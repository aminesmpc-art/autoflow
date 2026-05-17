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
  Message,
  ImageMeta,
  InputMethod,
} from '../types';
import { savePromptHistory, saveRunningQueue, clearRunningQueue } from '../shared/storage';
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
  getTileState,
  findAllFailedTiles,
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

  /** Start processing a queue */
  async start(queue: QueueObject): Promise<void> {
    // â”€â”€ Run-lock check â”€â”€
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

    this.log('info', `Starting queue "${queue.name}" with ${queue.prompts.length} prompts`);
    this.sendQueueStatus('running');

    // Save prompt order for library sorting (so retries keep correct position)
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

    // â”€â”€ Apply settings once at queue start (mode, ratio, generations, model) â”€â”€
    await this.ensurePageReady();
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
    const visibleTiles = findAssetCards().filter(el => isVisible(el));
    this.baselineTileCount = visibleTiles.length;
    this.log('info', `Baseline tiles on page: ${this.baselineTileCount}`);

    let doneCount = 0;
    let failedCount = 0;

    for (let i = this.currentPromptIdx; i < this.queue.prompts.length; i++) {
      if (this.stopped) break;
      while (this.paused) {
        await sleep(500);
        if (this.stopped) break;
      }
      if (this.stopped) break;

      this.currentPromptIdx = i;
      this.sendQueueStatus('running', i);

      const prompt = this.queue.prompts[i];
      await this.processPrompt(prompt, i);

      if (prompt.status === 'done') doneCount++;
      else if (prompt.status === 'failed') failedCount++;

      // Save progress so we can resume after a page reload
      try {
        await saveRunningQueue(this.queue, i + 1);
      } catch { /* ignore storage errors */ }

      // Verify page is still usable before next prompt
      if (!this.stopped && i < this.queue.prompts.length - 1) {
        await this.ensurePageReady(this.queue.prompts[i + 1]);
      }
    }

    // Post-queue: wait for all generations to settle and detect failures
    if (!this.stopped) {
      // IMPORTANT: If the queue ended on an extension prompt, the Detail View is still open.
      // We MUST close it to un-freeze the background grid so that the post-queue scan
      // can see the tiles from all the other prompts in the queue!
      this.log('info', 'Queue complete. Ensuring we are on the main grid before final scan...');
      await this.ensurePageReady();
      await this.postQueueScan();
    }

    // ── Auto-retry failed tiles (up to 3 rounds) ──
    const MAX_RETRY_ROUNDS = 3;
    if (!this.stopped) {
      for (let round = 1; round <= MAX_RETRY_ROUNDS; round++) {
        // Count failures after scan
        const failedNow = this.queue.prompts.filter(p => p.status === 'failed').length;
        if (failedNow === 0) {
          this.log('info', 'All prompts succeeded — no retries needed.');
          break;
        }

        this.log('info', `Auto-retry round ${round}/${MAX_RETRY_ROUNDS}: ${failedNow} failed prompt(s), retrying on page...`);

        // Click retry on all failed tiles on the page
        const retryResult = await this.retryFailedOnPage();
        if (this.stopped) break;

        if (retryResult.retried === 0) {
          this.log('warn', `Auto-retry round ${round}: no retry buttons found on page, stopping retries.`);
          break;
        }

        this.log('info', `Auto-retry round ${round}: clicked retry on ${retryResult.retried} tile(s). Waiting for them to finish...`);

        // Wait for all tiles to settle again
        await this.postQueueScan();
        if (this.stopped) break;
      }
    }

    // Recount after post-queue scan + retries
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
      this.log('info', 'Queue complete — triggering auto library scan...');
      try {
        chrome.runtime.sendMessage({
          type: 'AUTO_SCAN_LIBRARY',
          payload: { queueName: this.queue.name },
        }).catch(() => {});
      } catch { /* ignore */ }
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

        // ── Wait the configured "Video creation wait time" after clicking Generate ──
        // During the wait, poll the tracked tiles for early failure detection.
        this.state = 'WAIT_BETWEEN_PROMPTS';
        const minSec = this.queue!.settings.waitMinSec ?? this.queue!.settings.waitBetweenPromptsSec ?? 10;
        const maxSec = this.queue!.settings.waitMaxSec ?? minSec;
        const waitSec = minSec + Math.random() * Math.max(0, maxSec - minSec);
        const totalWaitMs = Math.max(0, waitSec * 1000 - 2000); // subtract tile snapshot delay
        this.log('info', `Generation started. Waiting ${waitSec.toFixed(1)}s before next prompt (range: ${minSec}-${maxSec}s)...`);

        // Poll during the wait to detect early failures.
        // IMPORTANT: Don't check too early — tiles can briefly show as "failed"
        // during initialization (3-6s after Generate). We enforce a 15s grace
        // period so Flow has time to fully start the generation.
        const FAILURE_GRACE_MS = 15_000;
        const waitStart = Date.now();
        let earlyFailure = false;
        while (Date.now() - waitStart < totalWaitMs) {
          if (this.stopped) return;
          await sleep(2000); // check every 2 seconds

          // Check if the tiles created by this prompt have failed,
          // but only after the grace period has elapsed.
          const elapsed = Date.now() - waitStart;
          if (newTileIds.length > 0 && elapsed >= FAILURE_GRACE_MS) {
            const tileStates = checkTileStates(newTileIds);
            if (tileStates.failed > 0 && tileStates.generating === 0) {
              // All tiles have settled and at least one failed
              this.log('warn', `Prompt #${idx + 1}: detected ${tileStates.failed} failed tile(s) during wait (${tileStates.completed} completed)`);
              if (tileStates.completed === 0) {
                // ALL tiles failed — mark prompt as failed
                earlyFailure = true;
                break;
              }
              // Some completed, some failed — still mark as done but log warning
              this.log('warn', `Prompt #${idx + 1}: partial failure — ${tileStates.completed} completed, ${tileStates.failed} failed`);
              break;
            }
          }
        }
        if (this.stopped) return;

        if (earlyFailure) {
          // Collect error text from the failed tiles
          const failedTiles = findAllFailedTiles();
          const thisTileFailed = failedTiles.find(ft => newTileIds.includes(ft.tileId));
          const errorMsg = thisTileFailed?.errorText || 'Generation failed (detected during wait)';
          throw new Error(errorMsg);
        }

        // State: MARK_DONE — prompt is "done" once generation was kicked off
        this.state = 'MARK_DONE';
        prompt.attempts = attempts + 1;
        this.updatePromptStatus(idx, 'done');
        this.log('info', `Prompt #${idx + 1} — generation started, moving to next prompt`);
        return;

      } catch (err: any) {
        attempts++;
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

        // Backoff before retry
        const backoff = BACKOFF_BASE_MS * Math.pow(2, attempts - 1);
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
         const t = b.textContent?.trim().toLowerCase() || '';
         return (t.includes('done') || t.includes('fermer') || t.includes('close')) && isVisible(b);
      });
      const closeIconBtns = Array.from(document.querySelectorAll('button[aria-label="Close"], button[aria-label="Back"]'));
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

      // 2. Now that we are sure the Detail View is closed, look for the main prompt input.
      const promptInput = findPromptInput();
      if (promptInput && isVisible(promptInput)) {
        this.log('info', 'Page ready — prompt input visible');
        return;
      }

      // Check if we landed on the homepage — look for "+ New project" button
      // Only click it once to avoid re-clicking during page transition
      if (!clickedNewProject) {
        const newProjectBtn = queryButtonByText('new project');
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
      return (t.includes('done') || t === 'hide history' || t === 'show history') && isVisible(b);
    });
    
    let isParentInHistorySidebar = false;
    
    if (isDetailViewOpen) {
      // First, ensure the history sidebar is actually expanded so we can see the steps
      const showHistoryBtn = btns.find(b => (b.textContent?.trim().toLowerCase() || '') === 'show history' && isVisible(b));
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
               retryBtn = stateEl.querySelector('button[aria-label*="retry"], button[aria-label*="Retry"]') || null;
               if (!retryBtn) {
                 const currentBtns = Array.from(document.querySelectorAll('button'));
                 retryBtn = currentBtns.find(b => (b.textContent||'').toLowerCase().includes('retry')) || null;
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
    const searchInput = document.querySelector('input[placeholder*="Search"]') as HTMLInputElement;
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

    // Check both toggles while the panel is open
    await this.ensureToggleOn('clear prompt on submit');
    await this.ensureToggleOn('show tile details');

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
          if (container?.textContent?.toLowerCase().includes('clear prompt on submit')) {
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
  private async ensureToggleOn(toggleLabel: string): Promise<void> {
    if (this.stopped) return;

    // The view settings panel should already be open (called from ensureToggles)
    // But verify — if it closed between toggles, reopen
    if (!isViewSettingsOpen()) {
      const opened = await this.openViewSettingsPanel();
      if (!opened || this.stopped) return;
    }

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
        if (ancestorText.includes(toggleLabel.toLowerCase())) {
          // Make sure this ancestor does NOT also contain other toggle labels —
          // if it does, we're too high up. Keep walking to find a tighter match.
          // But if it contains only our target, we found the right row.
          const otherToggles = ['sound on hover', 'show tile details', 'clear prompt on submit']
            .filter(t => t !== toggleLabel.toLowerCase());
          const containsOthers = otherToggles.some(t => ancestorText.includes(t));
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
        this.log('info', `${toggleLabel}: already ON`);
        return;
      }

      // Click it ON
      simulateClick(btn);
      this.log('info', `Enabled "${toggleLabel}"`);
      await humanDelay(300, 500);
      return;
    }

    this.log('info', `${toggleLabel} toggle not found (may already be ON)`);
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
   * Search for an asset by filename and attach it.
   * Flow: Open "+" dialog → type filename → press Enter → image attaches.
   */
  private async searchAndSelectAsset(filename: string, addBtn: HTMLElement): Promise<boolean> {
    if (this.stopped) return false;

    await this.dismissDialogs();
    await sleep(300);

    // Re-find the add button (prefer fresh DOM lookup)
    const btn = (findIngredientAttachButton() as HTMLElement) || addBtn;
    btn.scrollIntoView({ block: 'center', behavior: 'instant' });
    await sleep(200);

    // Open "+" dialog — simulateClick first, nativeClick as fallback
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

    // Switch to Image tab if not already active
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

    // Find search input, type filename, press Enter
    const searchInput = document.querySelector('input[placeholder*="Search"]') as HTMLInputElement;
    if (!searchInput) {
      this.log('warn', 'Search input not found in dialog');
      return false;
    }

    searchInput.focus();
    searchInput.value = '';
    searchInput.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(100);

    await setInputValue(searchInput, filename);
    await sleep(100);

    searchInput.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter', code: 'Enter', keyCode: 13,
      bubbles: true, cancelable: true,
    }));
    searchInput.dispatchEvent(new KeyboardEvent('keyup', {
      key: 'Enter', code: 'Enter', keyCode: 13,
      bubbles: true, cancelable: true,
    }));

    this.log('info', `Searched "${filename}" + Enter — attached!`);
    await sleep(500);

    return true;
  }

  /**
   * Attach frame images (Start / End) in Frames creation mode.
   * images[0] → Start frame, images[1] → End frame (optional).
   * Each slot is a div[type="button"][aria-haspopup="dialog"] with text "Start" or "End".
   * Clicking it opens the same "Search for Assets" dialog used for ingredients.
   */
  private async attachFrameImages(images: ImageMeta[], promptIdx: number): Promise<boolean> {
    if (images.length === 0) return true;

    this.log('info', `Attaching ${images.length} frame image(s) for prompt #${promptIdx + 1}`);

    // Get all image blobs from sidepanel
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

      this.log('info', `Clicking "${slot.label}" frame button...`);

      // 1. Find and click the frame button (Start or End)
      const frameBtn = findFrameButton(slot.label);
      if (!frameBtn) {
        this.log('warn', `Cannot find "${slot.label}" frame button`);
        return false;
      }

      // Try simulateClick first (handles Radix pointerdown+mousedown)
      simulateClick(frameBtn);
      await humanDelay(400, 700);

      // 2. Wait for the asset search dialog to appear
      let dialog = findAssetSearchDialog();
      if (!dialog) {
        // Retry with nativeClick
        nativeClick(frameBtn);
        await humanDelay(500, 800);
        dialog = findAssetSearchDialog();
      }
      if (!dialog) {
        this.log('warn', `Dialog did not open after clicking "${slot.label}"`);
        return false;
      }

      // 3. Click upload button inside dialog
      let uploadClicked = false;
      const allBtns = dialog.querySelectorAll('button');
      for (const btn of allBtns) {
        // Check for Google Symbols icon with "upload" text
        const icon = btn.querySelector('i.google-symbols, i.material-icons, .google-symbols');
        if (icon && icon.textContent?.trim() === 'upload') {
          nativeClick(btn);
          this.log('info', `Clicked upload button in ${slot.label} dialog`);
          uploadClicked = true;
          break;
        }
      }

      // Fallback: click the first visible button that isn't a menu trigger
      if (!uploadClicked) {
        for (const btn of allBtns) {
          const btnEl = btn as HTMLElement;
          if (btnEl.getAttribute('aria-haspopup') === 'menu') continue;
          if (btnEl.getAttribute('aria-label')?.toLowerCase().includes('close')) continue;
          if (!isVisible(btnEl)) continue;
          const btnText = (btnEl.textContent || '').trim();
          if (btnText.toLowerCase().includes('recently') || btnText.toLowerCase().includes('close')) continue;
          nativeClick(btnEl);
          this.log('info', `Clicked fallback upload button in ${slot.label} dialog`);
          uploadClicked = true;
          break;
        }
      }
      await sleep(300);

      // 4. Upload the image via file input
      const fileInput = findFileInput();
      if (!fileInput) {
        this.log('warn', `No file input found for ${slot.label} frame`);
        await this.dismissDialogs();
        return false;
      }

      const blob = this.base64ToBlob(fileData.data, fileData.mime);
      const file = new File([blob], fileData.filename, { type: fileData.mime });
      const dt = new DataTransfer();
      dt.items.add(file);
      fileInput.files = dt.files;
      triggerFileInputChange(fileInput);
      this.log('info', `Uploaded ${slot.label} frame: ${fileData.filename}`);

      // 5. Wait for the image to be processed/attached
      await humanDelay(2000, 4000);

      // 6. Dismiss any remaining dialogs
      await this.dismissDialogs();
      await humanDelay(500, 800);
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
        lower.includes('try again') || lower.includes('something went wrong')) {
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
    const POST_QUEUE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes max
    const startTime = Date.now();
    let lastLogTime = 0;

    while (Date.now() - startTime < POST_QUEUE_TIMEOUT_MS) {
      if (this.stopped) return;
      while (this.paused) {
        await sleep(500);
        if (this.stopped) return;
      }

      // Scroll to top before checking — generating tiles are at the top
      await scrollOutputToTop();
      if (this.stopped) return;

      if (allTilesSettled()) {
        // Double-check with a full scroll to catch off-screen generating tiles
        await sleep(2000);
        if (this.stopped) return;
        const fullySettled = await allTilesSettledWithScroll();
        if (this.stopped) return;
        if (fullySettled) {
          this.log('info', 'All tiles have settled (no more generating)');
          break;
        }
      }

      const elapsed = Date.now() - startTime;
      if (elapsed - lastLogTime > 15000) {
        lastLogTime = elapsed;
        const snap = snapshotTiles();
        this.log('info',
          `Post-queue waiting... generating: ${snap.generating}, completed: ${snap.completed}, ` +
          `failed: ${snap.failed}, elapsed: ${Math.round(elapsed / 1000)}s`
        );
      }

      await sleep(POLL_INTERVAL_MS);
    }

    if (this.stopped) return;

    if (Date.now() - startTime >= POST_QUEUE_TIMEOUT_MS) {
      this.log('warn', 'Post-queue scan timed out after 10 minutes');
    }

    // Now scroll through ALL tiles and detect failures by position
    if (!this.stopped) {
      await this.detectAndReportFailures();
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

  this.log('info', 'Scrolling through output grid to collect all tile states...');
  const allTiles = await scrollAndCollectAllTileStates();
  this.log('info', `Collected ${allTiles.length} total tile(s) on page`);

  // Build a map of tileId → state for fast lookup
  const tileStateMap = new Map<string, string>();
  for (const t of allTiles) {
    tileStateMap.set(t.tileId, t.state);
  }

  const failedPrompts: Array<{ promptIndex: number; text: string; error: string }> = [];
  let updatedCount = 0;

  for (let i = 0; i < this.queue.prompts.length; i++) {
    const prompt = this.queue.prompts[i];

    // Skip prompts that were already marked failed during processPrompt (e.g. paste/fill errors)
    if (prompt.status === 'failed' && prompt.error && !prompt.error.includes('Generation failed')) {
      failedPrompts.push({
        promptIndex: i,
        text: prompt.text,
        error: prompt.error,
      });
      continue;
    }

    // Skip prompts that never ran (still in 'not-added' or 'queued' state)
    if (prompt.status === 'not-added') continue;

    const ids: string[] = prompt.tileIds || [];

    // Case 1: Prompt has NO tracked tiles — it never produced output
    if (ids.length === 0) {
      if (prompt.isExtension && prompt.status === 'done') {
        this.log('info', `Extension prompt #${i + 1} has no tracked tiles but was marked done. Keeping status as done.`);
        updatedCount++;
        continue;
      }
      
      prompt.status = 'failed';
      prompt.error = 'No output generated — no tiles found for this prompt';
      this.updatePromptStatus(i, 'failed', prompt.error);
      failedPrompts.push({ promptIndex: i, text: prompt.text, error: prompt.error });
      updatedCount++;
      continue;
    }

    // Case 2: Check the state of each tracked tile
    let failedCount = 0;
    let completedCount = 0;
    let generatingCount = 0;
    let notFoundCount = 0;

    for (const id of ids) {
      const state = tileStateMap.get(id);
      if (!state) {
        // Tile not found on page — may have been removed or page scrolled past it
        notFoundCount++;
      } else if (state === 'failed') {
        failedCount++;
      } else if (state === 'completed') {
        completedCount++;
      } else if (state === 'generating') {
        generatingCount++;
      }
    }

    if (failedCount > 0 && completedCount === 0) {
      // All tiles failed
      prompt.status = 'failed';
      prompt.error = `Generation failed (${failedCount} tile(s) failed)`;
      this.updatePromptStatus(i, 'failed', prompt.error);
      failedPrompts.push({ promptIndex: i, text: prompt.text, error: prompt.error });
      updatedCount++;
    } else if (failedCount > 0) {
      // Partial failure
      const errMsg = `Partial failure: ${completedCount} completed, ${failedCount} failed`;
      prompt.status = 'failed';
      prompt.error = errMsg;
      this.updatePromptStatus(i, 'failed', errMsg);
      failedPrompts.push({ promptIndex: i, text: prompt.text, error: errMsg });
      updatedCount++;
    } else if (notFoundCount === ids.length) {
      if (prompt.isExtension && prompt.status === 'done') {
        // This is an extension prompt. It is bundled into a chain tile and its original ID
        // is not visible on the main grid. Since executeExtendPhase already waited and verified it,
        // we can safely assume it is still 'done'.
        this.log('info', `Extension prompt #${i + 1} tiles not found on main grid (expected), keeping status as done.`);
        updatedCount++;
        continue;
      }
      
      // All tiles disappeared from the page
      prompt.status = 'failed';
      prompt.error = 'No output found on page — tiles may have been removed';
      this.updatePromptStatus(i, 'failed', prompt.error);
      failedPrompts.push({ promptIndex: i, text: prompt.text, error: prompt.error });
      updatedCount++;
    } else if (completedCount > 0) {
      // All good — mark as done
      prompt.status = 'done';
      this.updatePromptStatus(i, 'done');
      updatedCount++;
    }
    // If still generating, leave status as-is (will be caught on next scan)
  }

  this.log('info',
    `Post-queue analysis complete: ${updatedCount} prompt(s) updated, ` +
    `${failedPrompts.length} total failure(s)`
  );

  this.sendFailedTilesResult(failedPrompts);
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

  // â”€â”€ Messaging helpers â”€â”€

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
      },
    }).catch(() => { });
  }
}
