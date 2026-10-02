/**
 * @jest-environment jsdom
 */

/**
 * Finding the "+" that attaches ingredients, on the Flow that exists now.
 *
 * Everything below was read off a live signed-in project. The page has TWO
 * buttons carrying an "add" ligature, and the old code picked the wrong one:
 *
 *   aria-label="Add media menu"                  flow-tile-view-header   1218,18  40x40
 *   aria-label="Add ingredients to the prompt box"  flow-add-menu        484,958  32x32
 *
 * The second is the composer's "+". The first is an unrelated control in the
 * page header. Measured on that page:
 *
 *   buttons with an "add_2" ligature      0    what strategy 1 looked for
 *   buttons with aria-haspopup="dialog"   0    what strategy 2 needed
 *   [role="dialog"] elements              0    what the dialog finder wanted
 *
 * So the first two tiers matched nothing and the last-resort tier — any "add"
 * icon in document order — returned the header button. Every existing
 * ingredient chip also carries an "add" hover overlay, so which element won
 * depended on document order rather than on anything meaningful.
 *
 * The label cannot be the anchor: it is translated. On a French account the
 * same button reads "Ajouter des ingredients au champ du prompt". The
 * component name, flow-add-menu, is not translated.
 */

import { findIngredientAttachButton } from '../content/flow/selectors';

/** jsdom gives everything a zero-sized rect, and isVisible rejects those. */
function makeVisible(el: Element): void {
  (el as HTMLElement).getBoundingClientRect = () =>
    ({ width: 32, height: 32, top: 0, left: 0, right: 32, bottom: 32, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);
}

function visibleAll(selector: string): void {
  document.querySelectorAll(selector).forEach(makeVisible);
}

/** The page header's add button — first in document order, as on the real page. */
const HEADER = `
  <flow-tile-view-header>
    <button aria-label="Add media menu" class="mdc-icon-button">
      <mat-icon class="mat-icon notranslate google-symbols">add</mat-icon>
    </button>
  </flow-tile-view-header>`;

/** An attached ingredient, whose hover overlay also carries an "add" icon. */
const CHIP = `
  <flow-ingredient-chip><flow-image-ingredient-chip>
    <button aria-label="Ingredient">
      <div class="hover-icon-overlay">add</div>
      <mat-icon class="mat-icon notranslate hover-icon google-symbols">add</mat-icon>
    </button>
  </flow-image-ingredient-chip></flow-ingredient-chip>`;

/** The composer's "+", nested as the live page nests it. */
const COMPOSER = `
  <flow-prompt-box><flow-prompt-box-instruction-card-wrapper><flow-base-prompt-box>
    <flow-add-menu>
      <button aria-label="Add ingredients to the prompt box">
        <mat-icon class="mat-icon notranslate google-symbols">add</mat-icon>
      </button>
    </flow-add-menu>
  </flow-base-prompt-box></flow-prompt-box-instruction-card-wrapper></flow-prompt-box>`;

describe('the composer add button on the new Flow', () => {
  it('is found even though the header button comes first in the document', () => {
    document.body.innerHTML = HEADER + COMPOSER;
    visibleAll('button');
    const btn = findIngredientAttachButton();
    expect(btn).not.toBeNull();
    expect(btn!.getAttribute('aria-label')).toBe('Add ingredients to the prompt box');
    expect(btn!.closest('flow-add-menu')).not.toBeNull();
  });

  it('never returns the page header control', () => {
    /* This is the regression: a 40x40 button at the top of the page, nothing
       to do with attaching an ingredient. Clicking it opened the wrong menu. */
    document.body.innerHTML = HEADER + COMPOSER;
    visibleAll('button');
    expect(findIngredientAttachButton()!.closest('flow-tile-view-header')).toBeNull();
  });

  it('is not confused by ingredients already attached', () => {
    document.body.innerHTML = HEADER + CHIP + CHIP + COMPOSER;
    visibleAll('button');
    const btn = findIngredientAttachButton();
    expect(btn!.closest('flow-ingredient-chip, flow-image-ingredient-chip')).toBeNull();
    expect(btn!.closest('flow-add-menu')).not.toBeNull();
  });

  it('does not depend on the label, which is translated', () => {
    /* Same markup, French account. Anchoring on the English aria-label would
       pass every test here and fail on the user's actual machine. */
    document.body.innerHTML = (HEADER + COMPOSER)
      .replace('Add ingredients to the prompt box', 'Ajouter des ingredients au champ du prompt')
      .replace('Add media menu', 'Menu Ajouter un media');
    visibleAll('button');
    expect(findIngredientAttachButton()!.closest('flow-add-menu')).not.toBeNull();
  });

  it('finds nothing rather than something wrong when there is no composer', () => {
    /* With only the header present, returning its button would be worse than
       returning null — the caller would click an unrelated control. */
    document.body.innerHTML = HEADER;
    visibleAll('button');
    expect(findIngredientAttachButton()).toBeNull();
  });

  it('skips a hidden add menu', () => {
    document.body.innerHTML = COMPOSER;
    // nothing made visible — every rect is 0x0
    expect(findIngredientAttachButton()).toBeNull();
  });
});

describe('the old Flow, which still resolves', () => {
  it('still finds the add_2 ligature button', () => {
    /* The previous site wrote the ligature add_2 and had no flow- components.
       That path has to keep working for anyone still on labs.google. */
    document.body.innerHTML = `
      <div id="__next">
        <button aria-haspopup="dialog">
          <i class="google-symbols">add_2</i>
        </button>
      </div>`;
    visibleAll('button');
    const btn = findIngredientAttachButton();
    expect(btn).not.toBeNull();
    expect(btn!.querySelector('i')!.textContent).toBe('add_2');
  });

  it('prefers the new component when both somehow exist', () => {
    document.body.innerHTML = `
      <button><i class="google-symbols">add_2</i></button>` + COMPOSER;
    visibleAll('button');
    expect(findIngredientAttachButton()!.closest('flow-add-menu')).not.toBeNull();
  });
});
