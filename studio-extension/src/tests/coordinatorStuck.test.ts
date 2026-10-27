/**
 * Press Run, and nothing happens.
 *
 *   19:47:58  Bridge  Handed to flow — brought its tab forward.
 *   19:48:16  Run     Stopped.
 *
 * Two lines, eighteen seconds apart, and the second one is the evidence.
 * WorkflowRunner.stop() picks its wording from what was in flight:
 *
 *   studioLog('Run', waiting
 *     ? 'Stopped. The step that was running was not waited out.'
 *     : 'Stopped.');
 *
 * The bare form means pendingWaits was EMPTY — the canvas runner was waiting
 * on nothing, because it had dispatched nothing. It had handed the run to the
 * service worker and returned, and the worker had refused it.
 *
 * bridge.startRun() returns whether the manifest was POSTED, not whether the
 * coordinator took it, so a connected port always reads as acceptance. The
 * refusal — `throw new Error('A run is already in progress')` — went into a
 * .catch that wrote to the worker console.
 *
 * And the refusal was permanent, for two reasons that compound:
 *
 *   recover()  restored state = snap.state after Chrome recycled the MV3
 *              worker (~30s idle, so: after any ordinary run), under a
 *              comment saying it does NOT auto-resume. But `state` is what
 *              isRunning() reads and start() guards on. A coordinator
 *              reading 'running' with no loop running can never finish.
 *   stop()     set abortRequested and left `state` to the run loop's finally.
 *              With no loop, nothing set it — so the one control that exists
 *              for this could not clear it either.
 *
 * Which is why it worked the first time and never again.
 */

/// <reference types="node" />

import { readFileSync } from 'fs';
import { join } from 'path';

const read = (...p: string[]) =>
  readFileSync(join(__dirname, '..', ...p), 'utf8').replace(/\r\n/g, '\n');

const COORD = read('background', 'runCoordinator.ts');
const WORKER = read('background', 'service-worker.ts');
const BRIDGE = read('studio', 'engine', 'bridge.ts');

const fn = (src: string, signature: string): string => {
  const at = src.indexOf(signature);
  expect(at).toBeGreaterThan(-1);
  return src.slice(at, src.indexOf('\n  }\n', at));
};

describe('a run that was interrupted is over, not running', () => {
  it('recover() never restores a state that reads as in progress', () => {
    /* nodeStatuses and progress are the display. `state` is the door. */
    const body = fn(COORD, 'async recover()');
    expect(body).toMatch(/snap\.state === 'running' \|\| snap\.state === 'paused'/);
    expect(body).toMatch(/\?\s*'stopped'/);
    expect(body).not.toMatch(/^\s*this\.state = snap\.state;\s*$/m);
  });

  it('still restores what the canvas needs to show', () => {
    const body = fn(COORD, 'async recover()');
    expect(body).toMatch(/this\.nodeStatuses = new Map\(Object\.entries\(snap\.nodeStatuses\)\)/);
    expect(body).toMatch(/this\.progress = \{ \.\.\.snap\.progress \}/);
    expect(body).toMatch(/this\.broadcastState\(\)/);
  });
});

describe('stop can always clear it', () => {
  it('sets the state itself rather than leaving it to a loop', () => {
    /* The loop's finally is the only other place this becomes terminal, and
       the whole failure is the case where there is no loop. */
    const body = fn(COORD, '  stop(): void {');
    expect(body).toMatch(/this\.state = 'stopped';/);
    expect(body).toMatch(/this\.abortRequested = true;/);
  });

  it('and the run loop still has the last word when it is alive', () => {
    expect(COORD).toMatch(/this\.state = this\.abortRequested \? 'stopped' : 'done';/);
  });
});

describe('a refusal is not swallowed', () => {
  it('reaches the Diagnostics feed, not just the worker console', () => {
    const at = WORKER.indexOf("case 'SW_START_RUN':");
    expect(at).toBeGreaterThan(-1);
    const handler = WORKER.slice(at, at + 900);
    expect(handler).toMatch(/diag\('Run',/);
    expect(handler).toMatch(/did not take this run/);
  });

  it('and the guard it trips is still the one that produced the message', () => {
    expect(COORD).toMatch(/if \(this\.isRunning\(\)\) \{\s*\n\s*throw new Error\('A run is already in progress'\);/);
  });
});

describe('what made it invisible, recorded so it is not re-introduced', () => {
  it('startRun reports delivery, not acceptance', () => {
    /* This is the trap. `send` answers "was there a port", and the canvas
       runner treats a true as "the worker owns this run now" and returns.
       If this is ever changed to a real acknowledgement, the diag above stops
       being the only thing standing between a refusal and silence — but until
       then it is, so neither may be removed casually. */
    expect(BRIDGE).toMatch(/startRun\(manifest: RunManifest\): boolean \{\s*\n\s*return this\.send\('SW_START_RUN', manifest\);/);
  });

  it('the canvas runner returns as soon as the manifest is posted', () => {
    const RUNNER = read('studio', 'engine', 'WorkflowRunner.ts');
    expect(RUNNER).toMatch(/if \(this\.tryCoordinatorRun\(nodes, edges, opts\)\) \{[\s\S]{0,200}?return;/);
  });

  it('and the wording of Stop is what told us which side was idle', () => {
    const RUNNER = read('studio', 'engine', 'WorkflowRunner.ts');
    expect(RUNNER).toMatch(/waiting\s*\n?\s*\? 'Stopped\. The step that was running was not waited out\.'\s*\n?\s*: 'Stopped\.'/);
  });
});

describe('the hand-off says what it is doing', () => {
  /* Reported as "need to wait too much to start, and he dont start until I
     stop and retry", with a Diagnostics feed holding exactly two lines:

       23:07:14  Bridge  Handed to flow — brought its tab forward.
       23:07:44  Bridge  The Google Flow tab had no listener — re-injected…

     Thirty seconds apart, which is TAB_PING_MINUTES. So the second line is
     the keepalive ALARM firing for the first time — meaning the tab already
     had no listener when the node was dispatched, half a minute earlier.

     The dispatch path does recover from that. It just never said so: the
     listen, the injection and the wait after it all wrote to console.log or
     pushLog, so the hole read as the run having died. */

  it('reports an absent listener when the node is dispatched, not 30s later', () => {
    const at = WORKER.indexOf("if (msg.type === 'STUDIO_EXECUTE_NODE') {");
    const dispatch = WORKER.slice(WORKER.indexOf('if (!ready) {', at));
    expect(dispatch.slice(0, 900)).toMatch(/diag\('Bridge',/);
    expect(dispatch.slice(0, 900)).toMatch(/injecting the adapter before/);
  });

  it('waits for the listener the way the keepalive routine measured', () => {
    /* Its comment is explicit: executeScript resolving means the FILE was
       injected, not that the script has added its onMessage listener. That
       routine asks four times over ~1.2s. The dispatch retry slept 1500ms
       once and then sent, so an adapter about to work perfectly could still
       be reported as unreachable. */
    expect(WORKER).toMatch(/async function waitForListener\(tabId: number/);
    expect(WORKER).toMatch(/await chrome\.tabs\.sendMessage\(tabId, \{ type: 'PING' \}\);\s*\n\s*return true;/);
    expect(WORKER).not.toMatch(/await new Promise\(\(r\) => setTimeout\(r, 1500\)\);/);
  });

  it('names the fix a user can actually apply', () => {
    /* "tab not reachable after injecting" describes the machine. Reloading
       the tab is the thing that works — an adapter cannot attach to a page
       that predates it. */
    expect(WORKER).toMatch(/Reload that tab and run again/);
    expect(WORKER).toMatch(/Reloading that tab is the fix/);
    expect(WORKER).toMatch(/the adapter cannot attach to a page/);
  });
});
