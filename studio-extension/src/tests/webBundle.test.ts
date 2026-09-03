/**
 * The website's copy of the clipping pipeline must not fall behind this one.
 *
 * website/src/vendor/autoflow-clip.js is built from this source tree by
 * webpack.web.js and committed, because Vercel deploys the website from
 * website/ alone and cannot reach up here at build time. That is a reasonable
 * trade — the alternative was a second implementation of the survey prompt,
 * the silence snapping and the caption cue timing in plain JavaScript — but it
 * comes with one failure mode, and it is a quiet one:
 *
 *   somebody fixes clip/runClip.ts, runs the tests, sees 2892 pass, ships —
 *   and the website keeps the old behaviour until somebody happens to rebuild.
 *
 * So the build stamps what it was built from, and this fails by name when a
 * stamped source has moved since. The fix is always the same one line, and it
 * is in the failure message.
 *
 * This is the same guard check-engine-drift.js applies to the copied engines,
 * for the same reason: a copy nothing checks is a copy that goes three months
 * out of date.
 */

/// <reference types="node" />

import { createHash } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import { join, resolve } from 'path';

const ROOT = resolve(__dirname, '..', '..');
const STAMP = resolve(ROOT, '..', 'website', 'src', 'vendor', 'autoflow-clip.sources.json');
const BUNDLE = resolve(ROOT, '..', 'website', 'src', 'vendor', 'autoflow-clip.js');

const sha = (bytes: Buffer): string =>
  createHash('sha256').update(bytes).digest('hex').slice(0, 16);

const REBUILD = 'Run `npm run build:web` in studio-extension/ and commit both files.';

describe('the clipping bundle the website ships', () => {
  it('exists, with the stamp saying what built it', () => {
    expect(existsSync(BUNDLE)).toBe(true);
    expect(existsSync(STAMP)).toBe(true);
  });

  it('was built from the sources as they stand now', () => {
    const stamp = JSON.parse(readFileSync(STAMP, 'utf8')) as {
      files: Record<string, string>;
    };
    const entries = Object.entries(stamp.files || {});
    expect(entries.length).toBeGreaterThan(10);

    const moved: string[] = [];
    const missing: string[] = [];
    for (const [rel, recorded] of entries) {
      const full = join(ROOT, rel);
      if (!existsSync(full)) { missing.push(rel); continue; }
      if (sha(readFileSync(full)) !== recorded) moved.push(rel);
    }

    /* Named, not counted. "3 files have drifted" sends you looking; the list
       tells you whether it was a comment or the survey prompt. */
    expect({ moved, missing, fix: moved.length || missing.length ? REBUILD : '' })
      .toEqual({ moved: [], missing: [], fix: '' });
  });

  it('exports what the website calls, and carries no chrome API', () => {
    const built = readFileSync(BUNDLE, 'utf8');
    for (const name of [
      'runWebClipping', 'probeDuration', 'supported', 'release',
      'DEFAULT_BASE', 'LIMITS', 'CAPTION_PRESETS', 'STAGE_ORDER', 'STAGE_LABEL',
    ]) {
      expect(built.includes(name)).toBe(true);
    }

    /* The pipeline is free of chrome APIs and must stay that way — a page has
       no chrome.storage, and an import that reaches for one is a ReferenceError
       at the moment a user clicks Run. shared/api.ts is in the bundle for its
       token helpers, which the injected credentials short-circuit, so the
       strings appear; what must not appear is a call at module scope.
       Checked as a regex over the built file because that is the artifact the
       website actually loads. */
    const topLevelChrome = /^\s*chrome\s*\./m.test(built);
    expect(topLevelChrome).toBe(false);
  });
});
