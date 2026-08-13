/**
 * The Fantasy Room template, against the storyboard machinery that is supposed
 * to serve it.
 *
 * This template is why the feature exists, and testing it first showed the
 * feature did nothing here at all: the Ask AI node had one text consumer, and
 * the two motion prompts were static text I had written for one imaginary
 * room. Everyone after me was editing my candy lounge by hand.
 */

/// <reference types="node" />

import { BUILTIN_TEMPLATES } from '../studio/templates/index';
import { validateTemplate, capabilityGap } from '../studio/templates/validate';
import { orderShotTargets, shotContract, checkShots, parseShots } from '../studio/ask/storyboard';
import { storyBrief } from '../studio/ask/storyPlan';

const room: any = (BUILTIN_TEMPLATES as any[]).find((t) => t.id === 'tpl_room_transform');
const targets = orderShotTargets('story', room.nodes, room.edges);

describe('the Fantasy Room template', () => {
  it('is still a valid, runnable graph', () => {
    expect(room).toBeTruthy();
    expect(validateTemplate(room)).toEqual([]);
    expect(capabilityGap(room, { version: '99.0.0' })).toBeNull();
    expect(room.nodes).toHaveLength(room.nodeCount);
  });

  it('has one director for all three prompts, not two conversations', () => {
    /* It shipped with an Ask AI writing the poster and a second writing the
       clips, which could not agree about the room because neither could see
       the other's answer. Before that it had two hardcoded prompt nodes
       holding a candy lounge I invented. */
    const writers = room.nodes.filter((n: any) => n.type === 'story');
    expect(writers).toHaveLength(1);
    expect(room.nodes.find((n: any) => n.id === 'p1')).toBeUndefined();
    expect(room.nodes.find((n: any) => n.id === 'motion')).toBeUndefined();
    expect(targets.map((t) => t.id)).toEqual(['board', 'part1', 'part2']);
  });

  it('builds a brief that carries the craft and the shape of the piece', () => {
    const d = room.nodes.find((n: any) => n.id === 'story').data;
    const brief = storyBrief('A candy-themed lounge', {
      cast: [], world: '', look: '', structure: d.structure, beats: 0, rules: d.rules,
    }, targets) + shotContract(targets);

    // The structure, chosen for a transformation rather than left on default.
    expect(brief).toContain('Before → Process → Reveal');
    // The rules that used to be prose inside a preset.
    expect(brief).toContain('nothing is removed, reset');
    expect(brief).toContain('ONE fixed camera');
    expect(brief).toContain('in a person’s hands');
    // The jobs, read off the wiring.
    expect(brief).toContain('NOT a moment in the story');
    expect(brief).toContain('Picks up exactly where');
    // And the arithmetic: 20s of clips.
    expect(brief).toContain('BEATS — 5');
  });

  it('asks each clip for motion and the poster for none', () => {
    const c = shotContract(targets);
    expect(c).toContain('must say what MOVES');
    const posterLine = c.split('\n').find((l) => /^\s+1\./.test(l)) as string;
    expect(posterLine).toContain('a still image');
  });
});

describe('a realistic reply for this template', () => {
  const anchor = 'the same blonde designer in a bright red tracksuit inside the tall pink '
    + 'peppermint lounge, one fixed medium-wide camera';
  const poster = 'A vertical design sheet for a tall pink peppermint lounge, showing the '
    + 'glossy candy floor, the lollipop arch and the cotton-candy ceiling, evenly lit.';
  const p1 = 'Vertical 9:16 ultra-realistic extreme fast hyperlapse. One fixed medium-wide '
    + 'camera inside a tall pink peppermint lounge. The same blonde designer in a bright red '
    + 'tracksuit walks in carrying glowing floor rails and lays them across the boards, then '
    + 'pours a glossy candy layer over them and presses the first wall piece into place.';
  const p2 = 'Vertical 9:16 ultra-realistic extreme fast hyperlapse. One fixed medium-wide '
    + 'camera inside the same tall pink peppermint lounge with the floor already glowing. The '
    + 'same blonde designer in a bright red tracksuit mounts the remaining wall pieces, climbs '
    + 'a ladder to fit the cotton-candy ceiling, then moves the cloud couch into place.';

  it('passes the checker end to end', () => {
    const reply = '```json\n' + JSON.stringify({
      story: 'One room built in two continuous halves.',
      anchor,
      shots: [
        { n: 1, title: 'Poster', prompt: poster },
        { n: 2, title: 'Part 1', prompt: p1 },
        { n: 3, title: 'Part 2', prompt: p2 },
      ],
    }) + '\n```';
    const parsed = parseShots(reply);
    expect(parsed.shots).toHaveLength(3);
    expect(checkShots(parsed.shots, targets, parsed.anchor)).toEqual([]);
  });

  it('catches the failure this template is famous for', () => {
    // A clip describing the poster instead of the room.
    const bad = p2.replace('mounts the remaining wall pieces', 'follows panel 3 of the storyboard');
    const problems = checkShots(
      [{ n: 1, title: 'a', prompt: poster }, { n: 2, title: 'b', prompt: p1 }, { n: 3, title: 'c', prompt: bad }],
      targets, anchor,
    );
    expect(problems.map((x) => x.code)).toContain('storyboard');
  });

  it('lets the poster itself be a design sheet', () => {
    /* The same rule must not fire on the reference: a poster IS panels, and a
       node that could never pass is a node that can never run. */
    const panelly = 'A vertical guide poster of five numbered panels with short captions, '
      + 'each a stage of the pink peppermint lounge being built, bright and evenly lit.';
    const problems = checkShots(
      [{ n: 1, title: 'a', prompt: panelly }, { n: 2, title: 'b', prompt: p1 }, { n: 3, title: 'c', prompt: p2 }],
      targets, anchor,
    );
    expect(problems.filter((x) => x.shot === 1)).toEqual([]);
  });

  it('catches Part 2 quietly restarting the room', () => {
    const restart = 'Extreme fast hyperlapse. A fixed camera watches an empty grey studio as '
      + 'someone walks in and begins laying equipment across the bare concrete floor.';
    const problems = checkShots(
      [{ n: 1, title: 'a', prompt: poster }, { n: 2, title: 'b', prompt: p1 }, { n: 3, title: 'c', prompt: restart }],
      targets, anchor,
    );
    expect(problems.filter((p) => p.code === 'continuity').map((p) => p.shot)).toEqual([3]);
  });
});

describe('the contract describes the node, not just its kind', () => {
  /* An Ask AI used to be told only "a moving clip, generated by flow". It
     would then write "the camera opens on an empty room" for a node whose
     first frame was already pinned by a wired-in image — a prompt fighting
     its own node, and nothing in the graph could tell it otherwise. */
  const nodes = [
    { id: 'ask', type: 'generate', position: { x: 0, y: 0 }, data: { mediaType: 'text' } },
    {
      id: 'clip', type: 'generate', position: { x: 400, y: 0 },
      data: {
        label: 'Continue the shot', mediaType: 'video', platform: 'flow',
        aspectRatio: '9:16', duration: '10s', creationType: 'frames',
      },
    },
    {
      id: 'plain', type: 'generate', position: { x: 800, y: 0 },
      data: { label: 'Opening', mediaType: 'video', platform: 'flow', aspectRatio: '16:9', duration: '8s' },
    },
  ];
  const edges = [
    { source: 'ask', target: 'clip', targetHandle: 'text' },
    { source: 'ask', target: 'plain', targetHandle: 'text' },
    { source: 'startImg', target: 'clip', targetHandle: 'frame_start' },
    { source: 'endImg', target: 'clip', targetHandle: 'frame_end' },
    { source: 'ref', target: 'plain', targetHandle: 'image' },
  ];

  it('reads the settings off the node', () => {
    const [clip, plain] = orderShotTargets('ask', nodes as any, edges as any);
    expect(clip).toMatchObject({
      id: 'clip', aspectRatio: '9:16', duration: '10s',
      mode: 'frames', hasStartFrame: true, hasEndFrame: true,
    });
    expect(plain).toMatchObject({ id: 'plain', aspectRatio: '16:9', mode: 'ingredients', references: 1 });
  });

  it('tells the writer the first frame is already decided', () => {
    const c = shotContract(orderShotTargets('ask', nodes as any, edges as any));
    expect(c).toContain('FIRST frame is already fixed');
    expect(c).toContain('LAST frame is fixed');
    expect(c).toContain('(9:16, 10s, flow)');
  });

  it('tells it a reference guides look, not action', () => {
    const c = shotContract(orderShotTargets('ask', nodes as any, edges as any));
    expect(c).toContain('1 reference image attached');
    expect(c).toContain('guides look, not action');
  });

  it('does not claim a still has a duration', () => {
    const still = [
      { id: 'ask', type: 'generate', position: { x: 0, y: 0 }, data: { mediaType: 'text' } },
      { id: 'img', type: 'generate', position: { x: 400, y: 0 }, data: { mediaType: 'image', platform: 'chatgpt', duration: '10s' } },
    ];
    const [t] = orderShotTargets('ask', still as any, [{ source: 'ask', target: 'img', targetHandle: 'text' }] as any);
    expect(t.duration).toBeUndefined();
  });
});
