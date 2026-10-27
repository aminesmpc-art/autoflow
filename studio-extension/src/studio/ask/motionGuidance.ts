/**
 * The wording around the references, and the checks on what comes back.
 *
 * ── Why the character is pointed at and never described ───────────────────
 *
 * This file used to tell the director that the character image defines
 * "identity, face, body and clothing". Read as an instruction to a model that
 * is about to write a prompt, that is an invitation to enumerate all four — and
 * it did:
 *
 *   "Apply the pose and motion from input video to provided character from this
 *    image. The woman from the provided image, with short dark hair and clear
 *    glasses, wearing a black sleeveless top and black shorts with a white
 *    waistband, performing a dance. …"
 *
 * Every generation from that prompt came back "This generation might violate
 * our policies", uncharged — which is the INPUT filter, not the output. A face
 * photo attached, plus text describing an identifiable person down to the
 * waistband of her shorts, plus a dance clip, is the exact shape that filter
 * exists to stop.
 *
 * Google's own wording for the same job is thirteen words and describes nobody:
 * "Apply the pose and motion from input video to provided character from this
 * image." The image is handed to the model with every generation, so the model
 * can already see the character. The description was never carrying information
 * — only risk.
 *
 * So the role separation stays (which image is the character, which is the
 * place) and the enumeration goes, replaced by a prohibition. This is the same
 * argument motionControl.ts already makes twice: do not narrate the movement,
 * because the clip carries it, and do not invent lighting values, because the
 * clip carries those too. The reference carries the person.
 */

import { motionAudioPrompt, SETTING_POINTER } from './motionControl';
import { replacementRoles, type MotionReplacement } from './motionTargets';
import { continuityPrompt } from './motionContinuity';

export const MOTION_PRESETS = [
  { id: 'custom', title: 'Custom direction', instruction: '' },
  { id: 'dance', title: 'Dance / choreography', instruction: 'Transfer the source choreography with its original rhythm and timing. Do not invent additional steps or change the camera.' },
  { id: 'fitness', title: 'Fitness / workout', instruction: 'This is a workout: keep every repetition, the full range of motion and the tempo exactly as in the footage, and do not name or count the exercises.' },
  { id: 'walk', title: 'Walk / body movement', instruction: 'Preserve the source gait, travel direction, body contacts and timing. Keep feet grounded and avoid sliding.' },
  { id: 'performance', title: 'Character performance', instruction: 'Preserve the source performance and gesture timing while keeping the referenced character identity consistent.' },
  { id: 'material', title: 'Material / artistic restyle', instruction: 'Re-express the source movement in the requested material while preserving its timing and overall silhouette.' },
] as const;

export function presetInstruction(id: unknown): string {
  return MOTION_PRESETS.find((p) => p.id === id)?.instruction || '';
}

/**
 * What a preset tells the VIDEO model, whatever the director writes.
 *
 * A preset's `instruction` reaches only the director, as part of what the user
 * asked for, and a director may or may not carry it into the prompt. A workout
 * drifts in ways the general motion block does not name — fewer repetitions, a
 * shorter range, hands and feet sliding on the floor — so these rules go into
 * the text Omni receives. Like the motion block, they name no exercise.
 */
const PRESET_FOR_OMNI: Record<string, string> = {
  fitness: 'WORKOUT: This is an exercise set. Keep every repetition exactly as the input video has it — '
    + 'the same number of repetitions, the same full range of motion and the same tempo, including any '
    + 'pause at the top or the bottom of a repetition. Hands and feet touch the floor, the mat or the '
    + 'equipment exactly where and when they do in the input video, without sliding.',
};

export function presetForOmni(id: unknown): string {
  return PRESET_FOR_OMNI[String(id)] || '';
}

/** How the subject must be named when a character image is attached. */
export const SUBJECT_POINTER = 'the provided character from this image';

export function referenceGuidance(characterCount: number, placeCount: number): string {
  const subject = characterCount
    ? `The first ${characterCount} reference image(s) ARE the character: identity, face, `
      + 'body and clothing all come from there, not from the video and not from any other '
      + 'image. Do not copy their background. Those images are attached to every '
      + 'generation, so the video model can already see the character — the prompt must '
      + 'NOT describe their appearance. No hair, face, skin, build, age or clothing. '
      + `Name the subject only as "${SUBJECT_POINTER}".`
    : 'Keep the subject from the input video; no replacement character image is attached. '
      + 'The footage already shows them, so do not describe their appearance either.';
  return `${subject} ${placeCount
    ? `The final ${placeCount} reference image(s) define the PLACE only. Use that environment, not people or objects as replacement characters. Integrate the subject with the place lighting, scale, perspective and contact shadows. Do not describe the place either: name it only as "${SETTING_POINTER}", in the same words in every piece, so every piece is the same place. The video still controls motion, timing and camera; do not copy a conflicting camera angle from the place image.`
    : 'No place image is attached. Keep the environment from the input video.'}`;
}

/* ── What the VIDEO MODEL is told ────────────────────────────────────────────
 *
 * referenceGuidance above is written for the DIRECTOR — it says what a prompt
 * may and may not contain. It used to be appended to every generation as
 * well, so Omni itself was told "the prompt must NOT describe their
 * appearance. No hair, face, skin, build, age or clothing": instructions about
 * writing a prompt, sent to a model that makes video — ninety words of them,
 * a list of body attributes included, which is the very wording the policy
 * filter refuses. And nothing in the final prompt asked Omni to follow the
 * motion exactly. Google's opening sentence was the whole of it, and the
 * output drifted: speeding up, slowing down, skipping a move, adding one,
 * the body flickering from frame to frame.
 *
 * So the video model gets its own blocks, written for it: what to do with the
 * motion, and what each image is for. */

/**
 * The exact-follow block every generation carries, per mode.
 *
 * Commands fidelity without narrating the movement — the rule from
 * motionControl.ts still holds: the footage carries the motion, and a
 * paraphrase of it competes with it. This names no movement at all. It only
 * forbids changing any of them.
 *
 * Mouths follow the source unless the audio was removed: the audio override
 * forbids speech and lip-sync then, and the two must not contradict.
 *
 * Likewise the place: with a setting image attached, swap's "everything else
 * in the shot exactly as in the input video" would keep the very place the
 * image replaces.
 */
export function motionFidelity(mode: string, muted: boolean, hasPlace = false): string {
  /* "Do not … repeat … any movement" was here, to stop the model inventing an
     extra step. A workout IS repetition — ten squats are one movement ten
     times — so on a fitness clip it argued with the video, and the output
     came back with fewer reps. The count is what is protected now; looping
     the clip is still forbidden. */
  const exact = 'every movement in the same order, at the same speed and timing, with the same pauses '
    + 'and holds, and exactly as many repetitions as the input video — no more, no fewer. Do not add, '
    + 'skip, smooth out, exaggerate, speed up or slow down any movement, and do not loop the clip.';
  const stable = 'Keep the character consistent in every frame, with no morphing, flicker or drift.';
  if (mode === 'restyle') {
    return 'MOTION: Keep the input video\'s movement exactly — the same timing, rhythm and silhouette, '
      + `${exact} Only the material and the look change${hasPlace ? ', in the setting image' : ''}. `
      + 'Keep the camera as in the input video. '
      + 'Keep the result consistent from frame to frame, with no flicker.';
  }
  if (mode === 'swap') {
    return `MOTION: Keep the input video's motion${muted ? '' : ' and dialogue'} exactly, frame for frame — `
      + `${exact}${muted ? '' : ' Lip movements match the input video\'s speech exactly.'} `
      + (hasPlace
        ? 'Keep the camera exactly as in the input video; only the character and the setting change. '
        : 'Keep the camera and everything else in the shot exactly as in the input video; only the '
          + 'character changes. ')
      + stable;
  }
  return 'MOTION: Follow the input video\'s motion exactly, frame for frame — '
    + `${exact}${muted ? '' : ' Mouth movements follow the input video too.'} `
    + `Keep the camera exactly as in the input video. ${stable}`;
}

/**
 * What each attached image is FOR, told to the video model.
 *
 * The model-facing counterpart of referenceGuidance: the same roles, none of
 * the prompt-writing instructions, and no list of body attributes.
 */
export function referenceRoles(characterCount: number, placeCount: number, continuity = false): string {
  /* "first" only when there is a place image after it to be first of. */
  const lead = placeCount || continuity ? 'first' : 'provided';
  const who = !characterCount
    ? 'Keep the subject from the input video.'
    : characterCount > 1
      ? `The ${lead} images show the character who performs the motion.`
      : `The ${lead} image is the character who performs the motion.`;
  const where = placeCount
      ? `The ${continuity ? `image ${characterCount + 1}` : `${characterCount ? 'last' : 'provided'} image`} is the setting: place the `
      + `${characterCount ? 'character' : 'subject'} in it, matching its light, scale, perspective `
      + 'and contact shadows. The input video still decides the motion, the timing and the camera.'
    : 'Keep the environment from the input video.';
  return `REFERENCES: ${who} ${where}`;
}

/**
 * The setting, held the same on every piece.
 *
 * Each piece is generated on its own, and nothing ties piece two's place to
 * piece one's except the image they share. They drifted apart two ways: the
 * director put the place into its own words each time, and the prompt asked for
 * the input video's lighting in the same breath as the setting image's. The
 * director is now told to do neither. This block is the half that does not
 * depend on the director listening — the same words on every piece, ending with
 * which instruction wins if anything above still says otherwise.
 *
 * A change the user asked for to the place ("at night") is the one exception,
 * and the director writes it in the same words on every piece, so it is the
 * same change everywhere.
 *
 * "Where the camera shows more than the image does" is for a source that pans:
 * the model has to invent the rest of the place then, and should invent it in
 * the image's style and light rather than its own.
 */
export function settingLock(): string {
  return 'SETTING: The setting image is the place for this whole clip. Keep it as the image shows it, '
    + 'in every frame: the same layout, objects, colours, light and time of day. Change it only where '
    + 'the prompt above asks for a change to the place itself, and then the same way in every frame; '
    + 'add nothing else, remove nothing and restyle nothing. Where the camera shows more than the image '
    + 'does, continue the place in the same style and light. Where anything above says to keep the '
    + 'input video\'s lighting, background or environment, the setting image wins.';
}

/**
 * "Keep exact lip sync": the mouths, told to the video model on their own.
 *
 * motionFidelity already mentions mouths in one clause, and only in two modes.
 * This is the user asking for it by name, so it gets a block of its own in
 * every mode, the same words on every piece. With the audio removed there is
 * no speech for the model to hear, only mouths to see, so it is told to copy
 * those, which is what lets the original sound be laid back over the clip.
 */
export function lipSyncLock(muted: boolean): string {
  return muted
    ? 'LIP SYNC: Copy every mouth movement from the input video exactly, frame for frame: the same '
      + 'shapes at the same moments, opening and closing exactly when the mouths there do, and closed '
      + 'whenever they are closed, so the original speech still matches the clip when it is laid back '
      + 'over it. Do not add, drop, delay, soften or exaggerate any mouth movement. Keep each mouth '
      + 'visible and the face turned as in the input video.'
    : 'LIP SYNC: Keep the lip sync exactly as in the input video. Every mouth shape, opening and '
      + 'closing happens on the same frame as in the input video, in time with every syllable of the '
      + 'speech, and the mouth is closed whenever the speaker is silent. Keep the speech exactly as in '
      + 'the input video: the same words at the same moments. Do not add, drop, delay, soften or '
      + 'exaggerate any mouth movement. Keep each mouth visible and the face turned as in the input video.';
}

/**
 * The prompt a Motion piece is generated from — exactly what Omni receives.
 *
 * The director's words first (they open with Google's own instruction for the
 * mode), then the exact-follow block, then — with "Keep exact lip sync" on —
 * the block for the mouths, then — for a preset that has one, like
 * Fitness — that preset's own rules, then the image roles, then — with a
 * setting image — the block that holds the place still, and — when the audio
 * was removed — the override that has the last word on sound.
 */
export function motionFinalPrompt(opts: {
  prompt: string; mode: string; muted: boolean; characters: number; places: number;
  continuity?: boolean;
  /** The panel's focus preset; only some add a block of their own. */
  preset?: string;
  /** Chosen people/items and their images (motionTargets.ts); they ARE the first images. */
  replacements?: MotionReplacement[];
  /** "Keep exact lip sync". */
  lipSync?: boolean;
}): string {
  const hasPlace = opts.places > 0;
  const presetBlock = presetForOmni(opts.preset);
  return motionAudioPrompt(
    [
      opts.prompt.trim(),
      motionFidelity(opts.mode, opts.muted, hasPlace),
      ...(opts.lipSync ? [lipSyncLock(opts.muted)] : []),
      ...(presetBlock ? [presetBlock] : []),
      opts.replacements?.length
        ? replacementRoles(opts.replacements, opts.places)
        : referenceRoles(opts.characters, opts.places, opts.continuity),
      ...(hasPlace ? [settingLock()] : []),
      ...(opts.continuity ? [continuityPrompt(opts.characters + opts.places + 1)] : []),
    ].join('\n'),
    opts.muted,
    opts.lipSync === true,
  );
}

/* ── The two families of wording that get a prompt refused ────────────────
 *
 * Deliberately narrow. These fire in the prompt editor, next to a box the user
 * is reading, and a warning that cries wolf on "match the lighting, grade and
 * framing of the input video" would be scrolled past along with the real ones.
 *
 * `top` and `short` are absent on purpose — "the top of the frame" and "a short
 * clip" are both ordinary direction. The compound forms that are only ever
 * clothing are listed instead. */
const GARMENT = /\b(sleeveless|crop[- ]top|tank[- ]top|waistband|midriff|cleavage|bikini|swimsuit|swimwear|leotard|lingerie|underwear|bra|panties|shorts|skirt|dress|blouse|shirt|jeans|trousers|leggings|stockings|hoodie)\b/i;
const APPEARANCE = /\b(hair|face|facial|eyes|skin|complexion|glasses|beard|moustache|freckles|tattoo|slim|slender|petite|curvy|busty|muscular|toned|figure|physique|\d+[- ]year[- ]old|years old|teenage|teenager)\b/i;

/**
 * The appearance and garment words a prompt actually used.
 *
 * Returned as TERMS rather than as a yes/no, because both callers need to say
 * which words they mean: the editor hint, so the user can find them in a
 * paragraph, and the one corrective turn to the director, which quotes them
 * back. Telling a model "your prompt describes the subject" gets a shrug;
 * telling it "you wrote sleeveless, shorts, waistband" gets a rewrite.
 */
export function subjectDescriptionTerms(prompt: string): string[] {
  const found = new Set<string>();
  for (const pattern of [GARMENT, APPEARANCE]) {
    const hits = String(prompt || '').match(new RegExp(pattern.source, 'gi'));
    if (hits) for (const hit of hits) found.add(hit.toLowerCase());
  }
  return [...found];
}

/**
 * The one warning that is not advice.
 *
 * Kept OUT of motionPromptWarnings, which returns things worth reading. This
 * one is worth stopping for: a prompt that describes the person is not a prompt
 * that might disappoint, it is a prompt that comes back refused without
 * generating anything. The node gives it its own box for that reason — put in
 * the same muted hint list as "check that this is intentional", it reads as the
 * same weight of remark and gets skimmed past.
 *
 * Empty string when there is nothing to say, so the caller can render it or not
 * with one check.
 *
 * restyle is exempt throughout: its subject is a material, a material has to be
 * described before it can be generated, and no filter is hunting for "fluid
 * reflective surface".
 */
export function subjectDescriptionWarning(prompt: string, mode: string): string {
  if (mode === 'restyle') return '';
  const garment = GARMENT.test(prompt);
  const appearance = APPEARANCE.test(prompt);
  if (!garment && !appearance) return '';
  const what = garment && appearance ? 'appearance and clothing' : garment ? 'clothing' : 'appearance';
  return `This prompt describes the subject's ${what}, and the reference image already `
    + 'carries it. Describing an identifiable person next to a photo of them is the most '
    + 'common cause of "This generation might violate our policies" — the generation is '
    + `refused before anything is made. Cut the description back to "${SUBJECT_POINTER}".`;
}

export function motionPromptWarnings(prompt: string, mode: string, muted: boolean): string[] {
  const warnings: string[] = [];
  if (mode !== 'restyle' && /\b(slow motion|speed up|new camera|camera orbit|zoom in)\b/i.test(prompt)) {
    warnings.push('This prompt may change source timing or camera movement. Check that this is intentional.');
  }
  if (muted && /\b(dialogue|lip.?sync|speak|singing)\b/i.test(prompt)) {
    warnings.push('Audio is removed. The silent-output instruction will override speech directions.');
  }
  return warnings;
}
