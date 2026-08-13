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
import { composeAskPrompt } from '../studio/presets';

const room: any = (BUILTIN_TEMPLATES as any[]).find((t) => t.id === 'tpl_room_transform');

describe('the Fantasy Room template', () => {
  it('is still a valid, runnable graph', () => {
    expect(room).toBeTruthy();
    expect(validateTemplate(room)).toEqual([]);
    expect(capabilityGap(room, { version: '99.0.0' })).toBeNull();
    expect(room.nodes).toHaveLength(room.nodeCount);
  });

  it('lets an Ask AI write both motion prompts instead of shipping mine', () => {
    const motion = room.nodes.find((n: any) => n.id === 'motion');
    expect(motion).toBeTruthy();
    expect(motion.data.preset).toBe('room_motion_director');
    // The static prompt nodes that used to hold a hardcoded candy lounge.
    expect(room.nodes.find((n: any) => n.id === 'p1')).toBeUndefined();
    expect(room.nodes.find((n: any) => n.id === 'p2')).toBeUndefined();
  });

  it('routes shot 1 to Part 1 and shot 2 to Part 2', () => {
    /* The failure this guards against is silent: the clips still render, they
       are just each other's. Order comes from canvas position, so a template
       whose Part 2 sat left of Part 1 would swap them. */
    const targets = orderShotTargets('motion', room.nodes, room.edges);
    expect(targets.map((t) => t.id)).toEqual(['part1', 'part2']);
    expect(targets.map((t) => t.media)).toEqual(['video', 'video']);
    expect(targets.map((t) => t.platform)).toEqual(['flow', 'flow']);
  });

  it('treats the poster node as one shot, not a set', () => {
    // One consumer, so one prompt — it must not be handed the whole set.
    expect(orderShotTargets('story', room.nodes, room.edges).map((t) => t.id)).toEqual(['board']);
  });

  it('builds a brief that carries the craft and demands both halves', () => {
    const targets = orderShotTargets('motion', room.nodes, room.edges);
    const brief = composeAskPrompt('room_motion_director', 'A candy-themed lounge', false)
      + '\n' + shotContract(targets);

    // The rules that used to live in the static prompts.
    for (const rule of ['hyperlapse', 'fixed medium-wide camera', 'red sporty tracksuit', 'IN HER HANDS']) {
      expect({ rule, present: brief.includes(rule) }).toEqual({ rule, present: true });
    }
    // The continuity contract between the halves.
    expect(brief).toContain('becomes the first frame of Part 2');
    expect(brief).toContain('never restart');
    // And the envelope.
    expect(brief).toContain('WRITE ALL 2 PROMPTS');
    expect(brief).toContain('Part 1 — 10s');
    expect(brief).toContain('Part 2 — 10s');
    expect(brief).toContain('must say what MOVES');
    expect(brief).toContain('A candy-themed lounge');
  });
});

describe('a realistic reply for this template', () => {
  const targets = orderShotTargets('motion', room.nodes, room.edges);

  const anchor = 'the same blonde designer in a bright red tracksuit inside the tall pink '
    + 'peppermint lounge, one fixed medium-wide camera';
  const p1 = 'Vertical 9:16 ultra-realistic extreme fast hyperlapse. One fixed medium-wide '
    + 'camera inside a tall pink peppermint lounge. The same blonde designer in a bright red '
    + 'tracksuit and white sneakers walks in carrying glowing floor rails and lays them across '
    + 'the boards, connecting them by hand until they glow, then pours a glossy candy layer '
    + 'over them and presses the first wall piece into place.';
  const p2 = 'Vertical 9:16 ultra-realistic extreme fast hyperlapse. One fixed medium-wide '
    + 'camera inside the same tall pink peppermint lounge with the glowing floor already lit. '
    + 'The same blonde designer in a bright red tracksuit mounts the remaining wall pieces, '
    + 'climbs a ladder and installs the cotton-candy ceiling, then moves the cloud couch into '
    + 'place as every light stays on.';

  it('passes the checker end to end', () => {
    const reply = 'Here you go:\n```json\n' + JSON.stringify({
      story: 'One room built in two continuous halves.',
      anchor,
      shots: [{ n: 1, title: 'Part 1', prompt: p1 }, { n: 2, title: 'Part 2', prompt: p2 }],
    }) + '\n```';
    const parsed = parseShots(reply);
    expect(parsed.shots).toHaveLength(2);
    expect(checkShots(parsed.shots, targets, parsed.anchor)).toEqual([]);
  });

  it('catches the failure this template is famous for', () => {
    // Describing the storyboard instead of the room — the exact thing the
    // brief has warned about in prose since the template shipped, and which
    // nothing checked until now.
    const bad = p2.replace('mounts the remaining wall pieces', 'follows panel 3 of the storyboard');
    const problems = checkShots(
      [{ n: 1, title: 'a', prompt: p1 }, { n: 2, title: 'b', prompt: bad }],
      targets, anchor,
    );
    expect(problems.map((x) => x.code)).toContain('storyboard');
  });

  it('catches Part 2 quietly restarting the room', () => {
    // Drops every anchor detail: a different person in an empty room.
    const restart = 'Extreme fast hyperlapse. A fixed camera watches an empty grey studio as '
      + 'someone walks in and begins laying out equipment across the bare concrete floor.';
    const problems = checkShots(
      [{ n: 1, title: 'a', prompt: p1 }, { n: 2, title: 'b', prompt: restart }],
      targets, anchor,
    );
    expect(problems.filter((p) => p.code === 'continuity').map((p) => p.shot)).toEqual([2]);
  });
});

describe('a single-target Ask AI still comes back as JSON', () => {
  /* The storyboard poster node has one consumer. It used to hand its raw reply
     straight to the image generator, so "Here's a prompt for your poster:" was
     typed into the composer along with the prompt. */
  const targets = orderShotTargets('story', room.nodes, room.edges);

  it('addresses exactly the one node it feeds', () => {
    expect(targets.map((t) => t.id)).toEqual(['board']);
    expect(targets[0].media).toBe('image');
  });

  it('asks for the envelope without pretending there is a set', () => {
    const c = shotContract(targets);
    expect(c).toContain('RETURN IT AS JSON');
    expect(c).not.toContain('WRITE ALL 1 PROMPTS');
    expect(c).not.toContain('produces a stranger');   // the continuity speech
    expect(c).toContain('"shots"');
    expect(c).toContain('Storyboard poster');
  });

  it('does not demand motion from a still', () => {
    expect(shotContract(targets)).not.toContain('must say what MOVES');
  });

  it('strips the preamble that used to reach the composer', () => {
    const reply = 'Sure! Here is the prompt for your poster:\n\n'
      + '{"story":"a poster","shots":[{"n":1,"title":"Poster","prompt":'
      + '"A vertical guide poster of a tall pink peppermint lounge, five numbered stages of '
      + 'its build laid out top to bottom, bright and glossy and evenly lit."}]}';
    const parsed = parseShots(reply);
    expect(parsed.shots).toHaveLength(1);
    expect(parsed.shots[0].prompt.startsWith('A vertical guide poster')).toBe(true);
    expect(parsed.shots[0].prompt).not.toContain('Sure!');
  });

  it('lets the poster describe panels, because a poster has them', () => {
    /* The storyboard rule exists for CLIP prompts — a clip that mentions
       panels animates the poster. The poster itself is allowed to be one, so
       the rule must not fire here or the node could never succeed. */
    const poster = 'A vertical guide poster showing five numbered panels with short captions, '
      + 'each one a stage of the pink peppermint lounge being built, bright and glossy.';
    const problems = checkShots([{ n: 1, title: 'Poster', prompt: poster }], targets);
    expect(problems.map((p) => p.code)).toEqual([]);
  });
});
