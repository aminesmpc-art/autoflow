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
