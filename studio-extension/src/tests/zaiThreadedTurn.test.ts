/**
 * @jest-environment jsdom
 */

/**
 * Z.AI, on the second round of a conversation.
 *
 * From a live run's Diagnostics, ninety seconds of it:
 *
 *   Waiting 45s — copy buttons 0 (started at 1), reply 0 chars
 *   Waiting 60s — copy buttons 1 (started at 1), reply 0 chars
 *   Waiting 90s — copy buttons 1 (started at 1), reply 0 chars
 *
 * with the complete reply on screen the whole time. Two compounding faults,
 * both from comparing a PAGE-WIDE count against a baseline taken before
 * submitting:
 *
 *  - submitting re-rendered the thread, so the previous turn's copy button
 *    went `invisible group-hover:visible` and the visible count fell to 0;
 *  - the new turn's button brought it back to 1, and one is never greater
 *    than one. The turn could never finish, and readLatestAssistantReply was
 *    gated on the same comparison, so it returned nothing at all.
 *
 * A new chat hid this completely: with a baseline of 0 the first button was
 * always an increase. It only surfaced once repairs began continuing the
 * conversation instead of starting a fresh one.
 *
 * Read off the live page: Z.AI wraps every turn in `div[id^="message-<uuid>"]`
 * — the same scope ChatGPT's <article> and Gemini's <model-response> give —
 * and renders a copy button on a finished assistant turn, never on a user
 * turn. So the question is about ONE turn, and the answer does not depend on
 * where the pointer happens to be.
 */

/// <reference types="node" />

const COPY = 'button.copy-response-button, button[class*="copy-response-button"], '
  + '[data-testid="copy-button"]';

/** The rule, as the adapter now runs it. */
function lastTurn(): HTMLElement | null {
  const turns = Array.from(document.querySelectorAll<HTMLElement>('div[id^="message-"]'))
    .filter((m) => (m.innerText || '').trim());
  return turns.length ? turns[turns.length - 1] : null;
}
function turnFinished(): boolean | null {
  const last = lastTurn();
  return last ? !!last.querySelector(COPY) : null;
}

/* jsdom has no innerText and the rule reads it to tell a real turn from the
   empty duplicate Z.AI renders for each id. Without this every turn looks
   empty and the tests pass for the wrong reason. */
if (!Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'innerText')) {
  Object.defineProperty(HTMLElement.prototype, 'innerText', {
    configurable: true,
    get(this: HTMLElement) { return this.textContent ?? ''; },
  });
}

/** A turn as Z.AI builds it. `hidden` mirrors the older-turn button. */
function turn(id: string, text: string, opts: { copy?: boolean; hidden?: boolean } = {}): void {
  const outer = document.createElement('div');
  outer.id = `message-${id}`;
  outer.textContent = text;
  if (opts.copy) {
    const b = document.createElement('button');
    b.className = opts.hidden
      ? 'copy-response-button invisible group-hover:visible'
      : 'copy-response-button visible';
    outer.append(b);
  }
  /* The empty twin. Z.AI renders each id twice — an outer and an inner — and
     the second carries no text. Taking the literal last element would read
     that one and find nothing. */
  const twin = document.createElement('div');
  twin.id = `message-${id}`;
  document.body.append(outer, twin);
}

afterEach(() => { document.body.innerHTML = ''; });

describe('the second round of a threaded conversation', () => {
  it('finishes when the newest turn has its copy button', () => {
    turn('aaa', 'the first reply', { copy: true, hidden: true });   // older, hover-hidden
    turn('bbb', 'the question');                                    // user
    turn('ccc', 'the second reply', { copy: true });                // newest
    expect(turnFinished()).toBe(true);
    expect((lastTurn()!.innerText || '')).toContain('the second reply');
  });

  it('counts a button that is only visible on hover', () => {
    /* The whole failure in one assertion. `invisible group-hover:visible` is
       in the DOM and does nothing until the pointer is over it, so a rule
       filtered by visibility gives a different answer depending on where the
       mouse is. */
    turn('aaa', 'the only reply', { copy: true, hidden: true });
    expect(turnFinished()).toBe(true);
  });

  it('is not finished while the user message is the newest turn', () => {
    turn('aaa', 'the first reply', { copy: true, hidden: true });
    turn('bbb', 'the second question');
    expect(turnFinished()).toBe(false);
  });

  it('is not finished while the reply is still streaming', () => {
    turn('aaa', 'the first reply', { copy: true, hidden: true });
    turn('bbb', 'the question');
    turn('ccc', 'half an ans');                                     // no button yet
    expect(turnFinished()).toBe(false);
  });

  it('says it cannot tell on an empty page', () => {
    expect(turnFinished()).toBeNull();
  });
});

describe('why the old rule could not work here', () => {
  const visible = (el: Element) => !/\binvisible\b/.test(el.className);
  const oldRule = (baseline: number) =>
    Array.from(document.querySelectorAll(COPY)).filter(visible).length > baseline;

  it('never exceeds a baseline of one, however finished it is', () => {
    /* Baseline 1: one assistant turn existed when the repair was submitted.
       Afterwards there are two buttons and only one is visible, because the
       older one is hover-hidden. 1 > 1 is false, forever. */
    turn('aaa', 'the first reply', { copy: true, hidden: true });
    turn('bbb', 'the question');
    turn('ccc', 'the second reply', { copy: true });
    expect(oldRule(1)).toBe(false);
    expect(turnFinished()).toBe(true);
  });

  it('worked in a fresh chat, which is why nobody saw it', () => {
    turn('aaa', 'the only reply', { copy: true });
    expect(oldRule(0)).toBe(true);
  });
});

describe('the adapter carries this rule', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const src = require('fs').readFileSync(
    require('path').join(__dirname, '..', 'content', 'zai', 'index.ts'), 'utf8');

  it('scopes to the newest turn', () => {
    expect(src).toMatch(/div\[id\^="message-"\]/);
    expect(src).toMatch(/function turnFinished\(\)/);
  });

  it('has no baseline left to compare against', () => {
    /* Leaving it threaded through implies it still decides something. */
    expect(src).not.toMatch(/baselineCopyCount/);
  });

  it('reads the reply from the turn, not from a count', () => {
    expect(src).toMatch(/const container = lastTurn\(\)/);
  });

  it('accepts as soon as the turn says finished', () => {
    expect(src).toMatch(/turnFinished\(\) === true \|\| \(!isBusy && stableCount >= 2\)/);
  });
});
