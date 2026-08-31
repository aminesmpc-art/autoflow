/**
 * @jest-environment jsdom
 */

/// <reference types="node" />

import { readFileSync } from 'fs';
import { join } from 'path';
import { useStudioStore } from '../studio/store';

const ROOT = join(__dirname, '..', '..');
const read = (...p: string[]) => readFileSync(join(ROOT, 'src', ...p), 'utf8');

const CANVAS = read('studio', 'components', 'Canvas.tsx');
const CSS = read('studio', 'studio.css');
const ICON = read('studio', 'components', 'Icon.tsx');
const STORE = read('studio', 'store.ts');
const EDGE = read('studio', 'canvas', 'DeletableEdge.tsx');

describe('Toolbar Redesign and Deletable Edge', () => {
  it('store has removeEdge method that filters edges and marks dirty', () => {
    expect(STORE).toMatch(/removeEdge:\s*\(edgeId\)\s*=>/);

    const store = useStudioStore.getState();
    store.setEdges([
      { id: 'e1', source: 'n1', target: 'n2' },
      { id: 'e2', source: 'n2', target: 'n3' },
    ]);
    expect(useStudioStore.getState().edges.length).toBe(2);

    store.removeEdge('e1');
    expect(useStudioStore.getState().edges.length).toBe(1);
    expect(useStudioStore.getState().edges[0].id).toBe('e2');
  });

  it('Canvas registers DeletableEdge in edgeTypes and defaultEdgeOptions', () => {
    expect(CANVAS).toMatch(/import \{ DeletableEdge \} from '\.\.\/canvas\/DeletableEdge';/);
    expect(CANVAS).toMatch(/edgeTypes=\{edgeTypes\}/);
    expect(CANVAS).toMatch(/type:\s*'deletable'/);
  });

  it('DeletableEdge renders delete button and calls removeEdge on click', () => {
    expect(EDGE).toMatch(/className="\s*studio-edge__delete-btn\s*"/);
    expect(EDGE).toMatch(/removeEdge\(id\)/);
  });

  it('Icon.tsx contains dedicated story icon', () => {
    expect(ICON).toMatch(/story:\s*<>/);
  });

  it('studio.css has styles for toolbar icons, animations, and edge delete button', () => {
    /* Renamed from __icon-box: these swatches carry the node-family
       colours (--n-prompt, --n-image, …), and the design system reserves
       those for node-family selectors. The name now says what it is, so
       the guard can tell chrome from a node swatch. */
    expect(CSS).toMatch(/\.studio-toolbar__node-icon/);
    expect(CSS).toMatch(/\.studio-edge__delete-btn/);
    expect(CSS).toMatch(/@keyframes toolbar-enter/);
  });
});
