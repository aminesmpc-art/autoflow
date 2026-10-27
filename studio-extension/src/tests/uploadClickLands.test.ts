/**
 * @jest-environment jsdom
 */

/**
 * "file chooser did not open within 15s" — a click that never landed.
 *
 * ── What the user saw ────────────────────────────────────────────────────
 *
 * A Motion Control run on a session carrying BOTH Chrome's debugging banner
 * and Flow's "You're running low on Google Flow credits" notice:
 *
 *   13:11:47  Motion  Uploading 2 piece(s) to Flow — Chrome will show a banner.
 *   13:12:06  Motion  The upload failed: file chooser did not open within 15s.
 *                     Clicked "uploadUpload media" at 510,965 (120x34).
 *                     Direct route was skipped: no file input on the page yet
 *
 * Nineteen seconds, no chooser, nothing generated.
 *
 * ── The button was found; the click was not made ─────────────────────────
 *
 * "uploadUpload media" is the button's icon ligature and its label read back
 * together, so the selector was right. Its markup:
 *
 *   <button class="… sidebar-upload-btn …" mattooltip="Upload media">
 *     <mat-icon class="upload-icon google-symbols">upload</mat-icon>
 *     <span class="upload-text">Upload media</span>
 *     <span class="mat-mdc-button-touch-target"></span>
 *
 * It sits at the bottom of the picker's rail — the first thing to fall below
 * the fold when two banners each take a strip off the viewport. A synthetic
 * mouse event at a point outside the viewport lands on nothing, and NOTHING
 * REPORTS THAT: Input.dispatchMouseEvent succeeds for the press and for the
 * release, and the only symptom is a chooser that never opens. Fifteen
 * seconds later the run blames the chooser.
 *
 * Same shape as every other bug in this pair of files: act, then assume.
 *
 * ── The fix ──────────────────────────────────────────────────────────────
 *
 * Scroll it into view, measure it THERE, and hit-test the point before
 * spending the click. Four points rather than one, because Material covers
 * the centre of its own buttons with ripple and touch-target spans. And two
 * routes around it: wait for the file input the direct route wants instead of
 * sampling once, and look again after a click that produced no chooser — it
 * may have built the input on its way past.
 */

/// <reference types="node" />

import * as fs from 'fs';
import * as path from 'path';

const WORKER = fs
  .readFileSync(path.resolve(__dirname, '../background/debugUpload.ts'), 'utf8')
  .replace(/\r\n/g, '\n');

/* ────────────────────────────────────────────────────────────────────────
   The hit-test, run for real
   ────────────────────────────────────────────────────────────────────────

   It lives in the worker as a string, because it executes inside CDP
   Runtime.evaluate. Lifted out and run against a real DOM here: a source
   assertion would prove the words are present, not that they work. */

const EXPR = (() => {
  const from = WORKER.indexOf('(function () {\n        var b = window.__afUploadBtn;');
  const to = WORKER.indexOf('})()', from);
  if (from < 0 || to < 0) throw new Error('the settle expression is no longer in debugUpload.ts');
  /* The file escapes its backslashes for the template literal it sits in;
     undoing that is exactly what the template literal does at runtime. */
  return WORKER.slice(from, to + 4).replace(/\\\\/g, '\\');
})();

// eslint-disable-next-line no-eval
const settle = (): any => JSON.parse(eval(EXPR));

function placeButton(rect: Partial<DOMRect> = {}): HTMLElement {
  document.body.innerHTML = '<button id="up">uploadUpload media</button>';
  const b = document.getElementById('up')!;
  const r = { top: 100, left: 100, width: 120, height: 34, right: 220, bottom: 134, ...rect };
  b.getBoundingClientRect = () => r as DOMRect;
  (window as any).__afUploadBtn = b;
  return b;
}

describe('the point is checked before the click is spent', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    (window as any).__afUploadBtn = undefined;
    (window as any).innerWidth = 1400;
    (window as any).innerHeight = 900;
    /* jsdom has no layout, so it has no elementFromPoint. Every test says
       what is under the point it is about. */
    (document as any).elementFromPoint = () => null;
  });

  it('accepts a point that really is on the button', () => {
    const b = placeButton();
    (document as any).elementFromPoint = () => b;
    const out = settle();
    expect(out.error).toBeUndefined();
    expect(out.x).toBe(160);
    expect(out.y).toBe(117);
  });

  it('accepts a child of it, because Material covers its own button', () => {
    /* mat-mdc-button-touch-target and two ripple spans sit over the label, so
       elementFromPoint returns one of those and not the <button>. Demanding
       an exact match would reject every Material button on the page. */
    const b = placeButton();
    b.innerHTML = '<span class="mat-mdc-button-touch-target"></span>';
    (document as any).elementFromPoint = () => b.firstElementChild;
    expect(settle().error).toBeUndefined();
  });

  it('refuses a button below the fold instead of clicking into space', () => {
    /* 510,965 in a viewport two banners have shortened. The failure verbatim:
       every candidate point is outside, so there is nothing to click and
       fifteen seconds of waiting would only prove that slowly. */
    placeButton({ top: 950, left: 450, width: 120, height: 34, right: 570, bottom: 984 });
    const out = settle();
    expect(out.error).toMatch(/no point on it can be clicked/);
    expect(out.blockedBy).toEqual([
      'outside the viewport', 'outside the viewport',
      'outside the viewport', 'outside the viewport',
    ]);
    /* The two numbers that make it diagnosable rather than mysterious. */
    expect(out.rect).toMatch(/top 950/);
    expect(out.viewport).toBe('1400x900');
  });

  it('names what is covering it, rather than blaming the button', () => {
    placeButton();
    document.body.insertAdjacentHTML('beforeend',
      '<div id="banner" class="credits-notice">low on credits</div>');
    const banner = document.getElementById('banner')!;
    (document as any).elementFromPoint = () => banner;
    const out = settle();
    expect(out.error).toBeTruthy();
    expect(out.blockedBy[0]).toBe('div.credits-notice');
  });

  it('tries the edges when the centre is unreachable', () => {
    /* Four points, not one. A centre covered by an overlay that stops short
       of the edges is a button that is perfectly clickable. */
    const b = placeButton();
    let call = 0;
    (document as any).elementFromPoint = () => (++call >= 3 ? b : document.body);
    const out = settle();
    expect(out.error).toBeUndefined();
    expect(call).toBeGreaterThan(1);
  });

  it('says the button has gone rather than measuring a ghost', () => {
    placeButton();
    document.body.innerHTML = '';
    expect(settle().error).toMatch(/left the page/);
  });
});

describe('the routes around a click that cannot be made', () => {
  it('waits for the file input rather than sampling for it once', () => {
    /* "Direct route was skipped: no file input on the page yet" was decided by
       a single look at an Angular dialog that builds the input later. That
       route needs no coordinates at all, so it is worth waiting for. */
    expect(WORKER).toMatch(/for \(let look = 0; !direct\.ok && look < \d+/);
    expect(WORKER).toMatch(/\/no file input\/i\.test\(direct\.why \|\| ''\)/);
  });

  it('looks once more after a click that produced no chooser', () => {
    const at = WORKER.indexOf('await chooserFired;');
    expect(at).toBeGreaterThan(-1);
    const around = WORKER.slice(at, at + 900);
    expect(around).toMatch(/catch \(noChooser/);
    expect(around).toMatch(/const late = await trySetFilesDirectly\(target, filePaths\)/);
    /* And still fails when that finds nothing. A fallback must not become a
       way for a failed upload to report success — which is the bug this pair
       of files has already shipped once. */
    expect(around).toMatch(/throw new Error/);
  });

  it('moves the pointer before pressing, the way hardware does', () => {
    const move = WORKER.indexOf("type: 'mouseMoved'");
    const press = WORKER.indexOf("type: 'mousePressed'");
    expect(move).toBeGreaterThan(-1);
    expect(move).toBeLessThan(press);
  });

  it('scrolls the button into view before it measures it', () => {
    const scroll = WORKER.indexOf('scrollIntoView');
    expect(scroll).toBeGreaterThan(-1);
    expect(WORKER.indexOf('var r = b.getBoundingClientRect();', scroll)).toBeGreaterThan(scroll);
  });

  it('spends the settled point, not the one measured before the scroll', () => {
    expect(WORKER).toMatch(/btnCoords = \{ \.\.\.btnCoords, x: settled\.x, y: settled\.y/);
  });

  it('gives up before enabling interception, not after a 15s wait', () => {
    /* Order is the saving. A settle failure that fell through to the chooser
       path would cost the same fifteen seconds it exists to avoid. */
    const settleAt = WORKER.indexOf('if (settled.error) {');
    const interceptAt = WORKER.indexOf("'Page.setInterceptFileChooserDialog', { enabled: true }");
    expect(settleAt).toBeGreaterThan(-1);
    expect(settleAt).toBeLessThan(interceptAt);
  });
});
