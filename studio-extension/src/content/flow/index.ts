/* ============================================================
   AutoFlow أ¢â‚¬â€œ Content Script Entry Point
   Runs on labs.google/flow pages.
   Routes messages to the automation engine and scanner.
   ============================================================ */

import { ImageMeta, Message, QueueObject } from '../../types';
import { openMediaDialog, watchForRightsConsent, confirmInLibrary } from './libraryPicker';
import { ensureProject } from './project';
import { AutomationEngine, attachStallLimitMs, isRunLocked } from './automation';
import { scanProjectForVideos, previewAsset, retrySingleTile, downloadAssetByMenu, waitForUpscalingDone, waitForExtendedVideoDownloadDone } from './scanner';
import {
  sleep, findModelSelectorTrigger, findMenuItem, simulateClick,
  scrollOutputToTop, bringTileIntoView, flowTileIdentity, findTileByIdentity, findActiveAgentToggle,
} from './selectors';

/**
 * Something to call this tile in a log line.
 *
 * data-tile-id and .id are both absent on the Angular Flow, so every line
 * naming a tile said "tile ?" and every completion said "(id=unknown)" — for
 * tiles that were tracked correctly and finished correctly. flowTileIdentity
 * reads the id out of the media URL, which is the same thing the rest of the
 * adapter identifies a tile by.
 */
function tileLabel(tile: Element): string {
  return tile.getAttribute('data-tile-id')
    || (tile as HTMLElement).id
    || flowTileIdentity(tile).slice(0, 8)
    || 'unknown';
}
import { DOM_SETTLE_MS } from '../../shared/constants';
import { getRunningQueue, clearRunningQueue } from '../../shared/storage';
import {
  initApiHelper, isApiAvailable, isInterceptorAlive, isCacheFresh, activeStatusCheck,
  findStatusByMediaId, findStatusByPromptText, classifyError, observeGeneration,
} from './apiHelper';
import { matchesFlowText, FLOW_STRINGS } from './flowStrings';
import { releaseStudioImages } from './studioImages';
import { resolveStudioReferenceImages } from './studioReferenceImages';
import { pickReferenceStill } from './studioFrames';
import { isSameGeneration } from './mediaIdentity';
import { captureVideoFrame, captureVideoEndFrame, framesFromVideoBlob } from './videoFrames';
import { effectiveVoice } from '../../studio/flowVoices';
import { MotionNativeRetry, MOTION_NATIVE_RETRIES, motionRetryReady } from './motionRetry';
import {
  getStudioTileState, extractTileProgress, findLargestImgSrc, resultArea,
  flowErrorTile, flowFailureMessage, isPriorFailure, PRIOR_FAILURE,
} from './tileState';

// أ¢â€‌â‚¬أ¢â€‌â‚¬ Singleton engine أ¢â€‌â‚¬أ¢â€‌â‚¬
let engine: AutomationEngine | null = null;

// أ¢â€‌â‚¬أ¢â€‌â‚¬ Recovery cancellation flag أ¢â€‌â‚¬أ¢â€‌â‚¬
let recoveryCancelled = false;

// أ¢â€‌â‚¬أ¢â€‌â‚¬ Anti-throttle: periodic self-ping via service worker roundtrip أ¢â€‌â‚¬أ¢â€‌â‚¬
// When Chrome throttles background tabs, setTimeout delays balloon.
// A message roundtrip to the service worker wakes up the main thread.
let antiThrottleInterval: ReturnType<typeof setInterval> | null = null;

/* Bumped whenever this adapter's completion logic changes. A content
   script already injected into an open tab is NOT replaced when the
   extension is rebuilt — the tab must be reloaded too — and a stale
   script is indistinguishable from a broken fix unless it says which
   one it is. */
const ADAPTER_BUILD = 'cdk-virtual-grid-v4';

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
  /* Only while a run holds this tab. The check had stopped matching Flow's
     chip, so people have been using Flow's Agent with the extension
     installed; repairing it must not take Agent away from them outside a run. */
  const deactivateAgent = () => {
    if (isRunLocked()) findActiveAgentToggle()?.click();
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
      // أ¢â€‌â‚¬أ¢â€‌â‚¬ RECOVERY MODE: Page was reloaded to clear fake "cancelled" tiles أ¢â€‌â‚¬أ¢â€‌â‚¬
      // The ONLY source of truth is: does a completed video exist on the page for each prompt?
      // We DON'T trust the prompt.status from before the reload أ¢â‚¬â€‌ tile IDs are stale after refresh.
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

      // Wait for Flow to fully load (reduced from 6s أ¢â‚¬â€‌ fake cancels resolve fast)
      await sleep(4000);
      if (recoveryCancelled) { console.log('[AutoFlow] Recovery cancelled by user.'); await clearRunningQueue(); return; }

      // Import tile scanning tools أ¢â‚¬â€‌ including scroll collector for virtualized lists
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
          console.log(`[AutoFlow] Recovery: tiles settled أ¢â‚¬â€‌ ${completed} completed, ${failed} failed (visible)`);
          break;
        }
        console.log(`[AutoFlow] Recovery: waiting... generating: ${generating}, completed: ${completed}, failed: ${failed}, elapsed: ${elapsed}s`);
        sendPhaseUpdate('scanning', `Recovery: Settling... generating: ${generating}, completed: ${completed}`);
        await sleep(8000);
      }

      // أ¢â€‌â‚¬أ¢â€‌â‚¬ CORE LOGIC: Scroll through the ENTIRE virtualized grid أ¢â€‌â‚¬أ¢â€‌â‚¬
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

      // أ¢â€‌â‚¬أ¢â€‌â‚¬ SMART STRATEGY: Count-first, then text-match أ¢â€‌â‚¬أ¢â€‌â‚¬
      // Subtract baseline tiles (from BEFORE the queue started) to avoid
      // counting old tiles from previous queues as "completed" for this queue.
      const baseline = baselineTileCount || 0;
      const effectiveCompleted = Math.max(0, totalCompleted - baseline);
      console.log(`[AutoFlow] Recovery: ${totalCompleted} total completed - ${baseline} baseline = ${effectiveCompleted} effective completed for this queue`);

      if (effectiveCompleted >= submittedPrompts.length) {
        console.log(`[AutoFlow] Recovery: أ¢إ“â€¦ ${effectiveCompleted} effective completed >= ${submittedPrompts.length} submitted أ¢â‚¬â€‌ ALL DONE (baseline-adjusted count)`);
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
        // Not enough completed tiles أ¢â‚¬â€‌ need to find which specific prompts are missing.
        // Use multi-fragment fuzzy matching for better accuracy.
        console.log(`[AutoFlow] Recovery: ${totalCompleted} completed but ${submittedPrompts.length} submitted أ¢â‚¬â€‌ using fuzzy match to find missing...`);
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
          // Start fragment (first 25 chars أ¢â‚¬â€‌ most reliable)
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
            console.log(`[AutoFlow] Recovery: prompt #${i + 1} is marked as hard-failed أ¢â‚¬â€‌ skipping rescue`);
            sendPromptStatusUpdate(queue.id, i, 'failed', p.error);
            continue;
          }

          // Very short prompts أ¢â‚¬â€‌ can't reliably match
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
            // Found in a specific tile أ¢â‚¬â€‌ consume it so it's not double-matched
            consumedTileIndices.add(matchIdx);
            if (p.status === 'failed') {
              recovered++;
              console.log(`[AutoFlow] Recovery: prompt #${i + 1} أ¢إ“â€¦ FOUND in tile أ¢â‚¬â€‌ "${p.text.slice(0, 30)}..." أ¢â€ â€™ marking done`);
            } else {
              console.log(`[AutoFlow] Recovery: prompt #${i + 1} أ¢إ“â€¦ confirmed (${p.status})`);
            }
            p.status = 'done';
            p.error = undefined;
            sendPromptStatusUpdate(queue.id, i, 'done', undefined, p.mediaId);
          } else if (matchIdx === -2) {
            // Found on page text but not in a specific tile
            if (p.status === 'failed') recovered++;
            console.log(`[AutoFlow] Recovery: prompt #${i + 1} أ¢إ“â€¦ found on page text أ¢â‚¬â€‌ "${p.text.slice(0, 30)}..." أ¢â€ â€™ marking done`);
            p.status = 'done';
            p.error = undefined;
            sendPromptStatusUpdate(queue.id, i, 'done', undefined, p.mediaId);
          } else {
            // NOT found anywhere أ¢â‚¬â€‌ truly failed (queued for regeneration)
            p.status = 'queued';
            p.attempts = 0;
            p.error = undefined;
            p.tileIds = [];
            trulyFailedPrompts.push(p);
            console.log(`[AutoFlow] Recovery: prompt #${i + 1} أ¢â€Œإ’ NOT FOUND أ¢â‚¬â€‌ "${p.text.slice(0, 30)}..." أ¢â€ â€™ will regenerate`);
            sendPromptStatusUpdate(queue.id, i, 'queued');
          }
        }

        // أ¢â€‌â‚¬أ¢â€‌â‚¬ SAFETY NET: Count-based correction أ¢â€‌â‚¬أ¢â€‌â‚¬
        // Rescues false-positives where a prompt is incorrectly marked as failed
        // because the text matcher failed to find its completed video tile.
        // Exclude hard-failed prompts from expected missing count
        const hardFailedCount = hardFailedIndices.filter((idx: number) => 
          submittedPrompts.map(p => queue.prompts.indexOf(p)).includes(idx)
        ).length;
        const expectedMissing = Math.max(0, submittedPrompts.length - effectiveCompleted - hardFailedCount);
        
        if (trulyFailedPrompts.length > expectedMissing && expectedMissing >= 0) {
          const excess = trulyFailedPrompts.length - expectedMissing;
          console.log(`[AutoFlow] Recovery: text match says ${trulyFailedPrompts.length} missing but baseline-adjusted count says only ${expectedMissing} missing أ¢â‚¬â€‌ removing ${excess} false negatives`);
          for (let x = 0; x < excess; x++) {
            const rescued = trulyFailedPrompts.shift()!;
            rescued.status = 'done';
            rescued.error = undefined;
            recovered++;
            console.log(`[AutoFlow] Recovery: prompt "${rescued.text.slice(0, 25)}..." rescued by count-based safety net أ¢إ“â€¦`);
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
        console.log('[AutoFlow] All prompts found on page! No regeneration needed. أ¢إ“â€¦');
        sendPhaseUpdate('checking', 'All prompts successfully verified and completed.');
        try {
          chrome.runtime.sendMessage({
            type: 'QUEUE_STATUS_UPDATE',
            payload: { queueId: queue.id, status: 'completed' }
          }).catch(() => {});
        } catch { /* ignore */ }

        // Auto-scan library أ¢â‚¬â€‌ download ALL completed videos on the page
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

    /* The debugger upload asks for this before attaching: CDP finds the
       "Upload media" button by looking inside an open dialog, so the dialog
       has to be on screen first. Reuses the opener the library picker uses,
       rather than a second set of selectors for the same three clicks. */
    case 'PREPARE_VIDEO_UPLOAD' as any: {
      /* Through logLine, so the waiting is visible in Diagnostics. Without it
         the feed showed eighty seconds of Gemini, then one line saying the
         upload failed, and nothing about the thirty seconds spent waiting for
         a tab Chrome had discarded. */
      /* Inside a project first. The media library belongs to a project, so
         on Flow's homepage there is no dialog to open — the upload used to
         fail here, three attempts and two reloads later. Nothing happens when
         a project is already open: that project is used. */
      const project = await ensureProject({ log: logLine });
      if (!project.ok) return { error: project.reason };
      const opened = await openMediaDialog({ log: logLine });
      return opened.ok ? { ok: true } : { error: opened.reason };
    }

    /* Flow's "Rights to use this video" consent, which stands in front of the
       FIRST upload and quietly stops it: the file chooser has already been
       satisfied by CDP, so nothing reports a failure — the bytes just never
       arrive, and the attach afterwards says "No assets found".

       Armed by the worker BEFORE the chooser runs and left polling across the
       whole upload, because whether Flow raises this on the Upload press or on
       the hand-off is not settled, and watching costs one query per quarter
       second. The worker does not await it. */
    case 'WATCH_RIGHTS_DIALOG' as any: {
      const ms = Number((msg as any).ms);
      const dismissed = await watchForRightsConsent(
        ms > 0 ? ms : 30_000,
        { log: logLine },
      );
      return { ok: true, dismissed };
    }

    /* Did Flow actually TAKE the file?

       CDP satisfying the file chooser is not the same as Flow ingesting the
       bytes, and until this existed nothing anywhere asked the difference:
       the upload returned ok the instant the paths were handed to the input,
       the Motion node announced the pieces were in the library, and the
       attach a few seconds later could not find them. Only one of those three
       had looked at the library.

       Run in the page rather than the worker because the answer is in the
       DOM — and because the same poll can press Flow's rights notice, which is
       the thing most likely to be holding the file on a new account. */
    case 'CONFIRM_VIDEOS_IN_LIBRARY' as any: {
      const names: string[] = Array.isArray((msg as any).names) ? (msg as any).names : [];
      const budgetMs = Number((msg as any).budgetMs) || undefined;
      return await confirmInLibrary(names, { log: logLine, budgetMs });
    }

    case 'PING':
      // `pong` as well as the legacy shape: the worker's readiness check looked
      // for it, found it only on the chat scripts, and made every Flow node
      // wait out a thirty-second loop that could never succeed.
      return { type: 'PONG', pong: true, runLocked: isRunLocked() };

    // أ¢â€‌â‚¬أ¢â€‌â‚¬ Studio: Execute a single node on Google Flow أ¢â€‌â‚¬أ¢â€‌â‚¬
    case 'STUDIO_EXECUTE_NODE' as any:
      return handleStudioExecuteNode(msg.payload);

    case 'STUDIO_STOP' as any:
      /* Every watcher goes with the engine. engine.stop() alone left a
         generation's watcher waiting on an engine back at IDLE, and ninety
         seconds later it reported "Engine stalled at IDLE" into whatever run
         was waiting on that node by then. See StudioExecution. */
      executions.clear();
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
  // DOWNLOAD ALL ASSETS via Flow context menu with rename
  // Always use menu-based download أ¢â‚¬â€‌ direct URL download is
  // unreliable because videoSrc is often empty for tiles.
  // أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯أ¢â€¢ع¯
  console.log(`[AutoFlow] Downloading ${payload.assets.length} asset(s) via context menu with rename...`);
  for (const asset of payload.assets) {
    try {
      const filename = buildFilename(asset);

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

/**
 * Which run each node is on, in this tab.
 *
 * A generation's watcher outlives the run that started it: Stop only stopped
 * the engine, and a closed or reloaded panel stops nothing here. On 2026-10-01
 * one such watcher reported "Engine stalled at IDLE for 132s" into the NEXT
 * run, whose director was waiting on the same node in Gemini — replies are
 * matched on the node — and that run stopped with nothing generated.
 *
 * So each watcher keeps the run it started with. A new run of the node, or
 * Stop, retires it without a word; and everything it does say carries the
 * runner's id for that run, which the runner checks.
 */
interface StudioExecution { readonly execId?: string }
const executions = new Map<string, StudioExecution>();
const isCurrentRun = (nodeId: string, run: StudioExecution): boolean => executions.get(nodeId) === run;

async function handleStudioExecuteNode(payload: any): Promise<any> {
  const { nodeId, config } = payload || {};
  if (!nodeId || !config) {
    return { type: 'STUDIO_NODE_ERROR', payload: { nodeId, error: 'Missing nodeId or config' } };
  }
  const run: StudioExecution = { execId: typeof config.execId === 'string' ? config.execId : undefined };
  executions.set(nodeId, run);

  const startedAt = Date.now();
  const since = () => `+${((Date.now() - startedAt) / 1000).toFixed(1)}s`;
  console.log(`[AutoFlow Studio] Executing node ${nodeId}`);

  // ── Resolve reference images (Image nodes + upstream Generate tiles) ──
  // Registers them in the studio image registry so the automation engine's
  // requestImageBlobs() can resolve them without touching the sidepanel.
  let refImages: ImageMeta[];
  try {
    refImages = await resolveStudioReferenceImages(config, tileId => {
      const tile = findTileByIdentity(tileId);
      return tile ? extractTileMediaUrl(tile) : '';
    });
  } catch (e: any) {
    sendStudioError(nodeId, e.message || 'Failed to resolve reference images', run.execId);
    return { success: false };
  }
  /* Reference images are fetched and registered before the queue starts, so a
     slow one delays everything visible after it. Timed separately because
     from the outside it is indistinguishable from Flow being slow. */
  if (refImages.length) {
    console.log(`[AutoFlow Studio] ${refImages.length} reference image(s) resolved ${since()}`);
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
      /* Frames mode gives Flow a first and last still and lets it
         interpolate between them. The engine has supported it all along —
         attachFrameImages exists — but Studio pinned this to 'ingredients',
         so the whole mode was unreachable from a node. */
      creationType: config.creationType === 'frames' ? 'frames' : 'ingredients',
      model: isImage ? 'Omni 1.1 Flash' : (config.model || 'Omni 1.1 Flash'),
      orientation: (config.aspectRatio === '9:16' || config.aspectRatio === '3:4') ? 'portrait' : 'landscape',
      generations: 1,
      // Honour the node's duration — this was pinned to '8s', so every
      // Studio video ran 8s no matter what the node's dropdown said.
      duration: (config.duration || '6s'),
      // 720p is Flow's own default; 360p is a deliberate cheaper choice.
      renderResolution: (config.renderResolution || '720p'),
      /* The node's voice, if the shot has a character to give it to.
         Pinned to 'none' since Studio was written, so the whole feature —
         built, working, and shipping in the original extension — was
         unreachable from a node. effectiveVoice holds the "needs an image"
         rule, because a voice applied to a shot with an empty ingredient tray
         is silently dropped by Flow and the clip comes back mute. */
      voiceIngredient: effectiveVoice(config.voice, refImages.length > 0, config.creationType),
      characters: config.characters,
      stopOnError: false,
      /* A video already in Flow's library, attached to the prompt so the
         generation matches the clip it belongs beside — or, for a Motion
         Control piece, so it has the motion it is transferring at all.
       *
         Handed to the ENGINE rather than attached here. It used to go on
         before startQueue, on the reasoning that the ingredient has to be on
         the prompt when the engine submits. That requirement is right and the
         timing was wrong: between here and Generate the engine opens the media
         dialog for the reference images, opens the ingredient menu for the
         voice, and fills the prompt — and Flow's own "clear prompt on submit"
         reads a chip put there beforehand as leftovers. Watched on the live
         page, the clip went on and came straight back off. The engine now
         attaches it at the last quiet moment and re-counts it before it
         presses Generate. */
      styleReference: String(config.styleReference || '').trim() || undefined,
      styleReferenceRequired: config.styleReferenceRequired === true,
      retryFailedMotion: config.retryFailedMotion === true,
      modelRequired: config.modelRequired === true,
      automationMode: 'lite',
      waitMinSec: 1,
      waitMaxSec: 2,
      typingMode: false,
      typingSpeedMultiplier: 1.0,
      autoDownloadVideos: false,
      videoResolution: '4K',
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

  console.log(`[AutoFlow Studio] Handing the node to the engine ${since()}`);
  /* Every failed tile on the page now belongs to an earlier attempt. A retried
     Motion piece sends the same prompt again, so its last failure sits in the
     grid with identical text and no id to tell it apart — marked before this
     node submits, only a failure that appears after it can be this node's. */
  for (const failure of Array.from(document.querySelectorAll('flow-error-tile'))) {
    failure.setAttribute(PRIOR_FAILURE, '');
  }
  // Start the queue (non-blocking)
  const result = await startQueue(queue);
  if (!result.success) {
    releaseStudioImages(refImages.map(i => i.id));
    sendStudioError(nodeId, result.error || 'Failed to start queue', run.execId);
    return { success: false };
  }

  // Return immediately -- do NOT block the message port.
  // Fire-and-forget poller sends updates via chrome.runtime.sendMessage.
  // Reference images stay registered until the node settles (retries re-attach them).
  /* The poller throws for a submit that never landed. Unhandled, that
     rejection reached no one: the node was left with no result at all and sat
     there until the runner's own 22-minute budget expired, replacing a
     specific message with a generic timeout. */
  pollStudioCompletion(nodeId, queue, run)
    .catch((e: any) => {
      if (isCurrentRun(nodeId, run)) {
        sendStudioError(nodeId, e?.message || 'Tracking this generation failed', run.execId);
      }
    })
    .finally(() => {
      releaseStudioImages(refImages.map(i => i.id));
      if (isCurrentRun(nodeId, run)) executions.delete(nodeId);
    });
  return { success: true };
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

async function pollStudioCompletion(nodeId: string, queue: any, run: StudioExecution): Promise<void> {
  /* This watcher's voice: every word carries the run that started it, and
     none is said once that run is over (StudioExecution). The same names as
     the module's senders, so every line below reads exactly as it did. */
  const sendStudioProgress = (id: string, progress: number): void => {
    if (isCurrentRun(id, run)) postStudioProgress(id, progress, run.execId);
  };
  const sendStudioError = (id: string, error: string): void => {
    if (isCurrentRun(id, run)) postStudioError(id, error, run.execId);
  };
  const sendStudioResult = async (
    id: string, tileId: string, mediaUrl?: string, previewSrc?: string, tile?: Element | null,
    promptText?: string, mediaId?: string, expectVideo = false,
  ): Promise<void> => {
    if (isCurrentRun(id, run)) {
      await postStudioResult(id, tileId, mediaUrl, previewSrc, tile, promptText, mediaId, expectVideo, run.execId);
    }
  };
  /* Checked on every turn of both waits below. */
  const retired = (): boolean => {
    if (isCurrentRun(nodeId, run)) return false;
    logLine('Stopped watching this generation — its node was stopped or run again.');
    return true;
  };

  const { findAssetCards, isVisible, findRowForPrompt, readGenerationRows, scrollOutputToTop,
    findOutputScroller, bringTileIntoView } =
    await import('./selectors');

  // What this node actually asked Flow for. Used further down to tell our
  // generation apart from everything else in the grid.
  const promptText: string = queue?.prompts?.[0]?.text || queue?.prompts?.[0]?.prompt || '';

  sendStudioProgress(nodeId, 20);

  /* ── Phase 1: wait for the engine to submit (settings → images → prompt → Generate) ──
   *
   * Waits on the engine making PROGRESS, not on a stopwatch.
   *
   * This used to allow a flat 60 seconds. clickGenerate alone is allowed 60s
   * waiting for Flow to re-enable the Generate button after it finishes
   * processing an uploaded image — so any node carrying a reference image
   * blew the budget while the engine was still working correctly, and the
   * node failed with "did not submit the prompt in time" having done nothing
   * wrong. Attaching an image made it near-certain.
   *
   * An outer wait shorter than the inner work it supervises is the same fault
   * that failed long videos, where the runner gave up at 10 minutes on a tile
   * the content script tracks for 20. Deriving the limit from progress rather
   * than from a guess is what stops it coming back a third time.
   */
  const STALL_LIMIT_MS = 90_000;   // no state change at all — genuinely hung

  /* Attaching is the one step whose own waits exceed the general limit, so it
     is the one step that gets its own — derived from those waits rather than
     guessed at, which is the whole point of the paragraph above. */
  const ATTACH_STATES = new Set(['ATTACH_INGREDIENT_IMAGES', 'ATTACH_FRAME_IMAGES']);
  // Content-identified references attach serially so each upload maps to one
  // asset. The supervisor must allow the same budget for every reference.
  const referenceCount = Math.max(1, queue?.prompts?.[0]?.images?.length || 0);
  const referenceAttachLimit = attachStallLimitMs() * referenceCount;
  const stallLimitFor = (state: string): number =>
    (ATTACH_STATES.has(state) ? referenceAttachLimit : STALL_LIMIT_MS);
  const ABSOLUTE_LIMIT_MS = Math.max(6 * 60_000, referenceAttachLimit + 120_000);

  const submitStart = Date.now();
  while (Date.now() - submitStart < ABSOLUTE_LIMIT_MS) {
    await sleep(500);
    if (retired()) return;
    const status = queue.prompts[0].status;

    if (status === 'submitted' || status === 'done') break;
    if (status === 'failed') {
      /* "Generation failed" is not a reason, and it is what the node has been
         showing: three words that do not say whether to reword the prompt,
         wait for capacity, or check the reference wired into it. The service
         said something more specific; go and get it. */
      let detail = queue.prompts[0].error || '';
      if (!detail && isApiAvailable()) {
        const st = (queue.prompts[0].mediaId ? findStatusByMediaId(queue.prompts[0].mediaId) : null)
          || findStatusByPromptText(promptText);
        if (st && st.state === 'failed') {
          const why = classifyError(st.rawStatus, st.failureReason);
          detail = why === 'safety'
            ? `Flow refused this prompt on safety grounds (${st.failureReason || st.rawStatus}). `
              + 'Rewording is the only thing that will change it.'
            : `Flow reported ${st.rawStatus}${st.failureReason ? ` — ${st.failureReason}` : ''}`;
        }
      }
      sendStudioError(nodeId, detail || 'Generation failed — Flow gave no reason');
      return;
    }

    /* Still moving through its steps? Then it is working, however slowly.

       The limit depends on the step. Attaching an image waits up to 145s of
       its own — see attachStallLimitMs — and supervising that with the
       general 90s reported a slow upload as a hang, on the one stage where
       giving up early risks generating without the reference. */
    if (engine && engine.getStateAge() < stallLimitFor(engine.getState())) continue;
    if (!engine) break; // engine gone — fall through to the status check below

    sendStudioError(
      nodeId,
      `Engine stalled at ${engine.getState()} for ${Math.round(engine.getStateAge() / 1000)}s ` +
      `without submitting. Check the Flow tab.`
    );
    return;
  }

  const prompt = queue.prompts[0];
  if (prompt.status !== 'submitted' && prompt.status !== 'done') {
    sendStudioError(
      nodeId,
      engine
        ? `Engine did not submit the prompt — last step was ${engine.getState()}.`
        : 'Engine did not submit the prompt in time'
    );
    return;
  }

  // Engine submitted the prompt — now we have the tile IDs
  const trackedTileIds: string[] = prompt.tileIds || [];
  console.log(`[AutoFlow Studio] Engine submitted. Tracking tiles: ${trackedTileIds.join(', ') || 'none'}`);
  sendStudioProgress(nodeId, 40);

  /* The engine saying "done" is not a result.
   *
   * This used to return here with nothing but a tile id. Everything a result
   * carries — the preview, the playable clip, and the last frame a chained
   * node continues from — is read off the tile ELEMENT inside
   * sendStudioResult. Handing it no element produced a node that went green
   * with "Preview unavailable" and an empty referenceUrl, so the Last Frame
   * below it stayed blank and every node after that failed with "Nothing to
   * continue from" while Flow was rendering the clip perfectly well.
   *
   * It cost nothing to skip the tracking loop here and everything downstream,
   * so both paths go through it now. A tile that is already finished is
   * detected on the first pass a second later. */
  if (prompt.status === 'done') {
    console.log('[AutoFlow Studio] Engine reports done — locating the tile to capture from');
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

  /* How long to watch the tile, by media type.
   *
   * Must stay INSIDE the runner's budget for the same node — 22 minutes for
   * video, 8 for an image. Whichever side gives up first writes the error the
   * user reads, and this side is the one that knows which tile it was watching
   * and what state it was in. A flat 20 minutes here was longer than the
   * runner allows an image, so a slow image was failed by the runner with a
   * vague message while this poller was still watching it happen.
   */
  const isVideoNode = queue?.settings?.mediaType === 'video';
  const watchSeconds = isVideoNode ? 1200 : 360; // 20 min vs 6 min
  const nativeRetry = isVideoNode && queue?.settings?.retryFailedMotion === true ? new MotionNativeRetry() : null;
  let attemptStartedAt = Date.now();
  let retryTile: Element | null = null;
  const currentRetryTile = (): Element | null =>
    retryTile?.isConnected && isVisible(retryTile) ? retryTile : null;

  /* Flow's grid is a virtuoso list: tiles that scroll out of view are removed
     from the document entirely. Our tile is the newest, so it lives at the
     top — and the moment the user scrolls down to look at an earlier clip, or
     the list grows past a screenful, querySelector stops finding it and this
     poller waits out its whole budget on a generation that finished minutes
     ago. Scrolling the output back to the top re-mounts it.

     Not every poll: that would take the grid away from the user each second
     while they are trying to look at their own gallery. Only when the tile has
     actually gone missing, and at most once every ten seconds. */
  const REMOUNT_AFTER_MISSES = 5;
  const REMOUNT_EVERY_MS = 10_000;
  /* How often a thumbnail-only tile is scrolled back into view. Often enough
     to recover inside the grace period, rarely enough that a user reading the
     page is not fighting it. */
  const NUDGE_EVERY_MS = 6_000;
  let missStreak = 0;
  let lastRemountAt = 0;

  /* The rows already on the page. Anything matching this node's prompt that is
     NOT in here is this node's own work.
  
     This is what makes it safe to look for the tile by name straight away.
     The search used to be held back until 45 seconds had passed, because the
     fallback it replaced took the newest card blindly and a re-run of the same
     prompt would be handed the previous run's result — green, plausible, and
     the wrong asset. The wait was a hedge against that.
  
     A hedge is not needed if the question is asked properly. An image node has
     no API state to fall back on, so the DOM is the only signal it has, and
     those 45 seconds were the whole reason a finished still sat there being
     waited for. */
  const rowsBefore = new Set(readGenerationRows().map((r) => r.tileId).filter(Boolean));

  /* How long a tile may show a thumbnail with no playable clip attached before
     we stop waiting for one. Flow normally attaches the source a second or two
     after the poster; 45s is far past that, so reaching it means the source is
     not coming. Taking the tile then is the lesser evil — it is genuinely
     rendered — but the log has to say the clip never became playable, because
     that is why the Last Frame below it will be empty. */
  const THUMBNAIL_GRACE_MS = 45_000;
  /* How long to wait for the clip once the SERVICE says it is finished.
     Then the element is the only thing missing, and giving up produces a
     result with no preview, no playable clip and no last frame — three
     failures downstream from one impatient decision. Measured on a Veo 3.1
     Fast tile: it paints an <img> thumbnail with NO poster and attaches the
     <video> some time later, which is a longer gap than Omni Flash's and
     longer than the blind grace allowed. */
  const CONFIRMED_GRACE_MS = 4 * 60_000;
  let thumbnailOnlySince = 0;
  /* Last time the tracked tile was pulled back into the viewport. Throttled
     the same way the remount is: the point is to give Virtuoso a chance to
     mount the player, not to hold the page still. */
  let lastNudgeAt = 0;
  let nudges = 0;

  /* Ask Flow's backend instead of guessing from pixels.
   *
   * Flow's own frontend polls batchCheckAsyncVideoGenerationStatus every few
   * seconds, and apiHelper reads those responses as they go past — no extra
   * requests, no traffic Google would not otherwise see. It has been driving
   * the queue engine's completion checks all along; this poller, the one the
   * Studio canvas actually runs, was the only path still reading the DOM
   * alone and inferring from what it could see.
   *
   * MEDIA_GENERATION_STATUS_SUCCESSFUL is a positive statement from the
   * service that made the clip. Every DOM signal here is a guess about what a
   * rendering pipeline means — which is why the poster race existed at all.
   *
   * It does not replace the DOM: the tile ELEMENT is still where the pixels
   * live, and the last frame can only be seeked off a real <video>. So the
   * API answers "is it finished" and the DOM answers "where is it". When the
   * interceptor is unavailable — a tab loaded before the extension, a Flow
   * change — apiState stays null and every rule below falls back to the DOM
   * exactly as before. */
  const API_RECHECK_MS = 30_000;
  let lastActiveCheckAt = 0;
  let apiState: string | null = null;
  /* Confirmation, as opposed to apiState's "whatever matched last".
     Set only by this generation's own id on a fresh cache — see
     observeGeneration. apiState falls back to matching the prompt TEXT, and
     re-running a shot leaves an older, finished entry carrying exactly the
     same text; that entry must never be what ends the wait. */
  let apiConfirmsCompleted = false;
  let apiReported = '';
  let failedStreak = 0;

  for (let wait = 0; wait < watchSeconds; wait++) {
    await sleep(1000);
    if (retired()) return;

    // A native Retry replaces the job behind this tile. The old API id/text
    // cache cannot confirm or fail the replacement; track its actual DOM.
    if (isApiAvailable() && !nativeRetry?.attempts) {
      /* Flow only polls while its tab is doing something. Backgrounded or
         idle, the cache goes stale and silence would read as "no news".
         One replay of Flow's own call, at most every 30s — the same cadence
         Flow uses, not a poll of our own on top of it. */
      if (!isCacheFresh() && Date.now() - lastActiveCheckAt > API_RECHECK_MS) {
        lastActiveCheckAt = Date.now();
        await activeStatusCheck(prompt.mediaId ? [prompt.mediaId] : undefined);
      }
      const byId = prompt.mediaId ? findStatusByMediaId(prompt.mediaId) : null;
      const status = byId || findStatusByPromptText(promptText);
      if (status && status.state !== apiState) {
        apiState = status.state;
        logLine(`Flow's API says this generation is ${status.state} (${status.rawStatus})`);
      }
      if (status) apiReported = status.rawStatus;
      apiConfirmsCompleted = observeGeneration(prompt.mediaId, promptText).confirmsCompleted;
      if (!status || status.state !== 'failed') failedStreak = 0;

      /* Failed is worth acting on immediately. The DOM equivalent needs eight
         consecutive failed reads and twenty seconds, and only after Flow has
         painted an error the user can see — the API knows first, and knows
         WHY, which decides whether rewording would even help. */
      if (status && status.state === 'failed') {
        /* A media id is this generation and nothing else. A text match is a
           guess, and re-running the same shot leaves an older failed entry in
           the cache carrying identical text — acting on that would fail the
           node that is at this moment rendering correctly. So a text-matched
           failure has to survive a second look; an id-matched one is fact. */
        failedStreak = byId ? 2 : failedStreak + 1;
        if (failedStreak < 2) continue;
        const why = classifyError(status.rawStatus, status.failureReason);
        // Motion waits for its failed tile and uses the Retry action Flow
        // offers, without changing its prompt or references.
        if (!nativeRetry) {
          sendStudioError(nodeId, why === 'safety'
            ? `Flow refused this prompt on safety grounds (${status.failureReason || status.rawStatus}). `
              + 'Review the prompt and references.'
            : `Flow reported ${status.rawStatus}${status.failureReason ? ` — ${status.failureReason}` : ''}`);
          return;
        }
      }
    }

    // Find the tracked tile in DOM
    let trackedTile: Element | null = currentRetryTile();
    for (const id of trackedTileIds) {
      if (trackedTile) break;
      // Primary: the grid tile
      const el = findTileByIdentity(id);
      if (el && isVisible(el)) { trackedTile = el; break; }

      // Detail View fallback: when the Detail View is open, Flow unmounts the
      // grid and shows history-step elements in the sidebar instead. The tile
      // id appears as part of the element's DOM id.
      const historyStep = document.querySelector(`div[id="history-step-${id}"]`);
      if (historyStep && isVisible(historyStep)) { trackedTile = historyStep; break; }
    }

    // Fallback path (no engine tile IDs): follow a tile we saw generating
    if (!trackedTile && fallbackTileId) {
      const el = findTileByIdentity(fallbackTileId);
      if (el && isVisible(el)) trackedTile = el;
    }
    if (!trackedTile && trackedTileIds.length === 0) {
      const allCards = findAssetCards().filter(el => isVisible(el));
      const generatingCard = allCards.find(c => getStudioTileState(c) === 'generating');
      if (generatingCard) {
        trackedTile = generatingCard;
        fallbackTileId = generatingCard.getAttribute('data-tile-id')
          || flowTileIdentity(generatingCard) || null;
        console.log(`[AutoFlow Studio] Locked onto generating tile ${fallbackTileId || '(no id)'}`);
      } else if (allCards.length > 0) {
        /* Nothing ever showed as generating. The render may genuinely have
           finished between submit and our first poll — or the submit never
           landed at all, and the grid is showing work from an earlier node or
           an earlier day.

           This used to take allCards[0], the newest card, without checking
           whose it was. When a submit had silently failed that returned the
           previous clip as this node's result, and the run went green with
           the wrong video in it — invisible until someone watched the output.

           Flow prints each row's prompt beside its media, so ask for ours by
           name instead. No match means we never submitted, which is worth
           saying out loud. */
        /* Ours FIRST, with everything that predates this node excluded, so a
           tile that was already on the page cannot be mistaken for this
           node's work however similar its prompt is. Only if nothing new
           carries our prompt does the old, looser question get asked. */
        /* An earlier attempt's failure is never ours, even after 45 seconds:
           it is the one stale row whose prompt matches by construction. */
        const earlierFailure = (row: { element: Element }) => isPriorFailure(row.element);
        const mine = findRowForPrompt(promptText, rowsBefore, earlierFailure)
          || (wait > 45 ? findRowForPrompt(promptText, undefined, earlierFailure) : null);
        /* Before the old 45-second mark, only a row that was not already on
           the page when this node started counts. After it, the run has waited
           long enough that a stale match is better than nothing — and by then
           anything still matching is almost certainly ours anyway. */
        const isNew = !!mine && (!rowsBefore.has(mine.tileId) || wait > 45);
        if (mine && isNew) {
          trackedTile = findTileByIdentity(mine.tileId) || mine.element;
          fallbackTileId = mine.tileId;
          console.log(
            `[AutoFlow Studio] Matched this node's prompt to tile ${mine.tileId}` +
            `${mine.model ? ` (${mine.model}${mine.duration ? `, ${mine.duration}` : ''})` : ''}`
          );
        } else if (!mine && wait > 75) {
          throw new Error(
            'This generation never appeared in Flow — no tile on the page carries this ' +
            'node\'s prompt. The submit did not land; check the Flow tab and run again.'
          );
        }
      }
    }

    if (!trackedTile) {
      missStreak++;
      /* Virtualised away, most likely. Bring the newest tiles back into the
         list and try again next second. */
      if (missStreak >= REMOUNT_AFTER_MISSES && Date.now() - lastRemountAt > REMOUNT_EVERY_MS) {
        lastRemountAt = Date.now();
        const scroller = findOutputScroller();
        logLine(
          `Tile ${trackedTileIds[0] || fallbackTileId || '(no id yet)'} is not in the page `
          + `after ${missStreak}s`
          /* The most useful sentence this poller can print: the service says
             the work is done and the only thing missing is the element. */
          + `${apiState === 'completed' ? ' — but Flow\'s API says it is finished' : ''}`
          + ` — ${scroller
              ? 'scrolling the output to the top, where the newest tile is'
              : 'and there is no scrollable output to bring it back'}`
        );
        if (scroller) await scrollOutputToTop();
      } else if (wait % 10 === 0) {
        logLine(`Tile not in DOM yet (wait=${wait}s)...`);
      }
      continue;
    }
    if (missStreak) {
      logLine(`Tile is back in the page after ${missStreak}s`);
      missStreak = 0;
    }

    // ── Studio-specific tile state detection ──
    // Priority: GENERATING first (a generating tile shows a real blurred
    // <img> + % badge, which a completion-first check misreads as done)
    let state = getStudioTileState(trackedTile, isVideoNode);

    /* Flow's own failed tile, and whether it is this attempt's. One that was
       on the page before this node submitted belongs to an earlier attempt
       and says nothing about this one. */
    const ownFailure = !!flowErrorTile(trackedTile) && !isPriorFailure(trackedTile);
    if (isPriorFailure(trackedTile)) state = 'unknown';
    nativeRetry?.observe(state);
    // The initial submission's age must not make a just-retried tile ready.
    if (nativeRetry?.attempts && state === 'completed' && !motionRetryReady(trackedTile, attemptStartedAt)) {
      state = 'generating';
    }
    // Keep ownership of the same live tile even when Retry changes its media id.
    if (nativeRetry) retryTile = trackedTile;

    // CRITICAL: Prevent early false-completion!
    // 1. If Flow's API says the video is still generating or queued, the video is NOT completed.
    /* THUMBNAIL_ONLY is not "still working". Since mid-October Flow's project
       media list (rpc Zzl0ze) gives EVERY clip only its /asb/ poster, finished
       ones included; the signed /video/ URL arrives only in the per-clip reply
       (as29s) that Flow fetches when the tile is hovered. Counting the poster
       as "generating" stopped the nudge below, so the tile was never hovered,
       the player never mounted, and a finished clip read as generating until
       the 22-minute limit (Motion, 2026-10-16, "the video is there"). A tile
       that is really rendering still shows its % or blur, which
       getStudioTileState reads as generating whatever the list says. */
    const serviceStillWorking = (apiState === 'generating' || apiState === 'queued')
      && apiReported !== 'THUMBNAIL_ONLY';
    if (state === 'failed' && apiConfirmsCompleted) {
      /* The service holds a finished clip under this generation's own id, so
         whatever failed in the grid is not this generation. The generating
         branch below takes the clip from the record. */
      state = 'generating';
    } else if (state === 'completed' && serviceStillWorking) {
      state = 'generating';
    } else if (state === 'failed' && serviceStillWorking && !ownFailure) {
      /* Not for Flow's own failed tile.
       *
       * On flow.google.com the API cannot say "failed" at all — flowBatch's
       * inferState reads only whether media has arrived, so `generating`
       * means "no media yet". A refused generation never gets media, so it
       * reads `generating` for ever, and this guard turned every refusal into
       * a twenty-minute wait: the Motion panel sat on "Generating in Flow…"
       * beside a tile that said "Failed — This generation might violate our
       * policies" (2026-10-01). Flow's error component is not a word in a
       * paragraph; it is the page stating the outcome. */
      /* The same guard, for the other direction — and it was missing.
       *
       *   22:36:51  Waiting 15s — tile unknown is failed, API generating
       *
       * Reported on an eight-shot run: one clip "failed" while Flow's own API
       * said it was still rendering, and because every shot is chained to the
       * last frame of the one before it, the whole rest of the episode went
       * red behind it with "Upstream dependency failed".
       *
       * The DOM reads failed for reasons that have nothing to do with the
       * generation. Tile state is decided by scanning text for words like
       * "failed", "rejected", "blocked", "unavailable" and "capacity" — and
       * Flow prints the PROMPT beside the media, so a shot whose script says
       * a hunter rejected the shelter can read as a rejected generation. The
       * tile id here was `unknown`, which means the element being scanned was
       * not even pinned down to the clip.
       *
       * A service that says `generating` is stating a fact about the job. It
       * outranks a word found in a paragraph the user wrote. When the render
       * genuinely fails the API says so, and the failure is taken then.
       *
       * Deliberately NOT a blanket "ignore DOM failures": with no API entry,
       * apiState is empty, serviceStillWorking is false, and the DOM remains
       * the only signal there is. */
      state = 'generating';
    } else if (state === 'completed' && isVideoNode && wait < 10 && !apiConfirmsCompleted) {
      // 2. Video rendering on Google Flow cannot legitimately finish in < 10 seconds
      // without API confirmation. Early 'completed' at wait < 10s is a false alarm from old DOM nodes.
      /* `apiConfirmsCompleted`, not `apiState !== 'completed'`. The old test
         let ANY 'completed' through, including one matched only on prompt
         text — which, on a re-run of the same shot, is the previous
         generation saying it finished. That is precisely how a stale tile
         got accepted as the new result inside the first ten seconds. */
      state = 'generating';
    }

    /* Say WHY it is still waiting, every fifteen seconds.
       A node ran for twenty minutes and the whole of Diagnostics said "Tile
       not in DOM yet" — and an 'unknown' tile said nothing at all, so the
       most confusing state was also the silent one. The state name, Flow's
       own badge and the tile id together separate "still rendering" from
       "watching the wrong tile" from "watching a tile Flow has abandoned". */
    if (wait > 8 && wait % 15 === 0) {
      const pct = extractTileProgress(trackedTile);
      logLine(
        `Waiting ${wait}s — tile ${tileLabel(trackedTile)} `
        + `is ${state}${pct !== null ? `, Flow says ${pct}%` : ''}`
        + `, API ${apiState || (isApiAvailable() ? 'has no entry for this prompt' : 'unavailable')}`
        + ` [adapter ${ADAPTER_BUILD}]`
      );
    }

    /* A thumbnail with no clip behind it. Keep waiting for the source to
       attach — that is the whole point of naming this state — but never
       forever, and say so out loud when the wait is given up. */
    /* The signed clip URL for THIS generation, when the service has one.
       Only a real /video/ URL counts: a record also carries its poster and,
       on a Frames run, the two input stills — none of which is the clip. */
    const apiVideoUrl = (): string => {
      if (nativeRetry?.attempts) return '';
      if (!isVideoNode) return '';
      const match = prompt.mediaId
        ? findStatusByMediaId(prompt.mediaId)
        : findStatusByPromptText(promptText);
      const url = match?.mediaUrl || '';
      return url.includes('/video/') ? url : '';
    };

    if (state === 'thumbnail-only') {
      if (!thumbnailOnlySince) thumbnailOnlySince = Date.now();
      const held = Date.now() - thumbnailOnlySince;
      /* The API settles this one properly. A poster with no clip means either
         "still rendering" or "rendered, source not attached yet", and the DOM
         cannot tell those apart — which is why the grace period is a guess.
         When the service says it is still working, the guess is not needed and
         must not expire: a long render would otherwise be declared finished
         at 45s and hand the next node an empty frame. */
      /* Three different waits, because three different things are known.
           still working  — no clock at all; the render is not done.
           finished       — the clip EXISTS and the page is behind. Worth
                            minutes, because what is missing is a DOM element
                            and not a generation.
           nothing known  — the blind grace, unchanged. */
      const grace = apiState === 'completed' ? CONFIRMED_GRACE_MS : THUMBNAIL_GRACE_MS;

      /* If the service has already handed us a playable URL, stop waiting for
         the page to catch up.
       *
       *   23:02:51  Flow's API says this generation is completed (VIDEO_PRESENT)
       *   23:03:01  Waiting 30s — tile 9287d711 is thumbnail-only, API completed
       *   …          45s, 60s, 75s, 90s, 105s, 120s, 135s, 150s
       *
       * VIDEO_PRESENT means the record carries a signed /video/ URL for this
       * generation. The clip exists; what is missing is a <video> element in a
       * virtualised grid. Waiting minutes for the DOM to mount one — and then
       * giving up with "it will have no preview and nothing chained from it
       * will have a last frame" — throws away a finished video we are already
       * holding the address of. */
      const apiUrl = apiVideoUrl();
      if (apiUrl && !serviceStillWorking) {
        logLine(
          `Flow's API already has the finished clip after ${Math.round(held / 1000)}s of `
          + 'thumbnail — taking it from there rather than waiting for the grid to mount a player.'
        );
        state = 'completed';
      } else if (serviceStillWorking || held < grace || nativeRetry?.attempts) {
        if (wait % 5 === 0) sendStudioProgress(nodeId, Math.min(97, 40 + Math.floor(wait / 12)));
        /* The reason most of these waits used to expire.
           Flow's grid is a Virtuoso list, so a tile that has scrolled out of
           view renders as a poster and never gets a <video> — and every clip
           generated after this one pushes it further out. Waiting cannot fix
           that; the tile has to be on screen for the player to mount. So bring
           it back, on the same throttle as the remount, and let the next poll
           read the real state. */
        if (!serviceStillWorking && Date.now() - lastNudgeAt > NUDGE_EVERY_MS) {
          lastNudgeAt = Date.now();
          nudges += 1;
          if (await bringTileIntoView(trackedTile)) {
            logLine('Tile was off screen — scrolled it back and the clip attached');
          }
        }
        continue;
      } else {
        /* An `else`, because this is the give-up. It used to sit after the
           chain, so the branch above — the one that SUCCEEDS, by taking the
           finished clip from the API — fell straight into it and logged the
           failure too:

             00:14:25  Flow's API already has the finished clip after 0s of thumbnail…
             00:14:25  Tile has shown a thumbnail for 0s … 0 attempts … no last frame.
             00:14:26  Clip attached once the tile was scrolled into view
             00:14:27  Last frame captured (30KB) from the downloaded clip

           "0s" and "0 attempts" are the tell: nothing waited and nothing was
           given up on. The run worked. Only the log said otherwise — and it
           said it in the words a user reads as the node having failed. */
        logLine(
          `Tile has shown a thumbnail for ${Math.round(held / 1000)}s without ever attaching a `
          + `playable clip${apiState ? ` (API: ${apiReported || apiState})` : ''}, including `
          + `${nudges} attempt${nudges === 1 ? '' : 's'} at scrolling it back into view — taking `
          + 'it as finished. It will have no preview and nothing chained from it will have a '
          + 'last frame.'
        );
        state = 'completed';
      }
    } else if (thumbnailOnlySince) {
      logLine(`Clip attached after ${Math.round((Date.now() - thumbnailOnlySince) / 1000)}s of thumbnail`);
      thumbnailOnlySince = 0;
    }

    if (state === 'completed') {
      if (serviceStillWorking) {
        continue;
      }
      /* One last look, at the only moment that matters.
         Everything below reads the tile ONCE — the last frame especially,
         because it has to be captured while the tile is definitely here. If
         the player is not mounted at this instant there is no second chance:
         the reference is empty, and the node chained below fails for want of
         it. So if this is a clip and there is no <video>, put the tile on
         screen and look again before committing to that. */
      if (isVideoNode && !trackedTile.querySelector('video')) {
        if (await bringTileIntoView(trackedTile)) {
          logLine('Clip attached once the tile was scrolled into view');
        }
      }
      // A retried placeholder must never reach frame extraction, even if a
      // grace period or recycled DOM element suggested completion earlier.
      if (nativeRetry?.attempts && !motionRetryReady(trackedTile, attemptStartedAt)) {
        sendStudioProgress(nodeId, Math.min(97, 40 + Math.floor(wait / 12)));
        continue;
      }
      logLine(`Tile completed! (id=${tileLabel(trackedTile)})`);
      /* What the tile is actually called, not what an absent attribute says.
         This was '' for every result on this Flow — and the canvas stores it,
         forwards it as referenceImageIds, and looks the tile up by it when a
         later node needs this one's picture. An empty name resolves to
         nothing, so the second look below re-read the stale element and the
         reference lookup could only fail. */
      const tileId = trackedTile.getAttribute('data-tile-id')
        || trackedTile.id
        || flowTileIdentity(trackedTile);
      let mediaUrl = extractTileMediaUrl(trackedTile, isVideoNode);
      let previewSrc = extractTilePreviewSrc(trackedTile);

      // Detail View / API fallback: if mediaUrl is missing for a video node
      if (isVideoNode && !mediaUrl && !nativeRetry?.attempts) {
        const apiMatch = prompt.mediaId
          ? findStatusByMediaId(prompt.mediaId)
          : findStatusByPromptText(promptText);
        /* The URL the service actually issued, first.
           This went straight to labs.google's media.getMediaUrlRedirect —
           an endpoint flow.google.com does not serve at all, so the fallback
           produced a URL that could never load. On this site a media URL
           cannot be built from an id: it is signed and carries an Expires, so
           the only working one is the one the status response came with. */
        if (apiMatch?.mediaUrl && apiMatch.mediaUrl.includes('/video/')) {
          mediaUrl = apiMatch.mediaUrl;
          logLine('Took the clip URL from the API — the grid never mounted a player for it.');
        } else if (apiMatch?.mediaId) {
          mediaUrl = `https://labs.google/fx/api/trpc/media.getMediaUrlRedirect?name=${apiMatch.mediaId}`;
        } else {
          // Check detail view video element on page
          const mainVideo = document.querySelector('main video, [class*="detail"] video, div[role="main"] video, video[src]') as HTMLVideoElement | null;
          if (mainVideo) {
            mediaUrl = mainVideo.currentSrc || mainVideo.src || mainVideo.querySelector('source')?.getAttribute('src') || '';
          }
        }
      }

      await sendStudioResult(nodeId, tileId, mediaUrl, previewSrc, trackedTile,
        nativeRetry?.attempts ? undefined : promptText, prompt.mediaId, isVideoNode);
      return;
    }

    if (state === 'generating') {
      /* The service outranks the DOM once it says the clip exists.
       *
       * Every other disagreement between the two is reconciled somewhere:
       * a DOM `completed` while the API is still working is pushed back to
       * generating, a DOM `failed` likewise, and a `thumbnail-only` whose
       * record carries a signed URL is taken from the record. This pair —
       * DOM generating, API completed — had nothing, so it waited out the
       * full twenty minutes:
       *
       *   05:14:57  Waiting 90s  — tile 34142166 is generating, API completed
       *   05:15:13  Waiting 105s — tile 34142166 is generating, API completed
       *   05:15:28  Waiting 120s — tile 34142166 is generating, API completed
       *
       * VIDEO_PRESENT means the record holds a signed /video/ URL for this
       * generation. Waiting for a grid to agree about a clip we already have
       * the address of is time spent on nothing.
       *
       * Held for ten seconds first, so a tile that is genuinely mid-render and
       * a record that has only just flipped are not raced. */
      const doneUrl = apiVideoUrl();
      if (doneUrl && apiConfirmsCompleted && !serviceStillWorking && wait > 10) {
        logLine(
          `Flow's API has the finished clip while the tile still reads as generating `
          + `after ${wait}s — taking it from the record rather than waiting for the grid.`
        );
        state = 'completed';
      }
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
      /* Flow's own failed tile needs three reads, only to rule out a frame
         caught mid-render; a refusal can land seconds after submit. A failure
         read from words keeps the slower bar, because words can come from a
         prompt. */
      if (ownFailure ? consecutiveFailed >= 3 : (consecutiveFailed >= 8 && wait > 20)) {
        if (nativeRetry && ownFailure) {
          const decision = nativeRetry.step(trackedTile, () => isCurrentRun(nodeId, run));
          if (decision.action === 'clicked') {
            logLine(`Motion: clicked Flow Retry ${nativeRetry.attempts}/${MOTION_NATIVE_RETRIES}. Retries may use Flow credits.`);
            sendStudioProgress(nodeId, 40);
            attemptStartedAt = Date.now();
            thumbnailOnlySince = 0;
            lastNudgeAt = 0;
            nudges = 0;
            missStreak = 0;
            apiState = null;
            apiReported = '';
            apiConfirmsCompleted = false;
            failedStreak = 0;
            consecutiveFailed = 0;
            trackedTileIds.length = 0;
            fallbackTileId = null;
            prompt.mediaId = undefined;
          }
          if (decision.action !== 'stop') continue;
          sendStudioError(nodeId, `${flowFailureMessage(trackedTile)} ${decision.reason}`.trim());
          return;
        }
        // Surface Flow's own wording ("Oops, something went wrong!",
        // a policy message, …) — "marked as failed" told the user nothing
        // about whether to retry, reword, or wait.
        sendStudioError(nodeId, (ownFailure && flowFailureMessage(trackedTile))
          || `Flow: ${extractTileErrorText(trackedTile) || 'generation failed'}`);
        return;
      }
    } else {
      consecutiveFailed = 0;
    }
  }

  // Stopped watching, which is not the same as the generation having failed.
  // The number comes from watchSeconds so the message cannot drift from it.
  // If we spent that budget never seeing the tile, say that rather than
  // implying we watched it: the two need completely different fixes.
  sendStudioError(nodeId,
    missStreak >= REMOUNT_AFTER_MISSES
      ? `Stopped tracking after ${Math.round(watchSeconds / 60)} minutes — this node's tile was `
        + `not in the page for the last ${missStreak}s and scrolling the output to the top did `
        + 'not bring it back. Check the Flow tab before re-running this node.'
      : `Stopped tracking after ${Math.round(watchSeconds / 60)} minutes. The generation may `
        + 'still be running — check the Flow tab before re-running this node.');
}

/** Flow's own failure wording from a failed tile, trimmed for display */
function extractTileErrorText(tile: Element): string {
  const raw = (tile.textContent || '').replace(/\s+/g, ' ').trim();
  if (!raw) return '';
  // Drop the leading "Failed" heading so the message isn't "failed — Failed …"
  let body = raw;
  for (const prefix of FLOW_STRINGS.generationFailed) {
    if (body.toLowerCase().startsWith(prefix.toLowerCase())) {
      body = body.slice(prefix.length).replace(/^[\s:—-]+/, '');
      break;
    }
  }
  body = body.trim() || raw;
  return body.length > 160 ? `${body.slice(0, 160)}…` : body;
}



async function sendStudioResult(
  nodeId: string,
  tileId: string,
  mediaUrl?: string,
  previewSrc?: string,
  tile?: Element | null,
  promptText?: string,
  mediaId?: string,
  /* The NODE's media type — the same argument extractTileMediaUrl already
     takes, and for the same reason. Everything below used to infer it from
     the page, which on Flow's library is never a question the page can
     answer: it holds every clip the project has ever made. */
  expectVideo = false,
  /* The run this result belongs to, echoed so the runner can tell it from a
     later run of the same node — see StudioExecution. */
  execId?: string,
): Promise<void> {
  // If mediaUrl was not passed or is empty, try resolving from API
  if (!mediaUrl && (mediaId || promptText)) {
    const apiMatch = mediaId
      ? findStatusByMediaId(mediaId)
      : (promptText ? findStatusByPromptText(promptText) : null);
    if (apiMatch?.mediaId) {
      mediaUrl = `https://labs.google/fx/api/trpc/media.getMediaUrlRedirect?name=${apiMatch.mediaId}`;
    }
  }

  // Flow's tile URLs are page-scoped (blob:) or need the page's auth context,
  // so they cannot be rendered from the chrome-extension:// Studio page.
  // Convert to self-contained data URLs here, where fetch still works.
  const stills = await buildStudioStills(mediaUrl || previewSrc || '');
  let previewUrl = stills.preview;

  /* Videos rarely carry a poster, so a frame is drawn off the <video> itself.
     Attempted here and again below, because at THIS point it cannot work:
     Flow renders its tiles with preload="none", so readyState is 0 and
     videoWidth is 0, and captureVideoFrame's first line returns '' on exactly
     that. The element has to be loaded first — which is what the end-frame
     capture further down does, and what this never learned to do. */
  /* Only a clip looks for a player, and the document-wide fallback below is
     why: `document.querySelector('… video')` matches ANY video in the
     library, so on an image node it returned a player belonging to a
     different generation — and that node then downloaded its own JPEG through
     the clip path ("Asked for a clip and got image/jpeg …"), reported the
     result as "Last frame captured from the downloaded clip", and was one
     failed still away from seeking a frame out of someone else's video. */
  let videoEl = expectVideo ? (tile?.querySelector('video') || null) : null;
  if (expectVideo && !videoEl) {
    /* Identified before it is used, which it never was.
     *
     * Read off flow.google.com on 2026-09-17, in a project with one finished
     * clip: a video tile mounts no <video> at all until the pointer crosses
     * it, and the player it then mounts is inside `main`. So `main video`
     * does not mean "the clip open in detail view" — it means whichever tile
     * the mouse last passed over. And this branch is only reached when OUR
     * tile has no player, so by construction the element it finds belongs to
     * something else.
     *
     * The scene editor, which is the detail view this fallback was written
     * for, turned out to render into <canvas class="video-canvas"> and to
     * hold no <video> whatever — so on this build the fallback cannot reach
     * the thing it exists for, and can only reach the thing it must not
     * touch. It is kept rather than deleted because that is one build on one
     * day; what it is not allowed to do is guess. */
    const pageVideo = document.querySelector('main video, [class*="detail"] video, div[role="main"] video, video') as HTMLVideoElement | null;
    const candidate = pageVideo
      ? (pageVideo.getAttribute('src') || pageVideo.currentSrc
        || pageVideo.querySelector('source')?.getAttribute('src') || '')
      : '';
    /* Every name this generation answers to. The tile's own thumbnail is the
       one that usually decides it: a video tile has no data-media-id, and its
       player's src is that same /asb/ token with a rendition suffix. */
    const knownBy = [mediaUrl, previewSrc, mediaId, tile ? extractTilePreviewSrc(tile) : ''];
    if (candidate && isSameGeneration(candidate, knownBy)) {
      videoEl = pageVideo;
      logLine('This tile has no player of its own; using the one open on the page, '
        + 'which is this same generation.');
    } else if (candidate) {
      logLine('A clip is mounted on this page but it is a different generation — not '
        + 'reading a frame from it. Taking one would have handed the next shot '
        + "someone else's ending, and said nothing.");
    }
  }

  if (!previewUrl && videoEl) {
    previewUrl = captureVideoFrame(videoEl);
  }

  // Ship the playable video itself when it's small enough to travel
  /* One branch. There were two, and they were identical — the second guarded
     by `!previewVideoUrl`, which is unconditionally true three lines after
     `let previewVideoUrl = ''`. So every node fetched its media expecting a
     video, image nodes included. */
  let previewVideoUrl = '';
  if (expectVideo && mediaUrl) {
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
  /* The downloaded file first: it does not care where the tile is on the
     page, what its preload says, or whether the virtual list has recycled it.
     The on-page capture stays as the fallback for a tile whose media URL we
     could not fetch. */
  /* `fromVideo`, not `videoEl`. Two different claims were riding on one test.
     A frame may be treated as the END of the clip only if it was decoded out
     of the clip file — so when the download turned out to be a still (a
     poster URL, a stale link), this handed pickReferenceStill the OPENING
     frame under the one name that bypasses its poster rule. And a clip whose
     tile never mounted a player still has a perfectly good last frame in the
     bytes we just decoded; whether the grid drew it is beside the point. */
  const fromFile = (expectVideo && stills.fromVideo) ? stills.reference : '';
  let referenceUrl = pickReferenceStill({
    fromFile,
    endFrame: (videoEl && !fromFile) ? await captureVideoEndFrame(videoEl, logLine) : '',
    posterStill: stills.reference,
    // For a clip the poster is the OPENING frame, so it must not stand in for
    // a failed capture — see pickReferenceStill. Read off the node, not off
    // the page: `!!videoEl` let a clip with no mounted player answer "not a
    // video", which switched that protection off for precisely the tiles that
    // need it most.
    isVideo: expectVideo,
  });
  if (videoEl && !referenceUrl) {
    logLine(`Last frame: nothing captured from this clip (duration ${
      isFinite(videoEl.duration) ? `${videoEl.duration.toFixed(1)}s` : 'unknown'}, readyState ${
      videoEl.readyState}) — anything chained from it will have no reference`);
    console.warn(
      '[AutoFlow Studio] No end frame captured for this clip. Anything chained ' +
      'from it will report a missing reference rather than silently restarting ' +
      'from the opening frame.'
    );
  }

  if (videoEl && referenceUrl) {
    logLine(`Last frame captured (${Math.round(referenceUrl.length / 1024)}KB)${
      fromFile ? ' from the downloaded clip' : ' off the page'}`);
  }

  /* The preview, now that there is something to draw.
     captureVideoEndFrame has just loaded the element and put the playhead
     back to where it found it, so the same call that returned nothing above
     returns the opening frame here. This is why a clip could finish, hand its
     last frame to the node below, and still show "Preview unavailable" — the
     load was added to one of the two callers and not the other.

     Failing that, the end frame is a far better thumbnail than none. It is
     the wrong end of the clip and it is a picture of the right clip. */
  if (!previewUrl && videoEl) {
    previewUrl = captureVideoFrame(videoEl) || referenceUrl;
    if (previewUrl) {
      logLine(`Preview captured (${Math.round(previewUrl.length / 1024)}KB)`);
    }
  }

  /* A clip that finished and handed over nothing is not a finished node.
   *
   * Reported repeatedly and correctly: a node goes green, says "Preview
   * unavailable", carries no last frame, and everything chained below it
   * fails — while the clip sits in Flow, rendered perfectly. Reporting that
   * as success is what makes it look like the node skipped itself.
   *
   * So it does not report it. The tile is brought back — scrolling the output
   * to the top, which is where a just-finished clip is, then into view — and
   * everything is read again from whatever is there now. Only if that also
   * comes back empty does the node fail, loudly, with the reason. */
  /* Not `videoEl &&`. That read as "this is a clip" only by accident —
     videoEl came from a document-wide lookup that matched any player on the
     page — and once that was made honest, image nodes fell out of this guard
     and began reporting success carrying nothing: no preview on the node, and
     no reference for the clip chained below, which then failed with "nothing
     to continue from". A node that hands over nothing is not a finished node,
     whatever it was asked to make. */
  if (!previewUrl && !referenceUrl) {
    logLine(`Nothing captured from this ${expectVideo ? 'clip' : 'image'} — `
      + 'scrolling back to it and trying once more');
    await scrollOutputToTop();
    const again = findTileByIdentity(tileId);
    const retryTile = again || tile;
    if (retryTile) await bringTileIntoView(retryTile);

    const v2 = retryTile?.querySelector('video') as HTMLVideoElement | null;
    if (expectVideo && v2) {
      referenceUrl = await captureVideoEndFrame(v2, logLine);
      previewUrl = captureVideoFrame(v2) || referenceUrl;
    } else if (retryTile) {
      /* An image has no player to read, and did not need one. What it was
         missing is a tile on screen and laid out — which is what the scroll
         above has just arranged, and what findLargestImgSrc needs before it
         can measure anything. So ask the tile for its media again. */
      const url2 = extractTileMediaUrl(retryTile, expectVideo)
        || extractTilePreviewSrc(retryTile);
      if (url2) {
        const s2 = await buildStudioStills(url2);
        previewUrl = s2.preview;
        if (!expectVideo || s2.fromVideo) referenceUrl = referenceUrl || s2.reference;
      }
    }

    if (!previewUrl && !referenceUrl) {
      /* One phrase, one literal. It was split as "…could read " + "nothing
         from it…", which reads identically and is not searchable — the test
         that pins this message matches across the join. */
      logLine(`The ${expectVideo ? 'clip' : 'image'} is on Flow but this node could read nothing from it, even after `
        + 'scrolling back. Failing rather than reporting a result with no data in it.');
      chrome.runtime.sendMessage({
        type: 'STUDIO_NODE_ERROR',
        payload: {
          nodeId,
          error: expectVideo
            ? 'The clip generated on Flow but no frame could be read from it. '
              + 'Open the Flow tab to check it, then retry this node.'
            : 'The image generated on Flow but could not be read off the page. '
              + 'Open the Flow tab to check it, then retry this node.',
        },
      }).catch(() => {});
      return;
    }
    logLine('Recovered on the second look.');
  }

  try {
    chrome.runtime.sendMessage({
      type: 'STUDIO_NODE_RESULT',
      payload: {
        nodeId,
        ...(execId ? { execId } : {}),
        tileId,
        /* Flow's own id for this generation, when the interceptor bound one.
           It is the same evidence the queue extension reports as a submission
           — proof that Flow received this prompt — and Studio's Flow nodes
           have to land in that number too, or the two products count the same
           resource differently. */
        mediaId: mediaId || '',
        /* Could this page see itself when the result landed? Only the page
           knows, and the worker cannot ask once the tab is gone. It separates
           "hidden runs do not submit" from "hidden runs submit fine and
           nobody collected" — the measurement step 1 asks for. */
        hidden: (() => { try { return document.hidden; } catch { return undefined; } })(),
        imageUrl: mediaUrl || '',
        thumbnailUrl: mediaUrl || '',
        previewUrl: previewUrl || stills.preview || '',
        previewVideoUrl,
        referenceUrl: referenceUrl || (expectVideo ? '' : stills.reference) || '',
      },
    }).catch(() => {});
  } catch {}
}

/** Fetch a video URL into a data URL so the Studio page can play it.
    Capped — oversized clips fall back to the poster frame only. */
const VIDEO_PREVIEW_MAX_BYTES = 15 * 1024 * 1024;

async function buildStudioVideoData(url: string): Promise<string> {
  if (!url || url.startsWith('data:')) return url.startsWith('data:video') ? url : '';

  /* Here first, because it is free when it works — a clip still served from
     flow.google.com/asb/ is same-origin with this page. */
  try {
    const resp = await fetch(url);
    if (resp.ok) {
      const blob = await resp.blob();
      if (!blob.type.startsWith('video/')) {
        /* Say so. This returned '' in silence, and that silence is what made
           the thumbnail-as-clip bug above invisible for as long as it was:
           the node simply had no video and nothing anywhere said why. */
        logLine(`Asked for a clip and got ${blob.type || 'an unknown type'} from ${
          url.slice(0, 80)} — this is not the generated video.`);
        return '';
      }
      if (blob.size > VIDEO_PREVIEW_MAX_BYTES) {
        logLine(`Clip is ${Math.round(blob.size / 1024 / 1024)}MB — too large to preview inline. `
          + 'The node keeps the Flow link.');
        return '';
      }
      return `data:${blob.type};base64,${await blobToRawBase64(blob)}`;
    }
  } catch { /* cross-origin, almost certainly — fall through */ }

  /* The worker, which is not bound by the page's CORS.
   *
   * Flow moved where it serves a finished clip from:
   *
   *   was   https://flow.google.com/asb/<token>=mm,22,15    same origin
   *   now   https://flow-content.google/video/<uuid>?Expires=…&Signature=…
   *
   * In MV3 a content script's cross-origin fetch follows the PAGE's CORS
   * rules, so the request above cannot succeed for the second form however
   * many permissions the extension holds. It failed silently, returned '',
   * and every finished clip reached the canvas as a still with "open in Flow
   * to play" beneath it — the clip itself was fine and sitting at a URL we
   * were holding.
   *
   * The worker fetches with extension privileges. flow-content.google had to
   * be added to host_permissions for that; it was missing, which is the other
   * half of the same bug. */
  try {
    const res: any = await chrome.runtime.sendMessage({
      type: 'STUDIO_FETCH_MEDIA',
      payload: { url, maxBytes: VIDEO_PREVIEW_MAX_BYTES },
    });
    if (res?.dataUrl && String(res.dataUrl).startsWith('data:video')) return res.dataUrl;
    logLine(`Could not inline the clip for preview: ${res?.error || 'no data came back'}. `
      + 'The node keeps the Flow link, and the clip itself is unaffected.');
  } catch (e: any) {
    logLine(`Could not inline the clip for preview: ${e?.message || e}.`);
  }
  return '';
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
/** `fromVideo` answers the only question the caller cannot: was `reference`
    decoded from a clip — and therefore its ending — or is it a still that
    happens to be at the URL a clip was expected at? */
/**
 * The bytes at `url`, from the page when it can and from the worker when it
 * cannot.
 *
 * The page first because it is free when it works — a clip still served from
 * flow.google.com/asb/ is same-origin. The worker after, because a finished
 * clip now lives at https://flow-content.google/video/<uuid>, and in MV3 a
 * content script's cross-origin fetch follows the PAGE's CORS rules: that
 * request cannot succeed here however many permissions the extension holds.
 * Only the worker, which is not bound by them, can retrieve it.
 *
 * buildStudioVideoData has done this for a while. buildStudioStills did not,
 * so the preview and the reference still came back empty for precisely the
 * clips the API fallback exists to rescue — and the node reported "the clip
 * generated on Flow but no frame could be read from it" about a clip sitting
 * in Flow, rendered perfectly.
 */
async function fetchMediaBlob(url: string, maxBytes: number): Promise<Blob | null> {
  try {
    const resp = await fetch(url);
    if (resp.ok) return await resp.blob();
  } catch { /* cross-origin, almost certainly — fall through */ }

  try {
    const res: any = await chrome.runtime.sendMessage({
      type: 'STUDIO_FETCH_MEDIA',
      payload: { url, maxBytes },
    });
    if (res?.dataUrl) return await (await fetch(res.dataUrl)).blob();
    logLine(`Could not read the media for this node: ${res?.error || 'no data came back'}.`);
  } catch (e: any) {
    logLine(`Could not read the media for this node: ${e?.message || e}.`);
  }
  return null;
}

async function buildStudioStills(
  url: string
): Promise<{ preview: string; reference: string; fromVideo: boolean }> {
  const none = { preview: '', reference: '', fromVideo: false };
  if (!url) return none;
  if (url.startsWith('data:')) return { preview: url, reference: url, fromVideo: false };

  try {
    const blob = await fetchMediaBlob(url, VIDEO_PREVIEW_MAX_BYTES);
    if (!blob) return none;
    if (blob.type.startsWith('video/')) {
      /* Decoded rather than discarded.
         This used to return nothing here on the assumption that a clip's tile
         carries a poster to fall back to. A finished Flow tile has no poster
         attribute at all, so the bytes were downloaded and dropped, and every
         later attempt went back to scraping a <video> on a page that may have
         scrolled it away. */
      const { first, last } = await framesFromVideoBlob(blob, logLine);
      return { preview: first, reference: last, fromVideo: true };
    }

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
    return { preview, reference, fromVideo: false };
  } catch (e: any) {
    console.warn(`[AutoFlow Studio] Preview unavailable: ${e?.message || e}`);
    return none;
  }
}

/** Preview source for a tile — prefers a poster/still over a video stream */
function extractTilePreviewSrc(tile: Element): string {
  const poster = resultArea(tile).querySelector('video')?.getAttribute('poster');
  if (poster) return poster;
  return findLargestImgSrc(tile);
}

/**
 * Extract the image or video URL from a completed tile.
 *
 * `expectVideo` is the NODE's own media type, not a guess from the DOM. It
 * has to be passed in: trackedTile is variously a [data-tile-id] element, a
 * history step or a generating card, so its tag name cannot be trusted to say
 * whether a clip or a still was asked for.
 */
function extractTileMediaUrl(tile: Element, expectVideo = false): string {
  /* The result half only. A batch also holds its INPUT pictures as
     <img class="chip-image"> under .ingredients-list, and findLargestImgSrc
     below would happily return one of those as the node's media — a still the
     user supplied, handed back as the thing that was generated from it. */
  const video = resultArea(tile).querySelector('video');
  if (video) {
    const source = video.querySelector('source[src]');
    if (source) return source.getAttribute('src') || '';
    if (video.src) return video.src;
    /* Deliberately NOT the poster. This is the clip's URL — it is downloaded,
       chained from, and shipped to the canvas as the node's video. Returning a
       JPEG here produced a node that looked like it held a clip and held one
       frame, and the failure surfaced two nodes later as a missing reference.
       Empty is honest and every caller already handles it. */
  }

  /* Same rule, for the case that actually happens.
   *
   * The guard above only covers a tile that HAS a player carrying no source.
   * On a live project with four finished clips there were no players at all —
   * every tile held a thumbnail and nothing else — so this line was reached
   * every single time and handed back a JPEG as the clip.
   *
   * Nothing downstream could recover from that, because it does not look like
   * a failure: the caller's `if (isVideoNode && !mediaUrl)` fallback, which
   * would have fetched the real signed URL from the API, was skipped for
   * having a perfectly good URL in hand. buildStudioVideoData then fetched an
   * image, saw a non-video blob and returned '', and the node rendered the
   * still with "open in Flow to play" under it.
   *
   * The thumbnail is NOT a lower-quality version of the clip and cannot be
   * turned into one: measured against a mounted player's src, it is a shorter
   * token entirely, so the "+ =mm,22,15" derivation the queue extension uses
   * does not reconstruct it on this Flow. Empty is the honest answer and the
   * one that lets the API fallback do its job. */
  if (expectVideo) return '';

  return findLargestImgSrc(tile);
}

function sendStudioProgress(nodeId: string, progress: number, execId?: string): void {
  try {
    chrome.runtime.sendMessage({
      type: 'STUDIO_NODE_PROGRESS',
      payload: { nodeId, progress, ...(execId ? { execId } : {}) },
    }).catch(() => {});
  } catch {}
}

function sendStudioError(nodeId: string, error: string, execId?: string): void {
  try {
    chrome.runtime.sendMessage({
      type: 'STUDIO_NODE_ERROR',
      payload: { nodeId, error, ...(execId ? { execId } : {}) },
    }).catch(() => {});
  } catch {}
}

/* The senders under the names a watcher shadows them with — see
   pollStudioCompletion. */
const postStudioProgress = sendStudioProgress;
const postStudioError = sendStudioError;
const postStudioResult = sendStudioResult;

/** Diagnostic log — shows in both the console and the side-panel Diagnostics section. */
function logLine(line: string): void {
  console.log(`[AutoFlow Flow] ${line}`);
  try {
    chrome.runtime.sendMessage({
      type: 'STUDIO_LOG',
      payload: { source: 'Flow', line },
    }).catch(() => {});
  } catch {}
}
