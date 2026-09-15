/**
 * Getting a run started on the Flow that exists now.
 *
 * A queue of four failed in 24 seconds, every prompt marked
 * "Could not switch Flow to Video mode", with nothing generated.
 *
 * ── What it was not ───────────────────────────────────────────────────────
 *
 * Not the switch. Measured on the live composer with its panel open:
 *
 *   findMediaTypeTab('video')   FOUND
 *   isTabActive(it)             true   (aria-checked="true")
 *   button[role="tab"]          0      every role-based tier dead, as expected
 *
 * Not a stray overlay either, which was the first theory and a wrong one. The
 * tile-grid settings panel was open in both screenshots of the failing run,
 * and an Angular overlay does lay a backdrop over the page — but opening that
 * panel and then clicking the composer's settings chip was tried live, and
 * the composer settings opened anyway. The backdrop does not block it.
 *
 * ── What it most likely was ───────────────────────────────────────────────
 *
 * A race. The run log reads "Opening a new Flow project…" and the failure in
 * the same minute, and ensurePageReady returns as soon as findPromptInput()
 * succeeds. On a freshly created project the editor is live before the
 * composer's settings chip is, so the media-type switch ran against a
 * half-built composer: three attempts inside a second, no toggle found, whole
 * queue failed. So the wait below is for the chip itself.
 *
 * This has NOT been reproduced — a fresh project would have to be created at
 * exactly the wrong moment. It is hardening against the mechanism the
 * timestamps point at, not a confirmed fix, and it is worth saying so.
 *
 * ── The overlay dismissal, which is kept anyway ───────────────────────────
 *
 * Cheap, and it protects against a real class of blockage even if not this
 * one. Escape dispatched on document.body, then a wait. Measured, in order:
 *
 *   Escape on document            still open
 *   synthetic click on backdrop   still open
 *   full pointer chain on it      still open
 *   Escape on document.body       CLOSED   (after ~400ms)
 *
 * The wait is half the answer. Angular re-renders on its next tick, so a
 * check made straight after dispatch reports failure on a dismissal that
 * worked — which is how this first looked unfixable.
 */

/// <reference types="node" />

import * as fs from 'fs';
import * as path from 'path';

const AUTOMATION = fs
  .readFileSync(path.resolve(__dirname, '../content/automation.ts'), 'utf8')
  .replace(/\r\n/g, '\n');

/** One method's body, so an assertion cannot be satisfied from elsewhere. */
const method = (name: string): string => {
  const m = new RegExp(`private async ${name}\\([\\s\\S]*?\\n  \\}`).exec(AUTOMATION);
  if (!m) throw new Error(`${name} not found in automation.ts`);
  return m[0];
};

describe('clearing the page before applying settings', () => {
  it('dismisses stray overlays first', () => {
    const apply = method('applyAllSettings');
    expect(apply).toMatch(/dismissStrayOverlays\(\)/);
  });

  it('does it before touching the media type', () => {
    /* After the first attempt is too late: the failure it prevents happens on
       that attempt. */
    const apply = method('applyAllSettings');
    expect(apply.indexOf('dismissStrayOverlays'))
      .toBeLessThan(apply.indexOf('findMediaTypeTab'));
  });

  it('sends Escape to document.body, which is what works', () => {
    const dismiss = method('dismissStrayOverlays');
    expect(dismiss).toMatch(/document\.body\.dispatchEvent/);
    expect(dismiss).toMatch(/'Escape'/);
  });

  it('waits before believing it failed', () => {
    /* Angular re-renders on its next tick. Checking immediately reports a
       working dismissal as a failed one. */
    expect(method('dismissStrayOverlays')).toMatch(/await sleep\(\d{3,}\)/);
  });

  it('gives up after a few tries instead of looping', () => {
    const dismiss = method('dismissStrayOverlays');
    expect(dismiss).toMatch(/i < 3/);
    expect(dismiss).toMatch(/still open/);
  });

  it('recognises an overlay by its backdrop, not by one panel', () => {
    /* Any overlay blocks, not only the settings one: a tile's More options
       menu and the asset picker do the same. */
    expect(method('dismissStrayOverlays')).toMatch(/cdk-overlay-backdrop/);
  });
});

describe('not doing work that is already done', () => {
  it('only rebuilds the menu when the mode actually changed', () => {
    /* The composer remembers the mode between sessions, so most runs start in
       the one they want. Closing and reopening the panel to rebuild it
       identically cost a close, a reopen and up to 1.4s of settling on every
       run. */
    const apply = method('applyAllSettings');
    expect(apply).toMatch(/mediaTypeSwitched = true/);
    expect(apply).toMatch(/if \(mediaTypeSwitched\) \{/);
  });

  it('still tears the menu down when it did change', () => {
    /* Image and Video render different controls; a later lookup must not see
       the pre-switch nodes. */
    const apply = method('applyAllSettings');
    const guard = apply.indexOf('if (mediaTypeSwitched) {');
    expect(apply.slice(guard, guard + 200)).toMatch(/closeSettingsPanel/);
  });

  it('does not mark the mode applied just because it clicked', () => {
    /* The click is confirmed by re-reading the toggle. Trusting the click is
       how a silent miss became video prompts rendered as images. */
    const apply = method('applyAllSettings');
    expect(apply).toMatch(/const after = findMediaTypeTab\(wantMedia\)/);
    expect(apply).toMatch(/if \(after && isTabActive\(after\)\)/);
  });
});

describe('waiting for the composer to be ready', () => {
  it('waits for the settings chip, not just the prompt box', () => {
    /* ensurePageReady returns as soon as findPromptInput() succeeds. On a
       freshly created project the editor is live before the settings chip is,
       so a queue starting right after "Opening a new Flow project" ran the
       media switch against a composer that was not finished — three attempts
       inside a second, and every prompt failed. */
    const apply = method('applyAllSettings');
    expect(apply).toMatch(/findSettingsPanelTrigger\(\)/);
  });

  it('waits before the first switch attempt, not after', () => {
    const apply = method('applyAllSettings');
    expect(apply.indexOf('findSettingsPanelTrigger'))
      .toBeLessThan(apply.indexOf('findMediaTypeTab'));
  });

  it('gives up rather than waiting forever', () => {
    const apply = method('applyAllSettings');
    expect(apply).toMatch(/waited < 12000/);
  });

  it('says so when the chip never arrives', () => {
    /* Otherwise the switch failure that follows reads as its own mystery. */
    const apply = method('applyAllSettings');
    expect(apply).toMatch(/Settings chip never appeared/);
  });
});

describe('not re-opening the settings panel on every prompt', () => {
  /* The tile-grid settings panel kept appearing over the page mid-run.
     verifyOrReapplySettings runs before EVERY prompt and calls
     applyAllSettings when the chip looks wrong; applyAllSettings ends in
     ensureToggles, which opens that panel. Those toggles are page-level and
     do not change between prompts, so once per run is enough. */

  it('checks the toggles once per run', () => {
    expect(method('ensureToggles')).toMatch(/if \(this\.togglesEnsured\) return;/);
  });

  it('records that it has done so', () => {
    expect(method('ensureToggles')).toMatch(/this\.togglesEnsured = true;/);
  });

  it('re-checks after a new project, which resets the toggles', () => {
    /* Flow resets them on project creation, so the flag has to reset with
       them or the run would trust a check made on a different project. */
    expect(AUTOMATION).toMatch(/New projects reset toggles[\s\S]{0,120}togglesEnsured = false/);
  });

  it('re-checks on a new run, since the engine outlives a queue', () => {
    expect(AUTOMATION).toMatch(/togglesEnsured = false;[\s\S]{0,40}ensurePageReady\(\)/);
  });
});

describe('handing the page back uncovered', () => {
  /* The tile-grid settings panel — View mode, Grid size, Sound on hover,
     Show tile details, Clear prompt on submit — sat open over the grid for a
     whole run. ensureToggles opens it to set two toggles and is supposed to
     close it again. */

  it('closes the panel however the setup ended', () => {
    /* Every early return in the middle used to skip the close: the panel
       failing to open, the toggles failing, the run being stopped. */
    const ensure = method('ensureToggles');
    expect(ensure).toMatch(/\} finally \{[\s\S]{0,240}closeViewSettingsPanel\(\)/);
  });

  it('marks the attempt before making it, not after', () => {
    /* togglesEnsured was set on the last line, so any early return left it
       false and the next prompt opened the panel again — the "it keeps
       opening" this was supposed to have fixed. */
    const ensure = method('ensureToggles');
    expect(ensure.indexOf('this.togglesEnsured = true;'))
      .toBeLessThan(ensure.indexOf('openViewSettingsPanel()'));
  });

  it('waits long enough for Angular to remove the panel', () => {
    /* Measured on the live page: one Escape lands in about 400-500ms, and it
       regularly takes two. The old code waited 200-400ms once. */
    const close = method('closeViewSettingsPanel');
    expect(close).toMatch(/i < 3/);
    expect(close).toMatch(/await sleep\(4\d\d\)/);
  });

  it('clicks the backdrop, not the body', () => {
    /* document.body.click() cannot reach the body — the overlay's backdrop
       is over it, and is the thing that dismisses. */
    const close = method('closeViewSettingsPanel');
    expect(close).toMatch(/cdk-overlay-backdrop/);
    expect(close).not.toMatch(/document\.body\.click\(\)/);
  });

  it('closes it even when the run was stopped', () => {
    /* Stopping is no reason to leave a panel covering the grid. */
    const close = method('closeViewSettingsPanel');
    expect(close).not.toMatch(/this\.stopped/);
  });

  it('says so when it cannot be closed', () => {
    expect(method('closeViewSettingsPanel')).toMatch(/would not close/);
  });
});
