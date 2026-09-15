/**
 * What happens to the product when the API host is unreachable.
 *
 * Every quota gate in shared/api.ts fails CLOSED on purpose —
 * checkCanGenerate and checkCanStartQueue both return allowed:false when
 * usage cannot be read, because failing open would hand every account
 * unlimited free usage for the length of an outage. That is the right
 * trade, and its price is that one unreachable host stops the entire
 * product for everyone, Pro included: there is no cached entitlement.
 *
 * So the host needs a standby, and the standby has to satisfy two things
 * that are easy to get wrong:
 *
 *   · it must be on a DIFFERENT DOMAIN. A name under auto-flow.studio is no
 *     help in the case that actually needs one — a lapsed registration, a
 *     DNS takeover, a registrar dispute takes every name under it at once.
 *
 *   · it must be in host_permissions BEFORE the emergency. Chrome enforces
 *     that list, so a host missing from the manifest is unreachable no
 *     matter what the code says, and adding one is a store review measured
 *     in days — exactly the days you do not have.
 *
 * Both are asserted here rather than left to a comment, because both look
 * like tidying to a future reader: the second host reads as duplication,
 * and the manifest entry reads as an unused permission.
 */

/// <reference types="node" />

import { readFileSync } from 'fs';
import { join } from 'path';

const API = readFileSync(
  join(__dirname, '..', 'shared', 'api.ts'), 'utf8').replace(/\r\n/g, '\n');
const MANIFEST = JSON.parse(
  readFileSync(join(__dirname, '..', '..', 'manifest.json'), 'utf8'));

/** Source with comments stripped, so prose cannot satisfy an assertion.
 *
 * Block comments only. Stripping `//` line comments as well would eat the
 * `//` inside every URL in this file — which is what it did on the first run
 * here, turning 'https://api.auto-flow.studio' into 'https: and failing two
 * assertions about hosts that were in fact perfectly correct. */
const codeOnly = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, '');

const CODE = codeOnly(API);

const hostOf = (u: string) => new URL(u).hostname;
const registrableSuffix = (h: string) => h.split('.').slice(-2).join('.');

describe('the API has a standby', () => {
  // From the RAW source: these values are URLs, not prose to be cheated with.
  const primary = /const API_BASE = '([^']+)'/.exec(API)?.[1];
  const fallback = /const API_FALLBACK = '([^']+)'/.exec(API)?.[1];

  it('declares one', () => {
    expect(primary).toBeTruthy();
    expect(fallback).toBeTruthy();
    expect(fallback).not.toEqual(primary);
  });

  /** The whole point. A sibling subdomain dies with the domain. */
  it('is on a different registrable domain from the primary', () => {
    expect(registrableSuffix(hostOf(fallback!)))
      .not.toEqual(registrableSuffix(hostOf(primary!)));
  });

  /** Chrome enforces host_permissions; code alone cannot reach a host. */
  it('is permitted in the manifest, in advance', () => {
    const perms: string[] = MANIFEST.host_permissions || [];
    for (const host of [primary!, fallback!]) {
      expect(perms.some((p) => p.startsWith(host))).toBe(true);
    }
  });

  /** Neither host may come from storage. */
  it('is compiled in, not read from storage', () => {
    const decl = CODE.slice(CODE.indexOf('const API_BASE'), CODE.indexOf('const API_FALLBACK') + 200);
    expect(decl).not.toMatch(/chrome\.storage/);
    expect(decl).not.toMatch(/getStored/);
  });
});

describe('when the primary is unreachable', () => {
  const body = (): string => {
    const at = CODE.indexOf('async function apiFetchRaw(');
    expect(at).toBeGreaterThan(-1);
    return CODE.slice(at, at + 1800);
  };

  it('tries the standby', () => {
    expect(body()).toMatch(/API_FALLBACK/);
    expect(body()).toMatch(/_usingFallback = /);
  });

  /**
   * A 4xx or 5xx is an ANSWER — the host is up and has an opinion. Retrying
   * it against the standby would double every genuine error and ask a second
   * host a question the first already answered. Only a thrown fetch (no
   * response at all) may fail over, which is what the catch block means.
   */
  it('does not fail over on an error RESPONSE, only on no response', () => {
    expect(body()).not.toMatch(/res\.ok|status >= 500|response\.status/);
  });

  /**
   * An abort is our own deadline firing, not evidence the host is down.
   * Retrying it would double the wait the deadline exists to cap — and the
   * auth tests assert fetch is called exactly once for a stalled request.
   */
  it('does not fail over on our own deadline', () => {
    expect(body()).toMatch(/AbortError/);
  });
});

describe('requests have a deadline', () => {
  it('sets one, because fetch has none of its own', () => {
    expect(CODE).toMatch(/const REQUEST_DEADLINE_MS = \d+/);
    const at = CODE.indexOf('async function apiFetchRaw(');
    const body = CODE.slice(at, at + 1800);
    expect(body).toMatch(/new AbortController\(\)/);
    expect(body).toMatch(/setTimeout\([\s\S]{0,60}abort\(\)/);
    expect(body).toMatch(/clearTimeout\(timer\)/);
  });

  it('lets a caller bring its own signal', () => {
    const at = CODE.indexOf('async function apiFetchRaw(');
    expect(CODE.slice(at, at + 1800)).toMatch(/init\.signal \?\? controller\.signal/);
  });

  it('tells the user which failure it was', () => {
    expect(CODE).toMatch(/function connectionMessage/);
    expect(API).toContain('The server took too long to respond.');
    expect(API).toContain('Could not reach the server.');
  });
});

describe('the version header is real', () => {
  /* It was hard-coded '5.1' through all of 8.x. Nothing broke, because the
     backend does not read it — which is also why nobody noticed. It is the
     field that would make receipt coverage exact rather than inferred. */
  it('comes from the manifest rather than a literal', () => {
    expect(CODE).toMatch(/getManifest\(\)\.version/);
    expect(CODE).not.toMatch(/const EXTENSION_VERSION = '\d/);
  });
});
