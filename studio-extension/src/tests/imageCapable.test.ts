/**
 * The chats that cannot see a picture.
 *
 * Reported as "Claude doesn't get image from the history", and it was not
 * about history at all — Claude never gets one, from anywhere.
 *
 * I had claimed the opposite: that attaching images was free because they ride
 * on referenceImageData, "the same field a Story node uses for its reference
 * stills, so all five adapters already know how to attach them". Three do.
 * Claude and Z.AI have no attach path at all: they take the payload, ignore
 * the field, and answer from the words.
 *
 * Which made it the worst version of a missing feature. The panel showed the
 * thumbnails, the worker carried several megabytes across two message
 * boundaries, the upload budget stretched from three minutes to six — and the
 * model never saw a pixel. Nothing anywhere said so.
 *
 * The capability list is checked against the adapters here, so adding the
 * missing path to one of them is a one-line change and not something anyone
 * has to remember.
 */

/// <reference types="node" />

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const SRC = readFileSync(join(__dirname, '..', 'sidepanel', 'index.ts'), 'utf8');
const adapter = (name: string): string => {
  const p = join(__dirname, '..', 'content', name, 'index.ts');
  return existsSync(p) ? readFileSync(p, 'utf8') : '';
};

/** What the panel believes. */
const claimed = (): string[] => {
  const m = SRC.match(/const IMAGE_CAPABLE = new Set\(\[([^\]]+)\]\)/);
  return m ? Array.from(m[1].matchAll(/'([a-z]+)'/g)).map((x) => x[1]) : [];
};

const ALL = ['chatgpt', 'gemini', 'grok', 'claude', 'zai'];

describe('the list matches the adapters', () => {
  it.each(ALL)('%s is claimed capable only if it reads the field', (name) => {
    /* The whole point of this file. A claim that drifts from the adapter is
       how a picture gets carried across two processes and dropped. */
    const reads = adapter(name).includes('referenceImageData');
    expect(claimed().includes(name)).toBe(reads);
  });

  it('knows about every chat the panel offers', () => {
    expect(claimed().every((k) => ALL.includes(k))).toBe(true);
  });
});

describe('nothing is sent that would be thrown away', () => {
  it('withholds the pictures from a chat that cannot attach them', () => {
    /* Carrying megabytes across two message boundaries and stretching the
       upload budget to six minutes, for a field the adapter ignores. */
    expect(SRC).toMatch(/images: round === 0 && IMAGE_CAPABLE\.has\(key\) \? refImages : \[\]/);
    expect(SRC).toMatch(/images: IMAGE_CAPABLE\.has\(at\.platform\) \? refineImages : \[\]/);
  });

  it('does not tell the model to look at pictures it will never receive', () => {
    /* aboutImages says "the attached picture shows…". Saying that with
       nothing attached is worse than saying nothing. */
    expect(SRC).toMatch(/aboutImages\(IMAGE_CAPABLE\.has\(key\) \? refImages\.length : 0, 'make'\)/);
    expect(SRC).toMatch(/aboutImages\(IMAGE_CAPABLE\.has\(at\.platform\) \? refineImages\.length : 0, 'edit'\)/);
  });
});

describe('and the panel says so before you press it', () => {
  it('warns beside the engine when pictures are attached', () => {
    expect(SRC).toMatch(/cannot see pictures/);
    expect(SRC).toMatch(/IMAGE_CAPABLE\.has\(sel\.value\)/);
  });

  it('says which chats can, so the fix is obvious', () => {
    expect(SRC).toMatch(/can see them/);
  });

  it('warns only when there is actually a picture to lose', () => {
    expect(SRC).toMatch(/\(refImages\.length \|\| refineImages\.length\)\s*\n?\s*&& !IMAGE_CAPABLE/);
  });

  it('puts that ahead of the tab-not-open warning', () => {
    /* A closed tab fails loudly. A blind model answers, plausibly, from the
       words — which is the one that quietly changes the result. */
    const at = SRC.indexOf('const blind =');
    const block = SRC.slice(at, at + 700);
    expect(block.indexOf('cannot see pictures')).toBeLessThan(block.indexOf('open it first'));
  });

  it('re-checks when a picture is added or removed', () => {
    /* The warning is about a combination — this engine, these pictures — so
       changing either side has to redraw it. */
    expect(SRC).toMatch(/function renderRefs\(\)[^\n]*renderEnginePicker\(\)/);
    expect(SRC).toMatch(/function renderRefineRefs\(\)[^\n]*renderEnginePicker\(\)/);
  });
});
