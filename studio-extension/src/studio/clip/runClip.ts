/**
 * The stages, wired to the real asks.
 *
 * Every media operation arrives through `deps` rather than being imported
 * here. That is not ceremony: decoding and encoding need WebCodecs, which does
 * not exist under Jest, and the orchestration is the part most worth testing.
 * What prompt was sent, what was done with a bad reply, whether a repair round
 * was spent, whether a stage refused before spending anything — all of that is
 * testable with fakes, and all of it is where the bugs are.
 *
 * ── The shape of every stage ──────────────────────────────────────────────
 *
 * Ask, read, CHECK AGAINST SOMETHING WE ALREADY HAVE, repair once, refuse.
 * The checking step is the whole point. A model answering about audio always
 * answers; the question is never "did it reply" but "does its reply agree
 * with the transcript, the duration, the words actually spoken". Nothing here
 * trusts a reply because it parsed.
 */

import {
  beatAsk, checkBeats, blockingClipProblems, locateAsk, locateWindow,
  readBeats, readLocate, readWindow, repairBeats, repairWindow, windowAsk,
  campaignAsk, estimateSeconds, wordsOf,
  surveyAsk, readSurvey, SURVEY_COUNT, MIN_CLIP_SCORE,
  MAX_CLIP_SECONDS, MIN_CLIP_SECONDS,
  type Beat, type LocatedWindow, type MomentCandidate, type SurveyMoment,
  type Transcript,
} from '../ask/clipperBrain';
import { planChunks, stitch, looksTranscribed, type ChunkText } from './chunks';
import { faceAsk, frameTimes, readFaces, transcribeAsk } from './prompts';
import { planReframe, type ReframePlan } from '../media/reframe';
import { envelopeOf, findPeaks, joinEnvelopes, textNear, type Envelope } from './peaks';
import { emitPlan } from './emitPlan';
import { blendMoments, findTextMoments } from './textMoments';
import type { Plan } from '../builder/plan';
import { snapToSilence } from '../media/silence';
import type { StageId, StageRunner } from './stages';

/* ------------------------------------------------------------------ */
/* What the outside world has to provide                               */
/* ------------------------------------------------------------------ */

export interface AskOptions {
  firstTurn?: boolean;
  /** Data URLs. The adapter turns these into real files. */
  attachments?: string[];
}

export interface MonoPcmLike {
  samples: Float32Array;
  sampleRate: number;
  startSec: number;
}

export interface ProbeLike {
  durationSec: number;
  video: { width: number; height: number; rotation: number; decodable: boolean } | null;
  audio: { sampleRate: number; channels: number; decodable: boolean } | null;
  alreadyVertical: boolean;
}

export interface CutLike {
  blob: Blob;
  width: number;
  height: number;
  mode: string;
  report: string;
}

/** Everything that needs a browser. Injected so the rest can be tested. */
export interface ClipMedia {
  probe(file: File): Promise<ProbeLike>;
  /** A span of audio as a data URL, for uploading to the chat. */
  audioDataUrl(file: File, startSec: number, endSec: number): Promise<string>;
  /** Mono PCM around a moment, for snapping to a pause. */
  pcmAround(file: File, targetSec: number, radiusSec: number, durationSec: number): Promise<MonoPcmLike | null>;
  /** Stills as data URLs, for asking where the speaker is. */
  frames(file: File, timesSec: number[]): Promise<string[]>;
  cut(file: File, options: {
    startSec: number; endSec: number; plan?: ReframePlan | null; silent?: boolean;
  }): Promise<CutLike>;
}

export interface ClipDeps {
  ask(message: string, options?: AskOptions): Promise<string>;
  getSource(key: string): File | undefined;
  media: ClipMedia;
  /** Somewhere to keep the finished clip, which cannot live in node data. */
  putMedia(key: string, blob: Blob): void;
  signal?: AbortSignal;
  /** A line for the node's log. */
  log?: (line: string) => void;
}

/**
 * Which job this node is doing.
 *
 * 'campaign' is paid clipping against someone else's video under a brief.
 * Briefs routinely forbid "content that is not affiliated with this campaign",
 * which is exactly what a generated motion graphic is — so campaign mode
 * produces the cut clip and nothing else. The account doing the earning is
 * worth more than the differentiator.
 *
 * 'explainer' is the full pipeline, for content where nothing forbids it.
 */
export type ClipMode = 'campaign' | 'explainer';

export interface ClipConfig {
  sourceKey: string;
  mode?: ClipMode;
  /** Verbatim rules from the campaign brief, shown to the model. */
  campaignRules?: string;
  /** A transcript wired into the T input, which skips the slowest stage. */
  pastedTranscript?: string;
  targetAspect?: number;
  /** Shown on the emitted workflow, so a canvas names the video it came from. */
  sourceName?: string;
  /** How many clips to come back with. */
  clipCount?: number;
  /** How many moments the audio shortlists for the model to rank. */
  surveyCandidates?: number;
  /** The cap on a finished clip. Carried onto every cut this lays out. */
  longestSeconds?: number;
  /** Which chat is driving. Carried onto every cut this lays out. */
  platform?: string;
  /** Out of 100, below which a clip is not worth posting. */
  minClipScore?: number;
  /* Read the video on the server in one call instead of transcribing it in
     the chat, four minutes at a time. Needs a signed-in account: the model
     can only take a video natively through the API, and that key lives on a
     server rather than inside an extension anyone can unpack. */
  readOnServer?: boolean;
}

/* The transcribe stage's result.
   A plain Transcript when the chat produced it; a Transcript plus the reading
   it came from when the server did. Everything downstream works from the
   Transcript alone, and uses the reading only to SKIP work it would otherwise
   pay a model for. */
export type TranscribeResult = Transcript & { reading?: import('./readingApi').VideoReading };

/* ------------------------------------------------------------------ */
/* Stage results                                                       */
/* ------------------------------------------------------------------ */

export interface WindowResult {
  window: LocatedWindow;
  startSec: number;
  endSec: number;
  /** The clip's own words, for directing the beats against. */
  text: string;
}

export interface CutStageResult {
  mediaKey: string;
  startSec: number;
  endSec: number;
  clipSeconds: number;
  width: number;
  height: number;
  reframe: string;
  report: string;
}

export interface BeatsResult {
  beats: Beat[];
  advisories: string[];
}

/** How far either side of a chosen moment to look for a pause. */
const SNAP_RADIUS_SEC = 1.5;

/** One repair round. A second rarely helps and always costs. */
const REPAIR_ROUNDS = 1;

const DEFAULT_ASPECT = 9 / 16;

/* The shortlist the survey ranks.
   Wider than the four a single-clip run used, because the model is choosing a
   field rather than a winner and a shortlist barely larger than the answer
   leaves it nothing to reject. Not unbounded: every candidate carries its
   transcript into the prompt, and forty of them is a prompt no chat will
   read carefully. */
const SURVEY_CANDIDATES = 14;

/* Candidate spans are longer than a finished clip on purpose. The span is
   the neighbourhood the moment lives in, not the cut — the cut's real ends
   are found later, from the words, and a span that hugged the expected clip
   length would clip its own context out of the prompt. */
const SURVEY_SPAN_SEC = 50;

/* ------------------------------------------------------------------ */
/* The stages                                                          */
/* ------------------------------------------------------------------ */

function requireSource(deps: ClipDeps, cfg: ClipConfig): File {
  const file = deps.getSource(cfg.sourceKey);
  if (!file) {
    /* The bytes live in memory and the run lives in node data, so reopening
       Studio keeps the work and loses the file. Say which, and what to do. */
    throw new Error(
      'The video is not loaded any more. The transcript and the plan were kept — '
      + 'drop the same file on the node again to carry on.',
    );
  }
  return file;
}

export function ingestStage(deps: ClipDeps, cfg: ClipConfig): StageRunner {
  return async () => {
    const file = requireSource(deps, cfg);
    const probe = await deps.media.probe(file);

    if (!probe.audio) {
      throw new Error('That file has no audio track, so there is nothing to transcribe.');
    }
    if (!probe.audio.decodable) {
      throw new Error('This browser has no decoder for that audio, so the recording cannot be read.');
    }
    if (!(probe.durationSec > MIN_CLIP_SECONDS)) {
      throw new Error(
        `That recording is ${Math.round(probe.durationSec)}s long — shorter than the `
        + `${MIN_CLIP_SECONDS}s minimum for a clip, so there is nothing to choose from.`,
      );
    }
    deps.log?.(`${Math.round(probe.durationSec)}s, ${probe.video ? `${probe.video.width}x${probe.video.height}` : 'audio only'}`);
    return probe;
  };
}

export function transcribeStage(deps: ClipDeps, cfg: ClipConfig): StageRunner {
  return async (previous) => {
    const probe = previous as ProbeLike;

    /* The escape hatch, and by far the cheapest path: many podcasts publish a
       transcript, and using it turns eight minutes into nothing.

       Checked with the same rule as a transcript that came back from a chat,
       because the failure mode is worse here and used to be silent. T is the
       obvious place to wire a Prompt node, and a Prompt node is the obvious
       place to write direction — so "we want good video with motion graphics"
       became the transcript of a twenty-minute video. The survey then sliced
       six words across ten candidate moments, asked a chat which were worth
       posting, and got {"clips":[]} back, which was the only honest answer.
       The user saw a failed ranking stage and no hint that the real mistake
       was two stages earlier and theirs to fix. */
    if (cfg.pastedTranscript && cfg.pastedTranscript.trim()) {
      const complaint = looksTranscribed(cfg.pastedTranscript, probe.durationSec);
      if (complaint) {
        throw new Error(
          `The text wired into T ${complaint}. T takes a TRANSCRIPT of this video — `
          + 'if you meant to give direction or rules, put it in Settings under the '
          + 'brief instead, and leave T unwired so the video gets transcribed.',
        );
      }
      deps.log?.('using the transcript wired into T');
      return {
        chunks: [{ index: 0, start: 0, end: probe.durationSec, text: cfg.pastedTranscript.trim() }],
        duration: probe.durationSec,
      } satisfies Transcript;
    }

    const file = requireSource(deps, cfg);

    /* One call, on the server, when there is an account to bill it to.
       Six chunked chat transcriptions take about 145 seconds on a twenty
       minute video and come back with no timings; this comes back with the
       seconds attached, which is what lets every cut skip its own locating. */
    if (cfg.readOnServer) {
      const { readVideoOnServer, isUnavailable } = await import('./readingApi');
      const { readingToTranscript } = await import('./fromReading');

      try {
        const reading = await readVideoOnServer(file, probe.durationSec, {
          signal: deps.signal,
          onProgress: (line) => deps.log?.(line),
        });
        for (const reason of reading.dropped) deps.log?.(`dropped: ${reason}`);
        deps.log?.(
          `read by ${reading.model || 'the server'}: `
          + `${reading.segments.length} phrases, ${reading.scenes.length} scenes`,
        );
        return { ...readingToTranscript(reading), reading } satisfies TranscribeResult;
      } catch (error) {
        /* Only when the server CANNOT do this — no endpoint, no credentials,
           unreachable, or signed out. The extension and the service deploy
           separately, so a build that knows about video reading routinely
           meets a service that does not yet; failing the run over that would
           break clipping entirely for a feature nobody asked for.

           A quota refusal or an oversized video is NOT this. Those are the
           user's to act on, and falling back would hide them behind two
           minutes of chat transcription and a bill they did not expect. */
        if (!isUnavailable(error)) throw error;
        deps.log?.(
          `${(error as Error).message} — transcribing in the chat instead, which is slower`,
        );
      }
    }

    const plans = planChunks(probe.durationSec);
    const pieces: ChunkText[] = [];

    for (const plan of plans) {
      if (deps.signal?.aborted) throw new DOMException('aborted', 'AbortError');
      const audio = await deps.media.audioDataUrl(file, plan.start, plan.end);
      const reply = await deps.ask(transcribeAsk(), { firstTurn: true, attachments: [audio] });

      const seconds = plan.end - plan.start;
      const complaint = looksTranscribed(reply, seconds);
      if (complaint) {
        throw new Error(
          `The transcript of ${Math.round(plan.start)}–${Math.round(plan.end)}s ${complaint}.`,
        );
      }
      pieces.push({ index: plan.index, start: plan.start, end: plan.end, text: reply.trim() });
      deps.log?.(`transcribed ${plan.index + 1}/${plans.length}`);
    }

    return stitch(pieces, probe.durationSec);
  };
}

/**
 * Locate one quoted line inside the chunk it belongs to.
 *
 * Two-stage on purpose. The first ask is against a whole chunk, where the
 * measurements put the error near a second; the second is against a minute cut
 * around that answer, which is the regime that scored 0.68s. Narrowing rather
 * than trusting one ask is what turns "about right" into a usable cut point.
 */
async function locateLine(
  deps: ClipDeps,
  file: File,
  line: string,
  chunkStart: number,
  chunkEnd: number,
): Promise<number | null> {
  const chunkAudio = await deps.media.audioDataUrl(file, chunkStart, chunkEnd);
  const coarse = readLocate(
    await deps.ask(locateAsk(line, chunkEnd - chunkStart), { firstTurn: true, attachments: [chunkAudio] }),
    chunkEnd - chunkStart,
  );
  if (coarse === null) return null;

  const absolute = chunkStart + coarse;
  const from = Math.max(chunkStart, absolute - 30);
  const to = Math.min(chunkEnd, from + 60);
  if (to - from < 10) return absolute;

  const fineAudio = await deps.media.audioDataUrl(file, from, to);
  const fine = readLocate(
    await deps.ask(locateAsk(line, to - from), { firstTurn: true, attachments: [fineAudio] }),
    to - from,
  );
  return fine === null ? absolute : from + fine;
}

/**
 * The loudness envelope of the whole recording, chunk by chunk.
 *
 * Built here rather than carried out of the transcribe stage for two reasons.
 * Stage results are written to node data, which is JSON, and a Float32Array
 * does not survive that trip — it comes back as an object with numeric keys.
 * And a run using a pasted transcript never decodes anything during
 * transcription, so a envelope produced there would simply be missing exactly
 * when the escape hatch is used.
 *
 * The cost is one extra decode pass, a few seconds on a twenty-minute file,
 * against carrying a megabyte of numbers through a serialisation boundary.
 */
async function envelopeOfSource(
  deps: ClipDeps, file: File, durationSec: number,
): Promise<Envelope> {
  const parts: Envelope[] = [];
  for (const plan of planChunks(durationSec)) {
    if (deps.signal?.aborted) throw new DOMException('aborted', 'AbortError');
    const mid = (plan.start + plan.end) / 2;
    const pcm = await deps.media.pcmAround(file, mid, (plan.end - plan.start) / 2, durationSec);
    if (pcm?.samples.length) {
      parts.push(envelopeOf(pcm.samples, pcm.sampleRate, pcm.startSec));
    }
  }
  return joinEnvelopes(parts);
}

/**
 * Campaign mode's choice of moment: the audio shortlists, the model judges.
 *
 * Asked to find a moment in a transcript alone, a model reaches for the most
 * quotable sentence — which in a chase video is the narration, the calmest
 * part of the whole recording.
 */
async function campaignPick(
  deps: ClipDeps, cfg: ClipConfig, file: File, transcript: Transcript, durationSec: number,
): Promise<string> {
  const env = await envelopeOfSource(deps, file, durationSec);
  const peaks = findPeaks(env, { spanSec: 45, count: 4 });
  deps.log?.(`${peaks.length} candidate moments from the audio`);

  if (!peaks.length) {
    /* No dynamics to shortlist from — a lecture, or a badly levelled export.
       Fall back to reading the transcript rather than refusing outright. */
    deps.log?.('no peaks in the audio — choosing from the transcript instead');
    return windowAsk(transcript);
  }

  const candidates: MomentCandidate[] = peaks.map((p, i) => ({
    n: i + 1,
    start: p.start,
    end: p.end,
    why: p.why,
    text: textNear(transcript.chunks, p.start, p.end),
  }));
  return campaignAsk(candidates, cfg.campaignRules);
}

export function windowStage(deps: ClipDeps, cfg: ClipConfig): StageRunner {
  return async (previous) => {
    const transcript = previous as Transcript;
    const file = requireSource(deps, cfg);

    const opening = cfg.mode === 'campaign'
      ? await campaignPick(deps, cfg, file, transcript, transcript.duration)
      : windowAsk(transcript);

    let pick = readWindow(await deps.ask(opening, { firstTurn: true }));
    let located = pick ? locateWindow(pick, transcript) : { window: null, problems: [] };

    for (let round = 0; round < REPAIR_ROUNDS; round++) {
      const blocking = blockingClipProblems(located.problems);
      if (pick && located.window && !blocking.length) break;
      deps.log?.('the moment it picked did not check out — asking again');
      pick = readWindow(await deps.ask(
        pick ? repairWindow(located.problems) : opening,
      ));
      located = pick ? locateWindow(pick, transcript) : { window: null, problems: [] };
    }

    if (!pick || !located.window) {
      const why = located.problems.map((p) => p.detail).join(' ');
      throw new Error(`No usable moment came back. ${why}`.trim());
    }
    if (blockingClipProblems(located.problems).length) {
      throw new Error(
        `The chosen moment does not match the transcript. `
        + blockingClipProblems(located.problems).map((p) => p.detail).join(' '),
      );
    }

    const chunk = transcript.chunks[located.window.chunk] || transcript.chunks[0];

    const hookAt = await locateLine(deps, file, pick.hookLine, chunk.start, chunk.end);
    if (hookAt === null) {
      throw new Error('The opening line could not be found in the audio, so there is no point to cut from.');
    }

    /* The end is located too rather than estimated from the start. A window
       whose length came from a word count is a clip that ends mid-sentence
       whenever the speaker slows down. */
    const closeAt = await locateLine(deps, file, pick.closingLine, chunk.start, chunk.end);
    const endSec = closeAt !== null
      ? closeAt + estimateSeconds(pick.closingLine)
      : hookAt + located.window.estimatedSeconds;

    if (!(endSec > hookAt)) {
      throw new Error('The closing line was found before the opening one, so the clip would run backwards.');
    }

    const words = wordsOf(chunk.text);
    const text = words.join(' ');

    deps.log?.(`clip ${hookAt.toFixed(1)}–${endSec.toFixed(1)}s`);
    return {
      window: located.window,
      startSec: hookAt,
      endSec: Math.min(endSec, hookAt + MAX_CLIP_SECONDS),
      text,
    } satisfies WindowResult;
  };
}

/** Move a boundary onto a real pause, when there is one to move to. */
async function snapped(
  deps: ClipDeps, file: File, target: number, durationSec: number, label: string,
): Promise<number> {
  const pcm = await deps.media.pcmAround(file, target, SNAP_RADIUS_SEC, durationSec);
  if (!pcm) return target;
  const snap = snapToSilence(pcm.samples, pcm.sampleRate, target, { radiusSec: SNAP_RADIUS_SEC }, pcm.startSec);
  deps.log?.(`${label}: ${snap.why}`);
  return snap.found ? snap.seconds : target;
}

export function cutStage(deps: ClipDeps, cfg: ClipConfig): StageRunner {
  return async (previous, signal) => {
    const win = previous as WindowResult;
    const file = requireSource(deps, cfg);
    const probe = await deps.media.probe(file);

    const startSec = await snapped(deps, file, win.startSec, probe.durationSec, 'clip start');
    const endSec = await snapped(deps, file, win.endSec, probe.durationSec, 'clip end');
    if (!(endSec > startSec)) {
      throw new Error('Snapping to the nearest pauses left the clip with no length.');
    }

    /* Where the speaker is, asked once for every sampled still rather than
       once per still. */
    let plan: ReframePlan | null = null;
    const aspect = cfg.targetAspect ?? DEFAULT_ASPECT;
    if (probe.video && !probe.alreadyVertical) {
      const times = frameTimes(endSec - startSec);
      const stills = await deps.media.frames(file, times.map((t) => startSec + t));
      const faces = stills.length
        ? readFaces(await deps.ask(faceAsk(stills.length), { firstTurn: true, attachments: stills }), times)
        : [];
      plan = planReframe(faces, probe.video.width, probe.video.height, aspect);
      deps.log?.(`reframe: ${plan.why}`);
    } else if (probe.video) {
      deps.log?.('source is already vertical — no reframe');
    }

    if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
    const out = await deps.media.cut(file, { startSec, endSec, plan });
    const mediaKey = `${cfg.sourceKey}#clip`;
    deps.putMedia(mediaKey, out.blob);

    return {
      mediaKey,
      startSec,
      endSec,
      clipSeconds: endSec - startSec,
      width: out.width,
      height: out.height,
      reframe: plan ? plan.mode : 'none',
      report: out.report,
    } satisfies CutStageResult;
  };
}

export function beatsStage(deps: ClipDeps, cfg: ClipConfig, clipText: () => string): StageRunner {
  return async (previous) => {
    const cut = previous as CutStageResult;
    const file = requireSource(deps, cfg);
    const text = clipText();

    /* The clip's own audio goes up with the ask. The Editor is deciding when
       to cut away from a face, and the thing that decides it is delivery —
       where the speaker leans in, speeds up, pauses before the punchline. A
       transcript cannot carry any of that. */
    const audio = await deps.media.audioDataUrl(file, cut.startSec, cut.endSec);

    let reply = await deps.ask(beatAsk(cut.clipSeconds, text), { firstTurn: true, attachments: [audio] });
    let beats = readBeats(reply);
    let problems = checkBeats(beats, cut.clipSeconds, text);

    for (let round = 0; round < REPAIR_ROUNDS; round++) {
      if (beats.length && !blockingClipProblems(problems).length) break;
      deps.log?.('the beat map did not tile the clip — asking for the beats that failed');
      reply = await deps.ask(repairBeats(problems, cut.clipSeconds));
      const repaired = readBeats(reply);
      if (repaired.length) {
        beats = repaired;
        problems = checkBeats(beats, cut.clipSeconds, text);
      }
    }

    const blocking = blockingClipProblems(problems);
    if (!beats.length || blocking.length) {
      throw new Error(
        `The beat map cannot be built: ${(blocking.length ? blocking : problems)
          .slice(0, 3).map((p) => p.detail).join(' ')}`,
      );
    }

    const advisories = problems
      .filter((p) => !blockingClipProblems([p]).length)
      .map((p) => (p.shot ? `Beat ${p.shot} ${p.detail}` : p.detail));

    deps.log?.(`${beats.length} beats, ${beats.filter((b) => b.edit === 'b-roll').length} graphics`);
    return { beats, advisories } satisfies BeatsResult;
  };
}

/**
 * The five runners, ready for the stage machine.
 *
 * `clipText` is a function rather than a value because the beats stage needs
 * the window stage's text, and the stage machine only ever hands a runner the
 * result immediately before it.
 */
/**
 * Stages this configuration does not need, and why.
 *
 * Campaign briefs routinely forbid "content that is not affiliated with this
 * campaign". A generated motion graphic is precisely that, so campaign mode
 * never directs beats — and says so on the node rather than reporting a stage
 * as done that drew nothing.
 */
export function stagesToSkip(_cfg: ClipConfig): Partial<Record<StageId, string>> {
  /* Nothing is skipped any more. Campaign mode used to skip the beats stage,
     because a generated motion graphic is exactly the "content not affiliated
     with this campaign" a brief forbids. The stage is gone rather than
     skipped: what the node produces now is a field of cuts, and whether any
     of them gets B-roll is decided per cut, when the plan is emitted. */
  return {};
}

export interface SurveyResult {
  moments: SurveyMoment[];
  /** The shortlist they were chosen from, kept so the layout can read its seconds. */
  candidates: MomentCandidate[];
  /** The server reading, when there was one, so the layout can time the cuts exactly. */
  reading?: import('./readingApi').VideoReading;
  /** How many clips were asked for, so fewer can be explained rather than guessed at. */
  wanted: number;
  /** Why any of the reply's clips were thrown away. Empty is the normal case. */
  dropped: string[];
}

export interface LayoutResult {
  /** The plan handed to the canvas. */
  plan: Plan;
  count: number;
}

/**
 * Rank the moments worth posting.
 *
 * The audio shortlists and the model judges — the same division that made the
 * single-clip campaign ask work, widened from "pick the best of four" to
 * "rank the best of twelve". What the model is trusted with does not widen
 * with it: it chooses among candidates the loudness envelope proposed, and
 * never names a second. That constraint is the whole reason this is sound at
 * twenty minutes, where asking for timestamps directly is not.
 */
export function surveyStage(deps: ClipDeps, cfg: ClipConfig): StageRunner {
  return async (previous, signal) => {
    const transcript = previous as TranscribeResult;
    const file = requireSource(deps, cfg);

    const env = await envelopeOfSource(deps, file, transcript.duration);
    if (signal?.aborted) throw new DOMException('aborted', 'AbortError');

    const wantCandidates = cfg.surveyCandidates ?? SURVEY_CANDIDATES;
    const peaks = findPeaks(env, { spanSec: SURVEY_SPAN_SEC, count: wantCandidates });

    /* The other half of the shortlist, from what is SAID.
       Loudness is the right signal for a chase and the wrong one for a
       tutorial: run against a real trading video it picked a chart section as
       the strongest moment and rated a genuine piece of advice unremarkable.
       This needs phrase-level timings to exist, so it contributes nothing on
       a chat-built transcript and everything on a server reading. */
    const spoken = findTextMoments(transcript.chunks, { count: wantCandidates });
    if (spoken.length) {
      deps.log?.(`${spoken.length} moments from what is said, ${peaks.length} from the sound`);
    }

    const blended = blendMoments(peaks, spoken, wantCandidates);
    if (!blended.length) {
      throw new Error(
        'The audio has no moments that stand out from the rest of it — nothing '
        + 'is louder or busier than average. A recording at a constant level '
        + 'has to be clipped by hand.',
      );
    }

    const candidates: MomentCandidate[] = blended.map((p, i) => ({
      n: i + 1,
      start: p.start,
      end: p.end,
      why: p.why,
      text: textNear(transcript.chunks, p.start, p.end),
    }));
    deps.log?.(`${candidates.length} candidate moments to rank`);

    const wanted = Math.max(1, cfg.clipCount ?? SURVEY_COUNT);
    const dropped: string[] = [];
    const moments = readSurvey(
      await deps.ask(surveyAsk(candidates, {
        rules: cfg.campaignRules,
        count: wanted,
        /* Campaign briefs forbid footage that is not the creator's own, so the
           question does not offer B-roll at all rather than offering it and
           discarding the answer. */
        broll: cfg.mode === 'explainer',
        /* A campaign brief forbids "logos, hashtags, watermarks, or content
           that is not affiliated with this campaign", so a suggested hashtag
           is not a nice extra — it is a rejected post. */
        hashtags: cfg.mode === 'explainer',
        minScore: cfg.minClipScore,
      }), { firstTurn: true }),
      candidates.length,
      (reason) => dropped.push(reason),
      cfg.minClipScore ?? MIN_CLIP_SCORE,
    );

    if (!moments.length) {
      throw new Error(
        'Nothing usable came back from ranking the moments. The reply named no '
        + 'moment from the shortlist, or quoted no lines to cut between.',
      );
    }
    for (const reason of dropped) deps.log?.(`dropped: ${reason}`);

    /* Fewer than asked for is a legitimate answer — the question says so, and
       a video with six good moments should not be padded to ten. It is only
       worth remarking on so the number is explained rather than wondered at. */
    const asked = Math.min(wanted, candidates.length);
    deps.log?.(moments.length < asked
      ? `${moments.length} of ${asked} — the rest were not judged worth posting`
      : `${moments.length} clip${moments.length === 1 ? '' : 's'} worth posting`);

    return {
      moments, candidates, wanted: asked, dropped, reading: transcript.reading,
    } satisfies SurveyResult;
  };
}

/**
 * Turn the ranked moments into a plan.
 *
 * Kept separate from the survey so that re-laying-out is cheap: the ask has
 * already been paid for, and a clipper who deleted the nodes and wants them
 * back should not buy it again.
 */
export function layoutStage(deps: ClipDeps, cfg: ClipConfig): StageRunner {
  return async (previous) => {
    const survey = previous as SurveyResult;
    const plan = emitPlan(survey.moments, survey.candidates, {
      sourceKey: cfg.sourceKey,
      mode: cfg.mode === 'explainer' ? 'explainer' : 'campaign',
      sourceName: cfg.sourceName,
      maxSeconds: cfg.longestSeconds,
      platform: cfg.platform as any,
      reading: survey.reading,
    });
    const cuts = plan.steps.filter((s) => s.type === 'cut').length;
    deps.log?.(`laying out ${cuts} cut${cuts === 1 ? '' : 's'}`);
    return { plan, count: cuts } satisfies LayoutResult;
  };
}

export function clipRunners(
  deps: ClipDeps,
  cfg: ClipConfig,
): Record<'ingest' | 'transcribe' | 'survey' | 'layout', StageRunner> {
  return {
    ingest: ingestStage(deps, cfg),
    transcribe: transcribeStage(deps, cfg),
    survey: surveyStage(deps, cfg),
    layout: layoutStage(deps, cfg),
  };
}

/* ============================================================
   One cut, on its own.

   The five-stage machine above runs a whole video down to a single clip. A
   Cut node is the other shape: the survey already decided what this clip is,
   and all that remains is to find its two ends in the audio and encode
   between them. Same locate, same snap, same reframe, same encoder — no
   transcript, no stage machine, no beats.
   ============================================================ */

export interface OneCutConfig {
  sourceKey: string;
  /** The first thing said in the clip, quoted from the transcript. */
  hookLine: string;
  /** The last thing said in it. */
  closingLine: string;
  /** Where the audio said this moment is. Bounds the search, never the clip. */
  nearSec?: number;
  targetAspect?: number;
  /** Hard cap on the finished clip. */
  maxSeconds?: number;
  /* Boundaries already measured by a server reading. When both are present
     the two locate asks per line never happen — the seconds came from a
     reading of the audio rather than from a model guessing at them. */
  startSec?: number;
  endSec?: number;
  /* Where the speaker stands, relative to the clip's start. When present the
     stills are never cut and the frame-sampling ask never happens. */
  faces?: Array<{ t: number; x: number }>;
}

/* How far either side of `nearSec` to look.
   Asymmetric because `nearSec` is where a peak STARTS: the moment runs
   forward from it, and only the run-up sits behind. The total is 150s, which
   is inside the window size where timestamp answers were measured to be
   sound — a whole-recording attachment is where they stopped being. */
const SEARCH_BACK_SEC = 20;
const SEARCH_FORWARD_SEC = 130;

/**
 * Find the two lines, snap both ends to a pause, reframe, encode.
 *
 * The end has a fallback and the start does not, on purpose. A start that
 * cannot be found means the clip has no defensible beginning and guessing one
 * produces a post that opens mid-word. A missing END is recoverable: the words
 * between the two lines are known, and how long they take to say is a decent
 * estimate — the same fallback the window stage uses, and the one that ran for
 * real when the model refused a locate mid-run.
 */
export async function runOneCut(
  deps: ClipDeps, cfg: OneCutConfig,
): Promise<CutStageResult> {
  const file = deps.getSource(cfg.sourceKey);
  if (!file) {
    throw new Error(
      'The video is not loaded any more. This cut kept its lines — drop the '
      + 'same file on the Clipping node again to carry on.',
    );
  }

  const hook = cfg.hookLine.trim();
  const closing = cfg.closingLine.trim();
  if (!hook || !closing) {
    throw new Error('A cut needs both the line it opens on and the line it ends on.');
  }

  const probe = await deps.media.probe(file);
  const duration = probe.durationSec;

  /* Already known, from a reading of the whole video. Four asks — two per
     line, coarse then narrowed — for something that was measured once when
     the video was read. */
  const known =
    typeof cfg.startSec === 'number'
    && typeof cfg.endSec === 'number'
    && cfg.endSec > cfg.startSec
    && cfg.startSec >= 0
    && cfg.startSec < duration;

  let hookAt: number | null;
  let closingAt: number | null;

  if (known) {
    hookAt = cfg.startSec!;
    closingAt = Math.min(duration, cfg.endSec!);
    deps.log?.(
      `boundaries already read: ${hookAt.toFixed(1)}–${closingAt.toFixed(1)}s, nothing to ask`,
    );
  } else {
    const near = Math.max(0, Math.min(duration, cfg.nearSec ?? 0));
    const from = Math.max(0, near - SEARCH_BACK_SEC);
    const to = Math.min(duration, from + SEARCH_BACK_SEC + SEARCH_FORWARD_SEC);

    deps.log?.(`searching ${Math.round(from)}–${Math.round(to)}s for the opening line`);
    hookAt = await locateLine(deps, file, hook, from, to);
    if (hookAt === null) {
      throw new Error(
        `Could not find "${hook.slice(0, 40)}…" in the audio around `
        + `${Math.round(near)}s. Edit the opening line to match what is actually said.`,
      );
    }
    closingAt = await locateLine(deps, file, closing, from, to);
  }
  /* Ends before it begins is not a located end — it is the model having found
     an earlier utterance of a line that repeats. Estimating is better than
     encoding backwards. */
  const estimated = hookAt + estimateSeconds(`${hook} ${closing}`) + MIN_CLIP_SECONDS;
  const found = closingAt !== null && closingAt > hookAt ? closingAt : estimated;
  if (closingAt === null || closingAt <= hookAt) {
    deps.log?.('closing line not located — ending on the estimate from the words');
  }

  /* Capped. A closing line the model placed too late — or an estimate on a
     slow speaker — otherwise produces a clip far past anything postable, and
     the first anyone knows of it is a hundred-megabyte encode. */
  const cap = cfg.maxSeconds ?? MAX_CLIP_SECONDS;
  const rawEnd = Math.min(found, hookAt + cap);
  if (rawEnd < found) deps.log?.(`clip capped at ${Math.round(cap)}s`);

  const startSec = await snapped(deps, file, hookAt, duration, 'clip start');
  const endSec = await snapped(deps, file, Math.min(duration, rawEnd), duration, 'clip end');
  if (!(endSec > startSec)) {
    throw new Error('Snapping to the nearest pauses left the clip with no length.');
  }

  let plan: ReframePlan | null = null;
  const aspect = cfg.targetAspect ?? DEFAULT_ASPECT;
  if (probe.video && !probe.alreadyVertical) {
    /* Where the speaker stands, already described by the reading. Cutting
       eight stills out of the video and asking a chat to point at the person
       in each is the same answer, several seconds and one ask later. */
    const supplied = (cfg.faces || []).filter(
      (f) => Number.isFinite(f.t) && Number.isFinite(f.x),
    );

    let faces = supplied;
    if (faces.length < 2) {
      const times = frameTimes(endSec - startSec);
      const stills = await deps.media.frames(file, times.map((t) => startSec + t));
      faces = stills.length
        ? readFaces(await deps.ask(faceAsk(stills.length), { firstTurn: true, attachments: stills }), times)
        : [];
    } else {
      deps.log?.(`framing from ${faces.length} described scenes, nothing to ask`);
    }

    plan = planReframe(faces, probe.video.width, probe.video.height, aspect);
    deps.log?.(`reframe: ${plan.why}`);
  }

  const out = await deps.media.cut(file, { startSec, endSec, plan });
  /* Keyed by the lines rather than by the source, because a source now has
     many clips and `sourceKey#clip` would have every Cut node overwriting the
     one before it. */
  const mediaKey = `${cfg.sourceKey}#${hook.slice(0, 24)}`;
  deps.putMedia(mediaKey, out.blob);

  return {
    mediaKey,
    startSec,
    endSec,
    clipSeconds: endSec - startSec,
    width: out.width,
    height: out.height,
    reframe: plan ? plan.mode : 'none',
    report: out.report,
  } satisfies CutStageResult;
}
