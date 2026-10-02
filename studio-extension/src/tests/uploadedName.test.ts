/**
 * The name Flow is searched for must be a NAME.
 *
 * ── What went into the search box ─────────────────────────────────────────
 *
 *   C:\Users\HP PROBOOK\Downloads\autoflow-omni-temp\Motion-Control-1-part1-of-2.mp4
 *
 * and Flow answered "No assets found", which was the truth: no asset is called
 * that. The two clips sitting in the library beside it were called
 * Motion-Control-1-part1-of-2 and Motion-Control-1-part2-of-2 — the requested
 * names, applied correctly.
 *
 * chrome.downloads.search returns an ABSOLUTE path. saveToDisk took its
 * basename with
 *
 *   path.split(/[\/]/).pop()
 *
 * a character class holding one forward slash. A Windows path has none, so
 * nothing split and pop() returned the whole string. That was harmless for as
 * long as the value only fed a console warning; it stopped being harmless the
 * moment the caller began searching Flow's library with it.
 *
 * Two defences, because either alone would have prevented this:
 *   1. split on both separators, so the basename is a basename
 *   2. refuse anything path-shaped at the point of use — what goes in that
 *      field is typed into a search box, and a path can only ever miss
 */

/// <reference types="node" />

import { readFileSync } from 'fs';
import { join } from 'path';

const UPLOAD = readFileSync(
  join(__dirname, '..', 'background', 'debugUpload.ts'), 'utf8').replace(/\r\n/g, '\n');
const RUNNER = readFileSync(
  join(__dirname, '..', 'studio', 'engine', 'WorkflowRunner.ts'), 'utf8').replace(/\r\n/g, '\n');

/** The exact expression the shipped code uses, lifted out to be exercised. */
const basename = (p: string) => (p.split(/[\\/]/).pop() || '').trim();

const WINDOWS =
  'C:\\Users\\HP PROBOOK\\Downloads\\autoflow-omni-temp\\Motion-Control-1-part1-of-2.mp4';
const POSIX =
  '/home/amine/Downloads/autoflow-omni-temp/Motion-Control-1-part1-of-2.mp4';

describe('the basename of a download path', () => {
  it('is a filename on Windows, where this failed', () => {
    expect(basename(WINDOWS)).toBe('Motion-Control-1-part1-of-2.mp4');
  });

  it('is a filename on posix too', () => {
    expect(basename(POSIX)).toBe('Motion-Control-1-part1-of-2.mp4');
  });

  it('the old expression returned the whole Windows path', () => {
    /* Stated outright, because the bug is invisible on a posix machine and
       every test here would have passed on one. */
    const old = (p: string) => p.split(/[/]/).pop() || '';
    expect(old(WINDOWS)).toBe(WINDOWS);
    expect(old(POSIX)).toBe('Motion-Control-1-part1-of-2.mp4');
  });

  it('is what the shipped code actually does', () => {
    expect(UPLOAD).toMatch(/const got = \(path\.split\(\/\[\\\\\/\]\/\)\.pop\(\) \|\| ''\)\.trim\(\)/);
  });
});

describe('a path never reaches the search box', () => {
  const at = RUNNER.indexOf('private async executeMotionNode');
  const body = RUNNER.slice(at, at + 22000);

  /** The guard the runner applies, lifted out. */
  const looksLikeAPath = (s: string) => /[\\/]/.test(s);

  it('rejects a Windows path, a posix path, and nothing else', () => {
    expect(looksLikeAPath(WINDOWS)).toBe(true);
    expect(looksLikeAPath(POSIX)).toBe(true);
    expect(looksLikeAPath('Motion-Control-1-part1-of-2.mp4')).toBe(false);
    expect(looksLikeAPath('téléchargement (7).mp4')).toBe(false);
  });

  it('is guarded in the runner, not just trusted from the sender', () => {
    expect(body).toMatch(/if \(\/\[\\\\\/\]\/\.test\(actual\)\) \{/);
    expect(body).toMatch(/that is a path, /);
  });

  it('keeps the name it already had when it rejects one', () => {
    /* Falling back to the requested name is right: that name is usually the
       one Flow has, and it is never a path. */
    expect(body).toMatch(/Keeping "\$\{row\.filename\}"/);
  });

  it('still adopts a genuinely different filename', () => {
    /* The case this whole mechanism exists for: Chrome's localised default
       when onDeterminingFilename misses. */
    expect(body).toMatch(/row\.filename = actual;/);
  });
});
