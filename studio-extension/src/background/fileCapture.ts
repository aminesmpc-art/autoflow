/**
 * The second route into Flow's uploader: catch the file input, skip the chooser.
 *
 * ── Why the first route fails on some profiles ────────────────────────────
 *
 * Flow keeps no <input type="file"> on the page. "Upload media" CREATES one
 * and calls .click() on it, and Chrome opens the native chooser only if that
 * call happens inside a user activation. The debugger's click supplies one —
 * which is why the chooser route works on a profile that has uploaded before.
 *
 * A fresh profile is different. Its first upload gets Flow's "Rights to use
 * this video" consent first, and the consent is answered from the content
 * script — a synthetic click, which carries no activation. Flow then calls
 * .click() on its input with nothing to show for it, Chrome quietly declines
 * to open a dialog, and there is nothing for Page.fileChooserOpened to
 * report. Measured as:
 *
 *   file chooser did not open within 15s. Clicked "uploadUpload media" at
 *   419,965 (120x34). Direct route was skipped: no file input on the page yet
 *
 * ── What this does instead ────────────────────────────────────────────────
 *
 * Before the click, a hook goes into Flow's own page (the main world, where
 * Flow's code runs) and records any file input that .click() or .showPicker()
 * is called on — then lets the call through, so the chooser route is
 * untouched wherever it works. When no chooser follows, the recorded input is
 * handed the files with DOM.setFileInputFiles, by object id. That is the same
 * command the chooser route ends with, and it fires the same trusted change
 * event a real pick does — on the very input Flow is listening to, whether or
 * not it was ever attached to the document.
 *
 * The hook is removed again before the debugger detaches.
 */

/** A CDP command, already bound to the tab. */
export type Send = (method: string, params?: object) => Promise<any>;

/** How long a caught input waits for a chooser that may still be coming.
    With an activation, Chrome opens it within the same task as the click. */
export const CAPTURE_GRACE_MS = 1500;

/* Page-side scripts. Plain ES5-ish strings: they run in Flow's page through
   Runtime.evaluate, not in this bundle. */

export const CAPTURE_INSTALL = `(function () {
  var prior = window.__afFileCapture;
  if (prior) { prior.input = null; return 'ready'; }
  var P = HTMLInputElement.prototype;
  var cap = { input: null, click: P.click, showPicker: P.showPicker };
  function take(el) { if (el && el.type === 'file') cap.input = el; }
  P.click = function () { take(this); return cap.click.apply(this, arguments); };
  if (typeof cap.showPicker === 'function') {
    P.showPicker = function () { take(this); return cap.showPicker.apply(this, arguments); };
  }
  Object.defineProperty(window, '__afFileCapture', { value: cap, configurable: true, writable: true, enumerable: false });
  return 'installed';
})()`;

export const CAPTURE_PROBE = `!!(window.__afFileCapture && window.__afFileCapture.input)`;

export const CAPTURE_HANDLE = `(window.__afFileCapture && window.__afFileCapture.input) || null`;

export const CAPTURE_RESTORE = `(function () {
  var cap = window.__afFileCapture;
  if (!cap) return 'none';
  var P = HTMLInputElement.prototype;
  P.click = cap.click;
  if (cap.showPicker) P.showPicker = cap.showPicker;
  delete window.__afFileCapture;
  return 'restored';
})()`;

export async function installFileCapture(send: Send): Promise<boolean> {
  const got = await send('Runtime.evaluate', { expression: CAPTURE_INSTALL, returnByValue: true });
  return got?.result?.value === 'installed' || got?.result?.value === 'ready';
}

/** Whether Flow has created and clicked a file input since the hook went in. */
export async function captureReady(send: Send): Promise<boolean> {
  try {
    const got = await send('Runtime.evaluate', { expression: CAPTURE_PROBE, returnByValue: true });
    return got?.result?.value === true;
  } catch {
    return false;
  }
}

/**
 * Hand the files to the input Flow created. Never throws: a route that cannot
 * be taken is a reason for the failure message, not a second failure.
 */
export async function deliverToCapturedInput(send: Send, files: string[]): Promise<{ ok: boolean; why?: string }> {
  try {
    const handle = await send('Runtime.evaluate', { expression: CAPTURE_HANDLE, returnByValue: false });
    const objectId = handle?.result?.objectId;
    if (!objectId) return { ok: false, why: 'Flow created no file input after the click either' };
    await send('DOM.setFileInputFiles', { objectId, files });
    return { ok: true };
  } catch (e: any) {
    return { ok: false, why: `the file input Flow created would not take the files (${e?.message || e})` };
  }
}

/** Put Flow's own methods back. Best effort: the page may already be gone. */
export async function removeFileCapture(send: Send): Promise<void> {
  try {
    await send('Runtime.evaluate', { expression: CAPTURE_RESTORE, returnByValue: true });
  } catch { /* nothing to restore into */ }
}
