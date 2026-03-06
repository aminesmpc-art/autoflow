/* ============================================================
   AutoFlow – Background Service Worker (MV3)
   Handles: downloads, storage messaging, queue orchestration
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

// ── Queue status update ──
async function handleQueueStatusUpdate(payload: {
  queueId: string;
  status: string;
  currentPromptIndex?: number;
}): Promise<void> {
  const queue = await getQueueById(payload.queueId);
  if (!queue) return;
  queue.status = payload.status as any;
  if (payload.currentPromptIndex !== undefined) {
    queue.currentPromptIndex = payload.currentPromptIndex;
  }
  queue.updatedAt = Date.now();
  await updateQueue(queue);
  broadcastToExtension({ type: 'QUEUE_STATUS_UPDATE', payload: queue });
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
  const queue = await getQueueById(payload.queueId);
  if (!queue) return;
  const prompt = queue.prompts[payload.promptIndex];
  if (!prompt) return;
  prompt.status = payload.status as any;
  if (payload.error !== undefined) prompt.error = payload.error;
  if (payload.outputFiles) prompt.outputFiles = payload.outputFiles;
  if (payload.attempts !== undefined) prompt.attempts = payload.attempts;
  queue.updatedAt = Date.now();
  await updateQueue(queue);
  broadcastToExtension({ type: 'PROMPT_STATUS_UPDATE', payload: { queue, promptIndex: payload.promptIndex } });
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

// ── Listen for download completion to detect "Ask where to save" issues ──
chrome.downloads.onChanged.addListener((delta) => {
  if (delta.error) {
    logEntry('error', `Download error: ${JSON.stringify(delta.error)}`);
  }
});
