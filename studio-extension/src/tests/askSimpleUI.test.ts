/** @jest-environment jsdom */
/// <reference types="node" />
import { createElement, act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { ASK_STARTERS } from '../studio/presets/askStarters';

const mockUpdate = jest.fn();
const mockState = { updateNodeData: mockUpdate, isRunning: false, nodes: [], edges: [] };
jest.mock('../studio/store', () => ({ useStudioStore: (selector: any) => selector(mockState) }));
const { AskBriefEditor } = require('../studio/components/AskBriefEditor.tsx');

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  mockUpdate.mockClear();
  mockState.isRunning = false;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });
const render = (data: any = {}) => act(() => root.render(createElement(AskBriefEditor, { id: 'ask', data, hasImage: false })));

it('puts all optional controls and preview inside one closed Advanced section', () => {
  render();
  const advanced = host.querySelector('details')!;
  expect(advanced.open).toBe(false);
  expect(advanced.querySelector('summary')!.textContent).toContain('Advanced');
  expect(host.querySelectorAll('textarea:not(details textarea)')).toHaveLength(1);
  expect(advanced.querySelector('select')).not.toBeNull();
  expect(advanced.querySelector('pre')).not.toBeNull();
});
it('fills an editable starter without executing or changing presets', () => {
  render();
  const button = host.querySelector<HTMLButtonElement>('.sn-ask__starters button')!;
  act(() => button.click());
  expect(mockUpdate).toHaveBeenCalledTimes(1);
  expect(mockUpdate).toHaveBeenCalledWith('ask', { askBrief: ASK_STARTERS[0].prompt });
});
it('does not offer starter replacements for existing text or specialized presets', () => {
  render({ askBrief: 'Keep this' });
  expect(host.querySelector('.sn-ask__starters')).toBeNull();
  render({ preset: 'place_environment', placePromptNotes: 'Stone floor' });
  expect(host.querySelector('.sn-ask__starters')).toBeNull();
  expect(host.querySelector('summary')!.textContent).toContain('Place');
  expect(host.querySelector('pre')!.textContent).toContain('Stone floor');
});
it('disables prompt editing and starters while running', () => {
  mockState.isRunning = true;
  render();
  expect(host.querySelector('textarea')!.disabled).toBe(true);
  const button = host.querySelector<HTMLButtonElement>('.sn-ask__starters button')!;
  act(() => button.click());
  expect(mockUpdate).not.toHaveBeenCalled();
});
