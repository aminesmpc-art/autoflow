/**
 * @jest-environment jsdom
 */

/* ============================================================
   ChatGPT's page as read on 2026-10-29.

   Three hooks the adapter leaned on were gone:
     #prompt-textarea              the composer is a ProseMirror editor
                                   labelled "Ask ChatGPT"
     create-new-chat-button        the sidebar control is a button labelled
                                   "New chat" — and each project row has its
                                   own "New chat in <project>"
     composer-plus-btn             the "+" is labelled "Add files and more",
                                   and its menu entries are plain buttons
   The send button kept no testid either; its label, "Send", still matched.

   With the New Chat hook gone every node after the first appended to the
   previous one's thread. This boots the BUILT bundle against that page, the
   way chatgptNewChat does, because dist/chatgpt-content.js is what ships.
   ============================================================ */

/// <reference types="node" />

import { existsSync } from 'fs';
import { join } from 'path';

const BUNDLE = join(__dirname, '../../dist/chatgpt-content.js');
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

function todaysPage(priorMessages: number) {
  document.body.innerHTML = '';
  const pressed: string[] = [];
  const submitted: string[] = [];

  const form = document.createElement('form');
  const composer = document.createElement('div');
  composer.className = 'ProseMirror';
  composer.setAttribute('contenteditable', 'true');
  composer.setAttribute('aria-label', 'Ask ChatGPT');
  const send = document.createElement('button');
  send.setAttribute('aria-label', 'Send');
  send.addEventListener('click', () => {
    submitted.push(composer.textContent || '');
    setTimeout(() => { composer.textContent = ''; }, 0);
  });
  form.append(composer, send);

  const thread = document.createElement('div');
  for (let i = 0; i < priorMessages; i++) {
    const m = document.createElement('div');
    m.setAttribute('data-message-author-role', i % 2 ? 'assistant' : 'user');
    thread.append(m);
  }

  const sidebar = document.createElement('nav');
  for (const label of ['New chat in Gym project', 'New chat', 'New chat in Devis']) {
    const b = document.createElement('button');
    b.setAttribute('aria-label', label);
    b.addEventListener('click', () => {
      pressed.push(label);
      setTimeout(() => { thread.innerHTML = ''; }, 30);
    });
    box(b);
    sidebar.append(b);
  }

  document.body.append(sidebar, thread, form);
  [composer, send].forEach(box);

  const logs: string[] = [];
  const listeners: Listener[] = [];
  (globalThis as any).chrome = {
    runtime: {
      onMessage: { addListener: (fn: Listener) => listeners.push(fn) },
      sendMessage: (msg: any) => {
        if (msg?.type === 'STUDIO_LOG') logs.push(String(msg.payload?.line ?? ''));
        return Promise.resolve();
      },
    },
  };
  (document as any).execCommand = (cmd: string, _ui: boolean, value: string) => {
    if (cmd === 'insertText') composer.textContent = value;
    return true;
  };
  jest.isolateModules(() => { require(BUNDLE); });

  const execute = (payload: any) => {
    for (const fn of listeners) fn({ type: 'STUDIO_EXECUTE_NODE', payload }, {}, () => {});
  };
  return { pressed, submitted, logs, execute };
}

const NODE = { nodeId: 'n1', config: { mediaType: 'text', prompt: 'Write one line about a sneaker.' } };

beforeAll(() => {
  if (!existsSync(BUNDLE)) throw new Error(`build first: ${BUNDLE} is missing`);
});

describe('ChatGPT as it is drawn now', () => {
  it('starts a new chat with the plain "New chat", never a project\'s', async () => {
    const page = todaysPage(4);
    page.execute(NODE);
    await waitFor(() => page.logs.some((l) => /Started a new chat/.test(l)));
    expect(page.pressed).toEqual(['New chat']);
  });

  it('types into the "Ask ChatGPT" editor and sends with the "Send" button', async () => {
    const page = todaysPage(0);
    page.execute(NODE);
    await waitFor(() => page.submitted.length > 0);
    expect(page.submitted.join('')).toContain('sneaker');
  });
});
