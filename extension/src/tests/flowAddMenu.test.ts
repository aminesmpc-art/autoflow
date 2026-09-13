/**
 * Finding the "+" that attaches ingredients, on the Flow that exists now.
 *
 * Read off a live signed-in project. The page has TWO buttons carrying an
 * "add" ligature, and the old code picked the wrong one:
 *
 *   aria-label="Add media menu"                     flow-tile-view-header  1218,18  40x40
 *   aria-label="Add ingredients to the prompt box"   flow-add-menu          484,958  32x32
 *
 * The second is the composer's "+". The first is an unrelated control in the
 * page header. Measured on that same page:
 *
 *   buttons with an "add_2" ligature      0    what strategy 1 looked for
 *   buttons with aria-haspopup="dialog"   0    what strategy 2 needed
 *   [role="dialog"] elements              0    what the dialog finder wanted
 *
 * The first two tiers matched nothing, so the last-resort tier decided it —
 * any "add" icon in document order — and that is the header button. Every
 * attached ingredient chip carries an "add" hover overlay too, so the winner
 * depended on document order rather than on anything meaningful.
 *
 * The label cannot be the anchor: it is translated. On a French account the
 * same button reads "Ajouter des ingredients au champ du prompt".
 *
 * ── Why these are source assertions ───────────────────────────────────────
 *
 * This package runs jest under `testEnvironment: 'node'` and has no DOM tests.
 * Installing jsdom into a shipped extension to add some is a bigger change
 * than the fix. The behaviour of this identical logic is covered against a
 * real DOM in studio-extension's flowAddMenu tests — where the same suite
 * fails 6 of 8 against the pre-fix source; what matters here is that this tree
 * carries the same logic rather than the code that was broken.
 */

/// <reference types="node" />

import * as fs from 'fs';
import * as path from 'path';

const SELECTORS = fs
  .readFileSync(path.resolve(__dirname, '../content/selectors.ts'), 'utf8')
  .replace(/\r\n/g, '\n');

/** The executable part only — block and line comments removed. */
const codeOnly = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

/** One function's body, so an assertion cannot be satisfied from elsewhere. */
const fn = (name: string): string => {
  const m = new RegExp(`export function ${name}\\([\\s\\S]*?\\n\\}`).exec(SELECTORS);
  if (!m) throw new Error(`${name} not found in selectors.ts`);
  return m[0];
};

describe('finding the attach button', () => {
  const body = () => fn('findIngredientAttachButton');

  it('asks for the add-menu component first', () => {
    /* The component name is the anchor: it is not translated, and it does not
       move when someone restyles the button. */
    expect(body()).toMatch(/querySelector\('flow-add-menu'\)/);
  });

  it('reaches the component before any ligature tier', () => {
    const b = body();
    expect(b.indexOf('flow-add-menu')).toBeLessThan(b.indexOf('add_2'));
  });

  it('never anchors on the English label, which is translated', () => {
    /* Anchoring would pass every test here and fail on the user's machine,
       where the button reads "Ajouter des ingredients au champ du prompt".

       Asserted against the code with comments stripped. The doc comment above
       the function quotes that very label to say what the markup looks like,
       and a naive match finds the comment and calls it an anchor — this
       project has already shipped one guard that its own comment satisfied. */
    expect(codeOnly(body())).not.toMatch(/Add ingredients to the prompt box/);
    expect(codeOnly(body())).not.toMatch(/aria-label="Add/);
  });

  it('excludes the page header from the last-resort tier', () => {
    /* This is the regression. Without it, "any add icon" resolves to
       aria-label="Add media menu" in flow-tile-view-header. */
    expect(body()).toMatch(/closest\('flow-tile-view-header'\)/);
  });

  it('excludes ingredient chips, which carry an add overlay each', () => {
    expect(body()).toMatch(/closest\('flow-ingredient-chip, flow-image-ingredient-chip'\)/);
  });

  it('scopes the last-resort search to the composer', () => {
    expect(body()).toMatch(/flow-prompt-box, flow-base-prompt-box/);
  });

  it('looks inside mat-icon, which is what Angular renders', () => {
    /* The old list was i.google-symbols / i.material-icons only. The new page
       writes <mat-icon class="mat-icon notranslate google-symbols">add. */
    expect(body()).toMatch(/mat-icon/);
  });

  it('still handles the old site, which has not stopped resolving', () => {
    expect(body()).toMatch(/'add_2'/);
    expect(body()).toMatch(/aria-haspopup="dialog"/);
  });

  it('carries no control character in any anchor', () => {
    /* Written three times in this project with a literal backspace where a
       word boundary was meant — a regex that compiles and matches nothing. */
    // eslint-disable-next-line no-control-regex
    expect(SELECTORS).not.toMatch(/[\x00-\x08\x0b\x0c\x0e-\x1f]/);
  });
});
