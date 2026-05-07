/* ============================================================
   Grok Auto – Background Service Worker (MV3)
   Handles: downloads, storage messaging, queue orchestration
   ============================================================ */

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

import { Message } from '../types';
import {
  getAllQueues, updateQueue, getActiveQueueId, setActiveQueueId,
  appendLog, getQueueById, getImageBlob,
} from '../shared/storage';

// ── Download rename queue ──
const pendingRenames: Map<string, string> = new Map();
const ourDownloadIds: Set<number> = new Set();

// ── Message router ──
chrome.runtime.onMessage.addListener((msg: Message, sender, sendResponse) => {
  (async () => {
    try {
      switch (msg.type) {
        case 'START_QUEUE':
        case 'PAUSE_QUEUE':
        case 'RESUME_QUEUE':
        case 'STOP_QUEUE':
        case 'SKIP_CURRENT':
        case 'PING':
        case 'SCAN_PAGE':
          // Forward to the active grok.com content script
          return await forwardToContentScript(msg);

        case 'LOG':
          await appendLog(msg.payload);
          return { ok: true };

        case 'QUEUE_STATUS_UPDATE': {
          const queue = await getQueueById(msg.payload.queueId);
          if (queue) {
            queue.status = msg.payload.status;
            queue.currentPromptIndex = msg.payload.currentPromptIndex ?? queue.currentPromptIndex;
            queue.updatedAt = Date.now();
            await updateQueue(queue);
          }
          // Broadcast to sidepanel
          chrome.runtime.sendMessage(msg).catch(() => {});
          return { ok: true };
        }

        case 'PROMPT_STATUS_UPDATE': {
          const queue = await getQueueById(msg.payload.queueId);
          if (queue && queue.prompts[msg.payload.promptIndex]) {
            const p = queue.prompts[msg.payload.promptIndex];
            p.status = msg.payload.status;
            if (msg.payload.error) p.error = msg.payload.error;
            p.attempts = msg.payload.attempts ?? p.attempts;
            queue.updatedAt = Date.now();
            await updateQueue(queue);
          }
          chrome.runtime.sendMessage(msg).catch(() => {});
          return { ok: true };
        }

        case 'RUN_LOCK_CHANGED':
        case 'QUEUE_SUMMARY':
          chrome.runtime.sendMessage(msg).catch(() => {});
          return { ok: true };

        case 'GENERATION_PROGRESS': {
          // Persist "running" state for the current prompt
          const gQueue = await getQueueById(msg.payload.queueId);
          if (gQueue && gQueue.prompts[msg.payload.promptIndex]) {
            const gp = gQueue.prompts[msg.payload.promptIndex];
            if (msg.payload.state === 'generating' && gp.status !== 'running') {
              gp.status = 'running' as any;
              gQueue.updatedAt = Date.now();
              await updateQueue(gQueue);
            }
          }
          chrome.runtime.sendMessage(msg).catch(() => {});
          return { ok: true };
        }

        case 'SET_DOWNLOAD_RENAME':
          queueDownloadRename(msg.payload.expectedFilename, msg.payload.desiredFilename);
          return { ok: true };

        case 'DOWNLOAD_FILE':
          return await handleDownload(msg.payload);

        case 'GET_IMAGE_BLOBS':
          return await handleImageBlobRequest(msg.payload);

        default:
          return { ok: false, error: `Unknown message: ${msg.type}` };
      }
    } catch (err: any) {
      console.error('[GrokAuto] Service worker error:', err);
      return { error: err.message };
    }
  })().then(sendResponse);
  return true; // keep async channel open
});

// ── Download handler ──
async function handleDownload(payload: { url: string; filename: string }): Promise<any> {
  try {
    const downloadId = await chrome.downloads.download({
      url: payload.url,
      filename: payload.filename,
      conflictAction: 'uniquify',
    });
    ourDownloadIds.add(downloadId);
    return { ok: true, downloadId };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

// ── Download rename interceptor ──
function queueDownloadRename(expectedFilename: string, desiredFilename: string) {
  pendingRenames.set(expectedFilename.toLowerCase(), desiredFilename);
  // Auto-expire after 60s
  setTimeout(() => pendingRenames.delete(expectedFilename.toLowerCase()), 60_000);
}

chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
  const basename = (item.filename || '').split(/[\\/]/).pop()?.toLowerCase() || '';

  // Check pending renames
  for (const [expected, desired] of pendingRenames) {
    if (basename.includes(expected) || expected.includes(basename)) {
      pendingRenames.delete(expected);
      suggest({ filename: desired, conflictAction: 'uniquify' });
      return true;
    }
  }

  // Also check if this is one of our downloads with a pending rename by ID
  if (ourDownloadIds.has(item.id)) {
    ourDownloadIds.delete(item.id);
    // Find any single pending rename
    const firstEntry = pendingRenames.entries().next().value;
    if (firstEntry) {
      const [key, desired] = firstEntry;
      pendingRenames.delete(key);
      suggest({ filename: desired, conflictAction: 'uniquify' });
      return true;
    }
  }

  suggest(); // Default behavior
  return true;
});

// ── Image blob handler: read directly from IndexedDB ──
async function handleImageBlobRequest(payload: { imageIds: string[] }): Promise<any> {
  try {
    const files: Array<{ id: string; filename: string; mime: string; data: string }> = [];
    for (const id of payload.imageIds) {
      const blob = await getImageBlob(id);
      if (blob) {
        const base64 = await blobToBase64(blob);
        const mime = blob.type || 'image/png';
        files.push({ id, filename: `image_${id}.${mime.includes('png') ? 'png' : 'jpg'}`, mime, data: base64 });
      }
    }
    return { files };
  } catch (err: any) {
    return { error: err.message, files: [] };
  }
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// ── Forward message to the active grok.com content script tab ──
async function forwardToContentScript(msg: Message): Promise<any> {
  const activeTabs = await chrome.tabs.query({
    url: ['https://grok.com/*'],
    active: true,
    currentWindow: true,
  });

  const allTabs = activeTabs.length > 0
    ? activeTabs
    : await chrome.tabs.query({ url: ['https://grok.com/*'] });

  if (allTabs.length === 0) {
    return { error: 'No grok.com tab found. Open grok.com/imagine first.' };
  }

  const tabId = allTabs[0].id!;

  // Try sending the message
  try {
    return await chrome.tabs.sendMessage(tabId, msg);
  } catch {
    // Content script not loaded — try injecting it
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['content.js'],
      });
      // Wait a moment for the script to initialize
      await new Promise(r => setTimeout(r, 500));
      return await chrome.tabs.sendMessage(tabId, msg);
    } catch {
      return { error: 'Could not reach grok.com tab. Reload the page and try again.' };
    }
  }
}

console.log('[GrokAuto] Service worker loaded');
