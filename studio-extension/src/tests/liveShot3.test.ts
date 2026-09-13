/**
 * The real Phase 2 prompt, from the run that would not pass.
 *
 * Three rewrites, each one opening with the previous shot's closing state
 * exactly as instructed, each one refused with contRestart. This puts the
 * verbatim text through the checker and prints what it caught, so the trigger
 * is a fact rather than a guess.
 */

import { checkShots, type Shot, type ShotTarget } from '../studio/ask/storyboard';

const clip = (over: Partial<ShotTarget> = {}): ShotTarget => ({
  id: 'x', media: 'video', platform: 'flow', label: 'Clip', ...over,
});

/* Verbatim, third attempt. */
const SHOT_3 =
  'A fully cured, monolithic, level grey concrete foundation slab with crisp razor-sharp edges '
  + 'sitting flush on the graded earth, perfectly dry, clean, and solid against surrounding green '
  + 'trees under pristine 5600K neutral daylight is already completely built and present in the '
  + 'opening frame. Filmed from a locked-off wide eye-level angle on a 35mm anamorphic lens, the '
  + 'camera is completely fixed and stationary without camera movement, without tilting, without '
  + 'panning, and without shifting angles; only the subject moves. Carrying the action forward '
  + 'seamlessly from this completed slab, rapid construction timelapse continues as Construction '
  + 'Hands, only human hands and forearms of unseen construction workers enter the frame, wearing '
  + 'clean matte grey work gloves and rolled dark blue work-shirt sleeves, no faces, heads or full '
  + 'bodies ever visible, movements quick, precise and continuous, erect the structural framing '
  + 'directly onto the concrete foundation. Across rapid action cuts, hands anchor heavy steel base '
  + 'plates, raise vertical matte black steel I-beam columns, and set horizontal glulam timber '
  + 'cross-beams, followed by a deliberate close-up where a heavy matte black steel beam is lowered '
  + 'and snaps perfectly flush into a locking column joint with a solid mechanical fit. The clip '
  + 'completes with a completed, rigid, two-story modern structural frame of matte black steel '
  + 'columns and warm architectural timber beams standing plumb, anchored permanently to the cured '
  + 'concrete foundation slab against surrounding green trees under pristine 5600K neutral '
  + 'daylight. Ambient noise: Steady gentle breeze through forest canopy. '
  + 'SFX: Sharp metallic clank of steel beam seating into joint brackets.';

const SHOT_2 =
  'Locked-off stationary wide framing on a 35mm anamorphic lens, the camera fixed while only the '
  + 'subject moves. Hands in clean matte grey work gloves dig square footings, tie steel rebar '
  + 'cages and screed wet cement in one clean stroke, completing a fully cured, monolithic, level '
  + 'grey concrete foundation slab with crisp razor-sharp edges sitting flush on the graded earth. '
  + 'Ambient noise: gentle breeze through forest canopy. SFX: trowels scraping wet concrete.';

const targets = [
  clip({ id: 'a', label: 'Phase 1' }),
  clip({ id: 'b', label: 'Phase 2', role: 'continuation', continues: 'Phase 1' }),
];

const shots: Shot[] = [
  { n: 1, title: 'Phase 1', prompt: SHOT_2 },
  { n: 2, title: 'Phase 2', prompt: SHOT_3 },
];

describe('the prompt that would not pass', () => {
  it('passes now, and says so with the words if it does not', () => {
    const problems = checkShots(shots, targets);
    const restart = problems.find((p) => p.code === 'contRestart');

    /* The message is the point of the assertion: if this ever fails again, the
       failure itself names the words, instead of sending somebody through four
       hundred of them looking for a rule they cannot see. */
    expect(restart ? `contRestart on “${restart.matched}”` : 'accepted')
      .toBe('accepted');
  });
});
