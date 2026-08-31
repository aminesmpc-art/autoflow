/**
 * @jest-environment jsdom
 */

/* ============================================================
   A Grok image node, end to end, through the shipped bundle.

   This answers the question live testing left open. On grok.com/imagine the
   Discover exclusion was proven to REJECT the wrong images — usable() went
   from 4 matches to 0 — but never proven to still FIND the right one. An
   exclusion that is too broad turns a node that returns a stranger's picture
   into a node that returns nothing, which is different but not better.

   The page below is /imagine as measured on a COMPLETED render, which is not
   what this file first assumed. Our own results sit in the very same
   component as the Discover feed —

     div#imagine-masonry-section-N > div.min-h-[100vh] > div
       > div.relative.group/media-post-masonry-card > div > img

   — so the original fixture, which put the genuine result outside the masonry
   markup, was testing a page that does not exist, and it passed a filter that
   rejected every real image on the live site.

   The one difference is a chip: the section holding our generation carries the
   prompt we submitted, and Discover sections carry none.

   The feed is the whole difficulty, and only because it lazy loads. A tile
   already on screen at submit lands in the baseline and is diffed away; a
   tile that ARRIVES during the wait is new, and before the fix it was
   captured and returned as the node's output. So both tests here add a tile
   mid-wait rather than only at the start.

   fetch echoes back the URL it was given, so the captured data URL decodes to
   whichever image was actually taken. That is what makes this decisive rather
   than "something was captured".
   ============================================================ */

/// <reference types="node" />

import { existsSync } from 'fs';
import { join } from 'path';
import { TextEncoder, TextDecoder } from 'util';

const BUNDLE = join(__dirname, '../../dist/grok-content.js');

type Listener = (msg: any, sender: any, respond: (r: any) => void) => boolean | void;

const RESULT_URL = 'https://grok.example/my-result.png';
const PROMPT = 'a red apple on a white plate';
const strangerUrl = (n: number) => `https://discover.example/stranger-${n}.png`;

const box = (w: number, h: number) => () =>
  ({ width: w, height: h, top: 0, left: 0, bottom: h, right: w, x: 0, y: 0, toJSON() {} });

/** An <img> that passes every size and completeness test usable() applies. */
function bigImage(src: string): HTMLImageElement {
  const img = document.createElement('img');
  img.alt = 'Generated image';
  for (const [prop, value] of [
    ['currentSrc', src], ['src', src], ['complete', true],
    ['naturalWidth', 512], ['naturalHeight', 512],
  ] as Array<[string, unknown]>) {
    Object.defineProperty(img, prop, { value, configurable: true });
  }
  (img as any).getBoundingClientRect = box(346, 352);
  return img;
}

interface Harness {
  sent: any[];
  submits: () => number;
  /** One more of someone else's posts, arriving as the feed scrolls. */
  lazyLoadDiscoverTile: (n: number) => void;
  /** The generation finishing, outside the feed. */
  addResult: (src?: string) => void;
  execute: (config: Record<string, unknown>, nodeId?: string) => void;
  checkedMode: () => string | undefined;
}

/** One masonry card, the shape both Discover and our results are built from. */
function card(src: string): HTMLElement {
  const outer = document.createElement('div');
  outer.className = 'relative group/media-post-masonry-card select-none cursor-pointer';
  const inner = document.createElement('div');
  inner.append(bigImage(src));
  outer.append(inner);
  return outer;
}

function buildPage(): Harness {
  document.body.innerHTML = '';
  const state = { submits: 0 };

  /* Discover: four of other people's posts, already rendered at submit, in a
     section carrying no prompt chip. */
  const masonry = document.createElement('div');
  masonry.id = 'imagine-masonry-section-3';
  const masonryInner = document.createElement('div');
  masonryInner.className = 'min-h-[100vh]';
  for (let i = 0; i < 4; i++) masonryInner.append(card(strangerUrl(i)));
  masonry.append(masonryInner);

  const composer = document.createElement('div');
  composer.setAttribute('contenteditable', 'true');
  composer.className = 'tiptap ProseMirror';
  composer.append(document.createElement('p'));
  (composer as any).getBoundingClientRect = box(400, 40);

  const submit = document.createElement('button');
  submit.setAttribute('type', 'submit');
  (submit as any).getBoundingClientRect = box(40, 40);
  submit.addEventListener('click', () => {
    state.submits++;
    // Grok clears the composer when it takes the prompt, and the adapter now
    // reads that as confirmation the press landed rather than assuming it.
    composer.textContent = '';
  });

  /* Mode starts on Video, so a run that never switches is visible. */
  const modeGroup = document.createElement('div');
  modeGroup.setAttribute('role', 'radiogroup');
  modeGroup.setAttribute('aria-label', 'Generation mode');
  (modeGroup as any).getBoundingClientRect = box(200, 30);
  for (const label of ['Image', 'Video', 'Agent']) {
    const b = document.createElement('button');
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-label', label);
    b.setAttribute('aria-checked', String(label === 'Video'));
    (b as any).getBoundingClientRect = box(60, 30);
    b.addEventListener('click', () => {
      modeGroup.querySelectorAll('[role="radio"]')
        .forEach((s) => s.setAttribute('aria-checked', 'false'));
      b.setAttribute('aria-checked', 'true');
    });
    modeGroup.append(b);
  }

  document.body.append(masonry, modeGroup, composer, submit);

  const sent: any[] = [];
  const listeners: Listener[] = [];
  (globalThis as any).chrome = {
    runtime: {
      onMessage: { addListener: (fn: Listener) => listeners.push(fn) },
      sendMessage: (msg: any) => { sent.push(msg); return Promise.resolve(); },
    },
  };
  (globalThis as any).TextEncoder ||= TextEncoder;
  (globalThis as any).TextDecoder ||= TextDecoder;
  (document as any).execCommand = (cmd: string, _ui: boolean, value: string) => {
    if (cmd === 'insertText') composer.textContent = value;
    return true;
  };
  // Echo the URL into the bytes, so a capture can be traced to its source.
  (globalThis as any).fetch = (url: string) => Promise.resolve({
    ok: true,
    blob: () => Promise.resolve(new Blob([url], { type: 'image/png' })),
  });

  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require(BUNDLE);
  });

  return {
    sent,
    submits: () => state.submits,
    lazyLoadDiscoverTile: (n: number) => { masonryInner.append(card(strangerUrl(n))); },
    /* Ours: a NEW section carrying the submitted prompt as a chip, holding the
       finished image — same markup as Discover, told apart only by the chip. */
    addResult: (src = RESULT_URL) => {
      const mine = document.createElement('div');
      mine.id = 'imagine-masonry-section-0';
      const chipWrap = document.createElement('div');
      chipWrap.className = 'bg-surface-l1 px-4 py-2';
      const chip = document.createElement('span');
      chip.textContent = PROMPT;
      chipWrap.append(chip);
      const inner = document.createElement('div');
      inner.className = 'min-h-[100vh]';
      inner.append(card(src));
      mine.append(chipWrap, inner);
      document.body.append(mine);
    },
    execute: (config, nodeId = 'n1') => {
      for (const fn of listeners) {
        fn({ type: 'STUDIO_EXECUTE_NODE', payload: { nodeId, config } }, {}, () => {});
      }
    },
    checkedMode: () => Array.from(document.querySelectorAll('[role="radio"]'))
      .find((r) => r.getAttribute('aria-checked') === 'true')
      ?.getAttribute('aria-label') || undefined,
  };
}

const decode = (dataUrl: string) =>
  Buffer.from(String(dataUrl).split(',')[1], 'base64').toString();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor(check: () => boolean, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (check()) return true;
    await sleep(100);
  }
  return false;
}

const resultOf = (h: Harness) => h.sent.find((m: any) => m.type === 'STUDIO_NODE_RESULT');
const errorOf = (h: Harness) => h.sent.find((m: any) => m.type === 'STUDIO_NODE_ERROR');

beforeAll(() => {
  if (!existsSync(BUNDLE)) throw new Error(`build first — ${BUNDLE} is missing`);
});

describe('a Grok image node with the Discover feed on the page', () => {
  it('captures the generated image, not a tile that lazy-loaded beside it', async () => {
    const h = buildPage();
    h.execute({ mediaType: 'image', prompt: PROMPT });

    expect(await waitFor(() => h.submits() > 0, 15_000)).toBe(true);
    // Mode is set before the prompt goes in; a still asked of Video mode is
    // a different thing arriving under the right name.
    expect(h.checkedMode()).toBe('Image');

    // The feed scrolls while Grok renders, then the real image lands.
    setTimeout(() => h.lazyLoadDiscoverTile(98), 500);
    setTimeout(() => h.addResult(), 2_500);

    expect(await waitFor(() => !!resultOf(h) || !!errorOf(h), 40_000)).toBe(true);
    expect(errorOf(h)).toBeUndefined();

    // The decisive assertion: which image came back.
    expect(decode(resultOf(h).payload.imageUrl)).toBe(RESULT_URL);
    expect(decode(resultOf(h).payload.imageUrl)).not.toMatch(/stranger/);
  }, 70_000);

  it('never reports a lazy-loaded Discover tile as the result', async () => {
    /* The live failure, reproduced: nothing of ours has finished, and two of
       someone else's posts scroll into view. Before the exclusion, the first
       of them was captured and sent as this node's output. */
    const h = buildPage();
    h.execute({ mediaType: 'image', prompt: PROMPT }, 'n2');

    expect(await waitFor(() => h.submits() > 0, 15_000)).toBe(true);
    h.lazyLoadDiscoverTile(98);
    setTimeout(() => h.lazyLoadDiscoverTile(99), 1_500);

    // Comfortably past the four stable polls a capture needs.
    await sleep(14_000);
    expect(resultOf(h)).toBeUndefined();
    expect(errorOf(h)).toBeUndefined();

    /* And the poller is still alive rather than merely dead — the same run
       returns the genuine image once it appears. Without this, "no result"
       proves nothing. */
    h.addResult();
    expect(await waitFor(() => !!resultOf(h), 40_000)).toBe(true);
    expect(decode(resultOf(h).payload.imageUrl)).toBe(RESULT_URL);
  }, 90_000);
});
