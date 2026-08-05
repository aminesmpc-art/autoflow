/* ============================================================
   AutoFlow – DOM Selectors for Google Flow UI
   Robust selectors using aria-labels, roles, visible text,
   and stable data-* attributes. Avoids brittle CSS paths.
   ============================================================ */
import { matchesFlowText, exactMatchFlowText } from './flowStrings';

/** Sleep helper */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Query by aria-label (partial match) */
export function queryByAriaLabel(label: string, root: Element | Document = document): Element | null {
  return root.querySelector(`[aria-label*="${CSS.escape(label)}"]`);
}

/** Query by role + text content */
export function queryByRoleAndText(role: string, text: string, root: Element | Document = document): Element | null {
  const elements = root.querySelectorAll(`[role="${role}"]`);
  for (const el of elements) {
    if (el.textContent?.trim().toLowerCase().includes(text.toLowerCase())) {
      return el;
    }
  }
  return null;
}

/** Query by visible button text */
export function queryButtonByText(text: string, root: Element | Document = document): Element | null {
  // Try button elements
  const buttons = root.querySelectorAll('button');
  for (const btn of buttons) {
    const btnText = btn.textContent?.trim().toLowerCase() || '';
    if (btnText === text.toLowerCase() || btnText.includes(text.toLowerCase())) {
      return btn;
    }
  }
  // Try elements with role=button
  const roleButtons = root.querySelectorAll('[role="button"]');
  for (const btn of roleButtons) {
    const btnText = btn.textContent?.trim().toLowerCase() || '';
    if (btnText === text.toLowerCase() || btnText.includes(text.toLowerCase())) {
      return btn;
    }
  }
  return null;
}

/** Query by data attribute */
export function queryByDataAttr(attr: string, value: string, root: Element | Document = document): Element | null {
  return root.querySelector(`[data-${attr}="${value}"]`);
}

/** Query all by visible text within a tag */
export function queryAllByText(tag: string, text: string, root: Element | Document = document): Element[] {
  const elements = root.querySelectorAll(tag);
  const matches: Element[] = [];
  for (const el of elements) {
    if (el.textContent?.trim().toLowerCase().includes(text.toLowerCase())) {
      matches.push(el);
    }
  }
  return matches;
}

/** Find a menu item by text in any visible menu/dropdown */
export function findMenuItem(text: string): Element | null {
  // Try standard menu roles
  const menuItems = document.querySelectorAll('[role="menuitem"], [role="option"], [role="listbox"] [role="option"]');
  for (const item of menuItems) {
    if (item.textContent?.trim().toLowerCase().includes(text.toLowerCase())) {
      return item;
    }
  }
  // Try mat-menu-item or similar
  const matItems = document.querySelectorAll('mat-option, .mat-menu-item, .mdc-list-item');
  for (const item of matItems) {
    if (item.textContent?.trim().toLowerCase().includes(text.toLowerCase())) {
      return item;
    }
  }
  // Fallback: any clickable element with text
  const allClickable = document.querySelectorAll('a, button, [role="button"], [role="menuitem"], li');
  for (const el of allClickable) {
    if (el.textContent?.trim().toLowerCase() === text.toLowerCase()) {
      return el;
    }
  }
  return null;
}

/** Find the prompt textarea/input in Flow.
 *  Flow uses a Slate.js rich-text editor rendered as:
 *  <div data-slate-editor="true" role="textbox" contenteditable="true">
 */
export function findPromptInput(): HTMLTextAreaElement | HTMLInputElement | HTMLElement | null {
  // Priority 1: Slate.js editor (data-slate-editor attribute)
  const slateEditor = document.querySelector('div[data-slate-editor="true"]');
  if (slateEditor && isVisible(slateEditor)) return slateEditor as HTMLElement;

  // Priority 2: role="textbox" + contenteditable (Slate fallback)
  const roleTextboxes = document.querySelectorAll('[role="textbox"][contenteditable="true"]');
  for (const el of roleTextboxes) {
    if (isVisible(el)) return el as HTMLElement;
  }

  // Priority 3: textarea with prompt-related attributes
  const textareas = document.querySelectorAll('textarea');
  for (const ta of textareas) {
    const placeholder = (ta.placeholder || '').toLowerCase();
    const label = (ta.getAttribute('aria-label') || '').toLowerCase();
    if (
      matchesFlowText(placeholder, 'prompt') ||
      matchesFlowText(label, 'prompt')
    ) {
      return ta;
    }
  }

  // Priority 4: any contenteditable
  const editables = document.querySelectorAll('[contenteditable="true"]');
  for (const el of editables) {
    if (isVisible(el)) return el as HTMLElement;
  }

  // Priority 5: first visible textarea
  if (textareas.length > 0) return textareas[0];
  return null;
}

/** Find the Generate/Send button (the → arrow near the prompt).
 *  Flow's send button contains a Google Symbols icon with text "arrow_forward"
 *  and a hidden <span>Create</span>.  The "+" add button ALSO has that same
 *  hidden "Create" text but uses icon "add_2" and has aria-haspopup="dialog".
 *  We must differentiate the two.
 */
/**
 * Every plausible submit button, best guess first.
 *
 * findGenerateButton returns one and the caller commits to it. When Flow
 * redesigned its composer the icon-font match stopped matching — the submit
 * control is now a circular SVG arrow — so the search fell through to "last
 * button in the container" and clicked whatever that happened to be. Clicking
 * the wrong thing looks exactly like clicking nothing.
 *
 * Handing back a ranked list lets the caller click, check, and move on.
 */
export function findGenerateButtonCandidates(): Element[] {
  const out: Element[] = [];
  const add = (el: Element | null | undefined) => {
    if (el && isVisible(el) && !out.includes(el)) out.push(el);
  };

  const usable = Array.from(document.querySelectorAll('button')).filter(
    (b) => isVisible(b) && !b.getAttribute('aria-haspopup') && b.getAttribute('role') !== 'tab'
  );

  // 1. Icon font glyph — how Flow used to render it.
  for (const btn of usable) {
    const icons = btn.querySelectorAll('i.google-symbols, i.material-icons, i.material-symbols, .google-symbols');
    for (const icon of icons) {
      const name = (icon.textContent || '').trim().toLowerCase();
      if (name === 'arrow_forward' || name === 'send' || name === 'arrow_upward') add(btn);
    }
  }

  // 2. SVG arrow — how it renders now. Matched on the path data rather than a
  //    class, since utility classes change with every restyle.
  for (const btn of usable) {
    const svg = btn.querySelector('svg');
    if (!svg) continue;
    const label = (btn.getAttribute('aria-label') || '').toLowerCase();
    const d = Array.from(svg.querySelectorAll('path')).map((p) => p.getAttribute('d') || '').join(' ');
    const looksLikeArrow = /arrow|send|submit/.test(label) || /M[\d.\s]*[hl]/i.test(d);
    // An icon-only button sitting at the end of the composer with no text.
    if (looksLikeArrow && !(btn.textContent || '').trim()) add(btn);
  }

  // 3. Explicit labels, in the languages Flow ships.
  for (const btn of usable) {
    const label = (btn.getAttribute('aria-label') || '').toLowerCase();
    if (/send|generate|submit|run|envoyer|générer/.test(label)) add(btn);
  }

  // 4. Last resort: the final button in the prompt's container, which is what
  //    the old code always fell back to.
  const promptInput = findPromptInput();
  if (promptInput) {
    let container: HTMLElement | null = promptInput.parentElement;
    for (let i = 0; i < 5 && container; i++) container = container.parentElement;
    if (container) {
      const inside = usable.filter((b) => container!.contains(b));
      if (inside.length) add(inside[inside.length - 1]);
    }
  }

  return out;
}

/** Short description of a button, for logs that have to be read from a screenshot. */
export function describeButton(el: Element): string {
  const label = el.getAttribute('aria-label');
  const text = (el.textContent || '').trim().slice(0, 20);
  const icon = el.querySelector('i, svg')?.tagName?.toLowerCase();
  return [
    el.tagName.toLowerCase(),
    label ? `aria="${label}"` : null,
    text ? `text="${text}"` : null,
    icon ? `icon=${icon}` : null,
    (el as HTMLButtonElement).disabled ? 'disabled' : null,
  ].filter(Boolean).join(' ');
}

export function findGenerateButton(): Element | null {
  // Strategy 1: Find button containing the arrow_forward icon text
  const buttons = document.querySelectorAll('button');
  for (const btn of buttons) {
    // Skip the ingredient add button (has aria-haspopup="dialog")
    if (btn.getAttribute('aria-haspopup')) continue;
    // Check for Google Symbols icon with "arrow_forward"
    const icons = btn.querySelectorAll('i.google-symbols, i.material-icons, i.material-symbols, .google-symbols');
    for (const icon of icons) {
      const iconText = (icon.textContent || '').trim().toLowerCase();
      if (iconText === 'arrow_forward' || iconText === 'send' || iconText === 'arrow_upward') {
        if (isVisible(btn)) return btn;
      }
    }
  }

  // Strategy 2: Find the send button near the prompt that has NO aria-haspopup
  const promptInput = findPromptInput();
  if (promptInput) {
    // Walk up to the prompt container (sc-21faa80e-0 or similar)
    let container = promptInput.parentElement;
    for (let i = 0; i < 5 && container; i++) {
      container = container.parentElement;
    }
    if (container) {
      const btns = Array.from(container.querySelectorAll('button')).filter(b => {
        if (!isVisible(b)) return false;
        // Exclude buttons with aria-haspopup (settings trigger or add button)
        if (b.getAttribute('aria-haspopup')) return false;
        // Exclude tab buttons
        if (b.getAttribute('role') === 'tab') return false;
        return true;
      });
      // The send button is the last one (rightmost in the toolbar)
      if (btns.length > 0) return btns[btns.length - 1];
    }
  }

  // Strategy 3: aria-label fallback
  const ariaLabels = ['Send', 'Generate', 'submit', 'Run'];
  for (const label of ariaLabels) {
    const btns = document.querySelectorAll(`button[aria-label*="${label}"]`);
    for (const btn of btns) {
      if (isVisible(btn) && !btn.getAttribute('aria-haspopup')) return btn;
    }
  }
  return null;
}

/**
 * Find the model dropdown trigger.
 * In Flow this is a <button aria-haspopup="menu"> whose text
 * contains a model name like "Veo" or "Imagen", and which is
 * NOT the settings panel trigger (that one also has "Video"/"x1").
 */
/**
 * The model Flow is currently set to, readable whether or not a panel is open.
 *
 * Verification used to read the model dropdown's own trigger — which lives
 * inside the settings popover. Selecting a model closes that popover, so the
 * check ran against an element that no longer existed, read an empty string,
 * concluded the click had failed, and fired four more clicks at a detached
 * node.
 *
 * Flow also prints the selection in the composer bar ("🍌 Nano Banana Pro
 * x1"), which is always on screen. That is the durable source.
 */
export function readSelectedModel(knownModels: readonly string[]): string {
  // Panel open: its trigger is the most specific answer.
  const trigger = findModelSelectorTrigger();
  const fromTrigger = (trigger?.textContent || '').replace(/arrow_drop_down/g, '').trim();
  if (fromTrigger) return fromTrigger;

  /* Otherwise read the composer chip. Scoped away from open menus so a list
     of choices is never mistaken for the choice. */
  const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9.\s]/g, ' ').replace(/\s+/g, ' ').trim();
  const wanted = knownModels.map(norm);

  for (const el of document.querySelectorAll<HTMLElement>('button, span, div')) {
    if (el.children.length > 2) continue;            // containers, not labels
    if (el.closest('[role="menu"], [data-radix-menu-content]')) continue;
    if (!isVisible(el)) continue;
    const text = norm(el.textContent || '');
    if (text && wanted.includes(text)) return (el.textContent || '').trim();
  }
  return '';
}

/** Model names, for telling the model button apart from the settings chip. */
let knownModelNames: readonly string[] = [];
export function setKnownModelNames(names: readonly string[]): void {
  knownModelNames = names;
}

const normModel = (t: string) =>
  t.toLowerCase().replace(/arrow_drop_down/g, '').replace(/[^a-z0-9.\s]/g, ' ')
    .replace(/\s+/g, ' ').trim();

/**
 * The button that opens the model list — not the chip that opens the settings.
 *
 * Both carry aria-haspopup="menu". The composer chip summarises everything
 * ("🍌 Nano Banana Pro" + a ratio glyph + "x1"), while the model button's text
 * is a model name and nothing else. Matching on "contains a model name" picked
 * the chip, and the menu bound to the chip is the settings panel — which is
 * why the log kept reporting 11 options, the exact number of tabs in it.
 *
 * So: exact text match wins, and only then anything looser.
 */
function looksLikeModelButton(btn: Element): boolean {
  const text = normModel(btn.textContent || '');
  return !!text && knownModelNames.some((m) => normModel(m) === text);
}

export function findModelSelectorTrigger(): Element | null {
  const all = Array.from(document.querySelectorAll('button[aria-haspopup="menu"]'))
    .filter(isVisible);

  // Exact model-name text, anywhere — this is the model button by definition.
  const exact = all.find(looksLikeModelButton);
  if (exact) return exact;

  // Primary: a nested aria-haspopup button inside an open menu. Scoped to the
  // menu that actually contains one, rather than whichever menu is first in
  // the document.
  for (const menuContainer of document.querySelectorAll('[role="menu"], [data-radix-menu-content]')) {
    for (const btn of menuContainer.querySelectorAll('button[aria-haspopup="menu"]')) {
      if (isVisible(btn)) return btn;
    }
  }

  /* Last resort: a button whose text mentions a model family. Only reached
     when the exact match failed, which means Flow is showing a model we do
     not know about yet.

     The composer chip must still be excluded here. Its text is the whole
     summary — "🍌 Nano Banana Pro" + a ratio glyph + "x1" — and clicking it
     toggles the settings panel rather than opening the model list, which is
     the open-and-close cycle this bug looked like from outside.

     The old guard demanded BOTH a count and the word "video" or "image". In
     image mode the ratio renders as a crop_square glyph, so the word is never
     there and the chip sailed through. A trailing count is enough on its own:
     a model button never carries one. */
  const looksLikeSummaryChip = (text: string) =>
    /x\s?\d/.test(text) || /crop_/.test(text) || /\d+:\d+/.test(text);

  for (const btn of document.querySelectorAll('button[aria-haspopup="menu"]')) {
    const text = (btn.textContent || '').toLowerCase();
    const namesAFamily =
      text.includes('veo') || text.includes('imagen') ||
      text.includes('banana') || text.includes('omni');
    if (namesAFamily && isVisible(btn) && !looksLikeSummaryChip(text)) return btn;
  }
  return null;
}

/** Find mode selector tabs (Create Image, Video Ingredients, etc.) */
export function findModeTab(modeText: string): Element | null {
  // Try tabs
  const tabs = document.querySelectorAll('[role="tab"]');
  for (const tab of tabs) {
    if (tab.textContent?.trim().toLowerCase().includes(modeText.toLowerCase())) {
      return tab;
    }
  }
  // Try buttons that look like mode selectors
  const btns = document.querySelectorAll('button, [role="button"]');
  for (const btn of btns) {
    const text = btn.textContent?.trim().toLowerCase() || '';
    if (text.includes(modeText.toLowerCase())) {
      return btn;
    }
  }
  return null;
}

/** Find the "More" menu button on an asset card */
export function findMoreMenuOnAsset(assetElement: Element): Element | null {
  const moreBtn = assetElement.querySelector('[aria-label*="More"], [aria-label*="more"], [aria-label*="Plus"], [aria-label*="plus"], [aria-label*="Más"], [aria-label*="Mehr"], button[aria-label*="menu"]');
  if (moreBtn) return moreBtn;
  // Try three-dot icon buttons
  const iconBtns = assetElement.querySelectorAll('button, [role="button"]');
  for (const btn of iconBtns) {
    const text = (btn.textContent || '').trim();
    if (text === '⋮' || text === '...' || text === 'more_vert') {
      return btn;
    }
  }
  return null;
}

/** Find all asset cards in the output/gallery grid.
 *  In Flow, each tile is <div data-tile-id="fe_id_..."> inside
 *  a virtuoso scroller: div[data-testid="virtuoso-item-list"].
 */
export function findAssetCards(): Element[] {
  // Primary: history steps in the detail view. We prioritize these because
  // when the detail view is open, the background grid tiles often stop receiving React updates.
  const historySteps = document.querySelectorAll('div[id^="history-step-fe_id_"]');
  const tiles = document.querySelectorAll('div[data-tile-id]');
  
  if (tiles.length > 0 || historySteps.length > 0) {
     return [...Array.from(historySteps), ...Array.from(tiles)];
  }

  // Secondary: individual tiles inside virtuoso scroller rows.
  // Flow structure: virtuoso-item-list > div[data-index] (ROW) > div (flex container) > div (individual tile)
  // We need the individual tiles, NOT the rows.
  const virtuosoRows = document.querySelectorAll('[data-testid="virtuoso-item-list"] > div[data-index]');
  if (virtuosoRows.length > 0) {
    const individualTiles: Element[] = [];
    for (const row of virtuosoRows) {
      // The row has a single child: the flex container
      const flexContainer = row.firstElementChild;
      if (flexContainer && flexContainer.children.length > 0) {
        // Each child of the flex container is an individual video/image tile
        for (const tile of Array.from(flexContainer.children)) {
          if (isVisible(tile)) individualTiles.push(tile);
        }
      } else {
        // Fallback: treat the row itself as a tile
        if (isVisible(row)) individualTiles.push(row);
      }
    }
    if (individualTiles.length > 0) return individualTiles;
  }

  // Tertiary: try common patterns for asset grids
  const selectors = [
    '[role="listitem"]',
    '[role="gridcell"]',
    '.asset-card',
    '[data-asset-id]',
    '.output-card',
    '.gallery-item',
  ];
  for (const sel of selectors) {
    const cards = document.querySelectorAll(sel);
    if (cards.length > 0) return Array.from(cards);
  }

  // Broad fallback: look for video elements or thumbnails in a grid
  const containers = document.querySelectorAll('[role="grid"], [role="list"], .gallery, .outputs');
  for (const container of containers) {
    const children = container.children;
    if (children.length > 0) return Array.from(children);
  }
  return [];
}

/** Find the prompt input specifically for the Extend phase */
export function findExtendPromptInput(): HTMLElement | null {
  // Primary: Slate editor that has "What happens next?" text nearby.
  const slateEditors = document.querySelectorAll('div[data-slate-editor="true"]');
  for (const slate of slateEditors) {
    if (!isVisible(slate)) continue;
    let container = slate.parentElement;
    for (let i = 0; i < 5 && container; i++) {
      if (matchesFlowText(container.textContent?.toLowerCase() || '', 'whatHappensNext')) {
        return slate as HTMLElement;
      }
      container = container.parentElement;
    }
  }

  // Fallback: return the first visible slate editor that is NOT the main prompt box.
  for (const slate of slateEditors) {
    if (!isVisible(slate)) continue;
    let container = slate.parentElement;
    let isMain = false;
    for (let i = 0; i < 5 && container; i++) {
      if (matchesFlowText(container.textContent?.toLowerCase() || '', 'whatDoYouWantToCreate')) {
        isMain = true;
        break;
      }
      container = container.parentElement;
    }
    if (!isMain) return slate as HTMLElement;
  }

  // Absolute fallback: return the first visible one
  for (const slate of slateEditors) {
    if (isVisible(slate)) return slate as HTMLElement;
  }

  return null;
}

/** Find the model selector specifically inside the Extend phase prompt area */
export function findExtendModelSelectorTrigger(): Element | null {
  const input = findExtendPromptInput();
  if (input) {
    let container = input.parentElement;
    for (let i = 0; i < 4 && container; i++) {
      container = container.parentElement;
    }
    if (container) {
      const btns = container.querySelectorAll('button[aria-haspopup="menu"]');
      for (const btn of btns) {
        if (isVisible(btn)) return btn;
      }
    }
  }
  return null;
}

/** Find the generate/send arrow specifically for the Extend phase */
export function findExtendGenerateButton(): Element | null {
  const modelTrigger = findExtendModelSelectorTrigger();
  if (modelTrigger) {
    // The generate button is normally exactly next to the model selector in the Extend prompt box
    if (modelTrigger.nextElementSibling && modelTrigger.nextElementSibling.tagName === 'BUTTON') {
      return modelTrigger.nextElementSibling;
    }
    // Alternatively, find the next button in the same parent
    if (modelTrigger.parentElement) {
      const btns = Array.from(modelTrigger.parentElement.querySelectorAll('button'));
      const triggerIdx = btns.indexOf(modelTrigger as HTMLButtonElement);
      if (triggerIdx >= 0 && triggerIdx + 1 < btns.length) {
        return btns[triggerIdx + 1];
      }
    }
  }

  // Fallback: look near the input, but limit traversal so we don't accidentally grab the Camera pill button
  const input = findExtendPromptInput();
  if (input) {
    let container = input.parentElement;
    for (let i = 0; i < 4 && container; i++) {
      container = container.parentElement;
    }
    if (container) {
      const btns = container.querySelectorAll('button');
      // Return the right-most arrow-like button, avoiding "Camera" or "Insert" pills
      for (const btn of Array.from(btns).reverse()) {
        const text = btn.textContent?.toLowerCase() || '';
        if (!text.includes('camera') && !text.includes('insert') && !text.includes('remove') && !text.includes('extend')) {
          if (isVisible(btn)) return btn;
        }
      }
    }
  }
  return null;
}

/** Find the "Start" or "End" frame button in Frames mode.
 *  In Flow's Frames creation mode, the UI shows two div-buttons
 *  (div[type="button"][aria-haspopup="dialog"]) labeled "Start" and "End"
 *  instead of the "+" ingredient button.
 *  Each is a 50×50 square with text "Start" or "End" inside.
 *  If an image is already attached, the text changes. We match by relative index
 *  excluding the "+" (Create) ingredient button and menus.
 */
export function findFrameButton(label: 'Start' | 'End'): Element | null {
  // Strategy 0: Search near the prompt input area to locate both slots relatively
  const promptInput = findPromptInput();
  if (promptInput) {
    let outerContainer = promptInput.parentElement;
    for (let i = 0; i < 8 && outerContainer; i++) {
      if (outerContainer.textContent?.includes('End') || outerContainer.querySelector('img')) {
        break;
      }
      outerContainer = outerContainer.parentElement;
    }

    if (outerContainer) {
      const candidates = Array.from(outerContainer.querySelectorAll('div, button, [role="button"]')).filter(el => {
        if (!isVisible(el)) return false;
        // Exclude prompt input itself and its descendants
        if (promptInput.contains(el) || el === promptInput) return false;

        const text = (el.textContent || '').trim();
        if (text.includes('Create') || text === 'Agent' || text === '⇆') return false;
        if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') return false;

        // A candidate is a slot if its text is "Start" or "End", or it contains an img/video
        const isSlot = text === 'Start' || text === 'End' || el.querySelector('img, video') !== null;
        return isSlot;
      });

      // Filter to keep only the leaf-most candidate slot wrappers
      const slots = candidates.filter(c => {
        return !candidates.some(other => other !== c && c.contains(other));
      });

      if (slots.length >= 2) {
        return label === 'Start' ? slots[0] : slots[1];
      }
    }
  }

  // Strategy 1: div with type="button" and aria-haspopup="dialog" containing exact text
  const divButtons = document.querySelectorAll('div[type="button"][aria-haspopup="dialog"]');
  for (const div of divButtons) {
    const text = (div.textContent || '').trim();
    if (text === label && isVisible(div)) return div;
  }

  // Strategy 2: Any element with aria-haspopup="dialog" containing exact text
  const haspopup = document.querySelectorAll('[aria-haspopup="dialog"]');
  for (const el of haspopup) {
    const text = (el.textContent || '').trim();
    if (text === label && isVisible(el)) return el;
  }

  return null;
}


/** Find the "+" ingredient attachment button near the prompt.
 *  In Flow this is <button aria-haspopup="dialog"> containing a
 *  Google Symbols icon with text "add_2" and a hidden <span>Create</span>.
 */
export function findIngredientAttachButton(): Element | null {
  // Strategy 1 (BEST): button containing Google Symbols icon with "add_2"
  // This is the most specific selector — the actual "+" ingredient button always has this icon.
  const buttons = document.querySelectorAll('button');
  for (const btn of buttons) {
    const icons = btn.querySelectorAll('i.google-symbols, i.material-icons, .google-symbols');
    for (const icon of icons) {
      const iconText = (icon.textContent || '').trim().toLowerCase();
      if (iconText === 'add_2') {
        if (isVisible(btn)) return btn;
      }
    }
  }

  // Strategy 2: button with aria-haspopup="dialog" AND add icon near the prompt
  const promptArea = findPromptInput();
  if (promptArea) {
    let container = promptArea.parentElement;
    for (let i = 0; i < 5 && container; i++) {
      container = container.parentElement;
    }
    if (container) {
      const dialogBtns = container.querySelectorAll('button[aria-haspopup="dialog"]');
      for (const btn of dialogBtns) {
        if (!isVisible(btn)) continue;
        // Only return if it has an "add" icon (avoid returning wrong button)
        const icons = btn.querySelectorAll('i.google-symbols, i.material-icons, .google-symbols');
        for (const icon of icons) {
          const iconText = (icon.textContent || '').trim().toLowerCase();
          if (iconText === 'add_2' || iconText === 'add') return btn;
        }
      }
    }
  }

  // Strategy 3: button with "add" icon anywhere
  for (const btn of buttons) {
    const icons = btn.querySelectorAll('i.google-symbols, i.material-icons, .google-symbols');
    for (const icon of icons) {
      const iconText = (icon.textContent || '').trim().toLowerCase();
      if (iconText === 'add') {
        if (isVisible(btn)) return btn;
      }
    }
  }

  return null;
}

/** Find the "Search for Assets" dialog that appears when clicking "+".
 *  This is a Radix dialog/popover containing:
 *  - A search input (placeholder: "Search for Assets")
 *  - A "Recently Used" dropdown
 *  - A list of asset results (clickable to add as ingredient)
 */
export function findAssetSearchDialog(): Element | null {
  // Helper: check if a container has a search input (any language)
  const hasSearchInput = (el: Element) => {
    const inputs = el.querySelectorAll('input');
    for (const input of inputs) {
      const placeholder = input.getAttribute('placeholder') || '';
      if (matchesFlowText(placeholder, 'search')) return true;
    }
    return false;
  };

  // Primary: Find the Radix dialog (role="dialog") with a search input
  const dialogs = document.querySelectorAll('[role="dialog"]');
  for (const dialog of dialogs) {
    if (!isVisible(dialog)) continue;
    if (hasSearchInput(dialog)) return dialog;
  }

  // Fallback 1: data-radix-popper-content-wrapper with a search input
  const wrappers = document.querySelectorAll('[data-radix-popper-content-wrapper]');
  for (const wrapper of wrappers) {
    if (!isVisible(wrapper)) continue;
    if (hasSearchInput(wrapper)) return wrapper;
  }

  // Fallback 2: any visible popover/overlay with a search input
  const popovers = document.querySelectorAll(
    '[class*="popover"], [class*="modal"], [class*="overlay"], [class*="dialog"]'
  );
  for (const p of popovers) {
    if (!isVisible(p)) continue;
    if (hasSearchInput(p)) return p;
  }

  return null;
}

/** Find the search input inside the "Search for Assets" dialog (any language) */
export function findAssetSearchInput(dialog: Element): HTMLInputElement | null {
  // Look for input with a search-related placeholder in any supported language
  const inputs = dialog.querySelectorAll('input');
  for (const input of inputs) {
    const placeholder = input.getAttribute('placeholder') || '';
    if (matchesFlowText(placeholder, 'search')) {
      return input as HTMLInputElement;
    }
  }
  // Fallback: any visible text input in the dialog
  for (const input of dialog.querySelectorAll('input[type="text"], input:not([type])')) {
    if (isVisible(input)) return input as HTMLInputElement;
  }
  return null;
}

/** Find clickable asset results inside the "Search for Assets" dialog.
 *  Each result is a div row with a thumbnail image and filename text,
 *  rendered inside a virtuoso virtual scroll list.
 *
 *  Real DOM structure (from whenimageuploaded.html):
 *    div[data-testid="virtuoso-item-list"]
 *      └── div[data-index="0"][data-item-index="0"]
 *            └── div.sc-dbfb6b4a-11  ← clickable result row
 *                  ├── img[src*="media.getMediaUrlRedirect"][alt="filename.jpeg"]
 *                  └── div.sc-dbfb6b4a-16  → "filename.jpeg"
 */
export function findAssetResults(dialog: Element): Element[] {
  const results: Element[] = [];

  // Strategy 1 (primary): Find rows inside virtuoso-item-list within the dialog.
  // Each data-item-index wrapper contains a div child that is the clickable row.
  const virtuosoItems = dialog.querySelectorAll(
    '[data-testid="virtuoso-item-list"] > div[data-item-index]'
  );
  for (const wrapper of virtuosoItems) {
    // The actual result row is the first child div with an img inside
    const row = wrapper.querySelector('div');
    if (row && isVisible(row) && row.querySelector('img')) {
      results.push(row);
    }
  }
  if (results.length > 0) return results;

  // Strategy 2: Find any div that contains both an img[src*="media.getMediaUrlRedirect"]
  // and filename text, within the dialog (not the header/toolbar area).
  const allImgs = dialog.querySelectorAll('img[src*="media.getMediaUrlRedirect"]');
  for (const img of allImgs) {
    const parent = img.parentElement;
    if (!parent || !isVisible(parent)) continue;
    // Skip very large elements (preview images vs thumbnail rows)
    const rect = parent.getBoundingClientRect();
    if (rect.height > 0 && rect.height < 120) {
      results.push(parent);
    }
  }
  if (results.length > 0) return results;

  // Strategy 3: Look for buttons, role="option", role="listitem" etc (legacy fallback)
  const clickables = dialog.querySelectorAll(
    'button, [role="button"], [role="option"], [role="listitem"], ' +
    '[role="menuitem"], [data-radix-collection-item]'
  );
  for (const el of clickables) {
    if (!isVisible(el)) continue;
    if (el.tagName === 'INPUT') continue;
    const text = (el.textContent || '').trim();
    if (text === 'Recently Used' || text === 'Close' || text === '' ||
      text === 'Upload image') continue;
    if (el.querySelector('img') || text.length > 2) {
      results.push(el);
    }
  }

  return results;
}

/** Find Flow's own file input element (for programmatic file upload).
 *  Skips our injected af-bot-* inputs to avoid confusion.
 *  Flow's native input has a styled-component class like sc-a40aa0db-0.
 */
/**
 * Flow's "not enough credits" notice, if it is on screen.
 *
 * Worth its own detector because of what it costs to miss. Flow accepts the
 * click, shows this, and never creates a tile — so the poller waits out its
 * full budget (22 minutes for video) for something that was refused in the
 * first second, then the runner moves to the next node and does it again.
 * An overnight queue can spend hours discovering the same fact repeatedly.
 *
 * Two signals required, because either alone is a false positive waiting to
 * happen: the word for credits appears in ordinary billing UI all over the
 * page, and an upgrade button sits in Flow's chrome permanently. Only a
 * visible element carrying both, small enough to be a notice rather than the
 * page, counts.
 */
/* ── Start / End frame slots ──────────────────────────────────
   Flow's video composer offers two drop targets rather than a list:

     <div type="button" aria-haspopup="dialog" aria-controls="radix-:r69:"
          data-state="closed">Start</div>
     <button/>                                    ← swap
     <div type="button" aria-haspopup="dialog" aria-controls="radix-:r6a:"
          data-state="closed">End</div>

   Note they are DIVs with type="button", not buttons — a querySelector for
   'button' misses them entirely. Each opens a dialog; the image goes in
   there, not into the prompt box. Pasting into the prompt attaches an
   ingredient instead, which is what Studio was doing: the slots stayed empty
   and Flow generated from a reference rather than interpolating.

   Found by position rather than by the words "Start" and "End", which are
   translated. They are the only two dialog triggers in the composer and they
   are always in that order — the swap button between them exists precisely
   because the order is meaningful.
   ──────────────────────────────────────────────────────────── */

export interface FrameSlots {
  start: HTMLElement;
  end: HTMLElement;
}

export function findFrameSlots(): FrameSlots | null {
  const triggers = Array.from(
    document.querySelectorAll<HTMLElement>('[aria-haspopup="dialog"]')
  ).filter(isVisible);
  if (triggers.length < 2) return null;

  /* Prefer the labelled pair when the UI is in a language we know; fall back
     to the first two, which is what the order guarantees. */
  const byText = (word: RegExp) =>
    triggers.find((t) => word.test((t.textContent || '').trim()));
  const start = byText(/^start$/i) || triggers[0];
  const end = byText(/^end$/i) || triggers[1];
  return start && end && start !== end ? { start, end } : null;
}

/**
 * True once a slot is holding an image rather than showing its placeholder.
 *
 * Checks both ways a thumbnail can be drawn. An <img> is the obvious one, but
 * a slot that renders it as a CSS background-image has no <img> at all — and
 * looking only for the element meant the slot filled on screen while the wait
 * loop sat there for its full 45 seconds and then called it a failure.
 *
 * Both branches require an actual image source. Loosening this to "the
 * placeholder text went away" would be worse than the original bug: it would
 * report filled before the bytes arrived, and the second paste would race
 * into a slot still settling.
 */
export function frameSlotFilled(slot: HTMLElement): boolean {
  for (const img of slot.querySelectorAll('img')) {
    if (img.complete && img.naturalWidth > 0) return true;
  }
  for (const el of [slot, ...Array.from(slot.querySelectorAll<HTMLElement>('*'))]) {
    const bg = getComputedStyle(el).backgroundImage;
    // "none" when unset; a real thumbnail is a url(...) or a data: URI.
    if (bg && bg !== 'none' && /url\(|data:/.test(bg)) return true;
  }
  return false;
}

/** What a slot looks like right now, for when it will not fill. */
export function describeFrameSlot(slot: HTMLElement): string {
  const imgs = slot.querySelectorAll('img').length;
  const loaded = Array.from(slot.querySelectorAll('img'))
    .filter((i) => i.complete && i.naturalWidth > 0).length;
  /* Same test frameSlotFilled uses, not `!== 'none'`. An unstyled element
     reports an empty string, which read as "background set" and would have
     pointed the next investigation at a thumbnail that was never there. */
  const bg = getComputedStyle(slot).backgroundImage;
  const hasBg = !!bg && bg !== 'none' && /url\(|data:/.test(bg);
  const text = (slot.textContent || '').trim().slice(0, 24);
  return `text="${text}" imgs=${imgs} loaded=${loaded} bg=${hasBg ? 'set' : 'none'}`;
}

/* ── Attached reference images ────────────────────────────────
   Flow shows each attached ingredient as a chip in the prompt bar:

     <button data-card-open="false" data-state="closed">
       <div><img src="/fx/api/trpc/media.getMediaUrlRedirect?name=..."
                 crossorigin="anonymous" style="opacity: 1;"></div>
       <div><i class="google-symbols">cancel</i></div>   ← remove
     </button>

   Uploading used to be followed by `await sleep(8000)` and an unconditional
   "uploaded successfully". On a slow upload the prompt was typed and Generate
   clicked while the chip was still arriving, so Flow generated from the text
   alone — the reference silently dropped, the clip subtly wrong, and the run
   green throughout.

   Identified by the pair of things no other element on the page has together:
   a media URL and a remove button. Grid tiles use the same URL shape, so the
   cancel glyph is what separates "attached to this prompt" from "exists in
   your library".
   ──────────────────────────────────────────────────────────── */

/** Reference chips currently attached to the prompt bar. */
export function findAttachedIngredients(): HTMLElement[] {
  const chips: HTMLElement[] = [];
  for (const btn of document.querySelectorAll<HTMLElement>('button')) {
    const img = btn.querySelector('img[src*="getMediaUrlRedirect"]');
    if (!img) continue;
    // The remove control is what makes it an attachment rather than a tile.
    const removable = Array.from(btn.querySelectorAll('i')).some(
      (i) => (i.textContent || '').trim().toLowerCase() === 'cancel'
    );
    if (removable && isVisible(btn)) chips.push(btn);
  }
  return chips;
}

/**
 * Chips whose image has actually arrived.
 *
 * A chip appears the instant the upload starts, so counting chips alone still
 * races the upload. Flow fades each one in with `opacity: 1` once it has
 * loaded, and the element's own `complete`/`naturalWidth` say the same thing
 * without depending on a style Flow could restyle tomorrow.
 */
export function findLoadedIngredients(): HTMLElement[] {
  return findAttachedIngredients().filter((chip) => {
    const img = chip.querySelector<HTMLImageElement>('img[src*="getMediaUrlRedirect"]');
    return !!img && img.complete && img.naturalWidth > 0;
  });
}

/**
 * Wait until `expected` references are attached and loaded.
 *
 * Returns true only on evidence. A timeout returns false and the caller
 * decides — which beats the old behaviour of sleeping a fixed 8 seconds and
 * announcing success either way.
 */
export async function waitForIngredients(
  expected: number,
  timeoutMs = 45_000
): Promise<boolean> {
  if (expected <= 0) return true;
  const deadline = Date.now() + timeoutMs;
  let stable = 0;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 500));
    if (findLoadedIngredients().length >= expected) {
      // Two consecutive clean reads: an upload finishing between polls would
      // otherwise let a half-attached set through.
      if (++stable >= 2) return true;
    } else {
      stable = 0;
    }
  }
  return false;
}

/* ── Generation rows ──────────────────────────────────────────
   Every row in Flow's grid carries its own prompt, model, ratio and duration
   in the same block as its media. That makes "is this tile mine?" a question
   with an actual answer, where before the poller guessed: if nothing had ever
   looked like it was generating, it fell back to the newest card on the page
   and reported whatever that was. If the submit had silently failed, the node
   confidently returned the previous node's clip — or a video the user made
   yesterday — and the run went green.

   Anchored on `button.reuse-prompt-button`, the one class in that subtree
   that is a name rather than a styled-components hash. Everything else there
   (sc-7f95703a-1, iEkYZi) changes on any rebuild of Flow.
   ──────────────────────────────────────────────────────────── */

export interface FlowGenerationRow {
  tileId: string;
  /** The prompt text Flow shows under the media — what identifies the row. */
  prompt: string;
  model: string;
  aspectRatio: string;
  /** e.g. "6s", read from "Video length: 6s" */
  duration: string;
  element: HTMLElement;
}

/** Collapse whitespace so DOM wrapping does not defeat comparison. */
const normalisePrompt = (s: string): string =>
  (s || '').replace(/\s+/g, ' ').trim().toLowerCase();

export function readGenerationRows(): FlowGenerationRow[] {
  const rows: FlowGenerationRow[] = [];

  for (const btn of document.querySelectorAll<HTMLElement>('button.reuse-prompt-button')) {
    // <wrapper><div>PROMPT</div><div><button.reuse-prompt-button/></div></wrapper>
    const wrapper = btn.parentElement?.parentElement;
    const prompt = (wrapper?.firstElementChild as HTMLElement | null)?.textContent?.trim() || '';
    if (!prompt) continue;

    // The row is the nearest ancestor that also owns the media.
    let row: HTMLElement | null = wrapper as HTMLElement | null;
    let tile: Element | null = null;
    for (let depth = 0; depth < 8 && row; depth++, row = row.parentElement) {
      tile = row.querySelector('[data-tile-id]');
      if (tile) break;
    }
    if (!row || !tile) continue;

    /* Metadata lines are plain divs with no stable class, so they are read by
       what they say rather than where they sit — Flow reorders them, and
       "Resolution: 720p" is recognisable wherever it lands. */
    const lines = Array.from(row.querySelectorAll<HTMLElement>('div'))
      // Leaf by div, not by child count: the ratio line holds an icon glyph
      // as well as its text, and skipping it lost the ratio entirely.
      .filter((d) => !d.querySelector('div'))
      .map((d) => (d.textContent || '').trim())
      .filter(Boolean);

    // The glyph's ligature runs into the value — "crop_9_16" + "9:16" reads as
    // "crop_9_169:16" — so the ratio is taken from the end of the line.
    const ratio = lines
      .map((l) => l.match(/(\d{1,2}:\d{1,2})\s*$/)?.[1])
      .find(Boolean) || '';

    rows.push({
      tileId: tile.getAttribute('data-tile-id') || '',
      prompt,
      model: lines.find((l) => /flash|veo|imagen|banana/i.test(l)) || '',
      aspectRatio: ratio,
      duration: (lines.find((l) => /length/i.test(l)) || '').replace(/^[^:]*:\s*/, ''),
      element: row,
    });
  }
  return rows;
}

/**
 * The row Flow created for this exact prompt, if there is one.
 *
 * Absence is the useful answer: it means our submit never landed, which is
 * worth failing on rather than papering over with somebody else's tile.
 */
export function findRowForPrompt(prompt: string): FlowGenerationRow | null {
  const want = normalisePrompt(prompt);
  if (want.length < 8) return null; // too short to identify anything

  const rows = readGenerationRows();
  const exact = rows.find((r) => normalisePrompt(r.prompt) === want);
  if (exact) return exact;

  /* Flow can trim trailing whitespace, collapse newlines, or clip a very long
     prompt in the card. A long shared opening is still conclusive — two
     different prompts agreeing on their first 80 characters would have to be
     deliberate. */
  const head = want.slice(0, 80);
  if (head.length < 40) return null;
  return rows.find((r) => {
    const got = normalisePrompt(r.prompt);
    return got.startsWith(head) || want.startsWith(got.slice(0, 80));
  }) || null;
}

/**
 * The orange alert sphere Flow puts beside the generation settings.
 *
 * This is the signal that actually exists while a run is happening. The
 * message explaining it lives in a popover that is `data-state="closed"`
 * until someone hovers the icon — closed Radix popovers render no content at
 * all, so a detector that only reads the message finds nothing, ever, during
 * automation. Nobody hovers anything during a run.
 *
 * Matched on the icon's own filename rather than a class, because every class
 * on it is a generated styled-components hash that changes on any rebuild.
 */
export function findFlowAlertIndicator(): HTMLElement | null {
  const icon = document.querySelector<HTMLElement>('img[src*="flow_alert"]');
  if (!icon || !isVisible(icon)) return null;
  // The wrapper is what carries the popover trigger; the img ignores clicks.
  return (icon.closest('[data-state]') as HTMLElement) || icon.parentElement || icon;
}

/**
 * Open the alert popover and read what it says.
 *
 * The sphere alone means "Flow is unhappy about something", which is not the
 * same as "out of credits" — acting on the icon alone would abort runs over
 * unrelated warnings. Opening it costs one click on an info button and turns a
 * guess into the actual sentence.
 */
export async function readFlowAlertMessage(): Promise<string> {
  const trigger = findFlowAlertIndicator();
  if (!trigger) return '';

  const alreadyOpen = trigger.getAttribute('data-state') === 'open';
  if (!alreadyOpen) {
    // Hover first: Flow's is a hover-card, and a click alone may not open it.
    for (const type of ['pointerover', 'mouseover', 'pointerenter', 'mouseenter']) {
      trigger.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));
    }
    (trigger as HTMLElement).click?.();
    await new Promise((r) => setTimeout(r, 400));
  }

  // The popover mounts elsewhere in the DOM, so read the page's open overlays
  // rather than looking inside the trigger.
  let text = '';
  for (const el of document.querySelectorAll<HTMLElement>('[data-state="open"], [role="tooltip"], [role="dialog"]')) {
    if (!isVisible(el) || el === trigger) continue;
    const t = (el.innerText || el.textContent || '').trim();
    if (t.length > text.length) text = t;
  }

  if (!alreadyOpen) {
    // Leave the page as we found it — an open overlay swallows the next click.
    for (const type of ['pointerout', 'mouseout', 'pointerleave', 'mouseleave']) {
      trigger.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));
    }
  }
  return text;
}

/** True when a message is Flow saying the account has no credits left. */
export function readsAsCreditsExhausted(text: string): boolean {
  if (!text || !matchesFlowText(text, 'credits')) return false;
  // "1,240 credits remaining" also mentions credits. A refusal is a sentence,
  // and in every language Flow ships it offers the upgrade in the same breath.
  return matchesFlowText(text, 'upgrade') || text.trim().length >= 25;
}

export function findCreditsExhaustedNotice(): HTMLElement | null {
  /* Anchored on the Upgrade button and walked upward, rather than queried by
     role. Flow's notice is a popover with no role we can rely on — guessing at
     one would make this silently stop working the next time the component
     changes, which is the failure mode it exists to prevent. Every version of
     this notice has an upgrade button in it. */
  const buttons = Array.from(document.querySelectorAll<HTMLElement>('button, a'))
    .filter((b) => matchesFlowText(b.innerText || b.textContent || '', 'upgrade'));

  for (const btn of buttons) {
    let el: HTMLElement | null = btn.parentElement;
    for (let depth = 0; depth < 5 && el; depth++, el = el.parentElement) {
      if (!isVisible(el)) continue;

      // A notice, not the whole app. The one in the report is ~220x160; a
      // pricing page mentions credits and upgrading too, and matching it
      // would abort a run that was working.
      const rect = el.getBoundingClientRect();
      if (rect.height > 420 || rect.width > 620) continue;

      const text = (el.innerText || el.textContent || '').trim();
      if (!matchesFlowText(text, 'credits')) continue;

      /* Third signal, because a persistent header chip reading
         "1,240 credits · Upgrade" satisfies both of the others. A refusal is
         a sentence, and it carries an error glyph; a balance is neither.
         The glyph is checked first since it survives translation, and the
         length test covers a notice rendered with an SVG icon instead. */
      const hasErrorGlyph = Array.from(el.querySelectorAll('*')).some((n) => {
        const t = (n.textContent || '').trim().toLowerCase();
        return t === 'error' || t === 'error_outline' || t === 'warning' || t === 'report';
      });
      /* Measured on the message, not the whole notice. Button labels are the
         one part guaranteed present in both a refusal and a balance chip, so
         counting them makes a chip with a wordy CTA look like a sentence. */
      const stripped = el.cloneNode(true) as HTMLElement;
      for (const cta of Array.from(stripped.querySelectorAll('button, a'))) cta.remove();
      const message = (stripped.textContent || '').trim();

      /* A refusal is a sentence; a balance is a number and a noun. The
         thresholds only have to separate those two, so they sit well below
         the shortest real refusal (~35 Latin, ~25 CJK) and well above the
         longest plausible balance ("1,240 credits" is 13).

         Character counts are not comparable across scripts — the same message
         is ~130 characters in English and under 30 in Japanese — so one
         threshold would either miss every CJK notice or match a Latin chip.

         Erring toward detection on purpose. A false negative is the bug this
         exists to fix: 22 minutes per node, silently. A false positive stops
         the run with a message saying exactly why, and costs one rerun. */
      const dense = /[　-鿿가-힯]/.test(message);
      if (hasErrorGlyph || message.length >= (dense ? 14 : 25)) return el;
    }
  }
  return null;
}

export function findFileInput(): HTMLInputElement | null {
  // Priority 1: Flow's file input accepting images (has SC class, no af-bot id)
  const imgInputs = document.querySelectorAll('input[type="file"][accept*="image"]');
  for (const input of imgInputs) {
    const el = input as HTMLInputElement;
    if (el.id && el.id.startsWith('af-bot-')) continue;
    return el;
  }
  // Priority 2: Any file input that isn't ours
  const allInputs = document.querySelectorAll('input[type="file"]');
  for (const input of allInputs) {
    const el = input as HTMLInputElement;
    if (el.id && el.id.startsWith('af-bot-')) continue;
    return el;
  }
  return null;
}

/** Trigger a file input's change handler via multiple methods.
 *  React uses synthetic events so native dispatches may not
 *  reach the component — we try React props, React fiber,
 *  and native events for maximum compatibility.
 */
export function triggerFileInputChange(fileInput: HTMLInputElement): void {
  // Method 1: Direct React onChange via __reactProps$
  const propsKey = Object.keys(fileInput).find(k => k.startsWith('__reactProps$'));
  if (propsKey) {
    const props = (fileInput as any)[propsKey];
    if (props?.onChange && typeof props.onChange === 'function') {
      try {
        props.onChange({
          target: fileInput,
          currentTarget: fileInput,
          type: 'change',
          bubbles: true,
          preventDefault: () => { },
          stopPropagation: () => { },
          isPropagationStopped: () => false,
          isDefaultPrevented: () => false,
          persist: () => { },
          nativeEvent: new Event('change', { bubbles: true }),
        });
      } catch { /* swallow */ }
    }
  }

  // Method 2: Walk up React fiber tree to find onChange on a parent
  const fiberKey = Object.keys(fileInput).find(k => k.startsWith('__reactFiber$'));
  if (fiberKey) {
    let fiber: any = (fileInput as any)[fiberKey];
    for (let i = 0; i < 15 && fiber; i++) {
      if (fiber.memoizedProps?.onChange && typeof fiber.memoizedProps.onChange === 'function') {
        try {
          fiber.memoizedProps.onChange({
            target: fileInput,
            currentTarget: fileInput,
            type: 'change',
            bubbles: true,
            preventDefault: () => { },
            stopPropagation: () => { },
            persist: () => { },
          });
        } catch { /* swallow */ }
        break;
      }
      fiber = fiber.return;
    }
  }

  // Method 3: Native DOM events (may reach React 16 document-level delegation)
  fileInput.dispatchEvent(new Event('change', { bubbles: true }));
  fileInput.dispatchEvent(new Event('input', { bubbles: true }));
}

// ── Tile state detection ────────────────────────────────────
// Flow DOM (from live inspection):
//   div[data-tile-id="fe_id_..."]        ← the tile root
//     └─ span[data-state="closed"]
//          └─ div                         ← content container
//               └─ div style="--blur-amount: 80px"  ← generating placeholder
//                    └─ "16%"             ← progress text overlay
//   When complete: play_arrow button or <video>/<img> appears, blur removed.
// ────────────────────────────────────────────────────────────

export type TileState = 'generating' | 'completed' | 'failed' | 'empty' | 'unknown';

/**
 * Determine the state of a single tile element.
 *
 * @returns
 *  - `'generating'` — tile has blur placeholder, progress %, or loading spinner
 *  - `'completed'`  — tile has playable video / visible image / play button
 *  - `'failed'`     — tile has error/warning icon or error overlay
 *  - `'empty'`      — tile exists but has no content yet
 *  - `'unknown'`    — cannot determine
 */
export function getTileState(tile: Element): TileState {
  const icons = tile.querySelectorAll('.google-symbols, .material-icons, .material-symbols-outlined, .material-symbols, i.google-symbols, i.material-icons, i.material-symbols-outlined');
  const tileTextRaw = tile.textContent?.toLowerCase() || '';

  // ── Signal 4: error/warning/failure icons → FAILED ──
  // NOTE: 'cancel' icon is NOT a failure — it appears on generating tiles
  // as the "stop generation" button. Only true error icons trigger failure.
  for (const icon of icons) {
    const txt = icon.textContent?.trim() || '';
    if (txt === 'error' || txt === 'error_outline' || txt === 'warning' ||
      txt === 'report' || txt === 'report_problem' ||
      txt === 'block' || txt === 'dangerous') {
      // Make sure this isn't the ingredient chip cancel icon
      const parent = icon.closest('[data-card-open]');
      if (!parent) return 'failed';
    }
  }

  // ── Signal 5: error text overlay ("failed", "error", "violated", "cancelled") ──
  if (tileTextRaw.includes('generation failed') || tileTextRaw.includes('violate') ||
    matchesFlowText(tileTextRaw, 'tryAgain') || tileTextRaw.includes('unable to generate') ||
    tileTextRaw.includes('blocked') ||
    matchesFlowText(tileTextRaw, 'generationCancelled') ||
    matchesFlowText(tileTextRaw, 'generationFailed')) {
    return 'failed';
  }

  // ── Signal 1: `--blur-amount` inline style on any descendant ──
  // Flow sets --blur-amount: 80px on a div inside generating tiles.
  // Only non-zero values indicate generation in progress.
  const blurEls = tile.querySelectorAll('[style*="blur-amount"]');
  for (const el of blurEls) {
    const val = (el as HTMLElement).style.getPropertyValue('--blur-amount');
    if (val) {
      const blur = parseFloat(val);
      if (blur > 0) return 'generating';
    }
  }

  // ── Signal 2: percentage text overlay (e.g. "16%", "73%", "99%") ──
  const walker = document.createTreeWalker(tile, NodeFilter.SHOW_TEXT);
  let textNode: Text | null;
  while ((textNode = walker.nextNode() as Text | null)) {
    const t = textNode.textContent?.trim() || '';
    if (/^\d{1,3}%$/.test(t)) return 'generating';
  }

  // ── Signal 2.5: detail view history sidebar generating text ──
  // When chaining extensions, the detail view history sidebar shows a grey box with:
  // "generation. You can update your settings..."
  if (tileTextRaw.includes('generation.') && tileTextRaw.includes('update your settings')) {
    return 'generating';
  }
  if (tileTextRaw.includes('queued') || tileTextRaw.includes('preparing') || tileTextRaw.includes('creating video') || tileTextRaw.includes('almost finished') || tileTextRaw.includes('is preparing')) {
    return 'generating';
  }

  // ── Signal 3: loading spinner / circular progress indicator ──
  // Flow may use a material icon 'progress_activity' or a CSS spinner
  for (const icon of icons) {
    const txt = icon.textContent?.trim() || '';
    if (txt === 'progress_activity' || txt === 'hourglass_empty' || txt === 'pending') {
      return 'generating';
    }
  }

  // ── Signal 6: play button (play_arrow / play_circle icon) = completed video ──
  for (const icon of icons) {
    const txt = icon.textContent?.trim() || '';
    if (txt === 'play_arrow' || txt === 'play_circle' || txt === 'play_circle_filled' ||
      txt === 'play_circle_outline') {
      return 'completed';
    }
  }
  // Also check non-icon buttons
  const buttons = tile.querySelectorAll('button, [role="button"]');
  for (const btn of buttons) {
    const txt = btn.textContent?.trim() || '';
    if (txt === '▶' || txt === 'play_arrow' || txt === 'play_circle') return 'completed';
  }

  // ── Signal 7: <video> with src = completed video ──
  const video = tile.querySelector('video');
  if (video && (video.src || video.querySelector('source[src]') || video.getAttribute('poster'))) {
    return 'completed';
  }

  // ── Signal 8: <img> with a real src (not data: placeholder) = completed image ──
  const imgs = tile.querySelectorAll('img[src]');
  for (const img of imgs) {
    if (!isVisible(img)) continue;
    const src = img.getAttribute('src') || '';
    // Skip tiny tracking pixels or data URIs that might be placeholders
    if (src.startsWith('data:') && src.length < 200) continue;
    return 'completed';
  }

  // ── Signal 9: background-image on inner div (thumbnail) ──
  const innerDivs = tile.querySelectorAll('div');
  for (const div of innerDivs) {
    const bg = window.getComputedStyle(div).backgroundImage;
    if (bg && bg !== 'none' && bg.includes('url(')) return 'completed';
  }

  // ── Signal 10: opacity on descendant divs that suggest loading ──
  // Some tiles have a loading state with opacity < 1 but no blur.
  // Walk the first few child divs and check computed opacity.
  const childDivs = tile.querySelectorAll(':scope > span > div > div, :scope > div > div');
  for (const cd of childDivs) {
    const op = window.getComputedStyle(cd).opacity;
    if (op && parseFloat(op) < 0.5 && parseFloat(op) > 0) {
      return 'generating';
    }
  }

  // Tile exists in DOM (data-tile-id present) but no content signals → empty
  if ((tile as HTMLElement).dataset?.tileId) return 'empty';
  // Also check descendant for data-tile-id
  if (tile.querySelector('[data-tile-id]')) return 'empty';

  return 'unknown';
}

/**
 * Snapshot of all tile states — used for change detection.
 */
export interface TileSnapshot {
  /** Total visible tile count */
  total: number;
  /** Number of tiles currently generating */
  generating: number;
  /** Number of tiles with finished media */
  completed: number;
  /** Number of tiles that failed */
  failed: number;
  /** Number of empty placeholders */
  empty: number;
  /** Comma-joined list of tile IDs (data-tile-id values) */
  tileIds: string;
}

/**
 * Capture a detailed snapshot of all visible tiles and their states.
 */
export function snapshotTiles(): TileSnapshot {
  const cards = findAssetCards().filter(el => isVisible(el));
  let generating = 0;
  let completed = 0;
  let failed = 0;
  let empty = 0;
  const ids: string[] = [];

  for (const card of cards) {
    const state = getTileState(card);
    if (state === 'generating') generating++;
    else if (state === 'completed') completed++;
    else if (state === 'failed') failed++;
    else empty++;

    // Collect tile ID
    const tileId = findTileId(card);
    if (tileId) ids.push(tileId);
  }

  return {
    total: cards.length,
    generating,
    completed,
    failed,
    empty,
    tileIds: ids.join(','),
  };
}

/**
 * Find the data-tile-id on or within a tile element.
 */
function findTileId(el: Element): string {
  // Direct attribute
  const directId = (el as HTMLElement).dataset?.tileId;
  if (directId) return directId;
  // Child with data-tile-id
  const child = el.querySelector('[data-tile-id]');
  if (child) return (child as HTMLElement).dataset?.tileId || '';
  // Fallback to data-index
  return (el as HTMLElement).dataset?.index || '';
}

/** Check if generation is in progress.
 *  Uses tile-level state detection (blur, progress %) and Flow status text.
 */
export function isGenerating(): boolean {
  // Check 1: Any tile in 'generating' state (blur or progress %)
  const snap = snapshotTiles();
  if (snap.generating > 0) return true;

  // Check 2: Flow-specific status text
  const flowStatuses = ['is preparing', 'creating video', 'almost finished'];
  for (const status of flowStatuses) {
    const els = queryAllByText('*', status);
    for (const el of els) {
      if (isVisible(el)) return true;
    }
  }

  return false;
}

/**
 * Check if any output tile shows a progress percentage overlay (e.g. "15%")
 * or has blur placeholder (--blur-amount).
 */
export function tilesHaveProgress(): boolean {
  const snap = snapshotTiles();
  return snap.generating > 0;
}

/**
 * Check if a tile has finished media content (video, image, or play button).
 */
export function tileHasMedia(tile: Element): boolean {
  return getTileState(tile) === 'completed';
}

/**
 * Check if the generate button is currently enabled (ready for new generation).
 * After generation completes, the button re-enables.
 */
export function isGenerateButtonEnabled(): boolean {
  const btn = findGenerateButton();
  if (!btn) return false;
  const htmlBtn = btn as HTMLButtonElement;
  if (htmlBtn.disabled) return false;
  if (htmlBtn.getAttribute('aria-disabled') === 'true') return false;
  return true;
}

/** Check if an element is visible */
export function isVisible(el: Element): boolean {
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return false;
  const style = window.getComputedStyle(el);
  return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
}

/** Simulate a click using the full pointer→mouse→click event chain.
 *  Uses coordinate jitter for natural input pacing.
 *  Does NOT also call native .click() — that would double-fire on
 *  Radix toggle buttons (open → close = net no change).
 */
export function simulateClick(el: Element): void {
  if (el instanceof HTMLElement) el.focus();
  const rect = el.getBoundingClientRect();
  // ±2px coordinate jitter for natural input variation
  const x = rect.left + rect.width / 2 + (Math.random() * 4 - 2);
  const y = rect.top + rect.height / 2 + (Math.random() * 4 - 2);
  const shared: MouseEventInit = {
    bubbles: true, cancelable: true, view: window,
    clientX: x, clientY: y, screenX: x, screenY: y,
    button: 0, buttons: 1,
  };
  const pointerOpts: PointerEventInit = {
    ...shared, pointerId: 1, pointerType: 'mouse', isPrimary: true,
  };
  el.dispatchEvent(new PointerEvent('pointerdown', pointerOpts));
  el.dispatchEvent(new MouseEvent('mousedown', shared));
  el.dispatchEvent(new PointerEvent('pointerup', pointerOpts));
  el.dispatchEvent(new MouseEvent('mouseup', shared));
  el.dispatchEvent(new MouseEvent('click', shared));
}

/** Native .click() — fires a browser-trusted click event.
 *  Use for non-toggle buttons where double-fire is harmless. */
export function nativeClick(el: Element): void {
  if (el instanceof HTMLElement) {
    el.focus();
    el.click();
  }
}

/** Directly invoke a React component's event handler via __reactProps$.
 *  This uses direct handler invocation — the last-resort option
 *  when dispatched events don't trigger React/Radix state changes.
 *  @param el  The DOM element rendered by React
 *  @param handlerName  e.g. 'onPointerDown', 'onClick'
 *  @returns true if the handler was found and invoked
 */
export async function reactTrigger(el: Element, handlerName: string): Promise<{ found: boolean, success: boolean, error?: string | null }> {
  const tempId = 'react-trig-' + Math.random().toString(36).slice(2);
  const oldId = el.id;
  el.id = tempId;

  try {
    const result = await chrome.runtime.sendMessage({
      type: 'REACT_TRIGGER',
      payload: { elId: tempId, handlerName, isKey: false, keyVal: '' }
    });
    
    if (oldId) el.id = oldId;
    else el.removeAttribute('id');

    return result || { found: false, success: false, error: 'No response from BG' };
  } catch (err: any) {
    if (oldId) el.id = oldId;
    else el.removeAttribute('id');
    return { found: false, success: false, error: err.message };
  }
}

/** Directly invoke a React onKeyDown handler via __reactProps$.
 *  Walks up the DOM tree to find the handler on the element or ancestors.
 *  Creates a fake keyboard event with the given key.
 *  @returns true if the handler was found and invoked
 */
export async function reactKeyTrigger(el: Element, key: string): Promise<{ found: boolean, success: boolean, error?: string | null }> {
  const tempId = 'react-key-' + Math.random().toString(36).slice(2);
  const oldId = el.id;
  el.id = tempId;

  try {
    const result = await chrome.runtime.sendMessage({
      type: 'REACT_TRIGGER',
      payload: { elId: tempId, handlerName: 'onKeyDown', isKey: true, keyVal: key }
    });
    
    if (oldId) el.id = oldId;
    else el.removeAttribute('id');

    return result || { found: false, success: false, error: 'No response from BG' };
  } catch (err: any) {
    if (oldId) el.id = oldId;
    else el.removeAttribute('id');
    return { found: false, success: false, error: err.message };
  }
}

/** Random variable delay for natural input pacing (ms range) */
export function humanDelay(min: number, max: number): Promise<void> {
  const ms = min + Math.random() * (max - min);
  return sleep(ms);
}

/**
 * Insert text into a Slate.js editor via simulated clipboard paste.
 * This is the ONLY safe way to programmatically insert text into Slate —
 * document.execCommand('insertText') mutates the DOM directly and
 * desynchronises Slate's virtual model, causing crashes.
 * Slate handles paste events natively through its own onPaste handler,
 * keeping the model and DOM in sync.
 */
async function slatePaste(el: HTMLElement, text: string): Promise<void> {
  // MAIN WORLD paste — DataTransfer objects from the isolated world cannot be
  // read by Slate in the main world (browser security). So we route through
  // the background service worker which uses chrome.scripting.executeScript
  // with world: 'MAIN'.
  const tempId = 'slate-paste-' + Math.random().toString(36).slice(2);
  const oldId = el.id;
  el.id = tempId;

  try {
    const result = await chrome.runtime.sendMessage({
      type: 'MAIN_WORLD_PASTE',
      payload: { elId: tempId, text }
    });

    if (result?.error) {
      console.warn('[AutoFlow] Main-world paste failed:', result.error, '— falling back to isolated-world paste');
      // Fallback to isolated-world paste (may not work but worth trying)
      isolatedWorldSlatePaste(el, text);
    }
  } catch (err) {
    console.warn('[AutoFlow] Main-world paste error:', err, '— falling back');
    isolatedWorldSlatePaste(el, text);
  } finally {
    if (oldId) el.id = oldId;
    else el.removeAttribute('id');
  }
}

/** Fallback paste in isolated world (original implementation) */
function isolatedWorldSlatePaste(el: HTMLElement, text: string): void {
  const dt = new DataTransfer();
  dt.setData('text/plain', text);

  const beforeInput = new InputEvent('beforeinput', {
    bubbles: true,
    cancelable: true,
    inputType: 'insertFromPaste',
    dataTransfer: dt,
  } as InputEventInit);
  el.dispatchEvent(beforeInput);

  const pasteEvent = new ClipboardEvent('paste', {
    bubbles: true,
    cancelable: true,
    clipboardData: dt,
  });
  el.dispatchEvent(pasteEvent);

  el.dispatchEvent(new Event('input', { bubbles: true }));
}

/** Set text in an input/textarea/contenteditable.
 *  For Slate.js editors we use clipboard paste events to avoid
 *  breaking Slate's internal DOM model.
 */
/**
 * What the editor actually holds — excluding its placeholder.
 *
 * textContent alone counts the placeholder, so an empty box reported
 * "What do you want to create?" as 27 characters of content and the fill was
 * declared a success. Slate marks its placeholder with data-slate-placeholder;
 * other editors use data-placeholder or hide it from assistive tech.
 */
export function readInputText(el: HTMLElement): string {
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
    return el.value || '';
  }

  const clone = el.cloneNode(true) as HTMLElement;
  clone.querySelectorAll(
    '[data-slate-placeholder], [data-placeholder], [aria-hidden="true"], .placeholder'
  ).forEach((n) => n.remove());
  return (clone.textContent || '').trim();
}

/**
 * Did enough of the text land to call this a success?
 *
 * Proportional, with no ceiling. It used to be
 * `Math.min(text.length * 0.6, 20)`, which caps the requirement at 20
 * characters — so any 20 characters counted as a 223-character prompt having
 * arrived, and the leftover placeholder sailed through it.
 *
 * Still not an exact match: editors collapse whitespace and turn fragments
 * into chips, so a proportion of the length is the honest test.
 */
function textLanded(el: HTMLElement, text: string): boolean {
  const want = text.trim();
  if (!want) return true;
  const got = readInputText(el);
  if (!got) return false;
  return got.length >= Math.max(4, Math.floor(want.length * 0.6));
}

/**
 * Put text into Flow's prompt box, and make sure it actually arrived.
 *
 * Previously this picked one strategy by sniffing the element and returned
 * without looking. When Flow redesigned its composer the chosen strategy
 * silently did nothing: the engine logged "Prompt filled (223 chars)", the box
 * stayed empty, Flow kept Generate disabled because there was no prompt, and
 * the run sat waiting for a button that was never going to enable. A fill that
 * cannot fail is worse than one that throws.
 *
 * Now every strategy is tried in turn until the text is visibly in the box,
 * and if none work it throws so the node reports something true.
 */
export async function setInputValue(el: HTMLElement, text: string): Promise<void> {
  const isField = el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement;

  const selectAll = () => {
    el.focus();
    if (isField) {
      (el as HTMLInputElement).select();
      return;
    }
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(el);
    selection?.removeAllRanges();
    selection?.addRange(range);
  };

  /* Ordered by how faithfully each imitates a real user for the editor in
     question — not by preference. Slate first when it is Slate, because
     execCommand desynchronises Slate's model and crashes it with "Cannot
     resolve a Slate node from DOM". */
  const strategies: Array<[string, () => void | Promise<void>]> = [];

  if (isField) {
    strategies.push(['native setter', () => {
      const proto = el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (setter) setter.call(el, text);
      else (el as HTMLInputElement).value = text;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }]);
  } else {
    if (el.hasAttribute('data-slate-editor')) {
      strategies.push(['slate paste', () => slatePaste(el, text)]);
    }
    strategies.push(['paste event', () => {
      const dt = new DataTransfer();
      dt.setData('text/plain', text);
      el.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }));
    }]);
    strategies.push(['beforeinput', () => {
      // What a real keystroke produces; modern editors listen for it even when
      // they ignore synthetic paste.
      el.dispatchEvent(new InputEvent('beforeinput', {
        bubbles: true, cancelable: true, inputType: 'insertText', data: text,
      }));
    }]);
    strategies.push(['execCommand', () => {
      document.execCommand('insertText', false, text);
    }]);
  }

  const attempted: string[] = [];
  for (const [name, run] of strategies) {
    selectAll();
    try {
      await run();
    } catch {
      // A strategy the editor rejects outright — try the next one.
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    // Editors apply asynchronously; give the model a tick to catch up.
    await new Promise((r) => setTimeout(r, 120));

    attempted.push(name);
    if (textLanded(el, text)) return;
  }

  throw new Error(
    `Could not type the prompt into Flow — tried ${attempted.join(', ')}. ` +
    `Flow's prompt box may have changed.`
  );
}

/** Find aspect ratio selector and click option */
export function findRatioOption(ratio: 'landscape' | '9:16'): Element | null {
  const ratioText = ratio === 'landscape' ? 'landscape' : '9:16';
  const altText = ratio === 'landscape' ? '16:9' : 'vertical';

  // Try buttons/options
  let el = queryButtonByText(ratioText) || queryButtonByText(altText);
  if (el) return el;

  // Try aria-labels
  el = queryByAriaLabel(ratioText) || queryByAriaLabel(altText);
  if (el) return el;

  // Try menu items
  el = findMenuItem(ratioText) || findMenuItem(altText);
  return el;
}

/** Count the number of visible output assets to detect new generation */
export function countOutputAssets(): number {
  return findAssetCards().filter(el => isVisible(el)).length;
}

/** Count tiles that have actual finished media content */
export function countTilesWithMedia(): number {
  return findAssetCards().filter(el => isVisible(el) && getTileState(el) === 'completed').length;
}

/**
 * Find the settings panel trigger button.
 * In Flow (Radix UI) this is a <button aria-haspopup="menu"> whose
 * textContent contains a generation count token like "1x" or "x1".
 * In Video mode the chip text is "Video 1x", in Image mode it shows
 * the model name like "Nano Banana 2 1x".
 * NOTE: Flow changed from "x1" to "1x" format in May 2026 update.
 */
export function findSettingsPanelTrigger(): Element | null {
  /**
   * The generation-count token, e.g. "x1" or "1x".
   *
   * Word boundaries are load-bearing. The old test was /x\d/ || /\dx/, which
   * also matched image DIMENSIONS like "1376x768" — and those only appear on
   * the page once a generation has produced tiles. That made this function
   * return a tile's menu button instead of the prompt-bar chip, but ONLY after
   * something had been generated. openSettingsPanel() then clicked the tile
   * menu, the real settings popover never opened, and the Image→Video switch
   * failed with "Media tab not found".
   */
  const isCountChip = (t: string) => /\bx\d+\b/.test(t) || /\b\d+x\b/.test(t);

  const menus = Array.from(document.querySelectorAll('button[aria-haspopup="menu"]'))
    .filter(isVisible);

  /**
   * Primary, structural test: the settings chip is the only menu button that
   * renders an aspect-ratio icon — a Material ligature named crop_9_16 /
   * crop_16_9 / crop_1_1. That holds regardless of interface language and
   * regardless of how the chip's text is formatted, which is what text
   * matching kept getting wrong.
   */
  const byRatioIcon = menus.find((b) =>
    Array.from(b.querySelectorAll('.google-symbols, .material-icons, .material-symbols-outlined, .material-symbols'))
      .some((i) => /^crop[_-]/i.test((i.textContent || '').trim()))
  );
  if (byRatioIcon) return byRatioIcon;

  // Fallback: the generation-count token ("x1" / "1x").
  const candidates = menus.filter((b) => isCountChip(labelText(b).toLowerCase()));
  if (candidates.length === 0) return null;

  // Prefer the chip that lives in the prompt bar, so a stray match elsewhere
  // on the page can never win regardless of DOM order.
  const input = findPromptInput();
  if (input && candidates.length > 1) {
    const bar = input.closest('form') || input.parentElement?.parentElement?.parentElement;
    const inBar = bar && candidates.find((b) => bar.contains(b));
    if (inBar) return inBar;
  }
  return candidates[0];
}

/**
 * Check if the settings panel is open.
 * The trigger button has aria-expanded="true" / data-state="open"
 * when the panel is showing.
 */
export function isSettingsPanelOpen(): boolean {
  const trigger = findSettingsPanelTrigger();
  if (!trigger) return false;
  return trigger.getAttribute('aria-expanded') === 'true' ||
    trigger.getAttribute('data-state') === 'open';
}

/**
 * Find the VIEW settings panel trigger button (gear/tune icon).
 * This is a SEPARATE button from the model settings chip.
 * The view settings panel contains toggles like:
 * - "Show tile details"
 * - "Clear prompt on submit"
 * - "Sound On hover"
 * - View mode (Grid/Batch)
 * - Grid size (S/M/L)
 *
 * The button is an icon-only button with aria-haspopup="menu" that
 * contains a Google Symbols icon (settings/tune) in the top toolbar.
 * It does NOT contain generation count text like "x1".
 */
export function findViewSettingsTrigger(): Element | null {
  const btns = document.querySelectorAll('button[aria-haspopup="menu"]');
  for (const btn of btns) {
    if (!isVisible(btn)) continue;
    const text = btn.textContent?.trim().toLowerCase() || '';

    // Skip the model settings chip (contains "1x", "2x", or legacy "x1", "x2" etc.)
    if (/x\d/.test(text) || /\dx/.test(text)) continue;

    // Method 1: Look for the hidden span with "View Tile Grid Settings"
    const spans = btn.querySelectorAll('span');
    for (const span of spans) {
      if (matchesFlowText(span.textContent?.trim() || '', 'viewTileGridSettings')) {
        return btn;
      }
    }

    // Method 2: Look for settings_2 icon (Google Symbols)
    const icons = btn.querySelectorAll('i.google-symbols, i[class*="google-symbols"], span.google-symbols, span[class*="google-symbols"]');
    for (const icon of icons) {
      const iconText = icon.textContent?.trim().toLowerCase() || '';
      if (iconText === 'settings_2' || iconText === 'settings' || iconText === 'tune' ||
        iconText === 'display_settings') {
        return btn;
      }
    }

    // Fallback: small icon-only button with no meaningful text (just icon text)
    // The gear button is typically 32x32 or similar small size
    const rect = btn.getBoundingClientRect();
    if (rect.width <= 48 && rect.height <= 48 && text.length <= 20) {
      // Check if this button contains a single icon and no other content
      const hasIcon = btn.querySelector('i, span[class*="symbol"]');
      if (hasIcon && !text.includes('video') && !text.includes('image') &&
        !text.includes('veo') && !text.includes('nano') &&
        !text.includes('add') && !text.includes('create')) {
        return btn;
      }
    }
  }
  return null;
}

/**
 * Check if the VIEW settings panel is open.
 */
export function isViewSettingsOpen(): boolean {
  const trigger = findViewSettingsTrigger();
  if (!trigger) return false;
  return trigger.getAttribute('aria-expanded') === 'true' ||
    trigger.getAttribute('data-state') === 'open';
}

/**
 * Detect the current view mode (Grid or Batch).
 * In Flow's view settings panel, the active mode tab has
 * data-state="active" or aria-selected="true".
 * We temporarily open the panel if needed, read the state, and close it.
 */
export async function getCurrentViewMode(): Promise<'Grid' | 'Batch' | null> {
  const wasOpen = isViewSettingsOpen();

  // Open the panel if not already open
  if (!wasOpen) {
    const trigger = findViewSettingsTrigger();
    if (!trigger) return null;
    simulateClick(trigger);
    await sleep(400);
  }

  // Look for the active mode button
  let mode: 'Grid' | 'Batch' | null = null;

  // Check role="tab" buttons first (Radix tab group)
  const tabs = document.querySelectorAll('button[role="tab"]');
  for (const tab of tabs) {
    const text = tab.textContent?.trim().toLowerCase() || '';
    const isActive = tab.getAttribute('aria-selected') === 'true' ||
      tab.getAttribute('data-state') === 'active';
    if (isActive) {
      if (matchesFlowText(text, 'grid')) mode = 'Grid';
      else if (matchesFlowText(text, 'batch')) mode = 'Batch';
    }
  }

  // Fallback: check menuitemradio or menuitem with checked state
  if (!mode) {
    const items = document.querySelectorAll('[role="menuitemradio"], [role="menuitem"]');
    for (const item of items) {
      if (!isVisible(item)) continue;
      const text = item.textContent?.trim().toLowerCase() || '';
      const isChecked = item.getAttribute('aria-checked') === 'true' ||
        item.getAttribute('data-state') === 'checked';
      if (isChecked) {
        if (matchesFlowText(text, 'grid')) mode = 'Grid';
        else if (matchesFlowText(text, 'batch')) mode = 'Batch';
      }
    }
  }

  // Close the panel if we opened it
  if (!wasOpen) {
    const trigger = findViewSettingsTrigger();
    if (trigger) {
      simulateClick(trigger);
      await sleep(300);
    }
  }

  return mode;
}

/**
 * Switch Flow's output view to Grid or Batch mode.
 * Opens the View Settings panel, clicks the target mode tab/button,
 * then closes the panel.
 *
 * @returns true if the switch was successful
 */
export async function switchToViewMode(targetMode: 'Grid' | 'Batch'): Promise<boolean> {
  // Check if already in the target mode
  const current = await getCurrentViewMode();
  if (current === targetMode) {
    console.log(`[AutoFlow] Already in ${targetMode} view mode`);
    return true;
  }

  // Open the View Settings panel
  const wasOpen = isViewSettingsOpen();
  if (!wasOpen) {
    const trigger = findViewSettingsTrigger();
    if (!trigger) {
      console.warn('[AutoFlow] switchToViewMode: View settings trigger not found');
      return false;
    }
    simulateClick(trigger);
    await sleep(500);
  }

  // Find and click the target mode button
  const modeBtn = findModeButton(targetMode);
  if (!modeBtn) {
    console.warn(`[AutoFlow] switchToViewMode: "${targetMode}" button not found in view settings`);
    // Close if we opened
    if (!wasOpen) {
      const trigger = findViewSettingsTrigger();
      if (trigger) simulateClick(trigger);
    }
    return false;
  }

  simulateClick(modeBtn);
  await sleep(600);

  // Close the panel
  const trigger = findViewSettingsTrigger();
  if (trigger && isViewSettingsOpen()) {
    simulateClick(trigger);
    await sleep(300);
  }

  // Wait for the view to re-render
  await sleep(800);

  console.log(`[AutoFlow] Switched to ${targetMode} view mode`);
  return true;
}

/**
 * Find a settings option inside the opened Radix dropdown menu.
 * Flow uses a dropdown menu (aria-haspopup="menu") for settings — NOT tabs.
 * When the menu opens, options appear as role="menuitem" or role="menuitemradio"
 * or as buttons within [role="menu"] / [data-radix-menu-content].
 *
 * Returns the matching element, excluding the settings trigger chip itself.
 */
/**
 * Visible label of an element, excluding Material Symbols icons.
 *
 * Flow renders icons as <i class="google-symbols">play_circle</i>, and the
 * ligature NAME is real text content. So the Video tab's raw textContent is
 * "play_circleVideo", and any button holding an image icon contains the word
 * "image". Substring matching on raw textContent therefore produces false
 * positives; match on this instead.
 */
export function labelText(el: Element): string {
  const ICON_SEL = '.google-symbols, .material-icons, .material-symbols-outlined, .material-symbols';
  const parts: string[] = [];
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) { parts.push(node.textContent || ''); return; }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const e = node as Element;
    // Removing an icon must SEPARATE its neighbours, not fuse them. The chip is
    // "Video · 6s" <i>crop_9_16</i> "x1"; concatenating gave "6sx1", where the
    // count token no longer has a word boundary and stopped being recognised.
    if (e.matches(ICON_SEL)) { parts.push(' '); return; }
    for (const child of Array.from(e.childNodes)) walk(child);
  };
  walk(el);
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

/** True when a Radix tab is the selected one */
export function isTabActive(el: Element): boolean {
  return el.getAttribute('data-state') === 'active' ||
         el.getAttribute('aria-selected') === 'true';
}

/**
 * Find the Image/Video media-type tab in the prompt-bar settings popover.
 *
 * Targeted deliberately rather than via generic text search: the left sidebar
 * has a "Videos" library filter that appears EARLIER in the DOM than this
 * popover (a Radix portal). A document-wide text scan returns that filter
 * first, so the engine clicked "show me videos" instead of "generate video" —
 * the mode never changed, the model list stayed image-only, and "Omni Flash"
 * was genuinely absent from the menu it was reading.
 *
 * Radix regenerates the instance id (":rt2:") on every render, but the
 * -trigger-VIDEO / -content-VIDEO suffixes are stable.
 */
export function findMediaTypeTab(mediaType: 'image' | 'video'): Element | null {
  const suffix = mediaType === 'image' ? 'IMAGE' : 'VIDEO';

  for (const sel of [
    `button[role="tab"][id$="-trigger-${suffix}"]`,
    `button[role="tab"][aria-controls$="-content-${suffix}"]`,
  ]) {
    const el = document.querySelector(sel);
    if (el && isVisible(el)) return el;
  }

  // Fallback: text match scoped to the tab slider / tablist — never the
  // whole document, so the sidebar filter can't win.
  const tabs = document.querySelectorAll(
    'button[role="tab"].flow_tab_slider_trigger, [role="tablist"] button[role="tab"]'
  );
  const want = mediaType === 'image' ? 'image' : 'video';
  for (const tab of tabs) {
    if (!isVisible(tab)) continue;
    const label = labelText(tab).toLowerCase();
    // Exact match: "videos" (the library filter) must not satisfy "video"
    if (label === want || matchesFlowText(label, want)) return tab;
  }
  return null;
}

export function findModeButton(modeName: string): Element | null {
  const lower = modeName.toLowerCase();

  // Media-type tabs have a precise structural selector — use it.
  if (lower === 'image' || lower === 'video') {
    const tab = findMediaTypeTab(lower as 'image' | 'video');
    if (tab) return tab;
  }

  // Multilingual matching for every label that Flow translates. 'Video' is
  // the critical one: FR "Vidéo" never matched the English substring path,
  // which silently left the engine in Image mode on French UIs.
  const MULTILINGUAL_KEYS = ['grid', 'batch', 'video', 'image', 'ingredients', 'frames'] as const;
  const flowKey = (MULTILINGUAL_KEYS as readonly string[]).includes(lower)
    ? (lower as (typeof MULTILINGUAL_KEYS)[number])
    : null;
  if (flowKey) {
    // Check tabs, menu items, and buttons using all translations
    const candidates = document.querySelectorAll(
      'button[role="tab"], [role="menuitem"], [role="menuitemradio"], [role="option"], [data-radix-collection-item]'
    );
    for (const el of candidates) {
      if (!isVisible(el)) continue;
      const text = labelText(el);
      if (matchesFlowText(text, flowKey)) return el;
    }
  }

  // Primary: role="menuitem" or role="menuitemradio" within the open menu
  const menuItems = document.querySelectorAll(
    '[role="menuitem"], [role="menuitemradio"], [role="option"], [data-radix-collection-item]'
  );
  for (const item of menuItems) {
    const text = labelText(item).toLowerCase();
    if (text.includes(lower) && isVisible(item)) {
      return item;
    }
  }

  // Secondary: buttons within [role="menu"] or Radix menu content
  const menuContainer = document.querySelector(
    '[role="menu"], [data-radix-menu-content], [data-radix-popper-content-wrapper]'
  );
  if (menuContainer) {
    const btns = menuContainer.querySelectorAll('button, [role="button"]');
    for (const btn of btns) {
      const text = labelText(btn).toLowerCase();
      if (text.includes(lower) && isVisible(btn)) {
        return btn;
      }
    }
  }

  // Tertiary: role="tab" buttons (just in case the UI changes back to tabs)
  const tabs = document.querySelectorAll('button[role="tab"]');
  for (const tab of tabs) {
    const text = labelText(tab).toLowerCase();
    if (text.includes(lower) && isVisible(tab)) {
      return tab;
    }
  }

  // Fallback: any visible button matching text, excluding the settings trigger chip
  const allBtns = document.querySelectorAll('button');
  for (const btn of allBtns) {
    const text = btn.textContent?.trim().toLowerCase() || '';
    if (text.includes(lower) && isVisible(btn)) {
      // Exclude the settings trigger (it contains "video" + "x1" together)
      if (btn.getAttribute('aria-haspopup') === 'menu') continue;
      // Exclude the add ingredient button
      if (btn.getAttribute('aria-haspopup') === 'dialog') continue;
      return btn;
    }
  }
  return null;
}

/** Simulate typing char-by-char with realistic delays */
export async function simulateTyping(
  el: HTMLElement,
  text: string,
  charsPerSecond: number,
  variableDelay: boolean
): Promise<void> {
  const baseDelayMs = 1000 / charsPerSecond;

  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
    el.focus();
    el.value = '';
    el.dispatchEvent(new Event('input', { bubbles: true }));

    const nativeSetter = Object.getOwnPropertyDescriptor(
      el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
      'value'
    )?.set;

    for (let i = 0; i < text.length; i++) {
      const current = el.value + text[i];
      if (nativeSetter) {
        nativeSetter.call(el, current);
      } else {
        el.value = current;
      }
      el.dispatchEvent(new KeyboardEvent('keydown', { key: text[i], bubbles: true }));
      el.dispatchEvent(new KeyboardEvent('keypress', { key: text[i], bubbles: true }));
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new KeyboardEvent('keyup', { key: text[i], bubbles: true }));

      let delay = baseDelayMs;
      if (variableDelay) {
        const jitter = 1 + (Math.random() * 0.6 - 0.3); // ±30%
        delay = baseDelayMs * jitter;
      }
      await sleep(delay);
    }
    el.dispatchEvent(new Event('change', { bubbles: true }));
  } else if (el.getAttribute('contenteditable') === 'true') {
    el.focus();

    // Select all existing content using the Selection API (Slate-safe)
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(el);
    selection?.removeAllRanges();
    selection?.addRange(range);

    const isSlate = el.hasAttribute('data-slate-editor');

    if (isSlate) {
      // ── Slate.js: NEVER use document.execCommand('insertText') ──
      // execCommand mutates the DOM directly, desyncing Slate's virtual
      // model and causing "Cannot resolve a Slate node from DOM" crashes.
      // Instead use clipboard paste events which Slate handles natively
      // through its own paste handler, keeping the model in sync.

      // Delete existing selection via Slate-safe paste of empty string
      // then paste the new text in chunks for realism.
      await slatePaste(el, ''); // clears selection
      await sleep(50);

      // Paste in chunks of 15-25 chars with realistic delays
      const CHUNK_MIN = 15;
      const CHUNK_MAX = 25;
      let offset = 0;
      while (offset < text.length) {
        const chunkSize = text.length <= 100
          ? 1  // char-by-char for short prompts
          : CHUNK_MIN + Math.floor(Math.random() * (CHUNK_MAX - CHUNK_MIN + 1));
        const chunk = text.slice(offset, offset + chunkSize);
        offset += chunk.length;

        await slatePaste(el, chunk);

        // Delay proportional to chunk length
        let delay = baseDelayMs * chunk.length;
        if (variableDelay) {
          const jitter = 1 + (Math.random() * 0.4 - 0.2); // ±20%
          delay *= jitter;
        }
        await sleep(delay);
      }
    } else {
      // Non-Slate contenteditable: execCommand is safe
      document.execCommand('delete', false);
      for (let i = 0; i < text.length; i++) {
        document.execCommand('insertText', false, text[i]);
        el.dispatchEvent(new Event('input', { bubbles: true }));

        let delay = baseDelayMs;
        if (variableDelay) {
          const jitter = 1 + (Math.random() * 0.6 - 0.3);
          delay = baseDelayMs * jitter;
        }
        await sleep(delay);
      }
    }
  }
}

/** Find ingredient chips/thumbnails that indicate images were attached.
 *  Flow's DOM has evolved — chips may or may not have data-card-open.
 *  The chips are small image thumbnails that appear in the prompt composer
 *  area when the user attaches reference images.
 *
 *  Detection strategy (multiple fallbacks):
 *  1. button[data-card-open] within prompt composer (legacy)
 *  2. img[src*="media.getMediaUrlRedirect"] or img[src*="blob:"] in
 *     the prompt composer that are NOT inside the Slate editor
 *  3. Walk up from the Slate editor and find sibling containers with
 *     small image thumbnails
 */
export function findIngredientChips(): Element[] {
  const chips: Element[] = [];

  const promptComposer = findPromptComposer();

  // Strategy 1: Legacy data-card-open buttons (still works on older builds)
  if (promptComposer) {
    const cardBtns = promptComposer.querySelectorAll('button[data-card-open]');
    for (const btn of cardBtns) {
      if (isVisible(btn)) chips.push(btn);
    }
  }
  if (chips.length > 0) return chips;

  // Strategy 2: Find image thumbnails inside the prompt composer
  // that are NOT inside the Slate editor (those would be pasted images, not chips)
  if (promptComposer) {
    const slateEditor = promptComposer.querySelector('[data-slate-editor]');
    const imgs = promptComposer.querySelectorAll('img');
    for (const img of imgs) {
      if (!isVisible(img)) continue;
      // Skip images inside the Slate editor
      if (slateEditor && slateEditor.contains(img)) continue;
      // Only count images that look like media references or blobs
      const src = img.src || '';
      if (src.includes('media.getMediaUrlRedirect') ||
          src.includes('blob:') ||
          src.includes('/api/')) {
        // Return the closest button or clickable parent as the "chip"
        const chipEl = img.closest('button') || img.closest('[role="button"]') || img;
        if (!chips.includes(chipEl)) chips.push(chipEl);
      }
    }
  }
  if (chips.length > 0) return chips;

  // Strategy 3: Global search for data-card-open buttons
  const globalCards = document.querySelectorAll('button[data-card-open]');
  for (const btn of globalCards) {
    if (isVisible(btn) && !chips.includes(btn)) chips.push(btn);
  }
  if (chips.length > 0) return chips;

  // Strategy 4: Broader search for ingredient containers
  // Look for containers with ingredient-related class names
  const strips = document.querySelectorAll('[class*="sc-8f31d1ba"], [class*="sc-d9d2dca3"], [class*="ingredient"]');
  for (const strip of strips) {
    const imgs = strip.querySelectorAll('img');
    for (const img of imgs) {
      if (isVisible(img) && !chips.includes(img)) chips.push(img);
    }
  }

  // Strategy 5: Walk up from the Slate editor and look for image thumbnails
  // in ancestor or sibling containers
  if (chips.length === 0) {
    const promptInput = findPromptInput();
    if (promptInput) {
      let container: Element | null = promptInput;
      for (let i = 0; i < 6 && container; i++) container = container.parentElement;
      if (container) {
        const slateEditor = container.querySelector('[data-slate-editor]');
        const imgs = container.querySelectorAll('img[src*="media.getMediaUrlRedirect"], img[src*="blob:"]');
        for (const img of imgs) {
          // Skip images inside the Slate editor
          if (slateEditor && slateEditor.contains(img)) continue;
          if (isVisible(img) && !chips.includes(img)) chips.push(img);
        }
      }
    }
  }

  return chips;
}

/** Find the prompt composer root container.
 *  This is the div that holds: ingredient strip + Slate editor + bottom toolbar + clear button.
 *  We find it by walking up from the Slate editor.
 */
export function findPromptComposer(): Element | null {
  const slate = document.querySelector('div[data-slate-editor="true"]');
  if (!slate) return null;
  // Walk up to find the prompt composer container
  // Structure: composer > scrollWrapper > slateEditor
  // The composer also contains the ingredient strip and bottom toolbar
  let el: Element | null = slate;
  for (let i = 0; i < 5 && el; i++) {
    el = el.parentElement;
    if (!el) break;
    // The prompt composer contains both the add ingredient button and the generate button
    const hasAddBtn = el.querySelector('button[aria-haspopup="dialog"]');
    const hasGenerateIcon = el.querySelector('i.google-symbols');
    if (hasAddBtn && hasGenerateIcon) return el;
  }
  // Fallback: walk up 3 levels from the slate editor's scroll wrapper
  let fallback: Element | null = slate.parentElement?.parentElement || null;
  return fallback;
}

// ================================================================
// FAILED TILE DETECTION & RETRY
// ================================================================

/**
 * Information about a single failed tile on the page.
 */
export interface FailedTileInfo {
  tileId: string;
  errorText: string;
  element: Element;
}

/**
 * Find all tiles on the page that are in a 'failed' state.
 * Returns the tile elements along with their tile IDs and error messages.
 */
export function findAllFailedTiles(): FailedTileInfo[] {
  const cards = findAssetCards().filter(el => isVisible(el));
  const failed: FailedTileInfo[] = [];

  for (const card of cards) {
    if (card.hasAttribute('data-autoflow-retried')) continue;
    if (getTileState(card) !== 'failed') continue;

    const tileId = findTileId(card);
    // Extract error text from the tile
    let errorText = '';
    const textContent = card.textContent?.trim() || '';
    // Look for the error description div (sibling of "Failed" text)
    const allDivs = card.querySelectorAll('div');
    for (const div of allDivs) {
      const text = div.textContent?.trim() || '';
      if (text.length > 20 && (text.toLowerCase().includes('failed') ||
        matchesFlowText(text, 'tryAgain') ||
        matchesFlowText(text, 'generationCancelled') ||
        matchesFlowText(text, 'notCharged') ||
        text.toLowerCase().includes('violate') ||
        text.toLowerCase().includes('unable'))) {
        errorText = text;
        break;
      }
    }
    if (!errorText) errorText = textContent.substring(0, 200);

    failed.push({ tileId, errorText, element: card });
  }

  return failed;
}

/**
 * Find all failed tiles by scrolling through the entire virtualized grid.
 * Unlike findAllFailedTiles(), this discovers off-screen tiles that Virtuoso
 * has removed from the DOM.
 *
 * NOTE: Because virtualized tiles are removed when scrolled away, the returned
 * elements may only be valid at the current scroll position. Callers should
 * process each tile immediately or re-query by tileId when needed.
 */
export async function findAllFailedTilesWithScroll(): Promise<FailedTileInfo[]> {
  const scroller = findOutputScroller();
  const collected = new Map<string, FailedTileInfo>();

  function collectVisibleFailed() {
    const cards = findAssetCards().filter(el => isVisible(el));
    for (const card of cards) {
      if (card.hasAttribute('data-autoflow-retried')) continue;
      if (getTileState(card) !== 'failed') continue;
      const tileId = findTileId(card);
      if (!tileId || collected.has(tileId)) continue;

      let errorText = '';
      const textContent = card.textContent?.trim() || '';
      const allDivs = card.querySelectorAll('div');
      for (const div of allDivs) {
        const text = div.textContent?.trim() || '';
        if (text.length > 20 && (text.toLowerCase().includes('failed') ||
          matchesFlowText(text, 'tryAgain') ||
          matchesFlowText(text, 'generationCancelled') ||
          matchesFlowText(text, 'notCharged') ||
          text.toLowerCase().includes('violate') ||
          text.toLowerCase().includes('unable'))) {
          errorText = text;
          break;
        }
      }
      if (!errorText) errorText = textContent.substring(0, 200);

      collected.set(tileId, { tileId, errorText, element: card });
    }
  }

  if (!scroller) {
    // No scrollable area — just check visible tiles
    collectVisibleFailed();
    return Array.from(collected.values());
  }

  // Scroll to top
  scroller.scrollTop = 0;
  await sleep(600);

  let prevScroll = -1;
  let stuckCount = 0;

  while (stuckCount < 3) {
    collectVisibleFailed();

    scroller.scrollBy(0, Math.max(200, scroller.clientHeight * 0.7));
    await sleep(400);

    if (Math.abs(scroller.scrollTop - prevScroll) < 5) {
      stuckCount++;
    } else {
      stuckCount = 0;
    }
    prevScroll = scroller.scrollTop;
  }

  // Final collection at bottom
  collectVisibleFailed();

  // Scroll back to top
  scroller.scrollTop = 0;

  return Array.from(collected.values());
}

/**
 * Find the Retry button (refresh icon) on a failed tile.
 * Flow renders: <button><i class="google-symbols">refresh</i><span>Retry</span></button>
 */
export function findRetryButtonOnTile(tile: Element): Element | null {
  const buttons = tile.querySelectorAll('button');
  for (const btn of buttons) {
    // Check for refresh icon
    const icons = btn.querySelectorAll('i.google-symbols, i[class*="google-symbols"]');
    for (const icon of icons) {
      if (icon.textContent?.trim() === 'refresh') return btn;
    }
    // Check for "Retry" text in hidden spans
    const spans = btn.querySelectorAll('span');
    for (const span of spans) {
      if (exactMatchFlowText(span.textContent?.trim() || '', 'retryExact')) return btn;
    }
  }
  return null;
}

/**
 * Find the "Reuse Prompt" button on a failed tile.
 * Flow renders: <button><i class="google-symbols">undo</i><span>Reuse Prompt</span></button>
 */
export function findReusePromptButtonOnTile(tile: Element): Element | null {
  const buttons = tile.querySelectorAll('button');
  for (const btn of buttons) {
    const icons = btn.querySelectorAll('i.google-symbols, i[class*="google-symbols"]');
    for (const icon of icons) {
      if (icon.textContent?.trim() === 'undo') return btn;
    }
    const spans = btn.querySelectorAll('span');
    for (const span of spans) {
      if (exactMatchFlowText(span.textContent?.trim() || '', 'reusePrompt')) return btn;
    }
  }
  return null;
}

/**
 * Find the middle toolbar button that appears on hover over a completed tile.
 * Flow renders the toolbar as an overlay ABOVE the tile content, not inside
 * the data-tile-id element. DOM structure:
 *   card-wrapper (sc-312888f-0)
 *     ├── overlay (sc-312888f-2)   ← toolbar lives here
 *     │    └── div[role="toolbar"]
 *     │         ├── button ♡ (heart)
 *     │         ├── button ↻ (reuse prompt) ← THE ONE WE WANT
 *     │         └── button ⋮ (more menu, aria-haspopup="menu")
 *     └── tile content (may contain data-tile-id deeper inside)
 *
 * The middle button loads the full prompt + image references into the editor.
 * We must search from the card wrapper, not the inner tile.
 *
 * @param searchRoot  The element to start searching from. Should be the
 *                    card wrapper, NOT the inner data-tile-id element.
 */
export function findToolbarReuseButton(searchRoot: Element): Element | null {
  return _pickMiddleToolbarBtn(searchRoot);
}

/**
 * Given a starting element, walk UP (up to 8 levels) to find a role="toolbar"
 * in any ancestor or its children, then return the middle radix button.
 */
export function findToolbarReuseButtonFromTile(tile: Element): Element | null {
  // Strategy 1: Search inside the tile itself (unlikely but cheap)
  const direct = _pickMiddleToolbarBtn(tile);
  if (direct) return direct;

  // Strategy 2: Walk up from tile to card wrapper, search each level
  let ancestor: Element | null = tile.parentElement;
  for (let i = 0; i < 8 && ancestor; i++) {
    const found = _pickMiddleToolbarBtn(ancestor);
    if (found) return found;
    ancestor = ancestor.parentElement;
  }

  return null;
}

/** Internal: find role="toolbar" inside root and pick the Reuse Prompt button */
function _pickMiddleToolbarBtn(root: Element): Element | null {
  const toolbar = root.querySelector('[role="toolbar"]');
  if (!toolbar) return null;

  // Get all radix collection buttons inside the toolbar
  let btns = Array.from(toolbar.querySelectorAll('button[data-radix-collection-item]'));
  if (btns.length === 0) {
    // Fallback: any direct button children
    btns = Array.from(toolbar.querySelectorAll('button'));
  }
  if (btns.length < 2) return null;

  // The middle button is: NOT the first (heart), NOT aria-haspopup (more menu)
  // It often has aria-describedby (tooltip) or data-state="delayed-open"
  for (let i = 1; i < btns.length; i++) {
    const b = btns[i];
    if (b.getAttribute('aria-haspopup')) continue; // skip 3-dot menu
    return b; // first non-heart, non-menu button = reuse prompt
  }

  // Last resort: second button regardless
  return btns[1];
}

/**
 * Check if all tiles on the page have settled (no more generating).
 * Returns true when there are no tiles in 'generating' state.
 */
export function allTilesSettled(): boolean {
  const snap = snapshotTiles();
  return snap.generating === 0;
}

/**
 * Get all tile IDs currently visible on the page.
 */
export function getAllTileIds(): string[] {
  const cards = findAssetCards().filter(el => isVisible(el));
  const ids: string[] = [];
  for (const card of cards) {
    let id = findTileId(card);
    if (!id && card.id && card.id.startsWith('history-step-')) {
       id = card.id.replace('history-step-', '');
    }
    if (id && !ids.includes(id)) {
       ids.push(id);
    }
  }
  return ids;
}

/**
 * Get the state of a specific tile by its data-tile-id.
 * Returns null if the tile is not found.
 */
export function getTileStateById(tileId: string): TileState | null {
  // Prioritize history steps over grid tiles, as grid tiles can freeze when behind the detail view
  let el = document.querySelector(`#history-step-${CSS.escape(tileId)}`);
  if (!el) {
     el = document.querySelector(`div[data-tile-id="${CSS.escape(tileId)}"]`);
  }
  if (!el) return null;
  return getTileState(el);
}

/**
 * Check the state of multiple tiles by IDs.
 * Returns a summary: { generating, completed, failed, unknown }.
 */
export function checkTileStates(tileIds: string[]): { generating: number; completed: number; failed: number; unknown: number } {
  let generating = 0, completed = 0, failed = 0, unknown = 0;
  for (const id of tileIds) {
    const state = getTileStateById(id);
    if (state === 'generating') generating++;
    else if (state === 'completed') completed++;
    else if (state === 'failed') failed++;
    else unknown++;
  }
  return { generating, completed, failed, unknown };
}

/**
 * Find the scrollable output container (virtuoso scroller or any scrollable
 * ancestor of the tile list).  Returns null if tiles aren't in a scrollable area.
 */
export function findOutputScroller(): HTMLElement | null {
  // Try the dedicated virtuoso scroller first
  const virtuosoScroller = document.querySelector('[data-testid="virtuoso-scroller"]') as HTMLElement | null;
  if (virtuosoScroller && virtuosoScroller.scrollHeight > virtuosoScroller.clientHeight + 10) {
    return virtuosoScroller;
  }

  // Walk up from the virtuoso item list
  const itemList = document.querySelector('[data-testid="virtuoso-item-list"]');
  if (itemList) {
    let el = itemList.parentElement;
    while (el && el !== document.documentElement) {
      if (el.scrollHeight > el.clientHeight + 10) return el;
      el = el.parentElement;
    }
  }

  // Walk up from any tile
  const anyTile = document.querySelector('div[data-tile-id]');
  if (anyTile) {
    let el = anyTile.parentElement;
    while (el && el !== document.documentElement) {
      if (el.scrollHeight > el.clientHeight + 10) return el;
      el = el.parentElement;
    }
  }

  return null;
}

/**
 * Scroll the output area to the very top so the newest tiles are visible.
 */
export async function scrollOutputToTop(): Promise<void> {
  const scroller = findOutputScroller();
  if (scroller) {
    scroller.scrollTop = 0;
    await sleep(500);
  }
}

/**
 * Scroll through the entire output grid (virtuoso scroller) and collect
 * the state of every tile.  Returns an ordered array from top-left to
 * bottom-right (newest tiles first).
 *
 * This handles virtualised lists where off-screen tiles are not in the DOM
 * by scrolling incrementally and collecting tiles at each viewport position.
 */
export async function scrollAndCollectAllTileStates(): Promise<Array<{ tileId: string; state: TileState; text: string }>> {
  const scroller = findOutputScroller();

  // Helper: collect all data-tile-id elements currently in the DOM
  const collected = new Map<string, { state: TileState; order: number; text: string }>();

  function collectVisible() {
    const tileEls = document.querySelectorAll('div[data-tile-id]');
    for (const tile of tileEls) {
      const htmlTile = tile as HTMLElement;
      const tileId = htmlTile.dataset.tileId || '';
      if (!tileId || collected.has(tileId)) continue;

      // Skip inner nested tiles (ancestor between this tile and document also has data-tile-id)
      if (htmlTile.parentElement?.closest('div[data-tile-id]')) continue;

      // Determine order from virtuoso row data-index + column position
      let order = collected.size; // fallback: insertion order
      const parentRow = tile.closest('div[data-index]');
      if (parentRow) {
        const rowIdx = parseInt(parentRow.getAttribute('data-index') || '0', 10);
        // Count preceding top-level tile siblings in this row
        let colIdx = 0;
        const rowTileEls = parentRow.querySelectorAll(':scope div[data-tile-id]');
        for (const rt of rowTileEls) {
          if (rt === tile) break;
          if (!(rt as HTMLElement).parentElement?.closest('div[data-tile-id]')) colIdx++;
        }
        order = rowIdx * 100 + colIdx;
      }

      collected.set(tileId, { state: getTileState(tile), order, text: (tile.textContent || '').trim() });
    }
  }

  if (!scroller) {
    // No scrollable area — just collect what is visible now
    collectVisible();
    const sorted = Array.from(collected.entries()).sort((a, b) => a[1].order - b[1].order);
    return sorted.map(([tileId, { state, text }]) => ({ tileId, state, text }));
  }

  // Scroll to top
  scroller.scrollTop = 0;
  await sleep(600);

  let prevScroll = -1;
  let stuckCount = 0;

  while (stuckCount < 3) {
    collectVisible();

    // Scroll down by ~70 % of the viewport height
    scroller.scrollBy(0, Math.max(200, scroller.clientHeight * 0.7));
    await sleep(400);

    if (Math.abs(scroller.scrollTop - prevScroll) < 5) {
      stuckCount++;
    } else {
      stuckCount = 0;
    }
    prevScroll = scroller.scrollTop;
  }

  // Final collection at bottom
  collectVisible();

  // Scroll back to top
  scroller.scrollTop = 0;

  // Return sorted by visual order (top-left first)
  const sorted = Array.from(collected.entries()).sort((a, b) => a[1].order - b[1].order);
  return sorted.map(([tileId, { state, text }]) => ({ tileId, state, text }));
}

/**
 * Check whether ALL tiles have settled by scrolling through the entire
 * output grid.  Unlike `allTilesSettled()` which only checks visible tiles,
 * this scrolls to discover off-screen tiles too.
 */
export async function allTilesSettledWithScroll(): Promise<boolean> {
  const tiles = await scrollAndCollectAllTileStates();
  return tiles.every(t => t.state !== 'generating');
}

/**
 * Find the voice chip button in the prompt area.
 */
export function findVoiceChip(): Element | null {
  return document.querySelector('button[aria-label="Play audio"]');
}

/**
 * Get the currently active voice name from the voice chip.
 */
export function getActiveVoiceName(): string | null {
  const chip = findVoiceChip();
  if (!chip) return null;
  const h4 = chip.querySelector('h4[title]');
  return h4 ? h4.getAttribute('title') : null;
}
/**
 * Check if the ingredient menu/dialog is currently open.
 */
export function isIngredientMenuOpen(): boolean {
  // Try to find the voice tab, or any common ingredient menu items
  if (findVoiceTabInDialog()) return true;
  // If no tab, check if there's an active menu/dialog that contains typical ingredient text
  const popups = document.querySelectorAll('[role="dialog"], [role="menu"], [role="presentation"]');
  for (const popup of popups) {
    const text = popup.textContent || '';
    if (matchesFlowText(text, 'voice') || matchesFlowText(text, 'image') || matchesFlowText(text, 'character')) {
      if (isVisible(popup)) return true;
    }
  }
  return false;
}

/**
 * Find the Voice tab button inside the "+" ingredient dialog.
 */
export function findVoiceTabInDialog(): Element | null {
  // Strategy 1: button[role="tab"] — Flow prefixes icon name to text (e.g. "voice_selectionVoices")
  const tabs = document.querySelectorAll('button[role="tab"]');
  for (const tab of tabs) {
    const text = (tab.textContent || '').trim();
    if (text.endsWith('Voices') || text.endsWith('Voice') || text.endsWith('Audio')) {
      if (isVisible(tab)) return tab;
    }
  }

  // Strategy 2: Old Radix tab IDs
  const tab = document.querySelector('button[role="tab"][id$="-trigger-AUDIO"], button[role="tab"][aria-controls$="-content-AUDIO"]');
  if (tab && isVisible(tab)) return tab;

  // Strategy 3: aria-label fallback
  const elements = document.querySelectorAll('[role="tab"], [role="menuitem"], button');
  for (const el of elements) {
    const aria = (el.getAttribute('aria-label') || '').trim().toLowerCase();
    if (aria === 'voice' || aria === 'voices' || aria === 'audio') {
      if (isVisible(el)) return el;
    }
  }
  return null;
}

/**
 * Find the Image tab button inside the "+" ingredient dialog.
 */
export function findImageTabInDialog(): Element | null {
  // Strategy 1: button[role="tab"] — Flow prefixes icon name (e.g. "photoImages")
  const tabs = document.querySelectorAll('button[role="tab"]');
  for (const tab of tabs) {
    const text = (tab.textContent || '').trim();
    if (text.endsWith('Images') || text.endsWith('Image')) {
      if (isVisible(tab)) return tab;
    }
  }

  // Strategy 2: Old Radix tab IDs
  const tab = document.querySelector('button[role="tab"][id$="-trigger-IMAGE"], button[role="tab"][aria-controls$="-content-IMAGE"]');
  if (tab && isVisible(tab)) return tab;

  // Strategy 3: aria-label fallback
  const elements = document.querySelectorAll('[role="tab"], [role="menuitem"], button');
  for (const el of elements) {
    const aria = (el.getAttribute('aria-label') || '').trim().toLowerCase();
    if (aria === 'image' || aria === 'images') {
      if (isVisible(el)) return el;
    }
  }
  return null;
}

