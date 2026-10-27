/// <reference types="node" />
import { readFileSync } from 'fs';
import { join } from 'path';
import { validateTemplate } from '../studio/templates/validate';

const kit = JSON.parse(readFileSync(join(__dirname, '../../../outputs/hero-family-rescue/FAMILY-RESCUE-OMNI-NO-DIRECTORS.import.json'), 'utf8'));
const number = (i: number) => String(i).padStart(2, '0');

test('hero workflow imports using only direct prompts, images, videos and frames', () => {
  expect(validateTemplate(kit)).toEqual([]);
  expect(kit.nodeCount).toBe(26);
  expect(kit.nodes.every((n: any) => ['prompt', 'image', 'generate', 'frame'].includes(n.type))).toBe(true);
  expect(kit.nodes.filter((n: any) => n.data.mediaType === 'image')).toHaveLength(1);
  const videos = kit.nodes.filter((n: any) => n.data.mediaType === 'video');
  expect(videos).toHaveLength(8);
  videos.forEach((n: any) => expect(n.data).toMatchObject({ platform: 'flow', model: 'Omni 1.1 Flash', creationType: 'frames', duration: '8s', aspectRatio: '9:16', renderResolution: '720p' }));
});

test('hero upload is wired to the opening, never mistaken for a later starting frame', () => {
  expect(kit.nodes.find((n: any) => n.id === 'hero_reference').data.imageData).toBe('');
  expect(kit.edges.filter((e: any) => e.source === 'hero_reference')).toEqual([
    expect.objectContaining({ target: 'opening_image', sourceHandle: 'image', targetHandle: 'image_ref' }),
  ]);
  for (let i = 1; i <= 8; i++) {
    const inputs = kit.edges.filter((e: any) => e.target === `clip_${number(i)}` && e.targetHandle === 'frame_start');
    expect(inputs).toHaveLength(1);
    expect(inputs[0].source).toBe(i === 1 ? 'opening_image' : `last_${number(i - 1)}`);
    if (i > 1) expect(kit.edges.filter((e: any) => e.target === `last_${number(i - 1)}`)).toEqual([
      expect.objectContaining({ source: `clip_${number(i - 1)}`, sourceHandle: 'result', targetHandle: 'image_ref' }),
    ]);
  }
});

test('all nine generation nodes have separate complete editable prompts', () => {
  kit.nodes.filter((n: any) => n.type === 'generate').forEach((n: any) => {
    const textEdges = kit.edges.filter((e: any) => e.target === n.id && e.targetHandle === 'text');
    expect(textEdges).toHaveLength(1);
    const source = kit.nodes.find((s: any) => s.id === textEdges[0].source);
    expect(source.type).toBe('prompt');
    expect(source.data.text).toBe(n.data.prompt);
    expect(source.data.text).toContain('Cinematic third-person');
    if (n.data.mediaType === 'video') {
      expect(source.data.text).toContain('0–2s:');
      expect(source.data.text).toContain('ENDING STATE:');
    }
  });
});

test('every scene starts from the preceding planned state and ends with a complete rescue', () => {
  for (let i = 2; i <= 8; i++) {
    const previous = kit.nodes.find((n: any) => n.id === `clip_${number(i - 1)}`).data.prompt;
    const next = kit.nodes.find((n: any) => n.id === `clip_${number(i)}`).data.prompt;
    const ending = previous.split('ENDING STATE: ')[1].split('\n')[0];
    expect(next).toContain(`OPENING STATE: ${ending}\n`);
  }
  expect(kit.nodes.find((n: any) => n.id === 'clip_08').data.prompt).toContain('Story complete.');
});

test('all nodes are reachable and dependencies are acyclic', () => {
  const active = new Set<string>(), visited = new Set<string>();
  function visit(id: string) {
    if (active.has(id)) throw new Error(`Cycle at ${id}`);
    if (visited.has(id)) return;
    active.add(id);
    kit.edges.filter((e: any) => e.source === id).forEach((e: any) => visit(e.target));
    active.delete(id); visited.add(id);
  }
  kit.nodes.filter((n: any) => ['prompt', 'image'].includes(n.type)).forEach((n: any) => visit(n.id));
  expect(visited.size).toBe(26);
});
