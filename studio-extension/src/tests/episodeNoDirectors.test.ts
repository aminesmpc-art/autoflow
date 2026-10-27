/// <reference types="node" />
import { readFileSync } from 'fs';
import { join } from 'path';
import { validateTemplate } from '../studio/templates/validate';

const load = (file: string) => JSON.parse(readFileSync(join(__dirname, '../../../outputs/episode-1-winter-shelter', file), 'utf8'));
const kit = load('EPISODE-1-OMNI-NO-DIRECTORS.import.json');
const original = load('EPISODE-1-OMNI-CHAIN.import.json');

test('valid direct workflow with no planning nodes', () => {
  expect(validateTemplate(kit)).toEqual([]);
  expect(kit.nodeCount).toBe(37);
  expect(kit.nodes.every((n: any) => ['prompt', 'generate', 'frame'].includes(n.type))).toBe(true);
  expect(kit.nodes.filter((n: any) => n.data.mediaType === 'image')).toHaveLength(1);
  expect(kit.nodes.filter((n: any) => n.data.mediaType === 'video')).toHaveLength(12);
});

test('each generation has its own complete authored prompt', () => {
  kit.nodes.filter((n: any) => n.type === 'generate').forEach((n: any) => {
    const incoming = kit.edges.filter((e: any) => e.target === n.id && e.targetHandle === 'text');
    expect(incoming).toHaveLength(1);
    const source = kit.nodes.find((p: any) => p.id === incoming[0].source);
    expect(source.type).toBe('prompt');
    expect(source.data.text).toBe(n.data.prompt);
    expect(source.data.text).toContain(original.nodes.find((o: any) => o.id === n.id).data.prompt);
    if (n.data.mediaType === 'video') expect(n.data).toMatchObject({ model: 'Omni 1.1 Flash', creationType: 'frames', duration: '8s' });
  });
});

test('retains every image and last-frame handoff unchanged', () => {
  const mediaEdges = (graph: any) => graph.edges.filter((e: any) => e.targetHandle !== 'text');
  expect(mediaEdges(kit)).toEqual(mediaEdges(original));
  expect(mediaEdges(kit)).toHaveLength(23);
  expect(kit.nodes.filter((n: any) => n.type === 'frame')).toHaveLength(11);
});
