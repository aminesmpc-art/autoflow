/**
 * New nodes never stack.
 *
 * Every add from the library was `{ x: fixed, y: fixed + nodes.length * 50 }`
 * — a 50px step for nodes 200-380px tall. Measured in the canvas harness: a
 * second Flow clip landed at y+50 over a 376px node, a Prompt sat on the Image
 * above it, and the covered node's ports could not be reached. A 1-star review
 * put it as "nodes don't properly connect".
 */

/// <reference types="node" />

import { readFileSync } from 'fs';
import { join } from 'path';
import { boxOf, freeSpot, sizeOf, type Box } from '../studio/canvas/placement';

const overlap = (a: Box, b: Box) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe('freeSpot', () => {
  it('keeps the node where it asked to be on an empty canvas', () => {
    expect(freeSpot({ x: 200, y: 100 }, sizeOf('generate'), [])).toEqual({ x: 200, y: 100 });
  });

  it('never lands on a node already there', () => {
    const first: Box = { x: 200, y: 100, ...{ w: 300, h: 380 } };
    const spot = freeSpot({ x: 200, y: 100 }, sizeOf('generate'), [first]);
    expect(overlap({ ...spot, w: 300, h: 380 }, first)).toBe(false);
  });

  it('adds ten clips in a row with no two overlapping', () => {
    const taken: Box[] = [];
    for (let i = 0; i < 10; i++) {
      const size = sizeOf('generate');
      const spot = freeSpot({ x: 400, y: 200 }, size, taken);
      const box = { ...spot, w: size.w, h: size.h };
      for (const t of taken) expect(overlap(box, t)).toBe(false);
      taken.push(box);
    }
  });

  it('stays near the anchor rather than jumping across the canvas', () => {
    const first: Box = { x: 0, y: 0, w: 300, h: 380 };
    const spot = freeSpot({ x: 0, y: 0 }, sizeOf('generate'), [first]);
    expect(Math.hypot(spot.x, spot.y)).toBeLessThan(600);
  });

  it('uses the size React Flow measured when there is one', () => {
    expect(boxOf({ position: { x: 1, y: 2 }, type: 'generate', measured: { width: 512, height: 640 } }))
      .toEqual({ x: 1, y: 2, w: 512, h: 640 });
    expect(boxOf({ position: { x: 1, y: 2 }, type: 'prompt' })).toEqual({ x: 1, y: 2, ...{ w: 270, h: 200 } });
  });
});

describe('the canvas uses it', () => {
  const CANVAS = readFileSync(join(__dirname, '..', 'studio', 'components', 'Canvas.tsx'), 'utf8');

  it('has no stepped positions left', () => {
    expect(CANVAS).not.toMatch(/nodes\.length \* 50/);
  });

  it('places every library add through place()', () => {
    expect((CANVAS.match(/position: place\('\w+'\),/g) || []).length).toBeGreaterThanOrEqual(12);
  });
});
