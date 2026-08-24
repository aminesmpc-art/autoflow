/**
 * Turning a landscape source into a vertical clip that follows the speaker.
 *
 * A podcast is 16:9 and a Short is 9:16, so something has to decide which
 * slice of each frame survives. This file decides it. Nothing here decodes or
 * draws — it takes a handful of observed speaker positions and produces the
 * crop rectangle for any moment, which the encoder then applies.
 *
 * ── The three failures this is shaped around ──────────────────────────────
 *
 * 1. JITTER. Detection is noisy. A crop that follows every wobble reads as a
 *    camera operator with a tremor, and it is the single clearest tell of an
 *    automated reframe.
 *
 * 2. DRIFT ON A LOCKED SHOT. Most podcast footage is one fixed camera and a
 *    person who barely moves. A crop that creeps a few pixels a second across
 *    that looks like a bug, not like production value. When the speaker does
 *    not move, the correct amount of movement is none.
 *
 * 3. PANNING ACROSS A CUT. When the source cuts between cameras the subject
 *    can jump the width of the frame. Gliding the crop across that boundary
 *    produces a whip-pan that exists nowhere in the source and looks worse
 *    than doing nothing. At a cut, the crop must cut too.
 *
 * The default is deliberately conservative: given nothing to work with, centre
 * the crop and leave it there. A wrong static crop is a clip someone can still
 * post; a wrong moving crop is not.
 */

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** One observation of where the speaker is, from a sampled frame. */
export interface FaceSample {
  /** Seconds from the start of the clip. */
  t: number;
  /** Horizontal centre of the face, 0..1 across the frame. */
  x: number;
  /** Vertical centre, 0..1. Optional — most sources need no vertical move. */
  y?: number;
}

export type ReframeMode = 'centre' | 'locked' | 'tracked' | 'fit';

export interface ReframePlan {
  mode: ReframeMode;
  /** Crop at each keyframe time. Between them, interpolate; at cuts, jump. */
  keyframes: Array<{ t: number; rect: Rect; cut: boolean }>;
  /** Plain words for the node's report. */
  why: string;
}

/**
 * How little the speaker can move before the crop stops following them.
 *
 * Six percent of frame width is roughly a head-width on a typical mid shot.
 * Below that the movement is posture, not travel, and following it is the
 * drift failure above.
 */
export const LOCK_THRESHOLD = 0.06;

/**
 * A jump this large between two adjacent samples is a shot change.
 *
 * People do not cross a quarter of the frame in the gap between samples;
 * cameras do. Treated as a cut, so the crop jumps rather than sweeping.
 */
export const SHOT_CUT_JUMP = 0.25;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/**
 * Round to an even number, staying at least 2.
 *
 * H.264 will not accept odd dimensions — encoder configuration fails outright
 * with a width of 607. It is the kind of detail that costs an afternoon the
 * first time, so it lives in one place.
 */
const even = (n: number): number => Math.max(2, Math.round(n / 2) * 2);

/**
 * The crop rectangle for a given subject position.
 *
 * `targetAspect` is width/height — 9/16 for a Short. Whichever dimension has
 * to shrink is worked out from the source's own aspect, so a source that is
 * already vertical is cropped in height (or not at all) rather than being
 * squeezed sideways.
 */
/**
 * The output frame for content with nobody in it.
 *
 * Cropping assumes there is a subject to keep and background to discard. On a
 * screen recording that assumption is false and the result is indefensible: a
 * 9:16 crop of a 640-wide chart keeps 202 pixels of it, and on a sparse
 * whiteboard the clip that came back was almost entirely blank white. Tested
 * on a real trading video, where the loudest moments are all screen share.
 *
 * So the whole frame is kept at its own width and the FRAME grows instead —
 * nothing is thrown away, and the source is never upscaled.
 */
export function fitRect(
  srcWidth: number,
  srcHeight: number,
  targetAspect: number,
): Rect {
  if (!(srcWidth > 0) || !(srcHeight > 0) || !(targetAspect > 0)) {
    return { left: 0, top: 0, width: 0, height: 0 };
  }
  const width = even(srcWidth);
  /* Never shorter than the source: a target WIDER than the source would
     otherwise produce a frame that crops vertically, which is the very thing
     this exists to avoid. */
  const height = even(Math.max(srcHeight, width / targetAspect));
  return { left: 0, top: 0, width, height };
}

export function cropRect(
  srcWidth: number,
  srcHeight: number,
  targetAspect: number,
  centreX = 0.5,
  centreY = 0.5,
): Rect {
  if (!(srcWidth > 0) || !(srcHeight > 0) || !(targetAspect > 0)) {
    return { left: 0, top: 0, width: 0, height: 0 };
  }

  const srcAspect = srcWidth / srcHeight;
  let width: number;
  let height: number;

  if (srcAspect > targetAspect) {
    /* Source is wider than the target — take a full-height column. */
    height = srcHeight;
    width = srcHeight * targetAspect;
  } else {
    /* Source is already as narrow or narrower — take a full-width band. */
    width = srcWidth;
    height = srcWidth / targetAspect;
  }

  width = Math.min(even(width), even(srcWidth));
  height = Math.min(even(height), even(srcHeight));

  /* Clamped so the crop never leaves the frame. A speaker standing at the
     very edge pulls the window to the edge and stops there — the alternative
     is a rectangle partly outside the picture, which encodes as black bars
     down one side. */
  const left = Math.round(
    Math.min(Math.max(clamp01(centreX) * srcWidth - width / 2, 0), srcWidth - width),
  );
  const top = Math.round(
    Math.min(Math.max(clamp01(centreY) * srcHeight - height / 2, 0), srcHeight - height),
  );

  return { left, top, width, height };
}

/**
 * Median-of-three over the positions, to remove single bad detections.
 *
 * Found by a failing test. One frame where the detector locked onto a face on
 * a poster produces a lone excursion — and a lone excursion looks like TWO
 * shot changes to a naive jump test: one leaving the real position and one
 * coming back. A whole clip then goes into tracking mode, and the crop lurches
 * to the poster and back, because of a single frame.
 *
 * A median cannot be moved by one outlier, and it leaves a genuine cut intact:
 * a real camera change is sustained across the samples after it, so the median
 * follows it. Same technique as the impulse rejection in silence.ts, for the
 * same reason.
 */
function medianFilter3(xs: number[]): number[] {
  if (xs.length < 3) return xs.slice();
  return xs.map((_, i) => {
    const a = xs[Math.max(0, i - 1)];
    const b = xs[i];
    const c = xs[Math.min(xs.length - 1, i + 1)];
    return Math.max(Math.min(a, b), Math.min(Math.max(a, b), c));
  });
}

/** Mark the positions where the subject jumped far enough to be a shot change. */
function markCuts(xs: number[]): boolean[] {
  const cuts = xs.map(() => false);
  for (let i = 1; i < xs.length; i++) {
    if (Math.abs(xs[i] - xs[i - 1]) >= SHOT_CUT_JUMP) cuts[i] = true;
  }
  return cuts;
}

/**
 * Moving average within each shot, never across a cut.
 *
 * Smoothing across a shot boundary is exactly the whip-pan failure: it takes a
 * legitimate jump and spreads it over the surrounding samples, so the crop
 * starts drifting before the cut happens and arrives late afterwards.
 */
function smoothWithinShots(values: number[], cuts: boolean[]): number[] {
  const out = values.slice();
  let segStart = 0;

  const smoothSegment = (from: number, to: number) => {
    const seg = values.slice(from, to);
    for (let i = 0; i < seg.length; i++) {
      const a = seg[Math.max(0, i - 1)];
      const b = seg[i];
      const c = seg[Math.min(seg.length - 1, i + 1)];
      out[from + i] = (a + b + c) / 3;
    }
  };

  for (let i = 1; i <= values.length; i++) {
    if (i === values.length || cuts[i]) {
      smoothSegment(segStart, i);
      segStart = i;
    }
  }
  return out;
}

const median = (xs: number[]): number => {
  if (!xs.length) return 0.5;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export interface PlanOptions {
  /* Whether content with nobody in it is fitted rather than cropped.
     On by default. Turned off only where a caller genuinely wants a centre
     crop of a screen recording, which is a choice nobody has yet wanted. */
  fitWhenNobody?: boolean;
  /** Below this spread, the crop is locked. Defaults to LOCK_THRESHOLD. */
  lockThreshold?: number;
}

/**
 * Decide how the crop should behave across the clip.
 *
 * The order matters: the cheapest, safest answer is preferred at every step.
 * No samples means centre; barely any movement means lock; only genuine travel
 * earns a moving crop.
 */
export function planReframe(
  samples: FaceSample[],
  srcWidth: number,
  srcHeight: number,
  targetAspect: number,
  options: PlanOptions = {},
): ReframePlan {
  const lockThreshold = options.lockThreshold ?? LOCK_THRESHOLD;
  const centreRect = cropRect(srcWidth, srcHeight, targetAspect, 0.5, 0.5);

  const usable = [...samples]
    .filter((s) => Number.isFinite(s.t) && Number.isFinite(s.x))
    .sort((a, b) => a.t - b.t);

  if (!usable.length) {
    /* Nobody on camera. Cropping would keep the middle third of whatever is
       there — a chart with its axes gone, or a whiteboard's blank centre —
       so the whole frame is kept and the frame is made taller around it. */
    if (options.fitWhenNobody !== false) {
      const rect = fitRect(srcWidth, srcHeight, targetAspect);
      return {
        mode: 'fit',
        keyframes: [{ t: 0, rect, cut: false }],
        why: 'nobody on camera — the whole frame is kept, on a blurred backdrop',
      };
    }
    return {
      mode: 'centre',
      keyframes: [{ t: 0, rect: centreRect, cut: false }],
      why: 'no speaker positions available — the crop is centred and static',
    };
  }

  /* Filtered before anything looks at it, so one bad detection cannot become
     a shot change, a spread, or a lock decision. */
  const xs = medianFilter3(usable.map((s) => s.x));
  const cuts = markCuts(xs);
  const hasCut = cuts.some(Boolean);

  /* Spread, measured as the range across the middle of the distribution
     rather than min-to-max. One bad detection at the frame edge should not
     force a whole clip into tracking mode. */
  const sorted = [...xs].sort((a, b) => a - b);
  const lo = sorted[Math.floor(sorted.length * 0.1)];
  const hi = sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.9))];
  const spread = hi - lo;

  if (!hasCut && spread < lockThreshold) {
    const x = median(xs);
    return {
      mode: 'locked',
      keyframes: [{ t: 0, rect: cropRect(srcWidth, srcHeight, targetAspect, x, 0.5), cut: false }],
      why: `speaker moved ${(spread * 100).toFixed(0)}% of frame width — crop locked at `
        + `x=${x.toFixed(2)}`,
    };
  }

  const smoothed = smoothWithinShots(xs, cuts);
  const keyframes = usable.map((s, i) => ({
    t: s.t,
    rect: cropRect(srcWidth, srcHeight, targetAspect, smoothed[i], s.y ?? 0.5),
    cut: cuts[i],
  }));

  return {
    mode: 'tracked',
    keyframes,
    why: `speaker moved ${(spread * 100).toFixed(0)}% of frame width across `
      + `${usable.length} samples${hasCut ? `, with ${cuts.filter(Boolean).length} shot change(s)` : ''}`,
  };
}

const lerp = (a: number, b: number, f: number) => a + (b - a) * f;

/**
 * The crop rectangle at a given moment.
 *
 * Interpolates between keyframes so the crop moves smoothly, EXCEPT into a
 * keyframe marked as a cut, where it holds the previous rectangle until the
 * cut lands and then switches. That is what makes a camera change read as a
 * camera change rather than as a pan.
 */
export function rectAt(plan: ReframePlan, t: number): Rect {
  const ks = plan.keyframes;
  if (!ks.length) return { left: 0, top: 0, width: 0, height: 0 };
  if (ks.length === 1 || t <= ks[0].t) return ks[0].rect;
  if (t >= ks[ks.length - 1].t) return ks[ks.length - 1].rect;

  for (let i = 1; i < ks.length; i++) {
    if (t > ks[i].t) continue;
    const prev = ks[i - 1];
    const next = ks[i];

    /* Hold, then switch ON the cut, not after it.
       Interpolating into a cut spreads the jump across the seconds before it,
       which is the whip-pan — but returning the previous rectangle AT the cut
       time leaves the crop one keyframe behind for the whole shot that
       follows, which is worse and was the original bug here. */
    if (next.cut) return t >= next.t ? next.rect : prev.rect;

    const span = next.t - prev.t;
    const f = span > 0 ? (t - prev.t) / span : 0;
    return {
      left: Math.round(lerp(prev.rect.left, next.rect.left, f)),
      top: Math.round(lerp(prev.rect.top, next.rect.top, f)),
      /* Width and height are constant across a plan — taken from the
         keyframe rather than interpolated, so rounding cannot make a frame
         one pixel wider than its neighbour and break the encoder. */
      width: next.rect.width,
      height: next.rect.height,
    };
  }
  return ks[ks.length - 1].rect;
}
