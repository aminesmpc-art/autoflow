/**
 * @jest-environment jsdom
 */

/**
 * The three controls that look alike, and the two "Videos" that are not the
 * same Videos.
 *
 * ── Everything below was READ off flow.google.com, not assumed ────────────
 *
 * Three buttons on a project page render as the bare ligature `add`:
 *
 *   aria="Add media menu"                     w=40
 *     < div.tools-button-group < div.tools-container < flow-tile-view-header
 *
 *   aria="Ingredient"                         w=40
 *     < flow-image-ingredient-chip < flow-ingredient-chip
 *     < div.ingredients-list < flow-batch-info        ← a PAST generation
 *
 *   aria="Add ingredients to the prompt box"  w=32    ← the only one that works
 *     < div.add-menu-container < flow-add-menu < div.bottom-controls
 *     < div.base-prompt-box < flow-base-prompt-box
 *
 * A previous version of composerAddButton looked for the third inside
 * `flow-ingredient-bar`/`.ingredients-list`. It is not there. So the function
 * returned null on every page: the readiness wait burned its whole budget and
 * then pressed the toolbar's button instead — a different control opening a
 * different thing. That is the regression this file exists to prevent.
 *
 * Pressing the real one was verified live. It opens:
 *
 *   div.cdk-overlay-pane        (no role="dialog")
 *     mat-list-item[role=tab]   dashboardAll
 *     mat-list-item[role=tab]   imageImages
 *     mat-list-item[role=tab]   videocamVideos          ← the tab we want
 *     mat-list-item[role=tab]   drive_folder_uploadUploads
 *     button                    uploadUpload media
 *     input.search-input        placeholder "Search assets"
 *     button.asset-item[role=option]  "make it danceVideo"
 *
 * And the project's LEFT RAIL carries its own `mat-list-item` reading
 * "videocam Videos". Identical markup, identical text — nothing about the
 * element separates them. Pressing the rail's navigates the project to its
 * Videos listing, which from the outside looks exactly like "the dialog did
 * not open". Only where it sits tells them apart.
 */

/// <reference types="node" />

import {
  flowUiPresent, waitForFlowUi, composerAddButton, mediaMenuButton, videosTab,
} from '../content/flow/libraryPicker';

function box(el: Element, w = 40): void {
  (el as HTMLElement).getBoundingClientRect = () =>
    ({ width: w, height: 40, left: 10, top: 700, right: 10 + w, bottom: 740 }) as DOMRect;
}
function boxAll(): void {
  for (const el of Array.from(document.querySelectorAll('*'))) box(el);
}

/** The project toolbar. Present from the moment the frame paints. */
const TOOLBAR = `
  <button id="ours">⚡ Open Studio</button>
  <flow-tile-view-header><header class="header-base"><div class="tools-container">
    <div class="tools-button-group">
      <button id="addmedia" aria-label="Add media menu"><i class="google-symbols">add</i></button>
      <button id="help" aria-label="Product help"><i class="google-symbols">help</i></button>
    </div>
  </div></header></flow-tile-view-header>`;

/** The project's left rail — it has a "Videos" of its own. */
const RAIL = `
  <mat-drawer><div class="mat-drawer-inner-container">
    <mat-list-item id="rail-all" role="tab"><mat-icon class="google-symbols">dashboard</mat-icon> All media</mat-list-item>
    <mat-list-item id="rail-videos" role="tab"><mat-icon class="google-symbols">videocam</mat-icon> Videos</mat-list-item>
  </div></mat-drawer>`;

/** A finished batch, carrying its own ingredient chips and its own + slots. */
const BATCH = `
  <div class="batch-container"><flow-batch-info><div class="below-toolbar">
    <div class="ingredients-list">
      <flow-ingredient-chip><flow-image-ingredient-chip>
        <button id="batch-chip" class="chip-container" aria-label="Ingredient"><i class="google-symbols">add</i></button>
      </flow-image-ingredient-chip></flow-ingredient-chip>
      <flow-ingredient-chip><flow-video-ingredient-chip>
        <button class="chip-container" aria-label="Ingredient" aria-busy="false">
          <video class="chip-video" src="https://flow-content.google/video/abc?Signature=x"></video>
          <mat-icon id="chip-badge" class="type-badge google-symbols">videocam</mat-icon>
        </button>
      </flow-video-ingredient-chip></flow-ingredient-chip>
    </div>
  </div></flow-batch-info></div>`;

/** The composer, with its add-menu trigger where it actually lives. */
const COMPOSER = `
  <flow-base-prompt-box><div class="base-prompt-box"><div class="bottom-controls">
    <flow-add-menu><div class="add-menu-container">
      <button id="composer-plus" aria-label="Add ingredients to the prompt box"><i class="google-symbols">add</i></button>
    </div></flow-add-menu>
  </div></div></flow-base-prompt-box>`;

/** What that + opens, verified live: an overlay with no dialog role. */
const PICKER = `
  <div class="cdk-overlay-pane">
    <mat-list-item id="pick-all" role="tab"><mat-icon class="google-symbols">dashboard</mat-icon>All</mat-list-item>
    <mat-list-item id="pick-images" role="tab"><mat-icon class="google-symbols">image</mat-icon>Images</mat-list-item>
    <mat-list-item id="pick-videos" role="tab"><mat-icon class="google-symbols">videocam</mat-icon>Videos</mat-list-item>
    <mat-list-item id="pick-uploads" role="tab"><mat-icon class="google-symbols">drive_folder_upload</mat-icon>Uploads</mat-list-item>
    <button id="pick-upload"><i class="google-symbols">upload</i>Upload media</button>
    <input class="search-input" aria-label="Search assets" placeholder="Search assets" />
  </div>`;

const PROJECT = TOOLBAR + RAIL + BATCH + COMPOSER;

describe('the three add buttons are not interchangeable', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('finds the composer + where it actually lives', () => {
    /* The regression: it was looked for in the ingredient bar, and it has
       never been there. */
    document.body.innerHTML = PROJECT;
    boxAll();
    expect(composerAddButton(document)?.id).toBe('composer-plus');
  });

  it('is not the toolbar button and not a batch chip', () => {
    document.body.innerHTML = PROJECT;
    boxAll();
    const got = composerAddButton(document);
    expect(got?.id).not.toBe('addmedia');
    expect(got?.id).not.toBe('batch-chip');
  });

  it('finds nothing when the composer has not painted', () => {
    /* A reloaded tab. The toolbar is up, the composer is not — and this is
       what the readiness wait must keep waiting for. */
    document.body.innerHTML = TOOLBAR + RAIL + BATCH;
    boxAll();
    expect(composerAddButton(document)).toBeNull();
  });

  it('finds the toolbar entry by its aria-label, which is all it has', () => {
    document.body.innerHTML = TOOLBAR;
    boxAll();
    expect(document.getElementById('addmedia')!.textContent!.trim()).toBe('add');
    expect(mediaMenuButton(document)?.id).toBe('addmedia');
  });
});

describe('a toolbar is not a painted page', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('keeps waiting when only the toolbar is up', async () => {
    document.body.innerHTML = TOOLBAR + RAIL + BATCH;
    boxAll();
    const said: string[] = [];
    const ok = await waitForFlowUi({ doc: document, uiWaitMs: 500, log: (l) => said.push(l) });
    expect(said.join(' ')).toMatch(/has not painted its composer yet/);
    /* Still proceeds — the Add-media menu is a real route — but only after
       giving the composer its chance, and it says which one it took. */
    expect(ok).toBe(true);
    expect(said.join(' ')).toMatch(/going in through the project Add-media menu/);
  });

  it('returns the moment the composer arrives', async () => {
    document.body.innerHTML = TOOLBAR + RAIL + BATCH;
    boxAll();
    setTimeout(() => {
      document.body.insertAdjacentHTML('beforeend', COMPOSER);
      boxAll();
    }, 400);
    const said: string[] = [];
    const ok = await waitForFlowUi({ doc: document, uiWaitMs: 5000, log: (l) => said.push(l) });
    expect(ok).toBe(true);
    expect(said.join(' ')).toMatch(/composer appeared after/);
  });

  it('is ready at once on a page that already has a composer', async () => {
    document.body.innerHTML = PROJECT;
    boxAll();
    const said: string[] = [];
    expect(await waitForFlowUi({ doc: document, uiWaitMs: 5000, log: (l) => said.push(l) })).toBe(true);
    expect(said).toEqual([]);          // no waiting, nothing to report
  });

  it('says no when the page is genuinely empty', async () => {
    document.body.innerHTML = '<button id="ours">⚡ Open Studio</button>';
    boxAll();
    expect(flowUiPresent(document)).toBe(false);
    expect(await waitForFlowUi({ doc: document, uiWaitMs: 60 })).toBe(false);
  });
});

describe('two Videos on one page, and only one of them is the tab', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('takes the picker tab, never the left rail', () => {
    /* Identical markup, identical text. Pressing the rail navigates the
       project away instead of switching the tab, which reads from outside as
       "the dialog did not open". */
    document.body.innerHTML = PROJECT + PICKER;
    boxAll();
    expect(document.getElementById('rail-videos')).not.toBeNull();
    expect(videosTab(document)?.id).toBe('pick-videos');
  });

  it('finds no tab at all when the picker is shut', () => {
    /* The rail and the chip badge are both still on the page. Neither is a
       tab, and answering with one is how a run came to click an icon. */
    document.body.innerHTML = PROJECT;
    boxAll();
    expect(document.getElementById('chip-badge')).not.toBeNull();
    expect(videosTab(document)).toBeNull();
  });

  it('treats an open picker as proof Flow is ready', () => {
    document.body.innerHTML = PICKER;
    boxAll();
    expect(flowUiPresent(document)).toBe(true);
  });
});
