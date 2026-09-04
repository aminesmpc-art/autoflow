/**
 * Burning the drawable half of the edit sheet onto the clip.
 *
 * editSheet.ts plans eight kinds and says plainly that it is not a compositor.
 * Three of those eight are drawing problems and five are not: broll needs a
 * second decoder, sfx needs an audio mixdown, and ramp, intro and outro change
 * the clip's DURATION rather than its pixels. So overlay.ts renders text,
 * punch and zoom, and the rest stay on the node for CapCut.
 *
 * The thing worth testing hardest is not that a card appears. It is that:
 *
 *   · nothing is rendered that cannot be rendered, and nothing is silently
 *     dropped either — an unrenderable kind must still reach the node;
 *   · a clip with a sheet of only sound effects does not pay for the canvas;
 *   · ops rebase correctly per Omni piece, because a card planned for the
 *     middle of a four-part clip would otherwise be drawn on all four.
 */

/// <reference types="node" />

import * as fs from 'fs';
import * as path from 'path';

import {
  opsAt, holdOf, framingAt, tighten, textAlphaAt, wrapText, drawTextOp,
  sheetDraws, DRAWN_KINDS, type DrawTarget,
} from '../studio/media/overlay';
import { opsForChunk } from '../studio/clip/omniChunks';
import { EDIT_KINDS, type EditOp } from '../studio/clip/editSheet';

const CUT = fs.readFileSync(
  path.resolve(__dirname, '../studio/media/cut.ts'), 'utf8',
).replace(/\r\n/g, '\n');

const RUN = fs.readFileSync(
  path.resolve(__dirname, '../studio/clip/runClip.ts'), 'utf8',
).replace(/\r\n/g, '\n');

const op = (o: Partial<EditOp>): EditOp => ({
  atSec: 0, kind: 'text', what: 'x', why: 'y', ...o,
} as EditOp);

describe('which ops are live', () => {
  const sheet = [
    op({ atSec: 1, seconds: 2, kind: 'text', what: '$5,000' }),
    op({ atSec: 6, seconds: 1, kind: 'punch' }),
  ];

  it('includes an op at its first instant and excludes it at its last', () => {
    /* Half-open, like every other window in this pipeline. Inclusive on both
       ends would draw two cards on the frame where one ends and another
       begins. */
    expect(opsAt(sheet, 1.0, ['text'])).toHaveLength(1);
    expect(opsAt(sheet, 2.99, ['text'])).toHaveLength(1);
    expect(opsAt(sheet, 3.0, ['text'])).toHaveLength(0);
    expect(opsAt(sheet, 0.99, ['text'])).toHaveLength(0);
  });

  it('filters by kind, so a punch is never asked to draw text', () => {
    expect(opsAt(sheet, 6.5, ['text'])).toHaveLength(0);
    expect(opsAt(sheet, 6.5, ['punch'])).toHaveLength(1);
  });

  it('gives a drawable op with no duration a real one', () => {
    /* A card that exists for a single frame is worse than no card, and much
       harder to work out from the output. */
    expect(holdOf(op({ atSec: 0 }))).toBeGreaterThan(1);
    expect(holdOf(op({ atSec: 0, seconds: 0 }))).toBeGreaterThan(1);
    expect(holdOf(op({ atSec: 0, seconds: 2.5 }))).toBe(2.5);
  });
});

describe('the framing', () => {
  it('is untouched when nothing asks for a push', () => {
    expect(framingAt([], 5)).toBe(1);
    expect(framingAt([op({ atSec: 0, seconds: 2, kind: 'sfx' })], 1)).toBe(1);
  });

  it('arrives over time rather than jumping', () => {
    /* A single-frame jump to a tighter frame reads as a dropped frame — the
       eye calls it a glitch, which is the opposite of emphasis. */
    const s = [op({ atSec: 2, seconds: 3, kind: 'punch' })];
    const atStart = framingAt(s, 2.0);
    const midEase = framingAt(s, 2.11);
    const settled = framingAt(s, 2.6);
    expect(atStart).toBeCloseTo(1, 3);
    expect(midEase).toBeLessThan(atStart);
    expect(settled).toBeLessThan(midEase);
  });

  it('holds a punch for the rest of its window', () => {
    const s = [op({ atSec: 0, seconds: 4, kind: 'punch' })];
    expect(framingAt(s, 1.5)).toBeCloseTo(framingAt(s, 3.5), 4);
  });

  it('takes a zoom back out again, because it is momentary', () => {
    const s = [op({ atSec: 1, seconds: 0.4, kind: 'zoom' })];
    const peak = framingAt(s, 1.2);
    expect(peak).toBeLessThan(1);
    expect(framingAt(s, 1.0)).toBeGreaterThan(peak);
    expect(framingAt(s, 1.39)).toBeGreaterThan(peak);
    expect(framingAt(s, 1.41)).toBe(1);
  });

  it('takes the tightest when two overlap, never the product', () => {
    /* Multiplying would compound a punch and a zoom into a much harder push
       than either asked for, and the planner writes them without knowing
       they collide. */
    const s = [
      op({ atSec: 0, seconds: 4, kind: 'punch' }),
      op({ atSec: 1, seconds: 1, kind: 'zoom' }),
    ];
    const both = framingAt(s, 1.5);
    const punchAlone = framingAt([s[0]], 1.5);
    expect(both).toBeLessThanOrEqual(punchAlone);
    expect(both).toBeGreaterThan(punchAlone * 0.95);
  });

  it('never pushes so far the picture would visibly soften', () => {
    /* The source rect is scaled DOWN to fill the same output, so the picture
       is upsampled by 1/scale. Past about 1.2x that starts to show. */
    const s = [
      op({ atSec: 0, seconds: 9, kind: 'punch' }),
      op({ atSec: 0, seconds: 9, kind: 'zoom' }),
    ];
    for (let t = 0; t < 9; t += 0.25) {
      expect(1 / framingAt(s, t)).toBeLessThan(1.2);
    }
  });
});

describe('tightening a rectangle', () => {
  const r = { left: 100, top: 50, width: 400, height: 720 };

  it('keeps the same centre, so a tracked crop stays on the speaker', () => {
    const t = tighten(r, 0.5);
    expect(t.left + t.width / 2).toBeCloseTo(r.left + r.width / 2, 6);
    expect(t.top + t.height / 2).toBeCloseTo(r.top + r.height / 2, 6);
  });

  it('keeps the aspect ratio, so the output shape never changes', () => {
    /* The encoder is configured once. A frame that arrives a different shape
       is a hard failure partway through a run. */
    const t = tighten(r, 0.7);
    expect(t.width / t.height).toBeCloseTo(r.width / r.height, 6);
  });

  it('stays inside the source it came from', () => {
    const t = tighten(r, 0.6);
    expect(t.left).toBeGreaterThanOrEqual(r.left);
    expect(t.top).toBeGreaterThanOrEqual(r.top);
    expect(t.left + t.width).toBeLessThanOrEqual(r.left + r.width);
  });

  it('is a no-op at scale 1, so an unpushed frame is not resampled', () => {
    expect(tighten(r, 1)).toBe(r);
  });
});

describe('a text card', () => {
  it('fades in and out rather than appearing between frames', () => {
    const o = op({ atSec: 2, seconds: 2 });
    expect(textAlphaAt(o, 1.99)).toBe(0);
    expect(textAlphaAt(o, 2.0)).toBeCloseTo(0, 2);
    expect(textAlphaAt(o, 2.09)).toBeGreaterThan(0);
    expect(textAlphaAt(o, 3.0)).toBe(1);
    expect(textAlphaAt(o, 3.95)).toBeLessThan(1);
    expect(textAlphaAt(o, 4.0)).toBe(0);
  });

  it('still fades on a card too short for two full fades', () => {
    /* The fades would otherwise overlap and drive alpha above 1 or below 0. */
    const o = op({ atSec: 0, seconds: 0.2 });
    for (let t = 0; t < 0.2; t += 0.02) {
      const a = textAlphaAt(o, t);
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThanOrEqual(1);
    }
  });

  it('wraps to as few lines as fit', () => {
    const measure = (s: string) => s.length * 10;
    expect(wrapText(measure, 'one two three four', 100)).toEqual(['one two', 'three four']);
    expect(wrapText(measure, 'short', 1000)).toEqual(['short']);
    expect(wrapText(measure, '   ', 100)).toEqual([]);
  });

  it('strokes before it fills, so it survives a cut to a white shirt', () => {
    const calls: string[] = [];
    const ctx = stubCtx(calls);
    drawTextOp(ctx, op({ atSec: 0, seconds: 2, what: '64M views' }), 1080, 1920, 1);
    const stroke = calls.indexOf('strokeText:64M views');
    const fill = calls.indexOf('fillText:64M views');
    expect(stroke).toBeGreaterThan(-1);
    expect(fill).toBeGreaterThan(stroke);
  });

  it('draws nothing at all when the card is not up', () => {
    const calls: string[] = [];
    drawTextOp(stubCtx(calls), op({ atSec: 5, seconds: 1 }), 1080, 1920, 1);
    expect(calls.filter((c) => c.startsWith('fillText'))).toHaveLength(0);
  });

  it('draws nothing for an op with no words', () => {
    const calls: string[] = [];
    drawTextOp(stubCtx(calls), op({ atSec: 0, seconds: 2, what: '  ' }), 1080, 1920, 1);
    expect(calls.filter((c) => c.startsWith('fillText'))).toHaveLength(0);
  });

  it('sits clear of the captions below it', () => {
    /* Captions default to 0.72 of the frame and the platforms paint their own
       furniture over the lower fifth. A card that drifted down into either is
       a card nobody reads. */
    const ys: number[] = [];
    const ctx = stubCtx([], (y) => ys.push(y));
    drawTextOp(ctx, op({ atSec: 0, seconds: 2, what: 'a much longer card that has to wrap onto lines' }), 1080, 1920, 1);
    expect(Math.max(...ys)).toBeLessThan(1920 * 0.6);
  });
});

describe('what the sheet is allowed to render', () => {
  it('renders exactly three of the eight kinds', () => {
    expect([...DRAWN_KINDS].sort()).toEqual(['punch', 'text', 'zoom']);
  });

  it('leaves the five that are not drawing problems alone', () => {
    const undrawn = EDIT_KINDS.filter((k) => !(DRAWN_KINDS as readonly string[]).includes(k));
    expect(undrawn.sort()).toEqual(['broll', 'intro', 'outro', 'ramp', 'sfx']);
  });

  it('does not turn the canvas on for a sheet it cannot draw', () => {
    /* A clip whose sheet is only sound effects must take mediabunny's cheap
       straight-through route, exactly as it did before any of this. */
    expect(sheetDraws([op({ atSec: 1, kind: 'sfx', what: 'impact' })])).toBe(false);
    expect(sheetDraws([op({ atSec: 1, kind: 'ramp' })])).toBe(false);
    expect(sheetDraws([])).toBe(false);
    expect(sheetDraws(undefined)).toBe(false);
    expect(sheetDraws([op({ atSec: 1, kind: 'text', what: 'hi' })])).toBe(true);
  });
});

describe('rebasing onto an Omni piece', () => {
  const sheet = [
    op({ atSec: 1, seconds: 2, what: 'first' }),
    op({ atSec: 12, seconds: 1.5, what: 'middle' }),
  ];

  it('shifts an op into the piece it belongs to', () => {
    const got = opsForChunk(sheet, { startSec: 9, endSec: 18 });
    expect(got).toHaveLength(1);
    expect(got[0].atSec).toBe(3);
  });

  it('keeps a card that spans a join on both sides of it', () => {
    /* Dropping it at the seam would blink the card off mid-word. Its start
       goes negative on the far side on purpose — that half is mid-card, and
       clamping to zero would restart the fade-in. */
    const spanning = [op({ atSec: 8, seconds: 3, what: 'across' })];
    const before = opsForChunk(spanning, { startSec: 0, endSec: 9 });
    const after = opsForChunk(spanning, { startSec: 9, endSec: 18 });
    expect(before).toHaveLength(1);
    expect(after).toHaveLength(1);
    expect(after[0].atSec).toBeLessThan(0);
  });

  it('leaves out an op that belongs to another piece entirely', () => {
    expect(opsForChunk(sheet, { startSec: 20, endSec: 28 })).toHaveLength(0);
  });
});

describe('the wiring, in the code that ships', () => {
  it('cut.ts turns the canvas on for a drawable sheet', () => {
    expect(CUT).toMatch(/const overlaying = sheetDraws\(sheet\);/);
    expect(CUT).toMatch(/tracked \|\| fitting \|\| captioning \|\| overlaying/);
  });

  it('the push is applied on every one of the three draw paths', () => {
    /* Fit, reframe and pass-through. Miss one and a punch silently does
       nothing for whichever kind of source takes that path. */
    expect((CUT.match(/tighten\(/g) || []).length).toBeGreaterThanOrEqual(3);
  });

  it('cards are drawn after the captions, never under one', () => {
    expect(CUT.indexOf('drawTextOp(')).toBeGreaterThan(CUT.indexOf('drawCaption('));
  });

  it('the sheet is planned before the encode it is burned into', () => {
    /* It used to be planned afterwards, deliberately, so a failed ask could
       never cost the clip. That property is kept — planTheEdit is soft and
       the encode runs either way — but a plan that arrives after the pixels
       cannot be drawn on them. */
    expect(RUN.indexOf('planTheEdit(')).toBeLessThan(RUN.indexOf('await deps.media.cut(file, {'));
  });

  it('each Omni piece gets the sheet rebased, not the clip\'s', () => {
    expect(RUN).toMatch(/editSheet: editSheet \? opsForChunk\(editSheet, piece\) : undefined/);
  });
});

/* A 2D context that records what it was asked to draw. */
function stubCtx(calls: string[], onY?: (y: number) => void): DrawTarget {
  return {
    save() {}, restore() {},
    measureText: (t: string) => ({ width: t.length * 18 }),
    fillText(t: string, _x: number, y: number) { calls.push(`fillText:${t}`); onY?.(y); },
    strokeText(t: string, _x: number, y: number) { calls.push(`strokeText:${t}`); onY?.(y); },
    font: '', fillStyle: '', strokeStyle: '', lineWidth: 0,
    lineJoin: 'round' as CanvasLineJoin,
    textAlign: 'center' as CanvasTextAlign,
    textBaseline: 'middle' as CanvasTextBaseline,
    globalAlpha: 1,
  };
}
