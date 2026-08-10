/**
 * @jest-environment jsdom
 */

/* ============================================================
   The agent's thread must survive its own loop.

   Every node normally starts a clean chat, which is right for nodes and fatal
   for an agent: the loop IS the conversation, so a reset between turns drops
   the tool results the agent just read and it starts over, forever, until the
   iteration cap. The bug would look like an agent that never makes progress.

   So config.newChat = 'never' has to be honoured by all three adapters, and
   the failure is silent in every one of them — hence a test per adapter
   against the built bundles rather than a reading of the source.
   ============================================================ */

/// <reference types="node" />

import { existsSync } from 'fs';
import { join } from 'path';

type Listener = (msg: any, sender: any, respond: (r: any) => void) => boolean | void;

const BOX = { width: 300, height: 40, top: 0, left: 0, bottom: 40, right: 300, x: 0, y: 0, toJSON() {} };
const box = (el: Element) => { (el as any).getBoundingClientRect = () => BOX; };

async function waitFor(check: () => boolean, ms = 4000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
}

interface Adapter {
  name: string;
  bundle: string;
  /** Build a page with an open thread and a working reset control. */
  page: (resetClicks: { n: number }) => { composer: HTMLElement; turns: () => number };
  mediaType: 'text';
}

const ADAPTERS: Adapter[] = [
  {
    name: 'chatgpt',
    bundle: join(__dirname, '../../dist/chatgpt-content.js'),
    mediaType: 'text',
    page: (clicks) => {
      const composer = document.createElement('div');
      composer.id = 'prompt-textarea';
      composer.setAttribute('contenteditable', 'true');
      const send = document.createElement('button');
      send.setAttribute('data-testid', 'send-button');
      const thread = document.createElement('div');
      for (let i = 0; i < 4; i++) {
        const m = document.createElement('div');
        m.setAttribute('data-message-author-role', i % 2 ? 'assistant' : 'user');
        thread.append(m);
      }
      const reset = document.createElement('a');
      reset.setAttribute('data-testid', 'create-new-chat-button');
      reset.addEventListener('click', () => { clicks.n++; thread.innerHTML = ''; });
      document.body.append(thread, reset, composer, send);
      [composer, send, reset].forEach(box);
      return { composer, turns: () => document.querySelectorAll('[data-message-author-role]').length };
    },
  },
  {
    name: 'gemini',
    bundle: join(__dirname, '../../dist/gemini-content.js'),
    mediaType: 'text',
    page: (clicks) => {
      const rich = document.createElement('rich-textarea');
      const composer = document.createElement('div');
      composer.className = 'ql-editor';
      composer.setAttribute('contenteditable', 'true');
      rich.append(composer);
      const thread = document.createElement('div');
      for (let i = 0; i < 4; i++) {
        thread.append(document.createElement(i % 2 ? 'model-response' : 'user-query'));
      }
      const reset = document.createElement('a');
      reset.setAttribute('data-test-id', 'side-nav-sparkle-button');
      reset.setAttribute('href', '/');
      reset.addEventListener('click', () => { clicks.n++; thread.innerHTML = ''; });
      document.body.append(thread, reset, rich);
      [composer, rich, reset].forEach(box);
      return { composer, turns: () => document.querySelectorAll('user-query, model-response').length };
    },
  },
  {
    name: 'grok',
    bundle: join(__dirname, '../../dist/grok-content.js'),
    mediaType: 'text',
    page: (clicks) => {
      const composer = document.createElement('div');
      composer.setAttribute('contenteditable', 'true');
      composer.className = 'tiptap ProseMirror';
      const send = document.createElement('button');
      send.setAttribute('type', 'submit');
      const thread = document.createElement('div');
      for (let i = 0; i < 4; i++) {
        const b = document.createElement('div');
        b.className = 'message-bubble';
        thread.append(b);
      }
      const reset = document.createElement('a');
      reset.setAttribute('href', '/');
      reset.textContent = 'New Chat';
      reset.addEventListener('click', () => { clicks.n++; thread.innerHTML = ''; });
      document.body.append(thread, reset, composer, send);
      [composer, send, reset].forEach(box);
      return { composer, turns: () => document.querySelectorAll('.message-bubble').length };
    },
  },
];

function boot(adapter: Adapter, clicks: { n: number }) {
  document.body.innerHTML = '';
  const page = adapter.page(clicks);

  const listeners: Listener[] = [];
  (globalThis as any).chrome = {
    runtime: {
      onMessage: { addListener: (fn: Listener) => listeners.push(fn) },
      sendMessage: () => Promise.resolve(),
    },
  };
  (document as any).execCommand = (cmd: string, _ui: boolean, value: string) => {
    if (cmd === 'insertText') page.composer.textContent = value;
    return true;
  };

  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require(adapter.bundle);
  });

  const execute = (payload: any) => {
    for (const fn of listeners) fn({ type: 'STUDIO_EXECUTE_NODE', payload }, {}, () => {});
  };
  return { ...page, execute };
}

const realLog = console.log;
const realWarn = console.warn;
beforeAll(() => {
  for (const a of ADAPTERS) {
    if (!existsSync(a.bundle)) throw new Error(`build first: ${a.bundle} is missing`);
  }
  console.log = () => {};
  console.warn = () => {};
});
afterAll(() => { console.log = realLog; console.warn = realWarn; });

describe.each(ADAPTERS.map((a) => [a.name, a] as const))('%s', (_name, adapter) => {
  it("resets the thread when newChat is unset — an ordinary node's behaviour", async () => {
    const clicks = { n: 0 };
    const h = boot(adapter, clicks);
    expect(h.turns()).toBe(4);

    h.execute({ nodeId: 'n', config: { mediaType: adapter.mediaType, prompt: 'hello' } });
    await waitFor(() => clicks.n > 0);

    expect(clicks.n).toBe(1);
  });

  it("keeps the thread when newChat is 'never' — the agent mid-loop", async () => {
    const clicks = { n: 0 };
    const h = boot(adapter, clicks);

    h.execute({
      nodeId: 'n',
      config: { mediaType: adapter.mediaType, prompt: 'turn two', newChat: 'never' },
    });
    // Give it well past the point the reset would have fired.
    await new Promise((r) => setTimeout(r, 900));

    expect(clicks.n).toBe(0);
    // And the memory it depends on is still on screen.
    expect(h.turns()).toBe(4);
  });
});
