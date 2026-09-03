/* ============================================================
   When the idea is a document.

   The build box was designed for a sentence. What people paste into it is a
   published "master prompt" for a niche — miniature construction, kung-fu cat,
   baby dragon, exterior construction ASMR — several hundred to a few thousand
   words, written to be dropped into a chat as a system prompt. It opens "Act
   as an Elite AI Video Production Strategist". It says "you do NOT behave like
   a conversational assistant", "never break character", "wait silently until
   the user types start".

   Pasted into the builder, that used to arrive raw and unlabelled in the last
   position of the brief, and a model would do the reasonable thing: adopt the
   most recent role it was handed and offer fifteen numbered buildings. The
   fence in spec.ts settles which of the two kinds of text it is. This file
   answers the other question — whether the paste is long enough to be worth
   reading on its own turn before anything is planned.

   The split is the same one the Story node makes between choosing its settings
   and writing its shots, for the same reason. One turn asked to dig a shot list
   out of a publishing process AND resist being recruited by it is one turn
   doing two hard things, on the weakest model this has to run on. Two turns
   each do one, and the extraction arrives small enough to be wrong visibly.
   ============================================================ */

import { extractJson } from './plan';

/**
 * Long enough, or shaped enough, to be a document rather than a sentence.
 *
 * The word count carries most of it. Nobody types two hundred words as a
 * casual idea, and anybody who does has written something worth reading
 * carefully anyway, so a false positive costs one turn and loses nothing.
 *
 * The markers catch the short-but-unmistakable case: a hundred-word paste that
 * opens "Act as..." is a system prompt whatever its length, and it is exactly
 * the kind that hijacks a single-turn build.
 */
const BRIEF_MARKERS = [
  /\bact as\b/i,
  /\byou are (?:an?|the)\b/i,
  /\byou do not behave\b/i,
  /\bnever break character\b/i,
  /\bwait (?:silently )?until\b/i,
  /\bsystem prompt\b/i,
  /^\s*(?:step|phase|state|prompt|scene)\s*\d/im,
  /\bdo not (?:ask|explain|summari[sz]e)\b/i,
];

/** Roughly a paragraph of casual description, past which a read turn pays. */
const LONG_ENOUGH = 220;
/** Below this nothing is a document, however it is phrased. */
const SHORT_ENOUGH_TO_TRUST = 60;

export function wordCount(text: string): number {
  return String(text || '').trim().split(/\s+/).filter(Boolean).length;
}

export function looksLikeBrief(idea: string): boolean {
  const text = String(idea || '');
  const words = wordCount(text);
  if (words >= LONG_ENOUGH) return true;
  if (words < SHORT_ENOUGH_TO_TRUST) return false;
  return BRIEF_MARKERS.some((re) => re.test(text));
}

/** One field of the reading, as a line, when the model actually filled it in. */
function line(label: string, value: unknown): string[] {
  const text = typeof value === 'string' ? value.trim() : '';
  return text ? [`${label}: ${text}`] : [];
}

/**
 * The reading, turned into something the planning turn can use.
 *
 * Deliberately lossy and deliberately forgiving. Every field is optional,
 * anything unrecognised is dropped, and a reply that cannot be parsed at all
 * returns '' — at which point the caller plans from the raw material exactly
 * as it did before. A first pass that fails should cost a turn, never a build.
 *
 * `notShots` is carried across even though nothing will be built from it. It
 * is the half of these documents that is a publishing process rather than a
 * video — thumbnails, hashtags, SEO, selection menus, which website to
 * generate on — and naming it is what stops the planner turning a thumbnail
 * spec into a node.
 */
export function readBriefReply(text: string): string {
  const obj = extractJson(text);
  if (!obj || typeof obj !== 'object') return '';

  const out: string[] = [];
  out.push(...line('Kind', obj.kind));

  const shots = Array.isArray(obj.shots)
    ? obj.shots.filter((x: unknown): x is string => typeof x === 'string' && !!x.trim())
    : [];
  const count = typeof obj.count === 'number' && obj.count > 0
    ? Math.round(obj.count)
    : shots.length;
  if (count) {
    out.push(`Shots: ${count}${shots.length && shots.length !== count
      ? ` (the reading listed ${shots.length}; the brief's own number wins)` : ''}`);
  }
  for (let i = 0; i < shots.length; i++) out.push(`  ${i + 1}. ${shots[i].trim()}`);

  out.push(...line('Aspect ratio', obj.aspectRatio));
  out.push(...line('Cast', obj.cast));
  out.push(...line('World', obj.world));
  out.push(...line('Look', obj.look));
  out.push(...line('Camera', obj.camera));
  out.push(...line('Audio', obj.audio));
  out.push(...line('Continuity', obj.continuity));

  const notShots = Array.isArray(obj.notShots)
    ? obj.notShots.filter((x: unknown): x is string => typeof x === 'string' && !!x.trim())
    : [];
  if (notShots.length) {
    out.push(
      'Asked for but NOT part of the video, so not a step:',
      ...notShots.map((x: string) => `  · ${x.trim()}`),
    );
  }

  /* A reading that found nothing is not a reading. Returning it would put an
     empty heading above the material and imply a first pass had succeeded. */
  return out.length ? out.join('\n') : '';
}
