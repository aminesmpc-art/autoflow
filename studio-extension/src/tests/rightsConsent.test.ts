/**
 * @jest-environment jsdom
 */

/**
 * Flow's "Rights to use this video", and why it had to be pressed.
 *
 * It stands in front of the FIRST upload of a session:
 *
 *   Rights to use this video
 *   Make sure you have the necessary rights to any content or files that you
 *   upload … you must comply with Google's Prohibited Use Policy.
 *
 *   [Cancel]            [I agree, do not show again]        [I agree]
 *
 * Nothing reported it, and nothing could: CDP satisfies the file chooser, so
 * the upload returns ok, and then the bytes never arrive. The attach that
 * follows says "No assets found" — true, and useless as a diagnosis.
 *
 * The middle button is the one worth pressing. "I agree" answers this upload
 * and comes back on the next one.
 */

/// <reference types="node" />

import { readFileSync } from 'fs';
import { join } from 'path';

import { rightsConsentButton, dismissRightsConsent } from '../content/flow/libraryPicker';
import { FLOW_STRINGS } from '../content/flow/flowStrings';

/** The dialog as the live page shows it: three buttons, in this order. */
function showDialog(buttons: string[] = ['Cancel', 'I agree, do not show again', 'I agree']): void {
  document.body.innerHTML = `
    <div role="dialog">
      <h2>Rights to use this video</h2>
      <p>Make sure you have the necessary rights to any content or files that you
         upload, including content of minors. When using Flow, you must comply with
         <a href="https://policies.google.com/terms/generative-ai/use-policy">Google's Prohibited Use Policy</a>.</p>
      ${buttons.map((b) => `<button>${b}</button>`).join('')}
    </div>`;
  /* jsdom gives every element a zero box, and the finder refuses anything with
     no size so a shut overlay is not pressed. Give them one. */
  for (const el of Array.from(document.querySelectorAll('*'))) {
    (el as any).getBoundingClientRect = () => ({ width: 320, height: 40, left: 0, top: 0 });
  }
}

afterEach(() => { document.body.innerHTML = ''; });

describe('the rights consent', () => {
  it('presses the one that does not come back', () => {
    /* "I agree" alone answers this upload and reappears on the next, which
       would stop the second part of a two-part motion job. */
    showDialog();
    expect(rightsConsentButton(document)?.textContent).toBe('I agree, do not show again');
  });

  it('falls back to the plain agreement when that is all there is', () => {
    showDialog(['Cancel', 'I agree']);
    expect(rightsConsentButton(document)?.textContent).toBe('I agree');
  });

  it('never presses Cancel', () => {
    /* The one wrong press that throws the upload away — the cut, the director
       conversation and the files already written to disk. */
    showDialog(['Cancel']);
    expect(rightsConsentButton(document)).toBeNull();
  });

  it('ignores an overlay that is not on screen', () => {
    /* Flow keeps its overlays in the DOM when they are shut. Pressing a hidden
       agreement would consent to nothing and report that it had. */
    showDialog();
    document.querySelector('[role="dialog"]')!.setAttribute('aria-hidden', 'true');
    expect(rightsConsentButton(document)).toBeNull();
  });

  it('does not go hunting outside a dialog', () => {
    /* An unscoped sweep for "I agree" is free to find a footer link on the
       project page sitting behind the overlay. */
    document.body.innerHTML = '<div><button>I agree</button></div>';
    for (const el of Array.from(document.querySelectorAll('*'))) {
      (el as any).getBoundingClientRect = () => ({ width: 90, height: 30, left: 0, top: 0 });
    }
    expect(rightsConsentButton(document)).toBeNull();
  });

  it('presses it and says so, and says nothing when it is not there', () => {
    const said: string[] = [];
    showDialog();
    const clicked: string[] = [];
    for (const b of Array.from(document.querySelectorAll('button'))) {
      b.addEventListener('click', () => clicked.push(b.textContent || ''));
    }
    expect(dismissRightsConsent({ log: (l) => said.push(l) })).toBe(true);
    expect(clicked).toEqual(['I agree, do not show again']);
    expect(said.join(' ')).toMatch(/rights notice/);

    document.body.innerHTML = '';
    expect(dismissRightsConsent({ log: (l) => said.push(l) })).toBe(false);
  });

  it('orders the two agreements so the shorter one cannot swallow the longer', () => {
    /* matchesFlowText uses `includes`, so "i agree" matches "i agree, do not
       show again" as well. Tested at the source, because the day someone
       reorders the passes the fallback silently becomes the default. */
    expect(FLOW_STRINGS.rightsAgree.some((t) => 'i agree, do not show again'.includes(t))).toBe(true);
  });
});

describe('the watcher is armed, not polled for afterwards', () => {
  const worker = readFileSync(join(__dirname, '../background/debugUpload.ts'), 'utf8');

  it('starts watching before the file chooser, not after it', () => {
    /* Whether Flow raises the dialog on the Upload press or once the bytes are
       handed over is not established. Armed first, it does not matter. */
    const armed = worker.indexOf("type: 'WATCH_RIGHTS_DIALOG'");
    const chooser = worker.indexOf('await uploadViaFileChooser(tabId, paths)');
    expect(armed).toBeGreaterThan(-1);
    expect(chooser).toBeGreaterThan(armed);
  });

  it('cannot fail the upload it is protecting', () => {
    /* Not awaited, and its rejection is swallowed. An upload that would have
       worked without this must still work when the message cannot land. */
    const call = worker.slice(worker.indexOf("type: 'WATCH_RIGHTS_DIALOG'"));
    expect(call.slice(0, 260)).toMatch(/\.catch\(/);
    expect(worker).not.toMatch(/await chrome\.tabs\.sendMessage\(tabId, \{ type: 'WATCH_RIGHTS_DIALOG'/);
  });

  it('is answered by the Flow adapter', () => {
    const flow = readFileSync(join(__dirname, '../content/flow/index.ts'), 'utf8');
    expect(flow).toMatch(/case 'WATCH_RIGHTS_DIALOG'/);
    expect(flow).toMatch(/watchForRightsConsent/);
  });
});
