/**
 * Studio's metering must outlive the Studio page, and its tab lifecycle
 * must be witnessed by something that outlives the tab.
 *
 * ── The gap this closes ──────────────────────────────────────────────────
 *
 * Studio's only trackSubmission call lived in WorkflowRunner, which Canvas
 * starts — so it runs in the Studio page. Close Studio and reporting stops
 * while the generation it already paid for carries on.
 *
 * That is not hypothetical. The queue extension had the identical shape with
 * its side panel, and the dashboard read 0 sent against 2,492 charged until
 * reporting moved to the background. Studio's version is worse, because a
 * page Chrome is free to discard is easier to lose than a panel a user has
 * to close.
 *
 * It also blocks the background-working plan directly. Step 4 says "Studio
 * must remain open in this first release" — the moment that stops being
 * true, every generation Studio submits becomes invisible to metering unless
 * this is already in place.
 *
 * ── And why the tab listeners are here ───────────────────────────────────
 *
 * Step 1 is "measure before changing focus behaviour". The measurement that
 * matters is whether a hidden run fails to submit or merely fails to be
 * collected — opposite problems that look identical today. Only the worker
 * survives a discarded tab, so only the worker can record that it happened.
 */

/// <reference types="node" />

import { readFileSync } from 'fs';
import { join } from 'path';

const WORKER = readFileSync(
  join(__dirname, '..', 'background', 'service-worker.ts'), 'utf8').replace(/\r\n/g, '\n');
const FLOW = readFileSync(
  join(__dirname, '..', 'content', 'flow', 'index.ts'), 'utf8').replace(/\r\n/g, '\n');

/** Block comments stripped, so prose cannot satisfy an assertion. Line
    comments are left alone: stripping them eats the `//` in every URL. */
const codeOnly = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, '');

const CODE = codeOnly(WORKER);

/* The reporting block, found by a marker unique to it.
   "msg.type === 'STUDIO_NODE_RESULT'" appears earlier in this file too, so
   indexOf on that lands in an unrelated branch — which is how the first run
   of these tests failed against code that was perfectly correct. */
const reportBlock = (): string => {
  const at = CODE.indexOf('_reportedStudioSubmissions.has(');
  expect(at).toBeGreaterThan(-1);
  return CODE.slice(Math.max(0, at - 400), at + 900);
};

describe('the background reports Studio submissions', () => {
  it('calls trackSubmission itself, not only the in-page runner', () => {
    expect(CODE).toMatch(/import \{ trackSubmission \}/);
    expect(CODE).toMatch(/trackSubmission\(\{/);
  });

  it('reports on the result message, which the worker receives directly', () => {
    expect(reportBlock()).toMatch(/trackSubmission\(\{/);
  });

  it('reports only when there is a media id to be idempotent on', () => {
    expect(reportBlock()).toMatch(/msg\.payload\?\.mediaId/);
  });

  it('does not re-post the same id while the worker lives', () => {
    expect(CODE).toMatch(/const _reportedStudioSubmissions = new Set<string>\(\)/);
    expect(reportBlock()).toMatch(/!_reportedStudioSubmissions\.has\(/);
  });

  it('never lets metering fail a generation', () => {
    const at = CODE.indexOf('trackSubmission({');
    expect(CODE.slice(at, at + 400)).toMatch(/\.catch\(/);
  });

  it('is marked as studio so the two products do not double-count', () => {
    const at = CODE.indexOf('trackSubmission({');
    expect(CODE.slice(at, at + 400)).toMatch(/mode: 'studio'/);
  });
});

describe('tab lifecycle is witnessed by the worker', () => {
  /* Each of these destroys the page's own state, so the page cannot be the
     one to report it. */
  const EVENTS: Array<[string, string]> = [
    ['a closed tab', 'chrome.tabs.onRemoved.addListener'],
    ['a discarded tab', 'chrome.tabs.onUpdated.addListener'],
    ['a replaced tab', 'chrome.tabs.onReplaced.addListener'],
  ];

  for (const [what, marker] of EVENTS) {
    it(`records ${what}`, () => {
      expect(CODE).toContain(marker);
    });
  }

  it('treats discard as the interesting update, not every update', () => {
    const at = CODE.indexOf('chrome.tabs.onUpdated.addListener');
    expect(CODE.slice(at, at + 400)).toMatch(/changeInfo\.discarded === true/);
  });

  it('keys tab entries by tab, since Chrome does not say which attempt', () => {
    expect(CODE).toMatch(/const tabAttemptKey = \(tabId: number\) => `tab-\$\{tabId\}`/);
  });

  /* Instrumentation that throws takes down the thing it measures, and a
     context without chrome.tabs is a real case (tests, odd hosts). */
  it('cannot throw in a context without chrome.tabs', () => {
    const at = CODE.indexOf('chrome.tabs.onRemoved.addListener');
    const around = CODE.slice(Math.max(0, at - 200), at + 900);
    expect(around).toMatch(/try \{/);
    expect(around).toMatch(/\} catch/);
  });
});

describe('visibility is captured where it is knowable', () => {
  /* Only the page knows whether it was hidden, and by the time the worker
     records the submission the tab may be gone. So the page has to say. */
  it('the flow adapter puts it on the result', () => {
    const at = FLOW.indexOf("type: 'STUDIO_NODE_RESULT'");
    expect(at).toBeGreaterThan(-1);
    expect(FLOW.slice(at, at + 900)).toMatch(/hidden:/);
    expect(FLOW.slice(at, at + 900)).toMatch(/document\.hidden/);
  });

  it('reading it cannot break the result it rides on', () => {
    const at = FLOW.indexOf("type: 'STUDIO_NODE_RESULT'");
    const block = FLOW.slice(at, at + 900);
    const h = block.indexOf('document.hidden');
    expect(block.slice(Math.max(0, h - 120), h + 60)).toMatch(/try \{/);
  });

  it('the worker records it against the submission', () => {
    expect(reportBlock()).toMatch(/hidden: msg\.payload\.hidden/);
  });

  it('omits it rather than guessing when the page could not say', () => {
    expect(reportBlock()).toMatch(/typeof msg\.payload\.hidden === 'boolean'/);
  });
});
