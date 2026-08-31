/**
 * What the Chrome Web Store checks before a human ever looks.
 *
 * These limits are enforced at upload: the dashboard refuses the package and
 * says little about why. That is a bad place to find out, because you only get
 * there after building, zipping and dragging the file in.
 *
 * This suite exists because the description sat at 138 characters against a
 * 132 limit for an entire release cycle, and nothing in the repo knew.
 */

/// <reference types="node" />

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..', '..');
const manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8'));
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

describe('the listing strings fit', () => {
  it('keeps the description inside 132 characters', () => {
    /* The blocker that stopped the 0.27.0 upload. Off-by-six, invisible in an
       editor, fatal at the dashboard. */
    expect(manifest.description.length).toBeGreaterThan(0);
    expect(manifest.description.length).toBeLessThanOrEqual(132);
  });

  it('keeps the name inside 75 characters', () => {
    expect(manifest.name.length).toBeGreaterThan(0);
    expect(manifest.name.length).toBeLessThanOrEqual(75);
  });

  it('says it is not affiliated with the sites it drives', () => {
    /* The description names Google, OpenAI and Anthropic products. Using those
       marks without a disclaimer is the impersonation rejection. */
    expect(manifest.description).toMatch(/no affiliation|not affiliated|independent/i);
  });
});

describe('the package is internally consistent', () => {
  it('has manifest and package.json on the same version', () => {
    /* They are bumped by hand in two files. One of them gets forgotten. */
    expect(manifest.version).toBe(pkg.version);
  });

  it('uses a version string the store accepts', () => {
    // Up to four dot-separated integers, each 0-65535, no leading zeros.
    expect(manifest.version).toMatch(/^\d{1,5}(\.\d{1,5}){0,3}$/);
    for (const part of manifest.version.split('.')) {
      expect(Number(part)).toBeLessThanOrEqual(65535);
      if (part.length > 1) expect(part.startsWith('0')).toBe(false);
    }
  });

  it('is manifest v3', () => {
    expect(manifest.manifest_version).toBe(3);
  });

  it('ships every icon size it declares', () => {
    const sizes = Object.keys(manifest.icons || {});
    expect(sizes).toEqual(expect.arrayContaining(['16', '48', '128']));
    for (const size of sizes) {
      expect(existsSync(join(ROOT, manifest.icons[size]))).toBe(true);
    }
  });
});

describe('every host permission is one we actually use', () => {
  /* Review asks for a justification per host. A permission with no content
     script behind it is one you cannot justify, and it widens the ask for
     nothing. */
  const scripted = new Set<string>(
    (manifest.content_scripts || []).flatMap((cs: any) => cs.matches || [])
  );

  const host = (pattern: string) => {
    try {
      return new URL(pattern.replace(/\*/g, 'x')).hostname.replace(/^x\./, '');
    } catch {
      return pattern;
    }
  };

  const BACKEND = 'api.auto-flow.studio';

  it('backs each host permission with a content script, except our own API', () => {
    const scriptedHosts = new Set(Array.from(scripted).map(host));
    const unbacked = (manifest.host_permissions || [])
      .filter((h: string) => host(h) !== BACKEND)
      .filter((h: string) => !scriptedHosts.has(host(h)));
    expect(unbacked).toEqual([]);
  });

  it('still talks to our own backend', () => {
    expect(manifest.host_permissions).toEqual(
      expect.arrayContaining([expect.stringContaining(BACKEND)])
    );
  });
});
