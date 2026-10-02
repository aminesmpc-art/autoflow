/**
 * @jest-environment jsdom
 */

/**
 * The finished image the node could not see.
 *
 * Reported with two screenshots: the picture fully rendered in the ChatGPT
 * tab, and the node beside it still reading "Generating image… 51%".
 *
 * Capture required BOTH the src to have held still AND `isGenerating()` to be
 * false, and isGenerating() reads a visible stop button. ChatGPT's image turns
 * can keep that button up after the picture has finished rendering. With it
 * up, the node waited out the whole six minutes and failed — with the image on
 * screen the entire time.
 *
 * The second half of the bug is worse than the first. The adapter has a
 * diagnostic for exactly this shape of failure — "no image found, here is what
 * is on the page" — and it too was behind !isGenerating(). So the one case
 * that most needed explaining was the only case guaranteed to say nothing.
 *
 * That progress bar never meant anything either: it is
 * `20 + elapsed/360000*90`, a clock, and it climbs identically whether the tab
 * is working or closed.
 */

/// <reference types="node" />

import { join } from 'path';

const BUNDLE = join(__dirname, '../../dist/chatgpt-content.js');
type Listener = (m: any, s: any, r: (x: any) => void) => void;

const BOX = {
  width: 512, height: 512, top: 0, left: 0, bottom: 512, right: 512, x: 0, y: 0, toJSON() {},
};

const tick = (ms = 60) => new Promise((r) => setTimeout(r, ms));

async function waitFor(check: () => boolean, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (check()) return true;
    await tick(40);
  }
  return check();
}

if (!Object.getOwnPropertyDescriptor(globalThis.HTMLElement?.prototype ?? {}, 'innerText')) {
  Object.defineProperty(globalThis.HTMLElement.prototype, 'innerText', {
    configurable: true,
    get(this: HTMLElement) { return this.textContent ?? ''; },
    set(this: HTMLElement, v: string) { this.textContent = v; },
  });
}

function harness() {
  document.body.innerHTML = '';
  const sent: any[] = [];
  const listeners: Listener[] = [];

  const composer = document.createElement('div');
  composer.id = 'prompt-textarea';
  composer.setAttribute('contenteditable', 'true');
  const sendBtn = document.createElement('button');
  sendBtn.setAttribute('data-testid', 'send-button');
  /* The adapter proves the send went through by watching the composer empty,
     which is what a real page does. */
  sendBtn.addEventListener('click', () => {
    setTimeout(() => { composer.textContent = ''; }, 0);
  });
  /* The Create image tool already on the composer. hasToolPill() sees this
     and skips the "+" menu, which is a real state and the one worth testing —
     the menu dance is covered elsewhere and is not what this file is about. */
  const pill = document.createElement('button');
  pill.className = '__composer-pill';
  pill.setAttribute('aria-label', 'Image, click to remove');
  const form = document.createElement('form');
  form.append(composer, sendBtn, pill);

  /* ChatGPT's stop button, up and staying up — the state under test. */
  const stop = document.createElement('button');
  stop.setAttribute('data-testid', 'stop-button');

  const thread = document.createElement('div');
  document.body.append(form, stop, thread);

  const box = (root: ParentNode) => {
    for (const el of Array.from(root.querySelectorAll('*'))) {
      (el as any).getBoundingClientRect = () => BOX;
    }
  };
  box(document);
  (stop as any).getBoundingClientRect = () => BOX;

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
  (globalThis as any).fetch = async () => ({
    ok: true,
    blob: async () => ({ size: 1234, type: 'image/png' }),
  });
  /* captureImage reads the blob through FileReader. */
  (globalThis as any).FileReader = class {
    onloadend: (() => void) | null = null;
    onerror: (() => void) | null = null;
    result = 'data:image/png;base64,AAAA';
    readAsDataURL() { setTimeout(() => this.onloadend && this.onloadend(), 0); }
  };

  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require(BUNDLE);
  });

  /** A finished picture inside an assistant turn. */
  const putImage = (src: string) => {
    const turn = document.createElement('article');
    const msg = document.createElement('div');
    msg.setAttribute('data-message-author-role', 'assistant');
    const img = document.createElement('img');
    img.src = src;
    Object.defineProperty(img, 'complete', { value: true });
    Object.defineProperty(img, 'naturalWidth', { value: 1024 });
    Object.defineProperty(img, 'naturalHeight', { value: 1024 });
    Object.defineProperty(img, 'currentSrc', { value: src, configurable: true });
    msg.append(img);
    turn.append(msg);
    thread.append(turn);
    box(turn);
    (img as any).getBoundingClientRect = () => BOX;
    (turn as any).getBoundingClientRect = () => BOX;
    return img;
  };

  const execute = (payload: any) => new Promise<any>((resolve) => {
    let done = false;
    for (const fn of listeners) {
      fn({ type: 'STUDIO_EXECUTE_NODE', payload }, {}, (r: any) => {
        if (!done) { done = true; resolve(r); }
      });
    }
  });

  const results = () => sent.filter((m) => m.type === 'STUDIO_NODE_RESULT');
  const logs = () => sent.filter((m) => m.type === 'STUDIO_LOG')
    .map((m) => String(m.payload?.line || ''));
  const clearStop = () => stop.remove();

  return { execute, results, logs, putImage, clearStop, sent };
}

const NODE = {
  nodeId: 'n1',
  config: { mediaType: 'image', platform: 'chatgpt', prompt: 'a tiny car on a bench' },
};

describe('a finished image while ChatGPT still shows its stop button', () => {
  jest.setTimeout(40_000);

  it('is captured anyway, instead of waiting out the six minutes', async () => {
    const h = harness();
    h.execute(NODE);
    await tick(600);
    h.putImage('https://files.example/img-a.png');

    /* The stop button is never cleared — the reported state. */
    const got = await waitFor(() => h.results().length > 0, 20_000);
    expect(got).toBe(true);
    expect(h.results()[0].payload.imageUrl).toMatch(/^data:image\/png/);
  });

  it('says out loud why it took the picture without being told to', async () => {
    const h = harness();
    h.execute(NODE);
    await tick(600);
    h.putImage('https://files.example/img-b.png');
    await waitFor(() => h.results().length > 0, 20_000);

    expect(h.logs().join('\n')).toMatch(/still\s+shows its stop button/i);
  });
});

describe('the ordinary case stays quick', () => {
  jest.setTimeout(30_000);

  it('captures soon after the image settles once ChatGPT is idle', async () => {
    const h = harness();
    h.execute(NODE);
    await tick(600);
    h.putImage('https://files.example/img-c.png');
    h.clearStop();

    const started = Date.now();
    const got = await waitFor(() => h.results().length > 0, 15_000);
    expect(got).toBe(true);
    /* Well inside the eight-second backstop — this is the settle path, not
       the one that gives up on the stop button. */
    expect(Date.now() - started).toBeLessThan(6000);
  });
});

describe('a preview that is still being drawn', () => {
  jest.setTimeout(30_000);

  it('is not captured while its src keeps changing', async () => {
    const h = harness();
    h.execute(NODE);
    await tick(600);

    /* Progressive previews swap srcs as they render. Each swap restarts the
       hold, so nothing should be taken while that is happening. */
    const img = h.putImage('https://files.example/preview-1.png');
    for (let i = 2; i <= 6; i++) {
      await tick(500);
      Object.defineProperty(img, 'currentSrc', {
        value: `https://files.example/preview-${i}.png`,
        configurable: true,
      });
    }
    expect(h.results()).toHaveLength(0);
  });
});
