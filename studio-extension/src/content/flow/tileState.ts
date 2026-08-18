/**
 * Is this Flow tile finished?
 *
 * Pulled out of the content script so it can be tested against the DOM Flow
 * actually renders. It was the one piece of that file that is pure — an
 * element in, a verdict out — and it was also the piece that decided whether
 * a node had a result, which made it the least examined and most expensive
 * thing in there to get wrong.
 */

import { matchesFlowText } from './flowStrings';

/**
 * Studio-specific tile state detector.
 * The original getTileState() checks error icons FIRST — but in the
 * sidebar/detail view, extra UI elements contain icons that match
 * error patterns, causing false 'failed' on completed tiles.
 *
 * This detector checks in the OPPOSITE order:
 * 1. COMPLETED: has real image or video? → done
 * 2. GENERATING: has blur, percentage, or spinner? → still working
 * 3. FAILED: has explicit failure text? → only then failed
 */
export type StudioTileState =
  'completed' | 'generating' | 'thumbnail-only' | 'failed' | 'unknown';

export function getStudioTileState(
  tile: Element,
  /**
   * Whether this tile is supposed to become a CLIP.
   *
   * Without it the detector cannot tell a finished still from a video tile
   * that has only painted its thumbnail. Measured on a Veo 3.1 Fast tile: it
   * renders an <img> with NO poster and NO <video> element at all, then
   * attaches the <video> some time later. The image branch below sees a real
   * picture and says "completed" — so the node was taken at the moment it had
   * a thumbnail and nothing else, which is why it came back with no preview,
   * no playable clip, and no last frame for the node chained under it.
   *
   * The caller knows what it asked Flow for. This is that knowledge.
   */
  expectVideo = false,
): StudioTileState {
  // ── 1. GENERATING — must be checked BEFORE completion. ──
  // While Flow generates, the tile shows a blurred preview <img> with a
  // "24%" badge. That preview is a real image, so any completion check
  // that runs first declares the tile done at 24% and grabs a blurred,
  // unusable thumbnail.
  const blurEls = tile.querySelectorAll('[style*="blur-amount"]');
  for (const el of blurEls) {
    const val = (el as HTMLElement).style.getPropertyValue('--blur-amount');
    if (val && parseFloat(val) > 0) return 'generating';
  }

  // Percentage text (e.g. "36%", "99%")
  if (extractTileProgress(tile) !== null) return 'generating';

  const icons = tile.querySelectorAll('.google-symbols, .material-icons, .material-symbols-outlined, .material-symbols');
  for (const icon of icons) {
    const txt = icon.textContent?.trim() || '';
    if (txt === 'progress_activity' || txt === 'hourglass_empty' || txt === 'pending') {
      return 'generating';
    }
  }

  // Generating text cues
  const text = tile.textContent?.toLowerCase() || '';
  if (text.includes('queued') || text.includes('preparing') || text.includes('creating video') ||
      text.includes('almost finished') || text.includes('is preparing')) {
    return 'generating';
  }

  // ── 2. COMPLETED: real image or video content, no generating markers ──

  /* A clip is finished when it is PLAYABLE — not when a thumbnail exists.
   *
   * This used to accept `poster` as proof, which is how a node could go green
   * carrying no video at all. Flow paints the poster the moment it has a first
   * frame to show, seconds before the encoded clip is attached to the element.
   * Caught in that window, everything downstream came apart in a way that
   * never pointed back here:
   *
   *   - extractTileMediaUrl falls through to the poster, so the "video" result
   *     was a single JPEG;
   *   - captureVideoEndFrame calls ensureVideoLoaded on an element with no
   *     source, which cannot load, so it spent 10s and returned nothing;
   *   - the Last Frame node below it then read "The clip above ran but gave up
   *     no last frame", blaming the clip for a race in this function.
   *
   * A poster with no source is a real state and it is neither of the two we
   * had, so it gets its own name. The caller decides how long to allow it —
   * see THUMBNAIL_GRACE_MS — because that is a question about time and this
   * function is a question about the DOM. */
  const video = tile.querySelector('video');
  if (video) {
    const playable = video.currentSrc
      || video.getAttribute('src')
      || video.querySelector('source[src]')?.getAttribute('src')
      || '';
    if (playable) return 'completed';
  }

  /* Authoritative: once the tile holds a <video>, no <img> beside it gets a
     vote on whether the clip is ready. Flow renders a thumbnail <img> inside a
     video tile as well, so letting the loop below see it would put the poster
     race back exactly as it was, one element to the left.

     Held rather than returned, because a tile that failed also has no playable
     source, and the failure text below has to be read before this is answered.
     Returning here would have turned every failed clip into a 20-minute wait. */
  const videoWithoutClip = (!!video || expectVideo)
    && !!(video?.getAttribute('poster') || findLargestImgSrc(tile));

  /* A still's own image is its result. A clip's is a placeholder until the
     <video> arrives, so it must not be allowed to answer the question. */
  const imgs = (video || expectVideo) ? [] : tile.querySelectorAll('img[src]');
  for (const img of imgs) {
    const src = img.getAttribute('src') || '';
    // Skip data URIs under 200 chars (tracking pixels / placeholders)
    if (src.startsWith('data:') && src.length < 200) continue;
    // Skip tiny invisible images
    const rect = img.getBoundingClientRect();
    if (rect.width < 20 || rect.height < 20) continue;
    return 'completed';
  }

  // Play button icons (completed video)
  for (const icon of icons) {
    const txt = icon.textContent?.trim() || '';
    if (txt === 'play_arrow' || txt === 'play_circle') return 'completed';
  }

  // ── 3. FAILED: explicit failure text (NOT icons) ──
  // Must cover what Flow actually renders. "Failed — Oops, something went
  // wrong!" contains neither "generation failed" nor "unable to generate"
  // (the words are reversed), so the old check missed the single most common
  // failure and the node polled it as 'unknown' until the 20-minute timeout.
  // Mirrors automation.ts's detectGenerationError vocabulary.
  if (
    matchesFlowText(text, 'generationFailed') ||
    matchesFlowText(text, 'tryAgain') ||
    text.includes('something went wrong') || text.includes('oops') ||
    text.includes('unable to generate') || text.includes('unavailable') ||
    text.includes('capacity') ||
    text.includes('violat') || text.includes('blocked') || text.includes('rejected') ||
    // Bare "failed" last: it is the broadest, and the generating/completed
    // checks above have already claimed any tile still in flight.
    /\bfailed\b/.test(text)
  ) {
    return 'failed';
  }

  if (videoWithoutClip) return 'thumbnail-only';
  return 'unknown';
}

/** Flow's own progress badge ("24%") from a generating tile, or null */
export function extractTileProgress(tile: Element): number | null {
  const walker = document.createTreeWalker(tile, NodeFilter.SHOW_TEXT);
  let textNode: Text | null;
  while ((textNode = walker.nextNode() as Text | null)) {
    const t = textNode.textContent?.trim() || '';
    const m = /^(\d{1,3})%$/.exec(t);
    if (m) return Math.min(100, parseInt(m[1], 10));
  }
  return null;
}

/** Largest real <img> src inside a tile (skips tiny data: placeholders) */
/* The pictures YOU gave the tile, not the one it produced.
   A finished clip's tile carries a thumbnail for every ingredient that went
   into it, and those are the only <img> elements in it — the clip itself is a
   <video> with no poster. So "largest image in the tile" returned the
   reference photo the user uploaded, and a node either showed the wrong
   picture or, when the strip had not rendered, nothing at all.

   Matched on the alt text Flow gives them, which is written for a screen
   reader and says exactly what they are. */
const INGREDIENT_ALT = /generated or uploaded by you|present in your collection/i;

export function findLargestImgSrc(tile: Element): string {
  const imgs = tile.querySelectorAll('img[src]');
  let bestSrc = '';
  let bestArea = 0;
  for (const img of imgs) {
    const src = img.getAttribute('src') || '';
    if (src.startsWith('data:') && src.length < 200) continue;
    if (INGREDIENT_ALT.test(img.getAttribute('alt') || '')) continue;
    const rect = img.getBoundingClientRect();
    const area = rect.width * rect.height;
    if (area > bestArea) {
      bestArea = area;
      bestSrc = src;
    }
  }
  return bestSrc;
}

