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

import {
  findMediaTypeTab, labelText, findSettingsPanelTrigger, isSettingsPanelOpen,
} from '../content/flow/selectors';

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

describe('the Flow that is actually there — Angular Material in a CDK overlay', () => {
  /* Read off the live page. The settings trigger is:
   *
   *   <button matbutton flow-button aria-label="Settings trigger" cdkoverlayorigin
   *           class="mdc-button mat-mdc-button-base settings-trigger-button …">
   *     <span class="mdc-button__label">
   *       <span class="settings-summary"> Video · 720p · 10s
   *         <mat-icon class="mat-icon google-symbols">crop_16_9</mat-icon> x1
   *       </span></span></button>
   *
   * Two things follow, and both had been guessed wrong:
   *
   *   · It is Angular Material, not Radix and not styled-components. So the
   *     popover lives in `.cdk-overlay-container`, which Angular's CDK appends
   *     to <body> — and the sidebar does not.
   *   · The ratio is written `crop_16_9`, a Material ligature with underscores
   *     and no colon. An anchor matching only "16:9" missed the chip entirely.
   */

  const TRIGGER = `
    <button aria-label="Settings trigger" cdkoverlayorigin
            class="mdc-button mat-mdc-button-base settings-trigger-button">
      <span class="mdc-button__label">
        <span class="settings-summary"> Video · 720p · 10s
          <mat-icon class="mat-icon notranslate flow-icon-m google-symbols"
                    data-mat-icon-type="font">crop_16_9</mat-icon> x1
        </span></span></button>`;

  /** The popover, where Angular actually renders it. */
  const OVERLAY = `
    <div class="cdk-overlay-container">
      <div class="cdk-overlay-pane">
        <button id="matImage" class="mat-mdc-button-base">
          <mat-icon class="google-symbols">image</mat-icon>Image</button>
        <button id="matVideo" class="mat-mdc-button-base">
          <mat-icon class="google-symbols">videocam</mat-icon>Video</button>
        <button id="matFrames" class="mat-mdc-button-base">Frames</button>
      </div>
    </div>`;

  beforeEach(() => {
    document.body.innerHTML = SIDEBAR + TRIGGER + OVERLAY;
    boxAll();
    for (const el of Array.from(document.querySelectorAll('mat-icon'))) box(el, 20, 20);
  });

  it('finds the Image tab inside the CDK overlay', () => {
    expect((findMediaTypeTab('image') as HTMLElement)?.id).toBe('matImage');
  });

  it('finds the Video tab', () => {
    expect((findMediaTypeTab('video') as HTMLElement)?.id).toBe('matVideo');
  });

  it('takes the overlay over the sidebar even with no ratio in the overlay', () => {
    /* The scope settles it outright rather than inferring around it: the
       sidebar is never inside .cdk-overlay-container, so it cannot win. */
    expect(document.querySelector('.cdk-overlay-container')!.textContent)
      .not.toMatch(/16|9:/);
    expect((findMediaTypeTab('video') as HTMLElement)?.id).not.toBe('navVideos');
  });

  it('takes the button, not the pane that holds it', () => {
    const got = findMediaTypeTab('image') as HTMLElement;
    expect(got?.className).not.toContain('cdk-overlay');
  });

  it('reads the settings chip ratio, which is a ligature not a colon', () => {
    /* The anchor this file previously used would not have matched the chip:
       it wrote the ratio as crop_16_9, underscores and no colon. */
    const chip = document.querySelector('.settings-summary')!;
    expect(chip.textContent).toContain('crop_16_9');
    expect(chip.textContent).not.toContain('16:9');
  });

  it('still ignores the ligature when reading a label', () => {
    /* labelText strips icons so the chip reads "Video · 720p · 10s   x1" —
       otherwise the ligature would fuse onto its neighbour and the count
       token would stop being recognised. */
    const chip = document.querySelector('.settings-summary') as HTMLElement;
    expect(labelText(chip)).not.toContain('crop_16_9');
    expect(labelText(chip)).toContain('720p');
  });
});

describe('opening the popover that holds the tabs', () => {
  /* The tabs only exist while the popover is open — a CDK overlay is created
     on open and destroyed on close — so finding them was never the first
     problem. Two checks before it both failed on Angular Material, and each
     one alone is enough to stop the run:

       findSettingsPanelTrigger  wanted button[aria-haspopup="menu"]
       isSettingsPanelOpen       wanted aria-expanded or data-state

     The real chip has none of the three. So the trigger was never found, the
     panel was never opened, and the run reported the last step in the chain
     rather than the first. */

  const CHIP = `
    <button matbutton flow-button aria-label="Settings trigger" cdkoverlayorigin
            class="mdc-button mat-mdc-button-base settings-trigger-button">
      <span class="mdc-button__label">
        <span class="settings-summary"> Video · 720p · 10s
          <mat-icon class="mat-icon notranslate google-symbols">crop_16_9</mat-icon> x1
        </span></span></button>`;

  const OPEN_PANE = `
    <div class="cdk-overlay-container"><div class="cdk-overlay-pane">
      <button id="pImage"><mat-icon class="google-symbols">image</mat-icon>Image</button>
      <button id="pVideo"><mat-icon class="google-symbols">videocam</mat-icon>Video</button>
      <button id="p169">16:9</button>
    </div></div>`;

  const layout = (html: string) => {
    document.body.innerHTML = html;
    boxAll();
    for (const el of Array.from(document.querySelectorAll('mat-icon'))) box(el, 20, 20);
  };

  it('finds the chip that carries no aria-haspopup', () => {
    layout(CHIP);
    const trig = findSettingsPanelTrigger() as HTMLElement;
    expect(trig).not.toBeNull();
    expect(trig.getAttribute('aria-label')).toBe('Settings trigger');
  });

  it('finds it by the ratio icon, which already knew this shape', () => {
    /* crop_16_9 was always the structural test; it simply could not be
       reached behind the aria-haspopup filter. */
    layout(CHIP);
    const trig = findSettingsPanelTrigger() as HTMLElement;
    expect(trig.textContent).toContain('crop_16_9');
  });

  it('calls the panel closed when only the chip is on screen', () => {
    layout(CHIP);
    expect(isSettingsPanelOpen()).toBe(false);
  });

  it('calls it open when the CDK pane is up, though nothing says expanded', () => {
    /* The chip never gains aria-expanded. Reading only that reported "closed"
       while it was open, so the caller pressed the chip again and closed it —
       open, close, open, close, three times, then the error. */
    layout(CHIP + OPEN_PANE);
    const trig = findSettingsPanelTrigger() as HTMLElement;
    expect(trig.getAttribute('aria-expanded')).toBeNull();
    expect(isSettingsPanelOpen()).toBe(true);
  });

  it('does not count an unrelated overlay as the settings panel', () => {
    /* A toast or another menu is also a cdk-overlay-pane. Counting one would
       make the engine believe a panel it never opened was already open. */
    layout(`${CHIP}<div class="cdk-overlay-container">
      <div class="cdk-overlay-pane"><span>Copied to clipboard</span></div></div>`);
    expect(isSettingsPanelOpen()).toBe(false);
  });

  it('still reads aria-expanded when a Flow provides it', () => {
    layout(`<button aria-haspopup="menu" aria-expanded="true">
      <i class="google-symbols">crop_9_16</i>x1</button>`);
    expect(isSettingsPanelOpen()).toBe(true);
  });

  it('finds the tabs once the pane is open', () => {
    layout(CHIP + OPEN_PANE);
    expect((findMediaTypeTab('image') as HTMLElement)?.id).toBe('pImage');
    expect((findMediaTypeTab('video') as HTMLElement)?.id).toBe('pVideo');
  });
});
