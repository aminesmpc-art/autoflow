/**
 * Splitting a clip into pieces Omni will accept.
 *
 * Flow's own words: "Videos longer than 10s can't be edited. Trim to 10s or
 * under to edit." So a nineteen second cut goes in pieces or not at all.
 *
 * The interesting question is not THAT it splits but WHERE. Ten-ten-six is the
 * obvious answer and it is wrong twice: the six second runt gets a different
 * share of whatever the model does, and 10.0s is a number rather than a moment
 * — it lands mid-word about as often as not.
 */

import {
  OMNI_MAX_SEC,
  describeChunks,
  planOmniChunks,
  type ChunkPhrase,
} from '../studio/clip/omniChunks';

/** Speech with real gaps in it, the shape a reading returns. */
const speech = (spans: Array<[number, number]>): ChunkPhrase[] =>
  spans.map(([startSec, endSec]) => ({ startSec, endSec }));

const lengths = (chunks: ReturnType<typeof planOmniChunks>) =>
  chunks.map((c) => Number(c.seconds.toFixed(1)));

describe('the cap Flow actually enforces', () => {
  it('is ten seconds', () => {
    expect(OMNI_MAX_SEC).toBe(10);
  });

  it('never returns a piece over it', () => {
    for (const runtime of [11, 19.3, 26, 41, 60, 119.7]) {
      for (const c of planOmniChunks(runtime)) {
        expect(c.seconds).toBeLessThanOrEqual(OMNI_MAX_SEC + 1e-6);
      }
    }
  });

  it('covers the whole clip with no gap and no overlap', () => {
    const chunks = planOmniChunks(26);
    expect(chunks[0].startSec).toBe(0);
    expect(chunks[chunks.length - 1].endSec).toBeCloseTo(26, 6);
    for (let i = 0; i < chunks.length - 1; i++) {
      expect(chunks[i].endSec).toBeCloseTo(chunks[i + 1].startSec, 6);
    }
  });
});

describe('a clip that already fits', () => {
  it('is left alone rather than cut up for no reason', () => {
    const chunks = planOmniChunks(8.4);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({ startSec: 0, index: 1, of: 1, cutsSpeech: false });
  });

  it('is left alone at exactly the cap', () => {
    expect(planOmniChunks(10)).toHaveLength(1);
  });

  it('splits the moment it goes over', () => {
    expect(planOmniChunks(10.1).length).toBeGreaterThan(1);
  });

  it('has nothing to say about a clip with no length', () => {
    expect(planOmniChunks(0)).toEqual([]);
    expect(planOmniChunks(-5)).toEqual([]);
  });
});

describe('evenly, not ten-ten-and-whatever', () => {
  it('splits 26 seconds into three roughly equal pieces', () => {
    /* THE POINT. 10 / 10 / 6 gives a third of the material a different share
       of whatever the model does. Three pieces of about nine are treated
       alike. */
    const chunks = planOmniChunks(26);
    expect(chunks).toHaveLength(3);
    for (const c of chunks) {
      expect(c.seconds).toBeGreaterThan(8);
      expect(c.seconds).toBeLessThan(9.5);
    }
  });

  it('uses the fewest pieces that fit', () => {
    expect(planOmniChunks(19.3)).toHaveLength(2);
    expect(planOmniChunks(26)).toHaveLength(3);
    expect(planOmniChunks(41)).toHaveLength(5);
  });

  it('never leaves a runt beside full-length pieces', () => {
    for (const runtime of [21, 26, 31, 44, 57]) {
      const l = lengths(planOmniChunks(runtime));
      expect(Math.max(...l) - Math.min(...l)).toBeLessThan(1);
    }
  });

  it('numbers the pieces so they can be found again', () => {
    const chunks = planOmniChunks(26);
    expect(chunks.map((c) => `${c.index}/${c.of}`)).toEqual(['1/3', '2/3', '3/3']);
  });
});

describe('joining where somebody stopped talking', () => {
  it('moves a boundary onto a nearby pause', () => {
    /* An even split of 19.3 wants a boundary at 9.65. There is a pause from
       9.0 to 10.0, so the join belongs at 9.5 — in the silence, not in a
       word. */
    const phrases = speech([[0, 9.0], [10.0, 19.3]]);
    const chunks = planOmniChunks(19.3, phrases);
    expect(chunks[0].endSec).toBeCloseTo(9.5, 1);
    expect(chunks.every((c) => !c.cutsSpeech)).toBe(true);
  });

  it('takes the middle of the pause, not either edge', () => {
    /* At the moment speech stops it clips the breath; at the moment it
       resumes it arrives late. */
    const phrases = speech([[0, 9.0], [10.0, 19.3]]);
    expect(planOmniChunks(19.3, phrases)[0].endSec).toBeCloseTo(9.5, 2);
  });

  it('refuses a pause that would push a piece over the cap', () => {
    /* A prettier join is not worth a chunk Flow will not take. */
    const phrases = speech([[0, 0.5], [0.6, 19.3]]);
    const chunks = planOmniChunks(19.3, phrases);
    for (const c of chunks) expect(c.seconds).toBeLessThanOrEqual(OMNI_MAX_SEC + 1e-6);
  });

  it('ignores a pause too far from where the boundary belongs', () => {
    /* Beyond the snap window it is no longer the boundary that was planned,
       and evenness matters more than the join. */
    const phrases = speech([[0, 2.0], [3.0, 19.3]]);
    const chunks = planOmniChunks(19.3, phrases);
    expect(chunks[0].endSec).toBeGreaterThan(8);
  });

  it('says so when a join had to land inside a sentence', () => {
    /* Not a failure — some clips have no pause anywhere near the middle. But
       the clipper should know which seam to look at. */
    const phrases = speech([[0, 19.3]]);
    const chunks = planOmniChunks(19.3, phrases);
    expect(chunks[1].cutsSpeech).toBe(true);
  });

  it('never calls the clip’s own opening a bad join', () => {
    /* Where the clip starts is where the cut already decided to be. */
    const chunks = planOmniChunks(19.3, speech([[0, 19.3]]));
    expect(chunks[0].cutsSpeech).toBe(false);
  });

  it('works with no phrases at all', () => {
    expect(planOmniChunks(26, []).length).toBe(3);
  });
});

describe('saying it in one line', () => {
  it('reports the pieces and their lengths', () => {
    const said = describeChunks(planOmniChunks(26));
    expect(said).toMatch(/3 pieces/);
    expect(said).toMatch(/every join is in a pause/);
  });

  it('calls out joins that land mid-sentence', () => {
    const said = describeChunks(planOmniChunks(19.3, speech([[0, 19.3]])));
    expect(said).toMatch(/mid-sentence/);
  });

  it('says a short clip needs no splitting', () => {
    expect(describeChunks(planOmniChunks(8))).toMatch(/one piece/);
  });

  it('has something to say about nothing', () => {
    expect(describeChunks([])).toBe('nothing to split');
  });
});

describe('the cap holds on BOTH sides of a boundary', () => {
  /* The bug this pins, found by printing real output rather than by any test
     here: a 19.32s clip with its real phrase timings came out 9.1 + 10.2.
     The join moved earlier to land in a pause — correct — and that grew the
     piece AFTER it to 10.2s, which Flow refuses.

     Guarding only the piece before a boundary is half a guard. Every test above
     ran without phrases, so none of them could ever have caught it. */

  /** The real reading of the user's own cut. */
  const REAL: ChunkPhrase[] = [
    { startSec: 0.0, endSec: 4.1 },
    { startSec: 4.4, endSec: 5.1 },
    { startSec: 5.1, endSec: 9.1 },
    { startSec: 9.1, endSec: 12.3 },
    { startSec: 12.6, endSec: 14.3 },
    { startSec: 14.6, endSec: 16.8 },
    { startSec: 16.8, endSec: 19.4 },
  ];

  it('keeps every piece under the cap on the real clip', () => {
    for (const c of planOmniChunks(19.32, REAL)) {
      expect(c.seconds).toBeLessThanOrEqual(OMNI_MAX_SEC + 1e-6);
    }
  });

  it('keeps every piece under the cap whatever the pauses are', () => {
    /* Swept, because the failure depended entirely on where the pauses fell —
       a single fixture would have missed it just as the originals did. */
    for (const runtime of [11, 14.5, 19.32, 21, 26, 33.3, 41, 58]) {
      for (let offset = 0; offset < 3; offset += 0.5) {
        const phrases: ChunkPhrase[] = [];
        for (let t = 0; t < runtime; t += 3.1) {
          phrases.push({ startSec: t, endSec: Math.min(runtime, t + 2.6 + offset * 0.1) });
        }
        for (const c of planOmniChunks(runtime, phrases)) {
          expect(c.seconds).toBeLessThanOrEqual(OMNI_MAX_SEC + 1e-6);
        }
      }
    }
  });

  it('still moves the join into a pause when it legally can', () => {
    /* The fix must not have bought safety by refusing to snap at all. */
    const phrases = speech([[0, 9.0], [10.0, 19.3]]);
    expect(planOmniChunks(19.3, phrases)[0].endSec).toBeCloseTo(9.5, 1);
  });
});
