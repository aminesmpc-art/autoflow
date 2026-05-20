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
import { getRunningQueue, clearRunningQueue } from '../shared/storage';

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

// ── Auto-resume: check if a queue was running before page reload ──
(async () => {
  try {
    const saved = await getRunningQueue();
    if (!saved) return;

    const { queue, currentIndex } = saved;
    const remaining = queue.prompts.length - currentIndex;

    if (remaining <= 0) {
      // Queue was already done, just clear it
      await clearRunningQueue();
      return;
    }

    console.log(`[AutoFlow] Detected interrupted queue "${queue.name}" — ${remaining} prompts remaining (from #${currentIndex + 1})`);

    // Wait for the Flow page to fully load
    await sleep(3000);

    // Set the resume point
    queue.currentPromptIndex = currentIndex;

    // Mark already-processed prompts so the engine doesn't re-send them
    for (let i = 0; i < currentIndex; i++) {
      if (queue.prompts[i].status !== 'failed') {
        queue.prompts[i].status = 'done';
      }
    }

    console.log(`[AutoFlow] Auto-resuming queue "${queue.name}" from prompt #${currentIndex + 1}...`);
    startQueue(queue);
  } catch (e) {
    console.warn('[AutoFlow] Auto-resume check failed:', e);
  }
})();

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

    case 'UPSCALE_SELECTED':
      return upscaleSelected(msg.payload);

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
  // ── Guard: prevent multiple concurrent engines ──
  // If we already have a running engine, stop it first
  if (engine) {
    console.warn('[AutoFlow] Stopping previous engine before starting new queue');
    engine.stop();
    engine = null;
    await sleep(500); // Let DOM settle after stopping
  }

  // De-duplicate rapid START_QUEUE messages (e.g. double-clicks or re-injections)
  const now = Date.now();
  if ((window as any).__af_lastStartTime && now - (window as any).__af_lastStartTime < 3000) {
    console.warn('[AutoFlow] Ignoring duplicate START_QUEUE (received within 3s of last start)');
    return { success: true, deduplicated: true };
  }
  (window as any).__af_lastStartTime = now;

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

/**
 * Upscale selected assets WITHOUT downloading.
 * Just triggers Flow's upscaling for each video, then returns.
 */
async function upscaleSelected(payload: {
  assets: Array<{
    locator: string;
    promptLabel?: string;
  }>;
  resolution: string;
}): Promise<{ triggered: number; failed: number }> {
  const resolution = payload.resolution || '1080p Upscaled';
  let triggered = 0;
  let failed = 0;

  console.log(`[AutoFlow] Upscale-only: triggering ${resolution} for ${payload.assets.length} asset(s)...`);

  // Suppress downloads — Flow's context menu triggers both upscale AND download,
  // but we only want the upscale. The service worker will cancel any downloads.
  await chrome.runtime.sendMessage({ type: 'SUPPRESS_DOWNLOADS' });

  try {
    for (const asset of payload.assets) {
      try {
        const ok = await downloadAssetByMenu(asset.locator, resolution);
        if (ok) {
          triggered++;
          console.log(`[AutoFlow] Upscale triggered: ${asset.promptLabel || 'asset'}`);
        } else {
          failed++;
          console.warn(`[AutoFlow] Could not trigger upscale: ${asset.promptLabel || 'asset'}`);
        }
      } catch (e: any) {
        failed++;
        console.error('[AutoFlow] Upscale error:', e);
      }
      await sleep(2000);
    }
  } finally {
    // Always unsuppress, even if errors occurred
    await chrome.runtime.sendMessage({ type: 'UNSUPPRESS_DOWNLOADS' });
  }

  console.log(`[AutoFlow] Upscale-only complete: ${triggered} triggered, ${failed} failed`);
  return { triggered, failed };
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
    promptNumber?: number;
    generationNum?: number;
  }>;
  queueName: string;
  resolution?: string;
}): Promise<any> {
  const results: string[] = [];
  const folderName = payload.queueName || 'AutoFlow_download';
  const resolutionLabel = payload.resolution || 'Original (720p)';
  const hasVideos = payload.assets.some(a => a.mediaType === 'video');
  const needsUpscale = hasVideos && !resolutionLabel.toLowerCase().includes('720p');

  /**
   * Build a clean filename from asset metadata.
   * Format: P001_G1_short_prompt_snippet.ext
   */
  function buildFilename(asset: typeof payload.assets[0]): string {
    let ext = asset.mediaType === 'image' ? 'jpg' : 'mp4';
    const url = asset.videoSrc || asset.thumbnailUrl || '';
    const urlExt = url.match(/\.([a-z0-9]{2,5})(?:[?#]|$)/i);
    if (urlExt) {
      const detected = urlExt[1].toLowerCase();
      if (['jpg', 'jpeg', 'png', 'webp', 'gif', 'mp4', 'webm'].includes(detected)) {
        ext = detected === 'jpeg' ? 'jpg' : detected;
      }
    }

    const pNum = String(asset.promptNumber ?? (asset.index + 1)).padStart(3, '0');
    const gNum = asset.generationNum ?? 1;
    const snippet = slugify(asset.promptLabel || '', 30);
    const base = snippet
      ? `P${pNum}_G${gNum}_${snippet}`
      : `P${pNum}_G${gNum}`;
    return `AutoFlow/${folderName}/${base}.${ext}`;
  }

  if (needsUpscale) {
    // ══════════════════════════════════════════════════════════
    // 3-PHASE BATCH DOWNLOAD for 1080p / 4K
    // Phase 1: Trigger upscaling for ALL videos
    // Phase 2: Wait for ALL upscaling to complete
    // Phase 3: Download upscaled videos one by one
    // ══════════════════════════════════════════════════════════

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
      await sleep(2000);
    }

    console.log('[AutoFlow] Phase 2: Waiting for all upscaling to finish...');
    await sleep(3000);
    const upscaleDone = await waitForUpscalingDone(15 * 60 * 1000);
    if (!upscaleDone) {
      console.warn('[AutoFlow] Some upscaling may not have completed (timed out)');
    }
    await sleep(2000);
  }

  // ══════════════════════════════════════════════════════════
  // DOWNLOAD ALL ASSETS via Flow context menu with rename
  // Always use menu-based download — direct URL download is
  // unreliable because videoSrc is often empty for tiles.
  // ══════════════════════════════════════════════════════════
  console.log(`[AutoFlow] Downloading ${payload.assets.length} asset(s) via context menu with rename...`);
  for (const asset of payload.assets) {
    try {
      const filename = buildFilename(asset);

      // Queue the rename FIRST — so onDeterminingFilename picks it up
      await chrome.runtime.sendMessage({
        type: 'SET_DOWNLOAD_RENAME',
        payload: { filename },
      });

      // Trigger download via Flow's context menu
      const ok = await downloadAssetByMenu(asset.locator, resolutionLabel);
      if (ok) {
        results.push(filename);
        console.log(`[AutoFlow] Download queued: ${filename}`);
      } else {
        console.warn(`[AutoFlow] Download failed for: ${asset.promptLabel || 'asset'}`);
      }
    } catch (e: any) {
      console.error('[AutoFlow] Download error:', e);
    }
    await sleep(1500);
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
