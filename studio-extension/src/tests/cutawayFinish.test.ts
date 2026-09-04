/**
 * Burning the generated cutaways into the clip, after the fact.
 *
 * ── Why there are two encodes ─────────────────────────────────────────────
 *
 * Every other kind on the edit sheet can be drawn from its description. A
 * cutaway cannot: it has to be GENERATED first, and Flow takes minutes over
 * one. The clip is encoded long before any of them exist.
 *
 * So the clip is encoded immediately — the same fast clip as before any of
 * this — and re-encoded once its cutaways land. The second pass reads the
 * SOURCE again rather than the finished clip, so it is a fresh generation
 * rather than an encode of an encode.
 *
 * ── What actually needs guarding ──────────────────────────────────────────
 *
 * Not that a cutaway appears. The failure modes that matter are all about
 * when the second pass runs and what happens when it cannot:
 *
 *   · it must wait for ALL of a clip's cutaways, or it re-encodes once per
 *     cutaway and throws away the previous result each time;
 *   · two cutaways landing in the same tick must not both start an encode;
 *   · every failure must leave the first clip untouched, because that clip is
 *     already good and took minutes.
 */

/// <reference types="node" />

import * as fs from 'fs';
import * as path from 'path';

import { cutawayAt, coverBox, type Cutaway } from '../studio/media/overlay';

const read = (rel: string) =>
  fs.readFileSync(path.resolve(__dirname, rel), 'utf8').replace(/\r\n/g, '\n');

const RUNNER = read('../studio/engine/WorkflowRunner.ts');
const CUT = read('../studio/media/cut.ts');
const DECODE = read('../studio/media/decode.ts');

const finishFn = () =>
  (/private async finishCutIfReady\([\s\S]*?\n  \}/.exec(RUNNER) as RegExpExecArray)[0];

const made = (atSec: number, seconds: number): Cutaway => ({
  atSec, seconds, frameAt: async () => null,
});

describe('when a cutaway is on screen', () => {
  const list = [made(2, 1.8), made(9, 4)];

  it('covers exactly its own window', () => {
    expect(cutawayAt(list, 1.99)).toBeNull();
    expect(cutawayAt(list, 2)).toBe(list[0]);
    expect(cutawayAt(list, 3.79)).toBe(list[0]);
    expect(cutawayAt(list, 3.8)).toBeNull();
    expect(cutawayAt(list, 9.5)).toBe(list[1]);
  });

  it('picks one when two overlap, rather than drawing both', () => {
    /* Two cutaways on the same frame would mean decoding two videos to show
       one of them. The sheet is told not to overlap broll; this is what
       happens when it does anyway. */
    const over = [made(0, 5), made(1, 2)];
    expect(cutawayAt(over, 1.5)).toBe(over[0]);
  });
});

describe('fitting a cutaway to the frame', () => {
  it('covers rather than letterboxes', () => {
    /* A bordered box appearing mid-sentence reads as a mistake, not an edit. */
    const box = coverBox(1920, 1080, 608, 1080);
    expect(box.w).toBeGreaterThanOrEqual(608);
    expect(box.h).toBeGreaterThanOrEqual(1080);
  });

  it('keeps the cutaway undistorted', () => {
    const box = coverBox(1920, 1080, 608, 1080);
    expect(box.w / box.h).toBeCloseTo(1920 / 1080, 4);
  });

  it('centres the overflow', () => {
    const box = coverBox(1920, 1080, 608, 1080);
    expect(box.x + box.w / 2).toBeCloseTo(304, 4);
    expect(box.y + box.h / 2).toBeCloseTo(540, 4);
  });

  it('is a clean fill when the ratio already matches', () => {
    /* The normal case: Flow returns the ratio it was asked for. */
    const box = coverBox(608, 1080, 608, 1080);
    expect(box).toEqual({ x: 0, y: 0, w: 608, h: 1080 });
  });

  it('does not divide by zero on a frame with no dimensions', () => {
    expect(coverBox(0, 0, 608, 1080)).toEqual({ x: 0, y: 0, w: 608, h: 1080 });
  });
});

describe('the second pass runs at the right moment', () => {
  it('waits for every cutaway, not the first', () => {
    /* Finishing on each arrival would encode the clip once per cutaway, each
       encode discarding the one before it. */
    const fn = finishFn();
    expect(fn).toMatch(/if \(ready\.length < owned\.length\) return;/);
  });

  it('claims the clip before it awaits anything', () => {
    /* Two cutaways completing in the same tick would otherwise both pass the
       readiness check and both start an encode of the same clip. */
    const fn = finishFn();
    expect(fn.indexOf('this.finishable.delete(cutId)')).toBeLessThan(fn.indexOf('await '));
  });

  it('is triggered by a cutaway landing, not by the run ending', () => {
    /* So a clip is finished as soon as its own cutaways are in, rather than
       waiting on unrelated nodes still generating. */
    expect(RUNNER).toMatch(/void this\.finishCutIfReady\(nodeData\.brollOwner\)/);
  });

  it('records what a finish needs before the cutaways start generating', () => {
    /* Laying them out is what starts them, and the first to land looks for
       this record. Written after, the fastest cutaway would find nothing. */
    expect(RUNNER.indexOf('this.finishable.set(nodeId'))
      .toBeLessThan(RUNNER.indexOf('const cutaways = this.layOutBroll('));
  });

  it('forgets the clip when no cutaways were laid out', () => {
    /* Otherwise the map holds a source file and a full caption set for the
       rest of the run, for a clip that will never be finished. */
    expect(RUNNER).toMatch(/if \(!cutaways\) \{[\s\S]*?this\.finishable\.delete\(nodeId\);/);
  });
});

describe('when it cannot be done', () => {
  it('leaves the finished clip alone on any failure', () => {
    /* The clip that exists already has its captions, text and push-ins on it
       and took minutes. Nothing here is worth losing it for. */
    const fn = finishFn();
    expect(fn).toMatch(/catch \(e: any\)/);
    expect(fn).toMatch(/could not burn in cutaways/i);
    /* Every early exit is a plain return, never a throw. */
    expect(fn).not.toMatch(/throw /);
  });

  it('gives up quietly when the source is gone', () => {
    /* The bytes live in memory for the life of the tab; a reload loses them
       while the run's record survives. */
    expect(finishFn()).toMatch(/if \(!file\) return;/);
  });

  it('a cutaway that will not decode costs one cutaway, not the clip', () => {
    const fn = /export async function openCutaway\([\s\S]*?\n\}/.exec(DECODE) as RegExpExecArray;
    expect(fn).not.toBeNull();
    expect(fn[0]).toMatch(/return null;/);
    expect(fn[0]).not.toMatch(/throw /);
  });

  it('paints the speaker when a frame cannot be read', () => {
    /* One unreadable frame is one frame of speaker, not a failed encode. */
    expect(CUT).toMatch(/\.catch\(\(\) => paint\(sample, null\)\)/);
  });
});

describe('the hold is the sheet\'s, not Flow\'s', () => {
  it('uses what was asked for rather than what came back', () => {
    /* Omni rounds a 1.8s ask up to 4s. Holding the full four would cover the
       line the cutaway was chosen to illustrate. */
    expect(finishFn()).toMatch(/Number\(d\.brollHoldSec\) \|\| 2/);
  });
});

describe('the cost of the common path is unchanged', () => {
  it('a clip with no cutaways never awaits per frame', () => {
    /* Most clips have none, and most frames of a clip that does are outside
       one. The hook returns a promise only when it has to wait. */
    expect(CUT).toMatch(/if \(!over\) return paint\(sample, null\);/);
  });

  it('the canvas is still only turned on when something needs it', () => {
    expect(CUT).toMatch(/tracked \|\| fitting \|\| captioning \|\| overlaying \|\| cutaways\.length > 0/);
  });

  it('decodes on demand instead of holding every frame in memory', () => {
    /* A two-second cutaway is fifty full-size RGBA frames, and there can be
       several per clip. */
    const fn = /export async function openCutaway\([\s\S]*?\n\}/.exec(DECODE) as RegExpExecArray;
    expect(fn[0]).toMatch(/sink\.getSample\(want\)/);
    expect(fn[0]).not.toMatch(/for \(/);
  });
});
