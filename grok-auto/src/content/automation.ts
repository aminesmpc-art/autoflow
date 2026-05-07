/* ============================================================
   Grok Auto – Automation Engine
   Processes prompts sequentially on grok.com/imagine
   ============================================================ */

import { QueueObject, QueueSettings } from '../types';
import {
  findPromptInput, findGenerateButton, findRadioButton,
  findProportionsButton, findMenuItem, isRadioActive,
  isGenerating, isGenerateEnabled, isVisible,
  simulateClick, fillPromptText, randomDelay, sleep,
  findUploadButton, findFileInput, injectFilesToInput,
  // Tile detection imports
  getGenerationTiles, getTileState, getProgressPercent,
  isGenerationDone, getPageSnapshot, findScrollContainer,
  // Video Extend imports
  findMoreOptionsButton, findExtendVideoMenuItem,
  findExtendDurationChip, isInExtendMode,
  // Page-level video state detection
  isPageVideoGenerating, isPageVideoCompleted, getPageVideoProgress,
} from './selectors';

let engineRunning = false;

export class AutomationEngine {
  private queue: QueueObject | null = null;
  private stopped = false;
  private paused = false;
  private currentPromptIdx = 0;
  private baselineTileCount = 0;
  private isMonitorRunning = false;
  private uploadedImageCount = 0; // Tracks image uploads for @Image N indexing

  async start(queue: QueueObject) {
    if (engineRunning) {
      this.log('error', 'Another queue is already running.');
      return;
    }
    engineRunning = true;
    this.sendRunLockChanged(true);
    this.queue = queue;
    this.stopped = false;
    this.paused = false;
    this.currentPromptIdx = queue.currentPromptIndex || 0;

    this.log('info', `Starting queue "${queue.name}" with ${queue.prompts.length} prompts`);
    this.sendQueueStatus('running');

    await this.ensurePageReady();
    await randomDelay(500, 1000);

    this.baselineTileCount = getGenerationTiles().length;
    this.log('info', `Baseline: ${this.baselineTileCount} existing tiles on page`);

    await this.applyAllSettings(queue.settings);
    if (this.stopped) {
      this.sendQueueStatus('stopped');
      engineRunning = false;
      this.sendRunLockChanged(false);
      return;
    }

    await randomDelay(300, 700);

    let done = 0;
    let failed = 0;

    // 1. Kick off the continuous background monitor
    this.startBackgroundMonitor();

    // 2. Submit prompts — DIFFERENT LOGIC for Video Extend vs Normal
    if (queue.settings.videoExtend && queue.settings.mediaType === 'video') {
      // ═══════════════════════════════════════════════════════════
      // VIDEO EXTEND MODE: Process prompts as chains of up to 3
      // Prompt[0] = initial 10s video
      // Prompt[1] = extend to 20s using Extend Video button
      // Prompt[2] = extend to 30s using Extend Video button
      // Then prompt[3] starts a NEW video chain, etc.
      // ═══════════════════════════════════════════════════════════
      let i = this.currentPromptIdx;
      while (i < queue.prompts.length && !this.stopped) {
        while (this.paused && !this.stopped) await sleep(500);
        if (this.stopped) break;

        // Determine chain: up to 3 prompts starting at i
        const chainStart = i;
        const chainEnd = Math.min(i + 3, queue.prompts.length);
        this.log('info', `━━━ Video chain: prompts #${chainStart + 1} to #${chainEnd} ━━━`);

        // Step A: Generate the FIRST prompt in the chain (initial 10s video)
        this.currentPromptIdx = chainStart;
        this.sendQueueStatus('running', chainStart);
        this.updatePromptStatus(chainStart, 'running');
        this.log('info', `Generating initial video: prompt #${chainStart + 1}`);

        // Upload per-prompt image if available (image-to-video)
        const chainPrompt = queue.prompts[chainStart];
        if (chainPrompt.imageDataUrls && chainPrompt.imageDataUrls.length > 0) {
          await this.uploadImages(chainPrompt.imageDataUrls, chainPrompt.imageNames || []);
          if (this.stopped) break;
          await this.typeImageReference(1);
          if (this.stopped) break;
        }

        await this.fillPrompt(queue.prompts[chainStart].text, queue.settings);
        if (this.stopped) break;
        await this.clickGenerate();
        if (this.stopped) break;

        // Wait for initial video to FULLY complete
        this.log('info', `Waiting for prompt #${chainStart + 1} to finish generating...`);
        const initResult = await this.waitForTileCompletion(chainStart);
        if (this.stopped) break;

        if (initResult === 'failed') {
          this.updatePromptStatus(chainStart, 'failed', 'Generation failed');
          this.log('error', `Prompt #${chainStart + 1} failed — skipping rest of chain`);
          // Mark remaining chain prompts as failed too
          for (let j = chainStart + 1; j < chainEnd; j++) {
            this.updatePromptStatus(j, 'failed', 'Skipped (initial video failed)');
          }
          i = chainEnd;
          continue;
        }

        this.updatePromptStatus(chainStart, 'done');
        this.sendGenerationProgress(chainStart, 100, 'completed');
        this.log('info', `Prompt #${chainStart + 1} — initial video completed ✅`);

        // Step B: Extend with remaining prompts in the chain
        let chainBroken = false;
        for (let ext = 1; ext < chainEnd - chainStart; ext++) {
          if (this.stopped) break;
          const extIdx = chainStart + ext;
          this.currentPromptIdx = extIdx;
          this.sendQueueStatus('running', extIdx);
          this.updatePromptStatus(extIdx, 'running');
          this.sendGenerationProgress(extIdx, 0, 'generating');

          this.log('info', `Extending video → prompt #${extIdx + 1} (segment ${ext + 1}/3)`);
          const extResult = await this.extendVideo(extIdx, queue.prompts[extIdx].text, queue.settings.extendDuration);

          if (extResult === 'failed') {
            this.updatePromptStatus(extIdx, 'failed', 'Extension failed');
            this.log('error', `Extend #${ext} failed`);
            // Mark remaining extensions as failed
            for (let j = extIdx + 1; j < chainEnd; j++) {
              this.updatePromptStatus(j, 'failed', 'Skipped (previous extend failed)');
            }
            chainBroken = true;
            break;
          }

          this.updatePromptStatus(extIdx, 'done');
          this.sendGenerationProgress(extIdx, 100, 'completed');
          this.log('info', `Prompt #${extIdx + 1} — extend completed ✅`);
        }

        i = chainEnd;

        // Prepare for next chain
        if (!this.stopped && i < queue.prompts.length) {
          this.log('info', 'Preparing for next video chain...');
          await this.ensurePageReady();
        }
      }

    } else {
      // ═══════════════════════════════════════════════════════════
      // NORMAL MODE: Process each prompt independently
      // ═══════════════════════════════════════════════════════════
      for (let i = this.currentPromptIdx; i < queue.prompts.length && !this.stopped; i++) {
        while (this.paused && !this.stopped) await sleep(500);
        if (this.stopped) break;

        this.currentPromptIdx = i;
        this.sendQueueStatus('running', i);
        await this.processPrompt(queue.prompts[i], i);

        // We no longer manually tally 'done' here, as the background monitor updates statuses asynchronously

        if (!this.stopped && i < queue.prompts.length - 1) {
          await this.ensurePageReady();
        }
      }
    }

    // 3. Wait for all submitted prompts to finish generating
    //    (SKIP in Video Extend mode — the chain loop already waited for each prompt)
    if (!this.stopped && !queue.settings.videoExtend && queue.prompts.some(p => p.status === 'running')) {
      this.log('info', 'All prompts submitted. Waiting for generation(s) to finish...');
      while (!this.stopped) {
        const allFinished = queue.prompts.every(
          p => p.status !== 'running'
        );
        if (allFinished) break;
        await sleep(2000);
      }
    }

    // Stop the background monitor
    this.isMonitorRunning = false;

    done = queue.prompts.filter(p => p.status === 'done').length;
    failed = queue.prompts.filter(p => p.status === 'failed').length;
    const skipped = queue.prompts.length - done - failed;

    if (this.stopped) {
      this.log('info', `Queue stopped. Done: ${done}, Failed: ${failed}, Skipped: ${skipped}`);
      this.sendQueueStatus('stopped');
    } else {
      this.log('info', `Queue complete! Done: ${done}, Failed: ${failed}, Skipped: ${skipped}`);
      this.sendQueueStatus('completed');
    }

    this.sendQueueSummary(done, failed, skipped);
    engineRunning = false;
    this.sendRunLockChanged(false);
  }

  private async processPrompt(prompt: any, idx: number) {
    let attempts = prompt.attempts || 0;

    while (attempts <= 2) {
      if (this.stopped) return;

      try {
        this.updatePromptStatus(idx, 'running');
        this.log('info', `Processing prompt #${idx + 1} (attempt ${attempts + 1}/3)`);

        const hasImages = prompt.imageDataUrls && prompt.imageDataUrls.length > 0;

        if (hasImages) {
          // ── IMAGE-TO-VIDEO FLOW ──
          // 1. Upload the image (Grok stacks them: Image 1, Image 2, etc.)
          await this.uploadImages(prompt.imageDataUrls, prompt.imageNames || []);
          if (this.stopped) return;
          this.uploadedImageCount++;

          // 2. fillPrompt with @ImageN prepended — single clean paste
          //    (fillPromptText fallback now uses length check, won't double)
          const fullText = `@Image${this.uploadedImageCount} ${prompt.text}`;
          await this.fillPrompt(fullText, this.queue!.settings);
        } else {
          // ── TEXT-ONLY FLOW ──
          await this.fillPrompt(prompt.text, this.queue!.settings);
        }
        if (this.stopped) return;

        await this.clickGenerate();
        if (this.stopped) return;

        // ── Wait behavior depends on settings ──
        if (this.queue!.settings.waitForCompletion) {
          // SMART WAITING: Wait for the background monitor to mark it 'done'
          this.log('info', `Waiting for prompt #${idx + 1} to finish...`);
          const waitMax = this.queue!.settings.waitMaxSec ?? 120;
          const deadline = Date.now() + Math.max(waitMax, 60) * 1000;

          while (Date.now() < deadline) {
            if (this.stopped) return;
            const currentStatus = this.queue!.prompts[idx].status;
            if (currentStatus === 'done') {
              this.log('info', `Prompt #${idx + 1} — generation completed ✅`);
              break;
            } else if (currentStatus === 'failed') {
              throw new Error('Generation failed (tile shows error state)');
            }
            await sleep(2000);
          }
          return;

        } else {
          // FIRE-AND-FORGET: Wait the configured delay, then move on
          const waitMin = this.queue!.settings.waitMinSec ?? 10;
          const waitMax = this.queue!.settings.waitMaxSec ?? 20;
          const waitTime = waitMin + Math.random() * Math.max(0, waitMax - waitMin);
          this.log('info', `Generation started — waiting ${waitTime.toFixed(0)}s before next prompt`);
          
          await sleep(waitTime * 1000);
          this.log('info', `Prompt #${idx + 1} — submitted ✅ (moving to next)`);
        }
        return;

      } catch (err: any) {
        attempts++;
        prompt.attempts = attempts;
        this.log('error', `Prompt #${idx + 1} error (attempt ${attempts}): ${err.message}`);

        if (attempts > 2) {
          this.updatePromptStatus(idx, 'failed', err.message);
          this.log('error', `Prompt #${idx + 1} failed after 3 attempts`);
          if (this.queue!.settings.stopOnError) {
            this.stopped = true;
            this.log('warn', 'Queue stopped (stopOnError=true)');
          }
          return;
        }

        const backoff = 5000 * Math.pow(2, attempts - 1);
        this.log('info', `Retrying in ${backoff / 1000}s...`);
        await sleep(backoff);
      }
    }
  }

  /**
   * Extend a completed video by clicking More Options → Extend Video,
   * then filling a new prompt and generating the next segment.
   * Returns 'completed' or 'failed'.
   */
  private async extendVideo(promptIdx: number, extendText: string, duration: '+6s' | '+10s'): Promise<'completed' | 'failed'> {
    this.log('info', `Extending video: "${extendText.substring(0, 50)}..." (${duration})`);

    // 1. Find the "..." (More options) button
    const moreBtn = findMoreOptionsButton();
    if (!moreBtn) {
      this.log('error', 'More options button not found');
      return 'failed';
    }

    // 2. Click "..." 
    simulateClick(moreBtn);
    await randomDelay(800, 1200);

    // 3. Click "Extend video" in the dropdown
    let extendItem: HTMLElement | null = null;
    const menuDeadline = Date.now() + 5000;
    while (Date.now() < menuDeadline) {
      extendItem = findExtendVideoMenuItem();
      if (extendItem) break;
      await sleep(300);
    }
    if (!extendItem) {
      this.log('error', 'Extend video menu item not found');
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      return 'failed';
    }
    simulateClick(extendItem);
    this.log('info', 'Clicked Extend video');
    await randomDelay(2000, 3000);

    // 4. Wait for extend mode input to appear
    const extendDeadline = Date.now() + 15000;
    while (Date.now() < extendDeadline) {
      if (isInExtendMode()) break;
      await sleep(500);
    }
    if (!isInExtendMode()) {
      this.log('error', 'Failed to enter extend mode');
      return 'failed';
    }
    this.log('info', 'Entered extend mode ✅');
    await sleep(1000); // Give UI extra time to stabilize

    // 5. Select duration chip (+6s or +10s)
    const durationChip = findExtendDurationChip(duration);
    if (durationChip) {
      simulateClick(durationChip);
      this.log('info', `Selected duration: ${duration}`);
      await randomDelay(400, 700);
    }

    // 6. Fill the extend prompt — target the <p> inside the Tiptap editor
    const editor = findPromptInput();
    if (!editor) {
      this.log('error', 'Tiptap editor not found in extend mode');
      return 'failed';
    }

    // Find the <p data-placeholder="Extend video"> inside the editor
    const editorP = editor.querySelector('p[data-placeholder]') as HTMLElement || editor.querySelector('p') as HTMLElement;
    
    // Click on the editor to place the cursor
    editor.focus();
    await sleep(200);
    if (editorP) {
      editorP.click();
      await sleep(200);
    }

    // Place cursor inside the editor
    const sel = window.getSelection();
    const range = document.createRange();
    if (editorP) {
      range.selectNodeContents(editorP);
      range.collapse(false); // Collapse to end
    } else {
      range.selectNodeContents(editor);
      range.collapse(false);
    }
    sel?.removeAllRanges();
    sel?.addRange(range);
    await sleep(100);

    // Clear any existing content (like the <br> trailing break)
    document.execCommand('selectAll', false);
    await sleep(50);
    document.execCommand('delete', false);
    await sleep(100);

    // Method 1: insertText (ProseMirror handles this correctly)
    this.log('info', 'Inserting extend prompt text via insertText...');
    document.execCommand('insertText', false, extendText);
    await sleep(500);

    // Check if text was inserted
    let currentText = (editor.textContent || '').trim();
    if (currentText.length >= 3) {
      this.log('info', `✅ Text inserted (${currentText.length} chars)`);
    } else {
      // Method 2: Paste simulation
      this.log('warn', 'insertText failed, trying paste simulation...');
      editor.focus();
      await sleep(200);
      const dt = new DataTransfer();
      dt.setData('text/plain', extendText);
      const pasteEvt = new ClipboardEvent('paste', {
        bubbles: true, cancelable: true, clipboardData: dt,
      });
      editor.dispatchEvent(pasteEvt);
      await sleep(500);

      currentText = (editor.textContent || '').trim();
      if (currentText.length >= 3) {
        this.log('info', `✅ Text inserted via paste (${currentText.length} chars)`);
      } else {
        // Method 3: Direct DOM manipulation as last resort
        this.log('warn', 'Paste failed, trying direct DOM...');
        if (editorP) {
          editorP.innerHTML = extendText;
          editorP.classList.remove('is-empty', 'is-editor-empty');
        } else {
          editor.innerHTML = `<p>${extendText}</p>`;
        }
        editor.dispatchEvent(new Event('input', { bubbles: true }));
        await sleep(300);
      }
    }

    // Fire React/ProseMirror events
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    editor.dispatchEvent(new Event('change', { bubbles: true }));
    this.log('info', `Extend prompt filled (${extendText.length} chars)`);
    await randomDelay(500, 800);

    // 7. Click Generate
    let genBtn: HTMLElement | null = null;
    const genDeadline = Date.now() + 10000;
    while (Date.now() < genDeadline) {
      genBtn = findGenerateButton();
      if (genBtn) break;
      await sleep(500);
    }
    if (!genBtn) {
      this.log('error', 'Generate button not found in extend mode');
      return 'failed';
    }
    this.log('info', 'Clicking Generate for extend');
    simulateClick(genBtn);
    await sleep(1000);
    // Retry with native click if needed
    if (!isPageVideoGenerating()) {
      genBtn.click();
      this.log('info', 'Retried Generate (native click)');
    }
    await sleep(2000);

    // 8. CRITICAL: Wait for generation to actually START before polling for completion
    //    Otherwise waitForTileCompletion sees the PREVIOUS completed video and returns immediately
    this.log('info', 'Waiting for extend generation to start...');
    const startDeadline = Date.now() + 30000; // 30s to start generating
    let generationStarted = false;
    while (Date.now() < startDeadline) {
      if (this.stopped) return 'failed';
      if (isPageVideoGenerating()) {
        generationStarted = true;
        this.log('info', 'Extend generation started! ✅ Now polling for completion...');
        break;
      }
      await sleep(1000);
    }

    if (!generationStarted) {
      this.log('error', 'Extend generation never started (no "Generating X%" detected)');
      return 'failed';
    }

    // 9. Now wait for this generation to complete
    return await this.waitForTileCompletion(promptIdx);
  }

  /**
   * Wait for a video generation to complete by polling the page-level DOM.
   * Uses isPageVideoGenerating/isPageVideoCompleted for reliable detection.
   * Returns 'completed' or 'failed'. Sends live progress % to UI.
   */
  private async waitForTileCompletion(promptIdx: number): Promise<'completed' | 'failed'> {
    const maxWaitMs = 10 * 60 * 1000; // 10 minutes max for video generation
    const startTime = Date.now();
    const pollMs = 3000;
    let lastProgress = -1;
    let stableCompletedCount = 0; // How many consecutive polls show 'completed'

    this.sendGenerationProgress(promptIdx, 0, 'generating');
    this.log('info', 'Polling page for video generation status...');

    while (Date.now() - startTime < maxWaitMs) {
      if (this.stopped) return 'failed';
      while (this.paused && !this.stopped) await sleep(500);

      await sleep(pollMs);

      // ── Check if page shows GENERATING state ──
      if (isPageVideoGenerating()) {
        stableCompletedCount = 0; // Reset
        const progress = getPageVideoProgress();
        if (progress >= 0 && progress !== lastProgress) {
          this.sendGenerationProgress(promptIdx, progress, 'generating');
          lastProgress = progress;
          const elapsed = Math.round((Date.now() - startTime) / 1000);
          this.log('info', `Video generating: ${progress}% (${elapsed}s)`);
        }
        continue;
      }

      // ── Check if page shows COMPLETED state ──
      if (isPageVideoCompleted()) {
        stableCompletedCount++;
        // Require 2 consecutive 'completed' polls to avoid false positives
        if (stableCompletedCount >= 2) {
          this.sendGenerationProgress(promptIdx, 100, 'completed');
          const elapsed = Math.round((Date.now() - startTime) / 1000);
          this.log('info', `Video generation DONE! (${elapsed}s total)`);
          return 'completed';
        }
        this.log('info', 'Completed detected, confirming...');
        continue;
      }

      // Neither generating nor completed — could be loading or transitioning
      stableCompletedCount = 0;
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      if (elapsed > 30) {
        this.log('info', `Waiting for generation to appear... (${elapsed}s)`);
      }
    }

    this.log('warn', `Timeout after ${Math.round(maxWaitMs / 1000)}s`);
    this.sendGenerationProgress(promptIdx, 0, 'failed');
    return 'failed';
  }

  /**
   * Continuous background monitor: polls DOM every 3s and syncs real-time progress
   * for ALL 'running' prompts independently of the main queue submission loop.
   */
  private async startBackgroundMonitor() {
    this.isMonitorRunning = true;
    while (this.isMonitorRunning && !this.stopped) {
      await sleep(3000);
      if (this.paused || this.stopped || !this.queue) continue;

      const hasRunning = this.queue.prompts.some(p => p.status === 'running');
      if (!hasRunning) continue;

      try {
        const { getPageSnapshot, findScrollContainer } = await import('./selectors');
        
        // Scroll to make newest tiles visible
        const scrollEl = findScrollContainer();
        if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight;
        await sleep(400);

        const snapshot = getPageSnapshot();
        
        for (let i = 0; i <= this.currentPromptIdx; i++) {
          const prompt = this.queue.prompts[i];
          if (prompt.status !== 'running') continue;

          const myTileIdx = this.baselineTileCount + i;
          const myTile = snapshot.tiles[myTileIdx];

          if (myTile) {
            if (myTile.state === 'generating' && myTile.progress !== null && myTile.progress >= 0) {
              this.sendGenerationProgress(i, myTile.progress, 'generating');
            } else if (myTile.state === 'completed') {
              this.updatePromptStatus(i, 'done');
              this.sendGenerationProgress(i, 100, 'completed');
            } else if (myTile.state === 'failed') {
              this.updatePromptStatus(i, 'failed', 'Generation tile error');
              this.sendGenerationProgress(i, 100, 'failed');
            }
          } else {
            // Fallback: use newest generating tile
            const genTiles = snapshot.tiles.filter(t => t.state === 'generating');
            const lastGen = genTiles.length > 0 ? genTiles[genTiles.length - 1] : null;
            if (lastGen && lastGen.progress !== null && lastGen.progress >= 0) {
              this.sendGenerationProgress(i, lastGen.progress, 'generating');
            } else if (snapshot.generating === 0 && snapshot.completed > 0) {
              // Safety fallback: if nothing is generating on the page, mark done
              this.updatePromptStatus(i, 'done');
              this.sendGenerationProgress(i, 100, 'completed');
            }
          }
        }
      } catch (e) {
        this.log('warn', `Background monitor error: ${e}`);
      }
    }
  }

  /** Scan the current page for all generation tiles and their states. */
  scanPage() {
    const snap = getPageSnapshot();
    this.log('info', `Page scan: ${snap.totalTiles} tiles — ${snap.completed} done, ${snap.generating} generating, ${snap.failed} failed`);
    return { total: snap.totalTiles, generating: snap.generating, completed: snap.completed, failed: snap.failed, idle: snap.idle };
  }

  private async ensurePageReady() {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      if (this.stopped) return;
      const input = findPromptInput();
      if (input && isVisible(input)) { this.log('info', 'Page ready — prompt input visible'); return; }
      this.log('info', 'Waiting for page to be ready...');
      await sleep(2000);
    }
    this.log('warn', 'Page may not be ready — prompt input not found');
  }

  private async applyAllSettings(settings: QueueSettings) {
    this.log('info', 'Applying settings...');

    const mediaLabel = settings.mediaType === 'image' ? 'image' : 'video';
    const mediaBtn = findRadioButton(mediaLabel) || findRadioButton('vidéo');
    if (mediaBtn) {
      if (!isRadioActive(mediaBtn)) { simulateClick(mediaBtn); this.log('info', `Selected: ${settings.mediaType}`); await randomDelay(400, 800); }
      else { this.log('info', `${settings.mediaType} already active`); }
    }

    if (settings.mediaType === 'video') {
      await sleep(300);
      const resBtn = findRadioButton(settings.videoResolution);
      if (resBtn && !isRadioActive(resBtn)) { simulateClick(resBtn); this.log('info', `Resolution: ${settings.videoResolution}`); await randomDelay(300, 500); }
      const durBtn = findRadioButton(settings.videoDuration);
      if (durBtn && !isRadioActive(durBtn)) { simulateClick(durBtn); this.log('info', `Duration: ${settings.videoDuration}`); await randomDelay(300, 500); }
    }

    await this.setAspectRatio(settings.aspectRatio);
    this.log('info', 'All settings applied');
  }

  private async setAspectRatio(ratio: string) {
    const propBtn = findProportionsButton();
    if (!propBtn) { this.log('warn', 'Proportions button not found'); return; }
    if ((propBtn.textContent?.trim() || '').includes(ratio)) { this.log('info', `Ratio ${ratio} already set`); return; }

    simulateClick(propBtn);
    await randomDelay(400, 700);
    const menuItem = findMenuItem(ratio);
    if (menuItem) { simulateClick(menuItem); this.log('info', `Ratio: ${ratio}`); await randomDelay(300, 500); }
    else { this.log('warn', `Ratio ${ratio} not found`); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); }
  }

  private async uploadImages(imageDataUrls: string[], imageNames: string[]) {
    this.log('info', `Uploading ${imageDataUrls.length} image(s)...`);
    
    // 1. Click the + button to open upload panel
    const uploadBtn = findUploadButton();
    if (uploadBtn) { simulateClick(uploadBtn); await randomDelay(500, 800); }

    // 2. Find and inject files
    const fileInput = findFileInput();
    if (!fileInput) { this.log('warn', 'File input not found — skipping image upload'); return; }

    const files: File[] = [];
    for (let i = 0; i < imageDataUrls.length; i++) {
      try {
        const blob = await (await fetch(imageDataUrls[i])).blob();
        files.push(new File([blob], imageNames[i] || `image_${i + 1}.png`, { type: blob.type || 'image/png' }));
      } catch (err: any) { this.log('warn', `Image ${i + 1} error: ${err.message}`); }
    }

    if (files.length === 0) { this.log('warn', 'No valid images'); return; }
    const ok = injectFilesToInput(fileInput, files);
    if (!ok) { this.log('error', 'Failed to inject images'); return; }
    this.log('info', `Injected ${files.length} image(s)`);

    // 3. Wait for the thumbnail to appear on the page (blob: src image)
    const thumbDeadline = Date.now() + 10000;
    let thumbFound = false;
    while (Date.now() < thumbDeadline) {
      const thumbs = document.querySelectorAll('img[src^="blob:"]');
      if (thumbs.length > 0) { thumbFound = true; break; }
      await sleep(500);
    }
    if (thumbFound) this.log('info', 'Image thumbnail appeared');
    else this.log('warn', 'Image thumbnail not detected (may still work)');
    
    await randomDelay(500, 800);

    // 4. Close the upload panel — click the + button again or press Escape
    const closeBtns = document.querySelectorAll('button[aria-label="Upload"]');
    for (const btn of closeBtns) {
      if (isVisible(btn as HTMLElement)) {
        simulateClick(btn as HTMLElement);
        this.log('info', 'Closed upload panel');
        break;
      }
    }
    await randomDelay(300, 500);
  }

  /**
   * Type @ in the prompt to trigger image reference autocomplete,
   * then select the image from the dropdown.
   * DOM structure: div[data-imagine-mention-menu="true"] > div > button > span.flex-1("Image N")
   */
  private async typeImageReference(imageIndex: number) {
    const input = findPromptInput();
    if (!input) { this.log('warn', 'Prompt input not found for @image ref'); return; }

    input.focus();
    await sleep(300);

    // Type @ to trigger the autocomplete dropdown
    document.execCommand('insertText', false, '@');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    this.log('info', 'Typed @ to trigger image selector');
    await sleep(1500); // Give dropdown time to appear

    // Look for the dropdown using the exact Grok selector
    const deadline = Date.now() + 8000;
    let selected = false;

    while (Date.now() < deadline) {
      // Find the mention menu container
      const menu = document.querySelector('div[data-imagine-mention-menu]');
      if (menu) {
        // Search buttons inside the menu
        const buttons = menu.querySelectorAll('button');
        for (const btn of buttons) {
          const span = btn.querySelector('span.flex-1') || btn.querySelector('span');
          const text = (span?.textContent || btn.textContent || '').trim().toLowerCase();
          if (text === `image ${imageIndex}` || text === `image${imageIndex}`) {
            this.log('info', `Found "${span?.textContent?.trim() || btn.textContent?.trim()}" — clicking`);
            simulateClick(btn as HTMLElement);
            await sleep(200);
            (btn as HTMLElement).click(); // native click backup
            selected = true;
            break;
          }
        }
      }
      if (selected) break;
      await sleep(400);
    }

    if (!selected) {
      // Fallback 1: Try keyboard navigation
      this.log('warn', 'Dropdown button not found — trying keyboard');
      for (let k = 0; k < imageIndex; k++) {
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
        await sleep(200);
      }
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await sleep(500);

      // Fallback 2: Just type "Image 1" after the @ already typed
      const content = (input.textContent || '').trim();
      if (!content.includes('Image')) {
        this.log('warn', 'Keyboard failed — typing @Image text directly');
        document.execCommand('insertText', false, `Image ${imageIndex} `);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }

    await sleep(500);
  }

  private async fillPrompt(text: string, _settings: QueueSettings) {
    await randomDelay(300, 700);
    const input = findPromptInput();
    if (!input) throw new Error('Prompt input not found');

    // ── Clear old text (React-safe) ──
    input.focus();
    await sleep(100);

    if (input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement) {
      const setter = Object.getOwnPropertyDescriptor(
        input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
        'value'
      )?.set;
      if (setter) setter.call(input, '');
      else input.value = '';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      // Contenteditable: use Ctrl+A then Delete (React-safe, no innerHTML!)
      document.execCommand('selectAll', false);
      await sleep(50);
      document.execCommand('delete', false);
      // Double-check it's clear
      if (input.textContent?.trim()) {
        const sel = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(input);
        sel?.removeAllRanges();
        sel?.addRange(range);
        document.execCommand('delete', false);
      }
    }
    await sleep(200);

    // ── Fill new text ──
    fillPromptText(input, text);
    await sleep(300);

    // ── Verify text was filled (retry once if failed) ──
    const actualText = (input.textContent || (input as any).value || '').trim();
    if (!actualText || actualText.length < 2) {
      this.log('warn', 'Text fill may have failed — retrying...');
      input.focus();
      document.execCommand('selectAll', false);
      document.execCommand('delete', false);
      await sleep(100);
      fillPromptText(input, text);
      await sleep(200);
    }

    // Fire React-compatible events
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));

    this.log('info', `Prompt filled (${text.length} chars)`);
    await randomDelay(400, 800);
  }

  private async clickGenerate() {
    await randomDelay(300, 600);
    const deadline = Date.now() + 30_000;
    let btn: HTMLElement | null = null;

    while (Date.now() < deadline) {
      if (this.stopped) return;
      btn = findGenerateButton();
      if (btn && isGenerateEnabled()) break;
      await sleep(500);
    }
    if (!btn) throw new Error('Generate button not found');

    this.log('info', 'Clicking Generate');
    simulateClick(btn);
    await randomDelay(500, 1000);

    if (isGenerating()) { this.log('info', 'Generation confirmed started'); }
    else { btn.click(); this.log('info', 'Retried Generate (native click)'); await randomDelay(500, 800); }
  }

  pause()  { this.paused = true;  this.log('info', 'Paused');  this.sendQueueStatus('paused'); }
  resume() { this.paused = false; this.log('info', 'Resumed'); this.sendQueueStatus('running'); }
  stop()   { this.stopped = true; this.paused = false; this.log('info', 'Stop requested'); engineRunning = false; this.sendRunLockChanged(false); }

  skipCurrent() {
    if (!this.queue) return;
    this.log('info', `Skipping prompt #${this.currentPromptIdx + 1}`);
    this.updatePromptStatus(this.currentPromptIdx, 'failed', 'Skipped by user');
    this.stopped = true;
    setTimeout(() => {
      this.stopped = false;
      this.currentPromptIdx++;
      if (this.queue && this.currentPromptIdx < this.queue.prompts.length) { engineRunning = false; this.start(this.queue); }
      else { engineRunning = false; this.sendRunLockChanged(false); }
    }, 500);
  }

  // ── Messaging helpers ──
  private log(level: 'info' | 'warn' | 'error', message: string) {
    console.log(`[GrokAuto] [${level.toUpperCase()}] ${message}`);
    chrome.runtime.sendMessage({ type: 'LOG', payload: { timestamp: Date.now(), level, message, queueId: this.queue?.id, promptIndex: this.currentPromptIdx } }).catch(() => {});
  }

  private sendQueueStatus(status: string, promptIdx?: number) {
    chrome.runtime.sendMessage({ type: 'QUEUE_STATUS_UPDATE', payload: { queueId: this.queue?.id, status, currentPromptIndex: promptIdx ?? this.currentPromptIdx } }).catch(() => {});
  }

  private updatePromptStatus(idx: number, status: string, error?: string) {
    if (this.queue) { this.queue.prompts[idx].status = status as any; if (error) this.queue.prompts[idx].error = error; }
    chrome.runtime.sendMessage({ type: 'PROMPT_STATUS_UPDATE', payload: { queueId: this.queue?.id, promptIndex: idx, status, error, attempts: this.queue?.prompts[idx]?.attempts } }).catch(() => {});
  }

  private sendRunLockChanged(locked: boolean) {
    chrome.runtime.sendMessage({ type: 'RUN_LOCK_CHANGED', payload: { locked } }).catch(() => {});
  }

  private sendQueueSummary(done: number, failed: number, skipped: number) {
    chrome.runtime.sendMessage({ type: 'QUEUE_SUMMARY', payload: { queueId: this.queue?.id, queueName: this.queue?.name, totalPrompts: this.queue?.prompts.length, done, failed, skipped } }).catch(() => {});
  }

  private sendGenerationProgress(promptIdx: number, progress: number, state: string) {
    chrome.runtime.sendMessage({ type: 'GENERATION_PROGRESS', payload: { promptIndex: promptIdx, progress, state, queueId: this.queue?.id } }).catch(() => {});
  }
}

export function isEngineLocked() { return engineRunning; }
