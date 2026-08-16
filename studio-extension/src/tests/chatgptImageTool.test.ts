/**
 * @jest-environment jsdom
 */

/**
 * Knowing that ChatGPT took the Create image tool.
 *
 * Read off the live page on 2026-08-17, both states, after the user reported
 * image generation had stopped working. ChatGPT moved the marker and renamed
 * it in the same redesign. It used to be a span INSIDE the editor:
 *
 *     <span data-inline-selection-pill>Create image</span>
 *
 * and it is now a button beside it, called something shorter:
 *
 *     <button class="__composer-pill" aria-label="Image, click to remove">
 *       <span class="max-w-40 truncate">Image</span>
 *
 * Either change alone was enough. The menu ENTRY is still "Create image", so
 * the click kept working and only the confirmation failed — every image node
 * clicked the right thing, waited three seconds for a marker that no longer
 * exists, and reported "the composer did not take the tool" about a composer
 * that had taken it.
 *
 * The old shape is still accepted: a redesign reaches accounts at different
 * times, and an adapter that only knows the newest one breaks for everybody
 * who has not been switched over yet.
 */

/// <reference types="node" />

import { readFileSync } from 'fs';
import { join } from 'path';

const SRC = readFileSync(
  join(__dirname, '..', 'content', 'chatgpt', 'index.ts'), 'utf8');

/** The predicate, lifted out of the adapter so the DOM can be driven at it. */
function hasToolPill(): boolean {
  const names = ['image', 'create image'];
  const named = (el: Element): string => (
    el.getAttribute('aria-label') || el.textContent || ''
  ).trim().toLowerCase().replace(/,\s*click to remove$/, '');
  return Array.from(document.querySelectorAll(
    'button.__composer-pill, [data-inline-selection-pill]',
  )).some((p) => names.includes(named(p)));
}

afterEach(() => { document.body.innerHTML = ''; });

describe('the composer pill, as ChatGPT renders it today', () => {
  it('sees the new button beside the editor', () => {
    document.body.innerHTML = `
      <form><div class="flex items-center"><div class="contents">
        <button class="__composer-pill group" aria-label="Image, click to remove">
          <span class="max-w-40 truncate">Image</span>
        </button>
      </div></div></form>`;
    expect(hasToolPill()).toBe(true);
  });

  it('sees nothing once the tool is removed', () => {
    /* Measured: clicking the pill removes it and leaves no marker at all.
       Without this the predicate could be always-true and nobody would know. */
    document.body.innerHTML = '<form><div class="flex items-center"></div></form>';
    expect(hasToolPill()).toBe(false);
  });

  it('still sees the old pill inside the editor', () => {
    document.body.innerHTML = `
      <div id="prompt-textarea" contenteditable="true">
        <span data-inline-selection-pill contenteditable="false">Create image</span>
      </div>`;
    expect(hasToolPill()).toBe(true);
  });
});

describe('what it must not mistake for the tool', () => {
  it('ignores an attached file that happens to be an image', () => {
    /* An attachment gets a pill of its own in the same row. Matching by
       prefix would read "Image_2024_final.png" as the tool being on, and the
       node would submit prose with no generation requested. */
    document.body.innerHTML = `
      <button class="__composer-pill" aria-label="Image_2024_final.png, click to remove">
        <span class="max-w-40 truncate">Image_2024_final.png</span>
      </button>`;
    expect(hasToolPill()).toBe(false);
  });

  it('ignores another tool sitting in the same place', () => {
    document.body.innerHTML = `
      <button class="__composer-pill" aria-label="Web search, click to remove">
        <span>Web search</span>
      </button>`;
    expect(hasToolPill()).toBe(false);
  });

  it('is not fooled by the word appearing elsewhere on the page', () => {
    document.body.innerHTML = '<div>Create image</div><p>image</p>';
    expect(hasToolPill()).toBe(false);
  });
});

describe('the adapter carries the same rule', () => {
  it('queries both shapes', () => {
    expect(SRC).toMatch(/button\.__composer-pill, \[data-inline-selection-pill\]/);
  });

  it('accepts both names', () => {
    expect(SRC).toMatch(/IMAGE_TOOL_NAMES = \['image', 'create image'\]/);
  });

  it('strips the affordance text before comparing', () => {
    /* aria-label is "Image, click to remove". Comparing it whole matches
       nothing, which is the same failure in a new coat. */
    expect(SRC).toMatch(/click to remove\$\/, ''\)/);
  });

  it('still clicks the menu entry by its own, unchanged name', () => {
    /* The entry is called "Create image" while the pill is called "Image".
       Renaming the click target to match the pill would break the click to
       fix the check. */
    expect(SRC).toMatch(/\/\^create image\/i\.test/);
  });
});
