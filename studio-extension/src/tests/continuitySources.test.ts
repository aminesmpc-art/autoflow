/**
 * Three continuity sources, three different jobs.
 *
 *   CAST/WORLD anchor   identity and style. Who these people are, what they
 *                       wear, what the light is. Shared, and deliberately
 *                       neutral about pose and composition.
 *   SHOT-SPECIFIC still a deliberate new composition, for a shot where the
 *                       story resets the frame — or an opening shot, where
 *                       nothing upstream fixes one.
 *   LAST FRAME          exact temporal continuity: this clip opens on the
 *                       frame the one before it closed on.
 *
 * Treating them as interchangeable is how a multi-shot piece ends up with a
 * still per shot, each re-staging a moment the frame chain already carried,
 * each costing a generation, and each producing a composition that argues
 * with the frame wired beside it.
 *
 * Building Episode 01 with a proper cast anchor also exposed a false positive
 * that had been there all along: storyAndPrompts treated the anchor as a shot
 * bypassing the Director, and told the user to delete its prompt and let the
 * Director write it — which would have produced a scene where a reference
 * sheet was wanted.
 */

/// <reference types="node" />

import { checkPlan } from '../studio/builder/check';

const clip = (id: string, inputs: string[]) => ({
  id, type: 'generate', media: 'video', platform: 'flow',
  aspectRatio: '9:16', duration: '6s', inputs,
});

const still = (id: string, extra: Record<string, unknown> = {}) => ({
  id, type: 'generate', media: 'image', platform: 'flow',
  prompt: 'a picture', aspectRatio: '9:16', ...extra,
});

const codes = (steps: any[]) => checkPlan({ name: 'x', steps } as any).map((p) => p.code);

describe('a still beside a last frame', () => {
  it('is reported when nothing else uses it', () => {
    /* shot2 is handed frame1 AND a still of its own. The frame already fixes
       how shot2 opens, so the still can only argue with it — and it costs a
       generation to make. */
    expect(codes([
      clip('s1', []),
      { id: 'f1', type: 'frame', inputs: ['s1'] },
      still('spare'),
      clip('s2', ['f1', 'spare']),
      clip('s3', ['f1']),
    ])).toContain('redundantStill');
  });

  it('is NOT reported for a still that several clips share', () => {
    /* That is an anchor doing its job: one identity and one world, carried
       into every shot. The frame chain still does the temporal work. */
    expect(codes([
      still('anchor'),
      clip('s1', ['anchor']),
      { id: 'f1', type: 'frame', inputs: ['s1'] },
      clip('s2', ['f1', 'anchor']),
      { id: 'f2', type: 'frame', inputs: ['s2'] },
      clip('s3', ['f2', 'anchor']),
    ])).not.toContain('redundantStill');
  });

  it('is NOT reported for a storyboard board, however it is wired', () => {
    /* A board is an anchor by definition. Even feeding one clip it is not a
       second opinion about a composition — it is the plan for all of them. */
    expect(codes([
      still('board', { storyboardSheet: true }),
      clip('s1', ['board']),
      { id: 'f1', type: 'frame', inputs: ['s1'] },
      clip('s2', ['f1', 'board']),
      clip('s3', ['f1']),
    ])).not.toContain('redundantStill');
  });

  it('is NOT reported for an opening still, which has no frame to argue with', () => {
    /* Shot 1 is the one shot a still genuinely earns: nothing upstream fixes
       its first frame, so without one it is invented from the words alone. */
    expect(codes([
      still('still1'),
      clip('s1', ['still1']),
      { id: 'f1', type: 'frame', inputs: ['s1'] },
      clip('s2', ['f1']),
      clip('s3', ['f1']),
    ])).not.toContain('redundantStill');
  });
});

describe('a reference asset is not a shot bypassing the Director', () => {
  const EPISODE = [
    { id: 'anchor', type: 'generate', media: 'image', platform: 'flow',
      prompt: 'a neutral cast and world line-up, nobody doing anything' },
    { id: 'still1', type: 'generate', media: 'image', platform: 'flow',
      prompt: 'the opening frame, hands packing', inputs: ['anchor'] },
    { id: 'director', type: 'story', prompt: 'eight beats' },
    clip('s1', ['still1', 'director']),
    { id: 'f1', type: 'frame', inputs: ['s1'] },
    clip('s2', ['f1', 'director']),
    { id: 'f2', type: 'frame', inputs: ['s2'] },
    clip('s3', ['f2', 'director']),
  ];

  it('lets an anchor and an opening still keep their own prompts', () => {
    /* The Director writes the SHOTS. Asking it to write a cast chart as well
       produces a scene where a reference sheet was wanted. */
    expect(codes(EPISODE)).not.toContain('storyAndPrompts');
    expect(checkPlan({ name: 'x', steps: EPISODE } as any)).toEqual([]);
  });

  it('still reports a CLIP that writes itself while a Director writes the rest', () => {
    /* The rule's real job, untouched. A video shot outside the Director sits
       outside the cast, world and look every other shot shares. */
    const rogue = EPISODE.map((s) => (s.id === 's3'
      ? { ...clip('s3', ['f2']), prompt: 'its own words' } : s));
    expect(codes(rogue)).toContain('storyAndPrompts');
  });

  it('still reports a still that feeds nothing at all', () => {
    /* The exemption is deliberately narrow: it covers references that are
       actually REFERENCED. A still feeding nothing is not a reference, it is
       a generation nobody will see, and orphanStill says so.

       It also still counts as a prompt-carrying step outside the Director,
       which is true of it. I expected that to be double-reporting and it is
       not: the two say different things about the same step, and either one
       alone would leave the user guessing at the other. */
    const out = codes([...EPISODE, still('nobody_uses_me')]);
    expect(out).toContain('orphanStill');
  });
});
