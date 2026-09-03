/**
 * Where a transformation starts.
 *
 * Reported as: the room time-lapse does not begin with an empty room. It
 * begins halfway through itself — floor already laid, some furniture in — and
 * then builds on top of that, so the "before" the whole format depends on
 * never exists.
 *
 * The instinct is that the prompt is missing the word "empty". It is not. The
 * room preset has said this since the day it was written:
 *
 *   PART 1 covers 00:00–00:10: the empty room, the glowing floor base, ...
 *
 * The words were there and the room still arrived furnished, because of what
 * was wired next to them: Part 1's reference image was the storyboard poster,
 * and a storyboard poster shows the FINISHED design. Flow was handed a
 * sentence saying empty and a picture showing furnished. A picture wins.
 *
 * So the fix is mostly about the picture:
 *   - the template generates an empty-room still and pins it to Part 1's
 *     FIRST FRAME, not its ingredients — Frames mode begins the clip inside
 *     that image rather than being influenced by it;
 *   - the poster is briefed to show the starting state as well as the design,
 *     since the empty still is drawn from it;
 *   - the brief tells the writer which of those two cases it is in;
 *   - and the checker fails an opening shot that says nothing about being
 *     empty, because everything above is still only a request.
 */

/// <reference types="node" />

import {
  storyBrief, openingState, isBuild, DEFAULT_STORY, type StorySettings,
} from '../studio/ask/storyPlan';
import {
  checkShots, orderShotTargets, type Shot, type ShotTarget,
} from '../studio/ask/storyboard';
import { BUILTIN_TEMPLATES } from '../studio/templates/index';
import { validateTemplate, isFramesMode } from '../studio/templates/validate';

const clip = (id: string, label: string, extra: Partial<ShotTarget> = {}): ShotTarget =>
  ({ id, label, media: 'video', platform: 'flow', duration: '10s', role: 'shot', ...extra });

const ref = (id: string, label: string, referenceFor: string): ShotTarget =>
  ({ id, label, media: 'image', platform: 'chatgpt', role: 'reference', referenceFor });

const build = (over: Partial<StorySettings> = {}): StorySettings =>
  ({ ...DEFAULT_STORY, structure: 'transform', ...over });

describe('what counts as a build', () => {
  it('is the structure or the rule, either alone', () => {
    expect(isBuild({ ...DEFAULT_STORY, structure: 'transform' })).toBe(true);
    expect(isBuild({ ...DEFAULT_STORY, rules: ['cumulative'] })).toBe(true);
  });

  it('counts the construction and craft structures, which it used to miss', () => {
    /* Both arrived after isBuild was written and neither was added, so a user
       who picked "Construction Timelapse Build" and nothing else got no
       opening-state instruction and no check on it. The failure is silent and
       expensive: the first clip opens on a half-built structure, which is
       precisely what openNotFromNothing exists to catch, on the two structures
       most likely to hit it. */
    expect(isBuild({ ...DEFAULT_STORY, structure: 'buildTimelapse' })).toBe(true);
    expect(isBuild({ ...DEFAULT_STORY, structure: 'craftTransform' })).toBe(true);
  });

  it('tells a construction piece its opening has to be empty', () => {
    const b = storyBrief('a garden wall', { ...DEFAULT_STORY, structure: 'buildTimelapse' },
      [clip('a', 'One'), clip('b', 'Two')]);
    expect(b).toMatch(/This piece BUILDS/);
  });

  it('is not every piece', () => {
    /* A piece that opens in a busy kitchen and stays there has no "before",
       and telling it to start empty would be telling it to start wrong. */
    expect(isBuild(DEFAULT_STORY)).toBe(false);
    expect(storyBrief('x', DEFAULT_STORY, [clip('a', 'One')]))
      .not.toMatch(/This piece BUILDS/);
  });
});

describe('when nothing pins the first frame', () => {
  const targets = [clip('a', 'Part 1'), clip('b', 'Part 2')];

  it('says the opening state is being invented from the words alone', () => {
    const text = storyBrief('a room built in a day', build(), targets);
    expect(text).toContain('OPENING STATE');
    expect(text).toContain('Nothing upstream fixes the first frame of Part 1');
    expect(text).toMatch(/renders something halfway through it/);
  });

  it('asks for every later arrival to be named as absent', () => {
    const text = storyBrief('x', build(), targets);
    expect(text).toMatch(/state before ANY of them/);
    /* Phrased as presence, which is Google's guidance and the same rule the
       "avoid" field already teaches — a bare negation summons what it names. */
    expect(text).toMatch(/things the place is WITHOUT/);
  });

  it('still states the opening for a piece that does not build', () => {
    /* The first shot is unpinned whatever the structure, and an unpinned
       opening always has to describe where the piece starts. Only the
       emptiness half is about building. */
    const text = storyBrief('x', DEFAULT_STORY, targets);
    expect(text).toContain('OPENING STATE');
    expect(text).not.toMatch(/This piece BUILDS/);
  });
});

describe('when a still pins the first frame', () => {
  const targets = [
    ref('empty', 'Empty room', 'Part 1'),
    clip('a', 'Part 1', { mode: 'frames', hasStartFrame: true }),
    clip('b', 'Part 2'),
  ];

  it('names the still, and says the clip begins inside it', () => {
    const text = storyBrief('x', build(), targets);
    expect(text).toContain('"Empty room" IS the first frame of Part 1');
    expect(text).toMatch(/the shot\s+that has to be right about the beginning, not the clip/);
  });

  it('does not tell the clip to invent an opening it was given', () => {
    expect(storyBrief('x', build(), targets)).not.toContain('Nothing upstream fixes');
  });

  it('warns that a design sheet shows the finished thing', () => {
    const text = storyBrief('x', build(), targets);
    expect(text).toMatch(/a design sheet naturally shows the\s+FINISHED piece/);
    expect(text).toMatch(/same\s+place, same angle, empty/);
  });

  it('says nothing about design sheets when there are none', () => {
    expect(storyBrief('x', build(), [clip('a', 'Part 1')]))
      .not.toMatch(/design sheet/);
  });

  it('is silent when there are no shots at all', () => {
    expect(openingState(build(), [])).toEqual([]);
  });
});

describe('the checker', () => {
  const targets = [
    ref('empty', 'Empty room', 'Part 1'),
    clip('a', 'Part 1', { mode: 'frames', hasStartFrame: true }),
    clip('b', 'Part 2'),
  ];
  const EMPTY = 'The tall pink lounge from one fixed medium-wide angle: bare grey boards, '
    + 'unpainted walls, no furniture and no lighting, daylight from the window wall.';
  const FURNISHED = 'The tall pink lounge from one fixed medium-wide angle, glossy candy '
    + 'floor, the lollipop arch on the main wall and the cloud couch in the middle.';
  const P1 = 'Extreme fast hyperlapse, one fixed camera, as the blonde designer in a red '
    + 'tracksuit walks in and lays glowing rails across the bare boards of the empty room.';
  const P2 = 'Extreme fast hyperlapse, one fixed camera, the floor already glowing, as the '
    + 'blonde designer in a red tracksuit mounts the wall panels and moves the couch in.';

  const run = (empty: string, one: string, opts?: { build?: boolean }) =>
    checkShots(
      [
        { n: 1, title: 'Empty room', prompt: empty } as Shot,
        { n: 2, title: 'Part 1', prompt: one } as Shot,
        { n: 3, title: 'Part 2', prompt: P2 } as Shot,
      ],
      targets, 'the blonde designer in a red tracksuit, the tall pink lounge',
      undefined, opts,
    ).map((p) => `${p.shot}:${p.code}`);

  it('passes a set that starts from nothing', () => {
    expect(run(EMPTY, P1, { build: true })).toEqual([]);
  });

  it('fails the still that pins the opening when it shows a finished room', () => {
    /* The actual bug: a perfect description of an empty room in the clip,
       generated from a picture of a furnished one. Checking only the clip
       would have passed this. */
    expect(run(FURNISHED, P1, { build: true })).toContain('1:openNotFromNothing');
  });

  it('fails the opening clip when it says nothing about being empty', () => {
    const furnishedOpen = P1.replace('the bare boards of the empty room', 'the glossy floor');
    expect(run(EMPTY, furnishedOpen, { build: true })).toContain('2:openNotFromNothing');
  });

  it('never fails a shot that is not the opening', () => {
    /* Part 2 must NOT be empty — it continues a room that is half built, and
       failing it for that would be failing it for being correct. */
    expect(run(EMPTY, P1, { build: true }).some((c) => c.startsWith('3:'))).toBe(false);
  });

  it('is silent on a piece that does not build', () => {
    expect(run(FURNISHED, P1)).not.toContain('1:openNotFromNothing');
    expect(run(FURNISHED, P1, { build: false })).not.toContain('1:openNotFromNothing');
  });

  it('accepts either way of saying it', () => {
    /* An adjective for the state, or an absence named inside the description.
       The second is what the brief teaches, but failing the first would fail a
       correct answer for using the other half of the same instruction. */
    const base = 'The tall pink lounge from one fixed medium-wide angle, daylight from the '
      + 'window wall on the left, ';
    for (const phrasing of ['a completely empty room.', 'stripped back to the boards.',
      'unfurnished and undecorated.', 'with no furniture at all.',
      'before any of the work has started.', 'bare concrete underfoot.']) {
      expect(run(base + phrasing, P1, { build: true })).not.toContain('1:openNotFromNothing');
    }
  });

  it('does not read ordinary shot description as emptiness', () => {
    /* "Nothing moves", "nothing in her hands" say nothing about the room, so
       they must not satisfy the rule — a check that passes on any prompt is
       not a check. */
    const notEmpty = 'The tall pink lounge, glossy candy floor and the cloud couch already '
      + 'in place, nothing moves and nothing is in her hands as she looks around.';
    expect(run(notEmpty, P1, { build: true })).toContain('1:openNotFromNothing');
  });
});

describe('the room template, rewired', () => {
  const room: any = (BUILTIN_TEMPLATES as any[]).find((t) => t.id === 'tpl_room_transform');
  const targets = orderShotTargets('story', room.nodes, room.edges);

  it('is still valid', () => {
    expect(validateTemplate(room)).toEqual([]);
    expect(room.nodes).toHaveLength(room.nodeCount);
  });

  it('generates an empty room and makes it Part 1\'s actual first frame', () => {
    const part1 = room.nodes.find((n: any) => n.id === 'part1');
    expect(isFramesMode(part1.data)).toBe(true);
    expect(room.edges).toContainEqual(expect.objectContaining({
      source: 'before', target: 'part1', targetHandle: 'frame_start',
    }));
  });

  it('no longer hands Part 1 a picture of the finished room', () => {
    /* The whole bug in one line. Frames mode has no image_ref port at all, so
       this cannot come back by accident — the validator would reject it. */
    expect(room.edges.some((e: any) => e.source === 'board' && e.target === 'part1'))
      .toBe(false);
  });

  it('draws the empty room from the poster, so the two agree about the room', () => {
    expect(room.edges).toContainEqual(expect.objectContaining({
      source: 'board', target: 'before', targetHandle: 'image_ref',
    }));
  });

  it('briefs the empty still as the opening, off the wiring alone', () => {
    const d = room.nodes.find((n: any) => n.id === 'story').data;
    const text = storyBrief('A candy-themed lounge', {
      ...DEFAULT_STORY, structure: d.structure, rules: d.rules,
    }, targets);
    expect(text).toContain('OPENING STATE');
    expect(text).toContain('"Empty room — first frame" IS the first frame of Part 1 — 10s');
    expect(text).toMatch(/This piece BUILDS/);
  });

  it('leaves Part 2 continuing from Part 1', () => {
    const part2 = targets.find((t) => t.id === 'part2');
    expect(part2?.role).toBe('continuation');
    expect(part2?.continues).toContain('Part 1');
  });
});
