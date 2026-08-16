/**
 * The format checker earns its place one failure at a time.
 *
 * Every rule in checkShots() corresponds to a reply that ran and produced
 * something wrong, usually expensively. These tests are those replies. A rule
 * with no test here is a rule nobody can justify keeping.
 */

import {
  shotContract, parseShots, checkShots, repairMessage, summarise,
  type ShotTarget, type Shot,
} from '../studio/ask/storyboard';

const VIDEO: ShotTarget[] = [
  { id: 'a', media: 'video', platform: 'flow', label: 'Part 1' },
  { id: 'b', media: 'video', platform: 'flow', label: 'Part 2' },
];
const shot = (n: number, prompt: string): Shot => ({ n, title: `Shot ${n}`, prompt });

/* Long enough to clear the "thin" rule, and full of motion, so a test can
   isolate the one thing it is actually about. */
const GOOD = 'A wide fixed camera inside a tall pink lounge as the woman in the red tracksuit '
  + 'walks in carrying glowing floor rails and lays them across the boards, the light rising '
  + 'under her hands while the cotton-candy ceiling holds still above her.';

describe('the contract', () => {
  it('names every shot and how many there are', () => {
    const c = shotContract(VIDEO);
    expect(c).toContain('WRITE ALL 2 PROMPTS');
    expect(c).toContain('Part 1');
    expect(c).toContain('Part 2');
    expect(c).toContain('"shots"');
  });

  it('only demands motion when something is actually a clip', () => {
    expect(shotContract(VIDEO)).toContain('must say what MOVES');
    expect(shotContract([{ id: 'a', media: 'image', platform: 'chatgpt' }]))
      .not.toContain('must say what MOVES');
  });
});

describe('parsing a reply', () => {
  const body = '{"story":"s","anchor":"red tracksuit","shots":[{"n":1,"title":"t","prompt":"p"}]}';

  it('reads a bare object', () => {
    expect(parseShots(body).shots).toHaveLength(1);
  });

  it('reads it out of a code fence', () => {
    const r = parseShots('Here you go:\n```json\n' + body + '\n```\nHope that helps!');
    expect(r.shots[0].prompt).toBe('p');
    expect(r.anchor).toBe('red tracksuit');
  });

  it('reads it out of surrounding prose', () => {
    expect(parseShots('Sure! ' + body + ' Let me know.').shots).toHaveLength(1);
  });

  it('accepts a bare array, which models return about as often', () => {
    expect(parseShots('[{"n":1,"prompt":"p"}]').shots).toHaveLength(1);
  });

  it('says so when there is nothing to read', () => {
    expect(parseShots('I cannot help with that.').problem).toMatch(/No JSON object/);
    expect(parseShots('').problem).toMatch(/empty/);
  });

  it('numbers shots that arrived without numbers', () => {
    const r = parseShots('{"shots":[{"prompt":"a"},{"prompt":"b"}]}');
    expect(r.shots.map((s) => s.n)).toEqual([1, 2]);
  });
});

describe('the format check', () => {
  it('passes prompts that are ready to run', () => {
    expect(checkShots([shot(1, GOOD), shot(2, GOOD)], VIDEO)).toEqual([]);
  });

  it('catches the wrong number of shots', () => {
    const p = checkShots([shot(1, GOOD)], VIDEO);
    expect(p.map((x) => x.code)).toContain('count');
    expect(p[0].detail).toContain('exactly 2');
  });

  it.each([
    ['a code fence', '```\n' + GOOD + '\n```', 'fence'],
    ['a shot label', 'Shot 2: ' + GOOD, 'numbered'],
    ['a list number', '1. ' + GOOD, 'numbered'],
    ['conversational filler', 'Certainly! ' + GOOD, 'meta'],
    ['storyboard language', GOOD + ' Panel 3 shows the caption.', 'storyboard'],
    ['markdown bullets', '- ' + GOOD, 'markdown'],
    ['an unfilled placeholder', GOOD + ' [describe the character]', 'placeholder'],
  ])('rejects %s', (_label, prompt, code) => {
    const p = checkShots([shot(1, prompt), shot(2, GOOD)], VIDEO);
    expect(p.map((x) => x.code)).toContain(code);
  });

  it('rejects a clip prompt in which nothing moves', () => {
    const still = 'A wide symmetrical view of a tall pink lounge with a cloud-shaped couch, '
      + 'glossy floors and a lollipop arch against the far wall, lit evenly and quietly.';
    const p = checkShots([shot(1, still), shot(2, GOOD)], VIDEO);
    expect(p.map((x) => x.code)).toContain('static');
  });

  it('does not demand motion from a still', () => {
    const still = 'A wide symmetrical view of a tall pink lounge with a cloud-shaped couch, '
      + 'glossy floors and a lollipop arch against the far wall, lit evenly and quietly.';
    const p = checkShots([shot(1, still)], [{ id: 'a', media: 'image', platform: 'chatgpt' }]);
    expect(p.map((x) => x.code)).not.toContain('static');
  });

  it('rejects a prompt too long for the composer it is going to', () => {
    const huge = GOOD + ' x'.repeat(9000);
    const p = checkShots([shot(1, huge)], [{ id: 'a', media: 'video', platform: 'grok' }]);
    expect(p.map((x) => x.code)).toContain('long');
    expect(p.find((x) => x.code === 'long')!.detail).toContain('8000');
  });

  it('applies each platform its own limit', () => {
    const mid = GOOD + ' x'.repeat(9000);
    expect(checkShots([shot(1, mid)], [{ id: 'a', media: 'video', platform: 'flow' }])
      .map((x) => x.code)).not.toContain('long');
  });

  it('catches a shot that dropped the details holding the set together', () => {
    const anchor = 'the same woman in a scarlet tracksuit inside the peppermint lounge';
    const drifted = 'A wide fixed camera as a person walks in and moves some furniture around '
      + 'the room while the light shifts slowly across the floor and the ceiling stays still.';
    const p = checkShots([shot(1, GOOD), shot(2, drifted)], VIDEO, anchor);
    expect(p.filter((x) => x.code === 'continuity').map((x) => x.shot)).toEqual([2]);
  });

  it('does not invent a continuity problem when there is no anchor', () => {
    const drifted = 'A wide fixed camera as a person walks in and moves some furniture around '
      + 'the room while the light shifts slowly across the floor and the ceiling stays still.';
    expect(checkShots([shot(1, drifted)], [VIDEO[0]]).map((x) => x.code))
      .not.toContain('continuity');
  });

  it('reports an empty prompt once, not as five separate faults', () => {
    const p = checkShots([shot(1, '')], [VIDEO[0]]);
    expect(p).toHaveLength(1);
    expect(p[0].code).toBe('empty');
  });
});

describe('the repair turn', () => {
  it('lists the problems per shot and asks for the whole object back', () => {
    const problems = checkShots([shot(1, 'Shot 1: ' + GOOD), shot(2, '')], VIDEO);
    const msg = repairMessage(problems, VIDEO);
    expect(msg).toContain('Shot 1:');
    expect(msg).toContain('Shot 2:');
    expect(msg).toContain('all 2 shots');
    expect(msg).toContain('the complete object');
  });

  it('puts envelope problems above the per-shot ones', () => {
    const msg = repairMessage(checkShots([shot(1, GOOD)], VIDEO), VIDEO);
    expect(msg.indexOf('exactly 2')).toBeLessThan(msg.length);
    expect(msg).toContain('Fix these');
  });

  it('summarises for the run log without dumping the whole list', () => {
    expect(summarise([])).toContain('passed');
    const s = summarise(checkShots([shot(1, '```x```'), shot(2, '```y```')], VIDEO));
    expect(s).toMatch(/fence×2|fence/);
  });
});

describe('when the brief and the canvas disagree', () => {
  /* A user's brief said "8 still-image nodes AND 8 video nodes" while the
     canvas held sixteen clips. GLM followed the sentence, wrote eight
     motionless prompts, and the checker rejected half the reply — correctly,
     and uselessly, because nothing had told the model which of the two
     descriptions of the work was true. */
  const sixteenClips: ShotTarget[] = Array.from({ length: 16 }, (_, i) => ({
    id: `c${i}`, media: 'video' as const, platform: 'flow',
    label: `Scene ${i + 1}`, aspectRatio: '9:16', duration: '6s',
  }));

  it('says the canvas wins, before listing it', () => {
    const c = shotContract(sixteenClips);
    const claim = c.indexOf('read from the canvas itself');
    const list = c.indexOf('1. Scene 1');
    expect(claim).toBeGreaterThan(-1);
    // Stated before the list, or it reads as a footnote to it.
    expect(claim).toBeLessThan(list);
  });

  it('names the exact contradiction it is resolving', () => {
    const c = shotContract(sixteenClips);
    expect(c).toContain('a different number of shots');
    expect(c).toContain('still where this says a clip');
    expect(c).toContain('out of date');
  });

  it('still asks for one prompt per entry', () => {
    expect(shotContract(sixteenClips)).toContain('one prompt per entry');
  });
});
