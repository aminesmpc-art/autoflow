/**
 * @jest-environment jsdom
 */

/**
 * Reading the project grid on the Flow that exists now.
 *
 * The markup below is not invented. It is the structure read off a live
 * project showing eight generated videos, where the old scanner found none:
 *
 *   div[data-tile-id]   0     what the scanner enumerated
 *   [data-index]        0     what it grouped by
 *   flow-video-tile     6     what is there
 *   flow-image-tile     2
 *
 * The x2 run in these fixtures is real: one batch-container really did hold
 * two tiles beside a single flow-batch-info.
 */

import {
  readGrid, readBatchInfo, batches, tilesIn, isNewFlowGrid,
  mediaTypeOf, thumbnailOf, tileStateOf, isUpload, TILE_TAG_ATTR,
} from '../content/flow/flowTiles';

/** One generated video tile, nested as the live page nests it. */
const tile = (label: string, thumb = 'https://flow.google.com/asb/AB-nOUbdK7WIJ') => `
  <flow-grid-tile-container><flow-tile-container><flow-video-tile>
    <button aria-label="Favorite"></button>
    <button aria-label="Reuse prompt"></button>
    <button aria-label="More options"></button>
    <img class="thumbnail" alt="Generated video thumbnail" src="${thumb}">
    <span>play_circle</span><span>${label}</span>
  </flow-video-tile></flow-tile-container></flow-grid-tile-container>`;

/** The metadata block, as one run of text exactly like the real one. */
const info = (label: string, model = 'Veo 3.1 - Lite') => `
  <flow-batch-info>downloadundodelete${label}keyboard_return Created Sep 5, 2026 ${model}•720p•8scrop_16_9</flow-batch-info>`;

const batch = (label: string, tiles: string, model?: string) =>
  `<div class="batch-container">${tiles}${info(label, model)}</div>`;

/** A project like the one measured: single runs plus one x2 batch. */
const GRID =
  batch('youssef', tile('youssef')) +
  batch('amien', tile('amien')) +
  batch('Slow camera push in on the car, soft light',
        tile('Camera pushing in on car') + tile('Camera pushing in on car'));

describe('recognising the new grid', () => {
  it('knows the Angular grid when it sees one', () => {
    document.body.innerHTML = GRID;
    expect(isNewFlowGrid(document)).toBe(true);
  });

  it('does not mistake the old site for it', () => {
    document.body.innerHTML = '<div data-tile-id="abc"><img src="x"></div>';
    expect(isNewFlowGrid(document)).toBe(false);
  });
});

describe('batches and their tiles', () => {
  beforeEach(() => { document.body.innerHTML = GRID; });

  it('finds one batch per prompt', () => {
    expect(batches(document)).toHaveLength(3);
  });

  it('keeps the two generations of an x2 run in one batch', () => {
    /* This is the grouping the old scanner had to infer from row indices.
       The page states it now, and a real x2 run produced exactly this. */
    expect(tilesIn(batches(document)[2])).toHaveLength(2);
    expect(tilesIn(batches(document)[0])).toHaveLength(1);
  });

  it('reads every generated tile', () => {
    expect(readGrid(document)).toHaveLength(4);
  });

  it('numbers generations within their batch', () => {
    const g = readGrid(document);
    const pair = g.filter((t) => t.groupIndex === 2);
    expect(pair.map((t) => t.positionInRow)).toEqual([0, 1]);
  });
});

describe('the metadata, which arrives as one run of text', () => {
  it('separates label, model and date', () => {
    document.body.innerHTML = batch('youssef', tile('youssef'));
    const m = readBatchInfo(batches(document)[0]);
    expect(m.promptLabel).toBe('youssef');
    expect(m.modelName).toBe('Veo 3.1 - Lite');
    expect(m.createdAt).toBe('Created Sep 5, 2026');
  });

  it('keeps a real prompt whole', () => {
    document.body.innerHTML = GRID;
    expect(readBatchInfo(batches(document)[2]).promptLabel)
      .toBe('Slow camera push in on the car, soft light');
  });

  it('never leaves an action ligature in the label', () => {
    /* download/undo/delete and keyboard_return render as text with no
       separator around them, so they land inside the label unless removed. */
    document.body.innerHTML = GRID;
    for (const t of readGrid(document)) {
      expect(t.promptLabel).not.toMatch(/download|undo|delete|keyboard_return|more_vert/);
    }
  });

  it('reads the model families Flow ships', () => {
    for (const model of ['Veo 3.1 - Lite', 'Omni 1.1 Flash', 'Nano Banana']) {
      document.body.innerHTML = batch('x', tile('x'), model);
      expect(readBatchInfo(batches(document)[0]).modelName).toBe(model);
    }
  });

  it('survives a batch with no info block', () => {
    document.body.innerHTML = '<div class="batch-container">' + tile('x') + '</div>';
    expect(() => readGrid(document)).not.toThrow();
    expect(readGrid(document)).toHaveLength(1);
  });
});

describe('one tile', () => {
  it('knows video from image by the component name', () => {
    document.body.innerHTML = GRID + '<flow-image-tile><img src="x"></flow-image-tile>';
    expect(mediaTypeOf(document.querySelector('flow-video-tile')!)).toBe('video');
    expect(mediaTypeOf(document.querySelector('flow-image-tile')!)).toBe('image');
  });

  it('takes the thumbnail from the app host', () => {
    document.body.innerHTML = GRID;
    expect(thumbnailOf(document.querySelector('flow-video-tile')!))
      .toContain('flow.google.com/asb/');
  });

  it('calls a tile with a thumbnail completed', () => {
    document.body.innerHTML = GRID;
    expect(tileStateOf(document.querySelector('flow-video-tile')!)).toBe('completed');
  });

  it('reads a percentage as still generating', () => {
    /* A running tile shows "29%" over the placeholder. */
    document.body.innerHTML = `<flow-video-tile><span>29%</span></flow-video-tile>`;
    expect(tileStateOf(document.querySelector('flow-video-tile')!)).toBe('generating');
  });

  it('reads a failure in any of the shipped languages', () => {
    for (const word of ['Failed', 'Échoué', 'Fehlgeschlagen']) {
      document.body.innerHTML = `<flow-video-tile><img src="https://flow.google.com/asb/x"><span>${word}</span></flow-video-tile>`;
      expect(tileStateOf(document.querySelector('flow-video-tile')!)).toBe('failed');
    }
  });

  it('skips uploads, which are not generations', () => {
    /* They sit in the same grid, named for their file. */
    document.body.innerHTML = batch('af_58166bae.jpg',
      `<flow-grid-tile-container><flow-image-tile><img src="https://flow-content.google/image/x">
        <span>af_58166bae.jpg</span></flow-image-tile></flow-grid-tile-container>`);
    expect(isUpload(document.querySelector('flow-image-tile')!, 'af_58166bae.jpg')).toBe(true);
    expect(readGrid(document)).toHaveLength(0);
  });

  it('does not mistake a video for an upload', () => {
    document.body.innerHTML = GRID;
    expect(readGrid(document).every((t) => t.mediaType === 'video')).toBe(true);
  });
});

describe('finding a tile again later', () => {
  it('tags each tile, since the page gives them no id', () => {
    /* Their only attributes are Angular's _ngcontent/_nghost markers, so
       preview, retry and download have nothing to bind to otherwise. */
    document.body.innerHTML = GRID;
    for (const t of readGrid(document)) {
      expect(t.locator).toContain(TILE_TAG_ATTR);
      expect(document.querySelectorAll(t.locator)).toHaveLength(1);
    }
  });

  it('gives every tile a distinct handle', () => {
    document.body.innerHTML = GRID;
    const ids = readGrid(document).map((t) => t.tileId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('keeps the same handle across a re-scan', () => {
    /* The panel holds references between scans; renumbering would break the
       download it is about to ask for. */
    document.body.innerHTML = GRID;
    const first = readGrid(document).map((t) => t.locator);
    const second = readGrid(document).map((t) => t.locator);
    expect(second).toEqual(first);
  });
});
