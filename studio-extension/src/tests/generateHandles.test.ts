/** @jest-environment jsdom */
/// <reference types="node" />
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const refreshHandles = jest.fn();
jest.mock('@xyflow/react', () => ({
  ...jest.requireActual('@xyflow/react'),
  useUpdateNodeInternals: () => refreshHandles,
  Handle: ({ id, type, title }: any) => require('react').createElement('div', { 'data-port': id, 'data-type': type, title }),
}));
jest.mock('../studio/engine/WorkflowRunner', () => ({ CHAT_PLATFORMS: ['chatgpt', 'gemini', 'grok', 'claude', 'zai'] }));
import { GenerateNode } from '../studio/nodes/GenerateNode';
import { useStudioStore } from '../studio/store';

let root: Root;
let container: HTMLDivElement;
const data = { type: 'generate', platform: 'flow', mediaType: 'video', creationType: 'ingredients' };
const render = (extra: Record<string, unknown> = {}) => act(() => {
  root.render(createElement(GenerateNode, { id: 'g', data: { ...data, ...extra }, selected: false } as any));
});
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  useStudioStore.setState({ nodes: [], edges: [] });
  container = document.createElement('div'); document.body.append(container);
  root = createRoot(container); refreshHandles.mockClear();
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

test('refreshes connection targets after Ingredients switches to Start/End', () => {
  render(); refreshHandles.mockClear();
  render({ creationType: 'frames' });
  expect([...container.querySelectorAll('[data-type="target"]')].map(el => el.getAttribute('data-port')))
    .toEqual(['text', 'frame_start', 'frame_end']);
  expect(refreshHandles).toHaveBeenCalledWith('g');
});

test('refreshes when the output changes from media to text', () => {
  render(); refreshHandles.mockClear();
  render({ platform: 'chatgpt', mediaType: 'text' });
  expect(container.querySelector('[data-type="source"]')!.getAttribute('data-port')).toBe('text');
  expect(refreshHandles).toHaveBeenCalledWith('g');
});

test('does not remeasure handles on every progress update', () => {
  render(); refreshHandles.mockClear();
  render({ progress: 40 });
  expect(refreshHandles).not.toHaveBeenCalled();
});

test('changing media type moves wires off frame ports that disappear', () => {
  useStudioStore.setState({ nodes: [{ id: 'g', type: 'generate', position: { x: 0, y: 0 }, data: { ...data, creationType: 'frames' } }],
    edges: [{ id: 's', source: 'a', target: 'g', targetHandle: 'frame_start' }, { id: 'e', source: 'b', target: 'g', targetHandle: 'frame_end' }] });
  useStudioStore.getState().updateNodeData('g', { mediaType: 'image' });
  expect(useStudioStore.getState().edges.map(e => e.targetHandle)).toEqual(['image_ref', 'image_ref']);
  useStudioStore.getState().updateNodeData('g', { mediaType: 'video' });
  expect(useStudioStore.getState().edges.map(e => e.targetHandle)).toEqual(['frame_start', 'frame_end']);
});
