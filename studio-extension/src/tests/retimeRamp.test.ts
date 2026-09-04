/**
 * The clock a ramp puts everything on.
 *
 * Every other kind on the sheet changes what a frame looks like. A ramp
 * changes WHEN every later frame happens — slow half a second to half speed
 * and the clip is half a second longer, so every caption cue, text card,
 * cutaway and sound after that point is at the wrong second, and so is the
 * Omni piece plan that cuts the clip into ten-second pieces.
 *
 * So the map is the whole feature and everything else is bookkeeping. These
 * check the two properties that make the bookkeeping safe:
 *
 *   · the two directions are actual inverses, because video is pushed forward
 *     through it and audio is pulled backward, and a map that is only right
 *     one way produces a clip of the right length with the ramp in the wrong
 *     place — which reads as a bug in the planner rather than here;
 *   · nothing before a ramp moves, so a clip whose ramp is at 3s has an
 *     identical first three seconds to one with no ramp at all.
 */

import {
  rampMap, noRetime, rampSpans, inRamp, retimeCues, retimeOps, retimeCutaways,
  RAMP_RATE,
} from '../studio/media/retime';
import type { EditOp } from '../studio/clip/editSheet';

const op = (o: Partial<EditOp>): EditOp =>
  ({ atSec: 0, kind: 'ramp', what: 'ramp', why: '', ...o } as EditOp);

describe('a clip with no ramp', () => {
  const m = rampMap([op({ kind: 'text', what: 'hi' })], 18.28);

  it('is the identity, and says so', () => {
    expect(m.identity).toBe(true);
    expect(m.outSeconds).toBe(18.28);
    for (const t of [0, 1, 9.4, 18.28]) {
      expect(m.toOutput(t)).toBe(t);
      expect(m.fromOutput(t)).toBe(t);
    }
  });

  it('leaves every timed thing untouched, by identity not by copy', () => {
    /* The common case is every clip. It must not pay for this feature. */
    const cues = [{ startSec: 1, endSec: 2 }];
    expect(retimeCues(cues, m)).toBe(cues);
    expect(retimeOps(cues.map(() => ({ atSec: 1, seconds: 1 })), m)).toBeDefined();
  });

  it('noRetime agrees with a rampless sheet', () => {
    expect(noRetime(18.28).outSeconds).toBe(rampMap([], 18.28).outSeconds);
  });
});

describe('one ramp', () => {
  /* 0.4s at half speed, starting at 3s, in an 18.28s clip. */
  const m = rampMap([op({ atSec: 3, seconds: 0.4 })], 18.28);

  it('makes the clip longer by exactly what it slowed', () => {
    /* 0.4s at half speed takes 0.8s, so the clip gains 0.4s. */
    expect(m.outSeconds).toBeCloseTo(18.68, 6);
  });

  it('leaves everything before it exactly where it was', () => {
    for (const t of [0, 1, 2.9, 3]) expect(m.toOutput(t)).toBeCloseTo(t, 9);
  });

  it('runs at half speed inside it', () => {
    /* Halfway through 0.4s of source is 0.2s in; at half speed that is 0.4s
       of output. */
    expect(m.toOutput(3.2)).toBeCloseTo(3.4, 9);
    expect(m.toOutput(3.4)).toBeCloseTo(3.8, 9);
  });

  it('runs at normal speed again after it', () => {
    /* Shifted by the 0.4s it gained, and no more. */
    expect(m.toOutput(4)).toBeCloseTo(4.4, 9);
    expect(m.toOutput(18.28)).toBeCloseTo(18.68, 9);
  });

  it('inverts itself, which is what keeps audio and video together', () => {
    for (let t = 0; t <= 18.28; t += 0.137) {
      expect(m.fromOutput(m.toOutput(t))).toBeCloseTo(t, 6);
    }
  });

  it('inverts from the other side too', () => {
    for (let u = 0; u <= m.outSeconds; u += 0.211) {
      expect(m.toOutput(m.fromOutput(u))).toBeCloseTo(u, 6);
    }
  });

  it('never goes backwards', () => {
    let last = -1;
    for (let t = 0; t <= 18.28; t += 0.05) {
      const u = m.toOutput(t);
      expect(u).toBeGreaterThanOrEqual(last);
      last = u;
    }
  });

  it('knows which source seconds are inside it', () => {
    expect(inRamp(m, 2.99)).toBe(false);
    expect(inRamp(m, 3)).toBe(true);
    expect(inRamp(m, 3.39)).toBe(true);
    expect(inRamp(m, 3.4)).toBe(false);
  });
});

describe('several ramps, and the ones that are really one', () => {
  it('adds up across two separate ramps', () => {
    const m = rampMap([
      op({ atSec: 2, seconds: 0.4 }),
      op({ atSec: 9, seconds: 0.6 }),
    ], 20);
    expect(m.outSeconds).toBeCloseTo(21, 6);
    expect(m.toOutput(1)).toBeCloseTo(1, 6);
    expect(m.toOutput(5)).toBeCloseTo(5.4, 6);
    expect(m.toOutput(15)).toBeCloseTo(16, 6);
  });

  it('merges two that nearly touch', () => {
    /* Left separate they would snap back to full speed for a twentieth of a
       second between them, which is seen as a dropped frame. */
    const spans = rampSpans([
      op({ atSec: 3, seconds: 0.3 }),
      op({ atSec: 3.35, seconds: 0.3 }),
    ], 20);
    expect(spans).toHaveLength(1);
    expect(spans[0]).toEqual({ from: 3, to: 3.65 });
  });

  it('merges overlapping ones without double-counting the overlap', () => {
    const m = rampMap([
      op({ atSec: 3, seconds: 0.5 }),
      op({ atSec: 3.2, seconds: 0.5 }),
    ], 20);
    /* The union is 3 to 3.7 — 0.7s slowed, so 0.7s gained, not 1.0. */
    expect(m.outSeconds).toBeCloseTo(20.7, 6);
  });

  it('clamps a ramp that runs off the end', () => {
    const spans = rampSpans([op({ atSec: 19.8, seconds: 0.9 })], 20);
    expect(spans).toEqual([{ from: 19.8, to: 20 }]);
  });

  it('drops one with nothing left after clamping', () => {
    expect(rampSpans([op({ atSec: 20, seconds: 0.5 })], 20)).toEqual([]);
    expect(rampSpans([op({ atSec: 19.995, seconds: 0.5 })], 20)).toEqual([]);
  });

  it('ignores every kind that is not a ramp', () => {
    expect(rampSpans([
      op({ kind: 'zoom', atSec: 1, seconds: 0.4 }),
      op({ kind: 'sfx', atSec: 2 }),
    ], 20)).toEqual([]);
  });
});

describe('moving the rest of the clip onto it', () => {
  const m = rampMap([op({ atSec: 3, seconds: 0.4 })], 18.28);

  it('moves a caption that sits after the ramp', () => {
    const [cue] = retimeCues([{ startSec: 5, endSec: 6 }], m);
    expect(cue.startSec).toBeCloseTo(5.4, 6);
    expect(cue.endSec).toBeCloseTo(6.4, 6);
  });

  it('moves the words inside it too', () => {
    /* A caption whose line is right and whose highlighting is a beat late is
       worse than one with no highlighting. */
    const [cue] = retimeCues([{
      startSec: 5, endSec: 6,
      words: [{ text: 'x', startSec: 5, endSec: 5.5 }],
    }] as any, m) as any;
    expect(cue.words[0].startSec).toBeCloseTo(5.4, 6);
  });

  it('leaves a caption before the ramp exactly alone', () => {
    const [cue] = retimeCues([{ startSec: 1, endSec: 2 }], m);
    expect(cue.startSec).toBeCloseTo(1, 9);
    expect(cue.endSec).toBeCloseTo(2, 9);
  });

  it('stretches anything that straddles the ramp', () => {
    /* A card running 2.8 to 3.6 covers the slowed half second, so on screen
       it now lasts longer — which is correct: the moment it marks does. */
    const [card] = retimeOps([{ atSec: 2.8, seconds: 0.8 }], m);
    expect(card.atSec).toBeCloseTo(2.8, 6);
    expect(card.seconds).toBeCloseTo(1.2, 6);
  });

  it('keeps an op with no duration without inventing one', () => {
    const [sfx] = retimeOps([{ atSec: 5 } as { atSec: number; seconds?: number }], m);
    expect(sfx.atSec).toBeCloseTo(5.4, 6);
    expect(sfx.seconds).toBeUndefined();
  });

  it('moves a cutaway and stretches one that overlaps', () => {
    const [after, over] = retimeCutaways(
      [{ atSec: 6, seconds: 2 }, { atSec: 2.9, seconds: 0.6 }], m,
    );
    expect(after.atSec).toBeCloseTo(6.4, 6);
    expect(after.seconds).toBeCloseTo(2, 6);
    expect(over.atSec).toBeCloseTo(2.9, 6);
    expect(over.seconds).toBeCloseTo(1, 6);
  });
});

describe('the rate itself', () => {
  it('is a half, which is the one that duplicates cleanly', () => {
    /* At 0.5 each source frame covers exactly two output frames. At 0.4 it
       covers two and a half, and the half is one frame held a beat longer
       than its neighbours — a stutter, on the one move in the sheet whose
       whole job is to look deliberate. */
    expect(RAMP_RATE).toBe(0.5);
    expect(1 / RAMP_RATE).toBe(2);
  });
});
