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
  findRetryButtonOnTile,
  allTilesSettled,
  getAllTileIds,
  checkTileStates,
  scrollAndCollectAllTileStates,
  scrollOutputToTop,
  allTilesSettledWithScroll,
} from './selectors';
import type { TileSnapshot, FailedTileInfo } from './selectors';

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

      // Verify page is still usable before next prompt
      if (!this.stopped && i < this.queue.prompts.length - 1) {
        await this.ensurePageReady();
      }
    }

    // Post-queue: wait for all generations to settle and detect failures
    if (!this.stopped) {
      await this.postQueueScan();
    }

    // Recount after post-queue scan (some done prompts may now be failed)
    doneCount = this.queue.prompts.filter(p => p.status === 'done').length;
    failedCount = this.queue.prompts.filter(p => p.status === 'failed').length;

    // â”€â”€ Queue summary â”€â”€
    const totalPrompts = this.queue.prompts.length;
    const skipped = totalPrompts - doneCount - failedCount;
    const summary = `Queue "${this.queue.name}" finished â€” Done: ${doneCount}, Failed: ${failedCount}, Skipped: ${skipped}`;

    if (this.stopped) {
      this.log('info', `Queue "${this.queue.name}" stopped by user. ${summary}`);
      this.sendQueueStatus('stopped');
    } else {
      this.log('info', summary);
      this.sendQueueStatus('completed');
    }

    this.sendQueueSummary(doneCount, failedCount, skipped);
    this.state = 'IDLE';

    // â”€â”€ Release run-lock â”€â”€
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
   * wait and check repeatedly. If we detect we're on the homepage (no
   * project), click "+ New project" to get back into a creation view.
   */
  private async ensurePageReady(): Promise<void> {
    const maxWait = 15000; // 15 seconds
    const start = Date.now();

    while (Date.now() - start < maxWait) {
      if (this.stopped) return;

      const promptInput = findPromptInput();
      if (promptInput && isVisible(promptInput)) {
        this.log('info', 'Page ready â€” prompt input visible');
        return;
      }

      // Check if we landed on the homepage â€” look for "+ New project" button
      const newProjectBtn = queryButtonByText('new project');
      if (newProjectBtn && isVisible(newProjectBtn)) {
        this.log('info', 'Detected Flow homepage. Clicking "+ New project" to continue...');
        simulateClick(newProjectBtn);
        await sleep(3000); // wait for new project to load
        // New projects reset toggles — ensure they're ON
        await this.ensureToggles();
        continue;
      }

      this.log('info', 'Waiting for page to be ready (prompt input not found yet)...');
      await sleep(2000);
    }

    this.log('warn', 'Page may not be ready â€” prompt input not found after waiting');
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
    const strategies: Array<{ name: string; fn: () => boolean }> = [
      {
        name: 'native .click()',
        fn: () => { nativeClick(trigger); return true; },
      },
      {
        name: 'React onPointerDown',
        fn: () => {
          const ok = reactTrigger(trigger, 'onPointerDown');
          if (!ok) this.log('info', 'No React onPointerDown handler found');
          return ok;
        },
      },
      {
        name: 'React onClick',
        fn: () => {
          const ok = reactTrigger(trigger, 'onClick');
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
      const fired = strategy.fn();

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
            const ok = reactTrigger(item, 'onMouseDown');
            if (!ok) reactTrigger(item, 'onPointerDown');
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

    // 2. Select creation type (Ingredients / Frames)
    const creationLabel = settings.creationType === 'frames' ? 'Frames' : 'Ingredients';
    await applyMenuItem(creationLabel, `Creation: ${creationLabel}`);
    if (this.stopped) return false;

    if (settings.mediaType === 'image') {
      // 3a. Set image model via nested dropdown (e.g. "Nano Banana 2", "Imagen 4")
      // The model selector is a sub-dropdown inside the settings menu — use setModel()
      // instead of applyMenuItem() to handle the nested menu correctly.
      await this.setModel(settings.imageModel);
      if (this.stopped) return false;

      // 3b. Set image ratio (e.g. "Landscape (16:9)")
      await applyMenuItem(settings.imageRatio, `Image Ratio: ${settings.imageRatio}`);
      if (this.stopped) return false;
    } else {
      // 3. Set orientation (Landscape / Portrait)
      const orientationLabel = settings.orientation === 'portrait' ? 'Portrait' : 'Landscape';
      await applyMenuItem(orientationLabel, `Orientation: ${orientationLabel}`);
      if (this.stopped) return false;

      // 5. Set model (video models)
      await this.setModel(settings.model);
      if (this.stopped) return false;
      await humanDelay(200, 400);
    }

    // 4. Set generations count
    await applyMenuItem(`x${settings.generations}`, `Generations: x${settings.generations}`);
    if (this.stopped) return false;

    // 6. Ensure critical toggles are ON
    await this.ensureToggles();

    // Close the settings panel
    await this.closeSettingsPanel();

    this.log('info', 'All settings applied');
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
    const strategies: Array<{ name: string; fn: () => boolean }> = [
      { name: 'simulateClick', fn: () => { simulateClick(trigger); return true; } },
      { name: 'native .click()', fn: () => { nativeClick(trigger); return true; } },
      {
        name: 'React onPointerDown',
        fn: () => {
          const ok = reactTrigger(trigger, 'onPointerDown');
          return ok;
        },
      },
    ];

    for (const strategy of strategies) {
      if (isViewSettingsOpen()) return true;

      this.log('info', `Opening view settings via: ${strategy.name}`);
      const fired = strategy.fn();
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
    const expectMedia = chipText.includes(settings.mediaType);
    const expectGen = chipText.includes(`x${settings.generations}`);

    if (!expectMedia || !expectGen) {
      this.log('info', `Settings chip "${trigger.textContent?.trim()}" doesn't match expected. Re-applying...`);
      await this.applyAllSettings(settings);
    }
    // If they match, settings are still correct â€” no action needed.
  }

  private async setModel(modelName: string): Promise<void> {
    if (this.stopped) return;
    // The model dropdown is INSIDE the settings panel — make sure it's open
    if (!isSettingsPanelOpen()) {
      const opened = await this.openSettingsPanel();
      if (!opened || this.stopped) {
        this.log('warn', 'Could not open settings panel to set model');
        return;
      }
      await humanDelay(300, 600);
    }
    if (this.stopped) return;

    // Model dropdown is a separate Radix menu button inside the panel
    const trigger = findModelSelectorTrigger();
    if (!trigger) {
      this.log('warn', 'Model dropdown not found. Using Flow default.');
      return;
    }

    const currentModelRaw = trigger.textContent?.trim() || '';
    const currentModelNorm = normalizeForModelMatch(currentModelRaw);
    const targetNorm = normalizeForModelMatch(modelName);
    if (currentModelNorm.includes(targetNorm)) {
      this.log('info', `Model already set: ${currentModelRaw}`);
      return;
    }

    // Open the model dropdown — try multiple strategies
    simulateClick(trigger);
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
      nativeClick(trigger);
      await humanDelay(600, 1000);
      if (this.stopped) return;
      menuItems = findModelOptions();
    }
    if (!menuItems || menuItems.length === 0) {
      reactTrigger(trigger, 'onPointerDown');
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
   * Upload a single batch of images via the asset dialog.
   * Returns true if the expected number of chips appeared.
   */
  private async uploadImageBatch(
    batch: any[],
    expectedTotalChips: number,
    batchIdx: number,
    totalBatches: number
  ): Promise<boolean> {
    // 1. Click "+" to open dialog
    const addBtn = findIngredientAttachButton();
    if (!addBtn) {
      this.log('warn', 'Cannot find "+" ingredient button');
      return false;
    }

    nativeClick(addBtn);
    await sleep(600);

    let dialog = findAssetSearchDialog();
    if (!dialog) {
      simulateClick(addBtn);
      await sleep(600);
      dialog = findAssetSearchDialog();
    }
    if (!dialog) {
      this.log('warn', 'Dialog did not open');
      return false;
    }

    // 2. Click upload button inside dialog
    const allBtns = dialog.querySelectorAll('button');
    for (const btn of allBtns) {
      const icon = btn.querySelector('i.google-symbols');
      if (icon && icon.textContent?.trim() === 'upload') {
        nativeClick(btn);
        this.log('info', 'Clicked upload button');
        break;
      }
    }
    await sleep(400);

    // 3. Upload batch via file input
    const fileInput = findFileInput();
    if (!fileInput) {
      this.log('warn', 'No file input found');
      await this.dismissDialogs();
      return false;
    }

    const dt = new DataTransfer();
    for (const fileData of batch) {
      const blob = this.base64ToBlob(fileData.data, fileData.mime);
      const file = new File([blob], fileData.filename, { type: fileData.mime });
      dt.items.add(file);
    }
    fileInput.files = dt.files;
    triggerFileInputChange(fileInput);
    this.log('info', `Uploaded ${batch.length} file(s) in batch ${batchIdx + 1}/${totalBatches}`);

    // 4. Wait for chips — dynamic timeout: base 30s + 10s per image in batch
    const maxWaitMs = Math.max(30000, batch.length * 15000);
    const pollMs = 1000;
    const startWait = Date.now();
    let chipsNow = findIngredientChips().length;

    while (Date.now() - startWait < maxWaitMs) {
      if (this.stopped) return false;
      await sleep(pollMs);
      chipsNow = findIngredientChips().length;

      if (chipsNow >= expectedTotalChips) {
        this.log('info', `Batch ${batchIdx + 1}: ${chipsNow} chips present (needed ${expectedTotalChips})`);
        break;
      }

      const elapsed = Date.now() - startWait;
      if (elapsed % 5000 < pollMs) {
        this.log('info', `Waiting for batch ${batchIdx + 1}... ${chipsNow}/${expectedTotalChips} chips (${Math.round(elapsed / 1000)}s)`);
      }
    }

    // Dismiss dialog before next batch
    await this.dismissDialogs();
    await sleep(500);

    // Verify this batch
    const chipsAfter = findIngredientChips().length;
    if (chipsAfter >= expectedTotalChips) {
      this.log('info', `Batch ${batchIdx + 1} complete: ${chipsAfter} chips present`);
      return true;
    }

    this.log('warn', `Batch ${batchIdx + 1}: only ${chipsAfter}/${expectedTotalChips} chips after ${Math.round((Date.now() - startWait) / 1000)}s`);

    // Partial success: if we got at least the batch's images, continue
    const prevExpected = expectedTotalChips - batch.length;
    if (chipsAfter > prevExpected) {
      this.log('info', `Batch ${batchIdx + 1}: partial success (${chipsAfter - prevExpected}/${batch.length} new chips). Continuing...`);
      return true;
    }

    return false;
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

  /** Request image blobs from the sidepanel via background */
  private requestImageBlobs(images: ImageMeta[]): Promise<any> {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { type: 'GET_IMAGE_BLOBS', payload: { imageIds: images.map(i => i.id) } },
        (response) => resolve(response)
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

    // Clear existing prompt
    if (input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement) {
      input.focus();
      input.select();
    } else {
      input.focus();
      document.execCommand('selectAll', false);
    }
    await humanDelay(100, 300);

    const method: InputMethod = settings.humanizedMode ? 'type' : (settings.inputMethod ?? 'paste');

    if (method === 'type') {
      const multiplier = settings.typingSpeedMultiplier ?? 1.0;
      const cps = Math.round((settings.typingCharsPerSecond ?? 25) * multiplier);
      const variable = settings.variableTypingDelay ?? settings.humanizedMode ?? true;
      const chunked = text.length > 100 ? ' [chunked]' : '';
      this.log('info', `Typing prompt (${text.length} chars at ~${cps} cps, speed=${multiplier.toFixed(2)}x, variable=${variable}${chunked})`);
      await simulateTyping(input as HTMLElement, text, cps, variable);
    } else {
      setInputValue(input as HTMLElement, text);
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

    // Strategy 1: simulateClick (pointerdown→mousedown→click chain)
    simulateClick(btn);
    this.log('info', 'Clicked Generate (simulateClick)');
    await humanDelay(500, 800);

    // Check if generation started (tile progress or isGenerating)
    if (tilesHaveProgress() || isGenerating()) {
      this.log('info', 'Generation confirmed started after simulateClick');
      return;
    }

    // Strategy 2: Native .click()
    (btn as HTMLElement).click();
    this.log('info', 'Retrying Generate (native .click)');
    await humanDelay(500, 800);

    if (tilesHaveProgress() || isGenerating()) {
      this.log('info', 'Generation confirmed started after native click');
      return;
    }

    // Strategy 3: React onPointerDown handler (Radix buttons)
    const ok1 = reactTrigger(btn, 'onPointerDown');
    if (ok1) {
      this.log('info', 'Retrying Generate (React onPointerDown)');
      await humanDelay(500, 800);
      if (tilesHaveProgress() || isGenerating()) return;
    }

    // Strategy 4: React onClick handler
    const ok2 = reactTrigger(btn, 'onClick');
    if (ok2) {
      this.log('info', 'Retrying Generate (React onClick)');
      await humanDelay(500, 800);
      if (tilesHaveProgress() || isGenerating()) return;
    }

    // Strategy 5: Enter key on the prompt input
    const promptInput = findPromptInput();
    if (promptInput) {
      this.log('info', 'Retrying Generate (Enter key on prompt)');
      (promptInput as HTMLElement).focus();
      promptInput.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true, cancelable: true,
      }));
      await humanDelay(500, 800);
    }

    this.log('info', 'Clicked Generate (all strategies attempted)');
    await humanDelay(500, 1000);
  }

  /**
   * Wait for generation to complete.
   * Uses multiple signals:
   * 1. Tile progress percentage text ("15%", "73%") appearing then disappearing
   * 2. New tiles appearing (count increase)
   * 3. Tile-level state transitions: generating → completed (blur removal, play button appears)
   * 4. Flow status text ("is preparing", "creating video")
   */
  private async waitForCompletion(
    snapshotBefore: TileSnapshot,
    expectedOutputs: number
  ): Promise<void> {
    const startTime = Date.now();
    const POLL_MS = POLL_INTERVAL_MS;
    const completedBefore = snapshotBefore.completed;

    // Phase 1: Wait for generation to START (up to 60 seconds)
    // Look for: generate button disabled, tiles in 'generating' state, new tiles, status text
    let generationStarted = false;
    for (let i = 0; i < 60; i++) {
      if (this.stopped) return;

      const snap = snapshotTiles();

      // Signal: tiles entered 'generating' state (blur / progress %)
      if (snap.generating > 0) {
        generationStarted = true;
        this.log('info', `Generation started (${snap.generating} tile(s) generating)`);
        break;
      }

      // Signal: generate button became disabled
      if (!isGenerateButtonEnabled()) {
        generationStarted = true;
        this.log('info', 'Generation started (generate button disabled)');
        break;
      }

      // Signal: new tiles appeared
      if (snap.total > snapshotBefore.total || snap.tileIds !== snapshotBefore.tileIds) {
        generationStarted = true;
        this.log('info', `Generation started (tiles changed: ${snapshotBefore.total}→${snap.total})`);
        break;
      }

      // Signal: status text
      if (isGenerating()) {
        generationStarted = true;
        this.log('info', 'Generation started (status text detected)');
        break;
      }

      // Check for errors
      const errorText = this.checkForFlowError();
      if (errorText) {
        throw new Error(`Flow error: ${errorText}`);
      }

      await sleep(1000);
    }

    if (!generationStarted) {
      const errorText = this.checkForFlowError();
      if (errorText) {
        throw new Error(`Flow error: ${errorText}`);
      }
      this.log('warn', 'Generation may not have started after 60s. Continuing to watch...');
    }

    // Phase 2: Wait for generation to COMPLETE (up to GENERATION_TIMEOUT_MS)
    // Primary signal: tile state transitions from 'generating' → 'completed'
    // Secondary: button re-enables, completed count increases, all quiet
    let lastLogTime = 0;
    let generatingSeenCount = 0;
    let buttonWasDisabled = false;
    let peakGenerating = 0;
    const failedBefore = snapshotBefore.failed;

    while (Date.now() - startTime < GENERATION_TIMEOUT_MS) {
      if (this.stopped) return;
      while (this.paused) {
        await sleep(500);
        if (this.stopped) return;
      }

      const snap = snapshotTiles();
      const btnEnabled = isGenerateButtonEnabled();
      const elapsed = Date.now() - startTime;

      if (snap.generating > 0) generatingSeenCount++;
      if (snap.generating > peakGenerating) peakGenerating = snap.generating;
      if (!btnEnabled) buttonWasDisabled = true;

      // Log detailed status every 15 seconds
      if (elapsed - lastLogTime > 15000) {
        lastLogTime = elapsed;
        this.log('info',
          `Waiting... total: ${snap.total}, generating: ${snap.generating}, ` +
          `completed: ${snap.completed}(was ${completedBefore}), ` +
          `failed: ${snap.failed}(was ${failedBefore}), ` +
          `empty: ${snap.empty}, btnEnabled: ${btnEnabled}, ` +
          `elapsed: ${Math.round(elapsed / 1000)}s`
        );
      }

      // ── Failure condition: new failed tiles appeared ──
      if (snap.failed > failedBefore) {
        const newFailed = snap.failed - failedBefore;
        this.log('warn', `${newFailed} tile(s) failed during generation`);
        // If ALL expected outputs failed and none completed, throw
        if (snap.completed <= completedBefore && snap.generating === 0) {
          throw new Error(`Generation failed: ${newFailed} tile(s) failed (policy violation, rate limit, or content error)`);
        }
        // Some failed but others may still be generating — continue watching
      }

      // ── Completion condition 1: All previously-generating tiles finished ──
      // We saw tiles generating, and now none are generating, and completed count went up
      if (generatingSeenCount > 0 && snap.generating === 0 && snap.completed > completedBefore) {
        // Wait a moment for UI to fully settle
        await sleep(2000);
        const final = snapshotTiles();
        if (final.generating === 0 && final.completed > completedBefore) {
          this.log('info',
            `Generation completed! Completed: ${completedBefore}→${final.completed} ` +
            `(+${final.completed - completedBefore} new)` +
            (final.failed > failedBefore ? `, ${final.failed - failedBefore} failed` : '')
          );
          await humanDelay(800, 1500);
          return;
        }
      }

      // ── Completion condition 2: All tiles settled (mix of completed + failed, none generating) ──
      if (generatingSeenCount > 0 && snap.generating === 0 &&
        (snap.completed > completedBefore || snap.failed > failedBefore) && elapsed > 5000) {
        await sleep(2000);
        const final = snapshotTiles();
        if (final.generating === 0) {
          const newCompleted = final.completed - completedBefore;
          const newFailed = final.failed - failedBefore;
          if (newCompleted > 0) {
            this.log('info',
              `Generation settled: ${newCompleted} completed, ${newFailed} failed`
            );
            await humanDelay(800, 1500);
            return;
          } else if (newFailed > 0) {
            throw new Error(`All ${newFailed} generation(s) failed`);
          }
        }
      }

      // ── Completion condition 2: Button was disabled and is now re-enabled ──
      if (buttonWasDisabled && btnEnabled && elapsed > 5000) {
        await sleep(2000);
        const final = snapshotTiles();
        this.log('info',
          `Generation completed (button re-enabled). Completed: ${completedBefore}→${final.completed}`
        );
        await humanDelay(800, 1500);
        return;
      }

      // ── Completion condition 3: Completed count increased, no active generation ──
      if (snap.completed > completedBefore && snap.generating === 0 && elapsed > 10000) {
        this.log('info',
          `Generation completed (new media). Completed: ${completedBefore}→${snap.completed}`
        );
        await humanDelay(800, 1500);
        return;
      }

      // ── Completion condition 4: All quiet for a long time after generation started ──
      if (generationStarted && snap.generating === 0 && btnEnabled && elapsed > 60000) {
        const generatingNow = isGenerating();
        if (!generatingNow) {
          this.log('info', 'Generation completed (all signals quiet after 60s)');
          await humanDelay(800, 1500);
          return;
        }
      }

      // Check for errors during generation
      const errorText = this.checkForFlowError();
      if (errorText) {
        throw new Error(`Generation failed: ${errorText}`);
      }

      await sleep(POLL_MS);
    }

    // Timeout — check if anything actually completed
    const final = snapshotTiles();
    if (final.completed > completedBefore) {
      this.log('info',
        `Generation completed on timeout. Completed: ${completedBefore}→${final.completed}`
      );
      return;
    }

    throw new Error(`Generation timed out after ${GENERATION_TIMEOUT_MS / 1000}s`);
  }

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

  /** Download the latest generated outputs.
   *  Uses Flow's right-click Radix ContextMenu which contains quality
   *  options (270p, 720p Original Size, 1080p Upscaled, 4K) and a
   *  generic "Download" menuitem.  Clicking a quality option triggers
   *  a native browser download of the video at that resolution.
   */
  private async downloadOutputs(promptIdx: number, settings: QueueSettings): Promise<string[]> {
    // Check both new and legacy auto-download settings
    const isVideo = (settings.mediaType ?? 'video') === 'video';
    const shouldDownload = isVideo
      ? (settings.autoDownloadVideos ?? settings.autoDownload ?? true)
      : (settings.autoDownloadImages ?? settings.autoDownload ?? true);

    if (!shouldDownload) {
      this.log('info', 'Auto-download disabled, skipping download');
      return [];
    }

    const files: string[] = [];
    const cards = findAssetCards().filter(el => isVisible(el));
    const startIdx = Math.max(0, cards.length - settings.generations);

    for (let i = startIdx; i < cards.length; i++) {
      if (this.stopped) break;
      const card = cards[i];
      const genNum = i - startIdx + 1;

      if (getTileState(card) !== 'completed') {
        this.log('warn', `Tile ${genNum} not completed, skipping download`);
        continue;
      }

      try {
        const ok = await this.downloadTile(card);
        if (ok) {
          files.push(`prompt_${promptIdx + 1}_gen_${genNum}`);
          this.log('info', `Downloaded output ${genNum} of prompt #${promptIdx + 1}`);
        } else {
          this.log('warn', `Could not download output ${genNum} of prompt #${promptIdx + 1}`);
        }
      } catch (e: any) {
        this.log('error', `Download error for output ${genNum}: ${e.message}`);
      }

      await humanDelay(1500, 2500);
    }

    return files;
  }

  /**
   * Download a single tile via Flow's context menu or edit page.
   */
  private async downloadTile(card: Element): Promise<boolean> {
    // Strategy 1: Right-click context menu → quality option
    if (await this.tryContextMenuDownload(card)) return true;

    // Strategy 2: Navigate to edit page → Download button
    if (await this.tryEditPageDownload(card)) return true;

    return false;
  }

  /**
   * Right-click on tile → open Radix ContextMenu → click 720p / Download.
   * Flow DOM: the tile is wrapped in span[data-state] which acts as the
   * Radix ContextMenu.Trigger.  Right-clicking dispatches contextmenu
   * which the trigger intercepts to show the quality download menu.
   */
  private async tryContextMenuDownload(card: Element): Promise<boolean> {
    const rect = card.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;

    // Full right-click event chain
    const opts: MouseEventInit = {
      bubbles: true, cancelable: true, view: window,
      clientX: cx, clientY: cy, button: 2, buttons: 2,
    };
    card.dispatchEvent(new PointerEvent('pointerdown', { ...opts, pointerId: 1 }));
    await sleep(50);
    card.dispatchEvent(new MouseEvent('contextmenu', opts));
    await sleep(800);

    if (await this.findAndClickDownloadOption()) return true;

    // Dismiss whatever opened
    this.dismissOpenMenu();
    await sleep(300);

    // Retry on all inner span[data-state] triggers (ContextMenu.Trigger)
    const triggers = card.querySelectorAll('span[data-state]');
    for (const trigger of triggers) {
      const tRect = trigger.getBoundingClientRect();
      if (tRect.width === 0 || tRect.height === 0) continue;
      const tx = tRect.left + tRect.width / 2;
      const ty = tRect.top + tRect.height / 2;

      trigger.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true, cancelable: true, view: window,
        clientX: tx, clientY: ty,
        button: 2, buttons: 2, pointerId: 1,
      }));
      await sleep(50);
      trigger.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true, cancelable: true, view: window,
        clientX: tx, clientY: ty, button: 2,
      }));
      await sleep(800);

      if (await this.findAndClickDownloadOption()) return true;

      this.dismissOpenMenu();
      await sleep(300);
    }

    return false;
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
    // Release run-lock immediately on stop
    globalRunLock = false;
    this.sendRunLockChanged(false);
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

    // Wait for all tiles to settle (no more generating state)
    const POST_QUEUE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes max
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

      if (allTilesSettled()) {
        // Double-check with a full scroll to catch off-screen generating tiles
        await sleep(2000);
        const fullySettled = await allTilesSettledWithScroll();
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

    if (Date.now() - startTime >= POST_QUEUE_TIMEOUT_MS) {
      this.log('warn', 'Post-queue scan timed out after 30 minutes');
    }

    // Now scroll through ALL tiles and detect failures by position
    await this.detectAndReportFailures();
  }

  /**
   * Scroll through the entire output grid, collect every tile's state,
   * and map results back to queue prompts using position-based matching.
   *
   * Position logic (newest tiles at the top):
   *   - Prompts were submitted in order 0, 1, 2, …, P-1
   *   - Each prompt creates G tiles (settings.generations)
   *   - The newest prompt's tiles appear at the top of the grid
   *   - So top G tiles = last prompt, next G = second-to-last, etc.
   *
   * After mapping, prompt statuses are updated to 'done' or 'failed'
   * and a FAILED_TILES_RESULT message is sent to the sidepanel.
   */
  private async detectAndReportFailures(): Promise<void> {
    if (!this.queue) return;

    this.log('info', 'Scrolling through output grid to collect all tile states...');
    const allTiles = await scrollAndCollectAllTileStates();
    this.log('info', `Collected ${allTiles.length} total tile(s) on page`);

    // Figure out which tiles belong to our queue
    const G = this.queue.settings.generations || 1;
    const doneIndices: number[] = [];
    for (let i = 0; i < this.queue.prompts.length; i++) {
      // Prompts that successfully started generation (status 'done' before this scan)
      if (this.queue.prompts[i].status === 'done') {
        doneIndices.push(i);
      }
    }

    const expectedNewTiles = doneIndices.length * G;
    // New tiles = total minus baseline (tiles that existed before queue start)
    const newTileCount = Math.max(0, allTiles.length - this.baselineTileCount);
    this.log('info',
      `Expected ${expectedNewTiles} new tiles (${doneIndices.length} done prompts x ${G} gen), ` +
      `found ${newTileCount} new tiles (total ${allTiles.length} - baseline ${this.baselineTileCount})`
    );

    // Take the first N tiles from the top (newest first) — these are our queue's tiles
    const tilesForQueue = allTiles.slice(0, Math.max(expectedNewTiles, newTileCount));

    // Map tiles to prompts by position
    // Top tiles = last submitted prompt, bottom tiles = first submitted prompt
    const failedPrompts: Array<{ promptIndex: number; text: string; error: string }> = [];
    let updatedCount = 0;

    for (let g = 0; g < doneIndices.length; g++) {
      // g=0 → top of grid → last prompt (doneIndices[doneIndices.length - 1])
      const promptIdx = doneIndices[doneIndices.length - 1 - g];
      const groupStart = g * G;
      const groupEnd = Math.min(groupStart + G, tilesForQueue.length);
      const group = tilesForQueue.slice(groupStart, groupEnd);

      if (group.length === 0) continue;

      const failedInGroup = group.filter(t => t.state === 'failed').length;
      const completedInGroup = group.filter(t => t.state === 'completed').length;

      if (failedInGroup > 0 && completedInGroup === 0) {
        // ALL tiles for this prompt failed
        this.queue.prompts[promptIdx].status = 'failed';
        this.queue.prompts[promptIdx].error = 'Generation failed';
        this.updatePromptStatus(promptIdx, 'failed', 'Generation failed');
        failedPrompts.push({
          promptIndex: promptIdx,
          text: this.queue.prompts[promptIdx].text,
          error: 'Generation failed',
        });
        updatedCount++;
      } else if (failedInGroup > 0) {
        // Partial failure — some succeeded, some failed
        const errMsg = `Partial failure: ${completedInGroup} completed, ${failedInGroup} failed`;
        this.queue.prompts[promptIdx].status = 'failed';
        this.queue.prompts[promptIdx].error = errMsg;
        this.updatePromptStatus(promptIdx, 'failed', errMsg);
        failedPrompts.push({
          promptIndex: promptIdx,
          text: this.queue.prompts[promptIdx].text,
          error: errMsg,
        });
        updatedCount++;
      } else {
        // All tiles completed — confirm done status
        if (this.queue.prompts[promptIdx].status === 'done') {
          // Re-send the done status to ensure UI is up to date
          this.updatePromptStatus(promptIdx, 'done');
          updatedCount++;
        }
      }
    }

    // Also handle prompts that were already marked 'failed' during processPrompt
    for (let i = 0; i < this.queue.prompts.length; i++) {
      if (this.queue.prompts[i].status === 'failed' && !failedPrompts.find(fp => fp.promptIndex === i)) {
        failedPrompts.push({
          promptIndex: i,
          text: this.queue.prompts[i].text,
          error: this.queue.prompts[i].error || 'Failed during processing',
        });
      }
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
    const failedTiles = findAllFailedTiles();
    if (failedTiles.length === 0) {
      this.log('info', 'No failed tiles to retry on page');
      return { retried: 0, total: 0 };
    }

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
