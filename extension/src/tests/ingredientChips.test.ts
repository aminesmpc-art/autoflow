/**
 * @jest-environment jsdom
 *
 * Attaching a reference image, and knowing when it has actually attached.
 *
 * The fixtures below are the two real states of an ingredient chip, copied
 * from the live composer.
 *
 * ── What was wrong ────────────────────────────────────────────────────────
 *
 * 1. The chips could not be found at all. findIngredientChips looked for
 *    button[data-card-open] and for images served from
 *    media.getMediaUrlRedirect, blob: or /api/ — none of which this Flow
 *    produces. So it returned nothing, and the ten-second wait for chips to
 *    appear could only ever time out.
 *
 * 2. The upload was not waited for. After pasting, the run slept exactly
 *    eight seconds and carried on. A small image is ready in about a second;
 *    a large one was still at 7% when the sleep expired.
 *
 * 3. The outcome was recorded regardless. uploadedAssets.add ran whether or
 *    not anything had arrived, so a later prompt took the "cached" path,
 *    searched Flow by filename for an image that was never uploaded, found
 *    nothing, and generated with no reference image at all. Silently.
 *
 * 4. Verification was a count. `chips >= expected` passes when two of three
 *    images attached and a chip left over from the previous prompt makes up
 *    the difference.
 *
 * ── The signal, and the one that looked right but is not ──────────────────
 *
 * aria-busy is the obvious candidate and it does not work. Measured on a chip
 * whose image had NOT arrived:
 *
 *   <button class="chip-container" aria-label="Ingredient" aria-busy="false">
 *     <div class="chip-image-wrapper">
 *       <div class="chip-placeholder"><mat-icon>image</mat-icon></div>
 *
 * "false" in the pending state as well as the finished one — waiting on it
 * would have returned immediately and bought nothing.
 *
 * The content is what differs: a placeholder div while pending, replaced by
 * <img class="chip-image"> once the upload lands. So the picture being there
 * is the readiness signal, and the media id in its URL says WHICH image
 * arrived — which is what turns a count into an answer.
 */

import {
  findIngredientChips,
  ingredientChipsSettled,
  ingredientChipIds,
} from '../content/selectors';

/** A chip whose upload has landed. */
const READY = `
  <flow-ingredient-chip><flow-image-ingredient-chip>
    <button class="chip-container" aria-label="Ingredient" aria-busy="false">
      <div class="chip-image-wrapper">
        <img alt="Ingredient image" class="chip-image"
             src="https://flow-content.google/image/512692e5-48d2-42c8-8d35-f44b09e5af4a?Expires=1788715445&amp;Signature=pfa8T6">
      </div>
      <div class="hover-icon-overlay"><mat-icon>cancel</mat-icon></div>
    </button>
  </flow-image-ingredient-chip></flow-ingredient-chip>`;

/** The same chip while the image is still not showing. */
const PENDING = `
  <flow-ingredient-chip><flow-image-ingredient-chip>
    <button class="chip-container" aria-label="Ingredient" aria-busy="false">
      <div class="chip-image-wrapper">
        <div class="chip-placeholder"><mat-icon class="placeholder-icon">image</mat-icon></div>
      </div>
      <div class="hover-icon-overlay"><mat-icon>cancel</mat-icon></div>
    </button>
  </flow-image-ingredient-chip></flow-ingredient-chip>`;

const bar = (...chips: string[]) => {
  document.body.innerHTML = `<div class="ingredient-bar-container">${chips.join('')}</div>`;
};

describe('finding the chips at all', () => {
  it('finds one on the Flow that exists now', () => {
    bar(READY);
    expect(findIngredientChips()).toHaveLength(1);
  });

  it('finds every chip in the bar', () => {
    bar(READY, PENDING, READY);
    expect(findIngredientChips()).toHaveLength(3);
  });

  it('returns the button, which is what gets clicked and read', () => {
    bar(READY);
    expect(findIngredientChips()[0].tagName).toBe('BUTTON');
  });

  it('finds none when nothing is attached', () => {
    document.body.innerHTML = '<div class="ingredient-bar-container"></div>';
    expect(findIngredientChips()).toHaveLength(0);
  });
});

describe('knowing when an upload has landed', () => {
  it('is settled when the picture is there', () => {
    bar(READY);
    expect(ingredientChipsSettled()).toBe(true);
  });

  it('is NOT settled while a placeholder is showing', () => {
    /* The case aria-busy gets wrong. */
    bar(PENDING);
    expect(ingredientChipsSettled()).toBe(false);
  });

  it('does not trust aria-busy on its own', () => {
    /* Both fixtures say aria-busy="false"; only one of them is ready. */
    expect(PENDING).toContain('aria-busy="false"');
    expect(READY).toContain('aria-busy="false"');
    bar(PENDING);
    expect(ingredientChipsSettled()).toBe(false);
  });

  it('still believes aria-busy when it says true', () => {
    bar(READY.replace('aria-busy="false"', 'aria-busy="true"'));
    expect(ingredientChipsSettled()).toBe(false);
  });

  it('waits for the slowest of them', () => {
    bar(READY, PENDING);
    expect(ingredientChipsSettled()).toBe(false);
  });

  it('is not settled when nothing has attached yet', () => {
    /* Otherwise a paste that produced nothing reads as finished. */
    document.body.innerHTML = '<div class="ingredient-bar-container"></div>';
    expect(ingredientChipsSettled()).toBe(false);
  });
});

describe('knowing WHICH images attached', () => {
  it('reads the media id out of the chip image', () => {
    bar(READY);
    expect(ingredientChipIds()).toEqual(['512692e5-48d2-42c8-8d35-f44b09e5af4a']);
  });

  it('counts a pending chip as nothing', () => {
    /* It has no picture, so it must not be mistaken for an image that
       arrived — which is exactly how a count-only check passed while an
       upload was still in flight. */
    bar(PENDING);
    expect(ingredientChipIds()).toEqual([]);
  });

  it('reports only the ones that are really there', () => {
    bar(READY, PENDING);
    expect(ingredientChipIds()).toHaveLength(1);
  });

  it('distinguishes one image from another', () => {
    /* A count cannot tell a new attachment from a chip left over by the
       previous prompt; an id can. */
    const other = READY.replace('512692e5-48d2-42c8-8d35-f44b09e5af4a', 'aaaa1111-2222-3333-4444-555566667777');
    bar(READY, other);
    const ids = ingredientChipIds();
    expect(new Set(ids).size).toBe(2);
  });
});

/**
 * Knowing an upload has finished by the name Flow prints for it.
 *
 * An uploaded image becomes a tile in the project, and the tile shows its
 * filename once Flow has taken it:
 *
 *   <span class="footer-title">af_5d2d0448.png</span>
 *
 * While it is still going up the tile is there but blank, with a percentage
 * on it — 7% in the case that first showed this up. So the name appearing IS
 * the upload completing, which is what to wait on instead of counting out a
 * fixed eight seconds.
 */
import { uploadIsOnPage, mediaNamesOnPage } from '../content/selectors';

const grid = (...titles: string[]) => {
  document.body.innerHTML = titles
    .map((t) => `<flow-grid-tile-container aria-label="${t}">
        <flow-tile-hover-footer><span class="footer-title">${t}</span></flow-tile-hover-footer>
      </flow-grid-tile-container>`)
    .join('');
};

describe('waiting for the name to appear', () => {
  it('sees the upload once its name is printed', () => {
    grid('af_5d2d0448.png');
    expect(uploadIsOnPage('af_5d2d0448.png')).toBe(true);
  });

  it('does not see it while the tile is still blank', () => {
    /* The uploading state: a tile exists, but with a percentage and no name. */
    document.body.innerHTML = `<flow-grid-tile-container aria-label="">
        <div class="progress">7 %</div></flow-grid-tile-container>`;
    expect(uploadIsOnPage('af_5d2d0448.png')).toBe(false);
  });

  it('does not mistake another upload for this one', () => {
    grid('af_11112222.png');
    expect(uploadIsOnPage('af_5d2d0448.png')).toBe(false);
  });

  it('matches when Flow drops the extension', () => {
    grid('af_5d2d0448');
    expect(uploadIsOnPage('af_5d2d0448.png')).toBe(true);
  });

  it('reads whatever name the tile carries', () => {
    /* This fixture is a manually uploaded picture, which keeps its own name.
       Whether a pasted file keeps af_<id>.png has NOT been established — so
       the run counts names that are new rather than looking for its own,
       which makes the question moot instead of guessing at it. */
    document.body.innerHTML = `
      <flow-grid-tile-container aria-label="VICTORIAN GENTLEMAN.jpeg">
        <flow-image-tile>
          <img class="image" data-media-id="ff5d2104-f6dd-4f0c-969e-1577ac3d1b4b"
               src="https://flow-content.google/image/ff5d2104-f6dd-4f0c-969e-1577ac3d1b4b?Signature=x">
        </flow-image-tile>
        <flow-tile-hover-footer><span class="footer-title">VICTORIAN GENTLEMAN.jpeg</span></flow-tile-hover-footer>
      </flow-grid-tile-container>`;

    expect(mediaNamesOnPage().join(' ')).toContain('VICTORIAN GENTLEMAN.jpeg');
    expect(uploadIsOnPage('af_5d2d0448.png')).toBe(false);
  });

  it('sees a name that was not there before', () => {
    /* The comparison the run actually makes. */
    grid('already there.png');
    const before = new Set(mediaNamesOnPage());
    grid('already there.png', 'VICTORIAN GENTLEMAN.jpeg');
    const fresh = mediaNamesOnPage().filter((n) => !before.has(n));
    expect(fresh).toContain('VICTORIAN GENTLEMAN.jpeg');
  });

  it('reads names from the grid label as well as the footer', () => {
    /* The footer is only rendered while a tile is hovered on some builds. */
    document.body.innerHTML =
      '<flow-grid-tile-container aria-label="af_5d2d0448.png"></flow-grid-tile-container>';
    expect(uploadIsOnPage('af_5d2d0448.png')).toBe(true);
  });

  it('answers nothing for an empty name', () => {
    grid('af_5d2d0448.png');
    expect(uploadIsOnPage('')).toBe(false);
  });

  it('collects the names it can see', () => {
    grid('af_a.png', 'af_b.png');
    expect(mediaNamesOnPage().join(' ')).toContain('af_a.png');
    expect(mediaNamesOnPage().join(' ')).toContain('af_b.png');
  });
});
