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
    expect(fn).toMatch(/would not give up a frame/);
  });

  it('leaves the last-frame capture alone', () => {
    /* That path was already right, and it is the one the chained node depends
       on. This adds a second reader of an element it has already loaded. */
    expect(FRAMES).toMatch(/if \(!\(await ensureVideoLoaded\(video\)\)\) \{/);
    expect(sendResult()).toMatch(/await captureVideoEndFrame\(videoEl, logLine\)/);
  });
});
