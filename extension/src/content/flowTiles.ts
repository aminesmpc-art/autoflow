/**
 * Reading the project grid on the Flow that exists now.
 *
 * ── Why this file exists ──────────────────────────────────────────────────
 *
 * The scanner enumerated tiles with `div[data-tile-id]` and grouped them by
 * the virtuoso row's `[data-index]`. Measured on a live project with eight
 * generated videos on screen:
 *
 *   div[data-tile-id]   0     what the scanner requires
 *   [data-tile-id] any  0
 *   [data-index]        0     what it grouped by
 *   flow-video-tile     6     what is actually there
 *   flow-image-tile     2
 *
 * So it collected nothing and the Library reported "No assets found" on a
 * page full of assets.
 *
 * ── What replaced it ──────────────────────────────────────────────────────
 *
 * The Angular app groups a prompt and its generations together, which is
 * exactly the shape the scanner wanted and had to infer before:
 *
 *   div.batch-container
 *     flow-grid-tile-container        one per generation
 *       flow-tile-container
 *         flow-video-tile | flow-image-tile
 *           img.thumbnail             from flow.google.com/asb/…
 *     flow-batch-info                 one per batch
 *
 * A batch is a prompt; the tiles inside it are its generations. The x2 run
 * recorded here really did produce one batch-container holding two tiles,
 * with a single flow-batch-info beside them.
 *
 * flow-batch-info carries the rest, as one run of text:
 *
 *   "download undo delete youssef keyboard_return
 *    Created Sep 5, 2026  Veo 3.1 - Lite•720p•8s crop_16_9"
 *
 * — action ligatures, then the label, then the date, then the model and its
 * settings. The ligatures are Material icon names rendered as text; they are
 * marked notranslate, so they read the same on every locale while the words
 * around them do not.
 *
 * ── Identity ──────────────────────────────────────────────────────────────
 *
 * These tiles carry no id: their only attributes are Angular's _ngcontent and
 * _nghost markers. The scanner needs a stable handle to re-find a tile later
 * for preview, retry and download, so one is assigned at scan time — see
 * `tagTile`. A tag we wrote ourselves is steadier than a positional selector,
 * which shifts the moment a generation finishes and the grid reflows.
 *
 * ── How to check any of this again ────────────────────────────────────────
 *
 *     document.querySelectorAll('div.batch-container').length
 *     document.querySelectorAll('flow-video-tile, flow-image-tile').length
 */

import { ScannedTileState } from '../types';

/** Our own handle on a tile, since the page gives none. */
export const TILE_TAG_ATTR = 'data-af-id';

/** What the scanner needs about one tile. Mirrors scanner.ts's RawTile. */
export interface NewFlowTile {
  tileId: string;
  groupIndex: number;
  positionInRow: number;
  mediaType: 'video' | 'image';
  tileState: ScannedTileState;
  thumbnailUrl: string;
  videoSrc: string;
  promptLabel: string;
  locator: string;
  modelName: string;
  createdAt: string;
}

/** True when this page is the Angular Flow rather than the old Next.js one. */
export function isNewFlowGrid(doc: Document = document): boolean {
  return !!doc.querySelector('flow-video-tile, flow-image-tile, div.batch-container');
}

/** The batches on the page, in document order. A batch is one prompt. */
export function batches(doc: Document = document): HTMLElement[] {
  const found = Array.from(doc.querySelectorAll<HTMLElement>('div.batch-container'));
  if (found.length) return found;

  /* No batch containers — an older or narrower layout. Fall back to treating
     each tile as its own batch so the Library still lists something rather
     than nothing. */
  return Array.from(doc.querySelectorAll<HTMLElement>('flow-grid-tile-container'));
}

/** The tiles inside one batch, in document order. */
export function tilesIn(batch: Element): HTMLElement[] {
  return Array.from(batch.querySelectorAll<HTMLElement>('flow-video-tile, flow-image-tile'));
}

/**
 * Give a tile a handle we can find it by later, and return the selector.
 *
 * Reuses an existing tag so a second scan does not renumber tiles the panel
 * is already holding references to.
 */
export function tagTile(tile: Element, id: string): string {
  if (!tile.getAttribute(TILE_TAG_ATTR)) tile.setAttribute(TILE_TAG_ATTR, id);
  const actual = tile.getAttribute(TILE_TAG_ATTR) || id;
  return `[${TILE_TAG_ATTR}="${actual}"]`;
}

/**
 * The token identifying this tile's media, out of its thumbnail URL.
 *
 * flow.google.com/asb/<token> for a generated video, flow-content.google's
 * /image/<uuid> for a still. Either is unique per media and, unlike anything
 * we write ourselves, Angular re-renders it along with the tile.
 */
export function mediaTokenOf(tile: Element): string {
  /* Read ONLY from the URL, and nothing else.
   *
   * locatorFor turns this into `img[src*="<token>"]`, so whatever comes back
   * has to be a substring of that src or the selector matches nothing. It was
   * briefly changed to prefer the tile's data-media-id — the page's own id,
   * which reads like the better answer — and that broke the contract: a video
   * tile's thumbnail is an /asb/ URL that does not contain the media id, so
   * every locator stopped matching. Downloads reported "Downloaded 0 file(s)"
   * and previews had no tile to play.
   *
   * The stated id is still worth having; it is just a different question, and
   * mediaIdOf answers it. */
  const m = /\/asb\/([A-Za-z0-9_-]{8,})|\/(?:image|video)\/([0-9a-f][0-9a-f-]{11,})/.exec(mediaSrcOf(tile));
  return m ? (m[1] || m[2] || '') : '';
}

/**
 * The URL of whatever media the tile is showing.
 *
 * Not always an <img>. A tile generated by Omni renders the video itself,
 * with no thumbnail image anywhere:
 *
 *   <flow-video-tile><div class="container">
 *     <video preload="auto" aria-label="Generated video"
 *            src="https://flow-content.google/video/331e1048-…?Expires=…&Signature=…">
 *
 * Reading only <img> meant those tiles had no token at all, so they got a
 * positional id and a locator built from an attribute we write ourselves —
 * the one Angular wipes on re-render. Everything downstream then looked for a
 * tile that could not be found.
 */
export function mediaSrcOf(tile: Element): string {
  const img = tile.querySelector('img');
  const fromImg = img ? (img.getAttribute('src') || '') : '';
  if (fromImg) return fromImg;

  const v = tile.querySelector('video') as HTMLVideoElement | null;
  return v ? (v.currentSrc || v.getAttribute('src') || '') : '';
}

/**
 * The media id the page states, when it states one.
 *
 * An image tile carries it outright:
 *   <img class="image" data-media-id="c4b5e39e-…" src="https://flow-content…">
 *
 * This is the id the API uses, so it is the better identity — but it is NOT
 * interchangeable with mediaTokenOf, which must stay a substring of the
 * thumbnail URL because locatorFor builds a CSS selector out of it.
 */
export function mediaIdOf(tile: Element): string {
  const stated = tile.querySelector('[data-media-id]');
  const id = stated ? (stated.getAttribute('data-media-id') || '') : '';
  return id || mediaTokenOf(tile);
}

/**
 * A selector that will still find this tile after the grid re-renders.
 *
 * The attribute written by tagTile does not survive: Angular destroys and
 * recreates these elements, and a navigation away and back was measured
 * wiping every tag — 0 of 3 left, so every later download, preview or retry
 * looked for a card that no longer existed and reported it missing.
 *
 * The media token does survive, because it is part of the thumbnail URL the
 * framework re-renders. :has() is used to select the tile by the image inside
 * it; Chrome has supported it since 105 and this only ever runs in Chrome.
 * The written tag stays as the fallback for a tile that has no image yet —
 * one still generating — where there is nothing else to hold on to.
 */
export function locatorFor(tile: Element, fallbackId: string): string {
  const token = mediaTokenOf(tile);
  /* Any descendant carrying that src, not specifically an img — a tile whose
     media is a <video> has no img to match. */
  if (token) return `${tile.tagName.toLowerCase()}:has([src*="${token}"])`;
  return tagTile(tile, fallbackId);
}

/* ── Reading one batch's metadata ────────────────────────────────────────── */

/** Material ligatures that render as text inside the info block. */
const ACTION_LIGATURES = /^(download|undo|delete|add|keyboard_return|more_vert|edit|content_copy)+/i;

/** A model line: a family name, then anything up to the settings separator. */
const MODEL = /\b((?:Veo|Omni|Imagen|Gemini|Lyria|Nano Banana)[\w\s.\-]*?)(?=\s*[•·]|\s*$)/i;

/** "Created Sep 5, 2026", and the same phrase in the other shipped locales. */
const CREATED = /((?:Created|Créé|Erstellt|Creato|Creado|作成)[^•·\n]{0,32}\d{4})/i;

/** The info block belonging to a batch. */
export function batchInfoOf(batch: Element): Element | null {
  return batch.querySelector('flow-batch-info');
}

/** Collapse an element's text the way it reads on screen. */
function textOf(el: Element | null): string {
  return el ? (el.textContent || '').replace(/\s+/g, ' ').trim() : '';
}

/**
 * The label, model and creation date for a batch.
 *
 * All three come out of one run of text, so each is found by what it looks
 * like rather than by position: the date by its "Created …  2026" shape, the
 * model by its family name, and the label by what is left once the leading
 * action ligatures and both of those are removed.
 */
export function readBatchInfo(batch: Element): {
  promptLabel: string; modelName: string; createdAt: string;
} {
  const raw = textOf(batchInfoOf(batch));
  if (!raw) return { promptLabel: '', modelName: '', createdAt: '' };

  const createdAt = (CREATED.exec(raw) || [])[1] || '';
  const modelName = ((MODEL.exec(raw) || [])[1] || '').trim();

  let label = raw;
  if (createdAt) label = label.split(createdAt)[0];
  label = label.replace(ACTION_LIGATURES, '');
  /* "keyboard_return" is the reuse-prompt icon and sits directly after the
     label, with no separator — splitting on it is what ends the label. */
  label = label.split('keyboard_return')[0];
  label = label.replace(/\b(download|undo|delete|more_vert|add)\b/gi, '').trim();

  return { promptLabel: label, modelName, createdAt };
}

/* ── Reading one tile ────────────────────────────────────────────────────── */

/** A video tile is the component that says so. */
export function mediaTypeOf(tile: Element): 'video' | 'image' {
  return tile.tagName.toLowerCase() === 'flow-image-tile' ? 'image' : 'video';
}

/**
 * The tile's thumbnail.
 *
 * Generated thumbnails come from flow.google.com/asb/…; an ingredient or an
 * upload comes from the signed content host instead. Both are media.
 */
/**
 * A URL that carries its own authorisation.
 *
 * Flow serves a generated image straight from flow-content.google with an
 * Expires/Signature pair on it:
 *
 *   https://flow-content.google/image/<id>?Expires=…&KeyName=…&Signature=…
 *
 * Measured by opening one in a browser with no Flow session at all: it
 * returned the image, 1376x768. Nothing about it depends on the user's
 * cookies, so the panel can render it directly — unlike a flow.google.com
 * /asb/ thumbnail, which cannot be loaded outside the page and is why
 * thumbnails are drawn to a canvas in the first place.
 */
export function isSelfAuthenticating(url: string): boolean {
  return url.startsWith('https://flow-content.google/') && url.includes('Signature=');
}

export function thumbnailOf(
  tile: Element,
  toDataUrl?: (img: HTMLImageElement) => string,
): string {
  const img = tile.querySelector('img') as HTMLImageElement | null;
  if (!img) return '';

  /* The panel is a chrome-extension:// page and cannot load a flow.google.com
     image: it rendered every thumbnail as the alt text instead. The scanner
     has always solved this by drawing the loaded image to a canvas and
     handing over the bytes, and the thumbnails are same-origin with the page,
     so the canvas does not taint. The raw URL is kept as the fallback for a
     caller with no converter — the jsdom tests, where there is no canvas. */
  const src = img.currentSrc || img.getAttribute('src') || '';

  if (toDataUrl) {
    const drawn = toDataUrl(img);
    if (drawn) return drawn;

    /* Conversion failed. For an IMAGE tile that is expected rather than
       exceptional: the picture is served from flow-content.google, a
       different origin, and the tag carries no crossorigin attribute — so
       the canvas is tainted and toDataURL throws. A video tile does not hit
       this, because its grid thumbnail is same-origin /asb/.
       
       The signed URL needs no cookies, so hand that over instead of nothing.
       Anything else stays empty: a URL the panel cannot load renders as a
       broken image, which is worse than a placeholder. */
    return isSelfAuthenticating(src) ? src : '';
  }

  /* No converter at all — the jsdom tests, and getTileState, which only asks
     whether a thumbnail exists. */
  return src;
}

/**
 * The tile's playable video URL.
 *
 * Flow serves the video from the same /asb/ token as the thumbnail, with a
 * different format suffix. Read off a real hovered tile:
 *
 *   <video preload="auto" aria-label="Generated video"
 *          src="https://flow.google.com/asb/AB-nOUYy…=mm,22,15">
 *
 * while the thumbnail on that same token ends =s512-rw. So when the element
 * is there its src is used, and when it is not the URL is built from the
 * thumbnail instead.
 *
 * Building it matters because the element usually is not there: Flow creates
 * the <video> only for a tile the user has hovered, and never at all in a
 * background tab. Reading the DOM alone reported "no video" on every asset
 * and the panel had nothing to play.
 *
 * The URL redirects to googlevideo.com, which sends no CORS headers — so it
 * must be handed to a <video> element, never fetched. A fetch of it fails;
 * a no-cors request succeeds, which is what says the URL itself is good.
 */
export function videoSrcOf(tile: Element): string {
  const v = tile.querySelector('video');
  if (v) {
    const direct = (v as HTMLVideoElement).currentSrc || v.getAttribute('src') || '';
    if (direct) return direct;
    const source = v.querySelector('source');
    const s = source ? source.getAttribute('src') || '' : '';
    if (s) return s;
  }

  /* No video element yet — derive the URL from the thumbnail.
   *
   * This was removed once, on a bad reading of a measurement, and then put
   * back after checking it properly. Both steps are worth recording.
   *
   * The removal: fetching thumbnail + "=mm,22,15" from the page THREW, while
   * the thumbnail alone returned 200. That looked like proof the derived URL
   * was invalid. It was not — a REAL video URL throws under fetch too,
   * because it redirects to googlevideo.com, which sends no CORS headers.
   * Both throw, so the test could not tell them apart.
   *
   * The check that settles it, run on live tiles that had both elements:
   *
   *   thumbnail contains "="          false
   *   derived URL === <video> src     TRUE
   *
   * Byte for byte the same as the URL Flow itself uses. The thumbnail carries
   * no format suffix on these tiles, so cutting at "=" returns the whole URL
   * and the suffix is appended to it — which is exactly right. */
  if (mediaTypeOf(tile) !== 'video') return '';
  const img = tile.querySelector('img');
  const thumb = img ? (img.getAttribute('src') || '') : '';
  if (!thumb.includes('/asb/')) return '';
  return thumb.split('=')[0] + VIDEO_FORMAT;
}

/** The format suffix Flow's own <video> uses on an /asb/ token. */
const VIDEO_FORMAT = '=mm,22,15';

/**
 * Does this URL carry an expiry that has passed?
 *
 * The /asb/ URLs above have no expiry — they are stable for the life of the
 * media. The signed ones do: Flow serves an Omni generation straight from
 * flow-content.google with Expires and Signature on it, valid for about an
 * hour. A library scanned and left open outlives them, and then a download or
 * a preview is working from a URL that has quietly died.
 */
export function hasExpired(url: string, now = Date.now()): boolean {
  const m = /[?&]Expires=(\d+)/.exec(url);
  if (!m) return false;
  return Number(m[1]) * 1000 <= now;
}

/** Words the tile shows when a generation did not produce a video. */
const FAILURE_WORDS = /(failed|échou|fehlgeschlagen|fallit|error|erreur)/i;

/**
 * What state a tile is in.
 *
 * Read from what the tile has rather than from a status attribute, because it
 * has none: a finished tile carries a thumbnail, a running one shows a
 * percentage, and a failed one says so in words.
 */
export function tileStateOf(tile: Element): ScannedTileState {
  const text = textOf(tile);
  if (FAILURE_WORDS.test(text)) return 'failed';
  /* A running tile renders its progress as "29%". */
  if (/\b\d{1,3}\s*%/.test(text)) return 'generating';
  if (thumbnailOf(tile)) return 'completed';
  return 'unknown';
}

/**
 * An upload rather than a generation.
 *
 * Uploads are listed in the same grid and are not generations, so the scanner
 * skips them. They are named for their file: af_58166bae.jpg.
 */
export function isUpload(tile: Element, label: string): boolean {
  if (mediaTypeOf(tile) !== 'image') return false;
  return /\.(jpe?g|png|webp|gif)\b/i.test(label) || /\.(jpe?g|png|webp|gif)\b/i.test(textOf(tile));
}

/* ── The whole grid ──────────────────────────────────────────────────────── */

/**
 * Every generated tile on the page, with its batch's metadata.
 *
 * Ordering follows the document, which is the order Flow shows them in, so
 * the caller's grouping and numbering need no further sorting.
 */
export function readGrid(
  doc: Document = document,
  toDataUrl?: (img: HTMLImageElement) => string,
): NewFlowTile[] {
  const out: NewFlowTile[] = [];

  batches(doc).forEach((batch, groupIndex) => {
    const info = readBatchInfo(batch);
    tilesIn(batch).forEach((tile, positionInRow) => {
      if (isUpload(tile, info.promptLabel)) return;

      const id = `af-${groupIndex}-${positionInRow}`;
      out.push({
        tileId: id,
        groupIndex,
        positionInRow,
        mediaType: mediaTypeOf(tile),
        tileState: tileStateOf(tile),
        thumbnailUrl: thumbnailOf(tile, toDataUrl),
        videoSrc: videoSrcOf(tile),
        promptLabel: info.promptLabel,
        locator: locatorFor(tile, id),
        modelName: info.modelName,
        createdAt: info.createdAt,
      });
    });
  });

  return out;
}

/* ── Sweeping a virtualised grid ─────────────────────────────────────────── */

/**
 * The element the project grid scrolls inside.
 *
 * Angular's CDK renders it as div.cdk-virtual-scrollable. Measured on a real
 * project: clientHeight 722 against a scrollHeight of 19672, and only seven
 * batches in the DOM at once — the rest of that height is the scroller's own
 * spacer. A list long enough to exceed the render window gets recycled, and
 * anything recycled out is simply not there to be read.
 */
export function gridScroller(doc: Document = document): HTMLElement | null {
  const el = doc.querySelector<HTMLElement>('div.cdk-virtual-scrollable');
  if (el) return el;
  /* Any tall scrollable that actually contains tiles. */
  const all = Array.from(doc.querySelectorAll<HTMLElement>('*'));
  return all.find((e) => e.scrollHeight > e.clientHeight + 80
    && e.clientHeight > 200
    && !!e.querySelector('flow-video-tile, flow-image-tile')) || null;
}

/** A key that identifies a batch across re-renders. */
function batchKey(batch: Element): string {
  const info = readBatchInfo(batch);
  return `${info.promptLabel}|${info.createdAt}`;
}

/**
 * Read the whole grid, scrolling to bring recycled rows back into the DOM.
 *
 * readGrid alone sees only what is rendered. On a project short enough to fit
 * the render window that is everything, which is why this was not noticed at
 * first; on a longer one it is the top of the list and nothing else.
 *
 * Identity comes from the media token rather than position, because position
 * is exactly what a virtual scroller changes: the batch at index 0 after
 * scrolling is not the batch that was at index 0 before. Groups are numbered
 * by when they were first seen instead, so the ordering the caller gets is
 * the order they appear on screen.
 */
export async function readGridScrolled(
  doc: Document = document,
  toDataUrl?: (img: HTMLImageElement) => string,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<NewFlowTile[]> {
  const scroller = gridScroller(doc);
  const seen = new Map<string, NewFlowTile>();
  const groupOrder: string[] = [];

  const sweep = () => {
    for (const batch of batches(doc)) {
      const key = batchKey(batch);
      let group = groupOrder.indexOf(key);
      if (group < 0) { groupOrder.push(key); group = groupOrder.length - 1; }

      const info = readBatchInfo(batch);
      tilesIn(batch).forEach((tile, pos) => {
        if (isUpload(tile, info.promptLabel)) return;
        /* The token is the identity; without one — a tile still generating —
           fall back to where it sits, which is the best available. */
        const id = mediaIdOf(tile) || `af-${group}-${pos}`;

        /* Already recorded, but perhaps not completely.
         *
         * A tile is read the moment it appears, and Angular fills it in over
         * the following frames — the <video> that carries the playable URL
         * arrives after the element does. Skipping outright meant whatever
         * was true in that first instant was final: a tile read too early
         * kept an empty videoSrc for the rest of the run, and the panel could
         * neither play nor download it.
         *
         * It showed up as "only the ones at the top work". Those are the
         * tiles that were already on screen and settled before the sweep
         * started; everything the sweep scrolled to was read the instant it
         * rendered. So a second look is allowed to fill in what the first
         * one missed — and only that; nothing already known is overwritten. */
        const known = seen.get(id);
        if (known) {
          if (!known.videoSrc) known.videoSrc = videoSrcOf(tile);
          if (!known.thumbnailUrl) known.thumbnailUrl = thumbnailOf(tile, toDataUrl);
          if (known.tileState !== 'completed') known.tileState = tileStateOf(tile);
          return;
        }

        seen.set(id, {
          tileId: id,
          groupIndex: group,
          positionInRow: pos,
          mediaType: mediaTypeOf(tile),
          tileState: tileStateOf(tile),
          thumbnailUrl: thumbnailOf(tile, toDataUrl),
          videoSrc: videoSrcOf(tile),
          promptLabel: info.promptLabel,
          locator: locatorFor(tile, `af-${group}-${pos}`),
          modelName: info.modelName,
          createdAt: info.createdAt,
        });
      });
    }
  };

  if (!scroller) {
    /* A grid short enough to need no scroller still has images that were not
       loaded when it was read, so it gets the same second pass. */
    sweep();
    await fillMissingThumbnails(seen, doc, toDataUrl, wait);
    return Array.from(seen.values());
  }

  const restore = scroller.scrollTop;
  const step = Math.max(200, Math.floor(scroller.clientHeight * 0.7));
  let quiet = 0;

  scroller.scrollTop = 0;
  await wait(250);
  sweep();
  await wait(350);
  sweep();

  for (let pos = step; pos <= scroller.scrollHeight && quiet < 3; pos += step) {
    const before = seen.size;
    scroller.scrollTop = pos;
    scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
    await wait(250);
    sweep();
    /* Again, a moment later, at the same position. The first pass catches the
       tiles; this one catches the media they had not rendered yet. Cheaper
       than scrolling back for them, and it is the only chance — once the
       scroller moves on, the row is recycled out of the DOM entirely. */
    await wait(350);
    sweep();
    /* Stop once three consecutive screens bring nothing new. The spacer can
       be many times taller than the content — 27x on one measured project —
       so walking every pixel of it would spend a minute finding nothing. */
    quiet = seen.size === before ? quiet + 1 : 0;
  }

  scroller.scrollTop = restore;
  await fillMissingThumbnails(seen, doc, toDataUrl, wait);
  return Array.from(seen.values());
}

/**
 * Give a thumbnail to anything collected without one.
 *
 * Only tiles still in the DOM can be helped — the grid is virtualised — but
 * those are the ones the user is looking at, which is where a missing
 * thumbnail actually shows.
 */
async function fillMissingThumbnails(
  seen: Map<string, NewFlowTile>,
  doc: Document,
  toDataUrl: ((img: HTMLImageElement) => string) | undefined,
  wait: (ms: number) => Promise<void>,
): Promise<void> {
  for (const tile of seen.values()) {
    if (tile.thumbnailUrl) continue;
    const el = doc.querySelector(tile.locator);
    if (!el) continue;
    tile.thumbnailUrl = await recoverThumbnail(el, toDataUrl, wait);
  }
}

/**
 * A second attempt at a thumbnail the sweep did not get.
 *
 * Two different tiles arrive here, and the panel showed the same broken-image
 * icon with alt text over it for both:
 *
 *   1. The image had not finished loading. The sweep moves a screen every
 *      250ms and converts whatever is on screen; anything that just scrolled
 *      into view has naturalWidth 0, and drawing it yields nothing.
 *
 *   2. The tile has no <img> at all. Once a tile has been hovered, Flow
 *      replaces its thumbnail with a <video>, and there is nothing to draw.
 *      The image still exists at the same /asb/ token, so it is fetched at
 *      thumbnail size and drawn instead.
 *
 * Both run on the Flow page, where an /asb/ URL carries its cookies and the
 * canvas does not taint — measured on live thumbnails: complete, 512x288,
 * toDataURL fine.
 */
async function recoverThumbnail(
  tile: Element,
  toDataUrl: ((img: HTMLImageElement) => string) | undefined,
  wait: (ms: number) => Promise<void>,
): Promise<string> {
  if (!toDataUrl) return '';

  const existing = tile.querySelector('img') as HTMLImageElement | null;
  if (existing) return await drawWhenLoaded(existing, toDataUrl, wait);

  const v = tile.querySelector('video') as HTMLVideoElement | null;
  const base = (v ? v.currentSrc || v.getAttribute('src') || '' : '').split('=')[0];
  if (!base.includes('/asb/')) return '';

  const fresh = new Image();
  fresh.src = `${base}${THUMB_FORMAT}`;
  return await drawWhenLoaded(fresh, toDataUrl, wait);
}

/** The format suffix Flow's own thumbnails carry on an /asb/ token. */
const THUMB_FORMAT = '=s512-rw';

async function drawWhenLoaded(
  img: HTMLImageElement,
  toDataUrl: (img: HTMLImageElement) => string,
  wait: (ms: number) => Promise<void>,
): Promise<string> {
  if (!img.naturalWidth) {
    /* decode() rejects on a load failure rather than hanging, and the race
       keeps one slow image from holding up the rest of the scan. */
    await Promise.race([img.decode().catch(() => undefined), wait(1500)]);
  }
  if (!img.naturalWidth) return '';
  return toDataUrl(img);
}
