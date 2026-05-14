/* ============================================================
   AutoFlow – Background Service Worker (MV3)
   Handles: downloads, storage messaging, queue orchestration,
   keepalive & anti-throttle for background execution.
   ============================================================ */

// ── Side panel setup — open on icon click ──
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

import { Message, QueueObject, LogEntry } from '../types';
import {
  getAllQueues,
  updateQueue,
  getActiveQueueId,
  setActiveQueueId,
  appendLog,
  getQueueById,
  getImageBlob,
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
  // Always read from session storage to avoid stale cached values
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
// and restart keepalive if needed — with health verification.
(async () => {
  try {
    const queueId = await getActiveQueueId();
    if (queueId) {
      const tabId = await getActiveTabId();
      if (tabId) {
        // Verify the tab still exists before restarting keepalive
        try {
          const tab = await chrome.tabs.get(tabId);
          if (tab) {
            console.log(`[AutoFlow] SW restarted — restoring keepalive for tab ${tabId}`);
            await startKeepalive(tabId);
          } else {
            throw new Error('Tab not found');
          }
        } catch {
          // Tab is gone — mark queue as stopped
          const queue = await getQueueById(queueId);
          if (queue && queue.status === 'running') {
            queue.status = 'stopped';
            queue.updatedAt = Date.now();
            await updateQueue(queue);
          }
          await setActiveQueueId(null);
          await stopKeepalive();
          console.log('[AutoFlow] SW restarted — queue tab gone, cleaned up');
        }
      }
    }
  } catch { /* first run, no active queue */ }
})();

// ── Tab removal listener — stop keepalive and mark queue stopped if queue tab is closed ──
chrome.tabs.onRemoved.addListener(async (closedTabId) => {
  const activeTab = await getActiveTabId();
  if (activeTab === closedTabId) {
    await logEntry('warn', 'Flow tab was closed while queue was running');
    // Mark queue as stopped so it doesn't stay in 'running' forever
    const queueId = await getActiveQueueId();
    if (queueId) {
      const queue = await getQueueById(queueId);
      if (queue && queue.status === 'running') {
        queue.status = 'stopped';
        queue.updatedAt = Date.now();
        await updateQueue(queue);
        broadcastToExtension({ type: 'QUEUE_STATUS_UPDATE', payload: queue });
      }
      await setActiveQueueId(null);
    }
    await stopKeepalive();
  }
});

// ================================================================
// CORE EXTENSION SETUP
// ================================================================

// ── Message router ──
chrome.runtime.onMessage.addListener((msg: Message, sender, sendResponse) => {
  // Skip self-broadcasts to prevent infinite loops
  if (_broadcasting && !sender.tab) { sendResponse({}); return true; }
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

    case 'REACT_TRIGGER': {
      if (!sender.tab?.id) return { error: 'No tab ID' };
      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId: sender.tab.id },
          world: 'MAIN',
          func: (elId: string, handlerName: string, isKey: boolean, keyVal: string) => {
            const targetEl = document.getElementById(elId);
            if (!targetEl) return { found: false, success: false, error: 'Element not found by ID' };
            
            let current: HTMLElement | null = targetEl;
            let foundProps = null;
            let keysDump = '';

            for (let depth = 0; depth < 10 && current; depth++) {
              let props: any = null;
              try {
                const keys = Object.getOwnPropertyNames(current);
                const propsKey = keys.find(k => k.startsWith('__reactProps$') || k.startsWith('__reactEventHandlers$'));
                if (propsKey) {
                  props = (current as any)[propsKey];
                } else {
                  const fiberKey = keys.find(k => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'));
                  if (fiberKey) {
                    const fiber = (current as any)[fiberKey];
                    props = fiber ? (fiber.memoizedProps || fiber.pendingProps) : null;
                  }
                }
                
                if (!props && depth === 0) {
                  keysDump = keys.join(',').substring(0, 500);
                }

                if (props && typeof props[handlerName] === 'function') {
                  foundProps = props;
                  break;
                }
              } catch(e) {}
              current = current.parentElement;
            }

            if (!foundProps) {
              return { found: false, success: false, error: 'No React props found. Keys: ' + keysDump };
            }

            try {
              // Helper: wrap a real event in a Proxy so .isTrusted returns true.
              // This passes instanceof checks AND spoofs the trusted flag.
              function trustedProxy<T extends Event>(evt: T): T {
                return new Proxy(evt, {
                  get(target, prop, receiver) {
                    if (prop === 'isTrusted') return true;
                    const value = Reflect.get(target, prop, receiver);
                    return typeof value === 'function' ? value.bind(target) : value;
                  }
                }) as T;
              }

              if (isKey) {
                const rawNative = new KeyboardEvent('keydown', {
                  key: keyVal, code: keyVal === 'Enter' ? 'Enter' : keyVal,
                  keyCode: 13, bubbles: true, cancelable: true,
                });
                const fakeEvent = {
                  type: 'keydown',
                  isTrusted: true,
                  key: keyVal,
                  code: keyVal === 'Enter' ? 'Enter' : keyVal,
                  keyCode: keyVal === 'Enter' ? 13 : 0,
                  which: keyVal === 'Enter' ? 13 : 0,
                  charCode: 0,
                  target: targetEl, currentTarget: current,
                  ctrlKey: false, metaKey: false, shiftKey: false, altKey: false,
                  repeat: false, isComposing: false, bubbles: true, cancelable: true,
                  nativeEvent: trustedProxy(rawNative),
                  preventDefault: () => { }, stopPropagation: () => { },
                  isPropagationStopped: () => false, isDefaultPrevented: () => false,
                  persist: () => { },
                };
                foundProps[handlerName](fakeEvent);
              } else {
                const rect = targetEl.getBoundingClientRect();
                const x = rect.left + rect.width / 2;
                const y = rect.top + rect.height / 2;
                const rawNative = new MouseEvent(
                  handlerName.replace(/^on/, '').toLowerCase(),
                  { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, detail: 1 },
                );
                const fakeEvent = {
                  type: handlerName.replace(/^on/, '').toLowerCase(),
                  isTrusted: true,
                  target: targetEl, currentTarget: current,
                  clientX: x, clientY: y, screenX: x, screenY: y,
                  pageX: x + window.scrollX, pageY: y + window.scrollY,
                  button: 0, buttons: 1, detail: 1,
                  ctrlKey: false, metaKey: false, shiftKey: false, altKey: false,
                  isPrimary: true, pointerId: 1, pointerType: 'mouse', bubbles: true, cancelable: true,
                  nativeEvent: trustedProxy(rawNative),
                  preventDefault: () => { }, stopPropagation: () => { },
                  isPropagationStopped: () => false, isDefaultPrevented: () => false,
                  persist: () => { },
                };
                foundProps[handlerName](fakeEvent);
              }
              return { found: true, success: true };
            } catch (e: any) {
              return { found: true, success: false, error: String(e) };
            }
          },
          args: [msg.payload.elId, msg.payload.handlerName, msg.payload.isKey, msg.payload.keyVal]
        });
        return results && results[0] ? results[0].result : { error: 'No result from script execution' };
      } catch (err: any) {
        return { found: false, success: false, error: err.message };
      }
    }

    case 'MAIN_WORLD_PASTE': {
      if (!sender.tab?.id) return { error: 'No tab ID' };
      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId: sender.tab.id },
          world: 'MAIN',
          func: (elId: string, text: string) => {
            const el = document.getElementById(elId);
            if (!el) return { success: false, error: 'Element not found' };

            el.focus();

            // Select all existing content
            const selection = window.getSelection();
            if (selection) {
              const range = document.createRange();
              range.selectNodeContents(el);
              selection.removeAllRanges();
              selection.addRange(range);
            }

            // Create DataTransfer in MAIN world — this is key!
            // Slate can only read clipboard data from events created in the same world.
            const dt = new DataTransfer();
            dt.setData('text/plain', text);

            // Dispatch beforeinput (Slate processes this)
            el.dispatchEvent(new InputEvent('beforeinput', {
              bubbles: true,
              cancelable: true,
              inputType: 'insertFromPaste',
              dataTransfer: dt,
            } as InputEventInit));

            // Dispatch paste event (Slate's onPaste handler)
            el.dispatchEvent(new ClipboardEvent('paste', {
              bubbles: true,
              cancelable: true,
              clipboardData: dt,
            }));

            // Fallback: standard input event
            el.dispatchEvent(new Event('input', { bubbles: true }));

            return { success: true, text: el.textContent?.substring(0, 50) };
          },
          args: [msg.payload.elId, msg.payload.text]
        });
        return results && results[0] ? results[0].result : { error: 'No result' };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    }



    case 'PING':
      return { type: 'PONG' };

    case 'FOCUS_FLOW_TAB': {
      const flowTabs = await chrome.tabs.query({
        url: ['https://labs.google/flow*', 'https://labs.google/fx*'],
      });
      if (flowTabs.length > 0 && flowTabs[0].id) {
        await chrome.tabs.update(flowTabs[0].id, { active: true });
        if (flowTabs[0].windowId) {
          await chrome.windows.update(flowTabs[0].windowId, { focused: true });
        }
      }
      return { success: true };
    }

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

    case 'SUPPRESS_DOWNLOADS':
      suppressDownloads = true;
      // Auto-expire after 60 seconds max (safety net)
      if (suppressTimeout) clearTimeout(suppressTimeout);
      suppressTimeout = setTimeout(() => { suppressDownloads = false; }, 60 * 1000);
      console.log('[AutoFlow] Download suppression ON (upscale-only mode)');
      return { success: true };

    case 'UNSUPPRESS_DOWNLOADS':
      suppressDownloads = false;
      if (suppressTimeout) { clearTimeout(suppressTimeout); suppressTimeout = null; }
      console.log('[AutoFlow] Download suppression OFF');
      return { success: true };

    case 'FAILED_TILES_RESULT':
      broadcastToExtension(msg);
      return {};

    case 'QUEUE_SUMMARY':
      broadcastToExtension(msg);
      return {};

    case 'AUTO_SCAN_LIBRARY':
      broadcastToExtension(msg);
      return {};

    case 'SET_DOWNLOAD_RENAME':
      queueDownloadRename(msg.payload.filename);
      return { success: true };

    default:
      return { error: 'Unknown message type' };
  }
}

// Track download IDs initiated by our extension — these already have proper filenames
const ourDownloadIds = new Set<number>();

// Download suppression for upscale-only operations
let suppressDownloads = false;
let suppressTimeout: ReturnType<typeof setTimeout> | null = null;

// ── Download handler ──
// Downloads the file directly. Filename renaming is handled by the
// onDeterminingFilename listener + queueDownloadRename() mechanism.
async function handleDownload(payload: {
  url: string;
  filename: string;
  conflictAction?: string;
}): Promise<{ downloadId?: number; error?: string }> {
  try {
    console.log(`[AutoFlow] Downloading: ${payload.filename} from ${payload.url.slice(0, 80)}...`);

    // Queue the rename BEFORE starting the download, so onDeterminingFilename picks it up
    queueDownloadRename(payload.filename);

    const downloadId = await chrome.downloads.download({
      url: payload.url,
      filename: payload.filename,
      conflictAction: (payload.conflictAction as any) || 'uniquify',
      saveAs: false,
    });

    // Track this ID so onDeterminingFilename knows this is ours
    ourDownloadIds.add(downloadId);
    setTimeout(() => ourDownloadIds.delete(downloadId), 60_000);

    console.log(`[AutoFlow] Download started: ID=${downloadId}, file=${payload.filename}`);
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
let _startingQueue = false; // Prevent concurrent startQueueInTab calls
async function startQueueInTab(payload: { queueId: string; tabId?: number }): Promise<any> {
  // Guard: prevent duplicate starts
  if (_startingQueue) {
    console.warn('[AutoFlow BG] Ignoring duplicate START_QUEUE — already starting');
    return { success: true, deduplicated: true };
  }
  _startingQueue = true;

  try {
    const queue = await getQueueById(payload.queueId);
    if (!queue) { _startingQueue = false; return { error: 'Queue not found' }; }

  let tabId: number | undefined;

  if (payload.tabId) {
    // Verify the tab is actually a Google Flow tab before using it
    try {
      const tab = await chrome.tabs.get(payload.tabId);
      if (tab.url && (tab.url.startsWith('https://labs.google/flow') || tab.url.startsWith('https://labs.google/fx'))) {
        tabId = payload.tabId;
        await chrome.tabs.update(tabId, { active: true });
      }
    } catch { /* ignore */ }
  }

  if (!tabId) {
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
        await chrome.tabs.create({ url: 'https://labs.google/flow' });
        return { error: 'Opening Google Flow — wait a few seconds for it to load, then hit Run again!' };
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
  } finally {
    // Release lock after a short delay to prevent rapid re-entry
    setTimeout(() => { _startingQueue = false; }, 2000);
  }
}

// ── Image blob handler: read directly from IndexedDB (shared storage) ──
// No longer relays through the sidepanel — reads blobs directly, which
// prevents failures when the sidepanel connection dies during long runs.
async function handleImageBlobRequest(payload: { imageIds: string[] }): Promise<any> {
  try {
    const files: Array<{ id: string; filename: string; mime: string; data: string }> = [];
    for (const id of payload.imageIds) {
      const blob = await getImageBlob(id);
      if (blob) {
        const base64 = await blobToBase64(blob);
        const mime = blob.type || 'image/png';
        files.push({ id, filename: `image_${id}.${mime.includes('png') ? 'png' : 'jpg'}`, mime, data: base64 });
      } else {
        console.warn(`[AutoFlow] Image blob not found in IndexedDB: ${id}`);
      }
    }
    return { files };
  } catch (err: any) {
    console.error(`[AutoFlow] Failed to read image blobs from IndexedDB: ${err.message}`);
    return { error: `Could not retrieve image blobs: ${err.message}`, files: [] };
  }
}

/** Convert a Blob to base64 string — service-worker compatible (no FileReader) */
async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
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
      await chrome.tabs.create({ url: 'https://labs.google/flow' });
      return { error: 'Google Flow opened in a new tab! Wait for it to load, then try again.' };
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
let _broadcasting = false;
function broadcastToExtension(msg: Message) {
  _broadcasting = true;
  chrome.runtime.sendMessage(msg).catch(() => {
    // No listener available, that's OK
  }).finally(() => { _broadcasting = false; });
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
    // For downloads initiated by our extension, consume the pending rename
    // and apply it via suggest(). We can't rely on chrome.downloads.download's
    // filename param alone — Content-Disposition from Google's servers overrides it.
    if (ourDownloadIds.has(downloadItem.id)) {
      ourDownloadIds.delete(downloadItem.id);
      // Clean expired entries
      const now = Date.now();
      while (pendingRenames.length > 0 && now - pendingRenames[0].createdAt > 120000) {
        pendingRenames.shift();
      }
      if (pendingRenames.length > 0) {
        const rename = pendingRenames.shift()!;
        console.log(`[AutoFlow] Renaming our download to: ${rename.filename}`);
        suggest({ filename: rename.filename, conflictAction: 'uniquify' });
        return;
      }
      // No pending rename — let Chrome use what we passed
      suggest();
      return;
    }

    // Clean expired entries (older than 120 seconds)
    const now = Date.now();
    while (pendingRenames.length > 0 && now - pendingRenames[0].createdAt > 120000) {
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

    // No rename needed — pass through unchanged
    suggest({ filename: downloadItem.filename, conflictAction: 'uniquify' });
  }
);

// ── Suppress downloads during upscale-only operations ──
// When suppressDownloads is true, cancel any download from Google domains
chrome.downloads.onCreated.addListener((downloadItem) => {
  if (!suppressDownloads) return;
  const url = downloadItem.url || '';
  if (url.includes('labs.google') || url.includes('googleapis.com') || url.includes('googleusercontent.com')) {
    console.log(`[AutoFlow] Suppressed download (upscale-only): ${url.slice(0, 80)}...`);
    chrome.downloads.cancel(downloadItem.id);
    // Also remove the file that may have been partially created
    chrome.downloads.erase({ id: downloadItem.id });
  }
});

// ── Listen for download completion to detect "Ask where to save" issues ──
chrome.downloads.onChanged.addListener((delta) => {
  if (delta.error) {
    logEntry('error', `Download error: ${JSON.stringify(delta.error)}`);
  }
});
