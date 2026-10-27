/// <reference types="node" />
import { readFileSync } from 'fs';
import { join } from 'path';
import { validateTemplate } from '../studio/templates/validate';
import { connectedDirectors, chiefLayoutProblem } from '../studio/ask/chief';

describe.each(['FIRST-HUNT-VEO-QUALITY-CHAIN.import.json', 'FIRST-HUNT-VEO-QUALITY-CHAIN-SQUARE-SOURCE.import.json'])('%s', file => {
  const kit = JSON.parse(readFileSync(join(__dirname, '../../../outputs/pov-reference-workflow', file), 'utf8'));
  test('valid graph with exactly one generated opening image and nine Quality videos', () => {
    expect(validateTemplate(kit)).toEqual([]);
    expect(kit.nodes.filter((n: any) => n.type === 'generate' && n.data.mediaType === 'image').map((n: any) => n.id)).toEqual(['still_01']);
    const videos = kit.nodes.filter((n: any) => n.type === 'generate' && n.data.mediaType === 'video');
    expect(videos).toHaveLength(9);
    videos.forEach((n: any) => expect(n.data).toMatchObject({ model: 'Veo 3.1 - Quality', creationType: 'frames', platform: 'flow' }));
  });
  test('every continuation takes only the immediately previous video’s extracted last frame', () => {
    for (let i = 1; i <= 9; i++) {
      const num = String(i).padStart(2, '0');
      const starts = kit.edges.filter((e: any) => e.target === `clip_${num}` && e.targetHandle === 'frame_start');
      expect(starts).toHaveLength(1);
      if (i === 1) expect(starts[0].source).toBe('still_01');
      else {
        const previous = String(i - 1).padStart(2, '0');
        expect(starts[0]).toMatchObject({ source: `last_${previous}`, sourceHandle: 'image' });
        expect(kit.edges.filter((e: any) => e.target === `last_${previous}`)).toEqual([
          expect.objectContaining({ source: `clip_${previous}`, sourceHandle: 'result', targetHandle: 'image_ref' }),
        ]);
      }
    }
  });
  test('keeps the character descriptions and bounded Director assignments', () => {
    const directors = connectedDirectors('chief', kit.nodes, kit.edges);
    expect(chiefLayoutProblem(directors)).toBeUndefined();
    expect(directors.map(d => d.targets.map(t => t.id))).toEqual([
      ['still_01', 'clip_01', 'clip_02', 'clip_03'], ['clip_04', 'clip_05', 'clip_06'], ['clip_07', 'clip_08', 'clip_09'],
    ]);
    for (const director of directors) {
      const data = kit.nodes.find((n: any) => n.id === director.id).data;
      expect(data.cast.map((c: any) => c.name)).toEqual(['POV hunter', 'Tarek', 'Sena']);
      expect(data.rules).toContain('frameChain');
    }
  });
  test('all dependencies are acyclic', () => {
    const visiting = new Set<string>(), visited = new Set<string>();
    function visit(id: string) {
      if (visiting.has(id)) throw new Error(`Cycle at ${id}`);
      if (visited.has(id)) return;
      visiting.add(id);
      kit.edges.filter((e: any) => e.source === id).forEach((e: any) => visit(e.target));
      visiting.delete(id); visited.add(id);
    }
    kit.nodes.forEach((n: any) => visit(n.id));
    expect(visited.size).toBe(kit.nodes.length);
  });
});
