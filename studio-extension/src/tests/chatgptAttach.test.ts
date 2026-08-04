/**
 * @jest-environment jsdom
 */

/* ============================================================
   Does the ChatGPT node actually put the image on the page?

   It used to not. The runner gathered reference images, packed them into the
   node config, sent them over the bridge — and the content script read only
   `prompt`. Every wire into a ChatGPT node was decorative: the run looked
   perfect and the answer was about an image ChatGPT had never seen.

   That is unfalsifiable by inspection, so this boots the BUILT bundle against
   a fake composer and checks the bytes that land in the file input. A stub of
   a stub proves nothing; dist/chatgpt-content.js is what ships.
   ============================================================ */

// Pulled in explicitly: tsconfig limits `types` to chrome + jest so node
// globals stay out of the extension source, and only this harness needs them.
/// <reference types="node" />

import { existsSync } from 'fs';
import { join } from 'path';
import { TextEncoder, TextDecoder } from 'util';

const BUNDLE = join(__dirname, '../../dist/chatgpt-content.js');

// A 1x1 red PNG, small enough to assert on byte-for-byte.
const RED_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4' +
  '2mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

type Listener = (msg: any, sender: any, respond: (r: any) => void) => boolean | void;

interface Harness {
  fileInput: HTMLInputElement;
  sendBtn: HTMLButtonElement;
  composer: HTMLElement;
  form: HTMLFormElement;
  sent: any[];
  execute: (payload: any) => Promise<any>;
}

/** A composer close enough to ChatGPT's for the script's selectors to bite. */
function buildHarness(): Harness {
  document.body.innerHTML = '';

  const form = document.createElement('form');
  const composer = document.createElement('div');
  composer.id = 'prompt-textarea';
  composer.setAttribute('contenteditable', 'true');
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'image/*';
  fileInput.multiple = true;
  const sendBtn = document.createElement('button');
  sendBtn.setAttribute('data-testid', 'send-button');

  form.append(composer, fileInput, sendBtn);
  document.body.append(form);

  // Everything the script measures is zero-sized under jsdom, so isVisible()
  // would reject the whole page. Give the elements a real box.
  const box = { width: 400, height: 40, top: 0, left: 0, bottom: 40, right: 400, x: 0, y: 0, toJSON() {} };
  for (const el of [composer, sendBtn, fileInput]) {
    (el as any).getBoundingClientRect = () => box;
  }

  const sent: any[] = [];
  const listeners: Listener[] = [];
  (globalThis as any).chrome = {
    runtime: {
      onMessage: { addListener: (fn: Listener) => listeners.push(fn) },
      sendMessage: (msg: any) => { sent.push(msg); return Promise.resolve(); },
    },
  };

  // execCommand is what fillComposer uses for contenteditable; jsdom has no
  // editing host, so emulate the one behaviour the script depends on.
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

  return { fileInput, sendBtn, composer, form, sent, execute };
}

/** Stand in for ChatGPT: show a thumbnail once files are picked. */
function autoAcceptUploads(h: Harness, delayMs = 100): void {
  h.fileInput.addEventListener('change', () => {
    setTimeout(() => {
      for (let i = 0; i < (h.fileInput.files?.length || 0); i++) {
        const thumb = document.createElement('img');
        thumb.src = 'blob:preview';
        h.form.append(thumb);
      }
    }, delayMs);
  });
}

const errorsFrom = (h: Harness) =>
  h.sent.filter((m) => m.type === 'STUDIO_NODE_ERROR').map((m) => m.payload.error);

/**
 * jsdom implements neither DataTransfer nor a settable `files`, both of which
 * Chrome has. Modelled on Chrome's behaviour rather than waved away: the point
 * of the test is that real bytes reach the input, so the shim has to carry
 * them faithfully or it proves nothing.
 */
function polyfillFileTransfer(): void {
  if (!(globalThis as any).DataTransfer) {
    (globalThis as any).DataTransfer = class {
      private _files: File[] = [];
      items = {
        add: (f: File) => { this._files.push(f); },
      };
      get files(): any {
        const list: any = [...this._files];
        list.item = (i: number) => list[i] ?? null;
        return list;
      }
    };
  }

  /* jsdom has a `files` setter, but it brand-checks for a genuine FileList,
     and nothing outside jsdom's internals can mint one. Chrome accepts the
     FileList off a real DataTransfer, so the strictness is equivalent — it is
     only the shim that cannot satisfy it. Replaced outright rather than
     skipped: what this test needs to observe is the File objects and their
     bytes, which the assignment carries either way. */
  Object.defineProperty(HTMLInputElement.prototype, 'files', {
    configurable: true,
    get() { return (this as any)._files ?? Object.assign([], { item: () => null }); },
    set(v: any) { (this as any)._files = v; },
  });
}

beforeAll(() => {
  // jsdom 26 ships neither; the bundle's atob path and File both want them.
  (globalThis as any).TextEncoder ||= TextEncoder;
  (globalThis as any).TextDecoder ||= TextDecoder;
  polyfillFileTransfer();
});

beforeEach(() => { jest.resetModules(); });

describe('ChatGPT reference upload', () => {
  it('has a built bundle to test', () => {
    expect(existsSync(BUNDLE)).toBe(true);
  });

  it('puts the reference image into the page file input', async () => {
    const h = buildHarness();
    autoAcceptUploads(h);

    await h.execute({
      nodeId: 'n1',
      config: { prompt: 'continue this scene', mediaType: 'image', referenceImageData: [RED_PNG] },
    });
    await new Promise((r) => setTimeout(r, 300));

    // The assertion that would have caught the original bug: a file, on the
    // page's own input, with the bytes we were given.
    expect(h.fileInput.files).toHaveLength(1);
    const file = h.fileInput.files![0];
    expect(file.type).toBe('image/png');
    expect(file.name).toMatch(/\.png$/);
    // jsdom's File has no arrayBuffer(); FileReader is the route it implements.
    const bytes = await new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(file);
    });
    const expected = Buffer.from(RED_PNG.split(',')[1], 'base64');
    expect(Buffer.from(bytes)).toEqual(expected);
  }, 20_000);

  it('attaches every reference, not just the first', async () => {
    const h = buildHarness();
    autoAcceptUploads(h);

    await h.execute({
      nodeId: 'n1',
      config: { prompt: 'blend these', mediaType: 'image', referenceImageData: [RED_PNG, RED_PNG] },
    });
    await new Promise((r) => setTimeout(r, 300));

    expect(h.fileInput.files).toHaveLength(2);
  }, 20_000);

  it('still types the prompt and submits after uploading', async () => {
    const h = buildHarness();
    autoAcceptUploads(h);
    let clicked = 0;
    h.sendBtn.addEventListener('click', () => { clicked++; });

    await h.execute({
      nodeId: 'n1',
      config: { prompt: 'continue this scene', mediaType: 'image', referenceImageData: [RED_PNG] },
    });
    await new Promise((r) => setTimeout(r, 300));

    // Uploading re-renders the composer on the real site; the prompt must
    // survive that, and send must come after the attachment, not before.
    expect(h.composer.textContent).toBe('continue this scene');
    expect(clicked).toBe(1);
    expect(errorsFrom(h)).toEqual([]);
  }, 20_000);

  it('fails instead of sending when the upload never lands', async () => {
    const h = buildHarness();
    // No autoAcceptUploads: the file is picked and no thumbnail ever appears,
    // which is what a rejected or stalled upload looks like.
    let clicked = 0;
    h.sendBtn.addEventListener('click', () => { clicked++; });

    // Resolves only once the upload wait gives up — awaiting it is the wait.
    await h.execute({
      nodeId: 'n1',
      config: { prompt: 'continue this scene', mediaType: 'image', referenceImageData: [RED_PNG] },
    });

    // Answering about an image ChatGPT never received is the failure this
    // whole path exists to prevent — so nothing may be sent.
    expect(clicked).toBe(0);
    expect(errorsFrom(h).join(' ')).toMatch(/did not finish uploading/i);
  }, 90_000);

  it('refuses a reference that arrived as a Flow tile id', async () => {
    const h = buildHarness();
    let clicked = 0;
    h.sendBtn.addEventListener('click', () => { clicked++; });

    await h.execute({
      nodeId: 'n1',
      config: { prompt: 'continue this scene', mediaType: 'image', referenceImageIds: ['fe_id_123'] },
    });
    await new Promise((r) => setTimeout(r, 300));

    // A tile id names a tile in Flow's grid; ChatGPT cannot resolve it.
    expect(clicked).toBe(0);
    expect(errorsFrom(h).join(' ')).toMatch(/Flow tile/i);
  }, 20_000);

  it('sends straight away when no reference is wired', async () => {
    const h = buildHarness();
    let clicked = 0;
    h.sendBtn.addEventListener('click', () => { clicked++; });

    await h.execute({ nodeId: 'n1', config: { prompt: 'write me four prompts', mediaType: 'text' } });
    await new Promise((r) => setTimeout(r, 300));

    // The un-wired case must not have grown a 60s upload wait.
    expect(h.fileInput.files).toHaveLength(0);
    expect(clicked).toBe(1);
    expect(errorsFrom(h)).toEqual([]);
  }, 20_000);

  it('uploads for a prompt-writer node too', async () => {
    const h = buildHarness();
    autoAcceptUploads(h);

    await h.execute({
      nodeId: 'n1',
      config: { prompt: 'describe what happens next', mediaType: 'text', referenceImageData: [RED_PNG] },
    });
    await new Promise((r) => setTimeout(r, 300));

    // "Look at this frame and write the next prompt" is the main reason to
    // wire an image into Ask AI at all.
    expect(h.fileInput.files).toHaveLength(1);
    expect(errorsFrom(h)).toEqual([]);
  }, 20_000);
});
