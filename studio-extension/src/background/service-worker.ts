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

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
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
