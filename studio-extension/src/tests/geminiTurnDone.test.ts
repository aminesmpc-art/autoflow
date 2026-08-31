/**
 * @jest-environment jsdom
 */

/**
 * Waiting for Gemini to actually finish.
 *
 * Same failure as ChatGPT, and worse here: Gemini has no persistent stop
 * button, so the adapter's only evidence that a reply was over was that the
 * text had not changed for two polls. A pause mid-answer is indistinguishable
 * from a finished one, and a half-written prompt then went to a generator
 * that rendered it and reported success.
 *
 * Gemini renders its footer — Good response, Bad response, Redo, Copy — only
 * once a turn is complete, so the copy control is a positive statement that
 * the answer is over.
 *
 * Two traps this file exists for. Every earlier model-response has a copy
 * button too, so a page-wide query says "finished" the moment there is any
 * history. And the aria-label is translated, so matching only "Copy" would
 * hang forever on a French or German account — the icon is matched first
 * because fonticon="copy" is semantic and does not translate.
 */

/// <reference types="node" />

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const BUNDLE = join(__dirname, '../../dist/gemini-content.js');
type Listener = (m: any, s: any, r: (x: any) => void) => void;

const BOX = { width: 400, height: 40, top: 0, left: 0, bottom: 40, right: 400, x: 0, y: 0, toJSON() {} };
const box = (el: Element) => { (el as any).getBoundingClientRect = () => BOX; };

const tick = (ms = 60) => new Promise((r) => setTimeout(r, ms));

async function waitFor(check: () => boolean, ms = 6000): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (check()) return true;
    await tick(25);
  }
  return false;
}

/* jsdom does not implement innerText, and the adapter reads replies with it.
   Without this every read is undefined, no answer is ever seen, and the
   negative tests below pass for entirely the wrong reason. */
if (!Object.getOwnPropertyDescriptor(globalThis.HTMLElement?.prototype ?? {}, 'innerText')) {
  Object.defineProperty(globalThis.HTMLElement.prototype, 'innerText', {
    configurable: true,
    get(this: HTMLElement) { return this.textContent ?? ''; },
    set(this: HTMLElement, v: string) { this.textContent = v; },
  });
}

/** `history` completed exchanges, each model turn carrying its own footer. */
function harness(history: number) {
  document.body.innerHTML = '';
  const sent: any[] = [];
  const listeners: Listener[] = [];

  const rich = document.createElement('rich-textarea');
  const composer = document.createElement('div');
  composer.className = 'ql-editor';
  composer.setAttribute('contenteditable', 'true');
  rich.append(composer);

  const thread = document.createElement('div');
  for (let i = 0; i < history; i++) {
    const q = document.createElement('user-query');
    q.textContent = `question ${i}`;
    const r = document.createElement('model-response');
    const body = document.createElement('message-content');
    body.textContent = `old answer ${i}`;
    r.append(body, copyControl());
    thread.append(q, r);
  }
  document.body.append(thread, rich);
  [composer, rich].forEach(box);
  Array.from(document.querySelectorAll('*')).forEach(box);

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

  /* The footer Gemini adds when a turn completes.
     Nested the way the real page nests it, read off a live conversation:

       div.response-container-footer > message-actions > div.actions-container-v2
         > div.buttons-container-v2 > copy-button > gem-icon-button
         > button[aria-label="Copy"] > mat-icon[fonticon="copy"]

     It used to be a bare button. That passed, and it tested a shape Gemini
     does not produce — so it could not have caught the code-block bug below,
     which is entirely about WHERE in the turn the copy icon sits. */
  function copyControl(label = 'Copy'): HTMLElement {
    const footer = document.createElement('div');
    footer.className = 'response-container-footer';
    const actions = document.createElement('message-actions');
    const wrap = document.createElement('copy-button');
    const btn = document.createElement('button');
    btn.setAttribute('aria-label', label);
    const icon = document.createElement('mat-icon');
    icon.setAttribute('fonticon', 'copy');
    icon.setAttribute('data-mat-icon-name', 'copy');
    btn.append(icon);
    wrap.append(btn);
    actions.append(wrap);
    footer.append(actions);
    [footer, actions, wrap, btn, icon].forEach(box);
    return footer;
  }

  /* A fenced block inside a reply, with the controls Gemini gives it the
     moment the block opens — before a word of it has been written. The copy
     one carries fonticon="copy", which is the whole problem. */
  function codeBlock(): HTMLElement {
    const cb = document.createElement('code-block');
    cb.className = 'enable-luminous-code-block';
    for (const [label, glyph] of [['Download code', 'arrow_circle_down'], ['Copy code', 'copy']]) {
      const b = document.createElement('button');
      b.setAttribute('aria-label', label);
      const i = document.createElement('mat-icon');
      i.setAttribute('fonticon', glyph);
      i.setAttribute('data-mat-icon-name', glyph);
      b.append(i);
      cb.append(b);
      box(b); box(i);
    }
    const pre = document.createElement('pre');
    cb.append(pre);
    box(cb); box(pre);
    return cb;
  }

  const startReply = (text: string) => {
    const r = document.createElement('model-response');
    r.id = 'live';
    const body = document.createElement('message-content');
    body.textContent = text;
    r.append(body);
    thread.append(r);
    Array.from(r.querySelectorAll('*')).forEach(box);
    box(r);
  };

  const growReply = (text: string) => {
    const b = document.querySelector('#live message-content');
    if (b) (b as HTMLElement).textContent = text;
  };

  const finishReply = (label = 'Copy') => {
    document.getElementById('live')?.append(copyControl(label));
  };

  /** Gemini opening a fenced block partway through writing the answer. */
  const openCodeBlock = () => {
    document.getElementById('live')?.append(codeBlock());
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
  return { execute, sent, results, startReply, growReply, finishReply, openCodeBlock, composer };
}

const ASK = {
  nodeId: 'g1',
  config: { mediaType: 'text', prompt: 'Write one line about a sneaker.', rawReply: true },
};

const HALF = 'A charcoal sneaker on a plain grey';
const FULL = 'A charcoal sneaker on a plain grey backdrop, lit softly from the left, '
  + 'photographed straight on with the whole shoe in frame and nothing cropped.';

beforeAll(() => {
  if (!existsSync(BUNDLE)) throw new Error(`build first: ${BUNDLE} is missing`);
});

// Two stable polls are required, so a completion takes several seconds of
// wall clock. The negative tests must wait longer than that or they prove
// nothing — which is exactly how the first ChatGPT version of this passed.
jest.setTimeout(60000);

describe('a reply that pauses mid-sentence', () => {
  it('is not captured while the footer is missing', async () => {
    const h = harness(0);
    h.execute(ASK);
    await waitFor(() => h.composer.textContent === '', 4000);

    h.startReply(HALF);
    await tick(12000);

    expect(h.results()).toHaveLength(0);
  });

  it('is captured in full once the footer appears', async () => {
    const h = harness(0);
    h.execute(ASK);
    await waitFor(() => h.composer.textContent === '', 4000);

    h.startReply(HALF);
    await tick(900);
    h.growReply(FULL);
    h.finishReply();

    expect(await waitFor(() => h.results().length > 0, 25000)).toBe(true);
    expect(String(h.results()[0].payload?.text || '')).toContain('nothing cropped');
  });
});

describe('a conversation that already has history', () => {
  it('does not read an earlier turn’s copy button as this turn finishing', async () => {
    const h = harness(4);
    h.execute(ASK);
    await waitFor(() => h.composer.textContent === '', 4000);

    h.startReply(HALF);
    await tick(12000);

    expect(h.results()).toHaveLength(0);
  });
});

describe('an account that is not in English', () => {
  it('finishes on the icon when the label is translated', async () => {
    /* "Copier" never matches an aria-label test, so a French user would wait
       until the ceiling timeout on every single node. The icon is what makes
       this work, and it is why the icon is checked first. */
    const h = harness(0);
    h.execute(ASK);
    await waitFor(() => h.composer.textContent === '', 4000);

    h.startReply(FULL);
    h.finishReply('Copier');

    expect(await waitFor(() => h.results().length > 0, 25000)).toBe(true);
    expect(String(h.results()[0].payload?.text || '')).toContain('nothing cropped');
  });
});

/**
 * The footer should make it FAST as well as correct.
 *
 * turnFinished() was added so a pause between chunks could not be mistaken for
 * an ending. It did that — and then the adapter carried on waiting for
 * stableCount >= 2 anyway, two more 2000ms polls after the site had already
 * rendered the action bar that says the turn is over. Four seconds per node
 * spent learning nothing, on every ChatGPT and Gemini node in every run.
 *
 * There is no state where that bar exists and the text is still growing, so
 * the wait bought no safety either. These tests hold the two paths apart: the
 * marker is immediate, its absence still takes the slow careful road.
 */
describe('how long it waits once the turn is over', () => {
  it('captures on the poll after the footer appears, not two later', async () => {
    const h = harness(1);
    await h.execute(ASK);
    h.startReply('a');

    /* Streaming, not settled. This is the whole point of the test and the
       first version got it wrong: if the text has already been still for two
       polls when the footer arrives, the OLD rule fires just as fast and the
       measurement proves nothing. Mutation caught that. So the reply grows
       right up to the moment it completes, which is what a real one does —
       stableCount is 0 when the footer appears, and the old rule would need
       two further polls of quiet on top. */
    const grow = setInterval(() => h.growReply(`a${'b'.repeat(Date.now() % 97)}`), 400);
    await tick(3000);
    clearInterval(grow);

    const said = Date.now();
    h.growReply('the finished answer about a sneaker');
    h.finishReply();
    /* Scoped to THIS reply, not "any result". Each test re-requires the
       bundle, but the previous test's polling loop is still ticking against
       the same globals — it reads the fresh DOM, finds the history turn, and
       posts its own capture into this harness. Taking results[0] measured a
       stale loop and read back "old answer 0". */
    const mine = () => h.results().find((r: any) => /sneaker/.test(r.payload?.text || ''));
    expect(await waitFor(() => !!mine(), 12_000)).toBe(true);
    const waited = Date.now() - said;
    /* One poll, not three. The old rule needed stableCount to reach 2 from
       zero — two further 2000ms polls — so 4000ms is the line between them. */
    /* Measured, both ways: 1032ms with the marker deciding, 5056ms with the
       old rule, in this same harness. 4000ms sits between them, so reinstating
       the two-poll wait turns this red.

       It is a wall-clock assertion inside a suite jest runs in parallel with
       sixty others, so it is the one test here that can flake under load
       rather than under change. The gap is 4s wide and the margin about 3s,
       which is why the threshold is not tightened towards the measurement. */
    expect(waited).toBeLessThan(4000);
    expect(mine()!.payload.text).toContain('sneaker');
  }, 30_000);

  it('still waits out two stable polls when there is no footer to read', async () => {
    const h = harness(1);
    await h.execute(ASK);
    h.startReply('an answer that keeps growing');
    /* No finishReply: turnFinished() cannot see a footer on the live turn, so
       the fallback runs. Two polls of unchanged text is not yet enough — the
       third is. Asserting the wait is real, because deleting the fallback
       would make the fast path look like it covered everything. */
    await tick(2600);
    expect(h.results()).toHaveLength(0);
  }, 20_000);

  it('does not accept while the site says it is still writing', async () => {
    const h = harness(1);
    await h.execute(ASK);
    h.startReply('half an answ');
    await tick(5200);                       // long enough for the old rule to fire
    expect(h.results()).toHaveLength(0);
  }, 20_000);
});

describe('a code block is not the end of the answer', () => {
  /* Reported as: the reply gets cut off after about a second whenever the
     answer contains a fenced block, and what arrives is the first line or two.

     Gemini gives a code block its own controls the instant the block opens —
     Download code, Copy code — and the copy one carries fonticon="copy", the
     exact attribute the adapter was using to decide a turn was over. So an
     answer whose second line was "```" was declared finished before its third
     line existed.

     The reason this shipped: the harness above built the footer as a bare
     button, so "in the footer" and "anywhere in the turn" were the same place
     and no test could tell them apart. It builds the real nesting now. */

  it('does not finish on the copy button a code block brings with it', async () => {
    const h = harness(0);
    const run = h.execute(ASK);

    h.startReply('### 5-SCENE STORYBOARD');
    await tick(200);
    h.openCodeBlock();          // one second in, the block opens
    await tick(1500);
    h.growReply('### 5-SCENE STORYBOARD\nScene 1 — the empty room, bare boards.');
    await tick(1500);

    /* Still writing. Nothing may have been accepted yet — the old code would
       have returned "### 5-SCENE STORYBOARD" and called it the answer. */
    expect(h.results().length).toBe(0);

    h.growReply('### 5-SCENE STORYBOARD\nScene 1 — the empty room, bare boards.\n'
      + 'Scene 5 — the finished lounge, lit.');
    h.finishReply();
    await waitFor(() => h.results().length > 0, 8000);

    expect(String(h.results()[0].payload?.text || '')).toContain('Scene 5');
  }, 20_000);

  /* Two more timing tests lived here and were deleted. Both passed against
     the broken adapter, which makes them worse than nothing: they described
     the bug accurately and proved nothing about it. Only the case above
     actually distinguishes the two versions, so it is the only one kept.

     What is left is the invariant itself, read off the shipped bundle. Not a
     substitute for the behavioural test — a guard on the two things that made
     the bug possible, so neither can come back quietly. */
  it('keeps the copy search inside the footer, and out of code blocks', () => {
    const src = readFileSync(join(__dirname, '..', 'content', 'gemini', 'index.ts'), 'utf8');
    const fn = src.slice(src.indexOf('function turnFinished()'));
    const body = fn.slice(0, fn.indexOf('\n}\n'));

    // Scoped to the footer rather than the whole turn...
    expect(body).toMatch(/message-actions, \.response-container-footer/);
    // ...and code blocks excluded even if that scope is ever not found.
    expect(body.match(/closest\('code-block'\)/g) || []).toHaveLength(2);
    // The icon still comes first: aria-label is translated, fonticon is not.
    expect(body.indexOf('fonticon="copy"')).toBeLessThan(body.indexOf('aria-label'));
  });
});
