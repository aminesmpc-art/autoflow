/**
 * Every chat adapter must say why it is waiting.
 *
 * A Z.AI node sat at 83% for four minutes with the finished reply visible on
 * screen, and the whole of Diagnostics said "waiting for the reply". Four
 * different things produce that exact silence and only one of them is a bug
 * in the adapter:
 *
 *   1. the model is genuinely still thinking (GLM's Deep Think runs minutes);
 *   2. the model finished but the adapter no longer recognises its end-of-turn
 *      marker, because the site shipped a redesign;
 *   3. the reply is being read as empty — right selector, wrong property;
 *   4. the tab is running a content script injected before the last rebuild.
 *
 * (4) deserves its own note: Chrome does NOT replace a content script in an
 * already-open tab when the extension is rebuilt. The tab has to be reloaded.
 * So a fix can be shipped, verified in the bundle, and still absent from the
 * page — and nothing anywhere said which script was actually running. That
 * cost a live debugging session on Z.AI.
 *
 * The fix was to make each adapter report its own signals periodically and
 * name its own build on the way in. It was written for Z.AI; this test is what
 * keeps the other four from being left behind, since the whole failure mode is
 * that silence looks identical everywhere.
 *
 * These tests read the adapter sources. A diagnostic that exists in one
 * adapter is not a diagnostic — the point is that any node, on any platform,
 * can answer "why are you still going".
 */

/// <reference types="node" />

import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..', '..');

/** Z.AI is included: it is where this came from, and it can regress too. */
const ADAPTERS = ['chatgpt', 'gemini', 'claude', 'grok', 'zai'] as const;

const src = (name: string) =>
  readFileSync(join(ROOT, 'src', 'content', name, 'index.ts'), 'utf8');

describe('every chat adapter reports to Diagnostics', () => {
  it.each(ADAPTERS)('%s has a logLine that reaches the panel', (name) => {
    const s = src(name);
    expect(s).toMatch(/function logLine\(/);
    /* console.log alone is not a diagnostic. The user is not holding DevTools
       open on the ChatGPT tab; they are looking at the Diagnostics panel. */
    expect(s).toContain("type: 'STUDIO_LOG'");
  });

  it.each(ADAPTERS)('%s names its build so a stale tab is visible', (name) => {
    const s = src(name);
    expect(s).toMatch(/const ADAPTER_BUILD = '[^']+'/);
    /* Named on a line that runs at the START of a node, not buried in an
       error path — the question "is my fix loaded" has to be answerable
       before the four-minute wait, not after it. */
    expect(s).toMatch(/logLine\([^;]*ADAPTER_BUILD/);
  });

  it.each(ADAPTERS)('%s says why it is still waiting, periodically', (name) => {
    const s = src(name);
    expect(s).toMatch(/Waiting \$\{[^}]*\}s —/);
    /* Reply length is the one number that separates "read nothing" from
       "read something and did not stop". */
    expect(s).toMatch(/reply \$\{[^}]*\.length\} chars/);
  });
});

describe('the periodic line fires on a schedule, not every poll', () => {
  /* A line every 800ms would bury the run's real events — the log is a
     shared surface, and the node's own start/finish lines have to stay
     findable in it. Fifteen seconds is roughly "I have started to wonder". */
  /* The waiting lines pose a question; this is the line that answers it.
     Three adapters had it in console.log only, and Claude never logged the
     capture at all — so the last thing Diagnostics showed was a wait, and a
     run that succeeded looked identical to one still hanging. */
  it.each(ADAPTERS)('%s reports the capture to the same place', (name) => {
    expect(src(name)).toMatch(/logLine\(`Reply captured \(\$\{[^}]*\.length\} chars\)`\)/);
  });

  it.each(ADAPTERS)('%s throttles to a 15s bucket', (name) => {
    const s = src(name);
    expect(s).toMatch(/Math\.floor\([^)]*\/ 15_000\)\s*!==\s*Math\.floor\(/);
    /* Bucketed on elapsed rather than a stored timestamp, so it cannot drift
       or double-fire if the poll interval changes. */
    expect(s).toMatch(/elapsed > 10_000/);
  });
});

describe('the signals reported are ones that adapter actually has', () => {
  /* A completion signal is a positive statement: the site has RENDERED the
     end-of-turn affordance. An absence — no stop button, text unchanged —
     lies during the gap before the first token. Only two adapters have found
     the positive marker so far, and the log has to distinguish those two from
     the ones still guessing, or the line reads as more certain than it is. */
  it('chatgpt and gemini report their positive end-of-turn check', () => {
    for (const name of ['chatgpt', 'gemini']) {
      const s = src(name);
      expect(s).toMatch(/function turnFinished\(/);
      expect(s).toMatch(/Waiting[^`]*finished \$\{String\(turnFinished\(\)\)\}/);
    }
  });

  it('claude and grok report generating, having no finished marker yet', () => {
    for (const name of ['claude', 'grok']) {
      const s = src(name);
      expect(s).not.toMatch(/function turnFinished\(/);
      expect(s).toMatch(/Waiting[^`]*generating \$\{isGenerating\(\)\}/);
    }
  });

  it('zai reports its own turn verdict', () => {
    const s = src('zai');
    /* It used to report a page-wide copy-button count against a baseline
       taken before submitting. That line read "copy buttons 1 (started at 1)"
       for ninety seconds — true, and no help at all, because one can never
       exceed one. The turn's own answer is the useful number. */
    expect(s.replace(/\s+/g, ' ')).toMatch(/turn finished \$\{String\(turnFinished\(\)\)\}/);
    /* Comments stripped: the history of the old line is written down in one,
       and asserting against the prose would fail the explanation. */
    const code = s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/started at/);
  });
});
