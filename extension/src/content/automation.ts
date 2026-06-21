/* ============================================================
   AutoFlow â€“ Automation Engine (Content Script)
   Fully-automatic state machine that drives Flow UI to
   generate videos. No manual intervention required.
   ============================================================ */

import {
  QueueObject,
  PromptEntry,
  QueueSettings,
  AutomationState,
  AutomationMode,
  Message,
  ImageMeta,
  InputMethod,
  FlowGenerationStatus,
} from '../types';
import { savePromptHistory, saveRunningQueue, clearRunningQueue } from '../shared/storage';
import { classifyGenerationError, verifyTileStatus } from './llmHelper';
import {
  MAX_RETRIES,
  BACKOFF_BASE_MS,
  GENERATION_TIMEOUT_MS,
  POLL_INTERVAL_MS,
  IMAGE_UPLOAD_BATCH_SIZE,
} from '../shared/constants';
import {
  sleep,
  findPromptInput,
  findGenerateButton,
  findModelSelectorTrigger,
  findMenuItem,
  findIngredientAttachButton,
  findFrameButton,
  findFileInput,
  triggerFileInputChange,
  findAssetSearchDialog,
  findAssetResults,
  isGenerating,
  tilesHaveProgress,
  countOutputAssets,
  countTilesWithMedia,
  snapshotTiles,
  isGenerateButtonEnabled,
  simulateClick,
  nativeClick,
  reactTrigger,
  reactKeyTrigger,
  humanDelay,
  setInputValue,
  simulateTyping,
  findIngredientChips,
  queryButtonByText,
  queryByAriaLabel,
  findAssetCards,
  isVisible,
  findMoreMenuOnAsset,
  findSettingsPanelTrigger,
  isSettingsPanelOpen,
  findViewSettingsTrigger,
  isViewSettingsOpen,
  findModeButton,
  switchToViewMode,
  getTileState,
  getTileStateById,
  findAllFailedTiles,
  findAllFailedTilesWithScroll,
  findVoiceChip,
  getActiveVoiceName,
  findVoiceTabInDialog,
  findImageTabInDialog,
  isIngredientMenuOpen,
  findRetryButtonOnTile,
  allTilesSettled,
  getAllTileIds,
  checkTileStates,
  scrollAndCollectAllTileStates,
  scrollOutputToTop,
  allTilesSettledWithScroll,
  findOutputScroller,
  findExtendPromptInput,
  findExtendModelSelectorTrigger,
  findExtendGenerateButton,
} from './selectors';
import type { TileSnapshot, FailedTileInfo, TileState } from './selectors';
import { matchesFlowText, exactMatchFlowText, closeAriaSelectors, FLOW_STRINGS } from './flowStrings';
import {
  getAllCachedStatuses,
  getRemainingCredits,
  isCacheFresh,
  isApiAvailable,
  onQueueStart,
  onBeforeSubmit,
  getNewSubmissions,
  findStatusByPromptText,
  findStatusByMediaId,
  getQueueSummary,
  classifyError,
  activeStatusCheck,
  getInterceptorError,
} from './apiHelper';

/**
 * Normalize a model name for fuzzy matching.
 * Strips punctuation, brackets, icon text (arrow_drop_down), and collapses whitespace.
 * e.g. "Veo 3.1 - Fast [Lower Priority]arrow_drop_down" → "veo 3.1 fast lower priority"
 */
function normalizeForModelMatch(text: string): string {
  return text
    .toLowerCase()
    .replace(/arrow_drop_down/g, '')
    .replace(/[^a-z0-9.\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

let globalRunLock = false;

export function isRunLocked(): boolean {
  return globalRunLock;
}

export class AutomationEngine {
  private queue: QueueObject | null = null;
  private state: AutomationState = 'IDLE';
  private paused = false;
  private stopped = false;
  private currentPromptIdx = 0;
  private baselineTileCount = 0; // tiles on page before queue starts
  /** Cache of filenames already uploaded to Flow's library (persists across prompts) */
  private uploadedAssets = new Set<string>();
  /** Current automation mode */
  private mode: AutomationMode = 'flow';
  /** Resolver for re-prompt dialog — waits for user to edit or skip a failed prompt */
  private repromptResolver: ((result: { text: string; skip: boolean }) => void) | null = null;
  /** Resolver for batch re-prompt — waits for user to edit/skip ALL failed prompts at once */
  private batchRepromptResolver: ((results: Array<{ promptIndex: number; text: string; skip: boolean }>) => void) | null = null;
  /** Count of webRequest completion signals (status 200) */
  public imageApiCompletedCount = 0;
  /** Signal flag for immediate break from wait loop */
  public imageApiSignal = false;

  /** Called when background detects generation API completed via webRequest */
  onImageApiCompleted(payload: any): void {
    this.imageApiSignal = true;
    if (payload?.statusCode === 200) {
      this.imageApiCompletedCount++;
    }
    console.log('[AutoFlow] [INFO] webRequest: image API completed (status ' + (payload?.statusCode || '?') + ', total: ' + this.imageApiCompletedCount + ')');
  }

  /** Start processing a queue */
  async start(queue: QueueObject, baselineTileCount?: number): Promise<void> {
    // ── Run-lock check ──
    if (globalRunLock) {
      this.log('error', 'Another queue is already running. Stop it before starting a new one.');
      this.sendRunLockChanged(true);
      return;
    }
    globalRunLock = true;
    this.sendRunLockChanged(true);

    this.queue = queue;
    this.stopped = false;
    this.paused = false;
    this.currentPromptIdx = queue.currentPromptIndex || 0;

    // Initialize API cache for this queue session
    onQueueStart();

    this.log('info', `Starting queue "${queue.name}" with ${queue.prompts.length} prompts`);
    this.sendQueueStatus('running');

    // Save prompt order for library sorting
    // Skip for recovery queues — they'd overwrite the original queue's correct indices
    const isRecovery = queue.name.includes('(Recovery)');
    if (!isRecovery) {
      try {
        await savePromptHistory({
          queueId: queue.id,
          queueName: queue.name,
          timestamp: Date.now(),
          prompts: queue.prompts.map((p, i) => ({ index: i, text: p.text })),
        });
        this.log('info', `Saved prompt order (${queue.prompts.length} prompts) for library sorting`);
      } catch (e) {
        this.log('warn', 'Could not save prompt history: ' + (e as Error).message);
      }
    }

    // ── Apply settings once at queue start (mode, ratio, generations, model) ──
    await this.ensurePageReady();
    this.mode = this.queue.settings.automationMode || 'flow';
    this.log('info', `Automation mode: ${this.mode.toUpperCase()}`);
    await humanDelay(500, 1000);
    const settingsOk = await this.applyAllSettings(this.queue.settings);
    if (this.stopped) {
      this.sendQueueStatus('stopped');
      globalRunLock = false;
      this.sendRunLockChanged(false);
      return;
    }
    if (!settingsOk) {
      this.log('warn', 'Settings may not have been applied. Continuing with Flow defaults.');
    }
    await humanDelay(300, 700);

    // Capture baseline tile count before processing any prompts
    if (baselineTileCount !== undefined) {
      this.baselineTileCount = baselineTileCount;
      this.log('info', `Using provided baseline tiles count: ${this.baselineTileCount}`);
    } else {
      const visibleTiles = findAssetCards().filter(el => isVisible(el));
      this.baselineTileCount = visibleTiles.length;
      this.log('info', `Baseline tiles on page: ${this.baselineTileCount}`);
    }

    let doneCount = 0;
    let failedCount = 0;

    for (let i = this.currentPromptIdx; i < this.queue.prompts.length; i++) {
      if (this.stopped) break;
      while (this.paused) {
        await sleep(500);
        if (this.stopped) break;
      }
      if (this.stopped) break;

      const prompt = this.queue.prompts[i];
      if (prompt.status === 'done' || prompt.status === 'not-added') {
        this.log('info', `Prompt #${i + 1} is already done/skipped — skipping`);
        if (prompt.status === 'done') doneCount++;
        continue;
      }

      this.currentPromptIdx = i;
      this.sendQueueStatus('running', i);

      await this.processPrompt(prompt, i);

      if ((prompt.status as string) === 'done') doneCount++;
      else if ((prompt.status as string) === 'failed') failedCount++;

      // Save progress so we can resume after a page reload
      try {
        await saveRunningQueue(this.queue, i + 1, false, this.baselineTileCount);
      } catch { /* ignore storage errors */ }

      // Verify page is still usable before next prompt
      if (!this.stopped && i < this.queue.prompts.length - 1) {
        await this.ensurePageReady(this.queue.prompts[i + 1]);
      }
    }

    // ════════════════════════════════════════════════════════════════
    // SMART POST-QUEUE COMPLETION (API-First Verification)
    //
    // Phase 1: Wait for all tiles to settle (postQueueScan)
    // Phase 2: Active API verification — make ONE server call, use
    //          mediaId for reliable matching, then re-prompt truly
    //          failed prompts through processPrompt (not DOM retry)
    //
    // Why this is better than the old 4-phase system:
    // - Uses mediaId (exact) instead of text matching (fragile)
    // - Makes an active API call instead of relying on stale cache
    // - Re-prompts through processPrompt instead of DOM retry buttons
    //   (no untraceable duplicates, each gets a new tracked mediaId)
    // - No infinite wait loops — every path has a timeout
    // ════════════════════════════════════════════════════════════════

    if (!this.stopped && this.mode !== 'lite') {
      if (this.mode === 'full') {
        // ── FULL MODE: Wait for tiles to settle, then verify via API ──
        // We still need postQueueScan() to wait for all generations to finish
        // before entering the verify phase. Without it, verifyAndReprompt()
        // polls 3 min per "still generating" prompt (6 prompts = 18 min wait).
        // postQueueScan's 30s API stale override catches stuck prompts fast.
        this.sendPhaseUpdate('scanning', 'Waiting for all generations to finish...');
        this.log('info', 'Queue complete (full mode). Waiting for tiles to settle...');
        await this.postQueueScan();
        if (!this.stopped) {
          this.sendPhaseUpdate('checking', 'Verifying results with server...');
          await this.verifyAndReprompt();
        }
      } else {
        // ── FLOW MODE: Wait for tiles to settle, then verify ──
        this.sendPhaseUpdate('scanning', 'Waiting for all generations to finish...');
        this.log('info', 'Queue complete. Ensuring we are on the main grid before final scan...');
        await this.ensurePageReady();
        await this.postQueueScan();
        if (this.stopped) { /* user stopped during scan */ }

        // ── Phase 2: Active API Verification + Re-prompt ──
        if (!this.stopped) {
          await this.verifyAndReprompt();
        }
      }
    }

    // Check if recovery reload is needed (verifyAndReprompt saves status as 'queued' for recovery prompts)
    const queuedRemaining = this.queue.prompts.filter(p => p.status === 'queued').length;
    if (queuedRemaining > 0 && !this.stopped) {
      if (this.mode === 'full') {
        this.log('info', `Queue has ${queuedRemaining} unverified/cancelled prompt(s). Skipping recovery reload (Full Mode)...`);
      } else {
        // Save uploaded assets set and hard failed indices to storage so they survive the reload
        try {
          const hardFailedIndices = this.queue.prompts
            .map((p, idx) => p.status === 'failed' ? idx : -1)
            .filter(idx => idx !== -1);
          await new Promise<void>((resolve, reject) => {
            chrome.storage.local.set({
              'autoflow_uploaded_assets': Array.from(this.uploadedAssets),
              'autoflow_hard_failed_indices': hardFailedIndices
            }, () => {
              if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
              else resolve();
            });
          });
          this.log('info', `Saved ${this.uploadedAssets.size} uploaded assets and ${hardFailedIndices.length} hard-failed indices to storage.`);
        } catch (err: any) {
          this.log('warn', `Failed to save recovery metadata: ${err.message}`);
        }

        this.log('info', `Queue has ${queuedRemaining} unverified/cancelled prompt(s) — reloading page to run recovery...`);
        this.sendPhaseUpdate('reloading', 'Refreshing page for recovery scan...');
        await sleep(1500);
        window.location.reload();
        return;
      }
    }

    // Recount after smart completion
    doneCount = this.queue.prompts.filter(p => p.status === 'done').length;
    failedCount = this.queue.prompts.filter(p => p.status === 'failed').length;

    // ── Queue summary ──
    const totalPrompts = this.queue.prompts.length;
    const skipped = totalPrompts - doneCount - failedCount;
    const summary = `Queue "${this.queue.name}" finished — Done: ${doneCount}, Failed: ${failedCount}, Skipped: ${skipped}`;

    if (this.stopped) {
      this.log('info', `Queue "${this.queue.name}" stopped by user. ${summary}`);
      this.sendQueueStatus('stopped');
    } else {
      this.log('info', summary);
      this.sendQueueStatus('completed');
    }

    this.sendQueueSummary(doneCount, failedCount, skipped);
    this.state = 'IDLE';

    // ── Auto-scan library after queue completes ──
    if (!this.stopped) {
      const shouldAutoDownload = !!(this.queue.settings as any).autoDownload;

      if (this.mode === 'full') {
        // ── FULL MODE (Images): Reload → library scan → download one by one ──
        const isImageMode = this.queue!.settings?.mediaType === 'image';
        if (isImageMode) {
          this.log('info', `Queue complete (Full Mode, images) — using library scan for downloads...`);
          this.sendPhaseUpdate('reloading', 'Refreshing page for library scan...');
          const finalDone = this.queue!.prompts.filter(p => p.status === 'done').length;
          const finalFailed = this.queue!.prompts.filter(p => p.status === 'failed').length;
          const finalSkipped = this.queue!.prompts.length - finalDone - finalFailed;
          this.sendQueueStatus('completed');
          this.sendQueueSummary(finalDone, finalFailed, finalSkipped);
          try {
            await saveRunningQueue(this.queue!, this.queue!.prompts.length, false);
            chrome.runtime.sendMessage({
              type: 'AUTO_SCAN_LIBRARY',
              payload: { queueName: this.queue!.name, autoDownload: shouldAutoDownload, afterReload: true },
            }).catch(() => {});
          } catch { /* ignore */ }
          try { await clearRunningQueue(); } catch { /* ignore */ }
          globalRunLock = false;
          this.sendRunLockChanged(false);
          window.location.reload();
          return;
        }

        // ── FULL MODE (Videos): Always API download, no DOM needed ──
        const downloadItems = this.buildApiDownloadItems();
        this.log('info', `API download: ${downloadItems.length} item(s) ready`);
        if (downloadItems.length > 0) {
            this.log('info', `Queue complete — API downloading ${downloadItems.length} video(s) directly...`);
            this.sendPhaseUpdate('downloading', `Downloading ${downloadItems.length} file(s) via API...`);

            try {
              const resp = await new Promise<any>((resolve) => {
                chrome.runtime.sendMessage({
                  type: 'BATCH_API_DOWNLOAD',
                  payload: {
                    items: downloadItems,
                    queueName: this.queue!.name || 'AutoFlow_' + new Date().toISOString().slice(0, 10),
                  },
                }, resolve);
              });
              const dlCount = resp?.downloaded?.length || 0;
              const errCount = resp?.errors?.length || 0;
              this.log('info', `API download result: ${dlCount} downloaded, ${errCount} failed`);

              if (dlCount > 0) {
                this.sendPhaseUpdate('done', `Downloaded ${dlCount} file(s) ✅`);
                
                // Mark all prompts with mediaId as 'done' — they were downloaded successfully
                // This syncs the prompt status with the download result.
                for (let i = 0; i < this.queue!.prompts.length; i++) {
                  const p = this.queue!.prompts[i];
                  if (p.mediaId && p.status !== 'done' && p.status !== 'failed') {
                    this.updatePromptStatus(i, 'done');
                  }
                }

                // Send final queue status so sidepanel updates the counts
                const finalDone = this.queue!.prompts.filter(p => p.status === 'done').length;
                const finalFailed = this.queue!.prompts.filter(p => p.status === 'failed').length;
                const finalSkipped = this.queue!.prompts.length - finalDone - finalFailed;
                this.sendQueueStatus('completed');
                this.sendQueueSummary(finalDone, finalFailed, finalSkipped);
                
                try { await clearRunningQueue(); } catch { /* ignore */ }
                globalRunLock = false;
                this.sendRunLockChanged(false);
                this.log('info', `All ${dlCount} video(s) downloaded via API. Done! ✅ (${finalDone} done, ${finalFailed} failed)`);
                return;
              }
            } catch (err: any) {
              this.log('warn', `API download failed: ${err.message} — falling back to library scan`);
          }
        }

        // Fallback: reload page → library scan → context menu download (Full Mode, skipping reload)
        if (this.mode === 'full') {
          this.log('info', `Queue complete (Full Mode, skipping library scan reload).`);
          const finalDone = this.queue!.prompts.filter(p => p.status === 'done').length;
          const finalFailed = this.queue!.prompts.filter(p => p.status === 'failed').length;
          const finalSkipped = this.queue!.prompts.length - finalDone - finalFailed;
          this.sendQueueStatus('completed');
          this.sendQueueSummary(finalDone, finalFailed, finalSkipped);
          try { await clearRunningQueue(); } catch { /* ignore */ }
          globalRunLock = false;
          this.sendRunLockChanged(false);
          return;
        }

        // Fallback: reload page → library scan → context menu download
        this.log('info', `Queue complete — reloading page for library scan...`);
        this.sendPhaseUpdate('reloading', 'Refreshing page for library scan...');
        try {
          await saveRunningQueue(this.queue!, this.queue!.prompts.length, false);
          try {
            chrome.runtime.sendMessage({
              type: 'AUTO_SCAN_LIBRARY',
              payload: { queueName: this.queue!.name, autoDownload: shouldAutoDownload, afterReload: true },
            }).catch(() => {});
          } catch { /* ignore */ }
        } catch { /* ignore */ }

        try { await clearRunningQueue(); } catch { /* ignore */ }
        globalRunLock = false;
        this.sendRunLockChanged(false);
        window.location.reload();
        return;

      } else if (this.mode === 'flow') {
        // ── FLOW MODE: reload + scan library only, NO auto-download ──
        // User browses the library and downloads manually.
        this.log('info', `Queue complete — reloading page for library scan (no auto-download)...`);
        this.sendPhaseUpdate('reloading', 'Refreshing page for library scan...');
        try {
          await saveRunningQueue(this.queue!, this.queue!.prompts.length, false);
          try {
            chrome.runtime.sendMessage({
              type: 'AUTO_SCAN_LIBRARY',
              payload: { queueName: this.queue!.name, autoDownload: false, afterReload: true },
            }).catch(() => {});
          } catch { /* ignore */ }
        } catch { /* ignore */ }

        try { await clearRunningQueue(); } catch { /* ignore */ }
        globalRunLock = false;
        this.sendRunLockChanged(false);
        window.location.reload();
        return;
      } else {
        // Lite mode: just finish — no library scan, no auto-download
        this.log('info', 'Queue complete (Lite mode).');
      }
    }

    // ── Clear saved queue state (no longer running) ──
    try { await clearRunningQueue(); } catch { /* ignore */ }

    // ── Release run-lock ──
    globalRunLock = false;
    this.sendRunLockChanged(false);
  }

  /** Process a single prompt through the state machine */
  private async processPrompt(prompt: PromptEntry, idx: number): Promise<void> {
    let attempts = prompt.attempts || 0;

    while (attempts <= MAX_RETRIES) {
      if (this.stopped) return;

      try {
        this.updatePromptStatus(idx, 'running');
        this.log('info', `Processing prompt #${idx + 1} (attempt ${attempts + 1}/${MAX_RETRIES + 1})`);

        // Credit guard: if API interceptor has detected zero credits, stop immediately
        const credits = getRemainingCredits();
        if (credits !== null && credits <= 0) {
          this.log('error', `No credits remaining (${credits}) — stopping queue to avoid wasted submissions`);
          this.stopped = true;
          this.updatePromptStatus(idx, 'failed', 'No credits remaining');
          return;
        }

        // Quick verification: is the settings chip still correct?
        // Only full re-check on the first prompt — settings are applied once at queue start.
        if (idx === 0) {
          this.state = 'VERIFY_SETTINGS';
          await this.verifyOrReapplySettings(this.queue!.settings);
          if (this.stopped) return;
        }

        // State: EXTEND VIDEO
        if (prompt.isExtension) {
          this.state = 'EXTEND_VIDEO';
          await this.executeExtendPhase(prompt, idx);
          this.updatePromptStatus(idx, 'done');
          return;
        }

        // State: ATTACH IMAGES — branch based on creation type
        if (prompt.images && prompt.images.length > 0) {
          const isFramesMode = this.queue!.settings.creationType === 'frames';
          if (isFramesMode) {
            this.state = 'ATTACH_FRAME_IMAGES';
            const attached = await this.attachFrameImages(prompt.images, idx);
            if (!attached) {
              throw new Error(
                `Failed to attach frame image(s) (Start/End) automatically. ` +
                `The UI may have changed or the frame buttons could not be found.`
              );
            }
          } else {
            this.state = 'ATTACH_INGREDIENT_IMAGES';
            const attached = await this.attachIngredientImages(prompt.images, idx);
            if (!attached) {
              throw new Error(
                `Failed to attach ${prompt.images.length} reference image(s) automatically after all retries. ` +
                `The UI may have changed or images could not be injected.`
              );
            }
          }
          if (this.stopped) return;
        }

        // State: APPLY_VOICE
        if (this.queue!.settings.mediaType !== 'image') {
          this.state = 'APPLY_VOICE';
          const voiceToApply = (prompt.images && prompt.images.length > 0) 
            ? this.queue!.settings.voiceIngredient 
            : 'none';
          await this.applyVoiceIngredient(voiceToApply);
          if (this.stopped) return;
        }

        // State: FILL_PROMPT
        this.state = 'FILL_PROMPT';
        await this.fillPrompt(prompt.text, this.queue!.settings);
        if (this.stopped) return;

        // Snapshot tile IDs BEFORE clicking Generate (for tracking which tiles belong to this prompt)
        const tileIdsBefore = new Set(getAllTileIds());

        // Snapshot API cache BEFORE Generate (so we can diff later to find new entries)
        onBeforeSubmit();

        // State: CLICK_GENERATE
        this.state = 'CLICK_GENERATE';
        await this.clickGenerate();
        if (this.stopped) return;

        // Brief delay to let new tiles appear in the DOM
        await sleep(2000);

        // Snapshot tile IDs AFTER generate and record new tiles for this prompt
        const tileIdsAfter = getAllTileIds();
        const newTileIds = tileIdsAfter.filter(id => !tileIdsBefore.has(id));
        prompt.tileIds = newTileIds;
        if (newTileIds.length > 0) {
          this.log('info', `Prompt #${idx + 1}: ${newTileIds.length} new tile(s) tracked`);
        }

        // ── Automation Mode Handling: Wait after clicking Generate ──
        this.state = 'WAIT_BETWEEN_PROMPTS';
        const minSec = this.queue!.settings.waitMinSec ?? this.queue!.settings.waitBetweenPromptsSec ?? 10;
        const maxSec = this.queue!.settings.waitMaxSec ?? minSec;
        const waitSec = minSec + Math.random() * Math.max(0, maxSec - minSec);
        
        let earlyFailure = false;

        if (this.mode === 'lite') {
          // LITE MODE: Fast submission, no polling, just a minimal delay to let UI reset
          const liteWaitMs = Math.max(3000, waitSec * 1000 - 2000);
          this.log('info', `[Lite] Generation started. Waiting ${Math.round(liteWaitMs / 1000)}s before next prompt...`);
          await sleep(liteWaitMs);
        } else {
          // FLOW + FULL MODE: Wait the configured time, poll for early failures
          const totalWaitMs = Math.max(0, waitSec * 1000 - 2000);
          const modeLabel = this.mode === 'full' ? 'Full' : 'Flow';
          this.log('info', `[${modeLabel}] Generation started. Waiting ${waitSec.toFixed(1)}s before next prompt (range: ${minSec}-${maxSec}s)...`);

          // Poll during the wait to detect early failures.
          // STRATEGY: Use API cache diff (from onBeforeSubmit snapshot) for
          // precise identification of THIS generation. DOM as fallback.
          // IMPORTANT: 15s grace period — tiles briefly show as "failed"
          // during initialization (3-6s after Generate).
          const FAILURE_GRACE_MS = 15_000;
          const waitStart = Date.now();
          while (Date.now() - waitStart < totalWaitMs) {
            if (this.stopped) return;
            await sleep(2000);

            const elapsed = Date.now() - waitStart;
            if (elapsed < FAILURE_GRACE_MS) continue;

            // ── Strategy 1: API cache diff (passive, zero network traffic) ──
            // getNewSubmissions() returns only entries that appeared AFTER
            // onBeforeSubmit() — exactly the generation(s) from this click.
            if (isCacheFresh()) {
              const newEntries = getNewSubmissions();
              if (newEntries.length > 0) {
                const entry = newEntries[0]; // primary generation for this prompt

                // 🆕 Store mediaId on the prompt for reliable API lookups later
                if (entry.mediaId && !prompt.mediaId) {
                  prompt.mediaId = entry.mediaId;
                  this.log('info', `Prompt #${idx + 1}: captured mediaId ${entry.mediaId.slice(-8)}`);
                }

                if (entry.state === 'failed') {
                  const errorClass = await this.getLlmOrFallbackErrorClass(entry.rawStatus, entry.failureReason);
                  this.log('warn',
                    `Prompt #${idx + 1}: API → FAILED (${entry.rawStatus}) [${errorClass}]`
                  );

                  if (errorClass === 'safety') {
                    // Safety violation: skip immediately, retrying same prompt is pointless
                    // Force max attempts so the catch block marks it failed, not retried
                    attempts = MAX_RETRIES + 1;
                    throw new Error(`Safety blocked: ${entry.rawStatus}`);
                  }
                  if (errorClass === 'quota') {
                    // Quota/capacity: stop the entire queue
                    this.log('error', 'Quota/capacity error — stopping queue');
                    this.stopped = true;
                    attempts = MAX_RETRIES + 1;
                    throw new Error(`Quota exceeded: ${entry.rawStatus}`);
                  }
                  // Server error or unknown: let normal retry logic handle it
                  earlyFailure = true;
                  break;
                }

                if (entry.state === 'completed') {
                  this.log('info', `Prompt #${idx + 1}: API → COMPLETED — skipping remaining wait`);
                  break;
                }

                // Still generating/queued — continue waiting
                continue;
              }
            }

            // ── Strategy 2: DOM-based fallback ──
            // IMPORTANT: Only trust the DOM if the API has NO data.
            // Google Flow sometimes shows "cancelled" tiles that are
            // actually still generating — the video appears after reload.
            if (newTileIds.length > 0) {
              // Skip DOM check if API says this prompt is still generating/completed
              const apiEntries = getNewSubmissions();
              const apiStillActive = apiEntries.some(e =>
                e.state === 'generating' || e.state === 'queued' || e.state === 'completed'
              );

              if (apiStillActive) {
                // API says still active — ignore any "cancelled" DOM tile
                // This is the most common fake cancel scenario
                const tileStates = checkTileStates(newTileIds);
                if (tileStates.failed > 0) {
                  this.log('info', `Prompt #${idx + 1}: DOM shows cancelled but API says still active — trusting API (ignoring fake cancel)`);
                }
              } else if (!apiStillActive) {
                const tileStates = checkTileStates(newTileIds);
                if (tileStates.failed > 0 && tileStates.generating === 0) {
                  // Run LLM verification before doing anything destructive
                  try {
                    let failedTileText = '';
                    for (const id of newTileIds) {
                      if (getTileStateById(id) === 'failed') {
                        let el = document.querySelector(`#history-step-${CSS.escape(id)}`);
                        if (!el) {
                          el = document.querySelector(`div[data-tile-id="${CSS.escape(id)}"]`);
                        }
                        if (el) {
                          failedTileText = el.textContent || '';
                          break;
                        }
                      }
                    }
                    if (!failedTileText) {
                      failedTileText = prompt.text;
                    }
                    const verification = await verifyTileStatus(failedTileText);
                    this.log('info', `Prompt #${idx + 1}: LLM status verification -> "${verification.decision}" (reason: ${verification.reason})`);
                    if (verification.decision === 'fake_cancel') {
                      this.log('info', `Prompt #${idx + 1}: LLM classified as fake cancel — ignoring DOM failure and continuing wait...`);
                      continue;
                    }
                    if (verification.decision === 'reload_needed') {
                      this.log('warn', `Prompt #${idx + 1}: LLM advises reload — reloading page...`);
                      window.location.reload();
                      return;
                    }
                  } catch (err: any) {
                    this.log('warn', `LLM status check skipped/failed: ${err.message || err}`);
                  }

                  // Double-check: wait 5 extra seconds and re-check API before trusting DOM
                  // Fake cancels often resolve within seconds
                  await sleep(5000);
                  const recheck = getNewSubmissions();
                  const nowActive = recheck.some(e =>
                    e.state === 'generating' || e.state === 'queued' || e.state === 'completed'
                  );
                  if (nowActive) {
                    this.log('info', `Prompt #${idx + 1}: DOM showed cancelled but API recovered — ignoring fake cancel`);
                  } else {
                    this.log('warn', `Prompt #${idx + 1}: DOM detected ${tileStates.failed} failed tile(s) (${tileStates.completed} completed)`);
                    if (tileStates.completed === 0) {
                      earlyFailure = true;
                      break;
                    }
                    break;
                  }
                }
              }
            }
          }
        }

        if (this.stopped) return;

        if (earlyFailure) {
          // Check API cache first for error classification
          const newEntries = getNewSubmissions();
          const apiEntry = newEntries.find(e => e.state === 'failed');
          if (apiEntry) {
            const errorClass = await this.getLlmOrFallbackErrorClass(apiEntry.rawStatus, apiEntry.failureReason);
            if (errorClass === 'safety' || errorClass === 'quota') {
              attempts = MAX_RETRIES + 1; // prevent retry
              throw new Error(`${errorClass === 'safety' ? 'Safety blocked' : 'Quota exceeded'}: ${apiEntry.rawStatus}`);
            }
          }

          // DOM fallback: check the tile error text for REAL safety keywords
          // NOTE: "cancelled" is NOT a safety block — Flow shows it as a
          // transient DOM state; the video often completes after a page reload.
          const failedTiles = findAllFailedTiles();
          const thisTileFailed = failedTiles.find(ft => newTileIds.includes(ft.tileId));
          const errorMsg = thisTileFailed?.errorText || 'Generation failed (detected during wait)';

          // Only treat explicit policy/harmful/violation text as safety blocks
          const lowerErr = errorMsg.toLowerCase();
          if (lowerErr.includes('policies') || lowerErr.includes('harmful') ||
              lowerErr.includes('violat') || lowerErr.includes('safety block')) {
            attempts = MAX_RETRIES + 1; // prevent retry — real safety block
          }
          throw new Error(errorMsg);
        }

        // State: MARK_SUBMITTED — prompt sent to Google, video still rendering
        this.state = 'MARK_SUBMITTED';
        prompt.attempts = attempts + 1;

        // Last-chance mediaId capture with extended polling
        // The API response may arrive late (server load, backgrounded tab).
        // Without mediaId, we fall back to fragile text matching.
        // NOTE: Skip entirely for images — the interceptor only captures video
        // API endpoints, so this always fails for images ("Value is unserializable").
        const isImageQueue = this.queue!.settings.mediaType === 'image';
        if (!prompt.mediaId && !isImageQueue) {
          const MEDIA_ID_POLL_MS = 8000;
          const MEDIA_ID_INTERVAL = 2000;
          const pollStart = Date.now();
          while (Date.now() - pollStart < MEDIA_ID_POLL_MS) {
            const finalEntries = getNewSubmissions();
            if (finalEntries.length > 0 && finalEntries[0].mediaId) {
              prompt.mediaId = finalEntries[0].mediaId;
              this.log('info', `Prompt #${idx + 1}: late mediaId capture ${finalEntries[0].mediaId.slice(-8)} (${Math.round((Date.now() - pollStart) / 1000)}s)`);
              break;
            }
            await sleep(MEDIA_ID_INTERVAL);
          }
          // Final attempt: trigger an active API refresh
          if (!prompt.mediaId) {
            const refreshed = await activeStatusCheck();
            if (refreshed) {
              await sleep(500);
              const freshEntries = getNewSubmissions();
              if (freshEntries.length > 0 && freshEntries[0].mediaId) {
                prompt.mediaId = freshEntries[0].mediaId;
                this.log('info', `Prompt #${idx + 1}: mediaId captured via active refresh ${freshEntries[0].mediaId.slice(-8)}`);
              }
            } else {
              const errMsg = getInterceptorError();
              if (errMsg) this.log('warn', `Active API check failed during late media ID capture: ${errMsg}`);
            }
          }
        }

        this.updatePromptStatus(idx, 'submitted');
        this.log('info', `Prompt #${idx + 1} — submitted to Google${prompt.mediaId ? ` [${prompt.mediaId.slice(-8)}]` : ' (no mediaId)'}, moving to next prompt`);
        return;

      } catch (err: any) {
        // Guard: only REAL safety/policy errors skip retry.
        // "cancelled" is a FAKE transient state — DO NOT skip retry for it.
        const errLower = (err.message || '').toLowerCase();
        const isFakeCancel = errLower.includes('cancelled') || errLower.includes('canceled') ||
          (errLower.includes('generation failed') && !errLower.includes('policies') && !errLower.includes('safety'));

        if (errLower.includes('safety block') || errLower.includes('policies') ||
            errLower.includes('harmful') || errLower.includes('violat')) {
          attempts = MAX_RETRIES + 1; // force skip — real safety block
        } else {
          attempts++;
          // Reassure the user on fake cancels
          if (isFakeCancel) {
            this.log('info', `Prompt #${idx + 1}: Google showed "cancelled" — this is usually a false alarm. AutoFlow is auto-retrying...`);
            this.sendPhaseUpdate('recovering', `Google cancelled prompt #${idx + 1} (usually fake) — auto-retrying...`);
            // Send visible alert to sidepanel so user doesn't panic
            chrome.runtime.sendMessage({
              type: 'FAKE_CANCEL_ALERT',
              payload: { promptIndex: idx + 1, attempt: attempts },
            }).catch(() => {});
          }
        }
        prompt.attempts = attempts;
        this.log('error', `Prompt #${idx + 1} error (attempt ${attempts}): ${err.message}`);

        if (attempts > MAX_RETRIES) {
          this.state = 'MARK_FAILED';
          this.updatePromptStatus(idx, 'failed', err.message);
          this.log('error', `Prompt #${idx + 1} failed after ${MAX_RETRIES + 1} attempts`);

          if (this.queue!.settings.stopOnError) {
            this.stopped = true;
            this.log('warn', 'Queue stopped due to error (stopOnError=true)');
          }
          return;
        }

        // Backoff before retry (shorter for fake cancels — they resolve fast)
        const backoff = isFakeCancel
          ? Math.min(BACKOFF_BASE_MS, 3000)  // Max 3s for fake cancels
          : BACKOFF_BASE_MS * Math.pow(2, attempts - 1);
        this.log('info', `Retrying prompt #${idx + 1} in ${backoff / 1000}s...`);
        await sleep(backoff);
      }
    }
  }

  /**
   * Ensure the page is ready for the next prompt.
   * If the prompt input has disappeared (e.g., Flow navigated away),
   * wait and check repeatedly.
   */
  private async ensurePageReady(nextPrompt?: PromptEntry): Promise<void> {
    // If the next prompt is an extension, we don't need the main prompt input.
    // The history grid remains accessible even if the detail view is open.
    if (nextPrompt && nextPrompt.isExtension) {
      await sleep(1500);
      return;
    }

    const maxWait = 30000; // 30 seconds — new projects can take time to load
    const start = Date.now();
    let clickedNewProject = false;
    let triedEscape = false;

    while (Date.now() - start < maxWait) {
      if (this.stopped) return;

      // 1. Actively check if the Detail View (or any blocking modal) is open.
      // We must close it FIRST, otherwise findPromptInput() gets tricked by the Extend prompt box
      // which is also a valid Slate editor!
      const closeBtns = Array.from(document.querySelectorAll('button'));
      const doneBtn = closeBtns.find(b => {
         const t = b.textContent?.trim() || '';
         return matchesFlowText(t, 'done') && isVisible(b);
      });
      const closeIconBtns = Array.from(document.querySelectorAll(closeAriaSelectors()));
      const closeIconBtn = closeIconBtns.find(b => isVisible(b));
      
      const isDetailViewOpen = !!doneBtn || !!closeIconBtn;
      
      if (isDetailViewOpen) {
         this.log('info', 'Detail view or modal is open. Closing it to return to main grid...');
         if (doneBtn && isVisible(doneBtn)) {
            simulateClick(doneBtn);
         } else if (closeIconBtn && isVisible(closeIconBtn)) {
            simulateClick(closeIconBtn);
         } else if (!triedEscape) {
            document.body.dispatchEvent(new KeyboardEvent('keydown', {
              key: 'Escape', code: 'Escape', bubbles: true, cancelable: true,
            }));
            triedEscape = true;
         }
         await sleep(1500); // Wait for the animation to finish
         continue; // Re-evaluate the page state
      }

      // 2. Deactivate "Agent" mode if it's enabled.
      // aria-pressed="true" + span.content="Agent" = Agent mode is ON.
      // Settings (model, ratio, etc.) are broken when Agent is active.
      const agentBtn = document.querySelector('button[aria-pressed="true"]') as HTMLElement | null;
      if (agentBtn) {
        const label = agentBtn.querySelector('.content')?.textContent?.trim();
        if (label === 'Agent') {
          this.log('warn', 'Agent mode is active — clicking to deactivate');
          simulateClick(agentBtn);
          await sleep(1000);
          continue; // re-check page state after deactivation
        }
      }

      // 3. Now that we are sure the Detail View is closed and Agent is off,
      // look for the main prompt input.
      const promptInput = findPromptInput();
      if (promptInput && isVisible(promptInput)) {
        this.log('info', 'Page ready — prompt input visible');
        return;
      }

      // Check if we landed on the homepage — look for "+ New project" button
      // Only click it once to avoid re-clicking during page transition
      if (!clickedNewProject) {
        const newProjectBtn = queryButtonByText('new project') || FLOW_STRINGS.newProject.slice(1).reduce((found: Element | null, text) => found || queryButtonByText(text), null as Element | null);
        if (newProjectBtn && isVisible(newProjectBtn)) {
          this.log('info', 'Detected Flow homepage. Clicking "+ New project" to continue...');
          simulateClick(newProjectBtn);
          clickedNewProject = true;
          await sleep(6000); // wait longer for new project to load — Flow creates a project + navigates
          // New projects reset toggles — ensure they're ON
          await this.ensureToggles();
          continue;
        }
      }

      this.log('info', 'Waiting for page to be ready (prompt input not found yet)...');
      await sleep(2000);
    }

    this.log('warn', 'Page may not be ready — prompt input not found after waiting');
  }

  /**
   * Execute the "Extend" phase for a prompt that is part of an extension chain.
   * This skips normal image attachment/voice selection and uses the extension UI.
   */
  private async executeExtendPhase(prompt: PromptEntry, idx: number): Promise<void> {
    this.log('info', `Executing Extension phase for prompt #${idx + 1}`);

    // 1. Wait for the parent tile to complete
    if (typeof prompt.baseIndex !== 'number') {
      throw new Error(`Extension prompt missing baseIndex`);
    }
    const parentPrompt = this.queue!.prompts[prompt.baseIndex];
    if (!parentPrompt.tileIds || parentPrompt.tileIds.length === 0) {
      throw new Error(`Cannot extend: parent prompt #${prompt.baseIndex + 1} did not generate any tiles.`);
    }

    // Always extend the first tile generated by the parent prompt
    const targetTileId = parentPrompt.tileIds[0];
    
    // Check if the detail view is currently open
    const btns = Array.from(document.querySelectorAll('button'));
    const isDetailViewOpen = !!btns.find(b => {
      const t = b.textContent?.trim().toLowerCase() || '';
      return (matchesFlowText(t, 'done') || exactMatchFlowText(t, 'showHistory') || exactMatchFlowText(t, 'hideHistory')) && isVisible(b);
    });
    
    let isParentInHistorySidebar = false;
    
    if (isDetailViewOpen) {
      // First, ensure the history sidebar is actually expanded so we can see the steps
      const showHistoryBtn = btns.find(b => {
        const ht = (b.textContent?.trim() || '');
        return exactMatchFlowText(ht, 'showHistory') && isVisible(b);
      });
      if (showHistoryBtn) {
        this.log('info', 'Clicking "Show history" to properly monitor generation progress...');
        simulateClick(showHistoryBtn);
        await sleep(1000); // Give the sidebar time to slide in
      }
      
      // Now check if the parent tile we want is in this sidebar!
      const historyStepEl = document.querySelector(`#history-step-${CSS.escape(targetTileId)}`);
      if (historyStepEl && isVisible(historyStepEl)) {
         isParentInHistorySidebar = true;
         this.log('info', 'Parent tile found in current history sidebar. Selecting it...');
         simulateClick(historyStepEl); // Select the exact step we want to extend
         await sleep(1000);
      }
    }

    // Wait up to 5 minutes for parent tile to finish if it's still generating
    const MAX_WAIT_MS = 5 * 60 * 1000; 
    const waitStart = Date.now();
    let tileEl: Element | null = null;
    let parentRetries = 0;
    const MAX_PARENT_RETRIES = 3;
    let missingCount = 0;
    
    while (Date.now() - waitStart < MAX_WAIT_MS) {
      if (this.stopped) return;
      
      let stateEl: Element | null = null;
      if (isParentInHistorySidebar) {
         stateEl = document.querySelector(`#history-step-${CSS.escape(targetTileId)}`);
      } else {
         stateEl = document.querySelector(`[data-tile-id="${CSS.escape(targetTileId)}"]`);
      }

      if (!stateEl) {
         // Fallback: If we couldn't find the tile by ID, let's look for any tile containing the prompt text!
         // This handles cases where Google Flow replaced the parent tile with a combined "chain" tile.
         if (!isParentInHistorySidebar) {
            const tiles = findAssetCards();
            for (const t of tiles) {
               if (t.textContent?.toLowerCase().includes(parentPrompt.text.toLowerCase())) {
                  stateEl = t;
                  this.log('info', `Found parent tile by text match: "${parentPrompt.text.substring(0, 30)}..."`);
                  break;
               }
            }
         }
      }

      if (!stateEl) {
        missingCount++;
        this.log('warn', `Tile ${targetTileId} not in DOM. It might be scrolled out of view.`);
        if (missingCount === 3 && !isParentInHistorySidebar) {
           // If we can't find it in the grid, maybe the detail view is hiding it. Press Escape.
           this.log('info', `Pressing Escape to ensure grid is visible...`);
           document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
        }
        if (missingCount > 10) {
           throw new Error(`Cannot extend: parent tile disappeared from DOM permanently.`);
        }
      } else {
        missingCount = 0; // reset
        
        // Save the resolved stateEl immediately so we don't lose it if we break
        tileEl = stateEl;
        
        const state: TileState = getTileState(stateEl);

        if (state === 'completed') {
          break; // Ready!
        } else if (state === 'failed') {
          if (parentRetries < MAX_PARENT_RETRIES) {
             this.log('warn', `Parent generation failed! Attempting to auto-retry it (${parentRetries + 1}/${MAX_PARENT_RETRIES})...`);
             let retryBtn: Element | null = null;
             if (isParentInHistorySidebar) {
               // Detail view: find a retry button inside the history step
               retryBtn = stateEl.querySelector('button[aria-label*="retry"], button[aria-label*="Retry"], button[aria-label*="réessayer"], button[aria-label*="Réessayer"], button[aria-label*="Reintentar"], button[aria-label*="Wiederholen"]') || null;
               if (!retryBtn) {
                 const currentBtns = Array.from(document.querySelectorAll('button'));
                 retryBtn = currentBtns.find(b => {
                    const rt = (b.textContent||'').trim();
                    return matchesFlowText(rt, 'retry');
                  }) || null;
               }
             } else {
               retryBtn = findRetryButtonOnTile(stateEl);
             }
             
             if (retryBtn) {
               simulateClick(retryBtn);
               parentRetries++;
               await sleep(2000); // Wait for state to change to generating
               continue;
             } else {
               throw new Error(`Cannot extend: parent generation failed and no retry button found.`);
             }
          } else {
             throw new Error(`Cannot extend: parent generation failed and exhausted ${MAX_PARENT_RETRIES} retries.`);
          }
        }
      }
      await sleep(3000);
    }

    if (!isParentInHistorySidebar) {
      // If tileEl is not yet set (e.g. wait loop was skipped), try one last time by ID
      if (!tileEl) {
         tileEl = document.querySelector(`[data-tile-id="${CSS.escape(targetTileId)}"]`);
      }
      if (!tileEl || getTileState(tileEl) !== 'completed') {
        throw new Error(`Cannot extend: parent tile did not complete in time or is missing.`);
      }

      // 2. Click the tile to open detail view
      this.log('info', `Parent tile complete. Opening detail view...`);
      const clickable = tileEl.querySelector('img, video, [role="button"]') || tileEl;
      simulateClick(clickable);
      nativeClick(clickable);
      await sleep(3500); // Wait for detail view to open and render
    } else {
      this.log('info', `Parent generation complete in detail view. Continuing chain...`);
      await sleep(1000);
    }
    
    // 3. Find prompt input
    const input = findExtendPromptInput();
    if (!input) throw new Error('Extend prompt input not found.');

    // 4. Set the model to the user's configured model, using the selector INSIDE the extend prompt area
    const queueModel = this.queue!.settings.model;
    if (queueModel) {
      const modelTrigger = findExtendModelSelectorTrigger();
      if (modelTrigger) {
        await this.setModel(queueModel, modelTrigger);
      } else {
        this.log('warn', 'Extend model selector not found, using default model.');
      }
    }

    // 5. Fill text
    await setInputValue(input, prompt.text);
    await sleep(500);

    // Snapshot API cache BEFORE extend Generate (for mediaId capture)
    onBeforeSubmit();

    // Snapshot tile IDs before
    const tileIdsBefore = new Set(getAllTileIds());

    // 6. Click Generate
    const genBtn = findExtendGenerateButton();
    if (!genBtn) throw new Error('Extend generate button not found.');
    
    // We need to verify if the click worked by checking if generation started.
    const clickWorked = async () => {
      // 1. Grid view check: new tile appears
      const currentTiles = getAllTileIds();
      if (currentTiles.length > tileIdsBefore.size) return true;
      
      // 2. Detail view check: history sidebar generating box appears
      const historyTextRaw = document.body.innerText?.toLowerCase() || '';
      if (historyTextRaw.includes('generation.') && historyTextRaw.includes('update your settings')) return true;
      
      // 3. Button check: disabled or disappeared
      if (!document.body.contains(genBtn)) return true;
      if (genBtn.hasAttribute('disabled') || genBtn.getAttribute('aria-disabled') === 'true') return true;
      
      return false;
    };

    let generationStarted = false;

    // Strategy 1: React onClick via MAIN world
    const trig2 = await reactTrigger(genBtn, 'onClick');
    if (trig2.found && trig2.success) {
      this.log('info', 'Strategy 2: React onClick (isTrusted)');
      await humanDelay(1500, 2000);
      if (await clickWorked()) {
        generationStarted = true;
      }
    }

    if (!generationStarted) {
      // Strategy 3: React onKeyDown Enter via MAIN world (on prompt input)
      const trig3 = await reactKeyTrigger(input, 'Enter');
      if (trig3.found && trig3.success) {
        this.log('info', 'Strategy 3: React onKeyDown Enter (isTrusted)');
        await humanDelay(1500, 2000);
        if (await clickWorked()) {
          generationStarted = true;
        }
      }
    }

    if (!generationStarted) {
      // Fallback: simulateClick
      simulateClick(genBtn);
      this.log('info', 'Fallback 1: simulateClick');
      await humanDelay(1500, 2000);
      if (await clickWorked()) {
        generationStarted = true;
      }
    }

    if (!generationStarted) {
      // Absolute fallback: nativeClick
      nativeClick(genBtn);
      this.log('info', 'Fallback 2: nativeClick');
      await humanDelay(1500, 2000);
      if (await clickWorked()) {
        generationStarted = true;
      }
    }

    if (!generationStarted) {
      this.log('warn', 'Extend generation did not start automatically. Proceeding anyway...');
    } else {
      this.log('info', 'Extend generation successfully started.');
    }
    
    // We explicitly DO NOT press Escape here anymore. 
    // This allows the detail view to stay open so the user can watch the video generating,
    // or quickly see the result. If the next prompt requires the main prompt box,
    // ensurePageReady() will press Escape for us.
    await sleep(1500);

    // Track new tile
    const tileIdsAfter = getAllTileIds();
    const newTileIds = tileIdsAfter.filter(id => !tileIdsBefore.has(id));
    prompt.tileIds = newTileIds;
    if (newTileIds.length > 0) {
      this.log('info', `Prompt #${idx + 1} (Extension): ${newTileIds.length} new tile(s) tracked`);
    }

    // Wait for the new extension tile to finish generation
    this.log('info', `Extension started. Waiting for generation to complete...`);
    const MAX_EXT_WAIT_MS = 5 * 60 * 1000; // 5 minutes max
    const extWaitStart = Date.now();
    let extFinished = false;
    
    while (Date.now() - extWaitStart < MAX_EXT_WAIT_MS) {
      if (this.stopped) return;

      // ── API-based check first (passive cache diff) ──
      if (isCacheFresh()) {
        const newEntries = getNewSubmissions();
        const entry = newEntries[0];
        // Capture mediaId for this extension prompt
        if (entry && entry.mediaId && !prompt.mediaId) {
          prompt.mediaId = entry.mediaId;
          this.log('info', `Extension #${idx + 1}: captured mediaId ${entry.mediaId.slice(-8)}`);
        }
        if (entry && (entry.state === 'completed' || entry.state === 'failed')) {
          extFinished = true;
          this.log('info', `Extension generation finished via API (${entry.state}).`);
          break;
        }
      }

      // ── DOM fallback ──
      const states = checkTileStates(newTileIds);
      // If we have at least one completed or failed tile, we consider it finished
      if (states.completed > 0 || states.failed > 0) {
        extFinished = true;
        this.log('info', `Extension generation finished (completed: ${states.completed}, failed: ${states.failed}).`);
        break;
      }
      
      await sleep(3000);
    }
    
    if (!extFinished) {
      this.log('warn', `Extension generation did not finish within 5 minutes. Moving to next prompt.`);
    }

    // Small delay before moving to the next prompt
    await sleep(2000);
    if (this.stopped) return;
    
    let earlyFailure = false;
    const finalStates = checkTileStates(newTileIds);
    if (finalStates.failed > 0 && finalStates.completed === 0) {
       earlyFailure = true;
    }
    
    if (earlyFailure) {
      const failedTiles = findAllFailedTiles();
      const thisTileFailed = failedTiles.find(ft => newTileIds.includes(ft.tileId));
      throw new Error(thisTileFailed?.errorText || 'Extension failed (detected during wait)');
    }
  }

  /** Open the settings flyout panel if not already open.
   *  Flow uses Radix UI which lazy-mounts popover content.
   *  We try 5 click strategies sequentially â€” each one a single
   *  click attempt followed by polling for the panel to appear.
   *  Strategy order: native click â†’ React onPointerDown â†’ React onClick
   *  â†’ dispatched events â†’ keyboard Space.
   */
  private async openSettingsPanel(): Promise<boolean> {
    if (isSettingsPanelOpen()) return true;

    const trigger = findSettingsPanelTrigger();
    if (!trigger) {
      this.log('warn', 'Settings trigger button not found in DOM');
      return false;
    }

    // Each strategy returns true if it actually fired an action,
    // false if it immediately knows it can't work (skip the wait).
    const strategies: Array<{ name: string; fn: () => boolean | Promise<boolean> }> = [
      {
        name: 'native .click()',
        fn: () => { nativeClick(trigger); return true; },
      },
      {
        name: 'React onPointerDown',
        fn: async () => {
          const ok = (await reactTrigger(trigger, 'onPointerDown')).success;
          if (!ok) this.log('info', 'No React onPointerDown handler found');
          return ok;
        },
      },
      {
        name: 'React onClick',
        fn: async () => {
          const ok = (await reactTrigger(trigger, 'onClick')).success;
          if (!ok) this.log('info', 'No React onClick handler found');
          return ok;
        },
      },
      {
        name: 'dispatched pointer+mouse+click',
        fn: () => { simulateClick(trigger); return true; },
      },
      {
        name: 'keyboard Space',
        fn: () => {
          (trigger as HTMLElement).focus();
          trigger.dispatchEvent(new KeyboardEvent('keydown', {
            key: ' ', code: 'Space', bubbles: true, cancelable: true,
          }));
          trigger.dispatchEvent(new KeyboardEvent('keyup', {
            key: ' ', code: 'Space', bubbles: true, cancelable: true,
          }));
          return true;
        },
      },
    ];

    for (const strategy of strategies) {
      // Check before each attempt — a previous strategy may have worked
      if (isSettingsPanelOpen()) {
        this.log('info', 'Settings panel is now open');
        return true;
      }

      this.log('info', `Opening settings panel via: ${strategy.name}`);
      const fired = await strategy.fn();

      if (!fired) {
        // Strategy immediately knew it can't work — skip waiting
        continue;
      }

      // Quick sync check before polling
      if (isSettingsPanelOpen()) {
        this.log('info', `Settings panel opened via ${strategy.name}`);
        return true;
      }

      // Poll for the panel to appear (Radix lazy-mounts content)
      const opened = await this.waitForSettingsPanel(1500);
      if (opened) {
        this.log('info', `Settings panel opened via ${strategy.name}`);
        return true;
      }

      // Brief pause before next strategy
      await humanDelay(100, 200);
    }


    this.log('error', 'All 5 click strategies failed to open settings panel');
    return false;
  }

  /** Poll until the settings panel is confirmed open or timeout */
  private async waitForSettingsPanel(timeoutMs: number): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (this.stopped) return false;
      // Check 1: trigger has aria-expanded="true" or data-state="open"
      if (isSettingsPanelOpen()) return true;
      // Check 2: Radix menu content appeared (settings is a dropdown menu, not tabs)
      const menuContent = document.querySelector(
        '[role="menu"], [data-radix-menu-content], [data-radix-popper-content-wrapper]'
      );
      if (menuContent && isVisible(menuContent)) {
        this.log('info', 'Found Radix menu content in DOM');
        return true;
      }
      // Check 3: menu items or tabs appeared (Radix lazy-mounts them)
      const items = document.querySelectorAll(
        '[role="menuitem"], [role="menuitemradio"], button[role="tab"]'
      );
      if (items.length > 0) {
        this.log('info', `Found ${items.length} menu item(s)/tab(s) — panel is mounted`);
        return true;
      }
      await sleep(100);
    }
    return false;
  }

  /** Close the settings panel (Escape or click outside) */
  private async closeSettingsPanel(): Promise<void> {
    if (!isSettingsPanelOpen() || this.stopped) return;
    // Escape key to close Radix popover
    document.body.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Escape', code: 'Escape', bubbles: true, cancelable: true,
    }));
    await humanDelay(200, 400);
    // If still open, click the body to dismiss
    if (isSettingsPanelOpen()) {
      document.body.click();
      await humanDelay(200, 400);
    }
  }

  /**
   * Apply ALL settings at once: modeâ†’ratioâ†’generationsâ†’model.
   * Opens the settings dropdown menu, applies each setting, then closes it.
   * Flow uses a single Radix dropdown menu (not a panel with tabs).
   * The menu may close after each selection, so we re-open as needed.
   */
  private async applyAllSettings(settings: QueueSettings): Promise<boolean> {
    this.state = 'APPLY_SETTINGS';

    // Helper to open settings, find a menu item, click it.
    // Radix TabsTrigger activates on mousedown, NOT click, so we use
    // simulateClick (which dispatches pointerdown→mousedown→click).
    const applyMenuItem = async (label: string, description: string): Promise<boolean> => {
      if (this.stopped) return false;
      // Open settings panel if closed
      if (!isSettingsPanelOpen()) {
        const opened = await this.openSettingsPanel();
        if (!opened) {
          this.log('warn', `Could not open settings to set ${description}`);
          return false;
        }
        await humanDelay(300, 600);
      }

      const item = findModeButton(label);
      if (item) {
        // Check if already selected/active
        const state = item.getAttribute('data-state');
        const selected = item.getAttribute('aria-selected');
        const checked = item.getAttribute('aria-checked');
        if (state === 'active' || selected === 'true' || checked === 'true') {
          this.log('info', `${description} already active`);
          return true;
        }

        // Use simulateClick — it dispatches pointerdown + mousedown which
        // Radix TabsTrigger requires. nativeClick (.click()) only fires
        // the click event and Radix tabs ignore it.
        simulateClick(item);
        this.log('info', `Selected ${description}`);
        await humanDelay(400, 800);

        // Verify the click worked by re-checking state
        const afterItem = findModeButton(label);
        if (afterItem) {
          const afterState = afterItem.getAttribute('data-state');
          if (afterState === 'active') {
            this.log('info', `${description} confirmed active`);
          } else {
            // Fallback: try React handler directly
            this.log('warn', `${description} not active after simulateClick, trying React handler`);
            let trig = await reactTrigger(item, 'onMouseDown');
            if (!trig.success) trig = await reactTrigger(item, 'onPointerDown');
            await humanDelay(300, 500);
          }
        }
        return true;
      } else {
        this.log('warn', `${description} menu item not found`);
        return false;
      }
    };

    // 1. Select media type (Video / Image)
    const mediaLabel = settings.mediaType === 'image' ? 'Image' : 'Video';
    await applyMenuItem(mediaLabel, `Media: ${mediaLabel}`);
    if (this.stopped) return false;

    // 2. Select creation type (Ingredients / Frames) — only for VIDEO mode
    // Image mode in Flow UI doesn't have creation type options
    if (settings.mediaType !== 'image') {
      const creationLabel = settings.creationType === 'frames' ? 'Frames' : 'Ingredients';
      await applyMenuItem(creationLabel, `Creation: ${creationLabel}`);
      if (this.stopped) return false;
    }

    if (settings.mediaType === 'image') {
      // 3a. Set image model via nested dropdown (e.g. "Nano Banana 2", "Imagen 4")
      // The model selector is a sub-dropdown inside the settings menu — use setModel()
      // instead of applyMenuItem() to handle the nested menu correctly.
      await this.setModel(settings.imageModel);
      if (this.stopped) return false;

      // 3b. Set image ratio (e.g. "16:9", "4:3", "1:1", "3:4", "9:16")
      // New Flow UI uses plain ratio chips. Extract ratio from legacy labels if needed.
      let imgRatio = settings.imageRatio;
      const ratioMatch = imgRatio.match(/(\d+:\d+)/);
      if (ratioMatch) imgRatio = ratioMatch[1] as any;
      await applyMenuItem(imgRatio, `Image Ratio: ${imgRatio}`);
      if (this.stopped) return false;
    } else {
      // 3. Set orientation / aspect ratio
      // New Flow UI uses '9:16' / '16:9' labels; older UI used 'Portrait' / 'Landscape'.
      // Try new labels first, fall back to old labels for compatibility.
      const isPortrait = settings.orientation === 'portrait';
      const newLabel = isPortrait ? '9:16' : '16:9';
      const oldLabel = isPortrait ? 'Portrait' : 'Landscape';
      let ratioSet = await applyMenuItem(newLabel, `Ratio: ${newLabel}`);
      if (!ratioSet) {
        ratioSet = await applyMenuItem(oldLabel, `Orientation: ${oldLabel}`);
      }
      if (this.stopped) return false;

      // 5. Set model (video models)
      await this.setModel(settings.model);
      if (this.stopped) return false;
      await humanDelay(200, 400);
    }

    // Try new format "1x" first, then old format "x1"
    const genNewFmt = `${settings.generations}x`;
    const genOldFmt = `x${settings.generations}`;
    let genSet = await applyMenuItem(genNewFmt, `Generations: ${genNewFmt}`);
    if (!genSet) {
      genSet = await applyMenuItem(genOldFmt, `Generations: ${genOldFmt}`);
    }
    if (this.stopped) return false;

    // 4b. Set video duration (4s/6s/8s) — video mode only
    if (settings.mediaType !== 'image' && settings.duration) {
      await applyMenuItem(settings.duration, `Duration: ${settings.duration}`);
      if (this.stopped) return false;
    }

    // 6. Ensure critical toggles are ON
    await this.ensureToggles();

    // Close the settings panel
    await this.closeSettingsPanel();

    this.log('info', 'All settings applied');
    return true;
  }

  /**
   * Apply a Voice Ingredient from settings.
   * Runs per-prompt to ensure voice is always set (clear prompt on submit resets it).
   */
  private async applyVoiceIngredient(voiceName: string | undefined): Promise<boolean> {
    if (!voiceName || voiceName === 'none') {
      this.log('info', 'No voice selected for queue');
      return true;
    }

    const currentVoice = getActiveVoiceName();
    if (currentVoice === voiceName) {
      this.log('info', `Voice "${voiceName}" already active`);
      return true;
    }

    this.log('info', `Setting voice to "${voiceName}"...`);
    
    // 1. Open ingredient dialog (the "+" button)
    const addBtn = findIngredientAttachButton();
    if (!addBtn) {
      this.log('warn', 'Cannot find "+" ingredient button to set voice');
      return false;
    }

    // Dismiss any stale dialogs first
    await this.dismissDialogs();
    await sleep(300);

    let opened = false;
    const openStrategies = [
      { name: 'React onPointerDown', fn: () => reactTrigger(addBtn, 'onPointerDown') },
      { name: 'React onClick', fn: () => reactTrigger(addBtn, 'onClick') },
      { name: 'simulateClick', fn: () => { simulateClick(addBtn); return true; } },
      { name: 'native .click()', fn: () => { nativeClick(addBtn); return true; } }
    ];

    for (const strat of openStrategies) {
      if (isIngredientMenuOpen()) {
        opened = true;
        break;
      }
      this.log('info', `Opening ingredient menu via: ${strat.name}`);
      await strat.fn();
      await sleep(600);
      if (isIngredientMenuOpen()) {
        opened = true;
        break;
      }
    }
    
    if (!opened) {
      this.log('warn', 'Failed to open ingredient menu for voice');
      return false;
    }

    // 2. ALWAYS click the Voice/AUDIO tab to switch to the voice list.
    //    The dialog may have opened on the Image tab (e.g. after attaching images).
    const voiceTab = findVoiceTabInDialog();
    if (voiceTab) {
      this.log('info', 'Clicking Voice/AUDIO tab...');
      // Fire all click strategies to ensure the tab switches
      const tabStrategies = [
        () => reactTrigger(voiceTab, 'onPointerDown'),
        () => reactTrigger(voiceTab, 'onClick'),
        () => { simulateClick(voiceTab); return true; },
        () => { nativeClick(voiceTab); return true; }
      ];
      for (const strat of tabStrategies) {
        await strat();
        await sleep(100);
      }

      // Wait until the Voice tab is confirmed active
      const tabStart = Date.now();
      while (Date.now() - tabStart < 2000) {
        const activeState = voiceTab.getAttribute('aria-selected') === 'true' ||
                            voiceTab.getAttribute('data-state') === 'active';
        if (activeState) {
          this.log('info', 'Voice/AUDIO tab is now active');
          break;
        }
        await sleep(100);
      }
      await sleep(300);
    } else {
      this.log('info', 'No explicit Voice tab found, assuming voices are already visible');
    }

    // 3. Type the voice name into the search box to filter the list.
    //    This is critical because voice lists can be virtualized (lazy-loaded)
    //    and the target voice may not be in the DOM until searched.
    const searchInput = document.querySelector('input[placeholder*="Search"], input[placeholder*="Rechercher"], input[placeholder*="Buscar"], input[placeholder*="Suchen"], input[placeholder*="Cerca"], input[placeholder*="Pesquisar"]') as HTMLInputElement;
    if (searchInput && isVisible(searchInput)) {
      this.log('info', `Searching for voice "${voiceName}"...`);
      searchInput.focus();
      // Clear any previous search text
      const nativeSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype, 'value'
      )?.set;
      if (nativeSetter) nativeSetter.call(searchInput, '');
      else searchInput.value = '';
      searchInput.dispatchEvent(new Event('input', { bubbles: true }));
      await sleep(100);
      // Type the voice name
      await setInputValue(searchInput, voiceName);
      await sleep(800); // Wait for results to filter
    } else {
      this.log('info', 'No search input found in voice panel');
    }

    // 4. Find and click the voice name in the filtered list
    let found = false;
    const targetName = voiceName.toLowerCase();

    // Try up to 2 times (in case the first scan is too early)
    for (let scanAttempt = 0; scanAttempt < 2 && !found; scanAttempt++) {
      if (scanAttempt > 0) {
        this.log('info', 'Retrying voice scan after brief wait...');
        await sleep(600);
      }

      const voiceHeaders = document.querySelectorAll('h4, div, span, [role="menuitem"], button');
      for (const header of voiceHeaders) {
        const text = (header.textContent || '').trim().toLowerCase();
        
        // Match: exact name, name followed by space/newline, or name followed by gender symbol
        // e.g. "callirrhoe", "callirrhoe ♀ easy-going, mid", "callirrhoe\nFemale..."
        if (text === targetName || 
            text.startsWith(targetName + ' ') || 
            text.startsWith(targetName + '\n') ||
            text.startsWith(targetName + '♀') ||
            text.startsWith(targetName + '♂') ||
            text.startsWith(targetName + '⚥')) {
          // Must be visible
          if (!isVisible(header)) continue;
          
          // Scroll into view (may be off-screen in scrollable list)
          try {
            header.scrollIntoView({ block: 'center', behavior: 'instant' });
          } catch { /* ignore */ }
          await sleep(100);

          // Gather all possible click targets
          const targets = new Set<Element>();
          targets.add(header);
          if (header.parentElement) targets.add(header.parentElement);
          if (header.parentElement?.parentElement) targets.add(header.parentElement.parentElement);
          const container = header.closest('[role="button"], [role="menuitem"], [role="option"], button, li');
          if (container) targets.add(container);

          for (const target of targets) {
            const clickStrategies = [
              () => reactTrigger(target, 'onPointerDown'),
              () => reactTrigger(target, 'onClick'),
              () => { simulateClick(target); return true; },
              () => { nativeClick(target); return true; }
            ];
            for (const strat of clickStrategies) {
              await strat();
              await sleep(50);
            }
          }
          
          found = true;
          this.log('info', `Clicked voice "${voiceName}"`);
          break;
        }
      }
    }

    if (!found) {
      this.log('warn', `Voice "${voiceName}" not found in list after search`);
    }

    await sleep(300);
    await this.dismissDialogs();
    await sleep(400);
    
    // Verify — but don't fail the queue if verification can't find the chip.
    // The voice chip may take a moment to appear, or the selector may not match.
    const verifyVoice = getActiveVoiceName();
    if (verifyVoice === voiceName) {
      this.log('info', `Voice successfully set to "${voiceName}"`);
    } else if (found) {
      // We clicked something but can't verify — warn but continue (don't block the queue)
      this.log('warn', `Voice click succeeded but verification found "${verifyVoice || 'none'}" instead of "${voiceName}". Continuing anyway.`);
    } else {
      this.log('warn', `Failed to set voice. Expected ${voiceName}, found ${verifyVoice || 'none'}`);
      return false;
    }
    return true;
  }

  /**
   * Ensure both critical toggles are ON:
   * - "Clear prompt on submit" (prevents old chips/text from lingering)
   * - "Show tile details" (shows generation progress and labels)
   * Opens the VIEW settings panel (gear icon), checks both, then closes.
   */
  private async ensureToggles(): Promise<void> {
    if (this.stopped) return;

    // Open the VIEW settings panel (gear icon) — NOT the model settings panel
    const opened = await this.openViewSettingsPanel();
    if (!opened || this.stopped) return;

    // Switch to Batch view mode (better for automation — shows all tiles)
    const switched = await switchToViewMode('Batch');
    if (switched) {
      this.log('info', 'Switched to Batch view mode');
    }
    if (this.stopped) return;

    // Re-open view settings if switchToViewMode closed it
    if (!isViewSettingsOpen()) {
      await this.openViewSettingsPanel();
    }

    // Check both toggles while the panel is open
    await this.ensureToggleOn('clearPromptOnSubmit');
    await this.ensureToggleOn('showTileDetails');

    // Close the view settings panel
    await this.closeViewSettingsPanel();
  }

  /**
   * Open the VIEW settings panel (gear icon with settings_2).
   * Uses multiple click strategies similar to openSettingsPanel.
   */
  private async openViewSettingsPanel(): Promise<boolean> {
    if (isViewSettingsOpen()) return true;

    const trigger = findViewSettingsTrigger();
    if (!trigger) {
      this.log('warn', 'View settings trigger (gear icon) not found in DOM');
      return false;
    }

    // Try clicking the gear button
    const strategies: Array<{ name: string; fn: () => boolean | Promise<boolean> }> = [
      { name: 'simulateClick', fn: () => { simulateClick(trigger); return true; } },
      { name: 'native .click()', fn: () => { nativeClick(trigger); return true; } },
      {
        name: 'React onPointerDown',
        fn: async () => {
          const ok = (await reactTrigger(trigger, 'onPointerDown')).success;
          return ok;
        },
      },
    ];

    for (const strategy of strategies) {
      if (isViewSettingsOpen()) return true;

      this.log('info', `Opening view settings via: ${strategy.name}`);
      const fired = await strategy.fn();
      if (!fired) continue;

      // Wait for panel to appear
      await sleep(500);
      if (isViewSettingsOpen()) {
        this.log('info', `View settings panel opened via ${strategy.name}`);
        return true;
      }

      // Check if any menu content appeared (Radix lazy-mounts)
      const start = Date.now();
      while (Date.now() - start < 1500) {
        if (this.stopped) return false;

        // Check for the toggle buttons that indicate the view panel is visible
        const allBtns = document.querySelectorAll('button[role="tab"]');
        for (const btn of allBtns) {
          let container: Element | null = btn;
          for (let i = 0; i < 5 && container; i++) container = container.parentElement;
          if (matchesFlowText(container?.textContent || '', 'clearPromptOnSubmit')) {
            this.log('info', 'View settings panel content detected');
            return true;
          }
        }

        if (isViewSettingsOpen()) return true;
        await sleep(100);
      }

      await humanDelay(100, 200);
    }

    this.log('warn', 'Could not open view settings panel');
    return false;
  }

  /**
   * Close the VIEW settings panel.
   */
  private async closeViewSettingsPanel(): Promise<void> {
    if (!isViewSettingsOpen() || this.stopped) return;
    document.body.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Escape', code: 'Escape', bubbles: true, cancelable: true,
    }));
    await humanDelay(200, 400);
    if (isViewSettingsOpen()) {
      document.body.click();
      await humanDelay(200, 400);
    }
  }

  /**
   * Generic toggle enabler: finds a toggle by its nearby label text
   * and clicks the "On" button if not already active.
   * The toggle uses two Radix-style tab buttons with aria-label="Off" and aria-label="On"
   * inside a section that contains the given label text.
   */
  private async ensureToggleOn(toggleKey: string): Promise<void> {
    if (this.stopped) return;

    // The view settings panel should already be open (called from ensureToggles)
    // But verify — if it closed between toggles, reopen
    if (!isViewSettingsOpen()) {
      const opened = await this.openViewSettingsPanel();
      if (!opened || this.stopped) return;
    }

    // Map of flowStrings keys for toggle labels
    const toggleKeys: Record<string, keyof typeof FLOW_STRINGS> = {
      clearPromptOnSubmit: 'clearPromptOnSubmit',
      showTileDetails: 'showTileDetails',
    };
    const flowKey = toggleKeys[toggleKey];
    const otherFlowKeys = Object.values(toggleKeys).filter(k => k !== flowKey);

    const allBtns = document.querySelectorAll('button[role="tab"]');
    for (const btn of allBtns) {
      const label = btn.getAttribute('aria-label');
      if (label !== 'On') continue;

      // Walk up level by level to find the NEAREST ancestor that contains
      // the toggle label. This avoids matching a shared parent that holds
      // ALL toggles (which caused "Sound On hover" to match everything).
      let matched = false;
      let ancestor: Element | null = btn.parentElement;
      for (let i = 0; i < 5 && ancestor; i++) {
        const ancestorText = ancestor.textContent?.toLowerCase() || '';
        if (flowKey && matchesFlowText(ancestorText, flowKey)) {
          // Make sure this ancestor does NOT also contain other toggle labels —
          // if it does, we're too high up. Keep walking to find a tighter match.
          const containsOthers = otherFlowKeys.some(k => matchesFlowText(ancestorText, k));
          if (!containsOthers) {
            matched = true;
            break;
          }
        }
        ancestor = ancestor.parentElement;
      }
      if (!matched) continue;

      // Check if already active
      const state = btn.getAttribute('data-state');
      if (state === 'active') {
        this.log('info', `${toggleKey}: already ON`);
        return;
      }

      // Click it ON
      simulateClick(btn);
      this.log('info', `Enabled "${toggleKey}"`);
      await humanDelay(300, 500);
      return;
    }

    this.log('info', `${toggleKey} toggle not found (may already be ON)`);
  }

  /**
   * Quick verification before each prompt. Reads the settings chip text
   * and re-applies settings if they look wrong.
   */
  private async verifyOrReapplySettings(settings: QueueSettings): Promise<void> {
    if (this.stopped) return;
    const trigger = findSettingsPanelTrigger();
    if (!trigger) {
      // No settings chip found â€” page may have navigated. Try recovery.
      this.log('warn', 'Settings chip not found â€” re-applying settings');
      await this.applyAllSettings(settings);
      return;
    }

    const chipText = (trigger.textContent || '').toLowerCase();
    // For images, the chip shows model name + ratio (e.g. "Nano Banana 2 crop_16_9 x3")
    // — it does NOT contain the word "image". So for image mode, check for the model name instead.
    const expectMedia = settings.mediaType === 'image'
      ? chipText.includes('banana') || chipText.includes('imagen') || chipText.includes('crop') || chipText.includes(':')
      : chipText.includes(settings.mediaType);
    const expectGen = chipText.includes(`${settings.generations}x`) || chipText.includes(`x${settings.generations}`);

    if (!expectMedia || !expectGen) {
      this.log('info', `Settings chip "${trigger.textContent?.trim()}" doesn't match expected. Re-applying...`);
      await this.applyAllSettings(settings);
    }
    // If they match, settings are still correct â€” no action needed.
  }

  private async setModel(modelName: string, overrideTrigger?: Element | null): Promise<void> {
    if (this.stopped) return;

    // Use override trigger if provided, else use the global settings panel trigger
    const trigger = overrideTrigger || findModelSelectorTrigger();
    if (!trigger) {
      // The model dropdown is INSIDE the settings panel — make sure it's open if we don't have an override
      if (!overrideTrigger && !isSettingsPanelOpen()) {
        const opened = await this.openSettingsPanel();
        if (!opened || this.stopped) {
          this.log('warn', 'Could not open settings panel to set model');
          return;
        }
        await humanDelay(300, 600);
      }
      if (this.stopped) return;
    }

    const finalTrigger = overrideTrigger || findModelSelectorTrigger();
    if (!finalTrigger) {
      this.log('warn', 'Model dropdown not found. Using Flow default.');
      return;
    }

    const currentModelRaw = finalTrigger.textContent?.trim() || '';
    const currentModelNorm = normalizeForModelMatch(currentModelRaw);
    const targetNorm = normalizeForModelMatch(modelName);
    if (currentModelNorm.includes(targetNorm)) {
      this.log('info', `Model already set: ${currentModelRaw}`);
      return;
    }

    // Open the model dropdown — try multiple strategies
    simulateClick(finalTrigger);
    await humanDelay(600, 1000);
    if (this.stopped) return;

    // Helper: find model options inside the model sub-menu.
    // When the model dropdown opens it creates a NEW [role="menu"] portal.
    // We scope our search to the LAST menu in the DOM to avoid matching
    // items from the parent settings menu.
    const findModelOptions = (): NodeListOf<Element> | null => {
      const allMenus = document.querySelectorAll('[role="menu"], [data-radix-menu-content]');
      if (allMenus.length > 1) {
        // Multiple menus open — the model sub-menu is the last (newest) portal
        const subMenu = allMenus[allMenus.length - 1];
        const items = subMenu.querySelectorAll('[role="menuitem"], [role="menuitemradio"], [role="option"], [data-radix-collection-item]');
        if (items.length > 0) return items;
      }
      // Fallback: global search, but skip items that contain a nested dropdown trigger
      return document.querySelectorAll('[role="menuitem"], [role="menuitemradio"], [role="option"], [data-radix-collection-item]');
    };

    let menuItems = findModelOptions();
    if (!menuItems || menuItems.length === 0) {
      nativeClick(finalTrigger);
      await humanDelay(600, 1000);
      if (this.stopped) return;
      menuItems = findModelOptions();
    }
    if (!menuItems || menuItems.length === 0) {
      await reactTrigger(finalTrigger, 'onPointerDown');
      await humanDelay(600, 1000);
      if (this.stopped) return;
      menuItems = findModelOptions();
    }

    this.log('info', `Found ${menuItems?.length ?? 0} model menu items`);

    if (menuItems) {
      for (const item of menuItems) {
        const itemText = item.textContent || '';
        const itemNorm = normalizeForModelMatch(itemText);

        // Skip disabled items
        if (item.getAttribute('aria-disabled') === 'true' ||
          item.getAttribute('data-disabled') === 'true') {
          continue;
        }

        // Skip items that are themselves dropdown triggers (parent menu containers)
        if (item.querySelector('button[aria-haspopup="menu"]')) {
          continue;
        }

        if (itemNorm.includes(targetNorm) && isVisible(item)) {
          // The clickable element may be a button inside the menuitem div
          const innerBtn = item.querySelector('button');
          const clickTarget = innerBtn || item;
          simulateClick(clickTarget);
          this.log('info', `Selected model: ${itemText.trim()}`);
          await humanDelay(300, 600);
          return;
        }
      }
    }

    // Close dropdown if nothing matched
    this.log('warn', `Model "${modelName}" not in menu. Using current: ${currentModelRaw}`);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await humanDelay(200, 400);
  }

  // ================================================================
  // IMAGE ATTACHMENT — two-phase: upload to library, then search & add as ingredient
  // ================================================================

  /**
   * Attach reference images to the current prompt as ingredients.
   *
   * Supports up to 10 images. Uploads in batches of IMAGE_UPLOAD_BATCH_SIZE
   * (default 5) to avoid overwhelming Flow's upload handler.
   * Each batch: open dialog → upload → wait for chips → close dialog.
   * Dynamic timeout scales with the number of images.
   */
  private async attachIngredientImages(images: ImageMeta[], promptIdx: number): Promise<boolean> {
    if (images.length === 0) return true;

    this.log('info', `Attaching ${images.length} reference image(s) for prompt #${promptIdx + 1}`);

    // "Clear prompt on submit" toggle handles clearing old chips automatically.
    // Just proceed to upload the new images for this prompt.

    // Get all image blobs from sidepanel upfront
    let imageBlobs: any;
    try {
      imageBlobs = await this.requestImageBlobs(images);
      if (!imageBlobs?.files?.length) {
        this.log('warn', 'No image blobs returned from sidepanel');
        return false;
      }
    } catch (e: any) {
      this.log('warn', `Failed to get image blobs: ${e.message}`);
      return false;
    }

    // Split files into batches
    const allFiles: any[] = imageBlobs.files;
    const batches: any[][] = [];
    for (let i = 0; i < allFiles.length; i += IMAGE_UPLOAD_BATCH_SIZE) {
      batches.push(allFiles.slice(i, i + IMAGE_UPLOAD_BATCH_SIZE));
    }

    this.log('info', `Uploading ${allFiles.length} image(s) in ${batches.length} batch(es) (batch size: ${IMAGE_UPLOAD_BATCH_SIZE})`);

    let totalExpected = 0;

    for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
      const batch = batches[batchIdx];
      totalExpected += batch.length;

      if (this.stopped) return false;

      this.log('info', `Batch ${batchIdx + 1}/${batches.length}: uploading ${batch.length} image(s)...`);

      // Open dialog
      const success = await this.uploadImageBatch(batch, totalExpected, batchIdx, batches.length);
      if (!success) {
        // If a batch fails, check if we got at least some chips
        const chipsNow = findIngredientChips().length;
        if (chipsNow >= images.length) {
          this.log('info', `Despite batch error, all ${images.length} chips are present`);
          return true;
        }
        this.log('warn', `Batch ${batchIdx + 1} failed. ${chipsNow}/${images.length} chips present`);
        return false;
      }
    }

    // Final verification
    await this.dismissDialogs();
    const chipsAfter = findIngredientChips().length;
    if (chipsAfter >= images.length) {
      this.log('info', `All ${images.length} image(s) attached successfully (${chipsAfter} chips present)`);
      return true;
    }
    this.log('warn', `Only ${chipsAfter}/${images.length} chips after all batches`);
    return false;
  }

  /**
   * Attach images as ingredient chips.
   * Per-image strategy:
   *   NEW image → Paste (Ctrl+V) → wait 6s for upload → chip appears
   *   CACHED image → Search by name in library → click → fast (~2s)
   */
  private async uploadImageBatch(
    batch: any[],
    expectedTotalChips: number,
    batchIdx: number,
    totalBatches: number
  ): Promise<boolean> {
    // Build filenames using the image's unique ID (not position) so every
    // distinct image gets a stable, unique name across prompts.
    // This prevents wrong-image selection when different prompts need
    // different character images at the same position.
    const filenames: string[] = [];
    for (let i = 0; i < batch.length; i++) {
      const ext = batch[i].mime.includes('png') ? 'png' : 'jpg';
      const idSlug = (batch[i].id || '').replace(/-/g, '').slice(0, 8) || `${batchIdx}_${i}`;
      filenames.push(`af_${idSlug}.${ext}`);
    }

    // Split into new vs cached
    const newIndices: number[] = [];
    const cachedIndices: number[] = [];
    for (let i = 0; i < filenames.length; i++) {
      if (this.uploadedAssets.has(filenames[i])) {
        cachedIndices.push(i);
      } else {
        newIndices.push(i);
      }
    }

    this.log('info', `${batch.length} image(s): ${newIndices.length} new, ${cachedIndices.length} cached`);

    // --- PASTE new images (all at once) ---
    if (newIndices.length > 0) {
      const promptInput = findPromptInput();
      if (!promptInput) {
        this.log('warn', 'Prompt input not found');
        return false;
      }

      const dt = new DataTransfer();
      for (const idx of newIndices) {
        const fileData = batch[idx];
        const blob = this.base64ToBlob(fileData.data, fileData.mime);
        const file = new File([blob], filenames[idx], { type: fileData.mime });
        dt.items.add(file);
      }

      if (promptInput instanceof HTMLElement) promptInput.focus();
      await sleep(100);

      const pasteEvent = new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData: dt,
      });
      promptInput.dispatchEvent(pasteEvent);
      this.log('info', `Pasted ${newIndices.length} new image(s) — waiting 8s for upload...`);

      await sleep(8000);

      // Mark as uploaded
      for (const idx of newIndices) {
        this.uploadedAssets.add(filenames[idx]);
      }
      this.log('info', 'New image(s) uploaded!');
    }

    // --- SEARCH cached images (one by one) ---
    if (cachedIndices.length > 0) {
      const addBtn = findIngredientAttachButton();
      if (!addBtn) {
        this.log('warn', 'Cannot find "+" ingredient button');
        return false;
      }

      let selectedCount = 0;
      for (const idx of cachedIndices) {
        if (this.stopped) return false;
        const selected = await this.searchAndSelectAsset(filenames[idx], addBtn as HTMLElement);
        if (selected) selectedCount++;
        else this.log('warn', `Failed to select "${filenames[idx]}"`);
        await sleep(200);
      }
      this.log('info', `Searched ${selectedCount}/${cachedIndices.length} cached image(s)`);
    }

    // Wait for all chips to appear
    const maxWaitMs = 10000;
    const startWait = Date.now();
    while (Date.now() - startWait < maxWaitMs) {
      if (this.stopped) return false;
      const chips = findIngredientChips().length;
      if (chips >= expectedTotalChips) {
        this.log('info', `All ${chips} chip(s) attached — done!`);
        return true;
      }
      await sleep(500);
    }
    return findIngredientChips().length >= expectedTotalChips;
  }

  /**
   * Helper to type filename in search and click the corresponding result in the dialog.
   */
  private async searchAndClickAssetInDialog(dialog: Element, filename: string): Promise<boolean> {
    const searchInput = dialog.querySelector(
      'input[placeholder*="Search"], input[placeholder*="Rechercher"], input[placeholder*="Buscar"], input[placeholder*="Suchen"], input[placeholder*="Cerca"], input[placeholder*="Pesquisar"]'
    ) as HTMLInputElement;

    if (!searchInput) {
      this.log('warn', 'Search input not found in dialog');
      return false;
    }

    searchInput.focus();
    searchInput.value = '';
    searchInput.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(100);

    await setInputValue(searchInput, filename);
    await sleep(800); // Wait for filtering to complete

    let results = findAssetResults(dialog);
    if (results.length === 0) {
      await sleep(1000);
      results = findAssetResults(dialog);
    }

    if (results.length > 0) {
      let targetEl = results[0];
      // Try to find a exact or partial filename match in the result row
      for (const res of results) {
        const text = (res.textContent || '').toLowerCase();
        const img = res.querySelector('img');
        const alt = (img?.getAttribute('alt') || '').toLowerCase();
        const fnLower = filename.toLowerCase();

        if (text.includes(fnLower) || alt.includes(fnLower)) {
          targetEl = res;
          break;
        }
      }

      this.log('info', `Found result row for "${filename}". Clicking to attach...`);
      simulateClick(targetEl);
      await sleep(100);
      nativeClick(targetEl);
      await sleep(500);
      return true;
    }

    // Fallback to Enter key if result elements aren't detectable
    this.log('warn', `No result elements found for "${filename}", falling back to Enter key`);
    searchInput.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter', code: 'Enter', keyCode: 13,
      bubbles: true, cancelable: true,
    }));
    await sleep(500);
    return true;
  }

  /**
   * Helper to trigger programmatic upload of an asset file inside the dialog.
   */
  private async uploadAssetInDialog(dialog: Element, fileData: any, filename: string): Promise<boolean> {
    let uploadClicked = false;
    const allBtns = dialog.querySelectorAll('button');
    for (const btn of allBtns) {
      const icon = btn.querySelector('i.google-symbols, i.material-icons, .google-symbols');
      if (icon && icon.textContent?.trim() === 'upload') {
        nativeClick(btn);
        uploadClicked = true;
        break;
      }
    }

    if (!uploadClicked) {
      for (const btn of allBtns) {
        const btnEl = btn as HTMLElement;
        if (btnEl.getAttribute('aria-haspopup') === 'menu') continue;
        if (matchesFlowText(btnEl.getAttribute('aria-label') || '', 'done')) continue;
        if (!isVisible(btnEl)) continue;
        const btnText = (btnEl.textContent || '').trim();
        if (matchesFlowText(btnText, 'recently') || matchesFlowText(btnText, 'done')) continue;
        nativeClick(btnEl);
        uploadClicked = true;
        break;
      }
    }
    await sleep(400);

    const fileInput = findFileInput();
    if (!fileInput) {
      this.log('warn', 'No file input found for upload');
      return false;
    }

    const blob = this.base64ToBlob(fileData.data, fileData.mime);
    const file = new File([blob], filename, { type: fileData.mime });
    const dt = new DataTransfer();
    dt.items.add(file);
    fileInput.files = dt.files;
    triggerFileInputChange(fileInput);
    
    this.log('info', `File uploaded: ${filename} — waiting 6s for Flow processing...`);
    await sleep(6000);
    return true;
  }

  /**
   * Search for an asset by filename and attach it.
   * Flow: Open "+" dialog → type filename → click/Enter → image attaches.
   */
  private async searchAndSelectAsset(filename: string, addBtn: HTMLElement): Promise<boolean> {
    if (this.stopped) return false;

    await this.dismissDialogs();
    await sleep(300);

    const btn = (findIngredientAttachButton() as HTMLElement) || addBtn;
    btn.scrollIntoView({ block: 'center', behavior: 'instant' });
    await sleep(200);

    let dialog: Element | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (this.stopped) return false;
      if (attempt === 0) simulateClick(btn);
      else nativeClick(btn);
      await sleep(600);

      dialog = findAssetSearchDialog();
      if (dialog) break;

      await this.dismissDialogs();
      await sleep(200);
    }

    if (!dialog) {
      this.log('warn', '"+" dialog did not open');
      return false;
    }

    const imageTab = findImageTabInDialog();
    if (imageTab && imageTab.getAttribute('aria-selected') !== 'true') {
      const tabStrategies = [
        () => reactTrigger(imageTab, 'onPointerDown'),
        () => reactTrigger(imageTab, 'onClick'),
        () => { simulateClick(imageTab); return true; },
        () => { nativeClick(imageTab); return true; }
      ];
      for (const strat of tabStrategies) {
        await strat();
        await sleep(100);
      }
      await sleep(200);
    }

    return this.searchAndClickAssetInDialog(dialog, filename);
  }

  /**
   * Attach frame images (Start / End) in Frames creation mode.
   * images[0] → Start frame, images[1] → End frame (optional).
   */
  private async attachFrameImages(images: ImageMeta[], promptIdx: number): Promise<boolean> {
    if (images.length === 0) return true;

    this.log('info', `Attaching ${images.length} frame image(s) for prompt #${promptIdx + 1}`);

    let imageBlobs: any;
    try {
      imageBlobs = await this.requestImageBlobs(images);
      if (!imageBlobs?.files?.length) {
        this.log('warn', 'No image blobs returned from sidepanel');
        return false;
      }
    } catch (e: any) {
      this.log('warn', `Failed to get image blobs: ${e.message}`);
      return false;
    }

    const frameSlots: Array<{ label: 'Start' | 'End'; fileIndex: number }> = [];
    frameSlots.push({ label: 'Start', fileIndex: 0 });
    if (images.length > 1) {
      frameSlots.push({ label: 'End', fileIndex: 1 });
    }

    for (const slot of frameSlots) {
      if (this.stopped) return false;
      const fileData = imageBlobs.files[slot.fileIndex];
      if (!fileData) {
        this.log('warn', `No file data for ${slot.label} frame (index ${slot.fileIndex})`);
        continue;
      }

      // Generate identical stable filename structure as ingredients
      const ext = fileData.mime.includes('png') ? 'png' : 'jpg';
      const idSlug = (images[slot.fileIndex].id || '').replace(/-/g, '').slice(0, 8) || `${promptIdx}_${slot.fileIndex}`;
      const filename = `af_${idSlug}.${ext}`;

      this.log('info', `Preparing to attach "${slot.label}" frame: ${filename}...`);

      const checkAttached = (): boolean => {
        const btn = findFrameButton(slot.label);
        if (!btn) return false;
        const hasImg = btn.querySelector('img') !== null;
        const text = (btn.textContent || '').trim();
        return hasImg || (text !== slot.label);
      };

      if (checkAttached()) {
        this.log('info', `"${slot.label}" frame already has an image attached. Skipping.`);
        continue;
      }

      const frameBtn = findFrameButton(slot.label);
      if (!frameBtn) {
        this.log('warn', `Cannot find "${slot.label}" frame button`);
        return false;
      }

      await this.dismissDialogs();
      await sleep(200);

      simulateClick(frameBtn);
      await humanDelay(400, 700);

      let dialog = findAssetSearchDialog();
      if (!dialog) {
        nativeClick(frameBtn);
        await humanDelay(500, 800);
        dialog = findAssetSearchDialog();
      }
      if (!dialog) {
        this.log('warn', `Dialog did not open after clicking "${slot.label}"`);
        return false;
      }

      // Focus the search input or the dialog itself to route the paste event
      const targetInput = dialog.querySelector('input') || dialog;
      
      const blob = this.base64ToBlob(fileData.data, fileData.mime);
      const file = new File([blob], filename, { type: fileData.mime });
      const dt = new DataTransfer();
      dt.items.add(file);

      if (targetInput instanceof HTMLElement) {
        targetInput.focus();
        await sleep(100);
      }

      const pasteEvent = new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData: dt,
      });
      targetInput.dispatchEvent(pasteEvent);
      this.log('info', `Pasted frame image "${filename}" into dialog — waiting for upload & attach...`);

      // Poll until the image shows up in the frame slot
      const maxWaitMs = 12000;
      const startWait = Date.now();
      let attached = false;

      while (Date.now() - startWait < maxWaitMs) {
        if (this.stopped) return false;
        if (checkAttached()) {
          attached = true;
          break;
        }
        await sleep(500);
      }

      if (!attached) {
        this.log('warn', `Timed out waiting for "${slot.label}" frame to show attached image.`);
        await this.dismissDialogs();
        return false;
      }

      this.log('info', `Successfully attached ${slot.label} frame: ${filename}`);
      this.uploadedAssets.add(filename);
      await this.dismissDialogs();
      await sleep(400);
    }

    this.log('info', `All frame image(s) attached for prompt #${promptIdx + 1}`);
    return true;
  }

  /** Dismiss any open dialogs/popover/modals by pressing Escape */
  private async dismissDialogs(): Promise<void> {
    for (let i = 0; i < 3; i++) {
      const openDialog = document.querySelector(
        '[role="dialog"]:not([hidden]), [data-radix-popper-content-wrapper], ' +
        '[data-state="open"][aria-haspopup]'
      );
      if (!openDialog) break;
      document.body.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Escape', code: 'Escape', bubbles: true, cancelable: true,
      }));
      await humanDelay(300, 500);
    }
  }

  /** Request image blobs from the sidepanel via background (30s timeout) */
  private requestImageBlobs(images: ImageMeta[]): Promise<any> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Image blob request timed out after 30s'));
      }, 30_000);
      chrome.runtime.sendMessage(
        { type: 'GET_IMAGE_BLOBS', payload: { imageIds: images.map(i => i.id) } },
        (response) => {
          clearTimeout(timeout);
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(response);
          }
        }
      );
    });
  }

  /** Convert base64 to Blob */
  private base64ToBlob(base64: string, mime: string): Blob {
    const byteString = atob(base64);
    const ab = new ArrayBuffer(byteString.length);
    const ia = new Uint8Array(ab);
    for (let i = 0; i < byteString.length; i++) {
      ia[i] = byteString.charCodeAt(i);
    }
    return new Blob([ab], { type: mime });
  }

  // ================================================================
  // PROMPT FILLING â€” supports paste OR simulated typing
  // ================================================================

  /** Fill the prompt text into Flow's prompt box */
  private async fillPrompt(text: string, settings: QueueSettings): Promise<void> {
    await humanDelay(300, 700);

    const input = findPromptInput();
    if (!input) {
      throw new Error('Prompt input not found in Flow UI');
    }

    // Clear existing prompt text. The image chips are sibling elements
    // OUTSIDE the Slate editor div, so selectAll inside the Slate editor
    // should only clear text content, not the chips.
    if (input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement) {
      input.focus();
      input.select();
    } else {
      input.focus();
      document.execCommand('selectAll', false);
    }
    await humanDelay(100, 300);

    const method: InputMethod = settings.typingMode ? 'type' : (settings.inputMethod ?? 'paste');

    if (method === 'type') {
      const multiplier = settings.typingSpeedMultiplier ?? 1.0;
      const cps = Math.round((settings.typingCharsPerSecond ?? 25) * multiplier);
      const variable = settings.variableTypingDelay ?? settings.typingMode ?? true;
      const chunked = text.length > 100 ? ' [chunked]' : '';
      this.log('info', `Typing prompt (${text.length} chars at ~${cps} cps, speed=${multiplier.toFixed(2)}x, variable=${variable}${chunked})`);
      await simulateTyping(input as HTMLElement, text, cps, variable);
    } else {
      await setInputValue(input as HTMLElement, text);
    }

    this.log('info', `Prompt filled (${text.length} chars, method=${method})`);
    await humanDelay(400, 800);
  }

  /** Click the Generate button using multiple strategies for reliability */
  private async clickGenerate(): Promise<void> {
    await humanDelay(300, 600);

    // Wait for the Generate button to exist and become enabled.
    // Flow disables the button while images are still being processed.
    let btn: Element | null = null;
    const maxWaitMs = 60000; // up to 60s for image processing
    const startWait = Date.now();
    let lastLogTime = 0;

    while (Date.now() - startWait < maxWaitMs) {
      if (this.stopped) return;
      btn = findGenerateButton();
      if (btn) {
        const htmlBtn = btn as HTMLButtonElement;
        const isDisabled = htmlBtn.disabled ||
          htmlBtn.getAttribute('aria-disabled') === 'true' ||
          htmlBtn.classList.contains('disabled');

        if (!isDisabled) break; // Button is enabled — proceed

        // Log every 5 seconds while waiting
        const elapsed = Date.now() - startWait;
        if (elapsed - lastLogTime > 5000) {
          lastLogTime = elapsed;
          this.log('info', `Waiting for Generate button to be enabled... (${Math.round(elapsed / 1000)}s)`);
        }
      }
      await sleep(500);
    }

    if (!btn) {
      throw new Error('Generate button not found in Flow UI');
    }

    // Final check — is it still disabled?
    const htmlBtn = btn as HTMLButtonElement;
    if (htmlBtn.disabled || htmlBtn.getAttribute('aria-disabled') === 'true') {
      this.log('warn', `Generate button still disabled after ${Math.round((Date.now() - startWait) / 1000)}s. Attempting click anyway.`);
    }

    this.log('info', 'Generate button is ready');

    // Helper: check if the click actually worked by verifying
    // the prompt was cleared (since "clear prompt on submit" is ON).
    // isGenerating() can give false positives in the new UI.
    const promptInput = findPromptInput();
    const promptTextBefore = promptInput
      ? ((promptInput as HTMLInputElement).value || promptInput.textContent || '').trim()
      : '';

    const clickWorked = async (): Promise<boolean> => {
      // Poll a few times — Flow's UI needs a moment to clear the prompt and start tiles
      for (let attempt = 0; attempt < 4; attempt++) {
        // Primary signal: prompt was cleared after submit
        if (promptInput) {
          const textNow = ((promptInput as HTMLInputElement).value || promptInput.textContent || '').trim();
          if (promptTextBefore.length > 0 && textNow.length === 0) return true;
        }
        // Secondary signal: tiles appeared
        if (tilesHaveProgress()) return true;
        if (attempt < 3) await sleep(500);
      }
      return false;
    };

    // ═══════════════════════════════════════════════════════════════
    // CLICK STRATEGIES — React MAIN-world handlers carry isTrusted
    // (replaces Chrome DevTools Protocol debugger approach)
    // ═══════════════════════════════════════════════════════════════

    // Strategy 1: React onPointerDown via MAIN world (most Radix UI buttons use this)
    const trig1 = await reactTrigger(btn, 'onPointerDown');
    if (trig1.found && trig1.success) {
      this.log('info', 'Strategy 1: React onPointerDown (isTrusted)');
      await humanDelay(800, 1200);
      if (await clickWorked()) {
        this.log('info', 'Generation confirmed started after React onPointerDown');
        return;
      }
    }

    // Strategy 2: React onClick via MAIN world
    const trig2 = await reactTrigger(btn, 'onClick');
    if (trig2.found && trig2.success) {
      this.log('info', 'Strategy 2: React onClick (isTrusted)');
      await humanDelay(800, 1200);
      if (await clickWorked()) {
        this.log('info', 'Generation confirmed started after React onClick');
        return;
      }
    }

    // Strategy 3: React onKeyDown Enter via MAIN world (on prompt input)
    if (promptInput) {
      const trig3 = await reactKeyTrigger(promptInput, 'Enter');
      if (trig3.found && trig3.success) {
        this.log('info', 'Strategy 3: React onKeyDown Enter (isTrusted)');
        await humanDelay(800, 1200);
        if (await clickWorked()) {
          this.log('info', 'Generation confirmed started after React Enter');
          return;
        }
      }
    }

    // ═══════════════════════════════════════════════════════════════
    // FALLBACK STRATEGIES (synthetic events — less reliable)
    // ═══════════════════════════════════════════════════════════════

    // Fallback 1: simulateClick (full pointer→mouse→click chain)
    simulateClick(btn);
    this.log('info', 'Fallback 1: simulateClick');
    await humanDelay(800, 1200);
    if (await clickWorked()) {
      this.log('info', 'Generation confirmed started after simulateClick');
      return;
    }

    // Fallback 2: Native .click()
    nativeClick(btn);
    this.log('info', 'Fallback 2: native .click()');
    await humanDelay(800, 1200);
    if (await clickWorked()) {
      this.log('info', 'Generation confirmed started after native click');
      return;
    }

    // Fallback 3: Dispatched Enter key on prompt
    if (promptInput) {
      (promptInput as HTMLElement).focus();
      promptInput.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true, cancelable: true,
      }));
      this.log('info', 'Fallback 3: dispatched Enter on prompt');
      await humanDelay(800, 1200);
      if (await clickWorked()) return;
    }

    this.log('warn', 'All click strategies attempted — none confirmed');
    await humanDelay(500, 1000);
  }

  // -- Control methods --

  /** Check for Flow error alerts. Returns error text or null. */
  private checkForFlowError(): string | null {
    // Check role="alert" elements
    const alertEls = document.querySelectorAll('[role="alert"]');
    for (const errorEl of alertEls) {
      if (!isVisible(errorEl)) continue;
      const errorText = errorEl.textContent?.trim() || '';
      const lower = errorText.toLowerCase();

      // Skip benign alerts
      if (lower.includes('can make mistakes') || lower.includes('double check')) continue;
      if (!errorText) continue;

      // Rate limiting
      if (lower.includes('too quickly') || lower.includes('queue full') ||
        lower.includes('limit reached') || lower.includes('exhausted') ||
        lower.includes('quota')) {
        return `Rate limited: ${errorText}`;
      }

      // Policy / content violations
      if (lower.includes('violate') || lower.includes('policies') ||
        lower.includes('blocked') || lower.includes('rejected') ||
        lower.includes('prominent people') || lower.includes('minors') ||
        lower.includes('harmful content')) {
        return `Policy violation: ${errorText}`;
      }

      // Generic errors
      if (lower.includes('error') || lower.includes('failed') || lower.includes('unable') ||
        lower.includes('cannot') || lower.includes('capacity') ||
        lower.includes('unavailable') || lower.includes('oops') ||
        matchesFlowText(lower, 'tryAgain') || lower.includes('something went wrong')) {
        return errorText;
      }
    }

    // Check for toast/snackbar notifications with errors
    const toasts = document.querySelectorAll('[class*="toast"], [class*="snackbar"], [class*="notification"]');
    for (const toast of toasts) {
      if (!isVisible(toast)) continue;
      const text = toast.textContent?.toLowerCase() || '';
      if (text.includes('failed') || text.includes('error') || text.includes('violate')) {
        return toast.textContent?.trim() || 'Unknown error';
      }
    }

    return null;
  }

  /**
   * Search all visible open menus for a download quality option and click it.
   * Uses settings.videoResolution and settings.imageResolution to pick quality.
   * Fallback order: preferred resolution → any available → generic Download.
   */
  private async findAndClickDownloadOption(): Promise<boolean> {
    const items = document.querySelectorAll('[role="menuitem"]');
    const settings = this.queue?.settings;
    const isVideo = (settings?.mediaType ?? 'video') === 'video';
    const preferredRes = isVideo
      ? (settings?.videoResolution ?? 'Original (720p)')
      : (settings?.imageResolution ?? '1K');

    let targetPreferred: Element | null = null;
    let target720p: Element | null = null;
    let target1080p: Element | null = null;
    let target4k: Element | null = null;
    let targetDownload: Element | null = null;

    for (const item of items) {
      if (!isVisible(item)) continue;
      if ((item as HTMLButtonElement).disabled ||
        item.getAttribute('aria-disabled') === 'true') continue;
      const text = item.textContent?.toLowerCase() || '';

      // Match preferred resolution
      if (preferredRes === 'Original (720p)' && text.includes('720p')) targetPreferred = item;
      else if (preferredRes === '1080p Upscaled' && text.includes('1080p')) targetPreferred = item;
      else if (preferredRes === '4K' && text.includes('4k')) targetPreferred = item;
      else if (preferredRes === '1K' && text.includes('1k')) targetPreferred = item;
      else if (preferredRes === '2K' && text.includes('2k')) targetPreferred = item;

      // Also track all quality options for fallback
      if (text.includes('720p')) target720p = item;
      else if (text.includes('1080p') && !target1080p) target1080p = item;
      else if (text.includes('4k') && !target4k) target4k = item;
      else if (/\bdownload\b/.test(text) &&
        !text.includes('270p') && !text.includes('720p') &&
        !text.includes('1080p') && !text.includes('4k')) {
        targetDownload = item;
      }
    }

    // Priority: preferred → 720p → 1080p → 4k (fallback chain)
    const directTarget = targetPreferred || target720p || target1080p || target4k;
    if (directTarget) {
      this.log('info', `Download: clicking "${directTarget.textContent?.trim().replace(/\s+/g, ' ')}" (preferred: ${preferredRes})`);
      simulateClick(directTarget);
      await humanDelay(500, 1000);
      return true;
    }

    // Quality options not visible — try "Download" menuitem
    if (targetDownload) {
      // If it has aria-haspopup="menu", hovering opens a submenu with quality options
      if (targetDownload.getAttribute('aria-haspopup') === 'menu') {
        targetDownload.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
        targetDownload.dispatchEvent(new PointerEvent('pointermove', {
          bubbles: true, view: window,
          clientX: targetDownload.getBoundingClientRect().left + 5,
          clientY: targetDownload.getBoundingClientRect().top + 5,
        }));
        await sleep(600);

        // Re-scan for quality options in the submenu — prefer configured resolution
        const subItems = document.querySelectorAll('[role="menuitem"]');
        const resKeyword = preferredRes === 'Original (720p)' ? '720p'
          : preferredRes === '1080p Upscaled' ? '1080p'
            : preferredRes === '4K' ? '4k'
              : preferredRes.toLowerCase();

        // First pass: look for preferred resolution
        for (const item of subItems) {
          if (!isVisible(item)) continue;
          const text = item.textContent?.toLowerCase() || '';
          if (text.includes(resKeyword)) {
            this.log('info', `Download: clicking ${resKeyword} from submenu`);
            simulateClick(item);
            await humanDelay(500, 1000);
            return true;
          }
        }
        // Second pass: any quality option
        for (const item of subItems) {
          if (!isVisible(item)) continue;
          const text = item.textContent?.toLowerCase() || '';
          if (text.includes('720p') || text.includes('1080p') || text.includes('4k')) {
            this.log('info', `Download: clicking ${text.trim()} from submenu (fallback)`);
            simulateClick(item);
            await humanDelay(500, 1000);
            return true;
          }
        }
      }

      // Click Download directly (default quality)
      this.log('info', 'Download: clicking Download menuitem');
      simulateClick(targetDownload);
      await humanDelay(500, 1000);
      return true;
    }

    return false;
  }

  /**
   * Navigate to the tile's edit page, click Download, then navigate back.
   * Fallback when context menu approach fails.
   *
   * Edit page DOM (from screenshot):
   *   button#radix-:rte: aria-haspopup="menu"
   *     → i.google-symbols  "download"
   *     → div               "Download"
   */
  private async tryEditPageDownload(card: Element): Promise<boolean> {
    const editLink = card.querySelector('a[href*="/edit/"]') as HTMLAnchorElement | null;
    if (!editLink?.href) return false;

    this.log('info', 'Navigating to edit page for download...');
    const returnUrl = window.location.href;

    simulateClick(editLink);
    await sleep(3000);

    // Find the Download button (google-symbols "download" icon)
    let dlBtn: Element | null = null;
    const allBtns = document.querySelectorAll('button');
    for (const btn of allBtns) {
      const icon = btn.querySelector('i.google-symbols');
      if (icon?.textContent?.trim() === 'download' && isVisible(btn)) {
        dlBtn = btn;
        break;
      }
    }

    let downloaded = false;
    if (dlBtn) {
      simulateClick(dlBtn);
      await sleep(800);

      // Look for quality options in the opened submenu
      downloaded = await this.findAndClickDownloadOption();

      if (!downloaded) {
        // The button click itself may have triggered a default download
        this.log('info', 'Download button clicked on edit page (no submenu)');
        downloaded = true;
      }
    } else {
      this.log('warn', 'Download button not found on edit page');
    }

    // Navigate back to the grid page
    await sleep(1000);
    window.history.back();
    await sleep(3000);

    // Verify we returned to the grid
    const cards = findAssetCards();
    if (cards.length === 0) {
      this.log('warn', 'Grid not found after back, navigating to saved URL');
      window.location.href = returnUrl;
      await sleep(3000);
    }

    return downloaded;
  }

  /** Dismiss any open Radix menu by sending Escape */
  private dismissOpenMenu(): void {
    document.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true, cancelable: true,
    }));
  }

  /** Trigger a download via background service worker */
  private triggerDownload(url: string, filename: string): Promise<void> {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        { type: 'DOWNLOAD_FILE', payload: { url, filename } },
        (response) => {
          if (response?.error) reject(new Error(response.error));
          else resolve();
        }
      );
    });
  }

  // â”€â”€ Control methods â”€â”€

  pause(): void {
    this.paused = true;
    this.log('info', 'Queue paused');
    this.sendQueueStatus('paused');
  }

  resume(): void {
    this.paused = false;
    this.log('info', 'Queue resumed');
    this.sendQueueStatus('running');
  }

  stop(): void {
    this.stopped = true;
    this.paused = false;
    this.log('info', 'Queue stop requested');
    // Immediately notify the UI so the user sees the state change
    this.sendQueueStatus('stopped');
  }

  /**
   * Ask the user to fix a failed prompt.
   * Sends a message to sidepanel, waits up to 2 minutes for response.
   * If no response, auto-skips.
   */
  private async promptUserForFix(prompt: PromptEntry, errorMsg: string): Promise<{ text: string; skip: boolean }> {
    const REPROMPT_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes

    return new Promise((resolve) => {
      let resolved = false;

      this.repromptResolver = (result) => {
        if (!resolved) {
          resolved = true;
          resolve(result);
        }
      };
      this.state = 'WAIT_FOR_REPROMPT';

      // Send the re-prompt request to sidepanel
      try {
        chrome.runtime.sendMessage({
          type: 'REPROMPT_NEEDED',
          payload: { promptText: prompt.text, error: errorMsg }
        }).catch(() => {});
      } catch { /* ignore */ }

      // Auto-skip after 2 minutes if user doesn't respond
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          this.log('warn', 'No response for re-prompt after 2 minutes — auto-skipping.');
          resolve({ text: prompt.text, skip: true });
        }
      }, REPROMPT_TIMEOUT_MS);
    });
  }

  /** Called by message listener when user responds to a re-prompt dialog */
  handleRepromptResponse(text: string, skip: boolean): void {
    if (this.repromptResolver) {
      this.repromptResolver({ text, skip });
      this.repromptResolver = null;
    }
  }

  /**
   * Ask the user to fix ALL failed prompts at once (batch).
   * Full mode: 5-minute countdown then auto-skip.
   * Flow mode: no timeout — user takes their time.
   */
  private async promptUserForBatchFix(
    failedPrompts: Array<{ promptIndex: number; text: string; error: string; hasImages: boolean }>
  ): Promise<Array<{ promptIndex: number; text: string; skip: boolean }>> {
    const useTimeout = this.mode === 'full';
    const BATCH_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

    return new Promise((resolve) => {
      let resolved = false;

      this.batchRepromptResolver = (results) => {
        if (!resolved) {
          resolved = true;
          resolve(results);
        }
      };
      this.state = 'WAIT_FOR_REPROMPT';

      // Send ALL failed prompts to sidepanel (include mode so panel knows about countdown)
      try {
        chrome.runtime.sendMessage({
          type: 'BATCH_REPROMPT_NEEDED',
          payload: { failedPrompts, noTimeout: !useTimeout }
        }).catch(() => {});
      } catch { /* ignore */ }

      // Auto-skip after timeout (full mode only)
      if (useTimeout) {
        setTimeout(() => {
          if (!resolved) {
            resolved = true;
            this.log('warn', `No batch re-prompt response after ${BATCH_TIMEOUT_MS / 60000} minutes — auto-skipping all.`);
            resolve(failedPrompts.map(fp => ({ promptIndex: fp.promptIndex, text: fp.text, skip: true })));
          }
        }, BATCH_TIMEOUT_MS);
      }
    });
  }

  /** Called by message listener when user responds to the batch re-prompt panel */
  handleBatchRepromptResponse(results: Array<{ promptIndex: number; text: string; skip: boolean }>): void {
    if (this.batchRepromptResolver) {
      this.batchRepromptResolver(results);
      this.batchRepromptResolver = null;
    }
  }

  skipCurrent(): void {
    if (this.queue && this.currentPromptIdx < this.queue.prompts.length) {
      this.log('info', `Skipping prompt #${this.currentPromptIdx + 1}`);
      this.updatePromptStatus(this.currentPromptIdx, 'failed', 'Skipped by user');
      this.stopped = true;
      setTimeout(() => {
        this.stopped = false;
        this.currentPromptIdx++;
        if (this.queue && this.currentPromptIdx < this.queue.prompts.length) {
          // Release run-lock before re-start since start() acquires it
          globalRunLock = false;
          this.start(this.queue);
        } else {
          globalRunLock = false;
          this.sendRunLockChanged(false);
        }
      }, 500);
    }
  }

  /**
   * Post-queue scan: wait for all tiles on the page to settle,
   * then scroll through ALL outputs; detect failures and map them
   * back to queue prompts by position.
   * Sends FAILED_TILES_RESULT to the sidepanel with failed prompt texts.
   */
  private async postQueueScan(): Promise<void> {
    this.log('info', 'Post-queue scan: waiting for all generations to finish...');

    // Scroll output area to the top so newest (potentially still generating) tiles are visible
    await scrollOutputToTop();
    if (this.stopped) return;

    // Wait for all tiles to settle (no more generating state)
    const POST_QUEUE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes max
    // Submitted timeout is short because verifyAndReprompt() handles
    // the actual verification with an active API call right after this
    const SUBMITTED_TIMEOUT_MS = 20 * 1000; // 20 seconds — don't wait long, verifyAndReprompt will handle it
    const STALE_THRESHOLD_MS = 45_000; // If generating count doesn't change for 45s, assume stale
    const startTime = Date.now();
    let lastLogTime = 0;
    let lastGeneratingCount = -1;
    let staleStartTime = 0;
    let submittedWaitStart = 0; // tracks when we first noticed submitted prompts lingering
    let domCheckCount = 0; // counter for throttled scroll-aware settlement checks
    let lastApiGenerating = -1; // track API generating count for staleness
    let apiStaleStart = 0; // when API generating count stopped changing
    const API_STALE_OVERRIDE_MS = 30_000; // after 30s of no API change, force DOM check

    while (Date.now() - startTime < POST_QUEUE_TIMEOUT_MS) {
      if (this.stopped) return;

      // ── API fast path: check if all cached generations are settled ──
      if (isApiAvailable() && isCacheFresh()) {
        const summary = getQueueSummary();

        if (summary.allSettled) {
          // Upgrade all submitted → done/failed before breaking
          await this.upgradeSubmittedFromApi();

          // Check if ANY prompts are still 'submitted' (not yet confirmed by API)
          const stillSubmitted = this.queue!.prompts.filter(p => p.status === 'submitted').length;
          if (stillSubmitted > 0) {
            // Start the submitted timeout clock on first detection
            if (submittedWaitStart === 0) submittedWaitStart = Date.now();
            const submittedElapsed = Date.now() - submittedWaitStart;

            if (submittedElapsed > SUBMITTED_TIMEOUT_MS) {
              // TIMEOUT: don't resolve here — verifyAndReprompt() will
              // handle it with an active API call (more reliable than DOM)
              this.log('info',
                `${stillSubmitted} submitted prompt(s) timed out after ${Math.round(submittedElapsed / 1000)}s — passing to verifyAndReprompt`
              );
              break;
            }

            const elapsed = Date.now() - startTime;
            if (elapsed - lastLogTime > 10000) {
              lastLogTime = elapsed;
              this.log('info',
                `API settled but ${stillSubmitted} prompt(s) still 'submitted' — ` +
                `timeout in ${Math.round((SUBMITTED_TIMEOUT_MS - submittedElapsed) / 1000)}s...`
              );
            }
            await sleep(POLL_INTERVAL_MS);
            continue;
          }

          // Reset submitted timer when all submitted are resolved
          submittedWaitStart = 0;
          this.log('info',
            `API: all generations settled (${summary.completed} ✓, ${summary.failed} ✗)` +
            (summary.credits !== null ? ` | Credits: ${summary.credits}` : '') +
            ' — skipping DOM scroll'
          );
          break;
        }

        // Live upgrade: check submitted prompts against API during wait
        await this.upgradeSubmittedFromApi();

        // ── API staleness detection ──
        // If the API generating count hasn't changed for 30s, the passive cache
        // is probably stale. Force an active refresh and check DOM as tiebreaker.
        if (summary.generating === lastApiGenerating) {
          if (apiStaleStart === 0) apiStaleStart = Date.now();
          const apiStaleMs = Date.now() - apiStaleStart;

          if (apiStaleMs > API_STALE_OVERRIDE_MS) {
            this.log('info', `API stuck at ${summary.generating} generating for ${Math.round(apiStaleMs / 1000)}s — forcing active refresh...`);
            
            // Force a fresh server call instead of relying on passive cache
            const activeMediaIds = (this.queue?.prompts || [])
              .filter(p => p.status !== 'done' && p.status !== 'queued' && p.status !== 'not-added')
              .map(p => p.mediaId)
              .filter(Boolean) as string[];
            chrome.runtime.sendMessage({ type: 'API_STATUS_CHANGED', payload: { isApiAvailable: 'checking' } }).catch(() => {});
            const refreshed = await activeStatusCheck(activeMediaIds);
            if (this.stopped) return;
            
            if (refreshed) {
              chrome.runtime.sendMessage({ type: 'API_STATUS_CHANGED', payload: { isApiAvailable: 'active' } }).catch(() => {});
              // Re-check with fresh data
              const freshSummary = getQueueSummary();
              if (freshSummary.allSettled) {
                await this.upgradeSubmittedFromApi();
                this.log('info', 'Active refresh resolved: all settled ✅');
                break;
              }
              this.log('info', `Active refresh: still ${freshSummary.generating} generating`);
            } else {
              chrome.runtime.sendMessage({ type: 'API_STATUS_CHANGED', payload: { isApiAvailable: 'fallback' } }).catch(() => {});
              const errMsg = getInterceptorError();
              this.log('warn', `Active API check failed during staleness refresh — using existing cache data${errMsg ? ` (Error: ${errMsg})` : ''}`);
            }

            // API still says generating — check DOM as tiebreaker
            chrome.runtime.sendMessage({ type: 'API_STATUS_CHANGED', payload: { isApiAvailable: 'fallback' } }).catch(() => {});
            const domSettled = await allTilesSettledWithScroll();
            if (domSettled) {
              this.log('info', 'API says generating but DOM shows all settled — trusting DOM, moving to verify phase');
              break;
            }

            // Neither agreed — reset timer and keep waiting
            apiStaleStart = Date.now();
            this.log('info', 'Both API and DOM disagree — continuing to wait...');
          }
        } else {
          lastApiGenerating = summary.generating;
          apiStaleStart = 0;
        }

        // Log API-based progress periodically
        const elapsed = Date.now() - startTime;
        if (elapsed - lastLogTime > 15000) {
          lastLogTime = elapsed;
          this.log('info',
            `Post-queue waiting... ⟳${summary.generating} ✓${summary.completed} ✗${summary.failed} (${Math.round(elapsed / 1000)}s)`
          );
        }
        await sleep(POLL_INTERVAL_MS);
        continue;
      }

      // ── API not fresh: wait and retry ──
      // Don't scroll DOM here — verifyAndReprompt() will handle everything
      // with an active API call. We just need to wait for tiles to stop generating.
      if (this.stopped) return;
      while (this.paused) {
        await sleep(500);
        if (this.stopped) return;
      }

      // DOM settlement check — use scroll-aware check periodically
      // to catch off-screen generating tiles in virtualized lists
      domCheckCount++;
      const useScrollCheck = domCheckCount % 3 === 0; // full scroll every 3rd cycle (~6s)
      const settled = useScrollCheck
        ? await allTilesSettledWithScroll()
        : allTilesSettled();
      
      if (settled) {
        // One confirmation check (always with scroll to be sure)
        await sleep(2000);
        if (this.stopped) return;
        const confirmedSettled = await allTilesSettledWithScroll();
        if (confirmedSettled) {
          const stillSubmitted = this.queue!.prompts.filter(p => p.status === 'submitted').length;
          if (stillSubmitted > 0) {
            // webRequest signal: batchGenerateImages completed — skip timeout
            if (this.imageApiSignal) {
              this.imageApiSignal = false;
              this.log('info', `webRequest confirmed image API done — resolving ${stillSubmitted} submitted prompt(s)`);
              break;
            }
            if (submittedWaitStart === 0) submittedWaitStart = Date.now();
            if (Date.now() - submittedWaitStart > SUBMITTED_TIMEOUT_MS) {
              this.log('info', `${stillSubmitted} submitted prompt(s) timed out — passing to verifyAndReprompt`);
              break;
            }
            this.log('info', `Tiles settled but ${stillSubmitted} prompt(s) still 'submitted' — waiting...`);
          } else {
            this.log('info', 'All tiles have settled (no more generating) — confirmed via scroll');
            break;
          }
        }
      }

      // Stale detection: if generating count hasn't changed, track how long
      const snap = snapshotTiles();
      if (snap.generating !== lastGeneratingCount) {
        lastGeneratingCount = snap.generating;
        staleStartTime = Date.now();
      } else if (snap.generating > 0 && Date.now() - staleStartTime > STALE_THRESHOLD_MS) {
        this.log('warn',
          `Generating count stuck at ${snap.generating} for ${Math.round(STALE_THRESHOLD_MS / 1000)}s — treating as settled`
        );
        break;
      }

      const elapsed = Date.now() - startTime;
      if (elapsed - lastLogTime > 15000) {
        lastLogTime = elapsed;
        this.log('info',
          `Post-queue waiting... generating: ${snap.generating}, completed: ${snap.completed}, ` +
          `failed: ${snap.failed}, elapsed: ${Math.round(elapsed / 1000)}s`
        );
      }

      await sleep(POLL_INTERVAL_MS);
    }

    if (this.stopped) return;

    // Don't resolve submitted or detect failures here.
    // verifyAndReprompt() handles everything with an active API call,
    // which is more reliable than DOM-based detection.
    // The old detectAndReportFailures() was marking fake cancels as
    // "failed" based on DOM tiles, which verifyAndReprompt then had to undo.

    // ── IMAGE MODE: Upgrade submitted prompts using DOM tile states ──
    // For images, the API interceptor never captures data (video-only endpoints),
    // so upgradeSubmittedFromApi() finds nothing. Use DOM tiles instead — they
    // correctly detect image completion (confirmed in AUTOFLOW15 test).
    const isImageMode = this.queue!.settings?.mediaType === 'image';
    if (isImageMode) {
      let domUpgraded = 0;
      for (let i = 0; i < this.queue!.prompts.length; i++) {
        const p = this.queue!.prompts[i];
        if (p.status !== 'submitted') continue;

        // Check tracked tile IDs from processPrompt
        if (p.tileIds && p.tileIds.length > 0) {
          const tileStates = p.tileIds.map(id => getTileStateById(id));
          const anyCompleted = tileStates.some(s => s === 'completed');
          const anyGenerating = tileStates.some(s => s === 'generating');
          const allFailed = tileStates.every(s => s === 'failed');

          if (anyCompleted) {
            this.updatePromptStatus(i, 'done');
            this.log('info', `Prompt #${i + 1}: image tile completed (DOM) ✅`);
            domUpgraded++;
          } else if (allFailed && !anyGenerating) {
            this.updatePromptStatus(i, 'failed', 'Image generation failed (DOM)');
            this.log('warn', `Prompt #${i + 1}: image tile failed (DOM) ❌`);
            domUpgraded++;
          }
        }
      }
      if (domUpgraded > 0) {
        this.log('info', `Image DOM upgrade: ${domUpgraded} prompt(s) resolved via tile states`);
      }
    }

    const leftoverSubmitted = this.queue!.prompts.filter(p => p.status === 'submitted').length;
    if (leftoverSubmitted > 0) {
      this.log('info', `Post-queue settled with ${leftoverSubmitted} submitted prompt(s) — verifyAndReprompt will resolve them`);
    }

    if (Date.now() - startTime >= POST_QUEUE_TIMEOUT_MS) {
      this.log('warn', 'Post-queue scan timed out after 5 minutes');
    }
  }

  /**
 * Scroll through the entire output grid, collect every tile's state,
 * and map results back to queue prompts using their tracked tileIds.
 *
 * Each prompt stores `tileIds: string[]` — the tile IDs that were
 * created when that prompt was submitted (captured in processPrompt).
 * We check the state of each tile directly, avoiding fragile
 * position-based mapping.
 *
 * Prompts with no tiles at all (tileIds empty or tiles not found)
 * are also flagged as failed so they can be retried.
 */
private async detectAndReportFailures(): Promise<void> {
  if (!this.queue) return;

  const failedPrompts: Array<{ promptIndex: number; text: string; error: string }> = [];
  let apiResolved = 0;
  let domResolved = 0;

  // ══════════════════════════════════════════════════════════════
  // STEP 1: API-FIRST — resolve as many prompts as possible
  //         via the interceptor cache (instant, no DOM needed)
  // ══════════════════════════════════════════════════════════════
  if (isApiAvailable()) {
    chrome.runtime.sendMessage({ type: 'API_STATUS_CHANGED', payload: { isApiAvailable: 'checking' } }).catch(() => {});
    const summary = getQueueSummary();
    this.log('info',
      `API status: ${summary.total} generations tracked ` +
      `(${summary.completed} ✓, ${summary.failed} ✗, ${summary.generating} ⟳)` +
      (summary.credits !== null ? ` | Credits: ${summary.credits}` : '')
    );

    for (let i = 0; i < this.queue.prompts.length; i++) {
      const prompt = this.queue.prompts[i];
      if (prompt.status === 'not-added') continue;

      // Don't re-check prompts already confirmed by API during processPrompt
      if (prompt.error?.startsWith('API:') || prompt.error?.includes('Safety') || prompt.error?.includes('Quota')) {
        if (prompt.status === 'failed') {
          failedPrompts.push({ promptIndex: i, text: prompt.text, error: prompt.error! });
        }
        continue;
      }

      const apiMatch = findStatusByPromptText(prompt.text);
      if (!apiMatch) continue;

      if (apiMatch.state === 'completed') {
        if (prompt.status !== 'done') {
          prompt.status = 'done';
          this.updatePromptStatus(i, 'done');
        }
        apiResolved++;
      } else if (apiMatch.state === 'failed') {
        const errorClass = await this.getLlmOrFallbackErrorClass(apiMatch.rawStatus, apiMatch.failureReason);
        prompt.status = 'failed';
        prompt.error = `API: ${apiMatch.rawStatus} [${errorClass}]`;
        this.updatePromptStatus(i, 'failed', prompt.error);
        failedPrompts.push({ promptIndex: i, text: prompt.text, error: prompt.error });
        apiResolved++;
      }
      // generating/queued: leave as-is, DOM will catch
    }

    if (apiResolved > 0) {
      this.log('info', `API resolved ${apiResolved} prompt(s) directly`);
    }
    chrome.runtime.sendMessage({ type: 'API_STATUS_CHANGED', payload: { isApiAvailable: 'active' } }).catch(() => {});
  }

  // ══════════════════════════════════════════════════════════════
  // STEP 2: DOM FALLBACK — only for prompts the API couldn't match
  // ══════════════════════════════════════════════════════════════
  const unresolvedPrompts = this.queue.prompts
    .map((p, i) => ({ prompt: p, idx: i }))
    .filter(item => {
      const p = item.prompt;
      return p.status !== 'done' && p.status !== 'failed' && p.status !== 'not-added';
    });

  if (unresolvedPrompts.length > 0) {
    chrome.runtime.sendMessage({ type: 'API_STATUS_CHANGED', payload: { isApiAvailable: 'fallback' } }).catch(() => {});
    this.log('info', `${unresolvedPrompts.length} prompt(s) unresolved by API — falling back to DOM scan`);
    const allTiles = await scrollAndCollectAllTileStates();
    this.log('info', `Collected ${allTiles.length} tile(s) on page`);

    const tileStateMap = new Map<string, string>();
    for (const t of allTiles) {
      tileStateMap.set(t.tileId, t.state);
    }

    for (const { prompt, idx } of unresolvedPrompts) {
      const ids: string[] = prompt.tileIds || [];

      if (ids.length === 0) {
        // No tracked tiles — check if it's an extension prompt
        if (prompt.isExtension && prompt.status === 'done') {
          domResolved++;
          continue;
        }
        prompt.status = 'failed';
        prompt.error = 'No output generated — no tiles found';
        this.updatePromptStatus(idx, 'failed', prompt.error);
        failedPrompts.push({ promptIndex: idx, text: prompt.text, error: prompt.error });
        domResolved++;
        continue;
      }

      let failedCount = 0, completedCount = 0, notFoundCount = 0;
      for (const id of ids) {
        const state = tileStateMap.get(id);
        if (!state) notFoundCount++;
        else if (state === 'failed') failedCount++;
        else if (state === 'completed') completedCount++;
      }

      if (failedCount > 0 && completedCount === 0) {
        prompt.status = 'failed';
        prompt.error = `Generation failed (${failedCount} tile(s) failed)`;
        this.updatePromptStatus(idx, 'failed', prompt.error);
        failedPrompts.push({ promptIndex: idx, text: prompt.text, error: prompt.error });
      } else if (completedCount > 0) {
        prompt.status = 'done';
        this.updatePromptStatus(idx, 'done');
      } else if (notFoundCount === ids.length) {
        if (prompt.isExtension && prompt.status === 'done') {
          // Extension tiles are bundled — keep as done
        } else {
          prompt.status = 'failed';
          prompt.error = 'Tiles not found on page';
          this.updatePromptStatus(idx, 'failed', prompt.error);
          failedPrompts.push({ promptIndex: idx, text: prompt.text, error: prompt.error });
        }
      }
      domResolved++;
    }
  } else {
    this.log('info', 'All prompts resolved by API — no DOM scan needed');
  }

  // ══════════════════════════════════════════════════════════════
  // STEP 3: Report results
  // ══════════════════════════════════════════════════════════════
  const done = this.queue.prompts.filter(p => p.status === 'done').length;
  const failed = this.queue.prompts.filter(p => p.status === 'failed').length;
  this.log('info',
    `Final results: ${done} done, ${failed} failed ` +
    `(API: ${apiResolved}, DOM: ${domResolved})`
  );

  this.sendFailedTilesResult(failedPrompts);
}

  /**
   * Check if a prompt's text is visible on any tile on the current page.
   * Used as a fallback when tile IDs become stale after a page refresh.
   * Searches the first 40 chars of the prompt in the page's visible text.
   */
  private isPromptVisibleOnPage(promptText: string): boolean {
    const searchText = promptText.trim().toLowerCase().slice(0, 40);
    if (searchText.length < 4) return false; // too short to be reliable
    const pageText = document.body.innerText.toLowerCase();
    return pageText.includes(searchText);
  }

  /**
   * Scan the current page for failed tiles (callable on demand via Scan Page button).
   * Scrolls through all tiles and reports failures.
   */
  async scanFailedTiles(): Promise<{ failedPrompts: Array<{ promptIndex: number; text: string; error: string }>; failedCount: number }> {
    this.log('info', 'Manual scan: scrolling through all tiles...');
    const allTiles = await scrollAndCollectAllTileStates();
    const failedTileCount = allTiles.filter(t => t.state === 'failed').length;
    const completedTileCount = allTiles.filter(t => t.state === 'completed').length;

    this.log('info', `Manual scan: ${allTiles.length} tiles total, ${completedTileCount} completed, ${failedTileCount} failed`);

    if (failedTileCount === 0) {
      this.log('info', 'No failed tiles found on page');
      this.sendFailedTilesResult([]);
      return { failedPrompts: [], failedCount: 0 };
    }

    const failedPrompts: Array<{ promptIndex: number; text: string; error: string }> = [];

    // Try position-based mapping if we have a queue
    if (this.queue) {
      const G = this.queue.settings.generations || 1;
      const doneIndices: number[] = [];
      for (let i = 0; i < this.queue.prompts.length; i++) {
        if (this.queue.prompts[i].status === 'done' || this.queue.prompts[i].status === 'failed') {
          doneIndices.push(i);
        }
      }

      const tilesForQueue = allTiles.slice(0, Math.max(doneIndices.length * G, allTiles.length - this.baselineTileCount));

      for (let g = 0; g < doneIndices.length; g++) {
        const promptIdx = doneIndices[doneIndices.length - 1 - g];
        const groupStart = g * G;
        const groupEnd = Math.min(groupStart + G, tilesForQueue.length);
        const group = tilesForQueue.slice(groupStart, groupEnd);

        if (group.length === 0) continue;
        const failedInGroup = group.filter(t => t.state === 'failed').length;

        if (failedInGroup > 0) {
          this.queue.prompts[promptIdx].status = 'failed';
          this.queue.prompts[promptIdx].error = 'Generation failed';
          this.updatePromptStatus(promptIdx, 'failed', 'Generation failed');
          failedPrompts.push({
            promptIndex: promptIdx,
            text: this.queue.prompts[promptIdx].text,
            error: 'Generation failed',
          });
        } else if (this.queue.prompts[promptIdx].status !== 'done') {
          this.queue.prompts[promptIdx].status = 'done';
          this.updatePromptStatus(promptIdx, 'done');
        }
      }

      // Include prompts already marked failed that weren't in the scan
      for (let i = 0; i < this.queue.prompts.length; i++) {
        if (this.queue.prompts[i].status === 'failed' && !failedPrompts.find(fp => fp.promptIndex === i)) {
          failedPrompts.push({
            promptIndex: i,
            text: this.queue.prompts[i].text,
            error: this.queue.prompts[i].error || 'Failed',
          });
        }
      }
    }

    // Fallback: if no queue or no mapping, report raw count
    if (failedPrompts.length === 0 && failedTileCount > 0) {
      this.log('info', `${failedTileCount} failed tile(s) detected but could not be mapped to prompts`);
      for (let i = 0; i < failedTileCount; i++) {
        failedPrompts.push({
          promptIndex: -1,
          text: `[Failed tile ${i + 1}]`,
          error: 'Generation failed',
        });
      }
    }

    this.sendFailedTilesResult(failedPrompts);
    return { failedPrompts, failedCount: failedPrompts.length };
  }

  /**
   * Click the Retry button on all failed tiles on the page.
   * This uses Flow's built-in retry mechanism (refresh icon button).
   */
  async retryFailedOnPage(): Promise<{ retried: number; total: number }> {
    // First pass: check visible tiles
    let failedTiles = findAllFailedTiles();

    // If no failed tiles visible, scroll through the entire virtualized list
    // to find off-screen failed tiles and retry them as we go
    if (failedTiles.length === 0) {
      this.log('info', 'No failed tiles visible — scrolling through page to find them...');
      const scroller = findOutputScroller();
      if (!scroller) {
        this.log('info', 'No failed tiles to retry on page');
        return { retried: 0, total: 0 };
      }

      const retriedIds = new Set<string>();
      let totalFound = 0;

      // Scroll to top first
      scroller.scrollTop = 0;
      await sleep(600);

      let prevScroll = -1;
      let stuckCount = 0;

      while (stuckCount < 3) {
        if (this.stopped) break;

        // Check for failed tiles at current scroll position
        const visibleFailed = findAllFailedTiles();
        for (const ft of visibleFailed) {
          if (retriedIds.has(ft.tileId)) continue; // already retried
          totalFound++;

          const retryBtn = findRetryButtonOnTile(ft.element);
          if (retryBtn) {
            simulateClick(retryBtn);
            retriedIds.add(ft.tileId);
            this.log('info', `Clicked retry on tile ${ft.tileId || retriedIds.size} (found while scrolling)`);
            await humanDelay(500, 1000);
          } else {
            this.log('warn', `Retry button not found on tile ${ft.tileId || 'unknown'}`);
          }
        }

        // Scroll down
        scroller.scrollBy(0, Math.max(200, scroller.clientHeight * 0.7));
        await sleep(400);

        if (Math.abs(scroller.scrollTop - prevScroll) < 5) {
          stuckCount++;
        } else {
          stuckCount = 0;
        }
        prevScroll = scroller.scrollTop;
      }

      // Final check at bottom
      const bottomFailed = findAllFailedTiles();
      for (const ft of bottomFailed) {
        if (retriedIds.has(ft.tileId)) continue;
        totalFound++;
        const retryBtn = findRetryButtonOnTile(ft.element);
        if (retryBtn) {
          simulateClick(retryBtn);
          retriedIds.add(ft.tileId);
          this.log('info', `Clicked retry on tile ${ft.tileId || retriedIds.size}`);
          await humanDelay(500, 1000);
        }
      }

      // Scroll back to top
      scroller.scrollTop = 0;

      if (retriedIds.size === 0) {
        this.log('info', 'No failed tiles to retry on page (checked all tiles via scroll)');
      } else {
        this.log('info', `Retried ${retriedIds.size} of ${totalFound} failed tile(s) via scroll`);
      }
      return { retried: retriedIds.size, total: totalFound };
    }

    // Original path: failed tiles are already visible
    this.log('info', `Retrying ${failedTiles.length} failed tile(s) on page...`);
    let retried = 0;

    for (const ft of failedTiles) {
      if (this.stopped) break;

      const retryBtn = findRetryButtonOnTile(ft.element);
      if (retryBtn) {
        simulateClick(retryBtn);
        retried++;
        this.log('info', `Clicked retry on tile ${ft.tileId || retried}`);
        await humanDelay(500, 1000);
      } else {
        this.log('warn', `Retry button not found on tile ${ft.tileId || 'unknown'}`);
      }
    }

    this.log('info', `Retried ${retried} of ${failedTiles.length} failed tile(s)`);
    return { retried, total: failedTiles.length };
  }

  private sendFailedTilesResult(failedPrompts: Array<{ promptIndex: number; text: string; error: string }>): void {
    chrome.runtime.sendMessage({
      type: 'FAILED_TILES_RESULT',
      payload: { failedPrompts, failedCount: failedPrompts.length },
    }).catch(() => { });
  }
  async retryFailed(): Promise<void> {
    if (!this.queue) return;
    for (const prompt of this.queue.prompts) {
      if (prompt.status === 'failed') {
        prompt.status = 'queued';
        prompt.attempts = 0;
        prompt.error = undefined;
      }
    }
    const firstRetry = this.queue.prompts.findIndex(p => p.status === 'queued');
    if (firstRetry >= 0) {
      this.currentPromptIdx = firstRetry;
      this.queue.currentPromptIndex = firstRetry;
      this.log('info', 'Retrying failed prompts...');
      // Release run-lock before re-start since start() acquires it
      globalRunLock = false;
      await this.start(this.queue);
    }
  }

  /**
   * Phase 2: Active API Verification + Re-prompt
   *
   * The core of the new post-queue strategy. Instead of DOM retry buttons
   * (which create untraceable duplicates), we:
   * 1. Make ONE active API call to refresh the cache
   * 2. Check each prompt by mediaId (reliable, no text guessing)
   * 3. Re-prompt truly failed prompts through processPrompt
   *    (each gets a new mediaId — fully tracked)
   */

  /**
   * Build download items from completed prompts for API-based download.
   * Returns an array of { mediaId, filename } for each downloadable video.
   */
  private buildApiDownloadItems(): Array<{ mediaId: string; filename: string }> {
    if (!this.queue) return [];

    const items: Array<{ mediaId: string; filename: string }> = [];
    const isImage = this.queue.settings?.mediaType === 'image';
    const ext = isImage ? '.png' : '.mp4';

    for (let i = 0; i < this.queue.prompts.length; i++) {
      const p = this.queue.prompts[i];
      if (p.status !== 'done' || !p.mediaId) continue;

      // Build filename: P001_G1_short_prompt_slug.mp4 (or .png for images)
      const pNum = String(i + 1).padStart(3, '0');
      const slug = p.text
        .toLowerCase()
        .replace(/[^a-z0-9 _-]/g, '')
        .trim()
        .replace(/\s+/g, '_')
        .slice(0, 30)
        .replace(/_+$/, '');
      const filename = slug
        ? `P${pNum}_G1_${slug}${ext}`
        : `P${pNum}_G1${ext}`;

      items.push({ mediaId: p.mediaId, filename });
    }

    return items;
  }

  /**
   * Verify that a media URL is actually downloadable.
   * Sends a HEAD request via the background service worker to avoid CSP issues.
   * Returns true if the URL responds with a valid video/media content type.
   */
  private async verifyMediaUrl(mediaId: string): Promise<boolean> {
    try {
      const url = `https://labs.google/fx/api/trpc/media.getMediaUrlRedirect?name=${mediaId}`;
      const resp: any = await new Promise((resolve) => {
        chrome.runtime.sendMessage(
          { type: 'VERIFY_MEDIA_URL', payload: { url } },
          (r) => resolve(r)
        );
        // Timeout — don't hang forever
        setTimeout(() => resolve({ valid: false }), 8000);
      });
      return resp?.valid === true;
    } catch {
      // If we can't verify, assume valid (fail-open for downloads)
      return true;
    }
  }

  private async verifyAndReprompt(): Promise<void> {
    if (!this.queue || this.stopped) return;

    this.sendPhaseUpdate('checking', 'Verifying results with server...');
    this.log('info', '── Phase 2: Smart Verification & Retries ──');

    // ── IMAGE MODE: Resolve submitted prompts ──
    // Strategy 1: webRequest count (works even in background tabs!)
    // Strategy 2: DOM scroll (works in foreground tabs)
    const isImageMode = this.queue!.settings?.mediaType === 'image';
    if (isImageMode) {
      const submittedCount = this.queue!.prompts.filter(p => p.status === 'submitted').length;
      if (submittedCount > 0) {
        const totalPrompts = this.queue!.prompts.length;
        const alreadyDone = this.queue!.prompts.filter(p => p.status === 'done').length;
        const apiCount = this.imageApiCompletedCount;

        this.log('info', `Image verification: ${submittedCount} submitted, ${alreadyDone} done, ${apiCount} webRequest signals received`);

        // ── Strategy 1: webRequest count ──
        // webRequest fires for EACH generation call. If we have enough 200 signals
        // to cover all prompts, we can trust the API and mark remaining as done.
        // This works even when Chrome tab is in the background!
        if (apiCount >= totalPrompts) {
          this.log('info', `webRequest signals (${apiCount}) >= total prompts (${totalPrompts}) — trusting API, marking all submitted as done`);
          for (let i = 0; i < this.queue!.prompts.length; i++) {
            if (this.queue!.prompts[i].status === 'submitted') {
              this.updatePromptStatus(i, 'done');
            }
          }
          this.log('info', `All ${submittedCount} submitted prompt(s) resolved via webRequest ✅`);
          return;
        }

        // ── Strategy 2: DOM scroll check ──
        // Scroll through the virtualized list to check all tile states
        this.log('info', `Scrolling grid to resolve remaining ${submittedCount} submitted prompt(s)...`);
        this.sendPhaseUpdate('checking', 'Scrolling grid to verify all images...');

        const allTileStates = await scrollAndCollectAllTileStates();
        let scrollResolved = 0;

        for (let i = 0; i < this.queue!.prompts.length; i++) {
          const p = this.queue!.prompts[i];
          if (p.status !== 'submitted') continue;

          if (p.tileIds && p.tileIds.length > 0) {
            for (const tid of p.tileIds) {
              const match = allTileStates.find(t => t.tileId === tid);
              if (match) {
                if (match.state === 'completed') {
                  this.updatePromptStatus(i, 'done');
                  this.log('info', `Prompt #${i + 1}: image completed (scroll) ✅`);
                  scrollResolved++;
                } else if (match.state === 'failed') {
                  this.updatePromptStatus(i, 'failed', 'Image generation failed');
                  this.log('warn', `Prompt #${i + 1}: image failed (scroll) ❌`);
                  scrollResolved++;
                }
                break;
              }
            }
          }
        }

        // ── Strategy 3: Count-based fallback ──
        const stillSubmitted = this.queue!.prompts.filter(p => p.status === 'submitted').length;
        if (stillSubmitted > 0) {
          // Check completed tile count vs expected
          const completedTiles = allTileStates.filter(t => t.state === 'completed').length;
          const nowDone = this.queue!.prompts.filter(p => p.status === 'done').length;
          const baseline = this.baselineTileCount || 0;
          const effectiveCompleted = Math.max(0, completedTiles - baseline);

          if (effectiveCompleted >= nowDone + stillSubmitted) {
            this.log('info', `Tile count resolve: ${effectiveCompleted} completed tiles — marking ${stillSubmitted} remaining as done`);
            for (let i = 0; i < this.queue!.prompts.length; i++) {
              if (this.queue!.prompts[i].status === 'submitted') {
                this.updatePromptStatus(i, 'done');
                scrollResolved++;
              }
            }
          } else if (apiCount > 0 && apiCount >= alreadyDone + scrollResolved + stillSubmitted) {
            // webRequest received enough signals even if tile count doesn't match (background tab)
            this.log('info', `webRequest fallback: ${apiCount} signals — marking ${stillSubmitted} remaining as done`);
            for (let i = 0; i < this.queue!.prompts.length; i++) {
              if (this.queue!.prompts[i].status === 'submitted') {
                this.updatePromptStatus(i, 'done');
                scrollResolved++;
              }
            }
          }
        }

        if (scrollResolved > 0) {
          this.log('info', `Image verification: ${scrollResolved} prompt(s) resolved`);
        }

        const remaining = this.queue!.prompts.filter(p => p.status === 'submitted' || p.status === 'failed').length;
        if (remaining === 0) {
          this.log('info', 'All image prompts resolved — skipping verification rounds');
          return;
        }
      }
    }

    let round = 0;
    const MAX_ROUNDS = 12;
    const cancelledPrompts: number[] = [];     // prompts saved for reload/recovery
    const lastRetriedRound = new Map<number, number>();  // promptIdx → round when last retried

    while (round < MAX_ROUNDS && !this.stopped) {
      round++;
      this.log('info', `── Verification Round ${round}/${MAX_ROUNDS} ──`);

      // ─── Step 1: Refresh API cache with ONE active call ───
      const activeMediaIds = this.queue.prompts
        .filter(p => p.status !== 'done' && p.status !== 'queued' && p.status !== 'not-added')
        .map(p => p.mediaId)
        .filter(Boolean) as string[];

      if (activeMediaIds.length > 0) {
        this.log('info', `Checking active Google Flow API for status of ${activeMediaIds.length} prompt(s)...`);
        const refreshed = await activeStatusCheck(activeMediaIds);
        if (this.stopped) return;
        if (refreshed) {
          this.log('info', `Active API check successful: refreshed statuses with fresh server data.`);
          await sleep(1000);
        } else {
          const errMsg = getInterceptorError();
          let friendlyDetail = 'Make sure the tab is open and you have generated at least 1 video/image in this session to let the helper capture your credentials.';
          if (errMsg?.includes('not captured yet')) {
            friendlyDetail = 'API credentials not captured yet. Please manually generate one video/image or refresh the page to let the helper sync.';
          }
          this.log('warn', `Active API check passive: using DOM fallback. ${friendlyDetail}${errMsg ? ` (Technical info: ${errMsg})` : ''}`);
        }
      }

      // ─── Step 2: Classify and process non-done/non-failed prompts ───
      let apiConfirmedDone = 0;
      let apiConfirmedFailed = 0;
      let noApiData = 0;
      const toRetryViaDom: number[] = [];       // prompts to retry via DOM retry button
      let pendingVerificationCount = 0;

      for (let i = 0; i < this.queue.prompts.length; i++) {
        const p = this.queue.prompts[i];
        if (p.status === 'done' || p.status === 'queued' || p.status === 'not-added') continue;
        // Skip prompts already confirmed dead and queued for reload recovery.
        // Without this, a dead prompt would re-trigger the 2-minute CDN poll every round.
        if (cancelledPrompts.includes(i)) continue;
        if (this.stopped) return;

        pendingVerificationCount++;

        // Look up in API cache
        let apiMatch: FlowGenerationStatus | null = null;
        if (p.mediaId) apiMatch = findStatusByMediaId(p.mediaId);
        if (!apiMatch) apiMatch = findStatusByPromptText(p.text);

        if (apiMatch) {
          if (apiMatch.state === 'completed') {
            // API says completed — verify the download URL is real
            const urlValid = p.mediaId ? await this.verifyMediaUrl(p.mediaId) : false;
            if (urlValid) {
              this.updatePromptStatus(i, 'done');
              this.log('info', `Prompt #${i + 1}: COMPLETED + URL valid ✅`);
              apiConfirmedDone++;
              pendingVerificationCount--;
            } else if (!p.mediaId) {
              // No mediaId — can't verify, trust API
              this.updatePromptStatus(i, 'done');
              this.log('info', `Prompt #${i + 1}: COMPLETED (no mediaId to verify) ✅`);
              apiConfirmedDone++;
              pendingVerificationCount--;
            } else if ((p.attempts || 0) < 3) {
              if (this.mode === 'full') {
                this.log('warn', `Prompt #${i + 1}: API says COMPLETED but URL dead (Full Mode) — re-submitting immediately...`);
                p.attempts = (p.attempts || 0) + 1;
                await this.processPrompt(p, i);
              } else {
                // URL dead — queue for DOM retry
                this.log('warn', `Prompt #${i + 1}: API says COMPLETED but URL dead — queue for retry`);
                toRetryViaDom.push(i);
              }
            } else {
              // Exhausted retries — mark failed
              this.updatePromptStatus(i, 'failed', 'URL dead after 3 attempts');
              this.log('warn', `Prompt #${i + 1}: URL dead after 3 attempts ❌`);
              apiConfirmedFailed++;
              pendingVerificationCount--;
            }

          } else if (apiMatch.state === 'failed') {
            const errorClass = await this.getLlmOrFallbackErrorClass(apiMatch.rawStatus, apiMatch.failureReason);
            if (errorClass === 'safety' || errorClass === 'quota') {
              this.updatePromptStatus(i, 'failed', `API: ${apiMatch.rawStatus} [${errorClass}]`);
              this.log('warn', `Prompt #${i + 1}: FAILED ❌ (${errorClass}) — no retry`);
              apiConfirmedFailed++;
              pendingVerificationCount--;
            } else if (errorClass === 'cancelled') {
              // "Cancelled" is usually a FAKE cancel — video exists eventually.
              // Poll the CDN URL for up to 2 minutes (similar to active waiting)
              if (p.mediaId) {
                this.log('info', `Prompt #${i + 1}: API reported cancelled, polling CDN URL for fake cancel rescue...`);
                this.sendPhaseUpdate('checking', `Checking if cancelled prompt #${i + 1} exists on CDN...`);

                const MAX_CANCEL_POLL_MS = 2 * 60 * 1000; // 2 minutes
                const POLL_MS = 10_000; // check every 10s
                const pollStart = Date.now();
                let urlValid = false;

                while (Date.now() - pollStart < MAX_CANCEL_POLL_MS && !this.stopped) {
                  urlValid = await this.verifyMediaUrl(p.mediaId);
                  if (urlValid) break;

                  const elapsed = Math.round((Date.now() - pollStart) / 1000);
                  this.log('info', `Prompt #${i + 1}: URL check empty (elapsed ${elapsed}s/120s, waiting ${POLL_MS / 1000}s)...`);
                  await sleep(POLL_MS);
                }

                if (urlValid) {
                  this.updatePromptStatus(i, 'done');
                  this.log('info', `Prompt #${i + 1}: CANCELLED but URL valid → fake cancel rescued successfully ✅`);
                  apiConfirmedDone++;
                  pendingVerificationCount--;
                } else {
                  // Truly cancelled (URL remained dead after 2 minutes)
                  if (this.mode === 'full') {
                    if ((p.attempts || 0) < 3) {
                      this.log('info', `Prompt #${i + 1}: CANCELLED + URL dead after 2m (Full Mode) — re-submitting immediately...`);
                      p.attempts = (p.attempts || 0) + 1;
                      await this.processPrompt(p, i);
                    } else {
                      this.updatePromptStatus(i, 'failed', 'Cancelled and exhausted all retry attempts');
                      this.log('warn', `Prompt #${i + 1}: CANCELLED + URL dead after 2m and exhausted retry attempts ❌`);
                      apiConfirmedFailed++;
                      pendingVerificationCount--;
                    }
                  } else {
                    if (!cancelledPrompts.includes(i)) cancelledPrompts.push(i);
                    this.log('info', `Prompt #${i + 1}: CANCELLED + URL dead after 2m → will re-submit after reload`);
                    pendingVerificationCount--;
                  }
                }
              } else {
                // No mediaId — can't verify, save for reload verification
                if (this.mode === 'full') {
                  if ((p.attempts || 0) < 3) {
                    this.log('info', `Prompt #${i + 1}: CANCELLED (no mediaId) (Full Mode) — re-submitting immediately...`);
                    p.attempts = (p.attempts || 0) + 1;
                    await this.processPrompt(p, i);
                  } else {
                    this.updatePromptStatus(i, 'failed', 'Cancelled and exhausted all retry attempts');
                    this.log('warn', `Prompt #${i + 1}: CANCELLED (no mediaId) and exhausted retry attempts ❌`);
                    apiConfirmedFailed++;
                    pendingVerificationCount--;
                  }
                } else {
                  if (!cancelledPrompts.includes(i)) cancelledPrompts.push(i);
                  this.log('info', `Prompt #${i + 1}: CANCELLED (no mediaId) — will verify after reload`);
                  pendingVerificationCount--;
                }
              }
            } else {
              // Server error
              if (this.mode === 'full') {
                if ((p.attempts || 0) < 3) {
                  this.log('info', `Prompt #${i + 1}: API says failed [${errorClass}] (Full Mode) — re-submitting immediately...`);
                  p.attempts = (p.attempts || 0) + 1;
                  await this.processPrompt(p, i);
                } else {
                  this.updatePromptStatus(i, 'failed', `API: failed [${errorClass}] and exhausted all retry attempts`);
                  this.log('warn', `Prompt #${i + 1}: API says failed [${errorClass}] and exhausted retry attempts ❌`);
                  apiConfirmedFailed++;
                  pendingVerificationCount--;
                }
              } else {
                this.log('info', `Prompt #${i + 1}: API says failed [${errorClass}] — will check DOM for retry button`);
                toRetryViaDom.push(i);
              }
            }

          } else if (apiMatch.state === 'generating' || apiMatch.state === 'queued') {
            // Still generating — but check DOM first: if the DOM shows the tiles are
            // already settled (failed/cancelled/completed), the API cache is STALE.
            // This happens when activeStatusCheck fails and we're reading old data.
            let routedToRetry = false;

            // Universal DOM tiebreaker — applies to ALL modes
            const domAlreadySettled = allTilesSettled();
            if (domAlreadySettled) {
              this.log('info', `Prompt #${i + 1}: API says "${apiMatch.state}" but DOM already settled — skipping wait, routing to retry`);
              toRetryViaDom.push(i);
              pendingVerificationCount--;
              routedToRetry = true;
              continue;
            }

            // Specific tile check — look for the actual tile in DOM
            const activeTiles = findAssetCards().filter(el => isVisible(el));
            const promptNeedle = p.text.trim().toLowerCase().slice(0, 40);
            let tileForPromptExists = false;
            let tileIsGenerating = false;

            for (const tile of activeTiles) {
              const tileText = tile.textContent?.toLowerCase() || '';
              const tileId = (tile as HTMLElement).dataset?.tileId || '';
              const isMatch = (p.tileIds && p.tileIds.includes(tileId)) ||
                              tileText.includes(promptNeedle) ||
                              promptNeedle.includes(tileText.slice(0, 40));
              
              if (isMatch) {
                tileForPromptExists = true;
                const state = getTileState(tile);
                if (state === 'generating') {
                  tileIsGenerating = true;
                }
                break;
              }
            }

            if (activeTiles.length > 0 && !tileForPromptExists) {
              this.log('warn', `Prompt #${i + 1}: Tile is completely missing (cancelled/deleted in DOM) — routing to retry`);
              toRetryViaDom.push(i);
              pendingVerificationCount--;
              routedToRetry = true;
              continue;
            }
            
            if (activeTiles.length > 0 && tileForPromptExists && !tileIsGenerating) {
              this.log('info', `Prompt #${i + 1}: Tile found but is no longer generating (completed/failed in DOM) — routing to retry`);
              toRetryViaDom.push(i);
              pendingVerificationCount--;
              routedToRetry = true;
              continue;
            }

            if (!routedToRetry) {
              if (round === MAX_ROUNDS) {
                // Final round timeout!
                if (this.mode === 'full') {
                  if ((p.attempts || 0) < 3) {
                    this.log('warn', `Prompt #${i + 1}: still generating after timeout (Full Mode) — re-submitting immediately...`);
                    p.attempts = (p.attempts || 0) + 1;
                    await this.processPrompt(p, i);
                    pendingVerificationCount--;
                  } else {
                    this.updatePromptStatus(i, 'failed', 'Stuck generating after timeout and exhausted retry attempts');
                    this.log('warn', `Prompt #${i + 1}: Stuck generating and exhausted retry attempts ❌`);
                    apiConfirmedFailed++;
                    pendingVerificationCount--;
                  }
                } else {
                  if (!cancelledPrompts.includes(i)) cancelledPrompts.push(i);
                  this.log('warn', `Prompt #${i + 1}: still generating after timeout — will verify after page reload`);
                  pendingVerificationCount--;
                }
              } else {
                // Not final round yet — log and let it continue generating in parallel
                this.log('info', `Prompt #${i + 1}: still ${apiMatch.state}... (Round ${round}/${MAX_ROUNDS})`);
                this.sendPhaseUpdate('checking', `Waiting for prompt #${i + 1} to finish generating...`);
              }
            }
          }
        } else {
          // No API data at all — Google may have DROPPED cancelled entries from the response.
          // Before re-submitting or routing to DOM, check if the video actually exists on CDN.
          // This is the most common case for fake cancels: API has no entry but video is available.
          noApiData++;

          // ── IMAGE MODE: Trust DOM tile states instead of re-submitting ──
          // The API interceptor never captures image generation traffic (video-only endpoints),
          // so ALL image prompts land here with no API data and no mediaId.
          // DOM detection works perfectly for images (confirmed: AUTOFLOW15 test saw
          // "completed: 6" correctly). Trust it instead of destructively re-submitting.
          const isImageMode = this.queue!.settings?.mediaType === 'image';
          if (isImageMode) {
            let resolvedViaDom = false;
            if (p.tileIds && p.tileIds.length > 0) {
              const tileStates = p.tileIds.map(id => getTileStateById(id));
              const anyCompleted = tileStates.some(s => s === 'completed');
              const allFailed = tileStates.every(s => s === 'failed');

              if (anyCompleted) {
                this.updatePromptStatus(i, 'done');
                this.log('info', `Prompt #${i + 1}: image completed (DOM tile check) ✅`);
                apiConfirmedDone++;
                pendingVerificationCount--;
                resolvedViaDom = true;
              } else if (allFailed) {
                if ((p.attempts || 0) < 3) {
                  this.log('info', `Prompt #${i + 1}: image failed (DOM) — re-submitting...`);
                  p.attempts = (p.attempts || 0) + 1;
                  await this.processPrompt(p, i);
                  pendingVerificationCount--;
                } else {
                  this.updatePromptStatus(i, 'failed', 'Image generation failed after 3 attempts');
                  this.log('warn', `Prompt #${i + 1}: image failed after 3 attempts ❌`);
                  apiConfirmedFailed++;
                  pendingVerificationCount--;
                }
                resolvedViaDom = true;
              }
            }

            if (!resolvedViaDom) {
              // No tileIds or tiles not in DOM — mark done optimistically
              // (images are fast, if tiles settled in postQueueScan they completed)
              this.updatePromptStatus(i, 'done');
              this.log('info', `Prompt #${i + 1}: image — no tile tracking, marking done (tiles settled in scan) ✅`);
              apiConfirmedDone++;
              pendingVerificationCount--;
            }
            continue;
          }

          if (p.mediaId) {
            this.log('info', `Prompt #${i + 1}: NOT FOUND in API — checking CDN URL for fake cancel rescue...`);
            this.sendPhaseUpdate('checking', `Checking if prompt #${i + 1} exists on CDN (no API data)...`);

            const MAX_CANCEL_POLL_MS = 2 * 60 * 1000; // 2 minutes
            const POLL_MS = 10_000;
            const pollStart = Date.now();
            let urlValid = false;

            while (Date.now() - pollStart < MAX_CANCEL_POLL_MS && !this.stopped) {
              urlValid = await this.verifyMediaUrl(p.mediaId);
              if (urlValid) break;

              const elapsed = Math.round((Date.now() - pollStart) / 1000);
              this.log('info', `Prompt #${i + 1}: CDN URL empty (elapsed ${elapsed}s/120s, waiting ${POLL_MS / 1000}s)...`);
              await sleep(POLL_MS);
            }

            if (urlValid) {
              this.updatePromptStatus(i, 'done');
              this.log('info', `Prompt #${i + 1}: NOT in API but URL valid → fake cancel rescued ✅`);
              apiConfirmedDone++;
              pendingVerificationCount--;
              continue;
            }
          }

          // URL dead or no mediaId — fall back to re-submission/DOM retry
          if ((p.attempts || 0) < 3) {
            if (this.mode === 'full') {
              this.log('info', `Prompt #${i + 1}: NOT FOUND in API + URL dead (Full Mode) — re-submitting...`);
              p.attempts = (p.attempts || 0) + 1;
              await this.processPrompt(p, i);
              pendingVerificationCount--;
            } else {
              this.log('info', `Prompt #${i + 1}: NOT FOUND in API + URL dead — will check DOM`);
              toRetryViaDom.push(i);
              pendingVerificationCount--;
            }
          } else {
            this.updatePromptStatus(i, 'failed', 'Not found on server after 3 attempts');
            this.log('warn', `Prompt #${i + 1}: NOT FOUND after 3 attempts ❌`);
            apiConfirmedFailed++;
            pendingVerificationCount--;
          }
        }
      }

      this.log('info',
        `Verification Round ${round} results: ✅${apiConfirmedDone} confirmed done, ❌${apiConfirmedFailed} failed, ` +
        `🔄${toRetryViaDom.length} to check DOM, ❓${noApiData} no API data`
      );

      // If nothing to retry via DOM/API and no pending verification, break the rounds loop
      if (toRetryViaDom.length === 0 && pendingVerificationCount === 0) {
        this.log('info', 'No active/submitted prompts remaining to verify and no failed prompts to retry.');
        break;
      }

      // ─── Step 3: DOM retry — find failed tiles and click retry buttons ───
      this.sendPhaseUpdate('retrying', `Checking ${toRetryViaDom.length} prompt(s) in DOM...`);
      const failedTiles = await findAllFailedTilesWithScroll();
      this.log('info', `DOM scan (with scroll) found ${failedTiles.length} failed tile(s) on page`);

      const retriedIndicesInThisRound: number[] = [];

      for (const idx of toRetryViaDom) {
        if (this.stopped) break;
        const prompt = this.queue.prompts[idx];

        // Cooldown: skip prompts retried in the previous round — their generation
        // is likely still running and we'd just re-click retry on an active tile.
        const prevRetryRound = lastRetriedRound.get(idx);
        if (prevRetryRound && round - prevRetryRound < 2) {
          this.log('info', `Prompt #${idx + 1}: skipping DOM retry (retried ${round - prevRetryRound} round(s) ago, waiting for result)`);
          continue;
        }
        const promptNeedle = prompt.text.trim().toLowerCase().slice(0, 40);

        // Find the matching failed tile by prompt text
        let matchedTile: FailedTileInfo | null = null;
        for (const ft of failedTiles) {
          const tileText = ft.element.textContent?.toLowerCase() || '';
          if (tileText.includes(promptNeedle) || promptNeedle.includes(tileText.slice(0, 40))) {
            matchedTile = ft;
            break;
          }
        }

        // Also try matching by tileId
        if (!matchedTile && prompt.tileIds && prompt.tileIds.length > 0) {
          for (const ft of failedTiles) {
            if (prompt.tileIds.includes(ft.tileId)) {
              matchedTile = ft;
              break;
            }
          }
        }

        if (!matchedTile) {
          // No matching tile in DOM — could be a tile that disappeared. Check URL if we have mediaId
          if (prompt.mediaId) {
            const urlValid = await this.verifyMediaUrl(prompt.mediaId);
            if (urlValid) {
              this.updatePromptStatus(idx, 'done');
              this.log('info', `Prompt #${idx + 1}: no DOM tile but URL valid ✅`);
              continue;
            }
          }
          // Truly missing — tile gone + URL dead
          if (this.mode === 'full') {
            if ((prompt.attempts || 0) < 3) {
              this.log('info', `Prompt #${idx + 1}: tile missing + URL dead (Full Mode) — re-submitting...`);
              prompt.attempts = (prompt.attempts || 0) + 1;
              await this.processPrompt(prompt, idx);
              retriedIndicesInThisRound.push(idx);
              lastRetriedRound.set(idx, round);
            } else {
              this.updatePromptStatus(idx, 'failed', 'Tile missing and exhausted all retry attempts');
              this.log('warn', `Prompt #${idx + 1}: tile missing + URL dead and exhausted retries ❌`);
            }
          } else {
            if (!cancelledPrompts.includes(idx)) cancelledPrompts.push(idx);
            this.log('warn', `Prompt #${idx + 1}: no tile found + URL dead — saved for post-reload retry`);
            pendingVerificationCount--;
          }
          continue;
        }

        // Found the tile — check if it has a retry button
        let retryBtn = findRetryButtonOnTile(matchedTile.element);

        if (!retryBtn) {
          // Fallback: If Detail View is open, the button is in the main panel (body), not inside the sidebar card
          this.log('info', `Prompt #${idx + 1}: No retry button inside tile element. Selecting tile to check Detail View...`);
          simulateClick(matchedTile.element);
          await sleep(1500); // wait for Detail View to switch
          retryBtn = findRetryButtonOnTile(document.body);
        }

        if (retryBtn) {
          // Guard: check if we've exhausted retry attempts
          if ((prompt.attempts || 0) >= 3) {
            this.updatePromptStatus(idx, 'failed', 'Failed after 3 retry attempts');
            this.log('warn', `Prompt #${idx + 1}: retry button found but exhausted all 3 attempts ❌`);
            continue;
          }
          // Click retry
          this.log('info', `Prompt #${idx + 1}: clicking retry button (attempt ${(prompt.attempts || 0) + 1}/3)...`);
          onBeforeSubmit();
          simulateClick(retryBtn);
          prompt.attempts = (prompt.attempts || 0) + 1;
          this.updatePromptStatus(idx, 'submitted');
          retriedIndicesInThisRound.push(idx);
          lastRetriedRound.set(idx, round);
          await sleep(4000); // Wait for new tile and API payload to be sniffed
          
          // Capture new mediaId
          const newEntries = getNewSubmissions();
          if (newEntries.length > 0) {
            const match = newEntries.find(e => 
              e.promptText.toLowerCase().includes(prompt.text.toLowerCase().slice(0, 30)) ||
              prompt.text.toLowerCase().includes(e.promptText.toLowerCase().slice(0, 30))
            );
            if (match) {
              prompt.mediaId = match.mediaId;
              this.log('info', `Prompt #${idx + 1}: captured new mediaId after retry: ${prompt.mediaId}`);
            }
          }
        } else {
          // No retry button — cancelled tile.
          // But the video might actually exist (fake cancel).
          // Run CDN URL verification before giving up.
          if (prompt.mediaId) {
            this.log('info', `Prompt #${idx + 1}: cancelled tile (no retry button) — checking CDN URL for fake cancel rescue...`);
            this.sendPhaseUpdate('checking', `Checking if cancelled prompt #${idx + 1} exists on CDN...`);

            const MAX_CANCEL_POLL_MS = 2 * 60 * 1000; // 2 minutes
            const POLL_MS = 10_000;
            const pollStart = Date.now();
            let urlValid = false;

            while (Date.now() - pollStart < MAX_CANCEL_POLL_MS && !this.stopped) {
              urlValid = await this.verifyMediaUrl(prompt.mediaId);
              if (urlValid) break;

              const elapsed = Math.round((Date.now() - pollStart) / 1000);
              this.log('info', `Prompt #${idx + 1}: CDN URL empty (elapsed ${elapsed}s/120s, waiting ${POLL_MS / 1000}s)...`);
              await sleep(POLL_MS);
            }

            if (urlValid) {
              this.updatePromptStatus(idx, 'done');
              this.log('info', `Prompt #${idx + 1}: cancelled tile but URL valid → fake cancel rescued ✅`);
              continue;
            }
          }

          // URL dead or no mediaId
          if (this.mode === 'full') {
            // Full mode: re-submit immediately (same as API cancelled path)
            if ((prompt.attempts || 0) < 3) {
              this.log('info', `Prompt #${idx + 1}: cancelled tile + URL dead (Full Mode) — re-submitting immediately...`);
              prompt.attempts = (prompt.attempts || 0) + 1;
              await this.processPrompt(prompt, idx);
              retriedIndicesInThisRound.push(idx);
              lastRetriedRound.set(idx, round);
            } else {
              this.updatePromptStatus(idx, 'failed', 'Cancelled and exhausted all retry attempts (no retry button)');
              this.log('warn', `Prompt #${idx + 1}: cancelled tile + URL dead and exhausted retry attempts ❌`);
            }
          } else {
            // Flow/Lite mode: save for post-reload recovery
            if (!cancelledPrompts.includes(idx)) cancelledPrompts.push(idx);
            this.log('warn', `Prompt #${idx + 1}: cancelled tile + URL dead — scheduling re-submission after reload recovery`);
          }
        }
      }

      if (retriedIndicesInThisRound.length > 0 && !this.stopped) {
        // Only scroll to top if we are NOT in the detail view
        const btns = Array.from(document.querySelectorAll('button'));
        const isDetailViewOpen = !!btns.find(b => {
          const t = b.textContent?.trim().toLowerCase() || '';
          return (matchesFlowText(t, 'done') || exactMatchFlowText(t, 'showHistory') || exactMatchFlowText(t, 'hideHistory')) && isVisible(b);
        });

        if (!isDetailViewOpen) {
          this.log('info', 'Not in Detail View: scrolling grid to top to monitor generating tiles...');
          await scrollOutputToTop();
        } else {
          this.log('info', 'In Detail View: skipping scrollOutputToTop to preserve selection scroll position.');
        }
        this.sendPhaseUpdate('retrying', `Waiting for ${retriedIndicesInThisRound.length} retry/retries to finish...`);
        const retryStart = Date.now();
        const RETRY_TIMEOUT = 5 * 60 * 1000; // 5 minutes max
        const POLL_MS = 10_000;

        let allSettled = false;
        while (Date.now() - retryStart < RETRY_TIMEOUT && !this.stopped && !allSettled) {
          await sleep(POLL_MS);

          // Refresh status for the retried prompts
          const retriedMediaIds = retriedIndicesInThisRound
            .map(idx => this.queue!.prompts[idx].mediaId)
            .filter(Boolean) as string[];
          if (retriedMediaIds.length > 0) {
            const refreshed = await activeStatusCheck(retriedMediaIds);
            if (!refreshed) {
              const errMsg = getInterceptorError();
              let friendlyDetail = 'Make sure the tab is open and you have generated at least 1 video/image in this session.';
              if (errMsg?.includes('not captured yet')) {
                friendlyDetail = 'API credentials not captured yet. Please manually generate one video/image or refresh the page to let the helper sync.';
              }
              this.log('warn', `Active API check passive during retry check: using DOM fallback. ${friendlyDetail}${errMsg ? ` (Technical info: ${errMsg})` : ''}`);
            }
          }

          let pendingRetries = 0;
          for (const idx of retriedIndicesInThisRound) {
            const p = this.queue.prompts[idx];
            let apiMatch: FlowGenerationStatus | null = null;
            if (p.mediaId) apiMatch = findStatusByMediaId(p.mediaId);
            if (!apiMatch) apiMatch = findStatusByPromptText(p.text);

            if (apiMatch && (apiMatch.state === 'generating' || apiMatch.state === 'queued')) {
              pendingRetries++;
            }
          }

          if (pendingRetries === 0 || allTilesSettled()) {
            this.log('info', 'All retried prompts in this round have finished generating.');
            allSettled = true;
          } else {
            this.log('info', `Waiting for ${pendingRetries} retried prompt(s)... (${Math.round((Date.now() - retryStart) / 1000)}s elapsed)`);
          }
        }
      }

      // If there are still pending/generating prompts, sleep for 15 seconds before starting the next round
      if (pendingVerificationCount > 0 && !this.stopped && round < MAX_ROUNDS) {
        const SLEEP_MS = 15000; // 15 seconds
        this.log('info', `Waiting ${SLEEP_MS / 1000}s before Verification Round ${round + 1}/${MAX_ROUNDS}...`);
        await sleep(SLEEP_MS);
      }
    }

    // ─── Step 4: Final checks & cleanup ───
    const finalDone = this.queue.prompts.filter(p => p.status === 'done').length;
    const finalFailed = this.queue.prompts.filter(p => p.status === 'failed').length;
    const finalQueued = this.queue.prompts.filter(p => p.status === 'queued').length;
    const finalSubmitted = this.queue.prompts.filter(p => p.status === 'submitted').length;
    this.log('info',
      `All verification rounds complete: ✅${finalDone} done, ❌${finalFailed} failed, 📋${finalQueued} queued for reload, 📤${finalSubmitted} submitted`
    );

    // Resolve any lingering submitted prompts
    if (finalSubmitted > 0) {
      const unresolvedIndices = await this.resolveSubmittedViaDom();
      if (unresolvedIndices.length > 0) {
        for (const idx of unresolvedIndices) {
          if (!cancelledPrompts.includes(idx)) cancelledPrompts.push(idx);
        }
        this.log('info', `${unresolvedIndices.length} unresolved submitted prompt(s) added to reload recovery`);
      }
    }

    // ─── Step 5: Save ALL unverified / cancelled prompts for post-reload recovery ───
    const finalRecoveryIndices = cancelledPrompts.filter(idx => {
      const p = this.queue!.prompts[idx];
      return p.status !== 'done' && p.status !== 'failed';
    });

    if (finalRecoveryIndices.length > 0 && !this.stopped) {
      this.log('info', `${finalRecoveryIndices.length} prompt(s) need post-reload verification`);
      this.sendPhaseUpdate('recovering', `Verifying ${finalRecoveryIndices.length} prompt(s) after reload...`);
      for (const idx of finalRecoveryIndices) {
        const p = this.queue.prompts[idx];
        if ((p.attempts || 0) >= 3) {
          // Exhausted retries — mark hard failed
          p.status = 'failed';
          p.error = 'Failed after 3 retry attempts';
          this.updatePromptStatus(idx, 'failed', p.error);
        } else {
          p.status = 'queued';
          p.error = undefined;
          p.tileIds = [];
          this.updatePromptStatus(idx, 'queued');
        }
      }
      
      const queuedRemaining = this.queue.prompts.filter(p => p.status === 'queued').length;
      if (queuedRemaining > 0) {
        try {
          await saveRunningQueue(this.queue, this.queue.prompts.length, true, this.baselineTileCount);
          this.log('info', `Saved ${queuedRemaining} unverified prompts for post-reload recovery`);
        } catch { /* ignore */ }
      }
    }

    // Report failures to sidepanel
    const failedPrompts = this.queue.prompts
      .map((p, i) => ({ prompt: p, idx: i }))
      .filter(item => item.prompt.status === 'failed')
      .map(item => ({
        promptIndex: item.idx,
        text: item.prompt.text,
        error: item.prompt.error || 'Unknown error',
      }));
    this.sendFailedTilesResult(failedPrompts);
  }

  /**
   * Resolve 'submitted' prompts that timed out waiting for API confirmation.
   * This happens when a DOM retry creates a new generation that our API
   * interceptor can't track (new entry, different media ID).
   *
   * Strategy: API first → if API confirms completed, mark done.
   * For server errors or no API data, route to post-reload recovery
   * instead of marking done blindly.
   *
   * Returns indices of prompts that need post-reload verification.
   */
  private async resolveSubmittedViaDom(): Promise<number[]> {
    if (!this.queue) return [];

    let resolved = 0;
    const needsReload: number[] = [];

    for (let i = 0; i < this.queue.prompts.length; i++) {
      const p = this.queue.prompts[i];
      if (p.status !== 'submitted') continue;

      // 1. Try API one last time (uses improved multi-fragment matching)
      let apiMatch: FlowGenerationStatus | null = null;
      if (p.mediaId) apiMatch = findStatusByMediaId(p.mediaId);
      if (!apiMatch) apiMatch = findStatusByPromptText(p.text);

      if (apiMatch?.state === 'completed') {
        this.updatePromptStatus(i, 'done');
        this.log('info', `Prompt #${i + 1}: resolved via API → done ✅`);
        resolved++;
        continue;
      }
      if (apiMatch?.state === 'failed') {
        const errorClass = await this.getLlmOrFallbackErrorClass(apiMatch.rawStatus, apiMatch.failureReason);
        // Only mark as hard-failed if safety/quota/cancelled confirmed
        if (errorClass === 'safety' || errorClass === 'quota') {
          this.updatePromptStatus(i, 'failed', `API: ${apiMatch.rawStatus} [${errorClass}]`);
          this.log('warn', `Prompt #${i + 1}: resolved via API → failed ❌ (${errorClass})`);
          resolved++;
        } else if (errorClass === 'cancelled') {
          // Cancelled = no retry button → needs re-submission after reload
          needsReload.push(i);
          this.log('info', `Prompt #${i + 1}: cancelled → will re-submit after reload`);
        } else {
          // Server/unknown failure — route to reload verification
          // Don't mark done blindly — let the tile scanner confirm after reload
          needsReload.push(i);
          this.log('info', `Prompt #${i + 1}: API says failed [${errorClass}] — will verify after reload`);
        }
        continue;
      }

      // 2. No API data at all — route to reload verification.
      // Don't mark done optimistically — the tile scanner will confirm.
      needsReload.push(i);
      this.log('info', `Prompt #${i + 1}: no API data — will verify after reload`);
    }

    this.log('info', `resolveSubmittedViaDom: ${resolved} confirmed, ${needsReload.length} need reload verification`);
    return needsReload;
  }

  /**
   * Upgrade 'submitted' prompts to 'done' or 'failed' using API cache.
   * Uses mediaId for direct lookup (reliable), falls back to text matching.
   * Called during postQueueScan to provide live status updates.
   */
  private async upgradeSubmittedFromApi(): Promise<void> {
    if (!this.queue) return;
    if (!isApiAvailable()) {
      const submittedCount = this.queue.prompts.filter(p => p.status === 'submitted').length;
      if (submittedCount > 0) {
        this.log('warn', `API not available — ${submittedCount} prompt(s) stuck as 'submitted'`);
      }
      return;
    }

    let upgraded = 0;

    for (let i = 0; i < this.queue.prompts.length; i++) {
      const prompt = this.queue.prompts[i];
      if (prompt.status !== 'submitted') continue;

      // Strategy 1: Direct mediaId lookup (reliable, no guessing)
      let apiMatch: FlowGenerationStatus | null = null;
      if (prompt.mediaId) {
        apiMatch = findStatusByMediaId(prompt.mediaId);
      }

      // Strategy 2: Text matching fallback (for prompts without mediaId)
      if (!apiMatch) {
        apiMatch = findStatusByPromptText(prompt.text);
      }

      if (!apiMatch) {
        // Only log periodically to avoid spam
        continue;
      }

      if (apiMatch.state === 'completed') {
        this.updatePromptStatus(i, 'done');
        this.log('info', `Prompt #${i + 1}: API confirms video ready ✅${prompt.mediaId ? ' [mediaId]' : ' [text]'}`);
        upgraded++;
      } else if (apiMatch.state === 'failed') {
        const errorClass = await this.getLlmOrFallbackErrorClass(apiMatch.rawStatus, apiMatch.failureReason);
        // Don't mark server/cancelled errors as hard-failed
        // Cancelled is usually a FAKE cancel — video exists after reload
        // Leave as 'submitted' so verifyAndReprompt can URL-check it
        if (errorClass === 'safety' || errorClass === 'quota') {
          const error = `API: ${apiMatch.rawStatus} [${errorClass}]`;
          this.updatePromptStatus(i, 'failed', error);
          this.log('warn', `Prompt #${i + 1}: API confirms failed ❌ (${errorClass})`);
          upgraded++;
        }
        // server/unknown: leave as 'submitted' — verifyAndReprompt will handle it
      }
      // generating/queued: leave as 'submitted', still rendering
    }
  }

  private async getLlmOrFallbackErrorClass(rawStatus: string, failureReason?: string): Promise<'safety' | 'server' | 'cancelled' | 'quota' | 'unknown'> {
    try {
      const errorText = `${rawStatus} ${failureReason || ''}`.trim();
      const result = await classifyGenerationError(errorText);
      if (result.classification === 'safety') return 'safety';
      if (result.classification === 'quota') return 'quota';
      if (result.classification === 'fake_cancel') return 'cancelled';
      if (result.classification === 'transient') return 'server';
      return 'unknown';
    } catch {
      return classifyError(rawStatus, failureReason);
    }
  }

  // ── Messaging helpers ──

  private log(level: 'info' | 'warn' | 'error', message: string): void {
    const entry = {
      timestamp: Date.now(),
      level,
      message,
      queueId: this.queue?.id,
      promptIndex: this.currentPromptIdx,
    };
    console.log(`[AutoFlow] [${level.toUpperCase()}] ${message}`);
    chrome.runtime.sendMessage({ type: 'LOG', payload: entry }).catch(() => { });
  }

  private sendQueueStatus(status: string, promptIndex?: number): void {
    chrome.runtime.sendMessage({
      type: 'QUEUE_STATUS_UPDATE',
      payload: {
        queueId: this.queue?.id,
        status,
        currentPromptIndex: promptIndex ?? this.currentPromptIdx,
        isApiAvailable: isApiAvailable(),
      },
    }).catch(() => { });
  }

  private updatePromptStatus(idx: number, status: string, error?: string, outputFiles?: string[]): void {
    if (this.queue) {
      this.queue.prompts[idx].status = status as any;
      if (error !== undefined) this.queue.prompts[idx].error = error;
      if (outputFiles) this.queue.prompts[idx].outputFiles = outputFiles;
    }
    chrome.runtime.sendMessage({
      type: 'PROMPT_STATUS_UPDATE',
      payload: {
        queueId: this.queue?.id,
        promptIndex: idx,
        status,
        error,
        outputFiles,
        attempts: this.queue?.prompts[idx]?.attempts,
        credits: getRemainingCredits(),
        isApiAvailable: isApiAvailable(),
      },
    }).catch(() => { });
  }

  /** Send a phase update to the sidepanel so the monitor can show what's happening */
  private sendPhaseUpdate(phase: string, detail?: string): void {
    chrome.runtime.sendMessage({
      type: 'QUEUE_PHASE_UPDATE',
      payload: {
        queueId: this.queue?.id,
        phase,
        detail: detail || '',
      },
    }).catch(() => { });
  }

  private sendRunLockChanged(locked: boolean): void {
    chrome.runtime.sendMessage({
      type: 'RUN_LOCK_CHANGED',
      payload: { locked },
    }).catch(() => { });
  }

  private sendQueueSummary(done: number, failed: number, skipped: number): void {
    chrome.runtime.sendMessage({
      type: 'QUEUE_SUMMARY',
      payload: {
        queueId: this.queue?.id,
        queueName: this.queue?.name,
        totalPrompts: this.queue?.prompts.length,
        done,
        failed,
        skipped,
        credits: getRemainingCredits(),
      },
    }).catch(() => { });
  }
}
