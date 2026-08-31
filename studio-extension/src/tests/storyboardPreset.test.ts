/**
 * The storyboard board, for a workflow with no director.
 *
 * A Story node wired to an image node ticked "Storyboard board" writes the
 * board prompt itself. But the commonest shape people actually build is an Ask
 * AI node feeding an image node, and that path knew nothing about boards — so
 * the feature existed only for the half of workflows that use a director.
 *
 * The one instruction that carries the whole idea is "ONE image, not a set".
 * A board works because every panel shares a canvas: the model composes them
 * as a single picture, so the character, the palette and the product hold
 * across all of them, and therefore across every clip made from the board.
 * Asked for as six separate images, that is exactly what is lost.
 */

import {
  BUILTIN_ASK_PRESETS, composeAskPrompt, findPreset,
} from '../studio/presets';

const preset = () => findPreset('storyboard_sheet');

describe('the preset exists and is offered', () => {
  it('is on the list Ask AI shows', () => {
    expect(BUILTIN_ASK_PRESETS.map((p) => p.id)).toContain('storyboard_sheet');
  });

  it('says what to type into it', () => {
    /* Every other preset's hint names its input. "A logline and a shot count"
       is the difference between a usable board and one panel. */
    expect(preset()?.hint).toMatch(/logline/i);
    expect(preset()?.hint).toMatch(/shot count/i);
  });
});

describe('what it asks the model for', () => {
  const brief = () => composeAskPrompt('storyboard_sheet', 'a 6-shot skincare ad', false);

  it('insists on one image rather than a set', () => {
    /* THE instruction. Without it a model returns six prompts, or one prompt
       for one scene, and the shared canvas — the entire mechanism — is gone. */
    expect(brief()).toMatch(/ONE image, not a set/);
  });

  it('explains why one canvas, not just that it wants one', () => {
    expect(brief()).toMatch(/same face, the same clothes and the same light/);
  });

  it('asks for the grid to be stated, and gives the shape of one', () => {
    expect(brief()).toMatch(/six panels read as 3x2, eight as/);
    expect(brief()).toMatch(/Wide beats tall/);
  });

  it('asks for numbered panels, which is what the checker requires of a board', () => {
    expect(brief()).toMatch(/"Panel 1: \.\.\.", "Panel 2: \.\.\." in story order/);
  });

  it('puts the spoken line in the caption, and keeps it short', () => {
    expect(brief()).toMatch(/the line that character speaks in that shot, in quotation/);
    expect(brief()).toMatch(/Long captions render as unreadable text/);
  });

  it('carries the subject through', () => {
    expect(brief()).toContain('a 6-shot skincare ad');
    expect(brief()).not.toContain('{{subject}}');
  });
});

describe('with a product photo wired in', () => {
  const withImage = () => composeAskPrompt('storyboard_sheet', 'a 6-shot shoe ad', true);

  it('reads the reference before drawing anything', () => {
    expect(withImage()).toMatch(/READ THE REFERENCE FIRST/);
    expect(withImage()).toMatch(/Do not restyle, improve or idealise it/);
  });

  it('carries what it read into the shared block, not into one panel', () => {
    /* Otherwise the shoe is right in panel 1 and drifts through the rest,
       which is the failure a board is supposed to prevent. */
    expect(withImage()).toMatch(/into\s+the shared block so every panel draws the same thing/);
  });

  it('is a different brief from the one with no reference', () => {
    /* "A board from a description" and "a board from a photo" are different
       jobs. One brief doing both hedges, and hedged briefs produce hedged
       boards — the same reason character_sheet carries two. */
    expect(withImage()).not.toBe(composeAskPrompt('storyboard_sheet', 'a 6-shot shoe ad', false));
  });
});
