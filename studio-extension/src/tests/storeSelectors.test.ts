/* ============================================================
   Selectors must return something stable.

   Zustand v5 compares snapshots with Object.is. A selector that builds a new
   object on every call is therefore "changed" on every store read, and React
   re-renders, re-reads, and never settles. It does not degrade — it hangs the
   tab: an Extend node did exactly this, and clicking one turned the whole
   Studio window black with no message and no way back.

   The rule cannot be checked by reading the code, because the offending call
   looks completely ordinary:

       useStudioStore((s) => extendChain(id, s.nodes, s.edges))

   So it is checked by identity: call the thing twice against unchanged input
   and see whether the same reference comes back.
   ============================================================ */

// tsconfig limits `types` to chrome + jest so node globals stay out of the
// extension source; only this harness reads files off disk.
/// <reference types="node" />

import { readFileSync } from 'fs';
import { join } from 'path';
import { extendChain } from '../studio/templates/validate';

const NODES = [
  { id: 'g1', type: 'generate', data: { type: 'generate', platform: 'grok', mediaType: 'video', duration: '10s' } },
  { id: 'e1', type: 'extend', data: { type: 'extend', extendSeconds: '+10s' } },
];
const EDGES = [
  { id: 'x', source: 'g1', target: 'e1', sourceHandle: 'result', targetHandle: 'video' },
];

describe('extendChain', () => {
  it('returns a new object each call', () => {
    /* Not a defect in itself — it is why the result must never be produced
       inside a selector. Stated as a test so the constraint is visible from
       the function rather than only from the component that misused it. */
    const a = extendChain('e1', NODES, EDGES);
    const b = extendChain('e1', NODES, EDGES);
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
  });

  it('gives the same answer for the same canvas', () => {
    // Stability of value, so a memo over [nodes, edges] is sound.
    expect(extendChain('e1', NODES, EDGES)).toEqual({
      secondsBefore: 10, index: 1, rootId: 'g1', problem: null,
    });
  });
});

describe('the Extend node', () => {
  const SOURCE = readFileSync(
    join(__dirname, '../studio/nodes/ExtendNode.tsx'), 'utf8'
  );

  it('does not call extendChain inside a store selector', () => {
    /* The exact shape that hung the tab. Checked against the source because
       the failure is a render loop — there is no value to assert on, and by
       the time it shows it has taken the application with it. */
    expect(SOURCE).not.toMatch(/useStudioStore\(\s*\([^)]*\)\s*=>\s*extendChain/);
  });

  it('computes the chain in a memo instead', () => {
    expect(SOURCE).toMatch(/useMemo\(\s*\(\)\s*=>\s*extendChain/);
  });
});

describe('every node type is guarded', () => {
  const CANVAS = readFileSync(
    join(__dirname, '../studio/components/Canvas.tsx'), 'utf8'
  );

  it('wraps each node in an error boundary', () => {
    /* One node throwing used to unmount the canvas, so a saved workflow
       became unopenable and the window went black. Containing it per node
       turns that into one card with a message. */
    const map = CANVAS.slice(CANVAS.indexOf('const nodeTypes'), CANVAS.indexOf('function CanvasInner'));
    for (const kind of ['prompt', 'image', 'generate', 'frame', 'extend']) {
      expect({ kind, guarded: new RegExp(`${kind}:\\s*guarded\\(`).test(map) })
        .toEqual({ kind, guarded: true });
    }
  });
});
