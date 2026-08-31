/**
 * One design system, two surfaces.
 *
 * Before this existed, the side panel had 28 documented tokens and the studio
 * canvas had none — 2158 lines holding 87 distinct hex colours, 86 distinct
 * rgba values, 23 font sizes and 17 border radii. The panel's accent was lime,
 * the canvas's was orange, and the extension icon was violet: three answers to
 * one question. Worse, hue was doing two jobs at once — blue meant both "image
 * node" and "input focus", so a focused text field looked like an image node.
 *
 * These tests are the ratchet. They do not check that the design is good; they
 * check that it stays single. A hardcoded colour reappearing in either
 * stylesheet is how this drifts back, and it drifts back one declaration at a
 * time, each of which looks harmless on its own.
 */

/// <reference types="node" />

import { readFileSync } from 'fs';
import { join } from 'path';

const SRC = join(__dirname, '..');
const tokens = () => readFileSync(join(SRC, 'shared', 'tokens.css'), 'utf8');
const panel = () => readFileSync(join(SRC, 'sidepanel', 'sidepanel.css'), 'utf8');
const studio = () => readFileSync(join(SRC, 'studio', 'studio.css'), 'utf8');

/** Hex literals, ignoring the ones inside a comment. */
function hexes(css: string): string[] {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
  return (stripped.match(/#[0-9a-fA-F]{3,8}\b/g) || []).map((h) => h.toLowerCase());
}

describe('one design system', () => {
  it('defines the palette in exactly one place', () => {
    expect(tokens()).toMatch(/--accent:\s*#a07afd/);
    // Neither surface may redefine a shared token; that is how two palettes
    // grow back without anyone deciding to have two.
    for (const [name, css] of [['panel', panel()], ['studio', studio()]] as const) {
      const redefined = (css.match(/^\s*--(accent|bg|surface|text|ok|warn|bad)\b[^:]*:/gm) || []);
      expect({ [name]: redefined }).toEqual({ [name]: [] });
    }
  });

  it('imports the shared tokens from both surfaces', () => {
    expect(panel()).toMatch(/@import\s+['"]\.\.\/shared\/tokens\.css['"]/);
    expect(studio()).toMatch(/@import\s+['"]\.\.\/shared\/tokens\.css['"]/);
  });

  it('leaves no hardcoded colour in either stylesheet', () => {
    expect({ panel: hexes(panel()) }).toEqual({ panel: [] });
    expect({ studio: hexes(studio()) }).toEqual({ studio: [] });
  });

  it('reserves hue for meaning: chrome never borrows a node-family colour', () => {
    /* --n-image used to be #3b82f6, which was also the focus ring. The rule is
       that node-family tokens appear only on node-family selectors. */
    const lines = studio().split('\n');
    let selector = '';
    const trespassers: string[] = [];
    for (const raw of lines) {
      const line = raw.trim();
      const m = /^([.#:[][^{]*)\{/.exec(line);
      if (m) selector = m[1].trim();
      else if (line.endsWith('{') && !line.startsWith('@')) selector = line.slice(0, -1).trim();
      if (!/var\(--n-/.test(line)) continue;
      const isNodeish = /node|dot|port|kind|handle|family|minimap|sn-|fn-/i.test(selector);
      if (!isNodeish) trespassers.push(`${selector} :: ${line}`);
    }
    expect(trespassers).toEqual([]);
  });

  it('keeps every size and radius on the scale', () => {
    for (const [name, css] of [['panel', panel()], ['studio', studio()]] as const) {
      const rawType = css.match(/font-size:\s*[\d.]+px/g) || [];
      const rawRadius = css.match(/border-radius:\s*[\d.]+px/g) || [];
      expect({ [name]: rawType }).toEqual({ [name]: [] });
      expect({ [name]: rawRadius }).toEqual({ [name]: [] });
    }
  });

  it('resolves every token it references', () => {
    const defined = new Set(
      Array.from(tokens().matchAll(/(--[a-z0-9-]+)\s*:/g), (m: RegExpMatchArray) => m[1]),
    );
    for (const [name, css] of [['panel', panel()], ['studio', studio()]] as const) {
      const local = new Set(Array.from(css.matchAll(/(--[a-z0-9-]+)\s*:/g), (m: RegExpMatchArray) => m[1]));
      const used = Array.from(css.matchAll(/var\((--[a-z0-9-]+)/g), (m: RegExpMatchArray) => m[1]);
      const missing = [...new Set(used.filter((t) => !defined.has(t) && !local.has(t) && !t.startsWith('--xy-')))];
      expect({ [name]: missing }).toEqual({ [name]: [] });
    }
  });

  it('never says a colour is the only signal for a status', () => {
    // Each status token exists in a light and a translucent form so a state
    // can be a tinted block behind a word, not a coloured word alone.
    for (const s of ['ok', 'warn', 'bad']) {
      expect(tokens()).toMatch(new RegExp(`--${s}:`));
      expect(tokens()).toMatch(new RegExp(`--${s}-\\d+:`));
    }
  });

  it('agrees with itself about what a node type looks like', () => {
    /* The gallery dot and the node header disagreed: a prompt was orange in
       one and green in the other, so the same workflow changed colour
       depending on which screen you opened it from. */
    const css = studio();
    const dot = (kind: string) =>
      new RegExp(`card-dot--${kind}\\s*\\{[^}]*var\\((--n-[a-z]+)\\)`).exec(css)?.[1];
    const header = (kind: string) =>
      new RegExp(`node__header--${kind}\\s*\\{[^}]*var\\((--n-[a-z]+)-10\\)`).exec(css)?.[1];
    for (const kind of ['prompt', 'image', 'generate']) {
      expect({ kind, dot: dot(kind) }).toEqual({ kind, dot: header(kind) });
    }
  });
});

describe('platform marks are the real marks', () => {
  it('keeps the source files it was generated from', () => {
    /* The generated module is not the record — assets/brands/ is. Keeping the
       downloads means the next person can diff them against a fresh fetch
       instead of trusting that a path was transcribed correctly. */
    const dir = join(SRC, '..', 'assets', 'brands');
    for (const f of ['chatgpt.svg', 'googlegemini.svg', 'grok.svg', 'claude.svg', 'flow.svg']) {
      const svg = readFileSync(join(dir, f), 'utf8');
      expect({ [f]: svg.slice(0, 4) }).toEqual({ [f]: '<svg' });
      expect(svg.length).toBeGreaterThan(200);
    }
  });

  it('carries real geometry for every platform it drives', () => {
    // Read the module, not its text. Regexing generated source only tests the
    // regex — the first attempt at this passed a broken pattern for the same
    // reason `\s` collapses to `s` inside a template literal.
    const { BRAND_MARKS } = require('../studio/components/brandMarks');
    for (const name of ['chatgpt', 'gemini', 'grok', 'claude', 'flow']) {
      const mark = BRAND_MARKS[name];
      expect({ name, present: !!mark }).toEqual({ name, present: true });
      expect({ name, viewBox: /^[-\d.]+( [-\d.]+){3}$/.test(mark.viewBox) })
        .toEqual({ name, viewBox: true });
      // A mark with no drawing commands is a blank square nobody would notice.
      expect({ name, drawn: mark.body.length > 120 && mark.body.includes('<path') })
        .toEqual({ name, drawn: true });
      expect({ name, colour: /^#[0-9A-F]{6}$/i.test(mark.color) })
        .toEqual({ name, colour: true });
    }
  });

  it('does not let brand colours leak into the token system', () => {
    /* Brand marks are exempt from the palette on purpose, which only works if
       the exemption stays inside brandMarks.ts. A vendor hex turning up in a
       stylesheet means someone has started theming with it. */
    for (const [surface, css] of [['panel', panel()], ['studio', studio()]] as const) {
      const leaked = (css.match(/#8E75B2|#D97757|#10A37F/gi) || []);
      expect({ [surface]: leaked }).toEqual({ [surface]: [] });
    }
  });
});
