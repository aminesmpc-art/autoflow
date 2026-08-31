/**
 * A join that lands mid-sentence is the thing the splitter exists to avoid.
 *
 * Reported from a real run: a 39.57s cut came back as
 *
 *   4 pieces: 9.9 + 9.9 + 9.9 + 9.9s — 3 joins lands mid-sentence
 *
 * A perfectly even split with EVERY join in speech is not the pause search
 * doing badly, it is the pause search never having a chance. The arithmetic:
 * four pieces of at most 10s must cover 39.57s, so the four lengths have
 * 40 − 39.57 = 0.43s of give between them, in total. Every boundary is pinned
 * to within a fraction of a second of the even split, and a pause has to fall
 * inside that sliver or it cannot be used.
 *
 * The piece count was the minimum that fits — right for spending the fewest
 * Flow edits, and it leaves nothing to pay for a clean join with. One more
 * piece turns 0.43s of slack into 10.43s, which is the difference between
 * hunting for a pause and having a choice of them.
 *
 * So these tests are about the trade rather than the search: fewest pieces
 * while the joins are clean, one more piece when that is what buys clean.
 */

import { planOmniChunks, describeChunks, OMNI_MAX_SEC } from '../studio/clip/omniChunks';

/**
 * Speech with real gaps in it, laid down end to end.
 *
 * `pattern` is a run of [spoken, silent] pairs, repeated to fill the clip, so
 * pauses land where somebody actually stopped talking rather than on a grid.
 */
function speech(runtime: number, pattern: Array<[number, number]> = [[3.2, 0.45], [4.1, 0.35], [2.6, 0.6]]) {
  const out: Array<{ startSec: number; endSec: number; text: string }> = [];
  let t = 0;
  let i = 0;
  while (t < runtime) {
    const [talk, gap] = pattern[i % pattern.length];
    const end = Math.min(t + talk, runtime);
    if (end > t) out.push({ startSec: t, endSec: end, text: `phrase ${i + 1}` });
    t = end + gap;
    i++;
  }
  return out;
}

const joinsInSpeech = (chunks: any[]) => chunks.filter((c) => c.cutsSpeech).length;
const longest = (chunks: any[]) => Math.max(...chunks.map((c) => c.seconds));

describe('the clip that was reported', () => {
  /* 39.57s, the exact length off the node: cut 3140.26–3179.88. */
  const RUNTIME = 39.57;
  const phrases = speech(RUNTIME);

  it('never exceeds what Flow will take', () => {
    /* The one rule that is not a preference. */
    const chunks = planOmniChunks(RUNTIME, phrases);
    expect(longest(chunks)).toBeLessThanOrEqual(OMNI_MAX_SEC + 1e-9);
  });

  it('lands every join in a pause', () => {
    /* This is the report. It was 3 of 3 joins inside speech. */
    const chunks = planOmniChunks(RUNTIME, phrases);
    expect(joinsInSpeech(chunks)).toBe(0);
  });

  it('says so, rather than apologising for itself', () => {
    const chunks = planOmniChunks(RUNTIME, phrases);
    expect(describeChunks(chunks)).toMatch(/every join is in a pause/);
  });

  it('and it costs at most one extra piece', () => {
    /* A clean join is worth one more upload. It is not worth six. */
    const chunks = planOmniChunks(RUNTIME, phrases);
    const fewest = Math.ceil(RUNTIME / OMNI_MAX_SEC);
    expect(chunks.length).toBeLessThanOrEqual(fewest + 1);
  });
});

describe('what it must not trade away', () => {
  it('still uses the fewest pieces when they already join cleanly', () => {
    /* A clip with an obvious pause near every even boundary must not grow an
       extra piece it does not need. */
    const phrases = [
      { startSec: 0, endSec: 9.4, text: 'one' },
      { startSec: 9.9, endSec: 19.3, text: 'two' },
      { startSec: 19.8, endSec: 28.0, text: 'three' },
    ];
    const chunks = planOmniChunks(28.0, phrases);
    expect(chunks.length).toBe(3);
    expect(joinsInSpeech(chunks)).toBe(0);
  });

  it('leaves a clip that already fits alone', () => {
    const chunks = planOmniChunks(8.4, speech(8.4));
    expect(chunks).toHaveLength(1);
    expect(describeChunks(chunks)).toMatch(/fits in one piece/);
  });

  it('makes no runt piece while chasing a pause', () => {
    const chunks = planOmniChunks(39.57, speech(39.57));
    expect(Math.min(...chunks.map((c) => c.seconds))).toBeGreaterThan(2);
  });

  it('covers the clip exactly, with no gap and no overlap', () => {
    /* Losing a second of the middle would be worse than any join. */
    const chunks = planOmniChunks(39.57, speech(39.57));
    expect(chunks[0].startSec).toBeCloseTo(0, 6);
    expect(chunks[chunks.length - 1].endSec).toBeCloseTo(39.57, 6);
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i].startSec).toBeCloseTo(chunks[i - 1].endSec, 6);
    }
  });

  it('holds the cap across a sweep of lengths, pauses or not', () => {
    /* The cap has been broken twice before by a change that was only checked
       against one clip. */
    for (let r = 10.5; r < 60; r += 0.37) {
      const chunks = planOmniChunks(r, speech(r));
      expect(longest(chunks)).toBeLessThanOrEqual(OMNI_MAX_SEC + 1e-9);
    }
  });

  it('survives having no phrases at all', () => {
    const chunks = planOmniChunks(39.57, []);
    expect(longest(chunks)).toBeLessThanOrEqual(OMNI_MAX_SEC + 1e-9);
    expect(chunks[chunks.length - 1].endSec).toBeCloseTo(39.57, 6);
  });
});

describe('the line the node shows', () => {
  it('agrees with itself about number', () => {
    /* It read "3 joins lands mid-sentence". */
    const chunks = [
      { startSec: 0, endSec: 9, seconds: 9, index: 1, of: 3, cutsSpeech: false },
      { startSec: 9, endSec: 18, seconds: 9, index: 2, of: 3, cutsSpeech: true },
      { startSec: 18, endSec: 27, seconds: 9, index: 3, of: 3, cutsSpeech: true },
    ] as any[];
    expect(describeChunks(chunks)).toContain('2 joins land mid-sentence');
  });

  it('says "1 join lands" for one', () => {
    const chunks = [
      { startSec: 0, endSec: 9, seconds: 9, index: 1, of: 2, cutsSpeech: false },
      { startSec: 9, endSec: 18, seconds: 9, index: 2, of: 2, cutsSpeech: true },
    ] as any[];
    expect(describeChunks(chunks)).toContain('1 join lands mid-sentence');
  });
});
