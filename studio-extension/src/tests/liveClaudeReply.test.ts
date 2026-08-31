/**
 * A real Claude reply, kept as a test.
 *
 * The anchor and the shape below are verbatim from claude.ai answering the
 * Fantasy Room motion brief the extension actually sends. It passed the
 * checker on the first attempt — no repair round — which is the good news.
 *
 * The bad news is why it passed. The continuity rule took the first six long
 * words of the anchor, and Claude opens its anchor with the camera spec, so
 * the rule compared the two prompts on "vertical, ultra-realistic, fixed,
 * medium-wide, camera, inside" — words that are in every prompt by
 * construction. It would have passed a Part 2 with a different person in it.
 *
 * That is the whole reason to run these things against a live model: the
 * suite was green, and the rule was looking at the wrong words.
 */

import { checkShots, type ShotTarget } from '../studio/ask/storyboard';

const TARGETS: ShotTarget[] = [
  { id: 'part1', media: 'video', platform: 'flow', label: 'Part 1 — 10s' },
  { id: 'part2', media: 'video', platform: 'flow', label: 'Part 2 — 10s' },
];

/** Verbatim from the live reply. */
const ANCHOR =
  'Vertical 9:16, ultra-realistic, one fixed medium-wide camera inside the room at standing '
  + 'eye height, never moving, zooming, rotating, dollying, orbiting or cutting; the entire '
  + 'clip is extreme fast hyperlapse with no normal-speed motion; the same young female '
  + 'designer with a blonde ponytail, bright red sporty tracksuit and white sneakers; a large '
  + 'wide high-ceilinged lounge with a full-height window wall on the left, a tall main wall '
  + 'facing the camera and open floor space right of centre for the hero couch; palette of '
  + 'glossy candy pink, peppermint red-and-white and soft mint green; every tool and material '
  + 'enters the frame in her hands before it changes anything; everything installed stays '
  + 'visible, in place and glowing; only the tool currently in use is on the floor.';

const P1 = 'Vertical 9:16 ultra-realistic extreme fast hyperlapse. One fixed medium-wide camera '
  + 'inside a large high-ceilinged lounge with a full-height window wall on the left. The same '
  + 'young female designer with a blonde ponytail, bright red sporty tracksuit and white '
  + 'sneakers walks in carrying glowing peppermint floor rails and lays them across the boards, '
  + 'connecting them by hand until they glow, then pours a glossy candy pink layer over them '
  + 'and presses the first mint green wall piece into place beside the hero couch space.';

/** Same camera, same format — different person and different room. */
const P2_DRIFT = 'Vertical 9:16 ultra-realistic extreme fast hyperlapse. One fixed medium-wide '
  + 'camera inside the room at standing eye height, never moving, zooming, rotating, dollying '
  + 'or cutting. A man in a grey boiler suit walks in and fits plain oak shelving to the far '
  + 'side of a beige studio, then carries in a leather armchair and switches on a floor lamp.';

const P2_GOOD = 'Vertical 9:16 ultra-realistic extreme fast hyperlapse. One fixed medium-wide '
  + 'camera inside the same large high-ceilinged lounge, the peppermint floor already glowing '
  + 'under glossy candy pink. The same young female designer with a blonde ponytail, bright red '
  + 'sporty tracksuit and white sneakers mounts the remaining mint green wall pieces, climbs a '
  + 'ladder to fit the cotton-candy cloud ceiling, then moves the hero couch into place.';

const shots = (a: string, b: string) => [
  { n: 1, title: 'Part 1', prompt: a },
  { n: 2, title: 'Part 2', prompt: b },
];

describe('the reply Claude actually sent', () => {
  it('passes the checker with nothing to repair', () => {
    expect(checkShots(shots(P1, P2_GOOD), TARGETS, ANCHOR)).toEqual([]);
  });

  it('now catches a Part 2 that keeps the camera and changes the person', () => {
    /* The case the old rule missed. Every camera and format word still
       matches; nothing about the subject does. */
    const problems = checkShots(shots(P1, P2_DRIFT), TARGETS, ANCHOR);
    expect(problems.filter((p) => p.code === 'continuity').map((p) => p.shot)).toEqual([2]);
  });

  it('names the details that went missing, so the repair can be specific', () => {
    const problems = checkShots(shots(P1, P2_DRIFT), TARGETS, ANCHOR);
    const detail = problems.find((p) => p.code === 'continuity')!.detail;
    expect(detail).toMatch(/tracksuit|ponytail|peppermint|designer|lounge|sneakers|candy/i);
  });

  it('does not fire on a long anchor that both shots honour', () => {
    // The failure mode of over-correcting: a rule so strict nothing passes.
    expect(checkShots(shots(P1, P2_GOOD), TARGETS, ANCHOR)
      .filter((p) => p.code === 'continuity')).toEqual([]);
  });
});
