/**
 * Step 2: a result produced while the tab was hidden must still be collected.
 *
 * Both adapters lost finished work for the same underlying reason — they
 * assumed a poll loop ticks at the interval it asks for. A hidden tab's
 * timers are clamped by Chrome to roughly a minute, and both fell over that.
 *
 * ── Claude: reported a timeout while holding the answer ──────────────────
 *
 * The quiet test ran BEFORE the text read on that same iteration refreshed
 * `lastChangeAt`. Visible, polls are a second apart (POLL_MS = 1000) and it
 * never showed. Hidden, the first poll to see the finished reply measured a
 * ~60s gap against a 45s quiet window (TEXT_QUIET_MS), broke out of the loop,
 * and fell through to `send('STUDIO_NODE_ERROR', … 'did not finish
 * answering')` — discarding the complete reply it had read one line above.
 *
 * Two things were wrong and both are fixed: the ordering, and treating quiet
 * as failure while a usable answer is in hand.
 *
 * ── Gemini: collected nothing at all while hidden ────────────────────────
 *
 * `if (document.hidden) continue;` skipped the collection step, on the theory
 * that "a throttled tab reads nothing useful". A hidden tab's DOM is
 * perfectly readable; Chrome throttles timers and rendering, not
 * querySelector. So the guard did not avoid a bad read, it avoided every
 * read — a run hidden throughout span the full twelve minutes collecting
 * nothing and then timed out on a clip that had finished.
 */

/// <reference types="node" />

import { readFileSync } from 'fs';
import { join } from 'path';

const read = (...p: string[]) =>
  readFileSync(join(__dirname, '..', ...p), 'utf8').replace(/\r\n/g, '\n');

const CLAUDE = read('content', 'claude', 'index.ts');
const GEMINI = read('content', 'gemini', 'index.ts');

/** Block comments stripped, so prose cannot satisfy an assertion. */
const codeOnly = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, '');

const trackReply = (): string => {
  const c = codeOnly(CLAUDE);
  const at = c.indexOf('async function trackReply(');
  expect(at).toBeGreaterThan(-1);
  return c.slice(at, c.indexOf('\n}', at));
};

const trackVideo = (): string => {
  const g = codeOnly(GEMINI);
  const at = g.indexOf('async function trackVideo(');
  expect(at).toBeGreaterThan(-1);
  return g.slice(at, at + 4000);
};

describe('claude accounts for fresh text before judging quiet', () => {
  it('refreshes lastChangeAt above the quiet test, not below it', () => {
    const body = trackReply();
    const refresh = body.indexOf('lastChangeAt = Date.now()');
    const quiet = body.indexOf('Date.now() - lastChangeAt > TEXT_QUIET_MS');
    expect(refresh).toBeGreaterThan(-1);
    expect(quiet).toBeGreaterThan(-1);
    // The entire bug, in one comparison.
    expect(refresh).toBeLessThan(quiet);
  });

  it('delivers what it is holding when the quiet window expires', () => {
    const body = trackReply();
    const at = body.indexOf('Date.now() - lastChangeAt > TEXT_QUIET_MS');
    const block = body.slice(at, at + 260);
    expect(block).toMatch(/deliver\(stable\)/);
  });

  it('only delivers a reply that is actually new', () => {
    const at = trackReply().indexOf('Date.now() - lastChangeAt > TEXT_QUIET_MS');
    expect(trackReply().slice(at, at + 260)).toMatch(/stable !== priorReply/);
  });

  it('has one delivery path, so the two cannot drift apart', () => {
    const body = trackReply();
    expect(body).toMatch(/const deliver = \(reply: string\): void =>/);
    expect((body.match(/STUDIO_NODE_RESULT/g) || []).length).toBe(1);
  });

  it('still times out when it really has nothing', () => {
    expect(codeOnly(CLAUDE)).toMatch(/STUDIO_NODE_ERROR[\s\S]{0,200}did not finish answering/);
  });
});

/**
 * The ordering, as an executable statement rather than a claim about source.
 *
 * Both orderings are modelled against the same throttled sequence: one poll
 * a minute, the reply complete by the second. The old order loses it.
 */
describe('the ordering decides whether a throttled reply survives', () => {
  const QUIET = 45_000;
  const POLLS = [
    { at: 0, text: '' },
    { at: 60_000, text: 'the complete answer' },
    { at: 120_000, text: 'the complete answer' },
  ];

  /** quiet judged BEFORE the fresh read is accounted for */
  const oldOrder = (): string => {
    let stable = '', lastChangeAt = 0, count = 0;
    for (const p of POLLS) {
      if (p.at - lastChangeAt > QUIET) return 'TIMEOUT';   // judged first
      if (!p.text) continue;
      if (p.text === stable) count++;
      else { stable = p.text; count = 0; lastChangeAt = p.at; }
      if (count >= 2) return stable;
    }
    return 'TIMEOUT';
  };

  /** quiet judged AFTER, and quiet-with-an-answer delivers it */
  const newOrder = (): string => {
    let stable = '', lastChangeAt = 0, count = 0;
    for (const p of POLLS) {
      if (p.text) {
        if (p.text === stable) count++;
        else { stable = p.text; count = 0; lastChangeAt = p.at; }
      }
      if (p.at - lastChangeAt > QUIET) return stable || 'TIMEOUT';
      if (count >= 2) return stable;
    }
    return stable || 'TIMEOUT';
  };

  it('the old order threw away a finished reply', () => {
    expect(oldOrder()).toBe('TIMEOUT');
  });

  it('the new order returns it', () => {
    expect(newOrder()).toBe('the complete answer');
  });

  it('neither invents a reply when there genuinely is none', () => {
    const empty = [{ at: 0, text: '' }, { at: 60_000, text: '' }];
    let stable = '', lastChangeAt = 0;
    for (const p of empty) {
      if (p.text) { stable = p.text; lastChangeAt = p.at; }
      if (p.at - lastChangeAt > QUIET) break;
    }
    expect(stable || 'TIMEOUT').toBe('TIMEOUT');
  });
});

describe('gemini collects while hidden', () => {
  it('no longer skips the read on document.hidden', () => {
    expect(trackVideo()).not.toMatch(/if \(document\.hidden\) continue/);
  });

  it('wakes on the DOM as well as the clock', () => {
    expect(trackVideo()).toMatch(/await sleepOrDomChange\(/);
    expect(codeOnly(GEMINI)).toMatch(/new MutationObserver\(/);
  });

  /* An observer that fires on every mutation of a chatty page turns a poll
     loop into a busy loop. */
  it('will not spin on a chatty page', () => {
    const g = codeOnly(GEMINI);
    const at = g.indexOf('function sleepOrDomChange(');
    expect(at).toBeGreaterThan(-1);
    const body = g.slice(at, at + 1200);
    expect(body).toMatch(/minMs/);
    expect(body).toMatch(/Date\.now\(\) - startedAt >= minMs/);
  });

  it('disconnects the observer rather than leaking one per poll', () => {
    const g = codeOnly(GEMINI);
    const at = g.indexOf('function sleepOrDomChange(');
    const body = g.slice(at, at + 1200);
    expect(body).toMatch(/obs\?\.disconnect\(\)/);
    expect(body).toMatch(/clearTimeout\(timer\)/);
  });

  it('settles once, however both signals race', () => {
    const g = codeOnly(GEMINI);
    const at = g.indexOf('function sleepOrDomChange(');
    const body = g.slice(at, at + 1200);
    expect(body).toMatch(/if \(settled\) return;/);
  });

  it('falls back to the timer where observers are unavailable', () => {
    const g = codeOnly(GEMINI);
    const at = g.indexOf('function sleepOrDomChange(');
    expect(g.slice(at, at + 1200)).toMatch(/\} catch \{/);
  });

  /* Decoding IS degraded while hidden, unlike reading — and the poster
     capture already guards on it. Asserted so the guard is not "tidied". */
  it('still guards the poster capture on a decoded frame', () => {
    expect(trackVideo()).toMatch(/videoWidth > 0 && .*videoHeight > 0/);
  });
});
