/**
 * The story a Story node works from.
 *
 * The layer split is the point: identity fixed and repeated into every prompt,
 * style global, action the only thing allowed to vary. Mixing them is what
 * makes a character drift, and the beat arithmetic is derived from the canvas
 * because a number the user has to keep in sync with the wires is a number
 * that will be wrong.
 */

import {
  storyBrief, beatsFor, beatSummary, hasStory, STRUCTURES, RULES, DEFAULT_STORY,
  type StorySettings,
} from '../studio/ask/storyPlan';
import type { ShotTarget } from '../studio/ask/storyboard';

const clips = (n: number, secs: string): ShotTarget[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `c${i}`, media: 'video' as const, platform: 'flow', label: `Clip ${i + 1}`, duration: secs,
  }));

const settings = (over: Partial<StorySettings> = {}): StorySettings => ({ ...DEFAULT_STORY, ...over });

describe('beats come from the canvas', () => {
  it('is about one per four seconds', () => {
    // 2 x 10s = 20s -> 5 beats, which is what the room piece already assumed.
    expect(beatsFor(clips(2, '10s'))).toBe(5);
    expect(beatsFor(clips(3, '8s'))).toBe(6);
  });

  it('never asks for fewer beats than there are shots', () => {
    expect(beatsFor(clips(4, '4s'))).toBe(4);
    expect(beatsFor(clips(6, '2s'))).toBe(6);
  });

  it('falls back to one per shot when nothing has a duration', () => {
    const stills: ShotTarget[] = [
      { id: 'a', media: 'image', platform: 'chatgpt' },
      { id: 'b', media: 'image', platform: 'chatgpt' },
    ];
    expect(beatsFor(stills)).toBe(2);
    expect(beatSummary(stills)).toBe('2 beats');
  });

  it('lets the user override it', () => {
    expect(beatsFor(clips(2, '10s'), 8)).toBe(8);
  });

  it('shows its own arithmetic', () => {
    expect(beatSummary(clips(2, '10s'))).toBe('5 beats · about 4s each');
  });
});

describe('the brief', () => {
  const targets = clips(2, '10s');

  it('asks for what is missing instead of inventing it silently', () => {
    const b = storyBrief('a candy lounge', settings(), targets);
    expect(b).toContain('CAST — decide who appears');
    expect(b).toContain('"cast" field');
    expect(b).toContain('WORLD — decide the place');
    expect(b).toContain('LOOK — decide the palette');
  });

  it('holds the model to what the user locked', () => {
    const b = storyBrief('a candy lounge', settings({
      cast: [{ name: 'Maya', look: 'blonde ponytail, red tracksuit' }],
      world: 'a tall pink lounge',
      look: 'glossy, 35mm, soft key',
    }), targets);
    expect(b).toContain('CAST — fixed');
    expect(b).toContain('Maya: blonde ponytail, red tracksuit');
    expect(b).toContain('WORLD — fixed');
    expect(b).toContain('a tall pink lounge');
    expect(b).toContain('LOOK — applies to every shot');
    expect(b).not.toContain('decide who appears');
  });

  it('explains why identity has to be repeated, not referred to', () => {
    /* The mechanism, in the brief itself: models hold a character by being
       re-told it every shot. Saying so is what stops "the same woman as
       before" appearing in shot 3. */
    const b = storyBrief('x', settings({ cast: [{ name: 'A', look: 'b' }] }), targets);
    expect(b).toContain('remembers nothing');
  });

  it('carries the chosen structure and nothing else', () => {
    const hook = storyBrief('x', settings({ structure: 'hook' }), targets);
    expect(hook).toContain('HOOK');
    expect(hook).not.toContain('BEFORE —');

    const tr = storyBrief('x', settings({ structure: 'transform' }), targets);
    expect(tr).toContain('BEFORE');
    expect(tr).toContain('REVEAL');
    expect(tr).not.toContain('HOOK —');
  });

  it('says nothing about structure when there is none', () => {
    const b = storyBrief('x', settings({ structure: 'free' }), targets);
    expect(b).not.toContain('STRUCTURE');
  });

  it('states the beat count and how to spread it', () => {
    const b = storyBrief('x', settings(), targets);
    expect(b).toContain('BEATS — 5');
    // The line wraps in the brief, so match the part that does not.
    expect(b).toContain('proportion to their length');
  });

  it('survives an empty idea, because the cast may be the whole brief', () => {
    const b = storyBrief('', settings({ world: 'a kitchen' }), targets);
    expect(b).toContain('(none given');
    expect(b).toContain('a kitchen');
  });
});

describe('housekeeping', () => {
  it('knows whether anything has been locked', () => {
    expect(hasStory(settings())).toBe(false);
    expect(hasStory(settings({ world: 'x' }))).toBe(true);
    // An empty row added by the + button is not a locked cast member.
    expect(hasStory(settings({ cast: [{ name: '', look: '' }] }))).toBe(false);
  });

  it('offers a structure for each way these pieces are actually built', () => {
    /* buildTimelapse and craftTransform are the construction and craft shapes
       — a build going up phase by phase, and raw stock becoming a finished
       piece. They arrived after this list was first written; the list is
       exhaustive on purpose, so adding one has to be a decision made here
       too.

       `twist` is the third such decision. Hook ➜ Build ➜ Payoff climbs to the
       biggest version of what it promised; a comedy or creature clip ends on
       the thing it did NOT promise, and given only the climbing shape a model
       puts the reversal in a middle beat where there is room for it. See
       storyNichePresets.test.ts. */
    expect(STRUCTURES.map((s) => s.id))
      .toEqual(['hook', 'twist', 'transform', 'buildTimelapse', 'craftTransform',
        'loop', 'ugcAd', 'free']);
    for (const s of STRUCTURES) expect(s.name.length).toBeGreaterThan(3);
  });
});

describe('continuity rules', () => {
  const targets = clips(2, '10s');

  it('says nothing when none are on', () => {
    expect(storyBrief('x', settings(), targets)).not.toContain('RULES —');
  });

  it('states each one it was given, and only those', () => {
    const b = storyBrief('x', settings({ rules: ['cumulative', 'fixedCamera'] }), targets);
    expect(b).toContain('RULES —');
    expect(b).toContain('nothing is removed, reset');
    expect(b).toContain('ONE fixed camera');
    expect(b).not.toContain('enters the frame in a person');
  });

  it('offers exactly the failures this format actually hits', () => {
    /* A short fixed list rather than a free-text box: a rule that can be
       written any way cannot also be checked, and these are worth checking. */
    expect(RULES.map((r) => r.id))
      .toEqual([
        'cumulative',
        /* Next to cumulative because it is the one people confuse it with,
           and it is not the same claim: cumulative is about what stays on
           screen, this is about the seam between two clips. */
        'frameChain',
        'fixedCamera', 'samePerson', 'inHand',
        /* The three the build and craft formats hit: a phase left half-done
           when the clip ends, a clip with no payoff moment in it, and every
           clip cut to the same monotonous rhythm. */
        'phaseComplete', 'satisfyingMoment', 'cutRhythm',
        /* And the two the miniature and creature formats hit: a tiny build
           photographed with nothing to give its size away, and a piece whose
           clips all do the same move from the same angle. */
        'scaleAnchor', 'noRepeatAction',
      ]);
    for (const r of RULES) expect(r.line.length).toBeGreaterThan(40);
  });
});
