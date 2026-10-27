/**
 * "fix this problem" — a Director Chief stuck on "Reviewing continuity across
 * Directors…" with its verdict finished and visible in the Gemini tab.
 *
 *   20:29:14  Gemini  Submitted — waiting for the reply...
 *   20:29:30  Gemini  Waiting 16s — finished true, generating false,
 *                     reply 29 chars (not started — thinking)
 *   20:29:44  Gemini  Waiting 30s — finished true, generating false,
 *                     reply 29 chars (not started — thinking)
 *
 * Three readings that contradict each other, and the contradiction IS the bug.
 * `finished true` — Gemini has rendered its end-of-turn action bar. `reply 29
 * chars` — there is text. `not started` — the adapter says no answer has begun.
 *
 * 29 characters, on screen, was:
 *
 *     {"approved":true,"issues":[]}
 *
 * which is exactly what the Chief had answered on the ROUND BEFORE, in the
 * same thread. And the test for "has our answer arrived" was:
 *
 *     if (!current || current === priorReply) continue;
 *
 * Identical text read as "nothing new has been written". So answerStarted
 * never turned true, so the quiet budget stayed NO_ANSWER_YET_MS — five
 * minutes — and at the end of it the node failed with "Gemini did not finish
 * answering in time" while holding the answer it had been reading all along.
 *
 * Two identical verdicts running is not an edge case for a Chief. An approval
 * has one shape, and a second clean round produces it again byte for byte, so
 * the second review of every healthy plan hit this.
 *
 * ── The shape of the mistake ──
 *
 * Same shape as `rejected` in a prompt reading as a failed generation, and
 * `preparing` in a tile title reading as still-generating: a machine fact
 * inferred from model-written text. Here the fact is "a new turn exists" and
 * the text is the model's own words, which it is free to repeat.
 *
 * The fix asks the structural question instead — is a CONTAINER being read
 * that was not there when we asked — and counts the very elements
 * readLatestReply reads. Measured on a live hydrated Gemini thread before
 * writing it, three turns deep:
 *
 *     containersPerModelResponse      [3, 3, 3]
 *     containersInsideUserQuery       0
 *     containersOutsideModelResponse  0
 *
 * Three containers per answer, none of them belonging to a user turn — so the
 * count moves when an answer body renders and at no other time. Counting
 * `model-response` instead would NOT do: that element appears the moment
 * Gemini starts thinking, while the text still being read belongs to the turn
 * before it.
 */

/// <reference types="node" />

import { readFileSync } from 'fs';
import { join } from 'path';

const read = (...p: string[]) =>
  readFileSync(join(__dirname, '..', ...p), 'utf8').replace(/\r\n/g, '\n');

/**
 * The source with its comments removed.
 *
 * Needed because each fix QUOTES the line it replaced, so that the next
 * reader can see what the mistake looked like. A plain "this line is gone"
 * assertion reads those quotations as the line itself and fails on a file
 * that is correct — which it did, first run.
 */
const code = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

const GEMINI = read('content', 'gemini', 'index.ts');
const CHATGPT = read('content', 'chatgpt', 'index.ts');
const CLAUDE = read('content', 'claude', 'index.ts');
const GROK = read('content', 'grok', 'index.ts');

/** The adapters that now ask the structural question. */
const FIXED: Array<[string, string]> = [
  ['gemini', GEMINI],
  ['chatgpt', CHATGPT],
  ['claude', CLAUDE],
];

describe('an answer identical to the one before it is still a new answer', () => {
  it.each(FIXED)('%s no longer decides it by comparing the text', (_name, src) => {
    /* The exact line this fixes. `continue` on text equality alone is the
       bug; it must not come back in any adapter that has been fixed. */
    expect(code(src)).not.toMatch(/if \(!\w+ \|\| \w+ === priorReply\)/);
  });

  it.each(FIXED)('%s counts containers instead, against a baseline', (_name, src) => {
    expect(src).toMatch(/const priorRepl(y|ies)/);
    expect(src).toMatch(/replyContainers\(\)\.length > priorReplies/);
  });

  it.each(FIXED)('%s takes that baseline BEFORE the prompt is sent', (_name, src) => {
    /* A baseline taken after submitting would already include our own turn,
       so the count could never grow past it and the node would hang — the
       same failure from the other direction. */
    const baseline = src.search(/const repliesBefore = .*replyContainers\(\)\.length/);
    const fill = src.indexOf('fillComposer(composer, prompt)');
    expect(baseline).toBeGreaterThan(-1);
    expect(fill).toBeGreaterThan(-1);
    expect(baseline).toBeLessThan(fill);
  });

  it.each(FIXED)('%s keeps the text comparison as a fallback, not a gate', (_name, src) => {
    /* OR, never AND. A rename that leaves the count unable to grow must
       degrade to the old behaviour rather than to a node that never
       finishes — so the new test accepts everything the old one did, and one
       thing more. */
    expect(src).toMatch(/ourTurn \|\| \w+ !== priorReply|ourContainer \|\| \w+ !== priorReply/);
  });
});

describe('the count and the read are the same elements', () => {
  it('gemini reads whatever it counted', () => {
    /* The whole point. Counting one selector and reading another is how a
       container that appears while the model is still thinking gets paired
       with the PREVIOUS turn's text — a stale reply delivered as this one. */
    const at = GEMINI.indexOf('function replyContainers()');
    expect(at).toBeGreaterThan(-1);
    const body = GEMINI.slice(at, GEMINI.indexOf('\n}', at));
    expect(body).toMatch(/message-content, \.model-response-text, \.markdown-main-panel/);

    const readAt = GEMINI.indexOf('function readLatestReply()');
    const readBody = GEMINI.slice(readAt, GEMINI.indexOf('\n}', readAt));
    expect(readBody).toMatch(/replyContainers\(\)/);
    /* And it must not re-query: a second selector here is a second answer to
       "which element is the newest reply". */
    expect(readBody).not.toMatch(/querySelectorAll/);
  });

  it('gemini does not count model-response for this', () => {
    /* It appears while Gemini is thinking, before any text. turnsBefore still
       counts it — that is isGenerating's question, which is a different one —
       but the container baseline must not be built on it. */
    expect(GEMINI).toMatch(
      /const repliesBefore = wantsText \? replyContainers\(\)\.length : 0;/);
  });

  it.each([['chatgpt', CHATGPT], ['claude', CLAUDE]] as Array<[string, string]>)(
    '%s counts assistant turns only', (_name, src) => {
      /* Both files keep a looser fallback inside readLatestReply — `article`
         for ChatGPT, a prose sweep for Claude — and both of those match the
         user's own turn as readily as the model's. Counting them would move
         the baseline when our QUESTION rendered and hand back the previous
         reply. So replyContainers returns the attributed selector or nothing,
         and nothing means the text fallback decides. */
      const at = src.indexOf('function replyContainers()');
      expect(at).toBeGreaterThan(-1);
      const body = src.slice(at, src.indexOf('\n}', at));
      expect(body).not.toMatch(/\barticle\b|class\*="prose"/);
      expect(body).toMatch(/assistant/);
    });
});

describe('claude had the same line three times', () => {
  const tracker = (): string => {
    const at = CLAUDE.indexOf('async function trackReply(');
    expect(at).toBeGreaterThan(-1);
    return CLAUDE.slice(at, CLAUDE.indexOf('\n  send(', at));
  };

  it('decides once and uses that decision everywhere', () => {
    const body = tracker();
    expect(body).toMatch(/const isOurs = !!now && \(ourTurn \|\| now !== priorReply\);/);
    expect((body.match(/isOurs/g) || []).length).toBeGreaterThanOrEqual(3);
  });

  it('no longer re-tests the held reply against priorReply', () => {
    /* `stable` is assigned only under isOurs, so holding one means holding
       ours. Re-testing it was the same mistake a third time, and it would
       have rejected exactly the identical-verdict case this fixes — the
       quiet-window delivery path, which is the one a throttled background
       tab actually takes. */
    const body = tracker();
    expect(body).not.toMatch(/stable !== priorReply/);
    expect(body).toMatch(/if \(stable\) \{ deliver\(stable\); return; \}/);
  });
});

describe('grok is left alone, and says why', () => {
  it('still compares text', () => {
    expect(GROK).toMatch(/if \(!current \|\| current === priorReply\) continue;/);
  });

  it('records the reason rather than leaving it to be rediscovered', () => {
    /* replyBlocks matches `.message-bubble` and `[data-testid*="message"]` —
       turn markers for either speaker — and the file already records that
       Grok's turn markup was never read off a live conversation. An
       assistant-only selector here has to be measured, not guessed. Guessing
       is what this note exists to prevent. */
    const at = GROK.indexOf('Known gap, deliberately left');
    expect(at).toBeGreaterThan(-1);
    const note = GROK.slice(at, at + 1400);
    expect(note).toMatch(/message-bubble/);
    expect(note).toMatch(/measured, not guessed/);
  });
});

describe('the feed can show this happening', () => {
  it('gemini reports the container count beside the character count', () => {
    /* The old line gave "reply 29 chars (not started — thinking)" and left
       the contradiction to be inferred. With the counts beside it, a reply
       that is present while the baseline has not moved is readable at a
       glance instead of costing five minutes and a guess. */
    expect(GEMINI).toMatch(/replies \$\{replyContainers\(\)\.length\} \(was \$\{priorReplies\}\), /);
  });
});
