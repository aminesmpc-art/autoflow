/**
 * @jest-environment jsdom
 */

/**
 * "2 piece(s) are in the Flow library" — said about two files that were not.
 *
 * ── What the user saw ────────────────────────────────────────────────────
 *
 * A Motion Control run on a NEW Google account in a NEW Chrome profile:
 *
 *   07:36:52  Motion  Uploading 2 piece(s) to Flow — Chrome will show a banner.
 *   07:36:59  Motion  2 piece(s) are in the Flow library.
 *   07:36:59  Flow    Starting queue "STUDIO" with 1 prompts
 *   07:36:59  Flow    Detail view or modal is open. Closing it to return…
 *   07:36:59  Flow    agreed to Flow's upload rights notice ("I agree, …")
 *   07:37:39  Flow    ERROR: nothing in the library matches
 *                     "Motion-Control-1-silent-part1-of-2.mp4"
 *
 * Searching Flow's library by hand agreed with the error: No assets found.
 * The same account uploaded the reference IMAGE in the same run without
 * trouble, and attempt 2 found that image in the library — so the library,
 * the search and the names were all fine. The videos were simply never there.
 *
 * ── Why ──────────────────────────────────────────────────────────────────
 *
 * uploadViaFileChooser returns `{ok: true}` the moment DOM.setFileInputFiles
 * resolves. That is Chrome handing the file PATHS to an <input>; Flow has not
 * read a byte. Nothing anywhere then checked the library — the claim at
 * 07:36:59 was made from `upload.ok` alone.
 *
 * Which leaves a race, and a new account loses it. Flow shows "Rights to use
 * this video" before the FIRST upload on an account and will not ingest until
 * it is answered. On an established account there is no notice, ingest starts
 * at once and wins. On a new one the notice stands in front of the bytes, the
 * Motion node walks away believing it is done, and the Flow queue it hands the
 * tab to closes the still-open dialog on its way in — look at the ordering
 * above: the modal was closed BEFORE the notice was agreed.
 *
 * ── The fix ──────────────────────────────────────────────────────────────
 *
 * The upload finishes when the names are in the library, not when Chrome has
 * passed the paths along. confirmInLibrary searches for each one — pressing
 * the rights notice every turn of the poll, because that is the thing most
 * likely to be holding the file — and only then may the worker say ok.
 *
 * With one line drawn carefully: a search that RAN and found nothing is
 * evidence the upload failed. A search that could not run is evidence of
 * nothing, and must not fail an upload that may well have worked.
 */

/// <reference types="node" />

import {
  confirmInLibrary,
  namedVideoRow,
} from '../content/flow/libraryPicker';
import * as fs from 'fs';
import * as path from 'path';

const read = (rel: string) =>
  fs.readFileSync(path.resolve(__dirname, rel), 'utf8').replace(/\r\n/g, '\n');

const WORKER = read('../background/debugUpload.ts');
const RUNNER = read('../studio/engine/WorkflowRunner.ts');
const FLOW = read('../content/flow/index.ts');

/** jsdom reports a zero box for everything; isShowing ranks on size. */
function box(el: Element): void {
  (el as HTMLElement).getBoundingClientRect = () =>
    ({ width: 120, height: 32, left: 10, top: 400, right: 130, bottom: 432 }) as DOMRect;
}
function boxAll(sel: string): void {
  for (const el of Array.from(document.querySelectorAll(sel))) box(el);
}

const PART1 = 'Motion-Control-1-silent-part1-of-2.mp4';
const PART2 = 'Motion-Control-1-silent-part2-of-2.mp4';

/** The asset picker, open on a library with whatever clips are passed in. */
function openPicker(clips: string[] = []): void {
  document.body.innerHTML = `
    <flow-ingredient-bar><div class="ingredient-bar-container"></div></flow-ingredient-bar>
    <div role="dialog" id="picker">
      <button id="tab-images"><i class="google-symbols">image</i>Images</button>
      <button id="tab-videos"><i class="google-symbols">videocam</i>Videos</button>
      <input class="search-input" aria-label="Search assets" placeholder="Search assets" />
      <div id="results">${clips.map(row).join('')}</div>
    </div>`;
  boxAll('button');
  boxAll('input');
}

function row(name: string): string {
  return `<div class="tile" role="button"><video src="blob:${name}"></video>`
    + `<span>${name}</span></div>`;
}

function addClip(name: string): void {
  document.getElementById('results')!.insertAdjacentHTML('beforeend', row(name));
}

/**
 * Flow's rights consent, over the top of whatever else is open.
 *
 * `sticky` is the notice that does not go away when it is pressed — a press
 * that lands on a disabled button, or the notice Flow raises again for the
 * second file of a two-part upload. It is the case the error message exists
 * for: pressing it is not the same as it being answered.
 */
function raiseConsent(onAgree: () => void, sticky = false): void {
  document.body.insertAdjacentHTML('beforeend',
    '<div class="cdk-overlay-pane" id="consent">'
    + '<button id="agree">I agree, do not show again</button></div>');
  box(document.getElementById('consent')!);
  box(document.getElementById('agree')!);
  document.getElementById('agree')!.addEventListener('click', () => {
    if (sticky) return;
    document.getElementById('consent')!.remove();
    onAgree();
  });
}

/* ────────────────────────────────────────────────────────────────────────
   1. It looks, rather than assuming
   ──────────────────────────────────────────────────────────────────────── */

describe('confirmInLibrary answers the question the upload never asked', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('confirms clips that are actually there', async () => {
    openPicker([PART1, PART2]);
    const seen = await confirmInLibrary([PART1, PART2], { doc: document, step: 0 });
    expect(seen.ok).toBe(true);
    expect(seen.missing).toEqual([]);
    expect(seen.found).toHaveLength(2);
  });

  it('reports the ones that are not, by name', async () => {
    /* The failing run: the picker is open, the search works, the library is
       simply empty of these two. */
    openPicker([]);
    const seen = await confirmInLibrary([PART1, PART2], { doc: document, step: 0 });
    expect(seen.ok).toBe(false);
    expect(seen.missing).toEqual([
      'Motion-Control-1-silent-part1-of-2',
      'Motion-Control-1-silent-part2-of-2',
    ]);
    /* No `reason`: the search RAN. That is what lets the worker fail the
       upload on this, and refuse to fail on the case below. */
    expect(seen.reason).toBeUndefined();
  });

  it('searches without the extension, the way the attach does', async () => {
    /* attachFromLibrary strips .mp4 before typing. If this did not, a library
       listing the clip without its extension would confirm as missing and the
       attach would then find it — the two disagreeing about one library. */
    openPicker(['Motion-Control-1-silent-part1-of-2']);
    const seen = await confirmInLibrary([PART1], { doc: document, step: 0 });
    expect(seen.ok).toBe(true);
  });

  it('does not accept part2 as proof that part1 arrived', async () => {
    /* The pieces of one cut differ by a single character. Taking a row that
       merely sits near the right one produces a plausible video of the wrong
       six seconds, which nothing downstream can detect. */
    openPicker([PART2]);
    const seen = await confirmInLibrary([PART1], { doc: document, step: 0 });
    expect(seen.ok).toBe(false);
    expect(seen.found).toEqual([]);
  });

  it('will not climb out of a row into the list that holds every name', async () => {
    /* namedVideoRow stops as soon as an ancestor holds a second <video>.
       Without that guard the results container matches every search, because
       its text carries every name in the library. */
    openPicker([PART1, PART2]);
    const hit = namedVideoRow(document, 'Motion-Control-1-silent-part1-of-2');
    expect(hit).not.toBeNull();
    expect(hit!.getAttribute('src')).toBe(`blob:${PART1}`);
  });
});

/* ────────────────────────────────────────────────────────────────────────
   2. The rights notice, which is why a new account behaved differently
   ──────────────────────────────────────────────────────────────────────── */

describe('the consent that stands in front of the ingest', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('is named when it is still on screen, because that has an action', async () => {
    /* Pressed, and still there. The user's fix for this one is thirty seconds
       of their own time, so the message says to go and do it rather than
       reporting a timeout they can do nothing with. */
    openPicker([]);
    raiseConsent(() => { /* the press does not take */ }, true);
    const seen = await confirmInLibrary([PART1], { doc: document, step: 0 });
    expect(seen.ok).toBe(false);
    expect(seen.consentOnScreen).toBe(true);
  });

  it('is pressed before the search, not merely watched for', async () => {
    /* A search run underneath the notice polls a library that cannot fill. */
    openPicker([]);
    raiseConsent(() => addClip(PART1));
    const seen = await confirmInLibrary([PART1], { doc: document, step: 0 });
    expect(seen.consentDismissed).toBe(1);
    expect(seen.ok).toBe(true);
    expect(seen.consentOnScreen).toBe(false);
  });

  it('is pressed again if it only appears once the wait is under way', async () => {
    /* Whether Flow raises it on the Upload press or on the hand-off is not
       settled, and the worker's 45s watcher is fired and forgotten — its
       window can expire on either side of the moment that matters. So the
       wait that CARES about the answer does the pressing, every turn. */
    openPicker([]);
    setTimeout(() => raiseConsent(() => addClip(PART1)), 300);

    const seen = await confirmInLibrary([PART1], {
      doc: document, step: 0, budgetMs: 5000,
    });
    expect(seen.consentDismissed).toBe(1);
    expect(seen.ok).toBe(true);
  }, 10_000);
});

/* ────────────────────────────────────────────────────────────────────────
   3. "Flow did not take it" is not the same as "I could not tell"
   ──────────────────────────────────────────────────────────────────────── */

describe('a check that could not run proves nothing', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('sets reason, and does not present missing as a finding', async () => {
    /* A dialog with no search box in it. The clips may be sitting in the
       library; this simply cannot see. Failing the upload here would break
       every layout whose picker libraryPicker has not learned to open. */
    document.body.innerHTML = '<div role="dialog" id="picker"><span>no search here</span></div>';
    boxAll('div');
    const seen = await confirmInLibrary([PART1], { doc: document, step: 0 });
    expect(seen.ok).toBe(false);
    expect(seen.reason).toBeTruthy();
  });

  it('the worker pauses unverified uploads instead of reporting success', () => {
    expect(WORKER).toMatch(/if \(result\.ok && !landed\.ok\)/);
    expect(WORKER).toContain("landed.failed ? 'failed' : 'pending'");
    /* And the two ways of not-running both say so rather than returning ok. */
    const at = WORKER.indexOf('async function confirmUploadLanded');
    expect(at).toBeGreaterThan(-1);
    const body = WORKER.slice(at, WORKER.length);
    expect(body).toMatch(/the library could not be checked/);
    expect(body).toMatch(/the library could not be searched/);
    expect(body).toMatch(/ran: false, note: `the library could not be checked/);
  });

  it('carries the distinction out to the caller instead of flattening it', () => {
    /* `confirmed` is tri-state on purpose: true, false, or absent. Two states
       would have to fold "could not look" into one of the answers, and either
       fold reintroduces the bug — as a false alarm or as the silent pass. */
    expect(WORKER).toMatch(/confirmed\?: boolean;/);
    expect(WORKER).toMatch(/confirmed: landed\.ran \? true : undefined/);
  });
});

/* ────────────────────────────────────────────────────────────────────────
   4. Wiring
   ──────────────────────────────────────────────────────────────────────── */

describe('the pieces are joined up', () => {
  it('the worker asks the page, because the answer is in the DOM', () => {
    expect(WORKER).toMatch(/type: 'CONFIRM_VIDEOS_IN_LIBRARY'/);
    expect(FLOW).toMatch(/case 'CONFIRM_VIDEOS_IN_LIBRARY'/);
    expect(FLOW).toMatch(/confirmInLibrary\(names, \{ log: logLine, budgetMs \}\)/);
  });

  it('the upload waits for the answer before it returns', () => {
    const at = WORKER.indexOf('const result = await uploadViaFileChooser(tabId, paths);');
    expect(at).toBeGreaterThan(-1);
    const after = WORKER.slice(at, WORKER.indexOf('Step 4', at));
    expect(after).toMatch(/await confirmUploadLanded\(tabId, names\)/);
  });

  it('gives Flow long enough that an impatient check cannot throw a cut away', () => {
    /* The budget is only ever spent in full on a failing upload, and the cost
       of being early is a discarded cut plus the director pass behind it. */
    const budget = /const LIBRARY_LANDING_MS = ([\d_]+);/.exec(WORKER);
    expect(budget).not.toBeNull();
    expect(Number(budget![1].replace(/_/g, ''))).toBeGreaterThanOrEqual(30_000);
  });

  it('the Motion node stops claiming a library it never looked at', () => {
    const at = RUNNER.indexOf("studioLog('Motion', upload.confirmed");
    expect(at).toBeGreaterThan(-1);
    /* The old sentence was unconditional. Whatever it says now has to depend
       on whether anything actually checked. */
    expect(RUNNER).not.toMatch(
      /studioLog\('Motion', `\$\{cuts\.length\} piece\(s\) are in the Flow library\.`\)/,
    );
    const body = RUNNER.slice(at, at + 600);
    expect(body).toMatch(/found by name/);
    expect(body).toMatch(/but the library could not be/);
    expect(body).toMatch(/upload\.confirmNote/);
  });
});
