/** @jest-environment jsdom */
/// <reference types="node" />

/**
 * The V port as the node draws it, and what the node says about it before a
 * credit is spent: the whole clip on Omni, its last frame on Veo.
 */

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

jest.mock('@xyflow/react', () => ({
  ...jest.requireActual('@xyflow/react'),
  useUpdateNodeInternals: () => () => {},
  Handle: ({ id, type, title }: any) => require('react').createElement('div', { 'data-port': id, 'data-type': type, title }),
}));
jest.mock('../studio/engine/WorkflowRunner', () => ({ CHAT_PLATFORMS: ['chatgpt', 'gemini', 'grok', 'claude', 'zai'] }));
import { GenerateNode } from '../studio/nodes/GenerateNode';
import { useStudioStore } from '../studio/store';

let root: Root;
let container: HTMLDivElement;
const clip = { type: 'generate', platform: 'flow', mediaType: 'video', creationType: 'ingredients' };
const upstream = { id: 'up', type: 'generate', position: { x: 0, y: 0 }, data: { ...clip } };

const render = (data: Record<string, unknown>, edges: any[] = []) => {
  act(() => {
    useStudioStore.setState({ nodes: [upstream, { id: 'g', type: 'generate', position: { x: 400, y: 0 }, data }] as any, edges });
    root.render(createElement(GenerateNode, { id: 'g', data, selected: false } as any));
  });
};
const ports = () => [...container.querySelectorAll('[data-type="target"]')].map((el) => el.getAttribute('data-port'));
const text = () => container.textContent || '';

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div'); document.body.append(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

test('a Flow clip draws V beside T and 🖼', () => {
  render({ ...clip });
  expect(ports()).toEqual(['text', 'image_ref', 'video_ref']);
});

test('on Omni, a clip on V is used whole', () => {
  render({ ...clip, model: 'Omni 1.1 Flash' }, [{ id: 'v', source: 'up', target: 'g', targetHandle: 'video_ref' }]);
  expect(text()).toContain('the whole clip goes on the prompt as a video reference');
});

test('on Veo, the node says it takes the last frame, and what to switch to', () => {
  render({ ...clip, model: 'Veo 3.1 - Fast' }, [{ id: 'v', source: 'up', target: 'g', targetHandle: 'video_ref' }]);
  expect(text()).toMatch(/Veo 3\.1 - Fast cannot take a video.*last frame.*Omni 1\.1 Flash/);
});

test('a clip on 🖼 — every wire saved before V existed — points at V', () => {
  render({ ...clip }, [{ id: 'i', source: 'up', target: 'g', targetHandle: 'image_ref' }]);
  expect(text()).toContain('A clip on 🖼 counts as its last frame. Wire it into V to use the whole clip.');
});

test('a Flow clip offers the two shapes Flow makes, and shows a saved 1:1 as the 16:9 it becomes', () => {
  render({ ...clip, aspectRatio: '1:1' });
  const field = container.querySelector('[title="Aspect ratio"]')!;
  const pills = [...field.querySelectorAll('.sn-seg__btn')].map((b) => b.textContent);
  expect(pills).toEqual(['9:16', '16:9']);
  expect(field.querySelector('.sn-seg__btn--on')!.textContent).toBe('16:9');
});
