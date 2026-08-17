/**
 * What a node is FOR, read off the wiring.
 *
 * The user's case, in their words: you describe a character, an image node
 * generates them, and a video node makes them dance. Told only that it is
 * "a still image", the writer describes a moment from the story and produces
 * a picture the clip cannot use as a reference. The wiring already says which
 * is which — an image node feeding a video node's reference port is not a
 * shot, it is the character being built — and nothing was reading it.
 */

import { orderShotTargets, shotContract, checkShots } from '../studio/ask/storyboard';
import { BUILTIN_TEMPLATES } from '../studio/templates/index';

const story = { id: 'story', type: 'story', position: { x: 0, y: 0 }, data: { mediaType: 'text' } };

/** idea → story → [character still] → [dance clip] */
const characterFirst = {
  nodes: [
    story,
    { id: 'char', type: 'generate', position: { x: 300, y: 0 },
      data: { label: 'Character', mediaType: 'image', platform: 'chatgpt', aspectRatio: '9:16' } },
    { id: 'dance', type: 'generate', position: { x: 700, y: 0 },
      data: { label: 'Dance clip', mediaType: 'video', platform: 'flow', aspectRatio: '9:16', duration: '8s' } },
  ],
  edges: [
    { source: 'story', target: 'char', targetHandle: 'text' },
    { source: 'story', target: 'dance', targetHandle: 'text' },
    { source: 'char', target: 'dance', targetHandle: 'image' },
  ],
};

/** clip A → Last Frame → clip B */
const chained = {
  nodes: [
    story,
    { id: 'a', type: 'generate', position: { x: 300, y: 0 },
      data: { label: 'Part 1', mediaType: 'video', platform: 'flow', duration: '10s' } },
    { id: 'hand', type: 'frame', position: { x: 500, y: 0 }, data: { label: 'Ends on' } },
    { id: 'b', type: 'generate', position: { x: 700, y: 0 },
      data: { label: 'Part 2', mediaType: 'video', platform: 'flow', duration: '10s',
        creationType: 'frames' } },
  ],
  edges: [
    { source: 'story', target: 'a', targetHandle: 'text' },
    { source: 'story', target: 'b', targetHandle: 'text' },
    { source: 'a', target: 'hand', targetHandle: 'image' },
    { source: 'hand', target: 'b', targetHandle: 'frame_start' },
  ],
};

describe('an image node that feeds a clip', () => {
  const targets = orderShotTargets('story', characterFirst.nodes as any, characterFirst.edges as any);

  it('is a reference, not a shot', () => {
    expect(targets.map((t) => [t.id, t.role])).toEqual([
      ['char', 'reference'],
      ['dance', 'shot'],
    ]);
  });

  it('knows which shot it is being made for', () => {
    expect(targets[0].referenceFor).toBe('Dance clip');
  });

  it('is briefed as a reference, in the words a reference needs', () => {
    const c = shotContract(targets);
    expect(c).toContain('NOT a moment in the story');
    expect(c).toContain('the reference Dance clip must match');
    expect(c).toContain('nothing important cropped');
    // And it must use the same words the clip uses, or the two disagree.
    expect(c).toContain('same words for the subject that the shots use');
  });

  it('attaches the reference note to the still, not to the clip', () => {
    /* By position, not by searching for the name: the note itself mentions
       "Dance clip" as the thing being referenced, so filtering on the name
       finds it under both — which is exactly what the first version of this
       test did, and it failed for that reason rather than for a real one. */
    const lines = shotContract(targets).split('\n');
    const still = lines.findIndex((l) => /^\s+1\./.test(l));
    const clip = lines.findIndex((l) => /^\s+2\./.test(l));
    const note = lines.findIndex((l) => l.includes('NOT a moment'));
    expect(note).toBeGreaterThan(still);
    expect(note).toBeLessThan(clip);
    expect(lines.filter((l) => l.includes('NOT a moment'))).toHaveLength(1);
  });
});

describe('a clip whose first frame comes from another clip', () => {
  const targets = orderShotTargets('story', chained.nodes as any, chained.edges as any);

  it('is a continuation, and knows what it continues', () => {
    const b = targets.find((t) => t.id === 'b');
    expect(b?.role).toBe('continuation');
    expect(b?.continues).toBe('Part 1');
  });

  it('follows the chain through the Last Frame node rather than stopping at it', () => {
    /* "clip A → Last Frame → clip B" is one relationship with a box drawn in
       the middle. Stopping at the box loses the only fact that matters. */
    expect(targets.find((t) => t.id === 'b')?.continues).not.toBe('Ends on');
  });

  it('tells it not to restart, and that nothing before it is visible to it', () => {
    const c = shotContract(targets);
    expect(c).toContain('Picks up exactly where "Part 1" ended');
    expect(c).toContain('cannot see the previous clip');
  });

  it('leaves the first clip an ordinary shot', () => {
    expect(targets.find((t) => t.id === 'a')?.role).toBe('shot');
  });
});

describe('the checker follows the same distinction', () => {
  const targets = orderShotTargets('story', characterFirst.nodes as any, characterFirst.edges as any);

  it('does not demand motion from a reference still', () => {
    const still = 'A full-length view of a young dancer in a red tracksuit against a plain '
      + 'grey backdrop, evenly lit, the whole figure in frame and nothing cropped.';
    const clip = 'The same dancer in the red tracksuit spins across a polished floor as the '
      + 'camera holds steady on her.';
    const problems = checkShots(
      [{ n: 1, title: 'Character', prompt: still }, { n: 2, title: 'Dance', prompt: clip }],
      targets,
    );
    expect(problems.map((p) => p.code)).not.toContain('static');
  });

  it('still demands motion from the clip', () => {
    const still = 'A full-length view of a young dancer in a red tracksuit against a plain '
      + 'grey backdrop, evenly lit, the whole figure in frame and nothing cropped.';
    const frozen = 'A symmetrical composition of a polished floor and a dancer in a red '
      + 'tracksuit standing at its centre under even light, everything perfectly still.';
    const problems = checkShots(
      [{ n: 1, title: 'Character', prompt: still }, { n: 2, title: 'Dance', prompt: frozen }],
      targets,
    );
    expect(problems.filter((p) => p.code === 'static').map((p) => p.shot)).toEqual([2]);
  });
});

describe('the real Fantasy Room template', () => {
  /* The synthetic graphs above were built from the handle names I assumed.
     The template uses 'image_ref', so the first version of the back-walk
     found nothing here while passing every test in this file. */
  const room: any = (BUILTIN_TEMPLATES as any[]).find((t) => t.id === 'tpl_room_transform');
  const targets = orderShotTargets('story', room.nodes, room.edges);

  it('reads every job off the wiring', () => {
    /* Four since the empty-room still was added. It feeds Part 1's first
       frame, so it reads as a reference without anything declaring it one —
       and Part 1 stays a shot rather than becoming a continuation, because
       what pins it is a still and not the end of another clip. */
    expect(targets.map((t) => [t.id, t.role])).toEqual([
      ['board', 'reference'],
      ['before', 'reference'],
      ['part1', 'shot'],
      ['part2', 'continuation'],
    ]);
  });

  it('knows which shots each reference is for', () => {
    // Naming only the first consumer is how this read before.
    expect(targets[0].referenceFor).toBe('Empty room — first frame and Part 2 — 10s');
    expect(targets[1].referenceFor).toBe('Part 1 — 10s');
  });

  it('sees Part 1 opening on a fixed first frame rather than inventing one', () => {
    const part1 = targets.find((t) => t.id === 'part1');
    expect(part1?.mode).toBe('frames');
    expect(part1?.hasStartFrame).toBe(true);
  });

  it('sees that Part 2 continues Part 1 through the Last Frame node', () => {
    expect(targets[3].continues).toBe('Part 1 — 10s');
  });

  it('briefs Part 2 not to restart the room', () => {
    const c = shotContract(targets);
    expect(c).toContain('Picks up exactly where "Part 1 — 10s" ended');
    expect(c).toContain('already built as already present');
  });

  it('ships the rules and the structure the format needs', () => {
    const d = room.nodes.find((n: any) => n.id === 'story').data;
    expect(d.structure).toBe('transform');
    expect(d.rules).toEqual(['cumulative', 'fixedCamera', 'samePerson', 'inHand']);
  });
});

describe('a reference is not held to the shots', () => {
  const targets = orderShotTargets('story', characterFirst.nodes as any, characterFirst.edges as any);
  const anchor = 'a young dancer in a red tracksuit on a polished studio floor under warm light';

  it('is not failed for continuity', () => {
    /* The rule catches a SHOT that dropped the shared identity. A reference
       is what that identity is defined BY — the shots match it, not it them.
       Backwards, it failed a room design sheet for not describing the person
       who walks into the room. */
    const ref = 'A plain grey studio backdrop with even light and a marked floor, nothing else '
      + 'in frame, shot straight on so the whole space reads clearly.';
    const clip = 'The young dancer in the red tracksuit spins across the polished floor under '
      + 'warm light as the camera holds steady.';
    const problems = checkShots(
      [{ n: 1, title: 'Ref', prompt: ref }, { n: 2, title: 'Dance', prompt: clip }],
      targets, anchor,
    );
    expect(problems.filter((p) => p.shot === 1)).toEqual([]);
  });

  it('still holds the shots to it', () => {
    const ref = 'A plain grey studio backdrop with even light and a marked floor, nothing else '
      + 'in frame, shot straight on so the whole space reads clearly.';
    const drifted = 'A man in a grey suit strides through a dark marble lobby while the camera '
      + 'tracks him past a row of tall windows.';
    const problems = checkShots(
      [{ n: 1, title: 'Ref', prompt: ref }, { n: 2, title: 'Dance', prompt: drifted }],
      targets, anchor,
    );
    expect(problems.filter((p) => p.code === 'continuity').map((p) => p.shot)).toEqual([2]);
  });
});
