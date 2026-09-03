/**
 * Where a clip made from two stills gets drawn.
 *
 * Reported with a screenshot of a canvas that was correct and unreadable — a
 * six-still, five-clip construction pipeline where the five clips sat in a
 * column on the far left, the six stills in a column to their right, and ten
 * dashed edges ran backwards across the whole canvas to join them. "only the
 * workflow not inderstand able hhhh".
 *
 * depthOf decides the column, as the longest path back to a step that depends
 * on nothing. It read `step.inputs` and nothing else. A clip in frames mode
 * has `startFrame` and `endFrame` and NO `inputs` at all — that is the whole
 * point of frames mode, the two named ends replace the reference list — so
 * every one of those clips looked like a step that depends on nothing and was
 * drawn in column zero, to the left of the two pictures it is made from.
 *
 * They are dependencies in every sense that matters: the clip cannot run until
 * both stills exist, and check.ts has counted them when working out what feeds
 * what for as long as it has existed. Only the layout disagreed, and only the
 * layout had no test.
 */

/// <reference types="node" />

import { compilePlan, type Plan } from '../studio/builder/plan';

const director = {
  id: 'director', type: 'story', platform: 'gemini', label: 'Construction Director',
  structure: 'buildTimelapse', cameraProgression: 'lockedWide',
};
const still = (id: string) => ({
  id, type: 'generate', media: 'image', platform: 'gemini', label: id,
  inputs: ['director'], aspectRatio: '16:9',
});
const clip = (id: string, a: string, b: string) => ({
  id, type: 'generate', media: 'video', platform: 'flow', label: id,
  startFrame: a, endFrame: b, aspectRatio: '16:9', duration: '6s',
});

/** The reported pipeline: six keyframes, five clips between them. */
const PIPELINE = {
  name: 'Drone Architectural Construction Timelapse',
  description: 'Six keyframes and the clips between them.',
  steps: [
    director,
    still('img1'), still('img2'), clip('vid1', 'img1', 'img2'),
    still('img3'), clip('vid2', 'img2', 'img3'),
    still('img4'), clip('vid3', 'img3', 'img4'),
    still('img5'), clip('vid4', 'img4', 'img5'),
    still('img6'), clip('vid5', 'img5', 'img6'),
  ],
} as unknown as Plan;

const place = (p: Plan) => {
  const { template } = compilePlan(p);
  const at = new Map<string, { x: number; y: number }>();
  for (const n of (template!.nodes as any[])) at.set(n.id, n.position);
  return at;
};

describe('a clip drawn after the stills it is made from', () => {
  const at = place(PIPELINE);

  it('puts every clip to the right of both its frames', () => {
    /* The whole bug in one assertion. Every one of these was false before:
       the clips were at x=40 and the stills at x=520. */
    for (const [id, a, b] of [
      ['vid1', 'img1', 'img2'], ['vid2', 'img2', 'img3'], ['vid3', 'img3', 'img4'],
      ['vid4', 'img4', 'img5'], ['vid5', 'img5', 'img6'],
    ] as Array<[string, string, string]>) {
      expect(at.get(id)!.x).toBeGreaterThan(at.get(a)!.x);
      expect(at.get(id)!.x).toBeGreaterThan(at.get(b)!.x);
    }
  });

  it('puts the director left of everything it writes for', () => {
    for (const id of ['img1', 'img6', 'vid1', 'vid5']) {
      expect(at.get(id)!.x).toBeGreaterThan(at.get('director')!.x);
    }
  });

  it('gives the stills one column and the clips the next', () => {
    const stills = ['img1', 'img2', 'img3', 'img4', 'img5', 'img6'].map((i) => at.get(i)!.x);
    const clips = ['vid1', 'vid2', 'vid3', 'vid4', 'vid5'].map((i) => at.get(i)!.x);
    expect(new Set(stills).size).toBe(1);
    expect(new Set(clips).size).toBe(1);
    expect(clips[0]).toBeGreaterThan(stills[0]);
  });

  it('keeps every edge inside one row of vertical travel', () => {
    /* What makes it read as a ladder rather than a fan. Each clip sits level
       with the still it starts on, and one row above the one it ends on. */
    const rows = new Set([...at.values()].map((p) => p.y));
    const step = Math.min(...[...rows].filter((y) => y > 40).map((y) => y - 40));
    for (const [id, a, b] of [
      ['vid1', 'img1', 'img2'], ['vid3', 'img3', 'img4'], ['vid5', 'img5', 'img6'],
    ] as Array<[string, string, string]>) {
      expect(Math.abs(at.get(id)!.y - at.get(a)!.y)).toBeLessThanOrEqual(step);
      expect(Math.abs(at.get(id)!.y - at.get(b)!.y)).toBeLessThanOrEqual(step);
    }
  });

  it('draws the phases down the page in the order they happen', () => {
    /* Reading order. A canvas where phase 4 sits above phase 2 is legal and
       unreadable, and the plan already arrives in order. */
    const ys = ['img1', 'img2', 'img3', 'img4', 'img5', 'img6'].map((i) => at.get(i)!.y);
    expect(ys).toEqual([...ys].sort((a, b) => a - b));
  });
});

describe('what the fix did not change', () => {
  it('still lays out a plain still-into-clip chain the same way', () => {
    /* The ordinary case has inputs and no frames, so depthOf sees exactly what
       it always saw. */
    const at2 = place({
      name: 'x',
      description: 'x',
      steps: [
        { id: 's', type: 'generate', media: 'image', platform: 'grok', label: 's',
          prompt: 'A still of a jar on a bench, soft window light from the left.' },
        { id: 'v', type: 'generate', media: 'video', platform: 'flow', label: 'v',
          prompt: 'Slow push in toward the jar, the light travelling across the glass.',
          inputs: ['s'] },
      ],
    } as unknown as Plan);
    expect(at2.get('v')!.x).toBeGreaterThan(at2.get('s')!.x);
  });

  it('does not hang on a frame that points back at its own clip', () => {
    /* A cycle is the validator's problem, not the layout's — but the layout
       walks the graph first and must come back from it. */
    const { template, problems } = compilePlan({
      name: 'x',
      description: 'x',
      steps: [
        { id: 'a', type: 'generate', media: 'video', platform: 'flow', label: 'a',
          startFrame: 'b', endFrame: 'b' },
        { id: 'b', type: 'generate', media: 'image', platform: 'gemini', label: 'b',
          inputs: ['a'], prompt: 'A wide drone view of an empty plot of land at midday.' },
      ],
    } as unknown as Plan);
    expect(template || problems.length).toBeTruthy();
  });
});
