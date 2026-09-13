/**
 * What Flow's page is made of, read off the live site.
 *
 * ── Why this file exists ──────────────────────────────────────────────────
 *
 * Flow was rebuilt. The old site was a Next.js app on labs.google whose
 * markup gave nothing to hold on to — styled-component class hashes that
 * changed on every deploy — so this codebase learned to find things by text,
 * by Material icon ligature, and by structure. That was the right answer for
 * that page, and the comments across selectors.ts are the scars of learning it.
 *
 * The site on flow.google.com is an Angular app, and it ships SEMANTIC CUSTOM
 * ELEMENT NAMES. A tile is a <flow-video-tile>. An ingredient is a
 * <flow-ingredient-chip>. These are component names, not styling — they do not
 * change when someone restyles a button, and they say what a thing IS rather
 * than what it looks like or what words happen to be printed on it.
 *
 * That makes them the best anchors this project has ever had, and better than
 * anything else in here. Everything below was verified in a real signed-in
 * Chrome on a real project — the counts are what was on screen at the time.
 *
 * ── How to check one of these again ───────────────────────────────────────
 *
 * Open a project and run, in the page console:
 *
 *     const t = {};
 *     for (const el of document.querySelectorAll('*')) {
 *       const n = el.tagName.toLowerCase();
 *       if (n.startsWith('flow-')) t[n] = (t[n] || 0) + 1;
 *     }
 *     console.table(t);
 *
 * That is the whole method. It took one command to find what several rounds of
 * guessing had not.
 */

/**
 * Flow's own components, as the live page declares them.
 *
 * Grouped by what they are for rather than alphabetically, because the useful
 * question is "what do I hold on to for X" and not "does flow-banner exist".
 */
export const FLOW_TAGS = {
  /* ── The composer ── */
  promptBox: 'flow-prompt-box',
  promptBoxBase: 'flow-base-prompt-box',
  promptEditor: 'flow-rich-text-editor',
  generateButton: 'flow-generate-icon-button',
  addMenu: 'flow-add-menu',
  agentToggle: 'flow-agent-mode-toggle-chip',

  /* ── Ingredients attached to the prompt ──
     Two nested elements: flow-ingredient-chip wraps a typed inner chip, which
     holds <button class="chip-container" aria-label="Ingredient">.

     A STILL puts <img alt="Ingredient image"> inside it. A CLIP puts

       <flow-video-ingredient-chip>
         <button class="chip-container" aria-label="Ingredient" aria-busy="false">
           <div class="chip-image-wrapper">
             <video muted playsinline class="chip-video" src="…flow-content.google/video/…">
           <mat-icon class="type-badge">videocam</mat-icon>

     — read off the live page. No <img> anywhere in it, which is what made a
     video ingredient invisible to anything that asked for one. */
  ingredientChip: 'flow-ingredient-chip',
  imageIngredientChip: 'flow-image-ingredient-chip',
  videoIngredientChip: 'flow-video-ingredient-chip',

  /* ── Generated results ──
     A tile holds <img class="thumbnail" alt="Generated video thumbnail">,
     sourced from flow.google.com/asb/… rather than the media host. */
  videoTile: 'flow-video-tile',
  imageTile: 'flow-image-tile',
  tileContainer: 'flow-tile-container',
  gridTileContainer: 'flow-grid-tile-container',
  tileHoverFooter: 'flow-tile-hover-footer',
  videoHotbar: 'flow-video-hotbar',
  imageHotbar: 'flow-image-hotbar',
  batchInfo: 'flow-batch-info',

  /* ── Everything else worth naming ── */
  mediaUpload: 'flow-media-upload',
  trashMenu: 'flow-media-trash-context-menu',
  searchBar: 'flow-search-bar',
  sidenav: 'flow-project-sidenav-container',
  projectPage: 'flow-project-page',
  creditBanner: 'flow-credit-banner',
} as const;

/**
 * Where Flow serves media from now, and where it used to.
 *
 * The old code looked for `img[src*="getMediaUrlRedirect"]`, which was the
 * tRPC endpoint on labs.google. Measured on the live page, that selector now
 * matches ZERO images while the real ones match four. The whole tRPC API is
 * gone: the new app talks to `/_/AiSandboxAngularFrontend/data/batchexecute`,
 * Google's internal batch RPC, and nothing on the page requests
 * labs.google/fx/api at all.
 *
 * Media arrives from two different places, which matters because they are not
 * interchangeable:
 *
 *   flow-content.google/image/<uuid>?Expires=…   ingredient chips — signed,
 *                                                and the signature expires
 *   flow.google.com/asb/<opaque>                 tile thumbnails
 *
 * The old pattern is kept in the list so a user still on labs.google — where
 * the old site continues to resolve — is not broken by the fix for the new one.
 */
export const MEDIA_SRC_PATTERNS = [
  'flow-content.google',
  '/asb/',
  'getMediaUrlRedirect',
] as const;

/** A selector matching a Flow media image on either the old site or the new. */
export const MEDIA_IMG_SELECTOR = MEDIA_SRC_PATTERNS
  .map((p) => `img[src*="${p}"]`)
  .join(', ');

/** True when this image is Flow media rather than page furniture. */
export function isMediaImage(img: Element): boolean {
  const src = (img as HTMLImageElement).currentSrc || img.getAttribute('src') || '';
  return MEDIA_SRC_PATTERNS.some((p) => src.includes(p));
}

/**
 * Ingredients currently attached to the prompt.
 *
 * Counted by component rather than by image URL. The URL test broke the moment
 * the media host changed, and it was measuring the wrong thing anyway: an
 * ingredient is an ingredient because it is an ingredient chip, not because of
 * where its thumbnail happens to be served from.
 */
/**
 * Where the COMPOSER keeps its ingredients.
 *
 * Read off the live page. The prompt box holds them in its own container:
 *
 *   .base-prompt-box
 *     .prompt-top-row.has-ingredient-bar
 *       flow-ingredient-bar.prompt-ingredient-bar
 *         div.ingredient-bar-container      ← the chips attached to THIS prompt
 *
 * In Frames mode the same container holds the Start/End frame-triggers
 * instead, which is why it is the right anchor for both.
 */
const COMPOSER_BAR = 'flow-ingredient-bar .ingredient-bar-container, .ingredient-bar-container';

/**
 * Where a FINISHED BATCH lists the ingredients it was made from.
 *
 * A different thing entirely, in the grid rather than the composer:
 *
 *   .batch-container
 *     flow-batch-info
 *       .ingredients-list
 *         flow-ingredient-chip → flow-image-ingredient-chip
 *
 * Identical components, so a tag query cannot tell them apart. The composer's
 * chip offers `cancel` on hover; a batch's offers `add`, because clicking it
 * copies that ingredient back into the prompt.
 */
const BATCH_INGREDIENTS = 'flow-batch-info, .batch-container, .ingredients-list';

export function ingredientChips(doc: Document = document): HTMLElement[] {
  /* Scoped to the composer, and NOT to the document.
   *
   * A document-wide query counted every past batch's ingredients as if they
   * were attached to the prompt — and Flow's grid is virtualised, so batches
   * mount and unmount as it scrolls and the number moves on its own. The
   * upload wait computes its target as "what is attached now, plus the one I
   * am adding", so it inherited that:
   *
   *   Waiting 41s for reference image(s): 5/7 loaded, 5 chip(s) attached.
   *
   * Seven wanted, five ever possible. Six were mounted when the target was
   * taken; five a moment later. It could never be satisfied, and every
   * ingredient upload sat out its whole budget before falling back.
   */
  const bar = doc.querySelector<HTMLElement>(COMPOSER_BAR);
  const scope: ParentNode = bar || doc;
  const found = scope.querySelectorAll<HTMLElement>(
    `${FLOW_TAGS.imageIngredientChip}, ${FLOW_TAGS.videoIngredientChip}, `
    + `${FLOW_TAGS.ingredientChip}`,
  );
  const mine = Array.from(found).filter((el) => !el.closest(BATCH_INGREDIENTS));
  /* The two nest, so counting both double-counts. Keep only the outermost. */
  return mine.filter(
    (el) => !mine.some((other) => other !== el && other.contains(el)),
  );
}

/** Generated tiles on the page, video and still. */
export function tiles(doc: Document = document): HTMLElement[] {
  return Array.from(doc.querySelectorAll<HTMLElement>(
    `${FLOW_TAGS.videoTile}, ${FLOW_TAGS.imageTile}`,
  ));
}

/** True when the page is the Angular Flow rather than the old Next.js one. */
export function isNewFlow(doc: Document = document): boolean {
  return !!doc.querySelector(`${FLOW_TAGS.projectPage}, ${FLOW_TAGS.promptBox}`)
    || !!doc.querySelector('.cdk-overlay-container');
}
