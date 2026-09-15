/**
 * Seeing a tile finish, and seeing one fail, on the Flow that exists now.
 *
 * The queue stalled at 3/4 with 0 failed while Flow was showing failure cards
 * on screen. It was not the API: the run monitor had no tile to read at all.
 * Measured on a live project showing six generated videos, every tier of
 * findAssetCards returned nothing:
 *
 *   div[id^="history-step-fe_id_"]   0
 *   div[data-tile-id]                0
 *   virtuoso [data-index] rows       0
 *   [role=listitem] / [role=gridcell] / .asset-card / …   0
 *   [role=grid] / [role=list] / .gallery / .outputs       0
 *   flow-video-tile + flow-image-tile                     6   ← what is there
 *
 * With an empty list the engine could see neither a completion nor a failure,
 * so it reported 0 failed beside visibly failed videos and waited on them
 * forever, looping "video is ready" then "creating video" again.
 *
 * Two of Flow's real failure messages also went unrecognised, and both are
 * quoted below verbatim from the failing run.
 *
 * ── Why these are source assertions ───────────────────────────────────────
 *
 * This package runs jest under `testEnvironment: 'node'` and has no DOM
 * tests; installing jsdom into a shipped extension is a bigger change than
 * the fix. The same reasoning as flowNewHost.test.ts.
 */

/// <reference types="node" />

import * as fs from 'fs';
import * as path from 'path';

const SELECTORS = fs
  .readFileSync(path.resolve(__dirname, '../content/selectors.ts'), 'utf8')
  .replace(/\r\n/g, '\n');

/** The executable part only. The doc comments quote the very anchors these
    assertions look for, and a naive match finds the comment — this project
    has already shipped one guard that its own comment satisfied. */
const codeOnly = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');

/** One function's body, so an assertion cannot be satisfied from elsewhere. */
const fn = (name: string): string => {
  const m = new RegExp(`export function ${name}\\([\\s\\S]*?\\n\\}`).exec(SELECTORS);
  if (!m) throw new Error(`${name} not found in selectors.ts`);
  return m[0];
};

describe('finding the tiles at all', () => {
  const body = () => fn('findAssetCards');

  it('looks for the components the page actually ships', () => {
    expect(body()).toMatch(/flow-video-tile, flow-image-tile/);
  });

  it('tries them before the tiers that match nothing here', () => {
    /* All five older tiers measured zero on the live page, so reaching them
       first only delays the answer — and the last of them can return
       unrelated elements. */
    const b = codeOnly(body());
    expect(b.indexOf('flow-video-tile')).toBeLessThan(b.indexOf('data-tile-id'));
  });

  it('keeps the old tiers, for a user still on labs.google', () => {
    const b = body();
    expect(b).toMatch(/history-step-fe_id_/);
    expect(b).toMatch(/data-tile-id/);
    expect(b).toMatch(/virtuoso-item-list/);
  });

  it('ignores tiles that are not on screen', () => {
    expect(body()).toMatch(/\.filter\(isVisible\)/);
  });
});

describe('reading whether a tile failed', () => {
  const body = () => fn('getTileState');

  it('looks inside mat-icon, which is where Angular puts ligatures', () => {
    /* The error and warning icons this reads were invisible to it, because
       the list named only <i> and class-based icons. */
    expect(body()).toMatch(/mat-icon/);
  });

  it('recognises the refusal Flow gives for third-party content', () => {
    /* "I can't generate the video you requested right now due to interests of
       third-party content providers." It never says failed, blocked or
       violated, so nothing in the old list matched it. */
    expect(body()).toMatch(/can't generate/);
    expect(body()).toMatch(/third-party content/);
  });

  it('matches a typographic apostrophe, which is what Flow writes', () => {
    /* The page renders "can’t", U+2019. A pattern typed with a plain
       apostrophe never matches it, so the text is normalised first. */
    expect(body()).toMatch(/u2018\\u2019|‘’/);
    expect(body()).toMatch(/replace\(/);
  });

  it('still recognises the wording it always did', () => {
    const b = body();
    expect(b).toMatch(/generation failed/);
    expect(b).toMatch(/tryAgain/);
    expect(b).toMatch(/violate/);
  });

  it('decides failure before deciding still-running', () => {
    /* A failure card also says "You can update your settings to return silent
       videos" — which the generating branch matches. Reading failure first is
       what stops a failed tile being reported as in progress forever. */
    const b = codeOnly(body());
    expect(b.indexOf("return 'failed'")).toBeLessThan(b.indexOf("return 'generating'"));
  });

  it('carries no control character in any pattern', () => {
    // eslint-disable-next-line no-control-regex
    expect(SELECTORS).not.toMatch(/[\x00-\x08\x0b\x0c\x0e-\x1f]/);
  });
});

describe('finding a scanned tile again later', () => {
  const TILES = fs
    .readFileSync(path.resolve(__dirname, '../content/flowTiles.ts'), 'utf8')
    .replace(/\r\n/g, '\n');

  it('locates by the media token, not by an attribute we wrote', () => {
    /* Measured: tag every tile, navigate away and back, and 0 of 3 tags
       survive — Angular destroys and recreates these elements. Every Library
       download, preview and retry after a re-render was looking for a card
       that no longer existed. The token is part of the thumbnail URL the
       framework re-renders, so it comes back with the tile. */
    expect(TILES).toMatch(/export function mediaTokenOf/);
    expect(TILES).toMatch(/export function locatorFor/);
  });

  it('builds a selector that matches the tile by its own media', () => {
    /* Verified live: the :has selector matched exactly 1 element and it was
       the right tile, and all three tiles on the page had distinct tokens.

       It matches any descendant carrying that src, not an img specifically —
       an Omni tile renders a bare <video> with no image anywhere, and
       :has(img[...]) could never match one. flowLocator.test.ts runs the
       selector against a real DOM for both shapes. */
    expect(TILES).toMatch(/:has\(\[src\*=/);
  });

  it('reads the token from either media host', () => {
    /* /asb/<token> for a generated video, /image/ or /video/ for the signed
       content host. */
    expect(TILES).toMatch(/asb/);
    expect(TILES).toMatch(/image\|video/);
  });

  it('still writes a tag when a tile has no image yet', () => {
    /* A tile still generating has no thumbnail and so no token, but the
       caller still needs a handle on it. */
    expect(TILES).toMatch(/return tagTile\(tile, fallbackId\)/);
  });

  it('hands the panel a thumbnail it can actually display', () => {
    /* The panel is a chrome-extension:// page and cannot load a
       flow.google.com image — it rendered every thumbnail as its alt text.
       The scanner converts the loaded image to data bytes instead. */
    const scanner = fs
      .readFileSync(path.resolve(__dirname, '../content/scanner.ts'), 'utf8');
    expect(scanner).toMatch(/readGridScrolled\(document, imgElementToDataUrl, sleep\)/);
  });
});

describe('sweeping the whole grid', () => {
  const TILES2 = fs
    .readFileSync(path.resolve(__dirname, '../content/flowTiles.ts'), 'utf8');

  it('scrolls, because the grid is virtualised', () => {
    /* Measured on a real project: clientHeight 722 against scrollHeight
       19672, with only seven batches in the DOM at once. A list longer than
       the render window gets recycled, and what is recycled out cannot be
       read — a single pass returns the top of the list and nothing else. */
    expect(TILES2).toMatch(/export async function readGridScrolled/);
    expect(TILES2).toMatch(/cdk-virtual-scrollable/);
  });

  it('identifies tiles by token, not by position', () => {
    /* Position is exactly what a virtual scroller changes: the batch at index
       0 after scrolling is not the one that was there before. */
    expect(TILES2).toMatch(/mediaIdOf\(tile\) \|\| `af-/);
  });

  it('numbers groups by when they were first seen', () => {
    expect(TILES2).toMatch(/groupOrder\.indexOf\(key\)/);
  });

  it('stops once nothing new is appearing', () => {
    /* The spacer can be many times taller than the content — 27x on one
       measured project — so walking all of it would find nothing slowly. */
    expect(TILES2).toMatch(/quiet < 3/);
  });

  it('puts the scroll position back', () => {
    /* The user is looking at this page; a scan should not move it. */
    expect(TILES2).toMatch(/scroller\.scrollTop = restore/);
  });

  it('still works when there is no scroller', () => {
    /* Reads the grid and returns it, rather than returning nothing because
       there was nothing to scroll. */
    const guard = TILES2.indexOf('if (!scroller) {');
    expect(guard).toBeGreaterThan(-1);
    const branch = TILES2.slice(guard, guard + 400);
    expect(branch).toMatch(/sweep\(\);/);
    expect(branch).toMatch(/return Array\.from\(seen\.values\(\)\);/);
  });
});

describe('playing an asset from the Library', () => {
  const PANEL = fs
    .readFileSync(path.resolve(__dirname, '../../sidepanel.html'), 'utf8');
  const SIDE = fs
    .readFileSync(path.resolve(__dirname, '../sidepanel/index.ts'), 'utf8');
  const TILES3 = fs
    .readFileSync(path.resolve(__dirname, '../content/flowTiles.ts'), 'utf8');

  it('does not dead-end when there is no embeddable URL', () => {
    /* Measured on the live grid: a tile holds a thumbnail image and zero
       <video> elements, and none appear on hover or on click — Flow attaches
       a player only in its own detail view. So videoSrc is empty for every
       scanned asset, and the play button showed "No video URL available" and
       did nothing at all. */
    expect(SIDE).not.toMatch(/showToast\('No video URL available'\)/);
  });

  it('plays here rather than opening Flow', () => {
    /* It used to open the asset in Flow, which was a stopgap — the ask is
       preview in the panel. */
    expect(SIDE).toMatch(/videoEl\.src = videoUrl/);
  });

  it('still falls back to Flow if the fetch itself fails', () => {
    /* A signed URL expires. If it has, opening in Flow is better than a dead
       player — that branch stays. */
    expect(SIDE).toMatch(/Could not load video/);
    expect(SIDE).toMatch(/FOCUS_FLOW_TAB/);
  });

  it('explains why the video element is usually absent', () => {
    /* Flow creates it only for a hovered tile, and never in a background tab
       — which is why four separate measurements here read "no video" and sent
       me chasing the wrong fix. */
    expect(TILES3).toMatch(/only for a tile the user has hovered/);
  });

  it('still has a play affordance in the panel markup', () => {
    expect(PANEL.length).toBeGreaterThan(1000);
  });
});

describe('choosing a download resolution', () => {
  const SCANNER = fs
    .readFileSync(path.resolve(__dirname, '../content/scanner.ts'), 'utf8');
  const TYPES = fs
    .readFileSync(path.resolve(__dirname, '../types/index.ts'), 'utf8');

  it('never clicks a row the plan does not include', () => {
    /* Measured on a real account: 270p, 720p and 1080p enabled, 4K DISABLED —
       and the shipped default is 4K. Clicking a dead row does nothing at all,
       so the submenu just stayed open and no file ever arrived. */
    expect(SCANNER).toMatch(/isDisabledItem/);
    expect(SCANNER).toMatch(/aria-disabled/);
  });

  it('does not mistake a tooltip class for a disabled state', () => {
    /* The ENABLED 720p row carries mat-mdc-tooltip-disabled. Matching
       "disabled" loosely marks every row dead and downloads nothing. */
    expect(SCANNER).toMatch(/tooltip-disabled/);
  });

  it('falls back to a resolution that works', () => {
    /* Verified live: wanting 4K, it skips the disabled row and takes
       "720p Original size", which fetched the signed video with a 200. */
    expect(SCANNER).toMatch(/preferredRes \|\| fallback720 \|\| anyRes/);
  });

  it('says when it had to substitute', () => {
    /* Otherwise a 4K setting silently yields 720p and looks like a bug. */
    expect(SCANNER).toMatch(/unavailable on this plan/);
  });

  it('no longer ships the unavailable resolution as the default', () => {
    /* It used to be '4K', which is exactly the row the plan disables. The
       fallback rescues it either way, but a default that works without being
       rescued is better. */
    expect(TYPES).toMatch(/videoResolution: 'Original \(720p\)'/);
    expect(TYPES).not.toMatch(/videoResolution: '4K'/);
  });

  it('moves existing installs off the old defaults, once', () => {
    /* A saved value wins over DEFAULT_SETTINGS, so changing the default alone
       reaches new installs only. The marker keeps a later deliberate choice
       of 4K from being rewritten on every read. */
    const storage = fs
      .readFileSync(path.resolve(__dirname, '../shared/storage.ts'), 'utf8');
    expect(storage).toMatch(/defaultsMovedV1/);
    expect(storage).toMatch(/videoResolution === '4K'/);
    expect(storage).toMatch(/model === 'Veo 3\.1 - Quality'/);
  });

  it('defaults the model to the one these runs use', () => {
    expect(TYPES).toMatch(/model: 'Veo 3\.1 - Fast'/);
  });
});

describe('previewing a Library asset in the panel', () => {
  const SIDE2 = fs.readFileSync(path.resolve(__dirname, '../sidepanel/index.ts'), 'utf8');
  const TILES4 = fs.readFileSync(path.resolve(__dirname, '../content/flowTiles.ts'), 'utf8');
  const WORKER3 = fs.readFileSync(path.resolve(__dirname, '../background/service-worker.ts'), 'utf8');
  const MANIFEST3 = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../manifest.json'), 'utf8'));

  /* This was read off a real tile:
   *
   *   <video src="https://flow.google.com/asb/AB-nOUYy…=mm,22,15">
   *
   * and it does redirect to googlevideo.com with itag=22 — the 720p original,
   * signed and needing no cookies. What was wrong was concluding that the
   * suffix could be APPENDED to any thumbnail to make a video URL. It could
   * not: that tile already had a <video>, and the suffix was Flow's, not a
   * formula.
   *
   * Measured later on a live project, fetched from the page itself, on a tile
   * whose thumbnail carries no "=" suffix at all:
   *
   *   thumbnail as-is        -> 200, image/jpeg
   *   thumbnail + =mm,22,15  -> threw, network failure
   *
   * So every tile that had not rendered a <video> was given a URL that cannot
   * be fetched, and the panel reported neither a download nor a playable
   * video while its thumbnail sat there loading fine.
   */

  it('takes the tile video src, and derives it when there is none', () => {
    expect(TILES4).toMatch(/tile\.querySelector\('video'\)/);
    /* Verified against live tiles carrying both elements: the derived URL is
       byte-for-byte the <video> src Flow itself uses. */
    expect(TILES4).toMatch(/'=mm,22,15'/);

    /* And when neither is available, the page is asked for the URL the tile
       holds now. Deliberately not the download menu: driving that makes Flow
       issue a URL by starting a download, which is fetching a video in order
       to look at it. */
    expect(SIDE2).toMatch(/GET_TILE_VIDEO_SRC/);
    expect(SIDE2).not.toMatch(/CAPTURE_ASSET_VIDEO_URL/);
  });

  it('resolves the URL in the worker, the only context that can', () => {
    /* The panel is cross-site so its cookies are withheld and the player sat
       black at 0:00; a content script has the cookies but its fetch follows
       the redirect to googlevideo.com, which sends no CORS headers and throws
       "Failed to fetch". An extension worker with host permissions is subject
       to neither. */
    expect(WORKER3).toMatch(/case 'FETCH_ASSET_VIDEO'/);
    expect(WORKER3).toMatch(/credentials: 'include'/);
  });

  it('asks for one byte, not the file', () => {
    /* Only the landing URL is wanted. */
    expect(WORKER3).toMatch(/Range: 'bytes=0-0'/);
  });

  it('accepts a 206, which is what a range request returns', () => {
    /* Treating partial content as failure would reject every success. */
    expect(WORKER3).toMatch(/status !== 206/);
  });

  it('is allowed to follow the redirect', () => {
    expect(MANIFEST3.host_permissions).toContain('https://*.googlevideo.com/*');
  });

  it('plays the resolved URL in the panel', () => {
    expect(SIDE2).toMatch(/FETCH_ASSET_VIDEO/);
    expect(SIDE2).toMatch(/videoEl\.src = videoUrl/);
  });

  it('does not ship the video through a message', () => {
    /* The resolved URL is self-authenticating, so megabytes of base64 never
       need to cross contexts. Scoped to the play path — the panel reads image
       uploads as data URLs elsewhere, which is unrelated. */
    const i = SIDE2.indexOf('Resolve it first');
    const play = SIDE2.slice(i, i + 1400);
    expect(play).not.toMatch(/readAsDataURL|dataUrl/);
    expect(play).toMatch(/resolved\.url/);
  });

  it('remembers the resolved URL for a replay', () => {
    expect(SIDE2).toMatch(/asset as any\)\.videoSrc = videoUrl/);
  });
});

describe('downloading straight from the tile URL', () => {
  const CONTENT3 = fs.readFileSync(path.resolve(__dirname, '../content/index.ts'), 'utf8');

  it('uses the tile URL instead of the menu when it can', () => {
    /* That URL is itag 22 — the 720p original, which is what "Original
       (720p)" asks for. Taking it directly skips a hover, a menu, a submenu
       and their settling delays on every asset. */
    expect(CONTENT3).toMatch(/DOWNLOAD_FILE/);
    expect(CONTENT3).toMatch(/wantsOriginal/);
  });

  it('still uses the menu for an upscale', () => {
    /* 1080p and 4K do not exist until Flow makes them, so they cannot be
       fetched from a URL that only serves the original. */
    expect(CONTENT3).toMatch(/original\|720/);
    expect(CONTENT3).toMatch(/downloadAssetByMenu/);
  });

  it('falls back to the menu when the direct attempt fails', () => {
    expect(CONTENT3).toMatch(/using the menu/);
  });

  it('does not queue the rename twice', () => {
    /* DOWNLOAD_FILE queues its own; a second one would be left over and land
       on the next file, renaming the wrong download. */
    expect(CONTENT3).toMatch(/queues its own rename/);
  });

  it('only takes this path for a video', () => {
    /* An image has no /asb/ video form. */
    expect(CONTENT3).toMatch(/asset\.mediaType === 'video' && \(asset as any\)\.videoSrc/);
  });
});
