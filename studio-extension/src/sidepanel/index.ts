/* ============================================================
   Side panel — control surface for a run happening elsewhere.

   The canvas is a full tab, and during a run the user is watching Flow
   generate, not the canvas. The panel is the one thing still on screen: it
   shows what is running, lets them stop it, and holds the account.

   It never drives execution itself. The runner lives in the Studio window;
   the panel asks the service worker to relay a request, and if Studio is
   closed there is nothing to control.
   ============================================================ */

import './sidepanel.css';
import { login, logout, isLoggedIn, getProfile } from '../shared/api';

/**
 * Element by id, loudly.
 *
 * Returning null here meant a single renamed id threw deep inside wiring and
 * killed the rest of init — leaving the panel showing its static HTML with no
 * hint anything had gone wrong. A side panel has no visible console, so a
 * silent failure looks exactly like a working panel with nothing to report.
 */
const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Side panel is missing #${id}`);
  return el as T;
};

/** Surface a failure in the panel itself — there is nowhere else to see it. */
function showFatal(err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  console.error('[Studio panel]', err);
  const box = document.createElement('div');
  box.className = 'sp-error';
  box.style.margin = '12px 0';
  box.textContent = `Panel error: ${message}`;
  document.body.prepend(box);
}

/* ── Run status ── */

interface RunSnapshot {
  studioOpen: boolean;
  running: boolean;
  paused: boolean;
  nodeLabel: string;
  progress: number;
  done: number;
  total: number;
  lastError: string;
}

let runStartedAt: number | null = null;

/** mm:ss — a run has no total, so elapsed is the honest number to show. */
function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function renderRun(s: Partial<RunSnapshot>): void {
  const live = !!s.running;
  $('run-idle').hidden = live;
  $('run-live').hidden = !live;

  if (!live) {
    runStartedAt = null;
    $('run-idle-hint').textContent = s.studioOpen
      ? 'Canvas is open — press Run there to start.'
      : 'Open the canvas to build or run a workflow.';
  } else {
    // Started when we first saw it running; the worker's snapshot has no
    // start time and inventing one on every tick would reset the clock.
    if (runStartedAt === null) runStartedAt = Date.now();

    $('run-node').textContent = s.nodeLabel || 'Working…';
    const pct = Math.max(0, Math.min(100, s.progress || 0));
    ($('run-bar') as HTMLElement).style.width = `${pct}%`;
    $('run-pct').textContent = `${pct}%`;
    $('run-count').textContent = `${s.done ?? 0} / ${s.total ?? 0}`;
    ($('btn-pause') as HTMLButtonElement).textContent = s.paused ? 'Resume' : 'Pause';
    $('head-sub').textContent = s.paused ? 'Paused' : 'Running';
  }

  if (!live) $('head-sub').textContent = 'Node workflows';

  const err = $('run-error');
  err.hidden = !s.lastError;
  if (s.lastError) err.textContent = s.lastError;
}

/** Ticks independently of worker updates, which only arrive on state changes. */
setInterval(() => {
  if (runStartedAt === null) return;
  try {
    $('run-elapsed').textContent = formatElapsed(Date.now() - runStartedAt);
  } catch { /* panel closing */ }
}, 1000);

async function refreshRun(): Promise<void> {
  try {
    const state = await chrome.runtime.sendMessage({ type: 'PANEL_GET_STATE' });
    if (state) renderRun(state);
  } catch { /* worker asleep; the next tick will get it */ }
}

// Pushed whenever the worker's snapshot changes, so the panel tracks a run
// without polling hard.
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'PANEL_RUN_STATE') renderRun(msg.payload || {});
  return false;
});

/* ── Platforms ──
   Answers "is the tab this run needs even open" before a node discovers it
   three minutes in. */
async function refreshPlatforms(): Promise<void> {
  /* 'open' | 'closed' | 'blocked'. Booleans until a Grok window sat open on
     screen while this read "not open" — which sends the user to open another
     tab that reads the same way, because the tab was never the problem. */
  let status: Record<string, string> = {};
  let reachedWorker = true;
  try {
    status = (await chrome.runtime.sendMessage({ type: 'PANEL_PLATFORM_STATUS' })) || {};
  } catch {
    // A worker that failed to start makes every button in here do nothing.
    // Say so, rather than showing dashes that look like "still loading".
    reachedWorker = false;
  }

  if (!reachedWorker) {
    for (const li of Array.from(document.querySelectorAll<HTMLLIElement>('#plat-list li'))) {
      li.classList.remove('is-open');
      const state = li.querySelector('.sp-plat__state');
      if (state) state.textContent = 'no worker';
    }
    const err = $('run-error');
    err.hidden = false;
    err.textContent =
      'Background worker is not responding — reload the extension in chrome://extensions.';
    return;
  }

  for (const li of Array.from(document.querySelectorAll<HTMLLIElement>('#plat-list li'))) {
    const key = li.dataset.plat || '';
    const value = status[key];
    // Older workers answered with booleans; treat that as before.
    const open = value === 'open' || value === true as any;
    const blocked = value === 'blocked';
    li.classList.toggle('is-open', open);
    li.classList.toggle('is-blocked', blocked);
    const state = li.querySelector('.sp-plat__state');
    if (state) state.textContent = open ? 'open' : blocked ? 'no access' : 'not open';
    /* Clicking a blocked row opens another tab that will read the same way,
       so say where the switch actually is. */
    li.title = blocked
      ? 'The tab is there but this extension has no access to the site. '
        + 'Open chrome://extensions, find AutoFlow Studio, and set Site access to "On all sites".'
      : '';
  }
}

/* ── Account ── */

async function refreshAccount(): Promise<void> {
  const signedIn = await isLoggedIn();
  $('acct-out').hidden = signedIn;
  $('acct-in').hidden = !signedIn;
  const badge = $('plan-badge');

  if (!signedIn) {
    badge.hidden = true;
    return;
  }

  const profile = await getProfile();
  if (!profile) {
    // A token that no longer works is worse than none — it silently fails
    // every limit check. Drop it and show the form again.
    await logout();
    $('acct-out').hidden = false;
    $('acct-in').hidden = true;
    badge.hidden = true;
    return;
  }

  /* Cache it where the canvas looks.
     Storage is per-extension, so signing in here is the only thing that can
     tell Studio this account is Pro — without it the canvas shows Free
     limits and an Upgrade button to someone who already paid. */
  try {
    await chrome.storage.local.set({ af_cached_profile: profile });
  } catch { /* the canvas fetches for itself too */ }

  $('acct-email').textContent = profile.email;
  $('acct-initial').textContent = (profile.email || '?').charAt(0);

  const pro = !!profile.is_pro_active;
  badge.hidden = false;
  badge.textContent = pro ? 'Pro' : 'Free';
  badge.className = `sp-badge ${pro ? 'sp-badge--pro' : ''}`;

  await renderUsage(pro);
}

/**
 * Studio runs used this month.
 *
 * Read from the same storage key the canvas writes, so the panel does not
 * need its own count and cannot disagree with the number shown there. The
 * server remains the authority — this is a display of what we last saw.
 */
const runKey = () => `studio_runs_${new Date().toISOString().slice(0, 7)}`;
const FREE_RUNS_PER_MONTH = 15;

async function renderUsage(isPro: boolean): Promise<void> {
  const bar = $('usage-bar') as HTMLElement;

  if (isPro) {
    $('usage-label').textContent = 'Studio runs';
    $('usage-count').textContent = 'Unlimited';
    bar.style.width = '100%';
    bar.classList.remove('sp-bar__fill--full');
    return;
  }

  let used = 0;
  try {
    const key = runKey();
    used = (await chrome.storage.local.get(key))?.[key] || 0;
  } catch { /* show zero rather than nothing */ }

  const pct = Math.min(100, Math.round((used / FREE_RUNS_PER_MONTH) * 100));
  $('usage-label').textContent = 'Studio runs this month';
  $('usage-count').textContent = `${used} / ${FREE_RUNS_PER_MONTH}`;
  bar.style.width = `${pct}%`;
  // Turns warm as it runs out, so the limit is not a surprise at run time.
  bar.classList.toggle('sp-bar__fill--full', used >= FREE_RUNS_PER_MONTH - 3);
}

/* ── Wiring ── */

function wire(): void {
  $('open-studio').addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'PANEL_OPEN_STUDIO' }).catch(() => {});
  });

  const control = async (action: 'pause' | 'stop') => {
    const res = await chrome.runtime.sendMessage({ type: 'PANEL_CONTROL', action }).catch(() => null);
    if (res && res.ok === false) {
      const err = $('run-error');
      err.hidden = false;
      err.textContent = res.error || 'Could not reach Studio';
    }
  };
  // A row that reports a missing tab may as well open it.
  for (const li of Array.from(document.querySelectorAll<HTMLLIElement>('#plat-list li'))) {
    const open = () => {
      // Table rather than a ternary: with three platforms a chained
      // conditional sent Gemini's row to Flow.
      const url = ({
        chatgpt: 'https://chatgpt.com/',
        gemini: 'https://gemini.google.com/app',
        grok: 'https://grok.com/imagine',
        flow: 'https://labs.google/fx/tools/flow',
      } as Record<string, string>)[li.dataset.plat || 'flow']
        || 'https://labs.google/fx/tools/flow';
      chrome.tabs.create({ url }).catch(() => {});
    };
    li.addEventListener('click', open);
    li.addEventListener('keydown', (e) => {
      const key = (e as KeyboardEvent).key;
      if (key === 'Enter' || key === ' ') { e.preventDefault(); open(); }
    });
  }

  $('btn-pause').addEventListener('click', () => control('pause'));
  $('btn-stop').addEventListener('click', () => control('stop'));

  $('btn-login').addEventListener('click', async () => {
    const email = ($('email') as HTMLInputElement).value.trim();
    const password = ($('password') as HTMLInputElement).value;
    const err = $('auth-error');
    err.hidden = true;

    if (!email || !password) {
      err.hidden = false;
      err.textContent = 'Enter your email and password.';
      return;
    }

    const btn = $('btn-login') as HTMLButtonElement;
    btn.disabled = true;
    btn.textContent = 'Signing in…';
    const res = await login(email, password);
    btn.disabled = false;
    btn.textContent = 'Sign in';

    if (!res.ok) {
      err.hidden = false;
      err.textContent = res.message;
      return;
    }
    ($('password') as HTMLInputElement).value = '';
    await refreshAccount();
  });

  $('btn-logout').addEventListener('click', async () => {
    await logout();
    // Otherwise the canvas keeps granting Pro to a signed-out browser.
    try { await chrome.storage.local.remove('af_cached_profile'); } catch { /* best effort */ }
    await refreshAccount();
  });

  // Enter submits, because a two-field form that ignores Enter feels broken.
  for (const id of ['email', 'password']) {
    $(id).addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Enter') $('btn-login').click();
    });
  }
}

/* Each step is independent: one failing must not take the others with it, and
   whatever fails has to be visible in the panel rather than only in a console
   nobody opens. */
function boot(): void {
  const steps: Array<[string, () => unknown]> = [
    ['wiring', wire],
    ['run status', refreshRun],
    ['account', refreshAccount],
    ['platforms', refreshPlatforms],
  ];
  for (const [name, step] of steps) {
    try {
      const result = step();
      if (result instanceof Promise) result.catch((e) => showFatal(new Error(`${name}: ${e?.message || e}`)));
    } catch (e: any) {
      showFatal(new Error(`${name}: ${e?.message || e}`));
    }
  }
}

boot();

// Tabs open and close without telling us; a slow poll keeps the dots honest.
setInterval(() => { refreshPlatforms().catch(() => {}); }, 5000);
