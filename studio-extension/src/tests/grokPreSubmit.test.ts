/**
 * @jest-environment jsdom
 */

/* ============================================================
   What Grok's adapter does before it submits anything.

   Two defects, both invisible from the outside:

   1. The aspect ratio never applied. Its menu is a Radix trigger, and Radix
      binds opening to pointerdown — a synthetic click does nothing. Measured
      live: after .click() the trigger still reads data-state="closed" and the
      document contains no menuitem; after pointerdown it reads "open" and five
      items exist. The item lookup therefore searched an unopened menu, found
      nothing, and logged "not offered, left as is" while the ratio stayed on
      whatever Grok happened to have. A node asking for 16:9 quietly rendered
      9:16.

   2. Text nodes posted into whatever chat thread was open, so each answer was
      conditioned on the previous ones.

   The fake trigger below refuses to open on click, exactly like the real one.
   That is the regression guard: revert to click() and these fail.
   ============================================================ */

/// <reference types="node" />

import { existsSync } from 'fs';
import { join } from 'path';

const BUNDLE = join(__dirname, '../../dist/grok-content.js');

type Listener = (msg: any, sender: any, respond: (r: any) => void) => boolean | void;

const BOX = { width: 200, height: 36, top: 0, left: 0, bottom: 36, right: 200, x: 0, y: 0, toJSON() {} };
const box = (el: Element) => { (el as any).getBoundingClientRect = () => BOX; };

async function waitFor(check: () => boolean, ms = 5000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
}

const RATIOS = ['2:3', '3:2', '1:1', '9:16', '16:9'];

interface Harness {
  ratioTrigger: HTMLElement;
  clicksOnNewChat: number;
  logs: string[];
  bubbles: () => number;
  execute: (payload: any) => Promise<any>;
}

interface Opts {
  /** Turns already in the chat thread. */
  priorBubbles?: number;
  /** Ratio the trigger starts on. */
  startRatio?: string;
  /** Mimic Radix: only pointerdown opens the menu. */
  openOnClickToo?: boolean;
}

function buildHarness({ priorBubbles = 0, startRatio = '9:16', openOnClickToo = false }: Opts = {}): Harness {
  document.body.innerHTML = '';
  const state = { newChatClicks: 0 };

  const composer = document.createElement('div');
  composer.setAttribute('contenteditable', 'true');
  composer.className = 'tiptap ProseMirror';

  const send = document.createElement('button');
  send.setAttribute('type', 'submit');

  // ── Aspect Ratio: a Radix-style menu ──
  const ratioTrigger = document.createElement('button');
  ratioTrigger.setAttribute('aria-label', 'Aspect Ratio');
  ratioTrigger.setAttribute('aria-haspopup', 'menu');
  ratioTrigger.setAttribute('data-state', 'closed');
  ratioTrigger.textContent = startRatio;

  let menu: HTMLElement | null = null;
  const openMenu = () => {
    if (menu) return;
    ratioTrigger.setAttribute('data-state', 'open');
    menu = document.createElement('div');
    menu.setAttribute('role', 'menu');
    for (const r of RATIOS) {
      const item = document.createElement('div');
      item.setAttribute('role', 'menuitem');
      item.textContent = r;
      box(item);
      item.addEventListener('click', () => {
        ratioTrigger.textContent = r;
        ratioTrigger.setAttribute('data-state', 'closed');
        menu?.remove();
        menu = null;
      });
      menu.append(item);
    }
    document.body.append(menu);
  };
  // The real trigger opens on pointerdown only.
  ratioTrigger.addEventListener('pointerdown', openMenu);
  if (openOnClickToo) ratioTrigger.addEventListener('click', openMenu);

  // ── Radio groups ──
  const mkGroup = (label: string, values: string[], checked: string) => {
    const g = document.createElement('div');
    g.setAttribute('role', 'radiogroup');
    g.setAttribute('aria-label', label);
    for (const v of values) {
      const b = document.createElement('button');
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', v === checked ? 'true' : 'false');
      b.setAttribute('aria-label', v);
      b.textContent = v;
      b.addEventListener('click', () => {
        for (const sib of Array.from(g.querySelectorAll('[role="radio"]'))) {
          sib.setAttribute('aria-checked', 'false');
        }
        b.setAttribute('aria-checked', 'true');
      });
      box(b);
      g.append(b);
    }
    box(g);
    return g;
  };

  // ── Chat surface: the thread, the logo, and New Chat ──
  const thread = document.createElement('div');
  for (let i = 0; i < priorBubbles; i++) {
    const b = document.createElement('div');
    b.className = 'message-bubble';
    b.textContent = `stale turn ${i}`;
    thread.append(b);
  }
  const logo = document.createElement('a');
  logo.setAttribute('href', '/');
  logo.setAttribute('aria-label', 'Home page');   // must NOT be chosen
  const newChat = document.createElement('a');
  newChat.setAttribute('href', '/');              // no aria-label, like the real one
  newChat.textContent = 'New Chat';
  newChat.addEventListener('click', () => {
    state.newChatClicks++;
    setTimeout(() => { thread.innerHTML = ''; }, 30);
  });

  document.body.append(
    thread, logo, newChat, ratioTrigger,
    mkGroup('Generation mode', ['Image', 'Video', 'Agent'], 'Image'),
    mkGroup('Video resolution', ['480p', '720p', '1080p'], '720p'),
    mkGroup('Video duration', ['6s', '10s', '15s'], '6s'),
    composer, send,
  );
  [composer, send, ratioTrigger, logo, newChat].forEach(box);

  current = [];

  const listeners: Listener[] = [];
  (globalThis as any).chrome = {
    runtime: {
      onMessage: { addListener: (fn: Listener) => listeners.push(fn) },
      sendMessage: () => Promise.resolve(),
    },
  };
  (document as any).execCommand = (cmd: string, _ui: boolean, value: string) => {
    if (cmd === 'insertText') composer.textContent = value;
    return true;
  };

  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require(BUNDLE);
  });

  const execute = (payload: any) =>
    new Promise<any>((resolve) => {
      let answered = false;
      for (const fn of listeners) {
        fn({ type: 'STUDIO_EXECUTE_NODE', payload }, {}, (r: any) => {
          if (!answered) { answered = true; resolve(r); }
        });
      }
    });

  return {
    ratioTrigger, logs: current, execute,
    get clicksOnNewChat() { return state.newChatClicks; },
    bubbles: () => document.querySelectorAll('.message-bubble').length,
  } as Harness;
}

/* One buffer per harness. Each isolateModules leaves the previous node's
   polling loop running against the same jsdom document, and those keep
   logging - a single shared buffer let one test's leftovers race the next
   test's assertions. */
let current: string[] = [];
const realLog = console.log;

beforeAll(() => {
  if (!existsSync(BUNDLE)) throw new Error(`build first: ${BUNDLE} is missing`);
  console.log = (...a: any[]) => { current.push(a.join(' ')); };
});
afterAll(() => { console.log = realLog; });

describe('aspect ratio actually gets applied', () => {
  it('opens the Radix menu with pointerdown and selects the asked-for ratio', async () => {
    const h = buildHarness({ startRatio: '9:16' });

    h.execute({ nodeId: 'v1', config: { mediaType: 'video', prompt: 'a clip', aspectRatio: '16:9' } });
    // The trigger updates before the line is logged - selectAspectRatio settles
    // for 400ms first - so wait on the log, which is the later of the two.
    await waitFor(() => h.logs.some((l) => /Aspect ratio: 16:9/.test(l)));

    expect(h.ratioTrigger.textContent).toContain('16:9');
    expect(h.logs.join('\n')).toContain('Aspect ratio: 16:9');
    expect(h.logs.join('\n')).not.toContain('not offered');
  });

  it('works on a trigger that refuses click entirely — the live behaviour', async () => {
    // openOnClickToo defaults to false, so the only way in is pointerdown.
    const h = buildHarness({ startRatio: '1:1' });

    h.execute({ nodeId: 'v2', config: { mediaType: 'video', prompt: 'a clip', aspectRatio: '9:16' } });
    await waitFor(() => h.logs.some((l) => /Aspect ratio: 9:16/.test(l)));

    expect(h.ratioTrigger.textContent).toContain('9:16');
  });

  it('leaves an already-correct ratio alone', async () => {
    const h = buildHarness({ startRatio: '16:9' });

    h.execute({ nodeId: 'v3', config: { mediaType: 'video', prompt: 'a clip', aspectRatio: '16:9' } });
    await waitFor(() => h.logs.some((l) => /Aspect ratio: 16:9/.test(l)));

    expect(h.ratioTrigger.getAttribute('data-state')).toBe('closed'); // never opened
    expect(h.logs.join('\n')).not.toContain('not offered');
  });

  it('reports honestly when the ratio is not on the menu', async () => {
    const h = buildHarness({ startRatio: '9:16' });

    h.execute({ nodeId: 'v4', config: { mediaType: 'video', prompt: 'a clip', aspectRatio: '21:9' } });
    await waitFor(() => h.logs.some((l) => /Aspect ratio: 21:9/.test(l)));

    // Saying "left as is" is the point: silence here is what hid the bug.
    expect(h.logs.join('\n')).toContain('not offered, left as is');
    expect(h.ratioTrigger.textContent).toContain('9:16');
  });
});

describe('text nodes get their own chat', () => {
  it('resets an open thread before a text node', async () => {
    const h = buildHarness({ priorBubbles: 4 });
    expect(h.bubbles()).toBe(4);

    h.execute({ nodeId: 't1', config: { mediaType: 'text', prompt: 'one line please' } });
    await waitFor(() => h.logs.some((l) => /Started a new chat/.test(l)));

    expect(h.clicksOnNewChat).toBe(1);
    expect(h.bubbles()).toBe(0);
  });

  it('picks New Chat rather than the home-page logo', async () => {
    /* Both are a[href="/"]. Taking the first visible one grabs the logo, which
       is a different control that merely happens to land somewhere similar. */
    const h = buildHarness({ priorBubbles: 2 });

    h.execute({ nodeId: 't2', config: { mediaType: 'text', prompt: 'hi' } });
    await waitFor(() => h.logs.some((l) => /Started a new chat/.test(l)));

    expect(h.clicksOnNewChat).toBe(1);
  });

  it('skips the reset on an empty thread', async () => {
    const h = buildHarness({ priorBubbles: 0 });

    h.execute({ nodeId: 't3', config: { mediaType: 'text', prompt: 'hi' } });
    await waitFor(() => h.logs.some((l) => /Already on an empty chat/.test(l)));

    expect(h.clicksOnNewChat).toBe(0);
  });

  it('does NOT reset for video — that would discard the clip an Extend continues', async () => {
    const h = buildHarness({ priorBubbles: 3 });

    h.execute({ nodeId: 'v5', config: { mediaType: 'video', prompt: 'a clip', aspectRatio: '16:9' } });
    await waitFor(() => h.logs.some((l) => /Aspect ratio: 16:9/.test(l)));

    expect(h.clicksOnNewChat).toBe(0);
  });
});

/* ============================================================
   Discover is not your generation.

   Found by running a real image generation on grok.com/imagine. The page
   renders a masonry feed of other people's public posts, and its tiles are
   <img alt="Generated image"> data URLs at 256x256 — which pass every test
   collectResultImages applies. Measured live, immediately after a render:

     usable() matched 4 images
     all 4 were <div id="imagine-masonry-section-0"> tiles
     the actual result was in History, not in that list

   The baseline diff hides this only while the feed holds still. It lazy
   loads on scroll, so a tile that arrives during the wait is NEW and gets
   captured as the node's output: a stranger's picture, returned as a
   success, with nothing in the log to say otherwise.

   The ancestry below is copied from the live DOM.
   ============================================================ */
describe('Grok result detection ignores the Discover feed', () => {
  const DATA_URL = `data:image/png;base64,${'A'.repeat(4000)}`;

  /** One Discover masonry tile, as /imagine renders it. */
  function discoverTile(): HTMLImageElement {
    const section = document.createElement('div');
    section.id = 'imagine-masonry-section-0';
    const card = document.createElement('div');
    card.className = 'relative group/media-post-masonry-card';
    const img = document.createElement('img');
    img.alt = 'Generated image';
    img.className = 'opacity-1 transition-opacity';
    Object.defineProperty(img, 'currentSrc', { value: DATA_URL, configurable: true });
    Object.defineProperty(img, 'complete', { value: true, configurable: true });
    Object.defineProperty(img, 'naturalWidth', { value: 256, configurable: true });
    Object.defineProperty(img, 'naturalHeight', { value: 256, configurable: true });
    (img as any).getBoundingClientRect = () => ({ width: 346, height: 352, top: 0, left: 0, bottom: 352, right: 346, x: 0, y: 0, toJSON() {} });
    card.append(img);
    section.append(card);
    document.body.append(section);
    return img;
  }

  /** A genuine result, outside the feed. */
  function realResult(): HTMLImageElement {
    const img = document.createElement('img');
    Object.defineProperty(img, 'currentSrc', { value: DATA_URL, configurable: true });
    Object.defineProperty(img, 'complete', { value: true, configurable: true });
    Object.defineProperty(img, 'naturalWidth', { value: 1024, configurable: true });
    Object.defineProperty(img, 'naturalHeight', { value: 1024, configurable: true });
    (img as any).getBoundingClientRect = () => ({ width: 512, height: 512, top: 0, left: 0, bottom: 512, right: 512, x: 0, y: 0, toJSON() {} });
    document.body.append(img);
    return img;
  }

  /** The shipped predicate, mirrored. */
  const usable = (img: HTMLImageElement): boolean => {
    const src = img.currentSrc || img.src || '';
    if (!src) return false;
    if (src.startsWith('data:') && src.length < 2000) return false;
    if (img.closest('[id^="imagine-masonry-section"], [class*="media-post-masonry-card"]')) return false;
    if (/assets\.grok\.com\/users\/.*\/(preview_image|generated_image)/i.test(src)) return true;
    const r = img.getBoundingClientRect();
    if (r.width < 180 && r.height < 180) return false;
    return img.complete && img.naturalWidth >= 256 && img.naturalHeight >= 256;
  };

  beforeEach(() => { document.body.innerHTML = ''; });

  it('rejects a Discover tile that passes every other test', () => {
    const tile = discoverTile();
    // Everything the old rule looked at says "result".
    expect(tile.complete).toBe(true);
    expect(tile.naturalWidth).toBeGreaterThanOrEqual(256);
    expect(usable(tile)).toBe(false);
  });

  it('still accepts a genuine result outside the feed', () => {
    expect(usable(realResult())).toBe(true);
  });

  it('picks only the result when both are on the page', () => {
    discoverTile(); discoverTile(); discoverTile(); discoverTile();
    const mine = realResult();
    const found = Array.from(document.querySelectorAll('img')).filter(usable);
    expect(found).toEqual([mine]);
  });

  it('rejects a tile matched by card class alone, without the section id', () => {
    // The feed is virtualised; a card can outlive its section wrapper.
    const card = document.createElement('div');
    card.className = 'relative group/media-post-masonry-card';
    const img = realResult();
    card.append(img);
    document.body.append(card);
    expect(usable(img)).toBe(false);
  });
});

describe('the shipped Grok bundle excludes the feed', () => {
  it('carries the masonry exclusion', () => {
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../../dist/grok-content.js'), 'utf8'
    );
    expect(src).toContain('imagine-masonry-section');
    expect(src).toContain('media-post-masonry-card');
  });
});
