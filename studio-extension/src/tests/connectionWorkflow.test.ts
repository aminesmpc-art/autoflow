/// <reference types="node" />
import { readFileSync } from 'fs';
import { join } from 'path';
import { validateTemplate } from '../studio/templates/validate';
import { canConnect } from '../studio/canvas/connect';

const workflow = JSON.parse(readFileSync(join(__dirname, '../../test-workflows/studio-connection-test.json'), 'utf8'));
test('the supplied JSON is importable and all ports match actual node modes', () => {
  expect(workflow.autoflowStudio).toBe(1);
  expect(validateTemplate(workflow)).toEqual([]);
  expect(workflow.edges.every((edge: any) => canConnect(edge))).toBe(true);
});
test('the workflow covers image Start, explicit last frame, End and direct clip chaining', () => {
  const links = workflow.edges.map((e: any) => `${e.source}:${e.sourceHandle}->${e.target}:${e.targetHandle}`);
  expect(links).toEqual(expect.arrayContaining([
    'start_image:image->clip_1:frame_start', 'clip_1:result->last_frame:image_ref',
    'last_frame:image->clip_2:frame_start', 'end_image:image->clip_2:frame_end',
    'clip_2:result->clip_3:frame_start',
  ]));
  expect(workflow.nodes.filter((n: any) => n.type === 'generate')).toHaveLength(3);
  for (const n of workflow.nodes.filter((n: any) => n.type === 'image')) {
    expect(n.data.imageData).toMatch(/^data:image\/png;base64,iVBOR/);
  }
});
