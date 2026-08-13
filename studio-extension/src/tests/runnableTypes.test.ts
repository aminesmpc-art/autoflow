/* ============================================================
   Which node types actually run.

   This was four separate `type === 'generate'` checks — the Run button, the
   billing count, the retry filter and the runner's own step filter — and
   adding the agent broke three of them at once. A canvas made only of agents
   had Run permanently greyed out, a failed agent could not be retried, and
   only the runner knew agents execute at all. Nothing errored; the button was
   just dead.

   One predicate now, and this test is what stops the next runnable type
   drifting back apart.
   ============================================================ */

/// <reference types="node" />
import { readFileSync } from 'fs';
import { join } from 'path';
import { RUNNABLE_NODE_TYPES, isRunnableType, NODE_PORTS } from '../studio/templates/validate';

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');

describe('the runnable list', () => {
  it('contains every type that executes, and nothing that only carries data', () => {
    expect([...RUNNABLE_NODE_TYPES].sort()).toEqual(['agent', 'extend', 'generate', 'story']);
    for (const t of ['prompt', 'image', 'frame']) {
      expect(isRunnableType(t)).toBe(false);
    }
  });

  it('only names types the canvas can actually draw', () => {
    for (const t of RUNNABLE_NODE_TYPES) {
      expect(NODE_PORTS[t]).toBeDefined();
    }
  });

  it('shrugs at rubbish rather than throwing', () => {
    for (const v of [undefined, null, 0, {}, [], '']) {
      expect(isRunnableType(v)).toBe(false);
    }
  });
});

describe('nobody re-hardcodes the check', () => {
  /* Grep rather than behaviour: the failure mode is a NEW site written as
     `type === 'generate'`, which no unit test of existing behaviour catches. */
  const FILES = [
    'studio/components/Canvas.tsx',
    'studio/engine/WorkflowRunner.ts',
  ];

  it.each(FILES)('%s decides runnability through the shared predicate', (file) => {
    const src = read(file);
    expect(src).toContain('isRunnableType');
  });

  it('the runner dispatches every runnable type', () => {
    /* The filter said agents run; the switch had no case for one, so it fell
       through to `default` and was skipped as an unknown type — counted in
       the progress total and never executed. Two lists, one of them wrong,
       and no error anywhere. */
    const src = read('studio/engine/WorkflowRunner.ts');
    for (const t of RUNNABLE_NODE_TYPES) {
      expect(src).toContain(`case '${t}':`);
    }
  });

  it('Canvas gates Run on the predicate, not on generate alone', () => {
    const src = read('studio/components/Canvas.tsx');
    const canRun = src.split('\n').find((l) => l.includes('const canRun'));
    expect(canRun).toBeDefined();
    expect(canRun).toContain('isRunnableType');
    // The exact shape that disabled Run on an agent-only canvas.
    expect(canRun).not.toMatch(/===\s*'generate'/);
  });
});
