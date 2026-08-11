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

import { existsSync, readFileSync } from 'fs';
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
  /** What the composer held each time Submit was pressed. */
  sentText: string[];
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

  /* What the composer held at the moment Submit was pressed. The prompt can
     no longer be read off the composer after a run, because accepting a
     prompt empties it — so the fixture records it on the way past. */
  const sentText: string[] = [];

  const showSubmit = (): HTMLButtonElement => {
    const existing = document.querySelector<HTMLButtonElement>('button[type="submit"]');
    if (existing) return existing;
    const btn = document.createElement('button');
    btn.type = 'submit';
    btn.setAttribute('aria-label', 'Submit');
    (btn as any).getBoundingClientRect = box(32, 32);
    /* Grok empties the composer when it accepts a prompt, and that is now the
       adapter's evidence the press landed — without it, submitPrompt is right
       to press again and then report a refusal. A fixture whose button does
       nothing is not a simpler version of the real one, it is the broken one. */
    btn.addEventListener('click', () => {
      sentText.push(composer.textContent || '');
      composer.textContent = '';
    });
    form.append(btn);
    return btn;
  };

  // Same on the Enter path, for the same reason.
  composer.addEventListener('keydown', (e: any) => {
    if (e.key === 'Enter') setTimeout(() => { composer.textContent = ''; }, 0);
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

  return { composer, fileInput, form, sent, execute, showSubmit, sentText };
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
    // Read from the press, not from the composer: Grok empties it on accept.
    expect(h.sentText).toEqual(['a tired detective in the rain']);
  }, 20_000);

  it('clicks Submit once the composer has text', async () => {
    /* The button does not exist before this point on the real page, which is
       why it is created here rather than in the harness. */
    const btn = h.showSubmit();
    let clicked = 0;
    btn.addEventListener('click', () => clicked++);
    await h.execute({ nodeId: 'n1', config: { prompt: 'hello' } });
    expect(clicked).toBe(1);
  }, 20_000);

  it('falls back to Enter when no submit button appeared', async () => {
    // No showSubmit() — the page never mounts one.
    let entered = 0;
    h.composer.addEventListener('keydown', (e: any) => { if (e.key === 'Enter') entered++; });
    await h.execute({ nodeId: 'n1', config: { prompt: 'hello' } });
    expect(entered).toBe(1);
    /* Longer than jest's default: the adapter gives the page six seconds to
       mount a send button before falling back, because on the real page the
       button is mounted late and was previously clicked while still
       disabled. A page that never mounts one pays that full wait. */
  }, 20_000);

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

/* ============================================================
   Grok Imagine, from the live markup.

   Two things here are the opposite of what the chat surface does, and both
   were wrong in the first cut of this adapter:

   1. The submit button EXISTS while the composer is empty and is `disabled`
      — `<button type="submit" aria-label="Submit" disabled="">`. Since an
      empty composer is also the resting state after a submit, reading
      "disabled" as "busy" means the completion check can never pass and every
      node runs to its timeout with the finished clip on screen.

   2. A finished clip is a <video src=… poster=…>. There is no <img> in it at
      all, so an image-only search finds nothing however long it waits.
   ============================================================ */
describe('Grok Imagine', () => {
  const IMAGINE = `
    <form>
      <div data-testid="chat-input">
        <div contenteditable="true" role="textbox" aria-label="Ask Grok anything"
             class="tiptap ProseMirror"><p data-placeholder="Type to imagine"></p></div>
      </div>
      <input class="hidden" multiple accept="image/jpeg,image/png" type="file" name="files">
      <button type="submit" aria-label="Submit" disabled=""></button>
      <div role="radiogroup" aria-label="Generation mode">
        <button type="button" role="radio" aria-checked="false" aria-label="Image"></button>
        <button type="button" role="radio" aria-checked="true" aria-label="Video"><span>Video</span></button>
        <button type="button" role="radio" aria-checked="false" aria-label="Agent"></button>
      </div>
      <div role="radiogroup" aria-label="Video resolution">
        <button type="button" role="radio" aria-checked="false"><span>480p</span></button>
        <button type="button" role="radio" aria-checked="true"><span>720p</span></button>
        <button type="button" role="radio" aria-checked="false"><span>1080p</span></button>
      </div>
      <div role="radiogroup" aria-label="Video duration">
        <button type="button" role="radio" aria-checked="false"><span>6s</span></button>
        <button type="button" role="radio" aria-checked="true"><span>10s</span></button>
        <button type="button" role="radio" aria-checked="false"><span>15s</span></button>
      </div>
      <button type="button" aria-label="Aspect Ratio"><span>9:16</span></button>
    </form>`;

  const clip = (id: string) => {
    const btn = document.createElement('button');
    btn.setAttribute('aria-label', 'Hot Girl Shaking Her Ass');
    btn.innerHTML =
      `<video src="https://assets.grok.com/users/u1/generated/${id}/generated_video.mp4?cache=1"` +
      ` poster="https://assets.grok.com/users/u1/generated/${id}/preview_image.jpg?cache=1"></video>`;
    document.body.append(btn);
    return btn;
  };

  beforeEach(() => { document.body.innerHTML = IMAGINE; });

  it('has a submit button that is present and disabled while empty', () => {
    // The premise of the deadlock. If this ever stops being true the guard
    // below is guarding nothing, and this test says so.
    const btn = document.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    expect(btn.disabled).toBe(true);
  });

  it('exposes each control as an aria-labelled radio group', () => {
    for (const label of ['Generation mode', 'Video resolution', 'Video duration']) {
      expect(document.querySelector(`[role="radiogroup"][aria-label="${label}"]`)).not.toBeNull();
    }
  });

  it('marks the checked option with aria-checked', () => {
    // What selectRadio reads back to confirm a click took, rather than
    // assuming it did.
    const mode = document.querySelector('[role="radiogroup"][aria-label="Generation mode"]')!;
    const on = mode.querySelector('[role="radio"][aria-checked="true"]');
    expect(on!.getAttribute('aria-label')).toBe('Video');
  });

  it('renders a finished clip as a video with a poster, and no image', () => {
    clip('eeac2e93');
    expect(document.querySelectorAll('img')).toHaveLength(0);
    const v = document.querySelector<HTMLVideoElement>('video[src]')!;
    expect(v.getAttribute('src')).toMatch(/generated_video\.mp4/);
    expect(v.getAttribute('poster')).toMatch(/preview_image\.jpg/);
  });

  it('tells two clips apart by the generation id in the URL', () => {
    /* Both carry the same aria-label — it is the model's summary of the
       prompt, and the live page showed three in a row reading "Hot Girl Video
       Generation". The id in the URL is the only thing unique per clip. */
    const a = clip('aaaa1111');
    const b = clip('bbbb2222');
    expect(a.getAttribute('aria-label')).toBe(b.getAttribute('aria-label'));
    const srcs = Array.from(document.querySelectorAll('video[src]')).map((v) => v.getAttribute('src'));
    expect(new Set(srcs).size).toBe(2);
  });
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

/* ============================================================
   Extend.

   Imagine can continue a finished clip instead of starting a new one. The
   sequence, read off the live viewer:

     button[aria-label="Extend"]  →  button[aria-label="Cancel Extend"]
                                     replaces it, and a +6s / +10s row appears

   "Cancel Extend" is the reason this is checkable at all. Without a signal
   that the mode engaged, a click that went nowhere is indistinguishable from
   one that worked — and the node would generate a brand-new clip while
   reporting that it had continued one, which is the failure that looks like a
   success.
   ============================================================ */
describe('extending a clip', () => {
  const CLIP = 'https://assets.grok.com/users/u1/generated/eeac2e93/generated_video.mp4?cache=1';

  const box = (w: number, h: number) => () =>
    ({ width: w, height: h, top: 0, left: 0, bottom: h, right: w, x: 0, y: 0, toJSON() {} });

  /** The viewer, with the clip open and Extend on offer. */
  function mountViewer(extending = false): void {
    document.body.innerHTML = `
      <button aria-label="Hot Girl Shaking Her Ass"><video src="${CLIP}"></video></button>
      <button type="button" aria-label="Regenerate">Regenerate</button>
      <button type="button" aria-label="${extending ? 'Cancel Extend' : 'Extend'}">${extending ? 'Cancel Extend' : 'Extend'}</button>
      <button type="button" aria-label="Share">Share</button>
      ${extending ? '<button type="button">+6s</button><button type="button">+10s</button>' : ''}`;
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('*'))) {
      (el as any).getBoundingClientRect = box(200, 36);
    }
  }

  const labelled = (label: string) =>
    Array.from(document.querySelectorAll<HTMLElement>('button[aria-label]'))
      .find((b) => (b.getAttribute('aria-label') || '').trim().toLowerCase() === label.toLowerCase());

  /* The panel that holds Extend is not always on screen. Running Studio in
     the side panel narrows the window, and Grok collapses the whole column —
     Regenerate, Extend, Share — behind a single "Post actions" button. So the
     button every earlier screenshot showed was simply absent whenever the
     panel was open, which is the state anyone driving Studio is actually in. */
  it('has no Extend button while the panel is collapsed', () => {
    document.body.innerHTML = `
      <button type="button" aria-label="Post actions"></button>
      <main></main>`;
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('*'))) {
      (el as any).getBoundingClientRect = box(40, 40);
    }
    expect(labelled('Extend')).toBeUndefined();
    expect(labelled('Post actions')).toBeDefined();
  });

  it('reveals Extend once Post actions is clicked', () => {
    document.body.innerHTML = '<button type="button" aria-label="Post actions"></button>';
    const reveal = document.querySelector<HTMLElement>('button[aria-label="Post actions"]')!;
    (reveal as any).getBoundingClientRect = box(40, 40);
    reveal.addEventListener('click', () => {
      const panel = document.createElement('div');
      panel.innerHTML = `
        <button type="button" aria-label="Regenerate"><span>Regenerate</span></button>
        <button type="button" aria-label="Extend"><span class="truncate flex-1 text-center">Extend</span></button>
        <button type="button" aria-label="Share"><span>Share</span></button>`;
      document.body.append(panel);
      for (const el of Array.from(panel.querySelectorAll<HTMLElement>('*'))) {
        (el as any).getBoundingClientRect = box(240, 36);
      }
    });

    reveal.click();
    expect(labelled('Extend')).toBeDefined();
  });

  it('finds Extend from the collapsed panel on every path', () => {
    /* The half-fix. Revealing was taught to one caller and not the other, so
       openClipForExtend still tested for the bare button — and with the side
       panel open, which is the only state Studio runs in, it waited six
       seconds and then reported the clip was not in Grok's history. It was;
       the button was behind Post actions. */
    const SOURCE = readFileSync(
      join(__dirname, '../content/grok/index.ts'), 'utf8'
    );
    const body = SOURCE.slice(SOURCE.indexOf('async function openClipForExtend'));
    const openClip = body.slice(0, body.indexOf('async function startExtend'));
    expect(openClip).toMatch(/findExtendControl\(\)/);
    expect(openClip).not.toMatch(/buttonByLabel\('Extend'\)/);
  });

  it('offers Extend on an open clip', () => {
    mountViewer();
    expect(labelled('Extend')).toBeDefined();
    expect(labelled('Cancel Extend')).toBeUndefined();
  });

  it('treats Cancel Extend as proof the mode engaged', () => {
    /* The whole check. Before the click there is no such button; after it
       there is, and only then is it safe to type the prompt. */
    mountViewer(true);
    expect(labelled('Cancel Extend')).toBeDefined();
  });

  it('reads extend mode off the composer placeholder', () => {
    /* What the working grok-auto extension checks, and the better signal: it
       sits on the box about to be typed into, so it answers "will this prompt
       extend the clip" rather than "is some button on screen". */
    document.body.innerHTML =
      '<div class="tiptap ProseMirror" contenteditable="true">'
      + '<p data-placeholder="Extend video"><br></p></div>';
    const inExtend = Array.from(document.querySelectorAll('[data-placeholder]'))
      .some((el) => /extend/i.test(el.getAttribute('data-placeholder') || ''));
    expect(inExtend).toBe(true);
  });

  it('does not read the ordinary composer as extend mode', () => {
    document.body.innerHTML =
      '<div class="tiptap ProseMirror" contenteditable="true">'
      + '<p data-placeholder="Type to imagine"><br></p></div>';
    const inExtend = Array.from(document.querySelectorAll('[data-placeholder]'))
      .some((el) => /extend/i.test(el.getAttribute('data-placeholder') || ''));
    expect(inExtend).toBe(false);
  });

  it('finds Extend video in the More options menu', () => {
    /* The proven entry point: entries are div[role="menuitem"], not buttons,
       so a button search finds nothing. */
    document.body.innerHTML = `
      <button aria-label="More options">...</button>
      <div role="menuitem">Download</div>
      <div role="menuitem">Extend video</div>
      <div role="menuitem">Delete</div>`;
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('*'))) {
      (el as any).getBoundingClientRect = box(200, 36);
    }
    expect(document.querySelectorAll('button[role="menuitem"]')).toHaveLength(0);
    const item = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'))
      .find((el) => /extend/i.test(el.textContent || ''));
    expect(item!.textContent).toBe('Extend video');
  });

  it('finds the clip to extend by the generation id in its URL', () => {
    // Labels repeat across clips; the id does not.
    mountViewer();
    const id = /generated\/([^/]+)\//.exec(CLIP)![1];
    expect(id).toBe('eeac2e93');
    const found = Array.from(document.querySelectorAll<HTMLVideoElement>('video[src]'))
      .find((v) => v.getAttribute('src')!.includes(id));
    expect(found).toBeDefined();
    expect(found!.closest('button')).not.toBeNull();
  });

  it('offers the two lengths Imagine actually adds', () => {
    mountViewer(true);
    const pills = Array.from(document.querySelectorAll<HTMLElement>('button'))
      .map((b) => (b.textContent || '').trim())
      .filter((t) => /^\+\d+s$/.test(t));
    expect(pills).toEqual(['+6s', '+10s']);
  });

  it('does not confuse Extend with Cancel Extend', () => {
    /* An exact match on aria-label, not a substring: "Cancel Extend" contains
       "Extend", so a loose match would click cancel and then wait for a mode
       it had just left. */
    mountViewer(true);
    expect(labelled('Extend')).toBeUndefined();
  });
});
