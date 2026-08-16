/* ============================================================
   Is this a good workflow, or merely a legal one?

   compilePlan already refuses a plan that cannot become a canvas: unknown
   ids, a frame fed by two clips, start/end frames on a platform that has no
   such thing. Those are the failures you find out about immediately, because
   nothing gets built.

   This is the other kind. Every problem below compiles perfectly, opens on
   the canvas, and runs — and produces a workflow that is worse than the one
   the user asked for, in a way they only discover after spending the
   generations. A clip that restarts the shot instead of continuing it. A
   node that was supposed to be five nodes. A voice that Flow silently drops.

   Written as a checker rather than as prose in the brief because a rule in a
   prompt is a suggestion and a rule here is enforced: every problem goes back
   to the model as a repair instruction, the same way the storyboard's shot
   checker works. That is what stopped bad prompts reaching Flow, and this is
   the same failure one level up.
   ============================================================ */

import type { Plan, PlanStep } from './plan';
import { FLOW_VOICES, NO_VOICE } from '../flowVoices';

export interface PlanProblem {
  /** Step this is about, or '' for the plan as a whole. */
  step: string;
  /** Machine-readable kind, so a repair can be counted and tested. */
  code:
    | 'noContinuity' | 'voiceOnFrames'
    | 'voiceWithoutImage' | 'unknownVoice' | 'voiceButSilent' | 'castVoiceUnused'
    | 'storyUnused' | 'uploadUnused' | 'lonelyStory';
  /** What to tell the model, in its own terms. */
  detail: string;
}

/* A folded-shots check lived here and was deleted rather than tuned.
   The idea was sound — one step is one generation, so a prompt moving through
   time asks one clip to be several — but every implementation of it was a
   keyword list, and keywords cannot tell the two meanings of "then" apart:

     "looking down at the outfit then back up"          — one continuous action
     "mark the cut lines in pencil, then draw the knife" — one continuous action
     "she waves, then the scene cuts to the harbour"     — two shots

   The first two ship today, in tpl_outfit_swap and tpl_styrofoam_asmr, and
   twelve templates in total tripped the rule. Narrowing it to "cut to" and
   "shot 2:" only moved the line; tpl_emotional_short refers to "scene 1"
   legitimately, as the thing its loop must match.

   A check that fires on a dozen working workflows is worse than no check: it
   spends a repair round on every build and asks the model to break prompts
   that were right. Reinstating it needs a signal that is actually about shot
   boundaries — the model naming them in a field of its own, not prose read
   with a regex. */

const isGen = (s: PlanStep) => s.type === 'generate' || s.type === 'extend' || s.type === 'agent';
const isClip = (s: PlanStep) => isGen(s) && s.media === 'video';

export function checkPlan(plan: Plan): PlanProblem[] {
  const out: PlanProblem[] = [];
  const steps = Array.isArray(plan?.steps) ? plan.steps : [];
  if (!steps.length) return out;

  const byId = new Map(steps.map((s) => [s.id, s]));
  const feeds = new Map<string, string[]>();          // id -> ids it feeds
  for (const s of steps) {
    for (const i of [...(s.inputs || []), s.startFrame, s.endFrame].filter(Boolean) as string[]) {
      feeds.set(i, [...(feeds.get(i) || []), s.id]);
    }
  }
  const used = (id: string) => (feeds.get(id) || []).length > 0;
  const textInputs = (s: PlanStep) => (s.inputs || [])
    .map((i) => byId.get(i))
    .filter((d) => d && (d.type === 'story' || d.media === 'text'));
  const imageInputs = (s: PlanStep) => (s.inputs || [])
    .map((i) => byId.get(i))
    .filter((d) => d && (d.type === 'image' || d.type === 'frame' || d.media === 'image'));

  const voiceNames = new Set(FLOW_VOICES.map((v) => v.id.toLowerCase()));
  const story = steps.find((x) => x.type === 'story');
  const castVoices = (story?.cast || []).filter((c: any) => c?.voice && c.voice !== NO_VOICE);

  for (const s of steps) {
    /* Deliberately NOT checked here: a step with no prompt and nothing
       writing one, and a step with both. compilePlan already reports both,
       and a repair message that lists the same problem twice reads like two
       separate faults — the model then "fixes" one of them and resends. */

    /* ── Voices Flow can actually use ── */
    if (s.voice && s.voice !== NO_VOICE) {
      if (!voiceNames.has(String(s.voice).toLowerCase())) {
        out.push({
          step: s.id, code: 'unknownVoice',
          detail: `names the voice "${s.voice}", which Flow does not have. Use one of its `
            + `voices (for example ${FLOW_VOICES.slice(0, 3).map((v) => v.id).join(', ')}) or omit it.`,
        });
      }
      if (s.startFrame || s.endFrame) {
        out.push({
          step: s.id, code: 'voiceOnFrames',
          detail: 'sets a voice and uses start/end frames. Flow removes the ingredient menu '
            + 'entirely in that mode, so no voice can be attached — drop one or the other.',
        });
      } else if (!imageInputs(s).length) {
        out.push({
          step: s.id, code: 'voiceWithoutImage',
          detail: 'sets a voice but has no still in its "inputs". Flow attaches a voice to a '
            + 'character, so without one the clip is generated silent.',
        });
      }
    }
  }

  /* ── Continuity across a sequence ── */
  /* Only when the piece is ONE narrative, and a story director is what says
     so. Three clips is not by itself a chain: "Water Wipeouts: 4 Written by
     AI" ships four independent gags rendered from four separate prompts, and
     linking them would be the defect. Held against every shipped template for
     exactly this reason — the first version of this rule flagged that one, and
     a rule that fires on a workflow somebody already uses is worse than no
     rule, because it costs a repair round on every build and teaches the model
     to break something that was right. */
  const clips = steps.filter(isClip);
  if (story && clips.length >= 3) {
    const linked = steps.some((s) => s.type === 'frame')
      || steps.some((s) => s.startFrame && s.endFrame)
      || clips.some((s) => (s.inputs || []).some((i) => {
        const d = byId.get(i);
        return d && (isClip(d) || d.type === 'frame');
      }));
    if (!linked) {
      out.push({
        step: '', code: 'noContinuity',
        detail: `there are ${clips.length} clips and nothing carrying one into the next. Each `
          + 'will start from scratch, so the subject resets every time however carefully the '
          + 'prompts are written. Add a "frame" step between consecutive clips.',
      });
    }
  }

  /* ── The story, and the voices on it ── */
  if (story) {
    if (!used(story.id)) {
      out.push({
        step: story.id, code: 'storyUnused',
        detail: 'is a story director that nothing takes its prompt from. List it in the '
          + '"inputs" of every shot it should write.',
      });
    }
    if (castVoices.length && story.audioMode === 'none') {
      out.push({
        step: story.id, code: 'voiceButSilent',
        detail: 'casts voices but sets audioMode "none", so nobody speaks and every voice is '
          + 'ignored. Choose "dialogue" or "cinematic", or drop the voices.',
      });
    }
    if (castVoices.length) {
      const anyShotHasStill = steps.some(
        (s) => isClip(s) && !s.startFrame && imageInputs(s).length,
      );
      if (!anyShotHasStill) {
        out.push({
          step: story.id, code: 'castVoiceUnused',
          detail: 'casts voices, but no clip has a still in its "inputs". Flow attaches a voice '
            + 'to a character, so every clip would come back silent. Give the speaking shots a '
            + 'reference still.',
        });
      }
    }
    const lone = steps.filter((s) => s.type === 'story');
    if (lone.length > 1) {
      out.push({
        step: '', code: 'lonelyStory',
        detail: `there are ${lone.length} story directors. One writes the whole piece in a `
          + 'single reply, which is how the shots stay consistent — use one.',
      });
    }
  }

  /* ── Uploads nobody asked for ── */
  for (const s of steps) {
    if (s.type === 'image' && !used(s.id)) {
      out.push({
        step: s.id, code: 'uploadUnused',
        detail: 'is an upload slot nothing uses. Either feed it into a step or remove it — it '
          + 'asks the user for a picture and then ignores it.',
      });
    }
  }

  return out;
}

/**
 * Turn the problems into the next message.
 *
 * Addressed to the model that wrote the plan, listing what to change and
 * nothing else. Repeats the envelope requirement because a reply that fixes
 * every problem and arrives wrapped in prose is still a failed round.
 */
export function repairPlanMessage(problems: PlanProblem[], structural: string[] = []): string {
  const lines = [
    'That plan has problems. Fix them and send the whole JSON object again.',
    '',
  ];
  for (const p of structural) lines.push(`  · ${p}`);
  for (const p of problems) {
    lines.push(p.step ? `  · Step "${p.step}" ${p.detail}` : `  · ${p.detail}`);
  }
  lines.push(
    '',
    'Reply with ONE JSON object and nothing else — the same shape as before, with',
    'every step in it, not only the ones you changed.',
  );
  return lines.join('\n');
}

/** "2 problems: 1 folded shot, 1 voice without an image" — for the log. */
export function summarisePlan(problems: PlanProblem[]): string {
  if (!problems.length) return 'no problems';
  const counts = new Map<string, number>();
  for (const p of problems) counts.set(p.code, (counts.get(p.code) || 0) + 1);
  const parts = [...counts.entries()].map(([code, n]) => `${n}× ${code}`);
  return `${problems.length} problem${problems.length === 1 ? '' : 's'}: ${parts.join(', ')}`;
}
