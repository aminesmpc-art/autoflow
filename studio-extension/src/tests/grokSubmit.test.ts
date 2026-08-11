/**
 * @jest-environment jsdom
 */

/* ============================================================
   Grok's submit button, and the silence when it is not ready.

   Measured on grok.com/imagine: the button carries `disabled` whenever the
   composer is empty, and React clears it on its next render — 646ms after the
   paste landed, not on the DOM mutation. The adapter slept a flat 400ms and
   clicked whatever `findSendButton()` returned, which at that moment was a
   disabled button. A disabled button swallows a click without throwing,
   without logging, and without any page change; the tracker then waited out
   its full ten-minute budget for a generation nobody had requested. On the
   canvas that is a node sitting at 52% forever.

   Nothing about that is visible from the code, and no existing test could see
   it, because the defect was a race against a framework's render. These drive
   the real bundle against a button that behaves the way the live one does.
   ============================================================ */

/// <reference types="node" />

import { existsSync } from 'fs';
import { join } from 'path';

const BUNDLE = join(__dirname, '../../dist/grok-content.js');

type Listener = (msg: any, sender: any, respond: (r: any) => void) => boolean | void;

const box = (w: number, h: number) => () =>
  ({ width: w, height: h, top: 0, left: 0, bottom: h, right: w, x: 0, y: 0, toJSON() {} });

interface Harness {
  sent: any[];
  clicks: () => number;
  acceptedAt: () => number | null;
  execute: (config: Record<string, unknown>) => void;
  /** The one thing only a person can do: a click carrying user activation. */
  acceptByHand: () => void;
  /** Grok's video flow: navigate to a post, leaving the composer alone. */
  navigateLikeVideo: () => void;
}

/**
 * @param enableAfterMs how long React takes to clear `disabled`. The live
 *        page measured 646ms; 0 means the button is ready immediately.
 * @param deadButton the button enables but pressing it does nothing — what
 *        grok.com actually did on 2026-08-11, for a real click too.
 */
let harnessSeq = 0;

function buildPage(enableAfterMs: number, deadButton = false): Harness {
  document.body.innerHTML = '';
  document.title = 'Imagine - Grok';       // what a refused submit leaves behind
  const nodeId = `n${++harnessSeq}`;
  const state = { clicks: 0, acceptedAt: null as number | null, t0: Date.now() };

  const composer = document.createElement('div');
  composer.setAttribute('contenteditable', 'true');
  composer.className = 'tiptap ProseMirror';
  composer.append(document.createElement('p'));
  (composer as any).getBoundingClientRect = box(400, 40);

  const submit = document.createElement('button');
  submit.setAttribute('type', 'submit');
  submit.setAttribute('aria-label', 'Submit');
  submit.disabled = true;                       // empty composer
  (submit as any).getBoundingClientRect = box(36, 36);

  /* React's behaviour, reproduced: the attribute clears on a later tick, not
     when the text lands. */
  const observer = new MutationObserver(() => {
    if ((composer.textContent || '').trim().length > 0 && submit.disabled) {
      setTimeout(() => { submit.disabled = false; }, enableAfterMs);
    }
  });
  observer.observe(composer, { childList: true, subtree: true, characterData: true });

  submit.addEventListener('click', () => {
    // A disabled button never fires click in a real browser; jsdom is laxer,
    // so the guard here is what makes this fixture honest.
    if (submit.disabled) return;
    state.clicks++;
    /* A REJECTED image submit still empties the composer and still leaves the
       button disabled — measured on grok.com, the page simply drops onto
       Discover with no generation. That is why acceptance cannot be read from
       either of those, and why this fixture clears the box in both branches.
       Getting this wrong is what let the hang come back. */
    composer.textContent = '';
    if (deadButton) return;                     // cleared, but nothing generated
    state.acceptedAt = Date.now() - state.t0;
    document.title = (composer.dataset.lastPrompt || '') + ' - Grok';
  });

  const modeGroup = document.createElement('div');
  modeGroup.setAttribute('role', 'radiogroup');
  modeGroup.setAttribute('aria-label', 'Generation mode');
  (modeGroup as any).getBoundingClientRect = box(200, 30);
  for (const label of ['Image', 'Video', 'Agent']) {
    const b = document.createElement('button');
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-label', label);
    b.setAttribute('aria-checked', String(label === 'Image'));
    (b as any).getBoundingClientRect = box(60, 30);
    // The radios have to actually switch, or a video node fails on mode before
    // it ever reaches the submit this file is about.
    b.addEventListener('click', () => {
      modeGroup.querySelectorAll('[role="radio"]')
        .forEach((o) => o.setAttribute('aria-checked', 'false'));
      b.setAttribute('aria-checked', 'true');
    });
    modeGroup.append(b);
  }

  document.body.append(modeGroup, composer, submit);

  const sent: any[] = [];
  const listeners: Listener[] = [];
  (globalThis as any).chrome = {
    runtime: {
      onMessage: { addListener: (fn: Listener) => listeners.push(fn) },
      sendMessage: (msg: any) => {
        // Only this harness's node. See harnessSeq above.
        const id = msg?.payload?.nodeId;
        if (!id || id === nodeId) sent.push(msg);
        return Promise.resolve();
      },
    },
  };
  (document as any).execCommand = (cmd: string, _ui: boolean, value: string) => {
    if (cmd === 'insertText') { composer.textContent = value; composer.dataset.lastPrompt = value; }
    return true;
  };
  composer.addEventListener('paste', (e: any) => {
    const t = e.clipboardData?.getData('text/plain') || '';
    if (t) { composer.textContent = t; composer.dataset.lastPrompt = t; }
  });
  (globalThis as any).fetch = () => Promise.resolve({
    ok: true, blob: () => Promise.resolve(new Blob(['x'], { type: 'image/png' })),
  });

  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require(BUNDLE);
  });

  return {
    sent,
    clicks: () => state.clicks,
    acceptByHand: () => {
      state.acceptedAt = Date.now() - state.t0;
      composer.textContent = '';
      // A real click makes Grok show the prompt — the tab title flips at once.
      document.title = (composer.dataset.lastPrompt || '') + ' - Grok';
    },
    navigateLikeVideo: () => {
      window.history.pushState({}, '', '/imagine/post/0bcba547?conversation=2adba0bf');
    },
    acceptedAt: () => state.acceptedAt,
    execute: (config) => {
      for (const fn of listeners) {
        fn({ type: 'STUDIO_EXECUTE_NODE', payload: { nodeId, config } }, {}, () => {});
      }
    },
  };
}

const waitFor = async (check: () => boolean, ms: number) => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (check()) return true;
    await new Promise((r) => setTimeout(r, 60));
  }
  return false;
};

const errorOf = (h: Harness) => h.sent.find((m: any) => m.type === 'STUDIO_NODE_ERROR');

beforeAll(() => {
  if (!existsSync(BUNDLE)) throw new Error(`build first — ${BUNDLE} is missing`);
});

describe('submitting to Grok', () => {
  it('waits for React to enable the button instead of clicking it disabled', async () => {
    // 646ms is the number measured live. The old code slept 400 and pressed.
    const h = buildPage(646);
    h.execute({ mediaType: 'image', prompt: 'a red apple on a white plate' });

    expect(await waitFor(() => h.acceptedAt() !== null, 15_000)).toBe(true);
    expect(h.clicks()).toBeGreaterThan(0);
    expect(errorOf(h)).toBeUndefined();
  }, 30_000);

  it('still submits when the button is slow well past the old 400ms sleep', async () => {
    const h = buildPage(3000);
    h.execute({ mediaType: 'image', prompt: 'a red apple on a white plate' });

    expect(await waitFor(() => h.acceptedAt() !== null, 20_000)).toBe(true);
    expect(h.acceptedAt()).toBeGreaterThanOrEqual(3000);
    expect(errorOf(h)).toBeUndefined();
  }, 40_000);

  it('asks for a click instead of failing when Grok ignores the press', async () => {
    /* Measured on grok.com: generation is gated on transient user activation,
       so a synthetic press clears the composer and goes nowhere, while a real
       one produces images in about ten seconds. navigator.userActivation reads
       isActive:false at the moment of a scripted submit, and Enter behaves the
       same. Pressing twice would not help; the run hands over instead. */
    const h = buildPage(300, true);
    h.execute({ mediaType: 'image', prompt: 'a red apple on a white plate' });

    const ask = () => h.sent.find((m: any) => m.type === 'STUDIO_NEEDS_CLICK');
    expect(await waitFor(() => !!ask(), 25_000)).toBe(true);
    expect(ask().payload.message).toMatch(/press the ↑ arrow/i);
    // One press, then the handover — not a retry loop.
    expect(h.clicks()).toBe(1);
    // Still running: no error, and above all no invented success.
    expect(errorOf(h)).toBeUndefined();
    expect(h.sent.some((m: any) => m.type === 'STUDIO_NODE_RESULT')).toBe(false);
  }, 40_000);

  it('treats a video-style navigation as accepted, prompt still in the box', async () => {
    /* Grok's video flow succeeds WITHOUT clearing the composer: measured, a
       synthetic press in Video mode produced a real ten-second clip, moved to
       /imagine/post/<id>, and left the prompt sitting there. Keying acceptance
       on the composer alone would ask the user to press a button for a
       generation already running. */
    const h = buildPage(300, true);   // "dead" button: never clears the composer
    h.execute({ mediaType: 'video', prompt: 'a paper boat drifting across a still puddle' });

    await waitFor(() => h.clicks() > 0, 20_000);
    h.navigateLikeVideo();            // URL moves to a post, composer untouched

    // No handover, because nothing needs a human here.
    const quiet = await waitFor(() => h.sent.some((m: any) => m.type === 'STUDIO_NEEDS_CLICK'), 8_000);
    expect(quiet).toBe(false);
    expect(errorOf(h)).toBeUndefined();
  }, 45_000);

  it('carries on the moment the person presses it', async () => {
    const h = buildPage(300, true);
    h.execute({ mediaType: 'image', prompt: 'a red apple on a white plate' });
    expect(await waitFor(() => h.sent.some((m: any) => m.type === 'STUDIO_NEEDS_CLICK'), 25_000)).toBe(true);

    // The person presses it. Grok clears the composer, as it does on accept.
    h.acceptByHand();

    expect(await waitFor(() => h.acceptedAt() !== null, 15_000)).toBe(true);
    expect(errorOf(h)).toBeUndefined();
  }, 45_000);
});

describe('the shipped bundle carries the image controls', () => {
  const src = () => require('fs').readFileSync(BUNDLE, 'utf8');

  it('knows the Image Count trigger', () => {
    expect(src()).toContain('Image Count');
  });

  it('knows the speed radio group', () => {
    expect(src()).toContain('Image generation speed');
  });

  it('applies aspect ratio outside the video branch', () => {
    /* The selector was always there; the call site was inside
       `if (wantsVideo && !wantsExtend)`, so a still never reached it. */
    expect(src()).toContain('Aspect Ratio');
    expect(src()).toMatch(/imageCount/);
  });
});
