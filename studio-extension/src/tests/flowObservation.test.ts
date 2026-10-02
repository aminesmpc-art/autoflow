/**
 * Step 3: what may end the wait, and what may only delay it.
 *
 * "Is the API available?" was one boolean doing four jobs. isApiAvailable()
 * is `lastCacheUpdate > 0` — "this page received data at some point, ever".
 * Sticky, and silent about whether the data is recent or whether it describes
 * the generation being watched.
 *
 * That mattered because completion was decided partly on `apiState`, which
 * falls back to matching the PROMPT TEXT when a media id was never captured.
 * Re-running the same shot is ordinary, and it leaves an older entry carrying
 * identical text and, by then, state 'completed'. Matching on that announces
 * that a generation started seconds ago has already finished — clearing the
 * early-completion guard and letting a stale tile be accepted as the result.
 *
 * The asymmetry throughout: weak evidence may object, only strong evidence
 * may confirm. A wrong objection costs a slower node. A wrong confirmation
 * costs the user a generation they paid for and did not get.
 */

/// <reference types="node" />

import { readFileSync } from 'fs';
import { join } from 'path';

/* getApiState() keeps its state on `window`, and this suite runs on node. */
(globalThis as any).window = (globalThis as any).window || {};

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { observeGeneration } = require('../content/flow/apiHelper');

const read = (...p: string[]) =>
  readFileSync(join(__dirname, '..', ...p), 'utf8').replace(/\r\n/g, '\n');
const codeOnly = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, '');

const FLOW = codeOnly(read('content', 'flow', 'index.ts'));
const BYPASS = codeOnly(read('content', 'flow', 'sw-bypass.ts'));

type St = { mediaId: string; state: string; rawStatus?: string; promptText?: string };

function setState(opts: {
  ageMs?: number;
  statuses?: St[];
  interceptor?: boolean;
  replayOk?: boolean;
}) {
  const cache = new Map<string, St>();
  for (const s of opts.statuses || []) cache.set(s.mediaId, s);
  (globalThis as any).window.__af_api_state = {
    statusCache: cache,
    cachedCredits: null,
    interceptorInstalled: true,
    lastCacheUpdate: opts.ageMs === undefined ? 0 : Date.now() - opts.ageMs,
    queueStartTime: 0,
    preSubmitSnapshot: new Set<string>(),
    warnedAboutStaleFailure: false,
    expectMedia: 'video',
    warnedAboutInputMedia: false,
    lastInterceptorError: null,
    interceptorAliveAt: opts.interceptor === false ? 0 : Date.now(),
    lastReplayOk: opts.replayOk === true,
    messageListenerRegistered: true,
  };
}

describe('the four signals are separate', () => {
  it('an installed interceptor that has captured nothing is not a refresh', () => {
    setState({ interceptor: true, replayOk: false, ageMs: 1000 });
    const o = observeGeneration('m1');
    expect(o.interceptorPresent).toBe(true);
    expect(o.canRefresh).toBe(false);
  });

  it('data received long ago is present but not fresh', () => {
    setState({ ageMs: 60_000, statuses: [{ mediaId: 'm1', state: 'completed' }] });
    expect(observeGeneration('m1').fresh).toBe(false);
  });

  it('a fresh cache about other generations does not match this one', () => {
    setState({ ageMs: 1000, statuses: [{ mediaId: 'other', state: 'completed' }] });
    const o = observeGeneration('m1');
    expect(o.fresh).toBe(true);
    expect(o.matched).toBeNull();
  });
});

describe('only strong evidence may confirm completion', () => {
  it('confirms when this id is fresh and completed', () => {
    setState({ ageMs: 1000, statuses: [{ mediaId: 'm1', state: 'completed' }] });
    expect(observeGeneration('m1').confirmsCompleted).toBe(true);
  });

  it('refuses to confirm on a stale cache', () => {
    setState({ ageMs: 60_000, statuses: [{ mediaId: 'm1', state: 'completed' }] });
    expect(observeGeneration('m1').confirmsCompleted).toBe(false);
  });

  it('refuses to confirm with no media id to match on', () => {
    setState({ ageMs: 1000, statuses: [{ mediaId: 'm1', state: 'completed' }] });
    expect(observeGeneration(undefined).confirmsCompleted).toBe(false);
  });

  /** The re-run case, which is what this whole step exists for. */
  it('refuses to confirm from a previous run carrying the same prompt text', () => {
    setState({
      ageMs: 1000,
      statuses: [{ mediaId: 'older-run', state: 'completed', promptText: 'a cat' }],
    });
    const o = observeGeneration(undefined, 'a cat');
    expect(o.confirmsCompleted).toBe(false);
  });
});

describe('weak evidence may still object', () => {
  it('an id match that says generating contradicts completion', () => {
    setState({ ageMs: 1000, statuses: [{ mediaId: 'm1', state: 'generating' }] });
    expect(observeGeneration('m1').contradictsCompleted).toBe(true);
  });

  it('queued counts as still working', () => {
    setState({ ageMs: 1000, statuses: [{ mediaId: 'm1', state: 'queued' }] });
    expect(observeGeneration('m1').contradictsCompleted).toBe(true);
  });

  it('a completed status is not an objection', () => {
    setState({ ageMs: 1000, statuses: [{ mediaId: 'm1', state: 'completed' }] });
    expect(observeGeneration('m1').contradictsCompleted).toBe(false);
  });

  it('says nothing either way when it knows nothing', () => {
    setState({ ageMs: undefined });
    const o = observeGeneration('m1');
    expect(o.confirmsCompleted).toBe(false);
    expect(o.contradictsCompleted).toBe(false);
  });
});

describe('the watcher demands confirmation, not an absence of objection', () => {
  it('the early-completion guard tests confirmation', () => {
    expect(FLOW).toMatch(/wait < 10 && !apiConfirmsCompleted/);
  });

  /* The old test. Any 'completed' satisfied it, including one matched on
     prompt text alone — the previous run, saying it had finished. */
  it('no longer accepts any completed status as sufficient', () => {
    expect(FLOW).not.toMatch(/wait < 10 && apiState !== 'completed'/);
  });

  it('sets it only from observeGeneration', () => {
    expect(FLOW).toMatch(/apiConfirmsCompleted = observeGeneration\(/);
    // Never assigned true from anywhere looser.
    expect(FLOW).not.toMatch(/apiConfirmsCompleted = true/);
  });
});

describe('recovering observation must never generate again', () => {
  /**
   * The replay sends the captured request verbatim, with credentials. If the
   * captured request were the SUBMIT, recovery would create a second video
   * and charge for it — silently, from a path whose whole purpose is to look
   * rather than to act.
   *
   * The submit is the only request that introduces a media id nobody has
   * seen; a status poll re-describes known ones. On batchexecute the rpc name
   * is an opaque code and this fork has no pending-prompt check, so that
   * difference is the only reliable discriminator available.
   */
  it('never keeps a request that introduced a generation', () => {
    expect(BYPASS).toMatch(/found > 0 && !lastBatchIntroducedNewId/);
  });

  it('decides that from the ids in the response', () => {
    expect(BYPASS).toMatch(/lastBatchIntroducedNewId = statuses\.some\(/);
    expect(BYPASS).toMatch(/!seenMediaIds\.has\(/);
  });

  it('remembers the ids it has seen, or every response looks new', () => {
    expect(BYPASS).toMatch(/const seenMediaIds = new Set<string>\(\)/);
    expect(BYPASS).toMatch(/seenMediaIds\.add\(/);
  });

  /* Fail closed: before anything has been observed, assume the next response
     could be a submit rather than assuming it is safe to keep. */
  it('starts by assuming the next response is not safe to keep', () => {
    expect(BYPASS).toMatch(/let lastBatchIntroducedNewId = true/);
  });

  it('replays only a captured request, never a constructed one', () => {
    const at = BYPASS.indexOf('__af_activeCheck');
    const body = BYPASS.slice(at, at + 900);
    expect(body).toMatch(/const req = lastStatusRequest/);
    expect(body).toMatch(/if \(!req\) return false/);
  });
});
