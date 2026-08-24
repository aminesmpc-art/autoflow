/**
 * Using a server reading in place of three model conversations.
 *
 * A reading is the words WITH the seconds they occupy, and the scenes with the
 * speaker's position in each. Everything the clipping pipeline previously had
 * to ask a chat for is already in it:
 *
 *   transcript   the segments, which become the chunks the survey reads
 *   boundaries   found by looking a quoted line up in those segments, rather
 *                than attaching audio and asking where it is — twice, per line
 *   framing      the speaker's position over time, rather than cutting stills
 *                out of the video and asking about them
 *
 * ── Why a quote is looked up by WORDS and not by string matching ───────────
 *
 * The survey quotes a line back from the transcript it was shown, and quoting
 * is not copying: punctuation moves, capitals change, and a line that spans
 * two segments is one string here and two rows there. Matching whole strings
 * misses all three, and a miss means falling back to the asks this exists to
 * avoid. So the segments are flattened into one stream of bare words, and the
 * quote is found as a run inside it.
 */

import type { Transcript } from '../ask/clipperBrain';
import type { FaceSample } from '../media/reframe';
import type { ReadScene, ReadSegment, VideoReading } from './readingApi';

/** Words, stripped of everything that changes when a line is quoted. */
export function bareWords(text: string): string[] {
  return (text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * A reading's segments, as the transcript the rest of the pipeline reads.
 *
 * One chunk per segment rather than one per four minutes. That is not a
 * detail: textNear slices a chunk PROPORTIONALLY to guess which words fall in
 * a span, because a four-minute chunk has no internal timing. Segments have
 * real ones, so the guess disappears and every candidate moment gets exactly
 * the words spoken during it.
 */
export function readingToTranscript(reading: VideoReading): Transcript {
  return {
    duration: reading.durationSec,
    chunks: reading.segments.map((segment, index) => ({
      index,
      start: segment.start,
      end: segment.end,
      text: segment.text,
    })),
  };
}

interface WordAt {
  word: string;
  /** Which segment it came from. */
  segment: number;
}

function flatten(segments: ReadSegment[]): WordAt[] {
  const out: WordAt[] = [];
  segments.forEach((segment, index) => {
    for (const word of bareWords(segment.text)) out.push({ word, segment: index });
  });
  return out;
}

/** Where a run of words begins in the stream, or -1. */
function findRun(stream: WordAt[], needle: string[], from = 0): number {
  if (!needle.length || needle.length > stream.length) return -1;
  outer: for (let i = from; i <= stream.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (stream[i + j].word !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

export interface FoundSpan {
  startSec: number;
  endSec: number;
  /** True when both ends were found; false when the end had to be inferred. */
  exact: boolean;
}

/* A quote shorter than this is not evidence.
   "Go" appears thirty times in a chase; matching on it would place a clip
   wherever it happened to look first. Four words is enough to be a line. */
const MIN_QUOTE_WORDS = 4;

/**
 * The seconds a clip runs between, from the lines it opens and closes on.
 *
 * Returns null when either line cannot be found, and the caller falls back to
 * asking. A wrong answer here is far worse than no answer: no answer costs
 * four model asks, and a wrong one cuts the wrong part of the video and says
 * nothing about it.
 */
export function locateFromReading(
  reading: VideoReading,
  hookLine: string,
  closingLine: string,
): FoundSpan | null {
  const segments = reading.segments;
  if (!segments.length) return null;

  const stream = flatten(segments);
  const hook = bareWords(hookLine);
  const closing = bareWords(closingLine);
  if (hook.length < MIN_QUOTE_WORDS) return null;

  const hookAt = findRun(stream, hook);
  if (hookAt < 0) return null;
  const startSec = segments[stream[hookAt].segment].start;

  /* The closing line is searched for only AFTER the hook. The same sentence
     can be said twice in a video, and an earlier instance would produce a
     clip that ends before it begins. */
  const closingAt =
    closing.length >= MIN_QUOTE_WORDS ? findRun(stream, closing, hookAt + hook.length) : -1;

  if (closingAt >= 0) {
    const endSec = segments[stream[closingAt + closing.length - 1].segment].end;
    if (endSec > startSec) return { startSec, endSec, exact: true };
  }

  /* The hook was found and the closing line was not. That is still worth
     having — one end measured beats both ends guessed — so the end comes from
     the last segment that starts within a sensible clip length. */
  const cap = startSec + 90;
  let endSec = segments[stream[hookAt].segment].end;
  for (const segment of segments) {
    if (segment.start > startSec && segment.start <= cap) endSec = segment.end;
  }
  return endSec > startSec ? { startSec, endSec, exact: false } : null;
}

/* How far a scene's speaker position may sit from the clip before it stops
   describing it. Scenes are whole shots, so one starting a little before the
   cut is still the shot the cut opens in. */
const SCENE_SLACK_SEC = 2;

/**
 * Where the speaker stands during a clip, from the scenes already described.
 *
 * Replaces cutting eight stills out of the video and asking a chat to point at
 * the person in each. Times are relative to the clip's own start, which is
 * what planReframe expects.
 */
export function facesFromReading(
  reading: VideoReading,
  startSec: number,
  endSec: number,
): FaceSample[] {
  const out: FaceSample[] = [];
  for (const scene of reading.scenes) {
    if (typeof scene.speaker_x !== 'number') continue;
    if (scene.end < startSec - SCENE_SLACK_SEC || scene.start > endSec + SCENE_SLACK_SEC) continue;

    /* Sampled at the middle of the part of the scene the clip actually uses.
       A scene running from before the cut to after it describes the whole
       clip, and its own midpoint may fall outside the clip entirely. */
    const from = Math.max(scene.start, startSec);
    const to = Math.min(scene.end, endSec);
    const at = (from + to) / 2 - startSec;
    out.push({ t: Math.max(0, at), x: scene.speaker_x });
  }
  out.sort((a, b) => a.t - b.t);
  return out;
}

/** Whether a reading covers a clip well enough to frame it without asking. */
export function canFrameFromReading(
  reading: VideoReading,
  startSec: number,
  endSec: number,
): boolean {
  /* Two samples is the least that can describe movement. With one the crop is
     a fixed position, which the frame-sampling ask would have done better. */
  return facesFromReading(reading, startSec, endSec).length >= 2;
}

/** Scenes overlapping a span, for showing on the node. */
export function scenesDuring(
  reading: VideoReading,
  startSec: number,
  endSec: number,
): ReadScene[] {
  return reading.scenes.filter((s) => s.end > startSec && s.start < endSec);
}
