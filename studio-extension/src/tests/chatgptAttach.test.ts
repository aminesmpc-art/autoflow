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
  /* ChatGPT empties the composer when it accepts a message, and the script
     reads that as proof the send landed. A fake that keeps the text would be
     modelling a page that swallowed the click — which is a real state, and
     has its own test below. */
  // Cleared on the next tick, not inside the handler: the real page processes
  // the submit first, and clearing synchronously would hide the prompt from
  // anything else listening for the same click.
  sendBtn.addEventListener('click', () => {
    setTimeout(() => { composer.textContent = ''; }, 0);
  });

  /* The "+" menu, because an image node now selects the Create image tool
     through it. Modelled on the live one: it opens on pointerdown, its entries
     are div.__menu-item with no role, and choosing one drops a
     contenteditable="false" pill into the editor. A harness without it would
     make every image test exercise the failure path instead. */
  const plusBtn = document.createElement('button');
  plusBtn.setAttribute('data-testid', 'composer-plus-btn');
  plusBtn.addEventListener('pointerdown', () => {
    if (document.querySelector('.__menu-item')) return;
    const menu = document.createElement('div');
    menu.id = 'fake-plus-menu';
    for (const label of ['Add photos & filesUpload from computer', 'Create imageVisualize anything']) {
      const item = document.createElement('div');
      item.className = 'group __menu-item';
      item.textContent = label;
      (item as any).getBoundingClientRect = () =>
        ({ width: 260, height: 36, top: 0, left: 0, bottom: 36, right: 260, x: 0, y: 0, toJSON() {} });
      item.addEventListener('click', () => {
        if (!/^Create image/.test(label)) return;
        const cursor = document.createElement('span');
        cursor.setAttribute('contenteditable', 'false');
        cursor.setAttribute('data-inline-selection-pill-cursor-target', '');
        cursor.textContent = '﻿';
        const pill = document.createElement('span');
        pill.setAttribute('contenteditable', 'false');
        pill.setAttribute('data-inline-selection-pill', '');
        pill.textContent = 'Create image';
        composer.prepend(cursor, pill);
        menu.remove();
      });
      menu.append(item);
    }
    document.body.append(menu);
  });

  form.append(composer, fileInput, sendBtn, plusBtn);
  document.body.append(form);

  // Everything the script measures is zero-sized under jsdom, so isVisible()
  // would reject the whole page. Give the elements a real box.
  const box = { width: 400, height: 40, top: 0, left: 0, bottom: 40, right: 400, x: 0, y: 0, toJSON() {} };
  for (const el of [composer, sendBtn, fileInput, plusBtn]) {
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
    let textAtSend = '';
    // Read at the moment of the click: afterwards the composer is empty,
    // because that is what accepting a message looks like.
    h.sendBtn.addEventListener('click', () => { clicked++; textAtSend = h.composer.textContent || ''; });

    await h.execute({
      nodeId: 'n1',
      config: { prompt: 'continue this scene', mediaType: 'image', referenceImageData: [RED_PNG] },
    });
    await new Promise((r) => setTimeout(r, 300));

    // Uploading re-renders the composer on the real site; the prompt must
    // survive that, and send must come after the attachment, not before.
    expect(textAtSend).toBe('continue this scene');
    expect(h.fileInput.files).toHaveLength(1);
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

  /* Reported from a real run: the canvas showed the uploaded product photo as
     the "generated" scene, and handed it to the video node as its reference.
     The upload had worked perfectly — the capture picked the wrong image. */
  it('captures what ChatGPT drew, not the reference we uploaded', async () => {
    const h = buildHarness();

    /** A conversation image, sized past the result thresholds. */
    const addImage = (parent: HTMLElement, src: string) => {
      const img = document.createElement('img');
      img.src = src;
      Object.defineProperty(img, 'complete', { value: true });
      Object.defineProperty(img, 'naturalWidth', { value: 1024 });
      Object.defineProperty(img, 'naturalHeight', { value: 1024 });
      (img as any).getBoundingClientRect = () => ({
        width: 400, height: 400, top: 0, left: 0, bottom: 400, right: 400, x: 0, y: 0, toJSON() {},
      });
      parent.append(img);
      return img;
    };

    const turn = (role: string) => {
      const el = document.createElement('div');
      el.setAttribute('data-message-author-role', role);
      document.body.append(el);
      return el;
    };

    // The uploaded reference echoes back inside the user's own turn — larger
    // than the eventual result, and on screen several seconds sooner.
    h.fileInput.addEventListener('change', () => {
      setTimeout(() => {
        addImage(h.form, 'blob:composer-thumb');
        addImage(turn('user'), 'https://files.example/uploaded-product.png');
      }, 100);
    });

    /* Then ChatGPT answers with the image we actually want — after a delay
       long enough for the uploaded one to sit still for several polls, which
       is what a real 30-60s generation looks like. Answer too soon and the
       old code stumbles onto the right image by accident, and the test
       proves nothing. */
    setTimeout(() => addImage(turn('assistant'), 'https://files.example/generated-scene.png'), 14_000);

    (globalThis as any).fetch = (url: string) => Promise.resolve({
      ok: true,
      blob: () => Promise.resolve(new Blob([url], { type: 'image/png' })),
    });

    await h.execute({
      nodeId: 'n1',
      config: { prompt: 'person holding the product', mediaType: 'image', referenceImageData: [RED_PNG] },
    });
    await new Promise((r) => setTimeout(r, 24_000));

    const result = h.sent.find((m) => m.type === 'STUDIO_NODE_RESULT');
    expect(result).toBeDefined();
    // The blob body is the URL, so the data URL says which image was captured.
    const captured = Buffer.from(result.payload.imageUrl.split(',')[1], 'base64').toString();
    expect(captured).toBe('https://files.example/generated-scene.png');
    expect(captured).not.toContain('uploaded-product');
  }, 60_000);

  /* Reported from a real run: ChatGPT drew the reference sheet, it was on
     screen, and the node sat at "Generating…" until it gave up. Scoping
     results to assistant turns had turned "I cannot tell which image" into
     "I cannot see any image", which is the worse of the two. */
  it('captures a result that renders outside an assistant turn', async () => {
    const h = buildHarness();

    const img = document.createElement('img');
    img.src = 'https://files.example/reference-sheet.png';
    Object.defineProperty(img, 'complete', { value: true });
    Object.defineProperty(img, 'naturalWidth', { value: 1536 });
    Object.defineProperty(img, 'naturalHeight', { value: 1024 });
    (img as any).getBoundingClientRect = () => ({
      width: 600, height: 400, top: 0, left: 0, bottom: 400, right: 600, x: 0, y: 0, toJSON() {},
    });

    /* Assistant turns exist — this is a normal conversation — but the image
       is not inside one. That is the discriminating case: with no turns at
       all the old code already fell back to the whole document, so a test
       without them would pass either way and prove nothing. */
    const reply = document.createElement('div');
    reply.setAttribute('data-message-author-role', 'assistant');
    reply.textContent = 'Here is the reference sheet.';
    document.body.append(reply);

    // The image-generation card, mounted beside the turn rather than in it.
    const card = document.createElement('div');
    document.body.append(card);
    setTimeout(() => card.append(img), 2500);

    (globalThis as any).fetch = (url: string) => Promise.resolve({
      ok: true,
      blob: () => Promise.resolve(new Blob([url], { type: 'image/png' })),
    });

    await h.execute({
      nodeId: 'n1',
      config: { prompt: 'reference sheet of a BMW M3 E46', mediaType: 'image' },
    });
    await new Promise((r) => setTimeout(r, 12_000));

    const result = h.sent.find((m) => m.type === 'STUDIO_NODE_RESULT');
    expect(result).toBeDefined();
    const captured = Buffer.from(result.payload.imageUrl.split(',')[1], 'base64').toString();
    expect(captured).toBe('https://files.example/reference-sheet.png');
  }, 30_000);

  it('does not treat the whole page as the composer', async () => {
    /* composerRegion() used to fall back to document.body when it could not
       find the composer's form. Results are filtered by "not inside the
       composer", so that fallback excluded every image on the page and the
       poller could never succeed. */
    const h = buildHarness();
    // Strip the form, leaving the composer with no identifiable region.
    h.composer.remove();
    document.body.append(h.composer);

    const img = document.createElement('img');
    img.src = 'https://files.example/result.png';
    Object.defineProperty(img, 'complete', { value: true });
    Object.defineProperty(img, 'naturalWidth', { value: 1024 });
    Object.defineProperty(img, 'naturalHeight', { value: 1024 });
    (img as any).getBoundingClientRect = () => ({
      width: 500, height: 500, top: 0, left: 0, bottom: 500, right: 500, x: 0, y: 0, toJSON() {},
    });
    setTimeout(() => document.body.append(img), 2500);

    (globalThis as any).fetch = (url: string) => Promise.resolve({
      ok: true,
      blob: () => Promise.resolve(new Blob([url], { type: 'image/png' })),
    });

    await h.execute({ nodeId: 'n1', config: { prompt: 'draw something', mediaType: 'image' } });
    await new Promise((r) => setTimeout(r, 12_000));

    expect(h.sent.find((m) => m.type === 'STUDIO_NODE_RESULT')).toBeDefined();
  }, 30_000);

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

/* A page that has rendered but not finished hydrating shows a send button
   before React has attached a handler to it, so the click is swallowed and the
   prompt sits in the composer unsent. That is what a workflow started before
   the ChatGPT tab existed actually looked like: the tab opened, the prompt
   appeared, nothing was sent, and the node was blamed a minute and a half
   later for a reply that was never coming — taking every node downstream with
   it. */
describe('a send that does not go through', () => {
  it('says so instead of waiting out the reply timeout', async () => {
    const h = buildHarness();
    // A button that takes the click and does nothing — the hydrating page.
    h.sendBtn.replaceWith(h.sendBtn.cloneNode(true));

    await h.execute({ nodeId: 'n1', config: { prompt: 'write me a shot list', mediaType: 'text' } });

    expect(errorsFrom(h).join(' ')).toMatch(/send did not go through/i);
  }, 20_000);

  it('blames the send rather than the typing', async () => {
    /* The distinction the next report depends on: "could not type" sends
       someone to the composer selector, and the composer was fine. */
    const h = buildHarness();
    h.sendBtn.replaceWith(h.sendBtn.cloneNode(true));

    await h.execute({ nodeId: 'n1', config: { prompt: 'write me a shot list', mediaType: 'text' } });

    expect(errorsFrom(h).join(' ')).not.toMatch(/could not type/i);
  }, 20_000);
});

/* ============================================================
   The "Create image" tool.

   Asking in prose is a coin flip — ChatGPT answers with a description about
   as often as it draws. Selecting the tool makes it a generation request.

   Everything below is verbatim from a live composer. Two details are the
   whole reason this needed reading rather than guessing:

   - The menu entries are div.__menu-item with no role="menuitem" anywhere, so
     a standard menu query returns zero.
   - The chosen tool becomes a pill INSIDE the editor, so the composer's
     textContent reads "\uFEFFCreate image " before a character of prompt is
     typed. Both pill spans are contenteditable="false", which is what tells a
     widget from the text — and the fill check and the send check both depend
     on getting that right.
   ============================================================ */
describe('the Create image tool', () => {
  /** The + menu, as it renders once opened. */
  function mountMenu(host: HTMLElement): void {
    const menu = document.createElement('div');
    for (const label of [
      'Add photos & filesUpload from computer',
      'Add from libraryBrowse and search your files',
      'Create imageVisualize anything',
      'Web searchFind real-time news and info',
    ]) {
      const item = document.createElement('div');
      item.className = 'group __menu-item gap-1.5';
      item.textContent = label;
      (item as any).getBoundingClientRect = () =>
        ({ width: 260, height: 36, top: 0, left: 0, bottom: 36, right: 260, x: 0, y: 0, toJSON() {} });
      menu.append(item);
    }
    host.append(menu);
  }

  /** The pill the tool leaves in the editor. */
  function addPill(composer: HTMLElement): void {
    const cursor = document.createElement('span');
    cursor.setAttribute('contenteditable', 'false');
    cursor.setAttribute('data-inline-selection-pill-cursor-target', '');
    cursor.textContent = '\uFEFF';
    const pill = document.createElement('span');
    pill.setAttribute('contenteditable', 'false');
    pill.setAttribute('data-inline-selection-pill', '');
    pill.textContent = 'Create image';
    composer.prepend(cursor, pill);
  }

  it('finds the entry even though it is not a menuitem', () => {
    document.body.innerHTML = '';
    const host = document.createElement('div');
    document.body.append(host);
    mountMenu(host);

    expect(document.querySelectorAll('[role="menuitem"]')).toHaveLength(0);
    const found = Array.from(document.querySelectorAll<HTMLElement>('.__menu-item'))
      .find((el) => /^create image/i.test((el.textContent || '').trim()));
    expect(found).toBeDefined();
  });

  it('does not mistake "Add from library" for it', () => {
    // Anchored at the start, so an entry merely containing the words loses.
    document.body.innerHTML = '';
    const host = document.createElement('div');
    document.body.append(host);
    mountMenu(host);

    const found = Array.from(document.querySelectorAll<HTMLElement>('.__menu-item'))
      .find((el) => /^create image/i.test((el.textContent || '').trim()));
    expect(found!.textContent).toMatch(/^Create image/);
  });

  it('reads the pill as a widget, not as the prompt', () => {
    /* The trap. Counting the pill would make an empty composer look filled,
       and would make a sent composer never look empty — so the send would
       escalate through every rung and report failure after succeeding. */
    const h = buildHarness();
    addPill(h.composer);
    expect(h.composer.textContent).toContain('Create image');

    const clone = h.composer.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('[contenteditable="false"], [data-inline-selection-pill]')
      .forEach((n) => n.remove());
    expect((clone.textContent || '').replace(/\uFEFF/g, '').trim()).toBe('');
  });

  it('still reads the prompt when the pill is present', () => {
    const h = buildHarness();
    addPill(h.composer);
    h.composer.append(document.createTextNode('a red bicycle'));

    const clone = h.composer.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('[contenteditable="false"], [data-inline-selection-pill]')
      .forEach((n) => n.remove());
    expect((clone.textContent || '').replace(/\uFEFF/g, '').trim()).toBe('a red bicycle');
  });
});
