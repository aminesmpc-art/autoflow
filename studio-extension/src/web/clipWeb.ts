/**
 * The clipping pipeline, driven from a web page instead of the canvas.
 *
 * The website runs the same four stages the Clipping node runs, and then the
 * same encoder each Cut node runs. Nothing about the pipeline is reimplemented
 * here — this file is the part WorkflowRunner.executeClipNode plays inside the
 * extension: it supplies the dependencies, drives the stage machine, and hands
 * back what came out. Every decision about what a clip IS still lives in
 * clip/ and media/, where it is unit tested.
 *
 * That matters more than it looks. The obvious way to put clipping on the site
 * was to port it, and a port means the survey prompt, the silence snapping,
 * the caption cue timing and the reframe planner all existing twice, in two
 * languages of JavaScript, drifting from the day they were written. The bug
 * that costs a user a clip would then have to be found and fixed twice.
 *
 * ── What is different on the web ──────────────────────────────────────────
 *
 *   · There is no chat tab. Inside the extension a model ask can fall back to
 *     a ChatGPT or Gemini window when the API cannot answer; a page has no
 *     such window, so `ask` below explains that rather than hanging.
 *   · There is no extension storage. The token and the host are injected
 *     (see readingApi.useInjectedCredentials) and the source file and the
 *     encoded clips live in module-level Maps for the life of the tab.
 *   · There is no canvas. The layout stage still emits a Plan — it is the
 *     tested path, and its cut steps carry exactly the fields runOneCut
 *     needs — but instead of compiling it into nodes, this walks the cut
 *     steps and encodes each one.
 */

import { advance, emptyRun, STAGE_LABEL, STAGE_ORDER, type ClipRun, type StageId } from '../studio/clip/stages';
import { clipRunners, runOneCut, stagesToSkip, type ClipConfig, type ClipDeps } from '../studio/clip/runClip';
import { askBudget, startAskBudget, useInjectedCredentials } from '../studio/clip/readingApi';
import type { Plan, PlanStep } from '../studio/builder/plan';
import type { CaptionPreset } from '../studio/media/captions';
import type { EditOp } from '../studio/clip/editSheet';

import { CAPTION_PRESETS } from '../studio/media/captions';

export { CAPTION_PRESETS };
export { STAGE_LABEL, STAGE_ORDER };
export type { StageId };

/* ------------------------------------------------------------------ */
/* Where the bytes live                                                */
/* ------------------------------------------------------------------ */

/* Keyed rather than passed around because that is the shape ClipDeps has, and
   the shape exists for a good reason inside the extension: node data is
   serialised into storage and a File cannot go through that. On the web the
   indirection buys nothing, but honouring it costs two Maps and means this
   file needs no changes to runClip at all. */
const sources = new Map<string, File>();
const media = new Map<string, Blob>();

/**
 * Forget everything a run held: the source file and every encoded clip.
 *
 * A 500MB recording still referenced after the page has finished with it is
 * 500MB of somebody's laptop spent on nothing, and the clips are not small
 * either. Cleared wholesale rather than by key prefix: runOneCut names its
 * output `${sourceKey}#${hookLine}`, that format is its business to change,
 * and a release that silently stops matching is worse than no release at all —
 * it looks like the memory is being freed.
 *
 * Safe because the web runs one video at a time. If that ever stops being
 * true, this needs the key, not a prefix guess.
 */
export function release(): void {
  sources.clear();
  media.clear();
}

/* ------------------------------------------------------------------ */
/* Can this browser do it at all                                       */
/* ------------------------------------------------------------------ */

export interface Supported {
  ok: boolean;
  /** Present when not. Written for a user, not for a log. */
  reason?: string;
}

/**
 * Whether this browser can encode video at all.
 *
 * Checked before anything is uploaded, because the alternative is a user
 * paying for a reading of a twenty-minute video and finding out at the encode
 * that their browser was never going to produce a file. WebCodecs is the hard
 * requirement: Chrome and Edge have had it since 94, Safari since 16.4,
 * Firefox since 130.
 */
export function supported(): Supported {
  if (typeof window === 'undefined') {
    return { ok: false, reason: 'Clipping runs in the browser and needs a page to run in.' };
  }
  if (typeof (globalThis as { VideoEncoder?: unknown }).VideoEncoder === 'undefined'
    || typeof (globalThis as { VideoDecoder?: unknown }).VideoDecoder === 'undefined') {
    return {
      ok: false,
      reason:
        'This browser cannot encode video. Clipping needs WebCodecs — Chrome or '
        + 'Edge 94 and up, Safari 16.4 and up, or Firefox 130 and up.',
    };
  }
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Running one                                                         */
/* ------------------------------------------------------------------ */

export interface WebClipOptions {
  /** The signed-in user's access token. Clipping is metered and needs one. */
  token: string;
  /** The extractor service. Defaults to production. */
  baseUrl?: string;

  /** How many clips to come back with. */
  clipCount?: number;
  /** How many moments the loudness envelope shortlists for the model to rank. */
  surveyCandidates?: number;
  /** Out of 100, below which a moment is not worth posting. */
  minClipScore?: number;
  /** The cap on a finished clip, in seconds. */
  longestSeconds?: number;
  /** Campaign is paid clipping under someone else's brief; see ClipMode. */
  mode?: 'campaign' | 'explainer';
  /** Verbatim rules from that brief, shown to the model. */
  campaignRules?: string;
  /** Burn the spoken words into the picture. On unless turned off. */
  captions?: boolean;
  captionPreset?: CaptionPreset;
  /** Also plan what to ADD to each clip. Costs one ask per cut. */
  planEdit?: boolean;
  /** Width over height. 9/16 unless asked otherwise. */
  targetAspect?: number;
  /** Names the run after the video it came from. */
  sourceName?: string;
  /**
   * The most model asks this run may make, on top of reading the video.
   *
   * Defaults to askCeilingFor(clipCount). Pass a number to override, or null
   * to count nothing — which is what the extension does, where a person is
   * watching a canvas and can stop it.
   */
  maxAsks?: number | null;

  signal?: AbortSignal;
  /** Called on every stage transition, for the progress rail. */
  onStages?: (run: ClipRun) => void;
  /** One line at a time, the same lines the node's status note shows. */
  onLog?: (line: string) => void;
  /** Called as each clip finishes encoding, so they appear one by one. */
  onClip?: (clip: WebClip) => void;
  /** How many cuts there are, as soon as the layout stage knows. */
  onPlanned?: (count: number) => void;
}

export interface WebClip {
  /** Stable within a run. Used as a React key and in the download name. */
  id: string;
  rank: number;
  label: string;
  /** What to write when posting it, from the reply that judged it. */
  title?: string;
  /** Why this moment is worth posting. */
  why?: string;
  score?: number;
  hookLine: string;
  closingLine: string;

  startSec: number;
  endSec: number;
  seconds: number;
  width: number;
  height: number;
  /** How the frame was arrived at — tracked, fitted, already vertical. */
  reframe: string;
  /** The encoder's own account of the cut, for a details line. */
  report: string;

  blob: Blob;
  /** An object URL for a <video>. Revoked by releaseRun, not before. */
  url: string;

  editSheet?: EditOp[];
  editDropped?: string[];
  editGaps?: string[];
}

export interface WebClipResult {
  /** The finished clips, best first. */
  clips: WebClip[];
  /** What the run spent against its ceiling, for the report. */
  asks: { ceiling: number; spent: number; left: number } | null;
  /** The plan the survey laid out, for the Studio .json hand-off. */
  plan: Plan;
  /** The stage machine's final state, for the report. */
  run: ClipRun;
  /** Cuts that were laid out but could not be encoded, and why. */
  failed: Array<{ label: string; error: string }>;
  sourceKey: string;
}

/**
 * The preset named on a plan step, if it names one this build can draw.
 *
 * A Plan is JSON: it survives being saved, edited by hand and reopened by a
 * later version, so its preset is typed as a string rather than as one of
 * five. Anything unrecognised falls back to the default look, which is what
 * a clipper wants from a typo far more than a clip with no words on it.
 */
const presetOf = (named: string | undefined): CaptionPreset | undefined =>
  named && (CAPTION_PRESETS as string[]).includes(named)
    ? (named as CaptionPreset)
    : undefined;

/**
 * How many model asks a run of N clips is allowed.
 *
 * A run's asks are one for the survey, then per cut: up to four to locate the
 * two spoken lines when the reading could not, one to find the speaker across
 * eight stills, and one to plan the edit sheet. The reading answers the first
 * five of those on ordinary footage, so the usual spend is 1 + N; the worst
 * case is 1 + 6N, and ten clips of worst case is sixty-one asks that no quota
 * counts.
 *
 * Two per cut plus six: comfortable headroom over the usual spend, and about a
 * third of the pathological one. The point is not to make a good run fail — it
 * is that a video which defeats the reading should stop somewhere rather than
 * quietly costing six times what the same run costs on footage that works.
 */
export const askCeilingFor = (clips: number): number =>
  6 + 2 * Math.max(1, Math.min(20, Math.floor(clips || 1)));

/** A key for this file, in this tab. Content-addressing it would mean hashing
    500MB to learn something only this tab needs to know. */
const keyFor = (): string =>
  `web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/**
 * Read a video, rank its moments, and encode every clip that survived.
 *
 * Resolves once every cut has been attempted. A cut that fails does not fail
 * the run — nine good clips and one that could not find its closing line is
 * nine clips, and throwing them away because of the tenth would be the worst
 * possible reading of one bad locate.
 */
export async function runWebClipping(
  file: File,
  options: WebClipOptions,
): Promise<WebClipResult> {
  const check = supported();
  if (!check.ok) throw new Error(check.reason);
  if (!options.token) {
    throw new Error('Clipping needs a signed-in account — the model reads the video on the server.');
  }

  useInjectedCredentials({
    token: options.token,
    baseUrl: (options.baseUrl || DEFAULT_BASE).replace(/\/+$/, ''),
  });

  const say = options.onLog || (() => {});
  const sourceKey = keyFor();
  sources.set(sourceKey, file);

  /* Opened before any stage runs and left open until the run returns, so the
     survey, the per-cut fallbacks and the edit sheets all draw on one number
     rather than each getting their own allowance. */
  startAskBudget(
    options.maxAsks === null
      ? null
      : options.maxAsks ?? askCeilingFor(options.clipCount ?? 6),
  );

  /* Imported here rather than at the top, for the same reason WorkflowRunner
     does it: this pulls in mediabunny, and a static import would put a demuxer
     into the first bytes the page loads whether or not anyone clips anything. */
  const { clipMedia } = await import('../studio/clip/clipMedia');

  const deps: ClipDeps = {
    /* Only ever reached when the server says it CANNOT answer — no endpoint,
       no credentials, unreachable. Inside the extension that falls back to a
       chat tab. Here there is none, so this says so instead of failing with
       whatever error the last fetch happened to leave behind. */
    ask: async () => {
      throw new Error(
        'The clipping service could not answer, and a web page has no chat window '
        + 'to fall back on. AutoFlow Studio can run this against your own ChatGPT '
        + 'or Gemini account instead.',
      );
    },
    getSource: (key: string) => sources.get(key),
    putMedia: (key: string, blob: Blob) => { media.set(key, blob); },
    media: clipMedia,
    signal: options.signal,
    log: say,
  };

  const cfg: ClipConfig = {
    sourceKey,
    mode: options.mode === 'explainer' ? 'explainer' : 'campaign',
    campaignRules: options.campaignRules,
    sourceName: options.sourceName || file.name,
    clipCount: options.clipCount,
    surveyCandidates: options.surveyCandidates,
    longestSeconds: options.longestSeconds,
    minClipScore: options.minClipScore,
    targetAspect: options.targetAspect ?? 9 / 16,
    captions: options.captions !== false,
    captionPreset: options.captionPreset,
    planEdit: options.planEdit === true,
    /* Both off on the web. Generated B-roll needs a Flow account the site does
       not have, and Omni parts are N extra encodes for pieces only the canvas
       can feed anywhere. */
    allowGenerated: false,
    omniParts: false,
    /* Not optional here. The chat path needs tabs this page does not have. */
    readOnServer: true,
  };

  const run = await advance(emptyRun(sourceKey), {
    runners: clipRunners(deps, cfg),
    skip: stagesToSkip(cfg),
    signal: options.signal,
    onChange: (state) => options.onStages?.(state),
  });

  const failedStage = STAGE_ORDER
    .map((id) => [id, run.stages[id]] as const)
    .find(([, rec]) => rec.status === 'failed');
  if (failedStage) {
    throw new Error(failedStage[1].error || `The ${STAGE_LABEL[failedStage[0]]} stage failed.`);
  }

  const layout = run.stages.layout.result as { plan?: Plan; count?: number } | undefined;
  const plan = layout?.plan;
  if (!plan) throw new Error('The survey produced no plan to cut from.');

  const cuts = plan.steps.filter((s) => s.type === 'cut');
  options.onPlanned?.(cuts.length);
  if (!cuts.length) {
    return { clips: [], plan, run, failed: [], sourceKey, asks: askBudget() };
  }

  const clips: WebClip[] = [];
  const failed: Array<{ label: string; error: string }> = [];

  /* One at a time. Encoding saturates the machine, and two clips racing for
     the same decoder finish no sooner while making the progress meaningless. */
  for (let i = 0; i < cuts.length; i++) {
    const step = cuts[i];
    if (options.signal?.aborted) break;
    const label = step.label || `Clip ${i + 1}`;
    say(`cutting ${i + 1} of ${cuts.length} — ${label}`);

    try {
      const cut = await runOneCut(deps, {
        sourceKey,
        hookLine: step.hookLine || '',
        closingLine: step.closingLine || '',
        nearSec: typeof step.nearSec === 'number' ? step.nearSec : 0,
        maxSeconds: step.maxSeconds,
        targetAspect: cfg.targetAspect,
        startSec: step.startSec,
        endSec: step.endSec,
        faces: step.faces,
        readOnServer: true,
        captionPhrases: step.captionPhrases,
        captionStyle: presetOf(step.captionPreset) ? { preset: presetOf(step.captionPreset) } : undefined,
        planEdit: step.planEdit === true,
        omniParts: false,
        allowGenerated: false,
        mode: cfg.mode,
        title: step.title,
        why: step.why,
      });

      const blob = media.get(cut.mediaKey);
      if (!blob) throw new Error('The clip encoded but its bytes went missing.');

      const clip: WebClip = {
        id: step.id,
        rank: i + 1,
        label,
        title: step.title,
        why: step.why,
        score: step.score,
        hookLine: step.hookLine || '',
        closingLine: step.closingLine || '',
        startSec: cut.startSec,
        endSec: cut.endSec,
        seconds: cut.clipSeconds,
        width: cut.width,
        height: cut.height,
        reframe: cut.reframe,
        report: cut.report,
        blob,
        url: URL.createObjectURL(blob),
        editSheet: cut.editSheet,
        editDropped: cut.editDropped,
        editGaps: cut.editGaps,
      };
      clips.push(clip);
      options.onClip?.(clip);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      /* An abort is the user stopping, not a cut that could not be made. */
      if ((error as { name?: string })?.name === 'AbortError') break;
      failed.push({ label, error: message });
      say(`${label} could not be cut — ${message}`);
    }
  }

  const asks = askBudget();
  if (asks && asks.left === 0) {
    say(`the ${asks.ceiling}-ask ceiling was reached — anything unanswered was left alone`);
  }
  /* Closed here rather than in a finally: a throw above leaves the run's spend
     readable, which is the state somebody debugging a failed run wants. The
     next run opens its own. */
  startAskBudget(null);

  return { clips, plan, run, failed, sourceKey, asks };
}

/* The production extractor service. The same default the extension ships
   with — api.auto-flow.studio is Django and serves none of these routes. */
export const DEFAULT_BASE = 'https://autoflow-extractor-production.up.railway.app';

/** What the service will accept, so the page can refuse a file before the
    upload rather than after it. */
export const LIMITS = {
  maxBytes: 500 * 1024 * 1024,
  maxSeconds: 2 * 60 * 60,
  types: ['video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/webm', 'video/x-matroska'],
};

/**
 * Read a file's duration without decoding it.
 *
 * Used to refuse an over-long video before it is uploaded, and to show the
 * length beside the filename. Falls back to null rather than throwing: a
 * container this cannot read is the server's business to reject, with a
 * better message than this could write.
 */
export async function probeDuration(file: File): Promise<number | null> {
  try {
    const { clipMedia } = await import('../studio/clip/clipMedia');
    const probe = await clipMedia.probe(file);
    return Number.isFinite(probe.durationSec) ? probe.durationSec : null;
  } catch {
    return null;
  }
}

/** A step's fields, for the callers that want the plan without the cuts. */
export type { Plan, PlanStep, ClipRun, EditOp, CaptionPreset };
