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

import { existsSync } from 'fs';
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

  /** The footer Gemini adds when a turn completes. */
  function copyControl(label = 'Copy'): HTMLElement {
    const btn = document.createElement('button');
    btn.setAttribute('aria-label', label);
    const icon = document.createElement('mat-icon');
    icon.setAttribute('fonticon', 'copy');
    icon.setAttribute('data-mat-icon-name', 'copy');
    btn.append(icon);
    box(btn);
    box(icon);
    return btn;
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

  const execute = (payload: any) => new Promise<any>((resolve) => {
    let done = false;
    for (const fn of listeners) {
      fn({ type: 'STUDIO_EXECUTE_NODE', payload }, {}, (r: any) => {
        if (!done) { done = true; resolve(r); }
      });
    }
  });

  const results = () => sent.filter((m) => m?.type === 'STUDIO_NODE_RESULT');
  return { execute, sent, results, startReply, growReply, finishReply, composer };
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
