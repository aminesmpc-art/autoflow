/* ============================================================
   AutoFlow – Smart Library Scanner (Content Script)
   
   Three-phase scanning architecture:
   Phase 1: Scroll & Collect — gather every tile with raw metadata
   Phase 2: Group & Deduce  — group by virtuoso row (= prompt),
            resolve prompt labels, detect media types
   Phase 3: Enrich          — assign prompt numbers, generation
            numbers, totals, and prepare final ScannedAsset[]
   
   Key design choices:
   • Groups by virtuoso row data-index (NOT prompt text), so two
     prompts with identical text stay separate.
   • Includes ALL tile states (completed, failed, generating,
     unknown) so the Library UI can show everything.
   • Filters out only user-uploaded images.
   ============================================================ */

import { ScannedAsset, ScannedTileState } from '../types';
import {
  findAssetCards,
  isVisible,
  findMoreMenuOnAsset,
  sleep,
  simulateClick,
  findOutputScroller,
  getTileState,
  findRetryButtonOnTile,
  findReusePromptButtonOnTile,
  findToolbarReuseButtonFromTile,
  findPromptInput,
  findGenerateButton,
  setInputValue,
  humanDelay,
  TileState,
} from './selectors';

// ── Noise words to filter from prompt label extraction ──
const NOISE_WORDS = new Set([
  'play_circle', 'videocam', 'image', 'warning', 'refresh', 'undo',
  'delete_forever', 'Failed', 'Retry', 'Reuse Prompt', 'Delete',
  'more_vert', 'download', 'play_arrow', 'play_circle_filled',
  'content_copy', 'share', 'error', 'error_outline', 'report',
  'progress_activity', 'hourglass_empty', 'pending',
]);

// ================================================================
// RAW TILE — intermediate representation before grouping
// ================================================================

interface RawTile {
  tileId: string;
  groupIndex: number;        // virtuoso row data-index
  positionInRow: number;     // 0-based position within the row
  mediaType: 'video' | 'image';
  tileState: ScannedTileState;
  thumbnailUrl: string;
  videoSrc: string;
  promptLabel: string;       // best-effort prompt text
  locator: string;
}

// ================================================================
// PHASE 1 — SCROLL & COLLECT
// ================================================================

/**
 * Check if a tile is a user-uploaded image (not AI-generated).
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
  if (hasVideocamIcon) return false;
  if (!hasImageIcon) return false;
  const label = extractPromptLabelFromTile(card);
  if (/\.(jpe?g|jfif|png|gif|webp|bmp|svg|tiff?)$/i.test(label)) return true;
  return false;
}

/**
 * Extract the prompt label from a tile using multiple strategies.
 * Returns the best candidate or empty string.
 */
function extractPromptLabelFromTile(card: Element): string {
  let bestLabel = '';

  // Strategy 1: Text sibling of a media icon (videocam / image)
  const icons = card.querySelectorAll('i.google-symbols, i[class*="google-symbols"]');
  for (const icon of icons) {
    const iconText = icon.textContent?.trim() || '';
    if (iconText !== 'videocam' && iconText !== 'image') continue;
    const iconParent = icon.parentElement;
    if (!iconParent) continue;
    const siblings = iconParent.parentElement?.children;
    if (siblings) {
      for (const sib of Array.from(siblings)) {
        if (sib === iconParent) continue;
        const text = sib.textContent?.trim();
        if (text && text.length > 2 && text.length < 200 && !NOISE_WORDS.has(text)) {
          bestLabel = text;
          break;
        }
      }
    }
    if (bestLabel) break;
  }

  // Strategy 2: Walk all leaf divs looking for meaningful label text
  if (!bestLabel) {
    const allDivs = card.querySelectorAll('div');
    for (const div of allDivs) {
      if (div.querySelector('div')) continue;
      if (div.querySelector('i')) continue;
      const text = div.textContent?.trim();
      if (text && text.length > 3 && text.length < 200 && !NOISE_WORDS.has(text) &&
        !/^\d{1,3}%$/.test(text)) {
        bestLabel = text;
        break;
      }
    }
  }

  // Strategy 3: aria-label on the tile itself or near parents
  if (!bestLabel) {
    const ariaLabel = card.getAttribute('aria-label') ||
      card.closest('[aria-label]')?.getAttribute('aria-label') || '';
    if (ariaLabel.length > 3 && ariaLabel.length < 200) bestLabel = ariaLabel;
  }

  return cleanPromptLabel(bestLabel);
}

/**
 * Clean a raw prompt label by removing UI noise text that gets
 * concatenated from button labels, icon names, and status text.
 */
function cleanPromptLabel(raw: string): string {
  if (!raw) return '';
  let cleaned = raw;

  // Remove known noise words/phrases that get concatenated
  const noisePatterns = [
    /\bwarning\b/gi,
    /\bFailed\b/gi,
    /\bundo\b/gi,
    /\bReuse\s*Prompt\b/gi,
    /\bdelete_forever\b/gi,
    /\bDelete\b/gi,
    /\bvideocam\b/gi,
    /\bplay_circle\b/gi,
    /\bplay_arrow\b/gi,
    /\bmore_vert\b/gi,
    /\bRefresh\b/gi,
    /\bRetry\b/gi,
    /\bredo\b/gi,
    /\bRedoReuse\s*prompt\b/gi,
    /\bredoReuse prompt\b/gi,
    /\bcontent_copy\b/gi,
    /\bprogress_activity\b/gi,
    /\bhourglass_empty\b/gi,
    /\bpending\b/gi,
    /^\d{1,3}%/gm,           // progress percentages at start
    /\d{1,3}%$/gm,           // progress percentages at end
  ];

  for (const pattern of noisePatterns) {
    cleaned = cleaned.replace(pattern, '');
  }

  // Collapse multiple spaces and trim
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  return cleaned;
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

/** Extract thumbnail URL from a tile */
function extractThumbnail(card: Element): string {
  const thumbImg = card.querySelector('img[alt="Video thumbnail"]') as HTMLImageElement | null;
  if (thumbImg?.src) return thumbImg.src;
  const video = card.querySelector('video');
  if (video) {
    if (video.poster) return video.poster;
    const source = video.querySelector('source');
    if (source?.src) return source.src;
  }
  const genImg = card.querySelector('img[alt="Generated image"]') as HTMLImageElement | null;
  if (genImg?.src) return genImg.src;
  const img = card.querySelector('img');
  if (img?.src) return img.src;
  const bgEls = card.querySelectorAll('[style*="background-image"]');
  for (const el of bgEls) {
    const style = (el as HTMLElement).style.backgroundImage;
    const match = style.match(/url\(["']?(.+?)["']?\)/);
    if (match) return match[1];
  }
  return '';
}

/**
 * Get the row data-index and position of a tile within its row.
 */
function getTileRowInfo(card: Element): { groupIndex: number; positionInRow: number } {
  const row = card.closest('div[data-index]');
  if (!row) return { groupIndex: -1, positionInRow: 0 };
  const groupIndex = parseInt(row.getAttribute('data-index') || '0', 10);

  // Find position within the row: row > flex-container > individual tiles
  const flexContainer = row.firstElementChild;
  if (flexContainer) {
    const children = Array.from(flexContainer.children);
    // The tile might be a direct child or nested one level deeper
    for (let i = 0; i < children.length; i++) {
      if (children[i] === card || children[i].contains(card)) {
        return { groupIndex, positionInRow: i };
      }
    }
  }

  return { groupIndex, positionInRow: 0 };
}

/**
 * Detect media type for a tile.
 */
function detectMediaType(tile: Element): 'video' | 'image' {
  if (tile.querySelector('video')) return 'video';
  const icons = tile.querySelectorAll('i.google-symbols, i[class*="google-symbols"]');
  for (const icon of icons) {
    if (icon.textContent?.trim() === 'videocam') return 'video';
  }
  return 'image';
}

/**
 * Map the selector TileState to our ScannedTileState.
 * We merge 'empty' into 'unknown' for the library display.
 */
function mapTileState(state: TileState): ScannedTileState {
  if (state === 'completed') return 'completed';
  if (state === 'failed') return 'failed';
  if (state === 'generating') return 'generating';
  return 'unknown';
}

// ================================================================
// PHASE 2 — GROUP & DEDUCE
// ================================================================

interface TileGroup {
  groupIndex: number;
  groupId: string;          // "row-{groupIndex}" — unique per virtuoso row
  promptLabel: string;      // best prompt label from all tiles in the group
  tiles: RawTile[];
  mediaType: 'video' | 'image';   // dominant media type
  mergedFromRows: number[];       // all row indices merged into this group
}

/**
 * Build groups from raw tiles. Each virtuoso row = one prompt's generations.
 * Within each group:
 *  - Pick the best prompt label (longest non-empty label wins)
 *  - Determine dominant media type
 *  - Sort tiles by position within row
 */
function buildGroups(rawTiles: RawTile[]): TileGroup[] {
  const groupMap = new Map<number, RawTile[]>();
  for (const tile of rawTiles) {
    if (!groupMap.has(tile.groupIndex)) groupMap.set(tile.groupIndex, []);
    groupMap.get(tile.groupIndex)!.push(tile);
  }

  const groups: TileGroup[] = [];
  for (const [groupIndex, tiles] of groupMap) {
    // Sort tiles by position within the row
    tiles.sort((a, b) => a.positionInRow - b.positionInRow);

    // Pick the best prompt label — longest meaningful one wins
    let bestLabel = '';
    for (const tile of tiles) {
      if (tile.promptLabel.length > bestLabel.length &&
        !tile.promptLabel.startsWith('Prompt group')) {
        bestLabel = tile.promptLabel;
      }
    }

    // Determine dominant media type (majority wins, video breaks ties)
    const videoCount = tiles.filter(t => t.mediaType === 'video').length;
    const imageCount = tiles.filter(t => t.mediaType === 'image').length;
    const dominantType: 'video' | 'image' = videoCount >= imageCount ? 'video' : 'image';

    groups.push({
      groupIndex,
      groupId: `row-${groupIndex}`,
      promptLabel: bestLabel || `Prompt group ${groupIndex}`,
      tiles,
      mediaType: dominantType,
      mergedFromRows: [groupIndex],
    });
  }

  // ── Merge groups that share the same prompt text ──
  // This handles retries: when a prompt fails and is retried, Flow creates
  // a new row. We merge them back into one group so the library shows 7
  // prompts instead of 12 for a 7-prompt queue with retries.
  return mergeGroupsByPromptText(groups);
}

/**
 * Merge groups that share the same prompt text.
 * The oldest group (highest groupIndex = first created) becomes the primary.
 * Tiles from newer groups (retries) are appended with their original row tracked.
 */
function mergeGroupsByPromptText(groups: TileGroup[]): TileGroup[] {
  // Normalize prompt text for comparison (lowercase, collapse whitespace)
  function normalizeLabel(label: string): string {
    return label.toLowerCase().replace(/\s+/g, ' ').trim();
  }

  const merged = new Map<string, TileGroup>();
  // Sort groups by groupIndex descending (oldest = highest index first)
  // so the oldest group becomes the primary entry in the map
  const sorted = [...groups].sort((a, b) => b.groupIndex - a.groupIndex);

  for (const group of sorted) {
    const key = normalizeLabel(group.promptLabel);

    // Skip generic labels ("Prompt group N") — they shouldn't be merged
    if (key.startsWith('prompt group')) {
      // Use unique key to prevent merging
      merged.set(`_generic_${group.groupIndex}`, group);
      continue;
    }

    const existing = merged.get(key);
    if (existing) {
      // Merge: append this group's tiles to the existing group
      existing.tiles.push(...group.tiles);
      existing.mergedFromRows.push(...group.mergedFromRows);
      // Re-sort all tiles by position
      existing.tiles.sort((a, b) => {
        // Primary sort: original row (older rows first)
        if (a.groupIndex !== b.groupIndex) return b.groupIndex - a.groupIndex;
        // Secondary sort: position within row
        return a.positionInRow - b.positionInRow;
      });
    } else {
      merged.set(key, group);
    }
  }

  return Array.from(merged.values());
}

// ================================================================
// PHASE 3 — ENRICH & BUILD FINAL ASSETS
// ================================================================

/**
 * Assign prompt numbers and build the final ScannedAsset array.
 * Prompt numbers are assigned so that the OLDEST prompt = 1
 * (highest groupIndex in Flow = first created).
 */
function enrichAndBuild(groups: TileGroup[]): ScannedAsset[] {
  // Sort groups by groupIndex ascending — Flow's row 0 is the newest prompt
  // so the last group is the oldest.
  groups.sort((a, b) => a.groupIndex - b.groupIndex);

  // Assign prompt numbers: oldest (highest groupIndex) = 1
  const totalGroups = groups.length;
  groups.forEach((g, i) => {
    (g as any)._promptNumber = totalGroups - i;
  });

  const assets: ScannedAsset[] = [];
  let globalIndex = 0;

  for (const group of groups) {
    const promptNumber = (group as any)._promptNumber as number;
    const totalInGroup = group.tiles.length;
    // The primary row is the oldest one (highest groupIndex)
    const primaryRow = Math.max(...group.mergedFromRows);

    for (let genIdx = 0; genIdx < group.tiles.length; genIdx++) {
      const raw = group.tiles[genIdx];
      assets.push({
        index: globalIndex++,
        tileId: raw.tileId,
        label: group.promptLabel,
        thumbnailUrl: raw.thumbnailUrl,
        videoSrc: raw.videoSrc,
        locator: raw.locator,
        selected: false,
        mediaType: raw.mediaType,
        tileState: raw.tileState,
        promptLabel: group.promptLabel,
        groupIndex: group.groupIndex,
        groupId: group.groupId,
        generationNum: genIdx + 1,
        totalInGroup,
        promptNumber,
        isRetry: raw.groupIndex !== primaryRow,
      });
    }
  }

  return assets;
}

// ================================================================
// MAIN SCANNER
// ================================================================

/**
 * Scan the current Flow project page for generated assets.
 * Uses a three-phase approach for maximum accuracy:
 * 1. Scroll & collect every tile with raw metadata
 * 2. Group tiles by virtuoso row (= one prompt's generations)
 * 3. Enrich with prompt numbers, generation numbers, totals
 */
export async function scanProjectForVideos(): Promise<ScannedAsset[]> {
  console.log('[AutoFlow] Smart Scanner: starting scan on', window.location.href);
  const scroller = findOutputScroller();
  const collected = new Map<string, RawTile>();

  function collectVisibleTiles() {
    const tileEls = document.querySelectorAll('div[data-tile-id]');
    for (const tile of tileEls) {
      const htmlTile = tile as HTMLElement;
      const tileId = htmlTile.dataset.tileId || '';
      if (!tileId || collected.has(tileId)) continue;

      // Skip nested data-tile-id elements
      if (htmlTile.parentElement?.closest('div[data-tile-id]')) continue;
      if (!isVisible(tile)) continue;

      // Skip user-uploaded images
      if (isUploadedImage(tile)) continue;

      const state = getTileState(tile);
      // Skip truly empty tiles (no content at all)
      if (state === 'empty') continue;

      const { groupIndex, positionInRow } = getTileRowInfo(tile);
      const mediaType = detectMediaType(tile);

      collected.set(tileId, {
        tileId,
        groupIndex,
        positionInRow,
        mediaType,
        tileState: mapTileState(state),
        thumbnailUrl: extractThumbnail(tile),
        videoSrc: extractVideoSrc(tile),
        promptLabel: extractPromptLabelFromTile(tile),
        locator: `div[data-tile-id="${CSS.escape(tileId)}"]`,
      });
    }
  }

  if (!scroller) {
    console.log('[AutoFlow] Smart Scanner: no scroller, collecting visible tiles');
    collectVisibleTiles();
    console.log(`[AutoFlow] Smart Scanner: ${collected.size} tiles collected (no scroll)`);
  } else {
    console.log('[AutoFlow] Smart Scanner: scrolling to discover all tiles');

    for (let pass = 0; pass < 2; pass++) {
      scroller.scrollTop = 0;
      await sleep(800);
      collectVisibleTiles();

      let prevScroll = -1;
      let stuckCount = 0;
      const prevCollected = collected.size;

      while (stuckCount < 5) {
        const step = Math.max(150, scroller.clientHeight * 0.5);
        scroller.scrollBy(0, step);
        await sleep(600);
        collectVisibleTiles();

        if (Math.abs(scroller.scrollTop - prevScroll) < 5) {
          stuckCount++;
        } else {
          stuckCount = 0;
        }
        prevScroll = scroller.scrollTop;
      }

      collectVisibleTiles();
      const newlyFound = collected.size - prevCollected;
      console.log(`[AutoFlow] Smart Scanner: pass ${pass + 1} found ${newlyFound} new tile(s) (total: ${collected.size})`);
      if (pass > 0 && newlyFound === 0) break;
    }

    scroller.scrollTop = 0;
  }

  // ── Phase 2: Group tiles by row ──
  const rawTiles = Array.from(collected.values());
  const groups = buildGroups(rawTiles);

  // ── Phase 3: Enrich and build final assets ──
  const assets = enrichAndBuild(groups);

  // Stats
  const completed = assets.filter(a => a.tileState === 'completed').length;
  const failed = assets.filter(a => a.tileState === 'failed').length;
  const generating = assets.filter(a => a.tileState === 'generating').length;
  const videos = assets.filter(a => a.mediaType === 'video').length;
  const images = assets.filter(a => a.mediaType === 'image').length;

  console.log(`[AutoFlow] Smart Scanner: scan complete — ${assets.length} assets in ${groups.length} prompts`);
  console.log(`[AutoFlow]   ${videos} videos, ${images} images | ${completed} completed, ${failed} failed, ${generating} generating`);

  return assets;
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
 * Download an asset using Flow's native right-click context menu.
 *
 * Flow's context menu structure (Radix UI):
 *   Right-click tile → context menu with: Add to Scene, Favorite, **Download**, etc.
 *   "Download" is a submenu trigger (aria-haspopup="menu") containing `<i>download</i>`.
 *   Hovering/clicking it opens a submenu with resolution buttons:
 *     `<button role="menuitem"><span>720p</span><span>Original Size</span></button>`
 *     `<button role="menuitem"><span>1080p</span><span>Upscaled</span></button>`
 *     `<button role="menuitem"><span>4K</span><span>Upscaled · 50 credits</span></button>`
 *
 * @param locator    CSS path to relocate the asset tile
 * @param resolution Preferred resolution, e.g. "1080p Upscaled", "4K", "Original (720p)"
 */
export async function downloadAssetByMenu(locator: string, resolution?: string): Promise<boolean> {
  const card = await relocateAsset(locator);
  if (!card) {
    console.warn('[AutoFlow] downloadAssetByMenu: card not found for', locator);
    return false;
  }

  // ── Step 1: Right-click to open Flow's context menu ──
  // IMPORTANT: Must right-click on the INNER content (span[data-state], video, img)
  // because right-clicking the outer div[data-tile-id] shows a "Collection" menu
  // instead of the "Download" menu.

  // Build a list of elements to try, inner content first
  const clickTargets: Element[] = [];

  // Priority 1: span[data-state] within the tile (Radix content wrapper)
  const spans = card.querySelectorAll('span[data-state]');
  for (const s of spans) {
    const r = s.getBoundingClientRect();
    if (r.width > 20 && r.height > 20) clickTargets.push(s);
  }

  // Priority 2: video or img element
  const video = card.querySelector('video');
  if (video) clickTargets.push(video);
  const img = card.querySelector('img');
  if (img) clickTargets.push(img);

  // Priority 3: the tile itself (last resort)
  clickTargets.push(card);

  // Helper: check if the correct context menu opened (has Download icon)
  function hasDownloadMenu(): boolean {
    const items = document.querySelectorAll('[role="menuitem"]');
    for (const item of items) {
      if (!isVisible(item)) continue;
      const icons = item.querySelectorAll('i.google-symbols, i[class*="google-symbols"]');
      for (const icon of icons) {
        if (icon.textContent?.trim().toLowerCase() === 'download') return true;
      }
    }
    return false;
  }

  // Try each target until the correct context menu opens
  let contextMenuOpen = false;
  for (const target of clickTargets) {
    // Dismiss any previously opened (wrong) menu
    if (document.querySelectorAll('[role="menuitem"]').length > 0) {
      pressEscape();
      await sleep(300);
    }

    const r = target.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const tx = r.left + r.width / 2;
    const ty = r.top + r.height / 2;

    target.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, cancelable: true, view: window,
      clientX: tx, clientY: ty, button: 2, buttons: 2,
      pointerId: 1, pointerType: 'mouse', isPrimary: true,
    } as any));
    await sleep(50);
    target.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true, cancelable: true, view: window,
      clientX: tx, clientY: ty, button: 2, buttons: 2,
    }));
    await sleep(800);

    if (hasDownloadMenu()) {
      contextMenuOpen = true;
      console.log(`[AutoFlow] Download context menu opened via ${target.tagName}`);
      break;
    }
  }

  if (!contextMenuOpen) {
    console.warn('[AutoFlow] downloadAssetByMenu: context menu did not open');
    return false;
  }

  // ── Step 2: Find the "Download" submenu trigger ──
  // It's a menuitem with aria-haspopup="menu" containing a google-symbols icon "download"
  const menuItems = document.querySelectorAll('[role="menuitem"]');
  let downloadTrigger: Element | null = null;

  for (const item of menuItems) {
    if (!isVisible(item)) continue;
    // Check for aria-haspopup="menu" (submenu trigger)
    if (item.getAttribute('aria-haspopup') !== 'menu') continue;
    // Check for download icon inside
    const icons = item.querySelectorAll('i.google-symbols, i[class*="google-symbols"]');
    for (const icon of icons) {
      if (icon.textContent?.trim().toLowerCase() === 'download') {
        downloadTrigger = item;
        break;
      }
    }
    if (downloadTrigger) break;
    // Fallback: check text content
    const text = item.textContent?.toLowerCase() || '';
    if (text.includes('download')) {
      downloadTrigger = item;
      break;
    }
  }

  if (!downloadTrigger) {
    console.warn('[AutoFlow] downloadAssetByMenu: Download submenu trigger not found');
    pressEscape();
    return false;
  }

  // ── Step 3: Open the Download submenu ──
  // Hover/click the Download trigger to expand the submenu
  simulateClick(downloadTrigger);
  await sleep(400);

  // Also dispatch pointer events (Radix uses onPointerMove to open submenus)
  const dtRect = downloadTrigger.getBoundingClientRect();
  downloadTrigger.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
  downloadTrigger.dispatchEvent(new PointerEvent('pointermove', {
    bubbles: true, view: window,
    clientX: dtRect.left + dtRect.width / 2,
    clientY: dtRect.top + dtRect.height / 2,
  }));
  await sleep(600);

  // ── Step 4: Find and click the resolution option in the submenu ──
  const resLabel = resolution || 'Original (720p)';
  const resKey = (resLabel.match(/(\d{3,4}[pk])/i) || ['720p'])[0].toLowerCase();

  // Re-query all menuitems (submenu items are now in the DOM)
  const allItems = document.querySelectorAll('[role="menuitem"]');
  let preferredRes: Element | null = null;
  let fallback720: Element | null = null;
  let anyRes: Element | null = null;

  for (const item of allItems) {
    if (!isVisible(item)) continue;
    if (item === downloadTrigger) continue; // skip the trigger itself
    if (item.getAttribute('aria-haspopup') === 'menu') continue; // skip other submenus

    // Check the span children for resolution text (e.g. <span>1080p</span>)
    const spans = item.querySelectorAll('span');
    let itemResText = '';
    for (const span of spans) {
      const t = span.textContent?.trim().toLowerCase() || '';
      if (/\d{3,4}[pk]/i.test(t) || t === '4k') {
        itemResText = t;
        break;
      }
    }

    // Also check full text as fallback
    if (!itemResText) {
      const fullText = (item.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
      if (/\d{3,4}[pk]/i.test(fullText)) {
        itemResText = fullText;
      }
    }

    if (!itemResText) continue;

    // Track matches
    if (itemResText.includes(resKey)) preferredRes = item;
    if (itemResText.includes('720p')) fallback720 = item;
    if (!anyRes) anyRes = item;
  }

  const target = preferredRes || fallback720 || anyRes;
  if (target) {
    const targetText = target.textContent?.trim().replace(/\s+/g, ' ') || '';
    console.log(`[AutoFlow] Download: clicking "${targetText}" (wanted: ${resKey})`);
    simulateClick(target);
    await sleep(500);
    return true;
  }

  console.warn(`[AutoFlow] downloadAssetByMenu: resolution "${resKey}" not found in submenu`);
  pressEscape();
  return false;
}

/**
 * Check if Flow is currently upscaling any video.
 */
export function isUpscalingActive(): boolean {
  const toasts = document.querySelectorAll('[role="status"], [role="alert"], [class*="toast"], [class*="snackbar"]');
  for (const t of toasts) {
    if (!isVisible(t)) continue;
    const text = t.textContent?.toLowerCase() || '';
    if (text.includes('upscaling') || text.includes('upscale')) return true;
  }
  const allText = document.body.innerText?.toLowerCase() || '';
  return allText.includes('upscaling your video');
}

/**
 * Wait for all upscaling operations to finish.
 * Polls every 5 seconds, up to maxWaitMs (default 10 minutes).
 */
export async function waitForUpscalingDone(maxWaitMs: number = 10 * 60 * 1000): Promise<boolean> {
  if (!isUpscalingActive()) return true;

  console.log('[AutoFlow] Waiting for upscaling to complete...');
  const startTime = Date.now();
  let lastLog = 0;

  while (Date.now() - startTime < maxWaitMs) {
    await sleep(5000);
    const elapsed = Math.round((Date.now() - startTime) / 1000);

    if (!isUpscalingActive()) {
      console.log(`[AutoFlow] All upscaling completed after ${elapsed}s`);
      return true;
    }

    if (elapsed - lastLog >= 30) {
      lastLog = elapsed;
      console.log(`[AutoFlow] Still upscaling... (${elapsed}s elapsed)`);
    }
  }

  console.warn('[AutoFlow] Upscaling timed out');
  return false;
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
 * Matches the user's preferred resolution from settings.
 *
 * @param preferred  Resolution label from settings, e.g. "Original (720p)", "1080p Upscaled", "4K"
 *                   If not provided, defaults to 720p.
 */
function findResolutionOption(preferred?: string): Element | null {
  const candidates = document.querySelectorAll('button, [role="button"], [role="menuitem"], [role="option"], a, div[class*="sc-"]');

  // Extract the key resolution part from the preferred label
  // "Original (720p)" → "720p", "1080p Upscaled" → "1080p", "4K" → "4k"
  const prefRaw = (preferred || '720p').toLowerCase();
  const prefKey = (prefRaw.match(/(\d{3,4}[pk])/i) || [prefRaw])[0].toLowerCase();

  let bestMatch: Element | null = null;
  let fallback720: Element | null = null;
  let anyRes: Element | null = null;

  for (const el of candidates) {
    if (!isVisible(el)) continue;
    // Normalise: collapse newlines/whitespace for matching
    const text = (el.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
    if (!/\d{3,4}[pk]/i.test(text) && !text.includes('original')) continue;

    // Track 720p as safe fallback
    if (text.includes('720p')) fallback720 = el;

    // Track first resolution option
    if (!anyRes) anyRes = el;

    // Match by the key resolution part (e.g. "1080p" or "4k")
    if (text.includes(prefKey)) {
      bestMatch = el;
      break;
    }
  }

  return bestMatch || fallback720 || anyRes;
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

/**
 * Retry a single tile from the Library.
 * - If the tile is failed: clicks Flow's native Retry button (regenerates in-place).
 * - If the tile is completed: clicks "Reuse Prompt" to refill the prompt editor,
 *   then clicks Generate to create a new generation.
 * The tile keeps its position in the library (re-scan to see updated result).
 */
export async function retrySingleTile(
  locator: string,
  promptLabel: string,
): Promise<{ success: boolean; method?: string; error?: string }> {
  console.log('[AutoFlow] retrySingleTile: locating tile', locator);

  // 1. Find the tile on the page (scroll if virtualised)
  const tile = await relocateAsset(locator);
  if (!tile) {
    return { success: false, error: 'Could not find the tile on the page. Try re-scanning the library.' };
  }

  const tileState = getTileState(tile);
  console.log('[AutoFlow] retrySingleTile: tile state =', tileState);

  // 2a. Failed tile → click Flow's native Retry button
  if (tileState === 'failed') {
    const retryBtn = findRetryButtonOnTile(tile);
    if (retryBtn) {
      simulateClick(retryBtn);
      console.log('[AutoFlow] retrySingleTile: clicked native Retry on failed tile');
      return { success: true, method: 'retry-failed' };
    }
    return { success: false, error: 'Failed tile found but Retry button not available.' };
  }

  // 2b. Completed or other tile → use right-click context menu → "Reuse Prompt"
  //     This navigates to the creation view with the prompt + images pre-filled.
  //     Then we click Generate to start the re-generation.

  // Build list of inner elements to try right-clicking (same as download approach)
  const clickTargets: Element[] = [];
  const spans = tile.querySelectorAll('span[data-state]');
  for (const s of spans) {
    const r = s.getBoundingClientRect();
    if (r.width > 20 && r.height > 20) clickTargets.push(s);
  }
  const vid = tile.querySelector('video');
  if (vid) clickTargets.push(vid);
  const img = tile.querySelector('img');
  if (img) clickTargets.push(img);
  clickTargets.push(tile);

  // Helper: check if the context menu has "Reuse Prompt"
  function hasReusePromptMenu(): boolean {
    const items = document.querySelectorAll('[role="menuitem"]');
    for (const item of items) {
      if (!isVisible(item)) continue;
      const text = item.textContent?.toLowerCase() || '';
      if (text.includes('reuse') && text.includes('prompt')) return true;
    }
    return false;
  }

  // Right-click to open context menu
  let contextMenuOpen = false;
  for (const target of clickTargets) {
    if (document.querySelectorAll('[role="menuitem"]').length > 0) {
      pressEscape();
      await sleep(300);
    }
    const r = target.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    target.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, cancelable: true, view: window,
      clientX: r.left + r.width / 2, clientY: r.top + r.height / 2,
      button: 2, buttons: 2, pointerId: 1, pointerType: 'mouse', isPrimary: true,
    } as any));
    await sleep(50);
    target.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true, cancelable: true, view: window,
      clientX: r.left + r.width / 2, clientY: r.top + r.height / 2,
      button: 2, buttons: 2,
    }));
    await sleep(800);
    if (hasReusePromptMenu()) {
      contextMenuOpen = true;
      console.log(`[AutoFlow] retrySingleTile: context menu opened via ${target.tagName}`);
      break;
    }
  }

  if (!contextMenuOpen) {
    // ── FALLBACK: manually fill prompt text and Generate ──
    if (promptLabel) {
      const promptInput = findPromptInput();
      if (promptInput) {
        setInputValue(promptInput, promptLabel);
        await sleep(500);
        const genBtn = findGenerateButton();
        if (genBtn) {
          simulateClick(genBtn);
          console.log('[AutoFlow] retrySingleTile: manually filled prompt and clicked Generate');
          return { success: true, method: 'manual-fill' };
        }
      }
    }
    return { success: false, error: 'Could not open context menu on tile. Try using Reuse Prompt manually.' };
  }

  // Find and click "Reuse Prompt" in the context menu
  const menuItems = document.querySelectorAll('[role="menuitem"]');
  let reuseItem: Element | null = null;
  for (const item of menuItems) {
    if (!isVisible(item)) continue;
    const text = item.textContent?.toLowerCase() || '';
    if (text.includes('reuse') && text.includes('prompt')) {
      reuseItem = item;
      break;
    }
  }

  if (!reuseItem) {
    pressEscape();
    return { success: false, error: 'Reuse Prompt not found in context menu.' };
  }

  simulateClick(reuseItem);
  console.log('[AutoFlow] retrySingleTile: clicked Reuse Prompt from context menu');

  // Wait for the creation view to load with prompt + references
  await sleep(2500);

  // Click Generate
  const genBtn = findGenerateButton();
  if (genBtn) {
    simulateClick(genBtn);
    console.log('[AutoFlow] retrySingleTile: clicked Generate after Reuse Prompt');
    return { success: true, method: 'context-menu-reuse' };
  }

  // The prompt was loaded even if we couldn't auto-click Generate
  return { success: true, method: 'context-menu-reuse-no-generate' };
}
