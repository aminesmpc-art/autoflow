/**
 * @jest-environment jsdom
 */

/* ============================================================
   The view a finished video leaves behind.
   Grok navigates a completed video to /imagine/post/<id>?conversation=<id>.
   Measured on that page:

     document.querySelectorAll('[role="radiogroup"]')  ->  empty
     the composer                                      ->  present, accepts text

   No mode control, no resolution, no duration — but somewhere to type. The
   mode guard only fired when a group existed, so the one case that actually
   happens fell straight through: the next node typed into that composer and
   generated in whatever mode the previous run had left. An image node after a
   video node produced a video, spent the credits, and handed a clip to
   something expecting a still. Nothing errored.

   The sidebar's New Generation button (button[aria-label="New Generation"])
   returns to /imagine and the controls come back in about 800ms, measured, as
   a client-side navigation — so the content script survives it.
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
  /** Mode the page is on, or null while no mode control exists. */
  mode: () => string | null;
  hasModeGroup: () => boolean;
  submitted: () => string | null;
  execute: (config: Record<string, unknown>) => void;
}

/**
 * @param escapeHatch which way back the page offers, if any.
 * @param leftOn the mode the previous run left behind.
 */
function buildPostView(
  escapeHatch: 'new-generation' | 'back-link' | 'none',
  leftOn: 'Video' | 'Image' = 'Video',
): Harness {
  document.body.innerHTML = '';
  const state = { submitted: null as string | null };

  const composer = document.createElement('div');
  composer.setAttribute('contenteditable', 'true');
  composer.className = 'tiptap ProseMirror';
  composer.append(document.createElement('p'));
  (composer as any).getBoundingClientRect = box(400, 40);

  const submit = document.createElement('button');
  submit.setAttribute('type', 'submit');
  submit.setAttribute('aria-label', 'Submit');
  submit.disabled = true;
  (submit as any).getBoundingClientRect = box(36, 36);
  new MutationObserver(() => {
    if ((composer.textContent || '').trim() && submit.disabled) {
      setTimeout(() => { submit.disabled = false; }, 60);
    }
  }).observe(composer, { childList: true, subtree: true, characterData: true });
  submit.addEventListener('click', () => {
    if (submit.disabled) return;
    state.submitted = composer.textContent || '';
    composer.textContent = '';
  });

  /** The generator surface's controls — absent on a post view. */
  const mountModeGroup = (checked: string) => {
    if (document.querySelector('[role="radiogroup"][aria-label="Generation mode"]')) return;
    const group = document.createElement('div');
    group.setAttribute('role', 'radiogroup');
    group.setAttribute('aria-label', 'Generation mode');
    (group as any).getBoundingClientRect = box(200, 30);
    for (const label of ['Image', 'Video', 'Agent']) {
      const b = document.createElement('button');
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-label', label);
      b.setAttribute('aria-checked', String(label === checked));
      (b as any).getBoundingClientRect = box(60, 30);
      b.addEventListener('click', () => {
        group.querySelectorAll('[role="radio"]').forEach((o) => o.setAttribute('aria-checked', 'false'));
        b.setAttribute('aria-checked', 'true');
      });
      group.append(b);
    }
    document.body.prepend(group);
  };

  // The post view: composer, no controls.
  document.body.append(composer, submit);

  if (escapeHatch !== 'none') {
    const el = document.createElement(escapeHatch === 'back-link' ? 'a' : 'button');
    if (escapeHatch === 'back-link') {
      el.setAttribute('href', '/imagine');
      el.setAttribute('aria-label', 'Back');
    } else {
      el.setAttribute('aria-label', 'New Generation');
      el.textContent = 'New Generation';
    }
    (el as any).getBoundingClientRect = box(120, 30);
    // Client-side navigation back to the generator, controls and all.
    el.addEventListener('click', () => setTimeout(() => mountModeGroup(leftOn), 300));
    document.body.append(el);
  }

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
  (globalThis as any).fetch = () => Promise.resolve({
    ok: true, blob: () => Promise.resolve(new Blob(['x'], { type: 'image/png' })),
  });

  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require(BUNDLE);
  });

  return {
    sent,
    hasModeGroup: () => !!document.querySelector('[role="radiogroup"][aria-label="Generation mode"]'),
    mode: () => document.querySelector('[role="radiogroup"][aria-label="Generation mode"] [role="radio"][aria-checked="true"]')
      ?.getAttribute('aria-label') ?? null,
    submitted: () => state.submitted,
    execute: (config) => {
      for (const fn of listeners) {
        fn({ type: 'STUDIO_EXECUTE_NODE', payload: { nodeId: 'n1', config } }, {}, () => {});
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

describe('an image node landing on the view a video left behind', () => {
  it('goes back for the controls and generates an image, not a video', async () => {
    const h = buildPostView('new-generation', 'Video');
    expect(h.hasModeGroup()).toBe(false);

    h.execute({ mediaType: 'image', prompt: 'a chipped enamel mug on a windowsill' });

    expect(await waitFor(() => h.submitted() !== null, 25_000)).toBe(true);
    // The whole point: it did not generate in the mode the video left.
    expect(h.mode()).toBe('Image');
    expect(errorOf(h)).toBeUndefined();
  }, 45_000);

  it('accepts the Back anchor when the sidebar button is not there', async () => {
    const h = buildPostView('back-link', 'Video');
    h.execute({ mediaType: 'image', prompt: 'a chipped enamel mug on a windowsill' });

    expect(await waitFor(() => h.submitted() !== null, 25_000)).toBe(true);
    expect(h.mode()).toBe('Image');
  }, 45_000);

  it('refuses rather than generating in an unknown mode', async () => {
    /* No way back and no controls. Guessing costs a generation and returns
       the wrong kind of media to whatever is downstream; refusing costs a
       node and says why. */
    const h = buildPostView('none');
    h.execute({ mediaType: 'image', prompt: 'a chipped enamel mug on a windowsill' });

    expect(await waitFor(() => !!errorOf(h), 25_000)).toBe(true);
    expect(errorOf(h).payload.error).toMatch(/no mode controls/i);
    // And above all: nothing was sent.
    expect(h.submitted()).toBeNull();
  }, 45_000);

  it('leaves an Extend node where it stands', async () => {
    /* Extend continues a clip that lives on this very view. Sending it back to
       a blank generator would lose the thing it is meant to continue. */
    const h = buildPostView('new-generation', 'Video');
    h.execute({
      mediaType: 'video', extend: true, extendSeconds: '+10s',
      prompt: 'keep drifting', extendFromVideo: 'https://assets.grok.com/x/generated_video.mp4',
    });

    // It fails for its own reason (no clip in this fixture), never by being
    // navigated away from the post it was standing on.
    expect(await waitFor(() => !!errorOf(h), 25_000)).toBe(true);
    expect(errorOf(h).payload.error).not.toMatch(/no mode controls/i);
    expect(h.hasModeGroup()).toBe(false);
  }, 45_000);
});
