/**
 * "Generated on Flow — Preview unavailable", on a clip Flow rendered fine.
 *
 * Reported with two screenshots: the node green and blank, and the same clip
 * sitting in Flow at 10s and 720p. Diagnostics said nothing about scrolling
 * the tile back, which rules out the virtualised-grid cause — those lines
 * only print when scrolling CHANGED something, so silence means the tile had
 * its player all along.
 *
 * Which leaves the thing that is wrong on every clip, not sometimes.
 *
 *   captureVideoFrame:  if (video.readyState < 2 || !video.videoWidth) return '';
 *
 * Flow renders its tiles with preload="none". At the moment sendStudioResult
 * asks for a preview, readyState is 0 and videoWidth is 0, so that guard
 * returns '' — every single time, for every clip.
 *
 * The end-frame path already knew this. captureVideoEndFrame calls
 * ensureVideoLoaded first, and its whole doc comment is about preload="none"
 * holding no bytes. That fix was applied to one of the two callers and never
 * the other, which is exactly the shape of the reported bug: the last frame
 * arrives, the chain continues, and the node has no thumbnail.
 */

/// <reference types="node" />

import { readFileSync } from 'fs';
import { join } from 'path';

const SRC = readFileSync(
  join(__dirname, '..', 'content', 'flow', 'index.ts'), 'utf8');
const FRAMES = readFileSync(
  join(__dirname, '..', 'content', 'flow', 'videoFrames.ts'), 'utf8');

const sendResult = (): string => {
  const at = SRC.indexOf('async function sendStudioResult');
  return SRC.slice(at, SRC.indexOf('\n}\n', at));
};

describe('why the first attempt cannot work', () => {
  it('captureVideoFrame refuses an element with nothing loaded', () => {
    /* Not a bug in it — drawing an unloaded video produces an empty canvas,
       so returning '' is right. The caller has to load first. */
    expect(FRAMES).toMatch(/if \(video\.readyState < 2 \|\| !video\.videoWidth\) return '';/);
  });

  it('and Flow gives it exactly that', () => {
    /* The end-frame path documents this at length; the preview path never
       mentioned it. */
    expect(FRAMES).toMatch(/preload="none"/);
  });
});

describe('the preview is drawn once there is something to draw', () => {
  it('tries again after the end frame has loaded the element', () => {
    const fn = sendResult();
    const first = fn.indexOf('previewUrl = captureVideoFrame(videoEl);');
    const again = fn.indexOf('previewUrl = captureVideoFrame(videoEl) || referenceUrl;');
    expect(first).toBeGreaterThan(-1);
    expect(again).toBeGreaterThan(first);
    /* After the end-frame capture, which is what does the loading. */
    expect(fn.indexOf('captureVideoEndFrame')).toBeLessThan(again);
  });

  it('falls back to the end frame rather than to nothing', () => {
    /* The wrong end of the clip, and a picture of the right clip. A node with
       a thumbnail of its own last frame is better than one that reads as
       having failed. */
    expect(sendResult()).toMatch(/captureVideoFrame\(videoEl\) \|\| referenceUrl/);
  });

  it('says in Diagnostics which way it went', () => {
    const fn = sendResult();
    expect(fn).toMatch(/logLine\(`Preview captured \(/);
    /* The "would not give up a frame" line is gone: coming back with nothing
       is no longer a thing to mention in passing, it fails the node. */
    expect(fn).toMatch(/could read nothing from it, even after/);
  });

  it('leaves the last-frame capture alone', () => {
    /* That path was already right, and it is the one the chained node depends
       on. This adds a second reader of an element it has already loaded. */
    expect(FRAMES).toMatch(/if \(!\(await ensureVideoLoaded\(video\)\)\) \{/);
    expect(sendResult()).toMatch(/await captureVideoEndFrame\(videoEl, logLine\)/);
  });
});

describe('a node does not report done with nothing in it', () => {
  /* Reported three times, and each time I fixed something adjacent. The DOM
     of a real finished tile settled it:

       <video src="/fx/api/trpc/media.getMediaUrlRedirect?name=…"
              playsinline crossorigin="anonymous" preload="auto">

     preload="auto", not "none" — so the premise of the previous fix was
     wrong. And no poster attribute at all, so extractTilePreviewSrc fell
     through to findLargestImgSrc, whose only candidates in a finished clip
     tile are the INGREDIENT thumbnails: the pictures the user supplied.

     The node then went green carrying either the wrong image or none, with no
     last frame, and everything chained below it failed while the clip sat in
     Flow rendered perfectly. Reporting that as success is what makes it look
     like the node skipped itself. */

  const TILE = readFileSync(
    join(__dirname, '..', 'content', 'flow', 'tileState.ts'), 'utf8');

  it('never mistakes an ingredient thumbnail for the result', () => {
    /* Matched on the alt text Flow writes for a screen reader, which says
       exactly what they are, rather than on a styled-components class. */
    expect(TILE).toMatch(/const INGREDIENT_ALT = /);
    expect(TILE).toMatch(/generated or uploaded by you/);
    const fn = TILE.slice(TILE.indexOf('export function findLargestImgSrc'));
    expect(fn.slice(0, fn.indexOf('\n}'))).toMatch(/INGREDIENT_ALT\.test\(img\.getAttribute\('alt'\)/);
  });

  it('scrolls the output back to the top before giving up', () => {
    /* Where a clip that has just finished actually is. */
    const fn = sendResult();
    expect(fn).toMatch(/await scrollOutputToTop\(\);/);
    expect(fn).toMatch(/bringTileIntoView\(retryTile\)/);
  });

  it('re-finds the tile by id rather than trusting the old element', () => {
    /* The element captured minutes ago may have been recycled out of the
       document by the virtual list. */
    expect(sendResult()).toMatch(/document\.querySelector\(`\[data-tile-id="\$\{CSS\.escape\(tileId\)\}"\]`\)/);
  });

  it('reads everything again from whatever is there now', () => {
    const fn = sendResult();
    const at = fn.indexOf('const v2 =');
    expect(fn.slice(at, at + 400)).toMatch(/captureVideoEndFrame\(v2, logLine\)/);
    expect(fn.slice(at, at + 400)).toMatch(/captureVideoFrame\(v2\)/);
  });

  it('fails the node rather than reporting a result with no data', () => {
    /* The whole point. A green node with nothing in it is worse than a red
       one, because the run continues and the failure surfaces two nodes
       later as "nothing to continue from". */
    const fn = sendResult();
    const at = fn.indexOf('if (!previewUrl && !referenceUrl) {');
    expect(at).toBeGreaterThan(-1);
    expect(fn.slice(at, at + 700)).toMatch(/STUDIO_NODE_ERROR/);
    expect(fn.slice(at, at + 700)).toMatch(/return;/);
  });

  it('only does any of that for a clip', () => {
    /* A still has no video to re-read, and its poster path is unaffected. */
    expect(sendResult()).toMatch(/if \(videoEl && !previewUrl && !referenceUrl\)/);
  });
});
