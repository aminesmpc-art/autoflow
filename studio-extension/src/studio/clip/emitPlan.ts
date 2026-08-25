/**
 * A survey of a video, as a workflow.
 *
 * The Clipping node used to cut one clip and stop. This turns it into what the
 * Builder already is for ideas: something that reads the material once and
 * lays out the nodes to work it, so the clipper reviews a canvas instead of
 * waiting through a pipeline.
 *
 * ── Why the cuts carry lines and not seconds ──────────────────────────────
 *
 * Every cut node names the words at each end and finds the seconds itself when
 * it runs. That looks like extra work — the survey could locate everything up
 * front — and it is deliberate for three reasons:
 *
 *   1. Locating costs two model asks per clip. Ten clips is twenty asks before
 *      the user sees anything. Deferring it means the survey is ONE ask and
 *      the canvas appears immediately.
 *   2. Most of those clips will never be run. A clipper posts the best three
 *      and deletes the rest, and work done for the deleted seven is wasted.
 *   3. A node that holds its own quoted lines can be re-run after the source
 *      is re-dropped, or edited by hand to move an end. Seconds baked in at
 *      survey time are a number nobody can check.
 *
 * ── What B-roll nodes are, and are not ────────────────────────────────────
 *
 * They generate ASSETS, standing beside their cut. Nothing on the canvas
 * composites a generated shot over real footage, so the clipper still does the
 * intercutting in an editor. Emitting them unconnected is honest about that;
 * wiring them into the cut would imply an edit that does not happen.
 */

import type { Plan, PlanStep } from '../builder/plan';
import type { MomentCandidate, SurveyMoment } from '../ask/clipperBrain';
import type { VideoReading } from './readingApi';
import { framingFromReading, locateFromReading } from './fromReading';

export interface EmitOptions {
  sourceKey: string;
  /** Campaign briefs forbid footage that is not the creator's own. */
  mode: 'campaign' | 'explainer';
  /** Names the workflow after the video it came from. */
  sourceName?: string;
  /** Cap on a finished clip, carried onto every cut so each one enforces it. */
  maxSeconds?: number;
  /* Which chat the cuts should use.
     Without it every cut fell back to ChatGPT while the director it came from
     was set to Gemini — so the node you configured and the nodes doing the
     work disagreed, and nothing on screen said so. */
  platform?: PlanStep['platform'];
  /* The server reading, when the video was read in one call.
     Where a cut's two quoted lines can be found in it, the cut is given its
     seconds and the speaker's position outright — which is four locate asks
     and one frame-sampling ask it never has to make. */
  reading?: VideoReading;
  /** Burn the spoken words into the picture. On unless turned off. */
  captions?: boolean;
  /** Which look. Carried onto every cut so they match across a workflow. */
  captionPreset?: import('../media/captions').CaptionPreset;
  /** Plan what to ADD to each finished clip. See clip/editSheet.ts. */
  planEdit?: boolean;
  /* Where a cut puts its fallback asks. Carried onto every cut rather than
     read from a setting at run time, so a node keeps the behaviour it was laid
     out with even if the director is changed afterwards. */
  readOnServer?: boolean;
}


/* How far a cut may wander from where the reading placed it.
   Mirrors runOneCut: it searches SEARCH_BACK before the candidate second and
   SEARCH_FORWARD after it whenever the boundaries were not exact. Carrying the
   phrases for that whole window is a few kilobytes and means the captions are
   there wherever the cut lands. */
const SEARCH_BACK_SEC = 20;
const SEARCH_FORWARD_SEC = 130;

/* A clip snapped to silence starts up to SNAP_RADIUS_SEC from the planned
   second, so the window is padded rather than cut to the exact span. */
const SNAP_PAD_SEC = 2;

function phrasesAround(
  segments: Array<{ start: number; end: number; text: string }>,
  found: { startSec: number; endSec: number; exact: boolean } | null,
  nearSec: number,
  maxSeconds?: number,
): Array<{ start: number; end: number; text: string }> {
  let from: number;
  let to: number;
  if (found?.exact) {
    from = found.startSec - SNAP_PAD_SEC;
    to = found.endSec + SNAP_PAD_SEC;
  } else {
    from = Math.max(0, nearSec - SEARCH_BACK_SEC);
    to = from + SEARCH_BACK_SEC + SEARCH_FORWARD_SEC + (maxSeconds ?? 90);
  }
  return segments
    .filter((seg) => seg.end > from && seg.start < to)
    .map((seg) => ({ start: seg.start, end: seg.end, text: seg.text }));
}

/** A short, readable id that survives being looked at in JSON. */
const idFor = (rank: number, suffix = ''): string => `clip${rank}${suffix}`;

/**
 * The first few words of a line, for a node label.
 *
 * A cut node labelled "Cut" nine times is a canvas nobody can read. The hook
 * line is what distinguishes them, and its opening words are what a clipper
 * recognises.
 */
export function labelFor(rank: number, hookLine: string): string {
  const words = hookLine.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return `Clip ${rank}`;
  const short = words.slice(0, 5).join(' ').replace(/[.,!?;:]+$/, '');
  return `${rank}. ${short}${words.length > 5 ? '…' : ''}`;
}

/**
 * Turn ranked moments into a plan the compiler can lay out.
 *
 * Returns a Plan rather than nodes, so it goes through compilePlan like every
 * other built workflow — positions, ids, handles and edge validation included.
 * Writing nodes directly here would be a second, untested layout path.
 */
export function emitPlan(
  moments: SurveyMoment[],
  candidates: MomentCandidate[],
  options: EmitOptions,
): Plan {
  const steps: PlanStep[] = [];
  const byN = new Map(candidates.map((c) => [c.n, c]));

  for (const m of moments) {
    /* Looked up rather than asked for. Returns null when either line cannot
       be found, and the node falls back to locating from the audio — a miss
       costs asks, and a wrong answer would cut the wrong part of the video. */
    const found = options.reading
      ? locateFromReading(options.reading, m.hookLine, m.closingLine)
      : null;

    /* What the reading already knows about framing. "Nobody on camera" is an
       ANSWER, not a gap — spending an ask to rediscover it was costing one
       model call per clip on exactly the screen-recorded footage where the
       answer is most obvious. */
    const framing = found && options.reading
      ? framingFromReading(options.reading, found.startSec, found.endSec)
      : { kind: 'unknown' as const };

    const faces = framing.kind === 'tracked' ? framing.faces : undefined;

    steps.push({
      id: idFor(m.rank),
      type: 'cut',
      label: labelFor(m.rank, m.hookLine),
      sourceKey: options.sourceKey,
      hookLine: m.hookLine,
      closingLine: m.closingLine,
      why: m.why,
      /* What to write when posting it, decided once by the reply that judged
         the clip rather than asked for again per node. */
      title: m.title,
      score: m.score,
      /* Only when BOTH ends were found. A half-located clip keeps its
         measured start by way of nearSec and locates the rest, rather than
         running to an end nobody established. */
      startSec: found?.exact ? found.startSec : undefined,
      endSec: found?.exact ? found.endSec : undefined,
      faces,
      /* The spoken phrases, in the VIDEO's own seconds — not cue times.
         The cues used to be worked out here, against found.startSec, and they
         did not follow the voice. Two reasons, and the second is the bad one:

           · the cut SNAPS its boundaries to the nearest silence, up to 1.5s
             either way, so the clip does not begin where this thought it would
           · when the closing line was not found exactly, startSec is left
             undefined on purpose so the cut re-locates both ends from the
             audio — landing anywhere in a 150 second search window, while the
             captions stayed timed from a number it had already discarded

         Cue times can only be worked out against the boundaries the encoder
         actually used, so they are worked out there. This carries the words. */
      captionPhrases: options.captions === false || !found || !options.reading
        ? undefined
        : phrasesAround(options.reading.segments, found, byN.get(m.moment)?.start ?? 0, options.maxSeconds),
      captionPreset: options.captionPreset,
      /* The director's settings, carried onto the cut rather than read at
         run time, so a clip keeps the brief it was planned under. */
      planEdit: options.planEdit === true,
      mode: options.mode,
      readOnServer: options.readOnServer !== false,
      /* The candidate's own second, from the loudness envelope. A moment the
         survey named but the shortlist never contained would have none — but
         readSurvey drops those, so an unmatched number here means the two
         lists were built from different runs, and 0 (search from the start)
         is the safe reading of that. */
      /* A measured start beats the loudness envelope's guess at where to
         look; the envelope is only a search hint when nothing better exists. */
      nearSec: found?.startSec ?? byN.get(m.moment)?.start ?? 0,
      maxSeconds: options.maxSeconds,
      platform: options.platform,
      aspectRatio: '9:16',
    });

    /* Campaign mode drops B-roll even if the model offered some. The brief
       forbids content that is not affiliated with the campaign, and a node
       sitting on the canvas is an invitation to use it. */
    if (options.mode !== 'explainer') continue;

    m.broll.forEach((b, i) => {
      steps.push({
        id: idFor(m.rank, `_b${i + 1}`),
        type: 'generate',
        media: 'video',
        platform: 'flow',
        label: `${m.rank}. B-roll ${i + 1}`,
        aspectRatio: '9:16',
        duration: `${b.seconds}s`,
        prompt: b.prompt,
      });
    });
  }

  const name = options.sourceName
    ? `Clips from ${options.sourceName}`
    : 'Clips from the survey';

  return {
    name,
    description: `${moments.length} moment${moments.length === 1 ? '' : 's'} `
      + `ranked from the audio and judged on what is said. Each cut finds its own `
      + `seconds when it runs.`,
    steps,
  };
}
