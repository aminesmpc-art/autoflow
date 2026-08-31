/**
 * Finding the moments worth clipping, from the sound of them.
 *
 * An explainer is chosen by argument: a hook, a climb, a line that closes the
 * loop. Entertainment is not. In a chase video the best sixty seconds is a
 * PEAK — a capture, a near-miss, a reveal — and the transcript alone is a poor
 * guide to where those are, because the words during the best moment are
 * usually "go, go, go" and "show us your hands".
 *
 * What separates those seconds from narration is audible, and we already have
 * the audio decoded for transcription. So the shortlist is made here, cheaply
 * and deterministically, and the model is asked to choose among candidates
 * rather than to find them.
 *
 * ── Loud is not enough ────────────────────────────────────────────────────
 *
 * Sustained narration over music is loud and steady. A chase is loud and
 * VARIED: shouting, then running, then a sudden stop. Scoring on loudness
 * alone picks the music bed; scoring on variation alone picks the quiet parts
 * either side of one bang. Both terms are needed, which is why the score adds
 * them rather than choosing.
 */

/** Energy per window, coarse enough to describe a moment rather than a word. */
export interface Envelope {
  values: Float32Array;
  windowSec: number;
  /** Where value 0 sits on the source timeline. */
  startSec: number;
}

export interface Candidate {
  start: number;
  end: number;
  /** Higher is more likely to be worth posting. Comparable within one file. */
  score: number;
  /** Plain words, for the node and for the prompt shown to the model. */
  why: string;
}

/**
 * Half a second per window.
 *
 * Fine enough to see a shout start and a room go quiet; coarse enough that a
 * twenty-minute recording is a few thousand numbers rather than millions. The
 * silence detector works at 20ms because it is placing a single cut; this is
 * describing a minute.
 */
export const ENVELOPE_WINDOW_SEC = 0.5;

/** RMS per window, over a decoded span. */
export function envelopeOf(
  samples: Float32Array,
  sampleRate: number,
  startSec = 0,
  windowSec: number = ENVELOPE_WINDOW_SEC,
): Envelope {
  const per = Math.max(1, Math.round(sampleRate * windowSec));
  const count = Math.floor(samples.length / per);
  const values = new Float32Array(Math.max(0, count));
  for (let w = 0; w < count; w++) {
    let sum = 0;
    const base = w * per;
    for (let i = 0; i < per; i++) {
      const v = samples[base + i];
      sum += v * v;
    }
    values[w] = Math.sqrt(sum / per);
  }
  return { values, windowSec, startSec };
}

/**
 * Join the envelopes of consecutive decoded chunks into one.
 *
 * Chunks overlap for transcription, but the envelope must not double-count
 * those seconds or the score of anything near a boundary is computed over the
 * same audio twice.
 */
export function joinEnvelopes(parts: Envelope[]): Envelope {
  const sorted = [...parts].filter((p) => p.values.length).sort((a, b) => a.startSec - b.startSec);
  if (!sorted.length) return { values: new Float32Array(0), windowSec: ENVELOPE_WINDOW_SEC, startSec: 0 };

  const windowSec = sorted[0].windowSec;
  const startSec = sorted[0].startSec;
  const out: number[] = [];
  let covered = startSec;

  for (const part of sorted) {
    const skip = Math.max(0, Math.round((covered - part.startSec) / windowSec));
    for (let i = skip; i < part.values.length; i++) out.push(part.values[i]);
    covered = Math.max(covered, part.startSec + part.values.length * windowSec);
  }

  return { values: Float32Array.from(out), windowSec, startSec };
}

const mean = (xs: ArrayLike<number>, from = 0, to = xs.length): number => {
  if (to <= from) return 0;
  let s = 0;
  for (let i = from; i < to; i++) s += xs[i];
  return s / (to - from);
};

const stdev = (xs: ArrayLike<number>, from = 0, to = xs.length): number => {
  if (to - from < 2) return 0;
  const m = mean(xs, from, to);
  let s = 0;
  for (let i = from; i < to; i++) s += (xs[i] - m) * (xs[i] - m);
  return Math.sqrt(s / (to - from));
};

export interface PeakOptions {
  /** How long each candidate should be. */
  spanSec?: number;
  /** How many to return. */
  count?: number;
  /** Ignore anything before this, e.g. an intro. */
  fromSec?: number;
}

const DEFAULT_SPAN_SEC = 45;
const DEFAULT_COUNT = 4;

/**
 * The most promising spans, strongest first and never overlapping.
 *
 * Scored as two z-scores added together: how much louder than usual this span
 * is, and how much more VARIED. Both are measured against the whole recording,
 * so the numbers mean "unusual for this video" rather than "loud in absolute
 * terms" — which is what makes it work on a quietly-mixed source as well as a
 * shouted one.
 */
export function findPeaks(env: Envelope, options: PeakOptions = {}): Candidate[] {
  const spanSec = Math.max(env.windowSec * 4, options.spanSec ?? DEFAULT_SPAN_SEC);
  const count = Math.max(1, options.count ?? DEFAULT_COUNT);
  const fromSec = Math.max(0, options.fromSec ?? 0);

  const v = env.values;
  const perSpan = Math.round(spanSec / env.windowSec);
  if (v.length < perSpan * 2) return [];

  const gMean = mean(v);
  const gStd = stdev(v);

  /* No dynamics, no peaks — and "no dynamics" has to be measured RELATIVE to
     the level, not against zero.
   *
     Audio at a constant level still has a wobbling envelope, because the RMS
     of a finite window is an estimate: over 8000 samples it lands within about
     one percent of the true value. An absolute guard passes that, and then the
     z-scores divide by a deviation of nearly nothing and turn one percent of
     measurement noise into a five-sigma "moment". The node would confidently
     recommend a stretch of unchanging room tone.
   *
     Five percent of the mean is far below anything with speech in it and far
     above estimator wobble. */
  if (!(gMean > 1e-9) || gStd / gMean < 0.05) return [];

  const firstWindow = Math.max(0, Math.round((fromSec - env.startSec) / env.windowSec));

  /* Scored at every window, then thinned. Sliding one window at a time is a
     few thousand cheap passes on a twenty-minute file. */
  const scored: Array<{ at: number; score: number; loud: number; vary: number }> = [];
  for (let i = firstWindow; i + perSpan <= v.length; i++) {
    const m = mean(v, i, i + perSpan);
    const s = stdev(v, i, i + perSpan);
    const loud = (m - gMean) / gStd;
    const vary = (s - gStd) / gStd;
    scored.push({ at: i, score: loud + vary, loud, vary });
  }
  if (!scored.length) return [];

  scored.sort((a, b) => b.score - a.score);

  /* Greedy non-overlap: take the best, discard everything it touches, repeat.
     Without this every result is the same moment shifted by half a second. */
  const taken: typeof scored = [];
  for (const cand of scored) {
    if (taken.length >= count) break;
    if (taken.some((t) => Math.abs(t.at - cand.at) < perSpan)) continue;
    taken.push(cand);
  }

  return taken.map((t) => {
    const start = env.startSec + t.at * env.windowSec;
    return {
      start,
      end: start + spanSec,
      score: Math.round(t.score * 100) / 100,
      why: describe(t.loud, t.vary),
    };
  });
}

function describe(loud: number, vary: number): string {
  const parts: string[] = [];
  if (loud > 0.6) parts.push('much louder than the rest of the recording');
  else if (loud > 0.15) parts.push('louder than usual');
  else if (loud < -0.3) parts.push('quieter than usual');

  if (vary > 0.6) parts.push('big swings in volume');
  else if (vary > 0.15) parts.push('more varied than usual');
  else if (vary < -0.3) parts.push('very even');

  return parts.length ? parts.join(', ') : 'unremarkable';
}

/**
 * The words spoken during a candidate, from a chunked transcript.
 *
 * Sliced WITHIN each chunk, not taken whole. A chunk is four minutes and a
 * candidate is forty-five seconds, so returning the chunk returns five times
 * too much — and when the transcript was pasted rather than chunked, the whole
 * recording is a single chunk and every candidate comes back with the same
 * text. That is not a cosmetic problem: the model is asked to judge the
 * moments on what is SAID, and four identical passages give it nothing to
 * judge. It happened on the first real run.
 *
 * The slice is proportional, because chunk boundaries are the only timing we
 * have — deliberately, since asking a model to timestamp a long recording is
 * the thing that does not work. It assumes an even speaking rate across a
 * chunk, which is wrong in detail and close enough to tell one moment from
 * another. The exact boundaries are found later, from the audio.
 */
export function textNear(
  chunks: Array<{ start: number; end: number; text: string }>,
  start: number,
  end: number,
): string {
  const parts: string[] = [];
  for (const c of chunks) {
    if (!(c.end > start && c.start < end)) continue;
    const span = c.end - c.start;
    const words = (c.text || '').trim().split(/\s+/).filter(Boolean);
    if (!(span > 0) || !words.length) continue;

    const from = Math.max(0, Math.floor(((start - c.start) / span) * words.length));
    const to = Math.min(words.length, Math.ceil(((end - c.start) / span) * words.length));
    if (to > from) parts.push(words.slice(from, to).join(' '));
  }
  return parts.join(' ').trim();
}
