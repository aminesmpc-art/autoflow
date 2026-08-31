/**
 * Asking for the board.
 *
 * The Story node writes prompts for everything it is wired to. One of those
 * nodes is the storyboard board — one image holding every shot as a numbered
 * panel with the spoken line beneath it — and a board is not a shot, so none
 * of the shot guidance applies to it.
 *
 * The panel count and the grid come from the canvas, not from a constant. A
 * board whose panel count disagrees with the number of clips it is planning is
 * a board nobody can shoot from, and the first draft of this plan hardcoded
 * "2x3" while the real working board was 8 panels in 4x2.
 *
 * The last suite here is the one that matters: take what the contract asks
 * for, write it, and put it through the checker. Both halves — accepted as a
 * sheet, refused as a clip — because either alone would pass with the rule
 * simply deleted.
 */

import {
  shotContract, gridFor, panelsFor, checkShots, blockingProblems,
  type Shot, type ShotTarget,
} from '../studio/ask/storyboard';

const board = (): ShotTarget => ({
  id: 'board', label: 'Board', media: 'image', platform: 'flow', isSheet: true,
});

const clips = (n: number): ShotTarget[] => Array.from({ length: n }, (_, i) => ({
  id: `c${i}`, label: `Shot ${i + 1}`, media: 'video' as const, platform: 'flow', duration: '10s',
}));

const contractFor = (n: number) => shotContract([board(), ...clips(n)]);

describe('the grid follows the panel count', () => {
  it.each([
    [2, '2x1'], [3, '3x1'], [4, '2x2'], [6, '3x2'], [8, '4x2'], [9, '3x3'], [12, '4x3'],
  ])('lays %i panels out as %s', (panels, grid) => {
    expect(gridFor(panels)).toBe(grid);
  });

  it('stays wide rather than tall', () => {
    /* The panels are 16:9. A single column of eight is a strip nobody can read
       at a glance, so rows never outnumber columns. */
    for (let n = 2; n <= 16; n++) {
      const [cols, rows] = gridFor(n).split('x').map(Number);
      expect(cols).toBeGreaterThanOrEqual(rows);
    }
  });

  it('always leaves room for every panel', () => {
    for (let n = 2; n <= 16; n++) {
      const [cols, rows] = gridFor(n).split('x').map(Number);
      expect(cols * rows).toBeGreaterThanOrEqual(n);
    }
  });

  it('never returns a one-cell grid, which is not a board', () => {
    expect(gridFor(1)).toBe('2x1');
    expect(gridFor(0)).toBe('2x1');
  });
});

describe('counting the panels', () => {
  it('is one per shot the board is planning for', () => {
    expect(panelsFor([board(), ...clips(8)])).toBe(8);
  });

  it('does not count the board itself', () => {
    expect(panelsFor([board(), ...clips(3)])).toBe(3);
  });

  it('does not count a reference still or a downstream writer', () => {
    /* Both are wired to the story and neither is a shot. Counting them puts
       panels on the board that no clip will ever be made from. */
    const extras: ShotTarget[] = [
      { id: 'ref', label: 'Product', media: 'image', platform: 'flow', role: 'reference' },
      { id: 'ask', label: 'Writer', media: 'text', platform: 'gemini' },
    ];
    expect(panelsFor([board(), ...clips(4), ...extras])).toBe(4);
  });
});

describe('what the board is asked for', () => {
  const out = contractFor(8);

  it('says it is a sheet and not a scene', () => {
    expect(out).toMatch(/A STORYBOARD SHEET/);
    expect(out).toMatch(/the plan for the scenes/);
  });

  it('names the count and the grid taken from the canvas', () => {
    expect(out).toMatch(/all 8 shots as numbered panels in a 4x2 grid/);
  });

  it('asks for the panels by number, through to the last one', () => {
    expect(out).toMatch(/"Panel 1: \.\.\.", "Panel 2: \.\.\." through to Panel 8/);
  });

  it('asks for the spoken line as the caption, and for it to be short', () => {
    /* The board carries the dialogue. Written once and used in both the
       caption and the clip prompt, or the board says one thing and the
       rendered clip says another. */
    expect(out).toMatch(/the line that character speaks in that shot, in quotation marks/);
    expect(out).toMatch(/Long captions render as unreadable text/);
  });

  it('moves the fixed description to the top so every panel matches', () => {
    expect(out).toMatch(/cast, the world and the look once at the top/);
  });

  it('follows the canvas when the canvas changes', () => {
    expect(contractFor(6)).toMatch(/all 6 shots as numbered panels in a 3x2 grid/);
    expect(contractFor(4)).toMatch(/all 4 shots as numbered panels in a 2x2 grid/);
  });
});

describe('a board is not given shot guidance', () => {
  const boardEntry = () => {
    const out = contractFor(8);
    const at = out.indexOf('1. Board');
    return out.slice(at, out.indexOf('2. Shot 1', at));
  };

  it('is never told it is not a moment in the story', () => {
    /* That note is for a reference still. A board is neither a shot nor a
       reference, and telling it both would be two contradictory jobs. */
    expect(boardEntry()).not.toMatch(/NOT a moment in the story/);
  });

  it('is not nagged about duration or continuity', () => {
    const entry = boardEntry();
    expect(entry).not.toMatch(/extended clip/);
    expect(entry).not.toMatch(/Picks up exactly where/);
  });
});

describe('what comes back passes the checker', () => {
  /* Written to the contract above: eight panels, the grid named, a short
     quoted caption under each. This is the shape the real GLOW DROP board
     took. */
  const BOARD_PROMPT = 'A storyboard sheet for a skincare ad, 8 sequential panels in a 4x2 '
    + 'grid. The same young woman throughout, hair in a loose bun, white tee; a small '
    + 'glass serum bottle with a dropper; warm daylight bathroom and bedroom. '
    + 'Panel 1: medium close-up, she leans to the mirror looking tired, caption "my skin '
    + 'looks so tired". Panel 2: macro of the dropper catching the light, caption "trying '
    + 'this serum". Panel 3: she smooths it over one cheek, caption "so lightweight". '
    + 'Panel 4: wide, she blends it in, caption "blends so easily". Panel 5: close on her '
    + 'cheek, caption "sinks right in". Panel 6: she smiles at the mirror, caption "look '
    + 'at that glow". Panel 7: she holds the bottle to camera, caption "honestly worth '
    + 'it". Panel 8: the bottle on the counter, caption "grab yours now". Dark grey '
    + 'production board, short caption beneath each frame.';

  const codes = (t: ShotTarget) =>
    checkShots([{ n: 1, title: 'Board', prompt: BOARD_PROMPT } as Shot], [t]).map((p) => p.code);

  it('is accepted as a sheet', () => {
    expect(blockingProblems(
      checkShots([{ n: 1, title: 'Board', prompt: BOARD_PROMPT } as Shot], [board()]),
    )).toEqual([]);
  });

  it('is refused as a clip', () => {
    /* The other half. The identical text on a Flow video node animates the
       poster instead of the room, which is what the rule was written for. */
    expect(codes({ ...board(), media: 'video', isSheet: false })).toContain('storyboard');
  });

  it('satisfies the rule that a board must lay itself out', () => {
    expect(codes(board())).not.toContain('sheetShape');
  });
});
