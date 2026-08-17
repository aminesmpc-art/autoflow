/**
 * No control characters in the source.
 *
 * A regex in the shot checker shipped as
 *
 *     /<BS>[\w-]+\.(?:png|jpe?g)<BS>|<BS>reference-\d+<BS>/i
 *
 * where <BS> is a literal backspace, 0x08. It was written through a script
 * whose string turned "\b" into the character it escapes rather than leaving
 * the two characters alone, and every tool downstream hid it: grep printed
 * the line as if it were correct, the TypeScript compiler accepted it, the
 * build passed, and the rule simply never matched anything.
 *
 * That is the worst shape a defect can take — invisible in review, silent at
 * runtime, and indistinguishable from a rule that is merely too narrow. It
 * cost half an hour of looking straight at the line and reading it as right.
 *
 * A backspace, form feed, vertical tab or bell has no business in a source
 * file. Anything that puts one there is a mistake, and this notices in a
 * second what took thirty minutes.
 */

/// <reference types="node" />

import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

const SRC = join(__dirname, '..');

/** Every .ts/.tsx/.css under src, tests included. */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) { sourceFiles(full, out); continue; }
    if (/\.(ts|tsx|css)$/.test(name)) out.push(full);
  }
  return out;
}

/* Backspace, bell, vertical tab, form feed, and the C1 range. Tab, newline and
   carriage return are deliberately absent — those are ordinary. */
const CONTROL = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/;

describe('the source files', () => {
  const files = sourceFiles(SRC);

  it('finds something to check', () => {
    /* A directory walk that silently returns nothing would make every
       assertion below vacuous, which is the same class of bug it is here to
       catch. */
    expect(files.length).toBeGreaterThan(50);
  });

  it('contain no control characters', () => {
    const bad: string[] = [];
    for (const f of files) {
      readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
        const m = CONTROL.exec(line);
        if (m) {
          bad.push(`${f.slice(SRC.length + 1)}:${i + 1} contains 0x${
            m[0].charCodeAt(0).toString(16).padStart(2, '0')} — probably a "\b" or "\f" `
            + 'that a script interpreted instead of writing literally');
        }
      });
    }
    expect(bad).toEqual([]);
  });
});
