/// <reference types="node" />

/**
 * Motion pieces go to Flow at 1080 on the short side, not the source's 4K.
 *
 * 2026-10-01: a 4K phone clip was cut into 4K pieces — "Uploaded video · 4K ·
 * 5s" — for a generation Flow makes at 720p. Every piece paid for that twice:
 * several times the bytes to upload, and a processing wait long enough that
 * the upload check gave up on it and the run stopped.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { shrinkToShortSide } from '../studio/media/shortSide';
import { MOTION_CUT_SHORT_SIDE } from '../studio/ask/motionControl';

const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');

describe('the size a piece is cut at', () => {
  it('takes a 4K portrait clip to 1080x1920', () => {
    expect(shrinkToShortSide(2160, 3840, 1080)).toEqual({ width: 1080, height: 1920 });
  });

  it('and a 4K landscape one to 1920x1080', () => {
    expect(shrinkToShortSide(3840, 2160, 1080)).toEqual({ width: 1920, height: 1080 });
  });

  it('leaves 1080p and anything smaller alone — it never scales up', () => {
    expect(shrinkToShortSide(1080, 1920, 1080)).toBeNull();
    expect(shrinkToShortSide(720, 1280, 1080)).toBeNull();
  });

  it('keeps both sides even, which the encoder needs, and the shape', () => {
    const size = shrinkToShortSide(2161, 3841, 1080)!;
    expect(size.width % 2).toBe(0);
    expect(size.height % 2).toBe(0);
    expect(Math.abs(size.width / size.height - 2161 / 3841)).toBeLessThan(0.01);
  });

  it('does nothing with a size it cannot read', () => {
    expect(shrinkToShortSide(0, 0, 1080)).toBeNull();
    expect(shrinkToShortSide(2160, 3840, 0)).toBeNull();
  });
});

describe('who gets it', () => {
  const CUT = read('studio/media/cut.ts');
  const RUNNER = read('studio/engine/WorkflowRunner.ts');
  const at = RUNNER.indexOf('private async executeMotionNode');
  const motion = RUNNER.slice(at, RUNNER.indexOf('private async askAgent(', at));

  it('only a plain cut — a reframe or a canvas sets its own size', () => {
    expect(CUT).toMatch(/const shrink = !plan && !drawing && options\.maxShortSide/);
  });

  it('is handed to the encoder, and said in the report', () => {
    expect(CUT).toMatch(/\.\.\.\(shrink \? \{ width: shrink\.width, height: shrink\.height, fit: 'fill' as const \} : \{\}\)/);
    expect(CUT).toMatch(/scaled from \$\{outWidth\}x\$\{outHeight\} to \$\{shrink\.width\}x\$\{shrink\.height\}/);
  });

  it('every Motion cut asks for 1080, the silent re-cut included', () => {
    expect(MOTION_CUT_SHORT_SIDE).toBe(1080);
    const cuts = motion.match(/clipMedia\.cut\(/g) || [];
    expect(cuts.length).toBeGreaterThan(0);
    expect(motion.match(/maxShortSide: MOTION_CUT_SHORT_SIDE/g) || []).toHaveLength(cuts.length);
  });
});
