/// <reference types="node" />

import fs from 'node:fs';
import path from 'node:path';
import {
  chiefLayoutProblem, chiefPrompt, connectedDirectors, parseChiefReply,
} from '../studio/ask/chief';
import { checkPlan } from '../studio/builder/check';
import { compilePlan, type Plan } from '../studio/builder/plan';
import { buildSpec } from '../studio/builder/spec';

const nodes: any[] = [
  { id: 'chief', type: 'chief', position: { x: 0, y: 0 }, data: { label: 'Chief' } },
  { id: 'late', type: 'story', position: { x: 400, y: 500 }, data: { label: 'Scenes 6–10' } },
  { id: 'early', type: 'story', position: { x: 400, y: 100 }, data: { label: 'Scenes 1–5' } },
  { id: 'clip1', type: 'generate', position: { x: 900, y: 100 }, data: { label: 'Opening', mediaType: 'video', platform: 'flow', duration: '4s' } },
  { id: 'clip6', type: 'generate', position: { x: 900, y: 500 }, data: { label: 'Twist', mediaType: 'video', platform: 'flow', duration: '4s' } },
];

const edges: any[] = [
  { source: 'chief', target: 'late', sourceHandle: 'text', targetHandle: 'text' },
  { source: 'chief', target: 'early', sourceHandle: 'text', targetHandle: 'text' },
  { source: 'early', target: 'clip1', sourceHandle: 'text', targetHandle: 'text' },
  { source: 'late', target: 'clip6', sourceHandle: 'text', targetHandle: 'text' },
];

describe('Director Chief planning', () => {
  const children = connectedDirectors('chief', nodes, edges);

  it('finds only directly connected Directors in canvas order with their own targets', () => {
    expect(children.map((d) => [d.id, d.label, d.targets.map((t) => t.label)]))
      .toEqual([
        ['early', 'Scenes 1–5', ['Opening']],
        ['late', 'Scenes 6–10', ['Twist']],
      ]);
  });

  it('requires two or three Directors and at least one target per Director', () => {
    expect(chiefLayoutProblem(children)).toBeUndefined();
    expect(chiefLayoutProblem(children.slice(0, 1))).toMatch(/two or three/i);
    expect(chiefLayoutProblem([...children, children[0], children[1]])).toMatch(/two or three/i);
    expect(chiefLayoutProblem([{ ...children[0], targets: [] }, children[1]]))
      .toMatch(/Scenes 1–5/);
  });

  it('asks for one bounded assignment per connected Director', () => {
    const prompt = chiefPrompt('A contestant chooses one of three doors.', children);
    expect(prompt).toContain('"directorId": "early"');
    expect(prompt).toContain('Opening — video, 4s');
    expect(prompt).toContain('Do NOT write final generator prompts');
  });

  it('parses the global bible and aligns assignments by Director id', () => {
    const reply = JSON.stringify({
      story: 'A fast three-door choice game.',
      cast: [{ name: 'Riko', look: 'Fictional captain in a green jersey.' }],
      world: 'One fixed room with three doors.',
      look: 'Glossy 3D cartoon.',
      structure: 'hook',
      cameraProgression: 'fixed',
      audioMode: 'cinematic',
      visualPreset: 'cgi3d',
      rules: ['fixedCamera', 'samePerson'],
      timedBeats: true,
      avoid: 'logos',
      directors: [
        { directorId: 'late', brief: 'Handle the twist and final reaction.' },
        { directorId: 'early', brief: 'Handle the hook and first assignments.' },
      ],
    });
    const parsed = parseChiefReply(reply, children);
    expect(parsed.problem).toBeUndefined();
    expect(parsed.plan?.assignments.get('early')).toContain('first assignments');
    expect(parsed.plan?.settings).toMatchObject({
      world: 'One fixed room with three doors.',
      look: 'Glossy 3D cartoon.',
      cameraProgression: 'fixed',
    });
  });

  it('refuses a reply that leaves one connected Director unassigned', () => {
    const parsed = parseChiefReply(JSON.stringify({
      story: 'A story.', cast: [], world: 'A room.', look: '3D cartoon.',
      directors: [{ directorId: 'early', brief: 'Only half.' }],
    }), children);
    expect(parsed.problem).toMatch(/Scenes 6–10/);
  });

  it('refuses unknown or duplicate Director assignments', () => {
    const base = {
      story: 'A story.', cast: [], world: 'A room.', look: '3D cartoon.',
    };
    expect(parseChiefReply(JSON.stringify({
      ...base,
      directors: [
        { directorId: 'early', brief: 'First.' },
        { directorId: 'late', brief: 'Second.' },
        { directorId: 'invented', brief: 'Should not exist.' },
      ],
    }), children).problem).toMatch(/unknown/i);
    expect(parseChiefReply(JSON.stringify({
      ...base,
      directors: [
        { directorId: 'early', brief: 'First.' },
        { directorId: 'early', brief: 'Duplicate.' },
        { directorId: 'late', brief: 'Second.' },
      ],
    }), children).problem).toMatch(/duplicate/i);
  });
});

describe('Director Chief builder plans', () => {
  const plan = {
    name: 'Chief hierarchy',
    description: 'One Chief delegates two scene groups.',
    steps: [
      { id: 'chief', type: 'chief', platform: 'chatgpt', prompt: 'A ten-shot story.' },
      { id: 'early', type: 'story', platform: 'chatgpt', inputs: ['chief'] },
      { id: 'late', type: 'story', platform: 'claude', inputs: ['chief'] },
      { id: 'shot1', type: 'generate', media: 'video', platform: 'flow', inputs: ['early'] },
      { id: 'shot6', type: 'generate', media: 'video', platform: 'flow', inputs: ['late'] },
    ],
  } as Plan;

  it('compiles the hierarchy with Chief-to-Director text connections', () => {
    const built = compilePlan(plan);
    expect(built.problems).toEqual([]);
    expect(built.template?.nodes.some((node) => node.type === 'chief')).toBe(true);
    expect(built.template?.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'chief', target: 'early', targetHandle: 'text' }),
      expect.objectContaining({ source: 'chief', target: 'late', targetHandle: 'text' }),
    ]));
  });

  it('rejects a Chief with the wrong number or kind of children', () => {
    const oneChild = {
      ...plan,
      steps: plan.steps.filter((step) => !['late', 'shot6'].includes(step.id)),
    } as Plan;
    expect(compilePlan(oneChild).problems.join(' ')).toMatch(/two or three/i);

    const directShot = {
      ...plan,
      steps: plan.steps.map((step) => step.id === 'shot1'
        ? { ...step, inputs: ['chief'] }
        : step),
    } as Plan;
    expect(compilePlan(directShot).problems.join(' ')).toMatch(/only Director/i);
  });

  it('accepts multiple Directors when one Chief controls all of them', () => {
    expect(checkPlan(plan).map((problem) => problem.code)).not.toContain('lonelyStory');
  });

  it('teaches the workflow builder to split large plans under one Chief', () => {
    const spec = buildSpec('A ten-scene vertical story.');
    expect(spec).toContain('"type": "chief"');
    expect(spec).toContain('ONE Chief feeding TWO OR THREE Directors');
    expect(spec).toContain('Do not wire the Chief directly to generated assets');
  });
});

describe('Chief-controlled Director UI', () => {
  it('shows the inherited lock and disables global story controls', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, '../studio/nodes/StoryNode.tsx'),
      'utf8',
    );
    expect(source).toContain('const chiefControlled =');
    expect(source).toContain('Controlled by Director Chief');
    expect(source).toContain('disabled={chiefControlled}');
  });
});

describe('the order the groups run in', () => {
  /* The assignments are sequential — each group opens where the last one
     closed — and the order comes from where the nodes sit on the canvas.
     Listing them without saying so left the model to infer a sequence from the
     order of a list, which it may or may not read as one. */

  const children = connectedDirectors('chief', nodes as any, edges as any);

  it('numbers the groups instead of implying an order', () => {
    const prompt = chiefPrompt('A contestant chooses one of three doors.', children);
    expect(prompt).toContain('GROUP 1 OF 2');
    expect(prompt).toContain('GROUP 2 OF 2');
  });

  it('spells the running order out in words as well', () => {
    const prompt = chiefPrompt('A contestant chooses one of three doors.', children);
    expect(prompt).toMatch(/The groups run in this order: 1\. Scenes 1–5\s+→\s+2\. Scenes 6–10\./);
  });

  it('keeps the order the canvas gives it', () => {
    /* Position decides, which is exactly why the node now shows the number. */
    expect(children.map((d) => d.label)).toEqual(['Scenes 1–5', 'Scenes 6–10']);
  });
});

describe('two groups given the same job', () => {
  const children = connectedDirectors('chief', nodes as any, edges as any);

  const reply = (a: string, b: string) => JSON.stringify({
    story: 'A contestant picks a door and lives with it.',
    world: 'A studio floor with three numbered doors.',
    look: 'Hard key light, saturated game-show palette.',
    cast: [{ name: 'Host', look: 'Silver suit, headset mic' }],
    directors: [
      { directorId: 'early', brief: a },
      { directorId: 'late', brief: b },
    ],
  });

  it('is refused, naming both', () => {
    /* Every id present and unique still admits the same assignment twice — a
       model taking the cheap way out — and that gives both groups the same
       section, which is worse than one Director doing the lot. */
    const out = parseChiefReply(reply('Open on the doors.', 'Open on the doors.'), children);
    expect(out.plan).toBeUndefined();
    expect(out.problem).toMatch(/Scenes 1–5/);
    expect(out.problem).toMatch(/Scenes 6–10/);
    expect(out.problem).toMatch(/same assignment/i);
  });

  it('is still refused when only the spacing and case differ', () => {
    /* A model repeating itself rarely repeats itself byte for byte. */
    const out = parseChiefReply(
      reply('Open on the doors.', '  OPEN   ON THE  DOORS.  '), children,
    );
    expect(out.plan).toBeUndefined();
    expect(out.problem).toMatch(/same assignment/i);
  });

  it('accepts two assignments that are genuinely different work', () => {
    const out = parseChiefReply(
      reply('Open on the doors and the host explaining the rules.',
        'The contestant commits, and the chosen door opens.'), children,
    );
    expect(out.problem).toBeUndefined();
    expect(out.plan?.assignments.size).toBe(2);
  });
});

describe('what each child is told about its place', () => {
  const children = connectedDirectors('chief', nodes as any, edges as any);
  const out = parseChiefReply(JSON.stringify({
    story: 'A contestant picks a door and lives with it.',
    world: 'A studio floor with three numbered doors.',
    look: 'Hard key light, saturated game-show palette.',
    cast: [{ name: 'Host', look: 'Silver suit, headset mic' }],
    directors: [
      { directorId: 'early', brief: 'The rules, and the choosing.' },
      { directorId: 'late', brief: 'The door opens and the room reacts.' },
    ],
  }), children);

  const brief = (id: string) => out.plan?.assignments.get(id) || '';

  it('tells each one which part it is', () => {
    /* A Director that does not know it is the middle of three cannot tell a
       handover from an opening, and the one it writes reads like a beginning. */
    expect(brief('early')).toContain('YOU ARE PART 1 OF 2');
    expect(brief('late')).toContain('YOU ARE PART 2 OF 2');
  });

  it('names what comes before and after, by label', () => {
    expect(brief('late')).toContain('“Scenes 1–5” comes immediately before you');
    expect(brief('early')).toContain('“Scenes 6–10” follows you');
  });

  it('tells the first that it opens and the last that it ends', () => {
    expect(brief('early')).toContain('Nothing comes before you');
    expect(brief('late')).toContain('Nothing follows you');
  });

  it('still carries the global story and the lock notice', () => {
    for (const id of ['early', 'late']) {
      expect(brief(id)).toContain('GLOBAL STORY:');
      expect(brief(id)).toContain('locked cast, world, look');
    }
  });
});

describe('the Director card shows where it sits', () => {
  /* Position decides the story order, so a drag is a story edit. That is not
     something anyone expects a drag to be, so the number is on the card. */
  const STORY = fs.readFileSync(
    path.resolve(__dirname, '../studio/nodes/StoryNode.tsx'), 'utf8',
  ).replace(/\r\n/g, '\n');

  it('works the part number out from the same left-to-right order', () => {
    expect(STORY).toMatch(/const chiefGroup = \(\) => \{|const chiefGroup = \(\(\) => \{/);
    expect(STORY).toMatch(/\(a\.position\?\.x \|\| 0\) - \(b\.position\?\.x \|\| 0\)/);
  });

  it('shows it, and says a drag reorders the story', () => {
    expect(STORY).toMatch(/part \$\{chiefGroup\.part\} of \$\{chiefGroup\.of\}/);
    expect(STORY).toMatch(/changes the order of the story/);
  });

  it('says nothing when there is no sibling to be ordered against', () => {
    expect(STORY).toMatch(/siblings\.length < 2 \? null/);
  });
});
