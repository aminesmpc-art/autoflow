/** @jest-environment jsdom */
/// <reference types="node" />
/**
 * Simple view (2026-10-30, phase 3 of the redesign): the open workflow as a
 * form — inputs, Run, results — with the graph hidden but still mounted.
 * Templates open this way; a blank canvas and saved work open as the graph.
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'fs';
import { join } from 'path';
import { simpleInputs, simpleResults, generateMakes } from '../studio/simple/simpleForm';
import { BUILTIN_TEMPLATES } from '../studio/templates';
import { WRONG_ROOM_TEMPLATE } from '../studio/templates/wrongRoom';
import { useStudioStore } from '../studio/store';
import SimpleView from '../studio/components/SimpleView';

const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8').replace(/\r\n/g, '\n');
const node = (id: string, type: string, data: any = {}, x = 0, y = 0) => ({ id, type, position: { x, y }, data: { type, ...data } });

describe('what the form asks for', () => {
  it('every Prompt and Image node, top to bottom, with what each one feeds', () => {
    const nodes = [
      node('img', 'image', { label: 'Product photo' }, 0, 300),
      node('p', 'prompt', { label: 'Ad prompt' }, 0, 0),
      node('clip', 'generate', { label: 'Ad clip', mediaType: 'video' }, 400, 0),
    ];
    const edges = [{ source: 'p', target: 'clip' }, { source: 'img', target: 'clip' }];
    expect(simpleInputs(nodes, edges)).toEqual([
      { id: 'p', kind: 'prompt', label: 'Ad prompt', feeds: ['Ad clip'] },
      { id: 'img', kind: 'image', label: 'Product photo', feeds: ['Ad clip'] },
    ]);
  });

  it('names each step it feeds once, however many wires go there', () => {
    const nodes = [node('p', 'prompt'), node('a', 'generate', { label: 'A' })];
    expect(simpleInputs(nodes, [{ source: 'p', target: 'a' }, { source: 'p', target: 'a' }])[0].feeds).toEqual(['A']);
  });
});

describe('what the form shows as results', () => {
  it('reads a generate node the way the node draws itself', () => {
    expect(generateMakes({ platform: 'flow', mediaType: 'video' })).toBe('video');
    expect(generateMakes({ platform: 'flow', mediaType: 'image' })).toBe('image');
    expect(generateMakes({ platform: 'grok', mediaType: 'video' })).toBe('video');
    /* ChatGPT cannot make a clip; a saved 'video' there draws a picture. */
    expect(generateMakes({ platform: 'chatgpt', mediaType: 'video' })).toBe('image');
    expect(generateMakes({ platform: 'claude' })).toBe('text');
    expect(generateMakes({ platform: 'chatgpt', mediaType: 'text' })).toBe('text');
  });

  it('counts written text only where the workflow ends', () => {
    /* A prompt an Ask AI node writes for a clip is a step, not a result. */
    const nodes = [
      node('ask', 'generate', { platform: 'chatgpt', mediaType: 'text', label: 'Writer' }),
      node('clip', 'generate', { mediaType: 'video', label: 'Clip' }, 400),
      node('agent', 'agent', { label: 'Answer' }, 800),
    ];
    const results = simpleResults(nodes, [{ source: 'ask', target: 'clip' }]);
    /* The agent reads nothing, so it is first in the run; the clip waits on
       the writer. */
    expect(results.map((r) => r.id)).toEqual(['agent', 'clip']);
  });

  it('lists results in the order the run makes them', () => {
    const results = simpleResults(WRONG_ROOM_TEMPLATE.nodes as any, WRONG_ROOM_TEMPLATE.edges as any);
    expect(results).toHaveLength(21);
    expect(results[0].id).toBe('continuity_board');
    const firstClip = results.findIndex((r) => r.kind === 'video');
    expect(results.slice(1, firstClip).every((r) => r.kind === 'image')).toBe(true);
    expect(results.slice(firstClip).every((r) => r.kind === 'video')).toBe(true);
  });

  it('gives every bundled template something to fill in and something to show', () => {
    for (const tpl of BUILTIN_TEMPLATES) {
      const shape = {
        id: tpl.id,
        inputs: simpleInputs(tpl.nodes as any, tpl.edges as any).length > 0,
        results: simpleResults(tpl.nodes as any, tpl.edges as any).length > 0,
      };
      expect(shape).toEqual({ id: tpl.id, inputs: true, results: true });
    }
  });
});

describe('the form, drawn', () => {
  let root: Root;
  let host: HTMLDivElement;
  const handlers = { onRun: jest.fn(), onPause: jest.fn(), onStop: jest.fn(), onRetry: jest.fn(), onShow: jest.fn() };

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    Object.values(handlers).forEach((h) => h.mockClear());
    useStudioStore.setState({
      nodes: [
        node('p', 'prompt', { label: 'Ad prompt', text: 'A sneaker' }, 0, 0),
        node('img', 'image', { label: 'Product photo' }, 0, 300),
        node('clip', 'generate', { label: 'Ad clip', mediaType: 'video', status: 'error', errorMessage: 'Flow said no' }, 400, 0),
      ] as any,
      edges: [{ id: 'e1', source: 'p', target: 'clip' }, { id: 'e2', source: 'img', target: 'clip' }] as any,
      isRunning: false,
      workflow: { id: 'w', name: 'Product Ad', createdAt: 0, updatedAt: 0 },
    } as any);
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    act(() => root.render(createElement(SimpleView, { canRun: true, elapsed: '0:00', ...handlers })));
  });
  afterEach(() => { act(() => root.unmount()); host.remove(); });

  it('edits the Prompt node itself', () => {
    const area = host.querySelector<HTMLTextAreaElement>('.studio-simple__text')!;
    expect(area.value).toBe('A sneaker');
    const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    act(() => { set.call(area, 'A red sneaker'); area.dispatchEvent(new Event('input', { bubbles: true })); });
    expect((useStudioStore.getState().nodes.find((n) => n.id === 'p')!.data as any).text).toBe('A red sneaker');
  });

  it('marks an empty image slot and says what happens if it stays empty', () => {
    expect(host.querySelector('.studio-simple__image--empty')).not.toBeNull();
    expect(host.querySelector('.studio-simple__warn')?.textContent).toMatch(/One image is still empty/);
  });

  it('runs, retries and shows through the canvas\'s own handlers', () => {
    act(() => { host.querySelector<HTMLButtonElement>('.studio-simple__go')!.click(); });
    expect(handlers.onRun).toHaveBeenCalledTimes(1);
    act(() => { host.querySelector<HTMLButtonElement>('[aria-label="Retry Ad clip"]')!.click(); });
    expect(handlers.onRetry).toHaveBeenCalledWith(['clip']);
    act(() => { host.querySelector<HTMLButtonElement>('[aria-label="Show Ad clip on the canvas"]')!.click(); });
    expect(handlers.onShow).toHaveBeenCalledWith('clip');
  });

  it('says what a failed result failed with', () => {
    expect(host.querySelector('.studio-simple__state--bad')?.textContent).toBe('Flow said no');
    expect(host.querySelector('.studio-simple__run')?.textContent).toMatch(/Retry 1 failed/);
  });
});

describe('where Simple view is used', () => {
  const GALLERY = read('studio/components/TemplateGallery.tsx');
  const STORE = read('studio/store.ts');
  const CANVAS = read('studio/components/Canvas.tsx');
  const CSS = read('studio/studio.css');

  it('templates open in it; a blank canvas and saved work open as the graph', () => {
    const load = GALLERY.slice(GALLERY.indexOf('const loadTemplate = useCallback'), GALLERY.indexOf('const startBlank'));
    expect(load).toMatch(/setWorkMode\('simple'\);\s*setView\('canvas'\);/);
    const blank = GALLERY.slice(GALLERY.indexOf('const startBlank'), GALLERY.indexOf('const startBlank') + 400);
    expect(blank).toMatch(/setWorkMode\('canvas'\)/);
    const saved = STORE.slice(STORE.indexOf('loadWorkflow: async (id) => {'), STORE.indexOf('loadLastWorkflow: async'));
    expect(saved).toMatch(/workMode: 'canvas'/);
  });

  it('switches from the top bar, and draws over the graph rather than replacing it', () => {
    expect(CANVAS).toMatch(/onClick=\{\(\) => setWorkMode\('simple'\)\}/);
    expect(CANVAS).toMatch(/onClick=\{\(\) => setWorkMode\('canvas'\)\}/);
    const stage = CANVAS.slice(CANVAS.indexOf('<div className="studio-stage"'));
    expect(stage.indexOf('<ReactFlow')).toBeLessThan(stage.indexOf('<SimpleView'));
    expect(stage).not.toMatch(/\{!simple && \(\s*<ReactFlow/);
  });

  it('has one Run: the form\'s, after the inputs', () => {
    expect(CSS).toMatch(/\.studio-canvas--simple \.studio-toolbar,\s*\.studio-canvas--simple \.studio-topbar__run,/);
  });
});
