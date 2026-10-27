/**
 * "why when i click retry its desnt work"
 *
 * The Retry button did nothing. Not an error, not a log line — nothing.
 *
 * ── The chain ────────────────────────────────────────────────────────────
 *
 * run() set isRunning true near its top and cleared it near its bottom, three
 * hundred lines apart, with exactly ONE try/catch between them covering a
 * single node type. Everything else in that loop — the Director's multi-turn
 * repair, the Chief, a clip decode, a bridge timeout — was unguarded.
 *
 * So a run that threw left the canvas believing a run was still in progress,
 * for ever. Which is invisible, because nothing on screen says "still
 * running" once the nodes have settled.
 *
 * And Retry opened with:
 *
 *     if (isRunning) return;
 *
 * A bare return. The button was dead until the tab was reloaded, and there
 * was no way to find that out from the outside.
 *
 * ── The fix ──────────────────────────────────────────────────────────────
 *
 * run() is now a wrapper whose finally always settles the run state, and the
 * three bare returns in Retry each say why they declined.
 *
 * The delegated path returns BEFORE the try, deliberately: the coordinator
 * owns that run's state and is still broadcasting it, so settling it here
 * would stop a background run the moment it started.
 */

/// <reference types="node" />

import { readFileSync } from 'fs';
import { join } from 'path';

const RUNNER = readFileSync(
  join(__dirname, '..', 'studio', 'engine', 'WorkflowRunner.ts'), 'utf8').replace(/\r\n/g, '\n');
const CANVAS = readFileSync(
  join(__dirname, '..', 'studio', 'components', 'Canvas.tsx'), 'utf8').replace(/\r\n/g, '\n');

describe('a run always ends', () => {
  it('wraps the local run so the state is settled whatever happens', () => {
    const at = RUNNER.indexOf('async run(nodes: Node[], edges: Edge[]');
    expect(at).toBeGreaterThan(-1);
    const body = RUNNER.slice(at, at + 1400);
    expect(body).toMatch(/try \{\s*\n\s*await this\.runLocal\(nodes, edges, opts\);/);
    expect(body).toMatch(/\} finally \{\s*\n\s*this\.settleRun\(\);/);
  });

  it('says what went wrong rather than swallowing it', () => {
    const at = RUNNER.indexOf('async run(nodes: Node[], edges: Edge[]');
    const body = RUNNER.slice(at, at + 1400);
    expect(body).toMatch(/catch \(err: any\)/);
    expect(body).toMatch(/Stopped on an unexpected error/);
  });

  it('settles running, paused and the current node together', () => {
    const at = RUNNER.indexOf('private settleRun(): void {');
    expect(at).toBeGreaterThan(-1);
    const body = RUNNER.slice(at, at + 400);
    expect(body).toMatch(/store\.setRunning\(false\)/);
    expect(body).toMatch(/store\.setPaused\(false\)/);
    expect(body).toMatch(/store\.setCurrentNode\(null\)/);
    expect(body).toMatch(/this\.pauseRequested = false/);
  });

  it('leaves a delegated run alone, because the worker owns its state', () => {
    /* The coordinator is still broadcasting SW_RUN_STATE for that run.
       Settling it here would stop a background run the moment it started. */
    const at = RUNNER.indexOf('async run(nodes: Node[], edges: Edge[]');
    const body = RUNNER.slice(at, at + 1400);
    const delegate = body.indexOf('tryCoordinatorRun');
    const tryAt = body.indexOf('try {');
    expect(delegate).toBeGreaterThan(-1);
    expect(delegate).toBeLessThan(tryAt);
  });

  it('does the delegation once, not once per layer', () => {
    expect(RUNNER.split('tryCoordinatorRun(nodes, edges, opts)').length - 1).toBe(1);
  });
});

describe('Retry says why when it declines', () => {
  it('has no bare returns left in it', () => {
    const at = CANVAS.indexOf('const handleRetry = useCallback');
    expect(at).toBeGreaterThan(-1);
    const body = CANVAS.slice(at, CANVAS.indexOf('runner.run(nodes, edges, { only })', at));
    expect(body).not.toMatch(/if \(isRunning\) return;/);
    expect(body).not.toMatch(/if \(!requested\.length\) return;/);
    expect(body).not.toMatch(/if \(!only\.size\) return;/);
  });

  it('names the run-in-progress case, which is the one that happened', () => {
    const at = CANVAS.indexOf('const handleRetry = useCallback');
    const body = CANVAS.slice(at, at + 1400);
    expect(body).toMatch(/A run is still in progress\. Stop it first/);
  });

  it('names the other two as well', () => {
    const at = CANVAS.indexOf('const handleRetry = useCallback');
    const body = CANVAS.slice(at, at + 1400);
    expect(body).toMatch(/no node is in a failed state/);
    expect(body).toMatch(/switched off, or is not/);
  });

  it('still refuses to start a second run on top of a live one', () => {
    /* The guard itself was right. Only its silence was wrong. */
    const at = CANVAS.indexOf('const handleRetry = useCallback');
    const body = CANVAS.slice(at, at + 1400);
    expect(body).toMatch(/if \(isRunning\) \{/);
    expect(body.indexOf('if (isRunning)')).toBeLessThan(body.indexOf('runner.planRetry'));
  });
});
