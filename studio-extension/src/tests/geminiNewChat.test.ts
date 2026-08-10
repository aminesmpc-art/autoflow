/**
 * @jest-environment jsdom
 */

/* ============================================================
   Does each Gemini node get its own thread?

   Same defect the ChatGPT adapter had: nodes posted into whatever
   conversation was open, so Gemini answered each prompt conditioned on the
   previous ones. It bites harder here than on text — an image model handed a
   stale picture in context will blend it into the next one.

   The turn-count selector is the interesting part and has its own test. The
   obvious guess, `conversation-container`, is absent from a live hydrated
   thread; `user-query` / `model-response` are what is actually there. A count
   built on the wrong one reports every conversation as empty, the reset never
   fires, and the bug looks fixed while nothing changed. Both selectors were
   read off the live page.

   Boots the BUILT bundle, because dist/gemini-content.js is what ships.
   ============================================================ */

/// <reference types="node" />

import { existsSync } from 'fs';
import { join } from 'path';

const BUNDLE = join(__dirname, '../../dist/gemini-content.js');

type Listener = (msg: any, sender: any, respond: (r: any) => void) => boolean | void;

const BOX = { width: 400, height: 40, top: 0, left: 0, bottom: 40, right: 400, x: 0, y: 0, toJSON() {} };
const box = (el: Element) => { (el as any).getBoundingClientRect = () => BOX; };

async function waitFor(check: () => boolean, ms = 4000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
}

interface Harness {
  composer: HTMLElement;
  clicks: number;
  logs: string[];
  warns: string[];
  turns: () => number;
  execute: (payload: any) => Promise<any>;
}

/**
 * @param priorTurns  how many user/model turns are already rendered
 * @param control     which New Chat affordance the page exposes
 */
function buildHarness(
  priorTurns: number,
  control: 'sparkle' | 'href' | 'none' = 'sparkle'
): Harness {
  document.body.innerHTML = '';
  const state = { clicks: 0 };

  // Gemini's composer is a Quill editor inside rich-textarea.
  const rich = document.createElement('rich-textarea');
  const composer = document.createElement('div');
  composer.className = 'ql-editor';
  composer.setAttribute('contenteditable', 'true');
  rich.append(composer);

  const thread = document.createElement('div');
  for (let i = 0; i < priorTurns; i++) {
    thread.append(document.createElement(i % 2 ? 'model-response' : 'user-query'));
  }

  if (control !== 'none') {
    const a = document.createElement('a');
    if (control === 'sparkle') {
      a.setAttribute('data-test-id', 'side-nav-sparkle-button');
      a.setAttribute('href', '/');
    } else {
      a.setAttribute('href', '/app');           // no test id, localised label
      a.setAttribute('aria-label', 'Nouvelle discussion');
    }
    a.addEventListener('click', () => {
      state.clicks++;
      setTimeout(() => { thread.innerHTML = ''; }, 30);
    });
    box(a);
    document.body.append(a);
  }

  document.body.append(thread, rich);
  [composer, rich].forEach(box);

  captured.logs.length = 0;
  captured.warns.length = 0;
  const { logs, warns } = captured;

  const listeners: Listener[] = [];
  (globalThis as any).chrome = {
    runtime: {
      onMessage: { addListener: (fn: Listener) => listeners.push(fn) },
      sendMessage: () => Promise.resolve(),
    },
  };

  /* Quill is driven through execCommand, which jsdom does not implement.
     Emulate the one behaviour the adapter depends on, as chatgptAttach does. */
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
    composer, logs, warns, execute,
    get clicks() { return state.clicks; },
    turns: () => document.querySelectorAll('user-query, model-response').length,
  } as Harness;
}

const textNode = { nodeId: 'g1', config: { mediaType: 'text', prompt: 'One line about a sneaker.' } };
const imageNode = { nodeId: 'g2', config: { mediaType: 'image', prompt: 'A red sneaker on concrete.' } };

/* The adapter reports through console, so capture it for the whole file
   rather than per harness — a hook cannot be declared inside a test. */
const captured = { logs: [] as string[], warns: [] as string[] };
const realLog = console.log;
const realWarn = console.warn;

beforeAll(() => {
  if (!existsSync(BUNDLE)) throw new Error(`build first: ${BUNDLE} is missing`);
  console.log = (...a: any[]) => { captured.logs.push(a.join(' ')); };
  console.warn = (...a: any[]) => { captured.warns.push(a.join(' ')); };
});

afterAll(() => { console.log = realLog; console.warn = realWarn; });

describe('every Gemini node starts its own conversation', () => {
  it('resets an open thread before a text node', async () => {
    const h = buildHarness(4);
    expect(h.turns()).toBe(4);

    h.execute(textNode);
    await waitFor(() => h.logs.some((l) => /Started a new chat/.test(l)));

    expect(h.clicks).toBe(1);
    expect(h.turns()).toBe(0);
  });

  it('resets an open thread before an image node too', async () => {
    const h = buildHarness(6);

    h.execute(imageNode);
    await waitFor(() => h.logs.some((l) => /Started a new chat/.test(l)));

    // Images are the case that matters most: a stale reference left in context
    // gets blended into the next generation.
    expect(h.clicks).toBe(1);
    expect(h.turns()).toBe(0);
  });

  it('skips the reset when the thread is already empty', async () => {
    const h = buildHarness(0);

    h.execute(textNode);
    await waitFor(() => h.logs.some((l) => /Already on an empty chat/.test(l)));

    expect(h.clicks).toBe(0);
  });

  it('falls back to the href when the sparkle control is absent', async () => {
    // aria-label is French here on purpose: the fallback must be structural,
    // not a translation table.
    const h = buildHarness(2, 'href');

    h.execute(textNode);
    await waitFor(() => h.logs.some((l) => /Started a new chat/.test(l)));

    expect(h.clicks).toBe(1);
    expect(h.turns()).toBe(0);
  });

  it('warns and keeps going when no control exists at all', async () => {
    const h = buildHarness(3, 'none');

    h.execute(textNode);
    await waitFor(() => h.warns.some((l) => /New Chat control not found/.test(l)));

    expect(h.clicks).toBe(0);
    expect(h.warns.join('\n')).toMatch(/may be influenced by the previous one/);
  });

  it('counts turns by user-query/model-response, not conversation-container', () => {
    /* Regression guard for the selector that nearly shipped. A live thread has
       these elements and no conversation-container, so a count built on the
       latter reads every conversation as empty and the reset silently never
       runs. */
    document.body.innerHTML = '';
    const thread = document.createElement('div');
    thread.append(document.createElement('user-query'), document.createElement('model-response'));
    document.body.append(thread);

    expect(document.querySelectorAll('user-query, model-response').length).toBe(2);
    expect(document.querySelectorAll('conversation-container').length).toBe(0);
  });
});
