/**
 * @jest-environment jsdom
 */

/**
 * Two overlays, one Upload button each, and only one of them is the picker.
 *
 * ── Read off flow.google.com, 9 Sep 2026 ──────────────────────────────────
 *
 * Pressing the project toolbar's `aria="Add media menu"` opens:
 *
 *   div.cdk-overlay-pane
 *     "uploadUpload · folderNew collection · account_circleCreate character
 *      · play_moviesNew scene"
 *     hasSearch: false   tabs: 0
 *
 * Pressing the composer's `aria="Add ingredients to the prompt box"` opens:
 *
 *   div.cdk-overlay-pane > flow-add-menu-popover-content
 *     > .add-menu-popover-container.flow-menu-panel > .panels-layout
 *       > flow-add-menu-side-nav > mat-nav-list > mat-list-item   (7 tabs)
 *       > .right-panel > header.search-header > input.search-input
 *     assets: button.asset-item[role=option] → "Motion-Control-1-part1-of-2Video"
 *
 * Both contain a control whose ligature is `upload`, so uploadButtons() matches
 * both — correctly; both raise a file chooser. But openMediaDialog used that as
 * its whole test for success, and a revision that tried the toolbar route FIRST
 * therefore reported success on the four-item menu. The attach that followed
 * then said, truthfully and uselessly:
 *
 *   18:54:19  no Videos tab in the dialog — searching whatever tab is showing
 *   18:54:19  ERROR: … the picker is open but has no search box in it
 *
 * Neither a tab nor a search box was there. It was not the picker.
 */

/// <reference types="node" />

import * as fs from 'fs';
import * as path from 'path';

import {
  assetPickerPane, mediaDialogOpen, mediaDialogRoot, openMediaDialog, videosTab,
} from '../content/flow/libraryPicker';

const read = (rel: string) =>
  fs.readFileSync(path.resolve(__dirname, rel), 'utf8').replace(/\r\n/g, '\n');

function box(el: Element, w = 40): void {
  (el as HTMLElement).getBoundingClientRect = () =>
    ({ width: w, height: 40, left: 10, top: 700, right: 10 + w, bottom: 740 }) as DOMRect;
}
function boxAll(): void {
  for (const el of Array.from(document.querySelectorAll('*'))) box(el);
}

/** The composer, with its add-menu trigger where it really lives. */
const COMPOSER = `
  <flow-base-prompt-box><div class="base-prompt-box"><div class="bottom-controls">
    <flow-add-menu><div class="add-menu-container">
      <button id="composer-plus" aria-label="Add ingredients to the prompt box"><i class="google-symbols">add</i></button>
    </div></flow-add-menu>
  </div></div></flow-base-prompt-box>`;

/** The project toolbar. */
const TOOLBAR = `
  <flow-tile-view-header><div class="tools-container"><div class="tools-button-group">
    <button id="addmedia" aria-label="Add media menu"><i class="google-symbols">add</i></button>
  </div></div></flow-tile-view-header>`;

/** What the TOOLBAR button opens. Four items, one of them Upload. */
const TOOLBAR_MENU = `
  <div class="cdk-overlay-pane" id="menu-pane">
    <button id="menu-upload"><i class="google-symbols">upload</i>Upload</button>
    <button><i class="google-symbols">folder</i>New collection</button>
    <button><i class="google-symbols">account_circle</i>Create character</button>
    <button><i class="google-symbols">play_movies</i>New scene</button>
  </div>`;

/** What the COMPOSER button opens. The real picker. */
const PICKER = `
  <div class="cdk-overlay-pane" id="picker-pane"><flow-add-menu-popover-content>
    <div class="add-menu-popover-container flow-menu-panel"><div class="panels-layout">
      <flow-add-menu-side-nav><mat-nav-list>
        <mat-list-item id="pick-all" role="tab"><mat-icon class="google-symbols">dashboard</mat-icon>All</mat-list-item>
        <mat-list-item id="pick-images" role="tab"><mat-icon class="google-symbols">image</mat-icon>Images</mat-list-item>
        <mat-list-item id="pick-videos" role="tab"><mat-icon class="google-symbols">videocam</mat-icon>Videos</mat-list-item>
        <mat-list-item id="pick-uploads" role="tab"><mat-icon class="google-symbols">drive_folder_upload</mat-icon>Uploads</mat-list-item>
      </mat-nav-list></flow-add-menu-side-nav>
      <div class="right-panel">
        <header class="search-header"><div class="search-input-container">
          <input class="search-input" aria-label="Search assets" placeholder="Search assets" />
        </div></header>
        <button class="asset-item" role="option">Motion-Control-1-part1-of-2Video</button>
        <button class="asset-item" role="option">Motion-Control-1-part2-of-2Video</button>
      </div>
      <button id="pick-upload"><i class="google-symbols">upload</i>Upload media</button>
    </div></div>
  </flow-add-menu-popover-content></div>`;

describe('the toolbar menu is not the asset picker', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('both have an Upload control, which is why that test was not enough', () => {
    document.body.innerHTML = TOOLBAR_MENU;
    boxAll();
    /* True and unhelpful: it does open a file chooser. */
    expect(mediaDialogOpen(document, 'upload')).toBe(true);
    expect(mediaDialogOpen(document, 'library')).toBe(false);
    expect(assetPickerPane(document)).toBeNull();
  });

  it('recognises the picker by its own component names', () => {
    document.body.innerHTML = PICKER;
    boxAll();
    expect(assetPickerPane(document)?.id).toBe('picker-pane');
    expect(mediaDialogOpen(document, 'library')).toBe(true);
  });

  it('picks the picker when BOTH overlays are up, whatever the order', () => {
    /* querySelector('.cdk-overlay-pane') takes the first in the DOM. With the
       toolbar menu open too, that is the wrong one — and it was chosen. */
    document.body.innerHTML = TOOLBAR_MENU + PICKER;
    boxAll();
    expect(document.querySelector('.cdk-overlay-pane')!.id).toBe('menu-pane');
    expect(assetPickerPane(document)?.id).toBe('picker-pane');
    expect(mediaDialogRoot(document)?.id).toBe('picker-pane');
    expect(videosTab(document)?.id).toBe('pick-videos');
  });

  it('falls back to search-box-and-tabs when the components are renamed', () => {
    document.body.innerHTML = PICKER.replace(/flow-add-menu-popover-content/g, 'div')
      .replace(/add-menu-popover-container flow-menu-panel/, 'x')
      .replace(/flow-add-menu-side-nav/g, 'div');
    boxAll();
    expect(assetPickerPane(document)?.id).toBe('picker-pane');
  });
});

describe('which route openMediaDialog takes', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  /** Wire each button to the overlay it really opens. */
  function wire(): void {
    document.getElementById('composer-plus')!.addEventListener('click', () => {
      document.body.insertAdjacentHTML('beforeend', PICKER);
      boxAll();
    });
    document.getElementById('addmedia')!.addEventListener('click', () => {
      document.body.insertAdjacentHTML('beforeend', TOOLBAR_MENU);
      boxAll();
    });
  }

  it('presses the composer + first, and never opens the toolbar menu', async () => {
    document.body.innerHTML = TOOLBAR + COMPOSER;
    boxAll();
    wire();
    const got = await openMediaDialog({ doc: document, step: 0, need: 'library' });
    expect(got.ok).toBe(true);
    expect(document.getElementById('picker-pane')).not.toBeNull();
    expect(document.getElementById('menu-pane')).toBeNull();
  });

  it('refuses to call the toolbar menu a library', async () => {
    /* No composer on the page — the only route left is the toolbar's, and for
       an attach that is not good enough. Saying so beats searching a menu. */
    document.body.innerHTML = TOOLBAR;
    boxAll();
    document.getElementById('addmedia')!.addEventListener('click', () => {
      document.body.insertAdjacentHTML('beforeend', TOOLBAR_MENU);
      boxAll();
    });
    const got = await openMediaDialog({ doc: document, step: 0, uiWaitMs: 60, need: 'library' });
    expect(got.ok).toBe(false);
    expect((got as any).reason).toMatch(/asset picker did not open/);
  });

  it('still accepts the toolbar menu for an upload, which only needs a chooser', async () => {
    document.body.innerHTML = TOOLBAR;
    boxAll();
    document.getElementById('addmedia')!.addEventListener('click', () => {
      document.body.insertAdjacentHTML('beforeend', TOOLBAR_MENU);
      boxAll();
    });
    const got = await openMediaDialog({ doc: document, step: 0, uiWaitMs: 60, need: 'upload' });
    expect(got.ok).toBe(true);
  });

  it('does nothing when the picker is already open', async () => {
    document.body.innerHTML = TOOLBAR + COMPOSER + PICKER;
    boxAll();
    let pressed = 0;
    for (const id of ['composer-plus', 'addmedia']) {
      document.getElementById(id)!.addEventListener('click', () => { pressed++; });
    }
    expect((await openMediaDialog({ doc: document, step: 0, need: 'library' })).ok).toBe(true);
    expect(pressed).toBe(0);
  });
});

describe('the name searched for is the name Flow actually has', () => {
  const UPLOAD = read('../background/debugUpload.ts');
  const RUNNER = read('../studio/engine/WorkflowRunner.ts');

  it('reports what Chrome wrote, not what was asked for', () => {
    /* onDeterminingFilename can miss — an MV3 worker may restart between the
       download starting and the event firing — and Chrome then uses its own
       localised default. A French profile produced "téléchargement (7)" and
       "(8)" while every attach searched for "Motion-Control-1-part1-of-2". */
    expect(UPLOAD).toMatch(/names\?: string\[\]/);
    expect(UPLOAD).toMatch(/return \{ path, downloadId, name: got \|\| filename \}/);
    expect(UPLOAD).toMatch(/names: saved\.map\(\(f\) => f\.name\)/);
  });

  it('the Motion node searches under that name', () => {
    const at = RUNNER.indexOf('private async executeMotionNode');
    const body = RUNNER.slice(at, at + 22000);
    expect(body).toMatch(/const savedAs: string\[\] = Array\.isArray\(upload\.names\)/);
    expect(body).toMatch(/row\.filename = actual;/);
  });

  it('says so in the log rather than renaming behind the run', () => {
    const at = RUNNER.indexOf('private async executeMotionNode');
    expect(RUNNER.slice(at, at + 22000))
      .toMatch(/Chrome saved piece \$\{row\.index\} as/);
  });
});
