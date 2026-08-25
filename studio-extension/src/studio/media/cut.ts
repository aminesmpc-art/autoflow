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
  type Input,
  type Quality,
} from 'mediabunny';

import { rectAt, type Rect, type ReframePlan } from './reframe';
import { cueAt, drawCaption, type CaptionCue, type CaptionStyle } from './captions';

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
  const captions = (options.captions || []).filter((c) => c.endSec > c.startSec);
  const captioning = captions.length > 0;
  const drawing = tracked || fitting || captioning;

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

  const conversion = await Conversion.init({
    input,
    output,
    trim: { start: startSec, end: endSec },
    audio: silent ? { discard: true } : undefined,
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
            if (fitting) {
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

              sample.draw(
                ctx!, 0, 0, sw, sh,
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
              const r = rectAt(plan, sample.timestamp);
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
              sample.draw(ctx!, 0, 0, sw, sh, 0, 0, outWidth, outHeight);
            }

            /* Seconds, not microseconds. Every keyframe time in a reframe plan
               is in seconds and rectAt is fed this same value directly above,
               so the units are already established — getting it wrong here
               would show the first cue for the whole clip. */
            if (captioning) {
              const cue = cueAt(captions, sample.timestamp);
              if (cue) drawCaption(ctx!, cue, outWidth, outHeight, options.captionStyle);
            }

            return new VideoSample(canvas!, {
              timestamp: sample.timestamp,
              duration: sample.duration,
            });
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
