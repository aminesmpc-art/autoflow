/**
 * Horizontal scroll rows must not be vertically crushable.
 *
 * The template gallery's category tabs rendered 32px tall against a natural
 * 48px, and because the tabs then stretched into a zero-height content box,
 * every label was sliced through the middle — "Starter", "Marketing",
 * "Character" all cut in half.
 *
 * Nothing declared that height. The cause is a corner of the flexbox spec:
 *
 *   `overflow-x: auto` makes an element a scroll container. For a flex item,
 *   that changes what `min-height: auto` resolves to — min-content for a
 *   normal item, but ZERO for a scroll container.
 *
 * So the tab row was the only child of .studio-gallery the flex algorithm was
 * permitted to shrink past its contents, and with a template grid below it
 * asking for 5,000px inside a 450px column, it shrank it.
 *
 * The row needs the overflow (the tabs scroll sideways). What it does not need
 * is to be shrinkable, and the two are independent. Any row that scrolls on
 * one axis inside a flex column wants flex-shrink: 0 for the same reason, so
 * this checks every such rule rather than the one that broke.
 */

/// <reference types="node" />

import { readFileSync } from 'fs';
import { join } from 'path';

const CSS = readFileSync(join(__dirname, '..', 'studio', 'studio.css'), 'utf8');

/** Every rule body in the stylesheet, keyed by selector. */
function rules(css: string): Array<{ selector: string; body: string }> {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out: Array<{ selector: string; body: string }> = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stripped))) {
    out.push({ selector: m[1].trim(), body: m[2] });
  }
  return out;
}

describe('a row that scrolls sideways', () => {
  const sideways = rules(CSS).filter((r) => /overflow-x:\s*(auto|scroll)/.test(r.body));

  it('exists — otherwise this suite is guarding nothing', () => {
    expect(sideways.length).toBeGreaterThan(0);
  });

  it('never leaves itself shrinkable', () => {
    /* A scroll container's min-height: auto resolves to 0, so without this
       the flex algorithm may crush it to any height at all, and the first
       sign is text sliced in half rather than a layout that looks wrong. */
    const shrinkable = sideways
      .filter((r) => !/flex-shrink:\s*0|flex:\s*(0\s+0|none)/.test(r.body))
      .map((r) => r.selector);
    expect(shrinkable).toEqual([]);
  });

  it('keeps the gallery tabs scrolling, not just unshrinkable', () => {
    /* The fix must not have been "remove the overflow", which would stop the
       tab row scrolling once the categories outgrow the width. */
    const tabs = rules(CSS).find((r) => r.selector === '.studio-gallery__tabs');
    expect(tabs).toBeDefined();
    expect(tabs!.body).toMatch(/overflow-x:\s*auto/);
    expect(tabs!.body).toMatch(/flex-shrink:\s*0/);
  });
});
