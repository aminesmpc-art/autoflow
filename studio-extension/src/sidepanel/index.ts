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
import { loadTemplates, refreshTemplates } from '../studio/templates/loader';
import type { Template } from '../studio/templates';
import { getAskPresets } from '../studio/presets';
import { buildSpec } from '../studio/builder/spec';
import { buildFromReply } from '../studio/builder/plan';
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

async function refreshAccount(): Promise<void> {
  const signedIn = await isLoggedIn();
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

type PanelView = 'run' | 'templates' | 'build' | 'prompts';

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
const AI_CHATS: Array<[string, string]> = [
  ['ChatGPT', 'https://chatgpt.com/'],
  ['Grok', 'https://grok.com/'],
  ['Gemini', 'https://gemini.google.com/app'],
  ['DeepSeek', 'https://chat.deepseek.com/'],
  ['Claude', 'https://claude.ai/new'],
];

function renderAiLinks(): void {
  const host = document.getElementById('build-ai');
  if (!host) return;
  host.innerHTML = '';
  for (const [name, url] of AI_CHATS) {
    const a = document.createElement('button');
    a.type = 'button';
    a.className = 'sp-ai__link';
    a.title = `Open ${name} in a new tab`;
    const dot = document.createElement('span');
    dot.className = 'sp-ai__dot';
    const label = document.createElement('span');
    label.textContent = name;
    a.append(dot, label);
    a.addEventListener('click', () => { chrome.tabs.create({ url }).catch(() => {}); });
    host.append(a);
  }
}

/** One place to say how it went, so a failure cannot look like nothing. */
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
  renderAiLinks();

  const idea = document.getElementById('build-idea') as HTMLTextAreaElement | null;
  const reply = document.getElementById('build-reply') as HTMLTextAreaElement | null;
  const copy = document.getElementById('build-copy');
  const go = document.getElementById('build-go');
  if (!idea || !reply || !copy || !go) return;

  // What was typed survives the panel closing; an idea is worth keeping.
  chrome.storage.local.get('af_build_idea')
    .then(({ af_build_idea }) => { if (af_build_idea && !idea.value) idea.value = af_build_idea; })
    .catch(() => {});
  idea.addEventListener('input', () => {
    chrome.storage.local.set({ af_build_idea: idea.value }).catch(() => {});
  });

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

    const { template, problems } = buildFromReply(text);
    if (!template) {
      buildSays('bad', 'That reply could not be turned into a workflow', problems);
      return;
    }

    /* Parked whole rather than by id: the gallery looks an id up in the
       published list, and this workflow exists nowhere but here. */
    try {
      await chrome.storage.local.set({ af_pending_workflow: template });
    } catch {
      buildSays('bad', 'Could not hand the workflow to the canvas — storage is unavailable.');
      return;
    }
    const steps = template.nodes.filter((n: any) => isRunnableType(n.type)).length;
    buildSays('ok', `Built "${template.name}"`, [
      `${template.nodes.length} nodes, ${steps} of them run`,
      'Opening the canvas…',
    ]);
    chrome.runtime.sendMessage({ type: 'PANEL_OPEN_STUDIO' }).catch(() => {});
  });
}

/** Templates currently shown, and the category filter over them. */
let panelTemplates: Template[] = [];
let panelCategory = 'All';
let panelQuery = '';

function showView(view: PanelView): void {
  for (const id of ['run', 'templates', 'build', 'prompts'] as PanelView[]) {
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
  search?.addEventListener('input', () => { panelQuery = search.value; renderTemplates(); });

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
