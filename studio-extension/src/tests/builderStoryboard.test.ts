/**
 * What the builder knows about storyboards and reference budgets.
 *
 * Two facts the builder had no way to know, both measured rather than assumed:
 *
 *   Flow refuses the sixth reference image outright — its composer says
 *   "Maximum image ingredients reached (5 allowed)". Nothing downstream caught
 *   that, so an over-wired plan opened the tab, attached five, and stalled on
 *   the rest, having already spent the time to get there.
 *
 *   A storyboard sheet works as a clip reference. That was doubted — a dark
 *   production board with panel borders and captions under every frame is the
 *   opposite of the "plain background" Flow's own guidance asks for, and the
 *   expectation was that Veo would paint the borders into the video. It does
 *   not: fed an 8-panel board with no prompt at all, it animated the CONTENT
 *   across three of the panels, with no borders, no captions and no grid.
 *   The character held and the product label stayed legible.
 */

import { checkPlan } from '../studio/builder/check';
import { compilePlan } from '../studio/builder/plan';
import { buildSpec } from '../studio/builder/spec';
import type { Plan } from '../studio/builder/plan';

const clip = (id: string, inputs: string[]) => ({
  id, type: 'generate' as const, media: 'video' as const,
  platform: 'flow', prompt: 'she lifts the jar to the light', inputs,
});

const still = (id: string) => ({
  id, type: 'image' as const, media: 'image' as const,
  platform: 'flow', prompt: 'a serum bottle on a plain background',
});

const plan = (steps: any[]): Plan => ({ name: 'test', steps } as Plan);

describe('the reference budget', () => {
  it('refuses a shot wired to six pictures', () => {
    const refs = ['a', 'b', 'c', 'd', 'e', 'f'];
    const problems = checkPlan(plan([...refs.map(still), clip('v', refs)]));
    const found = problems.filter((p) => p.code === 'tooManyReferences');
    expect(found).toHaveLength(1);
    expect(found[0].detail).toMatch(/at most 5/);
  });

  it('allows exactly five, because five is what Flow allows', () => {
    const refs = ['a', 'b', 'c', 'd', 'e'];
    const problems = checkPlan(plan([...refs.map(still), clip('v', refs)]));
    expect(problems.filter((p) => p.code === 'tooManyReferences')).toHaveLength(0);
  });

  it('says how many to drop, not just that there are too many', () => {
    const refs = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    const problems = checkPlan(plan([...refs.map(still), clip('v', refs)]));
    expect(problems.find((p) => p.code === 'tooManyReferences')?.detail).toMatch(/Drop 2\b/);
  });

  it('offers the storyboard as the way out of a crowded shot', () => {
    /* One picture carrying the whole scene beats five carrying parts of it,
       and it is the reason the sheet exists. */
    const refs = ['a', 'b', 'c', 'd', 'e', 'f'];
    const problems = checkPlan(plan([...refs.map(still), clip('v', refs)]));
    expect(problems.find((p) => p.code === 'tooManyReferences')?.detail)
      .toMatch(/storyboard image/);
  });

  it('leaves stills alone — the limit is on what a clip is given', () => {
    const problems = checkPlan(plan([
      still('a'), still('b'), still('c'), still('d'), still('e'), still('f'),
      { ...still('board'), inputs: ['a', 'b', 'c', 'd', 'e', 'f'] },
    ]));
    expect(problems.filter((p) => p.code === 'tooManyReferences')).toHaveLength(0);
  });
});

describe('what the spec teaches the builder', () => {
  const SPEC = buildSpec('a skincare ad');

  it('describes the storyboard sheet as a buildable shape', () => {
    expect(SPEC).toMatch(/storyboard sheet/i);
    expect(SPEC).toMatch(/generate image \(the board\)/);
  });

  it('explains WHY one canvas holds a character together', () => {
    /* Without the reason, a model asked for consistency reaches for repeated
       wording instead, which is the weaker tool and already documented above
       it in the same manual. */
    expect(SPEC).toMatch(/share a canvas/);
  });

  it('ties the panel count to the number of clips', () => {
    expect(SPEC).toMatch(/8 clips -> a 4x2\s*\n?\s*board/);
  });

  it('states the five-image ceiling where the builder will read it', () => {
    expect(SPEC).toMatch(/at most FIVE images/);
  });

  it('says a long piece is chained, not asked for in one go', () => {
    expect(SPEC).toMatch(/tops out at 10s/);
    expect(SPEC).toMatch(/last\s*\n?\s*frame of each clip into the next/);
  });

  it('warns that wardrobe drifts inside a single clip', () => {
    /* Measured: her hair went from up to down inside one 10s generation. */
    expect(SPEC).toMatch(/drift within a single ten-second clip/);
  });
});

describe('marking the board on a plan', () => {
  const dataFor = (steps: any[], id: string) => {
    const { template, problems } = compilePlan({ name: 't', steps } as any);
    expect(problems).toEqual([]);          // a plan that will not compile proves nothing
    return ((template?.nodes || []).find((n: any) => n.id === id)?.data || {}) as any;
  };

  it('carries the flag onto the node the story director will read', () => {
    /* Without this the feature is unreachable: nothing else in the product can
       set it, so the board would be asked for one illustration and then
       refused for mentioning panels. */
    const data = dataFor([{
      /* A generate step, not an upload slot: the board is drawn, not supplied. */
      id: 'board', type: 'generate', media: 'image', platform: 'flow',
      prompt: 'a storyboard sheet, 8 panels in a 4x2 grid', storyboardSheet: true,
    }], 'board');
    expect(data.storyboardSheet).toBe(true);
  });

  it('leaves an ordinary still unflagged', () => {
    const data = dataFor([{
      id: 'still', type: 'generate', media: 'image', platform: 'flow', prompt: 'a serum bottle',
    }], 'still');
    expect(data.storyboardSheet).toBeUndefined();
  });

  it('refuses to mark a video step, whatever the plan says', () => {
    /* A board is a picture. A clip carrying the flag would be handed the
       permissive rulebook and be free to describe panels, which is the render
       the rule exists to stop. */
    const data = dataFor([{
      id: 'clip', type: 'generate', media: 'video', platform: 'flow',
      prompt: 'she lifts the jar', storyboardSheet: true,
    }], 'clip');
    expect(data.storyboardSheet).toBeUndefined();
  });

  it('tells the builder the flag exists', () => {
    expect(buildSpec('x')).toMatch(/"storyboardSheet": true/);
  });
});
