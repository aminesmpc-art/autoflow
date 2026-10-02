/**
 * Why the library showed a broken-image icon with the label spilled over it.
 *
 * The videos played. The thumbnails did not, and they failed as the browser's
 * own broken-image placeholder — which means an <img> was rendered with a src
 * it could not load. Three separate paths produced one.
 *
 * ── 1. The panel cannot load a flow.google.com URL at all ─────────────────
 *
 * The panel is a chrome-extension:// page. The scanner has always solved this
 * by drawing the loaded image to a canvas and handing over the bytes — but
 * both converters fell back to the raw URL when they could not, which renders
 * as exactly the broken image this is about. Nothing beats a bad URL there.
 *
 * ── 2. The tile had no <img> to draw ──────────────────────────────────────
 *
 * The tile HTML from the failing project has a <video src=...=mm,22,15> and
 * no <img> anywhere: once a tile has been hovered, Flow swaps the thumbnail
 * out for a video element. thumbnailOf found nothing and returned nothing.
 *
 * The picture still exists at the same /asb/ token — the video URL and the
 * thumbnail URL differ only in the format suffix — so it is loaded fresh and
 * drawn. Canvas tainting was the first theory here and it was wrong; measured
 * on the live grid, on real thumbnails:
 *
 *   img 0: complete=true natural=512x288 crossOrigin=null -> toDataURL OK
 *   img 1: complete=true natural=512x288 crossOrigin=null -> toDataURL OK
 *
 * Same-origin with the page, cookies sent, no taint. Loading one directly
 * works for the same reason.
 *
 * ── 3. The image had not loaded when the sweep reached it ─────────────────
 *
 * readGridScrolled moves a screen every 250ms and converts whatever is on
 * screen. Anything that has only just scrolled into view still has
 * naturalWidth 0, and drawing it yields an empty string. Those get a second
 * attempt after the sweep, once they have had time to load.
 *
 * A thumbnail can still be legitimately missing — an asset mid-generation has
 * no picture yet — so the panel draws a deliberate placeholder rather than
 * letting the browser draw a broken one.
 */

/// <reference types="node" />

import * as fs from 'fs';
import * as path from 'path';

const read = (rel: string) =>
  fs.readFileSync(path.resolve(__dirname, rel), 'utf8').replace(/\r\n/g, '\n');

const TILES = read('../content/flowTiles.ts');
const SCANNER = read('../content/scanner.ts');
const PANEL = read('../sidepanel/index.ts');
const CSS = read('../sidepanel/styles.css');

/**
 * Source with comments removed, so prose cannot satisfy an assertion.
 *
 * The line-comment strip ignores a "//" preceded by a colon. Without that it
 * eats the rest of any line holding a URL — and this file is about
 * https://flow-content.google — which silently deleted the very code the
 * assertions were looking for, and reported it as the code being wrong.
 */
const codeOnly = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

/** One function's body, so a match cannot come from somewhere unrelated. */
const fn = (src: string, name: string): string => {
  const m = new RegExp(`(?:async )?function ${name}\\([\\s\\S]*?\\n\\}`).exec(src);
  if (!m) throw new Error(`${name} not found`);
  return m[0];
};

describe('never handing the panel a URL it cannot load', () => {
  it('returns nothing when the canvas taints, not the raw src', () => {
    const conv = codeOnly(fn(SCANNER, 'imgElementToDataUrl'));
    expect(conv).not.toMatch(/return img\.src/);
    expect(conv).toMatch(/catch \{\s*return '';/);
  });

  it('never falls back to a URL that needs the page to load it', () => {
    /* A flow.google.com /asb/ thumbnail carries no authorisation of its own,
       so handing it over renders the broken icon. Empty lets the caller draw
       a placeholder instead. */
    const thumb = codeOnly(fn(TILES, 'thumbnailOf'));
    const guard = thumb.indexOf('if (toDataUrl)');
    expect(guard).toBeGreaterThan(-1);
    expect(thumb.slice(guard)).toMatch(/isSelfAuthenticating\(src\) \? src : ''/);
  });

  it('still answers with a src when there is no converter at all', () => {
    /* getTileState only asks whether a thumbnail exists, and the jsdom tests
       have no canvas. Neither renders anything. */
    const thumb = codeOnly(fn(TILES, 'thumbnailOf'));
    expect(thumb).toMatch(/img\.currentSrc \|\| img\.getAttribute\('src'\)/);
  });
});

describe('recovering a thumbnail the sweep missed', () => {
  it('runs after the sweep, before the tiles are returned', () => {
    const grid = codeOnly(TILES.slice(TILES.indexOf('export async function readGridScrolled')));
    expect(grid).toMatch(/await fillMissingThumbnails\(/);
    expect(grid.indexOf('fillMissingThumbnails'))
      .toBeLessThan(grid.indexOf('return Array.from(seen.values())'));
  });

  it('only retries the ones that came back empty', () => {
    const fill = codeOnly(fn(TILES, 'fillMissingThumbnails'));
    expect(fill).toMatch(/if \(tile\.thumbnailUrl\) continue;/);
  });

  it('waits for an image that had not loaded yet', () => {
    const draw = codeOnly(fn(TILES, 'drawWhenLoaded'));
    expect(draw).toMatch(/if \(!img\.naturalWidth\)/);
    expect(draw).toMatch(/img\.decode\(\)/);
  });

  it('gives up on a slow image instead of holding up the scan', () => {
    const draw = codeOnly(fn(TILES, 'drawWhenLoaded'));
    expect(draw).toMatch(/Promise\.race/);
    expect(draw).toMatch(/wait\(\d{3,}\)/);
  });

  it('does not draw an image that never loaded', () => {
    /* drawImage on a zero-sized image yields a blank data URL, which is a
       thumbnail-shaped lie the placeholder cannot detect. */
    const draw = codeOnly(fn(TILES, 'drawWhenLoaded'));
    const guard = draw.lastIndexOf("if (!img.naturalWidth) return '';");
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(draw.indexOf('return toDataUrl(img)'));
  });

  it('rebuilds the picture from the video token when the tile has no img', () => {
    /* A hovered tile is all <video> and no <img>. Both URLs are the same
       /asb/ token with a different format suffix. */
    const rec = codeOnly(fn(TILES, 'recoverThumbnail'));
    expect(rec).toMatch(/querySelector\('video'\)/);
    expect(rec).toMatch(/\.split\('='\)\[0\]/);
    expect(rec).toMatch(/THUMB_FORMAT/);
    expect(TILES).toMatch(/THUMB_FORMAT = '=s512-rw'/);
  });

  it('prefers the img already on the tile over refetching', () => {
    const rec = codeOnly(fn(TILES, 'recoverThumbnail'));
    expect(rec.indexOf("querySelector('img')")).toBeLessThan(rec.indexOf("querySelector('video')"));
  });

  it('refuses a token that is not a Flow media URL', () => {
    const rec = codeOnly(fn(TILES, 'recoverThumbnail'));
    expect(rec).toMatch(/includes\('\/asb\/'\)/);
  });
});

describe('the panel, when a thumbnail is genuinely missing', () => {
  it('draws a placeholder rather than an img with a bad src', () => {
    const helper = codeOnly(fn(PANEL, 'thumbHtml'));
    expect(helper).toMatch(/af-lib-thumb-empty/);
  });

  it('decides what it can render in one place', () => {
    const helper = codeOnly(fn(PANEL, 'thumbHtml'));
    expect(helper).toMatch(/canRender\(asset\.thumbnailUrl\)/);
  });

  it('uses it for videos and for images alike', () => {
    /* Both card branches rendered their own <img> tag; both broke. */
    expect(PANEL).toContain("${thumbHtml(asset, 'af-lib-thumb')}");
    expect(PANEL).toContain("${thumbHtml(asset, 'af-lib-img')}");
    expect(PANEL).not.toMatch(/<img class="af-lib-(thumb|img)" src="\$\{escapeHtml\(asset\.thumbnailUrl\)/);
  });

  it('holds the same shape as a real thumbnail, so the grid does not shift', () => {
    const rule = /\.af-lib-thumb-empty \{[\s\S]*?\}/.exec(CSS);
    expect(rule).not.toBeNull();
    expect(rule![0]).toMatch(/aspect-ratio: 16\/9/);
  });
});

/**
 * An image tile is not a video tile.
 *
 * Generated images came through as placeholders while videos showed fine.
 * The markup says why — a video tile's grid thumbnail is a same-origin
 * flow.google.com /asb/ token, but an image tile is served straight from a
 * different origin:
 *
 *   <img class="image"
 *        data-media-id="c4b5e39e-92f3-48b4-ac6f-13a4dbbb120f"
 *        src="https://flow-content.google/image/c4b5e39e-…?Expires=…&Signature=…">
 *
 * with no crossorigin attribute. So the canvas taints, toDataURL throws, and
 * the converter correctly returns nothing — which the panel correctly drew as
 * a placeholder. Both halves behaved; the assumption underneath was wrong.
 *
 * That URL signs itself. Measured by opening one in a browser holding no Flow
 * session at all: it returned the image, 1376x768. So it is handed to the
 * panel as-is, and only that shape is — a flow.google.com /asb/ URL still
 * needs the page's cookies and would render as the broken icon this file
 * exists to prevent.
 */

const TILES_SRC = read('../content/flowTiles.ts');

describe('a signed URL the panel can load by itself', () => {
  it('is recognised by its host and signature', () => {
    const fn = codeOnly(TILES_SRC.slice(TILES_SRC.indexOf('export function isSelfAuthenticating')));
    expect(fn).toMatch(/flow-content\.google/);
    expect(fn).toMatch(/Signature=/);
  });

  it('is handed over when the canvas taints', () => {
    const thumb = codeOnly(fn(TILES, 'thumbnailOf'));
    expect(thumb).toMatch(/isSelfAuthenticating\(src\) \? src : ''/);
  });

  it('is only reached after conversion is actually tried', () => {
    /* Drawn bytes stay preferable: they cost nothing to render and never
       expire. */
    const thumb = codeOnly(fn(TILES, 'thumbnailOf'));
    expect(thumb.indexOf('toDataUrl(img)')).toBeLessThan(thumb.indexOf('isSelfAuthenticating'));
  });

  it('does not rescue a URL the panel cannot load', () => {
    /* Only the signed shape is handed over; anything else stays empty. */
    const thumb = codeOnly(fn(TILES, 'thumbnailOf'));
    const conv = thumb.slice(thumb.indexOf('if (toDataUrl)'), thumb.lastIndexOf('}'));
    expect(conv).toMatch(/: ''/);
  });

  it('is accepted by the panel, and nothing else is', () => {
    const guard = codeOnly(fn(PANEL, 'canRender'));
    expect(guard).toMatch(/startsWith\('data:'\)/);
    expect(guard).toMatch(/flow-content\.google/);
    expect(guard).toMatch(/Signature=/);
  });

  it('falls back to the placeholder when it expires', () => {
    /* Expires= is a real timestamp; a library kept open long enough will
       outlive one, and the browser would draw its broken icon. */
    expect(PANEL).toMatch(/addEventListener\('error'/);
    expect(PANEL).toMatch(/af-lib-thumb-empty/);
  });
});

describe('the media id the page states outright', () => {
  it('is read by mediaIdOf, which is a different question from the locator', () => {
    /* mediaTokenOf must stay a substring of the thumbnail URL, because
       locatorFor turns it into a CSS selector — see flowLocator.test.ts,
       which runs that selector against a real DOM. */
    const idFn = codeOnly(fn(TILES, 'mediaIdOf'));
    expect(idFn).toMatch(/data-media-id/);
    expect(codeOnly(fn(TILES, 'mediaTokenOf'))).not.toMatch(/data-media-id/);
  });
});

/**
 * Reading a tile that has not finished rendering.
 *
 * "Only the last ones, the ones at the top, work." Those are the tiles that
 * were already on screen and settled before the scan began. Everything the
 * sweep scrolled to was read the instant it appeared — and Angular fills a
 * tile in over the following frames, so the <video> carrying the playable URL
 * arrives after the element does.
 *
 * The sweep recorded each tile once and skipped it ever after, so whatever
 * was true in that first instant was final: a tile read too early kept an
 * empty videoSrc for the rest of the run, and the panel could neither play
 * nor download it. A second look is now allowed to fill in the gaps, and only
 * the gaps.
 */
describe('a tile is allowed a second look', () => {
  const grid = codeOnly(TILES.slice(TILES.indexOf('export async function readGridScrolled')));

  it('fills in media that had not rendered on the first pass', () => {
    expect(grid).toMatch(/if \(!known\.videoSrc\) known\.videoSrc = videoSrcOf\(tile\)/);
    expect(grid).toMatch(/if \(!known\.thumbnailUrl\) known\.thumbnailUrl = thumbnailOf\(tile, toDataUrl\)/);
  });

  it('does not overwrite what is already known', () => {
    /* A later read can be worse than an earlier one — a row being recycled
       out is briefly emptier than it was. */
    expect(grid).toMatch(/const known = seen\.get\(id\);/);
    expect(grid).toMatch(/if \(known\) \{/);
  });

  it('does not downgrade a finished tile', () => {
    expect(grid).toMatch(/if \(known\.tileState !== 'completed'\)/);
  });

  it('looks twice at each scroll position', () => {
    /* Scrolling back for it is not an option: once the scroller moves on,
       the row is recycled out of the DOM entirely. */
    const step = grid.slice(grid.indexOf('scroller.scrollTop = pos;'));
    const sweeps = (step.slice(0, 600).match(/sweep\(\);/g) || []).length;
    expect(sweeps).toBeGreaterThanOrEqual(2);
  });

  it('looks twice at the first screen too', () => {
    const first = grid.slice(grid.indexOf('scroller.scrollTop = 0;'), grid.indexOf('for (let pos'));
    expect((first.match(/sweep\(\);/g) || []).length).toBeGreaterThanOrEqual(2);
  });
});

describe('a tile whose media is a video element', () => {
  it('is read from the video when there is no image', () => {
    const src = codeOnly(fn(TILES, 'mediaSrcOf'));
    expect(src).toMatch(/querySelector\('img'\)/);
    expect(src).toMatch(/querySelector\('video'\)/);
    expect(src.indexOf("querySelector('img')")).toBeLessThan(src.indexOf("querySelector('video')"));
  });

  it('shows its first frame in the panel rather than a placeholder', () => {
    /* The signed video URL authorises itself, so metadata is enough to paint
       a frame — there is no image anywhere to draw. */
    const helper = codeOnly(fn(PANEL, 'thumbHtml'));
    expect(helper).toMatch(/preload="metadata"/);
    expect(helper).toMatch(/canRender\(vs\)/);
  });
});
