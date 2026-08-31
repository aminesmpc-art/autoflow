/**
 * @jest-environment jsdom
 */

/**
 * Waiting for ChatGPT to actually finish.
 *
 * The adapter decided a reply was complete from two absences: the stop button
 * had gone, and the text had not changed for two polls. Both lie. The stop
 * button disappears between chunks while the model thinks, and a pause
 * mid-answer looks exactly like a settled one — so a half-written prompt was
 * captured and sent to a generator, which then produced a clip from half a
 * sentence and reported success.
 *
 * ChatGPT renders its action bar — copy, rate, share — only once a turn is
 * complete. `copy-turn-action-button` is therefore a positive statement that
 * the answer is finished, which is what the other two signals never were.
 *
 * The trap, and the reason this file exists: EVERY earlier turn has a copy
 * button. A page-wide query reports "finished" the moment the conversation
 * has any history, which is every run after the first.
 */

/// <reference types="node" />

import { existsSync } from 'fs';
import { join } from 'path';

const BUNDLE = join(__dirname, '../../dist/chatgpt-content.js');
type Listener = (m: any, s: any, r: (x: any) => void) => void;

const BOX = { width: 400, height: 40, top: 0, left: 0, bottom: 40, right: 400, x: 0, y: 0, toJSON() {} };

async function tick(ms = 60): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

async function waitFor(check: () => boolean, ms = 6000): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (check()) return true;
    await tick(25);
  }
  return false;
}

/** A conversation with `history` completed turns, ready to be asked again. */
/* jsdom does not implement innerText, and the adapter reads replies with it.
   Without this every read returns undefined, the tracker never sees an answer
   at all, and the two "reply is not captured" tests pass for the wrong reason
   entirely — which is exactly what they did on the first run. */
if (!Object.getOwnPropertyDescriptor(globalThis.HTMLElement?.prototype ?? {}, 'innerText')) {
  Object.defineProperty(globalThis.HTMLElement.prototype, 'innerText', {
    configurable: true,
    get(this: HTMLElement) { return this.textContent ?? ''; },
    set(this: HTMLElement, v: string) { this.textContent = v; },
  });
}

function harness(history: number) {
  document.body.innerHTML = '';
  const sent: any[] = [];
  const listeners: Listener[] = [];

  const composer = document.createElement('div');
  composer.id = 'prompt-textarea';
  composer.setAttribute('contenteditable', 'true');
  const send = document.createElement('button');
  send.setAttribute('data-testid', 'send-button');
  send.addEventListener('click', () => { setTimeout(() => { composer.textContent = ''; }, 0); });
  const form = document.createElement('form');
  form.append(composer, send);

  const thread = document.createElement('div');
  /* Completed history: each turn carries its action bar, exactly as a real
     page does. This is what a page-wide copy-button query trips over. */
  for (let i = 0; i < history; i++) {
    const turn = document.createElement('article');
    const msg = document.createElement('div');
    msg.setAttribute('data-message-author-role', i % 2 ? 'assistant' : 'user');
    msg.textContent = `old turn ${i}`;
    turn.append(msg);
    if (i % 2) {
      const copy = document.createElement('button');
      copy.setAttribute('data-testid', 'copy-turn-action-button');
      turn.append(copy);
    }
    thread.append(turn);
  }
  document.body.append(form, thread);
  for (const el of Array.from(document.querySelectorAll('*'))) {
    (el as any).getBoundingClientRect = () => BOX;
  }

  (globalThis as any).chrome = {
    runtime: {
      onMessage: { addListener: (fn: Listener) => listeners.push(fn) },
      sendMessage: (m: any) => { sent.push(m); return Promise.resolve(); },
    },
  };
  (document as any).execCommand = (cmd: string, _u: boolean, v: string) => {
    if (cmd === 'insertText') composer.textContent = v;
    return true;
  };

  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require(BUNDLE);
  });

  /** Begin the assistant's answer, still streaming: no action bar yet. */
  const startReply = (text: string) => {
    const turn = document.createElement('article');
    turn.id = 'live-turn';
    const msg = document.createElement('div');
    msg.setAttribute('data-message-author-role', 'assistant');
    msg.textContent = text;
    turn.append(msg);
    thread.append(turn);
    for (const el of Array.from(turn.querySelectorAll('*'))) {
      (el as any).getBoundingClientRect = () => BOX;
    }
    (turn as any).getBoundingClientRect = () => BOX;
    return turn;
  };

  const growReply = (text: string) => {
    const m = document.querySelector('#live-turn [data-message-author-role="assistant"]');
    if (m) (m as HTMLElement).textContent = text;
  };

  /** ChatGPT finishing: the action bar appears on that turn. */
  const finishReply = () => {
    const turn = document.getElementById('live-turn');
    if (!turn) return;
    const copy = document.createElement('button');
    copy.setAttribute('data-testid', 'copy-turn-action-button');
    (copy as any).getBoundingClientRect = () => BOX;
    turn.append(copy);
  };

  const execute = (payload: any) => new Promise<any>((resolve) => {
    let done = false;
    for (const fn of listeners) {
      fn({ type: 'STUDIO_EXECUTE_NODE', payload }, {}, (r: any) => {
        if (!done) { done = true; resolve(r); }
      });
    }
  });

  const results = () => sent.filter((m) => m?.type === 'STUDIO_NODE_RESULT');
  return { execute, sent, results, startReply, growReply, finishReply, composer };
}

const ASK = {
  nodeId: 'n1',
  config: { mediaType: 'text', prompt: 'Write one line about a sneaker.', rawReply: true },
};

const HALF = 'A charcoal sneaker on a plain grey';
const FULL = 'A charcoal sneaker on a plain grey backdrop, lit softly from the left, '
  + 'photographed straight on with the whole shoe in frame and nothing cropped.';

beforeAll(() => {
  if (!existsSync(BUNDLE)) throw new Error(`build first: ${BUNDLE} is missing`);
});

// POLL_MS is 2s and two stable polls are required, so a completion needs
// roughly six seconds of wall clock after the text stops changing.
jest.setTimeout(45000);

describe('a reply that pauses mid-sentence', () => {
  it('is not captured while the action bar is missing', async () => {
    const h = harness(0);
    h.execute(ASK);
    await waitFor(() => h.composer.textContent === '', 3000);

    h.startReply(HALF);
    /* Longer than a completion takes. POLL_MS is 2s and two stable polls are
       required, so without the gate this text would have been accepted at
       about six seconds — waiting less than that proves nothing, which is
       what the first version of this test did. */
    await tick(11000);

    expect(h.results()).toHaveLength(0);
  });

  it('is captured in full once the action bar appears', async () => {
    const h = harness(0);
    h.execute(ASK);
    await waitFor(() => h.composer.textContent === '', 3000);

    h.startReply(HALF);
    await tick(900);
    h.growReply(FULL);
    h.finishReply();

    const got = await waitFor(() => h.results().length > 0, 20000);
    expect(got).toBe(true);
    expect(String(h.results()[0].payload?.text || '')).toContain('nothing cropped');
    expect(String(h.results()[0].payload?.text || '')).not.toBe(HALF);
  });
});

describe('a conversation that already has history', () => {
  it('does not treat an earlier turn’s copy button as this turn finishing', async () => {
    /* Four completed turns, each with its own action bar. A page-wide query
       for the button is true before the new answer has even started. */
    const h = harness(4);
    h.execute(ASK);
    await waitFor(() => h.composer.textContent === '', 3000);

    h.startReply(HALF);
    await tick(11000);

    expect(h.results()).toHaveLength(0);
  });

  it('finishes when the newest turn gets its own action bar', async () => {
    const h = harness(4);
    h.execute(ASK);
    await waitFor(() => h.composer.textContent === '', 3000);

    h.startReply(FULL);
    h.finishReply();

    expect(await waitFor(() => h.results().length > 0, 20000)).toBe(true);
    expect(String(h.results()[0].payload?.text || '')).toContain('nothing cropped');
  });
});
