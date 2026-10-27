/**
 * "Did not start — motion node type requires Canvas presence in v1.5.0"
 *
 * A Motion Control node reported that on a normal Run, and pressing its Retry
 * button reported it again, every time.
 *
 * ── What was happening ──────────────────────────────────────────────────
 *
 * v1.5.0 moved the execution loop into the service worker so a run survives
 * the Studio tab closing. Two node types cannot go there — motion cuts video
 * with a <video> and a canvas, and a worker has no DOM at all; agent's repair
 * loop rewrites the graph between turns.
 *
 * The runner knew that. Its comment said such nodes "fall back to the local
 * execution path below". Nothing implemented it:
 *
 *   tryCoordinatorRun() -> bridge.startRun(manifest) -> this.send(...)
 *
 * which reports whether the MESSAGE went, not whether the graph can be run.
 * So the decision was made once, for the whole run, before any node was
 * looked at — and it was always "delegate". The coordinator then walked to
 * the motion node and threw. That throw is caught by the per-node handler,
 * `isTransientFailure` does not match it, and the node goes red.
 *
 * Retry could not help: it goes through the same run() and delegates again.
 *
 * ── The fix ─────────────────────────────────────────────────────────────
 *
 * Decide from the graph, before sending. One predicate, in the module both
 * sides already import, so the coordinator's idea of what it can run and the
 * runner's idea of what to send it cannot drift apart again — which is how
 * this happened: `isRunnableType` in the coordinator ACCEPTED 'motion' and
 * the code ten lines below it rejected the same value.
 */

/// <reference types="node" />

import { readFileSync } from 'fs';
import { join } from 'path';
import { needsCanvas, CANVAS_ONLY_NODE_TYPES } from '../shared/executionTypes';

const read = (...p: string[]) =>
  readFileSync(join(__dirname, '..', ...p), 'utf8').replace(/\r\n/g, '\n');

const RUNNER = read('studio', 'engine', 'WorkflowRunner.ts');
const COORD = read('background', 'runCoordinator.ts');

describe('which node types need the canvas', () => {
  it('names motion, which cuts video in a DOM the worker does not have', () => {
    expect(needsCanvas('motion')).toBe(true);
  });

  it('names agent, whose repair loop rewrites the graph between turns', () => {
    expect(needsCanvas('agent')).toBe(true);
  });

  it('names story and chief, which write into other nodes on the canvas', () => {
    /* This test used to assert the opposite, and that was the bug after the
       bug: the first list held only motion and agent, so every Director and
       Chief run was delegated to a worker with no branch for either. The
       brief went over as one plain prompt and the reply came back as node
       text — a storyboard written out in prose, with every shot node it was
       supposed to fill still empty and nothing marked red. */
    expect(needsCanvas('story')).toBe(true);
    expect(needsCanvas('chief')).toBe(true);
  });

  it('names clip and cut, which demux video with a browser media library', () => {
    expect(needsCanvas('clip')).toBe(true);
    expect(needsCanvas('cut')).toBe(true);
  });

  it('still lets the two the worker can actually run go to it', () => {
    /* The whole point of v1.5.0: generate and extend keep running with the
       tab shut. They are also exactly what buildConfig describes — prompt,
       platform, model, aspect ratio — which is the test for this list. A
       type whose config the coordinator cannot build does not belong here. */
    for (const t of ['generate', 'extend']) {
      expect(needsCanvas(t)).toBe(false);
    }
  });

  it('does not throw on junk', () => {
    for (const t of [undefined, null, '', 0, {}]) {
      expect(() => needsCanvas(t)).not.toThrow();
      expect(needsCanvas(t)).toBe(false);
    }
  });

  it('is a real list, not an empty one that would pass every test above', () => {
    expect(CANVAS_ONLY_NODE_TYPES.length).toBeGreaterThan(0);
  });
});

describe('the runner decides before it delegates', () => {
  it('asks the graph, not the message channel', () => {
    const at = RUNNER.indexOf('private tryCoordinatorRun');
    expect(at).toBeGreaterThan(-1);
    const body = RUNNER.slice(at, at + 2600);
    /* Per node, not per type: an Ask AI node is a generate node in text mode,
       and only its settings say it needs the canvas. */
    const check = body.indexOf('needsCanvasNode(n)');
    const send = body.indexOf('bridge.startRun(manifest)');
    expect(check).toBeGreaterThan(-1);
    /* Order is the fix. Checking after sending would change nothing: once the
       manifest is gone the coordinator owns the run. */
    expect(check).toBeLessThan(send);
  });

  it('returns false so run() takes the local path', () => {
    const at = RUNNER.indexOf('private tryCoordinatorRun');
    const body = RUNNER.slice(at, at + 2600);
    const blocked = body.indexOf('if (blocked.length)');
    expect(blocked).toBeGreaterThan(-1);
    expect(body.slice(blocked, blocked + 300)).toMatch(/return false;/);
  });

  it('judges a targeted retry on what that retry will run', () => {
    /* Retrying one generate node must still reach the worker, even when the
       workflow contains a Motion node somewhere else. Without the `only`
       scope this fix would have cost every mixed workflow its background
       execution. */
    const at = RUNNER.indexOf('private tryCoordinatorRun');
    const body = RUNNER.slice(at, at + 2600);
    expect(body).toMatch(/!opts\.only \|\| opts\.only\.has\(n\.id\)/);
  });

  it('still delegates a run with nothing blocking in it', () => {
    const at = RUNNER.indexOf('private tryCoordinatorRun');
    const body = RUNNER.slice(at, at + 2600);
    expect(body).toContain('return bridge.startRun(manifest);');
  });
});

describe('the coordinator and the runner cannot drift apart', () => {
  it('the coordinator reads the same predicate rather than its own list', () => {
    /* The bug in one line: the coordinator had `['agent', 'motion'].includes`
       inline, ten lines under an isRunnableType that accepted both. */
    expect(COORD).toMatch(/needsCanvasNode\(node\)/);
    expect(COORD).not.toMatch(/\['agent', 'motion'\]\.includes/);
  });

  it('imports it from the shared contract both sides already use', () => {
    expect(COORD).toMatch(/import \{ needsCanvasNode \} from '\.\.\/shared\/executionTypes'/);
    expect(RUNNER).toMatch(/import \{ needsCanvasNode \} from '\.\.\/\.\.\/shared\/executionTypes'/);
  });

  it('tells the user what to do instead of which version they are on', () => {
    /* "requires Canvas presence in v1.5.0" named the version they were
       already running and no action at all.

       Scoped to what is THROWN, not to the file: the comment above the throw
       quotes the old wording so the next reader knows what this replaced, and
       a file-wide assertion would forbid saying so. */
    const at = COORD.indexOf('if (needsCanvasNode(node))');
    expect(at).toBeGreaterThan(-1);
    const thrown = COORD.slice(at, at + 300);
    expect(thrown).toMatch(/needs the Studio tab open to run/);
    expect(thrown).not.toMatch(/requires Canvas presence/);
  });
});
