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

  /* Decoding IS degraded while hidden, unlike reading — and the poster
     capture already guards on it. Asserted so the guard is not "tidied". */
  it('still guards the poster capture on a decoded frame', () => {
    expect(trackVideo()).toMatch(/videoWidth > 0 && .*videoHeight > 0/);
  });
});

/**
 * Every adapter waits the same way, so it waits well in one place.
 *
 * Nothing here is broken by a hidden tab on its own — they all read the DOM
 * fine. What suffers is everything counted in POLLS rather than seconds,
 * because Chrome clamps a hidden tab's timers to about a minute:
 *
 *   Grok wants three unchanged polls   three minutes, not six seconds
 *   Z.AI, ChatGPT and Gemini want two  two minutes, not four
 *
 * MutationObserver is not throttled by visibility, so the DOM becomes the
 * faster signal and the timer becomes the backstop. Gemini had this first;
 * it now lives in content/shared so the other three have it too rather than
 * three more copies of it.
 */
describe('every adapter wakes on the DOM, not only the clock', () => {
  const WAIT = codeOnly(read('content', 'shared', 'hiddenWait.ts'));

  const ADAPTERS: Array<[string, string]> = [
    ['gemini', codeOnly(GEMINI)],
    ['chatgpt', codeOnly(read('content', 'chatgpt', 'index.ts'))],
    ['grok', codeOnly(read('content', 'grok', 'index.ts'))],
    ['zai', codeOnly(read('content', 'zai', 'index.ts'))],
  ];

  for (const [name, src] of ADAPTERS) {
    it(`${name} uses the shared wait`, () => {
      expect(src).toMatch(/import \{ sleepOrDomChange \} from '\.\.\/shared\/hiddenWait'/);
      expect(src).toMatch(/await sleepOrDomChange\(/);
    });

    it(`${name} has no timer-only poll left in its result loop`, () => {
      expect(src).not.toMatch(/await sleep\(POLL_MS\)/);
    });
  }

  /**
   * Flow is the exception, and it needed a different answer.
   *
   * The chat adapters are woken by their own page changing. Flow's page
   * only polls while it is doing something, so a hidden Flow tab mutates
   * NOTHING — there is no DOM event to wait for. Its engine reads a status
   * cache that goes stale and stays stale, and the call that refreshes it
   * was initiated from a loop whose timer Chrome had clamped: the component
   * that must stay awake was asking permission from the one put to sleep.
   *
   * So the worker drives it on its own alarm, which is not throttled that
   * way. The DOM wake below is still worth having for the tiles that do
   * change, but it is not what makes Flow work hidden.
   */
  it('flow is refreshed by the worker, which is never throttled', () => {
    const WORKER = codeOnly(read('background', 'service-worker.ts'));
    expect(WORKER).toMatch(/async function refreshFlowStatus\(/);
    const at = WORKER.indexOf('async function tabPingRoutine(');
    expect(WORKER.slice(at, at + 1800)).toMatch(/refreshFlowStatus\(keptTabId\)/);
  });

  it('only flow, since only flow stops producing its own data', () => {
    const WORKER = codeOnly(read('background', 'service-worker.ts'));
    const at = WORKER.indexOf('refreshFlowStatus(keptTabId)');
    expect(WORKER.slice(Math.max(0, at - 200), at)).toMatch(/keptPlatform === 'flow'/);
  });

  /* Replaying a status request must never generate. The submit-exclusion
     guard is what makes it safe to call this on a timer at all. */
  it('the refresh it drives cannot submit', () => {
    const BYPASS = codeOnly(read('content', 'flow', 'sw-bypass.ts'));
    expect(BYPASS).toMatch(/found > 0 && !lastBatchIntroducedNewId/);
  });

  it('flow engine watch loops wake on the DOM too', () => {
    const ENGINE = codeOnly(read('content', 'flow', 'automation.ts'));
    expect(ENGINE).toMatch(/await sleepOrDomChange\(POLL_INTERVAL_MS\)/);
    expect(ENGINE).not.toMatch(/await sleep\(POLL_INTERVAL_MS\)/);
  });

  /* Only the watch loops. The engine's other ~100 sleeps are deliberate
     interaction timing — waiting for an animation, for a menu, for React to
     settle — and waking those early on any mutation would break them. */
  it('leaves interaction timing in the engine alone', () => {
    const ENGINE = codeOnly(read('content', 'flow', 'automation.ts'));
    expect((ENGINE.match(/await sleep\(/g) || []).length).toBeGreaterThan(50);
  });

  it('there is exactly one implementation', () => {
    for (const [name, src] of ADAPTERS) {
      expect({ [name]: /new MutationObserver\(/.test(src) }).toEqual({ [name]: false });
    }
    expect(WAIT).toMatch(/new MutationObserver\(/);
  });

  /**
   * Only while hidden — which is the whole reason it exists.
   *
   * Left on while visible it is pure cost: a page being interacted with
   * mutates constantly, so the observer fires immediately and a 2000ms poll
   * becomes a 250ms one. Eight times the work on the very tab the user is
   * looking at. It broke three adapter suites that reasonably assume a loop
   * ticks at its stated interval, which is how it was found.
   */
  it('is a plain sleep while the tab is visible', () => {
    expect(WAIT).toMatch(/document\.hidden === true/);
    const at = WAIT.indexOf('if (!hidden)');
    expect(at).toBeGreaterThan(-1);
    expect(WAIT.slice(at, at + 120)).toMatch(/setTimeout\(resolve, ms\)/);
    // The early return must come BEFORE the observer is ever constructed.
    expect(at).toBeLessThan(WAIT.indexOf('new MutationObserver('));
  });

  /* An observer that fires on every mutation of a chatty page turns a poll
     loop into a busy loop. */
  it('will not spin on a chatty page', () => {
    expect(WAIT).toMatch(/minMs/);
    expect(WAIT).toMatch(/Date\.now\(\) - startedAt >= minMs/);
  });

  it('disconnects rather than leaking an observer per poll', () => {
    expect(WAIT).toMatch(/obs\?\.disconnect\(\)/);
    expect(WAIT).toMatch(/clearTimeout\(timer\)/);
  });

  it('settles once, however the two signals race', () => {
    expect(WAIT).toMatch(/if \(settled\) return;/);
  });

  it('falls back to the timer where observers are unavailable', () => {
    expect(WAIT).toMatch(/\} catch \{/);
  });
});
