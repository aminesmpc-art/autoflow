/**
 * @jest-environment jsdom
 */

/* ============================================================
   Does each ChatGPT node get its own thread?

   It used not to. Every node in a run posted into whatever conversation was
   already open, so ChatGPT answered the fourth prompt in the light of the
   previous three — and an image attached to node one stayed in context for
   node four. The canvas says these steps are independent; the transcript said
   otherwise, and nothing in the run surfaced the difference.

   Same approach as chatgptAttach: boot the BUILT bundle against a fake page,
   because dist/chatgpt-content.js is what ships.
   ============================================================ */

/// <reference types="node" />

import { existsSync } from 'fs';
import { join } from 'path';

const BUNDLE = join(__dirname, '../../dist/chatgpt-content.js');

type Listener = (msg: any, sender: any, respond: (r: any) => void) => boolean | void;

const BOX = { width: 400, height: 40, top: 0, left: 0, bottom: 40, right: 400, x: 0, y: 0, toJSON() {} };
const box = (el: Element) => { (el as any).getBoundingClientRect = () => BOX; };

interface Harness {
  composer: HTMLElement;
  newChat: HTMLAnchorElement | null;
  clicks: number;
  sent: any[];
  logs: string[];
  /** Composer contents at the moment send was pressed. */
  submitted: string[];
  messages: () => number;
  execute: (payload: any) => Promise<any>;
}

/** Poll until `check` holds, so assertions do not race the script's timers. */
async function waitFor(check: () => boolean, ms = 4000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
}

/**
 * @param priorMessages how many turns are already in the thread
 * @param withButton    whether the sidebar exposes New Chat at all
 */
function buildHarness(priorMessages: number, withButton = true): Harness {
  document.body.innerHTML = '';
  const state = { clicks: 0 };
  const submitted: string[] = [];

  const form = document.createElement('form');
  const composer = document.createElement('div');
  composer.id = 'prompt-textarea';
  composer.setAttribute('contenteditable', 'true');
  const sendBtn = document.createElement('button');
  sendBtn.setAttribute('data-testid', 'send-button');
  sendBtn.addEventListener('click', () => {
    // Capture before the page clears it — the cleared composer is the only
    // proof the send landed, so the text has to be recorded here.
    submitted.push(composer.textContent || '');
    setTimeout(() => { composer.textContent = ''; }, 0);
  });
  form.append(composer, sendBtn);

  const thread = document.createElement('div');
  thread.id = 'thread';
  for (let i = 0; i < priorMessages; i++) {
    const m = document.createElement('div');
    m.setAttribute('data-message-author-role', i % 2 ? 'assistant' : 'user');
    m.textContent = `stale turn ${i} — must not be in context`;
    thread.append(m);
  }

  let newChat: HTMLAnchorElement | null = null;
  if (withButton) {
    newChat = document.createElement('a');
    newChat.setAttribute('data-testid', 'create-new-chat-button');
    newChat.setAttribute('href', '/');
    newChat.textContent = 'New chat';
    // The real page is an SPA: clicking tears the thread down.
    newChat.addEventListener('click', () => {
      state.clicks++;
      setTimeout(() => { thread.innerHTML = ''; }, 30);
    });
    box(newChat);
    document.body.append(newChat);
  }

  document.body.append(thread, form);
  [composer, sendBtn].forEach(box);

  const sent: any[] = [];
  const logs: string[] = [];
  const listeners: Listener[] = [];
  (globalThis as any).chrome = {
    runtime: {
      onMessage: { addListener: (fn: Listener) => listeners.push(fn) },
      sendMessage: (msg: any) => {
        sent.push(msg);
        if (msg?.type === 'STUDIO_LOG') logs.push(String(msg.payload?.line ?? ''));
        return Promise.resolve();
      },
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
    composer, newChat, sent, logs, execute, submitted,
    get clicks() { return state.clicks; },
    messages: () => document.querySelectorAll('[data-message-author-role]').length,
  } as Harness;
}

const NODE = {
  nodeId: 'n1',
  config: { mediaType: 'text', prompt: 'Write one line about a sneaker.' },
};

beforeAll(() => {
  if (!existsSync(BUNDLE)) throw new Error(`build first: ${BUNDLE} is missing`);
});

describe('every ChatGPT node starts its own conversation', () => {
  it('clicks New Chat when a thread is already open, and clears it', async () => {
    const h = buildHarness(6);
    expect(h.messages()).toBe(6);

    h.execute(NODE);
    // Wait on the script's own confirmation, not on the DOM it is polling —
    // the thread empties ~30ms after the click and the script only notices on
    // its next 250ms tick.
    await waitFor(() => h.logs.some((l) => /Started a new chat/.test(l)));

    expect(h.clicks).toBe(1);
    expect(h.messages()).toBe(0);
    expect(h.logs.join('\n')).toContain('Started a new chat');
  });

  it('does not open a second empty chat when the thread is already empty', async () => {
    const h = buildHarness(0);

    h.execute(NODE);
    await waitFor(() => h.submitted.length > 0);

    expect(h.clicks).toBe(0);
    expect(h.logs.join('\n')).toContain('Already on an empty chat');
  });

  it('warns and keeps going when the control is missing, rather than failing the run', async () => {
    const h = buildHarness(4, /* withButton */ false);

    h.execute(NODE);
    await waitFor(() => h.submitted.length > 0);

    expect(h.clicks).toBe(0);
    // Isolation is lost, so it has to say so — silence here is what let the
    // contaminated answers through in the first place.
    expect(h.logs.join('\n')).toMatch(/WARNING: New Chat control not found/);
    // The prompt is still submitted: a moved button must not block the run.
    expect(h.submitted.join('')).toContain('sneaker');
  });

  it('resets the thread before the prompt is typed, not after', async () => {
    const h = buildHarness(3);

    h.execute(NODE);
    await waitFor(() => h.submitted.length > 0);

    /* Ordering is the whole point. Typing first and resetting after would
       throw the prompt away with the thread, and the baseline snapshots the
       script takes for "what is new on screen" would be taken against the
       old conversation. */
    expect(h.messages()).toBe(0);
    expect(h.submitted.join('')).toContain('sneaker');
  });
});
