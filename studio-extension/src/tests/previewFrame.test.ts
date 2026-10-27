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
    /* Matched on WHERE the image is, not on what its alt text says.
     *
     * The alt list is still there and still consulted — but it read
     * "generated or uploaded by you", which is the old site's wording, and the
     * current chip says "Ingredient image". It matched nothing, so every input
     * picture counted as a result: an image batch reported itself finished the
     * moment its own reference rendered, and a video batch mistook a chip for
     * a poster and sat in thumbnail-only for two and a half minutes.
     *
     * That is how an exclusion list fails — silently, and only once the site
     * has moved on. The structure it lives in does not move: an ingredient is
     * inside .ingredients-list, in the flow-batch-info half of the batch,
     * while the result is in .batch-tiles-section. */
    expect(TILE).toMatch(/const INGREDIENT_ALT = /);
    expect(TILE).toMatch(/generated or uploaded by you/);
    expect(TILE).toMatch(/export function isIngredientImg\(img: Element\): boolean/);
    expect(TILE).toMatch(/ingredients-list, flow-ingredient-chip, flow-image-ingredient-chip/);
    const fn = TILE.slice(TILE.indexOf('export function findLargestImgSrc'));
    expect(fn.slice(0, fn.indexOf('\n}'))).toMatch(/if \(isIngredientImg\(img\)\) continue;/);
    expect(fn.slice(0, fn.indexOf('\n}'))).toMatch(/resultArea\(tile\)\.querySelectorAll/);
  });

  it('scrolls the output back to the top before giving up', () => {
    /* Where a clip that has just finished actually is. */
    const fn = sendResult();
    expect(fn).toMatch(/await scrollOutputToTop\(\);/);
    expect(fn).toMatch(/bringTileIntoView\(retryTile\)/);
  });

  it('re-finds the tile by id rather than trusting the old element', () => {
    /* The element captured minutes ago may have been recycled out of the
       document by the virtual list.
     *
     * This used to assert the lookup was `[data-tile-id="${tileId}"]`, which
     * is an attribute this Flow sets on nothing — measured 2026-09-17, zero
     * matches in the document. So the test passed and the code never found a
     * tile: the "second look" always re-read the same stale element it was
     * meant to replace. Asserting the SPELLING of a lookup says nothing about
     * whether it resolves; see tileIdentity.test.ts, which round-trips it. */
    expect(sendResult()).toMatch(/const again = findTileByIdentity\(tileId\);/);
    expect(sendResult()).not.toMatch(/querySelector\(`\[data-tile-id=/);
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
    /* Anchored on the message rather than on `if (!previewUrl && …)`, which
       now appears twice — once to enter the recovery and once to judge it.
       indexOf found the first, and the error is 700 characters past it. */
    const fn = sendResult();
    const at = fn.indexOf('Failing rather than reporting');
    expect(at).toBeGreaterThan(-1);
    expect(fn.slice(at, at + 700)).toMatch(/STUDIO_NODE_ERROR/);
    expect(fn.slice(at, at + 700)).toMatch(/return;/);
    // The judgement is its own test, after the second look, not before it.
    expect(fn.lastIndexOf('if (!previewUrl && !referenceUrl) {')).toBeLessThan(at);
    expect(fn.indexOf('if (!previewUrl && !referenceUrl) {'))
      .toBeLessThan(fn.lastIndexOf('if (!previewUrl && !referenceUrl) {'));
  });

  it('does it for a still as well as a clip', () => {
    /* This used to read `if (videoEl && …)`, on the reasoning that "a still
     * has no video to re-read, and its poster path is unaffected". The second
     * half was wrong.
     *
     * It only ever looked right because videoEl was truthy for an image node
     * by accident — it came from a document-wide querySelector that matched
     * any player anywhere on the page. Once that was made honest, image nodes
     * dropped out of this guard and began reporting success carrying nothing:
     * no preview on the node, and no reference for the clip wired below it,
     * which then failed with "nothing to continue from".
     *
     * A still has its own way back — the tile is on screen after the scroll,
     * which is the thing findLargestImgSrc was missing. */
    const fn = sendResult();
    expect(fn).not.toMatch(/if \(videoEl && !previewUrl && !referenceUrl\)/);
    expect(fn).toMatch(/if \(!previewUrl && !referenceUrl\) \{/);
    expect(fn).toMatch(/if \(expectVideo && v2\) \{/);
    expect(fn).toMatch(/extractTileMediaUrl\(retryTile, expectVideo\)/);
    // And the message names what it could not read.
    expect(fn).toMatch(/The image generated on Flow but could not be read off the page/);
  });
});

describe('using the file Flow already gave us', () => {
  /* The question that produced this: "in Flow it's easy with API download and
     getting data if it's there — why don't you use it?"

     It was already downloading it. buildStudioStills fetched the media URL
     off the tile — /fx/api/trpc/media.getMediaUrlRedirect?name=<uuid>, same
     origin, cookies included — and then threw the bytes away on
     `if (blob.type.startsWith('video/')) return none`, on the assumption that
     a clip's tile carries a poster to fall back to. The DOM of a finished
     tile has no poster attribute at all.

     So every failure since has been the DOM route: is the tile in view, has
     the virtual list recycled it, what does its preload say, where is the
     playhead. None of that applies to a blob we hold. */

  const FRAMES = readFileSync(
    join(__dirname, '..', 'content', 'flow', 'videoFrames.ts'), 'utf8');
  const STILLS = readFileSync(
    join(__dirname, '..', 'content', 'flow', 'studioFrames.ts'), 'utf8');

  it('decodes the clip instead of discarding it', () => {
    expect(SRC).not.toMatch(/return none; \/\/ videos use their poster instead/);
    expect(SRC).toMatch(/framesFromVideoBlob\(blob, logLine\)/);
    expect(SRC).toMatch(/return \{ preview: first, reference: last, fromVideo: true \}/);
  });

  it('records that the reference came out of a clip, not out of a still', () => {
    /* The caller has no other way to tell. Both branches of this function
       return a `reference`, and only one of them is the END of anything — a
       poster URL decodes perfectly well into a reference that is the OPENING
       frame. That distinction is what pickReferenceStill's `fromFile` rule
       is built on, so it has to travel with the value rather than be guessed
       from whether the page happened to mount a player. */
    expect(SRC).toMatch(/preview: string; reference: string; fromVideo: boolean/);
    expect(SRC).toMatch(/const none = \{ preview: '', reference: '', fromVideo: false \}/);
    expect(SRC).toMatch(/return \{ preview, reference, fromVideo: false \}/);
    expect(sendResult()).toMatch(
      /const fromFile = \(expectVideo && stills\.fromVideo\) \? stills\.reference : '';/);
  });

  it('is told the node is a clip rather than looking for one on the page', () => {
    /* `document.querySelector('… video')` matches any clip in the Flow
       library, so on an image node it found a player from an unrelated
       generation: the node fetched its own JPEG through the clip path and
       logged "Last frame captured from the downloaded clip" for an image.
       extractTileMediaUrl already takes the node's media type for this exact
       reason. */
    expect(sendResult()).toMatch(/expectVideo = false,/);
    expect(sendResult()).toMatch(
      /let videoEl = expectVideo \? \(tile\?\.querySelector\('video'\) \|\| null\) : null;/);
    expect(sendResult()).toMatch(/if \(expectVideo && !videoEl\) \{/);
    expect(sendResult()).toMatch(/isVideo: expectVideo,/);
    // …and the poller passes it.
    expect(SRC).toMatch(/sendStudioResult\(nodeId, tileId, [^)]*prompt\.mediaId, isVideoNode\);/);
  });

  it('fetches the media as a clip only when the node is one', () => {
    /* Both arms of this used to be identical, the second guarded by
       `!previewVideoUrl` — always true, three lines after it is set to ''. */
    const fn = sendResult();
    expect(fn).not.toMatch(/else if \(!previewVideoUrl && mediaUrl\)/);
    expect(fn).toMatch(
      /if \(expectVideo && mediaUrl\) \{\s*\n\s*previewVideoUrl = await buildStudioVideoData\(mediaUrl\);/);
  });

  it('takes both ends out of the one download', () => {
    /* The opening frame is the thumbnail, the closing frame is what a chained
       clip continues from. One fetch, both answers. */
    const fn = FRAMES.slice(FRAMES.indexOf('export async function framesFromVideoBlob'));
    const body = fn.slice(0, fn.lastIndexOf('\n}'));
    expect(body).toMatch(/const first = await drawWhenDecodable\(video\)/);
    expect(body).toMatch(/duration - 0\.05, duration - 0\.3, duration - 1/);
  });

  it('never returns the opening frame as a failed ending capture', () => {
    const fn = FRAMES.slice(FRAMES.indexOf('export async function framesFromVideoBlob'));
    expect(fn).toMatch(/return \{ first: first \|\| last, last \};/);
    expect(fn).not.toMatch(/last: last \|\| first/);
  });

  it('uses its own element, not the page’s', () => {
    /* Which is the whole point: nothing here depends on where the tile is,
       what its preload says, or whether it still exists. */
    const fn = FRAMES.slice(FRAMES.indexOf('export async function framesFromVideoBlob'));
    const body = fn.slice(0, fn.lastIndexOf('\n}'));
    expect(body).toMatch(/document\.createElement\('video'\)/);
    expect(body).toMatch(/video\.preload = 'auto'/);
    expect(body).toMatch(/URL\.createObjectURL\(blob\)/);
  });

  it('attaches it, because a detached element may not decode', () => {
    const fn = FRAMES.slice(FRAMES.indexOf('export async function framesFromVideoBlob'));
    expect(fn.slice(0, fn.lastIndexOf('\n}'))).toMatch(/document\.body\.appendChild\(video\)/);
  });

  it('cleans up whatever happened', () => {
    /* A blob URL held open is a whole clip pinned in memory, once per node. */
    const fn = FRAMES.slice(FRAMES.indexOf('export async function framesFromVideoBlob'));
    const body = fn.slice(0, fn.lastIndexOf('\n}'));
    expect(body).toMatch(/finally \{[\s\S]{0,240}URL\.revokeObjectURL\(url\)/);
    expect(body).toMatch(/video\.remove\(\)/);
  });

  it('lets a frame from the file stand as the reference', () => {
    /* The rule it passes is there to stop a POSTER — the opening frame —
       standing in for the ending and silently restarting a chained shot. A
       last frame read out of the file is the thing that rule protects. */
    const fn = STILLS.slice(STILLS.indexOf('export function pickReferenceStill'));
    const body = fn.slice(0, fn.indexOf('\n}'));
    expect(body).toMatch(/if \(fromFile\) return fromFile;/);
    expect(body.indexOf('if (fromFile)')).toBeLessThan(body.indexOf("if (isVideo) return '';"));
  });

  it('keeps the page capture as the fallback, not the first resort', () => {
    expect(SRC).toMatch(/endFrame: \(videoEl && !fromFile\) \? await captureVideoEndFrame/);
  });

  it('says which route the frame came from', () => {
    expect(SRC).toMatch(/from the downloaded clip/);
    expect(SRC).toMatch(/off the page/);
  });
});

/* ============================================================
   …and whose clip it is.

   Reached only when the tracked tile has NO player, so whatever
   `document.querySelector('… video')` returns belongs to something else
   unless it can be shown otherwise. Read off flow.google.com on 2026-09-17,
   in a project holding one finished clip:

     - a finished video tile mounts no <video> until the pointer crosses it;
     - the player it then mounts is inside `main`, so `main video` selects a
       GRID player, not the detail view it reads as;
     - the scene editor — the detail view this fallback was added for —
       paints into <canvas class="video-canvas"> and holds no <video> at all;
     - a video tile carries no data-media-id and no data-tile-id. Its /asb/
       token is the only name it has, and its player's src is that token with
       `=mm,22,15` appended.

   So the fallback could not reach the thing it exists for, and could reach
   only the thing it must not touch: the last clip the mouse passed over.
   ============================================================ */

import { mediaKey, isSameGeneration } from '../content/flow/mediaIdentity';

/* Shaped exactly as measured; the token itself is a stand-in, because a real
   one is a live handle to that clip. */
const TOKEN = 'AB-nOUa4wjw5zl4UkmV6z75u1WMpA0TVWnGhFZUpvYAZStR2o4joNxM7IX2qiZhoa7';
const THUMB = `https://flow.google.com/asb/${TOKEN}`;
const PLAYER = `${THUMB}=mm,22,15`;
const OTHER = 'https://flow.google.com/asb/AB-nOUbtljlmg3MA_7HQIAYf6fqiVe0yJWFtbaKk';

const UUID = 'd6d463f5-1808-43fb-b70a-e87c79f787be';
const SIGNED = `https://flow-content.google/video/${UUID}?Expires=1789000000&Signature=aaa`;
const SIGNED_AGAIN = `https://flow-content.google/video/${UUID}?Expires=1789009999&Signature=zzz`;
const POSTER = `https://flow-content.google/image/${UUID}?Expires=1789000000`;
const REDIRECT = `https://labs.google/fx/api/trpc/media.getMediaUrlRedirect?name=${UUID}`;

describe('recognising a tile by the only name it has', () => {
  it('gives a tile its own player the same name as its thumbnail', () => {
    /* The whole fix rests on this: with no id attribute anywhere on a video
       tile, the /asb/ token is how a tile recognises its own clip. The suffix
       is a rendition, not a different file. */
    expect(mediaKey(PLAYER)).toBe(mediaKey(THUMB));
    expect(mediaKey(THUMB)).toBe(`asb:${TOKEN}`);
  });

  it('does not confuse two tiles', () => {
    expect(mediaKey(OTHER)).not.toBe(mediaKey(THUMB));
    expect(isSameGeneration(OTHER, [THUMB])).toBe(false);
  });

  it('survives a signed URL being re-issued', () => {
    /* Expires and Signature change between requests for the same media. Key
       on the query and a clip stops matching itself a few minutes later. */
    expect(mediaKey(SIGNED_AGAIN)).toBe(mediaKey(SIGNED));
    expect(mediaKey(SIGNED)).toBe(`id:${UUID}`);
  });

  it('treats a generation and its poster as one generation', () => {
    expect(mediaKey(POSTER)).toBe(mediaKey(SIGNED));
  });

  it('accepts the bare mediaId the status cache holds', () => {
    /* So the caller can pass mediaId in the same list as the URLs instead of
       every caller special-casing it. */
    expect(mediaKey(UUID)).toBe(mediaKey(SIGNED));
    expect(mediaKey(REDIRECT)).toBe(mediaKey(SIGNED));
  });

  it('refuses to answer for a blob, rather than guessing', () => {
    /* A handle to bytes this page already holds. It says nothing about which
       generation they came from, and "no idea" must not read as "mine". */
    expect(mediaKey('blob:https://flow.google.com/6a1f-2b')).toBe('');
    expect(isSameGeneration('blob:https://flow.google.com/6a1f-2b', [THUMB, SIGNED])).toBe(false);
  });

  it('will not match across the two id spaces', () => {
    /* An /asb/ token cannot be turned into a uuid. Unanswerable, so false. */
    expect(isSameGeneration(PLAYER, [SIGNED])).toBe(false);
    expect(isSameGeneration(SIGNED, [THUMB])).toBe(false);
  });

  it('matches on whichever name the caller happens to hold', () => {
    expect(isSameGeneration(PLAYER, ['', undefined, THUMB])).toBe(true);
    expect(isSameGeneration(SIGNED_AGAIN, [undefined, UUID])).toBe(true);
    expect(isSameGeneration(PLAYER, [])).toBe(false);
    expect(isSameGeneration('', [THUMB])).toBe(false);
  });
});

describe('the page-wide player has to prove it is this generation', () => {
  it('checks the candidate before adopting it', () => {
    const fn = sendResult();
    expect(fn).toMatch(/isSameGeneration\(candidate, knownBy\)/);
    // Adopted only inside that test — never on the bare "is there a video" one.
    expect(fn).not.toMatch(/if \(pageVideo && \(pageVideo\.src \|\| pageVideo\.currentSrc/);
  });

  it('offers it every name this generation answers to', () => {
    /* The tile's own thumbnail is the one that usually decides it, and it is
       the one a video tile cannot be identified without. */
    expect(sendResult()).toMatch(
      /const knownBy = \[mediaUrl, previewSrc, mediaId, tile \? extractTilePreviewSrc\(tile\) : ''\];/);
  });

  it('says so when it turns one down', () => {
    /* Otherwise the fix is itself silent: a node that used to come back with
       a (wrong) frame now comes back with none, and nothing says why. */
    const fn = sendResult();
    expect(fn).toMatch(/a different generation/);
    expect(fn).toMatch(/using the one open on the page/);
  });
});

describe('the stills come back even when the page cannot fetch them', () => {
  /* "The clip generated on Flow but no frame could be read from it" — on a
     clip sitting in Flow, rendered perfectly.

     A finished clip now lives at https://flow-content.google/video/<uuid>,
     cross-origin to flow.google.com. In MV3 a content script's fetch follows
     the PAGE's CORS rules, so that request cannot succeed here however many
     permissions the extension holds. buildStudioVideoData has known this for
     a while and falls back to the worker. buildStudioStills, immediately
     below it, did a page fetch and returned nothing — so the preview AND the
     reference came back empty for precisely the clips the API fallback exists
     to rescue, and the node failed. */

  it('falls back to the worker, like its sibling already did', () => {
    const at = SRC.indexOf('async function fetchMediaBlob');
    expect(at).toBeGreaterThan(-1);
    const body = SRC.slice(at, SRC.indexOf('\n}\n', at));
    // Page first, because it is free when it works.
    expect(body).toMatch(/const resp = await fetch\(url\);/);
    expect(body.indexOf('await fetch(url)')).toBeLessThan(body.indexOf('STUDIO_FETCH_MEDIA'));
    // Then the worker, which is not bound by the page's CORS.
    expect(body).toMatch(/type: 'STUDIO_FETCH_MEDIA'/);
    expect(body).toMatch(/if \(res\?\.dataUrl\) return await \(await fetch\(res\.dataUrl\)\)\.blob\(\);/);
  });

  it('and buildStudioStills uses it rather than fetching directly', () => {
    const at = SRC.indexOf('async function buildStudioStills');
    const body = SRC.slice(at, SRC.indexOf('\n}\n', at));
    expect(body).toMatch(/const blob = await fetchMediaBlob\(url, VIDEO_PREVIEW_MAX_BYTES\);/);
    expect(body).toMatch(/if \(!blob\) return none;/);
    expect(body).not.toMatch(/const resp = await fetch\(url\)/);
  });

  it('says why when neither route works', () => {
    /* It returned '' in silence, which is what made this take three rounds to
       find: the node had no frame and nothing anywhere said why. */
    const at = SRC.indexOf('async function fetchMediaBlob');
    const body = SRC.slice(at, SRC.indexOf('\n}\n', at));
    expect(body).toMatch(/Could not read the media for this node/);
  });

  it('still decodes both ends of a clip once it has the bytes', () => {
    const at = SRC.indexOf('async function buildStudioStills');
    const body = SRC.slice(at, SRC.indexOf('\n}\n', at));
    expect(body).toMatch(/blob\.type\.startsWith\('video\/'\)/);
    expect(body).toMatch(/framesFromVideoBlob\(blob, logLine\)/);
  });
});
