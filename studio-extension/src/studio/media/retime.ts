/**
 * Speed ramps, and the one thing that makes them different.
 *
 * ── Why this is not another draw ──────────────────────────────────────────
 *
 * text, punch, zoom, broll and sfx all change what a frame looks like or what
 * plays over it. A ramp changes WHEN every later frame happens. Slow half a
 * second to half speed and the clip is half a second longer, which means every
 * caption cue, every text card, every cutaway and every sound after that point
 * is now at the wrong second — and so is the Omni piece plan, which cuts a
 * clip into ten-second pieces and would be measuring the wrong clip.
 *
 * So a ramp is not a renderer, it is a coordinate change, and everything timed
 * against the clip has to go through the same one. That is what this is: a map
 * from source seconds to output seconds, built once, applied to all of them.
 *
 * ── The shape of the map ──────────────────────────────────────────────────
 *
 * Piecewise linear. Slope 1 everywhere except inside a ramp, where it is
 * 1/RAMP_RATE — at half speed the output advances twice as fast as the source,
 * which is the same statement as "this half second now takes a second".
 *
 * Both directions are needed and they are not the same function. Video is
 * pushed forward: a source frame asks where it lands. Audio is pulled
 * backward: an output sample asks what it should contain. Getting these the
 * wrong way round produces a clip that is the right length with the ramp in
 * the wrong place, which looks like a bug in the planner rather than here.
 */

import type { EditOp } from '../clip/editSheet';

/**
 * How far the ramp slows.
 *
 * The sheet says "slow to about half, then snap back", and half is also the
 * number that survives having no frame interpolation: at 0.5 each source frame
 * covers two output frames, which is a clean duplication. At 0.4 it covers
 * two and a half, and the half is a frame held one beat longer than its
 * neighbours — a stutter, on the one move in the whole sheet that exists to
 * look deliberate.
 */
export const RAMP_RATE = 0.5;

export interface Span { from: number; to: number; }

export interface TimeMap {
  /** Where a source second lands in the output. */
  toOutput(t: number): number;
  /** What source second an output second shows. */
  fromOutput(u: number): number;
  /** How long the output runs. */
  outSeconds: number;
  /** How long the source ran. */
  srcSeconds: number;
  /** Nothing is retimed — every lookup is the identity. */
  identity: boolean;
  /** The ramped spans, in SOURCE seconds, merged and ordered. */
  spans: Span[];
}

/** The identity map, for the overwhelmingly common clip with no ramp. */
export function noRetime(seconds: number): TimeMap {
  return {
    toOutput: (t) => t,
    fromOutput: (u) => u,
    outSeconds: seconds,
    srcSeconds: seconds,
    identity: true,
    spans: [],
  };
}

/**
 * Ramp spans from a sheet: clamped to the clip, merged where they touch.
 *
 * Merged because two ramps a tenth of a second apart are not two moments, they
 * are one long one — and left separate they would produce a brief snap back to
 * full speed between them, which reads as a dropped frame rather than as
 * emphasis.
 */
export function rampSpans(
  sheet: readonly EditOp[],
  seconds: number,
  defaultHold = 0.4,
): Span[] {
  const raw: Span[] = [];
  for (const op of sheet) {
    if (op.kind !== 'ramp') continue;
    const hold = typeof op.seconds === 'number' && op.seconds > 0 ? op.seconds : defaultHold;
    const from = Math.max(0, op.atSec);
    const to = Math.min(seconds, from + hold);
    if (to - from > 0.01) raw.push({ from, to });
  }
  raw.sort((a, b) => a.from - b.from);

  const merged: Span[] = [];
  for (const s of raw) {
    const last = merged[merged.length - 1];
    if (last && s.from <= last.to + 0.1) last.to = Math.max(last.to, s.to);
    else merged.push({ ...s });
  }
  return merged;
}

/**
 * The map from a sheet.
 *
 * Returns the identity when there is nothing to ramp, so every caller can hold
 * one of these unconditionally and never branch on whether a clip has one.
 */
export function rampMap(
  sheet: readonly EditOp[] | undefined | null,
  seconds: number,
): TimeMap {
  const spans = rampSpans(sheet || [], seconds);
  if (!spans.length) return noRetime(seconds);

  /* Cumulative output time at the start of each span, so a lookup is a walk
     over at most a handful of segments rather than an integration. */
  const marks: Array<{ from: number; to: number; outFrom: number; outTo: number }> = [];
  let out = 0;
  let cursor = 0;
  for (const s of spans) {
    out += s.from - cursor;
    const outFrom = out;
    out += (s.to - s.from) / RAMP_RATE;
    marks.push({ from: s.from, to: s.to, outFrom, outTo: out });
    cursor = s.to;
  }
  const outSeconds = out + (seconds - cursor);

  const toOutput = (t: number): number => {
    let acc = t;
    for (const m of marks) {
      if (t <= m.from) break;
      /* The whole span, or however much of it has been reached. */
      const inside = Math.min(t, m.to) - m.from;
      acc += inside * (1 / RAMP_RATE - 1);
    }
    return acc;
  };

  const fromOutput = (u: number): number => {
    let src = u;
    for (const m of marks) {
      if (u <= m.outFrom) break;
      const insideOut = Math.min(u, m.outTo) - m.outFrom;
      src -= insideOut * (1 - RAMP_RATE);
    }
    return src;
  };

  return { toOutput, fromOutput, outSeconds, srcSeconds: seconds, identity: false, spans };
}

/** True while a source second is inside a ramp. */
export function inRamp(map: TimeMap, t: number): boolean {
  return map.spans.some((s) => t >= s.from && t < s.to);
}

/* ────────────────────────────────────────────────────────────────────────
   Moving everything else onto the new clock
   ──────────────────────────────────────────────────────────────────────── */

/**
 * Cues, ops and cutaways all carry seconds against the clip, and every one of
 * them has to move. These are separate functions rather than one generic
 * because the fields differ and a wrong field name would silently leave a
 * caption on the old clock — which is the failure mode this whole file exists
 * to prevent, so it should not be possible to write by accident.
 */

/** Caption cues, onto the output clock. */
export function retimeCues<T extends { startSec: number; endSec: number }>(
  cues: readonly T[],
  map: TimeMap,
): T[] {
  if (map.identity) return cues as T[];
  return cues.map((c) => ({
    ...c,
    startSec: map.toOutput(c.startSec),
    endSec: map.toOutput(c.endSec),
    /* Word timings drive the highlighting, so they move too — a caption whose
       line is right and whose words are a beat late is worse than one with no
       highlighting at all. */
    ...(Array.isArray((c as any).words)
      ? {
        words: (c as any).words.map((w: any) => ({
          ...w,
          startSec: map.toOutput(w.startSec),
          endSec: map.toOutput(w.endSec),
        })),
      }
      : {}),
  }));
}

/** Sheet ops, onto the output clock. */
export function retimeOps<T extends { atSec: number; seconds?: number }>(
  ops: readonly T[],
  map: TimeMap,
): T[] {
  if (map.identity) return ops as T[];
  return ops.map((o) => {
    const from = map.toOutput(o.atSec);
    const hold = typeof o.seconds === 'number' && o.seconds > 0
      ? map.toOutput(o.atSec + o.seconds) - from
      : o.seconds;
    return { ...o, atSec: from, ...(typeof hold === 'number' ? { seconds: hold } : {}) };
  });
}

/**
 * Cutaways, onto the output clock.
 *
 * A cutaway that overlaps a ramp gets longer, because the moment it covers
 * does. Its own footage is not slowed — it is a separate video with its own
 * clock, and stretching it too would be slowing something that was never part
 * of the shot.
 */
export function retimeCutaways<T extends { atSec: number; seconds: number }>(
  cutaways: readonly T[],
  map: TimeMap,
): T[] {
  if (map.identity) return cutaways as T[];
  return cutaways.map((c) => {
    const from = map.toOutput(c.atSec);
    return { ...c, atSec: from, seconds: map.toOutput(c.atSec + c.seconds) - from };
  });
}
