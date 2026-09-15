/**
 * @jest-environment jsdom
 */

/**
 * Why a hidden Gemini run did nothing until the tab was clicked.
 *
 * Reported twice from real runs. The cause was not throttling, not
 * collection, and not the composer write — it was the question every
 * adapter asks before any of that:
 *
 *     const rect = el.getBoundingClientRect();
 *     if (rect.width < 5 || rect.height < 5) return false;
 *
 * A tab Chrome is not rendering computes NO LAYOUT, so that call returns
 * 0×0 for every element on the page. The test answers "invisible" for
 * everything, findComposer() filters by it and returns null, and the
 * adapter never finds the box to type into. It never types, never submits,
 * and waits until it gives up.
 *
 * Clicking the tab computes layout and the next attempt works, which is
 * exactly what was described.
 *
 * Flow is the control: the only adapter with no getBoundingClientRect gate
 * anywhere, and the only one that ran hidden without complaint.
 *
 * All five copies were byte-identical, so there is one now.
 */

/// <reference types="node" />

import { readFileSync } from 'fs';
import { join } from 'path';
import { isVisible } from '../content/shared/visible';

const read = (...p: string[]) =>
  readFileSync(join(__dirname, '..', ...p), 'utf8').replace(/\r\n/g, '\n');
const codeOnly = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, '');

/** jsdom reports 0×0 for everything, exactly like a tab with no layout. */
function el(style: Partial<CSSStyleDeclaration> = {}, size?: [number, number]): HTMLElement {
  const node = document.createElement('div');
  Object.assign(node.style, style);
  document.body.appendChild(node);
  if (size) {
    node.getBoundingClientRect = () =>
      ({ width: size[0], height: size[1] }) as DOMRect;
  }
  return node;
}

function setHidden(hidden: boolean): void {
  Object.defineProperty(document, 'hidden', { value: hidden, configurable: true });
}

describe('a tab with no layout', () => {
  beforeEach(() => { document.body.innerHTML = ''; setHidden(true); });

  /* THE bug. Everything measures 0×0, and the old test called that hidden. */
  it('does not call every element invisible', () => {
    expect(isVisible(el())).toBe(true);
  });

  /* Style is computed without layout, so it still answers honestly and
     carries the decision on its own. */
  it('still respects display none', () => {
    expect(isVisible(el({ display: 'none' }))).toBe(false);
  });

  it('still respects visibility hidden', () => {
    expect(isVisible(el({ visibility: 'hidden' }))).toBe(false);
  });

  it('still respects opacity zero', () => {
    expect(isVisible(el({ opacity: '0' }))).toBe(false);
  });

  /* If a rect DID come back with real numbers while hidden, believe it. */
  it('believes a real measurement when it gets one', () => {
    expect(isVisible(el({}, [0, 0]))).toBe(true);      // unmeasured
    expect(isVisible(el({}, [200, 40]))).toBe(true);   // measured, big
  });
});

describe('a visible tab keeps the size test', () => {
  beforeEach(() => { document.body.innerHTML = ''; setHidden(false); });

  /* The size gate is doing real work on a visible tab: these sites leave
     collapsed and zero-sized elements in the DOM, and the composer finder
     depends on skipping them. It is only skipped where it cannot mean
     anything. */
  it('rejects a collapsed element', () => {
    expect(isVisible(el({}, [0, 0]))).toBe(false);
  });

  it('rejects something too small to be a real control', () => {
    expect(isVisible(el({}, [4, 4]))).toBe(false);
  });

  it('accepts a real one', () => {
    expect(isVisible(el({}, [200, 40]))).toBe(true);
  });
});

describe('it cannot break the adapter that asks', () => {
  it('never throws on a detached node', () => {
    setHidden(false);
    const orphan = document.createElement('div');
    expect(() => isVisible(orphan)).not.toThrow();
  });

  it('is false for nothing at all', () => {
    expect(isVisible(null as unknown as Element)).toBe(false);
  });
});

describe('every adapter asks the same question', () => {
  const ADAPTERS = ['gemini', 'chatgpt', 'claude', 'grok', 'zai'] as const;

  for (const name of ADAPTERS) {
    it(`${name} uses the shared test`, () => {
      const src = codeOnly(read('content', name, 'index.ts'));
      expect(src).toMatch(/import \{ isVisible \} from '\.\.\/shared\/visible'/);
    });

    /* Five byte-identical copies is how one fix missed four adapters. */
    it(`${name} keeps no copy of its own`, () => {
      const src = codeOnly(read('content', name, 'index.ts'));
      expect(src).not.toMatch(/function isVisible\(/);
    });
  }

  it('the shared one treats 0x0 as unknown only while hidden', () => {
    const SRC = codeOnly(read('content', 'shared', 'visible.ts'));
    expect(SRC).toMatch(/rect\.width === 0 && rect\.height === 0 && !hasLayout\(\)/);
    // And the size gate survives for the visible case.
    expect(SRC).toMatch(/rect\.width >= 5 && rect\.height >= 5/);
  });
});
