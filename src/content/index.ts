/* ============================================================
   AutoFlow – Content Script Entry Point
   Runs on labs.google/flow pages.
   Routes messages to the automation engine and scanner.
   ============================================================ */

import { Message, QueueObject } from '../types';
import { AutomationEngine, isRunLocked } from './automation';
import { scanProjectForVideos, previewAsset, retrySingleTile, downloadAssetByMenu, waitForUpscalingDone } from './scanner';
import { sleep, findModelSelectorTrigger, findMenuItem, simulateClick } from './selectors';
import { DOM_SETTLE_MS } from '../shared/constants';

// ── Singleton engine ──
let engine: AutomationEngine | null = null;

// ── Anti-throttle: periodic self-ping via service worker roundtrip ──
// When Chrome throttles background tabs, setTimeout delays balloon.
// A message roundtrip to the service worker wakes up the main thread.
let antiThrottleInterval: ReturnType<typeof setInterval> | null = null;

function startAntiThrottle() {
  if (antiThrottleInterval) return;
  antiThrottleInterval = setInterval(() => {
    // Round-trip to SW — the act of receiving the response wakes the thread
    chrome.runtime.sendMessage({ type: 'PING' }).catch(() => {});
  }, 15_000); // every 15 seconds
  console.log('[AutoFlow] Anti-throttle started');
}

function stopAntiThrottle() {
  if (antiThrottleInterval) {
    clearInterval(antiThrottleInterval);
    antiThrottleInterval = null;
    console.log('[AutoFlow] Anti-throttle stopped');
  }
}

// ── Handle (re-)injection: always register a fresh listener ──
// When the extension context is invalidated (e.g. extension closed & reopened,
// extension updated, or service worker restart), the old listener is dead even
// though `__autoflow_injected` may still be true in the isolated world.
// We remove any previous listener reference and re-register to ensure the
// content script is always reachable.

function _autoflowMessageHandler(msg: Message, sender: any, sendResponse: (r: any) => void) {
  handleMessage(msg)
    .then(sendResponse)
    .catch(err => {
      console.error('[AutoFlow] Content script error:', err);
      sendResponse({ error: err.message });
    });
  return true; // async
}

if ((window as any).__autoflow_listener) {
  try {
    chrome.runtime.onMessage.removeListener((window as any).__autoflow_listener);
  } catch (_) { /* old context may be dead, ignore */ }
}
(window as any).__autoflow_listener = _autoflowMessageHandler;
chrome.runtime.onMessage.addListener(_autoflowMessageHandler);

if (!(window as any).__autoflow_injected) {
  (window as any).__autoflow_injected = true;
  console.log('[AutoFlow] Content script loaded on', window.location.href);
} else {
  console.log('[AutoFlow] Content script re-injected, listener refreshed.');
}

async function handleMessage(msg: Message): Promise<any> {
  switch (msg.type) {
    case 'START_QUEUE':
      return startQueue(msg.payload.queue);

    case 'PAUSE_QUEUE':
      engine?.pause();
      return { success: true };

    case 'RESUME_QUEUE':
      engine?.resume();
      return { success: true };

    case 'STOP_QUEUE':
      engine?.stop();
      stopAntiThrottle();
      return { success: true };

    case 'SKIP_CURRENT':
      engine?.skipCurrent();
      return { success: true };

    case 'RETRY_FAILED':
      engine?.retryFailed();
      return { success: true };

    case 'SCAN_FAILED_TILES':
      if (engine) {
        const result = await engine.scanFailedTiles();
        return result;
      }
      return { failedPrompts: [], failedCount: 0 };

    case 'RETRY_FAILED_TILES':
      if (engine) {
        const retryResult = await engine.retryFailedOnPage();
        return retryResult;
      }
      return { retried: 0, total: 0 };

    case 'SCAN_LIBRARY':
      return scanLibrary();

    case 'RETRY_SINGLE_TILE':
      return retrySingleTileHandler(msg.payload);

    case 'PREVIEW_ASSET':
      return previewAssetHandler(msg.payload);

    case 'DOWNLOAD_SELECTED':
      return downloadSelected(msg.payload);

    case 'REFRESH_MODELS':
      return refreshModels();

    case 'UPLOAD_IMAGES_TO_FLOW':
    case 'GET_IMAGE_BLOBS':
      // These are forwarded via background to sidepanel — content script never handles directly
      // Return signal so background knows to ask sidepanel
      return { needsSidepanelRelay: true };

    case 'IMAGE_BLOBS_RESULT':
      // This would be received if background relays blob data here
      return msg.payload;

    case 'PING':
      return { type: 'PONG', runLocked: isRunLocked() };

    default:
      return { error: `Unknown message: ${msg.type}` };
  }
}

async function startQueue(queue: QueueObject): Promise<any> {
  engine = new AutomationEngine();
  startAntiThrottle();  // Fight tab throttling during automation
  // Don't await — run in background so the message can respond
  engine.start(queue).then(() => {
    stopAntiThrottle();  // Queue finished — stop self-ping
  }).catch(err => {
    console.error('[AutoFlow] Queue error:', err);
    stopAntiThrottle();
  });
  return { success: true };
}

async function scanLibrary(): Promise<any> {
  try {
    const assets = await scanProjectForVideos();
    return { assets };
  } catch (err: any) {
    return { error: err.message };
  }
}

async function previewAssetHandler(payload: { locator: string }): Promise<any> {
  const success = await previewAsset(payload.locator);
  return { success };
}

async function retrySingleTileHandler(payload: { locator: string; promptLabel: string }): Promise<any> {
  try {
    const result = await retrySingleTile(payload.locator, payload.promptLabel);
    return result;
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

/**
 * Sanitise a prompt string into a filesystem-safe slug.
 * Keeps the first ~40 chars, lowercased, trimmed, spaces → underscores.
 */
function slugify(text: string, maxLen = 40): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9 _-]/g, '')
    .trim()
    .replace(/\s+/g, '_')
    .slice(0, maxLen)
    .replace(/_+$/, '');
}

/**
 * Convert a possibly-relative URL to an absolute URL using the page origin.
 */
function toAbsoluteUrl(url: string): string {
  if (/^https?:\/\//i.test(url) || url.startsWith('data:') || url.startsWith('blob:')) {
    return url;
  }
  const origin = window.location.origin;
  return url.startsWith('/') ? `${origin}${url}` : `${origin}/${url}`;
}

async function downloadSelected(payload: {
  assets: Array<{
    locator: string;
    index: number;
    mediaType?: string;
    videoSrc?: string;
    thumbnailUrl?: string;
    promptLabel?: string;
    groupIndex?: number;
  }>;
  queueName: string;
  resolution?: string;
}): Promise<any> {
  const results: string[] = [];

  // ── Compute prompt numbers from promptLabel ordering ──
  // Group by promptLabel so all tiles from the same prompt share one number.
  // Flow shows newest prompts first (lowest groupIndex = newest), but the user
  // expects prompt 001 to be the FIRST prompt they created (oldest).
  // So we reverse the label order: last unique label → 001, first → highest num.
  const uniqueLabels: string[] = [];
  for (const a of payload.assets) {
    const key = a.promptLabel || '';
    if (!uniqueLabels.includes(key)) uniqueLabels.push(key);
  }
  // Reverse so oldest prompt (appearing last in the scan) gets number 1
  const reversedLabels = [...uniqueLabels].reverse();
  const labelToPromptNum = new Map<string, number>();
  reversedLabels.forEach((label, i) => labelToPromptNum.set(label, i + 1));

  // ── Count generations per prompt for sequential naming ──
  const genCounter = new Map<number, number>();

  // Determine if we need menu-based download (for upscaled resolutions)
  const resolutionLabel = payload.resolution || 'Original (720p)';
  const needsMenuDownload = !resolutionLabel.toLowerCase().includes('720p');

  if (needsMenuDownload) {
    // ══════════════════════════════════════════════════════════
    // 3-PHASE BATCH DOWNLOAD for 1080p / 4K
    // Phase 1: Trigger upscaling for ALL videos
    // Phase 2: Wait for ALL upscaling to complete
    // Phase 3: Download upscaled videos one by one
    // ══════════════════════════════════════════════════════════

    // ── Phase 1: Trigger upscaling for all selected assets ──
    console.log(`[AutoFlow] Phase 1: Triggering ${resolutionLabel} upscaling for ${payload.assets.length} asset(s)...`);
    for (const asset of payload.assets) {
      try {
        const ok = await downloadAssetByMenu(asset.locator, resolutionLabel);
        if (ok) {
          console.log(`[AutoFlow] Upscaling triggered for: ${asset.promptLabel || 'asset'}`);
        } else {
          console.warn(`[AutoFlow] Could not trigger upscaling for: ${asset.promptLabel || 'asset'}`);
        }
      } catch (e: any) {
        console.error(`[AutoFlow] Upscaling trigger error:`, e);
      }
      await sleep(2000); // 2s between each to avoid overloading Flow
    }

    // ── Phase 2: Wait for all upscaling to complete ──
    console.log('[AutoFlow] Phase 2: Waiting for all upscaling to finish...');
    await sleep(3000); // give toasts time to appear
    const upscaleDone = await waitForUpscalingDone(15 * 60 * 1000); // 15 min max
    if (!upscaleDone) {
      console.warn('[AutoFlow] Some upscaling may not have completed (timed out)');
    }
    await sleep(2000); // UI settle time

    // ── Phase 3: Download upscaled videos one by one ──
    console.log(`[AutoFlow] Phase 3: Downloading ${payload.assets.length} upscaled asset(s)...`);
    for (const asset of payload.assets) {
      try {
        // Build prompt-based filename
        const ext = asset.mediaType === 'image' ? 'png' : 'mp4';
        const promptNum = labelToPromptNum.get(asset.promptLabel || '') ?? (asset.index + 1);
        const genNum = (genCounter.get(promptNum) ?? 0) + 1;
        genCounter.set(promptNum, genNum);

        const promptSlug = slugify(asset.promptLabel || '');
        const numTag = String(promptNum).padStart(3, '0');
        const genSuffix = genNum > 1 ? ` (${genNum - 1})` : '';
        const baseName = promptSlug
          ? `${numTag}_${promptSlug}${genSuffix}`
          : `prompt_${numTag}${genSuffix}`;
        const filename = `LIBRARY/${payload.queueName || 'project'}/${baseName}.${ext}`;

        // Queue the rename
        await chrome.runtime.sendMessage({
          type: 'SET_DOWNLOAD_RENAME',
          payload: { filename },
        });

        // Download (now the upscaled version should download directly)
        const ok = await downloadAssetByMenu(asset.locator, resolutionLabel);
        if (ok) {
          results.push(filename);
        } else {
          console.warn(`[AutoFlow] Re-download failed for: ${asset.promptLabel || 'asset'}`);
        }
      } catch (e: any) {
        console.error('[AutoFlow] Download error:', e);
      }
      await sleep(1500);
    }
  } else {
    // ══════════════════════════════════════════════════════════
    // DIRECT URL DOWNLOAD for 720p (Original)
    // ══════════════════════════════════════════════════════════
    for (const asset of payload.assets) {
      try {
        let rawUrl: string | null = null;
        if (asset.mediaType === 'video' && asset.videoSrc) {
          rawUrl = asset.videoSrc;
        } else if (asset.thumbnailUrl) {
          rawUrl = asset.thumbnailUrl;
        }
        if (!rawUrl) continue;

        const absoluteUrl = toAbsoluteUrl(rawUrl);

        const ext = asset.mediaType === 'image' ? 'png' : 'mp4';
        const promptNum = labelToPromptNum.get(asset.promptLabel || '') ?? (asset.index + 1);
        const genNum = (genCounter.get(promptNum) ?? 0) + 1;
        genCounter.set(promptNum, genNum);

        const promptSlug = slugify(asset.promptLabel || '');
        const numTag = String(promptNum).padStart(3, '0');
        const genSuffix = genNum > 1 ? ` (${genNum - 1})` : '';
        const baseName = promptSlug
          ? `${numTag}_${promptSlug}${genSuffix}`
          : `prompt_${numTag}${genSuffix}`;
        const filename = `LIBRARY/${payload.queueName || 'project'}/${baseName}.${ext}`;

        const response = await chrome.runtime.sendMessage({
          type: 'DOWNLOAD_FILE',
          payload: { url: absoluteUrl, filename },
        });

        if (response?.downloadId) {
          results.push(filename);
        } else {
          console.warn('[AutoFlow] Download failed:', response?.error || 'unknown');
        }
      } catch (e: any) {
        console.error('[AutoFlow] Download error:', e);
      }
      await sleep(800);
    }
  }
  return { downloaded: results };
}

async function refreshModels(): Promise<any> {
  const models: string[] = [];

  // Try to open model selector
  const trigger = findModelSelectorTrigger();
  if (!trigger) {
    return { models: [], error: 'Model selector not found' };
  }

  simulateClick(trigger);
  await sleep(DOM_SETTLE_MS);

  // Read all menu items
  const items = document.querySelectorAll('[role="menuitem"], [role="option"], .mat-menu-item, .mdc-list-item, [role="listbox"] [role="option"]');
  for (const item of items) {
    const text = item.textContent?.trim();
    if (text && text.length > 0 && text.length < 100) {
      models.push(text);
    }
  }

  // Close menu
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await sleep(300);

  return { models };
}
