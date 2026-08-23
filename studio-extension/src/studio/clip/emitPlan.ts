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

export interface EmitOptions {
  sourceKey: string;
  /** Campaign briefs forbid footage that is not the creator's own. */
  mode: 'campaign' | 'explainer';
  /** Names the workflow after the video it came from. */
  sourceName?: string;
  /** Cap on a finished clip, carried onto every cut so each one enforces it. */
  maxSeconds?: number;
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
    steps.push({
      id: idFor(m.rank),
      type: 'cut',
      label: labelFor(m.rank, m.hookLine),
      sourceKey: options.sourceKey,
      hookLine: m.hookLine,
      closingLine: m.closingLine,
      why: m.why,
      /* The candidate's own second, from the loudness envelope. A moment the
         survey named but the shortlist never contained would have none — but
         readSurvey drops those, so an unmatched number here means the two
         lists were built from different runs, and 0 (search from the start)
         is the safe reading of that. */
      nearSec: byN.get(m.moment)?.start ?? 0,
      maxSeconds: options.maxSeconds,
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
