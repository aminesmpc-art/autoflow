/**
 * @jest-environment jsdom
 */

/**
 * A video ingredient is an ingredient.
 *
 * ── The run this comes from ───────────────────────────────────────────────
 *
 *   02:15:51  attached "Motion-Control-1-part1-of-2.mp4" as the style reference
 *   02:15:51  "Motion-Control-1-part1-of-2.mp4" is on the prompt as an ingredient
 *   02:15:52  Prompt filled (569 chars)
 *   02:16:12  Flow shows 1 of 2 ingredient(s) — 1 still(s) and the motion clip
 *
 * The clip WAS on the prompt. attachFromLibrary confirmed it, with a counter
 * that counts ingredient chips. The pre-Generate guard used a different one,
 * findAttachedIngredients, which required an <img> in the chip:
 *
 *   const img = chip.querySelector('img[src]');
 *   return !!img && isMediaImage(img) && isVisible(chip);
 *
 * A video chip has no <img> anywhere in it. So it was dropped there, before
 * chipMediaReady — which has handled <video> all along and had never been
 * shown one. Two counters, one prompt, and the run refused to press Generate
 * on a correctly assembled composer.
 *
 * The markup below is the live chip, pasted from the page.
 */

/// <reference types="node" />

import { ingredientChips } from '../content/flow/flowDom';
import { findAttachedIngredients, findLoadedIngredients } from '../content/flow/selectors';

/** The real thing, off flow.google.com. */
const VIDEO_CHIP = `
<div class="ingredient-bar-container">
  <flow-ingredient-chip>
    <flow-video-ingredient-chip>
      <button cdkoverlayorigin class="chip-container" aria-label="Ingredient" aria-busy="false">
        <div class="chip-image-wrapper">
          <video muted playsinline class="chip-video"
                 src="https://flow-content.google/video/a24908f9-7d2c-46ca-aacc-816289cd8961?Expires=1788938083&amp;KeyName=labs-flow-prod-cdn-key&amp;Signature=6gadxJER8GkFthLZ5AO5CtgxdL0"
                 style="visibility: visible;"></video>
        </div>
        <div class="hover-icon-overlay"><mat-icon class="hover-icon google-symbols">cancel</mat-icon></div>
        <mat-icon class="type-badge google-symbols">videocam</mat-icon>
      </button>
    </flow-video-ingredient-chip>
  </flow-ingredient-chip>
</div>`;

/** A still, for the mixed case that actually failed: one of each. */
const IMAGE_CHIP = `
  <flow-ingredient-chip>
    <flow-image-ingredient-chip>
      <button class="chip-container" aria-label="Ingredient" aria-busy="false">
        <img class="chip-image" alt="Ingredient image"
             src="https://flow-content.google/image/c302391d-0000-4000-8000-000000000000?Expires=1&Signature=x" />
      </button>
    </flow-image-ingredient-chip>
  </flow-ingredient-chip>`;

/** jsdom gives everything a zero box, and isVisible reads one. */
function box(el: Element): void {
  (el as HTMLElement).getBoundingClientRect = () =>
    ({ width: 54, height: 54, left: 10, top: 400, right: 64, bottom: 454 }) as DOMRect;
  Object.defineProperty(el, 'offsetParent', { value: document.body, configurable: true });
}
function boxAll(): void {
  for (const el of Array.from(document.querySelectorAll('*'))) box(el);
}

/** An <img> only counts once the browser says it decoded. */
function loadImages(): void {
  for (const img of Array.from(document.querySelectorAll('img'))) {
    Object.defineProperty(img, 'complete', { value: true, configurable: true });
    Object.defineProperty(img, 'naturalWidth', { value: 512, configurable: true });
  }
}

describe('a clip on the prompt counts as an ingredient', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('is found by the chip finder at all', () => {
    document.body.innerHTML = VIDEO_CHIP;
    boxAll();
    expect(ingredientChips(document)).toHaveLength(1);
  });

  it('survives the finder that wanted an <img>', () => {
    /* The regression, exactly. There is no <img> anywhere in that markup. */
    document.body.innerHTML = VIDEO_CHIP;
    boxAll();
    expect(document.querySelectorAll('img')).toHaveLength(0);
    expect(findAttachedIngredients()).toHaveLength(1);
  });

  it('counts as loaded, because its <video> has a src', () => {
    document.body.innerHTML = VIDEO_CHIP;
    boxAll();
    expect(findLoadedIngredients()).toHaveLength(1);
  });

  it('counts one still and one clip as two — the case that failed', () => {
    /* "Flow shows 1 of 2 ingredient(s)" was this, counted wrong. */
    document.body.innerHTML =
      `<div class="ingredient-bar-container">${IMAGE_CHIP}${VIDEO_CHIP}</div>`;
    boxAll();
    loadImages();
    expect(findLoadedIngredients()).toHaveLength(2);
  });

  it('does not count the nested chips twice', () => {
    /* flow-ingredient-chip wraps flow-video-ingredient-chip, and both are in
       the selector now. Only the outermost may be kept. */
    document.body.innerHTML = VIDEO_CHIP;
    boxAll();
    expect(document.querySelectorAll('flow-video-ingredient-chip')).toHaveLength(1);
    expect(document.querySelectorAll('flow-ingredient-chip')).toHaveLength(1);
    expect(ingredientChips(document)).toHaveLength(1);
  });

  it('is still busy while Flow says it is', () => {
    document.body.innerHTML = VIDEO_CHIP.replace('aria-busy="false"', 'aria-busy="true"');
    boxAll();
    expect(findLoadedIngredients()).toHaveLength(0);
  });
});
