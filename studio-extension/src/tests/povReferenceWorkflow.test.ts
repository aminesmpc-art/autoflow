/// <reference types="node" />
import { readFileSync } from 'fs';
import { join } from 'path';
import { validateTemplate } from '../studio/templates/validate';
import { connectedDirectors, chiefLayoutProblem } from '../studio/ask/chief';
import { readStorySettings, storyBrief } from '../studio/ask/storyPlan';

describe.each(['FIRST-HUNT-SHORTS.import.json', 'FIRST-HUNT-SQUARE-SOURCE.import.json', 'FIRST-HUNT-STRONGER-SHORTS.import.json', 'FIRST-HUNT-STRONGER-SQUARE-SOURCE.import.json'])('%s', file => {
  const kit = JSON.parse(readFileSync(join(__dirname, '../../../outputs/pov-reference-workflow', file), 'utf8'));
  test('imports with complete ports and prompt connections', () => {
    expect(kit.autoflowStudio).toBe(1);
    expect(validateTemplate(kit)).toEqual([]);
  });
  test('assigns exactly three ordered still/video pairs to each director', () => {
    const directors = connectedDirectors('chief', kit.nodes, kit.edges);
    expect(chiefLayoutProblem(directors)).toBeUndefined();
    expect(directors).toHaveLength(3);
    directors.forEach((director, group) => {
      expect(director.targets.map(t => t.id)).toEqual([1, 2, 3].flatMap(offset => {
        const number = String(group * 3 + offset).padStart(2, '0');
        return [`still_${number}`, `clip_${number}`];
      }));
      const node = kit.nodes.find((n: any) => n.id === director.id);
      const settings = readStorySettings(node.data);
      const brief = storyBrief('The first hunt', settings, director.targets);
      expect(brief).toMatch(/fisheye barrel distortion/);
      expect(brief).toMatch(/Deep focus/);
      expect(settings.pov?.narrationStrategy).toBe('none');
    });
  });
  test('every Flow clip starts at its own still; reference count stays bounded', () => {
    for (let i = 1; i <= 9; i++) {
      const number = String(i).padStart(2, '0');
      const video = kit.nodes.find((n: any) => n.id === `clip_${number}`);
      expect(video.data).toMatchObject({ platform: 'flow', mediaType: 'video', model: 'Omni 1.1 Flash', duration: '8s', creationType: 'frames', enabled: true });
      expect(['16:9', '9:16']).toContain(video.data.aspectRatio);
      expect(kit.edges.filter((e: any) => e.target === video.id && e.targetHandle === 'frame_start').map((e: any) => e.source)).toEqual([`still_${number}`]);
      expect(kit.edges.filter((e: any) => e.target === `still_${number}` && e.targetHandle === 'image_ref')).toHaveLength(3);
    }
  });
  test('graph is acyclic and contains no fabricated generation results', () => {
    const active = new Set<string>(), visited = new Set<string>();
    const visit = (id: string) => {
      if (active.has(id)) throw new Error(`Dependency loop: ${id}`);
      if (visited.has(id)) return;
      active.add(id);
      kit.edges.filter((e: any) => e.source === id).forEach((e: any) => visit(e.target));
      active.delete(id); visited.add(id);
    };
    kit.nodes.forEach((n: any) => {
      visit(n.id);
      expect(n.data.status).toBe('idle');
      expect(n.data.resultUrl).toBeUndefined();
      expect(n.data.resultText).toBeUndefined();
    });
    expect(visited.size).toBe(kit.nodes.length);
  });
});
