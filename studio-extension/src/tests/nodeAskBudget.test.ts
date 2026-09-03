/**
 * Every clipping node runs under an API ask ceiling.
 *
 * The website gets one because runWebClipping owns the whole video and can
 * open a budget around it. The canvas has no such moment: a Clipping node lays
 * out Cut nodes that execute separately, later, and one at a time when someone
 * re-runs a single clip. So the unit is the node, and the wiring lives in
 * WorkflowRunner — which means it is exactly the kind of thing that gets
 * dropped by a refactor of the method around it, silently, with the only
 * symptom being a bill.
 *
 * askBudget.test.ts proves the budget works. This proves it is still switched
 * on, and that it is switched off again afterwards: a node that throws with
 * its allowance still open would hand the remainder to whatever node the
 * runner reaches next.
 */

/// <reference types="node" />

import { readFileSync } from 'fs';
import { join } from 'path';

import { CLIP_NODE_ASK_CEILING, CUT_NODE_ASK_CEILING } from '../studio/clip/runClip';

const ROOT = join(__dirname, '..', '..');
const runner = readFileSync(
  join(ROOT, 'src', 'studio', 'engine', 'WorkflowRunner.ts'),
  'utf8',
);

/** The method body between `private async <name>(` and the next `private async`. */
function methodBody(name: string): string {
  const start = runner.indexOf(`private async ${name}(`);
  expect(start).toBeGreaterThan(-1);
  const next = runner.indexOf('\n  private async ', start + 1);
  return runner.slice(start, next === -1 ? undefined : next);
}

describe('the ceilings match the asks a node can actually make', () => {
  it('a cut can make six, and is allowed a little more', () => {
    /* 2 to locate the opening line, 2 for the closing one, 1 for the speaker
       across eight stills, 1 for the edit sheet. If a stage is added, this
       number moves first and the comment above it explains why. */
    const worstCase = 2 + 2 + 1 + 1;
    expect(worstCase).toBe(6);
    expect(CUT_NODE_ASK_CEILING).toBeGreaterThan(worstCase);
  });

  it('the stages make one, and are allowed room for a retry', () => {
    expect(CLIP_NODE_ASK_CEILING).toBeGreaterThan(1);
    /* Not so generous that a pathological node is indistinguishable from a
       working one. */
    expect(CLIP_NODE_ASK_CEILING).toBeLessThanOrEqual(CUT_NODE_ASK_CEILING);
  });
});

describe('the runner switches it on', () => {
  it('opens a budget before running the clipping stages', () => {
    const body = methodBody('executeClipNode');
    expect(body).toContain('startAskBudget(CLIP_NODE_ASK_CEILING)');
    expect(body.indexOf('startAskBudget(CLIP_NODE_ASK_CEILING)'))
      .toBeLessThan(body.indexOf('await advance('));
  });

  it('opens a budget before cutting', () => {
    const body = methodBody('executeCutNode');
    expect(body).toContain('startAskBudget(CUT_NODE_ASK_CEILING)');
    expect(body.indexOf('startAskBudget(CUT_NODE_ASK_CEILING)'))
      .toBeLessThan(body.indexOf('await runOneCut('));
  });
});

describe('and switches it off again', () => {
  /* The half that is easy to lose. An open budget outlives the node that
     opened it, so a stage that throws would leave the next node running on
     someone else's remainder — or on none at all. */
  it('closes the clipping budget even when a stage throws', () => {
    const body = methodBody('executeClipNode');
    expect(body).toMatch(/finally\s*\{[^}]*startAskBudget\(null\)/);
  });

  it('closes the cut budget even when the cut throws', () => {
    const body = methodBody('executeCutNode');
    expect(body).toMatch(/\.finally\(\(\)\s*=>\s*startAskBudget\(null\)\)/);
  });
});
