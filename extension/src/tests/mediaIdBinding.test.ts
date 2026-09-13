/**
 * @jest-environment jsdom
 *
 * Tying a generation to the prompt that asked for it.
 *
 * The engine used to take "the first status record that appeared after I
 * clicked Generate" and call that the prompt's media id. Nothing in that
 * compares the record to the prompt.
 *
 * That would be tolerable on a quiet channel. This one carries the entire
 * application's traffic — a single project load makes 19 batchexecute calls
 * and describes 58 generations — so a library scroll, a background project
 * refresh, or the previous prompt's record arriving a second late all land
 * inside the window and can be picked first. The wrong id then flows into the
 * completion check, the URL verification and the download list, each
 * reporting some other generation's state as this prompt's, confidently.
 *
 * ── Where it is settled ───────────────────────────────────────────────────
 *
 * In the MAIN world, which is the only place holding a request and its own
 * response together. The engine posts the prompt it is about to submit; the
 * interceptor checks whether the body Flow actually sent carries that text,
 * and if it does, the generations described in the reply to that same body
 * are that prompt's. Nothing about the payload shape is assumed — no rpcid,
 * no field offsets — so it survives a Flow redeploy.
 *
 * ── Two independent holes, both closed ────────────────────────────────────
 *
 * The second one is subtler than the ordering bug. getNewSubmissions walked
 * statusCache directly and returned anything not in the pre-submit snapshot —
 * but "new to the cache" is not "new". Flow re-describes old work whenever
 * the project is refreshed, so a video generated weeks ago could be first
 * SEEN moments after Generate and qualified as this prompt's. The queue-start
 * screen that getAllCachedStatuses already applied is now applied here too.
 */

/// <reference types="node" />

import * as fs from 'fs';
import * as pathMod from 'path';
import {
  initApiHelper,
  onQueueStart,
  onBeforeSubmit,
  getNewSubmissions,
  findBoundMediaIds,
} from '../content/apiHelper';
import { FlowGenerationStatus } from '../types';

/* initApiHelper pings the worker to install the interceptor; the ping is not
   what is under test, and it is already wrapped in a try. */
beforeAll(() => {
  (globalThis as any).chrome = {
    runtime: { sendMessage: () => Promise.resolve() },
    storage: { local: { get: () => Promise.resolve({}) } },
  };
});

const state = () => (window as any).__af_api_state;

const reset = async () => {
  delete (window as any).__af_api_state;
  await initApiHelper();
  onQueueStart();
};

/** Put a record straight into the cache, as a relayed status would. */
const cache = (mediaId: string, promptText: string, createdAt?: string) => {
  const s: FlowGenerationStatus = {
    mediaId, promptText, state: 'generating', rawStatus: 'NO_MEDIA_YET',
    createdAt: createdAt || new Date().toISOString(),
  } as FlowGenerationStatus;
  state().statusCache.set(mediaId, s);
  return s;
};

/** Deliver a relay message the way the MAIN world does. */
const relay = (type: string, payload: unknown) => {
  window.dispatchEvent(new MessageEvent('message', {
    source: window as unknown as Window,
    data: { source: 'autoflow-api-interceptor', type, payload },
  }));
};

describe('the exact binding', () => {
  beforeEach(reset);

  it('remembers which generations a prompt produced', () => {
    relay('GENERATION_BOUND', { promptText: 'a dragon over a burning city', mediaIds: ['m-1', 'm-2'] });
    expect(findBoundMediaIds('a dragon over a burning city')).toEqual(['m-1', 'm-2']);
  });

  it('matches on letters and digits, not on punctuation', () => {
    /* The engine looks the prompt up with the same string it submitted, but
       the two go through separate paths — normalising both means spacing or
       case drift cannot silently break the binding. */
    relay('GENERATION_BOUND', { promptText: 'A Dragon, over a burning city!', mediaIds: ['m-9'] });
    expect(findBoundMediaIds('a dragon over a burning city')).toEqual(['m-9']);
  });

  it('says nothing about a prompt it never bound', () => {
    relay('GENERATION_BOUND', { promptText: 'a dragon over a burning city', mediaIds: ['m-1'] });
    expect(findBoundMediaIds('a quiet lake at dawn')).toEqual([]);
  });

  it('ignores a binding that carries no ids', () => {
    relay('GENERATION_BOUND', { promptText: 'a dragon over a burning city', mediaIds: [] });
    expect(findBoundMediaIds('a dragon over a burning city')).toEqual([]);
  });

  it('does not survive into the next run', () => {
    /* A prompt reused in a later queue would otherwise bind to the
       generation the earlier queue made for it. */
    relay('GENERATION_BOUND', { promptText: 'a dragon over a burning city', mediaIds: ['m-1'] });
    onQueueStart();
    expect(findBoundMediaIds('a dragon over a burning city')).toEqual([]);
  });
});

describe('what counts as a new submission', () => {
  beforeEach(reset);

  it('excludes what was already in the cache before Generate', () => {
    cache('old', 'an earlier prompt');
    onBeforeSubmit('a dragon over a burning city');
    cache('new', 'a dragon over a burning city');

    expect(getNewSubmissions().map(s => s.mediaId)).toEqual(['new']);
  });

  it('excludes work made before this queue started, however late it is seen', () => {
    /* The hole this closes: Flow re-describes old generations on any project
       refresh, so one from weeks ago could first appear in the cache moments
       after Generate and be taken for this prompt's. */
    onBeforeSubmit('a dragon over a burning city');
    cache('ancient', 'something from last month', new Date(Date.now() - 30 * 24 * 3600_000).toISOString());
    cache('fresh', 'a dragon over a burning city');

    expect(getNewSubmissions().map(s => s.mediaId)).toEqual(['fresh']);
  });

  it('keeps a record that states no creation time', () => {
    /* Thin records exist, and dropping them would lose real submissions —
       the screen is there to exclude the provably old, not the unstated. */
    onBeforeSubmit('a dragon over a burning city');
    const s = cache('undated', 'a dragon over a burning city');
    delete (s as any).createdAt;

    expect(getNewSubmissions().map(s2 => s2.mediaId)).toEqual(['undated']);
  });

  it('tolerates a clock skew of about a minute', () => {
    /* The record is stamped by the server and the queue start by this
       machine; a strict comparison would drop genuine submissions. */
    onBeforeSubmit('a dragon over a burning city');
    cache('just-before', 'a dragon over a burning city', new Date(Date.now() - 30_000).toISOString());

    expect(getNewSubmissions().map(s => s.mediaId)).toEqual(['just-before']);
  });
});

describe('announcing the prompt to the interceptor', () => {
  beforeEach(reset);

  it('posts the prompt so the interceptor can recognise the request', () => {
    const posted: any[] = [];
    const real = window.postMessage;
    (window as any).postMessage = (msg: any) => { posted.push(msg); };
    try {
      onBeforeSubmit('a dragon over a burning city');
    } finally {
      (window as any).postMessage = real;
    }

    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({
      source: 'autoflow-engine',
      type: 'PENDING_PROMPT',
      payload: { text: 'a dragon over a burning city' },
    });
  });

  it('posts nothing when there is no prompt to announce', () => {
    const posted: any[] = [];
    const real = window.postMessage;
    (window as any).postMessage = (msg: any) => { posted.push(msg); };
    try {
      onBeforeSubmit();
    } finally {
      (window as any).postMessage = real;
    }
    expect(posted).toHaveLength(0);
  });

  it('still snapshots the cache when given no text', () => {
    /* The old call signature. It must keep working — the fallback path is
       what runs for a prompt too short to bind. */
    cache('old', 'an earlier prompt');
    onBeforeSubmit();
    cache('new', 'a later prompt');
    expect(getNewSubmissions().map(s => s.mediaId)).toEqual(['new']);
  });
});

/* ── The two halves that cannot be imported ──────────────────────────────────
 *
 * The interceptor is an IIFE that installs itself into the MAIN world at
 * document_start, and the chooser is a private method on the engine. Both are
 * read as source here. It is a weaker kind of test than the ones above, and
 * it is used only where behaviour cannot be exercised directly.
 */

const src = (rel: string) =>
  fs.readFileSync(pathMod.resolve(__dirname, rel), 'utf8').replace(/\r\n/g, '\n');

const BYPASS = src('../content/sw-bypass.ts');
const ENGINE = src('../content/automation.ts');

/** Source with comments stripped, so prose cannot satisfy an assertion. */
const bare = (s2: string) => s2.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

describe('the interceptor, which alone sees a request beside its own reply', () => {
  it('binds only when the body actually carried the prompt', () => {
    expect(bare(BYPASS)).toMatch(/requestCarriesPendingPrompt\(reqBody\)/);
  });

  it('reports which generations the reply described, not just how many', () => {
    /* relayBatch returned a count, which cannot say WHICH ids to bind. */
    expect(bare(BYPASS)).toMatch(/function relayBatch\(url: string, text: string\): string\[\]/);
    expect(bare(BYPASS)).toMatch(/statuses\.map\(\(st\) => st\.mediaId\)/);
  });

  it('refuses a prompt too short to identify a request', () => {
    /* "a cat" appears in bodies that have nothing to do with this
       submission, and a wrong binding is the failure being fixed. */
    expect(bare(BYPASS)).toMatch(/pendingNeedle\.length < 12/);
  });

  it('compares on letters and digits, which survive the encoding', () => {
    /* The prompt reaches the wire URL-encoded inside JSON inside a form
       field; its punctuation and whitespace do not survive intact. */
    expect(bare(BYPASS)).toMatch(/replace\(\/\[\^a-z0-9\]\+\/g, ' '\)/);
    expect(bare(BYPASS)).toMatch(/decodeURIComponent/);
  });

  it('undoes form encoding before decoding', () => {
    /* A form body writes spaces as "+", and decodeURIComponent leaves those
       alone — so without this the words never line up. */
    const decodeLine = bare(BYPASS)
      .split('\n')
      .find((l) => l.includes('decodeURIComponent(body')) || '';
    expect(decodeLine).not.toBe('');

    /* The + has to become a space BEFORE decoding — a form body writes
       spaces that way and decodeURIComponent leaves them untouched, so
       without it the words never line up with the prompt. */
    const BACKSLASH = String.fromCharCode(92);
    expect(decodeLine).toContain(`replace(/${BACKSLASH}+/g, ' ')`);
  });

  it('binds once per submission', () => {
    /* Flow polls the same generation for as long as it runs, and every one
       of those replies answers a request that still quotes the prompt.
       Without clearing, a later poll would rebind the prompt to whatever
       that reply described — for a batch, not the tile it started. */
    const idx = bare(BYPASS).indexOf("relay('GENERATION_BOUND'");
    expect(idx).toBeGreaterThan(-1);
    expect(bare(BYPASS).slice(idx, idx + 300)).toMatch(/pendingNeedle = '';/);
  });

  it('accepts the prompt only from this page', () => {
    const idx = bare(BYPASS).indexOf("d.type === 'PENDING_PROMPT'");
    const block = bare(BYPASS).slice(Math.max(0, idx - 400), idx);
    expect(block).toMatch(/event\.source !== window/);
    expect(block).toMatch(/d\.source !== 'autoflow-engine'/);
  });
});

describe('choosing which generation is the prompt\'s', () => {
  const chooser = /private pickGenerationFor\([\s\S]*?\n  \}/.exec(ENGINE)?.[0] || '';

  it('exists as one rule, not four copies', () => {
    expect(chooser).not.toBe('');
    /* One definition, four call sites: the submit-time capture, the late
       poll, the active-refresh retry, and the post-retry recapture. */
    expect((ENGINE.match(/pickGenerationFor\(/g) || []).length).toBe(5);
  });

  it('prefers the interceptor binding above everything', () => {
    const body = bare(chooser);
    expect(body.indexOf('findBoundMediaIds')).toBeLessThan(body.indexOf('promptText'));
  });

  it('falls back to the cache when the bound id is not in this batch', () => {
    expect(bare(chooser)).toMatch(/getCachedStatus\(id\)/);
  });

  it('then compares prompt text, and only then takes the first', () => {
    const body = bare(chooser);
    expect(body.indexOf('promptText')).toBeLessThan(body.lastIndexOf('candidates[0]'));
  });

  it('says so in the log when it is guessing', () => {
    /* A wrong id used to be silent, and surfaced later as another
       generation's state reported as this prompt's. */
    expect(chooser).toMatch(/none tied to this prompt/);
  });

  it('does not guess loudly when there is only one candidate', () => {
    expect(bare(chooser)).toMatch(/if \(candidates\.length > 1\)/);
  });

  it('refuses a text match on a fragment too short to mean anything', () => {
    expect(bare(chooser)).toMatch(/needle\.length > 10/);
  });
});

describe('every submission announces itself', () => {
  it('the queue run, the extend path and the retry click', () => {
    /* A site left calling onBeforeSubmit() with no text silently keeps the
       old positional guess for those generations. */
    const calls = bare(ENGINE).match(/onBeforeSubmit\([^)]*\)/g) || [];
    expect(calls.length).toBe(3);
    for (const c of calls) expect(c).toMatch(/prompt\.text/);
  });
});
