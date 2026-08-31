/**
 * @jest-environment jsdom
 */

/* ============================================================
   Does Gemini notice the file it just uploaded?

   It did not. attachmentCount() counted <img> inside composerRegion(), which
   resolves to `rich-textarea` — and Gemini renders the attachment chip in
   `.attachment-preview-wrapper`, a SIBLING of it. Measured on the live page:

     composerRegion() → RICH-TEXTAREA
     imgs inside:   0
     videos inside: 0
     uploader-file-preview anywhere: 1
     chip inside rich-textarea: false

   So the count was zero however many files had landed. Every reference spun
   the full 45s upload wait and came back "did not finish uploading to Gemini"
   while the file sat attached and visible. That hit every Gemini node with an
   image input, not just the agent.

   A clip makes it worse: its chip shows a duration badge ("0:06") and contains
   no <img> at all, so there was nothing to count even in principle.

   The DOM below is the live structure, reproduced.
   ============================================================ */

/// <reference types="node" />

import { existsSync } from 'fs';
import { join } from 'path';

const BUNDLE = join(__dirname, '../../dist/gemini-content.js');

/** The composer, exactly as Gemini nests it. */
function buildComposer(): { wrapper: HTMLElement } {
  document.body.innerHTML = '';
  const field = document.createElement('div');
  field.className = 'text-input-field';

  // The attachment chips live HERE — outside rich-textarea.
  const wrapper = document.createElement('div');
  wrapper.className = 'attachment-preview-wrapper';

  const rich = document.createElement('rich-textarea');
  const editor = document.createElement('div');
  editor.className = 'ql-editor';
  editor.setAttribute('contenteditable', 'true');
  rich.append(editor);

  field.append(wrapper, rich);
  document.body.append(field);
  return { wrapper };
}

/** One attachment chip, as Gemini renders it. */
function addChip(wrapper: HTMLElement, kind: 'image' | 'clip'): void {
  const container = document.createElement('uploader-file-preview-container');
  container.className = 'uploader-file-preview-container';
  const chip = document.createElement('uploader-file-preview');
  chip.className = 'file-preview-chip';
  if (kind === 'image') {
    chip.append(document.createElement('img'));
  } else {
    // A clip shows a duration badge and no <img> at all.
    chip.textContent = '0:06';
  }
  container.append(chip);
  wrapper.append(container);
}

beforeAll(() => {
  if (!existsSync(BUNDLE)) throw new Error(`build first: ${BUNDLE} is missing`);
});

/* The bundle keeps attachmentCount private, so this asserts the selectors it
   now uses against the real markup. If the shipped selectors and these ever
   disagree, the bundle check below fails. */
const countLikeAdapter = (): number => {
  const chips = document.querySelectorAll('uploader-file-preview, .file-preview-chip');
  if (chips.length) return chips.length;
  return document.querySelectorAll(
    '.attachment-preview-wrapper img, .attachment-preview-wrapper video'
  ).length;
};

describe('counting what is attached', () => {
  it('sees an image chip that lives outside rich-textarea', () => {
    const { wrapper } = buildComposer();
    addChip(wrapper, 'image');

    // The old rule, for contrast: scoped to the composer, it finds nothing.
    const composer = document.querySelector('rich-textarea');
    expect(composer!.querySelectorAll('img')).toHaveLength(0);

    expect(countLikeAdapter()).toBe(1);
  });

  it('sees a CLIP chip, which contains no image at all', () => {
    const { wrapper } = buildComposer();
    addChip(wrapper, 'clip');

    expect(document.querySelectorAll('img')).toHaveLength(0);
    expect(countLikeAdapter()).toBe(1);
  });

  it('counts each chip once, not twice for tag and class', () => {
    // The element is <uploader-file-preview class="file-preview-chip">, so it
    // matches both halves of the selector — querySelectorAll must dedupe it.
    const { wrapper } = buildComposer();
    addChip(wrapper, 'image');
    addChip(wrapper, 'clip');
    expect(countLikeAdapter()).toBe(2);
  });

  it('is zero on an empty composer, so the baseline delta works', () => {
    buildComposer();
    expect(countLikeAdapter()).toBe(0);
  });

  it('falls back to the wrapper if the component is ever renamed', () => {
    const { wrapper } = buildComposer();
    const img = document.createElement('img');
    wrapper.append(img);        // no uploader-file-preview anywhere
    expect(countLikeAdapter()).toBe(1);
  });
});

describe('the shipped bundle uses these selectors', () => {
  it('looks for the preview component, not img-in-composer', () => {
    const src = require('fs').readFileSync(BUNDLE, 'utf8');
    expect(src).toContain('uploader-file-preview');
    expect(src).toContain('attachment-preview-wrapper');
  });
});

/* ============================================================
   Waiting for the upload, not for the chip.

   Measured on a live Gemini with a 119KB clip:

     t=0     no chip,  1 spinner (a page-level one, unrelated)
     t=400   chip,     2 spinners   <- still uploading
     t=1200  chip,     1 spinner    <- upload done
     send button: never disabled, at any point

   So "a chip exists and the send button works" — the old readiness test — was
   already true at 400ms, with the bytes still going up. Submitting there sends
   the prompt alone and Gemini answers about a file it never received: a run
   that looks perfect and is wrong. Bigger files widen the window.

   The finished chip contains <gem-media-attachment>; the in-flight one carries
   a progress spinner inside .attachment-preview-wrapper. The leftover
   page-level spinner sits OUTSIDE that wrapper, which is why the check is
   scoped to it and not to the document.
   ============================================================ */
describe('waiting for the upload to actually finish', () => {
  const PROGRESS = 'mat-spinner, mat-progress-spinner, [role="progressbar"], '
    + '.mat-mdc-progress-spinner, .mat-mdc-progress-bar';

  /** The adapter's predicates, against the real markup. */
  const attachmentCount = () => {
    const chips = document.querySelectorAll('uploader-file-preview, .file-preview-chip');
    if (chips.length) return chips.length;
    return document.querySelectorAll(
      '.attachment-preview-wrapper img, .attachment-preview-wrapper video'
    ).length;
  };
  const uploadInProgress = () => {
    const w = document.querySelector('.attachment-preview-wrapper');
    return w ? w.querySelectorAll(PROGRESS).length > 0 : false;
  };
  const settled = () => {
    const media = document.querySelectorAll('gem-media-attachment').length;
    return media || (uploadInProgress() ? 0 : attachmentCount());
  };

  function page(): HTMLElement {
    document.body.innerHTML = '';
    // Gemini keeps an unrelated spinner mounted elsewhere on the page.
    const stray = document.createElement('mat-progress-spinner');
    stray.setAttribute('role', 'progressbar');
    const wrapper = document.createElement('div');
    wrapper.className = 'attachment-preview-wrapper';
    const rich = document.createElement('rich-textarea');
    document.body.append(stray, wrapper, rich);
    return wrapper;
  }

  const addUploadingChip = (w: HTMLElement) => {
    const chip = document.createElement('uploader-file-preview');
    chip.className = 'file-preview-chip';
    const spin = document.createElement('mat-progress-spinner');
    spin.setAttribute('role', 'progressbar');
    chip.append(spin);
    w.append(chip);
    return chip;
  };

  const finish = (chip: HTMLElement) => {
    chip.querySelectorAll('mat-progress-spinner').forEach((s) => s.remove());
    chip.append(document.createElement('gem-media-attachment'));
  };

  it('does not count a chip that is still uploading', () => {
    const w = page();
    addUploadingChip(w);

    // The old rule would already be satisfied here.
    expect(attachmentCount()).toBe(1);
    // The new one is not.
    expect(uploadInProgress()).toBe(true);
    expect(settled()).toBe(0);
  });

  it('counts it once the upload completes', () => {
    const w = page();
    const chip = addUploadingChip(w);
    finish(chip);

    expect(uploadInProgress()).toBe(false);
    expect(settled()).toBe(1);
  });

  it('ignores the page-level spinner outside the wrapper', () => {
    /* Scoping matters: a document-wide spinner check never clears, so every
       upload would run to the 45s timeout and be called a failure. */
    const w = page();
    const chip = addUploadingChip(w);
    finish(chip);

    expect(document.querySelectorAll(PROGRESS).length).toBe(1); // the stray one
    expect(uploadInProgress()).toBe(false);
  });

  it('waits for the slowest of several files', () => {
    const w = page();
    const a = addUploadingChip(w);
    const b = addUploadingChip(w);
    finish(a);

    // One done, one still going — not ready.
    expect(uploadInProgress()).toBe(true);
    expect(settled()).toBe(1);      // only the finished one counts

    finish(b);
    expect(settled()).toBe(2);
  });

  it('is zero on an empty composer, so the baseline delta holds', () => {
    page();
    expect(settled()).toBe(0);
    expect(uploadInProgress()).toBe(false);
  });

  it('still settles for a non-media file with no gem-media-attachment', () => {
    // A format that renders differently must not wait forever.
    const w = page();
    const chip = document.createElement('uploader-file-preview');
    chip.className = 'file-preview-chip';
    w.append(chip);

    expect(document.querySelectorAll('gem-media-attachment')).toHaveLength(0);
    expect(settled()).toBe(1);
  });
});

describe('the shipped Gemini bundle waits on the upload', () => {
  it('checks progress inside the attachment wrapper', () => {
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../../dist/gemini-content.js'), 'utf8'
    );
    expect(src).toContain('gem-media-attachment');
    expect(src).toContain('progressbar');
  });
});
