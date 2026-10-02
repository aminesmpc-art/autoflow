/**
 * @jest-environment jsdom
 */

/**
 * What Flow's page is made of now, and why the old anchors stopped working.
 *
 * Read off flow.google.com in a real signed-in Chrome. The numbers below are
 * what was on screen, not what seemed likely:
 *
 *   img[src*="getMediaUrlRedirect"]   0    what this codebase looks for
 *   img[src*="flow-content.google"]   4    what is actually there
 *
 * The whole tRPC API is gone. The new app talks to
 * /_/AiSandboxAngularFrontend/data/batchexecute — Google's internal batch RPC
 * — and nothing on the page requests labs.google/fx/api at all.
 *
 * The better news is what replaced it. The Angular app ships semantic custom
 * element names: a tile is <flow-video-tile>, an ingredient is
 * <flow-ingredient-chip>. Those are component names rather than styling, so
 * they survive a restyle, and they say what a thing IS rather than what words
 * are printed on it or where its thumbnail is hosted. They are better anchors
 * than anything this codebase has had.
 */

import {
  FLOW_TAGS, MEDIA_SRC_PATTERNS, MEDIA_IMG_SELECTOR, isMediaImage,
  ingredientChips, tiles, isNewFlow,
} from '../content/flow/flowDom';
import { attachedCount } from '../content/flow/libraryPicker';

/** An ingredient chip, nested exactly as the live page nests them. */
const CHIP = `
  <flow-ingredient-chip><flow-image-ingredient-chip>
    <button cdkoverlayorigin class="chip-container" aria-label="Ingredient" aria-busy="false">
      <div class="chip-image-wrapper">
        <img alt="Ingredient image"
             src="https://flow-content.google/image/009aada3-8cc6?Expires=1788576485">
      </div></button>
  </flow-image-ingredient-chip></flow-ingredient-chip>`;

/** A generated tile, whose thumbnail comes from a different host again. */
const TILE = `
  <flow-video-tile><div class="container">
    <img draggable="false" alt="Generated video thumbnail" class="thumbnail"
         src="https://flow.google.com/asb/AB-nOUbdK7WIJIpPsBgS">
  </div></flow-video-tile>`;

describe('the media hosts', () => {
  it('knows both of the ones Flow uses now', () => {
    /* They are not interchangeable: chips come from the signed, expiring
       content host; tile thumbnails come from the app host. */
    expect(MEDIA_SRC_PATTERNS).toContain('flow-content.google');
    expect(MEDIA_SRC_PATTERNS).toContain('/asb/');
  });

  it('still knows the old one, which has not stopped resolving', () => {
    /* labs.google still serves the previous site; a user on it must not be
       broken by the fix for the new one. */
    expect(MEDIA_SRC_PATTERNS).toContain('getMediaUrlRedirect');
  });

  it('recognises an image from each', () => {
    document.body.innerHTML = CHIP + TILE;
    const imgs = Array.from(document.querySelectorAll('img'));
    expect(imgs).toHaveLength(2);
    for (const img of imgs) expect(isMediaImage(img)).toBe(true);
  });

  it('does not call page furniture media', () => {
    document.body.innerHTML = `
      <img src="https://ssl.gstatic.com/gb/images/ring/pr_32px.png">
      <img src="https://lh3.googleusercontent.com/ogw/AF2bZyj=s64">`;
    for (const img of Array.from(document.querySelectorAll('img'))) {
      expect(isMediaImage(img)).toBe(false);
    }
  });

  it('builds a selector that finds the new images', () => {
    document.body.innerHTML = CHIP + TILE;
    expect(document.querySelectorAll(MEDIA_IMG_SELECTOR)).toHaveLength(2);
    /* The measurement that started this: the old selector finds none of them. */
    expect(document.querySelectorAll('img[src*="getMediaUrlRedirect"]')).toHaveLength(0);
  });
});

describe('ingredients, counted by component', () => {
  it('counts each chip once despite the two nested elements', () => {
    /* flow-ingredient-chip wraps flow-image-ingredient-chip. Selecting both
       and counting the result double-counts every ingredient. */
    document.body.innerHTML = CHIP + CHIP + CHIP;
    expect(document.querySelectorAll(
      `${FLOW_TAGS.ingredientChip}, ${FLOW_TAGS.imageIngredientChip}`,
    )).toHaveLength(6);
    expect(ingredientChips(document)).toHaveLength(3);
  });

  it('is what attachedCount reports', () => {
    document.body.innerHTML = CHIP + CHIP;
    expect(attachedCount(document)).toBe(2);
  });

  it('reports none when the prompt is empty', () => {
    document.body.innerHTML = '<div>nothing here</div>';
    expect(attachedCount(document)).toBe(0);
  });

  it('still counts the old site, where there are no components', () => {
    /* The URL path is the fallback, not the primary — but it has to keep
       working for anyone still on labs.google. */
    document.body.innerHTML = `
      <div><div><div><div contenteditable="true"></div>
        <img src="https://labs.google/fx/api/trpc/media.getMediaUrlRedirect?name=a">
        <img src="https://labs.google/fx/api/trpc/media.getMediaUrlRedirect?name=b">
      </div></div></div>`;
    expect(attachedCount(document)).toBe(2);
  });
});

describe('tiles', () => {
  it('finds video and still tiles by name', () => {
    document.body.innerHTML = TILE + '<flow-image-tile><img alt="x"></flow-image-tile>';
    expect(tiles(document)).toHaveLength(2);
  });
});

describe('telling the two Flows apart', () => {
  it('recognises the Angular one', () => {
    document.body.innerHTML = '<flow-project-page></flow-project-page>';
    expect(isNewFlow(document)).toBe(true);
  });

  it('recognises it from a CDK overlay alone', () => {
    document.body.innerHTML = '<div class="cdk-overlay-container"></div>';
    expect(isNewFlow(document)).toBe(true);
  });

  it('does not mistake the old one for it', () => {
    document.body.innerHTML = '<div id="__next"><button role="tab">Image</button></div>';
    expect(isNewFlow(document)).toBe(false);
  });
});

describe('the vocabulary itself', () => {
  it('names the components the page actually declares', () => {
    /* Verified present on a live project. If one of these disappears, the
       method for finding its replacement is in flowDom.ts's header. */
    const seen = [
      'flow-prompt-box', 'flow-rich-text-editor', 'flow-generate-icon-button',
      'flow-ingredient-chip', 'flow-image-ingredient-chip',
      'flow-video-tile', 'flow-image-tile', 'flow-tile-container',
      'flow-media-upload', 'flow-add-menu', 'flow-search-bar',
    ];
    const declared = Object.values(FLOW_TAGS) as string[];
    for (const tag of seen) {
      expect({ tag, known: declared.includes(tag) }).toEqual({ tag, known: true });
    }
  });

  it('is all flow- prefixed, so nothing generic crept in', () => {
    for (const tag of Object.values(FLOW_TAGS) as string[]) {
      expect(tag.startsWith('flow-')).toBe(true);
    }
  });
});
