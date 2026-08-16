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

describe('a finished turn is not vetoed by leftover thinking markup', () => {
  const fn = () => {
    const s = source();
    return s.slice(
      s.indexOf('function isThinkingOrGenerating'),
      s.indexOf('function findNewChatControl'),
    );
  };
  /* Comments mention .shimmer while explaining why it is checked second, so
     an ordering assertion has to read the code and not the prose about it. */
  const code = () => fn().replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  it('checks the copy button before anything else', () => {
    /* Z.AI leaves the collapsed accordion ("Thought for 12s") in the page
       after the answer lands, and it keeps its .shimmer class. Consulting
       that first meant a finished reply read as busy forever — the same
       mistake as the cursor-pointer check this replaced. */
    const body = code();
    const copy = body.indexOf('getAllCopyButtons()');
    const shimmer = body.indexOf('.shimmer');
    expect(copy).toBeGreaterThan(-1);
    expect(shimmer).toBeGreaterThan(-1);
    expect(copy).toBeLessThan(shimmer);
  });

  it('returns false immediately on a new copy button', () => {
    // Not "and also check the others" — the positive signal is final.
    expect(code()).toMatch(/getAllCopyButtons\(\)\.length > baselineCopyCount\) return false/);
  });

  it('treats the gap before the first token as busy, not as finished', () => {
    /* Falling through to "finished" would capture an empty reply the instant
       the prompt was sent. The outer silence timeout ends a dead turn. */
    expect(code().trimEnd().endsWith('return true;\n}')).toBe(true);
  });
});
