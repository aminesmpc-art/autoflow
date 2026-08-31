/**
 * Finding the moments worth clipping, from what is SAID.
 *
 * peaks.ts finds them from how the recording sounds — where it gets loud, or
 * busy, or suddenly stops. On a chase video that is exactly right: the best
 * sixty seconds is a capture or a near-miss, and the words during it are "go,
 * go, go". On a trading tutorial it is exactly wrong. Run against a real one,
 * loudness picked a chart section as the strongest moment and scored a genuine
 * piece of advice "unremarkable", because advice is not loud.
 *
 * ── Why this could not be built before ────────────────────────────────────
 *
 * Because until the video could be read in one pass, the transcript had no
 * timings in it. A moment chosen from text alone had no defensible seconds
 * behind it, and asking a model for them is the thing that was measured not to
 * work. Audio was the only honest source of a timestamp, so the shortlist had
 * to come from audio.
 *
 * A reading changes that: every phrase arrives with the seconds it occupies.
 * Choosing a span of phrases invents nothing — the boundaries are the ones
 * that were measured. So the words can be used to decide WHICH moment, while
 * the timings still come from the recording.
 *
 * ── Why the signals are computed here rather than asked for ───────────────
 *
 * A model could be handed the transcript and asked which parts are good. It
 * would answer, at length, about a twenty-minute wall of text — which is the
 * situation every measurement in this project says produces confident
 * nonsense. These signals are cheap, local, explainable, and they only have to
 * be good enough to SHORTLIST. Judging the shortlist is what the model is for.
 *
 * ── Why nothing here knows what kind of video it is ───────────────────────
 *
 * There is no category setting and there should not be one. The score is added
 * to the audio score, and each is measured against its own recording. On a
 * chase, speech signals are flat and loudness carries the decision. On a
 * tutorial, loudness is flat and the words carry it. The content decides,
 * which means nobody has to classify it and nobody can classify it wrongly.
 */

import type { TranscriptChunk } from '../ask/clipperBrain';

export interface TextMoment {
  start: number;
  end: number;
  /** Higher is more promising. Comparable within one recording only. */
  score: number;
  /** Plain words, for the node and for the prompt shown to the model. */
  why: string;
}

/* ── The signals ──────────────────────────────────────────────────────────
   Each is a claim about what makes a phrase worth opening or keeping a clip
   on, and each is deliberately shallow. A shortlist does not need to be right,
   it needs to be better than picking the loudest thing. */

/** A turn in the argument: the sentence that changes the listener's mind. */
const TURN = /\b(but|actually|however|instead|the (?:problem|mistake|truth|secret|reason)|turns out|in fact|the thing is|nobody tells you|most people)\b/i;

/** Advice aimed at the viewer, which is what a saved clip usually contains. */
const ADVICE = /\b(you (?:should|need to|have to|want to|can)|never|always|stop|don'?t|here'?s (?:how|what|why)|the trick|make sure)\b/i;

/** A promise of a payoff. A question asked on camera is a hook by construction. */
const QUESTION = /\?/;

/** Something checkable. Specificity is what separates advice from platitude. */
const SPECIFIC = /(\$\s?\d|\d+\s?%|\b\d{2,}\b|\b(?:first|second|third|one|two|three)\b\s+(?:rule|step|thing|reason|way))/i;

/* An opening that leans on what came before cannot start a clip.
   "And then he said" and "so that is why" are fine sentences and terrible
   first lines: the viewer has not heard the thing being referred to. */
const DEPENDENT_OPENING = /^\s*(and|so|but|then|because|which|that'?s why|anyway|also|plus|however)\b/i;

/** A line that closes a loop, which is what makes a clip feel finished. */
const RESOLUTION = /\b(that'?s (?:why|how|it)|which is why|so that'?s|and that'?s|in the end|the point is|bottom line)\b/i;

const words = (text: string): number => (text.trim().match(/\S+/g) || []).length;

/**
 * How promising one phrase is, on its own.
 *
 * Bounded and additive so no single signal can dominate: a sentence with a
 * number in it is not automatically the best moment in a video.
 */
export function phraseScore(text: string): number {
  let score = 0;
  if (TURN.test(text)) score += 2;
  if (ADVICE.test(text)) score += 1.5;
  if (QUESTION.test(text)) score += 1;
  if (SPECIFIC.test(text)) score += 1.5;
  if (RESOLUTION.test(text)) score += 1;
  return score;
}

/** Whether a phrase can be the first thing a stranger hears. */
export function opensCleanly(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (DEPENDENT_OPENING.test(t)) return false;
  /* A fragment cannot open a clip either — three words is not a sentence. */
  return words(t) >= 3;
}

/** Whether a phrase can be the last thing they hear. */
export function closesCleanly(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (RESOLUTION.test(t)) return true;
  // Ending on a full stop or a question mark at least sounds finished.
  return /[.!?]"?\s*$/.test(t);
}

export interface TextMomentOptions {
  /** Shortest a clip may be. */
  minSec?: number;
  /** Longest a clip may be. */
  maxSec?: number;
  /** How many to return. */
  count?: number;
}

const DEFAULT_MIN_SEC = 18;
const DEFAULT_MAX_SEC = 75;
const DEFAULT_COUNT = 14;

/**
 * The most promising spans, strongest first and never overlapping.
 *
 * Spans are built between PHRASE boundaries, never inside one, because those
 * boundaries are the only timings that were actually measured. A window that
 * started halfway through a phrase would need a second invented to describe
 * it, which is the one thing this whole pipeline refuses to do.
 */
export function findTextMoments(
  chunks: TranscriptChunk[],
  options: TextMomentOptions = {},
): TextMoment[] {
  const minSec = options.minSec ?? DEFAULT_MIN_SEC;
  const maxSec = options.maxSec ?? DEFAULT_MAX_SEC;
  const count = Math.max(1, options.count ?? DEFAULT_COUNT);

  /* Phrase-level timings are the whole premise. A transcript of four-minute
     chunks has none, so there is nothing here to work with and the caller
     falls back to the audio, which is what it did before this existed. */
  const phrases = chunks
    .filter((c) => Number.isFinite(c.start) && Number.isFinite(c.end) && c.end > c.start)
    .sort((a, b) => a.start - b.start);
  if (phrases.length < 3) return [];

  const median = medianDuration(phrases);
  /* A "phrase" lasting a minute is a chunk, not a sentence — the transcript
     was never broken up, so its boundaries are not sentence boundaries and
     nothing below means what it claims to. */
  if (median > 30) return [];

  const scores = phrases.map((p) => phraseScore(p.text));

  const spans: TextMoment[] = [];
  for (let i = 0; i < phrases.length; i++) {
    if (!opensCleanly(phrases[i].text)) continue;

    let total = 0;
    for (let j = i; j < phrases.length; j++) {
      const length = phrases[j].end - phrases[i].start;
      if (length > maxSec) break;
      total += scores[j];
      if (length < minSec) continue;
      if (!closesCleanly(phrases[j].text)) continue;

      /* Per second, not per span. Without it every span grows to the maximum
         length, because one more phrase can only add score. */
      const density = total / length;
      spans.push({
        start: phrases[i].start,
        end: phrases[j].end,
        score: density,
        why: describe(phrases.slice(i, j + 1).map((p) => p.text)),
      });
    }
  }
  if (!spans.length) return [];

  spans.sort((a, b) => b.score - a.score);

  /* Greedy non-overlap, the same rule the audio peaks use: take the best,
     discard everything it touches, repeat. Without it the answer is one
     moment returned fourteen times with slightly different edges. */
  const taken: TextMoment[] = [];
  for (const span of spans) {
    if (taken.length >= count) break;
    if (taken.some((t) => span.start < t.end && span.end > t.start)) continue;
    taken.push(span);
  }
  return taken;
}

function medianDuration(phrases: TranscriptChunk[]): number {
  const lengths = phrases.map((p) => p.end - p.start).sort((a, b) => a - b);
  return lengths[Math.floor(lengths.length / 2)];
}

function describe(texts: string[]): string {
  const joined = texts.join(' ');
  const parts: string[] = [];
  if (TURN.test(joined)) parts.push('turns on a point');
  if (ADVICE.test(joined)) parts.push('tells the viewer what to do');
  if (QUESTION.test(joined)) parts.push('asks something and answers it');
  if (SPECIFIC.test(joined)) parts.push('has numbers in it');
  if (RESOLUTION.test(joined)) parts.push('closes its own loop');
  return parts.length ? parts.join(', ') : 'a self-contained stretch of speech';
}

/* ── Putting the two shortlists together ────────────────────────────────── */

export interface Scored { start: number; end: number; score: number; why: string }

/**
 * One shortlist from both, without deciding what kind of video this is.
 *
 * Each list is normalised against ITSELF before they are added, so "unusually
 * loud for this recording" and "unusually dense for this recording" carry the
 * same weight. That is what removes the need for a category: on a chase the
 * speech signals are flat and loudness decides; on a tutorial loudness is flat
 * and the words decide. Nobody has to classify the video, and nobody can
 * classify it wrongly.
 */
export function blendMoments(
  audio: Scored[],
  text: Scored[],
  count: number,
): Scored[] {
  const normalise = (list: Scored[]): Array<Scored & { z: number }> => {
    if (!list.length) return [];
    const mean = list.reduce((sum, s) => sum + s.score, 0) / list.length;
    const sd = Math.sqrt(
      list.reduce((sum, s) => sum + (s.score - mean) ** 2, 0) / list.length,
    );
    /* One candidate, or several with identical scores, carries no information
       about which is better — so it contributes position, not preference. */
    return list.map((s) => ({ ...s, z: sd > 1e-9 ? (s.score - mean) / sd : 0 }));
  };

  const all = [...normalise(audio), ...normalise(text)].sort((a, b) => b.z - a.z);

  const taken: Scored[] = [];
  for (const candidate of all) {
    if (taken.length >= count) break;
    /* A moment both lists found is the same moment twice, and the stronger
       reading of it is already the one being considered first. */
    if (taken.some((t) => candidate.start < t.end && candidate.end > t.start)) continue;
    taken.push({
      start: candidate.start,
      end: candidate.end,
      score: Math.round(candidate.z * 100) / 100,
      why: candidate.why,
    });
  }
  return taken;
}
