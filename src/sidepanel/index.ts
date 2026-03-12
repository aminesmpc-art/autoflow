/* ============================================================
   AutoFlow – Side Panel Entry (index.ts)
   Wires up all tabs, event handlers, and real-time updates.
   ============================================================ */

import './styles.css';
import {
  QueueObject,
  QueueSettings,
  PromptEntry,
  ImageMeta,
  ScannedAsset,
  LogEntry,
  Message,
  DEFAULT_SETTINGS,
  AVAILABLE_MODELS,
  InputMethod,
  MediaType,
  CreationType,
  Orientation,
  VideoResolution,
  ImageResolution,
  ImageModel,
  ImageRatio,
} from '../types';
import { MAX_IMAGES_PER_PROMPT, MAX_SHARED_IMAGES, MAX_FRAMES_PER_PROMPT } from '../shared/constants';
import { parsePrompts, validatePrompts } from '../shared/parser';
import { sha256 } from '../shared/crypto';
import {
  getAllQueues,
  saveAllQueues,
  addQueue,
  deleteQueue,
  updateQueue,
  getNextQueueName,
  getSettings,
  saveSettings,
  saveImageBlob,
  getImageBlob,
  deleteImageBlob,
  appendLog,
  getLogs,
  getActiveQueueId,
} from '../shared/storage';

// ================================================================
// STATE
// ================================================================

interface AppState {
  parsedPrompts: string[];
  promptImages: Map<number, ({ meta: ImageMeta; objectUrl: string } | null)[]>; // promptIndex → images (null = empty slot)
  sharedImages: { meta: ImageMeta; objectUrl: string }[];               // shared across ALL prompts
  characterImages: { meta: ImageMeta; objectUrl: string }[];            // character library for auto-matching
  autoAddCharacters: boolean;                                            // toggle for auto-add
  lastAddedQueueId: string | null;
  scannedAssets: ScannedAsset[];
  isRunning: boolean;
  activeQueueId: string | null;
}

const state: AppState = {
  parsedPrompts: [],
  promptImages: new Map(),
  sharedImages: [],
  characterImages: [],
  autoAddCharacters: true,
  lastAddedQueueId: null,
  scannedAssets: [],
  isRunning: false,
  activeQueueId: null,
};

// ================================================================
// DOM REFS
// ================================================================

const $ = (sel: string) => document.querySelector(sel) as HTMLElement;
const $$ = (sel: string) => document.querySelectorAll(sel);

// ================================================================
// KEEPALIVE PORT — Prevents service worker from dying
// ================================================================
// A connected port keeps the MV3 service worker alive.
// We maintain this while a queue is running.

let keepalivePort: chrome.runtime.Port | null = null;
let keepaliveInterval: ReturnType<typeof setInterval> | null = null;

function updateStatusDot(status: 'disconnected' | 'connected' | 'running') {
  const dot = document.getElementById('af-status-dot');
  if (!dot) return;
  dot.classList.remove('connected', 'running');
  if (status === 'connected') {
    dot.classList.add('connected');
    dot.title = 'Connected';
  } else if (status === 'running') {
    dot.classList.add('running');
    dot.title = 'Queue Running';
  } else {
    dot.title = 'Disconnected';
  }
}

function startKeepalivePort() {
  if (keepalivePort) return; // already connected

  try {
    keepalivePort = chrome.runtime.connect({ name: 'af-keepalive' });

    // Ping every 20s to keep the port active (Chrome closes idle ports after ~5min)
    keepaliveInterval = setInterval(() => {
      try {
        keepalivePort?.postMessage({ type: 'keepalive' });
      } catch {
        // Port died — will reconnect via onDisconnect
        if (keepaliveInterval) clearInterval(keepaliveInterval);
      }
    }, 20_000);

    keepalivePort.onDisconnect.addListener(() => {
      if (keepaliveInterval) clearInterval(keepaliveInterval);
      keepaliveInterval = null;
      keepalivePort = null;

      // Reconnect if queue is still running
      if (state.isRunning) {
        setTimeout(startKeepalivePort, 1000);
      }
    });

    console.log('[AutoFlow] Keepalive port connected');
    updateStatusDot(state.isRunning ? 'running' : 'connected');
  } catch (err) {
    console.warn('[AutoFlow] Could not open keepalive port:', err);
    updateStatusDot('disconnected');
  }
}

function stopKeepalivePort() {
  if (keepaliveInterval) {
    clearInterval(keepaliveInterval);
    keepaliveInterval = null;
  }
  if (keepalivePort) {
    try { keepalivePort.disconnect(); } catch { /* already dead */ }
    keepalivePort = null;
  }
  console.log('[AutoFlow] Keepalive port disconnected');
  updateStatusDot('disconnected');
}

// ================================================================
// INIT
// ================================================================

document.addEventListener('DOMContentLoaded', async () => {
  initTabs();
  initVideoTab();
  initSettingsTab();
  initQueuesTab();
  initLibraryTab();
  initMessageListener();
  await loadSettings();
  await refreshQueuesList();
  await loadActiveQueueState();

  // Set initial status dot — ping background to verify connection
  const ping = await sendToBackground({ type: 'PING' });
  if (!ping?.error) {
    updateStatusDot(state.isRunning ? 'running' : 'connected');
  }

  // First-run disclosure — show once, remember dismissal
  const { af_first_run_seen } = await chrome.storage.local.get('af_first_run_seen');
  if (!af_first_run_seen) {
    const firstRunEl = $('#af-first-run');
    if (firstRunEl) {
      firstRunEl.style.display = 'flex';
      $('#btn-dismiss-first-run')?.addEventListener('click', () => {
        firstRunEl.style.display = 'none';
        chrome.storage.local.set({ af_first_run_seen: true });
      });
    }
  }
});

// ================================================================
// TABS
// ================================================================

function initTabs() {
  $$('.af-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      $$('.af-tab').forEach(t => { t.classList.remove('active'); t.setAttribute('aria-selected', 'false'); });
      $$('.af-panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      tab.setAttribute('aria-selected', 'true');
      const panelId = `panel-${tab.getAttribute('data-tab')}`;
      $(`#${panelId}`)?.classList.add('active');

      // Refresh queues when switching to that tab
      if (tab.getAttribute('data-tab') === 'queues') refreshQueuesList();
    });
  });
}

// ================================================================
// TAB A: VIDEO — PROMPTS + IMAGES + ADD TO QUEUE + MONITOR
// ================================================================

/** Re-parse the textarea, update prompt list and counter.
 *  Preserves per-prompt images that were already attached. */
function reparsePrompts() {
  const raw = ($('#prompt-input') as HTMLTextAreaElement).value;
  const freshPrompts = parsePrompts(raw);

  // Trim promptImages map: remove entries beyond the new prompt count
  const oldKeys = [...state.promptImages.keys()];
  for (const key of oldKeys) {
    if (key >= freshPrompts.length) {
      state.promptImages.delete(key);
    }
  }

  state.parsedPrompts = freshPrompts;

  const count = state.parsedPrompts.length;
  $('#prompt-count').textContent = count > 0
    ? `${count} prompt${count !== 1 ? 's' : ''}`
    : '';
  $('#queue-actions').style.display = count > 0 ? 'block' : 'none';

  renderPromptList();
}

function initVideoTab() {
  // Parse button
  $('#btn-parse').addEventListener('click', () => {
    reparsePrompts();
  });

  // Auto-reparse when textarea content changes (debounced)
  let reparseTimer: ReturnType<typeof setTimeout> | null = null;
  ($('#prompt-input') as HTMLTextAreaElement).addEventListener('input', () => {
    if (reparseTimer) clearTimeout(reparseTimer);
    reparseTimer = setTimeout(() => {
      reparsePrompts();
    }, 600);
  });

  // Add to Queue
  $('#btn-add-queue').addEventListener('click', addToQueue);

  // Run target buttons
  $('#btn-target-new').addEventListener('click', () => setRunTarget('newProject'));
  $('#btn-target-current').addEventListener('click', () => setRunTarget('currentProject'));

  // Monitor controls
  $('#btn-pause').addEventListener('click', () => sendToBackground({ type: 'PAUSE_QUEUE' }));
  $('#btn-resume').addEventListener('click', () => sendToBackground({ type: 'RESUME_QUEUE' }));
  $('#btn-stop').addEventListener('click', () => sendToBackground({ type: 'STOP_QUEUE' }));
  $('#btn-skip').addEventListener('click', () => sendToBackground({ type: 'SKIP_CURRENT' }));
  $('#btn-retry').addEventListener('click', () => sendToBackground({ type: 'RETRY_FAILED' }));
  $('#btn-manual-resume').addEventListener('click', () => {
    $('#manual-intervention').style.display = 'none';
    sendToBackground({ type: 'RESUME_QUEUE' });
  });

  // Failed generations controls
  $('#btn-scan-failed').addEventListener('click', () => {
    showToast('Scanning page for failed tiles...');
    sendToBackground({ type: 'SCAN_FAILED_TILES' });
  });
  $('#btn-copy-failed').addEventListener('click', () => {
    const textarea = $('#failed-prompts') as HTMLTextAreaElement;
    if (textarea.value) {
      navigator.clipboard.writeText(textarea.value).then(() => {
        showToast('Failed prompts copied to clipboard!');
      }).catch(() => {
        textarea.select();
        document.execCommand('copy');
        showToast('Failed prompts copied!');
      });
    }
  });
  $('#btn-retry-page').addEventListener('click', () => {
    showToast('Retrying failed tiles on page...');
    sendToBackground({ type: 'RETRY_FAILED_TILES' });
  });

  // Shared reference images
  const sharedAddBtn = $('#btn-add-shared-img') as HTMLButtonElement;
  const sharedFileInput = $('#shared-file-input') as HTMLInputElement;

  sharedAddBtn.addEventListener('click', () => {
    if (state.sharedImages.length >= MAX_SHARED_IMAGES) {
      showToast(`Maximum ${MAX_SHARED_IMAGES} shared reference images.`);
      return;
    }
    sharedFileInput.click();
  });

  sharedFileInput.addEventListener('change', async () => {
    const files = sharedFileInput.files;
    if (!files) return;
    await addSharedImages(Array.from(files));
    sharedFileInput.value = '';
    renderSharedImages();
    renderPromptList(); // update counters that show (+N shared)
  });

  // Character images library
  const charAddBtn = $('#btn-add-char-img') as HTMLButtonElement;
  const charFileInput = $('#char-file-input') as HTMLInputElement;
  const charToggle = $('#toggle-auto-char') as HTMLInputElement;

  charToggle.checked = state.autoAddCharacters;
  charToggle.addEventListener('change', () => {
    state.autoAddCharacters = charToggle.checked;
    renderPromptList(); // re-run auto-matching
  });

  charAddBtn.addEventListener('click', () => {
    charFileInput.click();
  });

  charFileInput.addEventListener('change', async () => {
    const files = charFileInput.files;
    if (!files) return;
    await addCharacterImages(Array.from(files));
    charFileInput.value = '';
    renderCharacterImages();
    renderPromptList(); // re-run auto-matching
  });

  // Auto-map images to prompts (1-to-1)
  const automapBtn = $('#btn-automap') as HTMLButtonElement;
  const automapFileInput = $('#automap-file-input') as HTMLInputElement;

  automapBtn.addEventListener('click', () => {
    if (state.parsedPrompts.length === 0) {
      showToast('Parse prompts first before auto-mapping images.');
      return;
    }
    automapFileInput.click();
  });

  automapFileInput.addEventListener('change', async () => {
    const files = automapFileInput.files;
    if (!files || files.length === 0) return;
    await autoMapImagesToPrompts(Array.from(files));
    automapFileInput.value = '';
    renderPromptList();
  });

  // Frame Chain: overlapping Start/End frames
  const framechainBtn = $('#btn-framechain') as HTMLButtonElement;
  const framechainFileInput = $('#framechain-file-input') as HTMLInputElement;

  framechainBtn.addEventListener('click', () => {
    if (state.parsedPrompts.length === 0) {
      showToast('Parse prompts first before chaining frames.');
      return;
    }
    framechainFileInput.click();
  });

  framechainFileInput.addEventListener('change', async () => {
    const files = framechainFileInput.files;
    if (!files || files.length === 0) return;
    await frameChainImagesToPrompts(Array.from(files));
    framechainFileInput.value = '';
    renderPromptList();
  });
}

function renderPromptList() {
  const container = $('#prompt-list');
  container.innerHTML = '';

  // Show/hide image sections based on prompts & creation type
  const creationTypeRadio = document.querySelector('input[name="creationType"]:checked') as HTMLInputElement;
  const creationType = (creationTypeRadio?.value || 'ingredients') as CreationType;
  updateCreationTypeVisibility(creationType);

  const isFrames = creationType === 'frames';
  const maxImg = isFrames ? MAX_FRAMES_PER_PROMPT : MAX_IMAGES_PER_PROMPT;

  state.parsedPrompts.forEach((text, idx) => {
    const row = document.createElement('div');
    row.className = 'af-prompt-row';
    row.dataset.index = String(idx);

    const preview = text.length > 80 ? text.substring(0, 80) + '…' : text;
    const images = state.promptImages.get(idx) || [];
    const imgCount = images.filter(Boolean).length; // count only non-null entries

    // In frames mode: no shared/character images — only Start + End frames
    const sharedCount = isFrames ? 0 : state.sharedImages.length;
    const autoMatchedCount = isFrames ? 0 : (state.autoAddCharacters ? getAutoMatchedImages(text).length : 0);
    const effectiveCount = Math.min(imgCount + autoMatchedCount + sharedCount, maxImg);

    // Build extra info tags
    const extras: string[] = [];
    if (sharedCount > 0) extras.push(`+${sharedCount} shared`);
    if (autoMatchedCount > 0) extras.push(`+${autoMatchedCount} char`);
    const extrasStr = extras.length > 0 ? ` (${extras.join(', ')})` : '';

    row.innerHTML = `
      <div class="af-prompt-header" data-toggle>
        <span class="af-prompt-num">#${idx + 1}</span>
        <span class="af-prompt-preview">${escapeHtml(preview)}</span>
        <span class="af-status af-status-not-added">Not Added</span>
      </div>
      <div class="af-prompt-full">${escapeHtml(text)}</div>
      <div class="af-images-section">
        <div class="af-img-thumbnails" data-prompt-idx="${idx}"></div>
        ${isFrames ? '' : `<span class="af-img-counter">${effectiveCount}/${maxImg}${extrasStr}</span>`}
        ${isFrames ? '' : `<button class="af-btn af-btn-add-img af-btn-sm" data-prompt-idx="${idx}">+ Add images</button>`}
        ${!isFrames && imgCount > 0 ? `<button class="af-btn-copy-all" data-copy-from="${idx}" title="Copy these images to all other prompts">Copy to all</button>` : ''}
        ${isFrames ? '' : `<input type="file" class="af-file-input" data-prompt-idx="${idx}" accept="image/*" multiple />`}
      </div>
    `;

    // Expand/collapse
    row.querySelector('[data-toggle]')!.addEventListener('click', () => {
      row.classList.toggle('expanded');
    });

    // Add images button (ingredients mode only — frames mode uses slot placeholders)
    const addBtn = row.querySelector('.af-btn-add-img') as HTMLButtonElement | null;
    const fileInput = row.querySelector('.af-file-input') as HTMLInputElement | null;

    if (addBtn && fileInput) {
      addBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (imgCount >= maxImg) {
          showToast(`Maximum ${MAX_IMAGES_PER_PROMPT} reference images per prompt.`);
          return;
        }
        fileInput.click();
      });

      fileInput.addEventListener('change', async () => {
        const files = fileInput.files;
        if (!files) return;
        await addImagesToPrompt(idx, Array.from(files));
        fileInput.value = '';
        renderPromptList(); // re-render
      });
    }

    // Copy to all prompts button
    const copyAllBtn = row.querySelector('.af-btn-copy-all') as HTMLButtonElement | null;
    if (copyAllBtn) {
      copyAllBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const fromIdx = parseInt(copyAllBtn.dataset.copyFrom || '0', 10);
        copyImagesToAllPrompts(fromIdx);
      });
    }

    // Render existing thumbnails — frames mode uses fixed Start/End slots
    if (isFrames) {
      renderFrameSlots(row, idx);
    } else {
      renderImageThumbnails(row, idx, images.filter(Boolean) as { meta: ImageMeta; objectUrl: string }[]);
    }

    // In frames mode, skip auto-matched & shared image indicators
    if (!isFrames) {
      // Render auto-matched character images (read-only, with badge)
      if (state.autoAddCharacters) {
        const autoMatched = getAutoMatchedImages(text);
        renderAutoMatchedThumbnails(row, autoMatched);
      }

      // Render shared image indicators (read-only, with badge)
      if (state.sharedImages.length > 0) {
        renderSharedThumbnailsInRow(row);
      }
    }

    container.appendChild(row);
  });
}

function renderImageThumbnails(row: HTMLElement, promptIdx: number, images: { meta: ImageMeta; objectUrl: string }[]) {
  const container = row.querySelector('.af-img-thumbnails') as HTMLElement;
  container.innerHTML = '';

  images.forEach((img, imgIdx) => {
    const wrap = document.createElement('div');
    wrap.className = 'af-img-thumb-wrap';
    wrap.innerHTML = `
      <img class="af-img-thumb" src="${img.objectUrl}" alt="${escapeHtml(img.meta.filename)}" />
      <button class="af-img-remove" data-prompt-idx="${promptIdx}" data-img-idx="${imgIdx}">×</button>
    `;
    wrap.querySelector('.af-img-remove')!.addEventListener('click', (e) => {
      e.stopPropagation();
      removeImageFromPrompt(promptIdx, imgIdx);
      renderPromptList();
    });
    container.appendChild(wrap);
  });
}

/**
 * Render fixed Start/End frame slots for frames mode.
 * Always shows exactly 2 slots. Filled slots show the image + delete button.
 * Empty slots show a clickable placeholder to upload a replacement.
 */
function renderFrameSlots(row: HTMLElement, promptIdx: number) {
  const container = row.querySelector('.af-img-thumbnails') as HTMLElement;
  container.innerHTML = '';

  const images = state.promptImages.get(promptIdx) || [];
  // Ensure we always have 2 slots
  const slots: ({ meta: ImageMeta; objectUrl: string } | null)[] = [
    images[0] || null,
    images[1] || null,
  ];

  const labels = ['Start', 'End'];

  slots.forEach((slot, slotIdx) => {
    const wrap = document.createElement('div');
    wrap.className = 'af-frame-slot';

    if (slot) {
      // Filled slot: show image + label + delete button
      wrap.classList.add('af-frame-slot-filled');
      wrap.innerHTML = `
        <span class="af-frame-slot-label">${labels[slotIdx]}</span>
        <img class="af-img-thumb" src="${slot.objectUrl}" alt="${escapeHtml(slot.meta.filename)}" />
        <button class="af-img-remove" data-prompt-idx="${promptIdx}" data-slot-idx="${slotIdx}" title="Remove ${labels[slotIdx]} frame">×</button>
      `;
      wrap.querySelector('.af-img-remove')!.addEventListener('click', (e) => {
        e.stopPropagation();
        clearFrameSlot(promptIdx, slotIdx);
        renderPromptList();
      });
    } else {
      // Empty slot: clickable placeholder
      wrap.classList.add('af-frame-slot-empty');
      wrap.innerHTML = `
        <span class="af-frame-slot-label">${labels[slotIdx]}</span>
        <div class="af-frame-slot-placeholder" title="Click to add ${labels[slotIdx]} frame">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
        </div>
        <input type="file" class="af-frame-slot-input" accept="image/*" style="display:none" />
      `;
      const placeholder = wrap.querySelector('.af-frame-slot-placeholder') as HTMLElement;
      const fileInput = wrap.querySelector('.af-frame-slot-input') as HTMLInputElement;
      placeholder.addEventListener('click', (e) => {
        e.stopPropagation();
        fileInput.click();
      });
      fileInput.addEventListener('change', async () => {
        const files = fileInput.files;
        if (!files || files.length === 0) return;
        await replaceFrameSlot(promptIdx, slotIdx, files[0]);
        fileInput.value = '';
        renderPromptList();
      });
    }

    container.appendChild(wrap);

    // Add arrow between Start and End
    if (slotIdx === 0) {
      const arrow = document.createElement('span');
      arrow.className = 'af-frame-slot-arrow';
      arrow.textContent = '→';
      container.appendChild(arrow);
    }
  });
}

/**
 * Clear a specific frame slot (set to null) without removing the other slot.
 */
function clearFrameSlot(promptIdx: number, slotIdx: number) {
  const images = state.promptImages.get(promptIdx) || [];
  // Ensure array has 2 entries
  while (images.length < 2) images.push(null);

  const old = images[slotIdx];
  if (old) {
    URL.revokeObjectURL(old.objectUrl);
    deleteImageBlob(old.meta.id).catch(() => { });
  }
  images[slotIdx] = null;
  state.promptImages.set(promptIdx, images);
}

/**
 * Replace a specific frame slot with a new image file.
 */
async function replaceFrameSlot(promptIdx: number, slotIdx: number, file: File) {
  const images = state.promptImages.get(promptIdx) || [];
  // Ensure array has 2 entries
  while (images.length < 2) images.push(null);

  // Clean up old image in this slot
  const old = images[slotIdx];
  if (old) {
    URL.revokeObjectURL(old.objectUrl);
    deleteImageBlob(old.meta.id).catch(() => { });
  }

  const id = crypto.randomUUID();
  const buffer = await file.arrayBuffer();
  const hash = await sha256(buffer);
  const blob = new Blob([buffer], { type: file.type });

  const meta: ImageMeta = {
    id,
    filename: file.name,
    mime: file.type,
    size: file.size,
    sha256: hash,
    lastModified: file.lastModified,
  };

  await saveImageBlob(id, blob);
  const objectUrl = URL.createObjectURL(blob);
  images[slotIdx] = { meta, objectUrl };
  state.promptImages.set(promptIdx, images);
}

async function addImagesToPrompt(promptIdx: number, files: File[]) {
  const current = state.promptImages.get(promptIdx) || [];

  // Determine limit based on creation type
  const creationTypeRadio = document.querySelector('input[name="creationType"]:checked') as HTMLInputElement;
  const isFrames = creationTypeRadio?.value === 'frames';
  const maxImg = isFrames ? MAX_FRAMES_PER_PROMPT : MAX_IMAGES_PER_PROMPT;

  if (isFrames) {
    // In frames mode, fill empty slots (null entries) first
    while (current.length < 2) current.push(null);

    let fileIdx = 0;
    for (let slotIdx = 0; slotIdx < 2 && fileIdx < files.length; slotIdx++) {
      if (current[slotIdx] === null) {
        const file = files[fileIdx++];
        const id = crypto.randomUUID();
        const buffer = await file.arrayBuffer();
        const hash = await sha256(buffer);
        const blob = new Blob([buffer], { type: file.type });
        const meta: ImageMeta = {
          id, filename: file.name, mime: file.type,
          size: file.size, sha256: hash, lastModified: file.lastModified,
        };
        await saveImageBlob(id, blob);
        current[slotIdx] = { meta, objectUrl: URL.createObjectURL(blob) };
      }
    }

    const filledCount = current.filter(Boolean).length;
    if (fileIdx === 0) {
      showToast('Both frame slots are already filled. Remove one first.');
    } else if (fileIdx < files.length) {
      showToast(`Only ${fileIdx} empty slot(s) available. ${files.length - fileIdx} image(s) skipped.`);
    }

    state.promptImages.set(promptIdx, current);
    return;
  }

  // Ingredients mode: append up to max
  const filled = current.filter(Boolean) as { meta: ImageMeta; objectUrl: string }[];
  const remaining = maxImg - filled.length;

  if (remaining <= 0) {
    showToast(`Maximum ${MAX_IMAGES_PER_PROMPT} reference images per prompt.`);
    return;
  }

  const toAdd = files.slice(0, remaining);
  if (files.length > remaining) {
    showToast(`Only ${remaining} more image(s) allowed. Added first ${remaining}.`);
  }

  for (const file of toAdd) {
    const id = crypto.randomUUID();
    const buffer = await file.arrayBuffer();
    const hash = await sha256(buffer);
    const blob = new Blob([buffer], { type: file.type });

    const meta: ImageMeta = {
      id,
      filename: file.name,
      mime: file.type,
      size: file.size,
      sha256: hash,
      lastModified: file.lastModified,
    };

    // Store blob in IndexedDB
    await saveImageBlob(id, blob);

    const objectUrl = URL.createObjectURL(blob);
    current.push({ meta, objectUrl });
  }

  state.promptImages.set(promptIdx, current);
}

function removeImageFromPrompt(promptIdx: number, imgIdx: number) {
  const images = state.promptImages.get(promptIdx) || [];
  if (imgIdx >= 0 && imgIdx < images.length) {
    const removed = images.splice(imgIdx, 1)[0];
    if (removed) {
      URL.revokeObjectURL(removed.objectUrl);
      deleteImageBlob(removed.meta.id).catch(() => { });
    }
    state.promptImages.set(promptIdx, images);
  }
}

/**
 * Add shared images that apply to ALL prompts.
 */
async function addSharedImages(files: File[]) {
  const remaining = MAX_SHARED_IMAGES - state.sharedImages.length;
  if (remaining <= 0) {
    showToast(`Maximum ${MAX_SHARED_IMAGES} shared reference images.`);
    return;
  }

  const toAdd = files.slice(0, remaining);
  if (files.length > remaining) {
    showToast(`Only ${remaining} more shared image(s) allowed. Added first ${remaining}.`);
  }

  for (const file of toAdd) {
    const id = crypto.randomUUID();
    const buffer = await file.arrayBuffer();
    const hash = await sha256(buffer);
    const blob = new Blob([buffer], { type: file.type });

    const meta: ImageMeta = {
      id,
      filename: file.name,
      mime: file.type,
      size: file.size,
      sha256: hash,
      lastModified: file.lastModified,
    };

    await saveImageBlob(id, blob);
    const objectUrl = URL.createObjectURL(blob);
    state.sharedImages.push({ meta, objectUrl });
  }
}

/**
 * Render the shared images thumbnails + counter.
 */
function renderSharedImages() {
  const container = $('#shared-img-thumbnails') as HTMLElement;
  container.innerHTML = '';

  state.sharedImages.forEach((img, imgIdx) => {
    const wrap = document.createElement('div');
    wrap.className = 'af-img-thumb-wrap';
    wrap.innerHTML = `
      <img class="af-img-thumb" src="${img.objectUrl}" alt="${escapeHtml(img.meta.filename)}" />
      <button class="af-img-remove" data-shared-idx="${imgIdx}">×</button>
    `;
    wrap.querySelector('.af-img-remove')!.addEventListener('click', (e) => {
      e.stopPropagation();
      removeSharedImage(imgIdx);
      renderSharedImages();
      renderPromptList(); // update counters
    });
    container.appendChild(wrap);
  });

  $('#shared-img-counter').textContent = `${state.sharedImages.length}/${MAX_SHARED_IMAGES}`;
}

function removeSharedImage(imgIdx: number) {
  if (imgIdx >= 0 && imgIdx < state.sharedImages.length) {
    const removed = state.sharedImages.splice(imgIdx, 1)[0];
    URL.revokeObjectURL(removed.objectUrl);
    deleteImageBlob(removed.meta.id).catch(() => { });
  }
}

/**
 * Copy images from one prompt to all other prompts.
 */
function copyImagesToAllPrompts(fromIdx: number) {
  const source = state.promptImages.get(fromIdx) || [];
  if (source.length === 0) {
    showToast('No images to copy.');
    return;
  }

  // Move these images to shared instead — cleaner approach
  // Add source images to shared (avoiding duplicates by sha256)
  const existingHashes = new Set(state.sharedImages.map(i => i.meta.sha256));
  let added = 0;
  for (const img of source) {
    if (state.sharedImages.length >= MAX_SHARED_IMAGES) break;
    if (!img) continue;
    if (existingHashes.has(img.meta.sha256)) continue;
    state.sharedImages.push(img);
    existingHashes.add(img.meta.sha256);
    added++;
  }

  // Clear the per-prompt images since they're now shared
  state.promptImages.set(fromIdx, []);

  showToast(`${added} image(s) moved to Shared Reference Images (applies to all prompts).`);
  renderSharedImages();
  renderPromptList();
}

/**
 * Auto-map multiple images to prompts 1-to-1.
 * Image 1 → Prompt 1, Image 2 → Prompt 2, etc.
 * If more images than prompts, extras are ignored.
 * If fewer images than prompts, only the first N prompts get images.
 */
async function autoMapImagesToPrompts(files: File[]) {
  const promptCount = state.parsedPrompts.length;
  if (promptCount === 0) {
    showToast('No prompts to map images to.');
    return;
  }

  const toMap = files.slice(0, promptCount);
  let mapped = 0;

  for (let i = 0; i < toMap.length; i++) {
    const file = toMap[i];
    const current = state.promptImages.get(i) || [];

    if (current.length >= MAX_IMAGES_PER_PROMPT) {
      continue; // skip prompts that already have max images
    }

    const id = crypto.randomUUID();
    const buffer = await file.arrayBuffer();
    const hash = await sha256(buffer);

    // Check for duplicate in this prompt's existing images
    if (current.some(img => img && img.meta.sha256 === hash)) continue;

    const blob = new Blob([buffer], { type: file.type });
    const meta: ImageMeta = {
      id,
      filename: file.name,
      mime: file.type,
      size: file.size,
      sha256: hash,
      lastModified: file.lastModified,
    };

    await saveImageBlob(id, blob);
    const objectUrl = URL.createObjectURL(blob);
    current.push({ meta, objectUrl });
    state.promptImages.set(i, current);
    mapped++;
  }

  const skipped = files.length > promptCount ? files.length - promptCount : 0;
  let msg = `Mapped ${mapped} image(s) to ${mapped} prompt(s).`;
  if (skipped > 0) msg += ` ${skipped} extra image(s) ignored (only ${promptCount} prompts).`;
  showToast(msg);
}

/**
 * Frame Chain: select N images and create overlapping Start/End frame pairs.
 * Image 1 → Prompt 1 Start, Image 2 → Prompt 1 End
 * Image 2 → Prompt 2 Start, Image 3 → Prompt 2 End
 * Image 3 → Prompt 3 Start, Image 4 → Prompt 3 End
 * ...and so on. N images → N-1 prompt pairs.
 *
 * Each prompt gets exactly 2 images: images[0]=Start frame, images[1]=End frame.
 * The End frame of prompt i is reused as the Start frame of prompt i+1.
 */
async function frameChainImagesToPrompts(files: File[]) {
  if (files.length < 2) {
    showToast('Select at least 2 images to create a frame chain.');
    return;
  }

  const promptCount = state.parsedPrompts.length;
  if (promptCount === 0) {
    showToast('No prompts to map frames to. Parse prompts first.');
    return;
  }

  const chainLength = files.length - 1; // N images → N-1 pairs
  const pairsToMap = Math.min(chainLength, promptCount);

  if (chainLength > promptCount) {
    showToast(`You have ${files.length} images (${chainLength} pairs) but only ${promptCount} prompt(s). Only the first ${promptCount + 1} images will be used.`);
  } else if (chainLength < promptCount) {
    showToast(`You have ${files.length} images (${chainLength} pairs) but ${promptCount} prompt(s). Prompts ${chainLength + 1}–${promptCount} won't get frame images.`);
  }

  // Pre-process all needed files (up to pairsToMap + 1 images)
  const neededCount = pairsToMap + 1;
  interface ProcessedImage {
    meta: ImageMeta;
    objectUrl: string;
    blob: Blob;
    hash: string;
  }
  const processed: ProcessedImage[] = [];

  for (let i = 0; i < neededCount; i++) {
    const file = files[i];
    const id = crypto.randomUUID();
    const buffer = await file.arrayBuffer();
    const hash = await sha256(buffer);
    const blob = new Blob([buffer], { type: file.type });

    const meta: ImageMeta = {
      id,
      filename: file.name,
      mime: file.type,
      size: file.size,
      sha256: hash,
      lastModified: file.lastModified,
    };

    await saveImageBlob(id, blob);
    const objectUrl = URL.createObjectURL(blob);
    processed.push({ meta, objectUrl, blob, hash });
  }

  // Assign overlapping pairs to prompts
  let mapped = 0;
  for (let i = 0; i < pairsToMap; i++) {
    const startImg = processed[i];     // Start frame (first frame)
    const endImg = processed[i + 1];   // End frame (last frame)

    // Replace any existing images on this prompt with the chain pair
    const existing = state.promptImages.get(i) || [];
    // Revoke old object URLs and clean up
    for (const old of existing) {
      if (old) {
        URL.revokeObjectURL(old.objectUrl);
        deleteImageBlob(old.meta.id).catch(() => { });
      }
    }

    // Set exactly 2 images: [Start, End]
    state.promptImages.set(i, [
      { meta: startImg.meta, objectUrl: startImg.objectUrl },
      { meta: endImg.meta, objectUrl: endImg.objectUrl },
    ]);
    mapped++;
  }

  // Render chain preview
  renderFrameChainPreview(processed, pairsToMap);

  showToast(`Frame chain: ${mapped} prompt(s) mapped with overlapping Start/End frames from ${neededCount} images.`);
}

/**
 * Render a visual preview of the frame chain mapping.
 */
function renderFrameChainPreview(
  images: { meta: ImageMeta; objectUrl: string }[],
  pairCount: number
) {
  const container = $('#framechain-preview') as HTMLElement;
  container.innerHTML = '';

  if (pairCount === 0) {
    container.style.display = 'none';
    return;
  }

  container.style.display = 'flex';

  for (let i = 0; i < pairCount; i++) {
    const startImg = images[i];
    const endImg = images[i + 1];

    const pair = document.createElement('div');
    pair.className = 'af-framechain-pair';
    pair.innerHTML = `
      <span class="af-framechain-pair-num">#${i + 1}</span>
      <span class="af-framechain-label">Start</span>
      <img class="af-framechain-thumb" src="${startImg.objectUrl}" alt="${escapeHtml(startImg.meta.filename)}" />
      <span class="af-framechain-arrow">→</span>
      <span class="af-framechain-label">End</span>
      <img class="af-framechain-thumb" src="${endImg.objectUrl}" alt="${escapeHtml(endImg.meta.filename)}" />
    `;
    container.appendChild(pair);
  }
}

// ================================================================
// CHARACTER IMAGE LIBRARY + AUTO-MATCHING
// ================================================================

/**
 * Add images to the character library.
 * Filenames become the "character name" used for auto-matching.
 */
async function addCharacterImages(files: File[]) {
  for (const file of files) {
    // Check for duplicate by sha256
    const buffer = await file.arrayBuffer();
    const hash = await sha256(buffer);
    const already = state.characterImages.some(i => i.meta.sha256 === hash);
    if (already) continue;

    const id = crypto.randomUUID();
    const blob = new Blob([buffer], { type: file.type });

    const meta: ImageMeta = {
      id,
      filename: file.name,
      mime: file.type,
      size: file.size,
      sha256: hash,
      lastModified: file.lastModified,
    };

    await saveImageBlob(id, blob);
    const objectUrl = URL.createObjectURL(blob);
    state.characterImages.push({ meta, objectUrl });
  }
}

/**
 * Render the character images library thumbnails + counter.
 */
function renderCharacterImages() {
  const container = $('#char-img-thumbnails') as HTMLElement;
  container.innerHTML = '';

  state.characterImages.forEach((img, imgIdx) => {
    const charName = getCharacterName(img.meta.filename);
    const wrap = document.createElement('div');
    wrap.className = 'af-img-thumb-wrap af-char-thumb';
    wrap.title = charName;
    wrap.innerHTML = `
      <img class="af-img-thumb" src="${img.objectUrl}" alt="${escapeHtml(charName)}" />
      <span class="af-char-label">${escapeHtml(charName)}</span>
      <button class="af-img-remove" data-char-idx="${imgIdx}">×</button>
    `;
    wrap.querySelector('.af-img-remove')!.addEventListener('click', (e) => {
      e.stopPropagation();
      removeCharacterImage(imgIdx);
      renderCharacterImages();
      renderPromptList();
    });
    container.appendChild(wrap);
  });

  $('#char-img-counter').textContent = `${state.characterImages.length} character${state.characterImages.length !== 1 ? 's' : ''}`;
}

function removeCharacterImage(imgIdx: number) {
  if (imgIdx >= 0 && imgIdx < state.characterImages.length) {
    const removed = state.characterImages.splice(imgIdx, 1)[0];
    URL.revokeObjectURL(removed.objectUrl);
    deleteImageBlob(removed.meta.id).catch(() => { });
  }
}

/**
 * Extract the "character name" from a filename.
 * Strips extension and common separators: "Giant_squid_01.jpg" → "Giant squid"
 */
function getCharacterName(filename: string): string {
  // Remove extension
  const stem = filename.replace(/\.[^.]+$/, '');
  // Replace underscores, hyphens, and trailing numbers with spaces
  return stem
    .replace(/[_-]/g, ' ')
    .replace(/\s*\d+\s*$/, '')  // strip trailing numbers
    .trim();
}

/**
 * Find character images whose name appears in the given prompt text.
 * Returns matching images (deduplicated).
 */
function getAutoMatchedImages(promptText: string): { meta: ImageMeta; objectUrl: string }[] {
  if (!state.autoAddCharacters || state.characterImages.length === 0) return [];

  const textLower = promptText.toLowerCase();
  const matched: { meta: ImageMeta; objectUrl: string }[] = [];
  const seen = new Set<string>();

  for (const img of state.characterImages) {
    if (seen.has(img.meta.sha256)) continue;
    const charName = getCharacterName(img.meta.filename).toLowerCase();
    if (charName.length < 2) continue; // skip single-char names

    // Check if the character name appears in the prompt text
    // Use word boundary matching where possible
    const escaped = charName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`\\b${escaped}\\b`, 'i');
    if (regex.test(promptText)) {
      matched.push(img);
      seen.add(img.meta.sha256);
    }
  }

  return matched;
}

/**
 * Render auto-matched character thumbnails inside a prompt row (read-only, with "char" badge).
 */
function renderAutoMatchedThumbnails(row: HTMLElement, autoMatched: { meta: ImageMeta; objectUrl: string }[]) {
  if (autoMatched.length === 0) return;
  const container = row.querySelector('.af-img-thumbnails') as HTMLElement;

  for (const img of autoMatched) {
    const charName = getCharacterName(img.meta.filename);
    const wrap = document.createElement('div');
    wrap.className = 'af-img-thumb-wrap af-thumb-auto';
    wrap.title = `Auto-matched: ${charName}`;
    wrap.innerHTML = `
      <img class="af-img-thumb" src="${img.objectUrl}" alt="${escapeHtml(charName)}" />
      <span class="af-thumb-badge af-badge-char">C</span>
    `;
    container.appendChild(wrap);
  }
}

/**
 * Render shared image indicators inside a prompt row (read-only, with "S" badge).
 */
function renderSharedThumbnailsInRow(row: HTMLElement) {
  const container = row.querySelector('.af-img-thumbnails') as HTMLElement;

  for (const img of state.sharedImages) {
    const wrap = document.createElement('div');
    wrap.className = 'af-img-thumb-wrap af-thumb-shared';
    wrap.title = `Shared: ${img.meta.filename}`;
    wrap.innerHTML = `
      <img class="af-img-thumb" src="${img.objectUrl}" alt="${escapeHtml(img.meta.filename)}" />
      <span class="af-thumb-badge af-badge-shared">S</span>
    `;
    container.appendChild(wrap);
  }
}

async function addToQueue() {
  if (state.parsedPrompts.length === 0) {
    showToast('No prompts to add. Parse prompts first.');
    return;
  }

  const settings = await getSettings();
  const queueName = await getNextQueueName();
  const queueId = crypto.randomUUID();

  const prompts: PromptEntry[] = state.parsedPrompts.map((text, idx) => {
    // Merge all image sources: per-prompt (manual) > auto-matched characters > shared
    const perPrompt = (state.promptImages.get(idx) || []).filter(Boolean).map(i => i!.meta);

    const isFrames = settings.creationType === 'frames';
    const maxImg = isFrames ? MAX_FRAMES_PER_PROMPT : MAX_IMAGES_PER_PROMPT;

    // In frames mode, only per-prompt images (Start + End), no shared/character
    const autoMatched = (!isFrames && state.autoAddCharacters)
      ? getAutoMatchedImages(text).map(i => i.meta)
      : [];
    const shared = isFrames ? [] : state.sharedImages.map(i => i.meta);

    // Deduplicate by sha256, priority order: per-prompt → character → shared
    // Cap at maxImg
    const seen = new Set<string>();
    const merged: ImageMeta[] = [];
    for (const img of [...perPrompt, ...autoMatched, ...shared]) {
      if (merged.length >= maxImg) break;
      if (seen.has(img.sha256)) continue;
      seen.add(img.sha256);
      merged.push(img);
    }

    return {
      id: crypto.randomUUID(),
      index: idx,
      text,
      images: merged,
      status: 'queued',
      attempts: 0,
      outputFiles: [],
    };
  });

  const queue: QueueObject = {
    id: queueId,
    name: queueName,
    prompts,
    settings: { ...settings },
    runTarget: null,
    status: 'pending',
    currentPromptIndex: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  await addQueue(queue);
  state.lastAddedQueueId = queueId;

  showToast(`Queue "${queueName}" created with ${prompts.length} prompt(s).`);

  // Show run target options
  $('#run-target-options').style.display = 'flex';

  // Update prompt statuses visually
  $$('.af-status').forEach(badge => {
    badge.className = 'af-status af-status-queued';
    badge.textContent = 'Queued';
  });
}

async function setRunTarget(target: 'newProject' | 'currentProject') {
  if (!state.lastAddedQueueId) return;

  const queues = await getAllQueues();
  const queue = queues.find(q => q.id === state.lastAddedQueueId);
  if (!queue) return;

  queue.runTarget = target;
  queue.updatedAt = Date.now();
  await saveAllQueues(queues);

  showToast(`Queue "${queue.name}" will ${target === 'newProject' ? 'start a new project' : 'run in current project'}.`);
  $('#run-target-options').style.display = 'none';

  // Switch to Queues tab to show the new queue and let user run it
  (document.querySelector('[data-tab="queues"]') as HTMLElement)?.click();
}

// ================================================================
// TAB B: SETTINGS
// ================================================================

function initSettingsTab() {
  $('#btn-save-settings').addEventListener('click', async () => {
    const settings = readSettingsFromUI();
    await saveSettings(settings);
    showToast('Settings saved.');
  });

  $('#btn-refresh-models').addEventListener('click', async () => {
    showToast('Refreshing models from Flow...');
    const response = await sendToBackground({ type: 'REFRESH_MODELS' });
    if (response?.models && response.models.length > 0) {
      const select = $('#setting-model') as HTMLSelectElement;
      select.innerHTML = '';
      for (const model of response.models) {
        const opt = document.createElement('option');
        opt.value = model;
        opt.textContent = model;
        select.appendChild(opt);
      }
      showToast(`Found ${response.models.length} models.`);
    } else {
      showToast(response?.error || 'No models found. Make sure a Flow tab is open.');
    }
  });

  // Typing mode toggle → show/hide typing speed slider
  const typingModeToggle = $('#setting-typing-mode') as HTMLInputElement;
  typingModeToggle.addEventListener('change', () => {
    updateTypingModeVisibility(typingModeToggle.checked);
  });

  // Typing speed slider → update display
  const speedSlider = $('#setting-typing-speed-slider') as HTMLInputElement;
  speedSlider.addEventListener('input', () => {
    const val = parseFloat(speedSlider.value);
    ($('#typing-speed-display') as HTMLElement).textContent = `${val.toFixed(2)}x`;
  });

  // Configure folder link
  $('#btn-configure-folder').addEventListener('click', (e) => {
    e.preventDefault();
    showToast('Downloads will go to your browser\'s default download folder. Change it in chrome://settings/downloads.');
  });

  // Clear Flow Cache button
  $('#btn-clear-cache').addEventListener('click', async () => {
    const response = await sendToBackground({ type: 'PING' });
    if (response) {
      // Reload the Flow tab to clear its cache
      showToast('Clearing Flow cache... The Flow tab will reload.');
      await sendToBackground({ type: 'STOP_QUEUE' });
      // Send a reload command via background
      chrome.runtime.sendMessage({ type: 'PING' }); // Re-establish connection
      showToast('Flow cache cleared. Please reload the Flow tab manually if needed.');
    } else {
      showToast('No active Flow tab found. Open Flow first.');
    }
  });

  // Media type radio → show/hide video vs image settings
  const mediaRadios = $$('input[name="mediaType"]') as NodeListOf<HTMLInputElement>;
  mediaRadios.forEach(r => {
    r.addEventListener('change', () => {
      updateMediaTypeVisibility(r.value as MediaType);
    });
  });

  // Creation type radio → show/hide frame chain vs ingredient sections
  const creationRadios = $$('input[name="creationType"]') as NodeListOf<HTMLInputElement>;
  creationRadios.forEach(r => {
    r.addEventListener('change', () => {
      const newType = r.value as CreationType;
      const oldType = newType === 'frames' ? 'ingredients' : 'frames';

      // Switching away from frames → clear per-prompt frame images
      if (oldType === 'frames' && state.promptImages.size > 0) {
        for (const [idx, imgs] of state.promptImages) {
          for (const img of imgs) {
            if (img) {
              URL.revokeObjectURL(img.objectUrl);
              deleteImageBlob(img.meta.id).catch(() => { });
            }
          }
        }
        state.promptImages.clear();
        // Clear frame chain preview
        const preview = document.getElementById('framechain-preview');
        if (preview) { preview.innerHTML = ''; preview.style.display = 'none'; }
      }

      updateCreationTypeVisibility(newType);
      renderPromptList();
    });
  });
}

async function loadSettings() {
  const settings = await getSettings();
  // Media type
  const mediaRadios = $$('input[name="mediaType"]') as NodeListOf<HTMLInputElement>;
  mediaRadios.forEach(r => { r.checked = r.value === (settings.mediaType ?? 'video'); });
  // Creation type
  const creationRadios = $$('input[name="creationType"]') as NodeListOf<HTMLInputElement>;
  creationRadios.forEach(r => { r.checked = r.value === (settings.creationType ?? 'ingredients'); });
  // Model
  ($('#setting-model') as HTMLSelectElement).value = settings.model;
  // Orientation
  const orientationRadios = $$('input[name="orientation"]') as NodeListOf<HTMLInputElement>;
  orientationRadios.forEach(r => { r.checked = r.value === (settings.orientation ?? 'landscape'); });
  // Generations
  ($('#setting-generations') as HTMLSelectElement).value = String(settings.generations);
  ($('#setting-stop-error') as HTMLInputElement).checked = settings.stopOnError;

  // Image generation settings
  ($('#setting-image-model') as HTMLSelectElement).value = settings.imageModel ?? 'Nano Banana Pro';
  ($('#setting-image-ratio') as HTMLSelectElement).value = settings.imageRatio ?? 'Landscape (16:9)';

  // Show/hide video vs image settings based on media type
  updateMediaTypeVisibility(settings.mediaType ?? 'video');

  // Show/hide frame chain vs ingredient sections based on creation type
  updateCreationTypeVisibility(settings.creationType ?? 'ingredients');

  // Timing
  ($('#setting-wait-min') as HTMLInputElement).value = String(settings.waitMinSec ?? 10);
  ($('#setting-wait-max') as HTMLInputElement).value = String(settings.waitMaxSec ?? 20);
  ($('#setting-typing-mode') as HTMLInputElement).checked = settings.typingMode ?? false;
  const speedSlider = $('#setting-typing-speed-slider') as HTMLInputElement;
  speedSlider.value = String(settings.typingSpeedMultiplier ?? 1.0);
  ($('#typing-speed-display') as HTMLElement).textContent = `${(settings.typingSpeedMultiplier ?? 1.0).toFixed(2)}x`;

  // Download
  ($('#setting-auto-dl-videos') as HTMLInputElement).checked = settings.autoDownloadVideos ?? settings.autoDownload ?? true;
  ($('#setting-video-resolution') as HTMLSelectElement).value = settings.videoResolution ?? 'Original (720p)';
  ($('#setting-auto-dl-images') as HTMLInputElement).checked = settings.autoDownloadImages ?? false;
  ($('#setting-image-resolution') as HTMLSelectElement).value = settings.imageResolution ?? '1K';

  // Interface
  ($('#setting-language') as HTMLSelectElement).value = settings.language ?? 'English';

  // Show/hide typing speed based on typing mode
  updateTypingModeVisibility(settings.typingMode ?? false);
}

function readSettingsFromUI(): QueueSettings {
  const mediaTypeRadio = document.querySelector('input[name="mediaType"]:checked') as HTMLInputElement;
  const mediaType = (mediaTypeRadio?.value || 'video') as MediaType;
  const creationTypeRadio = document.querySelector('input[name="creationType"]:checked') as HTMLInputElement;
  const creationType = (creationTypeRadio?.value || 'ingredients') as CreationType;
  const model = ($('#setting-model') as HTMLSelectElement).value;
  const orientationRadio = document.querySelector('input[name="orientation"]:checked') as HTMLInputElement;
  const orientation = (orientationRadio?.value || 'landscape') as Orientation;
  const generations = parseInt(($('#setting-generations') as HTMLSelectElement).value, 10) as 1 | 2 | 3 | 4;
  const stopOnError = ($('#setting-stop-error') as HTMLInputElement).checked;

  // Image generation
  const imageModel = ($('#setting-image-model') as HTMLSelectElement).value as ImageModel;
  const imageRatio = ($('#setting-image-ratio') as HTMLSelectElement).value as ImageRatio;

  // Timing
  const waitMinSec = Math.max(0, parseInt(($('#setting-wait-min') as HTMLInputElement).value, 10) || 10);
  const waitMaxSec = Math.max(waitMinSec, parseInt(($('#setting-wait-max') as HTMLInputElement).value, 10) || 20);
  const typingMode = ($('#setting-typing-mode') as HTMLInputElement).checked;
  const typingSpeedMultiplier = Math.max(0.25, Math.min(3.0, parseFloat(($('#setting-typing-speed-slider') as HTMLInputElement).value) || 1.0));

  // Download
  const autoDownloadVideos = ($('#setting-auto-dl-videos') as HTMLInputElement).checked;
  const videoResolution = ($('#setting-video-resolution') as HTMLSelectElement).value as VideoResolution;
  const autoDownloadImages = ($('#setting-auto-dl-images') as HTMLInputElement).checked;
  const imageResolution = ($('#setting-image-resolution') as HTMLSelectElement).value as ImageResolution;

  // Interface
  const language = ($('#setting-language') as HTMLSelectElement).value;

  // Compute legacy fields from new fields for backward compat
  const autoDownload = autoDownloadVideos || autoDownloadImages;
  const waitBetweenPromptsSec = waitMinSec;
  const inputMethod: InputMethod = typingMode ? 'type' : 'paste';
  const typingCharsPerSecond = Math.round(25 * typingSpeedMultiplier);
  const variableTypingDelay = typingMode;

  return {
    mediaType, creationType, model, orientation, generations, stopOnError,
    imageModel, imageRatio,
    waitMinSec, waitMaxSec, typingMode, typingSpeedMultiplier,
    autoDownloadVideos, videoResolution, autoDownloadImages, imageResolution,
    language,
    autoDownload, waitBetweenPromptsSec, inputMethod, typingCharsPerSecond, variableTypingDelay,
  };
}

// ================================================================
// TAB C: MANAGE QUEUES
// ================================================================

function initQueuesTab() {
  // Rendered dynamically
}

function formatTimeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  return `${d}d ago`;
}

function queueStatusConfig(status: string) {
  switch (status) {
    case 'running': return { label: 'Running', cls: 'running', icon: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>` };
    case 'paused': return { label: 'Paused', cls: 'paused', icon: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>` };
    case 'completed': return { label: 'Completed', cls: 'completed', icon: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>` };
    case 'stopped': return { label: 'Stopped', cls: 'stopped', icon: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><rect x="6" y="6" width="12" height="12" rx="1"/></svg>` };
    default: return { label: 'Pending', cls: 'pending', icon: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>` };
  }
}

async function refreshQueuesList() {
  const queues = await getAllQueues();
  const container = $('#queue-list');

  // Update tab badge
  const tabBadge = document.getElementById('queue-tab-badge');
  if (tabBadge) {
    if (queues.length > 0) {
      tabBadge.textContent = String(queues.length);
      tabBadge.style.display = '';
    } else {
      tabBadge.style.display = 'none';
    }
  }

  if (queues.length === 0) {
    container.innerHTML = `
      <div class="af-empty">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" opacity="0.25">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
          <line x1="3" y1="9" x2="21" y2="9"/>
          <line x1="9" y1="21" x2="9" y2="9"/>
        </svg>
        <p>No queues yet.<br/>Add prompts in the Create tab.</p>
      </div>`;
    return;
  }

  container.innerHTML = '';

  queues.forEach((queue, idx) => {
    const card = document.createElement('div');
    card.className = 'af-q-card';
    card.dataset.queueId = queue.id;

    const total = queue.prompts.length;
    const doneCount = queue.prompts.filter(p => p.status === 'done').length;
    const failedCount = queue.prompts.filter(p => p.status === 'failed').length;
    const pendingCount = total - doneCount - failedCount;
    const progressPct = total > 0 ? Math.round((doneCount / total) * 100) : 0;
    const st = queueStatusConfig(queue.status);

    const targetLabel = queue.runTarget === 'newProject' ? 'New Project' :
      queue.runTarget === 'currentProject' ? 'Current Project' : 'Not set';
    const targetIcon = queue.runTarget === 'newProject'
      ? `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`
      : queue.runTarget === 'currentProject'
        ? `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>`
        : `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" opacity="0.5"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/></svg>`;

    const timeAgo = formatTimeAgo(queue.updatedAt || queue.createdAt);

    const s = queue.settings;
    const isVideo = s.mediaType === 'video';
    const autoDownload = isVideo ? s.autoDownloadVideos : s.autoDownloadImages;
    const downloadRes = isVideo ? s.videoResolution : s.imageResolution;
    const modelDisplay = isVideo ? s.model : s.imageModel;

    card.innerHTML = `
      <div class="af-q-status-bar af-q-status-${st.cls}"></div>
      <div class="af-q-body">
        <div class="af-q-top">
          <div class="af-q-title-row">
            <span class="af-q-name">${escapeHtml(queue.name)}</span>
            <span class="af-q-badge af-q-badge-${st.cls}">${st.icon} ${st.label}</span>
          </div>
          <div class="af-q-time">${timeAgo}</div>
        </div>

        <!-- Settings Grid -->
        <div class="af-q-settings">
          <div class="af-q-settings-group">
            <div class="af-q-settings-title">Generation</div>
            <div class="af-q-setting-row">
              <span class="af-q-setting-key">Media</span>
              <span class="af-q-setting-val">${escapeHtml(s.mediaType ?? 'video')}</span>
            </div>
            <div class="af-q-setting-row">
              <span class="af-q-setting-key">Type</span>
              <span class="af-q-setting-val">${escapeHtml(s.creationType ?? 'ingredients')}</span>
            </div>
            <div class="af-q-setting-row">
              <span class="af-q-setting-key">Model</span>
              <span class="af-q-setting-val af-q-setting-highlight">${escapeHtml(modelDisplay)}</span>
            </div>
            <div class="af-q-setting-row">
              <span class="af-q-setting-key">${isVideo ? 'Orientation' : 'Ratio'}</span>
              <span class="af-q-setting-val">${escapeHtml(isVideo ? (s.orientation ?? 'landscape') : s.imageRatio)}</span>
            </div>
            <div class="af-q-setting-row">
              <span class="af-q-setting-key">Generations</span>
              <span class="af-q-setting-val">&times;${s.generations}</span>
            </div>
          </div>

          <div class="af-q-settings-group">
            <div class="af-q-settings-title">Timing</div>
            <div class="af-q-setting-row">
              <span class="af-q-setting-key">Wait</span>
              <span class="af-q-setting-val">${s.waitMinSec}s – ${s.waitMaxSec}s</span>
            </div>
            <div class="af-q-setting-row">
              <span class="af-q-setting-key">Typing Mode</span>
              <span class="af-q-setting-val">${s.typingMode ? `<span class="af-q-on">ON</span> &times;${s.typingSpeedMultiplier}` : '<span class="af-q-off">OFF</span>'}</span>
            </div>
          </div>

          <div class="af-q-settings-group">
            <div class="af-q-settings-title">Download</div>
            <div class="af-q-setting-row">
              <span class="af-q-setting-key">Auto-DL</span>
              <span class="af-q-setting-val">${autoDownload ? '<span class="af-q-on">ON</span>' : '<span class="af-q-off">OFF</span>'}</span>
            </div>
            <div class="af-q-setting-row">
              <span class="af-q-setting-key">Quality</span>
              <span class="af-q-setting-val">${escapeHtml(downloadRes)}</span>
            </div>
          </div>

          <div class="af-q-settings-group">
            <div class="af-q-settings-title">Behavior</div>
            <div class="af-q-setting-row">
              <span class="af-q-setting-key">Stop on error</span>
              <span class="af-q-setting-val">${s.stopOnError ? '<span class="af-q-on">ON</span>' : '<span class="af-q-off">OFF</span>'}</span>
            </div>
            <div class="af-q-setting-row">
              <span class="af-q-setting-key">Language</span>
              <span class="af-q-setting-val">${escapeHtml(s.language ?? 'English')}</span>
            </div>
            <div class="af-q-setting-row">
              <span class="af-q-setting-key">Target</span>
              <span class="af-q-setting-val af-q-setting-target">${targetIcon} ${targetLabel}</span>
            </div>
          </div>
        </div>

        <div class="af-q-progress-row">
          <div class="af-q-progress-track">
            <div class="af-q-progress-fill af-q-progress-${st.cls}" style="width:${progressPct}%"></div>
            ${failedCount > 0 ? `<div class="af-q-progress-fill af-q-progress-fail" style="width:${Math.round((failedCount / total) * 100)}%;left:${progressPct}%"></div>` : ''}
          </div>
          <span class="af-q-progress-label">${progressPct}%</span>
        </div>

        <div class="af-q-stats">
          <div class="af-q-stat">
            <span class="af-q-stat-num">${total}</span>
            <span class="af-q-stat-label">Prompts</span>
          </div>
          <div class="af-q-stat af-q-stat-done">
            <span class="af-q-stat-num">${doneCount}</span>
            <span class="af-q-stat-label">Done</span>
          </div>
          <div class="af-q-stat af-q-stat-fail">
            <span class="af-q-stat-num">${failedCount}</span>
            <span class="af-q-stat-label">Failed</span>
          </div>
          <div class="af-q-stat">
            <span class="af-q-stat-num">${pendingCount}</span>
            <span class="af-q-stat-label">Pending</span>
          </div>
        </div>

        <div class="af-q-actions">
          <div class="af-q-actions-left">
            <button class="af-q-act-btn" data-action="up" ${idx === 0 ? 'disabled' : ''} title="Move up">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg>
            </button>
            <button class="af-q-act-btn" data-action="down" ${idx === queues.length - 1 ? 'disabled' : ''} title="Move down">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
            </button>
          </div>
          <div class="af-q-actions-right">
            <button class="af-q-act-btn af-q-act-delete" data-action="delete" title="Delete queue">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
            </button>
            <button class="af-q-run-btn" data-action="run" ${!queue.runTarget ? 'disabled title="Set run target first"' : ''}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>
              Run
            </button>
          </div>
        </div>
      </div>
    `;

    // Actions
    card.querySelector('[data-action="up"]')?.addEventListener('click', async () => {
      await moveQueue(idx, idx - 1);
    });
    card.querySelector('[data-action="down"]')?.addEventListener('click', async () => {
      await moveQueue(idx, idx + 1);
    });
    card.querySelector('[data-action="delete"]')?.addEventListener('click', async () => {
      if (!confirm(`Delete queue "${queue.name}"?`)) return;
      await deleteQueue(queue.id);
      showToast(`Queue "${queue.name}" deleted.`);
      await refreshQueuesList();
    });
    card.querySelector('[data-action="run"]')?.addEventListener('click', async () => {
      await runQueue(queue.id);
    });

    container.appendChild(card);
  });
}

async function moveQueue(fromIdx: number, toIdx: number) {
  const queues = await getAllQueues();
  if (toIdx < 0 || toIdx >= queues.length) return;
  const [item] = queues.splice(fromIdx, 1);
  queues.splice(toIdx, 0, item);
  await saveAllQueues(queues);
  await refreshQueuesList();
}

async function runQueue(queueId: string) {
  if (state.isRunning) {
    showToast('Another queue is already running. Stop it first.');
    return;
  }
  showToast('Starting queue...');

  // Get the tab the sidepanel is attached to — this is the project tab the user has open
  let currentTabId: number | undefined;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    currentTabId = tab?.id;
  } catch { /* ignore */ }

  const response = await sendToBackground({
    type: 'START_QUEUE',
    payload: { queueId, tabId: currentTabId },
  });
  if (response?.error) {
    showToast(`Error: ${response.error}`);
    return;
  }
  state.isRunning = true;
  state.activeQueueId = queueId;
  updateRunLockUI(true);
  startKeepalivePort();  // Keep service worker alive during queue execution

  // Switch to Video tab and show monitor
  (document.querySelector('[data-tab="video"]') as HTMLElement)?.click();
  showRunMonitor(queueId);
}

// ================================================================
// RUN MONITOR
// ================================================================

async function showRunMonitor(queueId: string) {
  const queues = await getAllQueues();
  const queue = queues.find(q => q.id === queueId);
  if (!queue) return;

  $('#run-monitor').style.display = 'block';
  $('#monitor-queue-name').textContent = queue.name;
  $('#monitor-progress').textContent = `0 / ${queue.prompts.length}`;
  ($('#btn-pause') as HTMLButtonElement).disabled = false;
  ($('#btn-resume') as HTMLButtonElement).disabled = true;

  // Clear logs
  $('#monitor-logs').innerHTML = '';
}

async function loadActiveQueueState() {
  const activeId = await getActiveQueueId();
  if (activeId) {
    const queues = await getAllQueues();
    const queue = queues.find(q => q.id === activeId);
    if (queue && (queue.status === 'running' || queue.status === 'paused')) {
      state.isRunning = true;
      state.activeQueueId = activeId;
      startKeepalivePort();  // Restore keepalive if queue was already running
      showRunMonitor(activeId);
    }
  }
}

// ================================================================
// TAB D: LIBRARY
// ================================================================

let libraryFilter: 'all' | 'image' | 'video' = 'all';
let librarySearch = '';

function initLibraryTab() {
  $('#btn-scan').addEventListener('click', async () => {
    if (state.isRunning) {
      showToast('Pause the running queue before scanning.');
      return;
    }

    // Pre-check: verify extension can talk to the Flow tab
    const pingResult = await sendToBackground({ type: 'PING' });
    if (pingResult?.error) {
      showToast(`Cannot reach Flow tab: ${pingResult.error}`);
      return;
    }

    showToast('Scanning project...');
    const response = await sendToBackground({ type: 'SCAN_LIBRARY' });
    if (response?.error) {
      showToast(`Scan error: ${response.error}`);
      return;
    }
    state.scannedAssets = response?.assets || [];
    if (state.scannedAssets.length === 0) {
      showToast('No assets found. Make sure you\'re on a Flow project page with generated content.');
    } else {
      const prompts = new Set(state.scannedAssets.map(a => a.groupId)).size;
      showToast(`Found ${state.scannedAssets.length} asset(s) across ${prompts} prompt(s).`);
    }
    renderLibrary();
  });

  // Filter buttons
  document.querySelectorAll('[data-lib-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      libraryFilter = (btn.getAttribute('data-lib-filter') || 'all') as any;
      document.querySelectorAll('[data-lib-filter]').forEach(b => {
        b.classList.toggle('af-btn-primary', b.getAttribute('data-lib-filter') === libraryFilter);
      });
      renderLibrary();
    });
  });

  // Sort dropdown
  $('#library-sort').addEventListener('change', () => renderLibrary());

  // Search input
  const searchInput = $('#library-search') as HTMLInputElement;
  if (searchInput) {
    let searchTimeout: ReturnType<typeof setTimeout>;
    searchInput.addEventListener('input', () => {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => {
        librarySearch = searchInput.value.trim().toLowerCase();
        renderLibrary();
      }, 200);
    });
  }

  $('#btn-select-all').addEventListener('click', () => {
    getFilteredAssets().forEach(a => a.selected = true);
    renderLibrary();
  });

  $('#btn-clear-sel').addEventListener('click', () => {
    getFilteredAssets().forEach(a => a.selected = false);
    renderLibrary();
  });

  $('#btn-download-selected').addEventListener('click', async () => {
    const selected = state.scannedAssets.filter(a => a.selected);
    if (selected.length === 0) {
      showToast('No assets selected.');
      return;
    }
    showToast(`Downloading ${selected.length} file(s)...`);
    // Get the current resolution setting based on media type
    const hasVideo = selected.some(a => a.mediaType === 'video');
    const resolution = hasVideo
      ? ($('#setting-video-resolution') as HTMLSelectElement).value
      : ($('#setting-image-resolution') as HTMLSelectElement).value;
    const response = await sendToBackground({
      type: 'DOWNLOAD_SELECTED',
      payload: {
        assets: selected.map(a => ({
          locator: a.locator,
          index: a.index,
          mediaType: a.mediaType,
          videoSrc: a.videoSrc,
          thumbnailUrl: a.thumbnailUrl,
          promptLabel: a.promptLabel,
          groupIndex: a.groupIndex,
        })),
        queueName: state.activeQueueId || 'download',
        resolution,
      },
    });
    if (response?.downloaded) {
      showToast(`Downloaded ${response.downloaded.length} file(s).`);
    }
  });

  // ── Retry selected assets ──
  $('#btn-retry-selected').addEventListener('click', async () => {
    const selected = state.scannedAssets.filter(a => a.selected);
    if (selected.length === 0) {
      showToast('No assets selected.');
      return;
    }
    showToast(`Retrying ${selected.length} asset(s)...`);

    let succeeded = 0;
    let failed = 0;
    for (const asset of selected) {
      try {
        const response = await chrome.runtime.sendMessage({
          type: 'RETRY_SINGLE_TILE',
          payload: {
            locator: asset.locator,
            promptLabel: asset.promptLabel || '',
          },
        });
        if (response?.success) {
          succeeded++;
          console.log(`[AutoFlow] Retry succeeded: ${asset.promptLabel} (${response.method})`);
        } else {
          failed++;
          console.warn(`[AutoFlow] Retry failed: ${asset.promptLabel}`, response?.error);
        }
      } catch (e: any) {
        failed++;
        console.error(`[AutoFlow] Retry error:`, e);
      }
      // Wait between retries to let Flow process
      if (selected.indexOf(asset) < selected.length - 1) {
        await new Promise(r => setTimeout(r, 3000));
      }
    }
    showToast(`Retry complete: ${succeeded} succeeded, ${failed} failed.`);
  });

  // ── Upscale selected assets (no download) ──
  $('#btn-upscale-selected').addEventListener('click', async () => {
    const selected = state.scannedAssets.filter(a => a.selected);
    if (selected.length === 0) {
      showToast('No assets selected.');
      return;
    }
    const resolution = ($('#setting-video-resolution') as HTMLSelectElement).value || '1080p Upscaled';
    showToast(`Upscaling ${selected.length} video(s) to ${resolution}...`);

    const response = await chrome.runtime.sendMessage({
      type: 'UPSCALE_SELECTED',
      payload: {
        assets: selected.map(a => ({
          locator: a.locator,
          promptLabel: a.promptLabel,
        })),
        resolution,
      },
    });

    if (response) {
      showToast(`Upscale done: ${response.triggered} triggered, ${response.failed} failed.`);
    }
  });
}

/** Return assets matching the current type filter AND text search */
function getFilteredAssets(): ScannedAsset[] {
  let assets = state.scannedAssets;
  if (libraryFilter !== 'all') {
    assets = assets.filter(a => a.mediaType === libraryFilter);
  }
  if (librarySearch) {
    assets = assets.filter(a =>
      a.promptLabel.toLowerCase().includes(librarySearch) ||
      a.label.toLowerCase().includes(librarySearch) ||
      String(a.promptNumber) === librarySearch
    );
  }
  return assets;
}

/**
 * Sort prompt groups based on the sort dropdown.
 * Returns an array of [groupId, assets[]] pairs in the desired order.
 */
function getSortedGroups(assets: ScannedAsset[]): [string, ScannedAsset[]][] {
  // First, group by groupId (row-based, NOT by prompt text)
  const groups = new Map<string, ScannedAsset[]>();
  for (const asset of assets) {
    if (!groups.has(asset.groupId)) groups.set(asset.groupId, []);
    groups.get(asset.groupId)!.push(asset);
  }

  // Sort within each group by generationNum
  for (const [, groupAssets] of groups) {
    groupAssets.sort((a, b) => a.generationNum - b.generationNum);
  }

  // Convert to array for sorting
  let groupArr = Array.from(groups.entries());

  const sortValue = ($('#library-sort') as HTMLSelectElement).value;
  switch (sortValue) {
    case 'oldest':
      // Oldest prompt first (lowest promptNumber first = highest groupIndex)
      groupArr.sort((a, b) => a[1][0].promptNumber - b[1][0].promptNumber);
      break;
    case 'newest':
      // Newest prompt first (highest promptNumber first = lowest groupIndex)
      groupArr.sort((a, b) => b[1][0].promptNumber - a[1][0].promptNumber);
      break;
    case 'type':
      // Videos first, then images; within type, by promptNumber descending
      groupArr.sort((a, b) => {
        const aType = a[1][0].mediaType;
        const bType = b[1][0].mediaType;
        if (aType !== bType) return aType === 'video' ? -1 : 1;
        return b[1][0].promptNumber - a[1][0].promptNumber;
      });
      break;
    case 'most-gens':
      // Most generations first, then by promptNumber descending
      groupArr.sort((a, b) => {
        if (b[1].length !== a[1].length) return b[1].length - a[1].length;
        return b[1][0].promptNumber - a[1][0].promptNumber;
      });
      break;
    case 'prompt-num':
      // Ascending prompt number (prompt 1, 2, 3, …)
      groupArr.sort((a, b) => a[1][0].promptNumber - b[1][0].promptNumber);
      break;
    case 'status': {
      // Failed groups first, then generating, then completed
      const stateOrder = (assets: ScannedAsset[]) => {
        const hasFailed = assets.some(a => a.tileState === 'failed');
        const hasGenerating = assets.some(a => a.tileState === 'generating');
        if (hasFailed) return 0;
        if (hasGenerating) return 1;
        return 2;
      };
      groupArr.sort((a, b) => {
        const oa = stateOrder(a[1]);
        const ob = stateOrder(b[1]);
        if (oa !== ob) return oa - ob;
        return b[1][0].promptNumber - a[1][0].promptNumber;
      });
      break;
    }
    default:
      groupArr.sort((a, b) => b[1][0].promptNumber - a[1][0].promptNumber);
  }

  return groupArr;
}

function renderLibrary() {
  const grid = $('#library-grid');
  grid.innerHTML = '';

  if (state.scannedAssets.length === 0) {
    grid.innerHTML = '<p class="af-empty">No assets found. Click Scan to search.</p>';
    $('#scan-status').style.display = 'none';
    $('#library-filter').style.display = 'none';
    $('#library-controls').style.display = 'none';
    return;
  }

  $('#scan-status').style.display = 'block';
  $('#library-filter').style.display = 'flex';
  $('#library-controls').style.display = 'flex';
  updateLibraryCounters();

  const filtered = getFilteredAssets();
  const sortedGroups = getSortedGroups(filtered);

  if (sortedGroups.length === 0) {
    grid.innerHTML = `<p class="af-empty">No ${librarySearch ? 'matching' : libraryFilter === 'image' ? 'photos' : 'videos'} found.</p>`;
    return;
  }

  for (const [, assets] of sortedGroups) {
    const firstAsset = assets[0];
    const promptNum = firstAsset.promptNumber;
    const promptLabel = firstAsset.promptLabel;
    const totalInGroup = firstAsset.totalInGroup;

    // Build media type summary for the group
    const vCount = assets.filter(a => a.mediaType === 'video').length;
    const iCount = assets.filter(a => a.mediaType === 'image').length;
    const failedCount = assets.filter(a => a.tileState === 'failed').length;
    const genCount = assets.filter(a => a.tileState === 'generating').length;
    let mediaLabel = '';
    if (vCount > 0) mediaLabel += `${vCount} video${vCount > 1 ? 's' : ''}`;
    if (iCount > 0) mediaLabel += `${mediaLabel ? ', ' : ''}${iCount} image${iCount > 1 ? 's' : ''}`;

    // State badges
    let stateBadges = '';
    if (failedCount > 0) stateBadges += `<span class="af-lib-badge af-lib-badge-failed">${failedCount} failed</span>`;
    if (genCount > 0) stateBadges += `<span class="af-lib-badge af-lib-badge-gen">generating</span>`;

    const groupEl = document.createElement('div');
    groupEl.className = 'af-lib-group';
    if (failedCount > 0) groupEl.classList.add('has-failed');

    // Retry indicator
    const retryCount = assets.filter(a => a.isRetry).length;
    const retryBadge = retryCount > 0 ? `<span class="af-lib-badge af-lib-badge-retry">${retryCount} retr${retryCount > 1 ? 'ies' : 'y'}</span>` : '';

    // Group header with prompt number, label, and media summary
    const header = document.createElement('div');
    header.className = 'af-lib-group-header';
    header.style.cursor = 'pointer';
    header.title = 'Click to select/deselect all in this group';
    header.innerHTML = `
      <span class="af-lib-group-num">${promptNum}</span>
      <span class="af-lib-group-label" title="${escapeHtml(promptLabel)}">${escapeHtml(promptLabel)}</span>
      ${stateBadges}
      ${retryBadge}
      <span class="af-lib-group-count">${mediaLabel}</span>
    `;

    // Click header → toggle select all assets in this group
    header.addEventListener('click', () => {
      const allSelected = assets.every(a => a.selected);
      assets.forEach(a => a.selected = !allSelected);
      renderLibrary();
    });

    groupEl.appendChild(header);

    // Assets row
    const row = document.createElement('div');
    row.className = 'af-lib-row';

    for (const asset of assets) {
      const card = document.createElement('div');
      card.className = `af-lib-card ${asset.selected ? 'selected' : ''}`;
      if (asset.tileState === 'failed') card.classList.add('af-lib-card-failed');
      if (asset.tileState === 'generating') card.classList.add('af-lib-card-generating');

      // Generation badge (e.g., "1/3")
      const genBadge = totalInGroup > 1
        ? `<span class="af-lib-gen-badge">${asset.generationNum}/${totalInGroup}</span>`
        : '';

      // Tile state badge on the card
      let stateBadge = '';
      if (asset.tileState === 'failed') {
        stateBadge = '<span class="af-lib-state-badge af-lib-state-failed">Failed</span>';
      } else if (asset.tileState === 'generating') {
        stateBadge = '<span class="af-lib-state-badge af-lib-state-gen">Generating…</span>';
      }

      if (asset.mediaType === 'video') {
        card.innerHTML = `
          <input type="checkbox" class="af-lib-check" ${asset.selected ? 'checked' : ''} />
          <button class="af-lib-retry-btn" title="Retry — regenerate this video">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M17.65 6.35A7.958 7.958 0 0 0 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0 1 12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>
          </button>
          ${genBadge}
          ${stateBadge}
          <div class="af-lib-preview">
            <video
              class="af-lib-video"
              src="${escapeHtml(asset.videoSrc || asset.thumbnailUrl)}"
              poster="${escapeHtml(asset.thumbnailUrl)}"
              preload="metadata"
              playsinline
              muted
              loop
            ></video>
            <div class="af-lib-play-overlay">
              <svg width="36" height="36" viewBox="0 0 24 24" fill="white" opacity="0.9"><path d="M8 5v14l11-7z"/></svg>
            </div>
          </div>
        `;

        const preview = card.querySelector('.af-lib-preview') as HTMLElement;
        const videoEl = card.querySelector('.af-lib-video') as HTMLVideoElement;
        const playOverlay = card.querySelector('.af-lib-play-overlay') as HTMLElement;

        preview.addEventListener('click', (e) => {
          e.stopPropagation();
          if (videoEl.paused) {
            videoEl.muted = false;
            videoEl.play().catch(() => { });
            playOverlay.style.opacity = '0';
          } else {
            videoEl.pause();
            playOverlay.style.opacity = '1';
          }
        });

        videoEl.addEventListener('ended', () => {
          playOverlay.style.opacity = '1';
        });
      } else {
        card.innerHTML = `
          <input type="checkbox" class="af-lib-check" ${asset.selected ? 'checked' : ''} />
          <button class="af-lib-retry-btn" title="Retry — regenerate this image">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M17.65 6.35A7.958 7.958 0 0 0 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0 1 12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>
          </button>
          ${genBadge}
          ${stateBadge}
          <div class="af-lib-preview">
            <img class="af-lib-img" src="${escapeHtml(asset.thumbnailUrl)}" alt="${escapeHtml(asset.label)}" />
          </div>
        `;
      }

      // Selection logic
      const checkbox = card.querySelector('.af-lib-check') as HTMLInputElement;
      card.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        if (target.closest('.af-lib-preview')) return;
        if (target.closest('.af-lib-retry-btn')) return;
        asset.selected = !asset.selected;
        checkbox.checked = asset.selected;
        card.classList.toggle('selected', asset.selected);
        updateLibraryCounters();
      });
      checkbox.addEventListener('change', (e) => {
        e.stopPropagation();
        asset.selected = checkbox.checked;
        card.classList.toggle('selected', asset.selected);
        updateLibraryCounters();
      });

      // Retry button
      const retryBtn = card.querySelector('.af-lib-retry-btn') as HTMLButtonElement;
      if (retryBtn) {
        retryBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          retryBtn.disabled = true;
          retryBtn.classList.add('spinning');
          showToast(`Retrying prompt #${promptNum}…`);

          const response = await sendToBackground({
            type: 'RETRY_SINGLE_TILE',
            payload: {
              locator: asset.locator,
              promptLabel: asset.promptLabel,
            },
          });

          retryBtn.disabled = false;
          retryBtn.classList.remove('spinning');

          if (response?.success) {
            const method = response.method || '';
            if (method.includes('failed')) {
              showToast('Retry started! The tile will regenerate in place.');
            } else {
              showToast('Regeneration started! Re-scan after it completes.');
            }
          } else {
            showToast(response?.error || 'Retry failed. Make sure you are on a Flow project page.');
          }
        });
      }

      row.appendChild(card);
    }

    groupEl.appendChild(row);
    grid.appendChild(groupEl);
  }
}

function updateLibraryCounters() {
  const total = state.scannedAssets.length;
  const videos = state.scannedAssets.filter(a => a.mediaType === 'video').length;
  const images = total - videos;
  const selected = state.scannedAssets.filter(a => a.selected).length;
  const filtered = getFilteredAssets().length;
  const prompts = new Set(state.scannedAssets.map(a => a.groupId)).size;
  const failed = state.scannedAssets.filter(a => a.tileState === 'failed').length;

  let foundText = `${prompts} prompts · ${total} assets (${videos} 🎬 ${images} 🖼)`;
  if (failed > 0) foundText += ` · ${failed} ❌`;
  $('#scan-found').textContent = foundText;
  $('#scan-selected').textContent = `Showing: ${filtered} | Selected: ${selected}`;
}

// ================================================================
// MESSAGE LISTENER (from background)
// ================================================================

function initMessageListener() {
  chrome.runtime.onMessage.addListener((msg: Message, sender, sendResponse) => {
    // Only handle messages from the background service worker.
    // Content scripts also send via chrome.runtime.sendMessage which reaches us
    // directly, but the background re-broadcasts after processing — handling both
    // would cause duplicate log lines and UI updates.
    if (sender.tab) return;

    switch (msg.type) {
      case 'LOG':
        appendLogToMonitor(msg.payload);
        break;
      case 'QUEUE_STATUS_UPDATE':
        handleQueueStatusUpdate(msg.payload);
        break;
      case 'PROMPT_STATUS_UPDATE':
        handlePromptStatusUpdate(msg.payload);
        break;
      case 'MANUAL_INTERVENTION_NEEDED':
        handleManualIntervention(msg.payload);
        break;
      case 'GET_IMAGE_BLOBS':
        // Background asks us to read image blobs from IndexedDB and return base64
        handleGetImageBlobs(msg.payload).then(sendResponse);
        return true; // async response
      case 'RUN_LOCK_CHANGED':
        handleRunLockChanged(msg.payload);
        break;
      case 'QUEUE_SUMMARY':
        handleQueueSummary(msg.payload);
        break;
      case 'FAILED_TILES_RESULT':
        handleFailedTilesResult(msg.payload);
        break;
    }
  });
}

function appendLogToMonitor(entry: LogEntry) {
  const container = $('#monitor-logs');
  if (!container) return;

  const line = document.createElement('div');
  line.className = `af-log-line af-log-${entry.level}`;
  const time = new Date(entry.timestamp).toLocaleTimeString();
  line.textContent = `[${time}] ${entry.message}`;
  container.appendChild(line);
  container.scrollTop = container.scrollHeight;
}

function handleQueueStatusUpdate(queue: QueueObject) {
  // Update monitor
  const nameEl = $('#monitor-queue-name');
  const progressEl = $('#monitor-progress');
  if (nameEl) nameEl.textContent = queue.name;
  const done = queue.prompts.filter(p => p.status === 'done').length;
  if (progressEl) progressEl.textContent = `${done} / ${queue.prompts.length}`;
  console.log(`[AutoFlow SP] Queue status update: ${queue.name} — done ${done}/${queue.prompts.length}, status=${queue.status}`);

  // Toggle pause/resume buttons
  if (queue.status === 'paused') {
    ($('#btn-pause') as HTMLButtonElement).disabled = true;
    ($('#btn-resume') as HTMLButtonElement).disabled = false;
  } else if (queue.status === 'running') {
    ($('#btn-pause') as HTMLButtonElement).disabled = false;
    ($('#btn-resume') as HTMLButtonElement).disabled = true;
  } else {
    ($('#btn-pause') as HTMLButtonElement).disabled = true;
    ($('#btn-resume') as HTMLButtonElement).disabled = true;
  }

  if (queue.status === 'completed' || queue.status === 'stopped') {
    state.isRunning = false;
    stopKeepalivePort();  // Release service worker keepalive
    updateStatusDot('connected');
    showToast(`Queue "${queue.name}" ${queue.status}.`);
  } else if (queue.status === 'running') {
    updateStatusDot('running');
  }

  // Update prompt statuses in prompt list
  updatePromptStatuses(queue);
}

function handlePromptStatusUpdate(data: { queue: QueueObject; promptIndex: number }) {
  updatePromptStatuses(data.queue);
  const done = data.queue.prompts.filter(p => p.status === 'done').length;
  const progressEl = $('#monitor-progress');
  if (progressEl) progressEl.textContent = `${done} / ${data.queue.prompts.length}`;
  console.log(`[AutoFlow SP] Prompt #${data.promptIndex + 1} → ${data.queue.prompts[data.promptIndex]?.status}, done ${done}/${data.queue.prompts.length}`);
}

function updatePromptStatuses(queue: QueueObject) {
  const rows = $$('.af-prompt-row');
  queue.prompts.forEach((prompt, idx) => {
    if (rows[idx]) {
      const badge = rows[idx].querySelector('.af-status');
      if (badge) {
        badge.className = `af-status af-status-${prompt.status}`;
        badge.textContent = prompt.status === 'not-added' ? 'Not Added' :
          prompt.status.charAt(0).toUpperCase() + prompt.status.slice(1);
      }
      // Show error if failed
      let errEl = rows[idx].querySelector('.af-prompt-error');
      if (prompt.status === 'failed' && prompt.error) {
        if (!errEl) {
          errEl = document.createElement('div');
          errEl.className = 'af-prompt-error';
          rows[idx].appendChild(errEl);
        }
        errEl.textContent = `Error: ${prompt.error}`;
      } else if (errEl) {
        errEl.remove();
      }
    }
  });
}

function handleManualIntervention(payload: { message: string }) {
  $('#manual-intervention').style.display = 'flex';
  $('#manual-msg').textContent = payload.message;
}

// ================================================================
// IMAGE BLOB RELAY — sidepanel reads IndexedDB, returns base64
// ================================================================

async function handleGetImageBlobs(payload: { imageIds: string[] }): Promise<any> {
  try {
    const files: Array<{ id: string; filename: string; mime: string; data: string }> = [];
    for (const id of payload.imageIds) {
      const blob = await getImageBlob(id);
      if (blob) {
        const base64 = await blobToBase64(blob);
        // Find the meta info from shared images, character images, or prompt images
        let filename = `image_${id}.png`;
        let mime = blob.type || 'image/png';
        let found = state.sharedImages.find(i => i.meta.id === id);
        if (!found) found = state.characterImages.find(i => i.meta.id === id);
        if (!found) {
          for (const [, imgs] of state.promptImages) {
            const match = imgs.find(i => i && i.meta.id === id);
            if (match) { found = match; break; }
          }
        }
        if (found) {
          filename = found.meta.filename;
          mime = found.meta.mime;
        }
        files.push({ id, filename, mime, data: base64 });
      }
    }
    return { files };
  } catch (err: any) {
    return { error: err.message, files: [] };
  }
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const dataUrl = reader.result as string;
      // Strip the data:...;base64, prefix
      const base64 = dataUrl.split(',')[1] || '';
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// ================================================================
// RUN-LOCK — disable Run buttons during execution
// ================================================================

function handleRunLockChanged(payload: { locked: boolean }) {
  state.isRunning = payload.locked;
  updateRunLockUI(payload.locked);
  if (!payload.locked) {
    stopKeepalivePort();
  }
}

function updateRunLockUI(locked: boolean) {
  // Disable/enable all Run buttons in queue cards
  const runButtons = $$('[data-action="run"]') as NodeListOf<HTMLButtonElement>;
  runButtons.forEach(btn => {
    if (locked) {
      btn.disabled = true;
      btn.title = 'A queue is already running';
    } else {
      // Re-enable only if the queue has a run target set
      const card = btn.closest('.af-q-card');
      const queueId = card?.getAttribute('data-queue-id');
      // We'll just enable them; the run function will check
      btn.disabled = false;
      btn.title = '';
    }
  });

  // Also disable Add to Queue → Run Target buttons during run
  const targetNew = $('#btn-target-new') as HTMLButtonElement;
  const targetCurrent = $('#btn-target-current') as HTMLButtonElement;
  if (targetNew) targetNew.disabled = locked;
  if (targetCurrent) targetCurrent.disabled = locked;
}

// ================================================================
// QUEUE SUMMARY — show summary toast when queue finishes
// ================================================================

function handleQueueSummary(payload: { queueName: string; totalPrompts: number; done: number; failed: number; skipped: number }) {
  const msg = `${payload.queueName}: ${payload.done} done, ${payload.failed} failed, ${payload.skipped} skipped (of ${payload.totalPrompts})`;
  showToast(msg, 6000);

  // Auto-show failed section if there are failures
  if (payload.failed > 0) {
    showFailedSection();
  }
}

// ================================================================
// FAILED TILES RESULT — display failed prompts for copy/retry
// ================================================================

function handleFailedTilesResult(payload: { failedPrompts: Array<{ promptIndex: number; text: string; error: string }>; failedCount: number }) {
  const section = $('#failed-section');
  const countBadge = $('#failed-count');
  const textarea = $('#failed-prompts') as HTMLTextAreaElement;
  const copyBtn = $('#btn-copy-failed') as HTMLButtonElement;
  const retryBtn = $('#btn-retry-page') as HTMLButtonElement;

  if (payload.failedCount === 0) {
    section.style.display = 'none';
    showToast('No failed generations found on page.');
    return;
  }

  // Show the section
  section.style.display = 'block';
  countBadge.textContent = `${payload.failedCount} failed`;

  // Build clean copy-paste ready text — just the prompt texts separated by
  // blank lines, so the user can paste directly into the AutoFlow prompts area.
  const uniqueTexts: string[] = [];
  const seen = new Set<string>();
  for (const fp of payload.failedPrompts) {
    // Skip unmapped placeholders
    if (fp.text.startsWith('[Failed tile') || fp.text.startsWith('[Unknown')) continue;
    const t = fp.text.trim();
    if (t && !seen.has(t)) {
      seen.add(t);
      uniqueTexts.push(t);
    }
  }
  textarea.value = uniqueTexts.join('\n\n');

  // Enable buttons
  copyBtn.disabled = false;
  retryBtn.disabled = false;

  showToast(`${payload.failedCount} failed generation(s) detected.`);
}

function showFailedSection() {
  const section = $('#failed-section');
  if (section) section.style.display = 'block';
}

// ================================================================
// TYPING OPTIONS VISIBILITY
// ================================================================

function updateTypingModeVisibility(enabled: boolean) {
  const speedRow = $('#typing-speed-row');
  if (speedRow) {
    speedRow.style.display = enabled ? 'flex' : 'none';
  }
}

function updateMediaTypeVisibility(mediaType: MediaType) {
  const isImage = mediaType === 'image';
  const videoModel = $('#video-model-section');
  const videoOrientation = $('#video-orientation-section');
  const imageSection = $('#image-settings-section');
  const creationTypeSection = document.getElementById('creation-type-section');

  if (videoModel) videoModel.style.display = isImage ? 'none' : '';
  if (videoOrientation) videoOrientation.style.display = isImage ? 'none' : '';
  if (imageSection) imageSection.style.display = isImage ? '' : 'none';

  // Hide Creation Type (Frames is video-only) and force Ingredients when Image
  if (creationTypeSection) creationTypeSection.style.display = isImage ? 'none' : '';
  if (isImage) {
    const ingredientsRadio = document.querySelector('input[name="creationType"][value="ingredients"]') as HTMLInputElement | null;
    if (ingredientsRadio && !ingredientsRadio.checked) {
      ingredientsRadio.checked = true;
      updateCreationTypeVisibility('ingredients');
    }
  }
}

function updateCreationTypeVisibility(creationType: CreationType) {
  const hasPrompts = state.parsedPrompts.length > 0;
  const isFrames = creationType === 'frames';

  const sharedSection = $('#shared-images-section');
  const charSection = $('#character-images-section');
  const automapSection = $('#automap-section');
  const framechainSection = $('#framechain-section');

  if (!hasPrompts) {
    // Hide all when no prompts parsed
    if (sharedSection) sharedSection.style.display = 'none';
    if (charSection) charSection.style.display = 'none';
    if (automapSection) automapSection.style.display = 'none';
    if (framechainSection) framechainSection.style.display = 'none';
    return;
  }

  if (isFrames) {
    // Frames mode: show only Frame Chain
    if (sharedSection) sharedSection.style.display = 'none';
    if (charSection) charSection.style.display = 'none';
    if (automapSection) automapSection.style.display = 'none';
    if (framechainSection) framechainSection.style.display = 'block';
  } else {
    // Ingredients mode: show ingredient sections, hide Frame Chain
    if (sharedSection) sharedSection.style.display = 'block';
    if (charSection) charSection.style.display = 'block';
    if (automapSection) automapSection.style.display = 'block';
    if (framechainSection) framechainSection.style.display = 'none';
    renderSharedImages();
    renderCharacterImages();
  }
}

// ================================================================
// UTILS
// ================================================================

function showToast(msg: string, duration = 3000) {
  const toast = $('#toast');
  toast.textContent = msg;
  toast.style.display = 'block';
  setTimeout(() => { toast.style.display = 'none'; }, duration);
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

async function sendToBackground(msg: Message): Promise<any> {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(msg, (response) => {
        if (chrome.runtime.lastError) {
          console.error('[AutoFlow] sendToBackground error:', chrome.runtime.lastError.message);
          resolve({ error: chrome.runtime.lastError.message || 'Extension communication error. Try reloading the page.' });
          return;
        }
        if (response === undefined || response === null) {
          resolve({ error: 'No response from extension. Try refreshing the Flow tab and reopening the side panel.' });
          return;
        }
        resolve(response);
      });
    } catch (err: any) {
      console.error('[AutoFlow] sendToBackground exception:', err);
      resolve({ error: err.message || 'Extension communication failed.' });
    }
  });
}
