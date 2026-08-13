/**
 * Every class a node renders must have a rule behind it.
 *
 * The Story node shipped with `sn-field__select` and `sn-label__name`, class
 * names I assumed matched the other nodes. They did not — the real select
 * class is `sn-bar__sel` — so neither had a single rule anywhere, and every
 * control fell back to the operating system's own widget: a white box with
 * black text on a dark node. It looked broken because an unstyled form
 * control IS broken.
 *
 * Reading the stylesheet could never have caught it. The rule I would have
 * been looking for did not exist to be read. Rendering caught it in one look,
 * and this catches it without rendering.
 */

/// <reference types="node" />

import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const SRC = join(__dirname, '..');
const css = readFileSync(join(SRC, 'studio', 'studio.css'), 'utf8');

/** Every class name that appears as a selector in the stylesheet. */
const styled = new Set(
  Array.from(css.matchAll(/\.([a-zA-Z][\w-]*)/g)).map((m) => m[1]),
);

/**
 * Classes that carry no styling on purpose.
 *
 * `nodrag` and friends are read by React Flow, not by CSS. `sn-label__text`
 * is a <span> inside the styled `.sn-label`, so it inherits everything it
 * needs — which is exactly why the rule below is worth having rather than
 * widening: a span that inherits is fine, and a <select> that inherits
 * nothing is not.
 */
const EXEMPT = new Set(['nodrag', 'nowheel', 'nopan', 'sn-label__text']);

const nodeFiles = readdirSync(join(SRC, 'studio', 'nodes')).filter((f) => f.endsWith('.tsx'));

describe.each(nodeFiles)('%s', (file) => {
  const src = readFileSync(join(SRC, 'studio', 'nodes', file), 'utf8');

  it('renders no class that was never styled', () => {
    const used = new Set<string>();
    for (const m of src.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
      const raw = (m[1] || m[2] || '')
        /* Drop ${...} interpolations. What is left of a template literal is
           its fixed prefix — `sn-wrap--kind-` — which is not a class anyone
           wrote a rule for and never should be. Those end in a hyphen. */
        .replace(/\$\{[^}]*\}/g, ' ');
      for (const cls of raw.split(/\s+/)) {
        if (cls && !cls.endsWith('-')) used.add(cls);
      }
    }

    const orphans = [...used].filter((c) => !styled.has(c) && !EXEMPT.has(c)).sort();
    expect({ [file]: orphans }).toEqual({ [file]: [] });
  });
});
