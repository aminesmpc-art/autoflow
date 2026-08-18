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
import {
  login, logout, isLoggedIn, getProfile,
  listCommunityTemplates, getCommunityTemplate, likeCommunityTemplate,
  submitCommunityTemplate, type CommunityCard,
} from '../shared/api';
import { loadTemplates, refreshTemplates } from '../studio/templates/loader';
import { BRAND_MARKS } from '../studio/components/brandMarks';
import type { Template } from '../studio/templates';
import { getAskPresets } from '../studio/presets';
import { signInWithGoogle } from './googleSignIn';
import { buildSpec } from '../studio/builder/spec';
import { readPlan, compilePlan } from '../studio/builder/plan';
import {
  checkPlan, repairPlanMessage, explainPlan, type PlanProblem,
} from '../studio/builder/check';
import { isRunnableType } from '../studio/templates/validate';

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

  const liveDot = document.getElementById('nav-live-dot');
  if (liveDot) liveDot.hidden = !live;

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
  if (msg?.type === 'PANEL_LOG_PUSH') appendLogEntry(msg.payload);
  return false;
});

/* ── Diagnostics ──
   Renders log entries from content scripts so you can diagnose a failed node
   without opening devtools on chatgpt.com. */

function formatLogTs(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${
    String(d.getMinutes()).padStart(2, '0')}:${
    String(d.getSeconds()).padStart(2, '0')}`;
}

function appendLogEntry(entry: { ts: number; source: string; line: string }): void {
  const container = document.getElementById('diag-log');
  if (!container) return;

  // Remove the "No log entries yet" placeholder on first entry.
  const empty = container.querySelector('.sp-diag__empty');
  if (empty) empty.remove();

  const row = document.createElement('div');
  row.className = 'sp-diag__line';

  const ts = document.createElement('span');
  ts.className = 'sp-diag__ts';
  ts.textContent = formatLogTs(entry.ts);

  const src = document.createElement('span');
  src.className = 'sp-diag__src';
  src.textContent = entry.source;

  const msg = document.createElement('span');
  msg.className = 'sp-diag__msg';
  msg.textContent = entry.line;

  row.append(ts, src, msg);
  container.appendChild(row);
  container.scrollTop = container.scrollHeight;
}

async function refreshLogs(): Promise<void> {
  try {
    const entries = await chrome.runtime.sendMessage({ type: 'PANEL_GET_LOGS' });
    if (Array.isArray(entries)) {
      for (const e of entries) appendLogEntry(e);
    }
  } catch { /* worker asleep */ }
}

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

  const rows = Array.from(document.querySelectorAll<HTMLButtonElement>('#plat-list button'));
  const summary = document.getElementById('plat-count');

  if (!reachedWorker) {
    for (const row of rows) {
      row.classList.remove('is-open', 'is-blocked');
      const state = row.querySelector('.sp-plat__state');
      if (state) state.textContent = 'no worker';
    }
    if (summary) summary.textContent = 'unknown';
    const err = $('run-error');
    err.hidden = false;
    err.textContent =
      'Background worker is not responding — reload the extension in chrome://extensions.';
    return;
  }

  let openCount = 0;
  for (const row of rows) {
    const key = row.dataset.plat || '';
    const value = status[key];
    // Older workers answered with booleans; treat that as before.
    const open = value === 'open' || value === true as any;
    const blocked = value === 'blocked';
    if (open) openCount++;
    row.classList.toggle('is-open', open);
    row.classList.toggle('is-blocked', blocked);
    const state = row.querySelector('.sp-plat__state');
    if (state) state.textContent = open ? 'open' : blocked ? 'no access' : 'not open';
    /* Clicking a blocked row opens another tab that will read the same way,
       so say where the switch actually is. */
    row.title = blocked
      ? 'The tab is there but this extension has no access to the site. '
        + 'Open chrome://extensions, find AutoFlow Studio, and set Site access to "On all sites".'
      : '';
  }

  /* The answer, beside the heading. Four dots require reading four rows to
     learn the one thing you came for — whether the run can start. */
  if (summary) summary.textContent = `${openCount} of ${rows.length} open`;
}

/* ── Account ── */

/**
 * Show the panel, or the gate.
 *
 * Everything behind the gate spends a run against an account's quota, so
 * there is nothing honest to show someone we cannot count runs for. The
 * previous shape — the whole tab bar over controls that could not do anything
 * — reads as a broken app rather than a locked one.
 */
function showGate(signedIn: boolean): void {
  const gate = document.getElementById('gate');
  const app = document.getElementById('app');
  if (gate) (gate as HTMLElement).hidden = signedIn;
  if (app) (app as HTMLElement).hidden = !signedIn;
}

async function refreshAccount(): Promise<void> {
  const signedIn = await isLoggedIn();
  showGate(signedIn);
  $('acct-out').hidden = signedIn;
  $('acct-in').hidden = !signedIn;
  const badge = $('plan-badge');

  if (!signedIn) {
    badge.hidden = true;
    renderFooter(null, false, 0, FREE_RUNS_PER_MONTH);
    return;
  }

  const profile = await getProfile();
  if (!profile) {
    // A token that no longer works is worse than none — it silently fails
    // every limit check. Drop it and show the form again.
    await logout();
    showGate(false);
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
  // The footer is the always-visible copy of this, so it moves with it.
  const usedNow = await studioRunsUsed();
  renderFooter(profile.email, pro, usedNow, FREE_RUNS_PER_MONTH);
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

/** Runs recorded for this month. One reader, so the usage bar and the footer
    cannot show different numbers. */
async function studioRunsUsed(): Promise<number> {
  try {
    const key = runKey();
    return (await chrome.storage.local.get(key))?.[key] || 0;
  } catch {
    return 0;   // show zero rather than nothing
  }
}

async function renderUsage(isPro: boolean): Promise<void> {
  const bar = $('usage-bar') as HTMLElement;

  if (isPro) {
    $('usage-label').textContent = 'Studio runs';
    $('usage-count').textContent = 'Unlimited';
    bar.style.width = '100%';
    bar.classList.remove('sp-bar__fill--full');
    return;
  }

  const used = await studioRunsUsed();

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
  /* A row that reports a missing tab may as well open it. Real <button>s now,
     so Enter and Space come free — the previous version was an <li> carrying
     role="button" and hand-rolled key handling, which is the same thing with
     more code and one more place to get it wrong. */
  for (const row of Array.from(document.querySelectorAll<HTMLButtonElement>('#plat-list button'))) {
    row.addEventListener('click', () => {
      // Table rather than a ternary: with three platforms a chained
      // conditional sent Gemini's row to Flow.
      const url = ({
        chatgpt: 'https://chatgpt.com/',
        gemini: 'https://gemini.google.com/app',
        grok: 'https://grok.com/imagine',
        flow: 'https://labs.google/fx/tools/flow',
      } as Record<string, string>)[row.dataset.plat || 'flow']
        || 'https://labs.google/fx/tools/flow';
      chrome.tabs.create({ url }).catch(() => {});
    });
  }

  $('btn-pause').addEventListener('click', () => control('pause'));
  $('btn-stop').addEventListener('click', () => control('stop'));

  const gbtn = document.getElementById('gate-google') as HTMLButtonElement | null;
  gbtn?.addEventListener('click', async () => {
    const err = $('auth-error');
    err.hidden = true;
    gbtn.disabled = true;
    const original = gbtn.textContent;
    gbtn.textContent = 'Opening Google…';
    try {
      const res = await signInWithGoogle();
      if (!res.ok) {
        // Closing the window is a decision, not a failure worth shouting about.
        if (!res.cancelled) { err.hidden = false; err.textContent = res.message; }
        return;
      }
      await refreshAccount();
    } finally {
      gbtn.disabled = false;
      gbtn.textContent = original;
    }
  });

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
    // Close the sheet first, or it hangs over the gate behind it.
    const modal = document.getElementById('acct-modal');
    if (modal) (modal as HTMLElement).hidden = true;
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
    ['logs', refreshLogs],
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


/* ============================================================
   The shell: navigation, templates, prompts, footer, account.

   The panel used to be one long column of cards — run, platforms,
   diagnostics, account — all competing for a strip about 380px wide. Now the
   run view keeps that stack (it is the panel's reason to exist during a run)
   and everything else lives behind a tab, with the plan pinned to the bottom
   where it cannot scroll away.

   Templates are rendered here rather than only on the canvas: choosing what
   to build is the one thing you do BEFORE opening it, and it was the one
   thing the panel could not help with.
   ============================================================ */

type PanelView = 'build' | 'templates' | 'run';

/* ── The builder ──
   An idea in, a workflow out, with any AI chat in the middle.

   The chat is not driven from here, and that is the design rather than a
   shortcut. Three of these five have adapters in this extension; DeepSeek and
   Claude do not, and writing two more content scripts to reach them would
   make the feature depend on five sites keeping their DOM still. Copy, paste,
   done works with all five today and with whatever is popular next year.

   The model's half is small on purpose — see builder/spec.ts. Everything
   mechanical is computed by compilePlan, which puts its output through the
   same validator every shipped template passes. */
/** Chats the extension can drive end to end — these have content scripts.
    `models` is offered in a picker beside the button; the first is the
    default, and an empty value means "leave whatever the site is on". */
const AUTO_CHATS: Array<{ key: string; name: string; models?: string[] }> = [
  { key: 'chatgpt', name: 'ChatGPT' },
  { key: 'gemini', name: 'Gemini' },
  { key: 'grok', name: 'Grok' },
  /* Claude's picker reads "Sonnet 5 Max" and the suffix moves, so these are
     matched loosely by the adapter — "Opus" finds "Opus 5" and whatever it
     becomes next. */
  { key: 'claude', name: 'Claude', models: ['', 'Sonnet', 'Opus', 'Haiku'] },
  { key: 'zai', name: 'Z.AI' },
];

/** Chats it cannot, which is why the manual path stays below them. */
const MANUAL_CHATS: Array<[string, string]> = [
  ['DeepSeek', 'https://chat.deepseek.com/'],
];

/** The platform's own mark, or a neutral dot when we do not have one.
 *  Four identical dots said nothing about which chat was about to get the
 *  brief; the logo is the fastest way to read that, and people already know
 *  these shapes. */
function brandMark(key: string): Element {
  const mark = (BRAND_MARKS as Record<string, { viewBox: string; body: string; color: string }>)[key];
  if (!mark) {
    const dot = document.createElement('span');
    dot.className = 'sp-ai__dot';
    return dot;
  }
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'sp-ai__mark');
  svg.setAttribute('viewBox', mark.viewBox);
  svg.setAttribute('fill', mark.color);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  // Build-time constants generated from assets/brands — no untrusted input.
  svg.innerHTML = mark.body;
  return svg;
}

/* ── Which AI writes it ──
   Five equal brand buttons were five decisions before anything could happen,
   and none of them said which engines were signed in — so a regular user
   picked one at random, and when it was not open the run failed for a reason
   that had nothing to do with their idea.
   One button now. The engine is chosen from what is actually open, shown
   underneath, and changeable without being a question you must answer first. */
let engineOpen: Record<string, boolean> = {};

/** Preference order when several are open. Not a quality ranking — the ones
    that hold a long JSON envelope most reliably, from this repo's own runs. */
const ENGINE_ORDER = ['claude', 'chatgpt', 'gemini', 'zai', 'grok'];

function engineName(key: string): string {
  return (AUTO_CHATS.find((c) => c.key === key) || { name: key }).name;
}

/** The engine the button will use: what the user chose, or the best open one. */
function chosenEngine(): string {
  const sel = document.getElementById('build-engine') as HTMLSelectElement | null;
  if (sel && sel.value) return sel.value;
  return ENGINE_ORDER.find((k) => engineOpen[k]) || ENGINE_ORDER[0];
}

/** Fill the picker, mark what is open, and say so under the button. */
function renderEnginePicker(): void {
  const sel = document.getElementById('build-engine') as HTMLSelectElement | null;
  const hint = document.getElementById('build-engine-hint');
  if (!sel) return;

  const keep = sel.value;
  sel.innerHTML = '';
  for (const c of AUTO_CHATS) {
    const o = document.createElement('option');
    o.value = c.key;
    /* Said on the option itself rather than by disabling it. A user who wants
       ChatGPT should be able to pick ChatGPT and be told to open it, not find
       the choice greyed out with no explanation. */
    o.textContent = engineOpen[c.key] ? c.name : `${c.name} (not open)`;
    sel.append(o);
  }
  sel.value = keep && AUTO_CHATS.some((c) => c.key === keep) ? keep : chosenEngine();

  if (hint) {
    const open = engineOpen[sel.value];
    hint.textContent = open ? '' : '— open it first, or pick another';
    hint.classList.toggle('sp-ask__who-hint--warn', !open);
  }
}

/** Learn which chats are signed in, from the same worker the Activity tab asks. */
async function refreshEngineState(): Promise<void> {
  try {
    const status: any = await chrome.runtime.sendMessage({ type: 'PANEL_PLATFORM_STATUS' });
    engineOpen = {};
    for (const c of AUTO_CHATS) {
      const v = status?.[c.key];
      engineOpen[c.key] = v === 'open' || v === true;
    }
  } catch { /* leave every engine unknown rather than claiming none work */ }
  renderEnginePicker();
}

function renderAiButtons(idea: () => string): void {
  const auto = document.getElementById('build-ai');
  if (auto) {
    auto.innerHTML = '';
    for (const entry of AUTO_CHATS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'sp-ai__link sp-ai__link--auto';
      b.dataset.key = entry.key;
      b.title = `Ask ${entry.name} and load the workflow`;
      const label = document.createElement('span');
      label.textContent = entry.name;
      b.append(brandMark(entry.key), label);
      b.addEventListener('click', () => {
        const text = idea().trim();
        if (!text) { buildSays('bad', 'Describe the idea first.'); return; }
        autoBuild(entry.key, entry.name, text, pickedModel(entry.key));
      });
      auto.append(b);

      /* Only where the site has a picker worth driving. A select on every
         button would imply a choice the other adapters do not make. */
      if (entry.models && entry.models.length > 1) {
        const sel = document.createElement('select');
        sel.className = 'sp-ai__model nodrag';
        sel.id = `build-model-${entry.key}`;
        sel.title = `Model for ${entry.name}`;
        for (const m of entry.models) {
          const o = document.createElement('option');
          o.value = m;
          o.textContent = m || 'Default model';
          sel.append(o);
        }
        sel.addEventListener('change', () => {
          chrome.storage.local.set({ [`af_model_${entry.key}`]: sel.value }).catch(() => {});
        });
        chrome.storage.local.get(`af_model_${entry.key}`)
          .then((r) => { const v = r[`af_model_${entry.key}`]; if (typeof v === 'string') sel.value = v; })
          .catch(() => {});
        auto.append(sel);
      }
    }
  }

  const manual = document.getElementById('build-ai-manual');
  if (manual) {
    manual.innerHTML = '';
    for (const [name, url] of MANUAL_CHATS) {
      const a = document.createElement('button');
      a.type = 'button';
      a.className = 'sp-ai__link';
      a.title = `Open ${name} in a new tab`;
      const label = document.createElement('span');
      label.textContent = name;
      a.append(brandMark(name.toLowerCase().replace(/[^a-z]/g, '')), label);
      a.addEventListener('click', () => { chrome.tabs.create({ url }).catch(() => {}); });
      manual.append(a);
    }
  }
}

/** Hand a finished workflow to the canvas and open it. */
/* ── What it is doing, while it does it ──
   A build with two repair rounds runs for minutes. What this replaces was a
   list of appended lines, which looks identical whether the model is thinking
   or the tab has died: in both cases lines stop arriving. One live stage says
   which, and costs nothing to read. */
type BuildStage = 'write' | 'check' | 'ready';
const STAGE_ORDER: BuildStage[] = ['write', 'check', 'ready'];

function showStages(on: boolean): void {
  const box = document.getElementById('build-stages') as HTMLElement | null;
  if (box) box.hidden = !on;
  if (on) {
    for (const row of Array.from(document.querySelectorAll('.sp-stages__row'))) {
      row.classList.remove('sp-stages__row--done', 'sp-stages__row--live');
    }
    const note = document.getElementById('build-stage-note');
    if (note) note.textContent = '';
  }
}

function stage(now: BuildStage, note = ''): void {
  const at = STAGE_ORDER.indexOf(now);
  STAGE_ORDER.forEach((id, i) => {
    const row = document.querySelector(`.sp-stages__row[data-stage="${id}"]`);
    if (!row) return;
    row.classList.toggle('sp-stages__row--done', i < at);
    row.classList.toggle('sp-stages__row--live', i === at);
  });
  const el = document.getElementById('build-stage-note');
  if (el) el.textContent = note;
}

/* ── What it made, before it makes it ──
   The plan used to go straight onto the canvas. Every node on it is a
   generation somebody pays for, and this is the last moment they are still
   free — so it is shown first, with what it will cost, and built on a click. */
interface PendingBuild {
  template: any;
  /** In the user's terms, not the model's. See check.ts explainPlan. */
  warnings: string[];
  /** Kept so "make it 5 shots" is the next turn of the same conversation.
      Empty for a reply pasted by hand: there is no conversation to continue,
      and offering the box anyway would promise something that cannot work. */
  platform: string;
  name: string;
  model: string;
  /* Set when this came back from history rather than from a live
     conversation, so refine sends the plan instead of assuming the model
     still has it. */
  resumeFrom?: any;
}
let pendingBuild: PendingBuild | null = null;

/* ── Pictures of what you mean ──
   A sentence about "my product" is a great deal less use to a model than the
   product. These ride along with the build request on the same field a Story
   node uses for its reference stills, so every adapter already knows how to
   attach them. */
let refImages: string[] = [];

/** Small enough to survive a message hop and an upload. */
const REF_MAX_PX = 1024;

/** Read a picked file down to a data URL the chat tab can be given. */
function readRef(file: File): Promise<string> {
  return new Promise((resolve) => {
    const fr = new FileReader();
    fr.onerror = () => resolve('');
    fr.onload = () => {
      const img = new Image();
      img.onerror = () => resolve('');
      img.onload = () => {
        /* Downscaled here rather than sent whole. A phone photo is several
           megabytes, and it crosses two message boundaries before it reaches
           the tab that needs it. */
        const scale = Math.min(1, REF_MAX_PX / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(img.width * scale));
        c.height = Math.max(1, Math.round(img.height * scale));
        const ctx = c.getContext('2d');
        if (!ctx) return resolve('');
        ctx.drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL('image/jpeg', 0.85));
      };
      img.src = String(fr.result || '');
    };
    fr.readAsDataURL(file);
  });
}

function renderRefs(): void {
  const box = document.getElementById('build-refs') as HTMLElement | null;
  if (!box) return;
  box.hidden = !refImages.length;
  box.innerHTML = '';
  refImages.forEach((src, i) => {
    const cell = document.createElement('div');
    cell.className = 'sp-shot';
    const img = document.createElement('img');
    img.src = src;
    img.alt = '';
    const x = document.createElement('button');
    x.type = 'button';
    x.className = 'sp-shot__x';
    x.textContent = '\u2715';
    x.title = 'Remove';
    x.addEventListener('click', () => { refImages.splice(i, 1); renderRefs(); });
    cell.append(img, x);
    box.append(cell);
  });
}

/* ── What you made before ──
   A workflow is rarely right first time. Everything needed to ask for a
   change — the idea, the plan, which AI wrote it — was being discarded the
   moment it reached the canvas, so "make it 5 shots" was only ever possible
   in the thirty seconds the preview was on screen. */
interface PastBuild {
  id: string;
  idea: string;
  name: string;
  at: number;
  platform: string;
  model: string;
  template: any;
}

/** Enough to be useful, few enough that the list stays a list. */
const PAST_MAX = 12;

async function readPast(): Promise<PastBuild[]> {
  try {
    const { af_builds } = await chrome.storage.local.get('af_builds');
    return Array.isArray(af_builds) ? af_builds : [];
  } catch { return []; }
}

async function rememberBuild(b: PendingBuild, idea: string): Promise<void> {
  const past = await readPast();
  const entry: PastBuild = {
    id: `b_${Date.now().toString(36)}`,
    idea: idea.trim().slice(0, 400),
    name: String(b.template?.name || 'Workflow'),
    at: Date.now(),
    platform: b.platform,
    model: b.model,
    template: b.template,
  };
  try {
    await chrome.storage.local.set({ af_builds: [entry, ...past].slice(0, PAST_MAX) });
  } catch { /* storage full — the build still happened */ }
  renderPast();
}

/** "just now", "2h", "3d" — enough to tell one from another. */
function ago(at: number): string {
  const mins = Math.max(0, Math.round((Date.now() - at) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.round(hrs / 24)}d`;
}

async function renderPast(): Promise<void> {
  const box = document.getElementById('build-past') as HTMLElement | null;
  const list = document.getElementById('build-past-list');
  if (!box || !list) return;
  const past = await readPast();
  box.hidden = !past.length;
  list.innerHTML = '';
  for (const b of past) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'sp-past__item';
    const idea = document.createElement('span');
    idea.className = 'sp-past__idea';
    idea.textContent = b.idea || b.name;
    const when = document.createElement('span');
    when.className = 'sp-past__when';
    when.textContent = ago(b.at);
    row.append(idea, when);
    row.title = `${b.name} — reopen to change it`;
    row.addEventListener('click', () => reopenBuild(b));
    list.append(row);
  }
}

/**
 * Bring a past build back, with the refine box working.
 *
 * The chat tab it was written in is long gone, so this cannot resume that
 * conversation — and pretending otherwise is how the builder used to send
 * repairs into a fresh chat that had never seen the plan. It starts a new one
 * and hands over the plan as context, which is the honest version and the one
 * that actually produces a changed plan rather than a different piece.
 */
function reopenBuild(b: PastBuild): void {
  const idea = document.getElementById('build-idea') as HTMLTextAreaElement | null;
  if (idea) {
    idea.value = b.idea;
    idea.dispatchEvent(new Event('input'));
  }
  showStages(false);
  const out = document.getElementById('build-out') as HTMLElement | null;
  if (out) out.hidden = true;
  showPlan({
    template: b.template,
    warnings: [],
    platform: b.platform,
    name: engineName(b.platform),
    model: b.model,
    /* The conversation is gone; the plan is not. */
    resumeFrom: b.template,
  });
}

/** How many nodes on this template actually spend something. */
function generationCount(template: any): number {
  return (template?.nodes || []).filter((n: any) => isRunnableType(n.type)).length;
}

/**
 * The shots, and everything that is not a shot.
 *
 * A workflow is a graph, and the old preview showed it as one — a row per
 * node, including the prompt box, the writer and the frame handoffs. Reading
 * "Story — writes all three" and "Ends on → Shot 2" tells you nothing about
 * the video, and those are the rows somebody is being asked to spend four
 * generations on.
 *
 * A shot is a node that produces something you will watch. Everything else is
 * plumbing — real, necessary, and not what the decision is about — so it is
 * counted in one line instead of listed.
 */
function splitPlan(template: any): { shots: any[]; helpers: any[] } {
  const shots: any[] = [];
  const helpers: any[] = [];
  for (const n of (template?.nodes || [])) {
    const media = n?.data?.mediaType;
    const isShot = n.type === 'generate' && (media === 'video' || media === 'image');
    (isShot ? shots : helpers).push(n);
  }
  return { shots, helpers };
}

/** "24 seconds, 3 shots" — the piece, in the words somebody would use for it. */
function describeSize(shots: any[]): string {
  const clips = shots.filter((n) => n.data?.mediaType === 'video');
  const stills = shots.length - clips.length;
  const seconds = clips.reduce(
    (n, c) => n + (parseFloat(String(c.data?.duration || '')) || 0), 0);
  const parts: string[] = [];
  if (seconds) parts.push(`${Math.round(seconds)} seconds`);
  if (clips.length) parts.push(`${clips.length} clip${clips.length === 1 ? '' : 's'}`);
  if (stills) parts.push(`${stills} image${stills === 1 ? '' : 's'}`);
  return parts.join(', ') || 'A workflow';
}

/** What each helper node is for, in one phrase. */
function helperName(n: any): string {
  if (n.type === 'story') return 'a writer for the shots';
  if (n.type === 'frame') return 'a frame handoff';
  if (n.type === 'prompt') return 'your idea';
  if (n.type === 'image') return 'a picture you supply';
  if (n.type === 'extend') return 'a clip extension';
  return 'a step';
}

function planRow(n: any): HTMLElement {
  const li = document.createElement('li');
  li.className = 'sp-plan__shot';
  const label = document.createElement('span');
  label.className = 'sp-plan__label';
  label.textContent = String(n.data?.label || n.id);
  const meta = document.createElement('span');
  meta.className = 'sp-plan__meta';
  const d = n.data || {};
  meta.textContent = d.mediaType === 'video' ? String(d.duration || 'clip') : 'image';
  li.append(label, meta);
  return li;
}

function hidePlan(): void {
  pendingBuild = null;
  const box = document.getElementById('build-plan') as HTMLElement | null;
  if (box) box.hidden = true;
}

function showPlan(b: PendingBuild): void {
  pendingBuild = b;
  const box = document.getElementById('build-plan') as HTMLElement | null;
  if (!box) return;
  box.hidden = false;

  const { shots, helpers } = splitPlan(b.template);
  const runs = generationCount(b.template);

  const size = document.getElementById('build-plan-size');
  if (size) size.textContent = describeSize(shots);

  const cost = document.getElementById('build-plan-cost');
  if (cost) cost.textContent = `${runs} generation${runs === 1 ? '' : 's'}`;

  const sub = document.getElementById('build-plan-sub');
  if (sub) sub.textContent = String(b.template?.description || '');

  const list = document.getElementById('build-plan-shots');
  if (list) {
    list.innerHTML = '';
    for (const n of shots) list.append(planRow(n));
  }

  /* The plumbing, counted rather than listed. */
  const helperLine = document.getElementById('build-plan-helpers') as HTMLElement | null;
  if (helperLine) {
    const named = Array.from(new Set(helpers.map(helperName)));
    helperLine.hidden = !named.length;
    helperLine.textContent = named.length
      ? `Plus ${helpers.length} step${helpers.length === 1 ? '' : 's'} that make it work: ${
        named.join(', ')}.`
      : '';
  }

  const warn = document.getElementById('build-plan-warn') as HTMLElement | null;
  if (warn) {
    warn.hidden = !b.warnings.length;
    warn.innerHTML = '';
    if (b.warnings.length) {
      const t = document.createElement('div');
      t.className = 'sp-plan__warn-title';
      t.textContent = b.warnings.length === 1
        ? 'One thing to know' : `${b.warnings.length} things to know`;
      const ul = document.createElement('ul');
      for (const line of b.warnings) {
        const li = document.createElement('li');
        li.textContent = line;
        ul.append(li);
      }
      warn.append(t, ul);
    }
  }

  const ask = document.getElementById('build-refine') as HTMLInputElement | null;
  if (ask) ask.value = '';
  const refine = document.querySelector('.sp-plan__refine') as HTMLElement | null;
  if (refine) refine.hidden = !b.platform;
}

/**
 * Read a reply the whole way: is it a plan, does it compile, is it any good.
 *
 * One function because the first ask, every repair round and every later
 * refinement all need exactly this, and three copies of it is three places for
 * the definition of "good enough to build" to drift apart.
 */
function evaluateReply(text: string): {
  plan: any; template: any; quality: PlanProblem[]; problems: string[]; problem?: string;
} {
  const { plan, problem } = readPlan(text);
  if (!plan) return { plan: null, template: null, quality: [], problems: [], problem };
  const quality = checkPlan(plan);
  const { template, problems } = compilePlan(plan);
  return { plan, template, quality, problems };
}

async function openBuilt(template: any): Promise<void> {
  /* Parked whole rather than by id: the gallery looks an id up in the
     published list, and this workflow exists nowhere but here. */
  await chrome.storage.local.set({ af_pending_workflow: template });
  const steps = template.nodes.filter((n: any) => isRunnableType(n.type)).length;
  buildSays('ok', `Built "${template.name}"`, [
    `${template.nodes.length} nodes, ${steps} of them run`,
    'Opening the canvas…',
  ]);
  /* Offered here because this is the moment someone has something worth
     sharing, and the panel has the finished template in hand. */
  const box = document.getElementById('build-out');
  if (box) {
    const share = document.createElement('button');
    share.className = 'sp-btn sp-btn--ghost';
    share.style.marginTop = '8px';
    share.textContent = 'Share to community';
    share.addEventListener('click', () => {
      share.disabled = true;
      shareBuilt(template);
    });
    box.append(share);
  }
  chrome.runtime.sendMessage({ type: 'PANEL_OPEN_STUDIO' }).catch(() => {});
}

/** Disable every build button, so one run cannot be started twice. */
function setBuilding(on: boolean, activeKey?: string): void {
  const go = document.getElementById('build-go-ai') as HTMLButtonElement | null;
  if (go) {
    go.disabled = on || !(document.getElementById('build-idea') as HTMLTextAreaElement | null)?.value.trim();
    go.classList.toggle('sp-ask__go--busy', on);
    const label = go.querySelector('.sp-ask__go-label');
    if (label) label.textContent = on ? `${engineName(activeKey || chosenEngine())} is working…` : 'Make it';
  }
  const sel = document.getElementById('build-engine') as HTMLSelectElement | null;
  if (sel) sel.disabled = on;
}

/** Set by Cancel, read at the top of each repair round. */
let buildAborted = false;

/**
 * The whole thing, unattended: open the chat, ask, read the answer, compile
 * it, load it.
 *
 * The worker owns the tab rather than the panel, because it already knows how
 * to find or open one, wait for it to be ready, and re-inject a content script
 * into a tab that predates the extension. Duplicating that here would be a
 * second copy of the part most likely to be wrong.
 */
function pickedModel(key: string): string {
  const sel = document.getElementById(`build-model-${key}`) as HTMLSelectElement | null;
  return sel ? sel.value : '';
}

/**
 * Ask, check, repair, build.
 *
 * This used to be one question and one answer: if the reply did not compile it
 * was dropped into the manual box with the problems listed, and fixing it was
 * the user's job. But the problems are already written in the model's own
 * terms — "step X takes input Y, which is not a step" — which is exactly what
 * you would paste back yourself. So it pastes them back.
 *
 * Two kinds of problem go into that message. compilePlan's are structural: the
 * plan cannot become a canvas at all. checkPlan's are worse, because they
 * compile — a step folding five shots into one generation, a chain of clips
 * with nothing carrying one into the next, a voice on a shot Flow will
 * generate silent. Those the user pays for before finding out.
 *
 * Two repairs, then stop. Three rounds of a model that has not understood is
 * three rounds of the same reply, and the manual box is still there.
 */
const MAX_BUILD_REPAIRS = 2;

async function autoBuild(key: string, name: string, idea: string, model = ''): Promise<void> {
  setBuilding(true, key);
  buildAborted = false;
  hidePlan();
  showStages(true);
  const box = document.getElementById('build-out') as HTMLElement | null;
  if (box) box.hidden = true;

  /* The best plan seen so far, across every round.
     Round 2 is not reliably better than round 1 — a model asked to fix three
     things sometimes returns two fixed and a fourth broken — so keeping the
     one with the fewest problems is the difference between shipping the good
     attempt and shipping the last one. */
  let best: { template: any; quality: PlanProblem[] } | null = null;
  let lastReply = '';

  try {
    let message = buildSpec(idea);

    for (let round = 0; round <= MAX_BUILD_REPAIRS; round++) {
      if (buildAborted) return;
      stage('write', round === 0
        ? `${name} is writing them. This usually takes a minute or two.`
        : `${name} is fixing ${round === 1 ? 'what was wrong' : 'the rest'} — same conversation, so it keeps what worked.`);

      const res: any = await chrome.runtime.sendMessage({
        type: 'PANEL_BUILD', platform: key, prompt: message, model,
        /* First turn only. A repair is the next message in the same
           conversation and the pictures are already above it — sending them
           again would re-upload for nothing. */
        images: round === 0 ? refImages : [],
        /* A repair is the next turn of THIS conversation. Sent as a new chat
           it refers to a plan the model has never seen, and every repair round
           was doing exactly that — which is why the second attempt came back
           smaller than the first rather than fixed. The Story node's own loop
           has always done this correctly; the builder never did. */
        newChat: round === 0 ? 'auto' : 'never',
      });
      if (!res || res.error) {
        showStages(false);
        buildSays('bad', `${name} could not answer`, [
          res?.error || 'No reply from the extension worker.',
        ]);
        return;
      }
      if (buildAborted) return;
      lastReply = String(res.text || '');

      stage('check', 'Reading what came back…');
      const { plan, template, quality, problems, problem } = evaluateReply(lastReply);

      if (!plan) {
        /* Not a plan at all. Worth one more round — a model that wrapped its
           JSON in prose fixes that on being told. */
        if (round < MAX_BUILD_REPAIRS) {
          stage('write', problem || 'That reply was not usable. Asking again…');
          message = repairPlanMessage([], [problem || 'The reply was not a JSON object with a "steps" array.']);
          continue;
        }
        break;
      }

      stage('check', quality.length + problems.length
        ? `${plan.steps.length} steps back — checking what they would produce…`
        : `${plan.steps.length} steps back, nothing to fix.`);

      /* Structural problems mean there is no canvas to keep. Quality problems
         mean there is one, and it is worth keeping even if a later round never
         improves on it. */
      if (template && (!best || quality.length < best.quality.length)) {
        best = { template, quality };
      }

      if (template && !quality.length && !problems.length) break;
      if (round === MAX_BUILD_REPAIRS) break;
      message = repairPlanMessage(quality, problems);
    }

    if (best) {
      /* Every problem left is one that compiles, opens and runs — check.ts
         says so at the top of the file. This used to throw that away and hand
         over raw JSON with "fix it and build again", which turned a workflow
         that was 90% right into no workflow at all. Now it is offered, with
         what is wrong with it said plainly. */
      stage('ready', best.quality.length
        ? 'Ready — a few things worth knowing before you make it.'
        : 'Ready.');
      showPlan({
        template: best.template,
        warnings: explainPlan(best.quality),
        platform: key, name, model,
      });
      return;
    }

    /* Nothing compiled at all, in any round. Keep the reply rather than throw
       it away: a near miss is worth editing by hand, and the manual box is
       where that happens. */
    showStages(false);
    const replyBox = document.getElementById('build-reply') as HTMLTextAreaElement | null;
    if (replyBox) replyBox.value = lastReply;
    const details = document.getElementById('build-manual') as HTMLDetailsElement | null;
    if (details) details.open = true;
    buildSays('bad', `${name} could not get to a workflow`, [
      'The last reply is in the box below if you want to fix it and build again.',
    ]);
  } catch (e: any) {
    showStages(false);
    buildSays('bad', 'The build could not run', [e?.message || String(e)]);
  } finally {
    setBuilding(false);
  }
}

/**
 * Change something about the plan that is already on screen.
 *
 * The next turn of the same conversation, which is the whole point: the model
 * still has the plan it wrote, so "make it 5 shots" is a small edit rather
 * than a fresh brief that has to rediscover everything the first one settled.
 * Starting over was the only option before this, and it lost the parts that
 * were already right.
 */
async function refineBuild(text: string): Promise<void> {
  const at = pendingBuild;
  if (!at || !text.trim()) return;
  const ask = document.getElementById('build-refine-go') as HTMLButtonElement | null;
  if (ask) ask.disabled = true;
  showStages(true);
  stage('write', `Asking ${at.name} to change it…`);

  const carry = at.resumeFrom
    ? `Here is a workflow plan:\n\n${JSON.stringify(at.resumeFrom, null, 1)}\n\n`
    : '';

  try {
    const res: any = await chrome.runtime.sendMessage({
      type: 'PANEL_BUILD', platform: at.platform, model: at.model,
      /* A plan reopened from history is being shown to a model that has never
         seen it, so it travels with the message. A live one is the next turn
         of the conversation that produced it and does not — re-sending it
         would waste the context that thread already holds. */
      newChat: at.resumeFrom ? 'auto' : 'never',
      prompt: `${carry}${text.trim()}\n\nApply that to ${
        at.resumeFrom ? 'that plan' : 'the plan you just wrote'} and send the `
        + 'complete JSON object again — the same shape, with everything else unchanged. '
        + 'No prose around it, no code fence.',
    });
    if (!res || res.error) {
      stage('write', res?.error || 'No reply.');
      return;
    }

    stage('check', 'Reading the change…');
    const { plan, template, quality, problems } = evaluateReply(String(res.text || ''));
    if (!plan || !template || problems.length) {
      /* The plan on screen is still good. Saying so matters: silently keeping
         it would look like the change was applied. */
      stage('check', 'That came back unusable — keeping the plan you already have.');
      return;
    }

    stage('ready', quality.length ? 'Changed — a few things worth knowing.' : 'Changed.');
    showPlan({ ...at, template, warnings: explainPlan(quality), resumeFrom: undefined });
  } catch (e: any) {
    stage('write', e?.message || 'The change could not be asked for.');
  } finally {
    if (ask) ask.disabled = false;
  }
}

function buildSays(kind: 'ok' | 'bad' | 'info', title: string, lines: string[] = []): void {
  const box = document.getElementById('build-out');
  if (!box) return;
  box.hidden = false;
  box.className = `sp-buildout ${kind === 'ok' ? 'sp-buildout--ok' : kind === 'bad' ? 'sp-buildout--bad' : ''}`;
  box.innerHTML = '';
  const h = document.createElement('div');
  h.className = 'sp-buildout__title';
  h.textContent = title;
  box.append(h);
  if (lines.length) {
    const ul = document.createElement('ul');
    for (const line of lines) {
      const li = document.createElement('li');
      li.textContent = line;
      ul.append(li);
    }
    box.append(ul);
  }
}

function wireBuilder(): void {
  const idea = document.getElementById('build-idea') as HTMLTextAreaElement | null;
  const reply = document.getElementById('build-reply') as HTMLTextAreaElement | null;
  const copy = document.getElementById('build-copy');
  const go = document.getElementById('build-go');
  const clearBtn = document.getElementById('build-idea-clear') as HTMLButtonElement | null;
  if (!idea || !reply || !copy || !go) return;

  renderAiButtons(() => idea.value);

  /* The one button, and the engine under it. */
  refreshEngineState();
  const engineSel = document.getElementById('build-engine') as HTMLSelectElement | null;
  if (engineSel) engineSel.addEventListener('change', () => renderEnginePicker());

  const goBtn = document.getElementById('build-go-ai') as HTMLButtonElement | null;
  const how = document.getElementById('build-how') as HTMLElement | null;
  const syncGo = () => {
    const typed = !!idea.value.trim();
    if (goBtn) goBtn.disabled = !typed;
    /* Read once and then in the way. It fills the space that otherwise reads
       as unfinished, and stops filling it the moment it has done its job. */
    if (how) how.hidden = typed;
  };
  if (goBtn) {
    goBtn.addEventListener('click', () => {
      const text = idea.value.trim();
      if (!text) return;
      const key = chosenEngine();
      autoBuild(key, engineName(key), text, pickedModel(key));
    });
  }
  idea.addEventListener('input', syncGo);
  syncGo();

  /* Ctrl/Cmd+Enter, because a box you type a sentence into is a box people
     try to submit from. */
  idea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      goBtn?.click();
    }
  });

  const cancel = document.getElementById('build-cancel');
  if (cancel) {
    cancel.addEventListener('click', () => {
      buildAborted = true;
      showStages(false);
      buildSays('info', 'Stopped. Nothing was built.');
    });
  }

  /* Pictures for the AI. */
  const addImg = document.getElementById('build-add-image') as HTMLButtonElement | null;
  const imgInput = document.getElementById('build-image-input') as HTMLInputElement | null;
  if (addImg && imgInput) {
    addImg.addEventListener('click', () => imgInput.click());
    imgInput.addEventListener('change', async () => {
      for (const f of Array.from(imgInput.files || [])) {
        if (refImages.length >= 4) break;   // a chat tab will not take many
        const data = await readRef(f);
        if (data) refImages.push(data);
      }
      imgInput.value = '';
      renderRefs();
    });
  }

  /* What was built before. */
  renderPast();
  const pastClear = document.getElementById('build-past-clear');
  if (pastClear) {
    pastClear.addEventListener('click', async () => {
      try { await chrome.storage.local.set({ af_builds: [] }); } catch { /* ignore */ }
      renderPast();
    });
  }

  const toLibrary = document.getElementById('build-open-library');
  if (toLibrary) toLibrary.addEventListener('click', () => showView('templates'));

  /* The preview's own controls. Build hands over what is already on screen;
     Discard drops it without touching the canvas, which is the point of
     having a preview at all. */
  const planGo = document.getElementById('build-plan-go');
  if (planGo) {
    planGo.addEventListener('click', async () => {
      const at = pendingBuild;
      if (!at) return;
      (planGo as HTMLButtonElement).disabled = true;
      try {
        await openBuilt(at.template);
        await rememberBuild(at, (document.getElementById('build-idea') as HTMLTextAreaElement | null)?.value || '');
        hidePlan();
        showStages(false);
      } catch {
        buildSays('bad', 'Could not hand the workflow to the canvas — storage is unavailable.');
      } finally {
        (planGo as HTMLButtonElement).disabled = false;
      }
    });
  }
  const planDrop = document.getElementById('build-plan-drop');
  if (planDrop) {
    planDrop.addEventListener('click', () => { hidePlan(); showStages(false); });
  }

  const refineBox = document.getElementById('build-refine') as HTMLInputElement | null;
  const refineGo = document.getElementById('build-refine-go');
  if (refineGo && refineBox) {
    const send = () => { const t = refineBox.value; refineBox.value = ''; refineBuild(t); };
    refineGo.addEventListener('click', send);
    // Enter, because a one-line box that needs a button click is a box people
    // press Enter in and then wonder why nothing happened.
    refineBox.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); send(); }
    });
  }

  const syncClear = () => {
    if (clearBtn) clearBtn.hidden = !idea.value.trim();
  };

  // What was typed survives the panel closing; an idea is worth keeping.
  chrome.storage.local.get('af_build_idea')
    .then(({ af_build_idea }) => {
      if (af_build_idea && !idea.value) idea.value = af_build_idea;
      syncClear();
    })
    .catch(() => {});
  idea.addEventListener('input', () => {
    chrome.storage.local.set({ af_build_idea: idea.value }).catch(() => {});
    syncClear();
  });

  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      idea.value = '';
      chrome.storage.local.set({ af_build_idea: '' }).catch(() => {});
      syncClear();
      idea.focus();
    });
  }

  /* Starters fill the box rather than building straight away. The sentence is
     a starting point, not the brief — most people want to change a word or
     two first, and a button that skipped ahead would take that away. */
  for (const btn of Array.from(document.querySelectorAll<HTMLButtonElement>('.sp-idea'))) {
    btn.addEventListener('click', () => {
      const text = btn.dataset.prompt || (btn.querySelector('.sp-idea__text') || btn).textContent || '';
      idea.value = text.trim();
      chrome.storage.local.set({ af_build_idea: idea.value }).catch(() => {});
      idea.focus();
      idea.setSelectionRange(idea.value.length, idea.value.length);
    });
  }

  copy.addEventListener('click', async () => {
    const text = idea.value.trim();
    if (!text) {
      buildSays('bad', 'Describe the idea first.');
      idea.focus();
      return;
    }
    try {
      await navigator.clipboard.writeText(buildSpec(text));
      buildSays('ok', 'Brief copied — paste it into any chat above.');
    } catch {
      /* Clipboard can be refused. Putting the brief in the reply box is a
         worse place for it than the clipboard but a much better place than
         nowhere: it can still be selected and copied by hand. */
      reply.value = buildSpec(text);
      reply.select();
      buildSays('info', 'Clipboard blocked — the brief is in the box below, selected. Copy it, then paste the reply over it.');
    }
  });

  go.addEventListener('click', async () => {
    const text = reply.value.trim();
    if (!text) {
      buildSays('bad', 'Paste the chat reply first.');
      reply.focus();
      return;
    }

    const { template, quality, problems } = evaluateReply(text);
    if (!template) {
      buildSays('bad', 'That reply could not be turned into a workflow', problems);
      return;
    }

    /* It compiles. That is not the same as it being any good, and this path
       has no model to send a repair to — so say what is wrong and offer it
       anyway. Refusing would be worse: a plan pasted by hand is usually one
       the user is already editing.

       The same preview as the driven path, so what happens next does not
       depend on which button got you here. Without a conversation behind it,
       though — hence the empty platform. */
    const box = document.getElementById('build-out') as HTMLElement | null;
    if (box) box.hidden = true;
    showStages(false);
    showPlan({
      template, warnings: explainPlan(quality), platform: '', name: '', model: '',
    });
  });
}

/** Templates currently shown, and the category filter over them. */
let panelTemplates: Template[] = [];
let panelCategory = 'All';
let panelQuery = '';

function showView(view: PanelView): void {
  for (const id of ['build', 'templates', 'run'] as PanelView[]) {
    const el = document.getElementById(`view-${id}`);
    if (el) (el as HTMLElement).hidden = id !== view;
  }
  document.querySelectorAll('.sp-nav__tab').forEach((b) => {
    const on = (b as HTMLElement).dataset.view === view;
    b.classList.toggle('sp-nav__tab--on', on);
    b.setAttribute('aria-selected', String(on));
  });
  // A tab switch that leaves you where the last one was scrolled reads as the
  // click having done nothing.
  const main = document.querySelector('.sp-main');
  if (main) main.scrollTop = 0;
}

/**
 * Hand a template to the canvas.
 *
 * The panel cannot mount the canvas's React tree, so it parks the choice and
 * asks for the canvas to open; TemplateGallery picks it up on mount. Storage
 * rather than a message because the canvas may not exist yet to receive one.
 */
async function openTemplate(id: string): Promise<void> {
  try { await chrome.storage.local.set({ af_pending_template: id }); } catch { /* best effort */ }
  chrome.runtime.sendMessage({ type: 'PANEL_OPEN_STUDIO' }).catch(() => {});
}

/* ── Community templates ──────────────────────────────────────
   Other people's workflows. Kept in their own list and behind their own tab
   rather than merged into the official grid: the two have different authors,
   different guarantees and different failure modes, and a card that does not
   say which it is invites the assumption that we vouch for all of them.

   Everything here degrades to the official gallery. A failed fetch returns an
   empty list rather than throwing, because the curated templates are always
   there and losing them to a community outage would be the worse bug. */

type TemplateSourceTab = 'official' | 'community';
let templateSource: TemplateSourceTab = 'official';
let communityCards: CommunityCard[] = [];
let communityLoaded = false;

function heartSvg(): string {
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20s-7-4.35-7-9a4 4 0 0 1 7-2.65A4 4 0 0 1 19 11c0 4.65-7 9-7 9z"/></svg>';
}

/** Open a community template: fetch the graph, then hand it to the canvas. */
async function openCommunity(card: CommunityCard): Promise<void> {
  const count = document.getElementById('tpl-count');
  if (count) count.textContent = `Opening "${card.name}"…`;

  const full = await getCommunityTemplate(card.id);
  if (!full?.payload) {
    if (count) count.textContent = 'That template could not be loaded.';
    return;
  }
  /* Given a fresh id so it cannot collide with a bundled template, and so
     opening the same shared workflow twice does not reuse one canvas. */
  const template = { ...full.payload, id: `community_${Date.now().toString(36)}` };
  try {
    await chrome.storage.local.set({ af_pending_workflow: template });
    chrome.runtime.sendMessage({ type: 'PANEL_OPEN_STUDIO' }).catch(() => {});
    if (count) count.textContent = `Opened "${card.name}" on the canvas.`;
  } catch {
    if (count) count.textContent = 'Could not hand that template to the canvas.';
  }
}

function renderCommunity(): void {
  const grid = document.getElementById('tpl-grid');
  const count = document.getElementById('tpl-count');
  if (!grid) return;

  const q = panelQuery.trim().toLowerCase();
  const visible = communityCards.filter(
    (c) => !q || `${c.name} ${c.description} ${c.author}`.toLowerCase().includes(q),
  );

  grid.innerHTML = '';
  if (!visible.length) {
    const empty = document.createElement('div');
    empty.className = 'sp-empty';
    empty.textContent = communityLoaded
      ? (communityCards.length ? 'Nothing matches that search.' : 'Nobody has shared a template yet.')
      : 'Loading shared templates…';
    grid.append(empty);
    if (count) count.textContent = '';
    return;
  }
  if (count) count.textContent = `${visible.length} shared`;

  for (const card of visible) {
    const el = document.createElement('button');
    el.className = 'sp-tpl';
    el.title = card.description || card.name;

    const thumb = document.createElement('div');
    thumb.className = 'sp-tpl__thumb';
    thumb.textContent = card.thumbnail || '🧩';

    const body = document.createElement('div');
    body.className = 'sp-tpl__body';
    const name = document.createElement('div');
    name.className = 'sp-tpl__name';
    name.textContent = card.name;

    const meta = document.createElement('div');
    meta.className = 'sp-tpl__meta';
    const by = document.createElement('span');
    by.className = 'sp-tpl__by';
    by.textContent = `by ${card.author}`;
    const sep = document.createElement('span');
    sep.className = 'sp-tpl__sep';
    sep.textContent = '·';
    const steps = document.createElement('span');
    steps.textContent = `${card.nodeCount} ${card.nodeCount === 1 ? 'step' : 'steps'}`;

    const stats = document.createElement('span');
    stats.className = 'sp-tpl__stats';

    const like = document.createElement('span');
    like.className = `sp-like ${card.liked ? 'sp-like--on' : ''}`;
    like.setAttribute('role', 'button');
    like.tabIndex = 0;
    like.title = card.liked ? 'Remove your like' : 'Like this template';
    like.innerHTML = `${heartSvg()}<span>${card.likes}</span>`;
    /* Stops the card opening. A like is not a request to load the workflow,
       and treating it as one would spend an install on every tap. */
    const toggle = async (e: Event) => {
      e.stopPropagation();
      e.preventDefault();
      const res = await likeCommunityTemplate(card.id);
      if (!res.ok) { if (count) count.textContent = res.message || 'Could not like that.'; return; }
      card.liked = !!res.liked;
      card.likes = res.likes ?? card.likes;
      like.className = `sp-like ${card.liked ? 'sp-like--on' : ''}`;
      like.innerHTML = `${heartSvg()}<span>${card.likes}</span>`;
    };
    like.addEventListener('click', toggle);
    like.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Enter' || (e as KeyboardEvent).key === ' ') toggle(e);
    });

    const installs = document.createElement('span');
    installs.className = 'sp-installs';
    installs.textContent = `${card.installs} used`;

    stats.append(like, installs);
    meta.append(by, sep, steps, stats);
    body.append(name, meta);
    el.append(thumb, body);
    el.addEventListener('click', () => openCommunity(card));
    grid.append(el);
  }
}

async function loadCommunity(force = false): Promise<void> {
  if (communityLoaded && !force) { renderCommunity(); return; }
  renderCommunity();                       // shows the loading line
  communityCards = await listCommunityTemplates('top');
  communityLoaded = true;
  renderCommunity();
}

function setTemplateSource(next: TemplateSourceTab): void {
  templateSource = next;
  for (const [id, key] of [['src-official', 'official'], ['src-community', 'community']] as const) {
    const b = document.getElementById(id);
    if (!b) continue;
    b.classList.toggle('sp-seg2__btn--on', key === next);
    b.setAttribute('aria-selected', String(key === next));
  }
  // Categories filter the official set only; they mean nothing to the other.
  const pills = document.getElementById('tpl-pills');
  if (pills) (pills as HTMLElement).hidden = next === 'community';

  if (next === 'community') loadCommunity();
  else renderTemplates();
}

/** Share the workflow the Build tab just made. */
async function shareBuilt(template: any): Promise<void> {
  const who = (document.getElementById('foot-acct')?.textContent || '').trim();
  const res = await submitCommunityTemplate(template, who.includes('@') ? who.split('@')[0] : who);
  buildSays(res.ok ? 'ok' : 'bad', res.message);
}

function renderPills(): void {
  const host = document.getElementById('tpl-pills');
  if (!host) return;
  const cats = ['All', ...Array.from(new Set(panelTemplates.map((t) => t.category))).sort()];
  host.innerHTML = '';
  for (const cat of cats) {
    const b = document.createElement('button');
    b.className = `sp-pill ${cat === panelCategory ? 'sp-pill--on' : ''}`;
    b.textContent = cat;
    b.addEventListener('click', () => { panelCategory = cat; renderPills(); renderTemplates(); });
    host.append(b);
  }
}

function renderTemplates(): void {
  const grid = document.getElementById('tpl-grid');
  if (!grid) return;

  const q = panelQuery.trim().toLowerCase();
  const visible = panelTemplates.filter((t) => {
    if (panelCategory !== 'All' && t.category !== panelCategory) return false;
    if (!q) return true;
    return `${t.name} ${t.description} ${t.useCase} ${t.category}`.toLowerCase().includes(q);
  });

  const count = document.getElementById('tpl-count');

  grid.innerHTML = '';
  if (!visible.length) {
    const empty = document.createElement('div');
    empty.className = 'sp-empty';
    empty.textContent = panelTemplates.length
      ? 'No templates match that search.'
      : 'Loading templates…';
    grid.append(empty);
    if (count) count.textContent = '';
    return;
  }

  for (const t of visible) {
    const card = document.createElement('button');
    card.className = `sp-tpl ${(t as any).locked ? 'sp-tpl--locked' : ''}`;
    card.title = t.useCase;

    const thumb = document.createElement('div');
    thumb.className = 'sp-tpl__thumb';
    thumb.textContent = t.thumbnail;

    const body = document.createElement('div');
    body.className = 'sp-tpl__body';

    const name = document.createElement('div');
    name.className = 'sp-tpl__name';
    name.textContent = t.name;

    const meta = document.createElement('div');
    meta.className = 'sp-tpl__meta';
    /* Only what the template actually declares. No ratings and no install
       counts: nothing in this extension or the backend records either, and a
       card claiming "4.8 from 660 users" would be inventing them.

       "8 steps" rather than "⚙ 8" — the glyph was doing the work of a word it
       could not do, and rendered as a clock on this machine's emoji font. */
    const cat = document.createElement('span');
    cat.textContent = t.category;
    const sep = document.createElement('span');
    sep.className = 'sp-tpl__sep';
    sep.textContent = '·';
    const nodes = document.createElement('span');
    nodes.textContent = `${t.nodeCount} ${t.nodeCount === 1 ? 'step' : 'steps'}`;
    meta.append(cat, sep, nodes);

    body.append(name, meta);
    card.append(thumb, body);
    if ((t as any).locked) {
      const lock = document.createElement('span');
      lock.className = 'sp-tpl__lock';
      lock.textContent = 'PRO';
      card.append(lock);
    }
    card.addEventListener('click', () => openTemplate(t.id));
    grid.append(card);
  }

  /* How many of how many. Filtering used to give no feedback beyond the grid
     getting shorter, which reads the same as a template having gone missing. */
  if (count) {
    count.textContent = visible.length === panelTemplates.length
      ? `${visible.length} template${visible.length === 1 ? '' : 's'}`
      : `${visible.length} of ${panelTemplates.length}`;
  }
}

function renderPresets(): void {
  const host = document.getElementById('preset-list');
  if (!host) return;
  host.innerHTML = '';
  for (const p of getAskPresets()) {
    const row = document.createElement('div');
    row.className = 'sp-preset';
    const head = document.createElement('div');
    head.className = 'sp-preset__head';
    const nm = document.createElement('span');
    nm.className = 'sp-preset__name';
    nm.textContent = p.name;
    const id = document.createElement('code');
    id.className = 'sp-preset__id';
    id.textContent = p.id;
    head.append(nm, id);
    const hint = document.createElement('p');
    hint.className = 'sp-preset__hint';
    hint.textContent = p.hint;
    row.append(head, hint);
    host.append(row);
  }
}

/** The footer states the plan and what is left of it. */
function renderFooter(email: string | null, isPro: boolean, used: number, limit: number): void {
  const plan = document.getElementById('foot-plan');
  if (plan) {
    plan.textContent = isPro ? 'PRO' : 'FREE';
    plan.classList.toggle('sp-foot__plan--pro', isPro);
  }
  const acct = document.getElementById('foot-acct');
  if (acct) acct.textContent = email || 'Sign in';
  const runs = document.getElementById('foot-runs');
  // A Pro account has no monthly ceiling, so "n/15" against it would be false.
  if (runs) {
    runs.textContent = isPro ? 'Unlimited' : `${used}/${limit} runs`;
    /* Turns warm on the last three, matching the usage bar in the account
       sheet. This is the number that decides whether the next Run is refused,
       and it used to be 9px grey at 4:1 — present, but not readable. */
    runs.classList.toggle('sp-foot__stat--low', !isPro && used >= limit - 3);
  }
  const avatar = document.getElementById('top-avatar');
  if (avatar) avatar.textContent = email ? email.charAt(0).toUpperCase() : '👤';
}

function wireShell(): void {
  document.getElementById('sp-nav')?.addEventListener('click', (e) => {
    const tab = (e.target as HTMLElement).closest('.sp-nav__tab') as HTMLElement | null;
    if (tab?.dataset.view) showView(tab.dataset.view as PanelView);
  });

  const modal = document.getElementById('acct-modal');
  const openModal = () => { if (modal) (modal as HTMLElement).hidden = false; };
  const closeModal = () => { if (modal) (modal as HTMLElement).hidden = true; };
  document.getElementById('btn-account')?.addEventListener('click', openModal);
  document.getElementById('foot-acct')?.addEventListener('click', openModal);
  document.getElementById('acct-close')?.addEventListener('click', closeModal);
  modal?.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

  const search = document.getElementById('tpl-search') as HTMLInputElement | null;
  search?.addEventListener('input', () => {
    panelQuery = search.value;
    if (templateSource === 'community') renderCommunity();
    else renderTemplates();
  });
  document.getElementById('src-official')?.addEventListener('click', () => setTemplateSource('official'));
  document.getElementById('src-community')?.addEventListener('click', () => setTemplateSource('community'));

  renderPresets();
  renderTemplates();
  wireBuilder();

  /* Templates come from the cache, the bundle, or the backend — the loader
     never waits on the network, so the grid fills immediately and improves. */
  loadTemplates()
    .then(({ templates }) => {
      panelTemplates = templates;
      renderPills();
      renderTemplates();
      return refreshTemplates();
    })
    .then((fresher) => {
      if (!fresher) return;
      panelTemplates = fresher.templates;
      renderPills();
      renderTemplates();
    })
    .catch(() => { /* the bundle is the floor; a failed refresh changes nothing */ });
}

boot();
wireShell();

// Tabs open and close without telling us; a slow poll keeps the dots honest.
setInterval(() => { refreshPlatforms().catch(() => {}); }, 5000);

/* Diagnostics are pushed, not polled.

   There used to be a second reader here — refreshLog(), on a 2s interval —
   guarding on `document.getElementById('diag')`, a <details> element removed
   when the log became a card. The guard was never satisfied, so the function
   returned immediately every two seconds for the life of the panel and its
   PANEL_LOG round trip never ran. The live path is refreshLogs() at boot for
   the backlog, plus PANEL_LOG_PUSH for each new line. */
