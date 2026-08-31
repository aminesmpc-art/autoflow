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
    | 'storyUnused' | 'uploadUnused' | 'lonelyStory' | 'tooManyReferences'
    | 'orphanStill' | 'thinPrompt' | 'mixedAspect';
  /** What to tell the model, in its own terms. */
  detail: string;
}

/**
 * The same problem, said to a person.
 *
 * `detail` is written at the model: it names the field to change and the
 * repair to make, because that is what gets a better plan back. Shown to
 * someone building a video it reads as an instruction they did not ask for —
 * and the panel was showing worse than that, the raw codes, "2× noContinuity,
 * 1× voiceWithoutImage", which is a stack trace in a consumer product.
 *
 * So each code gets a sentence about the OUTPUT rather than the plan: not
 * what to change, but what the video will do wrong if nobody does. That is
 * the thing the user can judge, and the only reason they would care.
 */
const HUMAN: Record<PlanProblem['code'], string> = {
  noContinuity:
    'Each clip starts from scratch, so the subject changes between them however '
    + 'carefully the prompts are written.',
  voiceOnFrames:
    'This clip asks for a voice and also pins its first and last frame. Flow hides '
    + 'the voice picker entirely in that mode, so it would come back silent.',
  voiceWithoutImage:
    'This clip asks for a voice but has no picture of who is speaking, so Flow has '
    + 'nobody to attach the voice to and the clip comes back silent.',
  unknownVoice: 'That is not one of Flow’s voices, so no voice would be set at all.',
  voiceButSilent:
    'Voices are cast but the piece is set to have no sound, so nobody would speak.',
  castVoiceUnused:
    'Voices are cast but no clip has a picture of the character, so every one of '
    + 'them would come back silent.',
  storyUnused:
    'The story director writes the prompts and nothing is set to use them, so the '
    + 'shots would be generated from whatever was typed instead.',
  uploadUnused: 'This asks you for a picture and then never uses it.',
  lonelyStory:
    'There is more than one story director. They cannot see each other’s answers, '
    + 'so the shots would not agree about the character or the place.',
  tooManyReferences:
    'One shot is given more reference pictures than Flow accepts, so the extra ones '
    + 'would be dropped when the clip is generated.',
  orphanStill:
    'One of the stills is generated and then never used. You would pay for it and '
    + 'it would not appear anywhere in the finished video.',
  thinPrompt:
    'One step has barely any prompt, so what comes back is whatever the model felt '
    + 'like — and it will not match the shots around it.',
  mixedAspect:
    'The clips are not all the same shape, so they cannot be cut together without '
    + 'bars down the side or a crop that loses part of the frame.',
};

/**
 * What each problem means for the finished video, in order, deduplicated.
 *
 * Deduplicated because the same fault on four clips is one thing to understand
 * and one thing to fix — four identical sentences reads as four problems.
 */
export function explainPlan(problems: PlanProblem[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of problems) {
    const line = HUMAN[p.code];
    if (!line || seen.has(line)) continue;
    seen.add(line);
    out.push(line);
  }
  return out;
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

/* Long enough to be a shot rather than a label. Both apply: "a photorealistic"
   is nineteen characters and still says nothing, and "dawn, kitchen, wide" is
   three words that do. */
const THIN_PROMPT_CHARS = 24;
const THIN_PROMPT_WORDS = 4;

const clean = (v: unknown): string => String(v ?? '').replace(/\s+/g, ' ').trim();

/* A duplicate-work check lived here too, and lasted one test run.

   The idea: two steps with the same media, the same prompt and the same inputs
   are one shot generated twice, and the canvas has no seed, so nothing tells
   them apart except the bill.

   Two shipped templates say otherwise, and both are deliberate:

     tpl_ab_models    one prompt, two models, side by side. THE POINT is that
                      the prompt does not change. Adding `model` to the
                      fingerprint saves this one.

     tpl_pool_fails   one brief through FOUR identical Ask AI nodes. Same
                      prompt, same inputs, same model, and its own description
                      explains why: they run as consecutive turns in one
                      conversation, each told to differ from the last, so a
                      single Run gives four unrelated wipeouts.

   The second cannot be saved by a better fingerprint. Running one prompt more
   than once to get more than one answer is an established pattern in this
   product, and nothing in a plan separates a deliberate second take from a
   careless copy-paste. So the check would have to guess, and a check that
   guesses spends a repair round on every build that uses the pattern.

   Reinstating it needs the model to SAY it meant one shot — a field, not an
   inference from two steps happening to match. */

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

  /* ── More references than Flow will take ── */
  /* Flow's composer refuses the sixth image outright — "Maximum image
     ingredients reached (5 allowed)". Nothing downstream catches it, so a plan
     that over-wires a shot opens the tab, attaches five, and stalls on the
     rest, having already spent the time to get there. Cheaper to say so while
     it is still a plan. */
  const MAX_IMAGE_REFS = 5;
  for (const s of steps) {
    if (s.type !== 'generate' || s.media !== 'video') continue;
    const refs = imageInputs(s).length;
    if (refs > MAX_IMAGE_REFS) {
      out.push({
        step: s.id, code: 'tooManyReferences',
        detail: `wires ${refs} reference images into one shot. Flow takes at most `
          + `${MAX_IMAGE_REFS}, and refuses the rest at the composer. Drop `
          + `${refs - MAX_IMAGE_REFS} — or build a storyboard image and feed that `
          + 'single picture instead, which carries the whole scene in one reference.',
      });
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
    /* Every clip drawing on the SAME still is a continuity strategy, not the
       absence of one — and for a piece made of separate moments it is the
       better one. A frame chain carries a drifted face forward into every shot
       after it; a shared reference cannot, because each clip is measured
       against the original rather than against its predecessor.

       The ten-beat emotional short is exactly that shape and this rule flagged
       it, which is the failure the comment above warns about: a rule that
       fires on a workflow somebody already ships. A storyboard board is the
       same idea one step stronger, so it counts too. */
    const anchorsOf = (st: PlanStep) => new Set(
      (st.inputs || []).filter((i) => {
        const d = byId.get(i);
        return d && (d.type === 'image' || d.type === 'frame' || d.media === 'image');
      }),
    );
    const perClip = clips.map(anchorsOf);
    const sharedAnchor = perClip.length > 0
      && Array.from(perClip[0]).some((id) => perClip.every((set) => set.has(id)));

    const linked = sharedAnchor
      || steps.some((s) => s.type === 'frame')
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

  /* ── A still that is generated and then abandoned ──
     The upload check above is about a picture the USER supplies. This is the
     one that costs money: a generation that runs, is paid for, and appears
     nowhere in the finished video.

     Deliberately narrow. A plan whose deliverable IS a picture is a perfectly
     good plan, and a still that ends the chain is only wrong when the plan has
     already shown it knows the pattern — there are clips, and other stills DO
     feed them. Then a loose one is an oversight rather than an intention.
     Without that second condition this fires on every poster and every
     thumbnail workflow. */
  const genStills = steps.filter((s) => isGen(s) && s.media === 'image');
  if (clips.length && genStills.some((s) => used(s.id))) {
    for (const s of genStills) {
      if (!used(s.id)) {
        out.push({
          step: s.id, code: 'orphanStill',
          detail: 'generates a still that no later step takes as an input, while the other '
            + 'stills in this plan do feed one. It costs a generation and appears nowhere. '
            + 'Either list it in the "inputs" of the shot it belongs to, or remove it.',
        });
      }
    }
  }

  /* ── A prompt that is not yet a prompt ──
     "a man" produces a picture of nobody in particular, and next to shots that
     were written properly it reads as a different video. Only checked when the
     step carries its OWN prompt: a step fed by a story director or an Ask AI
     step is supposed to be thin here, because the text arrives at run time. */
  for (const s of steps) {
    if (!isGen(s)) continue;
    const own = clean(s.prompt);
    if (!own || textInputs(s).length) continue;
    if (own.length < THIN_PROMPT_CHARS || own.split(' ').length < THIN_PROMPT_WORDS) {
      out.push({
        step: s.id, code: 'thinPrompt',
        detail: `has "${own}" as its whole prompt. That is a label, not a shot — say what is `
          + 'in frame, how it is lit and how the camera moves.',
      });
    }
  }

  /* ── Clips that cannot be cut together ──
     Every shot of one piece has to be the same shape. Mixing them is not a
     generation that fails; it is an edit that cannot be assembled without bars
     or a crop, discovered at the end, after everything is paid for. */
  if (clips.length > 1) {
    const shapes = Array.from(new Set(clips.map((s) => s.aspectRatio).filter(Boolean) as string[]));
    if (shapes.length > 1) {
      out.push({
        step: '', code: 'mixedAspect',
        detail: `the clips are in ${shapes.length} different aspect ratios (${shapes.join(', ')}). `
          + 'They are shots of one video and cannot be cut together. Put every clip in the same one.',
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
