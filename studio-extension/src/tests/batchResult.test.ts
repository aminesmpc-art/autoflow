/**
 * @jest-environment jsdom
 *
 * "the image genereted but the bot not find it" and "the api is send the
 * generetion complete and the page show the video and he dont get the video".
 *
 * Both fixtures below are the live grid's own HTML. They share one structure,
 * and that structure is the whole answer:
 *
 *   <div class="batch-container virtual-item-container">
 *     <div class="batch-tiles-section">          THE RESULT
 *       <flow-image-tile><img class="image" data-media-id="…" src="…/asb/…">
 *       …or…
 *       <flow-video-tile><video src="…/asb/…=mm,22,15">
 *     <flow-batch-info>                          everything ABOUT it
 *       <flow-expandable-prompt>                 the prompt
 *       <div class="ingredients-list">           the INPUT pictures
 *         <flow-image-ingredient-chip>
 *           <img class="chip-image" alt="Ingredient image" src="…">
 *       <div class="metadata">                   model • 720p • 6s • 9:16
 *
 * Every read was scanning the whole batch, so the INPUT chips got a vote on
 * whether the OUTPUT existed. Two ways that goes wrong and both were seen:
 *
 *   an image batch  reads as finished the moment its own ingredient renders,
 *                   before the generation has produced anything
 *   a video batch   whose clip has not attached finds a chip image, decides it
 *                   is a poster, and calls itself "thumbnail-only" — the state
 *                   that then waited 150 seconds for a player to mount
 *
 * The exclusion that was supposed to prevent this matched on alt text:
 *
 *   /generated or uploaded by you|present in your collection/i
 *
 * which is the OLD site's wording. The current chip says "Ingredient image"
 * and matched none of it — an exclusion list failing the way they do, silently,
 * and only once the site has moved on.
 */

/// <reference types="node" />

import { getStudioTileState, findLargestImgSrc, resultArea, isIngredientImg } from '../content/flow/tileState';

const chip = (uuid: string) =>
  `<flow-ingredient-chip><flow-image-ingredient-chip><button cdkoverlayorigin class="chip-container" aria-label="Ingredient" aria-busy="false"><div class="chip-image-wrapper"><img alt="Ingredient image" class="chip-image" src="https://flow-content.google/image/${uuid}?Expires=1788915425&amp;Signature=x"></div><div class="hover-icon-overlay" data-state="closed"><mat-icon class="hover-icon google-symbols">add</mat-icon></div></button></flow-image-ingredient-chip></flow-ingredient-chip>`;

const batchInfo = (prompt: string, chips: string, meta: string) =>
  `<flow-batch-info><div class="batch-toolbar"><button aria-label="Download batch"><mat-icon class="google-symbols">download</mat-icon></button><button aria-label="Reuse prompt"><mat-icon class="google-symbols">undo</mat-icon></button><button aria-label="Trash batch"><mat-icon class="google-symbols">delete</mat-icon></button></div><div class="below-toolbar"><flow-expandable-prompt class="prompt inline"><div class="expandable-prompt-container"><div class="prompt-text"><span class="text-part">${prompt}</span></div><div class="prompt-actions"><button class="action-button reuse-prompt-button" aria-label="Reuse prompt"><mat-icon class="google-symbols">keyboard_return</mat-icon></button></div></div></flow-expandable-prompt><div class="ingredients-list">${chips}</div><div class="metadata"><div class="metadata-row"> Created Sep 8, 2026 </div><div class="metadata-row">${meta}</div></div></div></flow-batch-info>`;

/** A finished IMAGE batch, verbatim in shape. */
const IMAGE_BATCH = `<div class="batch-container virtual-item-container"><div class="batch-tiles-section"><div class="tile-row" style="height: 331.215px;"><flow-grid-tile-container class="mat-context-menu-trigger" aria-label="Person holding product"><flow-tile-container><div class="container"><flow-image-tile><div class="container"><img draggable="false" alt="Tile displaying a user's image" class="image" src="https://flow.google.com/asb/AB-nOUY3dxAx0T4NplFiSn1lDUCQwYRam=s512-rw" data-media-id="cde09780-39da-4329-bd6d-a1eccdf3bbac" style="aspect-ratio: 0.5625 / 1;"><div class="pre-hover-overlay"></div><div class="footer-overlay"><flow-tile-hover-footer class="project-tile-hover-footer"><div tabindex="0" role="button" cdkoverlayorigin class="footer-left"><mat-icon class="footer-icon google-symbols">image</mat-icon><span class="footer-title">Person holding product</span></div></flow-tile-hover-footer></div></div></flow-image-tile></div></flow-tile-container></flow-grid-tile-container></div></div>${batchInfo('A person holding the product in a sunlit kitchen.', chip('c3d7a1cd-8666-41b5-8b67-094ea666e8b3'), '<span>🍌 Nano Banana Pro</span><span>9:16</span>')}</div>`;

/** A finished VIDEO batch. Note it carries a .progress-bar at 0% — that is the
    player's own scrubber, not a generation badge. */
const VIDEO_BATCH = `<div class="batch-container virtual-item-container"><div class="batch-tiles-section"><div class="tile-row" style="height: 331.215px;"><flow-grid-tile-container class="mat-context-menu-trigger" aria-label="Person showing product to camera"><flow-tile-container><div class="container"><flow-video-tile><div class="container"><video disablepictureinpicture preload="auto" aria-label="Generated video" src="https://flow.google.com/asb/AB-nOUZD2QPfu7xg2nyiumBqt2i5d3XK=mm,22,15" loop controlslist="nodownload noremoteplayback noplaybackrate"></video><div class="pre-hover-overlay"><div class="type-icon-container"><mat-icon class="fill google-symbols">play_circle</mat-icon></div></div><div class="footer-overlay-has-progress-bar"><flow-tile-hover-footer class="project-tile-hover-footer"><div tabindex="0" role="button" cdkoverlayorigin class="footer-left"><mat-icon class="footer-icon google-symbols">play_circle</mat-icon><span class="footer-title">Person showing product to camera</span></div></flow-tile-hover-footer></div><div class="progress-bar" style="--progress-percent: 0%;"><div class="progress-bar-track"><div class="progress-bar-fill"></div><div class="progress-bar-dot"></div></div></div></div></flow-video-tile></div></flow-tile-container></flow-grid-tile-container></div></div>${batchInfo('Handheld UGC-style video of this exact scene.', chip('ebfc2220-1f12-400b-a6a0-0e1f3e514d91') + chip('504bfbde-eb74-4c7f-a4e9-1a76ee865528'), '<span>Omni 1.1 Flash</span><span>720p</span><span>6s</span><span>9:16</span>')}</div>`;

/** The same video batch a moment earlier: chips in, clip not attached yet. */
const VIDEO_BATCH_PENDING = VIDEO_BATCH.replace(
  /<video[^>]*><\/video>/,
  '<video disablepictureinpicture preload="auto" aria-label="Generated video" loop></video>');

/* jsdom lays nothing out and these read boxes. */
const realRect = Element.prototype.getBoundingClientRect;
beforeAll(() => {
  Element.prototype.getBoundingClientRect = function () {
    const isChip = (this as Element).classList?.contains('chip-image');
    const n = isChip ? 40 : 180;
    return { width: n, height: n, top: 0, left: 0, right: n, bottom: n, x: 0, y: 0,
      toJSON: () => ({}) } as DOMRect;
  };
});
afterAll(() => { Element.prototype.getBoundingClientRect = realRect; });

const mount = (html: string) => {
  document.body.innerHTML = html;
  return document.querySelector('.batch-container') as HTMLElement;
};

describe('telling the result from what it was made of', () => {
  it('finds the result half of a batch', () => {
    const batch = mount(IMAGE_BATCH);
    expect(resultArea(batch).className).toContain('batch-tiles-section');
  });

  it('falls back to the element itself when handed an inner tile', () => {
    /* Callers pass the batch sometimes and the tile itself other times. */
    mount(IMAGE_BATCH);
    const tile = document.querySelector('flow-image-tile')!;
    expect(resultArea(tile)).toBe(tile);
  });

  it('knows a chip is an input, by where it lives', () => {
    mount(VIDEO_BATCH);
    const chipImg = document.querySelector('img.chip-image')!;
    expect(isIngredientImg(chipImg)).toBe(true);
  });

  it('does not mistake the result image for an input', () => {
    mount(IMAGE_BATCH);
    const result = document.querySelector('img.image')!;
    expect(isIngredientImg(result)).toBe(false);
  });

  it('no longer relies on the old site\'s alt wording', () => {
    /* The current chip says "Ingredient image"; the list said "generated or
       uploaded by you". Structure is what survives a redesign. */
    mount(VIDEO_BATCH);
    const chipImg = document.querySelector('img.chip-image')!;
    expect(chipImg.getAttribute('alt')).toBe('Ingredient image');
    expect(isIngredientImg(chipImg)).toBe(true);
  });
});

describe('a finished image batch', () => {
  it('reads as completed', () => {
    expect(getStudioTileState(mount(IMAGE_BATCH), false)).toBe('completed');
  });

  it('hands back the generated image, not the reference it was given', () => {
    const src = findLargestImgSrc(mount(IMAGE_BATCH));
    expect(src).toContain('/asb/');
    expect(src).not.toContain('chip');
    expect(src).not.toContain('flow-content.google/image/');
  });

  it('carries its media id on the result img', () => {
    /* Present on an image tile, unlike a video one. Worth knowing: it is the
       one exact identifier a still batch offers. */
    mount(IMAGE_BATCH);
    expect(document.querySelector('img.image')!.getAttribute('data-media-id'))
      .toBe('cde09780-39da-4329-bd6d-a1eccdf3bbac');
  });
});

describe('a finished video batch', () => {
  it('reads as completed, not thumbnail-only', () => {
    /* The 150-second wait. The clip is right there with a src on it. */
    expect(getStudioTileState(mount(VIDEO_BATCH), true)).toBe('completed');
  });

  it('is not fooled by the player\'s own scrub bar', () => {
    /* A finished clip carries .progress-bar at --progress-percent: 0%. That is
       the scrubber, not a generation badge — reading it as progress would make
       every finished video look like one that had not started. */
    mount(VIDEO_BATCH);
    expect(document.querySelector('.progress-bar')).not.toBeNull();
    expect(getStudioTileState(document.querySelector('.batch-container')!, true)).toBe('completed');
  });

  it('still reports thumbnail-only while the clip is genuinely missing', () => {
    /* The state has to keep working — this is the poster race it was named
       for. What must NOT cause it is an ingredient chip. */
    expect(getStudioTileState(mount(VIDEO_BATCH_PENDING), true)).not.toBe('completed');
  });
});

/* ── Where those reads happen ─────────────────────────────────────────────── */

import { readFileSync } from 'fs';
import { join } from 'path';

const IDX = readFileSync(
  join(__dirname, '..', 'content', 'flow', 'index.ts'), 'utf8').replace(/\r\n/g, '\n');

describe('the extractors read the result half too', () => {
  it('takes the clip from the result, not from anywhere in the batch', () => {
    const at = IDX.indexOf('function extractTileMediaUrl');
    const body = IDX.slice(at, at + 900);
    expect(body).toMatch(/const video = resultArea\(tile\)\.querySelector\('video'\);/);
  });

  it('takes the preview poster from there as well', () => {
    const at = IDX.indexOf('function extractTilePreviewSrc');
    const body = IDX.slice(at, at + 400);
    expect(body).toMatch(/resultArea\(tile\)\.querySelector\('video'\)/);
  });
});

/* ── "why we still have this beelshit problem whyyyy" ────────────────────
 *
 *   Waiting 41s for reference image(s): 5/7 loaded, 5 chip(s) attached.
 *
 * Seven wanted; five ever possible. The target is "what is attached now, plus
 * the one I am adding", and the count it came from was a document-wide query:
 *
 *   doc.querySelectorAll('flow-image-ingredient-chip, flow-ingredient-chip')
 *
 * which matches the composer's chips AND every past batch's. Flow's grid is
 * virtualised, so batches mount and unmount as it scrolls and that number
 * moves on its own — six when the target was taken, five a moment later. It
 * could never be satisfied, so every upload sat out its whole budget before
 * falling back to the library.
 *
 * The two are identical components. What separates them is where they live,
 * and the hover icon says the same thing out loud: the composer's chip offers
 * `cancel`, a batch's offers `add`, because clicking that one copies the
 * ingredient back into the prompt.
 */
const COMPOSER_BAR = `<div class="base-prompt-box"><div class="prompt-top-row has-ingredient-bar"><flow-ingredient-bar class="prompt-ingredient-bar"><div class="ingredient-bar-container"><flow-ingredient-chip><flow-image-ingredient-chip><button cdkoverlayorigin class="chip-container" aria-label="Ingredient" aria-busy="false"><div class="chip-image-wrapper"><img alt="Ingredient image" class="chip-image" src="https://flow-content.google/image/b5b109ad-f91b-4278-a4ad-4e6440990756?Expires=1&amp;Signature=x"></div><div class="hover-icon-overlay" data-state="closed"><mat-icon class="hover-icon google-symbols">cancel</mat-icon></div></button></flow-image-ingredient-chip></flow-ingredient-chip></div></flow-ingredient-bar></div></div>`;

describe('the composer\'s ingredients are not the grid\'s', () => {
  const { ingredientChips } = require('../content/flow/flowDom');

  it('counts the chip attached to the prompt', () => {
    mount(COMPOSER_BAR);
    expect(ingredientChips(document)).toHaveLength(1);
  });

  it('does not count a finished batch\'s ingredients', () => {
    /* This is the whole bug. Every past generation lists what it was made
       from, in identical components. */
    document.body.innerHTML = COMPOSER_BAR + VIDEO_BATCH;
    expect(ingredientChips(document)).toHaveLength(1);
  });

  it('counts none when the composer bar is empty, whatever the grid holds', () => {
    document.body.innerHTML =
      '<div class="base-prompt-box"><flow-ingredient-bar><div class="ingredient-bar-container"></div></flow-ingredient-bar></div>'
      + VIDEO_BATCH + IMAGE_BATCH;
    expect(ingredientChips(document)).toHaveLength(0);
  });

  it('is not thrown off by how many batches happen to be mounted', () => {
    /* The virtualised grid mounts and unmounts as it scrolls, which is why the
       old count moved between one poll and the next. */
    document.body.innerHTML = COMPOSER_BAR + VIDEO_BATCH + IMAGE_BATCH + VIDEO_BATCH;
    const many = ingredientChips(document).length;
    document.body.innerHTML = COMPOSER_BAR;
    expect(ingredientChips(document).length).toBe(many);
  });

  it('excludes batch chips even with no composer bar to scope to', () => {
    /* Belt and braces: the scope and the exclusion each suffice alone, so a
       renamed container cannot bring the bug back on its own. */
    document.body.innerHTML = VIDEO_BATCH;
    expect(ingredientChips(document)).toHaveLength(0);
  });
});

/* ── "is not showing the video why is just photo" ────────────────────────
 *
 * The node had the clip. It showed a still with "▶ Video — open in Flow to
 * play" under it, and the clip played perfectly when the URL was opened by
 * hand — which is the whole tell: the address was right, the bytes were not
 * reachable.
 *
 * Flow moved where it serves a finished clip from:
 *
 *   was   https://flow.google.com/asb/<token>=mm,22,15      SAME origin as the page
 *   now   https://flow-content.google/video/<uuid>?Expires=…&Signature=…
 *
 * buildStudioVideoData fetches that URL from the CONTENT SCRIPT to inline it
 * as the node's playable preview. In MV3 a content script's cross-origin
 * fetch follows the PAGE's CORS rules, not the extension's — so the second
 * form cannot succeed there however many permissions the extension holds. It
 * returned '' and only console.warn'd, so the canvas fell back to the still
 * and nothing anywhere said why.
 *
 * And flow-content.google was not in host_permissions at all, so even the
 * worker could not have fetched it. Both halves of one bug.
 */
describe('a finished clip reaches the canvas playable', () => {
  const IDX2 = readFileSync(
    join(__dirname, '..', 'content', 'flow', 'index.ts'), 'utf8').replace(/\r\n/g, '\n');
  const WORKER = readFileSync(
    join(__dirname, '..', 'background', 'service-worker.ts'), 'utf8').replace(/\r\n/g, '\n');
  const MANIFEST = JSON.parse(
    readFileSync(join(__dirname, '..', '..', 'manifest.json'), 'utf8'));

  it('is allowed to reach the media host at all', () => {
    expect(MANIFEST.host_permissions).toContain('https://flow-content.google/*');
  });

  it('keeps the direct fetch, which is free when the clip is same-origin', () => {
    /* A clip still served from flow.google.com/asb/ needs no worker. */
    const at = IDX2.indexOf('async function buildStudioVideoData');
    const body = IDX2.slice(at, at + 2600);
    expect(body).toMatch(/const resp = await fetch\(url\);/);
    expect(body.indexOf('await fetch(url)')).toBeLessThan(body.indexOf('STUDIO_FETCH_MEDIA'));
  });

  it('falls back to the worker, which page CORS does not bind', () => {
    const at = IDX2.indexOf('async function buildStudioVideoData');
    const body = IDX2.slice(at, at + 2600);
    expect(body).toMatch(/type: 'STUDIO_FETCH_MEDIA'/);
  });

  it('accepts only something that is actually a video', () => {
    const at = IDX2.indexOf('async function buildStudioVideoData');
    const body = IDX2.slice(at, at + 2600);
    expect(body).toMatch(/String\(res\.dataUrl\)\.startsWith\('data:video'\)/);
  });

  it('says why the preview is missing, in the feed and not the console', () => {
    /* It console.warn'd, which is the one place nobody watching a run is
       looking — the same fault as the adapter's whole log, one function
       later. */
    const at = IDX2.indexOf('async function buildStudioVideoData');
    const body = IDX2.slice(at, at + 2600);
    expect(body).toMatch(/Could not inline the clip for preview/);
    expect(body).not.toMatch(/console\.warn/);
  });

  it('says the clip itself is fine when only the preview failed', () => {
    /* The node still holds a working URL. Losing the inline player is a
       cosmetic failure and should not read as a lost generation. */
    expect(IDX2).toMatch(/The node keeps the Flow link, and the clip itself is unaffected\./);
  });

  it('has a worker handler that answers asynchronously', () => {
    const at = WORKER.indexOf("if (msg?.type === 'STUDIO_FETCH_MEDIA')");
    expect(at).toBeGreaterThan(-1);
    const body = WORKER.slice(at, at + 1800);
    expect(body).toMatch(/return true; \/\/ async/);
    expect(body).toMatch(/readAsDataURL\(blob\)/);
  });

  it('refuses anything that is not an https url', () => {
    const at = WORKER.indexOf("if (msg?.type === 'STUDIO_FETCH_MEDIA')");
    const body = WORKER.slice(at, at + 1800);
    expect(body).toMatch(/not an https url/);
  });

  it('reports a clip too large rather than returning it', () => {
    const at = WORKER.indexOf("if (msg?.type === 'STUDIO_FETCH_MEDIA')");
    const body = WORKER.slice(at, at + 1800);
    expect(body).toMatch(/too large \(\$\{Math\.round\(blob\.size \/ 1024 \/ 1024\)\}MB\)/);
  });
});
