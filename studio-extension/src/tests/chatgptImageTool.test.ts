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

/**
 * The image's shape.
 *
 * The Ratio dropdown on a ChatGPT image node changed nothing at all until
 * now: aspectRatio was in the config the whole time and the adapter had
 * nowhere to put it, so a node set to 9:16 produced whatever Auto decided —
 * usually square. Silent, because a square image is a perfectly good image
 * right up until it goes into a vertical video.
 *
 * The control appeared in the same redesign that moved the tool pill. Read
 * off the live page on 2026-08-17, with Create image selected:
 *
 *   <button aria-label="Choose image aspect ratio"><span>Auto</span></button>
 *
 * opening six role="menuitemradio" entries — Auto, "Square 1:1",
 * "Portrait 3:4", "Story 9:16", "Landscape 4:3", "Widescreen 16:9". Those five
 * are exactly the five an image node offers, so nothing is approximated.
 * Selecting one was confirmed on the page: the button relabels itself from
 * "Auto" to "9:16".
 */
describe('choosing the image ratio', () => {
  /** The option list as ChatGPT builds it. */
  function ratioMenu(current = 'Auto'): void {
    const labels = ['Square 1:1', 'Portrait 3:4', 'Story 9:16', 'Landscape 4:3', 'Widescreen 16:9'];
    document.body.innerHTML = `
      <div data-testid="composer-footer-actions">
        <button class="composer-btn" aria-label="Choose image aspect ratio"
                aria-expanded="true"><span>${current}</span></button>
      </div>
      <div role="menu">
        <div role="menuitemradio" aria-checked="true">Auto</div>
        ${labels.map((l) => `<div role="menuitemradio" aria-label="${l}" aria-checked="false">${l.replace(' ', '')}</div>`).join('')}
      </div>`;
  }

  /** The match, lifted from the adapter. */
  const optionFor = (want: string) =>
    Array.from(document.querySelectorAll('[role="menuitemradio"]'))
      .find((el) => (el.getAttribute('aria-label') || '').trim().endsWith(` ${want}`));

  it('finds every ratio an image node can ask for', () => {
    ratioMenu();
    for (const [want, label] of [
      ['1:1', 'Square 1:1'], ['3:4', 'Portrait 3:4'], ['9:16', 'Story 9:16'],
      ['4:3', 'Landscape 4:3'], ['16:9', 'Widescreen 16:9'],
    ]) {
      expect(optionFor(want)?.getAttribute('aria-label')).toBe(label);
    }
  });

  it('matches the label, not the run-together text', () => {
    /* The visible text is "Story9:16" — no space, name and ratio jammed
       together. Only the aria-label separates them, which is why 16:9 must
       not be found by searching for "9:16" anywhere in a string. */
    ratioMenu();
    expect(optionFor('9:16')?.getAttribute('aria-label')).toBe('Story 9:16');
    expect(optionFor('16:9')?.getAttribute('aria-label')).toBe('Widescreen 16:9');
  });

  it('asks for nothing when ChatGPT has no such ratio', () => {
    ratioMenu();
    expect(optionFor('2:3')).toBeUndefined();
  });
});

describe('the adapter applies it correctly', () => {
  it('opens the menu on pointerdown, which a click alone does not', () => {
    /* Measured: .click() leaves aria-expanded false and no menu appears. This
       is the same lesson as the "+" menu, one control along. */
    expect(SRC).toMatch(/for \(const type of \['pointerdown', 'pointerup'\]\)/);
  });

  it('reads the open state instead of toggling blind', () => {
    /* The same sequence closes an open menu. Firing it unconditionally made
       the second attempt in a run close what the first had opened. */
    expect(SRC).toMatch(/aria-expanded'\) !== 'true'/);
  });

  it('confirms by the button relabelling itself', () => {
    expect(SRC).toMatch(/button\(\)\?\.textContent \|\| ''\)\.trim\(\) === want/);
  });

  it('sets it only after the tool is on, since the control does not exist before', () => {
    const tool = SRC.indexOf("logLine('Create image tool selected')");
    const ratio = SRC.indexOf('await selectImageRatio(ratio)');
    expect(tool).toBeGreaterThan(-1);
    expect(ratio).toBeGreaterThan(tool);
  });

  it('reports a wrong shape without failing the node', () => {
    /* A 1:1 picture where 9:16 was asked for is wrong and still usable.
       Failing here would throw away a generation to punish a dropdown — but
       saying nothing is how nobody noticed the setting did nothing for
       months. */
    const block = SRC.slice(SRC.indexOf('const ratio = String(config?.aspectRatio'));
    expect(block.slice(0, 700)).toMatch(/logLine\(ratioProblem \|\|/);
    expect(block.slice(0, 700)).not.toMatch(/STUDIO_NODE_ERROR/);
  });
});
