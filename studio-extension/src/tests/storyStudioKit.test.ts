/// <reference types="node" />
import { readFileSync } from 'fs';
import { join } from 'path';
import { validateTemplate } from '../studio/templates/validate';
import { connectedDirectors, chiefLayoutProblem } from '../studio/ask/chief';
const kit = JSON.parse(readFileSync(join(__dirname, '../../../outputs/story-studio-master/STORY-STUDIO.import.json'), 'utf8'));
it('is an importable Studio graph using valid node ports', () => {
  expect(kit.autoflowStudio).toBe(1);
  expect(validateTemplate(kit)).toEqual([]);
});
it('has three bounded directors with three ordered still/video pairs each', () => {
  const directors = connectedDirectors('chief', kit.nodes, kit.edges);
  expect(chiefLayoutProblem(directors)).toBeUndefined();
  expect(directors).toHaveLength(3);
  directors.forEach((d, group) => {
    expect(d.targets.map(t => t.id)).toEqual([0, 1, 2].flatMap(offset => {
      const id = String(group * 3 + offset + 1).padStart(2, '0');
      return [`still_${id}`, `clip_${id}`];
    }));
  });
});
it('wires each clip to its own start frame and caps each still at three references', () => {
  for (let i = 1; i <= 9; i++) {
    const id = String(i).padStart(2, '0');
    const clip = kit.nodes.find((n: any) => n.id === `clip_${id}`);
    expect(clip.data.creationType).toBe('frames');
    expect(clip.data.enabled).toBe(i <= 3);
    expect(kit.nodes.find((n: any) => n.id === `still_${id}`).data.enabled).toBe(i <= 3);
    const refs = kit.edges.filter((e: any) => e.target === `clip_${id}` && e.targetHandle === 'frame_start');
    expect(refs.map((e: any) => e.source)).toEqual([`still_${id}`]);
    expect(kit.edges.filter((e: any) => e.target === `still_${id}` && e.targetHandle === 'image_ref')).toHaveLength(3);
  }
});
it('has no dependency cycles or fabricated results', () => {
  const visiting = new Set<string>(), visited = new Set<string>();
  const visit = (id: string) => {
    if (visiting.has(id)) throw Error(`Cycle at ${id}`);
    if (visited.has(id)) return;
    visiting.add(id);
    kit.edges.filter((e: any) => e.source === id).forEach((e: any) => visit(e.target));
    visiting.delete(id); visited.add(id);
  };
  kit.nodes.forEach((n: any) => { visit(n.id); expect(n.data.resultUrl).toBeUndefined(); expect(n.data.status).toBe('idle'); });
  expect(visited.size).toBe(33);
});
