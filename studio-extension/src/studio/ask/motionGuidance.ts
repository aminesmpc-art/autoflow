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

export const MOTION_PRESETS = [
  { id: 'custom', title: 'Custom direction', instruction: '' },
  { id: 'dance', title: 'Dance / choreography', instruction: 'Transfer the source choreography with its original rhythm and timing. Do not invent additional steps or change the camera.' },
  { id: 'walk', title: 'Walk / body movement', instruction: 'Preserve the source gait, travel direction, body contacts and timing. Keep feet grounded and avoid sliding.' },
  { id: 'performance', title: 'Character performance', instruction: 'Preserve the source performance and gesture timing while keeping the referenced character identity consistent.' },
  { id: 'material', title: 'Material / artistic restyle', instruction: 'Re-express the source movement in the requested material while preserving its timing and overall silhouette.' },
] as const;

export function presetInstruction(id: unknown): string {
  return MOTION_PRESETS.find((p) => p.id === id)?.instruction || '';
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
    ? `The final ${placeCount} reference image(s) define the PLACE only. Use that environment, not people or objects as replacement characters. Integrate the subject with the place lighting, scale, perspective and contact shadows. The video still controls motion, timing and camera; do not copy a conflicting camera angle from the place image.`
    : 'No place image is attached. Keep the environment from the input video.'}`;
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
