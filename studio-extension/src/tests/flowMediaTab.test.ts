/**
 * @jest-environment jsdom
 */

/**
 * Switching Flow between Image and Video, on a Flow with no roles.
 *
 * The run stopped with:
 *
 *   Could not switch Flow to Image mode — stopped instead of generating the
 *   wrong media type.
 *
 * Stopping is right: everything downstream assumes the tab is correct, and
 * continuing is what once produced "video" nodes rendering images. But it
 * stopped because every tier of findMediaTypeTab needed role="tab", and the
 * Flow on flow.google.com has no roles on anything — the same thing that broke
 * the Upload button, which ships as styled-component classes and nothing else.
 *
 * ── Why text alone will not do ────────────────────────────────────────────
 *
 * The left sidebar carries Images and Vidéos library filters. They are
 * siblings of each other exactly like the real tabs, and they come EARLIER in
 * the document — so "first match wins" and "find the pair" both pick the
 * filter, and the engine clicks "show me videos" instead of "generate video".
 * That is the failure the original comment on this function was written about.
 *
 * What separates them is what else is in the box: the composer's settings
 * popover also holds the aspect ratios, and a navigation sidebar does not.
 */

/// <reference types="node" />

import * as fs from 'fs';
import * as path from 'path';

import { findMediaTypeTab } from '../content/flow/selectors';

const box = (el: Element, w = 90, h = 30): void => {
  (el as HTMLElement).getBoundingClientRect = () =>
    ({ width: w, height: h, left: 10, top: 200, right: 10 + w, bottom: 230 }) as DOMRect;
};
const boxAll = (): void => {
  for (const el of Array.from(document.querySelectorAll('button,div,span'))) box(el);
};

/** The sidebar, which comes first in the document and must never win. */
const SIDEBAR = `
  <nav id="sidebar">
    <button id="navAll">All media</button>
    <button id="navImages"><i class="google-symbols">image</i>Images</button>
    <button id="navVideos"><i class="google-symbols">videocam</i>Vidéos</button>
    <button id="navChars">Personnages</button>
    <button id="navScenes">Scènes</button>
  </nav>`;

/** The composer popover as the new Flow ships it: no role on anything. */
const POPOVER = `
  <div id="popover">
    <div id="modes">
      <button id="tabImage"><i class="google-symbols">image</i>Image</button>
      <button id="tabVideo"><i class="google-symbols">videocam</i>Video</button>
    </div>
    <div id="kinds">
      <button id="frames">Frames</button>
      <button id="ingredients">Ingredients</button>
    </div>
    <div id="ratios">
      <button id="r169">16:9</button>
      <button id="r916">9:16</button>
    </div>
    <div id="model">Omni 1.1 Flash</div>
  </div>`;

describe('the Flow that still has roles', () => {
  it('takes the Radix trigger id first, as it always did', () => {
    document.body.innerHTML = `
      <div role="tablist">
        <button role="tab" id="radix-r1-trigger-IMAGE">Image</button>
        <button role="tab" id="radix-r1-trigger-VIDEO">Video</button>
      </div>`;
    boxAll();
    for (const el of Array.from(document.querySelectorAll('button'))) box(el);
    expect((findMediaTypeTab('image') as HTMLElement)?.id).toBe('radix-r1-trigger-IMAGE');
    expect((findMediaTypeTab('video') as HTMLElement)?.id).toBe('radix-r1-trigger-VIDEO');
  });
});

describe('the Flow that has none', () => {
  beforeEach(() => {
    document.body.innerHTML = SIDEBAR + POPOVER;
    boxAll();
  });

  it('finds the Image tab that no selector could reach before', () => {
    expect((findMediaTypeTab('image') as HTMLElement)?.id).toBe('tabImage');
  });

  it('finds the Video tab', () => {
    expect((findMediaTypeTab('video') as HTMLElement)?.id).toBe('tabVideo');
  });

  it('never takes the sidebar filter, which comes first in the document', () => {
    /* The whole reason this function was written narrowly in the first place.
       Clicking it shows a library instead of changing what will be made. */
    const all = Array.from(document.querySelectorAll<HTMLElement>('button'));
    expect(all.indexOf(document.getElementById('navImages') as HTMLElement))
      .toBeLessThan(all.indexOf(document.getElementById('tabImage') as HTMLElement));
    expect((findMediaTypeTab('image') as HTMLElement)?.id).not.toBe('navImages');
    expect((findMediaTypeTab('video') as HTMLElement)?.id).not.toBe('navVideos');
  });

  it('takes the button, not the box that contains it', () => {
    /* #modes and #popover both have textContent carrying "Image", and both
       come before the button. An ancestor always matches everything its
       children match — the same trap the Videos tab fell into. */
    const got = findMediaTypeTab('image') as HTMLElement;
    expect(['modes', 'popover']).not.toContain(got?.id);
  });

  it('works in French, where the label is Vidéo', () => {
    document.getElementById('tabVideo')!.innerHTML =
      '<i class="google-symbols">videocam</i>Vidéo';
    boxAll();
    expect((findMediaTypeTab('video') as HTMLElement)?.id).toBe('tabVideo');
  });
});

describe('what it refuses to guess', () => {
  it('finds nothing when there is no ratio to anchor to', () => {
    /* A page with Image and Video text but no composer is not a composer.
       Returning null stops the run, which is the correct outcome: the caller
       refuses to generate the wrong media type rather than pressing on. */
    document.body.innerHTML = SIDEBAR;
    boxAll();
    expect(findMediaTypeTab('image')).toBeNull();
    expect(findMediaTypeTab('video')).toBeNull();
  });

  it('is not fooled by a timestamp that looks like a ratio', () => {
    /* "0:10" beside a clip length would qualify a sidebar holding no ratios,
       which is why the anchor is Flow's real ratios rather than any n:n. */
    document.body.innerHTML = `
      <nav id="sidebar">
        <button id="navImages">Images</button>
        <span id="len">0:10</span>
      </nav>`;
    boxAll();
    expect(findMediaTypeTab('image')).toBeNull();
  });

  it('ignores a hidden tab', () => {
    document.body.innerHTML = POPOVER;
    boxAll();
    (document.getElementById('tabImage') as HTMLElement).getBoundingClientRect =
      () => ({ width: 0, height: 0, left: 0, top: 0, right: 0, bottom: 0 }) as DOMRect;
    expect((findMediaTypeTab('image') as HTMLElement)?.id).not.toBe('tabImage');
  });

  it('has no stray control characters in its anchor', () => {
    /* Written twice with a literal backspace where \b was meant, which
       compiles, runs, and matches nothing at all. */
    const src = fs.readFileSync(
      path.resolve(__dirname, '../content/flow/selectors.ts'), 'utf8',
    );
    // eslint-disable-next-line no-control-regex
    expect(src).not.toMatch(/[\x00-\x08\x0b\x0c\x0e-\x1f]/);
  });
});
