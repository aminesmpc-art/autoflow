/**
 * Producing the cut clip.
 *
 * Trim in time, crop in space, encode, mux — in ONE decode pass, because they
 * cannot sensibly be separated. Splitting them means decoding the source,
 * encoding an uncropped intermediate, decoding that again, cropping, and
 * encoding a second time: two full transcodes and two generations of loss to
 * make a file nobody wants.
 *
 * ── Why there is no lossless stream copy here ─────────────────────────────
 *
 * Every earlier plan specified `ffmpeg -ss … -to … -c copy`. Two problems.
 * You cannot crop compressed packets at all, so the reframe rules it out on
 * its own; and a stream copy can only begin on a keyframe, which in podcast
 * footage is every two to ten seconds. A clip asked to start at 512.24 would
 * actually start at 510.00 — silently, and often mid-sentence.
 *
 * Mediabunny reaches the same conclusion independently: a non-zero trim start
 * forces a transcode regardless. So we decode, and frame-accurate cutting
 * comes free with it.
 *
 * ── Two paths, on purpose ─────────────────────────────────────────────────
 *
 * A locked crop goes through mediabunny's own `crop` option, which never
 * touches a canvas. Only a tracked crop needs the per-frame `process` hook.
 * Most podcast footage is one fixed camera, so the common case takes the
 * cheap path.
 */

import {
  BufferTarget,
  Conversion,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  VideoSample,
  AudioSample,
  type Input,
  type Quality,
} from 'mediabunny';

import { rectAt, type Rect, type ReframePlan } from './reframe';
import { cueAt, drawCaption, type CaptionCue, type CaptionStyle } from './captions';
import {
  framingAt, tighten, opsAt, drawTextOp, sheetDraws, cutawayAt, coverBox,
  type Cutaway,
} from './overlay';
import { soundFor } from './sfx';
import {
  rampMap, retimeCues, retimeOps, retimeCutaways, type TimeMap,
} from './retime';
import type { EditOp } from '../clip/editSheet';

export interface CutOptions {
  startSec: number;
  endSec: number;
  /** Omit for no reframe — trim only, full frame. */
  plan?: ReframePlan | null;
  /** Strip the audio track. B-roll is handed over silent. */
  silent?: boolean;
  /** 0..1. */
  onProgress?: (fraction: number) => void;
  /** Defaults to QUALITY_HIGH. */
  quality?: Quality;
  /* Burned into the picture, timed against the CLIP. About 85% of short-form
     views happen with the sound off, so this is not decoration — it is
     whether most of the audience can follow the clip at all. */
  captions?: CaptionCue[];
  captionStyle?: CaptionStyle;
  /* The planned edit, timed against the CLIP, so the ops that CAN be drawn
     arrive on the picture instead of only in a list for CapCut. Only text,
     punch and zoom are rendered — see overlay.ts for why the other five are
     not drawing problems at all. */
  editSheet?: EditOp[];
  /* Generated cutaways, already rendered and timed against the CLIP. Separate
     from the sheet because these are bytes rather than a plan: a cutaway is
     the one kind that has to be made before it can be drawn. */
  cutaways?: Cutaway[];
}

export interface CutResult {
  blob: Blob;
  width: number;
  height: number;
  /** How the crop was applied, for the report. */
  mode: 'full-frame' | 'locked' | 'tracked';
  report: string;
}

/**
 * A quality LEVEL, not a bitrate.
 *
 * This was a flat 6 Mbps, chosen for "9:16 at 1080-ish". Run against a real
 * podcast it produced 23 MB for thirty seconds of a 304x540 clip — six
 * megabits for a frame a third the size of a source that manages the whole
 * picture in 2.3. A fixed bitrate cannot be right for both, and the crop size
 * depends on the source, so it is never knowable in advance.
 *
 * Mediabunny's quality levels scale with resolution and frame rate, which is
 * the thing that actually varies. `bitrate` is deprecated in its API for the
 * same reason.
 */
const DEFAULT_QUALITY = QUALITY_HIGH;

const isTracked = (plan: ReframePlan | null | undefined): boolean =>
  !!plan && plan.mode === 'tracked' && plan.keyframes.length > 1;

const staticRect = (plan: ReframePlan | null | undefined): Rect | null => {
  if (!plan || !plan.keyframes.length) return null;
  if (plan.mode === 'tracked') return null;
  return plan.keyframes[0].rect;
};

/**
 * Cut, reframe and encode.
 *
 * Returns the finished MP4 plus what was actually done to it, because a
 * checkmark explains nothing to someone looking at a clip that came out
 * wrong.
 */
export async function cutClip(input: Input, options: CutOptions): Promise<CutResult> {
  const { startSec, endSec, plan, silent, onProgress } = options;

  if (!(endSec > startSec)) {
    throw new Error(
      `Nothing to cut: the clip ends at ${endSec.toFixed(2)}s, which is not after `
      + `its start at ${startSec.toFixed(2)}s.`,
    );
  }

  const target = new BufferTarget();
  const output = new Output({ format: new Mp4OutputFormat(), target });

  const tracked = isTracked(plan);
  const fixed = staticRect(plan);

  /* Fitting draws rather than crops, so it needs the canvas path that tracking
     uses — a static crop rectangle cannot express "the whole frame, smaller,
     on a blurred copy of itself". */
  const fitting = plan?.mode === 'fit';

  /* Captions are painted onto the frame, so they need the same canvas the
     reframing paths use. Without this a clip with no reframe — an already
     vertical source — took mediabunny's straight-through route and the text
     had nowhere to be drawn. */
  /* ── The clock ──
     A ramp makes the clip longer, so every cue, op and cutaway after it is at
     the wrong second — and so is the picture, which has to be told where each
     source frame now lands. One map, built here, and everything below is on
     the output clock. Identity when there is no ramp, which is nearly always,
     and the identity map returns its input array untouched. */
  const srcSeconds = endSec - startSec;
  const rawSheet = (options.editSheet || []).filter((o) => typeof o?.atSec === 'number');
  const time: TimeMap = rampMap(rawSheet, srcSeconds);
  const ramping = !time.identity;

  const captions = retimeCues(
    (options.captions || []).filter((c) => c.endSec > c.startSec), time,
  );
  const captioning = captions.length > 0;

  /* The sheet turns the canvas on for the same reason captions do: a text card
     or a push-in has nowhere to be drawn on mediabunny's straight-through
     route. Only kinds this can actually render count — a sheet of nothing but
     sound effects must not force a clip onto the slower path for no pixels. */
  const sheet = retimeOps(rawSheet, time);
  const overlaying = sheetDraws(sheet);

  /* Cutaways turn the canvas on too — there is nowhere to draw one on
     mediabunny's straight-through route either. */
  const cutaways = retimeCutaways(
    (options.cutaways || []).filter((c) => c.seconds > 0), time,
  );

  /* Sounds the sheet named that we can actually make. Resolved here rather
     than per audio sample: soundFor caches, but the name matching would
     otherwise run a few thousand times for a clip with three whooshes. */
  const sounds = silent
    ? []
    : sheet
      .filter((op) => op.kind === 'sfx')
      .map((op) => ({ atSec: op.atSec, what: String(op.what || '') }))
      .filter((op) => op.atSec >= 0);

  /* A ramp needs the canvas too: a retimed frame is emitted as a new sample,
     and mediabunny's straight-through route hands packets over untouched. */
  const drawing = tracked || fitting || captioning || overlaying
    || cutaways.length > 0 || ramping;

  /* Output size is decided ONCE and never varies. An encoder is configured a
     single time; a frame that arrives one pixel wider than the configuration
     is a hard failure partway through a run. reframe.ts guarantees constant
     width and height across a plan, and this is the other half of that
     promise.
   *
     With no plan there is no crop, so the output is the source frame — read
     from the track rather than left at zero. This reported "0x0" for every
     un-reframed clip until a harness printed the number next to a video that
     was plainly 1920 wide. */
  const videoTrack = await input.getPrimaryVideoTrack();
  const outWidth = plan?.keyframes[0]?.rect.width ?? videoTrack?.displayWidth ?? 0;
  const outHeight = plan?.keyframes[0]?.rect.height ?? videoTrack?.displayHeight ?? 0;

  let canvas: OffscreenCanvas | null = null;
  let ctx: OffscreenCanvasRenderingContext2D | null = null;
  if (drawing) {
    canvas = new OffscreenCanvas(outWidth, outHeight);
    ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not get a 2D context to draw the reframed video into.');
  }

  /**
   * One output frame: the picture, then everything drawn over it.
   *
   * Lifted out of the process hook so a cutaway can be awaited before it runs
   * without making the common path async. Most clips have no cutaways and
   * most frames of a clip that does are not inside one, so the hook below
   * only returns a promise when it actually has to wait for something.
   */
  /**
   * One retimed frame, repeated enough times to keep the frame rate up.
   *
   * A frame slowed to half speed covers twice as long in the output. Emitted
   * once, that is half the frame rate for the length of the ramp — and a
   * momentary drop to 15fps is seen as a stutter, on the one move in the whole
   * sheet whose entire job is to look deliberate.
   *
   * So it is emitted twice, half the new duration each. No interpolation:
   * duplicated frames are what an editor does by default, and inventing
   * in-between frames from two real ones is a different project with a much
   * worse failure mode. RAMP_RATE is a half precisely so this divides evenly —
   * see retime.ts.
   *
   * Returns the sample itself when nothing is stretched, which is every frame
   * of every clip without a ramp.
   */
  const spread = (
    made: VideoSample, outT: number, outDur: number | undefined,
  ): VideoSample | VideoSample[] => {
    if (!ramping || !outDur || !canvas) return made;
    const copies = Math.round(outDur / (made.duration || outDur));
    if (copies < 2) return made;
    const each = outDur / copies;
    const out: VideoSample[] = [made];
    /* The canvas still holds the frame that was just painted, so every copy is
       that frame — which is the point. */
    for (let i = 1; i < copies; i++) {
      out.push(new VideoSample(canvas, { timestamp: outT + i * each, duration: each }));
    }
    /* The first one has to be shortened to match, or the copies overlap it. */
    return out.map((v, i) => (i === 0
      ? new VideoSample(canvas, { timestamp: outT, duration: each })
      : v));
  };

  const paint = (
    sample: VideoSample,
    frame: CanvasImageSource | null,
    outT: number,
    outDur: number | undefined,
  ): VideoSample => {
            /* How tight the frame goes at this instant. 1 when the sheet asks
               for nothing here, which is most frames of most clips. */
            /* Output seconds. The sheet was moved onto the output clock, so a
               card planned for 5s in a clip with a ramp before it is looked up
               at 5.4s here — the same instant, counted the way the finished
               clip counts. The PICTURE still uses source time: the reframe
               plan's keyframes were never moved, because the crop follows the
               speaker in the footage rather than in the edit. */
            const push = overlaying ? framingAt(sheet, outT) : 1;

            if (frame) {
              /* A cutaway REPLACES the picture for its hold — that is what a
                 cutaway is. Cover-fit rather than contain: a bordered box
                 appearing mid-sentence reads as a mistake, not as an edit.
                 Flow returns the ratio it was asked for, so the crop is
                 normally nothing; this is what stops a mismatch showing bars.

                 The push is deliberately NOT applied here. A punch is a move
                 on the speaker, and carrying it onto footage that has no
                 speaker in it just arrives as an unexplained scale. */
              const cw = (frame as any).displayWidth || (frame as any).codedWidth
                || (frame as any).width || outWidth;
              const ch = (frame as any).displayHeight || (frame as any).codedHeight
                || (frame as any).height || outHeight;
              const box = coverBox(cw, ch, outWidth, outHeight);
              ctx!.drawImage(frame, box.x, box.y, box.w, box.h);
            } else if (fitting) {
              /* The whole frame, centred, over a blurred enlarged copy of
                 itself. The backdrop is what stops a chart reading as a
                 lazily reposted landscape video; black bars say "this was not
                 made for here", which some campaign briefs penalise.

                 Source dimensions come off the sample rather than the track:
                 draw() honours rotation metadata, so a rotated source
                 presents different dimensions here than the container
                 advertises, and using the container's would letterbox it
                 sideways. */
              const sw = sample.displayWidth || sample.codedWidth;
              const sh = sample.displayHeight || sample.codedHeight;

              const cover = Math.max(outWidth / sw, outHeight / sh);
              const contain = Math.min(outWidth / sw, outHeight / sh);

              /* Blur scales with the frame, so a 640-wide clip and a
                 1920-wide one look the same rather than one looking sharp. */
              ctx!.filter = `blur(${Math.max(8, Math.round(outWidth / 24))}px)`;
              sample.draw(
                ctx!, 0, 0, sw, sh,
                (outWidth - sw * cover) / 2, (outHeight - sh * cover) / 2,
                sw * cover, sh * cover,
              );
              ctx!.filter = 'none';

              /* Only the sharp copy pushes in. Tightening the backdrop too
                 would move both layers together, and the whole reason the
                 backdrop is there is to stay put behind a frame that does
                 not fill the output. */
              const f = tighten({ left: 0, top: 0, width: sw, height: sh }, push);
              sample.draw(
                ctx!, f.left, f.top, f.width, f.height,
                (outWidth - sw * contain) / 2, (outHeight - sh * contain) / 2,
                sw * contain, sh * contain,
              );
            } else if (plan) {
            /* Timestamps here are ALREADY clip-relative — mediabunny rebases
               them against the trim before calling this, so a clip trimmed
               from 2s sees its first frame at 0, not at 2.
             *
               This originally subtracted startSec, on the assumption they
               were source-relative. Nothing threw: the crop path simply ran
               late by exactly the trim start, so a clip cut from 1s showed
               the frame the plan wanted a second earlier. It was found by
               checking the colour of the output pixels, and by nothing else. */
              /* Tightened about its own centre, so a tracked crop keeps
                 pointing at the speaker through the push instead of drifting
                 off them over a long hold. */
              const r = tighten(rectAt(plan, sample.timestamp), push);
              /* draw() honours rotation metadata, which is what stops a
                 portrait phone clip being cropped as though it were
                 landscape. */
              sample.draw(
                ctx!,
                r.left, r.top, r.width, r.height,
                0, 0, outWidth, outHeight,
              );
            } else {
              /* Captions on a clip that needs no reframe — an already vertical
                 source. The picture passes through at its own size and only
                 the text is added. */
              const sw = sample.displayWidth || sample.codedWidth;
              const sh = sample.displayHeight || sample.codedHeight;
              const r = tighten({ left: 0, top: 0, width: sw, height: sh }, push);
              sample.draw(ctx!, r.left, r.top, r.width, r.height, 0, 0, outWidth, outHeight);
            }

            /* Seconds, not microseconds. Every keyframe time in a reframe plan
               is in seconds and rectAt is fed this same value directly above,
               so the units are already established — getting it wrong here
               would show the first cue for the whole clip. */
            if (captioning) {
              const cue = cueAt(captions, outT);
              /* The timestamp goes in as well as being used to pick the cue:
                 the highlighting presets need to know which WORD is being said
                 right now, not just which line is up. */
              if (cue) {
                drawCaption(ctx!, cue, outWidth, outHeight, options.captionStyle, outT);
              }
            }

            /* Last, so a card is never painted under a caption. They are kept
               apart vertically as well — captions default to 0.72 of the
               frame and a card sits at 0.24 — but drawing order is the half
               of that promise which does not depend on a style setting. */
            if (overlaying) {
              for (const op of opsAt(sheet, outT, ['text'])) {
                drawTextOp(ctx!, op, outWidth, outHeight, outT);
              }
            }

            return new VideoSample(canvas!, { timestamp: outT, duration: outDur });
  };

  const conversion = await Conversion.init({
    input,
    output,
    trim: { start: startSec, end: endSec },
    /* ── Sound effects ──
       The audio twin of the video hook: called per input sample after
       remixing and resampling, handed back an AudioSample built from the
       modified PCM. Measured before it was written — a 1kHz tone mixed over a
       220Hz source came back at 0.175 inside its window against 0.000 outside
       it, with the carrier unchanged at 0.125 either side. See media/sfx.ts.

       The samples are ADDED, not replaced. An effect that ducked the speech
       would be doing a job nobody asked for, and the levels in sfx.ts are
       chosen to sit under a voice rather than beside one. */
    audio: silent
      ? { discard: true }
      : ((sounds.length || ramping)
        ? {
          process: (sample: AudioSample) => {
            const rate = sample.sampleRate;
            const channels = sample.numberOfChannels;
            const frames = sample.numberOfFrames;

            /* Resolved against THIS sample's rate. mediabunny may have
               resampled before calling us, and a sound generated at the
               source rate would play at the wrong pitch and length. */
            const live = sounds
              .map((s) => ({ at: s.atSec, pcm: soundFor(s.what, rate) }))
              .filter((s): s is { at: number; pcm: Float32Array } => !!s.pcm)
              .filter((s) => {
                const from = s.at;
                const to = s.at + s.pcm.length / rate;
                /* Against the OUTPUT window: sfx times were moved onto the
                   output clock with everything else. */
                return to > u0 && from < u0 + outFrames / rate;
              });
            /* Nothing to add and nothing to stretch: hand it straight back. */
            if (!live.length && !ramping) return sample;

            const size = sample.allocationSize({ planeIndex: 0, format: 'f32' });
            const src = new Float32Array(size / 4);
            sample.copyTo(src, { planeIndex: 0, format: 'f32' });

            /* ── The ramp, for audio ──
               Video is pushed forward through the map; audio is pulled back
               through it. This chunk covers [t0, t1) of source, which is
               [toOutput(t0), toOutput(t1)) of output — so for every output
               sample in that range, ask what source instant it should contain
               and read it, interpolating between neighbours.

               The pitch drops with the speed. That is not a compromise, it is
               the sound: a speed ramp that keeps its pitch is a slow-motion
               shot, and the thing creators reach for here is the tape-slowdown
               that makes the moment land. Time-stretching it to hold pitch
               would need a phase vocoder and would sound worse on speech than
               the effect everyone already recognises. */
            const t0 = sample.timestamp;
            const t1 = t0 + frames / rate;
            const u0 = ramping ? time.toOutput(t0) : t0;
            const outFrames = ramping
              ? Math.max(1, Math.round((time.toOutput(t1) - u0) * rate))
              : frames;

            let buf: Float32Array;
            if (!ramping || outFrames === frames) {
              buf = src;
            } else {
              buf = new Float32Array(outFrames * channels);
              for (let i = 0; i < outFrames; i++) {
                /* Where in the SOURCE this output sample comes from. */
                const at = (time.fromOutput(u0 + i / rate) - t0) * rate;
                const lo = Math.floor(at);
                const frac = at - lo;
                for (let c = 0; c < channels; c++) {
                  const a = src[Math.min(frames - 1, Math.max(0, lo)) * channels + c] || 0;
                  const b = src[Math.min(frames - 1, Math.max(0, lo + 1)) * channels + c] || 0;
                  buf[i * channels + c] = a + (b - a) * frac;
                }
              }
            }
            const outCount = buf.length / channels;

            for (const s of live) {
              for (let i = 0; i < outCount; i++) {
                const at = u0 + i / rate;
                const k = Math.round((at - s.at) * rate);
                if (k < 0 || k >= s.pcm.length) continue;
                const v = s.pcm[k];
                /* Interleaved, and the same sound in every channel — these
                   are mono by construction and panning one would put a cut
                   transition in one ear. */
                for (let c = 0; c < channels; c++) {
                  const j = i * channels + c;
                  /* Clamped. Adding to speech already near full scale can
                     exceed it, and an encoder given out-of-range samples
                     produces a crackle that sounds like a broken export. */
                  buf[j] = Math.max(-1, Math.min(1, buf[j] + v));
                }
              }
            }

            const mixed = new AudioSample({
              data: buf,
              format: 'f32',
              numberOfChannels: channels,
              sampleRate: rate,
              timestamp: u0,
            });
            sample.close();
            return mixed;
          },
        }
        : undefined),
    video: {
      quality: options.quality ?? DEFAULT_QUALITY,
      /* Only when nothing is being drawn. Handing mediabunny a crop while
         also drawing that crop onto a canvas applies it twice, and the second
         one lands on an already-cropped frame. */
      ...(fixed && !drawing ? { crop: fixed } : {}),
      ...(drawing && ctx && canvas
        ? {
          processedWidth: outWidth,
          processedHeight: outHeight,
          process: (sample: VideoSample) => {
            /* A cutaway is the one thing here that cannot be drawn from a
               description — it has to be generated first, and Flow takes
               minutes over it. So the clip is encoded without them and
               re-encoded once they exist; see finishCut in clip/runClip.ts. */
            const outT = ramping ? time.toOutput(sample.timestamp) : sample.timestamp;
            const srcDur = (sample.duration ?? 0) > 0 ? (sample.duration as number) : 0;
            const outDur = ramping && srcDur
              ? time.toOutput(sample.timestamp + srcDur) - outT
              : sample.duration;

            const over = cutaways.length ? cutawayAt(cutaways, outT) : null;
            if (!over) return spread(paint(sample, null, outT, outDur), outT, outDur);

            /* A cutaway that cannot be read is not worth losing the clip over.
               The frame it would have covered simply shows the speaker, which
               is what the clip looked like before any of this existed. */
            /* The cutaway's own clock is its own: it is a separate video and
               was never slowed, so it is read at how far INTO the cutaway the
               output has got, not at a source second of the clip. */
            return over.frameAt(outT - over.atSec)
              .then((frame) => spread(paint(sample, frame, outT, outDur), outT, outDur))
              .catch(() => spread(paint(sample, null, outT, outDur), outT, outDur));
          },
        }
        : {}),
    },
  });

  if (onProgress) {
    conversion.onProgress = (progress: number) => onProgress(progress);
  }

  await conversion.execute();

  if (!target.buffer) {
    throw new Error('The encode finished but produced no data.');
  }

  const blob = new Blob([target.buffer], { type: 'video/mp4' });
  const mode: CutResult['mode'] = tracked ? 'tracked' : fixed ? 'locked' : 'full-frame';
  const seconds = endSec - startSec;

  return {
    blob,
    width: outWidth,
    height: outHeight,
    mode,
    report: [
      `cut ${startSec.toFixed(2)}–${endSec.toFixed(2)}s (${seconds.toFixed(2)}s)`,
      mode === 'full-frame'
        ? 'full frame, no reframe'
        : `${mode} crop ${outWidth}x${outHeight}`,
      plan ? plan.why : null,
      silent ? 'audio discarded' : 'audio kept',
      `${(blob.size / 1e6).toFixed(2)} MB`,
    ].filter(Boolean).join(' · '),
  };
}
