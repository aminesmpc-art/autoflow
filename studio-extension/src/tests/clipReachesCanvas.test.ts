/**
 * @jest-environment jsdom
 */

/**
 * "fix the viewer not geting the data why the video is not working"
 *
 * A finished Studio video node showed a still with "▶ Video — open in Flow to
 * play" under it. The clip existed and was fine; nothing ever reached the
 * canvas.
 *
 * ── What the live page actually does ────────────────────────────────────
 *
 * Measured on a real project holding four FINISHED clips, not inferred:
 *
 *   flow-video-tile elements       4
 *   <video> elements in document   0        ← none, anywhere
 *   poster attributes              none
 *   each tile carries              <img src="https://flow.google.com/asb/…">
 *
 * Flow mounts the player ON HOVER. Dispatching a pointer sequence at one tile
 * mounted a <video> on it within four seconds, readyState 4, carrying
 *
 *   https://flow.google.com/asb/<longer-token>=mm,22,15
 *
 * ── Why that broke the node ─────────────────────────────────────────────
 *
 * With no player, extractTileMediaUrl fell through to findLargestImgSrc and
 * returned the THUMBNAIL. That is not a degraded clip, it is a JPEG — and it
 * is not even the same token, so it cannot be turned into the clip URL.
 *
 * The damage was that it looked like success. The caller's recovery,
 *
 *   if (isVideoNode && !mediaUrl) { …take the signed URL from the API… }
 *
 * is guarded on mediaUrl being EMPTY, so a thumbnail in hand skipped it.
 * buildStudioVideoData then fetched an image, found a non-video blob, and
 * returned '' in silence. Three layers, no error, one still on the canvas.
 *
 * ── And the fetch itself ────────────────────────────────────────────────
 *
 * Confirmed on the page: fetching the clip URL from the content script throws
 * "Failed to fetch" even though it is same-origin with flow.google.com,
 * because it redirects to googlevideo.com, which sends no CORS headers. A
 * no-cors request to the same URL returns an opaque response — so the URL is
 * good and only CORS is refusing. That is the worker's job, and the worker
 * needs the redirect target in host_permissions to follow it.
 */

/// <reference types="node" />

import { readFileSync } from 'fs';
import { join } from 'path';

const read = (...p: string[]) =>
  readFileSync(join(__dirname, '..', ...p), 'utf8').replace(/\r\n/g, '\n');

const IDX = read('content', 'flow', 'index.ts');
const SELECTORS = read('content', 'flow', 'selectors.ts');
const WORKER = read('background', 'service-worker.ts');
const MANIFEST = JSON.parse(
  readFileSync(join(__dirname, '..', '..', 'manifest.json'), 'utf8'));

/** The body of a named function, so a match cannot drift in from elsewhere. */
function bodyOf(src: string, decl: string, span = 2200): string {
  const at = src.indexOf(decl);
  expect(at).toBeGreaterThan(-1);
  return src.slice(at, at + span);
}

describe('a video tile never reports a still as its clip', () => {
  it('returns nothing rather than the thumbnail when the clip is asked for', () => {
    const body = bodyOf(IDX, 'function extractTileMediaUrl');
    const guard = body.indexOf('if (expectVideo) return \'\';');
    const fallback = body.indexOf('return findLargestImgSrc(tile);');
    expect(guard).toBeGreaterThan(-1);
    /* Order is the whole point: the image fallback must be UNREACHABLE for a
       clip, not merely present further down. */
    expect(guard).toBeLessThan(fallback);
  });

  it('still reads the result half, not the batch ingredients', () => {
    /* The rule this function already carried, which must survive the change:
       a batch holds its INPUT pictures too, and returning one of those hands
       the user their own reference back as the generated result. */
    const body = bodyOf(IDX, 'function extractTileMediaUrl');
    expect(body).toMatch(/const video = resultArea\(tile\)\.querySelector\('video'\);/);
  });

  it('is told what the node asked for rather than guessing from the tag', () => {
    /* trackedTile is variously a [data-tile-id] element, a history step or a
       generating card, so its tagName cannot answer this. */
    expect(IDX).toMatch(/extractTileMediaUrl\(trackedTile, isVideoNode\)/);
  });

  it('leaves the image path alone', () => {
    /* An image node must keep taking the largest non-ingredient img. */
    const body = bodyOf(IDX, 'function extractTileMediaUrl');
    expect(body).toContain('return findLargestImgSrc(tile);');
  });
});

describe('the player is made to mount', () => {
  it('hovers, because scrolling alone never mounted one', () => {
    const body = bodyOf(SELECTORS, 'export async function bringTileIntoView');
    expect(body).toMatch(/scrollIntoView/);
    expect(body).toMatch(/hoverTile\(tile\)/);
  });

  it('only hovers when there is no player, so a healthy tile pays nothing', () => {
    const body = bodyOf(SELECTORS, 'export async function bringTileIntoView');
    expect(body).toMatch(/if \(!tile\.querySelector\('video'\)\) await hoverTile\(tile\)/);
  });

  it('sends the pointer events Flow listens for', () => {
    const body = bodyOf(SELECTORS, 'export async function hoverTile', 2600);
    for (const type of ['pointerover', 'mouseover', 'pointermove', 'mousemove']) {
      expect(body).toContain(type);
    }
  });

  it('waits for the player instead of a fixed sleep', () => {
    /* It took ~4s on the live page; a single short sleep would miss it and a
       single long one would cost every run that time for nothing. */
    const body = bodyOf(SELECTORS, 'export async function hoverTile', 2600);
    expect(body).toMatch(/if \(tile\.querySelector\('video'\)\) return true;/);
  });

  it('cannot take down the poller that called it', () => {
    const body = bodyOf(SELECTORS, 'export async function hoverTile', 2600);
    expect(body).toMatch(/catch \{\s*return false;\s*\}/);
  });
});

describe('the clip can actually be fetched', () => {
  it('sends the session cookies, which a different origin does not by default', () => {
    const at = WORKER.indexOf("msg?.type === 'STUDIO_FETCH_MEDIA'");
    expect(at).toBeGreaterThan(-1);
    expect(WORKER.slice(at, at + 1800)).toMatch(/fetch\(url, \{ credentials: 'include' \}\)/);
  });

  it('is allowed to follow the redirect a clip URL makes', () => {
    /* flow.google.com/asb/… redirects to googlevideo.com. Measured from the
       page: a plain fetch throws "Failed to fetch", a no-cors one returns an
       opaque response — the URL is good, CORS is refusing. Only a context
       holding this permission can follow it. */
    expect(MANIFEST.host_permissions).toContain('https://*.googlevideo.com/*');
  });

  it('keeps the host Flow serves finished media from', () => {
    expect(MANIFEST.host_permissions).toContain('https://flow-content.google/*');
  });
});

describe('nothing fails silently any more', () => {
  it('says so when what came back is not a video', () => {
    /* The line that returned '' without a word is how this survived: the node
       had no clip and no log line pointed at the reason. */
    const body = bodyOf(IDX, 'async function buildStudioVideoData', 2000);
    const at = body.indexOf("!blob.type.startsWith('video/')");
    expect(at).toBeGreaterThan(-1);
    const branch = body.slice(at, at + 600);
    expect(branch).toMatch(/logLine\(/);
    expect(branch.indexOf('logLine(')).toBeLessThan(branch.indexOf("return '';"));
  });
});
