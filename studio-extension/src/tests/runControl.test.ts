/**
 * Stop, during the only time anybody presses it.
 *
 * Reported as: Stop and Pause do nothing. They looked wired — the panel sends
 * PANEL_CONTROL, the worker relays STUDIO_CONTROL, the Canvas calls
 * runner.stop(), and stop() sets abortRequested and tells the content script.
 * Every link was there.
 *
 * The flag is read BETWEEN nodes. A run sits INSIDE one — parked in
 * awaitBridge, which resolves on a result, an error, or its timeout, and
 * listens for nothing else. So pressing Stop while a Flow clip was generating
 * set a flag nobody would read for up to twenty minutes, and the run carried
 * on in front of somebody who had just told it not to.
 *
 * Pause has the honest version of the same shape: a generation already
 * submitted cannot be un-submitted, so it really does have to wait. That is
 * defensible; leaving it to be inferred from a button that appears dead is
 * not.
 */

/// <reference types="node" />

import { readFileSync } from 'fs';
import { join } from 'path';

const SRC = readFileSync(
  join(__dirname, '..', 'studio', 'engine', 'WorkflowRunner.ts'), 'utf8');
const CANVAS = readFileSync(
  join(__dirname, '..', 'studio', 'components', 'Canvas.tsx'), 'utf8');
const PANEL = readFileSync(join(__dirname, '..', 'sidepanel', 'index.ts'), 'utf8');
const WORKER = readFileSync(
  join(__dirname, '..', 'background', 'service-worker.ts'), 'utf8');

const fn = (name: string): string => {
  const at = SRC.indexOf(name);
  return at === -1 ? '' : SRC.slice(at, SRC.indexOf('\n  }', at));
};

describe('the chain from the button to the runner', () => {
  it('the panel asks', () => {
    expect(PANEL).toMatch(/btn-stop'\)\.addEventListener\('click', \(\) => control\('stop'\)\)/);
    expect(PANEL).toMatch(/type: 'PANEL_CONTROL', action/);
  });

  it('the worker relays to the window the runner lives in', () => {
    expect(WORKER).toMatch(/PANEL_CONTROL[\s\S]{0,400}STUDIO_CONTROL/);
  });

  it('the canvas turns it into a call', () => {
    expect(CANVAS).toMatch(/action === 'stop'[\s\S]{0,80}runner\.stop\(\)/);
  });

  it('and says so when Studio is not open, rather than failing quietly', () => {
    expect(WORKER).toMatch(/Studio is not open/);
  });
});

describe('stop reaches the wait, not just the flag', () => {
  it('keeps track of what is being waited on', () => {
    expect(SRC).toMatch(/private pendingWaits = new Set<\(reason: Error\) => void>\(\);/);
  });

  it('registers each wait and clears it when it settles', () => {
    const wait = fn('private awaitBridge');
    expect(wait).toMatch(/this\.pendingWaits\.add\(abort\)/);
    /* In cleanup, so a wait that ends normally does not sit in the set
       forever and get "aborted" long after it resolved. */
    expect(wait).toMatch(/const cleanup = \(\) => \{[\s\S]{0,200}this\.pendingWaits\.delete\(abort\)/);
  });

  it('ends every pending wait when stop is pressed', () => {
    const stop = fn('  stop(): void {');
    expect(stop).toMatch(/this\.abortRequested = true/);
    expect(stop).toMatch(/bridge\.stopExecution\(\)/);
    /* The part that was missing. Telling the content script to stop leaves
       this side waiting for a reply that will now never come. */
    expect(stop).toMatch(/abort\(new Error\('Stopped'\)\)/);
    expect(stop).toMatch(/this\.pendingWaits\.clear\(\)/);
  });

  it('still checks the flag between nodes, for the gaps a wait cannot cover', () => {
    /* Belt and braces: a stop pressed between two nodes has no pending wait
       to end, and the loop check is what catches it. */
    expect(SRC).toMatch(/if \(this\.abortRequested\) \{\s*\n\s*this\.state = 'stopped';/);
  });
});

describe('what the user sees after pressing it', () => {
  it('does not mark the stopped node as failed', () => {
    /* It read "Stopped" in red, and Retry Failed offered to run it again —
       so stopping a run produced something that looked like a bug in it. */
    expect(SRC).toMatch(/if \(this\.abortRequested\) \{[\s\S]{0,220}status: 'idle', progress: 0, errorMessage: null/);
  });

  it('says stopping happened, and whether it cut something short', () => {
    const stop = fn('  stop(): void {');
    expect(stop).toMatch(/studioLog\('Run'/);
    expect(stop).toMatch(/was not waited out/);
  });

  it('admits that pause has to wait for the step already running', () => {
    /* True, and previously left to be inferred from a button that looked
       dead. A generation already submitted to Flow cannot be un-submitted. */
    const pause = fn('  pause(): void {');
    expect(pause).toMatch(/this\.pauseRequested = true/);
    expect(pause).toMatch(/studioLog\('Run', 'Pausing — the step already running has to finish first\.'\)/);
  });

  it('only says that when something is actually running', () => {
    /* Between nodes the pause is immediate, and claiming otherwise would be
       its own small lie. */
    expect(fn('  pause(): void {')).toMatch(/if \(this\.pendingWaits\.size\)/);
  });

  it('says when it resumes', () => {
    expect(fn('  resume(): void {')).toMatch(/studioLog\('Run', 'Resumed\.'\)/);
  });
});
