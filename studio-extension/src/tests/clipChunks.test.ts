/**
 * Splitting a recording up, and putting the answers back together.
 *
 * The stitching is where the silent failures live. If the overlap is not
 * removed, every chunk boundary stutters — the last sentence of one piece is
 * also the first sentence of the next — and the Clipper then picks a window
 * whose hook line appears twice in the transcript, so `findPhrase` matches the
 * wrong copy and the clip is cut four minutes from where it should be.
 *
 * Nothing about that reads as an error. The transcript looks fine, the window
 * looks fine, and only the finished clip is wrong.
 */

import {
  planChunks, overlapWords, stitch, looksTranscribed,
  CHUNK_SECONDS, OVERLAP_SECONDS,
  type ChunkText,
} from '../studio/clip/chunks';

/* ------------------------------------------------------------------ */

describe('planning the chunks', () => {
  it('uses the last measured-good size', () => {
    /* 289s scored 0.84s and 400s scored 3.12s, so the cliff is between them.
       Four minutes keeps room underneath it for real audio, which will be
       worse than the clean speech those numbers came from. */
    expect(CHUNK_SECONDS).toBe(240);
    expect(CHUNK_SECONDS).toBeLessThan(289);
  });

  it('gives a short recording a single chunk', () => {
    expect(planChunks(90)).toEqual([{ index: 0, start: 0, end: 90 }]);
  });

  it('covers the whole recording with no gap', () => {
    const plans = planChunks(1200);
    expect(plans[0].start).toBe(0);
    expect(plans[plans.length - 1].end).toBe(1200);
    for (let i = 1; i < plans.length; i++) {
      /* Each starts before the last ended — overlapping, never gapped. */
      expect(plans[i].start).toBeLessThan(plans[i - 1].end);
    }
  });

  it('never asks for more than a chunk at a time', () => {
    for (const d of [500, 1200, 3600, 7200]) {
      for (const p of planChunks(d)) {
        expect(p.end - p.start).toBeLessThanOrEqual(CHUNK_SECONDS + 0.001);
      }
    }
  });

  it('overlaps by enough to hold a straddling sentence', () => {
    const plans = planChunks(1200);
    for (let i = 1; i < plans.length; i++) {
      expect(plans[i - 1].end - plans[i].start).toBeCloseTo(OVERLAP_SECONDS, 5);
    }
  });

  it('absorbs a trailing sliver instead of spending a round trip on it', () => {
    /* A chunk of 1.5 seconds costs a full upload and ask and returns almost
       nothing — and is the piece most likely to be half a word. */
    const plans = planChunks(CHUNK_SECONDS + 3);
    expect(plans).toHaveLength(1);
    expect(plans[0].end).toBe(CHUNK_SECONDS + 3);
  });

  it('splits a twenty-minute podcast into a handful of asks, not twenty', () => {
    const plans = planChunks(20 * 60);
    expect(plans.length).toBeGreaterThanOrEqual(4);
    expect(plans.length).toBeLessThanOrEqual(7);
  });

  it('returns nothing for a recording with no duration', () => {
    expect(planChunks(0)).toEqual([]);
    expect(planChunks(-5)).toEqual([]);
  });

  it('never produces a backwards or empty chunk', () => {
    for (const d of [1, 30, 241, 480, 1000]) {
      for (const p of planChunks(d)) expect(p.end).toBeGreaterThan(p.start);
    }
  });
});

/* ------------------------------------------------------------------ */

describe('finding the repeated words at a boundary', () => {
  it('finds an exact repeat', () => {
    expect(overlapWords('one two three four five six', 'three four five six seven eight')).toBe(4);
  });

  it('will not act on a repeat shorter than three words', () => {
    /* The floor, stated as a decision rather than left implicit.
     *
     * Two words repeating across a boundary is as likely to be coincidence as
     * overlap — "…about it" ending one chunk and "about it…" starting the
     * next can easily be two different sentences. The cost of the two choices
     * is not symmetric: leaving a two-word duplicate makes the transcript
     * slightly redundant, while deleting two real words removes speech that
     * was said. So the short case is left alone on purpose. */
    expect(overlapWords('one two three four five', 'four five six seven')).toBe(0);
  });

  it('survives different spelling of the same speech', () => {
    /* Two transcriptions of the same seconds are not character-identical.
       Comparing characters finds nothing and leaves the whole overlap in. */
    const n = overlapWords(
      'he kept every receipt from nineteen eighty-four',
      'He kept every receipt from nineteen eighty four, in a shoebox.',
    );
    expect(n).toBeGreaterThanOrEqual(6);
  });

  it('prefers the LONGEST repeat when the speaker repeats themselves', () => {
    /* This needs a fixture where a SHORT match and a LONG one both hold, or
       it proves nothing — searching shortest-first and longest-first give the
       same answer on ordinary text, and an earlier version of this test
       passed against both. Mutation testing found it.
     *
     * Here the speaker says the same phrase twice, so the tail of the first
     * chunk matches the head of the second at four words AND at eight.
     * Stopping at four leaves "the banks are hiding" duplicated across the
     * boundary; taking eight removes the whole repeat. */
    const a = 'so the banks are hiding the banks are hiding the banks are hiding';
    const b = 'the banks are hiding the banks are hiding and nobody noticed';
    expect(overlapWords(a, b)).toBe(8);
  });

  it('reports nothing when the pieces do not actually overlap', () => {
    expect(overlapWords('completely different words here', 'nothing alike at all')).toBe(0);
  });

  it('ignores a coincidental one or two word match', () => {
    /* "the" at the end and "the" at the start is not an overlap. */
    expect(overlapWords('something ends with the', 'the beginning of something else')).toBe(0);
  });

  it('handles empty text without throwing', () => {
    expect(overlapWords('', 'anything')).toBe(0);
    expect(overlapWords('anything', '')).toBe(0);
  });
});

/* ------------------------------------------------------------------ */

describe('stitching the transcript back together', () => {
  const piece = (index: number, start: number, end: number, text: string): ChunkText =>
    ({ index, start, end, text });

  it('removes the duplicated overlap', () => {
    /* THE test. Left in, the hook line appears twice, findPhrase matches the
       wrong copy, and the clip is cut four minutes from where it should be. */
    const t = stitch([
      piece(0, 0, 240, 'the housing market is about to crash and nobody is talking about it'),
      piece(1, 232, 470, 'and nobody is talking about it the banks are hiding the real numbers'),
    ], 470);

    const all = t.chunks.map((c) => c.text).join(' ');
    expect(all.match(/nobody is talking about it/g)).toHaveLength(1);
    expect(all).toContain('the banks are hiding the real numbers');
  });

  it('keeps the pieces tiling, so no seconds are claimed twice', () => {
    const t = stitch([
      piece(0, 0, 240, 'one two three four'),
      piece(1, 232, 470, 'three four five six'),
      piece(2, 462, 700, 'five six seven eight'),
    ], 700);
    for (let i = 1; i < t.chunks.length; i++) {
      expect(t.chunks[i].start).toBe(t.chunks[i - 1].end);
    }
    expect(t.chunks[0].start).toBe(0);
    expect(t.chunks[t.chunks.length - 1].end).toBe(700);
  });

  it('puts pieces back in order when they arrive out of order', () => {
    const t = stitch([
      piece(2, 462, 700, 'seven eight'),
      piece(0, 0, 240, 'one two'),
      piece(1, 232, 470, 'three four'),
    ], 700);
    expect(t.chunks.map((c) => c.text)).toEqual(['one two', 'three four', 'seven eight']);
  });

  it('carries the duration through', () => {
    expect(stitch([piece(0, 0, 90, 'hello')], 90).duration).toBe(90);
  });

  it('drops a piece that came back empty rather than emitting a blank chunk', () => {
    const t = stitch([
      piece(0, 0, 240, 'real words here'),
      piece(1, 232, 470, ''),
    ], 470);
    expect(t.chunks).toHaveLength(1);
  });

  it('leaves a single piece alone', () => {
    const t = stitch([piece(0, 0, 90, 'the whole thing')], 90);
    expect(t.chunks).toHaveLength(1);
    expect(t.chunks[0].text).toBe('the whole thing');
  });
});

/* ------------------------------------------------------------------ */

describe('sanity-checking what came back', () => {
  const wordsOfLength = (n: number) => new Array(n).fill('word').join(' ');

  it('accepts an ordinary speaking rate', () => {
    /* 150 wpm over four minutes. */
    expect(looksTranscribed(wordsOfLength(600), 240)).toBeNull();
  });

  it('catches a summary dressed as a transcript', () => {
    /* Twenty words for four minutes of audio. It comes back well-formed with
       no error attached, which is the only reason this is checked. */
    expect(looksTranscribed(wordsOfLength(20), 240)).toMatch(/summary, not a transcript/);
  });

  it('catches an invented wall of text', () => {
    expect(looksTranscribed(wordsOfLength(3000), 240)).toMatch(/more than anyone can say/);
  });

  it('catches an empty reply', () => {
    expect(looksTranscribed('', 240)).toMatch(/empty/);
  });

  it('says nothing about a chunk with no duration', () => {
    expect(looksTranscribed('anything', 0)).toBeNull();
  });
});
