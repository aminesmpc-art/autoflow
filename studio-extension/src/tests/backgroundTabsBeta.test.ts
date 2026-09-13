/**
 * Step 4: running with the provider tab left where the user put it.
 *
 * ── Why the focus grab existed ───────────────────────────────────────────
 *
 * It is not a bug, it is the workaround. Chrome throttles a hidden tab's
 * timers to roughly once a minute and the only thing that resets that clock
 * is the tab being VISIBLE, so the routine bought un-throttled polling by
 * taking the foreground twice a minute — for the whole length of a run,
 * away from whatever the user was actually doing.
 *
 * ── Why it can now be switched off ───────────────────────────────────────
 *
 * Because the adapters stopped depending on a fast tick. Gemini reads while
 * hidden and wakes on a MutationObserver rather than the clock; Claude
 * accepts a reply discovered after a delayed poll instead of calling it a
 * timeout; Flow confirms completion from a fresh id-matched status rather
 * than from whatever matched last.
 *
 * Those three. ChatGPT, Grok and Z.AI have had none of that work — which is
 * why this is a flag rather than a deletion. The plan says "remove routine
 * focus stealing only after adapter tests pass", and for those three they
 * have not.
 */

/// <reference types="node" />

import { readFileSync } from 'fs';
import { join } from 'path';

const read = (...p: string[]) =>
  readFileSync(join(__dirname, '..', ...p), 'utf8').replace(/\r\n/g, '\n');

/** Block comments stripped, so prose cannot satisfy an assertion. */
const codeOnly = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, '');

const WORKER = codeOnly(read('background', 'service-worker.ts'));
const RUNNER = codeOnly(read('studio', 'engine', 'WorkflowRunner.ts'));

describe('the beta is opt-in', () => {
  it('is off unless the user turned it on', () => {
    expect(WORKER).toMatch(/const BACKGROUND_TABS_KEY = 'af_background_tabs'/);
    const at = WORKER.indexOf('async function backgroundTabsOn(');
    expect(at).toBeGreaterThan(-1);
    expect(WORKER.slice(at, at + 400)).toMatch(/=== true/);
  });

  /* A beta that turns itself on when storage misbehaves is not opt-in. */
  it('stays off when the setting cannot be read', () => {
    const at = WORKER.indexOf('async function backgroundTabsOn(');
    const body = WORKER.slice(at, at + 400);
    const c = body.indexOf('catch');
    expect(c).toBeGreaterThan(-1);
    expect(body.slice(c, c + 80)).toMatch(/return false/);
  });
});

describe('with the beta on, the tab is left alone', () => {
  it('skips the routine foreground grab', () => {
    const at = WORKER.indexOf('async function tabPingRoutine(');
    expect(at).toBeGreaterThan(-1);
    const body = WORKER.slice(at, at + 1400);
    expect(body).toMatch(/if \(!tab\.active && !\(await backgroundTabsOn\(\)\)\)/);
  });

  /* The health check is a different question from visibility, and dropping
     it would lose the only signal that an orphaned content script exists. */
  it('still checks that something is listening', () => {
    const at = WORKER.indexOf('async function tabPingRoutine(');
    expect(WORKER.slice(at, at + 1400)).toMatch(/type: 'PING'/);
  });

  it('keeps stealing focus when the beta is off', () => {
    const at = WORKER.indexOf('async function tabPingRoutine(');
    expect(WORKER.slice(at, at + 1400)).toMatch(/chrome\.tabs\.update\(keptTabId, \{ active: true \}\)/);
  });
});

describe('the requirements that were already met', () => {
  it('creates provider tabs inactive', () => {
    expect(WORKER).toMatch(/chrome\.tabs\.create\(\{ url, active: false \}\)/);
  });

  /* autoDiscardable is set false for the run; leaving it that way would
     change how Chrome treats the user's tab long after the run ended. */
  it('restores the temporary tab setting when the run ends', () => {
    const at = WORKER.indexOf('async function stopKeepalive(');
    expect(at).toBeGreaterThan(-1);
    expect(WORKER.slice(at, at + 500)).toMatch(/autoDiscardable: true/);
  });

  /* "Serialize work per provider composer" — the runner awaits each step in
     a plain loop, so no two nodes can be typing into one composer at once.
     Asserted because introducing parallelism would silently break it. */
  it('runs one node at a time', () => {
    expect(RUNNER).toMatch(/for \(const step of steps\)/);
    expect(RUNNER).not.toMatch(/Promise\.all\(\s*steps/);
    expect(RUNNER).not.toMatch(/Promise\.allSettled\(\s*steps/);
  });
});

describe('needs attention', () => {
  it('is part of what the panel is told', () => {
    expect(WORKER).toMatch(/needsAttention: string;/);
    expect(WORKER).toMatch(/attentionTabId: number \| null;/);
  });

  it('starts empty', () => {
    const at = WORKER.indexOf('const runState: RunSnapshot = {');
    const body = WORKER.slice(at, at + 400);
    expect(body).toMatch(/needsAttention: '',/);
    expect(body).toMatch(/attentionTabId: null,/);
  });

  /**
   * Raised only where nothing automatic can help. Re-injecting a content
   * script into an unrelated page cannot fix anything, so that is the case
   * that genuinely needs a person. A banner shown for ordinary slowness
   * teaches people to ignore the one that matters.
   */
  it('is raised when the kept tab is no longer the provider', () => {
    const at = WORKER.indexOf('if (!onPlatform) {');
    expect(at).toBeGreaterThan(-1);
    const body = WORKER.slice(at, at + 500);
    expect(body).toMatch(/needsAttention:/);
    expect(body).toMatch(/attentionTabId: keptTabId/);
  });

  it('names a tab to open, so the button is not dead', () => {
    const at = WORKER.indexOf("if (msg?.type === 'PANEL_OPEN_ATTENTION_TAB')");
    expect(at).toBeGreaterThan(-1);
    const body = WORKER.slice(at, at + 600);
    expect(body).toMatch(/runState\.attentionTabId/);
    expect(body).toMatch(/chrome\.tabs\.update\(id, \{ active: true \}\)/);
    expect(body).toMatch(/chrome\.windows\.update\(/);
  });

  /* A banner that outlives its cause is worse than none — the next real one
     reads as the same stale message. */
  it('clears itself as soon as the tab answers', () => {
    const at = WORKER.indexOf('async function tabPingRoutine(');
    const body = WORKER.slice(at, at + 1600);
    const ping = body.indexOf("type: 'PING'");
    expect(body.slice(ping, ping + 400)).toMatch(/needsAttention: ''/);
  });

  it('reports whether there was anything to open', () => {
    const at = WORKER.indexOf("if (msg?.type === 'PANEL_OPEN_ATTENTION_TAB')");
    expect(WORKER.slice(at, at + 600)).toMatch(/sendResponse\(\{ opened:/);
  });
});

describe('focus changes become something the user asks for', () => {
  /**
   * The point of the beta. With it on, the only path that raises a tab is
   * the one behind the user's own click — everything else leaves the window
   * where they put it.
   */
  it('every activation is either guarded or asked for', () => {
    /* Counting them was the first version of this test and it was wrong:
       it expected two and found five. Three more places raised a tab — the
       needs-a-click handler, the conversation-resume navigation, and
       openStudio — and two of them fired mid-run, which is the exact
       interruption the beta exists to remove. So the property is asserted
       instead of the number, and it holds however many sites there are. */
    const ALLOWED = [
      'backgroundTabsOn()',             // gated on the beta
      'PANEL_OPEN_ATTENTION_TAB',       // the user's own click
      'async function openStudio(',     // the user opening Studio
    ];

    const re = /chrome\.tabs\.update\([^)]*active: true[^)]*\)/g;
    const offenders: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(WORKER)) !== null) {
      const before = WORKER.slice(Math.max(0, m.index - 700), m.index);
      if (!ALLOWED.some((a) => before.includes(a))) {
        offenders.push(WORKER.slice(Math.max(0, m.index - 90), m.index + 60));
      }
    }
    expect(offenders).toEqual([]);
  });

  it('a provider that needs a human is stated, not grabbed', () => {
    const at = WORKER.indexOf("'PANEL_NEEDS_CLICK'");
    expect(at).toBeGreaterThan(-1);
    const body = WORKER.slice(at, at + 900);
    expect(body).toMatch(/backgroundTabsOn\(\)/);
    expect(body).toMatch(/needsAttention:/);
  });
});
