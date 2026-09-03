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
  locateAsk, readLocate, estimateSeconds,
  surveyAsk, readSurvey, SURVEY_COUNT, MIN_CLIP_SCORE,
  MAX_CLIP_SECONDS, MIN_CLIP_SECONDS,
  type MomentCandidate, type SurveyMoment,
  type Transcript,
} from '../ask/clipperBrain';
import type { EditOp } from './editSheet';
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
    captions?: import('../media/captions').CaptionCue[];
    captionStyle?: import('../media/captions').CaptionStyle;
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
  /* Burn the spoken words into the picture. On unless turned off: about 85%
     of short-form views happen with the sound off, so a clip without them is
     one most of its audience cannot follow. */
  captions?: boolean;
  /** Which look the burned-in words take. See CaptionPreset. */
  captionPreset?: import('../media/captions').CaptionPreset;
  /* Plan what to add to each finished clip, for finishing in CapCut.
     Off by default: it costs one ask per cut. */
  planEdit?: boolean;
  /* Campaign work carries generated footage only when the brief allows it.
     The ban is the safe default — briefs forbid "content not affiliated with
     this campaign" and a generated cutaway is exactly that. This is the
     per-node decision that lifts it for one job, taken having read the brief. */
  allowGenerated?: boolean;
  /* Also encode every cut in pieces Omni will take. Flow refuses
     anything over ten seconds. */
  omniParts?: boolean;
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
export type TranscribeResult = Transcript & {
  reading?: import('./readingApi').VideoReading;
  /* Why the slow path was taken, when it was.
     Kept on the RESULT rather than logged, because a log line goes to
     statusNote and the next one overwrites it — so the single most important
     thing about a run ("this took two minutes instead of ten seconds, and
     here is the fixable reason") survived for about a second, and afterwards
     a fallback run was indistinguishable from a normal one. */
  fallback?: string;
};

/* ------------------------------------------------------------------ */
/* Stage results                                                       */
/* ------------------------------------------------------------------ */

export interface CutStageResult {
  mediaKey: string;
  /* What to ADD to this clip, and when. Not rendered onto it — the
     finishing happens in CapCut, so this is a list of timed instructions
     and, later, the assets to go with them. See clip/editSheet.ts. */
  editSheet?: import('./editSheet').EditOp[];
  /** Anything the plan asked for that could not be followed. */
  editDropped?: string[];
  /* The clip in pieces Omni will take, keyed like the clip itself with
     a part suffix. Empty when it already fits. */
  omniParts?: Array<{ mediaKey: string; index: number; of: number; seconds: number; cutsSpeech: boolean }>;
  /** The split in one line, for the node. */
  omniSplit?: string;
  /** Stretches the plan leaves flat. Legal, but worth saying. */
  editGaps?: string[];
  startSec: number;
  endSec: number;
  clipSeconds: number;
  width: number;
  height: number;
  reframe: string;
  report: string;
}

/** How far either side of a chosen moment to look for a pause. */
const SNAP_RADIUS_SEC = 1.5;

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
    let fellBackBecause: string | undefined;

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
        fellBackBecause = (error as Error).message;
        deps.log?.(`${fellBackBecause} — transcribing in the chat instead, which is slower`);
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

    return { ...stitch(pieces, probe.durationSec), fallback: fellBackBecause } satisfies TranscribeResult;
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

    /* Judged through the server when it can be, and through the chat when it
       cannot. The prompt and the parser are the same either way — only where
       the question is put changes — because the ranking was the last step
       still depending on a browser tab staying healthy, and on a real run it
       failed three times in a row while the API calls around it worked. */
    const judge = serverFirstAsk(deps, cfg.readOnServer === true, { did: 'ranked', doing: 'ranking' });
    const ask = (prompt: string): Promise<string> => judge(prompt, { firstTurn: true });

    const moments = readSurvey(
      await ask(surveyAsk(candidates, {
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
      })),
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
      allowGenerated: cfg.allowGenerated === true,
      sourceName: cfg.sourceName,
      maxSeconds: cfg.longestSeconds,
      platform: cfg.platform as any,
      reading: survey.reading,
      /* Inherited, so a director set to the chat does not lay out nine nodes
         that quietly use the API instead. */
      readOnServer: cfg.readOnServer !== false,
      captions: cfg.captions !== false,
      captionPreset: cfg.captionPreset,
      planEdit: cfg.planEdit === true,
      omniParts: cfg.omniParts === true,
    });
    const cuts = plan.steps.filter((s) => s.type === 'cut').length;
    deps.log?.(`laying out ${cuts} cut${cuts === 1 ? '' : 's'}`);
    return { plan, count: cuts } satisfies LayoutResult;
  };
}

/* ------------------------------------------------------------------ */
/* What one node may spend on API asks                                  */
/* ------------------------------------------------------------------ */

/*
 * These bound the asks that go to /api/clip/ask — the ones the service pays
 * for. Chat-tab asks are not counted and are not meant to be: those spend the
 * user's own account, which is the whole reason the chat path exists.
 *
 * The unit is the NODE, not the run. On the website a run is one call and can
 * be budgeted as one; a canvas lays out Cut nodes that execute separately,
 * later, and one at a time when somebody re-runs a single clip. There is no
 * moment that owns the whole thing.
 *
 * The stages between them make one API ask: the survey. Everything else in a
 * Clipping node is the reading (metered separately, on /read) or local work.
 * Six leaves room for a retry and for a stage that grows one.
 */
export const CLIP_NODE_ASK_CEILING = 6;

/*
 * A cut's worst case, when the reading could not answer anything about it:
 *
 *   locate the opening line, coarse then fine     2
 *   locate the closing line, coarse then fine     2
 *   where is the speaker, across eight stills     1
 *   plan the edit sheet, when planEdit is on      1
 *                                               ---
 *                                                 6
 *
 * Eight, so the ordinary case never comes near it and the pathological one
 * stops. A cut that runs out fails alone: planTheEdit swallows the refusal and
 * lets the clip stand, and a locate that cannot be paid for fails that node
 * rather than the workflow.
 */
export const CUT_NODE_ASK_CEILING = 8;

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

/**
 * Put a question to the server, and to a chat tab only when the server cannot.
 *
 * Every model decision in this pipeline goes through the API now: the reading,
 * the ranking, and — through this — the two asks a cut falls back on when the
 * reading could not answer it. What is left in the browser is decoding, cutting
 * and encoding, which is work a server would have to send the file back and
 * forth to do.
 *
 * Three reasons this is not just "cheaper":
 *
 *   · A chat ask means opening a conversation, uploading through a composer,
 *     waiting on a streamed reply, and leaving a thread behind. The same
 *     question over HTTP is one request.
 *   · The tab is the fragile part. On a real twenty-minute run the ranking
 *     failed three times in a row — message channel closed, did not finish
 *     answering, lost connection — while the API calls either side of it
 *     worked first time.
 *   · The chat path cannot be told which model to use, and Gemini's composer
 *     answers with whatever mode happens to be selected.
 *
 * The fallback survives on purpose. `unavailable` means the server CANNOT do
 * this — no endpoint, no credentials, unreachable, signed out — and the
 * extension and the service deploy separately, so a build that knows about
 * this endpoint will routinely meet a service that does not yet. Anything else
 * — a quota refusal, a rejected attachment, a model error — is a real answer
 * and is raised rather than quietly retried somewhere else at ten times the
 * latency.
 */
export function serverFirstAsk(
  deps: ClipDeps,
  onServer: boolean,
  /* Both tenses, because the two lines this writes need different ones and a
     log that says "asking in the chat instead" for every step does not say
     which step fell back — which is the only thing the line is for. */
  step: { did: string; doing: string },
): ClipDeps['ask'] {
  if (!onServer) return (message, options) => deps.ask(message, options);

  return async (message, options) => {
    try {
      const { askOnServer } = await import('./readingApi');
      const reply = await askOnServer(message, {
        signal: deps.signal,
        attachments: options?.attachments,
      });
      deps.log?.(`${step.did} on the server`);
      return reply;
    } catch (error) {
      const { isUnavailable } = await import('./readingApi');
      if (!isUnavailable(error)) throw error;
      deps.log?.(`${(error as Error).message} — ${step.doing} in the chat instead`);
      return deps.ask(message, options);
    }
  };
}

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
  /** The reading looked and found nobody on camera. Fit, do not ask. */
  noSpeaker?: boolean;
  /* The spoken phrases, in the VIDEO's own seconds. Turned into cue times
     below, once the clip's real boundaries are known — see emitPlan for what
     went wrong when they were worked out any earlier.
     About 85% of short-form views happen with the sound off. */
  captionPhrases?: Array<{ start: number; end: number; text: string }>;
  /** Which look. See CaptionPreset — 'clean' unless the node says otherwise. */
  captionStyle?: import('../media/captions').CaptionStyle;
  /* Plan what to add to the finished clip. Off by default: it costs an
     ask, and a clipper who only wants the cut should not pay for one. */
  planEdit?: boolean;
  /* Campaign work carries generated footage only when the brief allows it.
     The ban is the safe default — briefs forbid "content not affiliated with
     this campaign" and a generated cutaway is exactly that. This is the
     per-node decision that lifts it for one job, taken having read the brief. */
  allowGenerated?: boolean;
  /* Also encode the clip in pieces Omni will accept. Flow refuses
     anything over ten seconds, so a longer cut has to go in parts or not
     at all. Off by default: it is N more encodes for a clip most people
     will post as one. */
  omniParts?: boolean;
  /** Campaign work forbids generated footage. Shapes what may be planned. */
  mode?: 'campaign' | 'explainer';
  /** What the clip is about, from the reply that judged it. */
  title?: string;
  why?: string;
  /* Where the two fallback asks go when the reading could not answer them.
     Inherited from the Clipping node that laid this cut out, so a director set
     to the chat does not quietly emit nine nodes that use the API. Defaults on
     for a node saved before the flag existed. */
  readOnServer?: boolean;
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

  /* Both of the asks below are fallbacks — the reading answers them outright
     whenever it covers the clip. When one does fire it goes to the API, so a
     run makes no chat calls at all and the only work left in the browser is
     decode, cut and encode. */
  const onServer = cfg.readOnServer !== false;
  const netDeps: ClipDeps = { ...deps, ask: serverFirstAsk(deps, onServer, { did: 'answered', doing: 'asking' }) };

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
    hookAt = await locateLine(netDeps, file, hook, from, to);
    if (hookAt === null) {
      throw new Error(
        `Could not find "${hook.slice(0, 40)}…" in the audio around `
        + `${Math.round(near)}s. Edit the opening line to match what is actually said.`,
      );
    }
    closingAt = await locateLine(netDeps, file, closing, from, to);
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
    if (faces.length < 2 && cfg.noSpeaker) {
      /* Already answered by the reading: keep the whole frame on a blurred
         backdrop, which is what the ask would have concluded. */
      deps.log?.('the reading found nobody on camera — fitting, nothing to ask');
    } else if (faces.length < 2) {
      const times = frameTimes(endSec - startSec);
      const stills = await deps.media.frames(file, times.map((t) => startSec + t));
      faces = stills.length
        ? readFaces(
          await netDeps.ask(faceAsk(stills.length), { firstTurn: true, attachments: stills }),
          times,
        )
        : [];
    } else {
      deps.log?.(`framing from ${faces.length} described scenes, nothing to ask`);
    }

    plan = planReframe(faces, probe.video.width, probe.video.height, aspect);
    deps.log?.(`reframe: ${plan.why}`);
  }

  /* Cue times, worked out HERE and nowhere earlier.
     startSec and endSec above are the snapped, possibly re-located boundaries
     the encoder is about to use. Timing the words against anything else — the
     planned second, the candidate second — is what made the captions run
     ahead of the voice. */
  const phrases = (cfg.captionPhrases || []).filter(
    (p) => p && Number.isFinite(p.start) && Number.isFinite(p.end) && p.end > p.start,
  );
  const { cuesForClip } = await import('../media/captions');
  const captions = phrases.length ? cuesForClip(phrases, startSec, endSec) : [];
  if (captions.length) deps.log?.(`burning in ${captions.length} caption cues`);

  const out = await deps.media.cut(file, {
    startSec, endSec, plan, captions,
    captionStyle: cfg.captionStyle,
  });
  /* Keyed by the lines rather than by the source, because a source now has
     many clips and `sourceKey#clip` would have every Cut node overwriting the
     one before it. */
  const mediaKey = `${cfg.sourceKey}#${hook.slice(0, 24)}`;
  deps.putMedia(mediaKey, out.blob);

  /* Encoded from the SOURCE, not from the finished clip.
     Cutting an encode out of an encode is a second generation loss for
     no reason — every piece here is the same pixels the whole clip would
     have had, because the bounds are simply shifted into the source.

     The plan and the captions are rebased per piece. Both are timed
     against the CLIP, and a piece is encoded as its own video starting at
     zero — hand piece three the clip's plan unchanged and every keyframe
     points past the end of it. */
  const parts: NonNullable<CutStageResult['omniParts']> = [];
  let omniSplit: string | undefined;
  if (cfg.omniParts) {
    const { planOmniChunks, describeChunks, cuesForChunk, planForChunk } =
      await import('./omniChunks');
    const pieces = planOmniChunks(
      endSec - startSec,
      captions.map((c) => ({ startSec: c.startSec, endSec: c.endSec })),
    );
    omniSplit = describeChunks(pieces);

    /* One piece means it already fits, and re-encoding the whole clip
       under a second key would just be the same file twice. */
    if (pieces.length > 1) {
      deps.log?.(omniSplit);
      for (const piece of pieces) {
        if (deps.signal?.aborted) throw new DOMException('aborted', 'AbortError');
        const out = await deps.media.cut(file, {
          startSec: startSec + piece.startSec,
          endSec: startSec + piece.endSec,
          plan: planForChunk(plan as any, piece) as typeof plan,
          captions: cuesForChunk(captions, piece),
          captionStyle: cfg.captionStyle,
        });
        const partKey = `${mediaKey}#part${piece.index}`;
        deps.putMedia(partKey, out.blob);
        parts.push({
          mediaKey: partKey,
          index: piece.index,
          of: piece.of,
          seconds: piece.seconds,
          cutsSpeech: piece.cutsSpeech,
        });
      }
    }
  }

  /* Planned AFTER the clip exists and never allowed to cost it.
     The cut is the thing that took minutes and cannot be remade for free;
     the sheet is one text ask over a transcript already in hand. Throwing
     the first away because the second failed would be the wrong trade by
     several orders of magnitude. */
  let sheet: Awaited<ReturnType<typeof planTheEdit>> = {};
  if (cfg.planEdit) {
    sheet = await planTheEdit(
      deps, cfg, captions, endSec - startSec, onServer,
      /* Every join, as a second into the clip: the running total of the parts
         before it. The clip's own opening is not a join — nothing was spliced
         there — so the last total is dropped rather than the first. */
      parts.slice(0, -1).map((_, i) =>
        parts.slice(0, i + 1).reduce((sum, part) => sum + part.seconds, 0)),
    );
  }

  return {
    mediaKey,
    startSec,
    endSec,
    clipSeconds: endSec - startSec,
    width: out.width,
    height: out.height,
    reframe: plan ? plan.mode : 'none',
    report: out.report,
    omniParts: parts.length ? parts : undefined,
    omniSplit,
    ...sheet,
  } satisfies CutStageResult;
}


/**
 * Ask what to add to a finished clip, and refuse anything that cannot be done.
 *
 * Soft all the way through. Every failure here returns an empty sheet and lets
 * the cut stand: the clip took minutes of decoding and encoding, the sheet is
 * one text ask, and no version of this is worth losing the first for the
 * second. The node shows what came back, including what was refused.
 */
async function planTheEdit(
  deps: ClipDeps,
  cfg: OneCutConfig,
  captions: Array<{ startSec: number; endSec: number; text: string }>,
  clipSeconds: number,
  onServer: boolean,
  /* Where the clip was split for Omni. Each join is a real cut in the finished
     edit, and covering a cut is what a whoosh is for. */
  seams: number[] = [],
): Promise<{ editSheet?: EditOp[]; editDropped?: string[]; editGaps?: string[] }> {
  /* The clip's own words, already timed against it by the caption pass. Asking
     over anything else would put the instructions on a different timeline than
     the clip they belong to, which is the fault captions had. */
  if (!captions.length) {
    deps.log?.('no words in this clip to plan an edit around');
    return {};
  }

  try {
    const { editSheetAsk, readEditSheet, sheetGaps } = await import('./editSheet');
    const context = {
      clipSeconds,
      title: cfg.title,
      why: cfg.why,
      mode: cfg.mode,
      allowGenerated: cfg.allowGenerated === true,
      phrases: captions.map((c) => ({ startSec: c.startSec, endSec: c.endSec, text: c.text })),
      seams,
    };

    const ask = serverFirstAsk(deps, onServer, { did: 'planned the edit', doing: 'planning the edit' });
    const { ops, dropped } = readEditSheet(
      await ask(editSheetAsk(context), { firstTurn: true }),
      context,
    );

    for (const reason of dropped) deps.log?.(`edit dropped: ${reason}`);
    const gaps = sheetGaps(ops, clipSeconds);
    deps.log?.(
      ops.length
        ? `${ops.length} thing${ops.length === 1 ? '' : 's'} to add in the edit`
        : 'nothing worth adding to this clip',
    );

    return { editSheet: ops, editDropped: dropped, editGaps: gaps };
  } catch (error) {
    deps.log?.(`could not plan the edit: ${(error as Error)?.message || error}`);
    return {};
  }
}
