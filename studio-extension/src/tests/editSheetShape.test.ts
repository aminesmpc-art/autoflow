/**
 * The shape the edit planner is asked for.
 *
 * The prompt already said what each kind of instruction IS, how long it may
 * hold, and how many were allowed. It said nothing about WHERE they go, so the
 * model spread its budget evenly across the clip.
 *
 * Two things from the 2026 write-ups say that is the wrong answer:
 *
 *   · The first one to three seconds decide whether anyone stays. The prompt
 *     named the 2-4s window a ramp belongs in and never mentioned second 0.
 *
 *   · A 2025 analysis across TikTok and Reels found a shaped arc — fast open,
 *     slower through the explanation, accelerating before the end — beat
 *     uniformly high-energy edits by 18-25% on completion. An even spread is
 *     precisely the edit that measured worst, and an even spread is what a
 *     budget with no shape produces.
 *
 * These are prompt rules, so what can be tested is that they are stated, that
 * the numbers in them agree with the constants, and that the windows they
 * describe do not contradict each other. That is worth doing: the arc is
 * computed from the clip's own runtime, and a clip short enough to collapse
 * the middle would otherwise print a window that runs backwards.
 */

/// <reference types="node" />

import {
  EMPHASIS_FROM_SEC, EMPHASIS_TO_SEC,
  HOOK_UNTIL_SEC, ARC_MIDDLE_FROM, ARC_MIDDLE_TO,
} from '../studio/clip/editSheet';

describe('the windows agree with each other', () => {
  it('the hook comes before the ramp window it feeds into', () => {
    /* A ramp at 2-4s is a move for a viewer who already stayed; the hook is
       what makes them stay. If the hook ran past the ramp the prompt would be
       asking for both in the same breath. */
    expect(HOOK_UNTIL_SEC).toBeLessThanOrEqual(EMPHASIS_TO_SEC);
    expect(EMPHASIS_FROM_SEC).toBeLessThan(EMPHASIS_TO_SEC);
  });

  it('the middle is a middle', () => {
    expect(ARC_MIDDLE_FROM).toBeGreaterThan(0);
    expect(ARC_MIDDLE_FROM).toBeLessThan(ARC_MIDDLE_TO);
    expect(ARC_MIDDLE_TO).toBeLessThan(1);
  });

  it('leaves real room at both ends, which is the whole point of an arc', () => {
    /* If the middle swallowed the clip there would be no fast open and no
       acceleration before the end — the arc would be a flat stretch again. */
    expect(ARC_MIDDLE_FROM).toBeGreaterThanOrEqual(0.2);
    expect(ARC_MIDDLE_TO).toBeLessThanOrEqual(0.8);
  });
});

describe('the arc on a real clip', () => {
  const middle = (runtime: number) => ({
    from: runtime * ARC_MIDDLE_FROM,
    to: runtime * ARC_MIDDLE_TO,
  });

  it('never prints a window that runs backwards', () => {
    for (const runtime of [8, 18.28, 30, 60, 200]) {
      const { from, to } = middle(runtime);
      expect({ runtime, ok: from < to }).toEqual({ runtime, ok: true });
    }
  });

  it('keeps the hook inside the clip even on the shortest one allowed', () => {
    /* A clip cannot be shorter than the cut minimum, but the hook is a fixed
       number of seconds while the arc is a fraction — so the two can only be
       trusted together if the shortest clip still has room for the hook. */
    const shortest = 8;
    expect(HOOK_UNTIL_SEC).toBeLessThan(shortest);
  });

  it('on the 18.3s clip from the run, the middle is where the talking is', () => {
    /* The clip in the screenshot: cut 132.68-150.96s, 18.28s long. */
    const { from, to } = middle(18.28);
    expect(from).toBeCloseTo(5.5, 1);
    expect(to).toBeCloseTo(12.8, 1);
    /* And the hook sits before it, with the tail after. */
    expect(HOOK_UNTIL_SEC).toBeLessThan(from);
    expect(to).toBeLessThan(18.28);
  });
});
