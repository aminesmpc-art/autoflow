/**
 * @jest-environment jsdom
 */

/* ============================================================
   Finding a tile again, on a Flow that names none of them.

   Measured on flow.google.com, 2026-09-17, in a project holding one finished
   clip and several finished stills: `[data-tile-id]` matched NOTHING. Not on
   a tile, not on any descendant of one. What the page states is:

     image tile   <img data-media-id="c4b5e39e-…" src="…/asb/<TOKEN>">
     video tile   <img alt="Generated video thumbnail" src="…/asb/<TOKEN>">
                  …and nothing else. No id attribute anywhere on it.

   flowTileIdentity was written for exactly this and answers "what is this
   tile called". The inverse did not exist, so every lookup in the codebase
   was spelled `querySelector('[data-tile-id="…"]')` and every one of them
   returned null for ever:

     findTileId        fell through to data-index, also absent → getAllTileIds
                       returned [], and the engine's before/after tile
                       comparison never had anything to compare.
     sendStudioResult  reported tileId: '' for every result, which the canvas
                       stores and forwards as referenceImageIds.
     the second look   re-found the tile by id before giving up — so it never
                       did, and always re-read the stale element.
     reference images  "Reference tile <id> not found on the Flow page".
     the extend path   waited five minutes for a parent tile it looked up the
                       same way.

   None of it failed loudly. It just never worked.
   ============================================================ */

/// <reference types="node" />

import {
  flowTileIdentity, findTileByIdentity, getAllTileIds,
} from '../content/flow/selectors';

const TOKEN_VIDEO = 'AB-nOUa4wjw5zl4UkmV6z75u1WMpA0TVWnGhFZUpvYAZStR2o4joNxM7IX2qiZhoa7';
const TOKEN_IMAGE = 'AB-nOUbtljlmg3MA_7HQIAYf6fqiVe0yJWFtbaKk_RI5ULvbqjo4d4Vvlk0ONvhh';
const MEDIA_ID = 'c4b5e39e-1809-4c03-90c8-dd6b2cb55e87';

/** A finished video tile, exactly as the page renders one: no id anywhere. */
function videoTile(token = TOKEN_VIDEO): Element {
  const tile = document.createElement('flow-video-tile');
  tile.innerHTML =
    `<img alt="Generated video thumbnail" src="https://flow.google.com/asb/${token}">`;
  document.body.append(tile);
  return tile;
}

/** A finished image tile, which does state a media id — on the <img>. */
function imageTile(id = MEDIA_ID, token = TOKEN_IMAGE): Element {
  const tile = document.createElement('flow-image-tile');
  tile.innerHTML = `<img alt="Tile displaying a user's image" data-media-id="${id}" `
    + `src="https://flow.google.com/asb/${token}">`;
  document.body.append(tile);
  return tile;
}

const realRect = Element.prototype.getBoundingClientRect;
beforeAll(() => {
  // findAssetCards filters by isVisible, and jsdom lays nothing out.
  Element.prototype.getBoundingClientRect = function () {
    return { width: 288, height: 512, top: 0, left: 0, right: 288, bottom: 512,
      x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
  };
});
afterAll(() => { Element.prototype.getBoundingClientRect = realRect; });
beforeEach(() => { document.body.innerHTML = ''; });

describe('a tile can be found by the name it gives itself', () => {
  it('round-trips a video tile, which states nothing at all', () => {
    /* The case with no alternative. There is no attribute to select on, so
       the only route is to ask every tile its name — which is why the scan
       is not a fallback here but the whole mechanism. */
    const tile = videoTile();
    const id = flowTileIdentity(tile);
    expect(id).toBe(TOKEN_VIDEO);
    expect(findTileByIdentity(id)).toBe(tile);
  });

  it('round-trips an image tile, and returns the TILE not the <img>', () => {
    /* resultArea, getTileState and bringTileIntoView all read the container.
       Handing back the <img> that carried the id would satisfy the lookup and
       break every caller. */
    const tile = imageTile();
    expect(flowTileIdentity(tile)).toBe(MEDIA_ID);
    const found = findTileByIdentity(MEDIA_ID);
    expect(found).toBe(tile);
    expect(found!.tagName.toLowerCase()).toBe('flow-image-tile');
  });

  it('tells two tiles apart', () => {
    const a = videoTile();
    const b = videoTile('ZZ-nOUqqqq5zl4UkmV6z75u1WMpA0TVWnGhFZUpvYAZStR2o4joNxM7IX2qiZhoa7');
    expect(findTileByIdentity(flowTileIdentity(a))).toBe(a);
    expect(findTileByIdentity(flowTileIdentity(b))).toBe(b);
    expect(a).not.toBe(b);
  });

  it('still prefers a stated data-tile-id, for the Flow this was written against', () => {
    document.body.innerHTML = '<div data-tile-id="fe_id_42"><img src="x"></div>';
    expect(findTileByIdentity('fe_id_42')).toBe(document.querySelector('[data-tile-id]'));
  });

  it('finds a history step, which is where the detail view puts them', () => {
    document.body.innerHTML = '<div id="history-step-fe_id_42"></div>';
    expect(findTileByIdentity('fe_id_42')).toBe(document.querySelector('div'));
  });

  it('is not defeated by an id that starts with a digit', () => {
    /* CSS.escape renders a leading digit as `\31 2…`, and the space that ends
       that escape becomes a descendant combinator once it is concatenated
       after `#history-step-`. The selector then means something else
       entirely, and silently. Attribute selectors do not have that shape. */
    document.body.innerHTML = '<div id="history-step-123abc"></div>';
    expect(findTileByIdentity('123abc')).toBe(document.querySelector('div'));
  });

  it('survives a quote or a backslash in an id without throwing', () => {
    expect(() => findTileByIdentity('a"b')).not.toThrow();
    expect(() => findTileByIdentity('a\\b')).not.toThrow();
    expect(findTileByIdentity('a"b')).toBeNull();
  });

  it('answers null rather than guessing', () => {
    videoTile();
    expect(findTileByIdentity('nothing-by-that-name')).toBeNull();
    expect(findTileByIdentity('')).toBeNull();
  });

  it('has nothing to say about a tile still generating', () => {
    /* No media yet, so no name yet. An empty identity is a real answer and
       the caller matches by prompt instead — it must not resolve to some
       other tile. */
    const tile = document.createElement('flow-video-tile');
    tile.innerHTML = '<div class="progress">47%</div>';
    document.body.append(tile);
    expect(flowTileIdentity(tile)).toBe('');
    expect(findTileByIdentity('')).toBeNull();
  });
});

describe('and the engine can now list what is on the page', () => {
  it('getAllTileIds names tiles that state no attribute', () => {
    /* It returned [] on every call, so `tileIdsBefore` — the snapshot taken
       before Generate to work out which tile is this prompt's — was always
       empty. */
    videoTile();
    imageTile();
    const ids = getAllTileIds();
    expect(ids).toContain(TOKEN_VIDEO);
    expect(ids).toContain(MEDIA_ID);
  });

  it('and every id it lists can be looked back up', () => {
    /* The property that was missing. A list of names is only useful if the
       names resolve. */
    videoTile();
    imageTile();
    for (const id of getAllTileIds()) {
      expect(findTileByIdentity(id)).not.toBeNull();
    }
  });
});
