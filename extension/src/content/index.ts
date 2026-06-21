/* ============================================================
   AutoFlow – Content Script Entry Point
   Runs on labs.google/flow pages.
   Routes messages to the automation engine and scanner.
   ============================================================ */

import { Message, QueueObject } from '../types';
import { AutomationEngine, isRunLocked } from './automation';
import { scanProjectForVideos, previewAsset, retrySingleTile, downloadAssetByMenu, waitForUpscalingDone, waitForExtendedVideoDownloadDone } from './scanner';
import { sleep, findModelSelectorTrigger, findMenuItem, simulateClick } from './selectors';
import { DOM_SETTLE_MS } from '../shared/constants';
import { getRunningQueue, clearRunningQueue } from '../shared/storage';
import { initApiHelper, isApiAvailable } from './apiHelper';

// ── Singleton engine ──
let engine: AutomationEngine | null = null;

// ── Recovery cancellation flag ──
let recoveryCancelled = false;

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

  // ── Deactivate "Agent" mode if it's enabled ──
  // When Agent is active (aria-pressed="true"), the prompt bar changes and
  // video settings (model, ratio, etc.) become non-functional.
  // We click it once to toggle it OFF — not hide it.
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

  // ── Initialize API helper (interceptor + status cache) ──
  // Initialize immediately without setTimeout to catch the earliest fetch calls at document_start
  initApiHelper().then(() => {
    console.log('[AutoFlow] API helper initialized');
  }).catch(() => { /* non-critical */ });
} else {
  console.log('[AutoFlow] Content script re-injected, listener refreshed.');
}

// ── Post-reload: detect interrupted or recovery queue ──
(async () => {
  try {
    const saved = await getRunningQueue();
    if (!saved) return;

    const { queue, currentIndex, recoveryMode, baselineTileCount } = saved;

    if (recoveryMode) {
      // ── RECOVERY MODE: Page was reloaded to clear fake "cancelled" tiles ──
      // The ONLY source of truth is: does a completed video exist on the page for each prompt?
      // We DON'T trust the prompt.status from before the reload — tile IDs are stale after refresh.
      recoveryCancelled = false;
      console.log(`[AutoFlow] Recovery mode: scanning page for "${queue.name}"...`);
      sendPhaseUpdate('scanning', 'Recovery: Waiting for page to load...');

      // Load recovery metadata from chrome.storage.local
      let hardFailedIndices: number[] = [];
      try {
        const storageData = await new Promise<any>((resolve) => {
          chrome.storage.local.get(['autoflow_hard_failed_indices'], resolve);
        });
        hardFailedIndices = storageData?.autoflow_hard_failed_indices || [];
        console.log(`[AutoFlow] Loaded hard-failed indices:`, hardFailedIndices);
      } catch (err: any) {
        console.warn('[AutoFlow] Failed to load hard-failed indices:', err);
      }

      // Wait for Flow to fully load (reduced from 6s — fake cancels resolve fast)
      await sleep(4000);
      if (recoveryCancelled) { console.log('[AutoFlow] Recovery cancelled by user.'); await clearRunningQueue(); return; }

      // Import tile scanning tools — including scroll collector for virtualized lists
      const { findAssetCards, getTileState, isVisible, findPromptInput, findOutputScroller, scrollAndCollectAllTileStates } = await import('./selectors');

      // Check if we're on a project page (has prompt input) vs homepage
      let onProjectPage = false;
      for (let wait = 0; wait < 15; wait++) {
        const promptInput = findPromptInput();
        const tiles = findAssetCards().filter(el => isVisible(el));
        if (promptInput || tiles.length > 0) {
          onProjectPage = true;
          break;
        }
        console.log(`[AutoFlow] Recovery: waiting for project page to load... (${(wait + 1) * 1.5}s)`);
        sendPhaseUpdate('scanning', `Recovery: Waiting for project page... (${wait + 1}/15)`);
        await sleep(1500);
        if (recoveryCancelled) { console.log('[AutoFlow] Recovery cancelled by user.'); await clearRunningQueue(); return; }
      }

      if (!onProjectPage) {
        console.log('[AutoFlow] Recovery: not on a project page after 30s. Clearing queue.');
        await clearRunningQueue();
        return;
      }

      // Wait for tiles to appear (up to 20s)
      let tilesFound = 0;
      for (let wait = 0; wait < 8; wait++) {
        tilesFound = findAssetCards().filter(el => isVisible(el)).length;
        if (tilesFound > 0) break;
        console.log(`[AutoFlow] Recovery: waiting for tiles... (${(wait + 1) * 1.5}s)`);
        sendPhaseUpdate('scanning', `Recovery: Waiting for tiles... (${wait + 1}/8)`);
        await sleep(1500);
        if (recoveryCancelled) { console.log('[AutoFlow] Recovery cancelled by user.'); await clearRunningQueue(); return; }
      }

      if (tilesFound === 0) {
        console.log('[AutoFlow] Recovery: no tiles found. Clearing queue.');
        await clearRunningQueue();
        return;
      }

      // Wait for any still-generating tiles to settle (up to 5 min)
      console.log(`[AutoFlow] Recovery: ${tilesFound} tile(s) found. Waiting for generating tiles to settle...`);
      sendPhaseUpdate('scanning', 'Recovery: Waiting for generating tiles to settle...');
      for (let elapsed = 0; elapsed < 300; elapsed += 15) {
        if (recoveryCancelled) { console.log('[AutoFlow] Recovery cancelled by user.'); await clearRunningQueue(); return; }
        const cards = findAssetCards().filter(el => isVisible(el));
        const generating = cards.filter(el => getTileState(el) === 'generating').length;
        const completed = cards.filter(el => getTileState(el) === 'completed').length;
        const failed = cards.filter(el => getTileState(el) === 'failed').length;

        if (generating === 0) {
          console.log(`[AutoFlow] Recovery: tiles settled — ${completed} completed, ${failed} failed (visible)`);
          break;
        }
        console.log(`[AutoFlow] Recovery: waiting... generating: ${generating}, completed: ${completed}, failed: ${failed}, elapsed: ${elapsed}s`);
        sendPhaseUpdate('scanning', `Recovery: Settling... generating: ${generating}, completed: ${completed}`);
        await sleep(8000);
      }

      // ── CORE LOGIC: Scroll through the ENTIRE virtualized grid ──
      // Flow uses Virtuoso which REMOVES off-screen tiles from the DOM.
      // We MUST scroll through all positions to see every tile.
      console.log('[AutoFlow] Recovery: scrolling through entire grid to collect ALL tile texts...');
      sendPhaseUpdate('checking', 'Recovery: Scrolling grid to verify all tiles...');

      // Use scrollAndCollectAllTileStates to get every tile's state and text
      const allTileStates = await scrollAndCollectAllTileStates();
      // Map all tile texts to prevent marking generating/failed-but-present tiles as "missing"
      const completedTileTexts = allTileStates
        .map(t => t.text.toLowerCase());

      // Also get full page text as final fallback
      const pageText = document.body.innerText.toLowerCase();

      const totalCompleted = allTileStates.filter(t => t.state === 'completed').length;
      const totalFailed = allTileStates.filter(t => t.state === 'failed').length;

      // Count how many prompts were actually submitted (not skipped/not-added)
      const submittedPrompts = queue.prompts.filter(p =>
        p.status !== 'not-added' && p.status !== 'queued'
      );
      console.log(`[AutoFlow] Recovery: found ${allTileStates.length} total tiles (${totalCompleted} completed, ${totalFailed} failed), collected text from ${completedTileTexts.length} completed tiles, ${submittedPrompts.length} prompts were submitted`);

      let recovered = 0;
      const trulyFailedPrompts: typeof queue.prompts = [];

      // ── SMART STRATEGY: Count-first, then text-match ──
      // Subtract baseline tiles (from BEFORE the queue started) to avoid
      // counting old tiles from previous queues as "completed" for this queue.
      const baseline = baselineTileCount || 0;
      const effectiveCompleted = Math.max(0, totalCompleted - baseline);
      console.log(`[AutoFlow] Recovery: ${totalCompleted} total completed - ${baseline} baseline = ${effectiveCompleted} effective completed for this queue`);

      if (effectiveCompleted >= submittedPrompts.length) {
        console.log(`[AutoFlow] Recovery: ✅ ${effectiveCompleted} effective completed >= ${submittedPrompts.length} submitted — ALL DONE (baseline-adjusted count)`);
        for (let i = 0; i < queue.prompts.length; i++) {
          const p = queue.prompts[i];
          if (p.status !== 'not-added') {
            if (p.status === 'failed') recovered++;
            p.status = 'done';
            p.error = undefined;
            sendPromptStatusUpdate(queue.id, i, 'done', undefined, p.mediaId);
          }
        }
      } else {
        // Not enough completed tiles — need to find which specific prompts are missing.
        // Use multi-fragment fuzzy matching for better accuracy.
        console.log(`[AutoFlow] Recovery: ${totalCompleted} completed but ${submittedPrompts.length} submitted — using fuzzy match to find missing...`);
        sendPhaseUpdate('checking', 'Recovery: Matching prompt texts against tiles...');

        // Track which tile texts have been "consumed" to avoid double-matching
        const consumedTileIndices = new Set<number>();

        /**
         * Fuzzy match: try multiple text fragments from start, middle, and end
         * of the prompt against each tile text. Google Flow often truncates
         * the prompt or reformats it, so a single 40-char slice fails.
         */
        function fuzzyMatchPrompt(promptText: string, tileTexts: string[]): number {
          const clean = promptText.trim().toLowerCase();
          if (clean.length < 4) return -1;

          // Generate search fragments from different parts of the prompt
          const fragments: string[] = [];
          // Start fragment (first 25 chars — most reliable)
          fragments.push(clean.slice(0, Math.min(25, clean.length)));
          // Middle fragment
          if (clean.length > 60) {
            const mid = Math.floor(clean.length / 2) - 12;
            fragments.push(clean.slice(mid, mid + 25));
          }
          // Unique keywords: pick the longest word (likely the most unique identifier)
          const words = clean.split(/\s+/).filter(w => w.length > 5);
          if (words.length > 0) {
            words.sort((a, b) => b.length - a.length);
            fragments.push(words[0]); // longest word
            if (words.length > 2) fragments.push(words[2]); // third longest
          }

          // Try matching each fragment against unconsumed tiles
          for (let ti = 0; ti < tileTexts.length; ti++) {
            if (consumedTileIndices.has(ti)) continue;
            const tile = tileTexts[ti];
            // Match if ANY 2+ fragments hit (reduces false positives)
            let hits = 0;
            for (const frag of fragments) {
              if (tile.includes(frag)) hits++;
            }
            if (hits >= 2) return ti;
            // Single hit with the start fragment is also OK (most reliable)
            if (hits >= 1 && tile.includes(fragments[0])) return ti;
          }

          // Last resort: check page text with start fragment
          if (pageText.includes(fragments[0])) return -2; // special: found on page but not in tile

          return -1; // not found
        }

        for (let i = 0; i < queue.prompts.length; i++) {
          const p = queue.prompts[i];
          if (p.status === 'not-added' || p.status === 'queued') continue;

          // If prompt has already hard-failed (reached 3 retries in Phase 1), preserve failed status and skip recovery
          if (hardFailedIndices.includes(i)) {
            p.status = 'failed';
            p.error = 'Failed after 3 retry attempts';
            console.log(`[AutoFlow] Recovery: prompt #${i + 1} is marked as hard-failed — skipping rescue`);
            sendPromptStatusUpdate(queue.id, i, 'failed', p.error);
            continue;
          }

          // Very short prompts — can't reliably match
          if (p.text.trim().length < 4) {
            console.log(`[AutoFlow] Recovery: prompt #${i + 1} too short, assuming done`);
            p.status = 'done';
            p.error = undefined;
            recovered++;
            sendPromptStatusUpdate(queue.id, i, 'done');
            continue;
          }

          const matchIdx = fuzzyMatchPrompt(p.text, completedTileTexts);

          if (matchIdx >= 0) {
            // Found in a specific tile — consume it so it's not double-matched
            consumedTileIndices.add(matchIdx);
            if (p.status === 'failed') {
              recovered++;
              console.log(`[AutoFlow] Recovery: prompt #${i + 1} ✅ FOUND in tile — "${p.text.slice(0, 30)}..." → marking done`);
            } else {
              console.log(`[AutoFlow] Recovery: prompt #${i + 1} ✅ confirmed (${p.status})`);
            }
            p.status = 'done';
            p.error = undefined;
            sendPromptStatusUpdate(queue.id, i, 'done', undefined, p.mediaId);
          } else if (matchIdx === -2) {
            // Found on page text but not in a specific tile
            if (p.status === 'failed') recovered++;
            console.log(`[AutoFlow] Recovery: prompt #${i + 1} ✅ found on page text — "${p.text.slice(0, 30)}..." → marking done`);
            p.status = 'done';
            p.error = undefined;
            sendPromptStatusUpdate(queue.id, i, 'done', undefined, p.mediaId);
          } else {
            // NOT found anywhere — truly failed (queued for regeneration)
            p.status = 'queued';
            p.attempts = 0;
            p.error = undefined;
            p.tileIds = [];
            trulyFailedPrompts.push(p);
            console.log(`[AutoFlow] Recovery: prompt #${i + 1} ❌ NOT FOUND — "${p.text.slice(0, 30)}..." → will regenerate`);
            sendPromptStatusUpdate(queue.id, i, 'queued');
          }
        }

        // ── SAFETY NET: Count-based correction ──
        // Rescues false-positives where a prompt is incorrectly marked as failed
        // because the text matcher failed to find its completed video tile.
        // Exclude hard-failed prompts from expected missing count
        const hardFailedCount = hardFailedIndices.filter((idx: number) => 
          submittedPrompts.map(p => queue.prompts.indexOf(p)).includes(idx)
        ).length;
        const expectedMissing = Math.max(0, submittedPrompts.length - effectiveCompleted - hardFailedCount);
        
        if (trulyFailedPrompts.length > expectedMissing && expectedMissing >= 0) {
          const excess = trulyFailedPrompts.length - expectedMissing;
          console.log(`[AutoFlow] Recovery: text match says ${trulyFailedPrompts.length} missing but baseline-adjusted count says only ${expectedMissing} missing — removing ${excess} false negatives`);
          for (let x = 0; x < excess; x++) {
            const rescued = trulyFailedPrompts.shift()!;
            rescued.status = 'done';
            rescued.error = undefined;
            recovered++;
            console.log(`[AutoFlow] Recovery: prompt "${rescued.text.slice(0, 25)}..." rescued by count-based safety net ✅`);
            sendPromptStatusUpdate(queue.id, queue.prompts.indexOf(rescued), 'done', undefined, rescued.mediaId);
          }
        }
      }

      console.log(`[AutoFlow] Recovery complete: ${recovered} recovered from fake failures, ${trulyFailedPrompts.length} truly missing`);
      sendPhaseUpdate('checking', `Recovery complete: ${recovered} recovered, ${trulyFailedPrompts.length} missing.`);
      if (recoveryCancelled) {
        console.log('[AutoFlow] Recovery cancelled by user.');
        await clearRunningQueue();
        await chrome.storage.local.remove(['autoflow_uploaded_assets', 'autoflow_hard_failed_indices']);
        return;
      }

      // Clear the saved state
      await clearRunningQueue();
      await chrome.storage.local.remove(['autoflow_uploaded_assets', 'autoflow_hard_failed_indices']);

      // Notify sidepanel
      await sleep(500);
      try {
        chrome.runtime.sendMessage({
          type: 'QUEUE_RECOVERY_RESULT',
          payload: {
            queueName: queue.name,
            recovered,
            trulyFailed: trulyFailedPrompts.length,
            failedPrompts: []
          }
        }).catch(() => {});
      } catch { /* ignore */ }

      // Only restart the queue if there are truly missing prompts
      if (trulyFailedPrompts.length > 0 && !recoveryCancelled) {
        console.log(`[AutoFlow] Regenerating ${trulyFailedPrompts.length} truly missing prompt(s)...`);
        sendPhaseUpdate('running', `Regenerating ${trulyFailedPrompts.length} missing prompt(s)...`);

        // We update the original queue status and current index, then start it
        queue.status = 'running';
        queue.currentPromptIndex = 0;

        await sleep(3000);
        startQueue(queue, baselineTileCount);
      } else {
        console.log('[AutoFlow] All prompts found on page! No regeneration needed. ✅');
        sendPhaseUpdate('checking', 'All prompts successfully verified and completed.');
        try {
          chrome.runtime.sendMessage({
            type: 'QUEUE_STATUS_UPDATE',
            payload: { queueId: queue.id, status: 'completed' }
          }).catch(() => {});
        } catch { /* ignore */ }

        // Auto-scan library — download ALL completed videos on the page
        // This covers the recovered fake-cancelled videos too
        await sleep(1000);
        try {
          chrome.runtime.sendMessage({
            type: 'AUTO_SCAN_LIBRARY',
            payload: { queueName: queue.name, autoDownload: !!(queue.settings as any)?.autoDownload },
          }).catch(() => {});
        } catch { /* ignore */ }
      }

      return;
    }

    // ── NORMAL INTERRUPT: Auto-resume if recent, ask user if old ──
    const remaining = queue.prompts.length - currentIndex;
    if (remaining <= 0) {
      await clearRunningQueue();
      return;
    }

    const ageMs = Date.now() - saved.savedAt;
    const AUTO_RESUME_THRESHOLD_MS = 2 * 60 * 1000; // 2 minutes

    if (ageMs < AUTO_RESUME_THRESHOLD_MS) {
      // Recent save — Chrome likely auto-refreshed the page. Resume immediately.
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
            message: `Page refreshed — auto-resuming queue "${queue.name}" from prompt #${currentIndex + 1} (${remaining} remaining)`
          }
        }).catch(() => {});
      } catch { /* ignore */ }

      return resumeInterruptedQueue();
    }

    // Old save — ask user whether to resume or discard
    console.log(`[AutoFlow] Detected interrupted queue "${queue.name}" — ${remaining} prompts remaining (from #${currentIndex + 1}), saved ${Math.round(ageMs / 60000)} minutes ago`);

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
        // Engine is null (page was reloaded) — force-clear the UI
        chrome.runtime.sendMessage({
          type: 'QUEUE_STATUS_UPDATE',
          payload: { status: 'stopped' }
        }).catch(() => {});
      }
      recoveryCancelled = true;
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
      return { isAvailable: isApiAvailable() };

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

    case 'IMAGE_API_COMPLETED': {
      // Background detected batchGenerateImages completed via webRequest.
      // Notify the engine so it can immediately resolve submitted prompts.
      console.log('[AutoFlow] Image API completed (webRequest signal)', msg.payload?.statusCode);
      if (engine) {
        (engine as any).onImageApiCompleted?.(msg.payload);
      }
      return { success: true };
    }

    case 'PING':
      return { type: 'PONG', runLocked: isRunLocked() };

    default:
      return { error: `Unknown message: ${msg.type}` };
  }
}

async function startQueue(queue: QueueObject, baselineTileCount?: number): Promise<any> {
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
  (async () => {
    try {
      const storageData = await new Promise<any>((resolve) => {
        chrome.storage.local.get(['autoflow_uploaded_assets'], resolve);
      });
      const uploadedAssetsList = storageData?.autoflow_uploaded_assets || [];
      if (uploadedAssetsList.length > 0) {
        for (const asset of uploadedAssetsList) {
          (engine as any).uploadedAssets.add(asset);
        }
        console.log(`[AutoFlow] Restored ${uploadedAssetsList.length} uploaded assets into engine cache.`);
      }
    } catch (err: any) {
      console.warn('[AutoFlow] Failed to restore uploaded assets:', err);
    }

    try {
      await engine.start(queue, baselineTileCount);
    } catch (err) {
      console.error('[AutoFlow] Queue error:', err);
    } finally {
      stopAntiThrottle();  // Queue finished — stop self-ping
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
      // Images: always download at 1K (original) — upscaling costs Google Flow credits
      // Videos: use the user's preferred resolution setting
      const assetRes = asset.mediaType === 'image' ? '1K' : resolutionLabel;
      const ok = await downloadAssetByMenu(asset.locator, assetRes);
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

