/**
 * @jest-environment jsdom
 */

/* ============================================================
   Grok, booted from the built bundle against a fake page.

   The page here is not invented. Every attribute below was read off a live,
   signed-in grok.com: a TipTap/ProseMirror contenteditable, an
   input[type=file][multiple] already present in the document, a
   button[aria-label="Attach"], and — only once the composer has text — a
   button[type="submit"][aria-label="Submit"].

   That last one is the point of most of this file. Grok renders NO send
   button while the composer is empty, which is also the state the page
   returns to after answering. Every check that reads "no send button" as
   "busy" therefore deadlocks, and the deadlock is silent: the node runs to
   its full timeout with the answer sitting on screen. Gemini shipped exactly
   that bug once already.

   Not covered, deliberately: the shape of a finished turn. Reading it needs a
   real conversation, and this was written against an empty history rather
   than spending one of the user's generations to find out. readLatestReply is
   a ladder ending in a page-wide search for that reason.
   ============================================================ */

/// <reference types="node" />

import { existsSync } from 'fs';
import { join } from 'path';

const BUNDLE = join(__dirname, '../../dist/grok-content.js');

type Listener = (msg: any, sender: any, respond: (r: any) => void) => boolean | void;

const box = (w: number, h: number) => () =>
  ({ width: w, height: h, top: 0, left: 0, bottom: h, right: w, x: 0, y: 0, toJSON() {} });

interface Harness {
  composer: HTMLElement;
  fileInput: HTMLInputElement;
  form: HTMLElement;
  sent: any[];
  execute: (payload: any) => Promise<any>;
  /** Grok only mounts a submit button once there is something to submit. */
  showSubmit: () => HTMLButtonElement;
}

function buildHarness(): Harness {
  document.body.innerHTML = '';

  const form = document.createElement('form');
  const composer = document.createElement('div');
  // Verbatim from the live page.
  composer.className = 'tiptap ProseMirror w-full px-2 bg-transparent';
  composer.setAttribute('contenteditable', 'true');
  composer.setAttribute('aria-label', 'Ask Grok anything');

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.multiple = true;   // accept is empty on the real page

  const attach = document.createElement('button');
  attach.setAttribute('aria-label', 'Attach');

  form.append(composer, fileInput, attach);
  document.body.append(form);
  for (const el of [form, composer, fileInput, attach]) {
    (el as any).getBoundingClientRect = box(400, 40);
  }
  Object.defineProperty(composer, 'innerText', {
    get: () => composer.textContent || '', configurable: true,
  });

  const showSubmit = (): HTMLButtonElement => {
    const existing = document.querySelector<HTMLButtonElement>('button[type="submit"]');
    if (existing) return existing;
    const btn = document.createElement('button');
    btn.type = 'submit';
    btn.setAttribute('aria-label', 'Submit');
    (btn as any).getBoundingClientRect = box(32, 32);
    form.append(btn);
    return btn;
  };

  const sent: any[] = [];
  const listeners: Listener[] = [];
  (globalThis as any).chrome = {
    runtime: {
      onMessage: { addListener: (fn: Listener) => listeners.push(fn) },
      sendMessage: (msg: any) => { sent.push(msg); return Promise.resolve(); },
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

  return { composer, fileInput, form, sent, execute, showSubmit };
}

const errorsFrom = (sent: any[]) =>
  sent.filter((m) => m.type === 'STUDIO_NODE_ERROR').map((m) => m.payload.error);

describe('the Grok bundle', () => {
  it('is built', () => {
    // Every test here drives the real bundle; without it they would pass vacuously.
    expect(existsSync(BUNDLE)).toBe(true);
  });
});

describe('submitting', () => {
  let h: Harness;
  beforeEach(() => {
    h = buildHarness();
    // ProseMirror handles paste itself; jsdom does not, so stand in for it.
    h.composer.addEventListener('paste', (e: any) => {
      const text = e.clipboardData?.getData('text/plain') || '';
      if (text) h.composer.textContent = text;
    });
  });

  it('types the prompt into the ProseMirror composer', async () => {
    h.showSubmit();
    await h.execute({ nodeId: 'n1', config: { prompt: 'a tired detective in the rain' } });
    expect(h.composer.textContent).toBe('a tired detective in the rain');
  });

  it('clicks Submit once the composer has text', async () => {
    /* The button does not exist before this point on the real page, which is
       why it is created here rather than in the harness. */
    const btn = h.showSubmit();
    let clicked = 0;
    btn.addEventListener('click', () => clicked++);
    await h.execute({ nodeId: 'n1', config: { prompt: 'hello' } });
    expect(clicked).toBe(1);
  });

  it('falls back to Enter when no submit button appeared', async () => {
    // No showSubmit() — the page never mounts one.
    let entered = 0;
    h.composer.addEventListener('keydown', (e: any) => { if (e.key === 'Enter') entered++; });
    await h.execute({ nodeId: 'n1', config: { prompt: 'hello' } });
    expect(entered).toBe(1);
  });

  it('refuses an empty prompt instead of sending one', async () => {
    // An empty submit spends a generation and returns something unusable.
    await h.execute({ nodeId: 'n1', config: { prompt: '   ' } });
    expect(errorsFrom(h.sent).join(' ')).toMatch(/empty/i);
  });

  // Ten retries at 600ms before it gives up — a slow tab is not a missing one.
  it('says so when there is no composer at all', async () => {
    document.body.innerHTML = '<div>Sign in to continue</div>';
    await h.execute({ nodeId: 'n1', config: { prompt: 'hello' } });
    expect(errorsFrom(h.sent).join(' ')).toMatch(/sign(ed)? in|prompt box not found/i);
  }, 15_000);
});

describe('reference images', () => {
  let h: Harness;
  beforeEach(() => { h = buildHarness(); });

  it('refuses a Flow tile id rather than sending the prompt alone', async () => {
    /* A tile id names a tile in Flow's grid; Grok cannot resolve one. Sending
       the text by itself would produce a confident answer about an image it
       never received — the failure that looks like success. */
    await h.execute({
      nodeId: 'n1',
      config: { prompt: 'describe this', referenceImageIds: ['fe_id_123'] },
    });
    expect(errorsFrom(h.sent).join(' ')).toMatch(/not an image file|Flow tile/i);
    expect(h.composer.textContent).toBe('');
  });
});
