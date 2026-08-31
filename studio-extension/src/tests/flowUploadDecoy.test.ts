/**
 * @jest-environment jsdom
 */

/**
 * The button that looked like Upload and was not.
 *
 * The run reported, in its own words:
 *
 *   file chooser did not open within 15s. Clicked
 *   "drive_folder_uploadView uploaded media" at 40,311 (40x40).
 *   Direct route was skipped: no input here accepts video
 *   (found 1 image-only: image/*) — the dialog may be on the Images tab
 *
 * That is Flow's sidebar: a 40x40 nav icon that opens a listing of uploaded
 * media. Matching the raw textContent, it wins on both tests used to find the
 * real control —
 *
 *   "drive_folder_uploadView uploaded media"
 *      contains "upload"   (from the ICON NAME, not the label)
 *      contains "media"    (so it was PREFERRED over anything else)
 *
 * — and clicking it opens no file chooser, so the upload burned fifteen
 * seconds and gave up. It also poisoned the step before: uploadButtons() saw
 * it, mediaDialogOpen() said the dialog was already open, and openMediaDialog
 * returned early without ever pressing Add Media.
 *
 * The fix is to judge on the icon NAME, matched exactly. A ligature renders as
 * text, is identical in every language, and separates an action from a view in
 * a way the label cannot — "upload" is the control, "drive_folder_upload" is
 * the shelf it sits on.
 */

/// <reference types="node" />

import * as fs from 'fs';
import * as path from 'path';

import { uploadButtons, mediaDialogOpen, labelWithoutIcons } from '../content/flow/libraryPicker';
import { FLOW_STRINGS } from '../content/flow/flowStrings';

const SRC = fs.readFileSync(
  path.resolve(__dirname, '../background/debugUpload.ts'), 'utf8',
).replace(/\r\n/g, '\n');

/** Flow's real Upload control. */
const REAL = `
  <button id="real" class="sc-16c4830a-1 dnFqQq">
    <i class="sc-a39c2a59-0 google-symbols">upload</i>Upload media
    <div data-type="button-overlay"></div>
  </button>`;

/** Flow's sidebar item, the one that was clicked. */
const DECOY = `
  <button id="decoy">
    <i class="google-symbols">drive_folder_upload</i>View uploaded media
  </button>`;

function box(el: Element, w = 160, h = 40): void {
  (el as HTMLElement).getBoundingClientRect = () =>
    ({ width: w, height: h, left: 20, top: 300, right: 20 + w, bottom: 300 + h }) as DOMRect;
}
function boxAll(): void {
  for (const el of Array.from(document.querySelectorAll('button'))) box(el);
}

describe('telling the control from the shelf', () => {
  it('strips the ligature off the label', () => {
    document.body.innerHTML = DECOY;
    const b = document.getElementById('decoy') as HTMLElement;
    /* textContent runs them together; the label alone is what a person reads. */
    expect((b.textContent || '').trim().replace(/\s+/g, ' '))
      .toBe('drive_folder_uploadView uploaded media');
    expect(labelWithoutIcons(b)).toBe('View uploaded media');
  });

  it('does not treat the sidebar item as an upload button', () => {
    document.body.innerHTML = DECOY;
    boxAll();
    expect(uploadButtons(document)).toHaveLength(0);
  });

  it('still finds the real one', () => {
    document.body.innerHTML = REAL;
    boxAll();
    expect(uploadButtons(document).map((b) => b.id)).toEqual(['real']);
  });

  it('picks only the real one when both are present', () => {
    document.body.innerHTML = DECOY + REAL;
    boxAll();
    expect(uploadButtons(document).map((b) => b.id)).toEqual(['real']);
  });

  it('does not call the sidebar an open dialog', () => {
    /* This is what made openMediaDialog return early and skip Add Media. */
    document.body.innerHTML = DECOY;
    boxAll();
    expect(mediaDialogOpen(document)).toBe(false);
  });

  it('accepts a translated label with no icon at all', () => {
    /* The icon is the best anchor, not the only one. */
    document.body.innerHTML = '<button id="fr">Importer un média</button>';
    boxAll();
    expect(uploadButtons(document).map((b) => b.id)).toEqual(['fr']);
  });

  it('accepts a verb-final language, where the label does not start with it', () => {
    /* German puts it last: "Medien hochladen". Anything anchored to the START
       of the label would miss this. */
    document.body.innerHTML = '<button id="de">Medien hochladen</button>';
    boxAll();
    expect(uploadButtons(document).map((b) => b.id)).toEqual(['de']);
    expect(FLOW_STRINGS.upload).toContain('Hochladen');
  });
});

describe('the CDP lookup, run as it actually ships', () => {
  /* The expression is a string sent to the page, so reading it proves nothing.
     It is extracted, its interpolations filled the way the module fills them,
     and then executed against the real markup. */
  function runShippedLookup(): any {
    const m = /expression: `(\(function \(\) \{[\s\S]*?\}\)\(\))`/.exec(SRC);
    if (!m) throw new Error('could not find the injected expression');

    const UPLOAD_WORDS = FLOW_STRINGS.upload.map((w) => w.toLowerCase());
    const mediaDecl = /^const MEDIA_WORDS = \[[\s\S]*?\];/m.exec(SRC) as RegExpExecArray;
    const iconDecl = /^const UPLOAD_ICONS = \[[\s\S]*?\];/m.exec(SRC) as RegExpExecArray;
    // eslint-disable-next-line no-eval
    const MEDIA_WORDS = eval(mediaDecl[0].replace('const MEDIA_WORDS =', '') .replace(/;$/, ''));
    // eslint-disable-next-line no-eval
    const UPLOAD_ICONS = eval(iconDecl[0].replace('const UPLOAD_ICONS =', '').replace(/;$/, ''));

    const filled = m[1]
      .replace('${JSON.stringify(UPLOAD_WORDS)}', JSON.stringify(UPLOAD_WORDS))
      .replace('${JSON.stringify(MEDIA_WORDS)}', JSON.stringify(MEDIA_WORDS))
      .replace('${JSON.stringify(UPLOAD_ICONS)}', JSON.stringify(UPLOAD_ICONS));

    expect(filled).not.toContain('${');   // every hole filled
    // eslint-disable-next-line no-eval
    return JSON.parse(eval(filled));
  }

  it('is syntactically valid and runs', () => {
    document.body.innerHTML = REAL;
    boxAll();
    expect(() => runShippedLookup()).not.toThrow();
  });

  it('refuses the sidebar item outright', () => {
    /* Before: it was chosen AND preferred, then clicked at 40,311. */
    document.body.innerHTML = DECOY;
    boxAll();
    const got = runShippedLookup();
    expect(got.error).toBe('no upload button on the page');
  });

  it('picks the real button when the decoy sits beside it', () => {
    document.body.innerHTML = DECOY + REAL;
    boxAll();
    const got = runShippedLookup();
    expect(got.error).toBeUndefined();
    expect(got.label.replace(/\s+/g, ' ')).toBe('uploadUpload media');
    expect(got.alternatives).toBe(0);
  });

  it('reports the decoy among seen, so a future miss is diagnosable', () => {
    document.body.innerHTML = DECOY;
    boxAll();
    expect(runShippedLookup().seen.join(' | ')).toContain('drive_folder_upload');
  });

  it('finds the French control by its icon, whatever the label says', () => {
    document.body.innerHTML = `
      <button id="fr"><i class="google-symbols">upload</i>Importer un média</button>`;
    boxAll();
    const got = runShippedLookup();
    expect(got.error).toBeUndefined();
    expect(got.label).toContain('Importer');
  });
});
