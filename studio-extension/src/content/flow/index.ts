/* ============================================================
   AutoFlow أ¢â‚¬â€œ Content Script Entry Point
   Runs on labs.google/flow pages.
   Routes messages to the automation engine and scanner.
   ============================================================ */

import { ImageMeta, Message, QueueObject } from '../../types';
import { AutomationEngine, isRunLocked } from './automation';
import { scanProjectForVideos, previewAsset, retrySingleTile, downloadAssetByMenu, waitForUpscalingDone, waitForExtendedVideoDownloadDone } from './scanner';
import { sleep, findModelSelectorTrigger, findMenuItem, simulateClick } from './selectors';
import { DOM_SETTLE_MS } from '../../shared/constants';
import { getRunningQueue, clearRunningQueue } from '../../shared/storage';
import {
  initApiHelper, isApiAvailable, isCacheFresh, activeStatusCheck,
  findStatusByMediaId, findStatusByPromptText, classifyError,
} from './apiHelper';
import { matchesFlowText } from './flowStrings';
import { registerStudioImage, releaseStudioImages } from './studioImages';
import { pickReferenceStill } from './studioFrames';
import { getStudioTileState, extractTileProgress, findLargestImgSrc } from './tileState';

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
const ADAPTER_BUILD = 'playable-clip-v1';

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
      // `pong` as well as the legacy shape: the worker's readiness check looked
      // for it, found it only on the chat scripts, and made every Flow node
      // wait out a thirty-second loop that could never succeed.
      return { type: 'PONG', pong: true, runLocked: isRunLocked() };

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

async function handleStudioExecuteNode(payload: any): Promise<any> {
  const { nodeId, config } = payload || {};
  if (!nodeId || !config) {
    return { type: 'STUDIO_NODE_ERROR', payload: { nodeId, error: 'Missing nodeId or config' } };
  }

  const startedAt = Date.now();
  const since = () => `+${((Date.now() - startedAt) / 1000).toFixed(1)}s`;
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
      model: isImage ? 'Omni Flash' : (config.model || 'Omni Flash'),
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
  /* The poller throws for a submit that never landed. Unhandled, that
     rejection reached no one: the node was left with no result at all and sat
     there until the runner's own 22-minute budget expired, replacing a
     specific message with a generic timeout. */
  pollStudioCompletion(nodeId, queue)
    .catch((e: any) => {
      sendStudioError(nodeId, e?.message || 'Tracking this generation failed');
    })
    .finally(() => {
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
  const { findAssetCards, isVisible, findRowForPrompt, scrollOutputToTop, findOutputScroller } =
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
  const ABSOLUTE_LIMIT_MS = 6 * 60_000; // backstop: an engine cycling forever

  const submitStart = Date.now();
  while (Date.now() - submitStart < ABSOLUTE_LIMIT_MS) {
    await sleep(500);
    const status = queue.prompts[0].status;

    if (status === 'submitted' || status === 'done') break;
    if (status === 'failed') {
      sendStudioError(nodeId, queue.prompts[0].error || 'Generation failed');
      return;
    }

    // Still moving through its steps? Then it is working, however slowly.
    if (engine && engine.getStateAge() < STALL_LIMIT_MS) continue;
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
  let missStreak = 0;
  let lastRemountAt = 0;

  /* How long a tile may show a thumbnail with no playable clip attached before
     we stop waiting for one. Flow normally attaches the source a second or two
     after the poster; 45s is far past that, so reaching it means the source is
     not coming. Taking the tile then is the lesser evil — it is genuinely
     rendered — but the log has to say the clip never became playable, because
     that is why the Last Frame below it will be empty. */
  const THUMBNAIL_GRACE_MS = 45_000;
  let thumbnailOnlySince = 0;

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
  let apiReported = '';
  let failedStreak = 0;

  for (let wait = 0; wait < watchSeconds; wait++) {
    await sleep(1000);

    if (isApiAvailable()) {
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
        sendStudioError(nodeId, why === 'safety'
          ? `Flow refused this prompt on safety grounds (${status.failureReason || status.rawStatus}). `
            + 'Rewording is the only thing that will change it.'
          : `Flow reported ${status.rawStatus}${status.failureReason ? ` — ${status.failureReason}` : ''}`);
        return;
      }
    }

    // Find the tracked tile in DOM
    let trackedTile: Element | null = null;
    for (const id of trackedTileIds) {
      // Primary: the grid tile
      const el = document.querySelector(`[data-tile-id="${id}"]`);
      if (el && isVisible(el)) { trackedTile = el; break; }

      // Detail View fallback: when the Detail View is open, Flow unmounts the
      // grid and shows history-step elements in the sidebar instead. The tile
      // id appears as part of the element's DOM id.
      const historyStep = document.querySelector(`div[id="history-step-${id}"]`);
      if (historyStep && isVisible(historyStep)) { trackedTile = historyStep; break; }
    }

    // Fallback path (no engine tile IDs): follow a tile we saw generating
    if (!trackedTile && fallbackTileId) {
      const el = document.querySelector(`[data-tile-id="${fallbackTileId}"]`)
        || document.querySelector(`div[id="history-step-${fallbackTileId}"]`);
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
        const mine = findRowForPrompt(promptText);
        if (mine) {
          trackedTile = document.querySelector(`[data-tile-id="${mine.tileId}"]`) || mine.element;
          fallbackTileId = mine.tileId;
          console.log(
            `[AutoFlow Studio] Matched this node's prompt to tile ${mine.tileId}` +
            `${mine.model ? ` (${mine.model}${mine.duration ? `, ${mine.duration}` : ''})` : ''}`
          );
        } else if (wait > 75) {
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
    let state = getStudioTileState(trackedTile);

    /* Say WHY it is still waiting, every fifteen seconds.
       A node ran for twenty minutes and the whole of Diagnostics said "Tile
       not in DOM yet" — and an 'unknown' tile said nothing at all, so the
       most confusing state was also the silent one. The state name, Flow's
       own badge and the tile id together separate "still rendering" from
       "watching the wrong tile" from "watching a tile Flow has abandoned". */
    if (wait > 8 && wait % 15 === 0) {
      const pct = extractTileProgress(trackedTile);
      logLine(
        `Waiting ${wait}s — tile ${trackedTile.getAttribute('data-tile-id') || trackedTile.id || '?'} `
        + `is ${state}${pct !== null ? `, Flow says ${pct}%` : ''}`
        + `, API ${apiState || (isApiAvailable() ? 'has no entry for this prompt' : 'unavailable')}`
        + ` [adapter ${ADAPTER_BUILD}]`
      );
    }

    /* A thumbnail with no clip behind it. Keep waiting for the source to
       attach — that is the whole point of naming this state — but never
       forever, and say so out loud when the wait is given up. */
    if (state === 'thumbnail-only') {
      if (!thumbnailOnlySince) thumbnailOnlySince = Date.now();
      const held = Date.now() - thumbnailOnlySince;
      /* The API settles this one properly. A poster with no clip means either
         "still rendering" or "rendered, source not attached yet", and the DOM
         cannot tell those apart — which is why the grace period is a guess.
         When the service says it is still working, the guess is not needed and
         must not expire: a long render would otherwise be declared finished
         at 45s and hand the next node an empty frame. */
      const serviceStillWorking = apiState === 'generating' || apiState === 'queued';
      if (serviceStillWorking || held < THUMBNAIL_GRACE_MS) {
        if (wait % 5 === 0) sendStudioProgress(nodeId, Math.min(97, 40 + Math.floor(wait / 12)));
        continue;
      }
      logLine(
        `Tile has shown a thumbnail for ${Math.round(held / 1000)}s without ever attaching a `
        + `playable clip${apiState ? ` (API: ${apiReported || apiState})` : ''} — taking it as `
        + 'finished. Nothing chained from it will have a last frame.'
      );
      state = 'completed';
    } else if (thumbnailOnlySince) {
      logLine(`Clip attached after ${Math.round((Date.now() - thumbnailOnlySince) / 1000)}s of thumbnail`);
      thumbnailOnlySince = 0;
    }

    if (state === 'completed') {
      logLine(`Tile completed! (id=${trackedTile.getAttribute('data-tile-id') || trackedTile.id || 'unknown'})`);
      const tileId = trackedTile.getAttribute('data-tile-id') || trackedTile.id || '';
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
  const body = raw.replace(/^failed[\s:—-]*/i, '').trim() || raw;
  return body.length > 160 ? `${body.slice(0, 160)}…` : body;
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
    // For a clip the poster is the OPENING frame, so it must not stand in for
    // a failed capture — see pickReferenceStill.
    isVideo: !!videoEl,
  });
  if (videoEl && !referenceUrl) {
    logLine('Last frame: nothing captured from this clip — anything chained from it will have no reference');
    console.warn(
      '[AutoFlow Studio] No end frame captured for this clip. Anything chained ' +
      'from it will report a missing reference rather than silently restarting ' +
      'from the opening frame.'
    );
  }

  if (videoEl && referenceUrl) {
    logLine(`Last frame captured (${Math.round(referenceUrl.length / 1024)}KB)`);
  }

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
 * Get enough of a clip loaded that it can be seeked and drawn.
 *
 * `preload="none"` means the browser has fetched nothing — not even metadata —
 * so duration is NaN and drawing the element produces an empty canvas. Setting
 * preload and calling load() starts the fetch; readyState >= 2 (HAVE_CURRENT_DATA)
 * is the point at which drawImage returns pixels.
 *
 * The attribute is restored afterwards so Flow's own lazy-loading behaviour is
 * unchanged for the user. Returns false rather than throwing: a clip that will
 * not load is a reason to report no frame, never a reason to fail the run.
 */
async function ensureVideoLoaded(video: HTMLVideoElement): Promise<boolean> {
  const ready = () => video.readyState >= 2 && isFinite(video.duration) && video.duration > 0;
  if (ready()) return true;

  const originalPreload = video.getAttribute('preload');
  video.preload = 'auto';
  try { video.load(); } catch { /* already loading */ }

  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      for (const ev of ['loadeddata', 'canplay', 'loadedmetadata', 'error']) {
        video.removeEventListener(ev, check);
      }
      resolve();
    };
    const check = () => { if (ready()) finish(); };
    // 10s: a Flow clip is a few MB and this happens once per node. Longer than
    // the seek timeout below because fetching bytes is the slow part.
    const timer = setTimeout(finish, 10_000);
    for (const ev of ['loadeddata', 'canplay', 'loadedmetadata', 'error']) {
      video.addEventListener(ev, check);
    }
    check();
  });

  if (originalPreload === null) video.removeAttribute('preload');
  else video.preload = originalPreload as any;

  return ready();
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
  /* Flow renders its tiles with preload="none", so the element usually holds
     no data at all: duration is NaN, readyState is 0, and every seek below is
     pointless. This used to bail straight to the poster — the clip's OPENING
     frame — so a Last Frame node showed the start of the shot it was supposed
     to end, and the chain silently restarted on every link.

     Loading it is the whole fix. The element is left as we found it. */
  if (!(await ensureVideoLoaded(video))) {
    /* Diagnostics, not just the console. This is the moment a Last Frame node
       is decided, and until now the only record of it was a warning in the
       Flow tab — so the panel showed an empty frame box, the dependent clip
       failed, and nothing anywhere said the two were connected. */
    logLine('Last frame: the clip would not load, so no end frame was captured');
    console.warn('[AutoFlow Studio] Clip would not load, so no end frame could be captured');
    return '';
  }

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
    /* Deliberately NOT the poster. This is the clip's URL — it is downloaded,
       chained from, and shipped to the canvas as the node's video. Returning a
       JPEG here produced a node that looked like it held a clip and held one
       frame, and the failure surfaced two nodes later as a missing reference.
       Empty is honest and every caller already handles it. */
  }

  return findLargestImgSrc(tile);
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
