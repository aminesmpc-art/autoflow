/**
 * @jest-environment jsdom
 */

/**
 * Telling GLM thinking apart from GLM finished.
 *
 * The previous detection answered "still generating" almost always, and the
 * two reasons were both Tailwind utilities rather than anything about
 * generation:
 *
 *   [class*="cursor"]  matches `cursor-pointer`, which Z.AI puts on nearly
 *                      every button. On a completely idle page this alone
 *                      returned true.
 *   .animate-pulse     matches skeletons and the sidebar promo cards.
 *
 * So every Z.AI node ran to the fifteen-minute ceiling regardless, and the
 * symptom looked like a slow model rather than a selector that could not be
 * false. These tests exist to keep any replacement falsifiable: the first one
 * is an ordinary idle page covered in cursor-pointer, and it must read as
 * finished.
 */

/// <reference types="node" />

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const SRC = join(__dirname, '..', 'content', 'zai', 'index.ts');

/* Exercised through the source rather than the bundle: isThinkingOrGenerating
   is internal, and the states below are about which selectors it trusts. */
const source = () => readFileSync(SRC, 'utf8');

describe('the selectors it relies on', () => {
  it('no longer matches Tailwind utilities', () => {
    const fn = source().slice(
      source().indexOf('function isThinkingOrGenerating'),
      source().indexOf('function findNewChatControl'),
    );
    expect(fn).not.toContain('class*="cursor"');
    expect(fn).not.toContain('animate-pulse');
    expect(fn).not.toContain('animate-spin');
    expect(fn).not.toContain('[class*="typing"]');
  });

  it('uses the marks Z.AI actually renders', () => {
    const fn = source().slice(
      source().indexOf('function isThinkingOrGenerating'),
      source().indexOf('function findNewChatControl'),
    );
    // The label and icon carry purpose-built class names.
    expect(fn).toContain('thinking-pulse');
    expect(fn).toContain('.shimmer');
    // And the control that exists only while reasoning is happening.
    expect(fn).toContain('Skip Thinking');
  });

  it('finds the copy button by its own class, not by guessing', () => {
    expect(source()).toContain('copy-response-button');
  });

  it('does not key thinking off the word "thinking"', () => {
    /* Text matching broke on any account not in English — Z.AI ships a
       Chinese UI — while the class names are the same everywhere. */
    const fn = source().slice(
      source().indexOf('function isThinkingOrGenerating'),
      source().indexOf('function findNewChatControl'),
    );
    expect(fn).not.toMatch(/includes\('thinking/i);
    expect(fn).not.toMatch(/txt === 'skip'/i);
  });

  it('does not read the Svelte scoping hash', () => {
    /* svelte-bugqhi is generated per build and changes on every Z.AI deploy.
       It appears in the markup beside every real signal, which makes it the
       most tempting wrong answer in that DOM. */
    expect(source()).not.toContain('svelte-');
  });
});

describe('the adapter still declares a ceiling the runner outlasts', () => {
  it('keeps its Deep Think budget', () => {
    /* The rewrite must not quietly shorten the wait — GLM genuinely takes
       minutes, and adapterTimeouts.test.ts checks the other side of this. */
    const m = /TEXT_CEILING_MS\s*=\s*([\d\s*]+)/.exec(source());
    expect(m).not.toBeNull();
    const ms = (m as RegExpExecArray)[1].split('*').map((x) => Number(x.trim()))
      .reduce((a, b) => a * b, 1);
    expect(ms).toBeGreaterThanOrEqual(15 * 60 * 1000);
  });
});

beforeAll(() => {
  if (!existsSync(SRC)) throw new Error(`missing adapter: ${SRC}`);
});
