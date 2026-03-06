/* ============================================================
   AutoFlow – Library Scanner (Content Script)
   Scans the current Flow project for generated assets
   (videos & AI-generated images), filtering out user uploads.
   Scrolls through the entire virtuoso output grid to discover
   all tiles, including those off-screen.
   ============================================================ */

import { ScannedAsset } from '../types';
import {
  findAssetCards,
  isVisible,
  findMoreMenuOnAsset,
  sleep,
  simulateClick,
  findOutputScroller,
  getTileState,
} from './selectors';

/**
 * Check if a tile is a user-uploaded image (not AI-generated).
 * Uploaded images have the `image` icon (not `videocam`) AND a filename
 * label with a common file extension (.jpeg, .jpg, .png, .gif, .webp, .bmp).
 */
function isUploadedImage(card: Element): boolean {
  const icons = card.querySelectorAll('i.google-symbols, i[class*="google-symbols"]');
  let hasImageIcon = false;
  let hasVideocamIcon = false;
  for (const icon of icons) {
    const txt = icon.textContent?.trim() || '';
    if (txt === 'image') hasImageIcon = true;
    if (txt === 'videocam') hasVideocamIcon = true;
  }
  if (hasVideocamIcon) return false; // It's a video tile
  if (!hasImageIcon) return false;

  // Check if the label looks like a filename with an extension
  const label = extractPromptLabelFromTile(card);
  if (/\.(jpe?g|png|gif|webp|bmp|svg|tiff?)$/i.test(label)) {
    return true; // Filename → uploaded image
  }
  return false;
}

/**
 * Extract the prompt label or asset title from a tile's info overlay.
 * For videos: looks for text in div near the `videocam` icon.
 * For images: looks for text in div near the `image` icon.
 */
function extractPromptLabelFromTile(card: Element): string {
  // Video label: inside a div that is a sibling/descendant near the videocam icon
  // CSS class pattern: sc-365a7498-3 (fKjJRu) for video prompt text
  const videoLabelDivs = card.querySelectorAll('div[class*="sc-365a7498-3"]');
  for (const div of videoLabelDivs) {
    const text = div.textContent?.trim();
    if (text) return text;
  }

  // Image label: inside a div near the image icon
  // CSS class pattern: sc-6e2527b8-2 (iwtwjL) for image file/label text
  const imageLabelDivs = card.querySelectorAll('div[class*="sc-6e2527b8-2"]');
  for (const div of imageLabelDivs) {
    const text = div.textContent?.trim();
    if (text) return text;
  }

  // Generic fallback: walk all leaf text nodes looking for a meaningful label
  const allDivs = card.querySelectorAll('div');
  for (const div of allDivs) {
    // Only consider leaf divs (no child divs)
    if (div.querySelector('div')) continue;
    const text = div.textContent?.trim();
    if (text && text.length > 3 && text.length < 200 &&
        !['play_circle', 'videocam', 'image', 'warning', 'refresh', 'undo',
          'delete_forever', 'Failed', 'Retry', 'Reuse Prompt', 'Delete'].includes(text)) {
      return text;
    }
  }

  return '';
}

/**
 * Extract the video source URL from a tile.
 */
function extractVideoSrc(card: Element): string {
  const video = card.querySelector('video');
  if (video) {
    if (video.src) return video.src;
    const source = video.querySelector('source');
    if (source?.src) return source.src;
  }
  return '';
}

/**
 * Get the group index (virtuoso row data-index) for a tile.
 * Tiles in the same row belong to the same prompt's generations.
 */
function getGroupIndex(card: Element): number {
  const row = card.closest('div[data-index]');
  if (row) return parseInt(row.getAttribute('data-index') || '0', 10);
  return -1;
}

/**
 * Scan the current Flow project page for generated assets.
 * Scrolls through the entire output grid to discover all tiles.
 * Filters out user-uploaded images — only returns AI-generated content.
 */
export async function scanProjectForVideos(): Promise<ScannedAsset[]> {
  const scroller = findOutputScroller();
  const collected = new Map<string, ScannedAsset>();
  let assetCounter = 0;

  function collectVisibleTiles() {
    const tileEls = document.querySelectorAll('div[data-tile-id]');
    for (const tile of tileEls) {
      const htmlTile = tile as HTMLElement;
      const tileId = htmlTile.dataset.tileId || '';
      if (!tileId || collected.has(tileId)) continue;

      // Skip inner nested data-tile-id elements (child of another data-tile-id)
      if (htmlTile.parentElement?.closest('div[data-tile-id]')) continue;
      if (!isVisible(tile)) continue;

      // Skip uploaded images
      if (isUploadedImage(tile)) continue;

      // Skip failed tiles
      const state = getTileState(tile);
      if (state === 'failed' || state === 'empty' || state === 'generating') continue;

      // Determine media type
      const hasVideo = tile.querySelector('video') !== null;
      const icons = tile.querySelectorAll('i.google-symbols, i[class*="google-symbols"]');
      let hasVideocamIcon = false;
      for (const icon of icons) {
        if (icon.textContent?.trim() === 'videocam') hasVideocamIcon = true;
      }
      const isVideo = hasVideo || hasVideocamIcon;

      const thumbnail = extractThumbnail(tile);
      const videoSrc = extractVideoSrc(tile);
      const promptLabel = extractPromptLabelFromTile(tile);
      const groupIndex = getGroupIndex(tile);
      const label = promptLabel || `Asset ${assetCounter + 1}`;

      collected.set(tileId, {
        index: assetCounter,
        label,
        thumbnailUrl: thumbnail,
        videoSrc,
        locator: `div[data-tile-id="${CSS.escape(tileId)}"]`,
        selected: false,
        mediaType: isVideo ? 'video' : 'image',
        promptLabel: promptLabel || `Prompt group ${groupIndex}`,
        groupIndex,
      });
      assetCounter++;
    }
  }

  if (!scroller) {
    // No scrollable area — just collect visible tiles
    collectVisibleTiles();
    return Array.from(collected.values()).sort((a, b) => a.groupIndex - b.groupIndex);
  }

  // Scroll to top
  scroller.scrollTop = 0;
  await sleep(600);

  let prevScroll = -1;
  let stuckCount = 0;

  while (stuckCount < 3) {
    collectVisibleTiles();

    // Scroll down by ~70% of viewport height
    scroller.scrollBy(0, Math.max(200, scroller.clientHeight * 0.7));
    await sleep(400);

    if (Math.abs(scroller.scrollTop - prevScroll) < 5) {
      stuckCount++;
    } else {
      stuckCount = 0;
    }
    prevScroll = scroller.scrollTop;
  }

  // Final collection at bottom
  collectVisibleTiles();

  // Scroll back to top
  scroller.scrollTop = 0;

  // Sort by group index (prompt order) — oldest first
  const assets = Array.from(collected.values()).sort((a, b) => a.groupIndex - b.groupIndex);

  // Re-assign sequential indices
  assets.forEach((a, i) => a.index = i);

  return assets;
}

/** Extract thumbnail URL from an asset card */
function extractThumbnail(card: Element): string {
  // Try video thumbnail image first
  const thumbImg = card.querySelector('img[alt="Video thumbnail"]') as HTMLImageElement | null;
  if (thumbImg?.src) return thumbImg.src;
  // Try video poster
  const video = card.querySelector('video');
  if (video) {
    if (video.poster) return video.poster;
    const source = video.querySelector('source');
    if (source?.src) return source.src;
  }
  // Try img with "Generated image" alt
  const genImg = card.querySelector('img[alt="Generated image"]') as HTMLImageElement | null;
  if (genImg?.src) return genImg.src;
  // Try any img
  const img = card.querySelector('img');
  if (img?.src) return img.src;
  // Try background image
  const bgEls = card.querySelectorAll('[style*="background-image"]');
  for (const el of bgEls) {
    const style = (el as HTMLElement).style.backgroundImage;
    const match = style.match(/url\(["']?(.+?)["']?\)/);
    if (match) return match[1];
  }
  return '';
}

/**
 * Click an asset card to preview it in Flow's viewer.
 */
export async function previewAsset(locator: string): Promise<boolean> {
  const card = await relocateAsset(locator);
  if (!card) return false;
  simulateClick(card);
  await sleep(500);
  return true;
}

/**
 * Download an asset using Flow's native download flow:
 * Hover tile → Click More (⋮) → Click "Download" → Click resolution (720p).
 * Flow produces correctly named, playable files natively.
 * Returns true if the download was triggered successfully.
 */
export async function downloadAssetByMenu(locator: string): Promise<boolean> {
  const card = await relocateAsset(locator);
  if (!card) {
    console.warn('[AutoFlow] downloadAssetByMenu: card not found for', locator);
    return false;
  }

  // Hover to reveal the overlay controls (More button)
  card.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
  card.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
  await sleep(600);

  const moreBtn = findMoreMenuOnAsset(card);
  if (!moreBtn) {
    console.warn('[AutoFlow] downloadAssetByMenu: More button not found');
    return false;
  }

  // Click the More (⋮) button
  simulateClick(moreBtn);
  await sleep(600);

  // Find and click "Download" menu item
  const downloadItem = findVisibleMenuItem('download');
  if (!downloadItem) {
    console.warn('[AutoFlow] downloadAssetByMenu: Download menu item not found');
    pressEscape();
    return false;
  }

  simulateClick(downloadItem);
  await sleep(800);

  // After clicking Download, a resolution picker appears.
  // Look for "720p" (original video) or "Original" option.
  const resOption = findResolutionOption();
  if (resOption) {
    simulateClick(resOption);
    await sleep(500);
  }
  // If no resolution picker, the download may have started directly

  return true;
}

/**
 * Find a visible menu item by text (case-insensitive partial match).
 */
function findVisibleMenuItem(searchText: string): Element | null {
  const lower = searchText.toLowerCase();
  // Check role="menuitem" first (most common in Flow menus)
  const menuItems = document.querySelectorAll('[role="menuitem"]');
  for (const item of menuItems) {
    const text = item.textContent?.trim().toLowerCase() || '';
    if (text.includes(lower) && isVisible(item)) return item;
  }
  // Fallback: any visible button/element with matching text
  const allItems = document.querySelectorAll('button, a, [role="option"], [role="button"]');
  for (const item of allItems) {
    const text = item.textContent?.trim().toLowerCase() || '';
    if (text.includes(lower) && isVisible(item)) return item;
  }
  return null;
}

/**
 * Find the resolution option to click in Flow's download resolution picker.
 * Prefers 720p (Original Size), falls back to first available option.
 */
function findResolutionOption(): Element | null {
  // Look for resolution options — Flow shows them as clickable elements
  // with text like "720p\nOriginal Size", "1080p\nUpscaled", etc.
  const candidates = document.querySelectorAll('button, [role="button"], [role="menuitem"], [role="option"], a, div[class*="sc-"]');
  let fallback: Element | null = null;

  for (const el of candidates) {
    if (!isVisible(el)) continue;
    const text = el.textContent?.trim().toLowerCase() || '';

    // Prefer 720p Original Size
    if (text.includes('720p')) return el;

    // Track first resolution-looking option as fallback
    if (!fallback && /^\d{3,4}p/.test(text)) {
      fallback = el;
    }
  }

  return fallback;
}

/** Press Escape to close any open menu/dialog */
function pressEscape(): void {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
}

/** Re-locate an asset by its stored locator, scrolling if necessary. */
async function relocateAsset(locator: string): Promise<Element | null> {
  // Try direct lookup first
  let el = document.querySelector(locator);
  if (el) return el;

  // Tile may be virtualised out of DOM — scroll through the list to find it
  const scroller = findOutputScroller();
  if (!scroller) return null;

  // Save current scroll position
  const savedScroll = scroller.scrollTop;
  scroller.scrollTop = 0;
  await sleep(400);

  let prevScroll = -1;
  let stuckCount = 0;
  while (stuckCount < 3) {
    el = document.querySelector(locator);
    if (el) return el; // Found it

    scroller.scrollBy(0, Math.max(200, scroller.clientHeight * 0.7));
    await sleep(350);

    if (Math.abs(scroller.scrollTop - prevScroll) < 5) {
      stuckCount++;
    } else {
      stuckCount = 0;
    }
    prevScroll = scroller.scrollTop;
  }

  // Last check at the bottom
  el = document.querySelector(locator);
  if (el) return el;

  // Restore scroll position if tile not found
  scroller.scrollTop = savedScroll;
  return null;
}
