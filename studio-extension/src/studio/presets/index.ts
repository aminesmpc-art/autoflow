/* ============================================================
   Ask AI presets — the craft, so the user only supplies the subject.

   Typing "BMW 525d" into a prompt box gets you a flat sheet, because the
   model was told what to draw and nothing about how. The car template solved
   that once, by hand: CAR_BRIEF is 150 words wrapping a single editable line.
   It works, and it only works for cars, in that one template.

   A preset is that wrapper, reusable. The user brings the subject; the preset
   brings the angles, the lighting, and the trap to avoid.

   ── Two rules this file must keep ──

   1. Presets are DATA, never code. `{{subject}}` is substituted with plain
      string replacement — no expressions, no callbacks. That is what lets
      them ride the cloud-template pipeline (MV3 permits fetching config, not
      logic), and the day a preset can carry logic that stops being true.

   2. Every brief says what NOT to do. Left to itself a model will centre the
      subject, light it evenly and call it done. The instructions that earn
      their place are the ones ruling out the obvious wrong answer.
   ============================================================ */

export interface AskPreset {
  id: string;
  name: string;
  /** One line under the dropdown, so the choice explains itself. */
  hint: string;
  /** Used when nothing is wired into the image port. */
  brief: string;
  /**
   * Used when a reference image IS wired in.
   *
   * The distinction matters more than it looks: "character sheet from a
   * description" and "character sheet from a photo" are different jobs — one
   * invents a character, the other matches one. A single brief doing both
   * ends up hedging, and hedged briefs produce hedged sheets.
   */
  withImage?: string;
}

/** Shared closing rule. An Ask AI answer is fed straight to another node as
    its prompt, so anything conversational gets rendered as if it were part
    of the shot. */
const ONLY_THE_PROMPT =
  '\n\nOutput only the prompt itself — no title, no preamble, no explanation, ' +
  'no quotes, no markdown, no numbered list unless asked for one.';

/**
 * The presets compiled into this build.
 *
 * The floor, exactly like BUILTIN_TEMPLATES: a fresh install or an
 * unreachable API still has every preset. The loader replaces this set with
 * a published one when it can, which is what lets a brief that produces weak
 * sheets be rewritten and live in minutes instead of a store review.
 */
export const BUILTIN_ASK_PRESETS: AskPreset[] = [
  {
    id: 'none',
    name: 'None — send as written',
    hint: 'Your text goes to the model unchanged.',
    brief: '{{subject}}',
  },

  {
    id: 'car_sheet',
    name: 'Car reference sheet',
    hint: 'Type a model and year. Returns a three-view sheet prompt.',
    brief:
      'Write ONE image-generation prompt for a reference sheet of this exact ' +
      'car: {{subject}}\n\n' +
      '# THE SHEET\n' +
      'One image on a plain mid-grey studio backdrop, three views: ' +
      'three-quarter front on the left, dead-side profile in the centre, ' +
      'three-quarter rear on the right. Even neutral studio lighting. The whole ' +
      'car in frame in every view, wheels straight, no cropping.\n\n' +
      '# BE SPECIFIC TO THIS MODEL\n' +
      'Name the details that make it recognisably this generation and trim: ' +
      'headlight and tail-light shape, grille design, bumper and skirt lines, ' +
      'bonnet contour, mirror style, wheel design and spoke count, badge ' +
      'placement, exhaust layout, roofline. Name the paint colour precisely. ' +
      'A prompt that would suit any car of that class is wrong — that is the ' +
      'failure to avoid.\n\n' +
      '# LOOK\n' +
      'Ultra photorealistic product photography, 8K, sharp throughout, ' +
      'accurate panel reflections. No people, no background detail, no text, ' +
      'no watermarks.\n\n' +
      'Under 150 words.' + ONLY_THE_PROMPT,
  },

  {
    id: 'character_sheet',
    name: 'Character sheet',
    hint: 'A name or a line of description. Wire in a photo to match one instead.',
    brief:
      'Write ONE image-generation prompt for a character reference sheet of: ' +
      '{{subject}}\n\n' +
      '# THE SHEET\n' +
      'One image on a plain mid-grey backdrop, three views: three-quarter ' +
      'front, side profile, three-quarter back. Full body head to toe in every ' +
      'view, neutral pose, arms clear of the body so the silhouette reads. ' +
      'Even lighting, no dramatic shadow.\n\n' +
      '# PIN THE THINGS THAT DRIFT\n' +
      'Face shape and features, hair length colour and how it falls, exact ' +
      'clothing including fastenings and footwear, body proportions, palette, ' +
      'and any prop the character always carries. These are what a later shot ' +
      'gets wrong, so name them rather than implying them.\n\n' +
      'Invent whatever the description leaves open, and commit to it — a ' +
      'sheet that hedges is a sheet nothing can be matched against.\n\n' +
      'Under 150 words.' + ONLY_THE_PROMPT,
    withImage:
      'Write ONE image-generation prompt for a character reference sheet that ' +
      'MATCHES the attached reference image. Notes on the subject: ' +
      '{{subject}}\n\n' +
      '# READ THE REFERENCE FIRST\n' +
      'Describe what is actually there — face shape, hair, build, clothing ' +
      'down to fastenings and footwear, colour palette, any distinctive prop. ' +
      'Do not improve, restyle, age or idealise the person in it. Where the ' +
      'reference is ambiguous, say what it shows rather than inventing.\n\n' +
      '# THE SHEET\n' +
      'One image on a plain mid-grey backdrop, three views: three-quarter ' +
      'front, side profile, three-quarter back. Full body, neutral pose, even ' +
      'lighting. Same person in every view.\n\n' +
      'Under 150 words.' + ONLY_THE_PROMPT,
  },

  {
    id: 'continue_shot',
    name: 'Continue this shot',
    hint: 'Wire a Last Frame in. Writes the clip that follows it.',
    brief:
      'Write ONE prompt for the video clip that follows this moment: ' +
      '{{subject}}\n\n' +
      'Continue the action rather than restarting it — the next clip opens ' +
      'exactly where this one ended, so do not re-establish the scene, ' +
      're-introduce the subject or cut away.\n\n' +
      'Keep the same location, lighting, camera height and subject. Describe ' +
      'what changes over the next few seconds and nothing else.\n\n' +
      'Under 120 words.' + ONLY_THE_PROMPT,
    withImage:
      'The attached image is the LAST FRAME of the previous clip. Write ONE ' +
      'prompt for the clip that continues from it.\n' +
      '{{subject}}\n\n' +
      '# CONTINUE, DO NOT RESTART\n' +
      'Open on exactly what the frame shows. Same location, same lighting, ' +
      'same camera height, same subject in the same position. No cut, no ' +
      're-establishing shot, no reset to a wide.\n\n' +
      'Describe the reference back accurately first — the model needs to know ' +
      'what it is continuing — then say what changes over the next few ' +
      'seconds.\n\n' +
      'Under 120 words.' + ONLY_THE_PROMPT,
  },

  {
    id: 'scene_beats',
    name: 'Scene beats',
    hint: 'A logline. Returns numbered shots with an emotional arc.',
    brief:
      'Break this into a numbered sequence of shots: {{subject}}\n\n' +
      '# THE ARC\n' +
      'Open on tension or a question, escalate, turn on something unexpected, ' +
      'resolve. Frame the final shot to echo the first so the video can loop.\n\n' +
      '# EACH SHOT\n' +
      'One line naming what happens, the framing, and the colour temperature. ' +
      'Carry the colour from cool and desaturated through the tense half to ' +
      'warm at the turn — that progression is doing real work and is the part ' +
      'most sequences skip.\n\n' +
      'Every shot must hold the same character and location unless the story ' +
      'moves. Number them. No dialogue.\n\n' +
      'Give 6 shots unless the subject asks for a different count.' +
      '\n\nOutput only the numbered list — no title, no preamble, no ' +
      'explanation, no markdown.',
  },

  {
    id: 'match_style',
    name: 'Match this style',
    hint: 'Wire an image in. Describes its look so other shots can reuse it.',
    brief:
      'Describe the visual style of: {{subject}}\n\n' +
      'Write it as a style block that can be appended to any prompt — lens and ' +
      'framing habits, lighting direction and quality, colour palette and ' +
      'grade, texture and grain, level of realism.\n\n' +
      'Describe only the look. No subject, no action, no story — anything ' +
      'specific to one shot makes the block unusable in the next.' +
      ONLY_THE_PROMPT,
    withImage:
      'Describe the visual style of the attached image so it can be reused on ' +
      'other subjects.\n' +
      '{{subject}}\n\n' +
      'Lens and framing, lighting direction and quality, colour palette and ' +
      'grade, texture and grain, level of realism.\n\n' +
      'Describe only the look. Not what is in the picture — a style block that ' +
      'names the subject cannot be applied to anything else, which is the ' +
      'whole point of extracting it.' + ONLY_THE_PROMPT,
  },

  {
    id: 'product_ugc',
    name: 'Product brief',
    hint: 'Name a product. Returns a UGC-style scene prompt.',
    brief:
      'Write ONE prompt for a handheld UGC-style video of this product: ' +
      '{{subject}}\n\n' +
      '# MUST READ AS A REAL PHONE VIDEO\n' +
      'Shot by one person on a modern phone. Slight micro-shake, imperfect ' +
      'framing, natural available light, one continuous take. Never a tripod, ' +
      'gimbal, drone or cinematic move.\n\n' +
      'The product stays exactly as it is — same shape, colour and label. Held ' +
      'so the label faces camera at least once.\n\n' +
      'Nothing glossy. Not an advert, not influencer content. Natural sound ' +
      'only, no music.\n\n' +
      'Under 120 words.' + ONLY_THE_PROMPT,
  },
];

/* What the app is actually using. Starts as the bundled set and is replaced
   by the loader after a fetch — a module-level list rather than a parameter
   on every call site, because the node dropdown, the runner and the tests all
   need the same answer and threading it through each of them invites drift. */
let activePresets: AskPreset[] = BUILTIN_ASK_PRESETS;

export const getAskPresets = (): AskPreset[] => activePresets;

export function setAskPresets(presets: AskPreset[] | null | undefined): void {
  // Never leave the app with nothing to choose from: an empty published list
  // would silently remove the feature rather than update it.
  activePresets = presets && presets.length ? presets : BUILTIN_ASK_PRESETS;
}

/** @deprecated Use getAskPresets() — this is the bundled floor, not the live set. */
export const ASK_PRESETS = BUILTIN_ASK_PRESETS;

export const DEFAULT_PRESET_ID = 'none';

export const findPreset = (id?: string): AskPreset =>
  activePresets.find((p) => p.id === id) || activePresets[0];

/**
 * Problems with a published preset, in plain language. Empty means valid.
 *
 * The one rule that is not stylistic: every field must be a string. MV3
 * permits fetching configuration and forbids fetching code, so the day a
 * preset can carry a function this stops being a config fetch. Everything
 * else here is about not shipping a preset that produces nothing.
 */
export function validatePreset(p: any): string[] {
  const problems: string[] = [];
  if (!p || typeof p !== 'object') return ['not an object'];
  for (const field of ['id', 'name', 'hint', 'brief'] as const) {
    if (!p[field] || typeof p[field] !== 'string') problems.push(`missing or non-string ${field}`);
  }
  if (p.withImage !== undefined && typeof p.withImage !== 'string') {
    problems.push('withImage is not a string');
  }
  for (const [key, value] of Object.entries(p)) {
    if (typeof value !== 'string') problems.push(`field "${key}" is ${typeof value}, not a string`);
  }
  // A brief with no placeholder ignores whatever the user typed.
  if (typeof p.brief === 'string' && p.id !== 'none' && !p.brief.includes('{{subject}}')) {
    problems.push('brief never uses {{subject}}, so whatever the user types is discarded');
  }
  return problems;
}

/**
 * The text actually sent to the chat.
 *
 * `hasImage` picks the variant, which is why the runner calls this after it
 * has gathered references rather than before: a character sheet built from a
 * photo and one built from a sentence are different briefs, and the node
 * cannot know which it is until the edges are resolved.
 */
export function composeAskPrompt(
  presetId: string | undefined,
  subject: string,
  hasImage: boolean
): string {
  const preset = findPreset(presetId);
  const template = (hasImage && preset.withImage) || preset.brief;
  const trimmed = (subject || '').trim();

  /* An empty subject is normal for the image-led presets — "continue this
     shot" needs nothing but the frame. Substituting an empty string would
     leave a dangling "Notes on the subject:" with nothing after it. */
  /* Every template keeps {{subject}} on a line of its own, so dropping that
     line when nothing was typed cannot take an instruction with it — which is
     what happened to "The attached image is the LAST FRAME…" while the
     placeholder was appended to the end of that sentence. */
  const filled = trimmed
    ? template.replace(/\{\{subject\}\}/g, trimmed)
    : template.replace(/^[^\n]*\{\{subject\}\}[^\n]*\n?/gm, '');

  return filled.trim();
}
