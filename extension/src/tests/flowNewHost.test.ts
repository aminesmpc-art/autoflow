/**
 * AutoFlow against the Flow that exists now.
 *
 * Everything asserted here was measured first, in a real signed-in Chrome on
 * flow.google.com — not inferred from the other tree:
 *
 *   settingsTrigger   1      the chip exists
 *   chipHaspopup      false  the old candidate filter's only requirement
 *   chipExpanded      null   so "is the panel open" was unanswerable
 *   roleTabs          0      every original tier dead
 *   icons             crop_9_16
 *
 * Running the old candidate set on that page found 11 buttons and NOT the
 * chip. The new set finds 60 and does.
 *
 * Four separate failures, each with the same symptom — "Could not switch Flow
 * to Image mode" — and each on its own enough to stop a run:
 *
 *   the host      flow.google.com was in no manifest and no tab query
 *   the trigger   found only by aria-haspopup, which the chip lacks
 *   the panel     "open" read from aria-expanded, which the chip lacks
 *   the toggle    "selected" read from data-state/aria-selected, both null
 *
 * ── Why these are source assertions ───────────────────────────────────────
 *
 * This package runs jest under `testEnvironment: 'node'` and has no DOM tests
 * at all. Installing jsdom into a shipped extension to add some is a bigger
 * change than the fix. The behaviour of the identical logic is covered against
 * a real DOM in studio-extension's flowMediaTab tests; what matters here is
 * that this tree carries the same logic rather than the code that was broken.
 */

/// <reference types="node" />

import * as fs from 'fs';
import * as path from 'path';

const read = (rel: string) =>
  fs.readFileSync(path.resolve(__dirname, rel), 'utf8').replace(/\r\n/g, '\n');

const MANIFEST = JSON.parse(read('../../manifest.json'));
const WORKER = read('../background/service-worker.ts');
const SELECTORS = read('../content/selectors.ts');

/** One function's body, so an assertion cannot be satisfied from elsewhere. */
const fn = (name: string): string => {
  const m = new RegExp(`export function ${name}\\([\\s\\S]*?\\n\\}`).exec(SELECTORS);
  if (!m) throw new Error(`${name} not found in selectors.ts`);
  return m[0];
};

describe('the new host', () => {
  it('is requested in the manifest', () => {
    expect(MANIFEST.host_permissions).toContain('https://flow.google.com/*');
  });

  it('gets the Flow content scripts injected there', () => {
    /* Without this no content script runs on the page at all, and the bridge
       reports that nothing was listening. */
    const flowScripts = MANIFEST.content_scripts.filter(
      (c: any) => (c.matches || []).some((m: string) => m.includes('labs.google')),
    );
    expect(flowScripts.length).toBeGreaterThan(0);
    for (const cs of flowScripts) {
      expect(cs.matches).toContain('https://flow.google.com/*');
    }
  });

  it('is in EVERY tab query, not just some', () => {
    /* One missed query is one code path reporting no Flow tab while Flow is
       open — chrome.tabs.query returns nothing for a host it does not know,
       which is indistinguishable from the tab not existing. */
    const queries = WORKER.match(/url: \['https:\/\/labs\.google\/flow\*'[^\]]*\]/g) || [];
    expect(queries.length).toBeGreaterThanOrEqual(8);
    for (const q of queries) expect(q).toContain('https://flow.google.com/*');
  });

  it('opens the host Flow actually lives on', () => {
    expect(WORKER).not.toMatch(/tabs\.create\(\{ url: 'https:\/\/labs\.google/);
    expect(WORKER).not.toMatch(/tabs\.update\([^)]*url: 'https:\/\/labs\.google/);
    expect(WORKER).not.toMatch(/let url = 'https:\/\/labs\.google/);
  });

  it('still recognises a tab on the old host, which still resolves', () => {
    expect(WORKER).toMatch(/startsWith\('https:\/\/labs\.google\/flow'\)/);
    expect(WORKER).toMatch(/startsWith\('https:\/\/flow\.google\.com\/'\)/);
  });

  it('names the right host when it cannot open one', () => {
    expect(WORKER).toMatch(/Check that flow\.google\.com is reachable/);
  });
});

describe('finding the settings chip', () => {
  it('no longer requires aria-haspopup, which the chip does not have', () => {
    const body = fn('findSettingsPanelTrigger');
    expect(body).toMatch(/button\[cdkoverlayorigin\]/);
    expect(body).toMatch(/button\.settings-trigger-button/);
  });

  it('still recognises it by the ratio ligature', () => {
    /* crop_9_16 was always the structural test; it simply could not be reached
       behind the aria-haspopup filter. */
    expect(fn('findSettingsPanelTrigger')).toMatch(/\^crop\[_-\]/);
  });
});

describe('knowing whether the panel is open', () => {
  const body = () => fn('isSettingsPanelOpen');

  it('no longer depends on aria-expanded alone', () => {
    /* Reading only that answered "closed" while the popover was open, so the
       caller pressed the chip again and CLOSED it — three times, then failed. */
    expect(body()).toMatch(/cdk-overlay-pane/);
  });

  it('requires the pane to look like this popover', () => {
    /* A toast is a cdk-overlay-pane too. Counting one would have the engine
       believe a panel it never opened was already open. */
    expect(body()).toMatch(/RATIO\.test\(text\)/);
    expect(body()).toMatch(/matchesFlowText\(text, 'image'\)/);
  });

  it('still trusts the trigger when a Flow provides the attribute', () => {
    expect(body()).toMatch(/aria-expanded'\) === 'true'/);
  });
});

describe('reading which toggle is selected', () => {
  const body = () => fn('isTabActive');

  it('reads the ways Angular Material says it', () => {
    /* Measured: data-state and aria-selected are both null on every toggle in
       that panel, and those were the only two being read. */
    expect(body()).toMatch(/aria-checked'\) === 'true'/);
    expect(body()).toMatch(/button-toggle-checked/);
  });

  it('looks at the wrapper from the PARENT up, never at itself', () => {
    /* closest() starts where it is called, and the button's own class is
       mat-button-toggle-button — which contains "button-toggle", so it matched
       itself and the wrapper was never examined. */
    expect(body()).toMatch(/el\.parentElement\?\.closest\(/);
    expect(body()).not.toMatch(/\bel\.closest\(/);
  });

  it('still reads the Radix attributes it always did', () => {
    expect(body()).toMatch(/data-state'\) === 'active'/);
    expect(body()).toMatch(/aria-selected'\) === 'true'/);
  });
});

describe('finding the Image and Video toggles', () => {
  const body = () => fn('findMediaTypeTab');

  it('has a tier that needs no role, since the page has none', () => {
    expect(body()).toMatch(/cdk-overlay-container/);
  });

  it('scopes to the overlay before falling back to the document', () => {
    /* The sidebar's Images and Vidéos filters are siblings of each other just
       like the real tabs and come earlier in the document. The CDK container
       settles it outright: the sidebar is never inside one. */
    /* The document is the LAST entry in the scope list — matched as its own
       line, since `document.querySelector` appears in the earlier tiers and a
       loose probe finds that instead. */
    const i = body().indexOf('cdk-overlay-container');
    const j = body().search(/\n\s*document,\n\s*\];/);
    expect(i).toBeGreaterThan(-1);
    expect(j).toBeGreaterThan(i);
  });

  it('accepts a ratio written as a ligature as well as with a colon', () => {
    /* The chip writes it crop_16_9 — underscores, no colon. An anchor matching
       only "16:9" matched nothing on the real page. */
    expect(body()).toMatch(/16\\s\*\[:_\]\\s\*9/);
  });

  it('takes the most specific match, not the wrapper', () => {
    expect(body()).toMatch(/labelText\(a\)\.trim\(\)\.length - labelText\(b\)\.trim\(\)\.length/);
  });

  it('keeps the role-based tiers first, so an older Flow is unaffected', () => {
    const b = body();
    expect(b.indexOf('-trigger-${suffix}')).toBeLessThan(b.indexOf('cdk-overlay-container'));
  });

  it('carries no control character in its anchor', () => {
    /* Written twice with a literal backspace where \b was meant — a regex that
       compiles, runs, and matches nothing. */
    // eslint-disable-next-line no-control-regex
    expect(SELECTORS).not.toMatch(/[\x00-\x08\x0b\x0c\x0e-\x1f]/);
  });
});
