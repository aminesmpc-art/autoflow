/**
 * A content script cannot lazy-load a webpack chunk.
 *
 *   ERROR: Prompt #1 error (attempt 1): Loading chunk 774 failed.
 *   (error: https://www.gstatic.com/_/mss/boq-labs-ai-sandbox/_/js/…/774.js)
 *
 * Four attempts, four identical failures, on every node — image and video —
 * and none of them ever reached Generate. dist/774.js was the character
 * picker, and it was being fetched from Google's CDN.
 *
 * Webpack's default publicPath is 'auto', resolved at RUNTIME against the
 * document. In a content script the document belongs to the site, so a chunk
 * request goes to the site's origin. It could not have come from the
 * extension either: web_accessible_resources lists studio.html and assets/*
 * and nothing else.
 *
 * Which made this invisible for as long as it was: `await import()` appears
 * four times in these content scripts and three of them are free, because the
 * module is ALSO imported statically elsewhere, so the call resolves against
 * the main bundle and asks the network for nothing.
 *
 *   ./selectors        static in content/flow/index.ts
 *   ./libraryPicker    static in content/flow/index.ts
 *   ./characterPicker  static nowhere  ← the only chunk, the only failure
 *
 * So "we already use await import() here and it works" was true and useless.
 * The rule is not about the syntax, it is about whether a chunk is emitted.
 *
 * The picker that caused it has since been removed with the Character node,
 * and the two cases that named it by hand went with it. The rule did not:
 * it is about every module under content/, and the next one to be split will
 * fail the same way for the same reason. The account above is kept because it
 * is the only evidence anyone has that this rule is real.
 */

/// <reference types="node" />

import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const CONTENT = join(__dirname, '..', 'content');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (name.endsWith('.ts') || name.endsWith('.tsx')) out.push(full);
  }
  return out;
}

const FILES = walk(CONTENT).map((path) => ({ path, src: readFileSync(path, 'utf8') }));

/** `./characterPicker` → `characterPicker`, so a static import matches it
    however it is spelled relative to its own directory. */
const tail = (spec: string): string => spec.replace(/^.*\//, '');

function dynamicImports(src: string): string[] {
  return [...src.matchAll(/\bimport\(\s*['"](\.[^'"]+)['"]\s*\)/g)].map((m) => m[1]);
}

function staticImports(src: string): string[] {
  return [
    ...[...src.matchAll(/\bfrom\s+['"](\.[^'"]+)['"]/g)].map((m) => m[1]),
    ...[...src.matchAll(/\bimport\s+['"](\.[^'"]+)['"]/g)].map((m) => m[1]),
  ];
}

const STATIC_TAILS = new Set(FILES.flatMap((f) => staticImports(f.src).map(tail)));

describe('nothing under content/ may be code-split', () => {
  it('every lazily imported module is also imported statically', () => {
    const orphans: string[] = [];
    for (const { path, src } of FILES) {
      if (path.includes(`${require('path').sep}tests${require('path').sep}`)) continue;
      for (const spec of dynamicImports(src)) {
        if (!STATIC_TAILS.has(tail(spec))) {
          orphans.push(`${path.slice(path.indexOf('content'))} → import('${spec}')`);
        }
      }
    }
    /* Named, not counted. "One orphan" tells you nothing; the file and the
       specifier are the whole fix — either import it statically, or set
       __webpack_public_path__ and publish the chunk. */
    expect(orphans).toEqual([]);
  });

});

describe('why the rule exists at all', () => {
  it('nothing sets a publicPath the extension could serve a chunk from', () => {
    /* If this ever stops being true — someone sets __webpack_public_path__ to
       chrome.runtime.getURL('') AND adds the chunks to
       web_accessible_resources — then code splitting becomes legal here and
       the rule above can be relaxed deliberately rather than by accident. */
    const cfg = readFileSync(join(__dirname, '..', '..', 'webpack.config.js'), 'utf8');
    const manifest = JSON.parse(
      readFileSync(join(__dirname, '..', '..', 'manifest.json'), 'utf8'));
    const hasPublicPath = /publicPath/.test(cfg)
      || FILES.some((f) => /__webpack_public_path__/.test(f.src));
    const war: string[] = (manifest.web_accessible_resources || [])
      .flatMap((entry: any) => entry.resources || []);
    const serves = war.some((r) => r.endsWith('.js') || r === '*');
    expect(hasPublicPath && serves).toBe(false);
  });
});
