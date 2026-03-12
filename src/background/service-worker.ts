/* ============================================================
   AutoFlow – Background Service Worker (MV3)
   Handles: downloads, storage messaging, queue orchestration,
   keepalive & anti-throttle for background execution.
   ============================================================ */

import { Message, QueueObject, LogEntry } from '../types';
import {
  getAllQueues,
  updateQueue,
  getActiveQueueId,
  setActiveQueueId,
  appendLog,
  getQueueById,
} from '../shared/storage';

// ================================================================
// KEEPALIVE SYSTEM — Prevents SW death & tab throttling
// ================================================================
// Chrome MV3 kills the service worker after ~30s of inactivity.
// Background tabs get timer-throttled (setTimeout min 1s, then frozen).
// This system uses alarms + ports + periodic pings to keep everything alive.

const KEEPALIVE_ALARM = 'af-keepalive';
const TAB_PING_ALARM = 'af-tab-ping';

/** Track the Flow tab running the queue (persisted in session storage) */
let _activeTabId: number | null = null;

async function getActiveTabId(): Promise<number | null> {
  if (_activeTabId) return _activeTabId;
  try {
    const data = await chrome.storage.session.get('activeQueueTabId');
    _activeTabId = data.activeQueueTabId ?? null;
  } catch {
    // session storage not available
  }
  return _activeTabId;
}

async function setActiveTabIdStore(tabId: number | null) {
  _activeTabId = tabId;
  try {
    if (tabId) {
      await chrome.storage.session.set({ activeQueueTabId: tabId });
    } else {
      await chrome.storage.session.remove('activeQueueTabId');
    }
  } catch { /* session storage may not be available */ }
}

/** Start keepalive alarms when a queue begins */
async function startKeepalive(tabId: number) {
  await setActiveTabIdStore(tabId);

  // Alarm to keep SW alive — fires every 24s (minimum for unpacked extensions)
  chrome.alarms.create(KEEPALIVE_ALARM, {
    delayInMinutes: 0.4,
    periodInMinutes: 0.4,
  });

  // Alarm to ping the content script tab — fires every 20s
  // This wakes up throttled tabs via chrome.tabs.sendMessage
  chrome.alarms.create(TAB_PING_ALARM, {
    delayInMinutes: 0.3,
    periodInMinutes: 0.3,
  });

  console.log(`[AutoFlow] Keepalive started for tab ${tabId}`);
}

/** Stop keepalive when queue ends */
async function stopKeepalive() {
  await setActiveTabIdStore(null);
  chrome.alarms.clear(KEEPALIVE_ALARM);
  chrome.alarms.clear(TAB_PING_ALARM);
  console.log('[AutoFlow] Keepalive stopped');
}

/** Alarm handler — keep SW alive + ping content script + anti-freeze tab */
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === KEEPALIVE_ALARM) {
    // Just waking up the SW is enough — check if queue is still active
    const queueId = await getActiveQueueId();
    if (!queueId) {
      await stopKeepalive();
    }
    return;
  }

  if (alarm.name === TAB_PING_ALARM) {
    await tabPingRoutine();
    return;
  }
});

/** Periodic routine: ping content script + ensure tab is active (not throttled) */
async function tabPingRoutine() {
  const tabId = await getActiveTabId();
  if (!tabId) {
    await stopKeepalive();
    return;
  }

  // 1. Ensure the tab still exists and is the active tab in its window
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab) {
      await logEntry('error', 'Queue tab no longer exists');
      await stopKeepalive();
      return;
    }

    // Make it the active tab in its window to reduce throttling
    if (!tab.active) {
      await chrome.tabs.update(tabId, { active: true });
    }
  } catch {
    // Tab is gone
    await logEntry('error', 'Lost connection to Flow tab');
    await stopKeepalive();
    return;
  }

  // 2. Ping the content script — this wakes it up from throttled state
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'PING' });
  } catch {
    // Content script not reachable — try re-injecting
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['content.js'],
      });
      console.log('[AutoFlow] Re-injected content script via keepalive');
    } catch (err: any) {
      await logEntry('error', `Keepalive: cannot reach Flow tab — ${err.message}`);
    }
  }
}

// ── Port-based keepalive from side panel ──
// A connected port prevents the SW from being terminated.
// The side panel maintains this port while a queue is running.
const keepalivePorts = new Set<chrome.runtime.Port>();

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'af-keepalive') {
    keepalivePorts.add(port);
    console.log('[AutoFlow] Keepalive port connected');

    port.onMessage.addListener((_msg) => {
      // Just receiving messages keeps the SW alive — no action needed
    });

    port.onDisconnect.addListener(() => {
      keepalivePorts.delete(port);
      console.log('[AutoFlow] Keepalive port disconnected');
    });
  }
});

// ── Restore keepalive on SW restart ──
// When the SW wakes up (e.g., from an alarm), check if a queue is active
// and restart keepalive if needed.
(async () => {
  try {
    const queueId = await getActiveQueueId();
    if (queueId) {
      const tabId = await getActiveTabId();
      if (tabId) {
        console.log(`[AutoFlow] SW restarted — restoring keepalive for tab ${tabId}`);
        await startKeepalive(tabId);
      }
    }
  } catch { /* first run, no active queue */ }
})();

// ── Tab removal listener — stop keepalive if queue tab is closed ──
chrome.tabs.onRemoved.addListener(async (closedTabId) => {
  const activeTab = await getActiveTabId();
  if (activeTab === closedTabId) {
    await logEntry('warn', 'Flow tab was closed while queue was running');
    await stopKeepalive();
  }
});

// ================================================================
// CORE EXTENSION SETUP
// ================================================================

// ── Open side panel on action click ──
chrome.action.onClicked.addListener(async (tab) => {
  if (tab.id) {
    await chrome.sidePanel.open({ tabId: tab.id });
  }
});

// ── Enable side panel on Flow pages ──
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

// ── Message router ──
chrome.runtime.onMessage.addListener((msg: Message, sender, sendResponse) => {
  handleMessage(msg, sender).then(sendResponse).catch(err => {
    console.error('[AutoFlow BG] Error handling message:', err);
    sendResponse({ error: err.message });
  });
  return true; // async response
});

async function handleMessage(msg: Message, sender: chrome.runtime.MessageSender): Promise<any> {
  switch (msg.type) {
    case 'DOWNLOAD_FILE':
      return handleDownload(msg.payload);

    // DOWNLOAD_VIA_PAGE removed – chrome.downloads.download handles cookies natively

    case 'LOG':
      return handleLog(msg.payload);

    case 'QUEUE_STATUS_UPDATE':
      return handleQueueStatusUpdate(msg.payload);

    case 'PROMPT_STATUS_UPDATE':
      return handlePromptStatusUpdate(msg.payload);

    case 'PING':
      return { type: 'PONG' };

    case 'START_QUEUE':
      return startQueueInTab(msg.payload);

    case 'PAUSE_QUEUE':
    case 'RESUME_QUEUE':
    case 'STOP_QUEUE':
    case 'SKIP_CURRENT':
    case 'RETRY_FAILED':
    case 'SCAN_LIBRARY':
    case 'PREVIEW_ASSET':
    case 'DOWNLOAD_SELECTED':
    case 'REFRESH_MODELS':
    case 'SCAN_FAILED_TILES':
    case 'RETRY_FAILED_TILES':
    case 'RETRY_SINGLE_TILE':
    case 'UPSCALE_SELECTED':
      return forwardToContentScript(msg);

    case 'GET_IMAGE_BLOBS':
    case 'UPLOAD_IMAGES_TO_FLOW':
      // Content script requests image blobs → relay to sidepanel which has IndexedDB access
      return handleImageBlobRequest(msg.payload);

    case 'RUN_LOCK_CHANGED':
      broadcastToExtension(msg);
      return {};

    case 'FAILED_TILES_RESULT':
      broadcastToExtension(msg);
      return {};

    case 'QUEUE_SUMMARY':
      broadcastToExtension(msg);
      return {};

    case 'SET_DOWNLOAD_RENAME':
      queueDownloadRename(msg.payload.filename);
      return { success: true };

    default:
      return { error: 'Unknown message type' };
  }
}

// ── Download handler ──
async function handleDownload(payload: {
  url: string;
  filename: string;
  conflictAction?: string;
}): Promise<{ downloadId?: number; error?: string }> {
  try {
    const downloadId = await chrome.downloads.download({
      url: payload.url,
      filename: payload.filename,
      conflictAction: (payload.conflictAction as any) || 'uniquify',
      saveAs: false,
    });
    return { downloadId };
  } catch (err: any) {
    await logEntry('error', `Download failed: ${err.message}`);
    return { error: err.message };
  }
}


// ── Log handler ──
async function handleLog(entry: LogEntry): Promise<void> {
  await appendLog(entry);
  // Broadcast to side panel
  broadcastToExtension({ type: 'LOG', payload: entry });
}

// ── Storage mutex to prevent concurrent read-modify-write ──
let storageLock: Promise<void> = Promise.resolve();
function withStorageLock<T>(fn: () => Promise<T>): Promise<T> {
  const prev = storageLock;
  let resolve: () => void;
  storageLock = new Promise(r => { resolve = r; });
  return prev.then(fn).finally(() => resolve!());
}

// ── Queue status update ──
async function handleQueueStatusUpdate(payload: {
  queueId: string;
  status: string;
  currentPromptIndex?: number;
}): Promise<void> {
  return withStorageLock(async () => {
    const queue = await getQueueById(payload.queueId);
    if (!queue) {
      console.warn('[AutoFlow BG] handleQueueStatusUpdate: queue not found', payload.queueId);
      return;
    }
    queue.status = payload.status as any;
    if (payload.currentPromptIndex !== undefined) {
      queue.currentPromptIndex = payload.currentPromptIndex;
    }
    queue.updatedAt = Date.now();
    await updateQueue(queue);
    console.log(`[AutoFlow BG] Queue status → ${payload.status}, prompt ${payload.currentPromptIndex}, done: ${queue.prompts.filter(p => p.status === 'done').length}/${queue.prompts.length}`);
    broadcastToExtension({ type: 'QUEUE_STATUS_UPDATE', payload: queue });

    // Stop keepalive when queue finishes
    if (payload.status === 'completed' || payload.status === 'stopped') {
      await stopKeepalive();
    }
  });
}

// ── Prompt status update ──
async function handlePromptStatusUpdate(payload: {
  queueId: string;
  promptIndex: number;
  status: string;
  error?: string;
  outputFiles?: string[];
  attempts?: number;
}): Promise<void> {
  return withStorageLock(async () => {
    const queue = await getQueueById(payload.queueId);
    if (!queue) {
      console.warn('[AutoFlow BG] handlePromptStatusUpdate: queue not found', payload.queueId);
      return;
    }
    const prompt = queue.prompts[payload.promptIndex];
    if (!prompt) {
      console.warn('[AutoFlow BG] handlePromptStatusUpdate: prompt not found at index', payload.promptIndex);
      return;
    }
    prompt.status = payload.status as any;
    if (payload.error !== undefined) prompt.error = payload.error;
    if (payload.outputFiles) prompt.outputFiles = payload.outputFiles;
    if (payload.attempts !== undefined) prompt.attempts = payload.attempts;
    queue.updatedAt = Date.now();
    await updateQueue(queue);
    console.log(`[AutoFlow BG] Prompt #${payload.promptIndex + 1} → ${payload.status}, done: ${queue.prompts.filter(p => p.status === 'done').length}/${queue.prompts.length}`);
    broadcastToExtension({ type: 'PROMPT_STATUS_UPDATE', payload: { queue, promptIndex: payload.promptIndex } });
  });
}

// ── Start queue: use the tab the sidepanel is on (user's project tab) ──
async function startQueueInTab(payload: { queueId: string; tabId?: number }): Promise<any> {
  const queue = await getQueueById(payload.queueId);
  if (!queue) return { error: 'Queue not found' };

  let tabId: number;

  if (payload.tabId) {
    // Use the exact tab the sidepanel sent us — this is the user's project tab
    tabId = payload.tabId;
    await chrome.tabs.update(tabId, { active: true });
  } else {
    // Fallback: find the currently active Flow tab
    const tabs = await chrome.tabs.query({
      url: ['https://labs.google/flow*', 'https://labs.google/fx*'],
      active: true,
      currentWindow: true,
    });

    if (tabs.length > 0 && tabs[0].id) {
      tabId = tabs[0].id;
    } else {
      // Try any Flow tab
      const allFlowTabs = await chrome.tabs.query({
        url: ['https://labs.google/flow*', 'https://labs.google/fx*'],
      });
      if (allFlowTabs.length > 0 && allFlowTabs[0].id) {
        tabId = allFlowTabs[0].id;
        await chrome.tabs.update(tabId, { active: true });
      } else {
        return { error: 'No Flow project tab found. Please open a project in labs.google/flow first.' };
      }
    }
  }

  // Update queue status
  queue.status = 'running';
  queue.updatedAt = Date.now();
  await updateQueue(queue);
  await setActiveQueueId(queue.id);

  // Open side panel on that tab
  try {
    await chrome.sidePanel.open({ tabId });
  } catch (e) {
    // Side panel may already be open
  }

  // Start keepalive system to prevent SW death and tab throttling
  await startKeepalive(tabId);

  // Forward start command to content script
  try {
    await chrome.tabs.sendMessage(tabId, {
      type: 'START_QUEUE',
      payload: { queue },
    });
  } catch (err: any) {
    // Content script might not be injected yet, inject it
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content.js'],
    });
    await sleep(1000);
    await chrome.tabs.sendMessage(tabId, {
      type: 'START_QUEUE',
      payload: { queue },
    });
  }

  broadcastToExtension({ type: 'QUEUE_STATUS_UPDATE', payload: queue });
  return { success: true };
}

// ── Image blob relay: ask sidepanel to read from IndexedDB and return base64 ──
async function handleImageBlobRequest(payload: { imageIds: string[] }): Promise<any> {
  // The sidepanel has access to IndexedDB where image blobs are stored.
  // We broadcast a request and wait for the sidepanel to respond.
  try {
    const response = await chrome.runtime.sendMessage({
      type: 'GET_IMAGE_BLOBS',
      payload,
    });
    return response;
  } catch (err: any) {
    // Sidepanel may not be open — return error
    return { error: `Could not retrieve image blobs: ${err.message}`, files: [] };
  }
}

// ── Forward message to the active Flow content script tab ──
async function forwardToContentScript(msg: Message): Promise<any> {
  // Prefer the active Flow tab in the current window — this is likely the one the user sees
  const activeTabs = await chrome.tabs.query({
    url: ['https://labs.google/flow*', 'https://labs.google/fx*'],
    active: true,
    currentWindow: true,
  });
  let tabId: number | undefined;

  if (activeTabs.length > 0 && activeTabs[0].id) {
    tabId = activeTabs[0].id;
  } else {
    // Fallback: any Flow tab
    const allTabs = await chrome.tabs.query({
      url: ['https://labs.google/flow*', 'https://labs.google/fx*'],
    });
    if (allTabs.length === 0 || !allTabs[0].id) {
      return { error: 'No Flow tab found. Please open labs.google/flow first.' };
    }
    tabId = allTabs[0].id;
  }

  // First attempt: try sending the message directly
  try {
    const response = await chrome.tabs.sendMessage(tabId, msg);
    return response;
  } catch (_firstErr: any) {
    // Content script is not reachable (extension was reloaded or context invalidated).
    // Re-inject the content script and retry.
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['content.js'],
      });
      // Give the re-injected script a moment to initialise its listener
      await sleep(500);
      const retryResponse = await chrome.tabs.sendMessage(tabId, msg);
      return retryResponse;
    } catch (retryErr: any) {
      return { error: `Failed to communicate with Flow tab: ${retryErr.message}` };
    }
  }
}

// ── Broadcast to all extension views (side panel) ──
function broadcastToExtension(msg: Message) {
  chrome.runtime.sendMessage(msg).catch(() => {
    // No listener available, that's OK
  });
}

// ── Helper ──
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function logEntry(level: 'info' | 'warn' | 'error', message: string) {
  await appendLog({ timestamp: Date.now(), level, message });
}

// ================================================================
// DOWNLOAD RENAME INTERCEPTION
// ================================================================
// When downloading at 1080p/4K via Flow's native menu, Flow names
// files itself. We intercept via onDeterminingFilename and rename
// them to the user's prompt-based naming scheme.
// ================================================================

interface PendingRename {
  filename: string;   // desired path like "LIBRARY/project/001_cat.mp4"
  createdAt: number;  // timestamp for expiry
}

const pendingRenames: PendingRename[] = [];

/**
 * Queue a filename rename — the next download from labs.google
 * will be renamed to this filename.
 */
function queueDownloadRename(filename: string) {
  pendingRenames.push({ filename, createdAt: Date.now() });
  console.log(`[AutoFlow] Queued rename: ${filename} (${pendingRenames.length} pending)`);
}

/**
 * Intercept downloads and rename them if a pending rename exists.
 * chrome.downloads.onDeterminingFilename fires when Chrome is about
 * to save a file — we can suggest a different filename.
 */
chrome.downloads.onDeterminingFilename.addListener(
  (downloadItem: chrome.downloads.DownloadItem, suggest: (suggestion?: { filename: string; conflictAction?: string }) => void) => {
    // Clean expired entries (older than 30 seconds)
    const now = Date.now();
    while (pendingRenames.length > 0 && now - pendingRenames[0].createdAt > 30000) {
      const expired = pendingRenames.shift()!;
      console.log(`[AutoFlow] Rename expired: ${expired.filename}`);
    }

    // Only rename if we have a pending rename queued
    if (pendingRenames.length > 0) {
      // Check the download is from a Google/Flow domain
      const url = downloadItem.url || '';
      if (url.includes('labs.google') || url.includes('googleapis.com') || url.includes('googleusercontent.com')) {
        const rename = pendingRenames.shift()!;
        console.log(`[AutoFlow] Renaming download to: ${rename.filename}`);
        suggest({ filename: rename.filename, conflictAction: 'uniquify' });
        return;
      }
    }

    // No rename needed — pass through the existing filename unchanged.
    // IMPORTANT: suggest() with no args resets to URL-derived name (UUID).
    // We must pass downloadItem.filename to preserve names set by
    // chrome.downloads.download({ filename: ... }).
    suggest({ filename: downloadItem.filename, conflictAction: 'uniquify' });
  }
);

// ── Listen for download completion to detect "Ask where to save" issues ──
chrome.downloads.onChanged.addListener((delta) => {
  if (delta.error) {
    logEntry('error', `Download error: ${JSON.stringify(delta.error)}`);
  }
});
