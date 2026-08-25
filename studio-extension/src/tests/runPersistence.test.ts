/**
 * A run you did once should not have to be done again.
 *
 * The complaint: "I don't want to run the clipping every time I open the
 * workflow. Just one time and get all the data saved." Everything a run
 * produces already lives in node data — the stages, the reading, the located
 * boundaries, the caption phrases — so the question was never what to store.
 * It was whether anything ever wrote it down.
 *
 * Two holes, both here:
 *
 *   · autosave GAVE UP when it fired during a run instead of waiting. The
 *     timer that fired mid-run was the last one armed: every node update after
 *     it happened inside the run, the run ended without touching anything, and
 *     nothing rescheduled. The finished job was never saved.
 *
 *   · autosave ignores a canvas that has never been saved by hand, which is
 *     right for a scratch workspace and wrong for one that just spent ten
 *     minutes reading a video and cutting nine clips from it.
 */

/// <reference types="node" />

import { readFileSync } from 'fs';
import { join } from 'path';

/* The store pulls in chrome.storage and the canvas; the two rules under test
   are the scheduler's, so they are exercised against the same shape rather
   than by booting Studio. */

interface StoreShape {
  isDirty: boolean;
  isRunning: boolean;
  nodes: unknown[];
  workflow: { id: string };
  savedWorkflows: Array<{ id: string }>;
  saveWorkflow: () => Promise<boolean>;
}

/**
 * The scheduler, as store.ts implements it.
 *
 * Kept in the test rather than exported because what matters is the DECISION —
 * wait, skip, or save — and a copy that disagrees with the original is caught
 * by the source assertion at the bottom.
 */
function makeScheduler(getState: () => StoreShape, delay = 0) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const schedule = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(async () => {
      const s = getState();
      if (!s.isDirty || s.nodes.length === 0) return;
      if (s.isRunning) { schedule(); return; }
      const known = s.savedWorkflows.some((w) => w.id === s.workflow.id);
      if (!known) return;
      await s.saveWorkflow();
    }, delay);
  };
  return schedule;
}

const settle = () => new Promise((r) => setTimeout(r, 5));

function state(over: Partial<StoreShape> = {}): StoreShape & { saved: number } {
  const s: any = {
    isDirty: true,
    isRunning: false,
    nodes: [{}],
    workflow: { id: 'wf-1' },
    savedWorkflows: [{ id: 'wf-1' }],
    saved: 0,
    ...over,
  };
  s.saveWorkflow = async () => { s.saved++; return true; };
  return s;
}

describe('autosave while a run is in flight', () => {
  it('waits for the run instead of giving up on it', async () => {
    /* THE BUG. Returning here armed nothing else, so the timer that fired
       during a run was the last one and the finished run was never written. */
    const s = state({ isRunning: true });
    makeScheduler(() => s)();

    await settle();
    expect(s.saved).toBe(0);          // nothing saved mid-run, correctly

    s.isRunning = false;              // the run finishes
    await settle();
    expect(s.saved).toBe(1);          // and the wait pays off
  });

  it('saves a workflow that is not running', async () => {
    const s = state();
    makeScheduler(() => s)();
    await settle();
    expect(s.saved).toBe(1);
  });

  it('still leaves a scratch canvas alone', async () => {
    /* The rule that was right all along: a canvas nobody ever saved does not
       start accumulating in storage on its own. */
    const s = state({ savedWorkflows: [] });
    makeScheduler(() => s)();
    await settle();
    expect(s.saved).toBe(0);
  });

  it('does nothing for an empty canvas or an unchanged one', async () => {
    for (const over of [{ nodes: [] }, { isDirty: false }]) {
      const s = state(over);
      makeScheduler(() => s)();
      await settle();
      expect(s.saved).toBe(0);
    }
  });
});

describe('what the real store and runner do', () => {
  /* Asserted against the source, because the behaviour is a scheduler and a
     lifecycle hook rather than a pure function, and the risk being guarded is
     that one of them is quietly reverted. */
  /* Normalised on the way in: git checks this repository out with CRLF on
     Windows, so a source assertion that cares about line endings passes or
     fails on who last wrote the file rather than on the code. */
  const read = (...p: string[]) =>
    readFileSync(join(__dirname, '..', ...p), 'utf8').replace(/\r\n/g, '\n');

  const store = read('studio', 'store.ts');
  const runner = read('studio', 'engine', 'WorkflowRunner.ts');

  it('reschedules rather than returning when a run is in flight', () => {
    expect(store).toMatch(/if \(s\.isRunning\) \{ scheduleAutosave\(\); return; \}/);
  });

  it('no longer folds isRunning into the give-up condition', () => {
    expect(store).not.toMatch(/!s\.isDirty \|\| s\.isRunning \|\| s\.nodes\.length === 0/);
  });

  it('saves when the run finishes, rather than on the next edit', () => {
    /* Nothing edits a workflow after a run ends, so waiting for an edit means
       waiting forever. */
    expect(runner).toMatch(/persistAfterRun\(\)/);
  });

  it('saves a finished run even on a canvas never saved by hand', () => {
    expect(store).toMatch(/persistAfterRun: async \(\) => \{/);
    const body = store.slice(store.indexOf('persistAfterRun: async'));
    expect(body.slice(0, 200)).not.toMatch(/savedWorkflows/);
  });
});
