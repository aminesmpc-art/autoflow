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
  console.log('[Studio] connected');

  port.onMessage.addListener(async (msg: any) => {
    if (!msg?.type?.startsWith?.('STUDIO_')) return;

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
    console.log('[Studio] disconnected');
  });
});

/* Results arrive from the content script as one-off messages; forward them to
   whichever Studio window is listening. */
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.type?.startsWith?.('STUDIO_') && sender.tab) {
    replyToStudio(msg);
  }
  return false;
});

/* ── Opening Studio ──
   No sidepanel here: Studio is the whole product, so the toolbar button opens
   it, and an already-open tab is focused rather than duplicated. */
const STUDIO_URL = chrome.runtime.getURL('studio.html');

chrome.action.onClicked.addListener(async () => {
  const open = await chrome.tabs.query({ url: STUDIO_URL });
  if (open.length && open[0].id != null) {
    await chrome.tabs.update(open[0].id, { active: true });
    if (open[0].windowId != null) await chrome.windows.update(open[0].windowId, { focused: true });
    return;
  }
  await chrome.tabs.create({ url: STUDIO_URL });
});
