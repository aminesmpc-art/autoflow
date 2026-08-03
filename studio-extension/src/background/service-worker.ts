/* ============================================================
   AutoFlow Studio — service worker

   Written fresh rather than copied. The AutoFlow service worker is 2,407
   lines, and almost all of it serves the sidepanel queue: download
   interception, upscale chains, scheduled runs, review rewards. Studio needs
   one job — carry messages between the Studio window and whichever platform
   tab a node targets — so copying that file would have imported a large
   surface with no purpose here and every reason to rot.
   ============================================================ */

type Platform = 'flow' | 'chatgpt' | 'grok';

/** The Studio window's long-lived port. Null whenever Studio is closed. */
let studioPort: chrome.runtime.Port | null = null;

/* ── Run state ──
   The canvas lives in a tab the user is usually not looking at: while a
   workflow runs they are watching Flow generate. The side panel is what they
   can see, so the worker keeps a snapshot of the run as messages pass through
   and hands it to the panel. Nothing here drives execution — it only observes.
*/
export interface RunSnapshot {
  studioOpen: boolean;
  running: boolean;
  paused: boolean;
  nodeLabel: string;
  progress: number;
  done: number;
  total: number;
  lastError: string;
  updatedAt: number;
}

const runState: RunSnapshot = {
  studioOpen: false,
  running: false,
  paused: false,
  nodeLabel: '',
  progress: 0,
  done: 0,
  total: 0,
  lastError: '',
  updatedAt: Date.now(),
};

function patchRunState(patch: Partial<RunSnapshot>): void {
  Object.assign(runState, patch, { updatedAt: Date.now() });
  // The panel may not be open; a failed send is normal and not an error.
  chrome.runtime.sendMessage({ type: 'PANEL_RUN_STATE', payload: runState }).catch(() => {});
}

/* ── Keepalive ──
   A video generation easily outlasts Chrome's idle timeout for a service
   worker. If the worker is recycled mid-run the port dies and the next node
   fails with "Lost connection". An alarm ticking under the idle threshold
   keeps it resident; autoDiscardable stops Chrome dropping the platform tab
   out from under a running generation. */
const KEEPALIVE_ALARM = 'studio-keepalive';
let keptTabId: number | null = null;

async function startKeepalive(tabId: number): Promise<void> {
  keptTabId = tabId;
  chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 0.4 });
  try {
    await chrome.tabs.update(tabId, { autoDiscardable: false });
  } catch { /* the tab may have gone; the alarm still matters */ }
}

async function stopKeepalive(): Promise<void> {
  chrome.alarms.clear(KEEPALIVE_ALARM).catch(() => {});
  if (keptTabId !== null) {
    try { await chrome.tabs.update(keptTabId, { autoDiscardable: true }); } catch { /* gone */ }
    keptTabId = null;
  }
}

chrome.alarms.onAlarm.addListener((alarm) => {
  // Touching an API is enough to reset the idle timer.
  if (alarm.name === KEEPALIVE_ALARM) chrome.runtime.getPlatformInfo().catch(() => {});
});

/* ── Platform tabs ── */

const PLATFORMS: Record<Platform, { match: string; open: string; script: string; name: string }> = {
  flow: {
    match: 'https://labs.google/*',
    open: 'https://labs.google/fx/tools/flow',
    script: 'flow-content.js',
    name: 'Google Flow',
  },
  chatgpt: {
    match: 'https://chatgpt.com/*',
    open: 'https://chatgpt.com/',
    script: 'chatgpt-content.js',
    name: 'ChatGPT',
  },
  grok: {
    match: 'https://grok.com/*',
    open: 'https://grok.com/imagine',
    script: 'grok-content.js',
    name: 'Grok',
  },
};

/** Reuse the user's existing tab if there is one; open it if not. */
async function ensurePlatformTab(platform: Platform): Promise<number | null> {
  const cfg = PLATFORMS[platform];
  try {
    const existing = await chrome.tabs.query({ url: cfg.match });
    if (existing.length && existing[0].id != null) return existing[0].id;

    // Flow: return to the project the user was last in, so generations land
    // where they expect rather than in a fresh untitled one.
    let url = cfg.open;
    if (platform === 'flow') {
      const stored = await chrome.storage.local.get('af_last_flow_project');
      if (stored?.af_last_flow_project) url = stored.af_last_flow_project;
    }

    const tab = await chrome.tabs.create({ url, active: false });
    // Give the page a moment to mount before anything is sent to it.
    await new Promise((r) => setTimeout(r, 3000));
    return tab.id ?? null;
  } catch {
    return null;
  }
}

function replyToStudio(msg: unknown): void {
  if (studioPort) {
    try { studioPort.postMessage(msg); } catch { /* Studio closed mid-flight */ }
  }
}

function nodeError(nodeId: unknown, error: string): void {
  replyToStudio({ type: 'STUDIO_NODE_ERROR', payload: { nodeId, error } });
}

/* ── Studio port ── */

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'studio') return;

  studioPort = port;
  patchRunState({ studioOpen: true });
  console.log('[Studio] connected');

  port.onMessage.addListener(async (msg: any) => {
    if (!msg?.type?.startsWith?.('STUDIO_')) return;

    // Studio reports its own run lifecycle so the panel can show it.
    if (msg.type === 'STUDIO_RUN_STATE') {
      patchRunState(msg.payload || {});
      return;
    }

    const platform: Platform = msg.payload?.config?.platform || 'flow';
    const cfg = PLATFORMS[platform] || PLATFORMS.flow;
    const tabId = await ensurePlatformTab(platform);

    if (!tabId) {
      nodeError(
        msg.payload?.nodeId,
        `Could not open a ${cfg.name} tab. Check the site is reachable and you are signed in.`
      );
      return;
    }

    // Only arm the keepalive for work that actually takes minutes.
    if (msg.type === 'STUDIO_EXECUTE_NODE') {
      startKeepalive(tabId).catch(() => { /* non-critical */ });
    }

    try {
      replyToStudio(await chrome.tabs.sendMessage(tabId, msg) || { type: 'STUDIO_ACK' });
    } catch (err: any) {
      // A tab open since before the extension loaded has no content script.
      if (!err?.message?.includes('Receiving end does not exist')) {
        nodeError(msg.payload?.nodeId, `${cfg.name} tab error: ${err.message}`);
        return;
      }
      try {
        await chrome.scripting.executeScript({ target: { tabId }, files: [cfg.script] });
        await new Promise((r) => setTimeout(r, 1500));
        replyToStudio(await chrome.tabs.sendMessage(tabId, msg) || { type: 'STUDIO_ACK' });
      } catch (retryErr: any) {
        nodeError(msg.payload?.nodeId, `${cfg.name} tab not reachable after injecting: ${retryErr.message}`);
      }
    }
  });

  port.onDisconnect.addListener(() => {
    studioPort = null;
    stopKeepalive().catch(() => {});
    // Closing the canvas ends the run as far as anyone can observe it.
    patchRunState({ studioOpen: false, running: false, paused: false, nodeLabel: '' });
    console.log('[Studio] disconnected');
  });
});

/**
 * Paste into a Slate editor from the MAIN world.
 *
 * Slate reads clipboard data only from events created in the same JavaScript
 * world, and a content script lives in the isolated one — so a DataTransfer
 * built there is invisible to it and the paste silently does nothing. The only
 * way in is to run the paste inside the page itself.
 *
 * This has to live in the worker because chrome.scripting is not available to
 * a content script. Missing it was why the prompt box stayed empty: the
 * content script asked, nothing answered, and slatePaste could not tell the
 * difference between "pasted" and "no handler".
 */
async function mainWorldPaste(tabId: number, elId: string, text: string): Promise<any> {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: (id: string, value: string) => {
      const el = document.getElementById(id);
      if (!el) return { success: false, error: 'Element not found' };

      el.focus();
      const selection = window.getSelection();
      if (selection) {
        const range = document.createRange();
        range.selectNodeContents(el);
        selection.removeAllRanges();
        selection.addRange(range);
      }

      // Built here, in the page's world, so Slate can actually read it.
      const dt = new DataTransfer();
      dt.setData('text/plain', value);

      el.dispatchEvent(new InputEvent('beforeinput', {
        bubbles: true, cancelable: true, inputType: 'insertFromPaste', dataTransfer: dt,
      } as InputEventInit));
      el.dispatchEvent(new ClipboardEvent('paste', {
        bubbles: true, cancelable: true, clipboardData: dt,
      }));
      el.dispatchEvent(new Event('input', { bubbles: true }));

      return { success: true, text: (el.textContent || '').slice(0, 50) };
    },
    args: [elId, text],
  });
  return result?.result ?? { success: false, error: 'No result from page' };
}

/**
 * Fire a React synthetic handler from inside the page.
 *
 * Flow's submit button is a React component whose handler checks isTrusted,
 * so a synthetic click dispatched from a content script is ignored. This
 * reaches the component's own onPointerDown/onClick in the MAIN world.
 *
 * Ported verbatim from the AutoFlow worker rather than retyped: it walks
 * React's internal fibre props, and small differences would fail silently in
 * ways indistinguishable from a click that simply did nothing.
 */
async function reactTriggerInPage(tabId: number, payload: any): Promise<any> {
try {
        const results = await chrome.scripting.executeScript({
          target: { tabId: tabId },
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
          args: [payload.elId, payload.handlerName, payload.isKey, payload.keyVal]
        });
        return results && results[0] ? results[0].result : { error: 'No result from script execution' };
      } catch (err: any) {
        return { found: false, success: false, error: err.message };
      }
    }

/** Types already reported, so one noisy caller cannot flood the console. */
const reportedUnhandled = new Set<string>();

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Flow's React submit handlers ignore untrusted synthetic events.
  if (msg?.type === 'REACT_TRIGGER') {
    const tabId = sender.tab?.id;
    if (!tabId) {
      sendResponse({ found: false, success: false, error: 'No tab ID' });
      return false;
    }
    reactTriggerInPage(tabId, msg.payload)
      .then(sendResponse)
      .catch((e) => sendResponse({ found: false, success: false, error: e?.message || String(e) }));
    return true; // async
  }

  // The prompt box cannot be filled without this — see mainWorldPaste.
  if (msg?.type === 'MAIN_WORLD_PASTE') {
    const tabId = sender.tab?.id;
    if (!tabId) {
      sendResponse({ error: 'No tab ID' });
      return false;
    }
    mainWorldPaste(tabId, msg.payload?.elId, msg.payload?.text)
      .then(sendResponse)
      .catch((e) => sendResponse({ error: e?.message || String(e) }));
    return true; // async
  }

  // Results arrive from a content script; forward them to the Studio window.
  if (msg?.type?.startsWith?.('STUDIO_') && sender.tab) {
    replyToStudio(msg);
    // Progress is worth surfacing in the panel too — it is the only place the
    // user can see a run without switching tabs.
    if (msg.type === 'STUDIO_NODE_PROGRESS') {
      patchRunState({ progress: msg.payload?.progress || 0 });
    } else if (msg.type === 'STUDIO_NODE_ERROR') {
      patchRunState({ lastError: msg.payload?.error || 'Generation failed' });
    }
    return false;
  }

  // ── Panel ──
  if (msg?.type === 'PANEL_GET_STATE') {
    sendResponse(runState);
    return false;
  }

  if (msg?.type === 'PANEL_OPEN_STUDIO') {
    openStudio().catch(() => {});
    return false;
  }

  if (msg?.type === 'PANEL_CONTROL') {
    // The runner lives in the Studio window, so control is a request, not a
    // command — if Studio is closed there is nothing running to control.
    if (!studioPort) {
      sendResponse({ ok: false, error: 'Studio is not open' });
      return false;
    }
    replyToStudio({ type: 'STUDIO_CONTROL', payload: { action: msg.action } });
    sendResponse({ ok: true });
    return false;
  }

  if (msg?.type === 'PANEL_PLATFORM_STATUS') {
    // Answering needs a query, so keep the channel open.
    (async () => {
      const status: Record<string, boolean> = {};
      for (const [key, cfg] of Object.entries(PLATFORMS)) {
        try {
          status[key] = (await chrome.tabs.query({ url: cfg.match })).length > 0;
        } catch {
          status[key] = false;
        }
      }
      sendResponse(status);
    })();
    return true;
  }

  /* ── Anything else ──
   *
   * The engine is copied from an extension whose worker answers 34 message
   * types; this one answers a handful, because Studio does not use the queue,
   * downloads or the sidepanel. The rest arriving here is expected.
   *
   * What is not acceptable is answering them with silence. Every bug in this
   * extension so far has been a missing handler: the content script asked, no
   * branch matched, sendResponse was never called, and the caller could not
   * distinguish "no handler" from "did not work". MAIN_WORLD_PASTE left the
   * prompt box empty that way; REACT_TRIGGER left Generate unclicked.
   *
   * So unknown messages now get an explicit answer and are named in the log
   * once each. A future gap shows up as a line in the console instead of a
   * feature that quietly does nothing.
   */
  if (typeof msg?.type === 'string') {
    if (!reportedUnhandled.has(msg.type)) {
      reportedUnhandled.add(msg.type);
      console.warn(
        `[Studio] No handler for "${msg.type}". Harmless if it belongs to the ` +
        `queue or downloads; a bug if Studio needs it.`
      );
    }
    sendResponse({ unhandled: true, type: msg.type });
    return false;
  }

  return false;
});

/* ── Opening Studio ──
   The canvas is a full tab; the toolbar button opens the side panel, which is
   what you can still see once you switch to the Flow tab to watch a run. */
const STUDIO_URL = chrome.runtime.getURL('studio.html');

/**
 * Open the canvas in a window of its own.
 *
 * Not a tab. A workflow runs on labs.google or chatgpt.com, so the canvas and
 * the thing it is driving need to be visible at the same time — as a tab in
 * the same window they hide each other and you spend the run switching back
 * and forth. A popup window also drops the tab strip and address bar, which
 * the canvas has no use for.
 *
 * An already-open canvas is focused rather than duplicated, whichever window
 * it ended up in.
 */
async function openStudio(): Promise<void> {
  const open = await chrome.tabs.query({ url: STUDIO_URL });
  if (open.length && open[0].id != null) {
    await chrome.tabs.update(open[0].id, { active: true });
    if (open[0].windowId != null) await chrome.windows.update(open[0].windowId, { focused: true });
    return;
  }

  // Sized off the current window, since the worker cannot see the screen
  // without an extra permission. Clamped so it is neither cramped nor larger
  // than the display it opens on.
  let width = 1360;
  let height = 900;
  let left: number | undefined;
  let top: number | undefined;
  try {
    const current = await chrome.windows.getCurrent();
    width = Math.min(1500, Math.max(1024, (current.width ?? width) - 120));
    height = Math.min(1000, Math.max(680, (current.height ?? height) - 60));
    // Offset a little so it does not land exactly on top of the window the
    // user just clicked from.
    left = (current.left ?? 0) + 60;
    top = (current.top ?? 0) + 40;
  } catch { /* defaults are fine */ }

  try {
    await chrome.windows.create({ url: STUDIO_URL, type: 'popup', width, height, left, top, focused: true });
  } catch {
    // Popup windows can be refused (some window managers, locked-down
    // policies). A tab is worse than a window but far better than nothing.
    await chrome.tabs.create({ url: STUDIO_URL });
  }
}

/**
 * Make the toolbar button open the side panel.
 *
 * Asked for on both install and every worker start: the worker is
 * event-driven, and a setting that only ever ran once can be missed.
 */
function enablePanelOnClick(): void {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch(() => { /* older Chrome — the onClicked fallback below covers it */ });
}
chrome.runtime.onInstalled.addListener(enablePanelOnClick);
enablePanelOnClick();

/**
 * Fallback so the button is never dead.
 *
 * Chrome does not fire onClicked while openPanelOnActionClick is active, so
 * this only runs when that never took — and without it the button did nothing
 * at all: no popup, no handler, nothing. Opening the panel here works because
 * a click is the user gesture sidePanel.open() requires; if even that fails,
 * fall back to the canvas so something always happens.
 */
chrome.action.onClicked.addListener(async (tab) => {
  try {
    if (tab?.windowId != null) {
      await chrome.sidePanel.open({ windowId: tab.windowId });
      return;
    }
  } catch { /* fall through to the canvas */ }
  await openStudio();
});
