/**
 * Splitting a long recording into pieces Gemini can actually read, and
 * putting the answers back together.
 *
 * ── Why four minutes ──────────────────────────────────────────────────────
 *
 * Measured, 23 Aug 2026, locating phrases in synthetic audio against
 * ffprobe-exact ground truth:
 *
 *      57s  0.57s      183s  1.23s      400s  3.12s
 *      60s  0.68s      289s  0.84s      728s  4.77s  (and fabricated)
 *
 * The cliff sits between 289 and 400 seconds. Four minutes is the last
 * measured-good size with room underneath it, and real podcast audio — music,
 * crosstalk, a room — will be worse than the clean speech those numbers came
 * from, not better.
 *
 * ── Why the chunks overlap ────────────────────────────────────────────────
 *
 * A sentence straddling a boundary arrives truncated in both pieces and
 * correct in neither, so each chunk starts a little before the previous one
 * ended and the duplicate is removed when the answers are stitched. Removing
 * it by matching the words is what makes the overlap invisible; without that
 * step the transcript stutters at every boundary, and the Clipper picks a
 * window whose hook line is written twice.
 */

import type { Transcript, TranscriptChunk } from '../ask/clipperBrain';

/** The last measured-good chunk size, with room underneath the cliff. */
export const CHUNK_SECONDS = 240;

/** Long enough to contain a straddling sentence, short enough to be cheap. */
export const OVERLAP_SECONDS = 8;

export interface ChunkPlan {
  index: number;
  start: number;
  end: number;
}

/**
 * Where to cut the source for transcription.
 *
 * Chunks tile the whole recording and each begins `overlap` before the
 * previous one ended. The last one ends exactly at the duration — a final
 * sliver of a second is not worth a round trip, so it is absorbed rather than
 * given a chunk of its own.
 */
export function planChunks(
  durationSec: number,
  chunkSec: number = CHUNK_SECONDS,
  overlapSec: number = OVERLAP_SECONDS,
): ChunkPlan[] {
  if (!(durationSec > 0)) return [];
  const size = Math.max(1, chunkSec);
  const overlap = Math.max(0, Math.min(overlapSec, size / 2));

  if (durationSec <= size) return [{ index: 0, start: 0, end: durationSec }];

  const plans: ChunkPlan[] = [];
  let start = 0;
  let index = 0;

  while (start < durationSec) {
    const end = Math.min(start + size, durationSec);
    plans.push({ index, start, end });
    if (end >= durationSec) break;
    index++;
    start = end - overlap;
  }

  /* A trailing sliver is absorbed into the chunk before it. Asking a model
     about 1.5 seconds of audio costs a full round trip and returns almost
     nothing, and it is the piece most likely to be a half-word. */
  const last = plans[plans.length - 1];
  if (plans.length > 1 && last.end - last.start < overlap * 2) {
    plans.pop();
    plans[plans.length - 1].end = durationSec;
  }

  return plans;
}

const words = (s: string): string[] =>
  (s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);

/**
 * How many words at the start of `next` repeat the end of `previous`.
 *
 * Compared on normalised words rather than characters, because the two
 * transcriptions of the same seconds are not character-identical — one may
 * write "eighty-four" and the other "eighty four", and a character match would
 * find nothing and leave the whole overlap duplicated.
 *
 * The longest match wins, which matters when the speaker repeats themselves:
 * a short accidental match near the start would otherwise be preferred and
 * leave most of the duplicate in place.
 */
export function overlapWords(previous: string, next: string, maxWords = 60): number {
  const a = words(previous);
  const b = words(next);
  const limit = Math.min(maxWords, a.length, b.length);

  for (let n = limit; n >= 3; n--) {
    let same = true;
    for (let i = 0; i < n; i++) {
      if (a[a.length - n + i] !== b[i]) { same = false; break; }
    }
    if (same) return n;
  }
  return 0;
}

/** Drop the first `n` words from a piece of text, keeping the original spelling. */
function dropLeadingWords(text: string, n: number): string {
  if (n <= 0) return text.trim();
  let seen = 0;
  let i = 0;
  const s = text || '';
  while (i < s.length && seen < n) {
    while (i < s.length && /\s/.test(s[i])) i++;
    while (i < s.length && !/\s/.test(s[i])) i++;
    seen++;
  }
  return s.slice(i).trim();
}

export interface ChunkText {
  index: number;
  start: number;
  end: number;
  text: string;
}

/**
 * Put the transcribed pieces back together as one transcript.
 *
 * The stitched chunks TILE: each one starts where the last ended, so a line's
 * time is known to within a chunk and the pieces never claim the same seconds
 * twice. That coarse attribution is all the Clipper needs — it chooses from
 * the words, and the exact moment is found later, inside one chunk, where the
 * measurements say the model can be trusted.
 */
export function stitch(pieces: ChunkText[], durationSec: number): Transcript {
  const sorted = [...pieces].sort((a, b) => a.index - b.index);
  const chunks: TranscriptChunk[] = [];

  let cursor = 0;
  sorted.forEach((piece, i) => {
    const previous = i > 0 ? sorted[i - 1].text : '';
    const repeated = i > 0 ? overlapWords(previous, piece.text) : 0;
    const text = dropLeadingWords(piece.text, repeated);
    if (!text) return;

    const start = chunks.length ? cursor : piece.start;
    const end = Math.max(start, piece.end);
    chunks.push({ index: chunks.length, start, end, text });
    cursor = end;
  });

  return { chunks, duration: durationSec };
}

/**
 * Whether a transcribed chunk looks like a real transcription.
 *
 * Ordinary speech runs 120-180 words per minute. Far below and the model
 * summarised or gave up; far above and it invented. Both come back as
 * well-formed text with no error attached, which is the only reason this
 * needs checking at all.
 */
export function looksTranscribed(text: string, seconds: number): string | null {
  if (!(seconds > 0)) return null;
  const n = words(text).length;
  if (!n) return 'came back empty';
  const wpm = (n / seconds) * 60;
  if (wpm < 40) return `came back with only ${n} words for ${Math.round(seconds)}s of audio — that is a summary, not a transcript`;
  if (wpm > 400) return `came back with ${n} words for ${Math.round(seconds)}s of audio, far more than anyone can say`;
  return null;
}
