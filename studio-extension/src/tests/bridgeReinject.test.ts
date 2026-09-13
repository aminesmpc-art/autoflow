/**
 * @jest-environment jsdom
 *
 * "WHY HE OLWAYSE SEE THIS ??? — Bridge: No content script was listening in
 * the Google Flow tab - re-injected it."
 *
 * Because that one line was printed for two unrelated situations, and never
 * said whether it had helped:
 *
 *   the adapter is orphaned in the right tab   re-injecting fixes it, and it
 *                                              is worth saying once
 *   the kept tab is not a Flow tab at all      re-injecting a Flow content
 *                                              script into an unrelated page
 *                                              cannot help, and the ping will
 *                                              fail again on the next tick
 *
 * The routine runs every thirty seconds. In the second case it re-injected,
 * announced it, failed again, re-injected, announced it — forever, which is
 * what "always" was. Nothing in the message distinguished a one-off recovery
 * from a loop that was never going to end.
 *
 * So: check the tab is the platform's before injecting anything, ping again
 * afterwards to find out whether it worked, and say each of those things once
 * rather than on every tick.
 */

/// <reference types="node" />

import { readFileSync } from 'fs';
import { join } from 'path';

const WORKER = readFileSync(
  join(__dirname, '..', 'background', 'service-worker.ts'), 'utf8').replace(/\r\n/g, '\n');

/**
 * A stand-in for the extension API, deep enough to import the worker.
 *
 * The worker registers its listeners at module scope, so importing it touches
 * chrome.alarms, chrome.runtime and several others before a single test runs.
 * Anything reached returns another one of these and is callable, which is
 * enough for registration; nothing here is asserted on.
 */
const chromeStub = (): any => new Proxy(function () { /* callable */ } as any, {
  get: (_t, prop) => (prop === 'then' ? undefined : chromeStub()),
  apply: () => Promise.resolve(undefined),
});

let matchesUrlPattern: (url: string, pattern: string) => boolean;

beforeAll(() => {
  (globalThis as any).chrome = chromeStub();
  // Required lazily: an import would be hoisted above the stub.
  ({ matchesUrlPattern } = require('../background/service-worker'));
});

describe('is the kept tab even the right platform', () => {
  it('recognises a Flow project page', () => {
    expect(matchesUrlPattern('https://flow.google.com/project/abc', 'https://flow.google.com/*'))
      .toBe(true);
  });

  it('recognises the old host, which still resolves', () => {
    expect(matchesUrlPattern('https://labs.google/fx/tools/flow', 'https://labs.google/fx*'))
      .toBe(true);
  });

  it('does not take the Studio canvas for a Flow tab', () => {
    /* The case that produced the loop: injecting a Flow adapter here can
       never make it answer, so the ping fails again thirty seconds later. */
    expect(matchesUrlPattern('https://www.auto-flow.studio/canvas', 'https://flow.google.com/*'))
      .toBe(false);
  });

  it('does not take another Google product for Flow', () => {
    expect(matchesUrlPattern('https://gemini.google.com/app', 'https://flow.google.com/*'))
      .toBe(false);
  });

  it('treats the dots in a host as dots', () => {
    /* An unescaped pattern would match this, since . is any character. */
    expect(matchesUrlPattern('https://flowXgoogleXcom/project', 'https://flow.google.com/*'))
      .toBe(false);
  });

  it('does not match a host that merely starts the same', () => {
    expect(matchesUrlPattern('https://flow.google.com.evil.test/x', 'https://flow.google.com/*'))
      .toBe(false);
  });
});

describe('what the bridge says, and how often', () => {
  it('still injects when the URL cannot be read', () => {
    /* This extension holds no "tabs" permission, only host permissions, so
       chrome.tabs.get leaves `url` empty for anything off those hosts.
       Reading empty as "wrong tab" would have stopped re-injection
       altogether — the guard is meant to prevent a pointless injection, not
       to invent a new way of doing nothing. */
    expect(WORKER).toMatch(/const onPlatform = !url \|\| patterns\.some/);
  });

  it('checks the tab is the platform before injecting into it', () => {
    expect(WORKER).toMatch(/patterns\.some\(\(p\) => matchesUrlPattern\(url, p\)\)/);
    expect(WORKER).toMatch(/injecting into it would not help/);
  });

  it('pings again afterwards, rather than assuming', () => {
    /* The old line described the attempt. The outcome is the useful part. */
    const at = WORKER.indexOf('executeScript({ target: { tabId: keptTabId }, files: [conf.script] })');
    expect(at).toBeGreaterThan(-1);
    expect(WORKER.slice(at, at + 1800)).toMatch(/sendMessage\(keptTabId, \{ type: 'PING' \}\)/);
  });

  it('gives the script a moment to register before calling it broken', () => {
    /* executeScript resolving means the FILE was injected, not that the script
       has run far enough to add its onMessage listener. Pinging immediately
       failed on a re-injection that was about to work perfectly, and the
       failure message reads "the adapter is failing as it loads" — alarming,
       and in the run that produced it, false: the Flow adapter started its
       queue two seconds later and completed the node. */
    expect(WORKER).toMatch(/for \(let i = 0; i < 4 && !answered; i\+\+\)/);
    expect(WORKER).toMatch(/if \(i\) await new Promise\(\(r\) => setTimeout\(r, 400\)\);/);
  });

  it('still reports a genuinely dead adapter on the same tick', () => {
    /* The retry is ~1.2s, not a new grace period. A tab that will never answer
       is still named now rather than next time round. */
    expect(WORKER).toMatch(/if \(!answered\) throw new Error\('no answer'\);/);
  });

  it('says when the re-injection worked', () => {
    expect(WORKER).toMatch(/re-injected, and it answers now/);
  });

  it('says when it did not, which is a different problem', () => {
    expect(WORKER).toMatch(/still does not answer after re-injecting/);
  });

  it('states a standing condition once, not every thirty seconds', () => {
    expect(WORKER).toMatch(/let reinjectSaidFor: string \| null = null;/);
    expect(WORKER).toMatch(/if \(reinjectSaidFor !== 'recovered'\)/);
    expect(WORKER).toMatch(/if \(reinjectSaidFor !== 'stuck'\)/);
  });

  it('lets the next real failure be news again', () => {
    /* Cleared the moment a ping succeeds, so a later orphaning is reported
       rather than swallowed by the flag from an hour ago. */
    expect(WORKER).toMatch(/reinjectSaidFor = null;\s*\/\/ it answered/);
  });

  it('forgets what it said when the run ends', () => {
    const at = WORKER.indexOf('async function stopKeepalive');
    expect(WORKER.slice(at, at + 400)).toMatch(/reinjectSaidFor = null;/);
  });
});

/* ── "every time i run a workflow needs 30s to start every time why" ─────
 *
 * Running · 0:27 · 0 / 2 nodes completed · 0%, and Execution Diagnostics
 * reading "No log entries yet." Twenty-seven seconds in and nothing had
 * reached the Flow adapter at all — so the delay was in front of it.
 *
 *   const ready = await waitForTabReady(tabId, 30_000);
 *   if (!ready) {
 *     await chrome.scripting.executeScript(…)   ← the thing that fixes it
 *   }
 *
 * The whole thirty seconds went on pinging a tab with no content script,
 * before trying the injection that would have answered in one. The budget is
 * meant for a page still LOADING; it was being spent on a page that had
 * finished loading and simply had no script.
 *
 * A loaded page either has one or it does not, and waiting does not change
 * which.
 */
describe('a run does not begin by waiting half a minute', () => {
  it('keeps the long budget for a page that is still loading', () => {
    const at = WORKER.indexOf('async function waitForTabReady');
    const body = WORKER.slice(at, WORKER.indexOf('\n}', at));
    expect(body).toMatch(/if \(tab\.status === 'complete'\) break;/);
    expect(body).toMatch(/while \(Date\.now\(\) < deadline\)/);
  });

  it('asks a loaded page only briefly, then lets the caller inject', () => {
    const at = WORKER.indexOf('async function waitForTabReady');
    const body = WORKER.slice(at, WORKER.indexOf('\n}', at));
    expect(body).toMatch(/const listenUntil = Math\.min\(deadline, Date\.now\(\) \+ LISTEN_GRACE_MS\);/);
    expect(body).toMatch(/while \(Date\.now\(\) < listenUntil\)/);
  });

  it('measures that grace in seconds, not tens of seconds', () => {
    const ms = /const LISTEN_GRACE_MS = ([\d_]+);/.exec(WORKER);
    expect(ms).not.toBeNull();
    expect(Number(ms![1].replace(/_/g, ''))).toBeLessThanOrEqual(5_000);
  });

  it('still injects when nothing answered', () => {
    /* The remedy is unchanged — it just is not made to wait thirty seconds
       for its turn. */
    expect(WORKER).toMatch(/if \(!ready\) \{\s*\n\s*try \{\s*\n\s*await chrome\.scripting\.executeScript/);
  });

  it('gives the freshly injected script its own wait', () => {
    expect(WORKER).toMatch(/await waitForTabReady\(tabId, 10_000\);/);
  });

  it('still says how long it waited, whenever that is not instant', () => {
    /* The line that would have named this in one run — "Waited 30.0s for the
       Google Flow tab (ready=false)". */
    expect(WORKER).toMatch(/Waited \$\{\(waited \/ 1000\)\.toFixed\(1\)\}s for the \$\{cfg\.name\} tab/);
  });
});
