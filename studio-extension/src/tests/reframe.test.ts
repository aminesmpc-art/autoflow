/**
 * Turning a landscape source into a vertical clip that follows the speaker.
 *
 * The failures this guards are all VISIBLE rather than throwable — a crop
 * that jitters, drifts, or whip-pans produces a perfectly valid MP4 that looks
 * amateur. Nothing errors, no test fails by accident, and the only way to
 * catch any of it is to assert on the geometry directly.
 *
 * Two of these are non-obvious enough to state plainly:
 *
 *   · odd crop dimensions make H.264 encoder configuration fail outright, so
 *     every rectangle must come out even. 1080 * 9/16 is 607.5.
 *   · smoothing must never cross a shot change, or a legitimate jump gets
 *     spread over the samples either side of it and the crop starts moving
 *     before the cut happens.
 */

import {
  cropRect,
  fitRect, planReframe, rectAt, LOCK_THRESHOLD, SHOT_CUT_JUMP,
  type FaceSample,
} from '../studio/media/reframe';

const NINE_SIXTEEN = 9 / 16;
const HD = { w: 1920, h: 1080 };

/* ------------------------------------------------------------------ */

describe('the crop rectangle', () => {
  it('takes a full-height column out of a landscape frame', () => {
    const r = cropRect(HD.w, HD.h, NINE_SIXTEEN, 0.5);
    expect(r.height).toBe(1080);
    expect(r.width).toBe(608);           // 1080 * 9/16 = 607.5, rounded even
    expect(r.left).toBe(Math.round((1920 - 608) / 2));
    expect(r.top).toBe(0);
  });

  it('produces even dimensions, because H.264 rejects odd ones', () => {
    /* 607.5 is the real number here. An encoder configured at 607 wide does
       not warn — it fails to initialise, at the end of a run. */
    for (const [w, h] of [[1920, 1080], [1280, 720], [1440, 1080], [1000, 563]]) {
      const r = cropRect(w, h, NINE_SIXTEEN, 0.5);
      expect(r.width % 2).toBe(0);
      expect(r.height % 2).toBe(0);
    }
  });

  it('follows the subject horizontally', () => {
    const left = cropRect(HD.w, HD.h, NINE_SIXTEEN, 0.25);
    const right = cropRect(HD.w, HD.h, NINE_SIXTEEN, 0.75);
    expect(left.left).toBeLessThan(right.left);
    expect(left.width).toBe(right.width);
  });

  it('never lets the crop leave the frame', () => {
    /* A rectangle partly outside the picture encodes as a black bar down one
       side — and a speaker standing at the very edge is exactly when it
       happens. */
    for (const x of [-1, 0, 0.01, 0.5, 0.99, 1, 2]) {
      const r = cropRect(HD.w, HD.h, NINE_SIXTEEN, x);
      expect(r.left).toBeGreaterThanOrEqual(0);
      expect(r.left + r.width).toBeLessThanOrEqual(HD.w);
      expect(r.top).toBeGreaterThanOrEqual(0);
      expect(r.top + r.height).toBeLessThanOrEqual(HD.h);
    }
  });

  it('still takes a column from a square source, which is wider than 9:16', () => {
    /* 1:1 is 1.0 and the target is 0.5625, so a square frame is WIDER than a
       Short and loses width like any landscape source. The first version of
       this test assumed a square would lose height, which is only true of a
       source narrower than the target. */
    const r = cropRect(1080, 1080, NINE_SIXTEEN, 0.5, 0.5);
    expect(r.width).toBe(608);
    expect(r.height).toBe(1080);
  });

  it('crops HEIGHT when the source really is narrower than the target', () => {
    /* 1080x2400 is 0.45, narrower than 0.5625. Losing width here would leave
       a sliver; the frame has to lose height instead. */
    const r = cropRect(1080, 2400, NINE_SIXTEEN, 0.5, 0.5);
    expect(r.width).toBe(1080);
    expect(r.height).toBe(1920);          // 1080 / (9/16)
    expect(r.top).toBe(Math.round((2400 - 1920) / 2));
  });

  it('returns the whole frame when source and target already match', () => {
    const r = cropRect(1080, 1920, NINE_SIXTEEN, 0.5);
    expect(r.width).toBe(1080);
    expect(r.height).toBe(1920);
    expect(r.left).toBe(0);
    expect(r.top).toBe(0);
  });

  it('survives nonsense dimensions instead of returning NaN', () => {
    for (const [w, h, a] of [[0, 1080, NINE_SIXTEEN], [1920, 0, NINE_SIXTEEN], [1920, 1080, 0]]) {
      const r = cropRect(w, h, a);
      expect(Number.isFinite(r.left)).toBe(true);
      expect(Number.isFinite(r.width)).toBe(true);
    }
  });
});

/* ------------------------------------------------------------------ */

describe('planning the crop', () => {
  const at = (t: number, x: number): FaceSample => ({ t, x });

  it('fits rather than centre-cropping when there are no positions at all', () => {
    /* This used to centre-crop, on the reasoning that a wrong static crop is
       still a clip someone can post. Cutting a real trading video disproved
       it: with nobody on camera the middle third of a chart loses its axes,
       and one clip came back as blank whiteboard. Given nothing to centre on,
       keeping everything is the thing that is never embarrassing.

       The old behaviour is still reachable — see fitWhenNobody. */
    const p = planReframe([], HD.w, HD.h, NINE_SIXTEEN);
    expect(p.mode).toBe('fit');
    expect(p.keyframes).toHaveLength(1);
    expect(p.why).toMatch(/nobody on camera/);
  });

  it('LOCKS the crop when the speaker barely moves', () => {
    /* The common case, and the one that looks worst when got wrong. Most
       podcast footage is a fixed camera and someone who shifts in their seat;
       a crop creeping across that reads as a bug. */
    const samples = [0.50, 0.51, 0.49, 0.50, 0.52, 0.50].map((x, i) => at(i * 2, x));
    const p = planReframe(samples, HD.w, HD.h, NINE_SIXTEEN);
    expect(p.mode).toBe('locked');
    expect(p.keyframes).toHaveLength(1);
    expect(p.why).toMatch(/locked/);
  });

  it('locks around where the speaker actually is, not the frame centre', () => {
    const samples = [0.30, 0.31, 0.29, 0.30].map((x, i) => at(i * 2, x));
    const p = planReframe(samples, HD.w, HD.h, NINE_SIXTEEN);
    const centre = cropRect(HD.w, HD.h, NINE_SIXTEEN, 0.5);
    expect(p.keyframes[0].rect.left).toBeLessThan(centre.left);
  });

  it('tracks when the speaker genuinely travels', () => {
    const samples = [0.2, 0.35, 0.5, 0.65, 0.8].map((x, i) => at(i * 2, x));
    const p = planReframe(samples, HD.w, HD.h, NINE_SIXTEEN);
    expect(p.mode).toBe('tracked');
    expect(p.keyframes.length).toBe(samples.length);
  });

  it('is not dragged into tracking by one bad detection', () => {
    /* A single frame where the detector found a face on a poster should not
       put the whole clip into a moving crop. */
    const samples = [0.50, 0.51, 0.05, 0.50, 0.49, 0.50].map((x, i) => at(i * 2, x));
    const p = planReframe(samples, HD.w, HD.h, NINE_SIXTEEN);
    expect(p.mode).toBe('locked');
  });

  it('marks a shot change rather than treating it as movement', () => {
    const samples = [0.25, 0.26, 0.75, 0.76].map((x, i) => at(i * 2, x));
    const p = planReframe(samples, HD.w, HD.h, NINE_SIXTEEN);
    expect(p.mode).toBe('tracked');
    expect(p.keyframes.filter((k) => k.cut)).toHaveLength(1);
    expect(p.why).toMatch(/shot change/);
  });

  it('sorts samples that arrive out of order', () => {
    const p = planReframe(
      [at(4, 0.8), at(0, 0.2), at(2, 0.5)], HD.w, HD.h, NINE_SIXTEEN,
    );
    expect(p.keyframes.map((k) => k.t)).toEqual([0, 2, 4]);
  });

  it('ignores samples with unusable numbers', () => {
    const p = planReframe(
      [at(0, 0.5), { t: NaN, x: 0.5 }, { t: 2, x: NaN }, at(4, 0.5)],
      HD.w, HD.h, NINE_SIXTEEN,
    );
    expect(p.keyframes.every((k) => Number.isFinite(k.rect.left))).toBe(true);
  });

  it('keeps every rectangle inside the frame and even', () => {
    const samples = [0.02, 0.5, 0.98, 0.4].map((x, i) => at(i * 2, x));
    const p = planReframe(samples, HD.w, HD.h, NINE_SIXTEEN);
    for (const k of p.keyframes) {
      expect(k.rect.left).toBeGreaterThanOrEqual(0);
      expect(k.rect.left + k.rect.width).toBeLessThanOrEqual(HD.w);
      expect(k.rect.width % 2).toBe(0);
    }
  });
});

/* ------------------------------------------------------------------ */

describe('smoothing', () => {
  const at = (t: number, x: number): FaceSample => ({ t, x });

  it('damps jitter within a shot', () => {
    /* Detection noise. Following it exactly is the clearest tell of an
       automated reframe.
     *
     * Measured as TOTAL VARIATION — the distance the crop actually travels,
     * summed frame to frame — not as min-to-max range. Range is the wrong
     * metric and the first version of this test used it: smoothing an
     * alternating signal leaves the extremes where they were and only changes
     * how the crop gets between them, so a correct implementation scored
     * identically to a no-op. Distance travelled is what a viewer sees. */
    const travel = (xs: number[]) =>
      xs.slice(1).reduce((sum, v, i) => sum + Math.abs(v - xs[i]), 0);

    const raw = [0.30, 0.45, 0.30, 0.45, 0.30, 0.45].map((x, i) => at(i * 2, x));
    const p = planReframe(raw, HD.w, HD.h, NINE_SIXTEEN);

    const smoothedTravel = travel(p.keyframes.map((k) => k.rect.left));
    const rawTravel = travel(raw.map((s) => cropRect(HD.w, HD.h, NINE_SIXTEEN, s.x).left));

    expect(smoothedTravel).toBeLessThan(rawTravel / 2);
  });

  it('does NOT smooth across a shot change', () => {
    /* The whip-pan failure. Smoothing across the boundary drags the crop
       toward the next shot before the cut happens, so it is already moving
       when the picture changes.
     *
     * Samples 0,1 sit at 0.20 and samples 2,3 at 0.80. If smoothing leaked
     * across, sample 1 would be pulled well right of 0.20. */
    const raw = [0.20, 0.20, 0.80, 0.80].map((x, i) => at(i * 2, x));
    const p = planReframe(raw, HD.w, HD.h, NINE_SIXTEEN);

    const before = cropRect(HD.w, HD.h, NINE_SIXTEEN, 0.20).left;
    const after = cropRect(HD.w, HD.h, NINE_SIXTEEN, 0.80).left;

    expect(p.keyframes[1].rect.left).toBe(before);
    expect(p.keyframes[2].rect.left).toBe(after);
  });
});

/* ------------------------------------------------------------------ */

describe('the rectangle at a given moment', () => {
  const at = (t: number, x: number): FaceSample => ({ t, x });

  it('holds the single rectangle for a locked plan', () => {
    const p = planReframe([0.4, 0.4, 0.41].map((x, i) => at(i * 2, x)), HD.w, HD.h, NINE_SIXTEEN);
    expect(rectAt(p, 0)).toEqual(p.keyframes[0].rect);
    expect(rectAt(p, 99)).toEqual(p.keyframes[0].rect);
  });

  it('interpolates between keyframes inside a shot', () => {
    /* The travel has to stay UNDER the shot-cut threshold or this is testing
       the cut path instead — 0.2 to 0.8 in one step is 0.6, which is a camera
       change by definition and holds rather than interpolating. Three samples
       moving 0.12 at a time is travel. */
    const p = planReframe(
      [at(0, 0.30), at(5, 0.42), at(10, 0.54)], HD.w, HD.h, NINE_SIXTEEN,
    );
    expect(p.keyframes.some((k) => k.cut)).toBe(false);
    const a = rectAt(p, 0).left;
    const mid = rectAt(p, 7.5).left;
    const b = rectAt(p, 10).left;
    expect(mid).toBeGreaterThan(a);
    expect(mid).toBeLessThan(b);
  });

  it('JUMPS at a cut instead of sweeping into it', () => {
    /* Immediately before the cut the crop must still be where the previous
       shot had it — not part-way across. */
    const p = planReframe(
      [at(0, 0.2), at(2, 0.2), at(4, 0.8), at(6, 0.8)], HD.w, HD.h, NINE_SIXTEEN,
    );
    const cutIdx = p.keyframes.findIndex((k) => k.cut);
    expect(cutIdx).toBeGreaterThan(0);

    const beforeRect = p.keyframes[cutIdx - 1].rect;
    const justBefore = rectAt(p, p.keyframes[cutIdx].t - 0.01);
    expect(justBefore.left).toBe(beforeRect.left);

    const atCut = rectAt(p, p.keyframes[cutIdx].t);
    expect(atCut.left).toBe(p.keyframes[cutIdx].rect.left);
  });

  it('holds the ends rather than extrapolating past them', () => {
    const p = planReframe([at(2, 0.2), at(8, 0.8)], HD.w, HD.h, NINE_SIXTEEN);
    expect(rectAt(p, -5)).toEqual(p.keyframes[0].rect);
    expect(rectAt(p, 500)).toEqual(p.keyframes[p.keyframes.length - 1].rect);
  });

  it('keeps width and height constant across the whole clip', () => {
    /* An encoder is configured once with one frame size. A rectangle that
       drifts a pixel wider between keyframes breaks the encode, and rounding
       on interpolation is exactly how that happens. */
    const p = planReframe(
      [0.2, 0.5, 0.9, 0.3, 0.7].map((x, i) => at(i * 2, x)), HD.w, HD.h, NINE_SIXTEEN,
    );
    const w = p.keyframes[0].rect.width;
    const h = p.keyframes[0].rect.height;
    for (let t = 0; t <= 10; t += 0.37) {
      expect(rectAt(p, t).width).toBe(w);
      expect(rectAt(p, t).height).toBe(h);
    }
  });

  it('survives an empty plan', () => {
    const r = rectAt({ mode: 'centre', keyframes: [], why: '' }, 3);
    expect(Number.isFinite(r.width)).toBe(true);
  });
});

describe('the thresholds are the ones the comments describe', () => {
  it('locks below roughly a head-width of movement', () => {
    expect(LOCK_THRESHOLD).toBeGreaterThan(0.02);
    expect(LOCK_THRESHOLD).toBeLessThan(0.15);
  });

  it('treats a quarter-frame jump as a camera change, not a person', () => {
    expect(SHOT_CUT_JUMP).toBeGreaterThan(LOCK_THRESHOLD * 2);
  });
});


/* ------------------------------------------------------------------ */

describe('content with nobody in it', () => {
  /* Found by cutting a real trading video. Its loudest moments are all screen
     share, and a 9:16 crop of a 640-wide chart keeps 202 pixels of it — the
     axes gone. One clip came back almost entirely blank white, because the
     middle third of that whiteboard was empty. Mechanically perfect, and
     unusable. */

  it('fits rather than crops when no speaker was found', () => {
    const plan = planReframe([], 640, 360, 9 / 16);
    expect(plan.mode).toBe('fit');
    expect(plan.why).toMatch(/nobody on camera/);
  });

  it('keeps the full width of the source', () => {
    const plan = planReframe([], 640, 360, 9 / 16);
    expect(plan.keyframes[0].rect.width).toBe(640);
  });

  it('makes the frame taller instead of narrower', () => {
    /* The frame grows around the content; the content is never cut down to
       the frame. 640 wide at 9:16 is 1138 tall. */
    const plan = planReframe([], 640, 360, 9 / 16);
    const rect = plan.keyframes[0].rect;
    expect(rect.height).toBeGreaterThan(360);
    expect(rect.width / rect.height).toBeCloseTo(9 / 16, 2);
  });

  it('gives H.264 the even dimensions it requires', () => {
    for (const [w, h] of [[641, 361], [1919, 1079], [640, 360]]) {
      const rect = fitRect(w, h, 9 / 16);
      expect(rect.width % 2).toBe(0);
      expect(rect.height % 2).toBe(0);
    }
  });

  it('never returns a frame shorter than the source', () => {
    /* A target WIDER than the source would otherwise crop vertically, which
       is the exact thing fitting exists to avoid. */
    const rect = fitRect(640, 360, 16 / 9);
    expect(rect.height).toBeGreaterThanOrEqual(360);
  });

  it('still crops when there IS somebody to crop around', () => {
    const plan = planReframe([{ t: 0, x: 0.5 }, { t: 5, x: 0.5 }], 640, 360, 9 / 16);
    expect(plan.mode).not.toBe('fit');
    expect(plan.keyframes[0].rect.width).toBeLessThan(640);
  });

  it('can be told to centre-crop instead, for a caller that wants it', () => {
    const plan = planReframe([], 640, 360, 9 / 16, { fitWhenNobody: false });
    expect(plan.mode).toBe('centre');
  });

  it('shrugs at a source with no dimensions', () => {
    expect(fitRect(0, 0, 9 / 16)).toEqual({ left: 0, top: 0, width: 0, height: 0 });
  });
});
