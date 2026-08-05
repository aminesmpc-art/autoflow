/**
 * @jest-environment jsdom
 */

/* ============================================================
   Finding Flow's model menu, and not finding something else.

   From a real run's log:

       [INFO] Found 18 model menu items
       [WARN] Model "Nano Banana 2" not found in menu

   Flow's model menu has three items. Eighteen was the settings panel — its
   Image/Video tabs, five ratio tabs and x1-x4 tabs all carry
   data-radix-collection-item. The old code fell back to a global query for
   those, got 18 hits, concluded the menu was open, and never escalated past
   its first click. The model dropdown had never opened at all, and every
   later "fix" was aimed at the wrong half of the problem.

   Radix binds a menu to its trigger: the button has an id, the menu has
   aria-labelledby pointing at it. That association is exact.
   ============================================================ */

/* jsdom ships no CSS.escape. It matters here rather than being incidental:
   Radix ids look like "radix-:ri2:", and an unescaped colon in a selector is
   a pseudo-class — `#radix-:ri2:` is a syntax error, not a miss. */
if (!(globalThis as any).CSS?.escape) {
  (globalThis as any).CSS = {
    ...(globalThis as any).CSS,
    // fromCharCode(92) rather than a literal: a lone backslash at the end of
    // a template literal escapes the closing backtick.
    escape: (v: string) =>
      String(v).replace(/[^a-zA-Z0-9_-]/g, (c) => String.fromCharCode(92) + c),
  };
}

const box = (w: number, h: number) => () =>
  ({ width: w, height: h, top: 0, left: 0, bottom: h, right: w, x: 0, y: 0, toJSON() {} });

function sizeAll(root: ParentNode): void {
  for (const el of Array.from(root.querySelectorAll<HTMLElement>('*'))) {
    (el as any).getBoundingClientRect = box(220, 34);
  }
}

/** The settings panel, shaped like the live one — tabs and all. */
function mountSettingsPanel(triggerId: string): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = `
    <div role="menu" data-radix-menu-content id="settings-menu">
      <div role="tablist">
        <button role="tab" id="r1-trigger-IMAGE" data-radix-collection-item aria-selected="true">Image</button>
        <button role="tab" id="r1-trigger-VIDEO" data-radix-collection-item aria-selected="false">Video</button>
      </div>
      <div role="tablist">
        <button role="tab" id="r2-trigger-LANDSCAPE" data-radix-collection-item>16:9</button>
        <button role="tab" id="r2-trigger-LANDSCAPE_4_3" data-radix-collection-item>4:3</button>
        <button role="tab" id="r2-trigger-SQUARE" data-radix-collection-item>1:1</button>
        <button role="tab" id="r2-trigger-PORTRAIT_3_4" data-radix-collection-item>3:4</button>
        <button role="tab" id="r2-trigger-PORTRAIT" data-radix-collection-item>9:16</button>
      </div>
      <button type="button" id="${triggerId}" aria-haspopup="menu" aria-expanded="false" data-state="closed">
        🍌 Nano Banana Pro<i>arrow_drop_down</i>
      </button>
      <div role="tablist">
        <button role="tab" id="r3-trigger-1" data-radix-collection-item aria-selected="true">x1</button>
        <button role="tab" id="r3-trigger-2" data-radix-collection-item>x2</button>
        <button role="tab" id="r3-trigger-3" data-radix-collection-item>x3</button>
        <button role="tab" id="r3-trigger-4" data-radix-collection-item>x4</button>
      </div>
    </div>`;
  document.body.append(host);
  sizeAll(host);
  return host.querySelector(`#${CSS.escape(triggerId)}`) as HTMLElement;
}

/** The model sub-menu Radix mounts when the trigger is clicked. */
function mountModelMenu(triggerId: string): void {
  const host = document.createElement('div');
  host.innerHTML = `
    <div role="menu" data-radix-menu-content id="model-menu" aria-labelledby="${triggerId}">
      ${['🍌 Nano Banana Pro', '🍌 Nano Banana 2', '🍌 Nano Banana 2 Lite'].map((m) => `
        <div role="menuitem" data-radix-collection-item>
          <div><button><div><div><span>${m}</span></div></div></button></div>
        </div>`).join('')}
    </div>`;
  document.body.append(host);
  sizeAll(host);
}

/** The lookup setModel performs. Mirrors modelMenuFor in automation.ts. */
function modelMenuFor(trigger: Element): Element | null {
  const id = trigger.getAttribute('id');
  if (id) {
    const bound = document.querySelector(`[role="menu"][aria-labelledby="${CSS.escape(id)}"]`);
    return bound || null;
  }
  const menus = Array.from(document.querySelectorAll('[role="menu"], [data-radix-menu-content]'));
  for (const menu of menus.reverse()) {
    if (menu === trigger.closest('[role="menu"]')) continue;
    const items = menu.querySelectorAll('[role="menuitem"], [role="menuitemradio"], [role="option"]');
    if (items.length && items.length <= 12) return menu;
  }
  return null;
}

const optionsFor = (trigger: Element): Element[] => {
  const menu = modelMenuFor(trigger);
  return menu
    ? Array.from(menu.querySelectorAll('[role="menuitem"], [role="menuitemradio"], [role="option"], [data-radix-collection-item]'))
    : [];
};

beforeEach(() => { document.body.innerHTML = ''; });

/* The trigger has to be found before its menu can be. Both the model button
   and the composer settings chip carry aria-haspopup="menu"; the chip's text
   is "🍌 Nano Banana Pro" plus a ratio glyph plus "x1", the model button's is
   a model name alone. Matching on "contains a model name" picked the chip,
   and the menu bound to the chip is the settings panel — which is why the log
   reported 11 options, the exact number of tabs in it. */
describe('telling the model button from the settings chip', () => {
  const KNOWN = ['Nano Banana Pro', 'Nano Banana 2', 'Nano Banana 2 Lite'];
  const norm = (t: string) =>
    t.toLowerCase().replace(/arrow_drop_down/g, '').replace(/[^a-z0-9.\s]/g, ' ')
      .replace(/\s+/g, ' ').trim();
  const isModelButton = (el: Element) => {
    const text = norm(el.textContent || '');
    return !!text && KNOWN.some((m) => norm(m) === text);
  };

  it('rejects the composer chip, which summarises everything', () => {
    const chip = document.createElement('button');
    chip.setAttribute('aria-haspopup', 'menu');
    chip.textContent = '🍌 Nano Banana Procrop_squarex1';
    expect(isModelButton(chip)).toBe(false);
  });

  it('accepts the model button, whose text is the model alone', () => {
    const btn = document.createElement('button');
    btn.setAttribute('aria-haspopup', 'menu');
    btn.textContent = '🍌 Nano Banana Proarrow_drop_down';
    expect(isModelButton(btn)).toBe(true);
  });

  /* The fallback path, reached when Flow shows a model we do not know yet.
     Its old chip guard demanded a count AND the word "video" or "image" — but
     in image mode the ratio is a crop_square glyph, so the word is never
     there and the chip sailed through. */
  const looksLikeSummaryChip = (t: string) =>
    /x\s?\d/.test(t) || /crop_/.test(t) || /\d+:\d+/.test(t);

  it('excludes the composer chip in every mode Flow renders it', () => {
    for (const chip of [
      // Both taken from a live page, glyph text and all.
      '🍌 nano banana 2 litecrop_squarex1',
      '🍌 nano banana procrop_9_16x1',
      // Ratio written out rather than drawn, in case Flow ever does that.
      'omni flash 9:16 x2',
    ]) {
      expect({ chip, excluded: looksLikeSummaryChip(chip) })
        .toEqual({ chip, excluded: true });
    }
  });

  it('does not exclude the model button itself', () => {
    expect(looksLikeSummaryChip('🍌 nano banana proarrow_drop_down')).toBe(false);
    expect(looksLikeSummaryChip('veo 3.1 fast')).toBe(false);
  });

  it('accepts every model we offer', () => {
    for (const m of KNOWN) {
      const btn = document.createElement('button');
      btn.textContent = `🍌 ${m}arrow_drop_down`;
      expect({ model: m, matched: isModelButton(btn) }).toEqual({ model: m, matched: true });
    }
  });
});

describe('finding the model menu', () => {
  it('finds nothing while the menu is closed', () => {
    const trigger = mountSettingsPanel('radix-r1e7');
    /* The regression, exactly. The settings panel alone offers 11
       data-radix-collection-item elements; the old code counted those as
       model options and stopped trying to open anything. */
    expect(document.querySelectorAll('[data-radix-collection-item]').length).toBeGreaterThan(10);
    expect(optionsFor(trigger)).toHaveLength(0);
  });

  it('finds exactly the three models once the menu opens', () => {
    const trigger = mountSettingsPanel('radix-r1e7');
    mountModelMenu('radix-r1e7');
    expect(optionsFor(trigger)).toHaveLength(3);
  });

  it('reads the model names, not the ratio and count tabs', () => {
    const trigger = mountSettingsPanel('radix-r1e7');
    mountModelMenu('radix-r1e7');
    const names = optionsFor(trigger).map((i) => (i.textContent || '').trim());
    expect(names).toEqual(['🍌 Nano Banana Pro', '🍌 Nano Banana 2', '🍌 Nano Banana 2 Lite']);
  });

  it('ignores a menu bound to some other trigger', () => {
    // Two dropdowns open at once must not borrow each other's items.
    const trigger = mountSettingsPanel('radix-r1e7');
    mountModelMenu('radix-SOMETHING-ELSE');
    expect(modelMenuFor(trigger)).toBeNull();
  });

  it('handles the colons in a real Radix id', () => {
    // "radix-:ri2:" unescaped reads as a pseudo-class and throws.
    const trigger = mountSettingsPanel('radix-:ri2:');
    mountModelMenu('radix-:ri2:');
    expect(optionsFor(trigger)).toHaveLength(3);
  });

  it('still copes when the trigger carries no id', () => {
    const trigger = mountSettingsPanel('radix-r1e7');
    trigger.removeAttribute('id');
    mountModelMenu('radix-r1e7');
    // Falls back to "a small menu that is not the settings menu".
    expect(optionsFor(trigger)).toHaveLength(3);
  });
});
