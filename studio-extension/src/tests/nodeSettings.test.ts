/** @jest-environment jsdom */
/// <reference types="node" />
/**
 * Settings in a side panel (2026-10-30, phase 2 of the redesign).
 *
 * Measured before, in the canvas harness: a Flow clip was 300×551px with 17
 * controls always open, the 26-node template's nodes ran to 809px, and the
 * whole workflow fitted only at 13%. After: 214px, 399px at most, 21%.
 *
 * The settings are portaled, not copied: each node keeps its own state and
 * handlers, so a setting changed in the panel is the call it always was.
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'fs';
import { join } from 'path';
import { NodeSettings, InspectorHost } from '../studio/components/NodeSettings';
import { useStudioStore } from '../studio/store';

const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8').replace(/\r\n/g, '\n');

let root: Root;
let card: HTMLDivElement;
let panel: HTMLElement;

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  card = document.createElement('div');
  panel = document.createElement('aside');
  document.body.append(card, panel);
  root = createRoot(card);
});
afterEach(() => { act(() => root.unmount()); card.remove(); panel.remove(); });

const selectedNodes = (...ids: string[]) => useStudioStore.setState({
  nodes: ['a', 'b'].map((id) => ({ id, type: 'generate', position: { x: 0, y: 0 }, data: {}, selected: ids.includes(id) })) as any,
});

const draw = (opts: { selected: boolean; host?: HTMLElement | null; onKey?: (e: any) => void; onClick?: () => void }) => {
  const settings = createElement(NodeSettings, {
    nodeId: 'a', selected: opts.selected, title: 'Clip one', summary: 'Flow · Omni · 8s',
    children: createElement('button', { className: 'the-setting' }, 'Ratio 9:16'),
  });
  /* Stands in for React Flow's node wrapper: it moves a selected node on
     arrow keys and re-selects on click, and both would fire for events in
     the panel, because a portal keeps its React parent. */
  const wrapper = createElement('div', { onKeyDown: opts.onKey, onClick: opts.onClick }, settings);
  act(() => {
    root.render(opts.host === null ? wrapper : createElement(InspectorHost.Provider, { value: opts.host ?? panel }, wrapper));
  });
};

describe('where the settings are drawn', () => {
  it('in the panel, while this is the one selected node', () => {
    selectedNodes('a');
    draw({ selected: true });
    expect(panel.querySelector('.the-setting')).not.toBeNull();
    expect(card.querySelector('.the-setting')).toBeNull();
    expect(panel.querySelector('.studio-inspector__title')?.textContent).toBe('Clip one');
  });

  it('nowhere while the node is not selected — the card shows the summary', () => {
    selectedNodes();
    draw({ selected: false });
    expect(panel.childElementCount).toBe(0);
    expect(card.querySelector('.the-setting')).toBeNull();
    expect(card.querySelector('.sn-summary')?.textContent).toBe('Flow · Omni · 8s');
  });

  it('keeps the summary on the card while the panel is open, so the card does not change size', () => {
    selectedNodes('a');
    draw({ selected: true });
    expect(card.querySelector('.sn-summary')?.textContent).toBe('Flow · Omni · 8s');
  });

  it('shows no one\'s settings with two nodes selected', () => {
    selectedNodes('a', 'b');
    draw({ selected: true });
    expect(panel.childElementCount).toBe(0);
  });

  it('stays on the node when there is no panel to draw into', () => {
    selectedNodes('a');
    draw({ selected: true, host: null });
    expect(card.querySelector('.the-setting')).not.toBeNull();
  });
});

describe('the panel keeps its events', () => {
  it('does not pass an arrow key or a click on to the node', () => {
    selectedNodes('a');
    const onKey = jest.fn();
    const onClick = jest.fn();
    draw({ selected: true, onKey, onClick });
    const setting = panel.querySelector<HTMLButtonElement>('.the-setting')!;
    act(() => { setting.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); });
    act(() => { setting.click(); });
    expect(onKey).not.toHaveBeenCalled();
    expect(onClick).not.toHaveBeenCalled();
  });

  it('closes on Escape and on its close button, by deselecting the node', () => {
    const changes = jest.fn();
    const real = useStudioStore.getState().onNodesChange;
    selectedNodes('a');
    useStudioStore.setState({ onNodesChange: changes } as any);
    try {
      draw({ selected: true });
      act(() => { panel.querySelector('.the-setting')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
      act(() => { panel.querySelector<HTMLButtonElement>('.studio-inspector__close')!.click(); });
      expect(changes).toHaveBeenCalledTimes(2);
      expect(changes).toHaveBeenLastCalledWith([{ type: 'select', id: 'a', selected: false }]);
    } finally {
      useStudioStore.setState({ onNodesChange: real } as any);
    }
  });
});

describe('the canvas provides the panel', () => {
  const CANVAS = read('studio/components/Canvas.tsx');
  const CSS = read('studio/studio.css');

  it('around the nodes, with an element for them to draw into', () => {
    expect(CANVAS).toMatch(/<InspectorHost\.Provider value=\{inspectorHost\}>\s*<ReactFlow/);
    expect(CANVAS).toMatch(/<aside className="studio-inspector" ref=\{setInspectorHost\} aria-label="Node settings" \/>/);
  });

  it('hidden while empty, so it takes no room with nothing selected', () => {
    expect(CSS).toMatch(/\.studio-inspector:empty \{ display: none; \}/);
  });

  it('slides a clicked node out from under it', () => {
    const click = CANVAS.slice(CANVAS.indexOf('const onNodeClick = useCallback'), CANVAS.indexOf('const onPaneClick'));
    expect(click).toMatch(/const under = card\.right \+ 16 - panel\.left;/);
    expect(click).toMatch(/setViewport\(\{ \.\.\.vp, x: vp\.x - under \}/);
  });
});

describe('each tall node puts its settings in the panel', () => {
  const settingsIn = (file: string) => {
    const src = read(`studio/nodes/${file}`);
    const open = src.indexOf('<NodeSettings');
    const close = src.indexOf('</NodeSettings>');
    expect(open).toBeGreaterThan(-1);
    expect(close).toBeGreaterThan(open);
    return { src, inside: src.slice(open, close), after: src.slice(close) };
  };

  it('Flow clip: every control, but the Ask AI brief stays on the card as its prompt', () => {
    const { src, inside } = settingsIn('GenerateNode.tsx');
    expect(inside).toContain('className="sn-bar sn-bar--grid"');
    expect(inside).not.toContain('<AskBriefEditor');
    expect(src.indexOf('<AskBriefEditor')).toBeLessThan(src.indexOf('<NodeSettings'));
    expect(src).toMatch(/summary=\{summary\}/);
  });

  it('Flow clip: the two problems that would cost a generation stay on the card', () => {
    const { after } = settingsIn('GenerateNode.tsx');
    expect(after).toMatch(/\{cardWarning && <div className="sn-summary sn-summary--warn"/);
    const src = read('studio/nodes/GenerateNode.tsx');
    expect(src).toMatch(/const cardWarning = voiceProblem \|\| videoRefProblem;/);
  });

  it('Director: the four sections go; the shot list and the Chief\'s lock stay', () => {
    const { src, inside } = settingsIn('StoryNode.tsx');
    expect(inside).toContain('className="sn-story__tabs"');
    expect(inside).not.toContain('sn-story__ribbon');
    expect(inside).not.toContain('Controlled by Director Chief');
    expect(src.indexOf('Controlled by Director Chief')).toBeLessThan(src.indexOf('<NodeSettings'));
    expect(src).toMatch(/bodyClass="sn-story-settings"/);
  });

  it('Director Chief: the engine goes; the team and the saved plan stay', () => {
    const { inside } = settingsIn('ChiefNode.tsx');
    expect(inside).toContain('Chief AI Engine');
    expect(inside).not.toContain('sn-chief__directors');
    expect(inside).not.toContain('sn-chief__checkpoint');
  });

  it('Clipping: setup and the brief go; the ranked moments are on the card, not behind a tab', () => {
    const { inside, after } = settingsIn('ClippingNode.tsx');
    expect(inside).toContain('sn-clip__strip');
    expect(inside).toContain("tab === 'settings'");
    expect(inside).not.toContain('sn-clip__moments');
    expect(after).toContain('sn-clip__moments');
    expect(read('studio/nodes/ClippingNode.tsx')).not.toMatch(/tab === 'moments'/);
  });

  it('Motion Control: choices go; the pieces, the upload switch and failures stay', () => {
    const { inside } = settingsIn('MotionNode.tsx');
    expect(inside).toContain('Choose a transformation');
    expect(inside).not.toContain('sn-motion__piece');
    expect(inside).not.toContain('Uploads are off');
    expect(read('studio/studio.css')).toMatch(/\.sn--motion \{ min-height: 236px; \}/);
  });
});

describe('settings styled under their node keep their styles in the panel', () => {
  const CSS = read('studio/studio.css');
  it('every Director and Clipping descendant rule also matches the panel', () => {
    /* A rule left as `.sn--story .x` styles the control on the card and
       leaves it bare in the panel — it would still work, and look broken. */
    expect(CSS).not.toMatch(/(^|[\s,])\.sn--story \.[a-z]/m);
    expect(CSS).not.toMatch(/(^|[\s,])\.sn--clip \.[a-z]/m);
    expect(CSS).toMatch(/:is\(\.sn--story, \.sn-story-settings\) \.sn-story__panel/);
    expect(CSS).toMatch(/:is\(\.sn--clip, \.sn-clip-settings\) \.sn-clip__strip/);
  });
});
