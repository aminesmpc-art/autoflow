/**
 * @jest-environment jsdom
 */

/* ============================================================
   Gemini, booted from the built bundle against a fake page.

   Same method as the ChatGPT harness, and for the same reason: the failures
   that matter on a chat platform are all silent. It typed into nothing; it
   sent before the upload finished; it captured the wrong image; it captured
   none and waited six minutes. None of those throw, and none are visible by
   reading the code.
   ============================================================ */

/// <reference types="node" />

import { existsSync } from 'fs';
import { join } from 'path';
import { TextEncoder, TextDecoder } from 'util';

const BUNDLE = join(__dirname, '../../dist/gemini-content.js');

const RED_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4' +
  '2mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

type Listener = (msg: any, sender: any, respond: (r: any) => void) => boolean | void;

interface Harness {
  composer: HTMLElement;
  sendBtn: HTMLButtonElement;
  fileInput: HTMLInputElement;
  host: HTMLElement;
  /** Where Gemini really puts attachment chips: beside the composer. */
  attachWrapper: HTMLElement;
  sent: any[];
  execute: (payload: any) => Promise<any>;
}

const box = (w: number, h: number) => () =>
  ({ width: w, height: h, top: 0, left: 0, bottom: h, right: w, x: 0, y: 0, toJSON() {} });

/** Gemini's shape: a Quill editor inside rich-textarea, plus a send button. */
function buildHarness(): Harness {
  document.body.innerHTML = '';

  const host = document.createElement('rich-textarea');
  const composer = document.createElement('div');
  composer.className = 'ql-editor';
  composer.setAttribute('contenteditable', 'true');
  composer.setAttribute('role', 'textbox');
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'image/*';
  const sendBtn = document.createElement('button');
  sendBtn.className = 'send-button';
  sendBtn.setAttribute('aria-label', 'Send message');

  /* The attachment chips do NOT live inside rich-textarea. Measured on the
     live page, they render in `.attachment-preview-wrapper`, a sibling of it —
     which is why a count scoped to the composer saw zero however many files
     had landed, and why this fixture used to hide the bug by putting the
     thumbnail in the wrong place. */
  const attachWrapper = document.createElement('div');
  attachWrapper.className = 'attachment-preview-wrapper';

  host.append(composer, fileInput, sendBtn);
  document.body.append(attachWrapper, host);
  for (const el of [host, composer, sendBtn, fileInput]) {
    (el as any).getBoundingClientRect = box(400, 40);
  }
  Object.defineProperty(composer, 'innerText', {
    get: () => composer.textContent || '', configurable: true,
  });

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

  return { composer, sendBtn, fileInput, host, attachWrapper, sent, execute };
}

/**
 * A model turn, shaped like the live one: the answer lives in
 * `message-content`, and the footer full of Good response / Redo / Copy
 * buttons sits alongside it inside the same `model-response`.
 */
function modelTurn(text = ''): HTMLElement {
  const el = document.createElement('model-response');
  el.innerHTML = `
    <div class="response-container">
      <message-content><div class="markdown markdown-main-panel" aria-busy="false"></div></message-content>
      <div class="response-footer gap complete">
        <button aria-label="Good response">thumb_up</button>
        <button aria-label="Redo">refresh</button>
        <button aria-label="Copy">copy</button>
      </div>
    </div>`;
  document.body.append(el);
  for (const n of [el, ...Array.from(el.querySelectorAll<HTMLElement>('*'))]) {
    Object.defineProperty(n, 'innerText', {
      configurable: true, get: () => n.textContent || '',
    });
  }
  const panel = el.querySelector<HTMLElement>('.markdown-main-panel')!;
  panel.textContent = text;
  // Callers set .textContent on the returned handle; route that to the panel
  // so the shape stays honest.
  return new Proxy(el, {
    get(t, k) {
      if (k === 'textContent') return panel.textContent;
      const v: any = (t as any)[k];
      return typeof v === 'function' ? v.bind(t) : v;
    },
    set(t, k, v) {
      if (k === 'textContent') { panel.textContent = v; return true; }
      (t as any)[k] = v; return true;
    },
  }) as HTMLElement;
}

function resultImage(parent: HTMLElement, src: string): HTMLImageElement {
  const img = document.createElement('img');
  img.src = src;
  Object.defineProperty(img, 'complete', { value: true });
  Object.defineProperty(img, 'naturalWidth', { value: 1024 });
  Object.defineProperty(img, 'naturalHeight', { value: 1024 });
  (img as any).getBoundingClientRect = box(500, 500);
  parent.append(img);
  return img;
}

const errorsFrom = (h: Harness) =>
  h.sent.filter((m) => m.type === 'STUDIO_NODE_ERROR').map((m) => m.payload.error);

function polyfillFileTransfer(): void {
  if (!(globalThis as any).DataTransfer) {
    (globalThis as any).DataTransfer = class {
      private _files: File[] = [];
      items = { add: (f: File) => { this._files.push(f); } };
      get files(): any {
        const list: any = [...this._files];
        list.item = (i: number) => list[i] ?? null;
        return list;
      }
    };
  }
  // jsdom brand-checks for a real FileList and nothing outside its internals
  // can mint one; Chrome accepts the one off a real DataTransfer.
  Object.defineProperty(HTMLInputElement.prototype, 'files', {
    configurable: true,
    get() { return (this as any)._files ?? Object.assign([], { item: () => null }); },
    set(v: any) { (this as any)._files = v; },
  });
}

beforeAll(() => {
  (globalThis as any).TextEncoder ||= TextEncoder;
  (globalThis as any).TextDecoder ||= TextDecoder;
  polyfillFileTransfer();
});
beforeEach(() => { jest.resetModules(); });

describe('Gemini adapter', () => {
  it('ships a built bundle', () => {
    expect(existsSync(BUNDLE)).toBe(true);
  });

  it('types the prompt into the Quill composer and sends', async () => {
    const h = buildHarness();
    let clicked = 0;
    h.sendBtn.addEventListener('click', () => { clicked++; });

    await h.execute({ nodeId: 'n1', config: { prompt: 'a reference sheet of a fox', mediaType: 'image' } });
    await new Promise((r) => setTimeout(r, 300));

    expect(h.composer.textContent).toBe('a reference sheet of a fox');
    expect(clicked).toBe(1);
    expect(errorsFrom(h)).toEqual([]);
  }, 20_000);

  it('captures the image Gemini produced', async () => {
    const h = buildHarness();
    setTimeout(() => resultImage(modelTurn(), 'https://gemini.example/result.png'), 2500);
    (globalThis as any).fetch = (url: string) => Promise.resolve({
      ok: true, blob: () => Promise.resolve(new Blob([url], { type: 'image/png' })),
    });

    await h.execute({ nodeId: 'n1', config: { prompt: 'draw a fox cub', mediaType: 'image' } });
    await new Promise((r) => setTimeout(r, 12_000));

    const result = h.sent.find((m) => m.type === 'STUDIO_NODE_RESULT');
    expect(result).toBeDefined();
    const captured = Buffer.from(result.payload.imageUrl.split(',')[1], 'base64').toString();
    expect(captured).toBe('https://gemini.example/result.png');
  }, 30_000);

  it('returns the written reply for a prompt-writer node', async () => {
    const h = buildHarness();
    const turn = modelTurn();
    setTimeout(() => {
      turn.textContent =
        'A solid block of walnut on a workbench, chisel paring away long curls of wood, ' +
        'macro lens, warm key light from the left, shallow depth of field.';
    }, 2500);

    await h.execute({ nodeId: 'n1', config: { prompt: 'write me a prompt', mediaType: 'text' } });
    await new Promise((r) => setTimeout(r, 12_000));

    const result = h.sent.find((m) => m.type === 'STUDIO_NODE_RESULT');
    expect(result?.payload.text).toMatch(/walnut/);
  }, 30_000);

  it('uploads a reference before sending', async () => {
    const h = buildHarness();
    /* Stand in for Gemini accepting the file: it renders an
       <uploader-file-preview class="file-preview-chip"> in the wrapper beside
       the composer — not an <img> inside it. */
    h.fileInput.addEventListener('change', () => {
      setTimeout(() => {
        const chip = document.createElement('uploader-file-preview');
        chip.className = 'file-preview-chip';
        chip.append(resultImage(h.attachWrapper, 'blob:thumb'));
        h.attachWrapper.append(chip);
      }, 100);
    });

    await h.execute({
      nodeId: 'n1',
      config: { prompt: 'carve this car', mediaType: 'image', referenceImageData: [RED_PNG] },
    });
    await new Promise((r) => setTimeout(r, 300));

    expect(h.fileInput.files).toHaveLength(1);
    expect(h.fileInput.files![0].type).toBe('image/png');
    expect(errorsFrom(h)).toEqual([]);
  }, 20_000);

  it('refuses a reference that arrived as a Flow tile id', async () => {
    const h = buildHarness();
    let clicked = 0;
    h.sendBtn.addEventListener('click', () => { clicked++; });

    await h.execute({
      nodeId: 'n1',
      config: { prompt: 'carve this car', mediaType: 'image', referenceImageIds: ['fe_id_1'] },
    });
    await new Promise((r) => setTimeout(r, 300));

    // A tile id names a tile in Flow's grid; Gemini cannot resolve one.
    expect(clicked).toBe(0);
    expect(errorsFrom(h).join(' ')).toMatch(/Flow tile/i);
  }, 20_000);

  /* Built from the live composer DOM. The detail that matters: with a blank
     composer Gemini renders NO send button — only a model picker and a mic.
     Code that read "no send button" as "still busy" could never see a turn
     finish, and every node would have run to its timeout with the answer
     visible on screen. */
  it('finishes a turn on the real composer, which has no send button', async () => {
    const h = buildHarness();
    h.host.remove();

    const real = document.createElement('div');
    real.innerHTML = `
      <div class="text-input-field simplified-input-area">
        <rich-textarea class="text-input-field_textarea ql-container ql-bubble" enterkeyhint="send" dir="ltr">
          <div class="ql-editor ql-blank textarea" contenteditable="true" dir="auto"
               role="textbox" aria-multiline="true"
               aria-label="Enter a prompt for Gemini" data-placeholder="Ask Gemini"><p><br></p></div>
        </rich-textarea>
        <button aria-label="Upload and tools"><mat-icon fonticon="plus"></mat-icon></button>
        <button data-test-id="bard-mode-menu-button" aria-label="Open mode picker, currently Flash">Flash</button>
        <button aria-label="Dictate (^⇧D)"><mat-icon fonticon="mic"></mat-icon></button>
      </div>`;
    document.body.append(real);
    for (const el of Array.from(real.querySelectorAll<HTMLElement>('*'))) {
      (el as any).getBoundingClientRect = box(320, 40);
      Object.defineProperty(el, 'innerText', {
        configurable: true, get: () => el.textContent || '',
      });
    }
    const editor = real.querySelector<HTMLElement>('.ql-editor')!;
    (document as any).execCommand = (cmd: string, _ui: boolean, value: string) => {
      if (cmd === 'insertText') editor.textContent = value;
      return true;
    };

    const turn = modelTurn();
    setTimeout(() => {
      turn.textContent =
        'Macro shot of a chisel paring a long curl from a block of walnut, ' +
        'warm key light from the left, shallow depth of field, no hands in frame.';
    }, 2500);

    await h.execute({ nodeId: 'n1', config: { prompt: 'write me a carving prompt', mediaType: 'text' } });
    await new Promise((r) => setTimeout(r, 12_000));

    expect(editor.textContent).toContain('write me a carving prompt');
    const result = h.sent.find((m) => m.type === 'STUDIO_NODE_RESULT');
    expect(result?.payload.text).toMatch(/walnut/);
  }, 30_000);

  it('treats a visible stop control as still writing', async () => {
    const h = buildHarness();
    const stop = document.createElement('button');
    stop.setAttribute('aria-label', 'Stop response');
    (stop as any).getBoundingClientRect = box(40, 40);
    document.body.append(stop);

    const turn = modelTurn('half a sentence that keeps growing and growing here');
    // Mark the turn as still streaming, the way Gemini does.
    turn.querySelector('.response-footer')!.classList.remove('complete');
    // Never stops streaming, so nothing may be captured however stable it is.
    await h.execute({ nodeId: 'n1', config: { prompt: 'write me a prompt', mediaType: 'text' } });
    await new Promise((r) => setTimeout(r, 9000));
    expect(h.sent.find((m) => m.type === 'STUDIO_NODE_RESULT')).toBeUndefined();

    // Finish the turn — stop control gone, footer marked complete.
    stop.remove();
    turn.querySelector('.response-footer')!.classList.add('complete');
    turn.textContent = turn.textContent + ' and now it has finished properly.';
    await new Promise((r) => setTimeout(r, 8000));
    expect(h.sent.find((m) => m.type === 'STUDIO_NODE_RESULT')).toBeDefined();
  }, 40_000);

  it('says so when it is not signed in', async () => {
    const h = buildHarness();
    // A login wall: composer gone, marketing copy in its place.
    h.host.remove();
    const wall = document.createElement('p');
    wall.textContent = 'Sign in to continue to Gemini';
    document.body.append(wall);
    // jsdom implements no innerText; the script reads body.innerText to tell
    // a login wall from a page that simply has not mounted yet.
    Object.defineProperty(document.body, 'innerText', {
      configurable: true,
      get: () => document.body.textContent || '',
    });

    await h.execute({ nodeId: 'n1', config: { prompt: 'anything at all', mediaType: 'image' } });
    await new Promise((r) => setTimeout(r, 7500));

    // "Not signed in" is actionable; "prompt box not found" sends the user
    // looking for a bug that is not there.
    expect(errorsFrom(h).join(' ')).toMatch(/not signed in/i);
  }, 25_000);
});
