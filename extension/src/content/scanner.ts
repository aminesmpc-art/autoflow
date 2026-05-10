/* ============================================================
   AutoFlow – Smart Library Scanner (Content Script)
   
   Three-phase scanning architecture:
   Phase 1: Scroll & Collect — gather every tile with raw metadata
   Phase 2: Group & Deduce  — group by prompt label (NOT visual row),
            resolve prompt labels, detect media types
   Phase 3: Enrich          — assign prompt numbers, generation
            numbers, totals, and prepare final ScannedAsset[]
   
   Key design choices:
   • Groups by PROMPT LABEL so tiles from the same prompt text
     are grouped together, regardless of visual row in Grid view.
   • Includes ALL tile states (completed, failed, generating,
     unknown) so the Library UI can show everything.
   • Filters out only user-uploaded images.
   ============================================================ */

import { ScannedAsset, ScannedTileState, PromptHistoryEntry } from '../types';
import { getPromptHistory } from '../shared/storage';
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
  getCurrentViewMode,
  switchToViewMode,
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
  modelName: string;         // e.g. "Veo 3.1 - Fast" — from Batch view
  createdAt: string;         // e.g. "Created Mar 31, 2026" — from Batch view
}

// ================================================================
// BATCH METADATA EXTRACTION
// ================================================================

/**
 * Extract additional metadata that's only visible in Batch view.
 * In Batch mode, each tile shows richer info: full prompt text,
 * model name, creation date, etc. These appear as text elements
 * within the tile's detail area (right side of each batch row).
 */
function extractBatchMetadata(card: Element): { modelName: string; createdAt: string; fullPrompt: string } {
  let modelName = '';
  let createdAt = '';
  let fullPrompt = '';

  // Collect all leaf text nodes to analyze
  const allText = card.querySelectorAll('div, span, p');
  let longestText = '';

  for (const el of allText) {
    // Skip non-leaf elements to avoid duplicate text from parent nodes
    if (el.querySelector('div, span, p')) continue;
    const text = (el.textContent || '').trim();
    if (!text) continue;

    // Model name detection: "Veo 3.1 - Fast", "Veo 2 - Quality", "Imagen 4", etc.
    if (!modelName && /^(Veo|Imagen|Nano)\s/i.test(text)) {
      modelName = text;
      continue;
    }

    // Creation date detection: "Created Mar 31, 2026" or similar
    if (!createdAt && /^Created\s/i.test(text)) {
      createdAt = text;
      continue;
    }

    // "Edited" dates as fallback
    if (!createdAt && /^Edited\s/i.test(text)) {
      createdAt = text;
      continue;
    }

    // Track the longest text block — this is likely the full prompt
    // Filter out known non-prompt texts (short UI labels, icon names, etc.)
    if (text.length > 30 && text.length > longestText.length) {
      // Skip texts that are clearly not prompts
      const lower = text.toLowerCase();
      const isNoise = /^(failed|retry|reuse|delete|download|share|created|edited)/i.test(text) ||
        lower.includes('not been charged') || lower.includes('try again');
      if (!isNoise) {
        longestText = text;
      }
    }
  }

  // Pass 2: Use a more robust strategy to find the full prompt.
  // In Batch view, the full prompt is inside a div that may have children
  // (expand button, etc). The leaf-only check from Pass 1 misses it.
  // Strategy: find [data-allow-text-selection] container, then get the
  // textContent of its FIRST child div (the actual prompt text),
  // skipping any button/action children.
  if (longestText.length < 50) {
    const textSelContainers = card.querySelectorAll('[data-allow-text-selection="true"]');
    for (const container of textSelContainers) {
      // Get direct children that are NOT buttons/actions
      for (const child of container.children) {
        if (child.tagName === 'BUTTON') continue;
        if (child.querySelector('button')) continue;
        const text = (child.textContent || '').trim();
        // Strip out any trailing icon text (keyboard_arrow_down, etc.)
        const cleaned = text
          .replace(/keyboard_arrow_(down|up)/g, '')
          .replace(/expand_(more|less)/g, '')
          .replace(/\s+/g, ' ')
          .trim();
        if (cleaned.length > 30 && cleaned.length > longestText.length) {
          const isNoise = /^(failed|retry|reuse|delete|download|share|created|edited)/i.test(cleaned) ||
            cleaned.toLowerCase().includes('not been charged');
          if (!isNoise) {
            longestText = cleaned;
          }
        }
      }
    }
  }

  // Pass 3: Brute-force — walk ALL divs and pick the one with the longest
  // direct textContent that's NOT a container for many children (depth check)
  if (longestText.length < 50) {
    const allDivs = card.querySelectorAll('div');
    for (const div of allDivs) {
      if (div.closest('button')) continue;
      // Skip divs that contain many children (layout containers)
      const childDivCount = div.querySelectorAll('div').length;
      if (childDivCount > 5) continue;
      // Get text, strip icon/button noise
      let text = (div.textContent || '').trim();
      text = text
        .replace(/keyboard_arrow_(down|up)/g, '')
        .replace(/expand_(more|less)/g, '')
        .replace(/(Reuse\s*(text\s*)?prompt|Expand\s*prompt)/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
      if (text.length > 50 && text.length > longestText.length && text.length < 2000) {
        const isNoise = /^(failed|retry|reuse|delete|download|share|created|edited)/i.test(text) ||
          text.toLowerCase().includes('not been charged') || text.toLowerCase().includes('try again') ||
          /^(Veo|Imagen|Nano)\s/i.test(text) || /^(Created|Edited)\s/i.test(text);
        if (!isNoise) {
          longestText = text;
        }
      }
    }
  }

  // The longest text block in a Batch tile is the full prompt
  if (longestText.length > 30) {
    fullPrompt = longestText;
  }

  // Strategy 2: Look in aria-labels for model info
  if (!modelName) {
    const ariaEls = card.querySelectorAll('[aria-label]');
    for (const el of ariaEls) {
      const label = el.getAttribute('aria-label') || '';
      if (/veo|imagen|nano/i.test(label)) {
        const match = label.match(/(Veo[\s\d.\-\w]+|Imagen[\s\d\w]+|Nano[\s\w]+)/i);
        if (match) modelName = match[1].trim();
        break;
      }
    }
  }

  return { modelName, createdAt, fullPrompt };
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

  // Strategy 0: data-card-open attribute (Flow stores prompt metadata here)
  const cardOpen = card.querySelector('[data-card-open]');
  if (cardOpen) {
    const val = cardOpen.getAttribute('data-card-open') || '';
    if (val.length > 2 && val.length < 300) bestLabel = val;
  }

  // Strategy 1: Text sibling of a media icon (videocam / image)
  if (!bestLabel) {
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
          // Skip sibs that contain icons (buttons like Retry/Delete)
          if (sib.querySelector('i.google-symbols, i[class*="google-symbols"]')) continue;
          const text = sib.textContent?.trim();
          if (text && text.length > 2 && text.length < 200 && !NOISE_WORDS.has(text) &&
            !isNoiseLabel(text)) {
            bestLabel = text;
            break;
          }
        }
      }
      if (bestLabel) break;
    }
  }

  // Strategy 2: Walk leaf divs looking for meaningful label text
  // Only pick divs that are INSIDE the tile (not action buttons)
  if (!bestLabel) {
    const allDivs = card.querySelectorAll('div');
    for (const div of allDivs) {
      // Skip non-leaf divs
      if (div.querySelector('div')) continue;
      // Skip divs containing icons (button labels)
      if (div.querySelector('i')) continue;
      // Skip divs inside buttons (action button text)
      if (div.closest('button')) continue;
      const text = div.textContent?.trim();
      if (text && text.length > 3 && text.length < 200 && !NOISE_WORDS.has(text) &&
        !/^\d{1,3}%$/.test(text) && !isNoiseLabel(text)) {
        bestLabel = text;
        break;
      }
    }
  }

  // Strategy 3: aria-label on the tile itself or near parents
  if (!bestLabel) {
    const ariaLabel = card.getAttribute('aria-label') ||
      card.closest('[aria-label]')?.getAttribute('aria-label') || '';
    if (ariaLabel.length > 3 && ariaLabel.length < 200 && !isNoiseLabel(ariaLabel)) {
      bestLabel = ariaLabel;
    }
  }

  return cleanPromptLabel(bestLabel);
}

/**
 * Check if a label looks like UI noise rather than a real prompt.
 */
function isNoiseLabel(text: string): boolean {
  const lower = text.toLowerCase().trim();
  // Common button/icon text that gets picked up
  if (/^(redo|retry|reuse|delete|copy|share|download|refresh|undo|more)\b/i.test(lower)) return true;
  // Just a number or percentage
  if (/^\d+%?$/.test(lower)) return true;
  // Concatenated icon text (multiple noise words joined)
  const noiseCount = [...NOISE_WORDS].filter(w => lower.includes(w.toLowerCase())).length;
  if (noiseCount >= 2) return true;
  return false;
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

/**
 * Convert a loaded HTMLImageElement or video poster to a small base64 data URI.
 * Returns '' if conversion fails. Uses canvas to bypass cross-origin URL issues
 * so the sidepanel can display the thumbnail.
 */
function imgElementToDataUrl(img: HTMLImageElement, maxSize = 160): string {
  try {
    if (!img.naturalWidth || !img.naturalHeight) return '';
    const canvas = document.createElement('canvas');
    const scale = Math.min(maxSize / img.naturalWidth, maxSize / img.naturalHeight, 1);
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.7);
  } catch {
    // Cross-origin tainted canvas — fall back to raw URL
    return img.src || '';
  }
}

/** Extract thumbnail as a base64 data URI from a tile (for sidepanel display) */
function extractThumbnail(card: Element): string {
  // Try img elements first — they're already loaded so we can convert via canvas
  const thumbImg = card.querySelector('img[alt="Video thumbnail"]') as HTMLImageElement | null;
  if (thumbImg?.src) {
    const dataUrl = imgElementToDataUrl(thumbImg);
    if (dataUrl) return dataUrl;
  }
  const video = card.querySelector('video');
  if (video) {
    // Try to capture a frame from the video if it's loaded
    if (video.readyState >= 2 && video.videoWidth > 0) {
      try {
        const canvas = document.createElement('canvas');
        const maxSize = 160;
        const scale = Math.min(maxSize / video.videoWidth, maxSize / video.videoHeight, 1);
        canvas.width = Math.round(video.videoWidth * scale);
        canvas.height = Math.round(video.videoHeight * scale);
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
          if (dataUrl && dataUrl.length > 100) return dataUrl;
        }
      } catch { /* tainted — continue */ }
    }
    if (video.poster) return video.poster; // fallback to raw URL
  }
  const genImg = card.querySelector('img[alt="Generated image"]') as HTMLImageElement | null;
  if (genImg?.src) {
    const dataUrl = imgElementToDataUrl(genImg);
    if (dataUrl) return dataUrl;
  }
  const img = card.querySelector('img') as HTMLImageElement | null;
  if (img?.src) {
    const dataUrl = imgElementToDataUrl(img);
    if (dataUrl) return dataUrl;
  }
  // Background image fallback (raw URL)
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
  groupId: string;          // "prompt-{n}" — unique per prompt label
  promptLabel: string;      // the prompt text this group represents
  tiles: RawTile[];
  mediaType: 'video' | 'image';   // dominant media type
  mergedFromRows: number[];       // all row indices that contributed tiles
}

/**
 * Build groups from raw tiles using a ROW-FIRST approach.
 *
 * Why row-first? In Grid view, tiles from the same prompt share
 * the same visual row (data-index). Failed tiles also stay in
 * their prompt's row, so grouping by row keeps them together
 * — even when their visible text is an error message.
 *
 * Two-step process:
 *   1. Group tiles by groupIndex (row). Each row = one prompt's tiles.
 *   2. Merge row-groups that share the same real (non-error) prompt text.
 *      This handles retries, which create new rows for the same prompt.
 */
function buildGroups(rawTiles: RawTile[]): TileGroup[] {
  function normalizeLabel(label: string): string {
    return label.toLowerCase().replace(/\s+/g, ' ').trim();
  }

  // Detect error messages that should NOT be used as grouping keys
  function isErrorText(label: string): boolean {
    const lower = label.toLowerCase();
    return (
      lower.includes('please try a different prompt') ||
      lower.includes('not been charged') ||
      lower.includes('try again later') ||
      lower.includes('unable to generate') ||
      lower.includes('violates our') ||
      lower.includes('content policy') ||
      lower.includes('generation failed') ||
      /^audio generation\s*\./i.test(label)
    );
  }

  // ── Step 1: Group tiles by row (groupIndex) ──
  const rowMap = new Map<number, RawTile[]>();
  for (const tile of rawTiles) {
    const row = tile.groupIndex;
    if (!rowMap.has(row)) rowMap.set(row, []);
    rowMap.get(row)!.push(tile);
  }

  // For each row, determine the "real" prompt label
  // (the longest non-error label from the row's tiles)
  interface RowGroup {
    rowIndex: number;
    tiles: RawTile[];
    realLabel: string;        // best non-error label from this row
    normalizedKey: string;    // for merging across rows
  }

  const rowGroups: RowGroup[] = [];
  let unknownCounter = 0;

  for (const [rowIndex, tiles] of rowMap) {
    // Sort by position within the row
    tiles.sort((a, b) => a.positionInRow - b.positionInRow);

    // Find the best non-error prompt label from this row
    let bestLabel = '';
    for (const tile of tiles) {
      const label = tile.promptLabel.trim();
      if (label && !isErrorText(label) && label.length > bestLabel.length) {
        bestLabel = label;
      }
    }

    // If no good label found (all tiles are errors/empty), use error text
    if (!bestLabel) {
      for (const tile of tiles) {
        if (tile.promptLabel.trim().length > bestLabel.length) {
          bestLabel = tile.promptLabel.trim();
        }
      }
    }

    // Generate grouping key: use real prompt text if available,
    // otherwise use unique key per row to prevent false merges
    const normalizedKey = bestLabel && !isErrorText(bestLabel)
      ? normalizeLabel(bestLabel)
      : `_row_${rowIndex}_${unknownCounter++}`;

    rowGroups.push({ rowIndex, tiles, realLabel: bestLabel, normalizedKey });
  }

  // ── Step 2: Merge row-groups that share the same prompt text ──
  // This handles retries (same prompt → new row)
  const mergeMap = new Map<string, RowGroup[]>();
  for (const rg of rowGroups) {
    if (!mergeMap.has(rg.normalizedKey)) mergeMap.set(rg.normalizedKey, []);
    mergeMap.get(rg.normalizedKey)!.push(rg);
  }

  const groups: TileGroup[] = [];
  let groupCounter = 0;

  for (const [, mergedRows] of mergeMap) {
    // Combine all tiles from merged rows
    const allTiles: RawTile[] = [];
    const allRowIndices: number[] = [];
    let bestLabel = '';

    for (const rg of mergedRows) {
      allTiles.push(...rg.tiles);
      allRowIndices.push(rg.rowIndex);
      if (rg.realLabel.length > bestLabel.length) {
        bestLabel = rg.realLabel;
      }
    }

    // Sort: oldest row (highest index) first, then by position
    allTiles.sort((a, b) => {
      if (a.groupIndex !== b.groupIndex) return b.groupIndex - a.groupIndex;
      return a.positionInRow - b.positionInRow;
    });

    const representativeRow = Math.max(...allRowIndices);
    const videoCount = allTiles.filter(t => t.mediaType === 'video').length;
    const imageCount = allTiles.filter(t => t.mediaType === 'image').length;

    groups.push({
      groupIndex: representativeRow,
      groupId: `prompt-${groupCounter++}`,
      promptLabel: bestLabel || `Prompt group ${groupCounter}`,
      tiles: allTiles,
      mediaType: videoCount >= imageCount ? 'video' : 'image',
      mergedFromRows: [...new Set(allRowIndices)],
    });
  }

  return groups;
}

// ================================================================
// PHASE 3 — ENRICH & BUILD FINAL ASSETS
// ================================================================

/**
 * Assign prompt numbers and build the final ScannedAsset array.
 * Prompt numbers are assigned so that the OLDEST prompt = 1.
 *
 * Sorting strategy:
 *   1. Match against saved prompt history (from queue runs) — most reliable
 *   2. Fall back to creation date from Batch metadata
 *   3. Fall back to groupIndex position
 */
function enrichAndBuild(groups: TileGroup[], history: PromptHistoryEntry[]): ScannedAsset[] {
  // Helper: normalize text for fuzzy matching
  function norm(text: string): string {
    return text.toLowerCase().replace(/\s+/g, ' ').trim();
  }

  // Helper: parse "Created Apr 3, 2026" → timestamp for sorting
  function parseCreatedDate(text: string): number {
    if (!text) return 0;
    const cleaned = text.replace(/^(Created|Edited)\s+/i, '').trim();
    const ts = Date.parse(cleaned);
    return isNaN(ts) ? 0 : ts;
  }

  // Build a flat lookup from ALL history entries: normalized prompt text → original index
  // Most recent history entries take priority (later in array = newer)
  const historyLookup = new Map<string, number>();
  for (const entry of history) {
    for (const p of entry.prompts) {
      historyLookup.set(norm(p.text), p.index);
    }
  }

  // Try to match each group to a saved history position
  let matchedCount = 0;
  for (const group of groups) {
    const groupNorm = norm(group.promptLabel);
    let matchedIndex = -1;

    // Exact match first
    if (historyLookup.has(groupNorm)) {
      matchedIndex = historyLookup.get(groupNorm)!;
    } else {
      // Substring match: check if the scanned label contains or is contained by a saved prompt
      for (const [savedNorm, idx] of historyLookup) {
        if (groupNorm.length > 20 && savedNorm.length > 20) {
          if (savedNorm.includes(groupNorm) || groupNorm.includes(savedNorm)) {
            matchedIndex = idx;
            break;
          }
        }
      }
    }

    (group as any)._historyIndex = matchedIndex;
    if (matchedIndex >= 0) matchedCount++;
  }

  console.log(`[AutoFlow] Prompt history match: ${matchedCount}/${groups.length} groups matched`);

  // For each group, find the OLDEST creation date among its tiles
  for (const group of groups) {
    let oldestDate = Infinity;
    let hasDate = false;
    for (const tile of group.tiles) {
      const ts = parseCreatedDate(tile.createdAt);
      if (ts > 0) {
        hasDate = true;
        if (ts < oldestDate) oldestDate = ts;
      }
    }
    (group as any)._oldestDate = hasDate ? oldestDate : 0;
  }

  // Sort groups: history index first, then date, then groupIndex
  groups.sort((a, b) => {
    const histA = (a as any)._historyIndex as number;
    const histB = (b as any)._historyIndex as number;
    // If both have history matches, sort by saved index (oldest = 0)
    if (histA >= 0 && histB >= 0) return histA - histB;
    // History-matched groups come before unmatched ones
    if (histA >= 0) return -1;
    if (histB >= 0) return 1;
    // Neither matched: fall back to date
    const dateA = (a as any)._oldestDate as number;
    const dateB = (b as any)._oldestDate as number;
    if (dateA > 0 && dateB > 0) return dateA - dateB;
    if (dateA > 0) return -1;
    if (dateB > 0) return 1;
    // Final fallback: higher groupIndex = older
    return b.groupIndex - a.groupIndex;
  });

  // Assign prompt numbers: first in sorted order = 1
  const totalGroups = groups.length;
  groups.forEach((g, i) => {
    (g as any)._promptNumber = i + 1;
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
        modelName: raw.modelName || '',
        createdAt: raw.createdAt || '',
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
 *
 * BATCH-FIRST SMART SCAN — always switches to Batch view for
 * the richest metadata (full prompt, model, creation date),
 * then restores the user's original view mode after scanning.
 *
 * Grouping uses the row-first approach in buildGroups():
 *   - Batch: each tile has its own row → merged by prompt text
 *   - Error messages are excluded from merge keys
 */
export async function scanProjectForVideos(): Promise<ScannedAsset[]> {
  console.log('[AutoFlow] Smart Scanner: starting Batch scan on', window.location.href);

  // Save original view so we can restore it later
  const originalView = await getCurrentViewMode();
  console.log(`[AutoFlow] Smart Scanner: original view = ${originalView || 'unknown'}`);

  // Switch to Batch view for the richest tile data
  if (originalView !== 'Batch') {
    const switched = await switchToViewMode('Batch');
    if (switched) {
      console.log('[AutoFlow] Smart Scanner: switched to Batch view');
    } else {
      console.log('[AutoFlow] Smart Scanner: could not switch to Batch, scanning current view');
    }
  }

  const collected = new Map<string, RawTile>();

  function collectVisibleTiles() {
    const tileEls = document.querySelectorAll('div[data-tile-id]');
    for (const tile of tileEls) {
      const htmlTile = tile as HTMLElement;
      const tileId = htmlTile.dataset.tileId || '';
      if (!tileId || collected.has(tileId)) continue;
      if (htmlTile.parentElement?.closest('div[data-tile-id]')) continue;
      if (!isVisible(tile)) continue;
      if (isUploadedImage(tile)) continue;

      const state = getTileState(tile);
      if (state === 'empty') continue;

      const { groupIndex, positionInRow } = getTileRowInfo(tile);

      // Extract rich metadata from Batch view
      // In Batch view, the tile (div[data-tile-id]) is just the thumbnail.
      // The full prompt, model, and date are in a SIBLING div (detail panel).
      // So we pass the parent row container to extractBatchMetadata.
      let promptLabel = extractPromptLabelFromTile(tile);
      const rowContainer = tile.closest('[data-index]') || tile.parentElement || tile;
      const batchMeta = extractBatchMetadata(rowContainer);

      // Use full prompt from Batch if available (longer and richer)
      if (batchMeta.fullPrompt && batchMeta.fullPrompt.length > promptLabel.length) {
        promptLabel = batchMeta.fullPrompt;
      }

      collected.set(tileId, {
        tileId,
        groupIndex,
        positionInRow,
        mediaType: detectMediaType(tile),
        tileState: mapTileState(state),
        thumbnailUrl: extractThumbnail(tile),
        videoSrc: extractVideoSrc(tile),
        promptLabel,
        locator: `div[data-tile-id="${CSS.escape(tileId)}"]`,
        modelName: batchMeta.modelName,
        createdAt: batchMeta.createdAt,
      });
    }
  }

  const scroller = findOutputScroller();
  if (!scroller) {
    collectVisibleTiles();
    console.log(`[AutoFlow] Smart Scanner: ${collected.size} tiles (no scroll)`);
  } else {
    for (let pass = 0; pass < 2; pass++) {
      scroller.scrollTop = 0;
      await sleep(800);
      collectVisibleTiles();

      let prevScroll = -1;
      let stuckCount = 0;
      const prevCount = collected.size;

      while (stuckCount < 5) {
        scroller.scrollBy(0, Math.max(150, scroller.clientHeight * 0.5));
        await sleep(600);
        collectVisibleTiles();

        if (Math.abs(scroller.scrollTop - prevScroll) < 5) stuckCount++;
        else stuckCount = 0;
        prevScroll = scroller.scrollTop;
      }

      collectVisibleTiles();
      const newFound = collected.size - prevCount;
      console.log(`[AutoFlow] Smart Scanner: pass ${pass + 1}, +${newFound} tiles (total: ${collected.size})`);
      if (pass > 0 && newFound === 0) break;
    }
    scroller.scrollTop = 0;
  }

  // ── Group tiles (row-first, then merge by prompt text) ──
  const rawTiles = Array.from(collected.values());
  const groups = buildGroups(rawTiles);

  // ── Load prompt history for sorting ──
  let history: PromptHistoryEntry[] = [];
  try {
    history = await getPromptHistory();
    if (history.length > 0) {
      const totalPrompts = history.reduce((sum, h) => sum + h.prompts.length, 0);
      console.log(`[AutoFlow] Smart Scanner: loaded ${history.length} history entries (${totalPrompts} prompts)`);
    }
  } catch (e) {
    console.log('[AutoFlow] Smart Scanner: could not load prompt history', e);
  }

  // ── Enrich and build final assets ──
  const assets = enrichAndBuild(groups, history);

  // Stats
  const completed = assets.filter(a => a.tileState === 'completed').length;
  const failed = assets.filter(a => a.tileState === 'failed').length;
  const generating = assets.filter(a => a.tileState === 'generating').length;
  const videos = assets.filter(a => a.mediaType === 'video').length;
  const images = assets.filter(a => a.mediaType === 'image').length;

  console.log(`[AutoFlow] Smart Scanner: scan complete — ${assets.length} assets in ${groups.length} prompts`);
  console.log(`[AutoFlow]   ${videos} videos, ${images} images | ${completed} completed, ${failed} failed, ${generating} generating`);

  // ── Restore original view mode ──
  if (originalView && originalView !== 'Batch') {
    console.log(`[AutoFlow] Smart Scanner: restoring ${originalView} view`);
    await switchToViewMode(originalView);
  }

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
        await setInputValue(promptInput, promptLabel);
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
