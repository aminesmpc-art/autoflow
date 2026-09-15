/**
 * @jest-environment jsdom
 */

/* ============================================================
   The clip that ran and gave up no last frame.

   Reported as a node failing "time to time, without any reason" — and the
   randomness was the whole clue. A workflow would chain four clips, three
   would hand their ending to the next one, and one would not: its Last Frame
   node showed "The clip above ran but gave up no last frame", and the clip
   wired below it failed for want of a reference it had no way to get.

   The capture code was not the problem. It had already been hardened for the
   seek races — 'seeked' meaning the playhead moved rather than a frame having
   decoded, preload="none" holding no bytes, the final frame sitting in an
   unfetched byte range. All of that works.

   The problem is upstream of any of it: there was no <video> to capture from.

   Flow's output grid is a Virtuoso virtual list. A tile that has scrolled out
   of the viewport renders as a lightweight poster and Flow does not attach a
   player to it. Nothing about that looks like failure — the clip exists, the
   tile looks finished — so the poller sat in 'thumbnail-only' waiting for a
   source that was never going to attach while the tile was off screen, spent
   its grace period, declared the tile complete anyway, and reported a result
   with no reference.

   And every clip generated after it pushes the grid along, so whether the
   tracked tile was still on screen when its clip landed depended on how many
   others were in flight. Hence: intermittent, in longer workflows, for no
   reason visible on the page.

   Waiting cannot fix it. The tile has to be on screen.
   ============================================================ */

/// <reference types="node" />

import { readFileSync } from 'fs';
import { join } from 'path';
import { bringTileIntoView, findOutputScroller, scrollOutputToTop } from '../content/flow/selectors';

const SRC = readFileSync(
  join(__dirname, '..', 'content', 'flow', 'index.ts'), 'utf8');

/** A tile Flow has rendered as a poster, with no player attached. */
function posterTile(): HTMLElement {
  const tile = document.createElement('div');
  tile.setAttribute('data-tile-id', 't1');
  const img = document.createElement('img');
  img.src = 'https://example.test/poster.jpg';
  tile.append(img);
  document.body.append(tile);
  return tile;
}

/** What Virtuoso does when the row comes back into view. */
function mountPlayerOnScroll(tile: HTMLElement): void {
  (tile as any).scrollIntoView = () => {
    const v = document.createElement('video');
    tile.append(v);
  };
}

beforeEach(() => { document.body.innerHTML = ''; });

describe('bringing an off-screen tile back', () => {
  it('reports that a player appeared where there was none', async () => {
    const tile = posterTile();
    mountPlayerOnScroll(tile);
    expect(tile.querySelector('video')).toBeNull();

    expect(await bringTileIntoView(tile)).toBe(true);
    expect(tile.querySelector('video')).not.toBeNull();
  }, 10_000);

  it('says nothing changed when the tile already had a player', async () => {
    /* The return value means "this scroll is what produced a player", not
       "there is a player". A caller logging on true would otherwise announce a
       recovery on every poll of a perfectly healthy tile. */
    const tile = posterTile();
    tile.append(document.createElement('video'));
    (tile as any).scrollIntoView = () => {};

    expect(await bringTileIntoView(tile)).toBe(false);
  }, 10_000);

  it('says nothing changed when scrolling does not help', async () => {
    const tile = posterTile();
    (tile as any).scrollIntoView = () => {};
    expect(await bringTileIntoView(tile)).toBe(false);
  }, 10_000);

  it('scrolls the least it can, so it cannot fight the user', async () => {
    /* `nearest` is a no-op for a tile already in view. `center` would yank the
       page on every poll of a healthy run. */
    const tile = posterTile();
    let opts: any = null;
    (tile as any).scrollIntoView = (o: any) => { opts = o; };
    await bringTileIntoView(tile);
    expect(opts).toMatchObject({ block: 'nearest', inline: 'nearest' });
  }, 10_000);

  it('survives a tile that throws on scroll', async () => {
    /* A detached or recycled node. Returning false is right; throwing here
       would take down the poller that was trying to recover. */
    const tile = posterTile();
    (tile as any).scrollIntoView = () => { throw new Error('detached'); };
    await expect(bringTileIntoView(tile)).resolves.toBe(false);
  }, 10_000);
});

describe('Flow Angular CDK output scrolling', () => {
  it('finds the viewport from the current virtual-scroll-container markup', () => {
    document.body.innerHTML = '<cdk-virtual-scroll-viewport class="cdk-virtual-scroll-viewport">'
      + '<div class="cdk-virtual-scroll-content-wrapper"><div class="virtual-scroll-container">'
      + '<div class="virtual-item-container"><flow-grid-tile-container><img data-media-id="m1"></flow-grid-tile-container></div>'
      + '</div></div></cdk-virtual-scroll-viewport>';
    const viewport = document.querySelector('cdk-virtual-scroll-viewport') as HTMLElement;
    expect(findOutputScroller()).toBe(viewport);
  });

  it('remounts the newest CDK rows by scrolling that viewport to zero', async () => {
    document.body.innerHTML = '<cdk-virtual-scroll-viewport class="cdk-virtual-scroll-viewport">'
      + '<div class="cdk-virtual-scroll-content-wrapper"><div class="virtual-scroll-container"></div></div>'
      + '</cdk-virtual-scroll-viewport>';
    const viewport = document.querySelector('cdk-virtual-scroll-viewport') as HTMLElement;
    viewport.scrollTop = 900;
    await scrollOutputToTop();
    expect(viewport.scrollTop).toBe(0);
  });

  it('can discover the scroll chain from a new tile with no data-tile-id', () => {
    document.body.innerHTML = '<section id="scroller"><div class="virtual-scroll-container">'
      + '<flow-grid-tile-container><img data-media-id="m1"></flow-grid-tile-container>'
      + '</div></section>';
    const scroller = document.querySelector('#scroller') as HTMLElement;
    Object.defineProperties(scroller, { scrollHeight: { value: 800 }, clientHeight: { value: 300 } });
    expect(findOutputScroller()).toBe(scroller);
  });
});

describe('the poller stops waiting for something waiting cannot fix', () => {
  it('brings a thumbnail-only tile back into view while it waits', () => {
    /* Sliced to the END of the thumbnail-only branch, not to the first
       "state = 'completed'". There are two of those now: the API short-circuit
       — the service already holds a signed clip URL, so waiting for the grid
       to mount a player is waiting for nothing — and the old give-up at the
       end of the grace. The nudge sits between them. */
    const branch = SRC.slice(SRC.indexOf("if (state === 'thumbnail-only')"));
    const body = branch.slice(0, branch.indexOf('} else if (thumbnailOnlySince)'));
    expect(body).toMatch(/bringTileIntoView\(trackedTile\)/);
  });

  it('does not nudge while the service says it is still rendering', () => {
    /* Nothing is missing then — the clip does not exist yet. Scrolling to it
       would be pointless motion on every poll of a long render. */
    expect(SRC).toMatch(/if \(!serviceStillWorking && Date\.now\(\) - lastNudgeAt > NUDGE_EVERY_MS\)/);
  });

  it('throttles it, rather than scrolling on every poll', () => {
    expect(SRC).toMatch(/const NUDGE_EVERY_MS = [\d_]+;/);
  });

  it('looks once more at the moment the result is committed', () => {
    /* Everything downstream reads the tile once, and the last frame has to be
       captured while it is definitely present. If the player is not mounted at
       that instant there is no second chance. */
    const at = SRC.indexOf("if (state === 'completed') {");
    const window = SRC.slice(at, SRC.indexOf('sendStudioResult(nodeId', at));
    expect(window).toMatch(/isVideoNode && !trackedTile\.querySelector\('video'\)/);
    expect(window).toMatch(/bringTileIntoView\(trackedTile\)/);
  });

  it('says how many times it tried, when it gives up anyway', () => {
    /* The old message said the clip never attached and left the reason to be
       guessed at. Whether it was ever scrolled back is the difference between
       "Flow never produced it" and "we never looked in the right place". */
    const giveUp = SRC.slice(SRC.indexOf('without ever attaching a '));
    expect(giveUp.slice(0, 400)).toMatch(/attempt\$\{nudges === 1/);
  });
});

describe('what it still refuses to do', () => {
  it('never lets a poster stand in for a missing last frame', () => {
    /* The poster is the clip's OPENING frame. Using it would make a chained
       shot restart rather than continue — silently, which is worse than the
       visible failure this fixes. pickReferenceStill returns '' for a video
       on purpose, and that stays. */
    const ref = readFileSync(
      join(__dirname, '..', 'content', 'flow', 'studioFrames.ts'), 'utf8');
    const fn = ref.slice(ref.indexOf('export function pickReferenceStill'));
    expect(fn.slice(0, fn.indexOf('\n}'))).toMatch(/if \(isVideo\) return '';/);
  });
});
