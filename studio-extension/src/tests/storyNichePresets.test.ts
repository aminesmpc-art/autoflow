/**
 * The director, taught the shapes its users were typing in by hand.
 *
 * Twelve published "master prompt" breakdowns — the ones circulating for the
 * niches people actually run: military reunion documentary, back-mounted
 * animal POV, kung-fu cat, AI influencer, baby dragon, 3D slapstick, styrofoam
 * carving, miniature construction, exterior construction ASMR, organic remedy.
 * Most of what they specify the Story node already had: identity locking,
 * dialogue word budgets, phone realism, ASMR craft audio, macro miniature
 * work, hook and CTA shape, per-phase completion, cut rhythm.
 *
 * Six things it did not, each of which someone was otherwise typing into
 * `look` and hoping survived:
 *
 *   frameChain      Four of the twelve build their whole continuity on the
 *                   closing frame of one clip being the opening frame of the
 *                   next. `cumulative` says what was built stays built; `loop`
 *                   says the last frame meets the first. Neither says this.
 *   twist           Three of them end on a reversal rather than a payoff, and
 *                   two of those name the last three seconds specifically.
 *   noRepeatAction  The kung-fu cat prompt spends a paragraph on it.
 *   scaleAnchor     A miniature with nothing beside it photographs exactly
 *                   like the full-size thing it copies.
 *   mountedPOV      A strap or housing rim at the frame edge. Drop it and the
 *                   generator renders a drone.
 *   lockedWide      Same position, altitude, lens AND angle across shots, with
 *                   the subject framed for the size it ends at.
 *
 * These are brief lines, not checker rules, and deliberately: every one of
 * them is a judgement a reader makes, and a checker that fires on wording
 * rather than substance now costs a real repair turn (see storyPolish).
 */

/// <reference types="node" />

import {
  STRUCTURES, RULES, CAMERA_PROGRESSIONS, DEFAULT_STORY,
  settingsAsk, readSettingsReply, storyBrief, isBuild, isUgc,
  type StorySettings,
} from '../studio/ask/storyPlan';
import type { ShotTarget } from '../studio/ask/storyboard';

const clip = (id: string, label: string): ShotTarget =>
  ({ id, label, media: 'video', platform: 'flow', duration: '8s' });

const TARGETS = [clip('a', 'One'), clip('b', 'Two'), clip('c', 'Three')];
const settings = (patch: Partial<StorySettings> = {}): StorySettings =>
  ({ ...DEFAULT_STORY, ...patch } as StorySettings);

const brief = (patch: Partial<StorySettings> = {}) =>
  storyBrief('a candy lounge', settings(patch), TARGETS);

const rule = (id: string) => RULES.find((r) => r.id === id);
const camera = (id: string) => CAMERA_PROGRESSIONS.find((c) => c.id === id);
const structure = (id: string) => STRUCTURES.find((x) => x.id === id);

describe('the join between one clip and the next', () => {
  it('exists as a rule of its own', () => {
    expect(rule('frameChain')).toBeTruthy();
  });

  it('asks for the shared moment in BOTH prompts, not just the later one', () => {
    /* The failure it prevents. Told only "continue from the last clip", a
       writer puts the handover in the second prompt, where the generator
       reads a reference to a clip it has never seen. */
    const line = rule('frameChain')!.line;
    expect(line).toContain('BOTH prompts');
    expect(line).toMatch(/closing state/);
    expect(line).toMatch(/opening state/);
    expect(line).toMatch(/cannot look back/);
  });

  it('is not the same rule as nothing-disappears or the seamless loop', () => {
    /* Three different continuity claims that were being confused for each
       other. cumulative is about what stays on screen, loop is about the whole
       piece meeting its own beginning, frameChain is about the seam. */
    expect(rule('cumulative')!.line).not.toContain('BOTH prompts');
    expect(structure('loop')!.shape.join(' ')).toMatch(/back into the first|continuous with the opening/);
    expect(rule('frameChain')!.line).not.toMatch(/loop/i);
  });

  it('reaches the brief when it is switched on, and not when it is off', () => {
    expect(brief({ rules: ['frameChain'] })).toContain('opens on the exact frame');
    expect(brief({ rules: [] })).not.toContain('opens on the exact frame');
  });
});

describe('a piece that ends on a reversal rather than a payoff', () => {
  it('is its own structure', () => {
    expect(structure('twist')).toBeTruthy();
  });

  it('puts the reversal in the final beat, and says why', () => {
    /* Given only Hook ➜ Build ➜ Payoff, a model writes the reversal into a
       middle beat where it has room — and then owes the viewer a second
       ending it pays by repeating the twist smaller. */
    const shape = structure('twist')!.shape.join('\n');
    expect(shape).toMatch(/FINAL beat/);
    expect(shape).toMatch(/last\n?\s*seconds/);
    expect(shape).toMatch(/has become the setup|already absorbed/);
  });

  it('escalates the same premise instead of stacking new ideas', () => {
    expect(structure('twist')!.shape.join('\n')).toMatch(/SAME premise taken further/);
  });

  it('is not a build, and is not UGC', () => {
    /* Both predicates gate real behaviour — the empty-opening instruction and
       the phone-realism block — and a comedy clip is neither. */
    expect(isBuild(settings({ structure: 'twist' }))).toBe(false);
    expect(isUgc(settings({ structure: 'twist' }))).toBe(false);
  });

  it('writes its beats into the brief', () => {
    const out = brief({ structure: 'twist' });
    expect(out).toContain('Hook → Escalate → Twist');
    expect(out).toContain('BUTTON');
  });
});

describe('a camera strapped to the subject', () => {
  it('insists the rig itself is visible', () => {
    /* The one detail the whole genre rests on. Without it the generator
       renders a smooth camera floating near the animal, which is a drone. */
    const lines = camera('mountedPOV')!.rules.join('\n');
    expect(lines).toMatch(/strap/);
    expect(lines).toMatch(/housing rim/);
    expect(lines).toMatch(/in frame at all times/);
    expect(lines).toMatch(/which is a drone/);
  });

  it('makes the body the reason the frame moves', () => {
    const lines = camera('mountedPOV')!.rules.join('\n');
    expect(lines).toMatch(/BODY moves/);
    expect(lines).toMatch(/micro-vibration/);
    expect(lines).toMatch(/No pan, tilt or zoom is ever chosen/);
  });

  it('reaches the brief', () => {
    expect(brief({ cameraProgression: 'mountedPOV' })).toContain('MOUNTED CAMERA');
  });
});

describe('one camera position for the whole piece', () => {
  it('is separate from the locked tripod, which answers a different question', () => {
    /* Locked Tripod says the camera does not move. This says it is the SAME
       camera in every shot, framed for the size the subject ends at. */
    expect(camera('lockedWide')).toBeTruthy();
    expect(camera('fixed')!.rules.join('\n')).not.toMatch(/same lens/);
  });

  it('demands the position be restated in every prompt', () => {
    const lines = camera('lockedWide')!.rules.join('\n');
    expect(lines).toMatch(/same spot, same height, same lens, same angle/);
    expect(lines).toMatch(/in full in EVERY prompt/);
    expect(lines).toMatch(/refers to nothing/);
  });

  it('frames for the last shot, not the first', () => {
    /* A ground-up build framed on bare land grows out of the top of the
       picture by shot five, and the whole sequence is unusable. */
    const lines = camera('lockedWide')!.rules.join('\n');
    expect(lines).toMatch(/completely inside the frame in every shot, including the last/);
    expect(lines).toMatch(/Frame for the finished thing/);
  });

  it('holds the light steady too', () => {
    expect(camera('lockedWide')!.rules.join('\n')).toMatch(/same time of day, same/);
  });
});

describe('the two smaller rules', () => {
  it('keeps something of known size in a miniature shot', () => {
    const line = rule('scaleAnchor')!.line;
    expect(line).toMatch(/fingertip/);
    expect(line).toMatch(/coin/);
    expect(line).toMatch(/named in every prompt/);
    /* The reason, which is the part that makes a writer comply. */
    expect(line).toMatch(/indistinguishable from the full-size thing/);
  });

  it('refuses to let two clips do the same thing', () => {
    const line = rule('noRepeatAction')!.line;
    expect(line).toMatch(/different angle/);
    expect(line).toMatch(/never|No pose, gesture, strike, camera move or beat appears twice/);
    /* Why it needs saying at all: each prompt is written blind to the others,
       so left alone they converge on the most obvious version. */
    expect(line).toMatch(/without\s+\n?\s*seeing what the others chose|converge/);
  });

  it('both reach the brief', () => {
    const out = brief({ rules: ['scaleAnchor', 'noRepeatAction'] });
    expect(out).toContain('fingertip');
    expect(out).toContain('different angle');
  });
});

describe('the new options travel the whole way, with no second place to register them', () => {
  /* The lists drive the settings menu, the reply validator, the brief and the
     node's own controls. That is the property worth testing: a seventh option
     added tomorrow should need one edit, not four. */
  const ADDED = {
    structure: ['twist'],
    cameraProgression: ['mountedPOV', 'lockedWide'],
    rules: ['frameChain', 'scaleAnchor', 'noRepeatAction'],
  };

  it('offers each of them to the model in the settings turn', () => {
    const ask = settingsAsk('a kung fu cat', TARGETS);
    for (const list of Object.values(ADDED)) {
      for (const id of list) expect(ask).toContain(`"${id}"`);
    }
  });

  it('accepts each of them back rather than dropping it as unknown', () => {
    /* readSettingsReply drops anything it does not recognise — silently, and
       correctly, because a value no dropdown can render shows blank. A new id
       missing from the union would be discarded exactly that quietly. */
    const out = readSettingsReply({
      structure: 'twist',
      cameraProgression: 'mountedPOV',
      rules: ['frameChain', 'scaleAnchor', 'noRepeatAction'],
    });

    expect(out.structure).toBe('twist');
    expect(out.cameraProgression).toBe('mountedPOV');
    expect(out.rules).toEqual(['frameChain', 'scaleAnchor', 'noRepeatAction']);
  });

  it('accepts the other new camera too', () => {
    expect(readSettingsReply({ cameraProgression: 'lockedWide' }).cameraProgression)
      .toBe('lockedWide');
  });

  it('still drops something it has never heard of', () => {
    /* Absent, not corrected. A model that invents "handheldVlog" has said
       nothing usable, and writing it onto the node would put a value in a
       dropdown that cannot render it. */
    expect(readSettingsReply({ cameraProgression: 'handheldVlog' }).cameraProgression)
      .toBeUndefined();
  });

  it('gives every option a name and a usable one-line hint', () => {
    /* Both are shown: the name in the node's dropdown, the hint under it and
       in the model's menu. An option with an empty hint is one the model
       chooses at random. */
    for (const x of [...STRUCTURES, ...CAMERA_PROGRESSIONS]) {
      expect(x.name.trim().length).toBeGreaterThan(3);
      expect(x.hint.trim().length).toBeGreaterThan(10);
    }
    for (const r of RULES) {
      expect(r.name.trim().length).toBeGreaterThan(3);
      expect(r.line.trim().length).toBeGreaterThan(40);
    }
  });

  it('has no duplicate ids anywhere', () => {
    for (const list of [STRUCTURES, CAMERA_PROGRESSIONS, RULES]) {
      const ids = list.map((x) => x.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});
