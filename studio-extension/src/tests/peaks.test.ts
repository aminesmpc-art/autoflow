/**
 * Finding the moments worth clipping, from the sound of them.
 *
 * The discriminator worth defending is the second one. Scoring on loudness
 * alone picks the music bed under the narration, which is loud, steady and
 * completely unpostable. What separates a chase from narration is that the
 * chase VARIES — a shout, then running, then a sudden stop — so the score has
 * to reward variation as well as level.
 *
 * These signals are built by hand so the right answer is known. Every failure
 * here is silent in the worst way: the node returns a moment, it is a real
 * moment, and it is simply the boring one.
 */

import {
  envelopeOf, joinEnvelopes, findPeaks, textNear, ENVELOPE_WINDOW_SEC,
  type Envelope,
} from '../studio/clip/peaks';

const RATE = 16000;

/** Deterministic noise — Math.random would make a failure unrepeatable. */
function noise(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return (s / 0xffffffff) * 2 - 1; };
}

/** Build audio from a script of {sec, level} segments. */
function build(segments: Array<{ sec: number; level: number }>, seed = 3): Float32Array {
  const rnd = noise(seed);
  const total = Math.round(segments.reduce((a, s) => a + s.sec, 0) * RATE);
  const out = new Float32Array(total);
  let i = 0;
  for (const seg of segments) {
    const n = Math.round(seg.sec * RATE);
    for (let k = 0; k < n && i < total; k++, i++) out[i] = rnd() * seg.level;
  }
  return out;
}

/** Alternating loud and quiet — the sound of something happening. */
function varied(sec: number, lo: number, hi: number, everySec = 1.5): Array<{ sec: number; level: number }> {
  const segs: Array<{ sec: number; level: number }> = [];
  for (let t = 0; t < sec; t += everySec) {
    segs.push({ sec: Math.min(everySec, sec - t), level: (segs.length % 2) ? lo : hi });
  }
  return segs;
}

/* ------------------------------------------------------------------ */

describe('the envelope', () => {
  it('is coarse enough to describe a moment, not a word', () => {
    /* The silence detector works at 20ms because it places one cut. This is
       describing a minute, so a twenty-minute file stays a few thousand
       numbers rather than millions. */
    expect(ENVELOPE_WINDOW_SEC).toBe(0.5);
    const env = envelopeOf(build([{ sec: 60, level: 0.3 }]), RATE);
    expect(env.values.length).toBe(120);
  });

  it('follows the level of the audio', () => {
    const env = envelopeOf(build([{ sec: 10, level: 0.1 }, { sec: 10, level: 0.6 }]), RATE);
    expect(env.values[5]).toBeLessThan(env.values[35]);
  });

  it('records where it starts on the source timeline', () => {
    const env = envelopeOf(build([{ sec: 5, level: 0.3 }]), RATE, 240);
    expect(env.startSec).toBe(240);
  });

  it('survives an empty buffer', () => {
    expect(envelopeOf(new Float32Array(0), RATE).values.length).toBe(0);
  });
});

describe('joining the chunk envelopes', () => {
  const env = (startSec: number, n: number, level: number): Envelope => ({
    values: Float32Array.from({ length: n }, () => level),
    windowSec: 0.5,
    startSec,
  });

  it('does not double-count the overlapping seconds', () => {
    /* Chunks overlap by eight seconds for transcription. Counted twice, the
       score of anything near a boundary is computed over the same audio
       twice — and every boundary looks unusual. */
    const joined = joinEnvelopes([env(0, 480, 0.2), env(232, 480, 0.5)]);
    expect(joined.values.length).toBe(Math.round(472 / 0.5));
  });

  it('puts chunks back in order', () => {
    const joined = joinEnvelopes([env(232, 10, 0.5), env(0, 464, 0.2)]);
    expect(joined.startSec).toBe(0);
    expect(joined.values[0]).toBeCloseTo(0.2, 5);
  });

  it('handles a single chunk and an empty list', () => {
    expect(joinEnvelopes([env(0, 10, 0.3)]).values.length).toBe(10);
    expect(joinEnvelopes([]).values.length).toBe(0);
  });
});

/* ------------------------------------------------------------------ */

describe('finding the peaks', () => {
  it('finds a loud stretch in an otherwise quiet recording', () => {
    /* quiet 0-120 · LOUD 120-180 · quiet 180-300 */
    const env = envelopeOf(build([
      { sec: 120, level: 0.08 }, ...varied(60, 0.2, 0.9), { sec: 120, level: 0.08 },
    ]), RATE);
    const peaks = findPeaks(env, { spanSec: 45, count: 2 });
    expect(peaks.length).toBeGreaterThan(0);
    expect(peaks[0].start).toBeGreaterThan(100);
    expect(peaks[0].start).toBeLessThan(180);
  });

  it('prefers a VARIED stretch over a steadily loud one', () => {
    /* THE discriminator. Narration over a music bed is loud and even and
       completely unpostable; a chase is loud and swings. Scoring on level
       alone picks the music.
     *
       steady-loud 0-90 · calm 90-150 · varied-loud 150-240 · calm 240-330 */
    const env = envelopeOf(build([
      { sec: 90, level: 0.55 },
      { sec: 60, level: 0.12 },
      ...varied(90, 0.1, 0.75),
      { sec: 90, level: 0.12 },
    ]), RATE);
    const peaks = findPeaks(env, { spanSec: 45, count: 1 });
    expect(peaks).toHaveLength(1);
    expect(peaks[0].start).toBeGreaterThan(140);
    expect(peaks[0].start).toBeLessThan(240);
  });

  it('prefers a sustained loud stretch over a near-silent spiky one', () => {
    /* The other half of the score, and the half my first fixtures never
       tested — mutation testing showed that removing the loudness term
       entirely still passed every case.
     *
       Both terms are needed because they fail in opposite directions. Without
       VARIATION the winner is the music bed under the narration: loud, even,
       unpostable. Without LOUDNESS the winner is this — a stretch of near
       silence with three bangs in it, which has the highest swing in the whole
       recording and is forty seconds of nothing.
     *
       baseline · SPIKY (silence + 3 bursts) · baseline · LOUD+varied · baseline */
    const spiky: Array<{ sec: number; level: number }> = [];
    for (let i = 0; i < 3; i++) {
      spiky.push({ sec: 13.5, level: 0.02 }, { sec: 1.5, level: 0.95 });
    }
    const env = envelopeOf(build([
      { sec: 60, level: 0.25 },
      ...spiky,
      { sec: 60, level: 0.25 },
      ...varied(45, 0.5, 0.9),
      { sec: 60, level: 0.25 },
    ]), RATE);

    const [p] = findPeaks(env, { spanSec: 45, count: 1 });
    expect(p.start).toBeGreaterThan(160);   // inside the loud, varied stretch
    expect(p.start).toBeLessThan(215);
  });

  it('returns candidates that do not overlap each other', () => {
    /* Without suppression every result is the same moment shifted by half a
       second, and the clipper is offered four copies of one clip. */
    const env = envelopeOf(build([
      { sec: 60, level: 0.1 }, ...varied(60, 0.2, 0.9),
      { sec: 60, level: 0.1 }, ...varied(60, 0.2, 0.85),
      { sec: 60, level: 0.1 }, ...varied(60, 0.2, 0.8),
      { sec: 60, level: 0.1 },
    ]), RATE);
    const peaks = findPeaks(env, { spanSec: 45, count: 3 });
    expect(peaks.length).toBeGreaterThan(1);
    for (let i = 0; i < peaks.length; i++) {
      for (let j = i + 1; j < peaks.length; j++) {
        const apart = Math.abs(peaks[i].start - peaks[j].start);
        expect(apart).toBeGreaterThanOrEqual(45);
      }
    }
  });

  it('returns them strongest first', () => {
    const env = envelopeOf(build([
      { sec: 60, level: 0.1 }, ...varied(60, 0.25, 0.95),
      { sec: 60, level: 0.1 }, ...varied(60, 0.22, 0.45),
      { sec: 60, level: 0.1 },
    ]), RATE);
    const peaks = findPeaks(env, { spanSec: 45, count: 2 });
    expect(peaks.length).toBe(2);
    expect(peaks[0].score).toBeGreaterThanOrEqual(peaks[1].score);
  });

  it('honours the span length asked for', () => {
    const env = envelopeOf(build([{ sec: 120, level: 0.1 }, ...varied(60, 0.2, 0.9), { sec: 120, level: 0.1 }]), RATE);
    for (const span of [30, 45, 60]) {
      const [p] = findPeaks(env, { spanSec: span, count: 1 });
      expect(p.end - p.start).toBeCloseTo(span, 5);
    }
  });

  it('can be told to skip an intro', () => {
    /* The loudest thing in a MrBeast video is often the opening. A clipper
       who has already used it wants the next one. */
    const env = envelopeOf(build([
      ...varied(60, 0.2, 0.95), { sec: 60, level: 0.1 },
      ...varied(60, 0.2, 0.85), { sec: 60, level: 0.1 },
    ]), RATE);
    const [p] = findPeaks(env, { spanSec: 45, count: 1, fromSec: 90 });
    expect(p.start).toBeGreaterThanOrEqual(90);
  });

  it('finds nothing in a recording with no dynamics at all', () => {
    /* A flat tone has no peaks. Returning one anyway would be inventing a
       moment, which is exactly the confident-and-wrong failure to avoid. */
    expect(findPeaks(envelopeOf(build([{ sec: 300, level: 0.3 }]), RATE), { spanSec: 45 }))
      .toEqual([]);
  });

  it('finds nothing in silence', () => {
    expect(findPeaks(envelopeOf(build([{ sec: 300, level: 0 }]), RATE), { spanSec: 45 }))
      .toEqual([]);
  });

  it('returns nothing rather than throwing on a recording shorter than a span', () => {
    expect(findPeaks(envelopeOf(build([{ sec: 20, level: 0.3 }]), RATE), { spanSec: 45 }))
      .toEqual([]);
  });

  it('describes each candidate in words a person can read', () => {
    const env = envelopeOf(build([
      { sec: 120, level: 0.08 }, ...varied(60, 0.2, 0.9), { sec: 120, level: 0.08 },
    ]), RATE);
    const [p] = findPeaks(env, { spanSec: 45, count: 1 });
    expect(p.why.length).toBeGreaterThan(8);
    expect(p.why).not.toMatch(/undefined|NaN/);
  });

  it('reports times on the source timeline, not offsets into the buffer', () => {
    const env = envelopeOf(build([
      { sec: 120, level: 0.08 }, ...varied(60, 0.2, 0.9), { sec: 120, level: 0.08 },
    ]), RATE, 600);
    const [p] = findPeaks(env, { spanSec: 45, count: 1 });
    expect(p.start).toBeGreaterThan(600);
  });
});

/* ------------------------------------------------------------------ */

describe('the words spoken during a candidate', () => {
  const chunks = [
    { start: 0, end: 240, text: 'the opening narration' },
    { start: 240, end: 480, text: 'show us your hands' },
    { start: 480, end: 720, text: 'the closing bit' },
  ];

  it('gathers the overlapping part of every chunk it touches', () => {
    /* 230-300 covers only the last sliver of chunk 0 and the first quarter of
       chunk 1, so that is what comes back. These two tests used to assert the
       whole chunks — which was the bug, not the specification. */
    expect(textNear(chunks, 230, 300)).toBe('narration show');
  });

  it('takes only the overlapping part of a chunk it sits inside', () => {
    expect(textNear(chunks, 300, 400)).toBe('us your');
  });

  it('returns nothing for a span past the end', () => {
    expect(textNear(chunks, 900, 1000)).toBe('');
  });

  it('slices WITHIN a chunk far longer than the candidate', () => {
    /* Found on the first real run, and invisible before it.
     *
       A pasted transcript is a single chunk covering the whole recording, so
       every candidate came back with the entire transcript. The model is
       asked to judge the moments on what is said, and four identical
       passages give it nothing to judge — it can only go on the audio
       description, which is exactly the half it was brought in to supplement.
     *
       The earlier fixtures all used chunks about the same size as a
       candidate, so returning the whole chunk looked correct. */
    const oneChunk = [{ start: 0, end: 240, text: 'aa bb cc dd ee ff gg hh' }];
    expect(textNear(oneChunk, 0, 60)).toBe('aa bb');
    expect(textNear(oneChunk, 120, 180)).toBe('ee ff');
    expect(textNear(oneChunk, 180, 240)).toBe('gg hh');
  });

  it('gives different moments different words', () => {
    /* The property that actually matters, stated directly. */
    const oneChunk = [{ start: 0, end: 240, text: 'aa bb cc dd ee ff gg hh' }];
    const a = textNear(oneChunk, 0, 45);
    const b = textNear(oneChunk, 150, 195);
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThan(0);
    expect(b.length).toBeGreaterThan(0);
  });

  it('still returns a short chunk whole', () => {
    expect(textNear(chunks, 240, 480)).toBe('show us your hands');
  });
});
