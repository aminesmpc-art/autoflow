/**
 * One rulebook per kind of target.
 *
 * `checkShots` applied a single rulebook to everything, and among the blocking
 * rules was `storyboard`:
 *
 *     /\b(comic\s*panel|storyboard\s*panel|panel\s*\d+|grid\s*layout
 *       |numbered\s*sequence|text\s*overlay)\b/i
 *
 * It is a good rule. A Flow clip handed the word "panel" animates a storyboard
 * poster instead of the room — a real failure, paid for in renders.
 *
 * But it was applied to every target, and a storyboard board IS a grid of
 * numbered panels with a caption under each. Run a real board prompt through
 * the old checker and it matched on "grid layout", "Panel 1" and "Panel 2" —
 * three blocking problems, which stop the whole workflow. The feature could
 * not ask for the thing it exists to produce.
 *
 * So rules carry a scope. The pair of assertions that matters is the same text
 * being refused as a clip and accepted as a sheet; either one alone proves
 * nothing about the scoping.
 */

import {
  checkShots, BLOCKING, orderShotTargets, type Shot, type ShotTarget,
} from '../studio/ask/storyboard';

const BOARD = 'A cinematic storyboard sheet, 8 sequential panels in a clean 4x2 grid layout. '
  + 'Panel 1: wide shot, she leans to the bathroom mirror looking tired. '
  + 'Panel 2: macro close-up of the serum dropper catching the light. '
  + 'Panel 3: she smiles as it absorbs. Panel 4: she presents the bottle to camera. '
  + 'Dark grey production board, crisp black borders, short caption beneath each frame.';

const CLIP = 'Handheld medium close-up, slight push in. She leans toward the bathroom mirror, '
  + 'tilts her chin to catch the light, then lets her shoulders drop as she turns away.';

const target = (over: Partial<ShotTarget> = {}): ShotTarget => ({
  id: 'n1', label: 'Board', media: 'image', platform: 'flow', ...over,
});

const shot = (prompt: string, n = 1): Shot => ({ n, title: 'Board', prompt });

const codes = (prompt: string, t: ShotTarget) =>
  checkShots([shot(prompt)], [t]).map((p) => p.code);

describe('the same words, judged by what the node is for', () => {
  it('refuses a board prompt on a clip', () => {
    expect(codes(BOARD, target({ media: 'video', isSheet: false }))).toContain('storyboard');
  });

  it('accepts the identical text on a sheet', () => {
    /* The other half. Without this the rule could simply have been deleted. */
    expect(codes(BOARD, target({ isSheet: true }))).not.toContain('storyboard');
  });

  it('still refuses a board prompt on an image node that is not the sheet', () => {
    /* A still of the product is a shot, not a board. Scope comes off the node,
       so an ordinary image target keeps the clip rulebook. */
    expect(codes(BOARD, target({ isSheet: false }))).toContain('storyboard');
  });
});

describe('a sheet that does not lay itself out', () => {
  it('is refused for having no panels', () => {
    const prose = 'A woman applies serum in a sunlit bathroom, warm morning light, '
      + 'shot on a clean neutral background with soft shadows and a calm mood throughout.';
    expect(codes(prose, target({ isSheet: true }))).toContain('sheetShape');
  });

  it('is refused for naming panels but no grid', () => {
    const noGrid = 'Panel 1: she leans to the mirror looking tired. '
      + 'Panel 2: macro close-up of the dropper. Panel 3: she smiles as it absorbs.';
    expect(codes(noGrid, target({ isSheet: true }))).toContain('sheetShape');
  });

  it('accepts one that names both', () => {
    expect(codes(BOARD, target({ isSheet: true }))).not.toContain('sheetShape');
  });

  it('never fires on a clip, which has no business laying out panels', () => {
    expect(codes(CLIP, target({ media: 'video', isSheet: false }))).not.toContain('sheetShape');
  });

  it('is blocking, because a board that is not a board is a wasted render', () => {
    expect(BLOCKING.has('sheetShape')).toBe(true);
  });
});

describe('the rules that apply to everything still do', () => {
  it.each([
    ['a code fence', '```\n' + BOARD + '\n```', 'fence'],
    ['a placeholder', BOARD + ' [describe the character here]', 'placeholder'],
    ['a filename', BOARD + ' matching reference-1.png exactly.', 'fileName'],
  ])('catches %s on a sheet too', (_label, prompt, code) => {
    expect(codes(prompt, target({ isSheet: true }))).toContain(code);
  });
});

describe('problems are numbered by position', () => {
  it('reports against the target it checked, not the number the shot gave itself', () => {
    /* After alignShots a shot sitting at position 2 can still call itself 1,
       and a partial repair reply numbers itself from 1 whatever it holds.
       repairMessage prints targets[n - 1].label and the ledger banks by it, so
       trusting shot.n filed every problem against the wrong target. */
    const targets = [target({ id: 'a', label: 'First' }), target({ id: 'b', label: 'Second' })];
    const shots: Shot[] = [
      { n: 7, title: 'First', prompt: CLIP },
      { n: 1, title: 'Second', prompt: '' },      // empty -> a problem we can locate
    ];
    const problems = checkShots(shots, targets);
    const empty = problems.find((p) => p.code === 'empty');
    expect(empty?.shot).toBe(2);
  });
});

describe('where the flag comes from', () => {
  const nodes = [
    { id: 'story', type: 'story', position: { x: 0, y: 0 }, data: { platform: 'gemini' } },
    {
      id: 'board', type: 'generate', position: { x: 300, y: 0 },
      data: { label: 'Board', mediaType: 'image', platform: 'flow', storyboardSheet: true },
    },
    {
      id: 'still', type: 'generate', position: { x: 600, y: 0 },
      data: { label: 'Product still', mediaType: 'image', platform: 'flow' },
    },
    {
      id: 'clip', type: 'generate', position: { x: 900, y: 0 },
      data: { label: 'Clip', mediaType: 'video', platform: 'flow', storyboardSheet: true },
    },
  ];
  const edges = [
    { source: 'story', target: 'board', targetHandle: 'text' },
    { source: 'story', target: 'still', targetHandle: 'text' },
    { source: 'story', target: 'clip', targetHandle: 'text' },
  ];

  const targets = orderShotTargets('story', nodes as any, edges as any);
  const byId = (id: string) => targets.find((t: ShotTarget) => t.id === id);

  it('reads the flag off the node', () => {
    expect(byId('board')?.isSheet).toBe(true);
  });

  it('leaves an ordinary still alone', () => {
    expect(byId('still')?.isSheet).toBe(false);
  });

  it('refuses to call a video node a sheet, however it is flagged', () => {
    /* A board is a picture. A clip carrying the flag would otherwise be handed
       the permissive rulebook and be free to describe panels, which is the
       render this whole rule exists to stop. */
    expect(byId('clip')?.isSheet).toBe(false);
  });
});
