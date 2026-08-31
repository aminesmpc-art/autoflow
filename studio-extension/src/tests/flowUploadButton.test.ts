/**
 * @jest-environment jsdom
 */

/**
 * Flow's Upload button, exactly as it is on the page.
 *
 * Read off the live dialog rather than imagined:
 *
 *   <button class="sc-16c4830a-1 dnFqQq sc-e7a64add-0 …">
 *     <i class="sc-a39c2a59-0 gOHwjv google-symbols undefined"
 *        font-size="1.25rem" color="currentColor">upload</i>
 *     Upload media
 *     <div data-type="button-overlay" class="sc-16c4830a-0 cZvLor"></div>
 *   </button>
 *
 * Two things follow from it, and both were being got wrong.
 *
 * 1. textContent is "uploadUpload media", not "Upload media". Material's
 *    ligature renders as text and runs straight into the label. Any matcher
 *    anchored to the START of the label misses; any matcher that ignores the
 *    ligature throws away the one token that is identical in every language.
 *
 * 2. There is no role, no data-test-id, and no semantic hook — on the button
 *    or on anything around it. Both the dialog opener and the CDP lookup
 *    required a [role="dialog"] ancestor before they would even look, so when
 *    that guess is wrong the answer is "the media dialog did not open" about a
 *    dialog that is plainly open, and the upload gives up before attaching.
 */

import { mediaDialogOpen } from '../content/flow/libraryPicker';
import { FLOW_STRINGS } from '../content/flow/flowStrings';

/** The button as it really is, ligature and overlay included. */
function uploadButton(label = 'Upload media'): string {
  return `
    <button class="sc-16c4830a-1 dnFqQq sc-e7a64add-0 sc-e7a64add-1 fPutAP jmLZrS">
      <i class="sc-a39c2a59-0 gOHwjv google-symbols undefined"
         font-size="1.25rem" color="currentColor">upload</i>${label}
      <div data-type="button-overlay" class="sc-16c4830a-0 cZvLor"></div>
    </button>`;
}

/** jsdom gives everything a zero rect; these lookups require a visible one. */
function makeVisible(): void {
  for (const el of Array.from(document.querySelectorAll('button, input'))) {
    (el as HTMLElement).getBoundingClientRect = () =>
      ({ width: 160, height: 40, left: 20, top: 300, right: 180, bottom: 340 }) as DOMRect;
  }
}

describe('what the markup actually says', () => {
  it('reads as "uploadUpload media", because the ligature is text', () => {
    document.body.innerHTML = uploadButton();
    const btn = document.querySelector('button') as HTMLElement;
    expect((btn.textContent || '').trim().replace(/\s+/g, ' ')).toBe('uploadUpload media');
  });

  it('carries nothing semantic to hang a selector on', () => {
    document.body.innerHTML = uploadButton();
    const btn = document.querySelector('button') as HTMLElement;
    expect(btn.getAttribute('role')).toBeNull();
    expect(btn.getAttribute('data-test-id')).toBeNull();
    expect(btn.closest('[role="dialog"]')).toBeNull();
  });
});

describe('recognising the dialog without a role', () => {
  it('accepts the real markup, with no [role=dialog] anywhere', () => {
    /* The regression. This returned false, and the upload reported that a
       dialog which was open on screen had not opened. */
    document.body.innerHTML = `<div class="sc-559b4cd2-4 hqrnuD">${uploadButton()}</div>`;
    makeVisible();
    expect(mediaDialogOpen(document)).toBe(true);
  });

  it('still accepts a proper dialog, which is the better signal', () => {
    document.body.innerHTML = '<div role="dialog"><button>whatever</button></div>';
    expect(mediaDialogOpen(document)).toBe(true);
  });

  it('says no when the dialog really is closed', () => {
    /* The check must not become "always true" — a false positive here sends
       CDP hunting for a button on a page that never opened the picker. */
    document.body.innerHTML = '<div><button>Generate</button><button>Settings</button></div>';
    makeVisible();
    expect(mediaDialogOpen(document)).toBe(false);
  });

  it('ignores a hidden Upload button', () => {
    document.body.innerHTML = uploadButton();
    /* left at jsdom's zero rect on purpose */
    expect(mediaDialogOpen(document)).toBe(false);
  });

  it('recognises it in a language nobody added, via the ligature', () => {
    /* The <i> says "upload" whatever the label says. */
    document.body.innerHTML = uploadButton('メディアをアップロード');
    makeVisible();
    expect(mediaDialogOpen(document)).toBe(true);
  });
});

describe('the CDP lookup, run against the same markup', () => {
  /* The lookup ships as a string evaluated in the page, so the matching rule
     is mirrored here and exercised on the real element. */
  const UP = FLOW_STRINGS.upload.map((w) => w.toLowerCase());
  const MED = ['media', 'média', 'medios', 'mídia', 'medien'];

  function pick(): { label: string; med: boolean } | { error: string } {
    const dialog = document.querySelector('[role="dialog"], mat-dialog-container');
    const scope: ParentNode = dialog || document;
    const cands: Array<{ label: string; med: boolean; len: number }> = [];
    for (const b of Array.from(scope.querySelectorAll('button'))) {
      const r = (b as HTMLElement).getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const t = (b.textContent || '').trim();
      const low = t.toLowerCase();
      if (!UP.some((w) => low.includes(w))) continue;
      cands.push({ label: t, med: MED.some((w) => low.includes(w)), len: t.length });
    }
    if (!cands.length) return { error: 'no upload button' };
    cands.sort((a, c) => (a.med !== c.med ? (a.med ? -1 : 1) : a.len - c.len));
    return cands[0];
  }

  it('finds the button with no dialog wrapper at all', () => {
    document.body.innerHTML = uploadButton();
    makeVisible();
    const got = pick() as { label: string };
    expect(got.label.replace(/\s+/g, ' ')).toBe('uploadUpload media');
  });

  it('prefers the media button over a bare Upload elsewhere', () => {
    /* Widening the scope to the whole document lets other upload buttons in;
       the media preference is what keeps the right one winning. */
    document.body.innerHTML = `<button>Upload</button>${uploadButton()}`;
    makeVisible();
    const got = pick() as { med: boolean; label: string };
    expect(got.med).toBe(true);
    expect(got.label).toContain('Upload media');
  });

  it('still prefers the dialog when there is one', () => {
    document.body.innerHTML = `
      <button>uploadUpload media</button>
      <div role="dialog">${uploadButton('Upload media from library')}</div>`;
    makeVisible();
    const got = pick() as { label: string };
    expect(got.label).toContain('from library');
  });
});
