/**
 * The worker will fetch for a page, and only for our own services.
 *
 * ── Why the proxy exists ──────────────────────────────────────────────────
 *
 * A fetch from an extension PAGE — the side panel, the Studio window — is an
 * ordinary cross-origin request. It is preflighted, and anything the browser
 * dislikes surfaces as a bare "Failed to fetch" with the reason deliberately
 * withheld from the page. A fetch from the SERVICE WORKER is not: host
 * permissions cover it, CORS does not apply, and there is no preflight to
 * fail.
 *
 * Sign-in failed on a machine where the server was demonstrably correct — the
 * right status, the right Access-Control-Allow-Origin on both the preflight
 * and the actual response, checked from that same machine with curl — and the
 * panel still could not read it. Rather than keep guessing which layer of the
 * browser objected, the request now goes where the objection cannot arise.
 *
 * ── Why the allowlist is the important half ───────────────────────────────
 *
 * Every content script this extension injects runs on a site somebody else
 * controls, and any of them can send the worker a message. A worker that
 * fetches whatever it is asked to would be a proxy lending the extension's
 * host permissions and cookies to those pages — a far worse hole than the one
 * this routes around. So the tests below spend most of their length on what it
 * REFUSES.
 */

/// <reference types="node" />

import * as fs from 'fs';
import * as path from 'path';

const WORKER = fs.readFileSync(
  path.resolve(__dirname, '../background/service-worker.ts'), 'utf8',
).replace(/\r\n/g, '\n');

const API = fs.readFileSync(
  path.resolve(__dirname, '../shared/api.ts'), 'utf8',
).replace(/\r\n/g, '\n');

/** The allowlist rule, lifted out so it can be exercised directly. */
const API_ORIGINS = [
  'https://api.auto-flow.studio',
  'https://autoflow-extractor-production.up.railway.app',
];
const allowed = (url: string) => API_ORIGINS.some((o) => url.startsWith(o + '/'));

describe('what it will fetch', () => {
  it('our own two services', () => {
    expect(allowed('https://api.auto-flow.studio/api/auth/login')).toBe(true);
    expect(allowed('https://autoflow-extractor-production.up.railway.app/read')).toBe(true);
  });

  it('and nothing else at all', () => {
    for (const url of [
      'https://evil.example.com/steal',
      'http://localhost:8080/admin',
      'file:///C:/Users/secrets.txt',
      'https://labs.google/fx/api/upload-video',
      'chrome-extension://abc/manifest.json',
    ]) {
      expect(allowed(url)).toBe(false);
    }
  });

  it('refuses a host that merely STARTS with ours', () => {
    /* The classic prefix hole: api.auto-flow.studio.evil.com begins with the
       allowed string. Requiring the "/" after the origin is what closes it,
       and it is the single character this check turns on. */
    expect(allowed('https://api.auto-flow.studio.evil.com/x')).toBe(false);
    expect(allowed('https://api.auto-flow.studioX/x')).toBe(false);
  });

  it('refuses the origin with no path, which cannot be a real request', () => {
    expect(allowed('https://api.auto-flow.studio')).toBe(false);
  });

  it('is not fooled by a userinfo prefix', () => {
    /* https://api.auto-flow.studio@evil.com/ is a request to evil.com. */
    expect(allowed('https://api.auto-flow.studio@evil.com/x')).toBe(false);
  });
});

describe('the guard is actually in the worker', () => {
  it('checks the url before fetching it', () => {
    const fn = /async function proxyApiFetch\([\s\S]*?\n\}/.exec(WORKER);
    expect(fn).not.toBeNull();
    const body = (fn as RegExpExecArray)[0];
    const checkAt = body.indexOf('API_ORIGINS.some');
    const fetchAt = body.indexOf('await fetch(');
    expect(checkAt).toBeGreaterThan(-1);
    expect(fetchAt).toBeGreaterThan(checkAt);
  });

  it('requires the separator, not just the prefix', () => {
    expect(WORKER).toMatch(/url\.startsWith\(o \+ '\/'\)/);
  });

  it('passes on only headers it recognises', () => {
    /* The headers arrive from a page. Forwarding them wholesale would let one
       set Cookie or Origin on a request made with our permissions. */
    expect(WORKER).toMatch(/const SAFE_HEADERS = new Set\(/);
    const set = /const SAFE_HEADERS = new Set\(\[([\s\S]*?)\]\)/.exec(WORKER);
    expect(set).not.toBeNull();
    const names = Array.from((set as RegExpExecArray)[1].matchAll(/'([^']+)'/g)).map((m) => m[1]);
    expect(names).toContain('authorization');
    expect(names).toContain('content-type');
    for (const forbidden of ['cookie', 'origin', 'referer', 'host']) {
      expect(names).not.toContain(forbidden);
    }
  });
});

describe('the page only asks after its own attempt failed', () => {
  it('tries a direct fetch first', () => {
    const fn = /async function timedFetch\([\s\S]*?\n\}/.exec(API);
    expect(fn).not.toBeNull();
    const body = (fn as RegExpExecArray)[0];
    expect(body.indexOf('return await fetch(url')).toBeGreaterThan(-1);
    expect(body.indexOf('fetchViaWorker')).toBeGreaterThan(body.indexOf('return await fetch(url'));
  });

  it('does not swallow a timeout into the fallback', () => {
    /* A slow server is not a blocked request, and retrying it through the
       worker would double the wait before saying so. */
    const fn = /async function timedFetch\([\s\S]*?\n\}/.exec(API) as RegExpExecArray;
    expect(fn[0].indexOf('throw new TimeoutError()')).toBeLessThan(fn[0].indexOf('fetchViaWorker'));
  });

  it('rethrows the original error when the worker cannot help either', () => {
    /* The first error is the more informative one — it is the browser's own
       account of what it refused. */
    const fn = /async function timedFetch\([\s\S]*?\n\}/.exec(API) as RegExpExecArray;
    expect(fn[0]).toMatch(/if \(viaWorker\) return viaWorker;[\s\S]*throw err;/);
  });
});

describe('a withheld host permission names itself', () => {
  /* host_permissions in a manifest are a REQUEST, not a grant. Chrome can hold
     one back — the "Site access" setting — and re-evaluates when an update adds
     permissions, which nobody chooses. While a host is withheld every fetch to
     it fails from the page AND the worker, with the same bare "Failed to fetch"
     an outage gives.

     This is the failure that cost most of a day: server correct, curl fine, a
     normal tab fine, and only the extension unable to reach it — while the
     product told the user to check the internet connection that was plainly
     working. */

  it('asks Chrome whether the host is allowed before blaming the network', () => {
    expect(API).toMatch(/async function apiHostAllowed\(\)/);
    expect(API).toMatch(/chrome\.permissions\?\.contains/);
    expect(API).toMatch(/origins: \[`\$\{API_BASE\}\/\*`\]/);
  });

  it('only asks once both the page and the worker have failed', () => {
    /* The check costs a round trip; a request that worked must not pay it. */
    const fn = /async function timedFetch\([\s\S]*?\n\}/.exec(API) as RegExpExecArray;
    expect(fn[0].indexOf('fetchViaWorker')).toBeLessThan(fn[0].indexOf('apiHostAllowed'));
  });

  it('says what to do, naming the exact setting', () => {
    /* "Permission denied" would be true and useless. The user needs the page,
       the button and the value. */
    expect(API).toMatch(/chrome:\/\/extensions/);
    expect(API).toMatch(/Site access/);
    expect(API).toMatch(/On all sites/);
  });

  it('treats "cannot ask" as not-a-permission-problem', () => {
    /* Returning null rather than false matters: outside an extension context
       there is no permission to be missing, and reporting one would send the
       user to a settings page that has nothing wrong on it. */
    const fn = /async function apiHostAllowed\([\s\S]*?\n\}/.exec(API) as RegExpExecArray;
    expect(fn[0]).toMatch(/return null;/);
    expect(API).toMatch(/=== false/);
  });
});
