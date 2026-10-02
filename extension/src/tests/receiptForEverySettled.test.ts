/**
 * Every prompt that settles should say which generation it was.
 *
 * ── The production row ───────────────────────────────────────────────────
 *
 *   keving2549@gmail.com   FREE   Sep 14, 2026
 *   Queues: 5 started (0L | 5F | 0U)      18 charged, ~3.6 prompts/run
 *   10 done · 6 pending · 2 failed        12 settled
 *   Submitted: 5 / 18 charged             5 receipts
 *
 * Twelve prompts finished and five produced a receipt. The other seven were
 * charged up front, ran correctly, and are counted as "charged, never
 * received" — which blames the Flow pipeline for a bookkeeping miss on ours.
 *
 * ── Why the two numbers can diverge at all ───────────────────────────────
 *
 * A receipt exists only where prompt.mediaId does. That is set in four
 * places, every one of them needing the MAIN-world interceptor to have bound
 * the generation right then.
 *
 * A prompt reaches `done` from TWENTY-THREE places, most of them DOM
 * verification that needs no id whatsoever.
 *
 * Different preconditions for the same event. Anything verified by the DOM
 * while the interceptor is cold settles with no id and is never reported.
 *
 * ── The two defects this pins ────────────────────────────────────────────
 *
 * 1. pickGenerationFor threw the binding away. `findBoundMediaIds` is the
 *    interceptor saying "this request carried this exact text" — the best
 *    answer available, and it needs no candidate list. It sat AFTER
 *    `if (candidates.length === 0) return null`, so an empty candidate list
 *    discarded a binding that was already in hand. Empty is ordinary:
 *    getNewSubmissions() only returns what entered the cache since
 *    onBeforeSubmit, and Flow refreshes that cache only while it is polling.
 *
 * 2. Nothing tried again at the end. updatePromptStatus is the one function
 *    every one of those 23 transitions goes through, so one lookup there
 *    covers all of them — and it is a cache read, not a request.
 */

/// <reference types="node" />

import { readFileSync } from 'fs';
import { join } from 'path';

const SRC = readFileSync(
  join(__dirname, '..', 'content', 'automation.ts'), 'utf8').replace(/\r\n/g, '\n');

/** The body of a named member, so a match cannot drift in from elsewhere. */
function bodyOf(decl: string, span = 2600): string {
  const at = SRC.indexOf(decl);
  expect(at).toBeGreaterThan(-1);
  return SRC.slice(at, at + span);
}

describe('the interceptor binding is not thrown away', () => {
  it('is consulted before the empty-candidates return', () => {
    const body = bodyOf('private pickGenerationFor');
    const bound = body.indexOf('findBoundMediaIds(prompt.text)');
    const bail = body.indexOf('if (candidates.length === 0) return null;');
    expect(bound).toBeGreaterThan(-1);
    expect(bail).toBeGreaterThan(-1);
    /* The whole defect in one assertion. */
    expect(bound).toBeLessThan(bail);
  });

  it('still answers when the binding names a generation the cache has not seen', () => {
    /* Previously this fell through to the text scan and then to
       candidates[0] — another prompt's generation — or to null. */
    const body = bodyOf('private pickGenerationFor');
    expect(body).toMatch(/return \{ mediaId: bound\[0\], promptText: prompt\.text \}/);
  });

  it('keeps preferring an exact candidate match over the bare id', () => {
    const body = bodyOf('private pickGenerationFor');
    const exact = body.indexOf('candidates.find((c) => bound.includes(c.mediaId))');
    const cached = body.indexOf('getCachedStatus(id)');
    const bare = body.indexOf('return { mediaId: bound[0]');
    expect(exact).toBeGreaterThan(-1);
    /* Fullest answer first, barest last. */
    expect(exact).toBeLessThan(cached);
    expect(cached).toBeLessThan(bare);
  });

  it('leaves the text fallback in place for an unbound prompt', () => {
    const body = bodyOf('private pickGenerationFor');
    expect(body).toMatch(/const needle = prompt\.text\.trim\(\)/);
  });
});

describe('a settling prompt gets one last chance to bind', () => {
  it('tries at the single point all 23 transitions pass through', () => {
    const body = bodyOf('private updatePromptStatus');
    expect(body).toMatch(/bindMediaIdIfMissing\(idx\)/);
  });

  it('tries BEFORE the message carrying the id is built', () => {
    const body = bodyOf('private updatePromptStatus');
    const bind = body.indexOf('bindMediaIdIfMissing(idx)');
    const send = body.indexOf('mediaId: this.queue?.prompts[idx]?.mediaId');
    expect(bind).toBeGreaterThan(-1);
    expect(send).toBeGreaterThan(-1);
    expect(bind).toBeLessThan(send);
  });

  it('only on a terminal status', () => {
    /* A running prompt has every later chance to bind one honestly; guessing
       early is how the wrong generation gets claimed. */
    const body = bodyOf('private updatePromptStatus');
    expect(body).toMatch(/if \(status === 'done' \|\| status === 'failed'\) this\.bindMediaIdIfMissing\(idx\)/);
  });

  it('never overwrites an id that was already captured', () => {
    const body = bodyOf('private bindMediaIdIfMissing');
    expect(body).toMatch(/if \(!prompt \|\| prompt\.mediaId\) return;/);
  });

  it('reads the cache rather than making a request', () => {
    /* Metering must never slow or fail a generation. */
    const body = bodyOf('private bindMediaIdIfMissing');
    expect(body).toMatch(/getNewSubmissions\(\)/);
    expect(body).not.toMatch(/await|fetch\(/);
  });

  it('cannot break the run that called it', () => {
    const body = bodyOf('private bindMediaIdIfMissing');
    expect(body).toMatch(/catch \{/);
  });

  it('says when it rescued one, so the effect is measurable', () => {
    const body = bodyOf('private bindMediaIdIfMissing');
    expect(body).toMatch(/would have gone unreported/);
  });
});
