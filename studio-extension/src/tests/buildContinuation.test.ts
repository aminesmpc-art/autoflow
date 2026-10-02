/**
 * A construction continuation may describe what it is continuing from.
 *
 * Reported from a real run, three attempts deep, on a Construction Timelapse
 * Build: "Still wrong: Phase 2: Structural Framing (contRestart)". The writer
 * had done exactly what the repair asked. Its opening reads:
 *
 *   "With a fully cured, immaculately leveled, smooth rectangular concrete
 *    foundation slab with steel anchor bolts protruding ... already resting on
 *    the ground from the previous work, the build continues forward without
 *    pause or reset."
 *
 * That is the handover, written the way the brief demands it: the closing
 * state of the shot before, repeated word for word so the two clips join. And
 * `leveled` is in EMPTY_START, so the checker read it as "the site is empty",
 * raised contRestart, and asked for the fix that had just been made.
 *
 * The loop is unwinnable by construction. The brief REQUIRES shot N to repeat
 * shot N-1's closing state verbatim; on a build, that state is a finished
 * surface, and the words for a finished surface are the words for a prepared
 * one — leveled, cleared, excavated, flattened. Every rewrite that obeys the
 * brief trips the check, and three attempts are spent before the run is
 * abandoned with nothing generated.
 *
 * EMPTY_START is right to look for those words in an OPENING shot, where they
 * mean "nothing has been built yet". It has no business reading them in a
 * continuation that is quoting the state it was handed.
 */

import {
  checkShots, type Shot, type ShotTarget,
} from '../studio/ask/storyboard';

const clip = (over: Partial<ShotTarget> = {}): ShotTarget => ({
  id: 'x', media: 'video', platform: 'flow', label: 'Clip', ...over,
});

const codesFor = (shots: Shot[], targets: ShotTarget[]): string[] =>
  checkShots(shots, targets).map((p) => `${p.shot}:${p.code}`);

/* Verbatim from the run, trimmed to the opening clause that decides it. */
const PHASE_1_CLOSE =
  'The camera is stationary and locked in place at an eye-level thirty-degree corner angle '
  + 'on a heavy tripod. Hands in matte grey gloves dig foundation trenches, set wooden formwork '
  + 'and tie steel rebar grids, then a steel trowel smooths the wet concrete in one clean stroke, '
  + 'leaving a fully cured, immaculately leveled, smooth rectangular concrete foundation slab '
  + 'with steel anchor bolts protruding under pristine natural daylight at 5600K neutral sun. '
  + 'Ambient noise: light wind through distant trees. SFX: the crisp scrape of a steel trowel.';

const PHASE_2_CONTINUES =
  'The camera is stationary and locked in place at an eye-level thirty-degree corner angle on a '
  + 'heavy tripod, while the subject moves in ultra-fast timelapse motion. With a fully cured, '
  + 'immaculately leveled, smooth rectangular concrete foundation slab with steel anchor bolts '
  + 'protruding already resting on the ground from the previous work, the build continues forward '
  + 'without pause or reset. Hands in matte grey gloves lower vertical matte-black steel columns '
  + 'onto those exposed foundation anchor bolts, tighten anchor base plates and place horizontal '
  + 'steel I-beams, ending with a complete two-story structural skeleton standing upon the intact '
  + 'concrete slab. Ambient noise: steady daytime breeze. SFX: deep metallic clangs of steel '
  + 'columns seating.';

const twoShots = (second: string) => codesFor(
  [
    { n: 1, title: 'Phase 1', prompt: PHASE_1_CLOSE },
    { n: 2, title: 'Phase 2', prompt: second },
  ],
  [
    clip({ id: 'a', label: 'Phase 1' }),
    clip({ id: 'b', label: 'Phase 2', role: 'continuation', continues: 'Phase 1' }),
  ],
);

describe('a build continuation quoting the state it was handed', () => {
  it('is not accused of restarting the scene', () => {
    /* The exact failure: three attempts, each one obeying the repair, each one
       blocked for the word the repair required it to use. */
    expect(twoShots(PHASE_2_CONTINUES)).not.toContain('2:contRestart');
  });

  it('is still allowed to carry the other finished-surface words', () => {
    /* leveled is the one that was reported; cleared, excavated and flattened
       are the same word in a different phase, and would have failed the next
       run instead. */
    for (const word of ['cleared', 'excavated', 'flattened', 'leveled']) {
      const prompt = PHASE_2_CONTINUES.replace('immaculately leveled', `immaculately ${word}`);
      expect(twoShots(prompt)).not.toContain('2:contRestart');
    }
  });
});

describe('what the check must still catch', () => {
  it('blocks a continuation that really does start from nothing', () => {
    /* The rule earns its place here. A continuation describing bare ground is
       arguing with the frame it was handed, whatever else it says. */
    const restarted =
      'The camera is stationary and locked in place at an eye-level thirty-degree corner angle '
      + 'on a heavy tripod. The site is level bare earth with no foundations, no framing and no '
      + 'materials of any kind, untouched and empty before any construction has begun. Hands in '
      + 'matte grey gloves begin to mark out the first trench lines across the open soil. '
      + 'Ambient noise: wind. SFX: a spade cutting soil.';

    expect(twoShots(restarted)).toContain('2:contRestart');
  });

  it('still blocks a continuation that opens the scene fresh', () => {
    /* RESTARTS is a separate pattern and is not being touched. */
    const opensOn =
      'The shot opens on a clean architectural site, establishing shot of level ground under '
      + 'daylight, where we first see the foundation being marked out by hands in matte grey '
      + 'gloves working quickly across the plot. Ambient noise: wind. SFX: a spade cutting soil.';

    expect(twoShots(opensOn)).toContain('2:contRestart');
  });
});
