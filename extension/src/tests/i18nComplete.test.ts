/**
 * The panel speaks four languages, and a gap in one of them is invisible
 * from English. These tests read the source, the way the rest of this suite
 * does, and hold three things:
 *
 *   - every language has every key English has, and no stragglers;
 *   - a translation keeps English's {placeholders}, so a count or a name is
 *     never silently dropped (or printed as "{n}");
 *   - every key the markup or the code asks for exists — a missing key
 *     renders as the raw key name, which is how "privacy.title" once
 *     appeared in the Arabic panel.
 */

/// <reference types="node" />

import { readFileSync } from 'fs';
import { join } from 'path';

const read = (rel: string): string =>
  readFileSync(join(__dirname, '..', rel), 'utf8').replace(/\r\n/g, '\n');

const I18N = read('sidepanel/i18n.ts');
const PANEL = read('sidepanel/index.ts');
const HTML = read('../sidepanel.html');

const LANGS = ['en', 'ar', 'fr', 'es'] as const;

/** key → value for one language block, read from the source. */
function block(lang: string): Map<string, string> {
  const start = I18N.indexOf(`\n  ${lang}: {\n`);
  expect(start).toBeGreaterThan(-1);
  const end = I18N.indexOf('\n  },', start);
  const body = I18N.slice(start, end);
  const out = new Map<string, string>();
  // 'key': "value",  or  'key': 'value',
  const re = /^\s*'([^']+)':\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')\s*,?\s*$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) out.set(m[1], m[2].slice(1, -1));
  return out;
}

const BLOCKS = Object.fromEntries(LANGS.map((l) => [l, block(l)])) as Record<(typeof LANGS)[number], Map<string, string>>;
const placeholders = (v: string): string[] => (v.match(/\{\w+\}/g) || []).slice().sort();

describe('every language is complete', () => {
  it('reads a sensible number of English keys', () => {
    expect(BLOCKS.en.size).toBeGreaterThan(400);
  });

  for (const lang of LANGS.filter((l) => l !== 'en')) {
    it(`${lang} has every English key, and nothing English lacks`, () => {
      const missing = [...BLOCKS.en.keys()].filter((k) => !BLOCKS[lang].has(k));
      const extra = [...BLOCKS[lang].keys()].filter((k) => !BLOCKS.en.has(k));
      expect({ missing, extra }).toEqual({ missing: [], extra: [] });
    });

    it(`${lang} keeps English's placeholders`, () => {
      /* One exception: the singular keys (countOf's "key1") are only ever
         shown for exactly one, and a language may say the word instead of
         the digit — Arabic's "ملف واحد", one file, reads better than "1". */
      const singular = (k: string, v: string) => /1$/.test(k) && placeholders(v).join() === '';
      const wrong = [...BLOCKS.en.entries()]
        .filter(([k]) => BLOCKS[lang].has(k))
        .filter(([k, v]) => {
          const theirs = BLOCKS[lang].get(k)!;
          if (placeholders(v).join() === placeholders(theirs).join()) return false;
          return !singular(k, theirs);
        })
        .map(([k]) => k);
      expect(wrong).toEqual([]);
    });
  }
});

describe('every key asked for exists', () => {
  it('in the markup', () => {
    const asked = new Set<string>();
    const re = /data-i18n(?:-placeholder|-title|-aria)?="([^"]+)"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(HTML))) asked.add(m[1]);
    expect(asked.size).toBeGreaterThan(150);
    expect([...asked].filter((k) => !BLOCKS.en.has(k))).toEqual([]);
  });

  it('in the code', () => {
    const asked = new Set<string>();
    const re = /\b(?:t|tf)\('([a-zA-Z][\w.]*)'/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(PANEL))) asked.add(m[1]);
    expect(asked.size).toBeGreaterThan(150);
    expect([...asked].filter((k) => !BLOCKS.en.has(k))).toEqual([]);
  });
});
