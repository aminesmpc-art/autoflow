/**
 * What the uploaded cuts are called in Flow's library.
 *
 * Four pieces of one clip arrived as:
 *
 *   tlchargement_7   tlchargement_8   tlchargement_9
 *
 * Flow shows an asset under its FILE name and sanitises it hard — spaces and
 * brackets become underscores, and anything non-ASCII is dropped rather than
 * folded. So Chrome's localised default "telechargement (7).mp4" lands as
 * "tlchargement_7": unreadable, unsortable, and indistinguishable from the
 * other three.
 *
 * Two things had to be true to fix it, and only one of them is about naming.
 *
 * 1. The name has to be a good one, folded to ASCII by us rather than gutted
 *    by Flow — "Téléchargement" should become "Telechargement", not
 *    "Tlchargement".
 *
 * 2. The name has to actually reach the disk. The filename passed to
 *    downloads.download was not being applied, which is why the default
 *    appeared at all. onDeterminingFilename settles it, and is scoped so it
 *    can never rename a download this extension did not start.
 */

/// <reference types="node" />

import * as fs from 'fs';
import * as path from 'path';

import { partFileName } from '../content/flow/uploadVideo';

const UPLOAD = fs.readFileSync(
  path.resolve(__dirname, '../background/debugUpload.ts'), 'utf8',
).replace(/\r\n/g, '\n');

const CUT = fs.readFileSync(
  path.resolve(__dirname, '../studio/nodes/CutNode.tsx'), 'utf8',
).replace(/\r\n/g, '\n');

describe('the name a piece gets', () => {
  it('folds accents instead of dropping them', () => {
    /* The whole point. Flow turns "Téléchargement" into "Tlchargement";
       folding first gives a word somebody can read. */
    expect(partFileName('Téléchargement', 1, 4)).toBe('Telechargement-part1-of-4.mp4');
    expect(partFileName('Rétrospective à Paris', 1, 1)).toBe('Retrospective-a-Paris.mp4');
  });

  it('numbers the part in words, not in brackets', () => {
    /* "(2)" is exactly the shape Flow mangles into "_2". */
    expect(partFileName('Clipping 1', 2, 4)).toBe('Clipping-1-part2-of-4.mp4');
  });

  it('leaves a single piece unnumbered', () => {
    expect(partFileName('Clipping 1', 1, 1)).toBe('Clipping-1.mp4');
  });

  it('gives every piece of a clip a distinct, sortable name', () => {
    const names = [1, 2, 3, 4].map((i) => partFileName('Interview', i, 4));
    expect(new Set(names).size).toBe(4);
    expect(names).toEqual([
      'Interview-part1-of-4.mp4', 'Interview-part2-of-4.mp4',
      'Interview-part3-of-4.mp4', 'Interview-part4-of-4.mp4',
    ]);
  });

  it('survives a label made entirely of punctuation', () => {
    expect(partFileName('!!! ???', 1, 2)).toBe('clip-part1-of-2.mp4');
    expect(partFileName('', 1, 1)).toBe('clip.mp4');
  });

  it('produces nothing Flow will rewrite', () => {
    /* If the name still contains a space, a bracket or a non-ASCII byte, Flow
       changes it and the name in the library stops matching the name on disk —
       which is what made these four impossible to tell apart. */
    for (const label of ['Téléchargement', 'Clip (final)', 'a  b', 'Ünïcödé', '日本語']) {
      const name = partFileName(label, 1, 2);
      expect({ label, name, clean: /^[\w.-]+$/.test(name) })
        .toEqual({ label, name, clean: true });
    }
  });

  it('does not run off the end on a very long label', () => {
    const name = partFileName('x'.repeat(200), 1, 2);
    expect(name.length).toBeLessThan(64);
    expect(name.endsWith('-part1-of-2.mp4')).toBe(true);
  });

  it('never ends the base on a stray hyphen', () => {
    expect(partFileName('Clip -', 1, 1)).toBe('Clip.mp4');
    expect(partFileName('-- lead --', 1, 1)).toBe('lead.mp4');
  });
});

describe('both routes into Flow agree', () => {
  it('the upload and Save all use the same helper', () => {
    /* They had separate sanitisers, so a piece could reach Flow under two
       different names depending on how it got there. */
    expect(CUT).toMatch(/import \{ partFileName \}/);
    expect((CUT.match(/partFileName\(String\(d\.label \|\| 'clip'\), part\.index, part\.of\)/g) || []).length)
      .toBe(2);
  });

  it('no local sanitiser is left behind', () => {
    expect(CUT).not.toMatch(/replace\(\/\[\^\\w\.-\]\+\/g, '_'\)/);
    expect(CUT).not.toMatch(/-part\$\{part\.index\}of\$\{part\.of\}/);
  });
});

describe('making the name stick', () => {
  it('suggests the filename while Chrome is choosing', () => {
    expect(UPLOAD).toMatch(/chrome\.downloads\.onDeterminingFilename/);
    expect(UPLOAD).toMatch(/suggest\(\{ filename: want, conflictAction: 'overwrite' \}\)/);
  });

  it('never renames a download this extension did not start', () => {
    /* The listener is global. Without this it would rename the user's own
       downloads, which is far worse than the bug it fixes. */
    expect(UPLOAD).toMatch(/item\.byExtensionId !== chrome\.runtime\.id/);
  });

  it('stays quiet when no upload is in flight', () => {
    expect(UPLOAD).toMatch(/!wantedNames\.length/);
  });

  it('drops the queued name when the download never starts', () => {
    /* A stale head would rename the NEXT piece, which is a subtler version of
       the same bug: right mechanism, wrong file. */
    const fn = /export async function saveToDisk\([\s\S]*?\n\}/.exec(UPLOAD) as RegExpExecArray;
    expect(fn).not.toBeNull();
    expect(fn[0]).toMatch(/wantedNames\.splice\(at, 1\)/);
  });

  it('queues one name per download, in order', () => {
    const fn = /export async function saveToDisk\([\s\S]*?\n\}/.exec(UPLOAD) as RegExpExecArray;
    expect(fn[0].indexOf('wantedNames.push'))
      .toBeLessThan(fn[0].indexOf('chrome.downloads.download'));
  });

  it('says so when Chrome writes a different name anyway', () => {
    /* The failure that started this was silent. If the suggestion is ever
       overridden again, the log names both sides instead of leaving somebody
       to work it out from the library. */
    const fn = /export async function saveToDisk\([\s\S]*?\n\}/.exec(UPLOAD) as RegExpExecArray;
    expect(fn[0]).toMatch(/got !== filename/);
  });
});

describe('the FIFO queue behaves', () => {
  /* The listener's rule, mirrored, because ordering is the part that would
     silently mis-name rather than fail. */
  function drain(queue: string[], ours: boolean[]): Array<string | null> {
    const out: Array<string | null> = [];
    for (const isOurs of ours) {
      if (!isOurs || !queue.length) { out.push(null); continue; }
      out.push(queue.shift() as string);
    }
    return out;
  }

  it('hands each download the name queued for it', () => {
    const q = ['t/a.mp4', 't/b.mp4', 't/c.mp4'];
    expect(drain(q, [true, true, true])).toEqual(['t/a.mp4', 't/b.mp4', 't/c.mp4']);
    expect(q).toEqual([]);
  });

  it('lets a foreign download through without consuming a name', () => {
    const q = ['t/a.mp4', 't/b.mp4'];
    expect(drain(q, [false, true])).toEqual([null, 't/a.mp4']);
    expect(q).toEqual(['t/b.mp4']);
  });

  it('leaves an unexpected download alone once the queue is empty', () => {
    const q: string[] = [];
    expect(drain(q, [true])).toEqual([null]);
  });
});
