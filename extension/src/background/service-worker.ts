/* ============================================================
   AutoFlow – Background Service Worker (MV3)
   Handles: downloads, storage messaging, queue orchestration,
   keepalive & anti-throttle for background execution.
   ============================================================ */

// ── Side panel setup — open on icon click ──
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

// ── Open changelog when extension updates ──
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'update') {
    const version = chrome.runtime.getManifest().version;
    chrome.tabs.create({
      url: `https://www.auto-flow.studio/changelog?v=${version}`,
      active: false, // open in background so it doesn't interrupt the user
    });
  }
});

import { Message, QueueObject, LogEntry, ScheduledChain } from '../types';
import {
  getAllQueues,
  updateQueue,
  getActiveQueueId,
  setActiveQueueId,
  appendLog,
  getQueueById,
  getImageBlob,
  getSettings,
  addScheduledChain,
  updateScheduledChain,
  removeScheduledChain,
  getActiveChain,
  getChainByAlarm,
  getChainById,
} from '../shared/storage';
import { consumeDownload } from '../shared/api';

// ================================================================
// OFFSCREEN DOCUMENT — Keeps SW alive during long operations
// ================================================================
// Chrome MV3 kills the service worker after ~30s of inactivity.
// An offscreen document sends periodic pings to keep the SW alive
// while we fire scheduled chains (which open tabs, inject scripts, etc).

const OFFSCREEN_URL = 'offscreen.html';

async function ensureOffscreen(): Promise<void> {
  // Check if offscreen doc already exists
  const contexts = await (chrome as any).runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
  }).catch(() => []);

  if (contexts && contexts.length > 0) {
    console.log('[AutoFlow] Offscreen doc already exists');
    return;
  }

  try {
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_URL,
      reasons: [chrome.offscreen.Reason.BLOBS as any],
      justification: 'Keep service worker alive during chain scheduling',
    });
    console.log('[AutoFlow] ✅ Offscreen document created');
  } catch (err) {
    console.error('[AutoFlow] ❌ Failed to create offscreen document:', err);
  }
}

async function closeOffscreen(): Promise<void> {
  try {
    await chrome.offscreen.closeDocument();
    console.log('[AutoFlow] Offscreen document closed');
  } catch {
    // Already closed or never opened — ignore
  }
}

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

  // ── Scheduled chain alarm ──
  if (alarm.name.startsWith('af-chain-')) {
    console.log(`[AutoFlow] 🔔 ALARM FIRED: ${alarm.name} at ${new Date().toLocaleString()}`);
    await fireScheduledChain(alarm.name);
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

    case 'QUEUE_PHASE_UPDATE':
      // Forward phase updates directly to sidepanel
      broadcastToExtension({ type: 'QUEUE_PHASE_UPDATE', payload: msg.payload });
      return;

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



    case 'INSTALL_NETWORK_SNIFFER': {
      if (!sender.tab?.id) return { error: 'No tab ID' };
      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId: sender.tab.id },
          world: 'MAIN',
          func: () => {
            // Guard: don't install twice
            if ((window as any).__af_interceptor_installed) {
              return { success: true, alreadyInstalled: true };
            }
            (window as any).__af_interceptor_installed = true;

            // ── Key endpoints we piggyback on ──
            const STATUS_CHECK = 'batchCheckAsyncVideoGenerationStatus';
            const GENERATE = 'batchAsyncGenerateVideoText';

            /** Post data to content script (local message, zero network traffic) */
            function relay(type: string, payload: any): void {
              window.postMessage({ source: 'autoflow-api-interceptor', type, payload }, '*');
            }

            // ── Stealth patch of window.fetch ──
            // We intercept ONLY the two endpoints we need. All other calls
            // pass through with zero overhead (no cloning, no body reading).
            const _origFetch = window.fetch;
            const _origToString = _origFetch.toString.bind(_origFetch);

            // Store the last status check URL + request init for active calls
            let _lastStatusUrl = '';
            let _lastStatusInit: any = null;

            const patchedFetch = async function (this: any, ...args: any[]) {
              const url = typeof args[0] === 'string'
                ? args[0]
                : (args[0] as Request)?.url || '';

              // Capture status check request info for active re-use
              if (url.includes(STATUS_CHECK)) {
                _lastStatusUrl = url;
                // Clone the init object (headers, body, method) for later replay
                const init = args[1] as RequestInit | undefined;
                if (init) {
                  _lastStatusInit = {
                    method: init.method || 'POST',
                    headers: init.headers ? JSON.parse(JSON.stringify(init.headers)) : undefined,
                    body: init.body,
                  };
                }
              }

              const response = await _origFetch.apply(
                this, args as [RequestInfo | URL, RequestInit?]
              );

              // Only intercept our two target endpoints — everything else untouched
              const isStatus = url.includes(STATUS_CHECK);
              const isGenerate = url.includes(GENERATE);

              if ((isStatus || isGenerate) && response.ok) {
                // Clone and read asynchronously — doesn't block the original response
                response.clone().json().then((data: any) => {
                  if (isGenerate && data && Array.isArray(data.media) && _lastStatusInit && _lastStatusInit.body) {
                    try {
                      const newIds = data.media.map((m: any) => m.name).filter(Boolean);
                      if (newIds.length > 0) {
                        const parsed = JSON.parse(_lastStatusInit.body);
                        
                        const appendToStringArrays = (obj: any): boolean => {
                          let changed = false;
                          if (!obj || typeof obj !== 'object') return false;
                          for (const key of Object.keys(obj)) {
                            const val = obj[key];
                            if (Array.isArray(val)) {
                              if (val.length === 0 || typeof val[0] === 'string') {
                                const unique = new Set([...val, ...newIds]);
                                obj[key] = Array.from(unique);
                                changed = true;
                              }
                            } else if (typeof val === 'object' && val !== null) {
                              if (appendToStringArrays(val)) {
                                changed = true;
                              }
                            }
                          }
                          return changed;
                        };

                        if (appendToStringArrays(parsed)) {
                          _lastStatusInit.body = JSON.stringify(parsed);
                        }
                      }
                    } catch (e) {
                      // ignore parse/JSON errors
                    }
                  }
                  relay(isStatus ? 'STATUS_UPDATE' : 'GENERATION_SUBMITTED', data);
                }).catch(() => { /* response wasn't JSON — ignore */ });
              }

              return response;
            };

            // ── Active status check: allows content script to trigger a fresh poll ──
            // This makes the SAME call Flow makes, using the captured URL + auth.
            // The response flows through the interceptor → updates the cache automatically.
            (window as any).__af_activeCheck = async function (mediaIds?: string[]): Promise<boolean> {
              if (!_lastStatusUrl || !_lastStatusInit) return false;
              try {
                let init = _lastStatusInit;
                if (mediaIds && mediaIds.length > 0 && _lastStatusInit.body) {
                  try {
                    const parsed = JSON.parse(_lastStatusInit.body);
                    
                    const replaceStringArrays = (obj: any): boolean => {
                      let changed = false;
                      if (!obj || typeof obj !== 'object') return false;
                      for (const key of Object.keys(obj)) {
                        const val = obj[key];
                        if (Array.isArray(val)) {
                          if (val.length === 0 || typeof val[0] === 'string') {
                            obj[key] = mediaIds;
                            changed = true;
                          }
                        } else if (typeof val === 'object' && val !== null) {
                          if (replaceStringArrays(val)) {
                            changed = true;
                          }
                        }
                      }
                      return changed;
                    };

                    if (replaceStringArrays(parsed)) {
                      init = {
                        ..._lastStatusInit,
                        body: JSON.stringify(parsed)
                      };
                    }
                  } catch (e) {
                    // fallback to original body
                  }
                }
                await patchedFetch(_lastStatusUrl, init);
                return true; // Cache was refreshed via the interceptor relay
              } catch {
                return false;
              }
            };

            // Make our patched fetch look identical to the original
            // Prevents detection via fetch.toString() or typeof checks
            patchedFetch.toString = _origToString;
            Object.defineProperty(patchedFetch, 'name', { value: 'fetch' });
            Object.defineProperty(patchedFetch, 'length', { value: _origFetch.length });

            (window as any).fetch = patchedFetch;

            return { success: true };
          },
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

    case 'STOP_QUEUE':
      // Forward to content script (if engine exists, it will stop)
      forwardToContentScript(msg).catch(() => {});
      // ALSO force-stop from background: mark active queue as stopped
      // This ensures the sidepanel clears even if the content script
      // has no engine (e.g. after page reload)
      {
        const activeQueueId = await getActiveQueueId();
        if (activeQueueId) {
          await handleQueueStatusUpdate({ queueId: activeQueueId, status: 'stopped' });
          await setActiveQueueId(null);
        }
        await stopKeepalive();
      }
      return { success: true };

    case 'PAUSE_QUEUE':
    case 'RESUME_QUEUE':
    case 'SKIP_CURRENT':
    case 'RETRY_FAILED':
    case 'REPROMPT_RESPONSE':
    case 'BATCH_REPROMPT_RESPONSE':
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

    case 'REPROMPT_NEEDED':
    case 'BATCH_REPROMPT_NEEDED':
    case 'FAKE_CANCEL_ALERT':
      broadcastToExtension(msg);
      return {};

    case 'VERIFY_MEDIA_URL': {
      // Check if a media URL is actually downloadable
      // Uses redirect: 'manual' to avoid CORS errors — Google's CDN
      // (flow-content.google) blocks cross-origin requests from extensions.
      // A 302/307 redirect means the URL is valid (Google gave us a CDN link).
      const verifyUrl = msg.payload?.url;
      if (!verifyUrl) return { valid: false };
      try {
        const resp = await fetch(verifyUrl, {
          method: 'HEAD',
          redirect: 'manual',  // Don't follow redirect — just check if we get one
          credentials: 'include',
        });
        // Valid if:
        // 1. Redirect response (302/307/308) — means Google gave us a valid CDN URL
        // 2. Direct 200 with media content type
        if (resp.type === 'opaqueredirect' || (resp.status >= 300 && resp.status < 400)) {
          console.log(`[AutoFlow] URL verify: redirect detected → valid ✅`);
          return { valid: true };
        }
        if (resp.ok) {
          const ct = resp.headers.get('content-type') || '';
          const valid = ct.includes('video') ||
            ct.includes('image') ||
            ct.includes('octet-stream') ||
            ct.includes('mp4') ||
            ct.includes('webm') ||
            ct.includes('png') ||
            ct.includes('jpeg') ||
            ct.includes('webp') ||
            ct.includes('application/');
          console.log(`[AutoFlow] URL verify: ${resp.status} ct=${ct} valid=${valid}`);
          return { valid };
        }
        console.log(`[AutoFlow] URL verify: ${resp.status} → invalid`);
        return { valid: false };
      } catch (err: any) {
        console.warn(`[AutoFlow] URL verify failed:`, err.message);
        // CORS error on redirect still means the URL exists — fail-open
        if (err.message?.includes('CORS') || err.message?.includes('opaque')) {
          console.log(`[AutoFlow] URL verify: CORS error but URL likely valid → assuming valid`);
          return { valid: true };
        }
        return { valid: false };
      }
    }

    case 'BATCH_API_DOWNLOAD': {
      // Direct API download — no DOM, no context menu, no library scan
      // URL pattern: /fx/api/trpc/media.getMediaUrlRedirect?name={mediaId}
      const items: Array<{ mediaId: string; filename: string }> = msg.payload?.items || [];
      const queueName = msg.payload?.queueName || 'AutoFlow_download';
      const results: string[] = [];
      const errors: string[] = [];
      const total = items.length;

      console.log(`[AutoFlow] API Download: starting ${total} file(s)...`);

      // Track download count in backend (same as library scan does)
      try {
        const dlQuota = await consumeDownload(total);
        console.log(`[AutoFlow] Download quota: ${dlQuota.remaining} remaining (allowed: ${dlQuota.allowed})`);
      } catch (e: any) {
        console.warn('[AutoFlow] consumeDownload failed (proceeding anyway):', e.message);
      }

      // Broadcast initial state — all files pending
      broadcastToExtension({
        type: 'DOWNLOAD_PROGRESS',
        payload: { items: items.map(i => ({ filename: i.filename, status: 'pending' })), current: 0, total },
      });

      for (let idx = 0; idx < items.length; idx++) {
        const item = items[idx];

        // Broadcast: this file is now downloading
        broadcastToExtension({
          type: 'DOWNLOAD_PROGRESS',
          payload: { items: items.map((it, i) => ({
            filename: it.filename,
            status: i < idx ? 'done' : i === idx ? 'downloading' : 'pending',
          })), current: idx + 1, total },
        });

        try {
          const url = `https://labs.google/fx/api/trpc/media.getMediaUrlRedirect?name=${item.mediaId}`;
          const filename = `AutoFlow/${queueName}/${item.filename}`;

          queueDownloadRename(filename);

          const downloadId = await chrome.downloads.download({
            url,
            filename,
            conflictAction: 'uniquify',
            saveAs: false,
          });

          ourDownloadIds.add(downloadId);
          setTimeout(() => ourDownloadIds.delete(downloadId), 60_000);

          results.push(item.filename);
          console.log(`[AutoFlow] API Download queued: ${item.filename}`);
        } catch (err: any) {
          console.error(`[AutoFlow] API Download failed: ${item.filename}`, err);
          errors.push(`${item.filename}: ${err.message}`);
        }
        await sleep(500);
      }

      // Broadcast final state — all done
      broadcastToExtension({
        type: 'DOWNLOAD_PROGRESS',
        payload: { items: items.map(i => ({
          filename: i.filename,
          status: results.includes(i.filename) ? 'done' : 'error',
        })), current: total, total, complete: true },
      });

      console.log(`[AutoFlow] API Download complete: ${results.length} ok, ${errors.length} failed`);
      return { downloaded: results, errors };
    }

    case 'SET_DOWNLOAD_RENAME':
      queueDownloadRename(msg.payload.filename);
      return { success: true };

    case 'PLAY_NOTIFICATION_SOUND':
      // Acknowledged — sound is played by the sidepanel, not the SW
      return {};

    case 'SCHEDULE_CHAIN':
      return handleScheduleChain(msg.payload);

    case 'KEEPALIVE_PING':
      // Offscreen doc ping — just acknowledge (resets SW idle timer)
      return;

    case 'CANCEL_CHAIN':
      return handleCancelChain(msg.payload);

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

      // ── Chain hook: check if this queue is part of a chain ──
      const chainAdvanced = await advanceChainIfNeeded(queue);

      // Only send individual notification if NOT part of a chain
      // (chain sends its own summary notification at the end)
      if (!chainAdvanced) {
        await sendQueueNotification(queue);
      }
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

// ================================================================
// SCHEDULED CHAINS — Smart Queue Playlist System
// ================================================================

/** Handle SCHEDULE_CHAIN message from sidepanel */
async function handleScheduleChain(payload: { queueIds: string[]; scheduledAt: number; waitBetweenSec?: number }): Promise<any> {
  const { queueIds, scheduledAt, waitBetweenSec = 60 } = payload;

  if (!queueIds || queueIds.length === 0) return { error: 'No queues selected' };

  // Validate all queues exist
  const queueNames: string[] = [];
  for (const qid of queueIds) {
    const q = await getQueueById(qid);
    if (!q) return { error: `Queue not found: ${qid}` };
    queueNames.push(q.name);
  }

  // Create chain
  const chainId = crypto.randomUUID ? crypto.randomUUID() : `chain-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const chain: ScheduledChain = {
    id: chainId,
    queueIds,
    currentIndex: 0,
    scheduledAt,
    waitBetweenSec,
    status: 'scheduled',
    results: queueIds.map((qid, i) => ({
      queueId: qid,
      queueName: queueNames[i],
      status: 'pending' as const,
      promptsDone: 0,
      promptsFailed: 0,
      promptsTotal: 0,
    })),
  };

  // Save chain and set alarm
  await addScheduledChain(chain);

  // Mark each queue with chainId
  for (const qid of queueIds) {
    const q = await getQueueById(qid);
    if (q) {
      q.chainId = chainId;
      q.scheduleStatus = 'scheduled';
      q.scheduledAt = scheduledAt;
      q.updatedAt = Date.now();
      await updateQueue(q);
    }
  }

  const alarmName = `af-chain-${chainId}`;
  const delayMs = scheduledAt - Date.now();

  console.log(`[AutoFlow] Chain ${chainId} scheduled: ${queueNames.join(' \u2192 ')}, delay: ${Math.round(delayMs/1000)}s`);

  broadcastToExtension({ type: 'CHAIN_PROGRESS', payload: chain });

  if (delayMs < 30_000) {
    // ── IMMEDIATE: Use offscreen doc to keep SW alive while firing ──
    await logEntry('info', `Chain firing NOW (offscreen keepalive)...`);
    await ensureOffscreen(); // Start keepalive heartbeat
    try {
      await fireScheduledChain(alarmName);
    } finally {
      await closeOffscreen(); // Clean up
    }
    return { success: true, chainId, scheduledAt };
  } else {
    // ── FUTURE: Use chrome.alarms for reliable wake-up ──
    await chrome.alarms.create(alarmName, { when: scheduledAt });
    await logEntry('info', `Alarm set for ${new Date(scheduledAt).toLocaleString()}`);
    return { success: true, chainId, scheduledAt };
  }
}

/** Handle CANCEL_CHAIN message from sidepanel */
async function handleCancelChain(payload: { chainId: string }): Promise<any> {
  const chain = await getChainById(payload.chainId);
  if (!chain) return { error: 'Chain not found' };

  // Clear alarm
  chrome.alarms.clear(`af-chain-${chain.id}`);

  // Reset queues
  for (const qid of chain.queueIds) {
    const q = await getQueueById(qid);
    if (q) {
      q.chainId = undefined;
      q.scheduledAt = undefined;
      q.scheduleStatus = 'cancelled';
      q.updatedAt = Date.now();
      await updateQueue(q);
    }
  }

  // Remove chain
  chain.status = 'cancelled';
  await updateScheduledChain(chain);
  await removeScheduledChain(chain.id);

  await logEntry('info', `Chain cancelled: ${chain.id}`);
  broadcastToExtension({ type: 'CHAIN_PROGRESS', payload: chain });
  return { success: true };
}

/** Ensure we have a Flow tab ready, returns tabId */
async function ensureFlowTab(): Promise<number> {
  // Try existing Flow tab first
  const flowTabs = await chrome.tabs.query({
    url: ['https://labs.google/flow*', 'https://labs.google/fx*'],
  });

  if (flowTabs.length > 0 && flowTabs[0].id) {
    const tabId = flowTabs[0].id;
    // Navigate to Flow homepage for a fresh project
    await chrome.tabs.update(tabId, { active: true, url: 'https://labs.google/fx/tools/flow' });
    // Wait for navigation to complete
    await waitForTabLoad(tabId, 30_000);
    await sleep(3000); // Wait for React app
    return tabId;
  }

  // Create new tab
  const newTab = await chrome.tabs.create({ url: 'https://labs.google/fx/tools/flow', active: true });
  const tabId = newTab.id!;
  await waitForTabLoad(tabId, 30_000);
  await sleep(5000); // Extra wait for first load
  return tabId;
}

/** Wait for a tab to finish loading */
function waitForTabLoad(tabId: number, timeoutMs: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const listener = (tid: number, changeInfo: chrome.tabs.TabChangeInfo) => {
      if (tid === tabId && changeInfo.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
    setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }, timeoutMs);
  });
}

/** Start a specific queue in the chain on the given tab */
async function startChainQueue(queue: QueueObject, tabId: number, chain: ScheduledChain): Promise<void> {
  // Force Full mode + New Project for chain queues
  (queue.settings as any).automationMode = 'full';
  queue.runTarget = 'newProject';
  queue.status = 'running';
  queue.scheduleStatus = 'firing';
  queue.updatedAt = Date.now();
  await updateQueue(queue);
  await setActiveQueueId(queue.id);

  // Open side panel
  try { await chrome.sidePanel.open({ tabId }); } catch { /* already open */ }

  // Start keepalive
  await startKeepalive(tabId);

  // Inject content script and start queue
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'START_QUEUE', payload: { queue } });
  } catch {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    await sleep(2000);
    await chrome.tabs.sendMessage(tabId, { type: 'START_QUEUE', payload: { queue } });
  }

  broadcastToExtension({ type: 'QUEUE_STATUS_UPDATE', payload: queue });
  broadcastToExtension({ type: 'CHAIN_PROGRESS', payload: chain });
}

/** Fire a scheduled chain when its alarm goes off */
async function fireScheduledChain(alarmName: string): Promise<void> {
  console.log(`[AutoFlow] \u23f0 Chain alarm fired: ${alarmName}`);

  const chain = await getChainByAlarm(alarmName);
  if (!chain || chain.status !== 'scheduled') {
    console.warn(`[AutoFlow] No valid chain for alarm: ${alarmName}`);
    return;
  }

  // Check if another queue is already running
  const activeQueueId = await getActiveQueueId();
  if (activeQueueId) {
    // Verify the active queue is ACTUALLY running (not stale)
    const activeQ = await getQueueById(activeQueueId);
    if (activeQ && activeQ.status === 'running') {
      await logEntry('warn', `Chain cannot start — queue "${activeQ.name}" is still running.`);
      chain.status = 'failed';
      await updateScheduledChain(chain);
      try {
        chrome.notifications.create(`af-chain-conflict-${chain.id}`, {
          type: 'basic',
          iconUrl: 'icons/icon128.png',
          title: 'AutoFlow — Chain Skipped',
          message: `Scheduled chain could not start because "${activeQ.name}" is still running.`,
        });
      } catch { /* */ }
      return;
    } else {
      // Stale activeQueueId — clear it
      await logEntry('info', `Clearing stale activeQueueId: ${activeQueueId}`);
      await setActiveQueueId('');
    }
  }

  // Start the chain!
  chain.status = 'running';
  chain.startedAt = Date.now();
  chain.currentIndex = 0;
  await updateScheduledChain(chain);

  await logEntry('info', `\u23f0 Chain started! ${chain.queueIds.length} queues to run.`);

  // Get the first queue
  const firstQueueId = chain.queueIds[0];
  const firstQueue = await getQueueById(firstQueueId);
  if (!firstQueue) {
    chain.status = 'failed';
    await updateScheduledChain(chain);
    return;
  }

  // Populate result totals
  for (const result of chain.results) {
    const q = await getQueueById(result.queueId);
    if (q) result.promptsTotal = q.prompts.length;
  }
  await updateScheduledChain(chain);

  // Get/open Flow tab and start first queue
  const tabId = await ensureFlowTab();
  chain.results[0].status = 'pending';
  chain.results[0].startedAt = Date.now();
  await updateScheduledChain(chain);

  await startChainQueue(firstQueue, tabId, chain);

  try {
    chrome.notifications.create(`af-chain-started-${chain.id}`, {
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: 'AutoFlow \u2014 Chain Started',
      message: `Running ${chain.queueIds.length} queues. First: "${firstQueue.name}"`,
    });
  } catch { /* */ }
}

/**
 * Called when a queue completes — checks if it's part of a chain and advances.
 * Returns true if a chain was advanced (so caller knows not to send individual notification).
 */
async function advanceChainIfNeeded(completedQueue: QueueObject): Promise<boolean> {
  if (!completedQueue.chainId) return false;

  const chain = await getChainById(completedQueue.chainId);
  if (!chain || chain.status !== 'running') return false;

  const idx = chain.currentIndex;
  const result = chain.results[idx];
  if (!result) return false;

  // Update result for completed queue
  const doneCount = completedQueue.prompts.filter(p => p.status === 'done').length;
  const failedCount = completedQueue.prompts.filter(p => p.status === 'failed').length;
  result.promptsDone = doneCount;
  result.promptsFailed = failedCount;
  result.promptsTotal = completedQueue.prompts.length;
  result.completedAt = Date.now();
  result.status = completedQueue.status === 'completed' ? 'done' : 'failed';

  // Clear the active queue ID so the next one can start
  await setActiveQueueId(null);

  // Is there a next queue?
  const nextIdx = idx + 1;
  if (nextIdx < chain.queueIds.length) {
    // Advance chain
    chain.currentIndex = nextIdx;
    await updateScheduledChain(chain);

    await logEntry('info', `\u2705 Chain queue ${idx + 1}/${chain.queueIds.length} done. Starting next...`);
    broadcastToExtension({ type: 'CHAIN_PROGRESS', payload: chain });

    // Cooldown between queues (user-configurable)
    const waitMs = (chain.waitBetweenSec || 60) * 1000;
    await logEntry('info', `Waiting ${chain.waitBetweenSec || 60}s before next queue...`);
    await sleep(waitMs);

    // Get next queue
    const nextQueue = await getQueueById(chain.queueIds[nextIdx]);
    if (!nextQueue) {
      // Skip missing queue
      chain.results[nextIdx].status = 'skipped';
      await updateScheduledChain(chain);
      // Try the one after that
      return advanceChainIfNeeded({ ...completedQueue, chainId: chain.id } as any);
    }

    // Navigate Flow to homepage for fresh project
    chain.results[nextIdx].startedAt = Date.now();
    await updateScheduledChain(chain);

    const tabId = await ensureFlowTab();
    await startChainQueue(nextQueue, tabId, chain);
    return true;
  }

  // Chain complete!
  chain.status = 'completed';
  chain.completedAt = Date.now();
  await updateScheduledChain(chain);

  // Build summary
  const totalDone = chain.results.reduce((s, r) => s + r.promptsDone, 0);
  const totalFailed = chain.results.reduce((s, r) => s + r.promptsFailed, 0);
  const elapsed = chain.completedAt - (chain.startedAt || chain.scheduledAt);
  const mins = Math.round(elapsed / 60_000);

  await logEntry('info', `\u2705 Chain complete! ${chain.queueIds.length} queues, ${totalDone} done, ${totalFailed} failed, ${mins}min total.`);
  broadcastToExtension({ type: 'CHAIN_PROGRESS', payload: chain });

  // Summary notification
  try {
    chrome.notifications.create(`af-chain-done-${chain.id}`, {
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: 'AutoFlow \u2014 All Queues Complete! \ud83c\udf89',
      message: `${chain.queueIds.length} queues finished in ${mins}min. ${totalDone} prompts done, ${totalFailed} failed.`,
    });
  } catch { /* */ }

  return true;
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
// QUEUE COMPLETION NOTIFICATIONS
// ================================================================

/**
 * Show a Chrome notification when a queue finishes.
 * Reads the user's notification preference from storage.
 */
async function sendQueueNotification(queue: QueueObject) {
  try {
    // Check user preference
    const settings = await getSettings();
    if (settings.showNotifications === false) return; // opt-out

    const done = queue.prompts.filter(p => p.status === 'done').length;
    const failed = queue.prompts.filter(p => p.status === 'failed').length;
    const total = queue.prompts.length;
    const isComplete = queue.status === 'completed';

    const title = isComplete ? `\u2705 ${queue.name} Complete` : `\u26A0\uFE0F ${queue.name} Stopped`;
    const message = isComplete
      ? `${done}/${total} prompts succeeded${failed > 0 ? `, ${failed} failed` : ''}.`
      : `Stopped at ${done}/${total} completed${failed > 0 ? `, ${failed} failed` : ''}.`;

    const notifId = `af-queue-${queue.id}-${Date.now()}`;
    chrome.notifications.create(notifId, {
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title,
      message,
      priority: 2,
    });

    // If sound is enabled, tell the sidepanel to play it
    if (settings.notificationSound !== false) {
      broadcastToExtension({ type: 'PLAY_NOTIFICATION_SOUND' as any, payload: { status: queue.status } });
    }

    console.log(`[AutoFlow] Notification sent: ${title} — ${message}`);
  } catch (err) {
    console.warn('[AutoFlow] Failed to send notification:', err);
  }
}

// When user clicks a notification → focus the Flow tab and open sidepanel
chrome.notifications.onClicked.addListener(async (notifId) => {
  if (!notifId.startsWith('af-queue-')) return;

  // Focus or open a Flow tab
  const flowTabs = await chrome.tabs.query({
    url: ['https://labs.google/flow*', 'https://labs.google/fx*'],
  });

  let tabId: number | undefined;
  if (flowTabs.length > 0 && flowTabs[0].id) {
    tabId = flowTabs[0].id;
    await chrome.tabs.update(tabId, { active: true });
    if (flowTabs[0].windowId) {
      await chrome.windows.update(flowTabs[0].windowId, { focused: true });
    }
  } else {
    const tab = await chrome.tabs.create({ url: 'https://labs.google/flow' });
    tabId = tab.id;
  }

  // Open sidepanel on that tab
  if (tabId) {
    try {
      await chrome.sidePanel.open({ tabId });
    } catch { /* sidepanel may already be open */ }
  }

  // Clear the notification
  chrome.notifications.clear(notifId);
});

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
