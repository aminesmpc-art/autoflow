/* ============================================================
   AutoFlow Studio — service worker

   Written fresh rather than copied. The AutoFlow service worker is 2,407
   lines, and almost all of it serves the sidepanel queue: download
   interception, upscale chains, scheduled runs, review rewards. Studio needs
   one job — carry messages between the Studio window and whichever platform
   tab a node targets — so copying that file would have imported a large
   surface with no purpose here and every reason to rot.
   ============================================================ */

/* The worker's only import, and static rather than lazy on purpose.

   As `await import('./debugUpload')` webpack emitted it as chunk 720, and a
   service worker cannot fetch a chunk the way a page can — the upload would
   have failed at the first click, on the one path that needed it. Costs ~16KB
   in a worker that is already far larger than that. */
import { uploadToFlow } from './debugUpload';

type Platform = 'flow' | 'chatgpt' | 'gemini' | 'grok' | 'claude' | 'zai';

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

/* ── Diagnostic log ──
   A ring buffer fed by STUDIO_LOG messages from content scripts. The panel
   pulls it on open and gets live pushes as entries arrive. Keeps the last 50
   lines — enough for a failed run but small enough to sit in memory forever. */
const DIAG_LOG_MAX = 50;
const diagLog: Array<{ ts: number; source: string; line: string }> = [];

/** Write a line into the same ring buffer the content scripts feed. */
function diag(source: string, line: string): void {
  const entry = { ts: Date.now(), source, line };
  diagLog.push(entry);
  if (diagLog.length > DIAG_LOG_MAX) diagLog.shift();
  chrome.runtime.sendMessage({ type: 'PANEL_LOG_PUSH', payload: entry }).catch(() => {});
}

/* ── Replies with nowhere to go ──
   replyToStudio used to be `if (studioPort) post(...)` with no else, so a
   result that arrived while the port was down was discarded — no buffer, no
   retry, no log. The runner, which is blocked in awaitBridge waiting for
   exactly that message, then sat out its full sixteen-minute backstop showing
   "Writing 4 prompts…" while the finished answer sat visible in the chat tab.

   The port goes down as a matter of routine: MV3 recycles the worker, the port
   closes with it, and the canvas reconnects two seconds later. Anything that
   landed inside those two seconds was gone for good. Long generations sit in
   that window far longer than short ones, which is why it was always the big
   Story nodes that hung.

   So a reply that cannot be delivered is kept instead of dropped, and handed
   over when the canvas comes back. Only terminal messages are worth keeping:
   a replayed progress tick tells nobody anything, and a run produces hundreds.

   Delivering the same result twice is safe — awaitBridge removes its listener
   in cleanup(), so the second copy arrives to an empty room. */
const PARKED_KEY = 'studio_parked_replies';
const PARKED_MAX = 20;
const PARKABLE = new Set(['STUDIO_NODE_RESULT', 'STUDIO_NODE_ERROR']);

/* In memory first, so parking is synchronous and cannot race a flush. The
   session copy is only there to survive a worker restart, which is the case
   the in-memory array cannot cover. It clears itself when Chrome closes. */
const parked: any[] = [];

function persistParked(): void {
  chrome.storage.session.set({ [PARKED_KEY]: parked }).catch(() => { /* best effort */ });
}

function park(msg: any): void {
  parked.push(msg);
  while (parked.length > PARKED_MAX) parked.shift();
  persistParked();
  diag('Bridge', `Studio was not connected — held ${msg?.type === 'STUDIO_NODE_ERROR'
    ? 'an error' : 'a reply'} for node ${msg?.payload?.nodeId || '?'} until it returns`);
}

async function flushParked(port: chrome.runtime.Port): Promise<void> {
  /* A worker that has just restarted has an empty array and a full store. */
  if (!parked.length) {
    try {
      const got = await chrome.storage.session.get(PARKED_KEY);
      const saved = got?.[PARKED_KEY];
      if (Array.isArray(saved) && saved.length) parked.push(...saved);
    } catch { /* session storage unavailable; nothing was held */ }
  }
  /* This port may have died — or been replaced by a newer one — while the
     read above was in flight. Without this check the flush from a port that
     is already gone wakes up, takes a reply that was parked in the meantime,
     and posts it into the dead port: the exact loss this whole mechanism
     exists to prevent, reintroduced one layer down. Leave it parked; the
     connect that replaced us runs its own flush. */
  if (studioPort !== port) return;
  if (!parked.length) return;

  const sending = parked.splice(0, parked.length);
  persistParked();
  diag('Bridge', `Studio reconnected — delivering ${sending.length} held ${
    sending.length === 1 ? 'reply' : 'replies'}`);
  for (const held of sending) {
    try { port.postMessage(held); } catch { /* went away again mid-flush */ }
  }
}

/* ── Keepalive ──
   A video generation easily outlasts Chrome's idle timeout for a service
   worker. If the worker is recycled mid-run the port dies and the next node
   fails with "Lost connection". An alarm ticking under the idle threshold
   keeps it resident; autoDiscardable stops Chrome dropping the platform tab
   out from under a running generation. */
const KEEPALIVE_ALARM = 'studio-keepalive';
/* ── The one that actually un-throttles ──
   A platform tab is opened with active:false, so it is hidden from the moment
   it exists. Chrome applies intensive throttling to a hidden tab after five
   minutes and clamps its timers to once a minute - and every adapter polls
   with sleep() loops, so the whole run drops to one check a minute.

   Keeping the worker alive does not help with that, and neither does
   autoDiscardable: alive is not un-throttled and not-discarded is not either.
   The only thing that resets Chrome's clock is the tab being VISIBLE, which
   is what this alarm is for.

   Note the period. Chrome clamps a packed extension's alarms to 30 seconds
   however small a number is asked for, so 0.5 is what this actually is rather
   than a wish for something faster. */
const TAB_PING_ALARM = 'studio-tab-ping';
const TAB_PING_MINUTES = 0.5;
let keptTabId: number | null = null;
let keptPlatform: Platform | null = null;

async function startKeepalive(tabId: number, platform: Platform): Promise<void> {
  keptTabId = tabId;
  keptPlatform = platform;
  chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 0.4 });
  chrome.alarms.create(TAB_PING_ALARM, {
    delayInMinutes: TAB_PING_MINUTES,
    periodInMinutes: TAB_PING_MINUTES,
  });
  try {
    await chrome.tabs.update(tabId, { autoDiscardable: false });
  } catch { /* the tab may have gone; the alarm still matters */ }
}

/**
 * Keep the working tab visible, and check something is still listening in it.
 *
 * Bringing the tab forward is the part that matters: it is what stops Chrome
 * throttling the adapter's polling down to once a minute. It also means this
 * routine takes the foreground away from whatever else is open in that window,
 * which is why it must stop the moment a run does - see the STUDIO_RUN_STATE
 * handler. An alarm that outlives its run would pull the user off their own
 * canvas twice a minute, forever.
 */
async function tabPingRoutine(): Promise<void> {
  if (keptTabId === null) { await stopKeepalive(); return; }

  let tab: chrome.tabs.Tab;
  try {
    tab = await chrome.tabs.get(keptTabId);
  } catch {
    diag('Bridge', 'The working tab was closed - stopping the keepalive.');
    await stopKeepalive();
    return;
  }

  if (!tab.active) {
    try { await chrome.tabs.update(keptTabId, { active: true }); } catch { /* gone */ }
  }

  /* Every adapter answers PING, so a rejection here means nothing is listening
     rather than that the message was ignored. That happens after an extension
     reload, which leaves the old content script orphaned in a tab that is
     still open: the run then waits out its full backstop against a page that
     can no longer hear it. */
  try {
    await chrome.tabs.sendMessage(keptTabId, { type: 'PING' });
  } catch {
    const script = keptPlatform ? PLATFORMS[keptPlatform]?.script : undefined;
    if (!script) return;
    try {
      await chrome.scripting.executeScript({ target: { tabId: keptTabId }, files: [script] });
      diag('Bridge', `No content script was listening in the ${
        PLATFORMS[keptPlatform as Platform].name} tab - re-injected it.`);
    } catch (err: any) {
      diag('Bridge', `Cannot reach the ${PLATFORMS[keptPlatform as Platform].name} tab: ${
        err?.message || err}`);
    }
  }
}

async function stopKeepalive(): Promise<void> {
  chrome.alarms.clear(KEEPALIVE_ALARM).catch(() => {});
  chrome.alarms.clear(TAB_PING_ALARM).catch(() => {});
  keptPlatform = null;
  if (keptTabId !== null) {
    try { await chrome.tabs.update(keptTabId, { autoDiscardable: true }); } catch { /* gone */ }
    keptTabId = null;
  }
}

chrome.alarms.onAlarm.addListener((alarm) => {
  // Touching an API is enough to reset the idle timer.
  if (alarm.name === KEEPALIVE_ALARM) chrome.runtime.getPlatformInfo().catch(() => {});
  if (alarm.name === TAB_PING_ALARM) tabPingRoutine().catch(() => { /* tab went */ });
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
  gemini: {
    match: 'https://gemini.google.com/*',
    open: 'https://gemini.google.com/app',
    script: 'gemini-content.js',
    name: 'Gemini',
  },
  grok: {
    match: 'https://grok.com/*',
    open: 'https://grok.com/imagine',
    script: 'grok-content.js',
    name: 'Grok',
  },
  /* Text only — Claude draws nothing. Opened on /new so a build starts on a
     clean thread rather than continuing whatever was last discussed. */
  claude: {
    match: 'https://claude.ai/*',
    open: 'https://claude.ai/new',
    script: 'claude-content.js',
    name: 'Claude',
  },
  /* Text only — Z.AI (GLM-4 / GLM-5) on chat.z.ai */
  zai: {
    match: 'https://chat.z.ai/*',
    open: 'https://chat.z.ai/',
    script: 'zai-content.js',
    name: 'Z.AI',
  },
};

/**
 * What the panel can say about a platform.
 *
 * "blocked" exists because the honest answer to a tab we can see and cannot
 * touch is not "not open". A Grok window sat open on screen while the panel
 * read "not open", which points the user at opening another tab — and the
 * second one reads the same way, because the problem was never the tab.
 *
 * chrome.tabs.query({url}) returns nothing for a host the extension has no
 * access to, which is indistinguishable from no such tab. Asking the
 * permissions API separates the two.
 */
type PlatformState = 'open' | 'closed' | 'blocked';

/**
 * The last few diagnostic lines, for the side panel.
 *
 * Capped and in memory only: this is for reading during a run, not a record.
 * The worker is the only place all four content scripts can reach.
 */
const LOG_LIMIT = 60;
const studioLog: Array<{ at: number; source: string; line: string }> = [];

function pushLog(source: string, line: string): void {
  if (!line) return;
  studioLog.push({ at: Date.now(), source, line });
  if (studioLog.length > LOG_LIMIT) studioLog.splice(0, studioLog.length - LOG_LIMIT);
}

async function platformState(match: string): Promise<PlatformState> {
  let granted = true;
  try {
    granted = await chrome.permissions.contains({ origins: [match] });
  } catch {
    /* Older Chrome, or a pattern it will not evaluate — assume access and let
       the query below be the answer. */
  }

  try {
    if ((await chrome.tabs.query({ url: match })).length > 0) return 'open';
  } catch {
    return granted ? 'closed' : 'blocked';
  }
  return granted ? 'closed' : 'blocked';
}

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
    return tab.id ?? null;
  } catch {
    return null;
  }
}

/**
 * Wait until a tab can actually take the job.
 *
 * This used to be `setTimeout(3000)` after opening the tab. Three seconds is
 * not a cold ChatGPT load — it has to authenticate, hydrate and mount its
 * composer — so the job arrived at a page that was still assembling itself.
 * The symptom was specific and misleading: the prompt appeared in the composer
 * and was never sent, because the send button existed before React had
 * attached a handler to it. The node then waited out its full reply timeout
 * for an answer to a question nobody had asked, and every node downstream
 * failed with it.
 *
 * Two conditions, both evidence rather than elapsed time: the tab reports
 * finished loading, and the content script answers. The script answering is
 * the one that matters — it is the thing the message is actually for.
 *
 * Returns false if the script never answers, so the caller can inject it
 * rather than send into the void.
 */
async function waitForTabReady(tabId: number, timeoutMs = 30_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab.status === 'complete') break;
    } catch {
      return false; // tab closed under us
    }
    await new Promise((r) => setTimeout(r, 250));
  }

  while (Date.now() < deadline) {
    try {
      await chrome.tabs.sendMessage(tabId, { type: 'PING' });
      return true;
    } catch {
      /* not listening yet */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

function replyToStudio(msg: any): void {
  if (studioPort) {
    try {
      studioPort.postMessage(msg);
      return;
    } catch {
      // Died between the null check and the post — the worker was recycled
      // under us. Fall through and hold it like any other undelivered reply.
      studioPort = null;
    }
  }
  /* Nowhere to put it *at this moment*, which is not the same as nobody
     wanting it. The runner is still waiting in the canvas page. */
  if (PARKABLE.has(msg?.type)) park(msg);
}

function nodeError(nodeId: unknown, error: string): void {
  replyToStudio({ type: 'STUDIO_NODE_ERROR', payload: { nodeId, error } });
}

/* ── Asking a chat model for a workflow plan ──────────────────
   The Build tab needs one text answer from one chat tab. Studio's runner
   cannot do it — the runner executes canvas nodes, and at this point there is
   no canvas — and the panel cannot do it either, because opening the tab,
   waiting for it to be ready and re-injecting a content script into a tab
   that predates the extension all live here.

   So the panel asks, and the worker runs exactly the same STUDIO_EXECUTE_NODE
   it would run for a node, then hands the reply straight back rather than
   posting it to a Studio window that may not be open. */

interface PlanWaiter { resolve: (r: { text?: string; error?: string }) => void; timer: any }
const planWaiters = new Map<string, PlanWaiter>();

/** A text answer from a chat platform, or the reason there is none. */
/**
 * Ask a chat for a workflow plan.
 *
 * newChat decides whether this is a fresh conversation or the next turn of
 * one. It matters because the builder repairs: round one asks for a plan,
 * round two says "that plan has problems, fix them and send the whole JSON
 * object again" — and in a NEW chat that sentence refers to nothing. Gemini
 * answered it exactly as anyone would: "Could you please provide the original
 * JSON object or the plan you are referring to?"
 *
 * Worse than useless, because the repair then produced a smaller plan built
 * from the sentence alone — eight steps became four — and the loop spent its
 * remaining round failing differently.
 */
async function askChatForPlan(
  platform: Platform, prompt: string, model = '', newChat: 'auto' | 'never' = 'auto',
  /* Pictures of what the user is describing. The same field a Story node uses
     to show a chat its reference stills, and the same adapters read it — a
     sentence about "my product" is a great deal less use to a model than the
     product. */
  images: string[] = [],
): Promise<{ text?: string; error?: string; conversationUrl?: string }> {
  const cfg = PLATFORMS[platform];
  if (!cfg) return { error: `Unknown platform "${platform}".` };

  const tabId = await ensurePlatformTab(platform);
  if (!tabId) return { error: `Could not open a ${cfg.name} tab. Check you are signed in.` };

  if (!(await waitForTabReady(tabId, 30_000))) {
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: [cfg.script] });
      await waitForTabReady(tabId, 10_000);
    } catch { /* the send below reports it properly */ }
  }

  const nodeId = `plan_${Date.now().toString(36)}`;
  const answer = new Promise<{ text?: string; error?: string }>((resolve) => {
    planWaiters.set(nodeId, {
      resolve,
      /* Longer than the adapters' own text budget, so their message wins and
         the user is told what the site did rather than "timed out here". */
      timer: setTimeout(() => {
        planWaiters.delete(nodeId);
        resolve({ error: `${cfg.name} did not answer in time.` });
      }, images.length ? 360_000 : 180_000),
    });
  });

  try {
    await chrome.tabs.sendMessage(tabId, {
      type: 'STUDIO_EXECUTE_NODE',
      payload: {
        nodeId,
        config: {
          platform,
          mediaType: 'text',
          prompt,
          /* Raw. The text adapters otherwise run the reply through
             cleanAssistantReply, which strips code fences and leading lines —
             reasonable for a prompt, destructive for JSON. */
          rawReply: true,
          newChat,
          model,
          aspectRatio: '1:1',
          creationType: 'ingredients',
          referenceImageData: images.length ? images : undefined,
        },
      },
    });
  } catch (e: any) {
    const w = planWaiters.get(nodeId);
    if (w) { clearTimeout(w.timer); planWaiters.delete(nodeId); }
    return { error: `${cfg.name} tab is not reachable: ${e?.message || e}` };
  }

  const settled = await answer;

  /* Where that conversation lives.
     Read here rather than in five content scripts: the worker owns the tab
     and already knows its id, and every one of these sites puts the
     conversation id in the address bar once the first message lands. Kept so
     a change asked for tomorrow can be typed into the SAME thread rather than
     into a new one that has to be told everything again. */
  if (settled.text) {
    try {
      const tab = await chrome.tabs.get(tabId);
      const url = tab?.url || '';
      /* Only a real conversation, not the site's front door. A bare
         chatgpt.com would reopen a blank chat and look like it worked. */
      if (url && /\/(c|chat|app|share)\/[\w-]{6,}/.test(url)) {
        return { ...settled, conversationUrl: url };
      }
    } catch { /* tab closed between answering and asking */ }
  }
  return settled;
}

/** True when this result belonged to a Build request rather than to a node. */
function settlePlan(msg: any): boolean {
  const nodeId = msg?.payload?.nodeId;
  const waiter = nodeId && planWaiters.get(nodeId);
  if (!waiter) return false;
  if (msg.type === 'STUDIO_NODE_PROGRESS') return true;   // ours, but not an answer
  clearTimeout(waiter.timer);
  planWaiters.delete(nodeId);
  waiter.resolve(
    msg.type === 'STUDIO_NODE_RESULT'
      ? { text: msg.payload?.text || '' }
      : { error: msg.payload?.error || 'The chat did not return an answer.' }
  );
  return true;
}

/* ── Studio port ── */

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'studio') return;

  studioPort = port;
  patchRunState({ studioOpen: true });
  console.log('[Studio] connected');
  /* Before anything else: a reply that landed while this port was down is the
     only thing standing between a stuck node and a finished one. */
  flushParked(port).catch(() => { /* nothing held, or storage gone */ });

  port.onMessage.addListener(async (msg: any) => {
    if (!msg?.type?.startsWith?.('STUDIO_')) return;

    // Studio reports its own run lifecycle so the panel can show it.
    if (msg.type === 'STUDIO_RUN_STATE') {
      patchRunState(msg.payload || {});
      /* The moment the run is over, stop holding the tab forward.
       *
       * The keepalive used to end only when the canvas was closed, which cost
       * nothing while all it did was poke an API. It brings a tab to the front
       * twice a minute now, so an alarm that outlives its run would pull the
       * user off whatever they moved on to, indefinitely, with no run left to
       * justify it. */
      if (msg.payload && msg.payload.running === false) {
        stopKeepalive().catch(() => { /* nothing was running */ });
      }
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
      startKeepalive(tabId, platform).catch(() => { /* non-critical */ });
    }

    /* Applies to a tab we found as well as one we opened: a ChatGPT window the
       user left open on a cold profile is mid-reload just as often. Returns
       immediately when the script is already listening, so a warm tab pays
       nothing for this. */
    /* Only a generation is worth waiting on. Pause and stop are the controls
       someone reaches for when a run is misbehaving, and making those sit
       through a readiness wait is the opposite of what they are for. */
    const readyAt = Date.now();
    const ready = await waitForTabReady(
      tabId,
      msg.type === 'STUDIO_EXECUTE_NODE' ? 30_000 : 3_000
    );
    /* Printed whenever it was not instant. A readiness check that silently
       costs seconds is exactly how forty of them went unnoticed: every log
       line said what happened, none said when. */
    const waited = Date.now() - readyAt;
    if (waited > 400) {
      pushLog('Studio', `Waited ${(waited / 1000).toFixed(1)}s for the ${cfg.name} tab (ready=${ready})`);
      console.log(`[Studio] Waited ${(waited / 1000).toFixed(1)}s for the ${cfg.name} tab (ready=${ready})`);
    }
    if (!ready) {
      try {
        await chrome.scripting.executeScript({ target: { tabId }, files: [cfg.script] });
        await waitForTabReady(tabId, 10_000);
      } catch { /* the send below reports it properly */ }
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
    /* Only if it is still ours. A reconnect can land before the old port's
       disconnect fires, and clearing unconditionally would blank the live
       port — sending every reply after it straight to the parking lot. */
    if (studioPort !== port) return;
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
 * Dispatch paste and drop events with image files in the page's MAIN world.
 */
async function mainWorldAttachFiles(tabId: number, elId: string, dataUrls: string[]): Promise<any> {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: (id: string, urls: string[]) => {
      const composer = document.getElementById(id)
        || document.querySelector('[data-testid="chat-input"]')
        || document.querySelector('div[contenteditable="true"].ProseMirror')
        || document.querySelector('div[contenteditable="true"]');
      if (!composer) return { success: false, error: 'Composer not found' };

      const files: File[] = [];
      for (let i = 0; i < urls.length; i++) {
        const url = urls[i];
        const comma = url.indexOf(',');
        const header = url.slice(0, comma);
        const mime = /data:([^;,]+)/.exec(header)?.[1] || 'image/png';
        const body = url.slice(comma + 1);
        const binary = header.includes(';base64') ? atob(body) : decodeURIComponent(body);
        const bytes = new Uint8Array(binary.length);
        for (let j = 0; j < binary.length; j++) bytes[j] = binary.charCodeAt(j);
        const ext = mime.split('/')[1]?.replace('jpeg', 'jpg') || 'png';
        files.push(new File([bytes], `reference-${i + 1}.${ext}`, { type: mime }));
      }

      const dt = new DataTransfer();
      for (const f of files) dt.items.add(f);

      // Paste on composer
      composer.focus();
      try {
        composer.dispatchEvent(new ClipboardEvent('paste', {
          bubbles: true, cancelable: true, clipboardData: dt,
        }));
      } catch {}

      // Drop on composer
      try {
        composer.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: dt }));
        composer.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
        composer.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
      } catch {}

      // Populate file inputs
      const inputs = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="file"]'));
      for (const input of inputs) {
        try {
          input.files = dt.files;
          input.dispatchEvent(new Event('change', { bubbles: true }));
          input.dispatchEvent(new Event('input', { bubbles: true }));
        } catch {}
      }

      return { success: true, count: files.length };
    },
    args: [elId, dataUrls],
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

  if (msg?.type === 'MAIN_WORLD_ATTACH_FILES') {
    const tabId = sender.tab?.id;
    if (!tabId) {
      sendResponse({ error: 'No tab ID' });
      return false;
    }
    mainWorldAttachFiles(tabId, msg.payload?.elId, Array.isArray(msg.payload?.dataUrls) ? msg.payload.dataUrls : [])
      .then(sendResponse)
      .catch((e) => sendResponse({ error: e?.message || String(e) }));
    return true; // async
  }

  /* ── Refresh Flow's generation-status cache on demand ──
     apiHelper reads Flow's own batchCheckAsyncVideoGenerationStatus responses
     as they go past. That is passive and free, but it only yields news while
     Flow is polling — and Flow stops when its tab is idle or backgrounded,
     which is exactly when a Studio run is waiting on it.

     activeStatusCheck replays the call Flow itself makes, from the MAIN world
     where the captured URL and auth live. It has to route through here because
     labs.google's CSP blocks injected <script> tags, so executeScript is the
     only way in.

     This handler existed in the original extension and was never ported. The
     call has been failing silently in Studio ever since — returning false,
     which reads identically to "nothing changed", so a stale cache looked like
     a generation that had not moved. */
  if (msg?.type === 'RUN_ACTIVE_CHECK') {
    const tabId = sender.tab?.id;
    if (tabId == null) { sendResponse({ success: false, error: 'No tab ID' }); return false; }
    chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: async (mediaIds?: string[]) => {
        const check = (window as any).__af_activeCheck;
        if (typeof check !== 'function') return false;
        try { return await check(mediaIds); } catch { return false; }
      },
      args: [msg.payload?.mediaIds],
    })
      .then((results) => sendResponse({ success: results?.[0]?.result === true }))
      .catch((err: any) => sendResponse({ success: false, error: err?.message || String(err) }));
    return true; // async
  }

  // ── Diagnostic log ──
  // Content scripts send STUDIO_LOG with { source, line }. Collect them in a
  // ring buffer so the panel can display them, and push each new one live.
  // Must sit ABOVE the STUDIO_* catch-all — STUDIO_LOG starts with "STUDIO_"
  // and comes from a tab, so the catch-all was swallowing it.
  if (msg?.type === 'STUDIO_LOG' && sender.tab) {
    diag(msg.payload?.source || '?', msg.payload?.line || '');
    return false;
  }

  /* ── A node that cannot finish itself ──
     Grok only starts a generation on a click carrying real user activation,
     which no extension can produce. When a node reaches that point everything
     else is already set up, so the run pauses for one press rather than
     throwing the prepared prompt away. The ask is useless if it lands in a
     background tab, so bring that tab forward — this is the one case where
     stealing focus is the entire point. */
  if (msg?.type === 'STUDIO_NEEDS_CLICK' && sender.tab) {
    const line = msg.payload?.message || 'Your click is needed to continue.';
    const entry = { ts: Date.now(), source: msg.payload?.platform || 'Grok', line };
    diagLog.push(entry);
    if (diagLog.length > DIAG_LOG_MAX) diagLog.shift();
    chrome.runtime.sendMessage({ type: 'PANEL_LOG_PUSH', payload: entry }).catch(() => {});
    chrome.runtime.sendMessage({ type: 'PANEL_NEEDS_CLICK', payload: msg.payload }).catch(() => {});
    patchRunState({ lastError: line });
    if (sender.tab.id != null) {
      chrome.tabs.update(sender.tab.id, { active: true }).catch(() => {});
      if (sender.tab.windowId != null) {
        chrome.windows.update(sender.tab.windowId, { focused: true }).catch(() => {});
      }
    }
    replyToStudio(msg);
    return false;
  }

  /* A Build request's answer, which belongs to the panel rather than to a
     canvas node. Checked before the relay below, or it would be posted to a
     Studio window that is very often not open during a build. */
  if (msg?.type?.startsWith?.('STUDIO_NODE_') && sender.tab && settlePlan(msg)) {
    return false;
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

  if (msg?.type === 'PANEL_GET_LOGS') {
    sendResponse(diagLog);
    return false;
  }

  if (msg?.type === 'PANEL_BUILD') {
    askChatForPlan(
      msg.platform, msg.prompt, msg.model || '',
      msg.newChat === 'never' ? 'never' : 'auto',
      Array.isArray(msg.images) ? msg.images : [],
    )
      .then(sendResponse)
      .catch((e) => sendResponse({ error: e?.message || String(e) }));
    return true;   // async
  }

  /* Put a chat tab back on the conversation a plan was written in, so the
     next message continues it instead of starting somewhere new. */
  if (msg?.type === 'PANEL_OPEN_CHAT') {
    (async () => {
      const platform = msg.platform as Platform;
      const url = String(msg.url || '');
      const cfg = PLATFORMS[platform];
      if (!cfg || !url) {
        sendResponse({ ok: false, error: 'No conversation to open.' });
        return;
      }
      try {
        const tabId = await ensurePlatformTab(platform);
        if (!tabId) { sendResponse({ ok: false, error: 'Could not open that chat.' }); return; }
        const tab = await chrome.tabs.get(tabId);
        /* Already there — navigating again would discard anything typed. */
        if ((tab?.url || '') !== url) {
          await chrome.tabs.update(tabId, { url });
          await waitForTabReady(tabId, 20_000);
        }
        await chrome.tabs.update(tabId, { active: true });

        /* Where did we actually land?
           A conversation id stays well-formed long after the conversation
           stops existing — deleted, expired, or belonging to another account.
           Gemini answers one of those with a silent redirect to /app, which
           is a blank new chat that looks like a working page, so navigating
           and reporting success handed the user a broken screen and called it
           done. Observed directly: /app/8ddbd0fbddb01467 -> /app, no turns.

           A short settle first, because the redirect happens after load. */
        await new Promise((r) => setTimeout(r, 1200));
        const landed = (await chrome.tabs.get(tabId))?.url || '';
        /* Compared without the query string: these sites append their own. */
        const bare = (u: string) => u.split('?')[0].replace(/\/$/, '');
        if (bare(landed) !== bare(url)) {
          /* Named in the order they actually happen.
             The first one is not a guess: these sites put no account index in
             the path, so which conversations exist is decided by the cookies
             of the Chrome profile. A chat built while signed in as someone
             else — or in another Chrome profile entirely — is unreachable
             from here, and the site says so by redirecting to a blank page
             rather than by refusing.

             Saying "deleted" sent somebody looking through their own history
             for a conversation that was never in it. */
          sendResponse({
            ok: false,
            error: `${cfg.name} did not open that conversation. It usually belongs to a `
              + 'different Google account or Chrome profile than the one signed in here; '
              + 'it may also have been deleted.',
          });
          return;
        }
        sendResponse({ ok: true });
      } catch (e: any) {
        sendResponse({ ok: false, error: e?.message || String(e) });
      }
    })();
    return true;   // async
  }

  if (msg?.type === 'PANEL_OPEN_STUDIO') {
    openStudio().catch(() => {});
    return false;
  }

  /* The website's Extractor, handing a built workflow over.
     Same action as the panel's, and deliberately a separate name: this one
     arrives from a content script on a page, so a reader tracing "who can open
     my canvas" sees both callers rather than one shared label. */
  if (msg?.type === 'OPEN_STUDIO') {
    openStudio().catch(() => {});
    return false;
  }

  /* Upload clips to Flow by driving a real file chooser.
     OFF unless the user turned it on — see DEBUG_UPLOAD_KEY below. */
  if (msg?.type === 'DEBUG_UPLOAD_TO_FLOW') {
    debugUploadToFlow(msg)
      .then(sendResponse)
      .catch((e: any) => sendResponse({ ok: false, error: e?.message || String(e) }));
    return true;
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

  /* Diagnostics for the panel.
     The content scripts log to the console of the site they drive, which is
     the one place someone watching a run is not looking — finding out why a
     node failed meant opening devtools on chatgpt.com. */
  if (msg?.type === 'STUDIO_LOG') {
    pushLog(msg.payload?.source || 'Studio', msg.payload?.line || '');
    return false;
  }

  if (msg?.type === 'PANEL_LOG') {
    sendResponse(studioLog);
    return false;
  }

  if (msg?.type === 'PANEL_PLATFORM_STATUS') {
    // Answering needs a query, so keep the channel open.
    (async () => {
      const status: Record<string, PlatformState> = {};
      for (const [key, cfg] of Object.entries(PLATFORMS)) {
        status[key] = await platformState(cfg.match);
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


/* ── Uploading a clip to Flow with the debugger ──────────────────────────
   Flow ignores every synthetic file event a content script can produce —
   uploadVideo.ts records the five routes tried and why each is dead. The one
   thing that does work is what Puppeteer does: intercept the file chooser
   through the Chrome DevTools Protocol, which the browser treats exactly like
   a real pick.

   It is off unless asked for, and the switch is deliberately a stored flag
   read HERE rather than a check in whatever offers the button:

     · attaching the debugger puts a banner across the top of the user's Flow
       tab saying this extension is debugging their browser. Nobody should
       meet that by accident.
     · the `debugger` permission is one of the most heavily scrutinised in the
       Web Store. Declaring it is unavoidable to ship the feature at all;
       using it without being asked is not.
     · a gate in the UI is a gate one new caller can walk around. This one
       every caller goes through, because it is the only path to the module. */
const DEBUG_UPLOAD_KEY = 'af_debug_upload';

async function debugUploadEnabled(): Promise<boolean> {
  try {
    const got = await chrome.storage.local.get([DEBUG_UPLOAD_KEY]);
    return got?.[DEBUG_UPLOAD_KEY] === true;
  } catch {
    /* Storage unreachable is not consent. */
    return false;
  }
}

async function debugUploadToFlow(msg: any): Promise<{ ok: boolean; error?: string }> {
  if (!(await debugUploadEnabled())) {
    return {
      ok: false,
      error: 'Debugger upload is off. Turn on "Upload to Flow automatically" in '
        + 'Settings first — it attaches Chrome\'s debugger to your Flow tab and '
        + 'shows a banner while it does.',
    };
  }

  const files = Array.isArray(msg?.files) ? msg.files : [];
  if (!files.length) return { ok: false, error: 'nothing to upload' };

  const tabId = typeof msg?.tabId === 'number' ? msg.tabId : (await findFlowTab());
  if (!tabId) return { ok: false, error: 'no Flow tab is open' };

  return uploadToFlow(tabId, files);
}

/** The Flow tab to drive, when the caller did not name one. */
async function findFlowTab(): Promise<number | null> {
  try {
    const tabs = await chrome.tabs.query({ url: 'https://labs.google/*' });
    const withProject = tabs.find((t) => /\/project\//.test(t.url || ''));
    return (withProject || tabs[0])?.id ?? null;
  } catch {
    return null;
  }
}
