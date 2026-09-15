/* ============================================================
   AutoFlow أ¢â‚¬â€œ Content Script Entry Point
   Runs on labs.google/flow pages.
   Routes messages to the automation engine and scanner.
   ============================================================ */

import { ImageMeta, Message, QueueObject } from '../types';
import { AutomationEngine, isRunLocked } from './automation';
import { scanProjectForVideos, previewAsset, retrySingleTile, downloadAssetByMenu, waitForUpscalingDone, waitForExtendedVideoDownloadDone } from './scanner';
import { sleep, findModelSelectorTrigger, findMenuItem, simulateClick } from './selectors';
import { DOM_SETTLE_MS } from '../shared/constants';
import { getRunningQueue, clearRunningQueue } from '../shared/storage';
import { initApiHelper, isApiAvailable, isInterceptorAlive, armPreviewCapture, takeCapturedMediaUrl } from './apiHelper';
import { matchesFlowText } from './flowStrings';
import { registerStudioImage, releaseStudioImages } from './studioImages';
import { pickReferenceStill } from './studioFrames';

// أ¢â€‌â‚¬أ¢â€‌â‚¬ Singleton engine أ¢â€‌â‚¬أ¢â€‌â‚¬
let engine: AutomationEngine | null = null;

// أ¢â€‌â‚¬أ¢â€‌â‚¬ Recovery cancellation flag أ¢â€‌â‚¬أ¢â€‌â‚¬

// أ¢â€‌â‚¬أ¢â€‌â‚¬ Anti-throttle: periodic self-ping via service worker roundtrip أ¢â€‌â‚¬أ¢â€‌â‚¬
// When Chrome throttles background tabs, setTimeout delays balloon.
// A message roundtrip to the service worker wakes up the main thread.
let antiThrottleInterval: ReturnType<typeof setInterval> | null = null;

function startAntiThrottle() {
  if (antiThrottleInterval) return;
  antiThrottleInterval = setInterval(() => {
    // Round-trip to SW أ¢â‚¬â€‌ the act of receiving the response wakes the thread
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

function sendPhaseUpdate(phase: string, message: string) {
  try {
    chrome.runtime.sendMessage({
      type: 'QUEUE_PHASE_UPDATE',
      payload: { phase, message }
    }).catch(() => {});
  } catch { /* ignore */ }
}

function sendPromptStatusUpdate(queueId: string, idx: number, status: string, error?: string, mediaId?: string) {
  try {
    chrome.runtime.sendMessage({
      type: 'PROMPT_STATUS_UPDATE',
      payload: { queueId, promptIndex: idx, status, error, mediaId }
    }).catch(() => {});
  } catch { /* ignore */ }
}

// أ¢â€‌â‚¬أ¢â€‌â‚¬ Handle (re-)injection: always register a fresh listener أ¢â€‌â‚¬أ¢â€‌â‚¬
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

  // ── Remember the current Flow project ──
  // Studio reopens this exact URL when it needs a Flow tab and none is open.
  // Storing the project (not the Flow home) matters: generations land in
  // whichever project is loaded, so a blank tab would create them in the
  // wrong place.
  try {
    if (/\/project\//.test(location.href)) {
      chrome.storage.local.set({ af_last_flow_project: location.href }).catch(() => {});
    }
  } catch { /* storage unavailable — non-critical */ }

  // NOTE: we used to force ?hl=en here with a location.replace, reloading
  // every Flow page on first load. The selectors are multilingual now
  // (selectors.ts matches all supported languages), so the redirect was
  // pure cost: an extra reload per navigation and a query param Google
  // often ignored anyway.

  // أ¢â€‌â‚¬أ¢â€‌â‚¬ Deactivate "Agent" mode if it's enabled أ¢â€‌â‚¬أ¢â€‌â‚¬
  // When Agent is active (aria-pressed="true"), the prompt bar changes and
  // video settings (model, ratio, etc.) become non-functional.
  // We click it once to toggle it OFF أ¢â‚¬â€‌ not hide it.
  const deactivateAgent = () => {
    const agentBtn = document.querySelector('button[aria-pressed="true"]');
    if (agentBtn) {
      const text = agentBtn.querySelector('.content')?.textContent?.trim();
      if (text === 'Agent') {
        (agentBtn as HTMLElement).click();
      }
    }
  };

  const initDomHooks = () => {
    deactivateAgent();
    const observer = new MutationObserver(() => deactivateAgent());
    if (document.body) {
      observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-pressed'] });
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initDomHooks);
  } else {
    initDomHooks();
  }

  // أ¢â€‌â‚¬أ¢â€‌â‚¬ Initialize API helper (interceptor + status cache) أ¢â€‌â‚¬أ¢â€‌â‚¬
  // Initialize immediately without setTimeout to catch the earliest fetch calls at document_start
  initApiHelper().then(() => {
    console.log('[AutoFlow] API helper initialized');
  }).catch(() => { /* non-critical */ });

  // أ¢â€‌â‚¬أ¢â€‌â‚¬ Inject floating "Open Studio" button on the Flow page أ¢â€‌â‚¬أ¢â€‌â‚¬
  const injectStudioButton = () => {
    if (document.getElementById('af-open-studio-btn')) return; // already injected

    const btn = document.createElement('button');
    btn.id = 'af-open-studio-btn';
    btn.textContent = '\u26A1 Open Studio';
    btn.title = 'Open AutoFlow Studio - Visual Workflow Builder';

    Object.assign(btn.style, {
      position: 'fixed',
      top: '12px',
      right: '200px',
      zIndex: '99999',
      padding: '8px 20px',
      background: 'linear-gradient(135deg, #f97316 0%, #ef4444 100%)',
      color: '#fff',
      border: 'none',
      borderRadius: '24px',
      fontSize: '13px',
      fontWeight: '700',
      fontFamily: 'Inter, -apple-system, sans-serif',
      cursor: 'pointer',
      boxShadow: '0 2px 12px rgba(249, 115, 22, 0.4), 0 0 0 0 rgba(249, 115, 22, 0)',
      transition: 'all 0.25s ease',
      letterSpacing: '0.3px',
      display: 'flex',
      alignItems: 'center',
      gap: '4px',
    });

    // Hover effect
    btn.addEventListener('mouseenter', () => {
      btn.style.transform = 'scale(1.05)';
      btn.style.boxShadow = '0 4px 20px rgba(249, 115, 22, 0.6), 0 0 0 3px rgba(249, 115, 22, 0.2)';
    });
    btn.addEventListener('mouseleave', () => {
      btn.style.transform = 'scale(1)';
      btn.style.boxShadow = '0 2px 12px rgba(249, 115, 22, 0.4), 0 0 0 0 rgba(249, 115, 22, 0)';
    });

    btn.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'OPEN_STUDIO' });
    });

    document.body.appendChild(btn);
    console.log('[AutoFlow] Studio button injected');
  };

  // Inject once body is ready
  if (document.body) {
    injectStudioButton();
  } else {
    const obs = new MutationObserver(() => {
      if (document.body) {
        obs.disconnect();
        injectStudioButton();
      }
    });
    obs.observe(document.documentElement, { childList: true });
  }
} else {
  console.log('[AutoFlow] Content script re-injected, listener refreshed.');
}

// أ¢â€‌â‚¬أ¢â€‌â‚¬ Post-reload: detect interrupted or recovery queue أ¢â€‌â‚¬أ¢â€‌â‚¬
(async () => {
  try {
    const saved = await getRunningQueue();
    if (!saved) return;

    const { queue, currentIndex, recoveryMode, baselineTileCount } = saved;

    if (recoveryMode) {
      /* Legacy. A run used to end by reloading the page and coming back here
         to "clear fake cancelled tiles" — Flow's own words for a state it no
         longer has, and Google has since fixed the behaviour behind it. What
         this branch did was rescan the grid and then call startQueue() to
         regenerate whatever it could not find, i.e. re-prompt: the one thing
         FLOW mode must not do, and FLOW was the only mode that reached it.
         
         Nothing writes recoveryMode any more. Reaching it means a queue saved
         by an older version is still in storage, so the save is cleared
         rather than acted on — regenerating prompts on a page the user just
         opened, for a run they finished days ago, would be worse than doing
         nothing. */
      console.log('[AutoFlow] Discarding a saved recovery run from an older version.');
      await clearRunningQueue();
      try {
        chrome.storage.local.remove(['autoflow_uploaded_assets', 'autoflow_hard_failed_indices']);
      } catch { /* nothing to clean up */ }
      return;
    }

    // أ¢â€‌â‚¬أ¢â€‌â‚¬ NORMAL INTERRUPT: Auto-resume if recent, ask user if old أ¢â€‌â‚¬أ¢â€‌â‚¬
    const remaining = queue.prompts.length - currentIndex;
    if (remaining <= 0) {
      await clearRunningQueue();
      return;
    }

    const ageMs = Date.now() - saved.savedAt;
    const AUTO_RESUME_THRESHOLD_MS = 2 * 60 * 1000; // 2 minutes

    if (ageMs < AUTO_RESUME_THRESHOLD_MS) {
      // Recent save أ¢â‚¬â€‌ Chrome likely auto-refreshed the page. Resume immediately.
      console.log(`[AutoFlow] Page refreshed while queue "${queue.name}" was running (saved ${Math.round(ageMs / 1000)}s ago). Auto-resuming from prompt #${currentIndex + 1}...`);

      // Wait for Flow to fully load
      await sleep(4000);

      // Notify sidepanel that we're resuming
      try {
        chrome.runtime.sendMessage({
          type: 'LOG',
          payload: {
            timestamp: Date.now(),
            level: 'info',
            message: `Page refreshed أ¢â‚¬â€‌ auto-resuming queue "${queue.name}" from prompt #${currentIndex + 1} (${remaining} remaining)`
          }
        }).catch(() => {});
      } catch { /* ignore */ }

      return resumeInterruptedQueue();
    }

    // Old save أ¢â‚¬â€‌ ask user whether to resume or discard
    console.log(`[AutoFlow] Detected interrupted queue "${queue.name}" أ¢â‚¬â€‌ ${remaining} prompts remaining (from #${currentIndex + 1}), saved ${Math.round(ageMs / 60000)} minutes ago`);

    await sleep(2000);
    try {
      chrome.runtime.sendMessage({
        type: 'QUEUE_RESUME_AVAILABLE',
        payload: {
          queueName: queue.name,
          remaining,
          currentIndex,
          total: queue.prompts.length,
        }
      }).catch(() => {});
    } catch { /* sidepanel may not be open yet */ }
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
      if (engine) {
        engine.stop();
      } else {
        // Engine is null (page was reloaded) أ¢â‚¬â€‌ force-clear the UI
        chrome.runtime.sendMessage({
          type: 'QUEUE_STATUS_UPDATE',
          payload: { status: 'stopped' }
        }).catch(() => {});
      }
      clearRunningQueue().catch(() => {});
      stopAntiThrottle();
      return { success: true };

    case 'SKIP_CURRENT':
      engine?.skipCurrent();
      return { success: true };

    case 'RETRY_FAILED':
      engine?.retryFailed();
      return { success: true };

    case 'REPROMPT_RESPONSE':
      engine?.handleRepromptResponse(msg.payload.text, msg.payload.skip);
      return { success: true };

    case 'BATCH_REPROMPT_RESPONSE':
      engine?.handleBatchRepromptResponse(msg.payload.results);
      return { success: true };

    case 'RESUME_QUEUE_CONFIRMED':
      return resumeInterruptedQueue();

    case 'DISCARD_INTERRUPTED_QUEUE':
      await clearRunningQueue();
      return { success: true };

    case 'CHECK_API_AVAILABILITY':
      /* Either the pipe is open or data has arrived through it. The badge
         asks this on every monitor render, so answering with cache
         freshness alone reset it to "API Passive" between generations. */
      return { isAvailable: isApiAvailable() || isInterceptorAlive() };

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

    /**
     * The URL the tile is holding right now.
     *
     * A tile carries its own video once Flow has rendered it:
     *
     *   <video preload="auto" src="https://flow.google.com/asb/AB-nOU…=mm,22,15">
     *
     * and that URL plays — it redirects to a signed googlevideo one. But it
     * only exists after the tile renders, and a scan reads rows the moment
     * they scroll past, so the row it recorded often had no video yet.
     *
     * Re-reading it now costs a lookup. The alternative was driving Flow's
     * download menu to make it issue a URL, which downloads a video in order
     * to show a preview — the right mechanism for getting a file, and the
     * wrong one for looking at something.
     */
    case 'GET_TILE_VIDEO_SRC': {
      const locator = msg.payload?.locator || '';
      let present = false;
      try { present = !!document.querySelector(locator); } catch { present = false; }
      if (!present) return { error: 'That tile is no longer on the page — rescan the project' };

      const url = await liveVideoSrc(locator);
      return url ? { url } : { error: 'Flow did not attach a video to that tile' };
    }

    /* Drive Flow's own download menu so it issues a signed URL. The
       service worker takes that URL off the download and cancels it, so
       nothing is saved — see CAPTURE_ASSET_VIDEO_URL. */
    case 'DOWNLOAD_ASSET_FOR_PREVIEW': {
      /* Get a playable URL without writing a file.
         Flow's download menu fetches the signed URL, wraps it in a blob and
         saves that with an <a download>. The interceptor sees the fetch — the
         only place the real URL appears — and swallows the anchor click, so
         the panel gets something to play and nothing lands on disk. */
      armPreviewCapture();
      const ok = await downloadAssetByMenu(msg.payload.locator, msg.payload.resolution);
      if (!ok) return { error: 'Could not reach the download menu for this asset' };

      /* The fetch is already in flight by the time the menu click returns,
         but not necessarily observed yet. */
      for (let waited = 0; waited < 15000; waited += 200) {
        const url = takeCapturedMediaUrl();
        if (url) return { url };
        await new Promise((r) => setTimeout(r, 200));
      }
      return { error: 'Flow did not fetch a video for this asset' };
    }

    case 'PREVIEW_ASSET':
      return previewAssetHandler(msg.payload);

    case 'DOWNLOAD_SELECTED':
      return downloadSelected(msg.payload);

    case 'REFRESH_MODELS':
      return refreshModels();

    case 'UPLOAD_IMAGES_TO_FLOW':
    case 'GET_IMAGE_BLOBS':
      // These are forwarded via background to sidepanel أ¢â‚¬â€‌ content script never handles directly
      // Return signal so background knows to ask sidepanel
      return { needsSidepanelRelay: true };

    case 'IMAGE_BLOBS_RESULT':
      // This would be received if background relays blob data here
      return msg.payload;

    case 'IMAGE_API_COMPLETED': {
      // Background detected a generation API call completed via webRequest.
      // This fires for BOTH video (batchAsyncGenerateVideo) and image (batchGenerateImages) endpoints.
      // Only used by image mode verification أ¢â‚¬â€‌ video mode ignores the count.
      console.log('[AutoFlow] Generation API signal (webRequest)', msg.payload?.statusCode);
      if (engine) {
        (engine as any).onImageApiCompleted?.(msg.payload);
      }
      return { success: true };
    }

    case 'PING':
      return { type: 'PONG', runLocked: isRunLocked() };

    // أ¢â€‌â‚¬أ¢â€‌â‚¬ Studio: Execute a single node on Google Flow أ¢â€‌â‚¬أ¢â€‌â‚¬
    case 'STUDIO_EXECUTE_NODE' as any:
      return handleStudioExecuteNode(msg.payload);

    case 'STUDIO_STOP' as any:
      if (engine) engine.stop();
      return { success: true };

    case 'STUDIO_PAUSE' as any:
      if (engine) engine.pause();
      return { success: true };

    case 'STUDIO_RESUME' as any:
      if (engine) engine.resume();
      return { success: true };

    default:
      return { error: `Unknown message: ${msg.type}` };
  }
}

async function startQueue(queue: QueueObject, baselineTileCount?: number): Promise<any> {
  // أ¢â€‌â‚¬أ¢â€‌â‚¬ Guard: prevent multiple concurrent engines أ¢â€‌â‚¬أ¢â€‌â‚¬
  // If we already have a running engine, stop it first
  if (engine) {
    console.warn('[AutoFlow] Stopping previous engine before starting new queue');
    engine.stop();
    engine = null;
    await sleep(500); // Let DOM settle after stopping
  }

  // De-duplicate rapid START_QUEUE messages (e.g. double-clicks or re-injections).
  // Studio is exempt: its runs are programmatic and sequential, never double
  // clicks. Swallowing one returned {success:true}, so Studio believed its node
  // had started and polled the PREVIOUS node's tile — reporting progress for a
  // generation it never launched.
  const now = Date.now();
  const isStudioQueue = queue?.name === 'STUDIO';
  if (!isStudioQueue && (window as any).__af_lastStartTime && now - (window as any).__af_lastStartTime < 3000) {
    console.warn('[AutoFlow] Ignoring duplicate START_QUEUE (received within 3s of last start)');
    return { success: true, deduplicated: true };
  }
  (window as any).__af_lastStartTime = now;

  engine = new AutomationEngine();
  startAntiThrottle();  // Fight tab throttling during automation
  // Don't await أ¢â‚¬â€‌ run in background so the message can respond
  (async () => {
    /* The engine's uploadedAssets used to be restored from storage here, so
       it could survive the page reload a run ended with. Nothing writes that
       key any more — the reload is gone, and within one run the engine holds
       the set in memory, which is all it was ever for. */

    try {
      await engine.start(queue, baselineTileCount);
    } catch (err) {
      console.error('[AutoFlow] Queue error:', err);
    } finally {
      stopAntiThrottle();  // Queue finished أ¢â‚¬â€‌ stop self-ping
    }
  })();
  return { success: true };
}

async function resumeInterruptedQueue(): Promise<any> {
  try {
    const saved = await getRunningQueue();
    if (!saved) return { success: false, error: 'No interrupted queue found' };

    const { queue, currentIndex } = saved;
    const remaining = queue.prompts.length - currentIndex;
    if (remaining <= 0) {
      await clearRunningQueue();
      return { success: false, error: 'Queue already completed' };
    }

    // Set the resume point
    queue.currentPromptIndex = currentIndex;

    // Mark already-processed prompts so the engine doesn't re-send them,
    // and broadcast the status change so the background script and sidepanel stay in sync.
    for (let i = 0; i < currentIndex; i++) {
      const p = queue.prompts[i];
      if (p.status !== 'failed' && p.status !== 'done' && p.status !== 'submitted' && p.status !== 'queued' && p.status !== 'not-added') {
        p.status = 'done';
        try {
          chrome.runtime.sendMessage({
            type: 'PROMPT_STATUS_UPDATE',
            payload: {
              queueId: queue.id,
              promptIndex: i,
              status: 'done'
            }
          }).catch(() => {});
        } catch { /* ignore */ }
      }
    }

    console.log(`[AutoFlow] Resuming queue "${queue.name}" from prompt #${currentIndex + 1}...`);
    return startQueue(queue);
  } catch (e: any) {
    return { success: false, error: e.message };
  }
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
 * Keeps the first ~40 chars, lowercased, trimmed, spaces أ¢â€ â€™ underscores.
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

  // Suppress downloads أ¢â‚¬â€‌ Flow's context menu triggers both upscale AND download,
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

/**
 * The video URL a tile is holding right now, waiting briefly for it.
 *
 * Flow renders a row's <video> when the row is on screen, and a scan reads
 * rows as they scroll past — so the URL recorded at scan time is often empty
 * for anything below the first screen. Reading it again when it is actually
 * needed costs a lookup and gets the real thing.
 */
async function liveVideoSrc(locator: string, timeoutMs = 4000): Promise<string> {
  let tile: Element | null = null;
  try { tile = document.querySelector(locator); } catch { return ''; }
  if (!tile) return '';

  const read = () => {
    const v = tile!.querySelector('video') as HTMLVideoElement | null;
    return v ? (v.currentSrc || v.getAttribute('src') || '') : '';
  };

  const already = read();
  if (already) return already;

  /* Hover it. That is what makes Flow attach the video.
   *
   * Measured on a live project, on a tile that starts as a thumbnail:
   *
   *   before                  no <video>
   *   after scrollIntoView    no <video>
   *   after hover             <video> present, with its real URL
   *
   * Scrolling alone does nothing, which is why waiting for the element to
   * appear simply timed out. Flow keeps the grid as still images and swaps in
   * the video only for the tile under the pointer.
   *
   * The events are dispatched on the tile and on its inner container, because
   * the listener sits on whichever of them Angular bound it to and that is not
   * ours to know. */
  try { tile.scrollIntoView({ block: 'center' }); } catch { /* not fatal */ }

  const targets = [tile, tile.querySelector('.container'), tile.firstElementChild]
    .filter(Boolean) as Element[];
  for (const el of targets) {
    for (const type of ['pointerover', 'pointerenter', 'mouseover', 'mouseenter', 'mousemove']) {
      const Ev = type.startsWith('pointer') ? PointerEvent : MouseEvent;
      el.dispatchEvent(new Ev(type, { bubbles: true, cancelable: true, view: window }));
    }
  }

  for (let waited = 0; waited < timeoutMs; waited += 150) {
    const src = read();
    if (src) return src;
    await new Promise((r) => setTimeout(r, 150));
  }
  return '';
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

  /* Say which route this is taking before taking it.
   *
   * There are three, and from the outside they all look like "download".
   * The fast one fetches each tile's own URL. Anything other than 720p goes
   * through Flow's menu to make it upscale first — which spends credits and
   * can sit for fifteen minutes. And a tile with no URL of its own falls back
   * to the menu too, which needs its locator to still match.
   *
   * A run that reported "Downloaded 0 file(s)" could have been any of those,
   * so the reason is now on the record. */
  const missingUrl = payload.assets.filter(a => a.mediaType === 'video' && !a.videoSrc).length;
  console.log(
    `[AutoFlow] Download: ${payload.assets.length} asset(s) at "${resolutionLabel}" · ` +
    `${needsUpscale ? 'UPSCALE FIRST (menu, costs credits)' : 'direct URL where possible'} · ` +
    `${missingUrl} video(s) have NO url of their own and must use the menu`,
  );

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
    // أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯
    // 3-PHASE BATCH DOWNLOAD for 1080p / 4K
    // Phase 1: Trigger upscaling for ALL videos
    // Phase 2: Wait for ALL upscaling to complete
    // Phase 3: Download upscaled videos one by one
    // أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯

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

  // أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯
  // DOWNLOAD ALL ASSETS
  // The tile's own video URL first, and the context menu when there is no
  // such URL or the user wants an upscale. Direct download used to be
  // unreliable "because videoSrc is often empty for tiles" — it was, until
  // the URL could be derived from the thumbnail token.
  // أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯
  console.log(`[AutoFlow] Downloading ${payload.assets.length} asset(s) via context menu with rename...`);
  for (const asset of payload.assets) {
    try {
      const filename = buildFilename(asset);
      const assetResEarly = asset.mediaType === 'image' ? '1K' : resolutionLabel;

      /* Fast path: fetch the file straight from the tile's own URL.
         Flow serves it from the same /asb/ token as the thumbnail, and that
         URL is itag 22 — the 720p original, which is exactly what "Original
         (720p)" asks for. Taking it directly skips a hover, a menu, a
         submenu and their settling delays for every asset, and never touches
         the page. An upscale still has to go through the menu: 1080p and 4K
         do not exist until Flow makes them. */
      const wantsOriginal = /original|720/i.test(String(assetResEarly));

      /* The scan may have read this row before Flow rendered its video. Ask
         the page for the URL it is holding now, rather than going straight to
         the menu — the menu is slower, needs the tile's locator to still
         match, and on anything but the original resolution makes Flow upscale
         first, which costs credits. */
      /* Missing, or expired. A signed flow-content.google URL lasts about an
         hour; a library scanned earlier and downloaded later is working from
         one that has died. The /asb/ URLs carry no expiry and are left be. */
      const cached = String((asset as any).videoSrc || '');
      const expiredMatch = /[?&]Expires=(\d+)/.exec(cached);
      const staleUrl = !!expiredMatch && Number(expiredMatch[1]) * 1000 <= Date.now();
      if (staleUrl) {
        console.log(`[AutoFlow] The saved URL for "${asset.promptLabel || 'asset'}" has expired; re-reading the tile`);
        (asset as any).videoSrc = '';
      }

      if (asset.mediaType === 'video' && !(asset as any).videoSrc && wantsOriginal) {
        const live = await liveVideoSrc(asset.locator);
        if (live) {
          (asset as any).videoSrc = live;
          console.log(`[AutoFlow] Read the video URL off the page for "${asset.promptLabel || 'asset'}"`);
        }
      }

      if (asset.mediaType === 'video' && (asset as any).videoSrc && wantsOriginal) {
        /* No SET_DOWNLOAD_RENAME here: DOWNLOAD_FILE queues its own rename,
           and queuing twice leaves a spare that lands on the next file. */
        const direct: any = await chrome.runtime.sendMessage({
          type: 'DOWNLOAD_FILE',
          payload: { url: (asset as any).videoSrc, filename },
        });
        if (!direct?.error) {
          results.push(filename);
          console.log(`[AutoFlow] Downloaded direct: ${filename}`);
          await sleep(300);
          continue;
        }
        console.warn(`[AutoFlow] Direct download failed (${direct.error}); using the menu`);
      } else if (asset.mediaType === 'video') {
        console.warn(
          `[AutoFlow] Not using the direct URL for "${asset.promptLabel || 'asset'}": ` +
          `${(asset as any).videoSrc ? '' : 'no url on the tile'}` +
          `${wantsOriginal ? '' : ` resolution is "${assetResEarly}", not the original`}`,
        );
      }

      // Queue the rename FIRST أ¢â‚¬â€‌ so onDeterminingFilename picks it up
      await chrome.runtime.sendMessage({
        type: 'SET_DOWNLOAD_RENAME',
        payload: { filename },
      });

      // Trigger download via Flow's context menu
      // Images: always download at 1K (original) أ¢â‚¬â€‌ upscaling costs Google Flow credits
      // Videos: use the user's preferred resolution setting
      const assetRes = asset.mediaType === 'image' ? '1K' : resolutionLabel;
      const ok = await downloadAssetByMenu(asset.locator, assetRes);
      if (!ok) {
        let hits = -1;
        try { hits = document.querySelectorAll(asset.locator).length; } catch { hits = -2; }
        console.warn(
          `[AutoFlow] Menu download failed for "${asset.promptLabel || 'asset'}" — ` +
          `its locator matched ${hits} tile(s): ${asset.locator}`,
        );
      }
      if (ok) {
        results.push(filename);
        console.log(`[AutoFlow] Download queued: ${filename}`);
        
        // Extended videos take ~20s to prepare on the server before downloading.
        // We MUST wait for the "Downloading your extended video." toast to disappear
        // before we click download on the next one, or else Flow might ignore it or crash.
        await waitForExtendedVideoDownloadDone();
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


// -- Studio: Single-node execution via the EXISTING proven engine --

async function handleStudioExecuteNode(payload: any): Promise<any> {
  const { nodeId, config } = payload || {};
  if (!nodeId || !config) {
    return { type: 'STUDIO_NODE_ERROR', payload: { nodeId, error: 'Missing nodeId or config' } };
  }

  console.log(`[AutoFlow Studio] Executing node ${nodeId}`);

  // ── Resolve reference images (Image nodes + upstream Generate tiles) ──
  // Registers them in the studio image registry so the automation engine's
  // requestImageBlobs() can resolve them without touching the sidepanel.
  let refImages: ImageMeta[];
  try {
    refImages = await resolveStudioReferenceImages(config);
  } catch (e: any) {
    sendStudioError(nodeId, e.message || 'Failed to resolve reference images');
    return { success: false };
  }

  const mediaType = config.mediaType || 'image';
  const isImage = mediaType === 'image';

  const queue: any = {
    id: `studio-${nodeId}-${Date.now()}`,
    name: 'STUDIO',
    prompts: [{
      id: `prompt-${nodeId}`,
      index: 0,
      text: config.prompt || '',
      images: refImages,
      status: 'pending',
      attempts: 0,
      outputFiles: [],
    }],
    settings: {
      mediaType,
      creationType: 'ingredients',
      model: isImage ? 'Omni 1.1 Flash' : (config.model || 'Omni 1.1 Flash'),
      orientation: (config.aspectRatio === '9:16' || config.aspectRatio === '3:4') ? 'portrait' : 'landscape',
      generations: 1,
      // Honour the node's duration — this was pinned to '8s', so every
      // Studio video ran 8s no matter what the node's dropdown said.
      duration: (config.duration || '6s'),
      voiceIngredient: 'none',
      stopOnError: false,
      automationMode: 'lite',
      waitMinSec: 1,
      waitMaxSec: 2,
      typingMode: false,
      typingSpeedMultiplier: 1.0,
      autoDownloadVideos: false,
      /* Matches DEFAULT_SETTINGS: 4K is disabled on plans without it. */
      videoResolution: 'Original (720p)',
      autoDownloadImages: false,
      imageResolution: '4K',
      imageModel: isImage ? (config.model || 'Nano Banana Pro') : 'Nano Banana Pro',
      imageRatio: isImage ? (config.aspectRatio || '9:16') : '9:16',
      language: 'English',
      showNotifications: false,
      notificationSound: false,
      autoDownload: false,
      waitBetweenPromptsSec: 0,
      inputMethod: 'paste',
      typingCharsPerSecond: 25,
      variableTypingDelay: true,
    },
    runTarget: 'currentProject',
    status: 'pending',
    currentPromptIndex: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  // Start the queue (non-blocking)
  const result = await startQueue(queue);
  if (!result.success) {
    releaseStudioImages(refImages.map(i => i.id));
    sendStudioError(nodeId, result.error || 'Failed to start queue');
    return { success: false };
  }

  // Return immediately -- do NOT block the message port.
  // Fire-and-forget poller sends updates via chrome.runtime.sendMessage.
  // Reference images stay registered until the node settles (retries re-attach them).
  pollStudioCompletion(nodeId, queue).finally(() => {
    releaseStudioImages(refImages.map(i => i.id));
  });
  return { success: true };
}

/**
 * Resolve a Studio node's reference images into ImageMeta entries backed by
 * the in-memory studio image registry.
 * - config.referenceImageData: base64 data URLs from Image nodes
 * - config.referenceImageIds:  tile IDs of upstream Generate results — the
 *   media URL is read from the tile on the page and fetched to base64.
 * Throws with a user-readable message if any reference cannot be resolved —
 * silently dropping a reference produces wrong generations (broken character
 * consistency) with no visible error, which is worse than failing the node.
 */
async function resolveStudioReferenceImages(config: any): Promise<ImageMeta[]> {
  const metas: ImageMeta[] = [];

  const register = (mime: string, data: string): void => {
    const id = crypto.randomUUID();
    const ext = mime.includes('png') ? 'png' : 'jpg';
    const filename = `studio_${id.slice(0, 8)}.${ext}`;
    registerStudioImage({ id, filename, mime, data });
    metas.push({
      id,
      filename,
      mime,
      size: Math.floor(data.length * 0.75), // approx decoded size
      sha256: '',
      lastModified: Date.now(),
    });
  };

  const parseDataUrl = (dataUrl: string): { mime: string; data: string } | null => {
    const m = /^data:([^;,]+);base64,(.+)$/.exec(dataUrl || '');
    return m ? { mime: m[1], data: m[2] } : null;
  };

  // Base64 payloads from Image nodes
  for (const dataUrl of config.referenceImageData || []) {
    const parsed = parseDataUrl(dataUrl);
    if (!parsed) {
      releaseStudioImages(metas.map(i => i.id));
      throw new Error('Reference image is not a valid base64 data URL');
    }
    register(parsed.mime, parsed.data);
  }

  // Tile IDs from upstream Generate nodes → resolve via the tile on the page
  for (const tileId of config.referenceImageIds || []) {
    const tile = document.querySelector(`[data-tile-id="${tileId}"]`);
    const url = tile ? extractTileMediaUrl(tile) : '';
    if (!url) {
      releaseStudioImages(metas.map(i => i.id));
      throw new Error(`Reference tile ${tileId} not found on the Flow page — cannot pass its image to this node`);
    }
    const inline = parseDataUrl(url);
    if (inline) {
      register(inline.mime, inline.data);
      continue;
    }
    try {
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const blob = await resp.blob();
      register(blob.type || 'image/png', await blobToRawBase64(blob));
    } catch (e: any) {
      releaseStudioImages(metas.map(i => i.id));
      throw new Error(`Could not fetch reference image for tile ${tileId}: ${e.message}`);
    }
  }

  return metas;
}

/** Blob → raw base64 (no data: prefix) */
function blobToRawBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(((reader.result as string) || '').split(',')[1] || '');
    reader.onerror = () => reject(new Error('Failed to read image blob'));
    reader.readAsDataURL(blob);
  });
}

async function pollStudioCompletion(nodeId: string, queue: any): Promise<void> {
  const { findAssetCards, isVisible } = await import('./selectors');

  sendStudioProgress(nodeId, 20);

  // ── Phase 1: Wait for engine to finish processing (fill prompt → click generate) ──
  // Engine in lite mode sets status to 'submitted' once it clicked Generate.
  for (let wait = 0; wait < 120; wait++) {
    await sleep(500);
    const status = queue.prompts[0].status;

    if (status === 'submitted' || status === 'done') break;
    if (status === 'failed') {
      sendStudioError(nodeId, queue.prompts[0].error || 'Generation failed');
      return;
    }
  }

  const prompt = queue.prompts[0];
  if (prompt.status !== 'submitted' && prompt.status !== 'done') {
    sendStudioError(nodeId, 'Engine did not submit the prompt in time');
    return;
  }

  // Engine submitted the prompt — now we have the tile IDs
  const trackedTileIds: string[] = prompt.tileIds || [];
  console.log(`[AutoFlow Studio] Engine submitted. Tracking tiles: ${trackedTileIds.join(', ') || 'none'}`);
  sendStudioProgress(nodeId, 40);

  // If engine already marked as done (unlikely in lite, but possible)
  if (prompt.status === 'done') {
    await sendStudioResult(nodeId, trackedTileIds[0] || '');
    return;
  }

  // ── Phase 2: Track tile using Studio-specific state detection ──
  // The existing getTileState() checks error icons FIRST which gives
  // false 'failed' in sidebar/detail view. Studio detector checks
  // completion signals FIRST: has real image/video → completed.
  let consecutiveFailed = 0;
  // When the engine gave us no tile IDs, we lock onto the first card we see
  // actually GENERATING. Grabbing just "any visible card" made the poller
  // adopt an old, already-finished tile and report done instantly.
  let fallbackTileId: string | null = null;

  for (let wait = 0; wait < 1200; wait++) {
    await sleep(1000);

    // Find the tracked tile in DOM
    let trackedTile: Element | null = null;
    for (const id of trackedTileIds) {
      const el = document.querySelector(`[data-tile-id="${id}"]`);
      if (el && isVisible(el)) { trackedTile = el; break; }
    }

    // Fallback path (no engine tile IDs): follow a tile we saw generating
    if (!trackedTile && fallbackTileId) {
      const el = document.querySelector(`[data-tile-id="${fallbackTileId}"]`);
      if (el && isVisible(el)) trackedTile = el;
    }
    if (!trackedTile && trackedTileIds.length === 0) {
      const allCards = findAssetCards().filter(el => isVisible(el));
      const generatingCard = allCards.find(c => getStudioTileState(c) === 'generating');
      if (generatingCard) {
        trackedTile = generatingCard;
        fallbackTileId = generatingCard.getAttribute('data-tile-id') || null;
        console.log(`[AutoFlow Studio] Locked onto generating tile ${fallbackTileId || '(no id)'}`);
      } else if (wait > 45 && allCards.length > 0) {
        // Nothing ever showed as generating — the render may have finished
        // between submit and our first poll. Last resort: newest card.
        trackedTile = allCards[0];
      }
    }

    if (!trackedTile) {
      if (wait % 10 === 0) console.log('[AutoFlow Studio] Tile not in DOM, waiting...');
      continue;
    }

    // ── Studio-specific tile state detection ──
    // Priority: GENERATING first (a generating tile shows a real blurred
    // <img> + % badge, which a completion-first check misreads as done)
    const state = getStudioTileState(trackedTile);

    if (state === 'completed') {
      console.log('[AutoFlow Studio] Tile completed!');
      const tileId = trackedTile.getAttribute('data-tile-id') || '';
      const mediaUrl = extractTileMediaUrl(trackedTile);
      const previewSrc = extractTilePreviewSrc(trackedTile);
      await sendStudioResult(nodeId, tileId, mediaUrl, previewSrc, trackedTile);
      return;
    }

    if (state === 'generating') {
      consecutiveFailed = 0;
      // Relay Flow's own % badge when present; otherwise a slow synthetic ramp
      const flowPct = extractTileProgress(trackedTile);
      const progress = flowPct !== null
        ? Math.max(5, Math.min(99, flowPct))
        : Math.min(95, 40 + Math.floor(wait / 12));
      if (flowPct !== null || wait % 5 === 0) sendStudioProgress(nodeId, progress);
    } else if (state === 'failed') {
      consecutiveFailed++;
      if (consecutiveFailed >= 8 && wait > 20) {
        // Surface Flow's own wording ("Oops, something went wrong!",
        // a policy message, …) — "marked as failed" told the user nothing
        // about whether to retry, reword, or wait.
        sendStudioError(nodeId, `Flow: ${extractTileErrorText(trackedTile) || 'generation failed'}`);
        return;
      }
    } else {
      consecutiveFailed = 0;
    }
  }

  // Stopped watching, which is not the same as the generation having failed.
  sendStudioError(nodeId,
    'Stopped tracking after 20 minutes. The generation may still be running — ' +
    'check the Flow tab before re-running this node.');
}

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
function getStudioTileState(tile: Element): 'completed' | 'generating' | 'failed' | 'unknown' {
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
  const video = tile.querySelector('video');
  if (video && (video.src || video.querySelector('source[src]') || video.getAttribute('poster'))) {
    return 'completed';
  }

  const imgs = tile.querySelectorAll('img[src]');
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

  return 'unknown';
}

/** Flow's own failure wording from a failed tile, trimmed for display */
function extractTileErrorText(tile: Element): string {
  const raw = (tile.textContent || '').replace(/\s+/g, ' ').trim();
  if (!raw) return '';
  // Drop the leading "Failed" heading so the message isn't "failed — Failed …"
  const body = raw.replace(/^failed[\s:—-]*/i, '').trim() || raw;
  return body.length > 160 ? `${body.slice(0, 160)}…` : body;
}

/** Flow's own progress badge ("24%") from a generating tile, or null */
function extractTileProgress(tile: Element): number | null {
  const walker = document.createTreeWalker(tile, NodeFilter.SHOW_TEXT);
  let textNode: Text | null;
  while ((textNode = walker.nextNode() as Text | null)) {
    const t = textNode.textContent?.trim() || '';
    const m = /^(\d{1,3})%$/.exec(t);
    if (m) return Math.min(100, parseInt(m[1], 10));
  }
  return null;
}


async function sendStudioResult(
  nodeId: string,
  tileId: string,
  mediaUrl?: string,
  previewSrc?: string,
  tile?: Element | null
): Promise<void> {
  // Flow's tile URLs are page-scoped (blob:) or need the page's auth context,
  // so they cannot be rendered from the chrome-extension:// Studio page.
  // Convert to self-contained data URLs here, where fetch still works.
  const stills = await buildStudioStills(previewSrc || mediaUrl || '');
  let previewUrl = stills.preview;

  // Videos rarely carry a poster — grab a frame straight off the <video>
  const videoEl = tile?.querySelector('video') || null;
  if (!previewUrl && videoEl) {
    previewUrl = captureVideoFrame(videoEl);
  }

  // Ship the playable video itself when it's small enough to travel
  let previewVideoUrl = '';
  if (videoEl && mediaUrl) {
    previewVideoUrl = await buildStudioVideoData(mediaUrl);
  }

  /**
   * Capture the still a downstream node will use as its reference, NOW.
   *
   * Downstream nodes used to reference this result by tile id and look the tile
   * up in the DOM at the moment they ran, minutes later. Flow's media grid
   * lazy-renders and recycles tiles as it grows, so by the time a late node ran
   * the tile it needed was often no longer in the document — and the node failed
   * with "reference tile not found" even though the image existed. The longer
   * the workflow, the likelier that got.
   *
   * Right here the tile has just been produced and is definitely present, so
   * the bytes are always available. For a clip that means seeking to its last
   * frame; see pickReferenceStill for why the poster must not win.
   */
  const referenceUrl = pickReferenceStill({
    endFrame: videoEl ? await captureVideoEndFrame(videoEl) : '',
    posterStill: stills.reference,
  });

  try {
    chrome.runtime.sendMessage({
      type: 'STUDIO_NODE_RESULT',
      payload: {
        nodeId,
        tileId,
        imageUrl: mediaUrl || '',
        thumbnailUrl: mediaUrl || '',
        previewUrl,
        previewVideoUrl,
        referenceUrl,
      },
    }).catch(() => {});
  } catch {}
}

/** Draw the current frame of a page <video> to a downscaled JPEG data URL.
    blob: video sources are same-origin, so the canvas stays untainted. */
function captureVideoFrame(video: HTMLVideoElement): string {
  try {
    if (video.readyState < 2 || !video.videoWidth) return '';
    const scale = Math.min(1, 512 / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.82);
  } catch (e: any) {
    console.warn(`[AutoFlow Studio] Video frame capture failed: ${e?.message || e}`);
    return '';
  }
}

/**
 * Capture the LAST frame of a page <video>.
 *
 * Chained workflows hand one clip's ending to the next clip as its opening
 * frame — that handoff is the whole continuity technique. After a generation
 * the element sits at time 0, so capturing "the current frame" would pass the
 * clip's *start* downstream and the subject would reset on every clip instead
 * of progressing. Seeks to the end, captures, then puts the playhead back so
 * the tile on the page looks untouched.
 */
async function captureVideoEndFrame(video: HTMLVideoElement): Promise<string> {
  const duration = video.duration;
  if (!isFinite(duration) || duration <= 0) return captureVideoFrame(video);

  const original = video.currentTime;
  // A hair before the end: seeking exactly to duration can land past the last
  // decodable frame and draw blank.
  const target = Math.max(0, duration - 0.05);

  try {
    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        video.removeEventListener('seeked', finish);
        resolve();
      };
      // Never hang a run on a video that refuses to seek — take whatever
      // frame is showing instead.
      const timer = setTimeout(finish, 2000);
      video.addEventListener('seeked', finish);
      video.currentTime = target;
    });
    return captureVideoFrame(video);
  } catch {
    return captureVideoFrame(video);
  } finally {
    try { video.currentTime = original; } catch { /* leave it wherever it is */ }
  }
}

/** Fetch a video URL into a data URL so the Studio page can play it.
    Capped — oversized clips fall back to the poster frame only. */
const VIDEO_PREVIEW_MAX_BYTES = 15 * 1024 * 1024;

async function buildStudioVideoData(url: string): Promise<string> {
  if (!url || url.startsWith('data:')) return url.startsWith('data:video') ? url : '';
  try {
    const resp = await fetch(url);
    if (!resp.ok) return '';
    const blob = await resp.blob();
    if (!blob.type.startsWith('video/')) return '';
    if (blob.size > VIDEO_PREVIEW_MAX_BYTES) {
      console.log(`[AutoFlow Studio] Video too large for inline preview (${Math.round(blob.size / 1024 / 1024)}MB)`);
      return '';
    }
    return `data:${blob.type};base64,${await blobToRawBase64(blob)}`;
  } catch (e: any) {
    console.warn(`[AutoFlow Studio] Video preview unavailable: ${e?.message || e}`);
    return '';
  }
}

/**
 * Fetch a tile's media and re-encode it as a downscaled JPEG data URL.
 * Returns '' if the media cannot be fetched or decoded — the node then falls
 * back to showing a "preview unavailable" placeholder rather than a broken image.
 */
const PREVIEW_MAX_EDGE = 512;
/* Reference stills are fed back into a generation rather than shown in a node,
   so they keep far more detail than the canvas thumbnail. ~1536px JPEG lands
   around 200-400KB, and these live only in runner memory — stripResults()
   keeps run output out of saved workflows. */
const REFERENCE_MAX_EDGE = 1536;

/**
 * Build both stills a completed node needs, from a single fetch and decode.
 *
 * `preview` is the small thumbnail the canvas shows; `reference` is the larger
 * still a downstream node feeds back into Flow. Producing them together matters
 * because this runs after every generation — encoding twice from one bitmap is
 * cheap, downloading the image twice is not.
 */
async function buildStudioStills(url: string): Promise<{ preview: string; reference: string }> {
  const none = { preview: '', reference: '' };
  if (!url) return none;
  if (url.startsWith('data:')) return { preview: url, reference: url };

  try {
    const resp = await fetch(url);
    if (!resp.ok) return none;
    const blob = await resp.blob();
    if (blob.type.startsWith('video/')) return none; // videos use their poster instead

    const bitmap = await createImageBitmap(blob);
    const longest = Math.max(bitmap.width, bitmap.height);

    const encode = async (maxEdge: number, quality: number): Promise<string> => {
      const scale = Math.min(1, maxEdge / longest);
      const w = Math.max(1, Math.round(bitmap.width * scale));
      const h = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = new OffscreenCanvas(w, h);
      const ctx = canvas.getContext('2d');
      if (!ctx) return '';
      ctx.drawImage(bitmap, 0, 0, w, h);
      const out = await canvas.convertToBlob({ type: 'image/jpeg', quality });
      return `data:${out.type};base64,${await blobToRawBase64(out)}`;
    };

    const preview = await encode(PREVIEW_MAX_EDGE, 0.82);
    const reference = await encode(REFERENCE_MAX_EDGE, 0.9);
    bitmap.close();
    return { preview, reference };
  } catch (e: any) {
    console.warn(`[AutoFlow Studio] Preview unavailable: ${e?.message || e}`);
    return none;
  }
}

/** Preview source for a tile — prefers a poster/still over a video stream */
function extractTilePreviewSrc(tile: Element): string {
  const poster = tile.querySelector('video')?.getAttribute('poster');
  if (poster) return poster;
  return findLargestImgSrc(tile);
}

/** Extract the image or video URL from a completed tile */
function extractTileMediaUrl(tile: Element): string {
  // Try video first
  const video = tile.querySelector('video');
  if (video) {
    const source = video.querySelector('source[src]');
    if (source) return source.getAttribute('src') || '';
    if (video.src) return video.src;
    if (video.getAttribute('poster')) return video.getAttribute('poster') || '';
  }

  return findLargestImgSrc(tile);
}

/** Largest real <img> src inside a tile (skips tiny data: placeholders) */
function findLargestImgSrc(tile: Element): string {
  const imgs = tile.querySelectorAll('img[src]');
  let bestSrc = '';
  let bestArea = 0;
  for (const img of imgs) {
    const src = img.getAttribute('src') || '';
    if (src.startsWith('data:') && src.length < 200) continue;
    const rect = img.getBoundingClientRect();
    const area = rect.width * rect.height;
    if (area > bestArea) {
      bestArea = area;
      bestSrc = src;
    }
  }
  return bestSrc;
}

function sendStudioProgress(nodeId: string, progress: number): void {
  try {
    chrome.runtime.sendMessage({
      type: 'STUDIO_NODE_PROGRESS',
      payload: { nodeId, progress },
    }).catch(() => {});
  } catch {}
}

function sendStudioError(nodeId: string, error: string): void {
  try {
    chrome.runtime.sendMessage({
      type: 'STUDIO_NODE_ERROR',
      payload: { nodeId, error },
    }).catch(() => {});
  } catch {}
}
