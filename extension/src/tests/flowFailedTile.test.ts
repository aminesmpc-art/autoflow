/**
 * @jest-environment jsdom
 *
 * Retrying a failed generation on the Flow that exists now.
 *
 * The fixture below is the real markup of a failed tile, copied from a live
 * project. Everything here is measured against it rather than against a shape
 * I imagined, because guessing this site's DOM has been wrong every time.
 *
 * ── Why nothing was ever retried ──────────────────────────────────────────
 *
 * Two independent breaks, either of which alone was fatal.
 *
 * 1. findRetryButtonOnTile could not see the button. It asked for
 *    `i.google-symbols` holding the text "refresh", and for a <span> reading
 *    "Retry". The Angular Flow renders <mat-icon>refresh</mat-icon> and puts
 *    the word in aria-label. Measured on the live page: 0 elements match
 *    `i.google-symbols`, against 70 <mat-icon>. So it returned null on every
 *    failed tile the site can produce.
 *
 * 2. findTileId returned '' — the new tiles carry no data-tile-id and no
 *    data-index, as the fixture shows. findAllFailedTilesWithScroll skips any
 *    tile with an empty id, so the failed tiles were dropped before the
 *    button was ever looked for.
 *
 * ── Why the icon is the primary signal ────────────────────────────────────
 *
 * A ligature is the same word in every locale; an aria-label is not. The live
 * page reads "Favourite", so it is already serving en-GB rather than en-US,
 * and the retry path should not depend on which spelling arrives.
 *
 * ── Why matching the neighbouring buttons would be worse than failing ─────
 *
 * The error tile carries three buttons in one container. `undo` only refills
 * the prompt box — it generates nothing, so a run that clicked it would wait
 * out its timeout and report a failure it had itself caused. `delete_forever`
 * destroys the tile. Only `refresh` regenerates.
 */

import { findRetryButtonOnTile, findReusePromptButtonOnTile, getTileState } from '../content/selectors';

/** The real markup of a failed tile, trimmed only of ripple/touch spans. */
const FAILED_TILE = `
<div class="batch-container virtual-item-container">
  <div class="batch-tiles-section">
    <div class="tile-row">
      <flow-grid-tile-container aria-label="Woman posing">
        <flow-tile-container>
          <div class="container">
            <flow-video-tile>
              <div class="container">
                <flow-error-tile>
                  <div class="error-tile">
                    <div class="error-tile-content">
                      <div class="error-message">
                        <mat-icon role="img" class="mat-icon notranslate error-icon google-symbols mat-icon-no-color" aria-hidden="true" data-mat-icon-type="font">warning</mat-icon>
                        <div class="error-title">Failed</div>
                        <div class="error-subtitle">
                          <span class="error-message-text"> This prompt might violate our policies about generating prominent people. Please try a different prompt or send feedback. </span>
                          <span class="disclaimer-message">You have not been charged for this generation.</span>
                        </div>
                      </div>
                      <div class="buttons-container">
                        <button class="mdc-icon-button mat-mdc-icon-button" aria-label="Retry"><mat-icon role="img" class="mat-icon notranslate google-symbols mat-icon-no-color" aria-hidden="true" data-mat-icon-type="font">refresh</mat-icon></button>
                        <button class="mdc-icon-button mat-mdc-icon-button" aria-label="Reuse prompt"><mat-icon role="img" class="mat-icon notranslate google-symbols mat-icon-no-color" aria-hidden="true" data-mat-icon-type="font">undo</mat-icon></button>
                        <button class="mdc-icon-button mat-mdc-icon-button" aria-label="Delete"><mat-icon role="img" class="mat-icon notranslate google-symbols mat-icon-no-color" aria-hidden="true" data-mat-icon-type="font">delete_forever</mat-icon></button>
                      </div>
                    </div>
                  </div>
                </flow-error-tile>
              </div>
            </flow-video-tile>
          </div>
        </flow-tile-container>
      </flow-grid-tile-container>
    </div>
  </div>
  <flow-batch-info>
    <div class="batch-toolbar">
      <button aria-label="Download batch"><mat-icon class="mat-icon notranslate flow-icon-m google-symbols">download</mat-icon></button>
      <button aria-label="Reuse prompt"><mat-icon class="mat-icon notranslate flow-icon-m google-symbols">undo</mat-icon></button>
      <button aria-label="Trash batch"><mat-icon class="mat-icon notranslate flow-icon-m google-symbols">delete</mat-icon></button>
    </div>
    <div class="below-toolbar">
      <flow-expandable-prompt class="prompt inline">
        <div class="expandable-prompt-container">
          <div class="prompt-text"><span class="text-part">sexy hot woman like gorgena </span></div>
          <div class="prompt-actions">
            <button class="action-button reuse-prompt-button" aria-label="Reuse prompt"><mat-icon class="mat-icon notranslate google-symbols">keyboard_return</mat-icon></button>
          </div>
        </div>
      </flow-expandable-prompt>
      <div class="metadata">
        <div class="metadata-row"> Created Sep 5, 2026 </div>
        <div class="metadata-row"><span>Omni 1.1 Flash</span><span aria-hidden="true">&bull;</span><span>720p</span><span aria-hidden="true">&bull;</span><span>8s</span><mat-icon class="mat-icon notranslate metadata-icon google-symbols">crop_16_9</mat-icon><span>16:9</span></div>
      </div>
    </div>
  </flow-batch-info>
</div>`;

const mount = (html: string): Element => {
  document.body.innerHTML = html;
  return document.querySelector('flow-video-tile')!;
};

describe('the failed tile the site actually renders', () => {
  let tile: Element;
  beforeEach(() => { tile = mount(FAILED_TILE); });

  it('reads as failed', () => {
    /* Via the refusal wording — "violate" — and the warning ligature, both of
       which getTileState already knows. */
    expect(getTileState(tile)).toBe('failed');
  });

  it('carries no id of its own, which is why one has to be derived', () => {
    expect(tile.querySelectorAll('[data-tile-id]').length).toBe(0);
    expect(tile.querySelectorAll('[data-index]').length).toBe(0);
  });

  it('finds the Retry button', () => {
    const btn = findRetryButtonOnTile(tile);
    expect(btn).not.toBeNull();
    expect(btn!.getAttribute('aria-label')).toBe('Retry');
  });

  it('does not mistake Reuse prompt for Retry', () => {
    /* It refills the prompt box and generates nothing, so a run that clicked
       it would wait out its timeout and report a failure it caused itself. */
    expect(findRetryButtonOnTile(tile)!.getAttribute('aria-label')).not.toBe('Reuse prompt');
  });

  it('does not mistake Delete for Retry', () => {
    expect(findRetryButtonOnTile(tile)!.getAttribute('aria-label')).not.toBe('Delete');
  });

  it('finds Retry by the icon, not the wording', () => {
    /* A ligature is locale-independent; the label is not — this page already
       serves en-GB ("Favourite"). Strip every label and it must still work. */
    tile.querySelectorAll('button').forEach((b) => b.removeAttribute('aria-label'));
    const btn = findRetryButtonOnTile(tile);
    expect(btn).not.toBeNull();
    expect(btn!.querySelector('mat-icon')!.textContent).toBe('refresh');
  });

  it('finds Retry by the label when the icon font has not resolved', () => {
    tile.querySelectorAll('mat-icon').forEach((i) => { i.textContent = ''; });
    expect(findRetryButtonOnTile(tile)!.getAttribute('aria-label')).toBe('Retry');
  });

  it('still finds the Reuse prompt button on the tile', () => {
    const btn = findReusePromptButtonOnTile(tile);
    expect(btn).not.toBeNull();
    expect(btn!.getAttribute('aria-label')).toBe('Reuse prompt');
  });
});

describe('a tile that has not failed', () => {
  it('offers no Retry button to click', () => {
    /* The succeeded tile's three buttons, read off the live page: favourite,
       redo, more_vert. None regenerates, and `redo` must not be taken for
       `refresh`. */
    const tile = mount(`
      <div class="batch-container"><flow-video-tile>
        <button aria-label="Favourite"><mat-icon>favorite</mat-icon></button>
        <button aria-label="Reuse prompt"><mat-icon>redo</mat-icon></button>
        <button aria-label="More options"><mat-icon>more_vert</mat-icon></button>
      </flow-video-tile></div>`);
    expect(findRetryButtonOnTile(tile)).toBeNull();
  });
});

describe('the old Flow, which some users may still be served', () => {
  it('is still matched by the icon tier', () => {
    const tile = mount(`
      <div class="batch-container"><flow-video-tile>
        <button><i class="google-symbols">refresh</i><span>Retry</span></button>
      </flow-video-tile></div>`);
    expect(findRetryButtonOnTile(tile)).not.toBeNull();
  });

  it('is still matched by the span tier when the icon is absent', () => {
    const tile = mount(`
      <div class="batch-container"><flow-video-tile>
        <button><span>Retry</span></button>
      </flow-video-tile></div>`);
    expect(findRetryButtonOnTile(tile)).not.toBeNull();
  });
});
