/**
 * @jest-environment jsdom
 */

/**
 * The ingredient chip, as Flow actually renders it today.
 *
 * Reported from a live run: "Engine stalled at ATTACH_INGREDIENT_IMAGES for
 * 90s without submitting", with the chip visibly present on the page holding
 * a real picture. So the image had arrived and the settle loop did not believe
 * it — which is the failure that costs ninety seconds and then either refuses
 * a prompt that was ready or, worse, generates without the reference.
 *
 * The markup below is copied verbatim from that page, not written from the
 * selector's point of view. That distinction is the whole value of this file:
 * a fixture invented to match the code proves the code matches itself.
 */

import { findIngredientChips, ingredientChipIds, ingredientChipsSettled } from '../content/flow/selectors';

/* Verbatim from the live page, including the signed CDN URL. */
const LIVE_CHIP = `
<flow-ingredient-bar _ngcontent-ng-c3466413254="" class="prompt-ingredient-bar" _nghost-ng-c2759378901="">
  <div _ngcontent-ng-c2759378901="" class="ingredient-bar-container">
    <flow-image-ingredient-chip _ngcontent-ng-c775064767="" _nghost-ng-c2423813527="">
      <button _ngcontent-ng-c2423813527="" cdkoverlayorigin="" class="chip-container"
              aria-label="Ingredient" aria-busy="false">
        <div _ngcontent-ng-c2423813527="" class="chip-image-wrapper">
          <img _ngcontent-ng-c2423813527="" alt="Ingredient image" class="chip-image"
               src="https://flow-content.google/image/edd71fab-a703-4ab7-a84e-8a67cdb5ad2a?Expires=1788754493&amp;KeyName=labs-flow-prod-cdn-key&amp;Signature=6zin7Gd4C7UQ-VOHgxmX8fPuWYA">
        </div>
        <div _ngcontent-ng-c2423813527="" class="hover-icon-overlay" data-state="closed">
          <mat-icon _ngcontent-ng-c2423813527="" role="img"
                    class="mat-icon notranslate hover-icon flow-icon-s google-symbols mat-icon-no-color"
                    aria-hidden="true" data-mat-icon-type="font">cancel</mat-icon>
        </div>
      </button>
    </flow-image-ingredient-chip>
  </div>
</flow-ingredient-bar>`;

/* jsdom gives every element a zero box, so anything gated on isVisible would
   see nothing at all. Flow's chips are laid out by Angular; measuring them is
   not what this file is about, so the geometry is stubbed once and the
   selectors are asked the question they actually get asked in the browser. */
function withLayout(): void {
  Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
    configurable: true,
    value() {
      return { width: 120, height: 54, top: 900, left: 60, bottom: 954, right: 180, x: 60, y: 900 };
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
    configurable: true,
    get() { return document.body; },
  });
}

beforeEach(() => {
  document.body.innerHTML = LIVE_CHIP;
  withLayout();
});

describe('the chip Flow renders today', () => {
  it('is found at all', () => {
    expect(findIngredientChips()).toHaveLength(1);
  });

  it('counts as loaded, so the settle loop stops waiting', () => {
    /* The bug as reported: this returning false for ninety seconds while the
       picture was on screen the whole time. */
    expect(ingredientChipsSettled()).toBe(true);
  });

  it('yields the media id from the signed CDN url', () => {
    /* Not the whole src: the URL carries an Expires and a Signature that
       change on every render, so comparing srcs before and after an attach
       would report every chip as different and the ids would never settle. */
    expect(ingredientChipIds()).toEqual(['edd71fab-a703-4ab7-a84e-8a67cdb5ad2a']);
  });
});

describe('a chip whose picture has not arrived', () => {
  it('is not counted as loaded', () => {
    /* aria-busy is "false" here too — measured — so the placeholder is the
       only thing that distinguishes the two states. */
    document.body.innerHTML = `
      <flow-image-ingredient-chip>
        <button class="chip-container" aria-label="Ingredient" aria-busy="false">
          <div class="chip-image-wrapper">
            <div class="chip-placeholder"><mat-icon>image</mat-icon></div>
          </div>
        </button>
      </flow-image-ingredient-chip>`;
    withLayout();

    expect(findIngredientChips()).toHaveLength(1);
    expect(ingredientChipsSettled()).toBe(false);
    expect(ingredientChipIds()).toEqual([]);
  });
});
