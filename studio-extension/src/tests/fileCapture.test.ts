/**
 * @jest-environment jsdom
 */

/**
 * The second route into Flow's uploader.
 *
 *   file chooser did not open within 15s. Clicked "uploadUpload media" at
 *   419,965 (120x34). Direct route was skipped: no file input on the page yet
 *
 * Flow keeps no file input on the page; "Upload media" creates one and calls
 * .click() on it. Chrome opens a chooser for that only inside a user
 * activation — and on a fresh profile the first upload goes through Flow's
 * consent dialog, answered by a synthetic click with no activation behind it.
 * No chooser, so nothing for the debugger to intercept.
 *
 * The hook catches the input itself, and the files go to it directly. The
 * page-side scripts run here in a real DOM, exactly as Runtime.evaluate runs
 * them in Flow's page.
 */

/// <reference types="node" />

import { readFileSync } from 'fs';
import { join } from 'path';

import {
  CAPTURE_INSTALL, CAPTURE_PROBE, CAPTURE_HANDLE, CAPTURE_RESTORE,
  captureReady, deliverToCapturedInput, removeFileCapture,
} from '../background/fileCapture';

/* Runtime.evaluate runs in the page's global scope — an indirect eval is the
   same thing here. */
const page = (script: string) => (0, eval)(script);
const original = HTMLInputElement.prototype.click;

afterEach(() => {
  page(CAPTURE_RESTORE);
  HTMLInputElement.prototype.click = original;
  delete (HTMLInputElement.prototype as any).showPicker;
});

describe('catching the input Flow creates', () => {
  it('records a file input when Flow clicks it — even one never put on the page', () => {
    expect(page(CAPTURE_INSTALL)).toBe('installed');
    const input = document.createElement('input');
    input.type = 'file';                       // created, never appended
    input.click();
    expect(page(CAPTURE_PROBE)).toBe(true);
    expect(page(CAPTURE_HANDLE)).toBe(input);
  });

  it('ignores every input that is not a file input', () => {
    page(CAPTURE_INSTALL);
    const text = document.createElement('input');
    text.type = 'text';
    text.click();
    expect(page(CAPTURE_PROBE)).toBe(false);
  });

  it('lets the click through, so the chooser route still works wherever it does', () => {
    const calls: string[] = [];
    HTMLInputElement.prototype.click = function (this: HTMLInputElement) { calls.push(this.type); };
    page(CAPTURE_INSTALL);
    const input = document.createElement('input');
    input.type = 'file';
    input.click();
    expect(calls).toEqual(['file']);
  });

  it('catches showPicker too, the other way to open a chooser', () => {
    const shown: HTMLInputElement[] = [];
    (HTMLInputElement.prototype as any).showPicker = function (this: HTMLInputElement) { shown.push(this); };
    page(CAPTURE_INSTALL);
    const input = document.createElement('input');
    input.type = 'file';
    (input as any).showPicker();
    expect(page(CAPTURE_HANDLE)).toBe(input);
    expect(shown).toEqual([input]);
  });

  it('starts clean for the next upload without stacking a second hook', () => {
    page(CAPTURE_INSTALL);
    const first = document.createElement('input');
    first.type = 'file';
    first.click();
    expect(page(CAPTURE_INSTALL)).toBe('ready');
    expect(page(CAPTURE_PROBE)).toBe(false);
  });

  it('puts Flow\'s own methods back, and leaves nothing behind', () => {
    page(CAPTURE_INSTALL);
    expect(HTMLInputElement.prototype.click).not.toBe(original);
    expect(page(CAPTURE_RESTORE)).toBe('restored');
    expect(HTMLInputElement.prototype.click).toBe(original);
    expect((window as any).__afFileCapture).toBeUndefined();
  });
});

describe('handing the files over', () => {
  /** A debugger that answers the way Chrome's does. */
  const fakeDebugger = (objectId: string | null, failSet = false) => {
    const sent: Array<[string, any]> = [];
    const send = async (method: string, params?: any) => {
      sent.push([method, params]);
      if (method === 'Runtime.evaluate' && params?.expression === CAPTURE_HANDLE) {
        return { result: objectId ? { type: 'object', objectId } : { type: 'object', subtype: 'null', value: null } };
      }
      if (method === 'DOM.setFileInputFiles' && failSet) throw new Error('Not allowed');
      return {};
    };
    return { send, sent };
  };

  it('sets the files on the caught input, by object id', async () => {
    const d = fakeDebugger('input-7');
    expect(await deliverToCapturedInput(d.send, ['C:/tmp/p1.mp4'])).toEqual({ ok: true });
    expect(d.sent).toContainEqual(['DOM.setFileInputFiles', { objectId: 'input-7', files: ['C:/tmp/p1.mp4'] }]);
  });

  it('says so when Flow created no input at all', async () => {
    const out = await deliverToCapturedInput(fakeDebugger(null).send, ['C:/tmp/p1.mp4']);
    expect(out.ok).toBe(false);
    expect(out.why).toMatch(/no file input/);
  });

  it('says so when the input refused the files, rather than throwing', async () => {
    const out = await deliverToCapturedInput(fakeDebugger('input-7', true).send, ['C:/tmp/p1.mp4']);
    expect(out.ok).toBe(false);
    expect(out.why).toMatch(/would not take the files \(Not allowed\)/);
  });

  it('reads "not caught" from a page it cannot reach', async () => {
    expect(await captureReady(async () => { throw new Error('detached'); })).toBe(false);
    await expect(removeFileCapture(async () => { throw new Error('detached'); })).resolves.toBeUndefined();
  });
});

describe('the upload uses it', () => {
  const SRC = readFileSync(join(__dirname, '..', 'background', 'debugUpload.ts'), 'utf8');
  const fn = SRC.slice(SRC.indexOf('export async function uploadViaFileChooser'));

  it('puts the hook in before the click', () => {
    const hook = fn.indexOf('captureInstalled = await installFileCapture(send)');
    const press = fn.indexOf("type: 'mousePressed'");
    expect(hook).toBeGreaterThan(-1);
    expect(press).toBeGreaterThan(hook);
  });

  it('stops waiting for a chooser once Flow\'s input is caught and none came', () => {
    expect(fn).toMatch(/Date\.now\(\) - caughtAt < CAPTURE_GRACE_MS/);
    expect(fn).toMatch(/\{ captured: true \}/);
  });

  it('lets only one route deliver the files', () => {
    /* The chooser, the caught input and the timeout each check and set the
       same flag — two deliveries would put the files in Flow twice. */
    expect((fn.match(/if \(settled\) return;/g) || []).length).toBeGreaterThanOrEqual(2);
    expect(fn).toMatch(/if \(settled \|\| !ready\) return;/);
  });

  it('tries the caught input before giving up, and names the route that worked', () => {
    /* The single fast look for an input on the page first, then the input
       caught off it, then — and only then — the failure. */
    const direct = fn.indexOf('const late = await trySetFilesDirectly(target, filePaths)');
    const caught = fn.indexOf('await deliverCaptured()');
    const giveUp = fn.indexOf('throw new Error(', caught);
    expect(direct).toBeGreaterThan(-1);
    expect(caught).toBeGreaterThan(direct);
    expect(giveUp).toBeGreaterThan(caught);
    expect(fn).toMatch(/deliverToCapturedInput\(send, filePaths\)/);
    expect(fn).toMatch(/route: late\.ok \? 'direct' : 'captured'/);
  });

  it('takes the hook out of Flow\'s page before the debugger lets go', () => {
    const out = fn.indexOf('if (captureInstalled) await removeFileCapture(send);');
    const detach = fn.indexOf('chrome.debugger.detach(target');
    expect(out).toBeGreaterThan(-1);
    expect(detach).toBeGreaterThan(out);
  });
});
