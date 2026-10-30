/**
 * The canvas fixes that came before the redesign (2026-10-30).
 *
 * Measured in the canvas harness before any of this changed:
 *   - Wrong Room Challenge opened with 24 overlapping pairs of nodes, at
 *     100% zoom on its top-left corner. Its positions were laid out for far
 *     shorter nodes: a Director 140px left of the 300px board it feeds.
 *   - React Flow refuses to zoom out past 0.5, so "Recenter — fit all nodes"
 *     could not fit a 26-node workflow on a laptop.
 *   - Half of every port lay over the node: T covered "Platform", V "Model".
 *   - The node library floated over 150px of Simple Video's first node, and
 *     Run sat at the bottom of it, under twelve buttons that add things.
 *   - "MCP Idle" sat in every top bar for a bridge that never connects.
 */

/// <reference types="node" />

import { readFileSync } from 'fs';
import { join } from 'path';
import { separate, tidy, sizeOf, type Box, type Placed } from '../studio/canvas/placement';
import { WRONG_ROOM_TEMPLATE } from '../studio/templates/wrongRoom';
import { BUILTIN_TEMPLATES } from '../studio/templates';
import { NODE_PORTS } from '../studio/templates/validate';

const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8').replace(/\r\n/g, '\n');
const CANVAS = read('studio/components/Canvas.tsx');
const CSS = read('studio/studio.css');

const hits = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const overlapping = (boxes: Box[]) => {
  let n = 0;
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) if (hits(boxes[i], boxes[j])) n++;
  return n;
};
const boxesOf = (tpl: { nodes: any[] }): Placed[] =>
  tpl.nodes.map((n) => ({ id: n.id, x: n.position.x, y: n.position.y, ...(({ w, h }) => ({ w, h }))(sizeOf(n.type)) }));
const apply = (boxes: Placed[], to: Map<string, { x: number; y: number }>): Placed[] =>
  boxes.map((b) => ({ ...b, ...(to.get(b.id) || {}) }));

describe('separate: a workflow that arrives stacked', () => {
  it('pulls the shipped template that opened with overlapping nodes apart', () => {
    const boxes = boxesOf(WRONG_ROOM_TEMPLATE);
    expect(overlapping(boxes)).toBeGreaterThan(0);
    expect(overlapping(apply(boxes, separate(boxes)))).toBe(0);
  });

  it('leaves every bundled template with nothing on top of anything', () => {
    for (const tpl of BUILTIN_TEMPLATES) {
      const boxes = boxesOf(tpl);
      expect({ id: tpl.id, overlaps: overlapping(apply(boxes, separate(boxes))) }).toEqual({ id: tpl.id, overlaps: 0 });
    }
  });

  it('keeps each node in its column, and only ever moves it down', () => {
    const boxes = boxesOf(WRONG_ROOM_TEMPLATE);
    const moved = separate(boxes);
    for (const [id, to] of moved) {
      const was = boxes.find((b) => b.id === id)!;
      expect(to.x).toBe(Math.round(was.x));
      expect(to.y).toBeGreaterThan(was.y);
    }
  });

  it('touches nothing that was already clear', () => {
    const clear: Placed[] = [
      { id: 'a', x: 0, y: 0, w: 300, h: 200 },
      { id: 'b', x: 400, y: 0, w: 300, h: 200 },
    ];
    expect(separate(clear).size).toBe(0);
  });
});

describe('tidy: the workflow in the order it runs', () => {
  const chain: Placed[] = [
    { id: 'clip2', x: 0, y: 0, w: 300, h: 550 },
    { id: 'brief', x: 900, y: 500, w: 270, h: 200 },
    { id: 'clip1', x: 50, y: 900, w: 300, h: 550 },
    { id: 'image', x: 900, y: 0, w: 270, h: 300 },
  ];
  const wires = [
    { source: 'brief', target: 'clip1' },
    { source: 'image', target: 'clip1' },
    { source: 'clip1', target: 'clip2' },
  ];

  it('puts everything to the right of what it reads from', () => {
    const at = tidy(chain, wires);
    expect(at.get('brief')!.x).toBe(at.get('image')!.x);
    expect(at.get('clip1')!.x).toBeGreaterThan(at.get('brief')!.x + 270);
    expect(at.get('clip2')!.x).toBeGreaterThan(at.get('clip1')!.x + 300);
  });

  it('stacks a column by measured height, keeping its top-to-bottom order', () => {
    const at = tidy(chain, wires);
    expect(at.get('image')!.y).toBeLessThan(at.get('brief')!.y);
    expect(at.get('brief')!.y).toBeGreaterThanOrEqual(at.get('image')!.y + 300);
  });

  it('overlaps nothing, and a second press changes nothing', () => {
    const once = apply(chain, tidy(chain, wires));
    expect(overlapping(once)).toBe(0);
    expect(tidy(once, wires)).toEqual(tidy(chain, wires));
  });

  it('survives a wire that loops back', () => {
    const loop = [...wires, { source: 'clip2', target: 'brief' }];
    const at = tidy(chain, loop);
    expect(at.size).toBe(chain.length);
    expect(overlapping(apply(chain, at))).toBe(0);
  });

  it('lays out the 26-node template with nothing overlapping', () => {
    const boxes = boxesOf(WRONG_ROOM_TEMPLATE);
    expect(overlapping(apply(boxes, tidy(boxes, WRONG_ROOM_TEMPLATE.edges)))).toBe(0);
  });
});

describe('the canvas uses them', () => {
  it('separates once per workflow, after React Flow has measured the nodes, then fits', () => {
    expect(CANVAS).toMatch(/const nodesMeasured = useNodesInitialized\(\);/);
    const effect = CANVAS.slice(CANVAS.indexOf('const settledFor = useRef'), CANVAS.indexOf('const [beforeTidy'));
    expect(effect).toMatch(/if \(settledFor\.current === workflow\.id\) return;/);
    expect(effect).toMatch(/if \(!nodesMeasured\) return;/);
    expect(effect).toMatch(/separate\(measuredBoxes\(\)\)/);
    expect(effect).toMatch(/fitView\(FIT\)/);
  });

  it('leaves a blank canvas alone, so the first node added does not move the view', () => {
    const effect = CANVAS.slice(CANVAS.indexOf('const settledFor = useRef'), CANVAS.indexOf('const [beforeTidy'));
    expect(effect).toMatch(/if \(!nodes\.length\) \{ settledFor\.current = workflow\.id; return; \}/);
    expect(effect.indexOf('if (!nodes.length)')).toBeLessThan(effect.indexOf('if (!nodesMeasured)'));
  });

  it('moves nodes as React Flow position changes, so the move is saved', () => {
    expect(CANVAS).toMatch(/onNodesChange\(\[\.\.\.to\]\.map\(\(\[id, position\]\) => \(\{ type: 'position', id, position \}\)\)\)/);
  });

  it('measures through React Flow, the copy that carries sizes', () => {
    expect(CANVAS).toMatch(/getNodes\(\)\.map\(\(n\) => \(\{ id: n\.id, \.\.\.boxOf\(n as any\) \}\)\)/);
  });

  it('offers Tidy, and puts the old layout back on a second press', () => {
    expect(CANVAS).toMatch(/onClick=\{handleTidy\}/);
    expect(CANVAS).toMatch(/\{beforeTidy \? '↶ Undo tidy' : '⇉ Tidy'\}/);
    const tidyFn = CANVAS.slice(CANVAS.indexOf('const handleTidy = useCallback'), CANVAS.indexOf('}, [beforeTidy, moveNodes'));
    expect(tidyFn.indexOf('moveNodes(beforeTidy)')).toBeLessThan(tidyFn.indexOf('moveNodes(tidy('));
  });

  it('can zoom out far enough to fit a whole workflow', () => {
    expect(CANVAS).toMatch(/const MIN_ZOOM = 0\.1;/);
    expect(CANVAS).toMatch(/minZoom=\{MIN_ZOOM\}/);
    expect(CANVAS).toMatch(/const FIT = \{[^}]*minZoom: MIN_ZOOM/);
  });
});

describe('the frame around the canvas', () => {
  it('docks the library beside a stage instead of floating it over the canvas', () => {
    expect(CANVAS).toMatch(/<div className="studio-stage" ref=\{reactFlowWrapper\}>/);
    expect(CSS).toMatch(/\.studio-stage \{[^}]*left: var\(--library-w\);/);
    expect(CSS).toMatch(/\.studio-toolbar \{[^}]*width: var\(--library-w\);/);
    expect(CSS).not.toMatch(/\.studio-toolbar \{[^}]*box-shadow/);
  });

  it('folds the library to icons, remembers it, and keeps a name on every button', () => {
    expect(CANVAS).toMatch(/localStorage\.getItem\('studio_library_open'\) !== '0'/);
    expect(CANVAS).toMatch(/aria-expanded=\{libraryOpen\}/);
    const library = CANVAS.split('<aside className="studio-toolbar"')[1].split('</aside>')[0];
    const adds = library.match(/aria-label="Add [^"]+ node"/g) || [];
    const titled = library.match(/aria-label="(Add [^"]+ node)" title="\1"/g) || [];
    expect(titled).toHaveLength(adds.length);
  });

  it('puts Run in the top bar, last, and nowhere in the library', () => {
    const bar = CANVAS.slice(CANVAS.indexOf('<div className="studio-topbar__right">'), CANVAS.indexOf('{/* Limit notice'));
    expect(bar).toMatch(/className="studio-topbar__run"\s+onClick=\{handleRun\}/);
    expect(bar.indexOf('studio-topbar__run')).toBeGreaterThan(bar.indexOf('studio-topbar__save'));
    const library = CANVAS.split('<aside className="studio-toolbar"')[1].split('</aside>')[0];
    expect(library).not.toMatch(/handleRun/);
  });

  it('shows the MCP bridge only while it is connected', () => {
    expect(CANVAS).toMatch(/\{mcpStatus === 'connected' && \(/);
    expect(CANVAS).not.toMatch(/MCP \{mcpStatus === 'connected' \? 'Active' : 'Idle'\}/);
  });

  it('lets the name give way before Run is pushed off the bar', () => {
    expect(CSS).toMatch(/\.studio-topbar__left \{[^}]*min-width: 0;/);
    expect(CSS).toMatch(/\.studio-topbar__right \{[^}]*flex: none;/);
  });
});

describe('ports', () => {
  it('sit outside the node, so they cover nothing on it', () => {
    expect(CSS).toMatch(/\.react-flow__node \.sn-port\.react-flow__handle-left \{ left: -15px !important; \}/);
    expect(CSS).toMatch(/\.react-flow__node \.sn-port\.react-flow__handle-right \{ right: -15px !important; \}/);
  });

  it('name every input any node can have', () => {
    /* Keyed on React Flow's data-handleid, so a new input id with no rule
       here would ship as an unnamed dot — this is the list that catches it. */
    const inputs = new Set(Object.values(NODE_PORTS).flatMap((p) => p.in));
    inputs.add('character');                       // Flow's native character port
    for (const id of inputs) {
      expect({ id, named: new RegExp(`\\.sn-port\\[data-handleid="${id}"\\]\\.react-flow__handle-left::after`).test(CSS) })
        .toEqual({ id, named: true });
    }
  });
});
