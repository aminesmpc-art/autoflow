/**
 * @jest-environment jsdom
 *
 * Finding which tile belongs to this node, on the Flow that exists now.
 *
 * From a live run, repeating every ten seconds while the clip sat finished in
 * the tab beside it:
 *
 *   14:35:08  Tile not in DOM yet (wait=40s)...
 *   14:35:10  Tile (no id yet) is not in the page after 42s — but Flow's API
 *             says it is finished — scrolling the output to the top, where
 *             the newest tile is
 *   14:35:20  Tile not in DOM yet (wait=50s)...
 *
 * "(no id yet)" is the whole story. The API side was working — it knew the
 * generation had finished — and the DOM side could not say which tile was
 * this node's, so the poller scrolled, looked again, and waited out its
 * timeout on work that was done.
 *
 * readGenerationRows walked up from each prompt looking for an ancestor
 * holding `[data-tile-id]`. That attribute does not exist anywhere on this
 * Flow, so every row was skipped and the function returned an empty list on
 * every call. findRowForPrompt therefore never matched anything, and nothing
 * failed loudly enough to say so.
 *
 * The shape it has to read instead:
 *
 *   div.batch-container
 *     ├── div.batch-tiles-section   → flow-video-tile / flow-image-tile
 *     └── flow-batch-info           → flow-expandable-prompt (the prompt)
 *                                     button.reuse-prompt-button
 */

/// <reference types="node" />

import { readFileSync } from 'fs';
import { join } from 'path';
import { readGenerationRows, findRowForPrompt } from '../content/flow/selectors';

/** Line endings normalised: this tree is CRLF and the patterns are not. */
const readSrcFile = (rel: string) =>
  readFileSync(join(__dirname, rel), 'utf8').replace(/\r\n/g, '\n');

const PROMPT = 'Slow cinematic push-in toward the product on a dark stone plinth, '
  + 'a soft key light travelling across its surface as dust drifts in the beam';

/** One batch as this Flow renders it. */
const batch = (prompt: string, mediaId = 'c4b5e39e-92f3-48b4-ac6f-13a4dbbb120f') => `
  <div class="batch-container virtual-item-container">
    <div class="batch-tiles-section">
      <div class="tile-row">
        <flow-grid-tile-container aria-label="Product on plinth">
          <flow-video-tile>
            <div class="container">
              <img class="image" data-media-id="${mediaId}"
                   src="https://flow-content.google/image/${mediaId}?Signature=x">
            </div>
          </flow-video-tile>
        </flow-grid-tile-container>
      </div>
    </div>
    <flow-batch-info>
      <div class="batch-toolbar">
        <button aria-label="Download batch"><mat-icon>download</mat-icon></button>
      </div>
      <div class="below-toolbar">
        <flow-expandable-prompt class="prompt inline">
          <div class="expandable-prompt-container">
            <div class="prompt-text"><span class="text-part">${prompt}</span></div>
            <div class="prompt-actions">
              <button class="action-button reuse-prompt-button" aria-label="Reuse prompt">
                <mat-icon>keyboard_return</mat-icon>
              </button>
            </div>
          </div>
        </flow-expandable-prompt>
        <div class="metadata">
          <div class="metadata-row"> Created Sep 6, 2026 </div>
          <div class="metadata-row"><span>Omni 1.1 Flash</span><span>720p</span><span>8s</span><span>9:16</span></div>
        </div>
      </div>
    </flow-batch-info>
  </div>`;

describe('reading the rows off the page', () => {
  it('finds one at all', () => {
    /* It returned an empty list on every call, which is why the poller could
       never name the tile it was waiting for. */
    document.body.innerHTML = batch(PROMPT);
    expect(readGenerationRows()).toHaveLength(1);
  });

  it('reads the prompt out of the batch info', () => {
    document.body.innerHTML = batch(PROMPT);
    expect(readGenerationRows()[0].prompt).toContain('Slow cinematic push-in');
  });

  it('gives the tile an identity from the media the page states', () => {
    document.body.innerHTML = batch(PROMPT);
    expect(readGenerationRows()[0].tileId).toBe('c4b5e39e-92f3-48b4-ac6f-13a4dbbb120f');
  });

  it('falls back to the token in the media URL', () => {
    /* A video tile carries no data-media-id; the /asb/ token in its src is
       part of what the framework re-renders, so it survives recycling. */
    document.body.innerHTML = `
      <div class="batch-container">
        <div class="batch-tiles-section"><flow-video-tile><div class="container">
          <img class="image" src="https://flow.google.com/asb/AB-nOUYy_bMOxK9wQ=s512-rw">
        </div></flow-video-tile></div>
        <flow-batch-info><div class="below-toolbar"><flow-expandable-prompt>
          <div class="expandable-prompt-container">
            <div class="prompt-text"><span class="text-part">${PROMPT}</span></div>
            <div class="prompt-actions">
              <button class="reuse-prompt-button" aria-label="Reuse prompt"></button>
            </div>
          </div>
        </flow-expandable-prompt></div></flow-batch-info>
      </div>`;
    expect(readGenerationRows()[0].tileId).toBe('AB-nOUYy_bMOxK9wQ');
  });

  it('hands back the tile, not the batch around it', () => {
    /* The container also holds the prompt, and tile state is decided by
       scanning text for "violate", "blocked" and the like — so a prompt
       carrying one of those words would read as a failed generation. */
    document.body.innerHTML = batch(PROMPT);
    expect(readGenerationRows()[0].element.tagName.toLowerCase()).toBe('flow-video-tile');
  });

  it('does not let a prompt full of refusal words reach the state check', () => {
    const nasty = 'A blocked road at night, the driver violates the barrier and '
      + 'the camera cannot generate enough light to see past it';
    document.body.innerHTML = batch(nasty);
    const el = readGenerationRows()[0].element;
    expect((el.textContent || '')).not.toContain('violates');
  });

  it('still reads the model from the metadata line', () => {
    document.body.innerHTML = batch(PROMPT);
    expect(readGenerationRows()[0].model).toMatch(/Omni 1\.1 Flash/);
  });
});

describe('matching a row to this node prompt', () => {
  it('matches the prompt that made it', () => {
    document.body.innerHTML = batch(PROMPT);
    expect(findRowForPrompt(PROMPT)).not.toBeNull();
  });

  it('does not match a different shot', () => {
    document.body.innerHTML = batch(PROMPT);
    expect(findRowForPrompt(
      'A completely different scene: a wide desert at noon with a lone figure walking away'
    )).toBeNull();
  });

  it('takes the newest when one prompt was run twice', () => {
    /* Otherwise a re-run is handed the previous run's clip — green, plausible
       and the wrong video. */
    document.body.innerHTML = batch(PROMPT, 'aaaa1111-2222-3333-4444-555566667777')
      + batch(PROMPT, 'bbbb1111-2222-3333-4444-555566667777');
    expect(findRowForPrompt(PROMPT)!.tileId).toBe('bbbb1111-2222-3333-4444-555566667777');
  });

  it('refuses a prompt too short to identify anything', () => {
    document.body.innerHTML = batch(PROMPT);
    expect(findRowForPrompt('a cat')).toBeNull();
  });
});

/**
 * The tile as it really came back from the failing run.
 *
 * Copied from the page, not written from memory, and it differs from the
 * fixture above in two ways that both matter:
 *
 *   the thumbnail is <img class="thumbnail"> with NO data-media-id, so the
 *   identity has to come from the token in its URL
 *
 *   the interface is in French — "Réutiliser le prompt", "Télécharger le
 *   lot", "Ingrédient" — so anything keyed on English wording is already
 *   broken for this user
 *
 * The class on the reuse button survives translation, which is why the rows
 * are found through it rather than through its label.
 */
const REAL_TILE = `
<div class="batch-container virtual-item-container">
  <div class="batch-tiles-section"><div class="tile-row">
    <flow-grid-tile-container aria-label="Hand placing sneaker on pedestal">
      <flow-tile-container><div class="container">
        <flow-video-tile><div class="container">
          <img draggable="false" alt="Miniature de la vidéo générée" class="thumbnail"
               src="https://flow-content.google/image/1f7d770e-4630-4389-a632-a4fd68ea6c0b?Expires=1788723406&amp;Signature=YcvMHvji">
          <div class="pre-hover-overlay"><div class="type-icon-container">
            <mat-icon>play_circle</mat-icon></div></div>
          <div class="footer-overlay-has-progress-bar"><flow-tile-hover-footer>
            <div class="footer-left"><mat-icon>play_circle</mat-icon>
              <span class="footer-title">Hand placing sneaker on pedestal</span></div>
          </flow-tile-hover-footer></div>
        </div></flow-video-tile>
      </div></flow-tile-container>
    </flow-grid-tile-container>
  </div></div>
  <flow-batch-info>
    <div class="batch-toolbar">
      <button aria-label="Télécharger le lot"><mat-icon>download</mat-icon></button>
      <button aria-label="Réutiliser le prompt"><mat-icon>undo</mat-icon></button>
      <button aria-label="Placer le lot dans la corbeille"><mat-icon>delete</mat-icon></button>
    </div>
    <div class="below-toolbar">
      <flow-expandable-prompt class="prompt inline">
        <div class="expandable-prompt-container">
          <div class="prompt-text"><span class="text-part">The scene opens on a bare obsidian plinth and unadorned black granite pedestal in an unlit commercial studio with plain matte charcoal backdrops, completely empty without shoes, without styling props, without human hands, and without studio illumination, resting in quiet darkness.</span></div>
          <div class="prompt-actions">
            <button class="mdc-icon-button action-button reuse-prompt-button" aria-label="Réutiliser le prompt"><mat-icon>keyboard_return</mat-icon></button>
            <button class="mdc-icon-button action-button expand-button" aria-label="Développer le prompt"><mat-icon>keyboard_arrow_down</mat-icon></button>
          </div>
        </div>
      </flow-expandable-prompt>
      <div class="ingredients-list"><flow-ingredient-chip><flow-image-ingredient-chip>
        <button class="chip-container" aria-label="Ingrédient" aria-busy="false">
          <div class="chip-image-wrapper"><img class="chip-image"
            src="https://flow-content.google/image/60e07f78-bbff-4e95-96b7-a80fd60b27d1?Signature=Ir9emm"></div>
        </button>
      </flow-image-ingredient-chip></flow-ingredient-chip></div>
      <div class="metadata">
        <div class="metadata-row"> Date de création&nbsp;: 6 sept. 2026 </div>
        <div class="metadata-row"><span>Omni 1.1 Flash</span><span>•</span><span>720p</span><span>•</span><span>8&nbsp;s</span><mat-icon>crop_9_16</mat-icon><span>9:16</span></div>
      </div>
    </div>
  </flow-batch-info>
</div>`;

const REAL_PROMPT = 'The scene opens on a bare obsidian plinth and unadorned black granite '
  + 'pedestal in an unlit commercial studio with plain matte charcoal backdrops, completely '
  + 'empty without shoes, without styling props, without human hands, and without studio '
  + 'illumination, resting in quiet darkness.';

describe('the tile from the run that hung', () => {
  beforeEach(() => { document.body.innerHTML = REAL_TILE; });

  it('is found', () => {
    /* This is the case that printed "(no id yet)" every ten seconds while the
       clip sat finished. */
    expect(readGenerationRows()).toHaveLength(1);
  });

  it('gets its identity from the URL, having no data-media-id', () => {
    expect(readGenerationRows()[0].tileId).toBe('1f7d770e-4630-4389-a632-a4fd68ea6c0b');
  });

  it('is matched to the prompt that made it', () => {
    expect(findRowForPrompt(REAL_PROMPT)).not.toBeNull();
  });

  it('works with the interface in French', () => {
    /* Nothing in this path reads a label. The reuse button keeps its class
       whatever the language, which is why it is the anchor. */
    expect(REAL_TILE).toContain('Réutiliser le prompt');
    expect(readGenerationRows()[0].prompt).toContain('obsidian plinth');
  });

  it('does not mistake the ingredient chip for the tile', () => {
    /* The batch carries a reference image of its own, on the same signed
       host. Taking that as the generation would hand the run its own input
       back as the result. */
    expect(readGenerationRows()[0].tileId).not.toBe('60e07f78-bbff-4e95-96b7-a80fd60b27d1');
  });

  it('hands back the tile, so the prompt is out of state detection', () => {
    const el = readGenerationRows()[0].element;
    expect(el.tagName.toLowerCase()).toBe('flow-video-tile');
    expect(el.textContent || '').not.toContain('obsidian');
  });
});

/**
 * How long an image node waits to notice its own still.
 *
 * "the image is not have api checks ok so only the dom" — right, and that is
 * what made the delay hurt. A video node has the service to fall back on; an
 * image node has the page and nothing else.
 *
 * The tile was looked up by name only after `wait > 45`. Before that the
 * poller relied on catching a card in the `generating` state, and if it never
 * saw one — a still that rendered between two polls, or one whose generating
 * state this build does not recognise — it simply waited out the 45 seconds
 * on an image that was already sitting on screen.
 *
 * That wait was a hedge, not a rule. The fallback it guarded took the newest
 * card blindly, so a re-run of the same prompt would be handed the previous
 * run's result. Snapshotting the rows that existed BEFORE the node started
 * answers that properly: a matching row that is not in the snapshot is this
 * node's own work, whatever second it is.
 */
describe('noticing a still without waiting out a timer', () => {
  const SRC = readSrcFile('../content/flow/index.ts');

  it('remembers which rows were already there', () => {
    expect(SRC).toMatch(/const rowsBefore = new Set\(readGenerationRows\(\)/);
  });

  it('looks the tile up by name without a 45-second gate', () => {
    expect(SRC).not.toMatch(/else if \(wait > 45 && allCards\.length > 0\)/);
    expect(SRC).toMatch(/else if \(allCards\.length > 0\)/);
  });

  it('accepts only a row that was not on the page before', () => {
    /* The whole reason the gate existed: a re-run of the same prompt must not
       be handed the earlier run's asset. */
    expect(SRC).toMatch(/!rowsBefore\.has\(mine\.tileId\)/);
  });

  it('relaxes that once it has waited as long as it used to', () => {
    /* Past the old mark, a stale match beats nothing — and by then anything
       still matching is almost certainly this node's. */
    expect(SRC).toMatch(/!rowsBefore\.has\(mine\.tileId\) \|\| wait > 45/);
  });

  it('still says so when the generation never appeared at all', () => {
    /* Only when nothing matched — otherwise a tile found on second 2 would
       trip the "never appeared" error at second 75. */
    expect(SRC).toMatch(/else if \(!mine && wait > 75\)/);
  });
});

/**
 * The Start / End frame slots, as this Flow draws them.
 *
 * "Failed to attach frame image(s) (Start/End) automatically. The UI may have
 * changed or the frame buttons could not be found." — it had.
 *
 *   <div class="ingredient-bar-container">
 *     <div cdkoverlayorigin class="frame-trigger">
 *       <button class="empty-chip"> Début </button>
 *     <button aria-label="Intervertir les première et dernière images">
 *       <mat-icon>swap_horiz</mat-icon>
 *     <div cdkoverlayorigin class="frame-trigger">
 *       <button class="empty-chip"> Fin </button>
 *
 * Two things in there defeated the old code, and neither is about the labels:
 * the picker is a CDK overlay rather than a Radix dialog wired back with
 * aria-controls, and the listener is on the inner button, not on the div the
 * code was clicking. Three attempts passed with the slots on screen and no
 * picker ever opening.
 */
describe('opening a frame slot', () => {
  const SEL = readSrcFile('../content/flow/selectors.ts');
  const AUTO = readSrcFile('../content/flow/automation.ts');

  it('finds the picker when it is a CDK overlay', () => {
    const fn = SEL.slice(SEL.indexOf('export function findFrameSlotDialog'));
    expect(fn.slice(0, 1800)).toMatch(/cdk-overlay-pane/);
  });

  it('still prefers aria-controls, which names the right one', () => {
    /* Both slots have a picker; taking "whichever is open" could fill Start
       from End's and reverse the clip. */
    const fn = SEL.slice(SEL.indexOf('export function findFrameSlotDialog'));
    expect(fn.indexOf('aria-controls')).toBeLessThan(fn.indexOf('cdk-overlay-pane'));
  });

  it('clicks the button inside the slot, not the wrapper', () => {
    const fn = AUTO.slice(AUTO.indexOf('private async openFrameSlotDialog'));
    expect(fn.slice(0, 2200)).toMatch(/slot\.querySelector\('button'\)/);
    expect(fn.slice(0, 2200)).toMatch(/simulateClick\(target\)/);
  });

  it('falls back to the slot itself when it holds no button', () => {
    /* The old shape was the trigger; it must keep working. */
    const fn = AUTO.slice(AUTO.indexOf('private async openFrameSlotDialog'));
    expect(fn.slice(0, 2200)).toMatch(/\|\| slot;/);
  });
});

describe('the two slots, in order', () => {
  /* isVisible measures a bounding box, and jsdom lays nothing out — every
     element would read as hidden and findFrameSlots would find nothing for a
     reason that has nothing to do with the code under test. */
  const realRect = Element.prototype.getBoundingClientRect;
  beforeAll(() => {
    Element.prototype.getBoundingClientRect = function () {
      return { width: 80, height: 40, top: 0, left: 0, right: 80, bottom: 40, x: 0, y: 0,
        toJSON: () => ({}) } as DOMRect;
    };
  });
  afterAll(() => { Element.prototype.getBoundingClientRect = realRect; });

  it('reads them off the swap button between them', () => {
    document.body.innerHTML = `
      <div class="ingredient-bar-container">
        <div cdkoverlayorigin class="frame-trigger"><button class="empty-chip"> Début </button></div>
        <button aria-label="Intervertir les première et dernière images"><mat-icon>swap_horiz</mat-icon></button>
        <div cdkoverlayorigin class="frame-trigger"><button class="empty-chip"> Fin </button></div>
      </div>`;
    const { findFrameSlots } = require('../content/flow/selectors');
    const slots = findFrameSlots();
    expect(slots).not.toBeNull();
    expect(slots.start.textContent).toContain('Début');
    expect(slots.end.textContent).toContain('Fin');
  });

  it('does not depend on the words, which are localised here', () => {
    /* "Début" and "Fin" are the same slots as Start and End. Order is what
       carries the meaning — the swap button between them exists precisely
       because the order is what matters. */
    document.body.innerHTML = `
      <div class="ingredient-bar-container">
        <div class="frame-trigger"><button class="empty-chip"> Inicio </button></div>
        <button aria-label="Intercambiar"><mat-icon>swap_horiz</mat-icon></button>
        <div class="frame-trigger"><button class="empty-chip"> Fin </button></div>
      </div>`;
    const { findFrameSlots } = require('../content/flow/selectors');
    const slots = findFrameSlots();
    expect(slots).not.toBeNull();
    expect(slots.start.textContent).toContain('Inicio');
  });
});

/**
 * The frame picker, as it really opens.
 *
 * Copied from the page. Reading it settled what was and was not broken, and
 * most of it was not: the rows still carry role="option" and aria-selected,
 * the confirm button still says "Add to prompt", and the thumbnail src is
 * unique per asset so it still works as an identity.
 *
 *   <div class="add-menu-popover-container flow-menu-panel">
 *     <h2 class="header-title">Select a frame image</h2>
 *     <input class="search-input" aria-label="Search assets">
 *     <cdk-virtual-scroll-viewport role="listbox">
 *       <button role="option" class="asset-item" aria-selected="false">
 *         <img class="asset-thumbnail-image" src="https://lh3.googleusercontent.com/asb/…">
 *         <span class="asset-title">af_01b81b98.png</span>
 *     <button class="detail-add-to-prompt-btn"> Add to prompt </button>
 *
 * What was broken was reaching it at all: it opens as a CDK overlay, and the
 * code looked for the trigger's aria-controls and then for a Radix dialog.
 * Neither exists, so openFrameSlotDialog spent its three attempts and gave up
 * with the picker open on screen.
 */
const PICKER = `
<div class="cdk-overlay-pane">
  <div class="add-menu-popover-container flow-menu-panel">
    <div class="header-bar">
      <h2 class="header-title">Select a frame image</h2>
      <button aria-label="Close"><mat-icon>close</mat-icon></button>
    </div>
    <div class="panels-layout"><div class="right-panel">
      <header class="search-header">
        <div class="search-input-container">
          <mat-icon class="search-icon">search</mat-icon>
          <input type="text" aria-label="Search assets" placeholder="Search assets" class="search-input">
        </div>
      </header>
      <div class="content-area">
        <flow-add-menu-asset-list>
          <cdk-virtual-scroll-viewport role="listbox" aria-label="Asset list" class="asset-list-viewport">
            <div class="cdk-virtual-scroll-content-wrapper">
              <div class="asset-item-container">
                <button type="button" role="option" class="asset-item asset-item-active" aria-selected="true">
                  <flow-add-menu-asset-item>
                    <div class="asset-thumbnail"><img class="asset-thumbnail-image"
                      src="https://lh3.googleusercontent.com/asb/AB-nOUZHwHZsSL4YnXqlQXiD13QZeVAD"></div>
                    <div class="asset-text"><span class="asset-title">VICTORIAN GENTLEMAN.jpeg</span></div>
                  </flow-add-menu-asset-item>
                </button>
              </div>
              <div class="asset-item-container">
                <button type="button" role="option" class="asset-item" aria-selected="false">
                  <flow-add-menu-asset-item>
                    <div class="asset-thumbnail"><img class="asset-thumbnail-image"
                      src="https://lh3.googleusercontent.com/asb/AB-nOUbNs4salDk6fUDUbaE8RiQIWgKb"></div>
                    <div class="asset-text"><span class="asset-title">af_01b81b98.png</span></div>
                  </flow-add-menu-asset-item>
                </button>
              </div>
            </div>
            <div class="cdk-virtual-scroll-spacer" style="height: 288px;"></div>
          </cdk-virtual-scroll-viewport>
        </flow-add-menu-asset-list>
        <flow-add-menu-detail-pane>
          <div class="detail-preview-box"><img class="detail-preview-image"
            src="https://lh3.googleusercontent.com/asb/AB-nOUZHwHZsSL4YnXqlQXiD13QZeVAD"
            alt="Preview of VICTORIAN GENTLEMAN.jpeg"></div>
          <div class="bottom-actions">
            <button type="button" class="detail-add-to-prompt-btn">
              <span class="mdc-button__label"> Add to prompt </span>
            </button>
          </div>
        </flow-add-menu-detail-pane>
      </div>
    </div></div>
  </div>
</div>`;

describe('the frame picker once it is open', () => {
  const realRect = Element.prototype.getBoundingClientRect;
  beforeAll(() => {
    Element.prototype.getBoundingClientRect = function () {
      return { width: 120, height: 40, top: 0, left: 0, right: 120, bottom: 40, x: 0, y: 0,
        toJSON: () => ({}) } as DOMRect;
    };
  });
  afterAll(() => { Element.prototype.getBoundingClientRect = realRect; });
  beforeEach(() => { document.body.innerHTML = PICKER; });

  it('is found, though it is neither a Radix dialog nor wired by aria-controls', () => {
    const { findFrameSlotDialog } = require('../content/flow/selectors');
    const slot = document.createElement('div');
    const dlg = findFrameSlotDialog(slot);
    expect(dlg).not.toBeNull();
    expect(dlg.className).toContain('add-menu-popover-container');
  });

  it('reads its rows, which still declare themselves as options', () => {
    const { findFrameSlotDialog, findAssetOptions } = require('../content/flow/selectors');
    const dlg = findFrameSlotDialog(document.createElement('div'));
    expect(findAssetOptions(dlg)).toHaveLength(2);
  });

  it('tells one asset from another by its thumbnail', () => {
    /* Two uploads of the same picture share a name; the src does not. */
    const { findFrameSlotDialog, findAssetOptions, assetOptionId } = require('../content/flow/selectors');
    const dlg = findFrameSlotDialog(document.createElement('div'));
    const ids = findAssetOptions(dlg).map(assetOptionId);
    expect(new Set(ids).size).toBe(2);
    expect(ids[0]).not.toBe('');
  });

  it('knows which row is selected', () => {
    const { findFrameSlotDialog, findAssetOptions, assetOptionSelected } = require('../content/flow/selectors');
    const dlg = findFrameSlotDialog(document.createElement('div'));
    const rows = findAssetOptions(dlg);
    expect(assetOptionSelected(rows[0])).toBe(true);
    expect(assetOptionSelected(rows[1])).toBe(false);
  });

  it('finds the button that commits the choice', () => {
    const { findFrameSlotDialog, findAddToPromptButton } = require('../content/flow/selectors');
    const dlg = findFrameSlotDialog(document.createElement('div'));
    const btn = findAddToPromptButton(dlg);
    expect(btn).not.toBeNull();
    expect((btn.textContent || '').trim()).toContain('Add to prompt');
  });

  it('finds the search box by class, not by its wording', () => {
    /* The wording is translated; the class is not. */
    const { searchInputSelector } = require('../content/flow/flowStrings');
    expect(searchInputSelector()).toMatch(/^input\.search-input,/);
    expect(document.querySelector(searchInputSelector())).not.toBeNull();
  });

  it('finds the search box even with every label translated', () => {
    document.body.innerHTML = PICKER
      .replace('aria-label="Search assets"', 'aria-label="Rechercher des éléments"')
      .replace('placeholder="Search assets"', 'placeholder="Rechercher des éléments"');
    const { searchInputSelector } = require('../content/flow/flowStrings');
    expect(document.querySelector(searchInputSelector())).not.toBeNull();
  });
});

/**
 * Switching the composer to Frames, which everything else depended on.
 *
 * "HE NOT CLICK ON THIS TO SHOW HIM THE START AND END FRAME" — and he could
 * not, because the control was not in the list of things looked at.
 *
 *   <mat-button-toggle>
 *     <button class="mat-button-toggle-button" role="radio" aria-checked="false">
 *       <span class="toggle-label">
 *         <mat-icon class="google-symbols">crop_free</mat-icon>
 *         <span class="toggle-text">Images</span>
 *
 * findModeButton searched button[role="tab"], [role="menuitem"],
 * [role="menuitemradio"], [role="option"] and [data-radix-collection-item].
 * role="radio" is in none of them, so findModeButton('Frames') returned null,
 * the composer stayed on Ingredients, and the Start/End slots were never
 * rendered at all.
 *
 * Which means the earlier fixes in this area — the CDK overlay, the button
 * inside the slot — were all downstream of a mode that was never switched.
 * They were needed; they just could not be reached.
 */
describe('the creation-type toggle', () => {
  const realRect = Element.prototype.getBoundingClientRect;
  beforeAll(() => {
    Element.prototype.getBoundingClientRect = function () {
      return { width: 90, height: 36, top: 0, left: 0, right: 90, bottom: 36, x: 0, y: 0,
        toJSON: () => ({}) } as DOMRect;
    };
  });
  afterAll(() => { Element.prototype.getBoundingClientRect = realRect; });

  const group = (checked: 'Images' | 'Frames') => `
    <mat-button-toggle-group role="radiogroup">
      <mat-button-toggle class="mat-button-toggle${checked === 'Images' ? ' mat-button-toggle-checked' : ''}">
        <button class="mat-button-toggle-button" role="radio" aria-checked="${checked === 'Images'}">
          <span class="mat-button-toggle-label-content"><span class="toggle-label">
            <mat-icon class="mat-icon notranslate google-symbols">crop_free</mat-icon>
            <span class="toggle-text">Images</span>
          </span></span>
        </button>
      </mat-button-toggle>
      <mat-button-toggle class="mat-button-toggle${checked === 'Frames' ? ' mat-button-toggle-checked' : ''}">
        <button class="mat-button-toggle-button" role="radio" aria-checked="${checked === 'Frames'}">
          <span class="mat-button-toggle-label-content"><span class="toggle-label">
            <mat-icon class="mat-icon notranslate google-symbols">animation</mat-icon>
            <span class="toggle-text">Frames</span>
          </span></span>
        </button>
      </mat-button-toggle>
    </mat-button-toggle-group>`;

  it('is found at all', () => {
    document.body.innerHTML = group('Images');
    const { findModeButton } = require('../content/flow/selectors');
    expect(findModeButton('Frames')).not.toBeNull();
  });

  it('is the Frames one, not whichever came first', () => {
    document.body.innerHTML = group('Images');
    const { findModeButton, labelText } = require('../content/flow/selectors');
    expect(labelText(findModeButton('Frames'))).toContain('Frames');
  });

  it('reads the label without the icon fused onto it', () => {
    /* The ligature sits in the same span: raw textContent is
       "crop_freeImages", which matches neither word. */
    document.body.innerHTML = group('Images');
    const { findModeButton, labelText } = require('../content/flow/selectors');
    expect(labelText(findModeButton('Images'))).not.toContain('crop_free');
  });

  it('knows which one is already chosen', () => {
    /* A Material toggle sets aria-checked and a class on the wrapper, and
       data-state on neither — so a click that worked read as one that had
       not, and the code went on to try React handlers that do not exist. */
    document.body.innerHTML = group('Frames');
    const { findModeButton, isTabActive } = require('../content/flow/selectors');
    expect(isTabActive(findModeButton('Frames'))).toBe(true);
    expect(isTabActive(findModeButton('Images'))).toBe(false);
  });

  it('is verified through isTabActive rather than data-state', () => {
    const AUTO = readSrcFile('../content/flow/automation.ts');
    const at = AUTO.indexOf('const afterItem = findModeButton(label);');
    expect(at).toBeGreaterThan(-1);
    expect(AUTO.slice(at, at + 700)).toMatch(/if \(isTabActive\(afterItem\)\)/);
  });
});

/**
 * The creation-type group as it really is, in French.
 *
 * Both halves copied from the page:
 *
 *   <mat-button-toggle class="… mat-button-toggle-checked">
 *     <button role="radio" aria-checked="true">
 *       <mat-icon>chrome_extension</mat-icon><span class="toggle-text">Ingrédients</span>
 *
 *   <mat-button-toggle>
 *     <button role="radio" aria-checked="false">
 *       <mat-icon>crop_free</mat-icon><span class="toggle-text">Images</span>
 *
 * "Images" is the FRAMES option here — that is what FLOW_STRINGS.frames means
 * by listing it — and it is also the English word for the OTHER toggle. A
 * loose contains-match on either key could therefore pick the wrong one, in
 * opposite directions depending on the language, and click it with complete
 * confidence.
 *
 * Hence the order: the literal word asked for, then an exact translation,
 * then loose. Both languages are pinned here because getting one right by
 * breaking the other is the failure mode.
 */
describe('choosing between Ingrédients and Images', () => {
  const realRect = Element.prototype.getBoundingClientRect;
  beforeAll(() => {
    Element.prototype.getBoundingClientRect = function () {
      return { width: 90, height: 36, top: 0, left: 0, right: 90, bottom: 36, x: 0, y: 0,
        toJSON: () => ({}) } as DOMRect;
    };
  });
  afterAll(() => { Element.prototype.getBoundingClientRect = realRect; });

  const FRENCH = `
    <mat-button-toggle-group role="radiogroup">
      <mat-button-toggle class="mat-button-toggle toggle flex-toggle mat-button-toggle-checked">
        <button class="mat-button-toggle-button" role="radio" aria-checked="true" name="mat-button-toggle-group-322">
          <span class="mat-button-toggle-label-content"><span class="toggle-label">
            <mat-icon class="mat-icon notranslate flow-icon-m google-symbols">chrome_extension</mat-icon>
            <span class="toggle-text">Ingrédients</span>
          </span></span>
        </button>
      </mat-button-toggle>
      <mat-button-toggle class="mat-button-toggle toggle flex-toggle">
        <button class="mat-button-toggle-button" role="radio" aria-checked="false" name="mat-button-toggle-group-322">
          <span class="mat-button-toggle-label-content"><span class="toggle-label">
            <mat-icon class="mat-icon notranslate flow-icon-m google-symbols">crop_free</mat-icon>
            <span class="toggle-text">Images</span>
          </span></span>
        </button>
      </mat-button-toggle>
    </mat-button-toggle-group>`;

  const ENGLISH = FRENCH
    .replace('Ingrédients', 'Ingredients')
    .replace('>Images<', '>Frames<');

  it('picks Images for Frames on a French interface', () => {
    document.body.innerHTML = FRENCH;
    const { findModeButton, labelText } = require('../content/flow/selectors');
    expect(labelText(findModeButton('Frames'))).toContain('Images');
  });

  it('picks Ingrédients for Ingredients on the same interface', () => {
    /* Getting Frames right by making Ingredients wrong would be no better. */
    document.body.innerHTML = FRENCH;
    const { findModeButton, labelText } = require('../content/flow/selectors');
    expect(labelText(findModeButton('Ingredients'))).toContain('Ingrédients');
  });

  it('sees that Ingrédients is the one already chosen', () => {
    document.body.innerHTML = FRENCH;
    const { findModeButton, isTabActive } = require('../content/flow/selectors');
    expect(isTabActive(findModeButton('Ingredients'))).toBe(true);
    expect(isTabActive(findModeButton('Frames'))).toBe(false);
  });

  it('still picks Frames for Frames on an English interface', () => {
    /* Where "Images" would be the wrong toggle entirely. */
    document.body.innerHTML = ENGLISH;
    const { findModeButton, labelText } = require('../content/flow/selectors');
    expect(labelText(findModeButton('Frames'))).toContain('Frames');
  });

  it('drops the icon ligature from the label either way', () => {
    document.body.innerHTML = FRENCH;
    const { findModeButton, labelText } = require('../content/flow/selectors');
    expect(labelText(findModeButton('Ingredients'))).not.toContain('chrome_extension');
    expect(labelText(findModeButton('Frames'))).not.toContain('crop_free');
  });
});

/**
 * Ingredients, held to the same standard as frames.
 *
 * The frames path waits for the media to actually be in the slot. The
 * ingredients path counted chips — and a chip appears the instant it is
 * added, in the placeholder state, before its image has arrived:
 *
 *   <button class="chip-container" aria-label="Ingrédient" aria-busy="false">
 *     <div class="chip-image-wrapper">
 *       <div class="chip-placeholder"><mat-icon>image</mat-icon></div>
 *
 * On a large upload those are seconds apart, and the run generated in
 * between — with a reference the model never received. Note aria-busy reads
 * "false" in both states, so it cannot be the signal; the picture appearing
 * is.
 */
describe('an ingredient that has arrived, and one that has not', () => {
  const realRect = Element.prototype.getBoundingClientRect;
  beforeAll(() => {
    Element.prototype.getBoundingClientRect = function () {
      return { width: 48, height: 48, top: 0, left: 0, right: 48, bottom: 48, x: 0, y: 0,
        toJSON: () => ({}) } as DOMRect;
    };
  });
  afterAll(() => { Element.prototype.getBoundingClientRect = realRect; });

  const READY = (id: string) => `
    <flow-ingredient-chip><flow-image-ingredient-chip>
      <button class="chip-container" aria-label="Ingrédient" aria-busy="false">
        <div class="chip-image-wrapper">
          <img class="chip-image" src="https://flow-content.google/image/${id}?Signature=x">
        </div>
      </button>
    </flow-image-ingredient-chip></flow-ingredient-chip>`;

  const PENDING = `
    <flow-ingredient-chip><flow-image-ingredient-chip>
      <button class="chip-container" aria-label="Ingrédient" aria-busy="false">
        <div class="chip-image-wrapper">
          <div class="chip-placeholder"><mat-icon class="placeholder-icon">image</mat-icon></div>
        </div>
      </button>
    </flow-image-ingredient-chip></flow-ingredient-chip>`;

  const bar = (...chips: string[]) => {
    document.body.innerHTML = `<div class="ingredient-bar-container">${chips.join('')}</div>`;
  };

  it('is settled once the picture is showing', () => {
    bar(READY('512692e5-48d2-42c8-8d35-f44b09e5af4a'));
    const { ingredientChipsSettled } = require('../content/flow/selectors');
    expect(ingredientChipsSettled()).toBe(true);
  });

  it('is not settled while a placeholder is showing', () => {
    bar(PENDING);
    const { ingredientChipsSettled } = require('../content/flow/selectors');
    expect(ingredientChipsSettled()).toBe(false);
  });

  it('does not take aria-busy for the answer', () => {
    /* Both states say "false"; only one of them is ready. */
    expect(PENDING).toContain('aria-busy="false"');
    expect(READY('x')).toContain('aria-busy="false"');
  });

  it('waits for the slowest of them', () => {
    bar(READY('512692e5-48d2-42c8-8d35-f44b09e5af4a'), PENDING);
    const { ingredientChipsSettled } = require('../content/flow/selectors');
    expect(ingredientChipsSettled()).toBe(false);
  });

  it('counts only the ones that really arrived', () => {
    bar(READY('512692e5-48d2-42c8-8d35-f44b09e5af4a'), PENDING);
    const { ingredientChipIds } = require('../content/flow/selectors');
    expect(ingredientChipIds()).toHaveLength(1);
  });

  it('tells one ingredient from another', () => {
    /* So a chip left over from the previous prompt cannot make the count up
       when one of this prompt's images failed to land. */
    bar(READY('512692e5-48d2-42c8-8d35-f44b09e5af4a'), READY('aaaa1111-2222-3333-4444-555566667777'));
    const { ingredientChipIds } = require('../content/flow/selectors');
    expect(new Set(ingredientChipIds()).size).toBe(2);
  });

  it('is one of the two things the attach waits on', () => {
    /* Still a way to finish, no longer the only one — and no longer the first.
       ingredientChipsSettled() is PAGE-WIDE: every chip in the tray must be
       showing its picture, including ones an earlier prompt left there. A run
       that uploaded one image and found three chips spent ninety seconds
       waiting on two it had never attached, then failed with the picture
       plainly in the library. The name on the page is the primary test now;
       this is kept as the other way of seeing the same thing. */
    const AUTO = readSrcFile('../content/flow/automation.ts');
    const at = AUTO.indexOf('Final verification: the pictures, not the boxes');
    expect(at).toBeGreaterThan(-1);
    const block = AUTO.slice(at, at + 3600);
    expect(block).toMatch(/if \(namesNow\(\)\.length >= images\.length\) break;/);
    expect(block).toMatch(/ready >= images\.length && ingredientChipsSettled\(\)/);
    expect(block).not.toMatch(/const chipsAfter = findIngredientChips\(\)\.length;/);
  });

  it('says which of the failures it was', () => {
    /* "Only 2/3 attached" and "3 attached, one still empty" need different
       fixes and were reported identically. Now there is a third, and it is the
       one that matters most: Flow never took the file at all. One line carries
       all three counts rather than guessing which to print. */
    const AUTO = readSrcFile('../content/flow/automation.ts');
    expect(AUTO).toMatch(/Flow never showed a name for/);
    expect(AUTO).toMatch(/chip\(s\) in the tray, \$\{ready\} with a picture/);
  });
});
