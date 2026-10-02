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

import { ScannedTileState } from '../../types';

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
export function thumbnailOf(tile: Element): string {
  const img = tile.querySelector('img');
  if (!img) return '';
  return (img as HTMLImageElement).currentSrc || img.getAttribute('src') || '';
}

/**
 * The playable source, when the tile has one.
 *
 * Usually empty: measured on a real grid, a finished tile holds a thumbnail
 * image and no <video> at all — Flow attaches the element on play. Returning
 * empty is correct rather than a failure, and the caller already treats a
 * missing src as "download it through the menu instead".
 */
export function videoSrcOf(tile: Element): string {
  const v = tile.querySelector('video');
  if (!v) return '';
  const src = (v as HTMLVideoElement).currentSrc || v.getAttribute('src') || '';
  if (src) return src;
  const source = v.querySelector('source');
  return source ? source.getAttribute('src') || '' : '';
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
export function readGrid(doc: Document = document): NewFlowTile[] {
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
        thumbnailUrl: thumbnailOf(tile),
        videoSrc: videoSrcOf(tile),
        promptLabel: info.promptLabel,
        locator: tagTile(tile, id),
        modelName: info.modelName,
        createdAt: info.createdAt,
      });
    });
  });

  return out;
}
