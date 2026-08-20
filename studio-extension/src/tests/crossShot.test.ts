/**
 * Shots measured against the shot before them.
 *
 * Every other rule in the checker judges a prompt on its own. Nothing compared
 * shot 3 to shot 2, so the failure that actually ruins a sequence went
 * unnoticed: a continuation that restarts, a room re-emptied after it was
 * furnished, hair up in one shot and down in the next.
 *
 * That last one is measured, not imagined. A 10s clip generated from an
 * 8-panel storyboard with no prompt at all put the character's hair up for the
 * first half and down for the second. Nothing asked for it. Across six clips
 * of a sixty-second piece, unmanaged drift is a certainty.
 *
 * The split matters as much as the rules:
 *
 *   contRestart  BLOCKING. This node's first frame comes from another shot, so
 *                a prompt that establishes the scene fresh is arguing with the
 *                frame it was handed. The clip restarts; the render is wasted.
 *   contBreak    advisory. A shot can continue perfectly well by describing
 *                continuing action without ever reaching for the word.
 *   stateDrift   advisory. It costs a shot its consistency, not its render.
 */

import {
  checkShots, blockingProblems, type Shot, type ShotTarget,
} from '../studio/ask/storyboard';

const clip = (over: Partial<ShotTarget> = {}): ShotTarget => ({
  id: 'x', media: 'video', platform: 'flow', label: 'Clip', ...over,
});

const cont = (label = 'Clip B'): ShotTarget =>
  clip({ id: 'b', label, role: 'continuation', continues: 'Clip A' });

/** Long enough to clear the `thin` rule, so only what is under test speaks. */
const FIRST = 'She lifts the ceramic jar from the marble counter and turns it slowly in '
  + 'the morning light, watching the glaze catch, her hair twisted up into a loose bun.';

const codesFor = (shots: Shot[], targets: ShotTarget[]) =>
  checkShots(shots, targets).map((p) => `${p.shot}:${p.code}`);

const two = (second: string, secondTarget = cont(), first = FIRST) => codesFor(
  [{ n: 1, title: 'Clip A', prompt: first }, { n: 2, title: 'Clip B', prompt: second }],
  [clip({ id: 'a', label: 'Clip A' }), secondTarget],
);

describe('a continuation that restarts', () => {
  it.each([
    ['the scene opens', 'The scene opens on a sunlit bathroom as she reaches for the bottle on the shelf.'],
    ['establishing shot', 'Establishing shot of the quiet kitchen, sunlight across the counter, everything still.'],
    ['for the first time', 'She reaches for the ceramic jar for the first time, turning it over in her hands.'],
    ['an empty room', 'The bare, unfurnished room, nothing on the walls, before any of the work has begun.'],
  ])('is refused when it %s', (_label, prompt) => {
    expect(two(prompt)).toContain('2:contRestart');
  });

  it('is blocking, because the frame it was handed says otherwise', () => {
    const problems = checkShots(
      [{ n: 1, title: 'Clip A', prompt: FIRST },
        { n: 2, title: 'Clip B', prompt: 'The scene opens on a sunlit bathroom, quiet and still and new.' }],
      [clip({ id: 'a', label: 'Clip A' }), cont()],
    );
    expect(blockingProblems(problems).map((p) => p.code)).toContain('contRestart');
  });

  it('says nothing to a shot that is not a continuation', () => {
    /* Every piece opens somewhere. "The scene opens on" is the correct way to
       write shot 1 and would be absurd to refuse. */
    expect(two(
      'The scene opens on a sunlit bathroom as she reaches for the bottle on the shelf.',
      clip({ id: 'b', label: 'Clip B' }),
    )).not.toContain('2:contRestart');
  });
});

describe('a continuation that never says so', () => {
  it('is mentioned, not refused', () => {
    const prompt = 'She stands by the counter and looks at the jar in her hands, turning '
      + 'it over once, the light moving across the glaze as she does.';
    const problems = checkShots(
      [{ n: 1, title: 'Clip A', prompt: FIRST }, { n: 2, title: 'Clip B', prompt }],
      [clip({ id: 'a', label: 'Clip A' }), cont()],
    );
    expect(problems.map((p) => p.code)).toContain('contBreak');
    expect(blockingProblems(problems).map((p) => p.code)).not.toContain('contBreak');
  });

  it.each([
    ['continues', 'She continues lowering the jar onto the counter, the same slow movement carrying on.'],
    ['picks up where', 'Picks up where the last shot ended, her hand still wrapped around the ceramic jar.'],
    ['mid-motion', 'Caught mid-motion, the jar travelling down towards the marble as her wrist turns.'],
    ['uninterrupted', 'One uninterrupted movement onward, the jar settling onto the counter without a pause.'],
  ])('is silent when the prompt says it %s', (_label, prompt) => {
    expect(two(prompt)).not.toContain('2:contBreak');
  });

  it('never fires on an ordinary shot', () => {
    expect(two(
      'She stands by the counter and looks at the jar in her hands, turning it over once slowly.',
      clip({ id: 'b', label: 'Clip B' }),
    )).not.toContain('2:contBreak');
  });
});

describe('state that changes when nothing asked it to', () => {
  it('notices hair going from up to down between adjacent shots', () => {
    /* The failure observed in a real generation. */
    const prompt = 'She continues turning towards the window, her hair down across her '
      + 'shoulders, the jar still held loosely in one hand as she moves.';
    expect(two(prompt)).toContain('2:stateDrift');
  });

  it('is advisory — it costs the shot its consistency, not its render', () => {
    const prompt = 'She continues turning towards the window, her hair down across her '
      + 'shoulders, the jar still held loosely in one hand as she moves.';
    const problems = checkShots(
      [{ n: 1, title: 'Clip A', prompt: FIRST }, { n: 2, title: 'Clip B', prompt }],
      [clip({ id: 'a', label: 'Clip A' }), cont()],
    );
    expect(blockingProblems(problems).map((p) => p.code)).not.toContain('stateDrift');
  });

  it('stays quiet when the state agrees', () => {
    const prompt = 'She continues turning towards the window, her hair still twisted up '
      + 'into the same loose bun, the jar held loosely in one hand as she moves.';
    expect(two(prompt)).not.toContain('2:stateDrift');
  });

  it('stays quiet when the next shot says nothing about it', () => {
    /* A shot that does not mention hair is not a contradiction. This is what
       keeps the rule from becoming noise nobody reads. */
    const prompt = 'She continues lowering the jar towards the marble counter, her fingers '
      + 'easing open as it comes to rest, the light shifting across the glaze.';
    expect(two(prompt)).not.toContain('2:stateDrift');
  });

  it('does not compare a shot to one two places back', () => {
    /* Adjacent only. Over a long sequence a legitimate change three shots
       earlier is not a contradiction, and treating it as one would make the
       rule fire on every well-written story. */
    const up = FIRST;
    const down = 'She continues turning towards the window, her hair down across her shoulders now.';
    const codes = codesFor(
      [{ n: 1, title: 'A', prompt: up },
        { n: 2, title: 'B', prompt: down },
        { n: 3, title: 'C', prompt: 'She continues lowering the jar onto the counter, easing her fingers open.' }],
      [clip({ id: 'a', label: 'A' }), cont('B'), cont('C')],
    );
    expect(codes).toContain('2:stateDrift');
    expect(codes).not.toContain('3:stateDrift');
  });
});

describe('the vocabulary matches how continuations are really written', () => {
  it.each([
    ['the same room', 'One fixed camera inside the same tall pink lounge with the floor already glowing.'],
    ['already', 'The wall is already painted; she moves on to fitting the ceiling panels above it.'],
    ['remaining', 'She mounts the remaining wall pieces, then climbs the ladder with the last panel.'],
    ['still', 'Her hand is still wrapped around the ceramic jar as she lowers it towards the marble.'],
  ])('stays silent on a continuation that says "%s"', (_label, prompt) => {
    /* All four come from, or read like, the fixtures of shipped templates. The
       first version of this rule excluded "same" and "already" for being too
       common, and roomStoryboard.test.ts immediately failed on a textbook
       continuation: "inside the SAME lounge with the floor ALREADY glowing...
       mounts the REMAINING wall pieces".

       An advisory that fires on correct work is worse than one that misses
       some: it teaches people to ignore the panel. contRestart is where the
       strictness belongs, because that one is unambiguous. */
    expect(two(prompt)).not.toContain('2:contBreak');
  });
});

describe('"the shot before it" means the previous shot', () => {
  it('looks past a reference still standing between two clips', () => {
    /* Targets arrive in CANVAS order, and a workflow that gives each clip its
       own anchor still has those stills interleaved between the clips. Read
       off a real one: the director's targets came back as

         still-A, still-B, clip test_a, clip unbox, still-C, clip test_b

       so shots[i - 1] for a clip was a reference picture. Comparing a clip's
       wardrobe against a reference picture's is not a contradiction, and
       reporting it as one is how an advisory becomes noise. */
    const ref: ShotTarget = clip({ id: 'r', label: 'Anchor', media: 'image', role: 'reference' });
    const codes = codesFor(
      [
        { n: 1, title: 'A', prompt: FIRST },
        { n: 2, title: 'Anchor', prompt: 'A clean product still of the jar on a plain background, evenly lit, hair down.' },
        { n: 3, title: 'B', prompt: 'She continues lowering the jar, her hair still twisted up into the same loose bun.' },
      ],
      [clip({ id: 'a', label: 'A' }), ref, cont('B')],
    );
    // Shot 3 agrees with shot 1, which is the shot before it that matters.
    expect(codes).not.toContain('3:stateDrift');
  });

  it('still catches drift across an intervening still', () => {
    const ref: ShotTarget = clip({ id: 'r', label: 'Anchor', media: 'image', role: 'reference' });
    const codes = codesFor(
      [
        { n: 1, title: 'A', prompt: FIRST },
        { n: 2, title: 'Anchor', prompt: 'A clean product still of the jar on a plain background, evenly lit.' },
        { n: 3, title: 'B', prompt: 'She continues lowering the jar, her hair down loose across her shoulders now.' },
      ],
      [clip({ id: 'a', label: 'A' }), ref, cont('B')],
    );
    expect(codes).toContain('3:stateDrift');
  });
});

describe('canvas order is not story order', () => {
  /* Read off a real run of a real workflow. The director's targets came back
     as: still, still, FILM 2A, FILM 1, still, FILM 2B — so the shot
     positionally before FILM 2B was the UNBOXING, while the clip it actually
     picks up from is 2A, two places earlier. */
  const targets: ShotTarget[] = [
    clip({ id: 'a', label: 'FILM 2A' }),
    clip({ id: 'u', label: 'FILM 1' }),
    { ...clip({ id: 'b', label: 'FILM 2B' }), role: 'continuation', continues: 'FILM 2A' },
  ];

  const run = (twoA: string, one: string, twoB: string) => codesFor(
    [{ n: 1, title: 'FILM 2A', prompt: twoA },
      { n: 2, title: 'FILM 1', prompt: one },
      { n: 3, title: 'FILM 2B', prompt: twoB }],
    targets,
  );

  it('compares a continuation to the shot it continues, not the one beside it', () => {
    const codes = run(
      'She laces the shoes on the baseline, her hair twisted up into a loose bun as she pulls tight.',
      'She lifts the lid off the shoebox on the bench, her hair down loose across her shoulders.',
      'She continues into a full sprint across the court, her hair still twisted up into the same bun.',
    );
    /* 2B agrees with 2A. Measured against FILM 1 next door it would look like
       a contradiction, and that is purely where the nodes sit. */
    expect(codes).not.toContain('3:stateDrift');
  });

  it('still catches a real contradiction with the shot it continues', () => {
    const codes = run(
      'She laces the shoes on the baseline, her hair twisted up into a loose bun as she pulls tight.',
      'She lifts the lid off the shoebox on the bench, her hair down loose across her shoulders.',
      'She continues into a full sprint across the court, her hair down loose across her shoulders now.',
    );
    expect(codes).toContain('3:stateDrift');
  });
});
