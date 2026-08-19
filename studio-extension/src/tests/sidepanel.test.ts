/**
 * @jest-environment jsdom
 */

/* ============================================================
   The side panel's shipped markup and stylesheet, checked together.

   There were no tests here, which is how the panel shipped with tab
   navigation that did not navigate: `.sp-view { display: flex }` is
   author-origin and therefore beat the user agent's `[hidden] { display:
   none }`, so all three views rendered at once, stacked. The tabs moved a
   highlight. Nothing in the TypeScript was wrong — `showView` set `.hidden`
   correctly every time — so no test of the logic would have caught it. The
   defect lived in the cascade between two files.

   jsdom does not do layout, but it does implement the cascade, which is the
   part that failed. `getComputedStyle(el).display` is enough to answer "would
   the user see two views at once", and that is the whole question.
   ============================================================ */

/// <reference types="node" />

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const DIST = join(__dirname, '../../dist');
const HTML = join(DIST, 'sidepanel.html');
const CSS = join(DIST, 'sidepanel.css');

/** The shipped panel, with its real stylesheet applied. */
function mountPanel(): void {
  document.head.innerHTML = '';
  const doc = new DOMParser().parseFromString(readFileSync(HTML, 'utf8'), 'text/html');
  doc.querySelectorAll('script').forEach((s) => s.remove());
  document.body.innerHTML = doc.body.innerHTML;
  const style = document.createElement('style');
  style.textContent = readFileSync(CSS, 'utf8');
  document.head.append(style);
}

const shown = (id: string) => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} is missing from the shipped panel`);
  return getComputedStyle(el).display !== 'none';
};

beforeAll(() => {
  for (const f of [HTML, CSS]) {
    if (!existsSync(f)) throw new Error(`build first — ${f} is missing`);
  }
});

beforeEach(mountPanel);

describe('hidden actually hides', () => {
  const VIEWS = ['view-build', 'view-templates', 'view-run'];

  it('shows exactly one view at rest', () => {
    // Build leads: the panel used to open on Run, which is empty until
    // something is already running.
    expect(VIEWS.filter(shown)).toEqual(['view-build']);
  });

  it.each(VIEWS)('shows only %s when the others carry hidden', (want) => {
    for (const id of VIEWS) document.getElementById(id)!.hidden = id !== want;
    expect(VIEWS.filter(shown)).toEqual([want]);
  });

  it('never shows the idle and live run states together', () => {
    // The same cascade defect, second occurrence: .sp-run__idle is display:grid.
    document.getElementById('run-idle')!.hidden = true;
    document.getElementById('run-live')!.hidden = false;
    expect(shown('run-idle')).toBe(false);
    expect(shown('run-live')).toBe(true);
  });

  it('hides every element the panel ships with the attribute set', () => {
    /* A blanket sweep, so an element added later with a display rule and a
       `hidden` attribute cannot repeat this a third time. */
    const leaked = Array.from(document.querySelectorAll<HTMLElement>('[hidden]'))
      .filter((el) => getComputedStyle(el).display !== 'none')
      .map((el) => el.id || el.className);
    expect(leaked).toEqual([]);
  });
});

describe('the panel markup keeps the contract index.ts relies on', () => {
  /* `$()` throws on a missing id and takes the rest of boot with it, and a
     side panel has no visible console — a renamed id looks exactly like a
     working panel with nothing to report. */
  const REQUIRED = [
    'run-idle', 'run-live', 'run-idle-hint', 'run-node', 'run-elapsed',
    'run-bar', 'run-pct', 'run-count', 'run-error',
    'btn-pause', 'btn-stop', 'head-sub', 'open-studio',
    'plat-list', 'plat-count', 'diag-log',
    'acct-out', 'acct-in', 'plan-badge', 'acct-email', 'acct-initial',
    'usage-bar', 'usage-label', 'usage-count',
    'btn-login', 'btn-logout', 'email', 'password', 'auth-error',
    'btn-account', 'acct-close', 'acct-modal', 'top-avatar',
    'foot-plan', 'foot-acct', 'foot-runs',
    'sp-nav', 'tpl-search', 'tpl-pills', 'tpl-grid', 'tpl-count', 'preset-list',
    'build-idea', 'build-reply', 'build-copy', 'build-go', 'build-out',
    'build-ai-manual', 'build-manual',
    'build-go-ai', 'build-engine', 'build-engine-hint', 'build-open-library',
    'build-composer', 'build-how', 'build-refs', 'build-add-image', 'build-image-input',
    'build-past', 'build-past-list', 'build-past-clear',
    'view-pro', 'pro-back', 'pro-go', 'pro-status', 'pro-free',
    'build-refine-refs', 'build-refine-image', 'build-refine-image-input',
    'build-stages', 'build-stage-note', 'build-cancel',
    'build-plan', 'build-plan-size', 'build-plan-cost', 'build-plan-sub',
    'build-plan-shots', 'build-plan-helpers', 'build-plan-warn',
    'build-plan-go', 'build-plan-drop', 'build-refine', 'build-refine-go',
    'gate', 'app', 'gate-google',
    'src-official', 'src-community',
  ];

  it.each(REQUIRED)('has #%s', (id) => {
    expect(document.getElementById(id)).not.toBeNull();
  });

  it('gives every platform row a button and a destination', () => {
    const rows = Array.from(document.querySelectorAll<HTMLButtonElement>('#plat-list button'));
    expect(rows.map((r) => r.dataset.plat)).toEqual(['flow', 'chatgpt', 'gemini', 'grok']);
    // Real buttons, so Enter and Space work without hand-rolled key handling.
    for (const r of rows) expect(r.tagName).toBe('BUTTON');
  });

  it('wires each tab to a panel that exists', () => {
    const tabs = Array.from(document.querySelectorAll<HTMLElement>('.sp-nav__tab'));
    expect(tabs.length).toBe(3);
    for (const t of tabs) {
      expect(document.getElementById(`view-${t.dataset.view}`)).not.toBeNull();
      expect(t.getAttribute('role')).toBe('tab');
      expect(t.getAttribute('aria-selected')).toMatch(/^(true|false)$/);
    }
    expect(tabs.filter((t) => t.getAttribute('aria-selected') === 'true')).toHaveLength(1);
  });
});

describe('the stylesheet', () => {
  const css = () => readFileSync(CSS, 'utf8');
  // The scale and palette live one level up, shared with the studio canvas.
  const tokens = () => readFileSync(join(__dirname, '..', 'shared', 'tokens.css'), 'utf8');

  it('carries the rule that makes hidden win', () => {
    expect(css()).toMatch(/\[hidden\]\s*\{\s*display:\s*none\s*!important/);
  });

  it('has no `font:` shorthand ending in inherit', () => {
    /* `font: 600 11.5px/1 inherit` is invalid — `inherit` is not a family
       inside the shorthand, so the entire declaration is dropped and the
       control silently keeps the UA default of 13.33px. It looks correct in
       the source and is only visible by measuring. */
    const bad = css().match(/font:\s*[^;]*\d+px[^;]*\binherit\b[^;]*;/g) || [];
    expect(bad).toEqual([]);
  });

  it('ships one accent, not two', () => {
    // The shell used to be built on Tailwind slate + #a3e635 while the cards
    // used the obsidian ramp + #b5f602. Two greys and two limes.
    const stray = css().match(/#a3e635|#bef264|148,\s*163,\s*184/gi) || [];
    expect(stray).toEqual([]);
  });

  it('sets no text smaller than 10px', () => {
    /* Sizes come from the shared scale now, so there are no literals left in
       this file to measure. The rule is unchanged and is checked where the
       values actually live: every --t-* step, and the fact that nothing here
       opts out of them with a raw px. */
    const literals = Array.from(css().matchAll(/font-size:\s*([\d.]+)px/g)).map((m) => Number(m[1]));
    expect(literals).toEqual([]);

    const scale = Array.from(tokens().matchAll(/--t-[a-z]+:\s*([\d.]+)px/g)).map((m) => Number(m[1]));
    expect(scale.length).toBeGreaterThan(4);
    expect(Math.min(...scale)).toBeGreaterThanOrEqual(10);

    const used = Array.from(css().matchAll(/font-size:\s*var\((--t-[a-z]+)\)/g)).map((m) => m[1]);
    expect(used.length).toBeGreaterThan(10);
    const defined = new Set(Array.from(tokens().matchAll(/(--t-[a-z]+):/g)).map((m) => m[1]));
    expect(used.filter((t) => !defined.has(t))).toEqual([]);
  });
});

describe('the panel is gated behind sign-in', () => {
  it('shows the gate and hides the app before anyone signs in', () => {
    /* The signed-out panel used to be the whole tab bar over controls that
       could not do anything, which reads as broken rather than locked. */
    expect(shown('gate')).toBe(true);
    expect(shown('app')).toBe(false);
  });

  it('swaps them the moment the app is revealed', () => {
    document.getElementById('gate')!.hidden = true;
    document.getElementById('app')!.hidden = false;
    expect(shown('gate')).toBe(false);
    expect(shown('app')).toBe(true);
  });

  it('offers Google before the password form', () => {
    const html = readFileSync(HTML, 'utf8');
    expect(html.indexOf('gate-google')).toBeLessThan(html.indexOf('id="password"'));
  });

  it('keeps the sign-in fields the api wiring needs', () => {
    for (const id of ['email', 'password', 'btn-login', 'auth-error']) {
      expect(document.getElementById(id)).not.toBeNull();
    }
  });
});

describe('community templates sit beside the official ones, not among them', () => {
  it('offers a source switch with Official selected first', () => {
    /* Two sets with different authors and different guarantees. A merged list
       would imply we vouch for all of them. */
    const off = document.getElementById('src-official')!;
    const com = document.getElementById('src-community')!;
    expect(off.getAttribute('aria-selected')).toBe('true');
    expect(com.getAttribute('aria-selected')).toBe('false');
    expect(off.className).toContain('sp-seg2__btn--on');
  });

  it('puts the switch above the search, inside the pinned bar', () => {
    const bar = document.querySelector('.sp-tplbar')!;
    expect(bar.querySelector('#src-community')).not.toBeNull();
    const html = bar.innerHTML;
    expect(html.indexOf('src-official')).toBeLessThan(html.indexOf('tpl-search'));
  });
});
