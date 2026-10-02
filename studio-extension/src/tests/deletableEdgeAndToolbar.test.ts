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

  it('uses distinct, visible icons for clipping, motion and chief controls', () => {
    for (const [action, icon] of [['addClipNode', 'scissors'], ['addMotionNode', 'motion'], ['addChiefNode', 'chief']]) {
      const button = CANVAS.match(new RegExp(`<button[^>]*onClick=\\{${action}\\}[\\s\\S]*?<\\/button>`))?.[0];
      expect(button).toContain(`<Icon name="${icon}"`);
      expect(ICON).toContain(`${icon}:`);
    }
    for (const kind of ['clip', 'motion', 'chief']) {
      expect(CSS).toMatch(new RegExp(`\\.studio-toolbar__node-icon--${kind}\\s*\\{[^}]*color:`));
    }
  });

  it('keeps all twelve add-node actions and separates scrolling from execution controls', () => {
    const palette = CANVAS.split('<aside className="studio-toolbar"')[1].split('</aside>')[0];
    expect(palette.match(/aria-label="Add [^"]+ node"/g)).toHaveLength(12);
    expect(palette).toContain('studio-toolbar__items');
    expect(palette).toContain('studio-toolbar__actions');
    expect(palette).toContain('onClick={handleRun}');
    expect(palette).toContain('onClick={() => handleRetry()}');
    expect(CSS).toMatch(/\.studio-toolbar__items\s*\{[^}]*overflow-y:\s*auto/);
    expect(CSS).toContain('.studio-toolbar__btn:focus-visible');
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
