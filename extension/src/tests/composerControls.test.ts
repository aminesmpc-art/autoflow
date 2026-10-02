/**
 * @jest-environment jsdom
 *
 * The composer controls on the Angular Flow, carried over from the sibling
 * extension where they were found on the live page.
 *
 * ── The creation type was never switched ─────────────────────────────────
 *
 * Ingredients and Frames are a Material button-toggle group:
 *
 *   <mat-button-toggle class="… mat-button-toggle-checked">
 *     <button class="mat-button-toggle-button" role="radio" aria-checked="true">
 *       <span class="toggle-label">
 *         <mat-icon class="google-symbols">chrome_extension</mat-icon>
 *         <span class="toggle-text">Ingrédients</span>
 *
 * findModeButton looked at button[role="tab"], [role="menuitem"],
 * [role="menuitemradio"], [role="option"] and [data-radix-collection-item].
 * role="radio" is in none of them, so it returned null for BOTH options, the
 * composer stayed on whatever it was, and everything downstream went looking
 * for controls the page had never rendered.
 *
 * ── The translations overlap, in opposite directions ─────────────────────
 *
 * FLOW_STRINGS.frames contains 'Images', because on a French interface that
 * IS the Frames tab. On an English one "Images" would be the OTHER toggle. A
 * loose contains-match therefore picks the wrong control in one language or
 * the other, clicks it, and reports the mode switched.
 *
 * ── And the click read as failed when it had worked ──────────────────────
 *
 * A button-toggle marks itself with aria-checked and a class on its wrapper,
 * and sets data-state on neither.
 */

import { findModeButton, findFrameButton, labelText, isTabActive } from '../content/selectors';

/* jsdom lays nothing out, and isVisible measures a box — without this every
   element reads as hidden, for a reason unrelated to what is being tested. */
const realRect = Element.prototype.getBoundingClientRect;
beforeAll(() => {
  Element.prototype.getBoundingClientRect = function () {
    return { width: 90, height: 36, top: 0, left: 0, right: 90, bottom: 36, x: 0, y: 0,
      toJSON: () => ({}) } as DOMRect;
  };
});
afterAll(() => { Element.prototype.getBoundingClientRect = realRect; });

/** The real group, in the language this user's interface is in. */
const FRENCH_TOGGLES = `
  <mat-button-toggle-group role="radiogroup">
    <mat-button-toggle class="mat-button-toggle toggle flex-toggle mat-button-toggle-checked">
      <button class="mat-button-toggle-button" role="radio" aria-checked="true">
        <span class="mat-button-toggle-label-content"><span class="toggle-label">
          <mat-icon class="mat-icon notranslate flow-icon-m google-symbols">chrome_extension</mat-icon>
          <span class="toggle-text">Ingrédients</span>
        </span></span>
      </button>
    </mat-button-toggle>
    <mat-button-toggle class="mat-button-toggle toggle flex-toggle">
      <button class="mat-button-toggle-button" role="radio" aria-checked="false">
        <span class="mat-button-toggle-label-content"><span class="toggle-label">
          <mat-icon class="mat-icon notranslate flow-icon-m google-symbols">crop_free</mat-icon>
          <span class="toggle-text">Images</span>
        </span></span>
      </button>
    </mat-button-toggle>
  </mat-button-toggle-group>`;

const ENGLISH_TOGGLES = FRENCH_TOGGLES
  .replace('Ingrédients', 'Ingredients')
  .replace('>Images<', '>Frames<');

describe('switching the creation type', () => {
  it('finds the toggle at all', () => {
    document.body.innerHTML = FRENCH_TOGGLES;
    expect(findModeButton('Frames')).not.toBeNull();
    expect(findModeButton('Ingredients')).not.toBeNull();
  });

  it('picks Images for Frames on a French interface', () => {
    document.body.innerHTML = FRENCH_TOGGLES;
    expect(labelText(findModeButton('Frames')!)).toContain('Images');
  });

  it('picks Ingrédients for Ingredients on the same interface', () => {
    /* Getting Frames right by making Ingredients wrong would be no better. */
    document.body.innerHTML = FRENCH_TOGGLES;
    expect(labelText(findModeButton('Ingredients')!)).toContain('Ingrédients');
  });

  it('still picks Frames for Frames in English, where Images is the other one', () => {
    document.body.innerHTML = ENGLISH_TOGGLES;
    expect(labelText(findModeButton('Frames')!)).toContain('Frames');
  });

  it('reads the label without the icon ligature fused onto it', () => {
    /* The ligature is a text node in the same span: raw textContent gives
       "chrome_extensionIngrédients", which matches neither word. */
    document.body.innerHTML = FRENCH_TOGGLES;
    expect(labelText(findModeButton('Ingredients')!)).not.toContain('chrome_extension');
  });

  it('knows which one is already chosen', () => {
    document.body.innerHTML = FRENCH_TOGGLES;
    expect(isTabActive(findModeButton('Ingredients')!)).toBe(true);
    expect(isTabActive(findModeButton('Frames')!)).toBe(false);
  });
});

describe('the Start and End frame slots', () => {
  const SLOTS = `
    <div class="ingredient-bar-container">
      <div cdkoverlayorigin class="frame-trigger"><button class="empty-chip"> Début </button></div>
      <button aria-label="Intervertir les première et dernière images">
        <mat-icon>swap_horiz</mat-icon>
      </button>
      <div cdkoverlayorigin class="frame-trigger"><button class="empty-chip"> Fin </button></div>
    </div>`;

  it('finds both, in order', () => {
    document.body.innerHTML = SLOTS;
    expect(findFrameButton('Start')!.textContent).toContain('Début');
    expect(findFrameButton('End')!.textContent).toContain('Fin');
  });

  it('does not depend on the words, which are translated', () => {
    /* The tiers below this one compare against the literal strings "Start"
       and "End". This interface says neither. */
    document.body.innerHTML = SLOTS
      .replace('Début', 'Inicio')
      .replace('Fin', 'Final');
    expect(findFrameButton('Start')!.textContent).toContain('Inicio');
    expect(findFrameButton('End')!.textContent).toContain('Final');
  });

  it('does not mistake the swap button between them for a slot', () => {
    document.body.innerHTML = SLOTS;
    expect(findFrameButton('End')!.textContent).not.toContain('swap_horiz');
  });

  it('finds nothing when the composer is not in frames mode', () => {
    /* No slots rendered is the normal state in ingredients mode, and must
       not resolve to some other element that happens to be nearby. */
    document.body.innerHTML = '<div class="ingredient-bar-container"></div>';
    expect(findFrameButton('Start')).toBeNull();
  });
});
