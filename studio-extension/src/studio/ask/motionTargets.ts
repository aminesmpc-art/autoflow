/* ── Replacing chosen people and items ──────────────────────────────────────
 *
 * "Same videos, we want to change 2 characters, or 1 character and the item."
 *
 * Replace subject used to take one image, and nothing said WHICH person in the
 * footage it was for. Now the analysis engine lists the people and items it
 * sees (motionTargetsAsk), the user gives the ones to change a new image (up
 * to four), words, or both, and the generation tells Omni exactly what
 * replaces which target. Everything not picked stays as it is in the footage.
 *
 * The mapping is written HERE, in fixed words, not by the director: image
 * order is decided by code (replacements first, in the user's order, then the
 * place, then a continuity frame), so only code can number them correctly.
 */
import { readJsonObject } from './storyboard';
import { SETTING_POINTER } from './motionControl';

export type MotionTargetKind = 'person' | 'item';

/** Something the analysis engine saw in the footage. */
export interface MotionTarget {
  id: string;
  kind: MotionTargetKind;
  /** Short, unique within the video: position plus what tells it apart. */
  label: string;
  /** When it is on screen, as the engine wrote it ("whole video", "0:03-0:09"). */
  when?: string;
}

/**
 * A target the user chose to replace: with a new image, with words, or both.
 *
 * "SAMTAMIS WE WAN TO ADD PROMPT NOT IMAGE": words alone ("an old wizard
 * with a long beard") take no image slot, so they are not held to the image
 * limit. With an image, the words say what to change about it ("wearing a
 * red dress").
 */
export interface MotionReplacement {
  targetId: string;
  kind: MotionTargetKind;
  label: string;
  /** data: URL of the new person or item, when one was given. */
  image?: string;
  /** What it becomes, in the user's words; beside an image, what to change about it. */
  text?: string;
  name?: string;
}

/** Omni 1.1 Flash takes five images beside the video. */
export const OMNI_IMAGE_SLOTS = 5;
export const MAX_REPLACEMENTS = 4;
export const MAX_DESCRIPTION = 300;
const MAX_TARGETS = 8;

/** How many replacement IMAGES fit, after the place image and a continuity frame take theirs. */
export function replacementLimit(hasPlace: boolean, continuity: boolean): number {
  return Math.max(0, Math.min(MAX_REPLACEMENTS, OMNI_IMAGE_SLOTS - (hasPlace ? 1 : 0) - (continuity ? 1 : 0)));
}

/** Only the ones that say what to replace with — an image, words, or both — tidied. */
export function usableReplacements(reps: unknown): MotionReplacement[] {
  if (!Array.isArray(reps)) return [];
  const out: MotionReplacement[] = [];
  for (const r of reps as MotionReplacement[]) {
    if (!r || typeof r.label !== 'string' || !r.label) continue;
    const image = typeof r.image === 'string' && r.image.startsWith('data:image/') ? r.image : undefined;
    const text = typeof r.text === 'string' ? r.text.replace(/\s+/g, ' ').trim().slice(0, MAX_DESCRIPTION) : '';
    if (!image && !text) continue;
    const { image: _image, text: _text, ...rest } = r;
    out.push({ ...rest, ...(image ? { image } : {}), ...(text ? { text } : {}) });
  }
  return out;
}

/** Image numbers in the order the images go to Flow: replacements with an image, in the user's order. */
function numbered(reps: MotionReplacement[]): Array<{ r: MotionReplacement; n: number }> {
  let n = 0;
  return reps.map(r => ({ r, n: r.image ? ++n : 0 }));
}

/** The one question the scan asks. The video is attached. */
export function motionTargetsAsk(): string {
  return [
    'Watch the attached video. List the people, and the distinct objects a person holds, uses or interacts with, that someone might want to replace with something else.',
    'Do not list the background, the room, furniture, walls, or anything that is only scenery.',
    `List at most ${MAX_TARGETS}: people first, then objects.`,
    'For each one write a short label that tells it apart from everything else in THIS video, using its position in the frame and what it wears or what it is, for example "woman on the left, black top", "man on the right, grey hoodie", "plate of bread on the table". Do not guess names, ages or identities.',
    'Say when it is on screen: "whole video", or the range such as "0:03-0:09".',
    'Reply with JSON only, in this shape:',
    '{"targets":[{"kind":"person","label":"woman on the left, black top","when":"whole video"},{"kind":"item","label":"plate of bread","when":"0:00-0:06"}]}',
    'Use curly quotes inside labels if you need quotation marks.',
  ].join('\n');
}

/** The engine's list, validated: kinds normalised, labels unique, at most eight. */
export function readMotionTargets(reply: string): MotionTarget[] {
  const parsed = readJsonObject(String(reply || ''));
  const raw = parsed && Array.isArray((parsed as any).targets) ? (parsed as any).targets as unknown[] : [];
  const seen = new Set<string>();
  const out: MotionTarget[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    const label = String(e.label || '').replace(/\s+/g, ' ').trim().slice(0, 80);
    if (!label || seen.has(label.toLowerCase())) continue;
    seen.add(label.toLowerCase());
    const kind: MotionTargetKind = /item|object|thing|prop/i.test(String(e.kind || '')) ? 'item' : 'person';
    const when = String(e.when || '').replace(/\s+/g, ' ').trim().slice(0, 40) || undefined;
    out.push({ id: `t${out.length + 1}`, kind, label, ...(when ? { when } : {}) });
    if (out.length >= MAX_TARGETS) break;
  }
  if (!out.length) throw new Error('The analysis engine did not list anyone or anything to replace. Try the scan again, or use a clearer piece of the video.');
  /* People first, as asked, whatever order came back. */
  return [...out.filter(t => t.kind === 'person'), ...out.filter(t => t.kind === 'item')]
    .map((t, i) => ({ ...t, id: `t${i + 1}` }));
}

const pointer = (r: MotionReplacement, n: number) =>
  r.kind === 'item' ? `the object from image ${n}` : `the person from image ${n}`;

/** For the DIRECTOR: what each replacement is, and what the prompt may say about it. */
export function replacementGuidance(reps: MotionReplacement[], placeCount: number): string {
  const list = numbered(reps);
  const mapping = list.map(({ r, n }) => {
    const what = r.kind === 'item' ? 'an object' : 'a person';
    if (!n) {
      return `${r.label} (${what}) is replaced by: "${r.text}". There is no image for it: describe it in exactly these words, the same way in every piece.`;
    }
    return `Image ${n} replaces ${r.label} (${what}): name it only as "${pointer(r, n)}"`
      + (r.text ? `, and add, in exactly these words, what changes about it: "${r.text}".` : '.');
  }).join(' ');
  const images = list.filter(({ n }) => n).length;
  return [
    `REPLACEMENTS: ${mapping}`,
    'Each replacement keeps the target\'s place in the frame, its movement, its timing and its interaction with everything around it; only who or what it is changes.',
    images
      ? 'The images are attached to every generation, so the video model can see them: beyond the words given for one, do NOT describe the appearance of a replacement that has an image (no face, hair, skin, build, age, clothing, colour or material).'
      : '',
    'Every other person and object stays exactly as in the video: do not replace, restyle or describe them as changed.',
    'If a target is not visible in a piece, do not mention it in that piece\'s prompt.',
    placeCount
      ? `The final reference image defines the PLACE only; name it only as "${SETTING_POINTER}", the same words in every piece.`
      : 'No place image is attached. Keep the environment from the input video.',
  ].filter(Boolean).join(' ');
}

/** For OMNI: the fixed instruction for what replaces what, replacing referenceRoles. */
export function replacementRoles(reps: MotionReplacement[], placeCount: number): string {
  const list = numbered(reps);
  const images = list.filter(({ n }) => n).length;
  const lines = list.map(({ r, n }) => n
    ? `Image ${n} replaces ${r.label}${r.text ? `: ${r.text}` : ''}.`
    : `Replace ${r.label} with ${r.text}.`);
  const place = placeCount
    ? ` Image ${images + 1} is the setting: place everyone in it, matching its light, scale, perspective and contact shadows.`
    : ' Keep the environment from the input video.';
  return `${images || placeCount ? 'REFERENCES' : 'REPLACEMENTS'}: ${lines.join(' ')} Each replacement takes the target's position, movement, timing and contact with everything around it. `
    + 'Keep every other person and object exactly as in the input video.'
    + place
    + ' The input video still decides the motion, the timing and the camera.';
}
