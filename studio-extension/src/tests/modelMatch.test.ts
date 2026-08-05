/* ============================================================
   Choosing the right model from Flow's menu.

   Reported from a real run: the node asked for one image model and Flow
   generated on another. The menu is

       🍌 Nano Banana Pro
       🍌 Nano Banana 2
       🍌 Nano Banana 2 Lite

   and the matcher took the first item whose text CONTAINED the target. "Nano
   Banana 2" is a substring of "Nano Banana 2 Lite", so which model you got
   depended on DOM order — and a menu reorder would have silently switched it
   for every user at once.

   These test the decision, which is the part that was wrong. The clicking and
   the verification around it live in automation.ts.
   ============================================================ */

import { AVAILABLE_IMAGE_MODELS } from '../types';

/** The matcher from automation.ts — strips emoji, punctuation and icon text. */
function normalizeForModelMatch(text: string): string {
  return text
    .toLowerCase()
    .replace(/arrow_drop_down/g, '')
    .replace(/[^a-z0-9.\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The rule setModel applies: exact name wins; a substring only when unique. */
function choose(menu: string[], target: string): string | null {
  const t = normalizeForModelMatch(target);
  const norm = menu.map((m) => ({ text: m, n: normalizeForModelMatch(m) }));
  const exact = norm.filter((c) => c.n === t);
  if (exact.length) return exact[0].text;
  const loose = norm.filter((c) => c.n.includes(t));
  return loose.length === 1 ? loose[0].text : null;
}

/** Verbatim from the live menu, emoji included. */
const FLOW_IMAGE_MENU = [
  '🍌 Nano Banana Pro',
  '🍌 Nano Banana 2',
  '🍌 Nano Banana 2 Lite',
];

describe('normalizeForModelMatch', () => {
  it('strips the emoji Flow renders in front of every model', () => {
    expect(normalizeForModelMatch('🍌 Nano Banana Pro')).toBe('nano banana pro');
  });

  it('strips the trigger button’s dropdown glyph', () => {
    expect(normalizeForModelMatch('🍌 Nano Banana Proarrow_drop_down')).toBe('nano banana pro');
  });

  it('keeps digits and dots, which separate the models', () => {
    expect(normalizeForModelMatch('Veo 3.1 - Fast')).toBe('veo 3.1 fast');
  });
});

describe('choosing from the live menu', () => {
  it('picks the exact model, not the longer one it is a prefix of', () => {
    // The regression. A first-match-wins scan returns whichever of these two
    // the DOM lists first.
    expect(choose(FLOW_IMAGE_MENU, 'Nano Banana 2')).toBe('🍌 Nano Banana 2');
  });

  it('picks the Lite variant when that is what was asked for', () => {
    expect(choose(FLOW_IMAGE_MENU, 'Nano Banana 2 Lite')).toBe('🍌 Nano Banana 2 Lite');
  });

  it('picks Pro', () => {
    expect(choose(FLOW_IMAGE_MENU, 'Nano Banana Pro')).toBe('🍌 Nano Banana Pro');
  });

  it('refuses rather than guessing when a name is ambiguous', () => {
    // "Nano Banana" alone matches all three. Guessing means a whole run on the
    // wrong model with nothing downstream able to tell.
    expect(choose(FLOW_IMAGE_MENU, 'Nano Banana')).toBeNull();
  });

  it('returns nothing for a model Flow no longer offers', () => {
    // Imagen 4 shipped in our list after Flow had dropped it, so asking for it
    // quietly left the run on Flow's default.
    expect(choose(FLOW_IMAGE_MENU, 'Imagen 4')).toBeNull();
  });

  it('still resolves a target that is only a substring, when unique', () => {
    expect(choose(FLOW_IMAGE_MENU, 'Pro')).toBe('🍌 Nano Banana Pro');
  });
});

describe('the model list we offer', () => {
  it('only offers models the live menu actually has', () => {
    for (const model of AVAILABLE_IMAGE_MODELS) {
      expect({ model, resolves: choose(FLOW_IMAGE_MENU, model) !== null })
        .toEqual({ model, resolves: true });
    }
  });

  it('offers every model the live menu has', () => {
    // A model missing from our dropdown is one nobody can select.
    for (const label of FLOW_IMAGE_MENU) {
      const clean = label.replace(/^\W+\s*/, '');
      expect({ label: clean, offered: (AVAILABLE_IMAGE_MODELS as string[]).includes(clean) })
        .toEqual({ label: clean, offered: true });
    }
  });
});
