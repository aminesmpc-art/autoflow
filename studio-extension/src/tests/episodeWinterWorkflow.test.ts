/// <reference types="node" />
import { readFileSync } from 'fs';
import { join } from 'path';
import { validateTemplate } from '../studio/templates/validate';
import { connectedDirectors, chiefLayoutProblem } from '../studio/ask/chief';

describe.each([
  ['EPISODE-1-VEO-QUALITY-CHAIN.import.json', 'Veo 3.1 - Quality'],
  ['EPISODE-1-OMNI-CHAIN.import.json', 'Omni 1.1 Flash'],
])('%s', (file, model) => {
const kit = JSON.parse(readFileSync(join(__dirname, '../../../outputs/episode-1-winter-shelter', file), 'utf8'));
const num = (i: number) => String(i).padStart(2, '0');

test('episode imports with one opening image and twelve selected-model videos', () => {
  expect(validateTemplate(kit)).toEqual([]);
  expect(kit.nodeCount).toBe(29);
  expect(kit.nodes.filter((n: any) => n.data.mediaType === 'image').map((n: any) => n.id)).toEqual(['still_01']);
  const videos = kit.nodes.filter((n: any) => n.data.mediaType === 'video');
  expect(videos).toHaveLength(12);
  videos.forEach((n: any) => expect(n.data).toMatchObject({ platform: 'flow', model, creationType: 'frames', status: 'idle', duration: '8s' }));
  expect(kit.nodes.find((n: any) => n.id === 'brief').data.text).toContain(model);
});

test('every clip inherits exactly the preceding last frame across all directors', () => {
  expect(kit.nodes.filter((n: any) => n.type === 'frame')).toHaveLength(11);
  for (let i = 1; i <= 12; i++) {
    const starts = kit.edges.filter((e: any) => e.target === `clip_${num(i)}` && e.targetHandle === 'frame_start');
    expect(starts).toHaveLength(1);
    expect(starts[0].source).toBe(i === 1 ? 'still_01' : `last_${num(i - 1)}`);
    if (i > 1) expect(kit.edges.filter((e: any) => e.target === `last_${num(i - 1)}`)).toEqual([
      expect.objectContaining({ source: `clip_${num(i - 1)}`, sourceHandle: 'result', targetHandle: 'image_ref' }),
    ]);
  }
});

test('three bounded directors preserve six family identities and final standoff', () => {
  const directors = connectedDirectors('chief', kit.nodes, kit.edges);
  expect(chiefLayoutProblem(directors)).toBeUndefined();
  expect(directors.map(d => d.targets.map(t => t.id))).toEqual([
    ['still_01', 'clip_01', 'clip_02', 'clip_03', 'clip_04'],
    ['clip_05', 'clip_06', 'clip_07', 'clip_08'],
    ['clip_09', 'clip_10', 'clip_11', 'clip_12'],
  ]);
  directors.forEach(d => {
    const data = kit.nodes.find((n: any) => n.id === d.id).data;
    expect(data.cast.map((c: any) => c.name)).toEqual(['POV protagonist', 'Old man', 'Old woman', 'Older boy', 'Younger boy', 'Young child']);
    expect(data.rules).toContain('frameChain');
  });
  expect(kit.nodes.find((n: any) => n.id === 'clip_12').data.prompt).toContain('No attack, escape, resolution, fade or Episode 2');
});

test('episode dependencies are acyclic', () => {
  const active = new Set<string>(), visited = new Set<string>();
  function visit(id: string) {
    if (active.has(id)) throw new Error(`Cycle at ${id}`);
    if (visited.has(id)) return;
    active.add(id);
    kit.edges.filter((e: any) => e.source === id).forEach((e: any) => visit(e.target));
    active.delete(id); visited.add(id);
  }
  kit.nodes.forEach((n: any) => visit(n.id));
  expect(visited.size).toBe(29);
});
});
