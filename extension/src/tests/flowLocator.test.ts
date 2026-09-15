/**
 * @jest-environment jsdom
 *
 * A locator has to find its tile again.
 *
 * The grid gives a tile no id, and an attribute written onto it does not
 * survive Angular re-rendering — measured, 0 of 3 tags left after navigating
 * away and back. So a tile is found again by the one thing the framework
 * re-renders faithfully: the media token inside its thumbnail URL.
 *
 *   flow-video-tile:has([src*="<token>"])
 *
 * That puts a hard contract on mediaTokenOf: whatever it returns MUST be a
 * substring of the src of something inside the tile. Anything else compiles,
 * type-checks, reads perfectly well, and silently matches nothing.
 *
 * ── What actually broke, and what did not ─────────────────────────────────
 *
 * The real failure is the OMNI case at the bottom of this file: a tile whose
 * media is a bare <video>, with no <img> anywhere. Every reader here looked
 * only at <img>, so those tiles produced no token at all.
 *
 * A second theory was investigated first and was WRONG, which is worth
 * recording so it is not re-derived. mediaTokenOf had been changed to prefer
 * the tile's data-media-id, and that looked like it would break the /asb/
 * locator. Measured on three live video tiles: data-media-id is null on all
 * of them — video tiles do not carry it, so mediaTokenOf fell through to the
 * URL token exactly as before and nothing broke.
 *
 * The split between the two ideas is kept anyway, because the contract above
 * was real and unenforced: mediaTokenOf answers "how do I find this element
 * again", mediaIdOf answers "what is this generation called". The tests run
 * the locator against a real DOM, which is the only way to catch a selector
 * that is well-formed and wrong.
 */

/// <reference types="node" />

import * as fs from 'fs';
import * as path from 'path';
import { locatorFor, mediaTokenOf, mediaIdOf, videoSrcOf, hasExpired } from '../content/flowTiles';

const mount = (html: string): Element => {
  document.body.innerHTML = `<div class="batch-container">${html}</div>`;
  return document.querySelector('flow-video-tile, flow-image-tile')!;
};

/** A finished video tile: same-origin /asb/ thumbnail, plus a stated id. */
const VIDEO = `
  <flow-video-tile>
    <div class="container">
      <img draggable="false" alt="Tile displaying a user's video" class="image"
           src="https://flow.google.com/asb/AB-nOUYy_bMOxK9wQ=s512-rw"
           data-media-id="9f1c77aa-2b41-4d0e-8c55-6a1b0e2f4d31">
    </div>
  </flow-video-tile>`;

/** A finished image tile: cross-origin signed URL that contains the id. */
const IMAGE = `
  <flow-image-tile>
    <div class="container">
      <img draggable="false" alt="Tile displaying a user's image" class="image"
           src="https://flow-content.google/image/c4b5e39e-92f3-48b4-ac6f-13a4dbbb120f?Expires=1788708929&amp;KeyName=labs-flow-prod-cdn-key&amp;Signature=NaqwnOeTz8"
           data-media-id="c4b5e39e-92f3-48b4-ac6f-13a4dbbb120f">
    </div>
  </flow-image-tile>`;

describe('the locator finds the tile it was made from', () => {
  it('finds a video tile', () => {
    const tile = mount(VIDEO);
    const found = document.querySelector(locatorFor(tile, 'fallback-1'));
    expect(found).toBe(tile);
  });

  it('finds an image tile', () => {
    const tile = mount(IMAGE);
    const found = document.querySelector(locatorFor(tile, 'fallback-1'));
    expect(found).toBe(tile);
  });

  it('picks the right one out of several', () => {
    document.body.innerHTML = `<div class="batch-container">${VIDEO}${IMAGE}</div>`;
    const video = document.querySelector('flow-video-tile')!;
    const image = document.querySelector('flow-image-tile')!;

    expect(document.querySelector(locatorFor(video, 'a'))).toBe(video);
    expect(document.querySelector(locatorFor(image, 'b'))).toBe(image);
  });

  it('does not depend on an attribute we wrote ourselves', () => {
    /* Angular destroys and recreates these elements; a written tag is gone by
       the time anyone looks for it. */
    const tile = mount(VIDEO);
    const locator = locatorFor(tile, 'fallback-1');
    expect(locator).not.toMatch(/data-af-id/);
  });
});

describe('the token the locator is built from', () => {
  it('is always part of the thumbnail URL', () => {
    /* The contract. Break it and the selector is well-formed and matches
       nothing — which is exactly how this failed. */
    for (const html of [VIDEO, IMAGE]) {
      const tile = mount(html);
      const src = tile.querySelector('img')!.getAttribute('src')!;
      const token = mediaTokenOf(tile);
      expect(token).not.toBe('');
      expect(src).toContain(token);
    }
  });

  it('ignores the stated id on a video, whose URL does not contain it', () => {
    const tile = mount(VIDEO);
    expect(mediaTokenOf(tile)).not.toBe('9f1c77aa-2b41-4d0e-8c55-6a1b0e2f4d31');
  });
});

describe('the id used to name a generation', () => {
  it('is the one the page states, when it states one', () => {
    expect(mediaIdOf(mount(VIDEO))).toBe('9f1c77aa-2b41-4d0e-8c55-6a1b0e2f4d31');
    expect(mediaIdOf(mount(IMAGE))).toBe('c4b5e39e-92f3-48b4-ac6f-13a4dbbb120f');
  });

  it('falls back to the URL token when the page states none', () => {
    const tile = mount(`
      <flow-video-tile><div class="container">
        <img class="image" src="https://flow.google.com/asb/AB-nOUYy_bMOxK9wQ=s512-rw">
      </div></flow-video-tile>`);
    expect(mediaIdOf(tile)).toBe(mediaTokenOf(tile));
    expect(mediaIdOf(tile)).not.toBe('');
  });

  it('is distinct from the locator token where the two differ', () => {
    /* If these ever collapse back into one function, one of the two callers
       is wrong — and it will be the silent one. */
    const tile = mount(VIDEO);
    expect(mediaIdOf(tile)).not.toBe(mediaTokenOf(tile));
  });
});

/**
 * The tile that renders the video itself.
 *
 * An Omni generation has no <img> anywhere. The whole tile is:
 *
 *   <flow-video-tile><div class="container">
 *     <video preload="auto" loop aria-label="Generated video"
 *            src="https://flow-content.google/video/331e1048-…?Expires=…&Signature=…">
 *
 * Every reader here looked only at <img>, so these tiles came back with no
 * token — which meant a positional id and a locator built from an attribute
 * we write ourselves, the one Angular wipes on re-render. Preview had nothing
 * to play and download had nothing to fetch.
 */
const OMNI = `
  <flow-video-tile>
    <div class="container">
      <video disablepictureinpicture loop preload="auto" aria-label="Generated video"
             src="https://flow-content.google/video/331e1048-2e2d-4cff-8967-4523495c66af?Expires=1788712266&amp;KeyName=labs-flow-prod-cdn-key&amp;Signature=SGk6uSt3tj"
             controlslist="nodownload noremoteplayback noplaybackrate"></video>
    </div>
  </flow-video-tile>`;

describe('a tile whose media is a video element', () => {
  it('still yields a token', () => {
    const tile = mount(OMNI);
    expect(mediaTokenOf(tile)).toBe('331e1048-2e2d-4cff-8967-4523495c66af');
  });

  it('is found again by its locator', () => {
    const tile = mount(OMNI);
    expect(document.querySelector(locatorFor(tile, 'fallback'))).toBe(tile);
  });

  it('does not fall back to a tag we wrote ourselves', () => {
    /* That tag is what Angular wipes; a locator built from it finds nothing
       the next time anyone looks. */
    const tile = mount(OMNI);
    expect(locatorFor(tile, 'fallback')).not.toMatch(/data-af-id/);
  });

  it('matches on the element that actually carries the src', () => {
    /* :has(img[...]) cannot match a tile with no img in it. */
    const tile = mount(OMNI);
    expect(locatorFor(tile, 'fallback')).not.toMatch(/has\(img/);
  });

  it('keeps working for a tile that does have an image', () => {
    const tile = mount(VIDEO);
    expect(document.querySelector(locatorFor(tile, 'fallback'))).toBe(tile);
  });

  it('reads the image first when a tile has both', () => {
    /* A hovered tile grows a <video> beside its thumbnail; the thumbnail is
       the stable one, so it stays the identity. */
    const tile = mount(`
      <flow-video-tile><div class="container">
        <img class="image" src="https://flow.google.com/asb/AB-nOUYy_bMOxK9wQ=s512-rw">
        <video src="https://flow.google.com/asb/AB-nOUYy_bMOxK9wQ=mm,22,15"></video>
      </div></flow-video-tile>`);
    expect(mediaTokenOf(tile)).toBe('AB-nOUYy_bMOxK9wQ');
  });
});

/**
 * Where a video URL comes from — and a mistake worth not repeating.
 *
 * A tile that has rendered its video carries the URL outright, and it plays:
 * pasted into a browser it redirects to a signed googlevideo one.
 *
 *   <video preload="auto" src="https://flow.google.com/asb/AB-nOU…=mm,22,15">
 *
 * A tile that has NOT rendered one still yields it, because the thumbnail is
 * the same token: cut at "=", append the format suffix.
 *
 * ── The mistake ───────────────────────────────────────────────────────────
 *
 * That derivation was deleted once, on this reasoning: fetching the derived
 * URL from the page THREW, while the thumbnail alone returned 200 — so the
 * derived one must be invalid.
 *
 * It is not. A real video URL throws under fetch too, because it redirects to
 * googlevideo.com, which sends no CORS headers. BOTH throw. The test could
 * not distinguish them and proved nothing, and a working path was removed on
 * the strength of it.
 *
 * What settles it is comparing the two directly, on live tiles carrying both
 * an <img> and a <video>:
 *
 *   thumbnail contains "="        false
 *   derived === the <video> src   TRUE
 *
 * Byte for byte identical to what Flow itself uses.
 */
describe('deriving the video URL from the thumbnail', () => {
  it('prefers a video element the page has already rendered', () => {
    const tile = mount(OMNI);
    expect(videoSrcOf(tile)).toContain('flow-content.google/video/331e1048');
  });

  it('derives one from the thumbnail when there is no video yet', () => {
    const tile = mount(VIDEO);
    expect(videoSrcOf(tile)).toBe('https://flow.google.com/asb/AB-nOUYy_bMOxK9wQ=mm,22,15');
  });

  it('appends to the whole URL when the thumbnail has no suffix', () => {
    /* The live shape: these thumbnails carry no "=" at all, so the cut
       returns everything and the suffix goes on the end. */
    const tile = mount(`
      <flow-video-tile><div class="container">
        <img class="image" src="https://flow.google.com/asb/AB-nOUanQ2zN3TnP">
      </div></flow-video-tile>`);
    expect(videoSrcOf(tile)).toBe('https://flow.google.com/asb/AB-nOUanQ2zN3TnP=mm,22,15');
  });

  it('derives nothing for an image tile', () => {
    expect(videoSrcOf(mount(IMAGE))).toBe('');
  });

  it('derives nothing from a thumbnail on another host', () => {
    /* Only the /asb/ token has this relationship; a signed content URL does
       not, and inventing one there would be the error above for real. */
    const tile = mount(`
      <flow-video-tile><div class="container">
        <img class="image" src="https://flow-content.google/image/abc?Signature=x">
      </div></flow-video-tile>`);
    expect(videoSrcOf(tile)).toBe('');
  });
});

describe('a URL that has an expiry on it', () => {
  const past = 'https://flow-content.google/video/a?Expires=1000000000&Signature=x';
  const future = 'https://flow-content.google/video/a?Expires=99999999999&Signature=x';

  it('is recognised as dead once the time has passed', () => {
    expect(hasExpired(past)).toBe(true);
  });

  it('is left alone while it is still good', () => {
    expect(hasExpired(future)).toBe(false);
  });

  it('does not treat a URL without an expiry as dead', () => {
    /* The /asb/ URLs carry none and are stable for the life of the media. */
    expect(hasExpired('https://flow.google.com/asb/AB-nOU=mm,22,15')).toBe(false);
  });
});

/**
 * A preview must not download anything.
 *
 * A tile carries its own video once Flow renders it:
 *
 *   <video preload="auto" src="https://flow.google.com/asb/AB-nOU…=mm,22,15">
 *
 * and that URL plays — pasted into a browser it redirects to a signed
 * googlevideo one and the video comes up. So the suffix is real; what was
 * wrong before was BUILDING that URL out of a thumbnail, which produced
 * something the server refuses. Flow's own URL works, an invented one does
 * not, and both of those were measured.
 *
 * The URL only exists after the row renders, though, and a scan reads rows as
 * they scroll past — so anything below the first screen was recorded without
 * one. The fallback that filled the gap drove Flow's download menu to make it
 * issue a URL, which downloads a video in order to look at it. Right
 * mechanism for fetching a file, wrong one for a preview.
 *
 * So the page is asked for the URL the tile is holding now.
 */
describe('getting a URL without downloading', () => {
  const CONTENT = fs.readFileSync(
    path.resolve(__dirname, '../content/index.ts'), 'utf8').replace(/\r\n/g, '\n');
  const SIDE = fs.readFileSync(
    path.resolve(__dirname, '../sidepanel/index.ts'), 'utf8').replace(/\r\n/g, '\n');
  const bare = (x: string) =>
    x.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

  it('reads the tile that is on the page', () => {
    expect(bare(CONTENT)).toMatch(/async function liveVideoSrc\(/);
    expect(bare(CONTENT)).toMatch(/querySelector\('video'\)/);
  });

  it('brings the row into view first', () => {
    /* Flow renders a row's video when the row is on screen; a tile scrolled
       away has nothing to read. */
    const fnBody = bare(CONTENT).slice(bare(CONTENT).indexOf('async function liveVideoSrc('));
    expect(fnBody.slice(0, 2600)).toMatch(/scrollIntoView/);
  });

  it('waits for it rather than asking once', () => {
    const fnBody = bare(CONTENT).slice(bare(CONTENT).indexOf('async function liveVideoSrc('));
    expect(fnBody.slice(0, 2600)).toMatch(/waited < timeoutMs/);
  });

  it('gives up instead of hanging', () => {
    const fnBody = bare(CONTENT).slice(bare(CONTENT).indexOf('async function liveVideoSrc('));
    expect(fnBody.slice(0, 2600)).toMatch(/return '';/);
  });

  it('is what the preview uses — not the download menu', () => {
    const play = bare(SIDE).slice(bare(SIDE).indexOf("type: 'FETCH_ASSET_VIDEO'") - 3000);
    expect(play.slice(0, 3200)).toMatch(/GET_TILE_VIDEO_SRC/);
    expect(play.slice(0, 3200)).not.toMatch(/CAPTURE_ASSET_VIDEO_URL/);
  });

  it('is tried by the downloader before the menu', () => {
    /* Scoped to the download loop. The FIRST downloadAssetByMenu in this
       function belongs to the upscale phase above it, which runs only for
       1080p and 4K and legitimately has to use the menu. */
    const src = bare(CONTENT);
    const dl = src.slice(src.indexOf('async function downloadSelected('));
    expect(dl.indexOf('liveVideoSrc(asset.locator)'))
      .toBeLessThan(dl.lastIndexOf('downloadAssetByMenu(asset.locator'));
  });

  it('only fills a gap, never replaces a URL already known', () => {
    const dl = bare(CONTENT).slice(bare(CONTENT).indexOf('async function downloadSelected('));
    expect(dl).toMatch(/!\(asset as any\)\.videoSrc && wantsOriginal/);
  });
});
