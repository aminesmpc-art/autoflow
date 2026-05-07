/* ============================================================
   Grok Auto – Side Panel Entry (index.ts)
   Wires up all tabs, events, auth, queue management.
   ============================================================ */

import { QueueObject, PromptItem, QueueSettings, DEFAULT_SETTINGS, Message } from '../types';
import {
  getAllQueues, addQueue, deleteQueue, updateQueue,
  getSettings, saveSettings, getNextQueueName,
  appendLog, getLogs, clearLogs,
} from '../shared/storage';
import { login, register, logout, isLoggedIn, getProfile, getDailyUsage, checkCanGenerate, trackUsage, getUpgradeUrl } from '../shared/api';

// ================================================================
// STATE
// ================================================================

interface ImageAttachment {
  dataUrl: string;
  name: string;
  objectUrl: string;
}

interface AppState {
  parsedPrompts: string[];
  lastAddedQueueId: string | null;
  isRunning: boolean;
  activeQueueId: string | null;
  attachedImages: ImageAttachment[];       // Shared: same images for ALL prompts
  mappedImages: (ImageAttachment | null)[]; // Mapped: image[i] → prompt[i] (1:1)
}

const state: AppState = {
  parsedPrompts: [],
  lastAddedQueueId: null,
  isRunning: false,
  activeQueueId: null,
  attachedImages: [],
  mappedImages: [],
};

// ================================================================
// DOM REFS
// ================================================================

const $ = (sel: string) => document.querySelector(sel) as HTMLElement;
const $$ = (sel: string) => document.querySelectorAll(sel);

// ================================================================
// KEEPALIVE PORT
// ================================================================

let keepalivePort: chrome.runtime.Port | null = null;
let keepaliveInterval: ReturnType<typeof setInterval> | null = null;

function updateStatusDot(status: 'disconnected' | 'connected' | 'running') {
  const dot = document.getElementById('af-status-dot');
  if (!dot) return;
  dot.classList.remove('connected', 'running');
  if (status === 'connected') { dot.classList.add('connected'); dot.title = 'Connected'; }
  else if (status === 'running') { dot.classList.add('running'); dot.title = 'Queue Running'; }
  else { dot.title = 'Disconnected'; }
}

function startKeepalivePort() {
  if (keepalivePort) return;
  try {
    keepalivePort = chrome.runtime.connect({ name: 'ga-keepalive' });
    keepaliveInterval = setInterval(() => {
      try { keepalivePort?.postMessage({ type: 'keepalive' }); } catch {
        if (keepaliveInterval) clearInterval(keepaliveInterval);
        keepaliveInterval = null;
        keepalivePort = null;
      }
    }, 20_000);
    keepalivePort.onDisconnect.addListener(() => {
      // Suppress runtime.lastError to prevent unchecked error
      void chrome.runtime.lastError;
      if (keepaliveInterval) clearInterval(keepaliveInterval);
      keepaliveInterval = null;
      keepalivePort = null;
      if (state.isRunning) setTimeout(startKeepalivePort, 2000);
    });
    updateStatusDot(state.isRunning ? 'running' : 'connected');
  } catch {
    // Service worker not ready yet
    updateStatusDot('disconnected');
    keepalivePort = null;
  }
}

// ================================================================
// INIT
// ================================================================

document.addEventListener('DOMContentLoaded', async () => {
  try {
    initTabs();
    initCreateTab();
    initSettingsTab();
    initQueuesTab();
    initAccountTab();
    initMessageListener();
    await loadSettings();
    await refreshQueuesList();

    // Ping background
    try {
      const ping = await sendToBackground({ type: 'PING' });
      if (!ping?.error) updateStatusDot(state.isRunning ? 'running' : 'connected');
    } catch { /* extension context may not be ready */ }

    // First-run disclosure
    try {
      const { ga_first_run_seen } = await chrome.storage.local.get('ga_first_run_seen');
      if (!ga_first_run_seen) {
        const firstRunEl = document.getElementById('af-first-run');
        if (firstRunEl) {
          firstRunEl.style.display = 'flex';
          document.getElementById('btn-dismiss-first-run')?.addEventListener('click', () => {
            firstRunEl.style.display = 'none';
            chrome.storage.local.set({ ga_first_run_seen: true });
          });
        }
      }
    } catch { /* storage not available outside extension */ }
  } catch (err) {
    console.error('[GrokAuto] Init error:', err);
  }
});

// ================================================================
// TABS (with auth gating)
// ================================================================

let _isAuthenticated = false;

function initTabs() {
  $$('.af-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      if (!_isAuthenticated && tab.hasAttribute('data-requires-auth')) {
        const accountTab = $('[data-tab="account"]');
        accountTab?.classList.add('af-tab-pulse');
        setTimeout(() => accountTab?.classList.remove('af-tab-pulse'), 600);
        return;
      }
      $$('.af-tab').forEach(t => { t.classList.remove('active'); t.setAttribute('aria-selected', 'false'); });
      $$('.af-panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      tab.setAttribute('aria-selected', 'true');
      const panelId = `panel-${tab.getAttribute('data-tab')}`;
      $(`#${panelId}`)?.classList.add('active');
      if (tab.getAttribute('data-tab') === 'queues') refreshQueuesList();
    });
  });
}

function enforceAuthGate(loggedIn: boolean) {
  _isAuthenticated = loggedIn;
  const authTabs = $$('[data-requires-auth]');
  authTabs.forEach(tab => {
    if (loggedIn) {
      tab.classList.remove('af-tab-locked');
      tab.removeAttribute('title');
    } else {
      tab.classList.add('af-tab-locked');
      tab.setAttribute('title', 'Sign in to unlock');
    }
  });
  if (loggedIn) {
    const createTab = $('[data-tab="video"]');
    if (createTab) createTab.click();
  }
}

// ================================================================
// TAB A: CREATE
// ================================================================

function parsePrompts(raw: string): string[] {
  return raw.split(/\n\s*\n/).map(b => b.trim()).filter(b => b.length > 0);
}

function reparsePrompts() {
  const raw = ($('#prompt-input') as HTMLTextAreaElement).value;
  state.parsedPrompts = parsePrompts(raw);
  const count = state.parsedPrompts.length;
  $('#prompt-count').textContent = count > 0 ? `${count} prompt${count !== 1 ? 's' : ''}` : '';
  const qa = document.getElementById('queue-actions');
  if (qa) qa.style.display = count > 0 ? 'block' : 'none';
  renderPromptList();
}

function initCreateTab() {
  // Mode cards (Image / Video)
  const modeCards = document.querySelectorAll('.af-mode-card');
  modeCards.forEach(card => {
    card.addEventListener('click', () => {
      modeCards.forEach(c => c.classList.remove('active'));
      card.classList.add('active');
      const mode = card.getAttribute('data-mode');
      // Sync hidden radios
      const radio = document.querySelector(`input[name="mediaType"][value="${mode}"]`) as HTMLInputElement;
      if (radio) radio.checked = true;
      // Toggle video settings
      const videoSection = document.getElementById('video-settings-section');
      if (videoSection) videoSection.style.display = mode === 'video' ? '' : 'none';
      // Toggle extend settings
      const extendSection = document.getElementById('extend-settings-section');
      if (extendSection) extendSection.style.display = mode === 'video' ? '' : 'none';
    });
  });

  // Trigger default active card
  const defaultActive = document.querySelector('.af-mode-card.active') as HTMLElement;
  if (defaultActive) defaultActive.click();

  // Parse button
  $('#btn-parse').addEventListener('click', reparsePrompts);

  // Auto-reparse on input (debounced)
  let reparseTimer: ReturnType<typeof setTimeout> | null = null;
  ($('#prompt-input') as HTMLTextAreaElement).addEventListener('input', () => {
    if (reparseTimer) clearTimeout(reparseTimer);
    reparseTimer = setTimeout(reparsePrompts, 600);
  });

  // Add to Queue
  $('#btn-add-queue').addEventListener('click', addToQueue);

  // Monitor controls
  $('#btn-pause').addEventListener('click', () => sendToBackground({ type: 'PAUSE_QUEUE' }));
  $('#btn-resume').addEventListener('click', () => sendToBackground({ type: 'RESUME_QUEUE' }));
  $('#btn-stop').addEventListener('click', () => sendToBackground({ type: 'STOP_QUEUE' }));
  $('#btn-skip').addEventListener('click', () => sendToBackground({ type: 'SKIP_CURRENT' }));

  // Scan page button
  $('#btn-scan-page')?.addEventListener('click', async () => {
    const scanBtn = $('#btn-scan-page') as HTMLButtonElement;
    scanBtn.disabled = true;
    scanBtn.textContent = 'Scanning...';
    const result = await sendToBackground({ type: 'SCAN_PAGE' });
    scanBtn.disabled = false;
    scanBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg><span>Scan Page</span>';

    const scanResult = document.getElementById('scan-result');
    if (scanResult && result && !result.error) {
      scanResult.style.display = '';
      scanResult.innerHTML = `
        <div class="af-gen-stats" style="display:flex;">
          <div class="af-gen-stat"><span class="af-gen-stat-dot af-dot-completed"></span><strong>${result.completed || 0}</strong> Done</div>
          <div class="af-gen-stat"><span class="af-gen-stat-dot af-dot-generating"></span><strong>${result.generating || 0}</strong> Generating</div>
          <div class="af-gen-stat"><span class="af-gen-stat-dot af-dot-failed"></span><strong>${result.failed || 0}</strong> Failed</div>
          <div class="af-gen-stat" style="opacity:0.5"><strong>${result.idle || 0}</strong> Idle</div>
        </div>
        <p style="margin:4px 0 0;font-size:11px;opacity:0.6">${result.total || 0} tiles total</p>
      `;
    } else if (scanResult) {
      scanResult.style.display = '';
      scanResult.textContent = result?.error || 'No tiles found on page.';
    }
  });

  // Image uploads
  const imgFileInput = document.getElementById('image-file-input') as HTMLInputElement;
  $('#btn-add-images')?.addEventListener('click', () => {
    if (state.attachedImages.length >= 5) { showToast('Max 5 images.'); return; }
    imgFileInput.click();
  });

  imgFileInput?.addEventListener('change', async () => {
    const files = imgFileInput.files;
    if (!files) return;
    for (const file of Array.from(files)) {
      if (state.attachedImages.length >= 5) break;
      const dataUrl = await readFileAsDataUrl(file);
      const objectUrl = URL.createObjectURL(file);
      state.attachedImages.push({ dataUrl, name: file.name, objectUrl });
    }
    imgFileInput.value = '';
    renderImageThumbnails();
  });

  $('#btn-clear-images')?.addEventListener('click', () => {
    state.attachedImages.forEach(img => URL.revokeObjectURL(img.objectUrl));
    state.attachedImages = [];
    state.mappedImages.forEach(img => { if (img) URL.revokeObjectURL(img.objectUrl); });
    state.mappedImages = [];
    renderImageThumbnails();
    renderPromptList();
  });

  // Map Images: each image maps 1:1 to its corresponding prompt
  const mapFileInput = document.getElementById('map-image-file-input') as HTMLInputElement;
  $('#btn-map-images')?.addEventListener('click', () => {
    if (state.parsedPrompts.length === 0) { showToast('Parse prompts first before mapping images.'); return; }
    mapFileInput.click();
  });

  mapFileInput?.addEventListener('change', async () => {
    const files = mapFileInput.files;
    if (!files || files.length === 0) return;

    // Clear previous mapped images
    state.mappedImages.forEach(img => { if (img) URL.revokeObjectURL(img.objectUrl); });
    state.mappedImages = new Array(state.parsedPrompts.length).fill(null);

    // Map each file to its corresponding prompt index
    const fileArr = Array.from(files);
    for (let i = 0; i < Math.min(fileArr.length, state.parsedPrompts.length); i++) {
      const file = fileArr[i];
      const dataUrl = await readFileAsDataUrl(file);
      const objectUrl = URL.createObjectURL(file);
      state.mappedImages[i] = { dataUrl, name: file.name, objectUrl };
    }

    mapFileInput.value = '';
    const mapped = state.mappedImages.filter(Boolean).length;
    showToast(`Mapped ${mapped} image${mapped !== 1 ? 's' : ''} to ${mapped} prompt${mapped !== 1 ? 's' : ''}`);
    renderImageThumbnails();
    renderPromptList();
  });
}

function renderPromptList() {
  const container = $('#prompt-list');
  container.innerHTML = '';
  const isExtendEnabled = ($('#setting-video-extend') as HTMLInputElement)?.checked ?? false;
  const isVideo = (document.querySelector('input[name="mediaType"]:checked') as HTMLInputElement)?.value === 'video';
  const showExtend = isExtendEnabled && isVideo;

  state.parsedPrompts.forEach((text, idx) => {
    const row = document.createElement('div');
    row.className = 'af-prompt-row';
    const preview = text.length > 80 ? text.substring(0, 80) + '…' : text;
    const mappedImg = state.mappedImages[idx];
    const imgThumb = mappedImg
      ? `<img src="${mappedImg.objectUrl}" alt="${escapeHtml(mappedImg.name)}" style="width:28px;height:28px;border-radius:4px;object-fit:cover;border:1px solid rgba(255,255,255,0.1);flex-shrink:0;" title="${escapeHtml(mappedImg.name)}" />`
      : '';
    row.innerHTML = `
      <div class="af-prompt-header" data-toggle>
        ${imgThumb}
        <span class="af-prompt-num">#${idx + 1}</span>
        <span class="af-prompt-preview">${escapeHtml(preview)}</span>
        <span class="af-status af-status-not-added">Not Added</span>
      </div>
      <div class="af-prompt-full">${escapeHtml(text)}</div>
      ${showExtend ? `
      <div class="af-extend-fields" style="padding:6px 8px 8px;border-top:1px solid rgba(255,255,255,0.06);">
        <div style="font-size:11px;color:#818cf8;font-weight:600;margin-bottom:4px;">🔗 Video Extensions</div>
        <input type="text" class="af-input af-extend-input" data-prompt-idx="${idx}" data-extend-idx="0" placeholder="Extend 1 — what happens next (10s)" style="font-size:11px;margin-bottom:4px;padding:5px 8px;" />
        <input type="text" class="af-input af-extend-input" data-prompt-idx="${idx}" data-extend-idx="1" placeholder="Extend 2 — final segment (10s)" style="font-size:11px;padding:5px 8px;" />
      </div>
      ` : ''}
    `;
    row.querySelector('[data-toggle]')!.addEventListener('click', () => row.classList.toggle('expanded'));
    container.appendChild(row);
  });
}

async function addToQueue() {
  if (state.parsedPrompts.length === 0) { showToast('Parse prompts first.'); return; }

  // Check usage
  const quota = await checkCanGenerate('text');
  if (!quota.allowed) {
    showToast(`Daily limit reached (${quota.limit}). ${quota.remaining} remaining.`);
    return;
  }

  const settings = readSettingsFromUI();
  const name = await getNextQueueName();

  // Collect shared image data URLs
  const sharedImageDataUrls = state.attachedImages.map(img => img.dataUrl);
  const sharedImageNames = state.attachedImages.map(img => img.name);
  const hasMappedImages = state.mappedImages.some(Boolean);

  const prompts: PromptItem[] = state.parsedPrompts.map((text, idx) => {
    // Collect extension prompts from the UI inputs
    const extendPrompts: string[] = [];
    const ext1 = document.querySelector(`.af-extend-input[data-prompt-idx="${idx}"][data-extend-idx="0"]`) as HTMLInputElement;
    const ext2 = document.querySelector(`.af-extend-input[data-prompt-idx="${idx}"][data-extend-idx="1"]`) as HTMLInputElement;
    if (ext1?.value?.trim()) extendPrompts.push(ext1.value.trim());
    if (ext2?.value?.trim()) extendPrompts.push(ext2.value.trim());

    // Determine images for THIS prompt:
    // If mapped images exist → use the 1:1 mapped image for this index
    // Otherwise → use shared images (applied to all)
    let promptImageUrls: string[] | undefined;
    let promptImageNames: string[] | undefined;

    if (hasMappedImages && state.mappedImages[idx]) {
      promptImageUrls = [state.mappedImages[idx]!.dataUrl];
      promptImageNames = [state.mappedImages[idx]!.name];
    } else if (!hasMappedImages && sharedImageDataUrls.length > 0) {
      promptImageUrls = sharedImageDataUrls;
      promptImageNames = sharedImageNames;
    }

    return {
      text,
      status: 'queued' as const,
      attempts: 0,
      imageDataUrls: promptImageUrls,
      imageNames: promptImageNames,
      extendPrompts: extendPrompts.length > 0 ? extendPrompts : undefined,
    };
  });

  const queue: QueueObject = {
    id: crypto.randomUUID(),
    name,
    prompts,
    settings,
    status: 'idle',
    currentPromptIndex: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  await addQueue(queue);
  state.lastAddedQueueId = queue.id;
  showToast(`Queue "${name}" added with ${prompts.length} prompts`);

  // Update prompt list status
  const rows = document.querySelectorAll('.af-prompt-row');
  rows.forEach(row => {
    const badge = row.querySelector('.af-status') as HTMLElement;
    if (badge) {
      badge.classList.remove('af-status-not-added');
      badge.classList.add('af-status-queued');
      badge.textContent = 'Queued';
    }
  });

  await refreshQueuesList();
}

// ================================================================
// TAB B: SETTINGS
// ================================================================

function readSettingsFromUI(): QueueSettings {
  const mediaType = (document.querySelector('input[name="mediaType"]:checked') as HTMLInputElement)?.value as 'image' | 'video' || 'image';
  const videoResolution = ($('#setting-video-res') as HTMLSelectElement)?.value as '480p' | '720p' || '720p';
  const videoDuration = ($('#setting-video-dur') as HTMLSelectElement)?.value as '6s' | '10s' || '6s';
  const aspectRatio = ($('#setting-ratio') as HTMLSelectElement)?.value as any || '16:9';
  const waitMinSec = Number(($('#setting-wait-min') as HTMLInputElement)?.value) || 10;
  const waitMaxSec = Number(($('#setting-wait-max') as HTMLInputElement)?.value) || 20;
  const autoDownload = ($('#setting-auto-download') as HTMLInputElement)?.checked ?? true;
  const stopOnError = ($('#setting-stop-error') as HTMLInputElement)?.checked ?? false;
  const waitForCompletion = ($('#setting-wait-completion') as HTMLInputElement)?.checked ?? false;
  const videoExtend = ($('#setting-video-extend') as HTMLInputElement)?.checked ?? false;
  const extendDuration = ($('#setting-extend-duration') as HTMLSelectElement)?.value as '+6s' | '+10s' || '+10s';

  return { ...DEFAULT_SETTINGS, mediaType, videoResolution, videoDuration, aspectRatio, autoDownload, waitMinSec, waitMaxSec, stopOnError, waitForCompletion, videoExtend, extendDuration };
}

function applySettingsToUI(s: QueueSettings) {
  const mediaRadio = document.querySelector(`input[name="mediaType"][value="${s.mediaType}"]`) as HTMLInputElement;
  if (mediaRadio) mediaRadio.checked = true;

  const videoSection = document.getElementById('video-settings-section');
  if (videoSection) videoSection.style.display = s.mediaType === 'video' ? '' : 'none';

  // Show/hide extend section for video mode
  const extendSection = document.getElementById('extend-settings-section');
  if (extendSection) extendSection.style.display = s.mediaType === 'video' ? '' : 'none';

  const modeCards = document.querySelectorAll('.af-mode-card');
  modeCards.forEach(c => c.classList.remove('active'));
  const activeCard = document.querySelector(`.af-mode-card[data-mode="${s.mediaType}"]`) as HTMLElement;
  if (activeCard) activeCard.classList.add('active');

  ($('#setting-video-res') as HTMLSelectElement).value = s.videoResolution;
  ($('#setting-video-dur') as HTMLSelectElement).value = s.videoDuration;
  ($('#setting-ratio') as HTMLSelectElement).value = s.aspectRatio;
  ($('#setting-wait-min') as HTMLInputElement).value = String(s.waitMinSec);
  ($('#setting-wait-max') as HTMLInputElement).value = String(s.waitMaxSec);
  ($('#setting-auto-download') as HTMLInputElement).checked = s.autoDownload;
  ($('#setting-stop-error') as HTMLInputElement).checked = s.stopOnError;
  ($('#setting-wait-completion') as HTMLInputElement).checked = s.waitForCompletion ?? false;
  ($('#setting-video-extend') as HTMLInputElement).checked = s.videoExtend ?? false;
  ($('#setting-extend-duration') as HTMLSelectElement).value = s.extendDuration ?? '+10s';
}

async function loadSettings() {
  const s = await getSettings();
  applySettingsToUI(s);
}

function initSettingsTab() {
  $('#btn-save-settings')?.addEventListener('click', async () => {
    const settings = readSettingsFromUI();
    await saveSettings(settings);
    showToast('Settings saved!');
  });
}

// ================================================================
// TAB C: QUEUES
// ================================================================

function initQueuesTab() {}

async function refreshQueuesList() {
  const queues = await getAllQueues();
  const container = $('#queue-list');
  if (queues.length === 0) {
    container.innerHTML = `
      <div class="af-empty">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" opacity="0.2">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
          <line x1="3" y1="9" x2="21" y2="9"/>
          <line x1="9" y1="21" x2="9" y2="9"/>
        </svg>
        <p class="af-empty-title">No queues yet</p>
        <p class="af-empty-steps">
          <span>1. Go to <strong>Create</strong> tab</span>
          <span>2. Paste your prompts</span>
          <span>3. Click <strong>Add to Queue</strong></span>
        </p>
      </div>
    `;
    return;
  }

  container.innerHTML = '';
  queues.forEach(q => {
    const done = q.prompts.filter(p => p.status === 'done').length;
    const failed = q.prompts.filter(p => p.status === 'failed').length;
    const total = q.prompts.length;
    const date = new Date(q.createdAt).toLocaleString();
    const isActive = state.activeQueueId === q.id && state.isRunning;

    const card = document.createElement('div');
    card.className = 'af-queue-card af-card';
    card.id = `queue-card-${q.id}`;

    // Build prompt rows HTML
    let promptsHtml = '';
    q.prompts.forEach((p, idx) => {
      const preview = p.text.length > 60 ? p.text.substring(0, 60) + '…' : p.text;
      const statusClass = p.status === 'done' ? 'af-ps-done' : p.status === 'failed' ? 'af-ps-failed' : p.status === 'running' ? 'af-ps-running' : 'af-ps-queued';
      const statusLabel = p.status === 'done' ? '✅' : p.status === 'failed' ? '❌' : p.status === 'running' ? '⏳' : '○';
      const progressWidth = p.status === 'done' ? 100 : p.status === 'failed' ? 100 : 0;
      const progressClass = p.status === 'done' ? 'af-ppb-done' : p.status === 'failed' ? 'af-ppb-failed' : '';

      promptsHtml += `
        <div class="af-prompt-row-q ${statusClass}" id="pq-${q.id}-${idx}">
          <div class="af-pq-header">
            <span class="af-pq-num">${idx + 1}</span>
            <span class="af-pq-text">${escapeHtml(preview)}</span>
            <span class="af-pq-status">${statusLabel}</span>
          </div>
          <div class="af-pq-bar-bg">
            <div class="af-pq-bar ${progressClass}" id="pqbar-${q.id}-${idx}" style="width:${progressWidth}%"></div>
          </div>
        </div>
      `;
    });

    card.innerHTML = `
      <div class="af-queue-card-header">
        <strong class="af-queue-name">${escapeHtml(q.name)}</strong>
        <span class="af-status af-status-${q.status}">${q.status.toUpperCase()}</span>
      </div>
      <div class="af-queue-stats">
        <span class="af-qs-done">✅ ${done}</span>
        <span class="af-qs-failed">❌ ${failed}</span>
        <span class="af-qs-total">📋 ${total}</span>
        <span class="af-qs-date">${date}</span>
      </div>
      <div class="af-queue-progress-bar-bg">
        <div class="af-queue-progress-bar" style="width:${total > 0 ? Math.round((done / total) * 100) : 0}%"></div>
      </div>
      <div class="af-queue-actions">
        <button class="af-btn af-btn-sm af-btn-primary af-queue-run" data-queue-id="${q.id}">▶ Run</button>
        <button class="af-btn af-btn-sm af-btn-secondary af-queue-toggle" data-queue-id="${q.id}">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="6 9 12 15 18 9"/></svg>
          Prompts
        </button>
        <button class="af-btn af-btn-sm af-btn-danger af-queue-delete" data-queue-id="${q.id}">Delete</button>
      </div>
      <div class="af-queue-prompts ${isActive ? 'expanded' : ''}" id="qprompts-${q.id}">
        ${promptsHtml}
      </div>
    `;

    // Run button
    card.querySelector('.af-queue-run')?.addEventListener('click', async () => {
      if (state.isRunning) { showToast('Another queue is running.'); return; }

      await trackUsage(q.prompts.length, 'text');

      state.isRunning = true;
      state.activeQueueId = q.id;
      startKeepalivePort();
      updateStatusDot('running');

      // Show monitor
      const monitor = document.getElementById('run-monitor');
      if (monitor) monitor.style.display = '';
      $('#monitor-queue-name').textContent = q.name;
      $('#monitor-progress').textContent = `0 / ${q.prompts.length}`;

      // Auto-expand prompts list
      const promptsList = document.getElementById(`qprompts-${q.id}`);
      if (promptsList) promptsList.classList.add('expanded');

      const resp = await sendToBackground({ type: 'START_QUEUE', payload: q });
      if (resp?.error) {
        showToast(`Error: ${resp.error}`);
        state.isRunning = false;
        updateStatusDot('connected');
      }
    });

    // Toggle prompts visibility
    card.querySelector('.af-queue-toggle')?.addEventListener('click', () => {
      const promptsList = document.getElementById(`qprompts-${q.id}`);
      if (promptsList) promptsList.classList.toggle('expanded');
    });

    // Delete button
    card.querySelector('.af-queue-delete')?.addEventListener('click', async () => {
      await deleteQueue(q.id);
      showToast('Queue deleted');
      refreshQueuesList();
    });

    container.appendChild(card);
  });
}

// ================================================================
// TAB D: ACCOUNT (copied from AutoFlow)
// ================================================================

function initAccountTab() {
  const btnShowLogin = $('#btn-show-login') as HTMLButtonElement;
  const btnShowRegister = $('#btn-show-register') as HTMLButtonElement;
  const formLogin = $('#form-login') as HTMLFormElement;
  const formRegister = $('#form-register') as HTMLFormElement;

  function showMessage(id: string, msg: string, type: 'success' | 'error' | 'info') {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = msg;
    el.className = `af-auth-message ${type}`;
    el.style.display = 'block';
  }
  function hideMessage(id: string) {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  }

  // Toggle login/register forms
  btnShowLogin?.addEventListener('click', () => {
    btnShowLogin.classList.add('active');
    btnShowRegister.classList.remove('active');
    formLogin.style.display = 'flex';
    formRegister.style.display = 'none';
    hideMessage('login-message');
  });
  btnShowRegister?.addEventListener('click', () => {
    btnShowLogin.classList.remove('active');
    btnShowRegister.classList.add('active');
    formLogin.style.display = 'none';
    formRegister.style.display = 'flex';
    hideMessage('register-message');
  });

  // Login form
  formLogin?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = ($('#login-email') as HTMLInputElement).value.trim();
    const password = ($('#login-password') as HTMLInputElement).value;
    const submitBtn = $('#btn-login-submit') as HTMLButtonElement;
    hideMessage('login-message');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Signing in...';
    const result = await login(email, password);
    submitBtn.disabled = false;
    submitBtn.textContent = 'Sign In';
    if (result.ok) {
      showMessage('login-message', 'Signed in successfully!', 'success');
      await checkAuthState();
    } else {
      if (result.message?.includes('verify') || result.message?.includes('Verify')) {
        showVerifyPending(email);
      } else {
        showMessage('login-message', result.message, 'error');
      }
    }
  });

  // Register form
  formRegister?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = ($('#register-email') as HTMLInputElement).value.trim();
    const password = ($('#register-password') as HTMLInputElement).value;
    const submitBtn = $('#btn-register-submit') as HTMLButtonElement;
    hideMessage('register-message');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Creating...';
    const result = await register(email, password);
    submitBtn.disabled = false;
    submitBtn.textContent = 'Create Account';
    if (result.ok) {
      showVerifyPending(email);
    } else {
      showMessage('register-message', result.message, 'error');
    }
  });

  // Verification pending
  let pendingEmail = '';
  function showVerifyPending(email: string) {
    pendingEmail = email;
    ($('#account-logged-out') as HTMLElement).style.display = 'none';
    ($('#account-verify-pending') as HTMLElement).style.display = '';
    ($('#account-logged-in') as HTMLElement).style.display = 'none';
    ($('#verify-pending-email') as HTMLElement).textContent = email;
  }

  $('#btn-resend-verify')?.addEventListener('click', async () => {
    try {
      const res = await fetch(`https://api.auto-flow.studio/api/auth/resend-verification`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: pendingEmail }),
      });
      if (res.ok) showMessage('resend-message', 'Verification email resent!', 'success');
      else showMessage('resend-message', 'Could not resend. Try again later.', 'error');
    } catch { showMessage('resend-message', 'Network error. Check your connection.', 'error'); }
  });

  $('#btn-back-to-login')?.addEventListener('click', () => {
    ($('#account-logged-out') as HTMLElement).style.display = '';
    ($('#account-verify-pending') as HTMLElement).style.display = 'none';
    ($('#login-email') as HTMLInputElement).value = pendingEmail;
    showMessage('login-message', 'Verified your email? Sign in below.', 'info');
  });

  // Logout
  $('#btn-logout')?.addEventListener('click', async () => {
    await logout();
    showLoggedOutState();
    enforceAuthGate(false);
    showToast('Signed out');
  });

  // Refresh usage
  $('#btn-refresh-usage')?.addEventListener('click', () => checkAuthState());

  // Upgrade
  $('#btn-upgrade-pro')?.addEventListener('click', async () => {
    const url = await getUpgradeUrl();
    chrome.tabs.create({ url });
  });

  // Check initial auth state
  checkAuthState();
}

async function checkAuthState() {
  const loggedIn = await isLoggedIn();
  if (!loggedIn) {
    showLoggedOutState();
    enforceAuthGate(false);
    return;
  }

  const profile = await getProfile();
  const usage = await getDailyUsage();

  if (!profile) {
    showLoggedOutState();
    enforceAuthGate(false);
    return;
  }

  enforceAuthGate(true);
  showLoggedInState(profile, usage);
}

function showLoggedOutState() {
  const lo = document.getElementById('account-logged-out');
  const vp = document.getElementById('account-verify-pending');
  const li = document.getElementById('account-logged-in');
  if (lo) lo.style.display = '';
  if (vp) vp.style.display = 'none';
  if (li) li.style.display = 'none';
}

function showLoggedInState(profile: any, usage: any) {
  const lo = document.getElementById('account-logged-out');
  const vp = document.getElementById('account-verify-pending');
  const li = document.getElementById('account-logged-in');
  if (lo) lo.style.display = 'none';
  if (vp) vp.style.display = 'none';
  if (li) li.style.display = '';

  $('#account-email').textContent = profile.email;
  const planBadge = $('#account-plan-badge') as HTMLElement;
  planBadge.textContent = profile.is_pro_active ? 'Pro' : 'Free';
  planBadge.className = `af-plan-badge ${profile.is_pro_active ? 'af-plan-pro' : ''}`;

  if (usage) {
    // Text-to-Video usage
    const textPct = usage.text_limit > 0 ? Math.min(100, (usage.text_used / usage.text_limit) * 100) : 0;
    $('#account-text-usage-text').textContent = `${usage.text_used} / ${usage.text_limit}`;
    ($('#account-text-usage-bar') as HTMLElement).style.width = `${textPct}%`;
    $('#account-text-usage-hint').textContent = `${usage.text_remaining} remaining today`;

    // Full Features usage
    const fullPct = usage.full_limit > 0 ? Math.min(100, (usage.full_used / usage.full_limit) * 100) : 0;
    $('#account-full-usage-text').textContent = `${usage.full_used} / ${usage.full_limit}`;
    ($('#account-full-usage-bar') as HTMLElement).style.width = `${fullPct}%`;
    $('#account-full-usage-hint').textContent = `${usage.full_remaining} remaining today`;
  }

  // Show upgrade CTA for free users
  const upgradeCta = document.getElementById('upgrade-cta');
  if (upgradeCta) upgradeCta.style.display = profile.is_pro_active ? 'none' : '';
}

// ================================================================
// MESSAGE LISTENER (from content script / service worker)
// ================================================================

function initMessageListener() {
  chrome.runtime.onMessage.addListener((msg: Message, _sender, _sendResponse) => {
    // Suppress runtime.lastError to prevent unchecked error logging
    void chrome.runtime.lastError;
    try {
      switch (msg.type) {
        case 'QUEUE_STATUS_UPDATE':
          if (msg.payload.status === 'completed' || msg.payload.status === 'stopped') {
            state.isRunning = false;
            updateStatusDot('connected');
          }
          // Update monitor
          if (msg.payload.currentPromptIndex !== undefined) {
            $('#monitor-progress').textContent =
              `${msg.payload.currentPromptIndex + 1} / ${msg.payload.totalPrompts || '?'}`;
          }
          break;

        case 'PROMPT_STATUS_UPDATE': {
          const { queueId, promptIndex, status: pStatus, error: pError } = msg.payload;
          const row = document.getElementById(`pq-${queueId}-${promptIndex}`);
          const bar = document.getElementById(`pqbar-${queueId}-${promptIndex}`);
          if (row) {
            row.className = `af-prompt-row-q ${pStatus === 'done' ? 'af-ps-done' : pStatus === 'failed' ? 'af-ps-failed' : pStatus === 'running' ? 'af-ps-running' : 'af-ps-queued'}`;
            const statusEl = row.querySelector('.af-pq-status');
            if (statusEl) statusEl.textContent = pStatus === 'done' ? '✅' : pStatus === 'failed' ? '❌' : pStatus === 'running' ? '⏳' : '○';
          }
          if (bar) {
            bar.style.width = pStatus === 'done' ? '100%' : pStatus === 'failed' ? '100%' : '0%';
            bar.className = `af-pq-bar ${pStatus === 'done' ? 'af-ppb-done' : pStatus === 'failed' ? 'af-ppb-failed' : ''}`;
          }
          break;
        }

        case 'RUN_LOCK_CHANGED':
          state.isRunning = msg.payload.locked;
          updateStatusDot(state.isRunning ? 'running' : 'connected');
          if (!state.isRunning) {
            const monitor = document.getElementById('run-monitor');
            // Keep monitor visible
          }
          break;

        case 'QUEUE_SUMMARY': {
          const { done, failed, skipped } = msg.payload;
          showToast(`Complete! ✅ ${done} done · ❌ ${failed} failed · ⏭ ${skipped} skipped`);
          state.isRunning = false;
          updateStatusDot('connected');
          refreshQueuesList();
          break;
        }

        case 'LOG': {
          const logDiv = document.getElementById('monitor-logs');
          if (logDiv) {
            const entry = document.createElement('div');
            entry.className = `af-log-entry af-log-${msg.payload.level}`;
            const time = new Date(msg.payload.timestamp).toLocaleTimeString();
            entry.textContent = `[${time}] ${msg.payload.message}`;
            logDiv.appendChild(entry);
            logDiv.scrollTop = logDiv.scrollHeight;
            while (logDiv.childElementCount > 200) logDiv.removeChild(logDiv.firstChild!);
          }
          break;
        }

        case 'GENERATION_PROGRESS': {
          const { promptIndex, progress, state: genState, queueId: gQueueId } = msg.payload;
          // Update individual prompt bar
          const pBar = document.getElementById(`pqbar-${gQueueId}-${promptIndex}`);
          const pRow = document.getElementById(`pq-${gQueueId}-${promptIndex}`);
          if (pBar) {
            if (genState === 'generating' && progress >= 0) {
              pBar.style.width = `${progress}%`;
              pBar.className = 'af-pq-bar af-ppb-active';
            } else if (genState === 'completed') {
              pBar.style.width = '100%';
              pBar.className = 'af-pq-bar af-ppb-done';
            } else if (genState === 'failed') {
              pBar.style.width = '100%';
              pBar.className = 'af-pq-bar af-ppb-failed';
            }
          }
          if (pRow) {
            const statusEl = pRow.querySelector('.af-pq-status');
            if (genState === 'generating' && statusEl) statusEl.textContent = progress >= 0 ? `${progress}%` : '⏳';
            if (genState === 'completed' && statusEl) statusEl.textContent = '✅';
            if (genState === 'failed' && statusEl) statusEl.textContent = '❌';
            if (genState === 'timeout' && statusEl) statusEl.textContent = '⏱';
          }

          // Also update global monitor progress bar
          const progressSection = document.getElementById('gen-progress-section');
          const progressBar = document.getElementById('gen-progress-bar') as HTMLElement;
          const progressPct = document.getElementById('gen-progress-pct');
          const progressLabel = document.getElementById('gen-progress-label');
          if (progressSection) progressSection.style.display = '';
          const monitor = document.getElementById('run-monitor');
          if (monitor) monitor.style.display = '';

          if (genState === 'generating' && progress >= 0) {
            if (progressBar) progressBar.style.width = `${progress}%`;
            if (progressPct) progressPct.textContent = `${progress}%`;
            if (progressLabel) progressLabel.textContent = `Prompt #${promptIndex + 1} generating...`;
          } else if (genState === 'completed') {
            if (progressBar) { progressBar.style.width = '100%'; progressBar.classList.add('af-progress-done'); }
            if (progressPct) progressPct.textContent = '✅';
            if (progressLabel) progressLabel.textContent = `Prompt #${promptIndex + 1} completed`;
            setTimeout(() => {
              if (progressBar) { progressBar.style.width = '0%'; progressBar.classList.remove('af-progress-done'); }
              if (progressPct) progressPct.textContent = '0%';
            }, 2000);
          } else if (genState === 'failed') {
            if (progressBar) { progressBar.style.width = '100%'; progressBar.classList.add('af-progress-failed'); }
            if (progressPct) progressPct.textContent = '❌';
            if (progressLabel) progressLabel.textContent = `Prompt #${promptIndex + 1} failed`;
            setTimeout(() => {
              if (progressBar) { progressBar.style.width = '0%'; progressBar.classList.remove('af-progress-failed'); }
            }, 2000);
          } else if (genState === 'timeout') {
            if (progressPct) progressPct.textContent = '⏱';
            if (progressLabel) progressLabel.textContent = `Prompt #${promptIndex + 1} timeout`;
          }
          break;
        }
      }
    } catch (err) {
      console.warn('[GrokAuto] Message handler error:', err);
    }
  });
}

// ================================================================
// UTILITIES
// ================================================================

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function showToast(msg: string) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = msg;
  toast.style.display = 'block';
  setTimeout(() => { toast.style.display = 'none'; }, 3000);
}

async function sendToBackground(msg: Message): Promise<any> {
  try {
    return await chrome.runtime.sendMessage(msg);
  } catch (err: any) {
    return { error: err.message };
  }
}

// ================================================================
// IMAGE HELPERS
// ================================================================

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

function renderImageThumbnails() {
  const container = document.getElementById('image-thumbnails');
  const countBadge = document.getElementById('image-count');
  const clearBtn = document.getElementById('btn-clear-images');
  if (!container) return;

  container.innerHTML = '';

  state.attachedImages.forEach((img, idx) => {
    const wrap = document.createElement('div');
    wrap.className = 'af-img-thumb-wrap';
    wrap.innerHTML = `
      <img class="af-img-thumb" src="${img.objectUrl}" alt="${escapeHtml(img.name)}" />
      <button class="af-img-remove" data-img-idx="${idx}" title="Remove">×</button>
    `;
    wrap.querySelector('.af-img-remove')!.addEventListener('click', (e) => {
      e.stopPropagation();
      URL.revokeObjectURL(state.attachedImages[idx].objectUrl);
      state.attachedImages.splice(idx, 1);
      renderImageThumbnails();
    });
    container.appendChild(wrap);
  });

  const count = state.attachedImages.length;
  if (countBadge) {
    countBadge.style.display = count > 0 ? '' : 'none';
    countBadge.textContent = `${count} image${count !== 1 ? 's' : ''}`;
  }
  if (clearBtn) {
    clearBtn.style.display = count > 0 ? '' : 'none';
  }
}
