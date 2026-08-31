/// <reference types="node" />

/* Auth request deadlines.

   Ported from the Flow extension, which hit this first. Studio had the same
   nine bare fetch() calls and none of the fix: a stalled socket never settled
   the promise, so the sign-in button stayed disabled on "Signing in…" forever
   — no error shown, no way to retry. On a flaky connection that is what a new
   user meets on first run.

   Two things are pinned here: a stalled request now settles, and it settles
   saying the server was slow rather than blaming the user's connection.
*/

const mockStorage: Record<string, any> = {};

// @ts-ignore
global.chrome = {
  storage: {
    local: {
      get: jest.fn((key: string, cb: (r: any) => void) => cb({ [key]: mockStorage[key] })),
      set: jest.fn((items: Record<string, any>, cb?: () => void) => {
        Object.assign(mockStorage, items);
        cb?.();
      }),
      remove: jest.fn((_key: string, cb?: () => void) => cb?.()),
    },
  },
} as any;

import { readFileSync } from 'fs';
import { join } from 'path';

import { login, register, requestPasswordReset } from '../shared/api';

/** A fetch that never answers, but honours abort — i.e. a stalled connection. */
function stalledFetch() {
  return jest.fn((_url: string, opts: any = {}) =>
    new Promise((_resolve, reject) => {
      const signal = opts.signal;
      if (!signal) return; // no signal wired up => hangs forever, test times out
      signal.addEventListener('abort', () => {
        const err: any = new Error('The operation was aborted.');
        err.name = 'AbortError';
        reject(err);
      });
    })
  );
}

describe('auth calls have a deadline', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    Object.keys(mockStorage).forEach((k) => delete mockStorage[k]);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it('login settles instead of hanging when the server never answers', async () => {
    // @ts-ignore
    global.fetch = stalledFetch();

    const pending = login('user@example.com', 'hunter2');
    jest.advanceTimersByTime(15000);

    const result = await pending;
    expect(result.ok).toBe(false);
    expect(result.message).toBe('The server took too long to respond. Please try again.');
  });

  it('passes an abort signal on every auth call', async () => {
    const spy = stalledFetch();
    // @ts-ignore
    global.fetch = spy;

    const pending = register('user@example.com', 'hunter2');
    jest.advanceTimersByTime(15000);
    await pending;

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][1].signal).toBeDefined();
  });

  it('does not trip the deadline when the server answers in time', async () => {
    // @ts-ignore
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ message: 'Verification code sent.' }),
      })
    );

    const result = await requestPasswordReset('user@example.com');
    expect(result.ok).toBe(true);
    expect(result.message).toBe('Verification code sent.');
  });

  it('still blames the connection when there is no network at all', async () => {
    // @ts-ignore
    global.fetch = jest.fn(() => Promise.reject(new TypeError('Failed to fetch')));

    const result = await login('user@example.com', 'hunter2');
    expect(result.ok).toBe(false);
    expect(result.message).toContain('Could not reach the server. Check your internet connection.');
  });

  it('and says WHICH failure it was, because four of them share that sentence', () => {
    /* No network, DNS gone, a response blocked by CORS, a request blocked by
       the extension's own CSP. The last two are not the user's connection and
       checking it will never help.

       This is not decoration. The server was answering 401 correctly to curl
       from the same machine while the panel insisted it was unreachable, and
       nothing on screen could separate the two — the browser hides the reason
       from the page, so it exists only in a console a user will not open. */
    // @ts-ignore
    global.fetch = jest.fn(() => Promise.reject(new TypeError('Failed to fetch')));

    return login('user@example.com', 'hunter2').then((result) => {
      expect(result.message).toContain('(Failed to fetch)');
    });
  });

  it('adds nothing when the failure carries no message', async () => {
    /* An empty pair of brackets is worse than none. */
    // @ts-ignore
    global.fetch = jest.fn(() => Promise.reject(new TypeError('')));
    const result = await login('user@example.com', 'hunter2');
    expect(result.message).not.toContain('()');
  });
});

describe('the version header', () => {
  const SRC = readFileSync(join(__dirname, '..', 'shared', 'api.ts'), 'utf8');

  it('is read off the manifest, not restated', () => {
    /* It said '5.1' — not stale, but the Flow extension's numbering entirely,
       on a build shipping 0.27.0. A hardcoded copy is only ever right on the
       day it is written. */
    expect(SRC).not.toMatch(/const EXTENSION_VERSION = '[\d.]+';/);
    expect(SRC).toMatch(/chrome\.runtime\.getManifest\(\)\.version/);
  });
});
