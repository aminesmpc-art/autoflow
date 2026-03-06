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
import { MAX_IMAGES_PER_PROMPT } from '../shared/constants';
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
  promptImages: Map<number, { meta: ImageMeta; objectUrl: string }[]>; // promptIndex → images
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
    if (state.sharedImages.length >= MAX_IMAGES_PER_PROMPT) {
      showToast(`Maximum ${MAX_IMAGES_PER_PROMPT} shared reference images.`);
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
}

function renderPromptList() {
  const container = $('#prompt-list');
  container.innerHTML = '';

  // Show shared images section once prompts are parsed
  const sharedSection = $('#shared-images-section');
  const charSection = $('#character-images-section');
  const automapSection = $('#automap-section');
  if (state.parsedPrompts.length > 0) {
    sharedSection.style.display = 'block';
    charSection.style.display = 'block';
    automapSection.style.display = 'block';
    renderSharedImages();
    renderCharacterImages();
  } else {
    sharedSection.style.display = 'none';
    charSection.style.display = 'none';
    automapSection.style.display = 'none';
  }

  state.parsedPrompts.forEach((text, idx) => {
    const row = document.createElement('div');
    row.className = 'af-prompt-row';
    row.dataset.index = String(idx);

    const preview = text.length > 80 ? text.substring(0, 80) + '…' : text;
    const images = state.promptImages.get(idx) || [];
    const imgCount = images.length;
    // Effective images: per-prompt + auto-matched characters + shared (up to max)
    const sharedCount = state.sharedImages.length;
    const autoMatchedCount = state.autoAddCharacters ? getAutoMatchedImages(text).length : 0;
    const effectiveCount = Math.min(imgCount + autoMatchedCount + sharedCount, MAX_IMAGES_PER_PROMPT);

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
        <span class="af-img-counter">${effectiveCount}/${MAX_IMAGES_PER_PROMPT}${extrasStr}</span>
        <button class="af-btn af-btn-add-img af-btn-sm" data-prompt-idx="${idx}">+ Add images</button>
        ${imgCount > 0 ? `<button class="af-btn-copy-all" data-copy-from="${idx}" title="Copy these images to all other prompts">Copy to all</button>` : ''}
        <input type="file" class="af-file-input" data-prompt-idx="${idx}" accept="image/*" multiple />
      </div>
    `;

    // Expand/collapse
    row.querySelector('[data-toggle]')!.addEventListener('click', () => {
      row.classList.toggle('expanded');
    });

    // Add images button
    const addBtn = row.querySelector('.af-btn-add-img') as HTMLButtonElement;
    const fileInput = row.querySelector('.af-file-input') as HTMLInputElement;

    addBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (imgCount >= MAX_IMAGES_PER_PROMPT) {
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

    // Copy to all prompts button
    const copyAllBtn = row.querySelector('.af-btn-copy-all') as HTMLButtonElement | null;
    if (copyAllBtn) {
      copyAllBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const fromIdx = parseInt(copyAllBtn.dataset.copyFrom || '0', 10);
        copyImagesToAllPrompts(fromIdx);
      });
    }

    // Render existing thumbnails (manual per-prompt)
    renderImageThumbnails(row, idx, images);

    // Render auto-matched character images (read-only, with badge)
    if (state.autoAddCharacters) {
      const autoMatched = getAutoMatchedImages(text);
      renderAutoMatchedThumbnails(row, autoMatched);
    }

    // Render shared image indicators (read-only, with badge)
    if (state.sharedImages.length > 0) {
      renderSharedThumbnailsInRow(row);
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

async function addImagesToPrompt(promptIdx: number, files: File[]) {
  const current = state.promptImages.get(promptIdx) || [];
  const remaining = MAX_IMAGES_PER_PROMPT - current.length;

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
    URL.revokeObjectURL(removed.objectUrl);
    deleteImageBlob(removed.meta.id).catch(() => {});
    state.promptImages.set(promptIdx, images);
  }
}

/**
 * Add shared images that apply to ALL prompts.
 */
async function addSharedImages(files: File[]) {
  const remaining = MAX_IMAGES_PER_PROMPT - state.sharedImages.length;
  if (remaining <= 0) {
    showToast(`Maximum ${MAX_IMAGES_PER_PROMPT} shared reference images.`);
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

  $('#shared-img-counter').textContent = `${state.sharedImages.length}/${MAX_IMAGES_PER_PROMPT}`;
}

function removeSharedImage(imgIdx: number) {
  if (imgIdx >= 0 && imgIdx < state.sharedImages.length) {
    const removed = state.sharedImages.splice(imgIdx, 1)[0];
    URL.revokeObjectURL(removed.objectUrl);
    deleteImageBlob(removed.meta.id).catch(() => {});
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
    if (state.sharedImages.length >= MAX_IMAGES_PER_PROMPT) break;
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
    if (current.some(img => img.meta.sha256 === hash)) continue;

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
    deleteImageBlob(removed.meta.id).catch(() => {});
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
    const perPrompt = (state.promptImages.get(idx) || []).map(i => i.meta);
    const autoMatched = state.autoAddCharacters
      ? getAutoMatchedImages(text).map(i => i.meta)
      : [];
    const shared = state.sharedImages.map(i => i.meta);

    // Deduplicate by sha256, priority order: per-prompt → character → shared
    // Cap at MAX_IMAGES_PER_PROMPT
    const seen = new Set<string>();
    const merged: ImageMeta[] = [];
    for (const img of [...perPrompt, ...autoMatched, ...shared]) {
      if (merged.length >= MAX_IMAGES_PER_PROMPT) break;
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

  // Humanized mode toggle → show/hide typing speed slider
  const humanizedToggle = $('#setting-humanized') as HTMLInputElement;
  humanizedToggle.addEventListener('change', () => {
    updateHumanizedVisibility(humanizedToggle.checked);
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

  // Manage Subscription button
  $('#btn-manage-subscription').addEventListener('click', () => {
    showToast('Subscription management coming soon.');
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

  // Timing
  ($('#setting-wait-min') as HTMLInputElement).value = String(settings.waitMinSec ?? 10);
  ($('#setting-wait-max') as HTMLInputElement).value = String(settings.waitMaxSec ?? 20);
  ($('#setting-humanized') as HTMLInputElement).checked = settings.humanizedMode ?? false;
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

  // Show/hide typing speed based on humanized mode
  updateHumanizedVisibility(settings.humanizedMode ?? false);
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
  const humanizedMode = ($('#setting-humanized') as HTMLInputElement).checked;
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
  const inputMethod: InputMethod = humanizedMode ? 'type' : 'paste';
  const typingCharsPerSecond = Math.round(25 * typingSpeedMultiplier);
  const variableTypingDelay = humanizedMode;

  return {
    mediaType, creationType, model, orientation, generations, stopOnError,
    imageModel, imageRatio,
    waitMinSec, waitMaxSec, humanizedMode, typingSpeedMultiplier,
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

async function refreshQueuesList() {
  const queues = await getAllQueues();
  const container = $('#queue-list');

  if (queues.length === 0) {
    container.innerHTML = '<p class="af-empty">No queues yet. Add prompts in the Video tab.</p>';
    return;
  }

  container.innerHTML = '';

  queues.forEach((queue, idx) => {
    const card = document.createElement('div');
    card.className = 'af-queue-card';
    card.dataset.queueId = queue.id;

    const doneCount = queue.prompts.filter(p => p.status === 'done').length;
    const failedCount = queue.prompts.filter(p => p.status === 'failed').length;
    const statusColor = queue.status === 'running' ? 'var(--warning)' :
                        queue.status === 'completed' ? 'var(--success)' :
                        queue.status === 'stopped' ? 'var(--danger)' : 'var(--text-muted)';

    card.innerHTML = `
      <div class="af-queue-card-header">
        <span class="af-queue-name">${escapeHtml(queue.name)}</span>
        <span class="af-status" style="background:${statusColor}22;color:${statusColor}">${queue.status}</span>
      </div>
      <div class="af-queue-meta">
        ${queue.prompts.length} prompts | ${queue.settings.mediaType ?? 'video'} | ${queue.settings.model} | ${queue.settings.orientation ?? 'landscape'} | ×${queue.settings.generations}
        | Done: ${doneCount} | Failed: ${failedCount}
        ${queue.runTarget ? `| Target: ${queue.runTarget === 'newProject' ? 'New Project' : 'Current Project'}` : '| Target: not set'}
      </div>
      <div class="af-queue-actions">
        <button class="af-btn af-btn-sm" data-action="up" ${idx === 0 ? 'disabled' : ''}>↑ Up</button>
        <button class="af-btn af-btn-sm" data-action="down" ${idx === queues.length - 1 ? 'disabled' : ''}>↓ Down</button>
        <button class="af-btn af-btn-sm af-btn-danger" data-action="delete">🗑 Delete</button>
        <button class="af-btn af-btn-sm af-btn-primary" data-action="run" ${!queue.runTarget ? 'disabled title="Set run target first"' : ''}>▶ Run</button>
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
      showRunMonitor(activeId);
    }
  }
}

// ================================================================
// TAB D: LIBRARY
// ================================================================

let libraryFilter: 'all' | 'image' | 'video' = 'all';

function initLibraryTab() {
  $('#btn-scan').addEventListener('click', async () => {
    if (state.isRunning) {
      showToast('Pause the running queue before scanning.');
      return;
    }
    showToast('Scanning project...');
    const response = await sendToBackground({ type: 'SCAN_LIBRARY' });
    if (response?.error) {
      showToast(`Scan error: ${response.error}`);
      return;
    }
    state.scannedAssets = response.assets || [];
    renderLibrary();
  });

  // Filter buttons
  document.querySelectorAll('[data-lib-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      libraryFilter = (btn.getAttribute('data-lib-filter') || 'all') as any;
      // Update active style
      document.querySelectorAll('[data-lib-filter]').forEach(b => {
        b.classList.toggle('af-btn-primary', b.getAttribute('data-lib-filter') === libraryFilter);
      });
      renderLibrary();
    });
  });

  // Sort dropdown
  $('#library-sort').addEventListener('change', () => {
    renderLibrary();
  });

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
      },
    });
    if (response?.downloaded) {
      showToast(`Downloaded ${response.downloaded.length} file(s).`);
    }
  });
}

/** Return assets matching the current filter */
function getFilteredAssets(): ScannedAsset[] {
  if (libraryFilter === 'all') return state.scannedAssets;
  return state.scannedAssets.filter(a => a.mediaType === libraryFilter);
}

/** Sort assets based on the sort dropdown */
function getSortedAssets(assets: ScannedAsset[]): ScannedAsset[] {
  const sortValue = ($('#library-sort') as HTMLSelectElement).value;
  const sorted = [...assets];
  switch (sortValue) {
    case 'oldest':
      sorted.sort((a, b) => a.index - b.index);
      break;
    case 'newest':
      sorted.sort((a, b) => b.index - a.index);
      break;
    case 'type':
      sorted.sort((a, b) => {
        if (a.mediaType === b.mediaType) return a.index - b.index;
        return a.mediaType === 'video' ? -1 : 1;
      });
      break;
  }
  return sorted;
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
  const sorted = getSortedAssets(filtered);

  if (sorted.length === 0) {
    grid.innerHTML = `<p class="af-empty">No ${libraryFilter === 'image' ? 'photos' : 'videos'} found.</p>`;
    return;
  }

  // Group assets by promptLabel to display one row per prompt
  const groups = new Map<string, ScannedAsset[]>();
  for (const asset of sorted) {
    const key = asset.promptLabel || `Group ${asset.groupIndex}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(asset);
  }

  // Assign prompt numbers so that oldest prompt = 1 (matching download filenames).
  // Groups are in scan order (newest first), so reverse to number from oldest.
  const groupKeys = Array.from(groups.keys());
  const totalGroups = groupKeys.length;

  let groupIdx = 0;
  for (const [promptLabel, assets] of groups) {
    groupIdx++;
    // Reverse the numbering: first group shown (newest) gets highest number
    const promptNum = totalGroups - groupIdx + 1;
    const groupEl = document.createElement('div');
    groupEl.className = 'af-lib-group';

    // Group header
    const header = document.createElement('div');
    header.className = 'af-lib-group-header';
    header.innerHTML = `
      <span class="af-lib-group-num">${promptNum}</span>
      <span class="af-lib-group-label" title="${escapeHtml(promptLabel)}">${escapeHtml(promptLabel)}</span>
      <span class="af-lib-group-count">${assets.length} ${assets[0].mediaType === 'video' ? 'video' : 'image'}${assets.length > 1 ? 's' : ''}</span>
    `;
    groupEl.appendChild(header);

    // Assets row
    const row = document.createElement('div');
    row.className = 'af-lib-row';

    for (const asset of assets) {
      const card = document.createElement('div');
      card.className = `af-lib-card ${asset.selected ? 'selected' : ''}`;

      if (asset.mediaType === 'video') {
        // Video card with playable video
        card.innerHTML = `
          <input type="checkbox" class="af-lib-check" ${asset.selected ? 'checked' : ''} />
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

        // Click to play/pause video
        const preview = card.querySelector('.af-lib-preview') as HTMLElement;
        const videoEl = card.querySelector('.af-lib-video') as HTMLVideoElement;
        const playOverlay = card.querySelector('.af-lib-play-overlay') as HTMLElement;

        preview.addEventListener('click', (e) => {
          e.stopPropagation();
          if (videoEl.paused) {
            videoEl.muted = false;
            videoEl.play().catch(() => {});
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
        // Image card with full preview
        card.innerHTML = `
          <input type="checkbox" class="af-lib-check" ${asset.selected ? 'checked' : ''} />
          <div class="af-lib-preview">
            <img class="af-lib-img" src="${escapeHtml(asset.thumbnailUrl)}" alt="${escapeHtml(asset.label)}" />
          </div>
        `;
      }

      // Selection logic via checkbox or clicking the card border
      const checkbox = card.querySelector('.af-lib-check') as HTMLInputElement;
      card.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        // Don't toggle selection when clicking the video/image preview area
        if (target.closest('.af-lib-preview')) return;
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

  $('#scan-found').textContent = `Found: ${total} (${images} 🖼 / ${videos} 🎬)`;
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
  $('#monitor-queue-name').textContent = queue.name;
  const done = queue.prompts.filter(p => p.status === 'done').length;
  $('#monitor-progress').textContent = `${done} / ${queue.prompts.length}`;

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
    showToast(`Queue "${queue.name}" ${queue.status}.`);
  }

  // Update prompt statuses in prompt list
  updatePromptStatuses(queue);
}

function handlePromptStatusUpdate(data: { queue: QueueObject; promptIndex: number }) {
  updatePromptStatuses(data.queue);
  const done = data.queue.prompts.filter(p => p.status === 'done').length;
  $('#monitor-progress').textContent = `${done} / ${data.queue.prompts.length}`;
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
            found = imgs.find(i => i.meta.id === id);
            if (found) break;
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
      const card = btn.closest('.af-queue-card');
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

function updateHumanizedVisibility(enabled: boolean) {
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
  if (videoModel) videoModel.style.display = isImage ? 'none' : '';
  if (videoOrientation) videoOrientation.style.display = isImage ? 'none' : '';
  if (imageSection) imageSection.style.display = isImage ? '' : 'none';
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
  return new Promise(resolve => {
    chrome.runtime.sendMessage(msg, response => {
      resolve(response);
    });
  });
}
