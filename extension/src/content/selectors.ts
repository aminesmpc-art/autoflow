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
export function findModelSelectorTrigger(): Element | null {
  // Primary: find a button[aria-haspopup="menu"] INSIDE the open settings menu.
  // The settings trigger opens a [role="menu"] dropdown. Inside it, the model
  // selector is a nested button[aria-haspopup="menu"] (e.g. "Nano Banana 2 ▼").
  const menuContainer = document.querySelector(
    '[role="menu"], [data-radix-menu-content]'
  );
  if (menuContainer) {
    const innerBtns = menuContainer.querySelectorAll('button[aria-haspopup="menu"]');
    for (const btn of innerBtns) {
      if (isVisible(btn)) return btn;
    }
  }

  /* Fallback: a button whose text mentions a model family.

     The composer chip must be excluded here. Both it and the real model
     button carry aria-haspopup="menu" and both contain the model name, but
     the chip's text is the whole summary — "Nano Banana 2 Lite" + a
     crop_square glyph + "x1" — and clicking it toggles the settings panel
     rather than opening the model list.

     The old guard demanded BOTH a count and the word "video" or "image". In
     image mode the ratio renders as a glyph, so the word is never there and
     the chip sailed through. A count, a crop_ glyph or a written ratio is
     each enough on its own; a model button carries none of them. */
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
  /* The Angular Flow. Measured on a live project showing six generated
     videos, EVERY tier below returned zero:

       div[id^="history-step-fe_id_"]   0
       div[data-tile-id]                0
       virtuoso [data-index] rows       0
       [role=listitem|gridcell] etc     0
       [role=grid], [role=list], …      0

     So this returned an empty array, the run monitor had no tile to read, and
     a queue could neither see a video finish nor see one fail — it reported
     0 failed beside visibly failed tiles and waited on them forever. */
  const flowTiles = Array.from(
    document.querySelectorAll('flow-video-tile, flow-image-tile'),
  ).filter(isVisible);
  if (flowTiles.length > 0) return flowTiles;

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
  /* Tier 0: the Angular Flow, which names both slots and puts them in order.
  
       <div class="ingredient-bar-container">
         <div cdkoverlayorigin class="frame-trigger">
           <button class="empty-chip"> Début </button>
         <button aria-label="Intervertir les première et dernière images">
           <mat-icon>swap_horiz</mat-icon>
         <div cdkoverlayorigin class="frame-trigger">
           <button class="empty-chip"> Fin </button>
  
     Position carries the meaning, not the wording — which is just as well,
     since the tiers below compare against the literal strings "Start" and
     "End" and this interface says "Début" and "Fin". The swap button sitting
     between them exists precisely because the order is what matters. */
  const bar = document.querySelector('div.ingredient-bar-container');
  const triggers = Array.from(
    (bar || document).querySelectorAll<HTMLElement>('div.frame-trigger')
  ).filter(isVisible);
  if (triggers.length >= 2) return label === 'Start' ? triggers[0] : triggers[1];

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
  /* Tier 0 (new Flow): the component that IS the add menu.
     Read off the live page — the composer's "+" is

       <flow-add-menu>
         <button aria-label="Add ingredients to the prompt box">
           <mat-icon class="mat-icon notranslate google-symbols">add</mat-icon>

     Anchored on the component rather than that label, because the label is
     translated: on a French account it reads "Ajouter des ingredients au
     champ du prompt". The component name is not translated and does not move
     when someone restyles the button. */
  const addMenu = document.querySelector('flow-add-menu');
  if (addMenu) {
    const btn = addMenu.querySelector('button');
    if (btn && isVisible(btn)) return btn;
  }

  // Strategy 1 (old Flow): button containing Google Symbols icon with "add_2"
  // That was the ligature on the previous site; the new one writes plain "add".
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

  // Strategy 2: button with aria-haspopup="dialog" AND add icon near the prompt.
  // Kept for the old site. The new one has no aria-haspopup anywhere — measured 0.
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

  /* Strategy 3: an "add" icon anywhere — last resort, and the reason this
     function was returning the wrong element on the new site.

     A bare "add" ligature is not unique there. Measured on a real project, the
     first button carrying one is

       aria-label="Add media menu"   in flow-tile-view-header   at (1218, 18)

     a 40x40 control in the page header, unrelated to the composer's 32x32 "+"
     at (484, 958). Every existing ingredient chip carries an "add" hover
     overlay too, so which one won came down to document order.

     Scoped to the prompt box when there is one, with the header and the chips
     excluded outright. */
  const composer = document.querySelector('flow-prompt-box, flow-base-prompt-box');
  const scope: ParentNode = composer || document;
  for (const btn of scope.querySelectorAll('button')) {
    if (btn.closest('flow-tile-view-header')) continue;
    if (btn.closest('flow-ingredient-chip, flow-image-ingredient-chip')) continue;
    const icons = btn.querySelectorAll('i.google-symbols, i.material-icons, .google-symbols, mat-icon');
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
  /* mat-icon included: the Angular Flow renders its ligatures there, so the
     error/warning icons this reads were invisible to it. */
  const icons = tile.querySelectorAll('mat-icon, .google-symbols, .material-icons, .material-symbols-outlined, .material-symbols, i.google-symbols, i.material-icons, i.material-symbols-outlined');
  /* Apostrophes normalised: Flow writes "can’t generate" with a typographic
     apostrophe, which does not match a pattern typed with a plain one. */
  const tileTextRaw = (tile.textContent || '').toLowerCase().replace(/[‘’]/g, "'");

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
    /* Flow's refusal for third-party content reads "I can't generate the
       video you requested right now due to interests of third-party content
       providers" — it never says failed, blocked or violated, so none of the
       words beside it matched and the tile read as still running. */
    tileTextRaw.includes("can't generate") || tileTextRaw.includes('cannot generate') ||
    tileTextRaw.includes('third-party content') ||
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
  const idx = (el as HTMLElement).dataset?.index;
  if (idx) return idx;

  /* The Angular Flow gives a tile no id of any kind — measured on the real
     markup of a failed tile, whose only attributes are _ngcontent-*, class,
     aria-label, role and style. That mattered more than it looks: callers
     drop any tile whose id is empty (findAllFailedTilesWithScroll does
     `if (!tileId) continue`), so EVERY failed tile was skipped and the retry
     pass had nothing to work on.
     So derive one. A tile is identified by the batch it sits in and its place
     in that batch, which is stable across Angular's re-renders — unlike an
     attribute we write ourselves, which its re-render wipes. */
  return newFlowTileId(el);
}

/** An identity for a tile on a page that supplies none. */
function newFlowTileId(el: Element): string {
  const batch = el.closest('.batch-container');
  if (!batch) return '';

  const tiles = Array.from(batch.querySelectorAll('flow-video-tile, flow-image-tile'));
  const pos = tiles.indexOf(el as Element);
  /* Not in this batch's tile list — a container element rather than a tile.
     Better to have no id than one that collides with the tile at index -1. */
  if (pos < 0) return '';

  const promptEl = batch.querySelector('flow-expandable-prompt .text-part');
  const prompt = (promptEl?.textContent || '').trim().slice(0, 60);
  /* The prompt alone is not unique — a batch of four shares one — so the
     position carries the rest of the identity. */
  return `af:${prompt}#${pos}`;
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
export async function setInputValue(el: HTMLElement, text: string): Promise<void> {
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
    // Use native input setter to trigger React/Angular change detection
    const nativeSetter = Object.getOwnPropertyDescriptor(
      el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
      'value'
    )?.set;
    if (nativeSetter) {
      nativeSetter.call(el, text);
    } else {
      el.value = text;
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  } else if (el.getAttribute('contenteditable') === 'true') {
    el.focus();

    // Select all existing content using the Selection API
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(el);
    selection?.removeAllRanges();
    selection?.addRange(range);

    // For Slate.js we MUST NOT use document.execCommand('insertText') — it
    // mutates the DOM directly and desynchronises Slate's virtual model,
    // causing "Cannot resolve a Slate node from DOM" crashes.
    // Instead, simulate a clipboard paste that Slate handles natively.
    if (el.hasAttribute('data-slate-editor')) {
      await slatePaste(el, text);
    } else {
      // Non-Slate contenteditable: execCommand is fine
      document.execCommand('insertText', false, text);
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
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

  /* Every button that could open a popover.
     This was `button[aria-haspopup="menu"]` alone, which is how Radix says it.
     Flow is Angular Material now and says it differently — verified on the
     live page, the settings chip is

       <button matbutton aria-label="Settings trigger" cdkoverlayorigin
               class="mdc-button mat-mdc-button-base settings-trigger-button">

     with no aria-haspopup at all. Measured there: the old set was 11 buttons
     and did NOT contain the chip; this set is 60 and does. The ratio-icon test
     below already recognises it — crop_9_16 is right there in it — so widening
     what reaches that test is the whole fix. */
  const menus = Array.from(document.querySelectorAll<HTMLElement>(
    'button[aria-haspopup="menu"], button[cdkoverlayorigin], button[aria-label],'
    + ' button.settings-trigger-button, [role="button"][aria-haspopup="menu"]',
  )).filter(isVisible);

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
/**
 * Is the composer's settings popover on screen?
 *
 * Asked of the trigger first, which is how Radix says it. Angular Material
 * says nothing at all — measured on the live page, aria-expanded stayed null
 * with the popover open — so this answered "closed" while it was open, and the
 * caller, which opens the panel whenever this is false, pressed the chip again
 * and CLOSED it. Open, close, open, close, three attempts, then the error.
 *
 * So the panel itself is the second answer. Angular's CDK renders overlays
 * into `.cdk-overlay-pane`, and one holding a ratio or a media word is this
 * popover rather than some other dialog — a bare "is any overlay open" would
 * count a toast.
 */
export function isSettingsPanelOpen(): boolean {
  const trigger = findSettingsPanelTrigger();
  if (trigger && (trigger.getAttribute('aria-expanded') === 'true'
    || trigger.getAttribute('data-state') === 'open')) return true;

  const RATIO = /(?:16\s*[:_]\s*9|9\s*[:_]\s*16|1\s*[:_]\s*1|4\s*[:_]\s*3|3\s*[:_]\s*4)/;
  return Array.from(document.querySelectorAll<HTMLElement>('.cdk-overlay-pane'))
    .some((pane) => {
      if (!isVisible(pane)) return false;
      const text = pane.textContent || '';
      return RATIO.test(text)
        || matchesFlowText(text, 'image')
        || matchesFlowText(text, 'video');
    });
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
  /* Tier 0 (new Flow): the gear, found by its ligature.
     Read off the live page:

       <button aria-label="Tile grid settings" aria-haspopup="menu">
         <mat-icon class="mat-icon notranslate google-symbols">settings_2</mat-icon>

     The ligature is the anchor because Material renders it as literal text
     and marks it notranslate, so it reads "settings_2" on every locale while
     the aria-label becomes "Parametres de la grille" on a French account.

     This tier exists because the icon is a <mat-icon>. Every tier below looks
     for i.google-symbols or span[class*="google-symbols"], and mat-icon is
     neither an <i> nor a <span> — so all of them missed it, the function
     returned null, and the panel simply never opened. */
  const GEAR = ['settings_2', 'settings', 'tune', 'display_settings'];
  const gearScopes: ParentNode[] = [
    document.querySelector('flow-tile-view-header') || document,
    document,
  ];
  for (const scope of gearScopes) {
    for (const btn of scope.querySelectorAll('button')) {
      if (!isVisible(btn)) continue;
      for (const icon of btn.querySelectorAll('mat-icon, i, span')) {
        const lig = (icon.textContent || '').trim().toLowerCase();
        if (GEAR.includes(lig)) return btn;
      }
    }
  }
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
    const icons = btn.querySelectorAll('mat-icon, i.google-symbols, i[class*="google-symbols"], span.google-symbols, span[class*="google-symbols"]');
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
      const hasIcon = btn.querySelector('i, mat-icon, span[class*="symbol"]');
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
  /* The panel itself, named by its component. aria-expanded is what the live
     page sets today, but the composer's settings chip carries no such
     attribute — so this does not depend on the trigger having one. */
  if (document.querySelector('flow-tile-view-settings')) return true;

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
/**
 * Is this control the selected one?
 *
 * Every UI kit says it differently, and reading only one is how a click that
 * worked reports that it did not. Radix uses data-state or aria-selected. The
 * Image/Video control on flow.google.com is an Angular Material button-toggle
 * and uses neither — read off the live page with the panel open:
 *
 *   <button class="mat-button-toggle-button" aria-checked="true">   Video
 *   <mat-button-toggle class="… mat-button-toggle-checked">
 *
 * data-state and aria-selected were both null on every toggle. So the switch
 * would find the tab, click it, ask whether it had taken, be told no, and give
 * up after three tries — the same error as never finding it, for a completely
 * different reason.
 *
 * The wrapper is consulted from the PARENT up, never from the element itself:
 * closest() starts where it is called, and the button's own class is
 * `mat-button-toggle-button`, which contains "button-toggle" — so it matched
 * itself and the wrapper was never examined.
 */
export function isTabActive(el: Element): boolean {
  if (el.getAttribute('data-state') === 'active') return true;
  if (el.getAttribute('aria-selected') === 'true') return true;
  if (el.getAttribute('aria-checked') === 'true') return true;
  if (el.getAttribute('aria-pressed') === 'true') return true;

  const wrap = el.parentElement?.closest('mat-button-toggle, [class*="button-toggle"]');
  if (wrap) {
    if (wrap.getAttribute('aria-checked') === 'true') return true;
    if (wrap.getAttribute('aria-pressed') === 'true') return true;
    if (/(?:^|\s)[\w-]*button-toggle-checked(?:\s|$)/.test(wrap.className || '')) return true;
  }
  return false;
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

  /* ── Last resort: a Flow with no roles on anything ──
     Every tier above needs role="tab". Measured on flow.google.com:
     document.querySelectorAll('button[role="tab"]').length === 0. Its controls
     are Angular Material button-toggles, so all three tiers missed and the run
     stopped with "Could not switch Flow to Image mode".

     Text alone is not safe, and the comment at the top of this function says
     why: the sidebar carries Images and Vidéos library filters, they are
     siblings of each other just like the real tabs, and they come EARLIER in
     the document — so both "first match" and "find the pair" click "show me
     videos" instead of "generate video".

     Scope settles it. Angular's CDK renders every overlay, this popover
     included, inside .cdk-overlay-container appended to <body>, and the
     sidebar is not in it. That is a framework fact rather than a Flow choice.
     The ratio anchor below is the fallback for the open document, and it
     accepts `crop_16_9` as well as `16:9` because the chip writes the ratio as
     a Material ligature — underscores, no colon. */
  const RATIO = /(?:16\s*[:_]\s*9|9\s*[:_]\s*16|1\s*[:_]\s*1|4\s*[:_]\s*3|3\s*[:_]\s*4)/;
  const nearRatio = (el: Element): boolean => {
    let up: Element | null = el.parentElement;
    for (let i = 0; i < 5 && up; i++) {
      if (RATIO.test(up.textContent || '')) return true;
      up = up.parentElement;
    }
    return false;
  };

  const scopes: ParentNode[] = [
    ...Array.from(document.querySelectorAll<HTMLElement>(
      '.cdk-overlay-container, [role="dialog"], mat-dialog-container',
    )),
    document,
  ];
  const SELECTOR = 'button,[role="tab"],[role="menuitemradio"],[role="option"],div,span';

  for (const scope of scopes) {
    const anchored = scope === document;
    const found = Array.from(scope.querySelectorAll<HTMLElement>(SELECTOR)).filter((el) => {
      if (!isVisible(el)) return false;
      const label = labelText(el).trim().toLowerCase();
      if (!label || (label !== want && !matchesFlowText(label, want))) return false;
      /* "videos"/"vidéos" is the library filter, never the mode tab. */
      if (/s$/.test(label) && label !== want) return false;
      return anchored ? nearRatio(el) : true;
    });
    /* The most specific one: an ancestor's textContent contains its children's,
       so a wrapper matches everything its tab matches and comes first. */
    found.sort((a, b) => labelText(a).trim().length - labelText(b).trim().length);
    if (found[0]) return found[0];
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
    /* button[role="radio"] and mat-button-toggle are the Angular Flow.
    
       The creation type — Ingredients or Frames — is a Material button-toggle
       group there, read off the live page:
    
         <mat-button-toggle class="… mat-button-toggle-checked">
           <button class="mat-button-toggle-button" role="radio" aria-checked="true">
             <span class="toggle-label">
               <mat-icon class="google-symbols">chrome_extension</mat-icon>
               <span class="toggle-text">Ingrédients</span>
    
       role="radio" appears in none of the tiers this list used to hold, so
       findModeButton returned null for both Ingredients and Frames, the
       composer was never switched, and everything downstream looked for
       controls the page had not rendered. */
    const candidates = document.querySelectorAll(
      'button[role="tab"], [role="menuitem"], [role="menuitemradio"], [role="option"], '
      + '[data-radix-collection-item], button[role="radio"], mat-button-toggle button'
    );

    /* Strongest match first, because the translations overlap.
    
       FLOW_STRINGS.frames contains 'Images' — on a French UI that IS the
       Frames tab. Correct there, and ruinous under a loose match on an
       English one, where "Images" is the OTHER toggle: asking for Frames
       would return Ingredients, click it, and report the mode switched. */
    const visible = Array.from(candidates).filter(isVisible);

    const literal = visible.find((el) => labelText(el).trim().toLowerCase() === lower);
    if (literal) return literal;

    const exact = visible.find((el) => exactMatchFlowText(labelText(el), flowKey));
    if (exact) return exact;

    const loose = visible.find((el) => matchesFlowText(labelText(el), flowKey));
    if (loose) return loose;
  }

  // Primary: role="menuitem" or role="menuitemradio" within the open menu
  const menuItems = document.querySelectorAll(
    '[role="menuitem"], [role="menuitemradio"], [role="option"], [data-radix-collection-item], '
    + 'button[role="radio"], mat-button-toggle button'
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
/**
 * The names Flow is showing for the media in this project.
 *
 * An uploaded image becomes a tile in the project, and the tile prints its
 * filename once the upload has finished:
 *
 *   <span class="footer-title">af_5d2d0448.png</span>
 *
 * While it is still going up the tile is there but blank, showing a
 * percentage instead — 7% in the case that first showed this up. So the name
 * appearing IS the upload completing, which is the signal to wait on rather
 * than counting out a fixed number of seconds.
 */
export function mediaNamesOnPage(): string[] {
  const names: string[] = [];

  for (const el of document.querySelectorAll('.footer-title, flow-tile-hover-footer')) {
    const text = (el.textContent || '').trim();
    if (text) names.push(text);
  }

  /* The grid labels its tiles too, and the footer is only rendered while the
     tile is hovered on some builds. */
  for (const el of document.querySelectorAll('flow-grid-tile-container[aria-label]')) {
    const label = (el.getAttribute('aria-label') || '').trim();
    if (label) names.push(label);
  }

  return names;
}

/** Has Flow finished taking this upload, judged by its name appearing? */
export function uploadIsOnPage(filename: string): boolean {
  if (!filename) return false;
  const wanted = filename.toLowerCase();
  /* Flow may show the name without its extension, so compare on the stem. */
  const stem = wanted.replace(/\.[a-z0-9]{2,5}$/i, '');
  return mediaNamesOnPage().some((n) => {
    const got = n.toLowerCase();
    return got.includes(wanted) || (stem.length > 4 && got.includes(stem));
  });
}

/**
 * Is every attached ingredient actually showing its image?
 *
 * NOT aria-busy. That was the obvious candidate and it is not reliable —
 * measured on a chip whose image had not arrived:
 *
 *   <button class="chip-container" aria-label="Ingredient" aria-busy="false">
 *     <div class="chip-image-wrapper">
 *       <div class="chip-placeholder"><mat-icon>image</mat-icon></div>
 *
 * aria-busy reads "false" in the pending state as well as the finished one,
 * so waiting on it would have returned immediately and been no better than
 * the fixed eight-second sleep it replaced.
 *
 * What does differ is the content. Pending shows div.chip-placeholder holding
 * an icon; ready replaces it with <img class="chip-image"> pointing at the
 * uploaded media. So the picture being there IS the readiness signal.
 *
 * aria-busy is still honoured when it says "true", since that is unambiguous.
 */
export function ingredientChipsSettled(): boolean {
  const chips = findIngredientChips();
  if (chips.length === 0) return false;

  return chips.every((c) => {
    if (c.getAttribute('aria-busy') === 'true') return false;
    if (c.querySelector('.chip-placeholder')) return false;
    const img = c.querySelector('img.chip-image') || c.querySelector('img');
    return !!(img && img.getAttribute('src'));
  });
}

/**
 * The media each attached ingredient is showing.
 *
 * A chip's image is served with its id in the URL, so comparing this before
 * and after a paste says WHICH ingredients arrived — not merely how many.
 * Counting alone passed when two of three images attached and a chip left
 * over from the previous prompt made up the difference.
 */
export function ingredientChipIds(): string[] {
  const ids: string[] = [];
  for (const chip of findIngredientChips()) {
    /* A chip still waiting for its upload has a placeholder here instead of
       an image, so it contributes no id — which is what we want: it must not
       be counted as one of the images that arrived. */
    const img = chip.querySelector('img.chip-image') || chip.querySelector('img');
    const src = img ? (img.getAttribute('src') || '') : '';
    const m = /\/(?:image|video)\/([0-9a-f][0-9a-f-]{11,})/.exec(src);
    if (m) ids.push(m[1]);
    else if (src) ids.push(src.slice(0, 120));
  }
  return ids;
}

export function findIngredientChips(): Element[] {
  const chips: Element[] = [];

  /* Tier 0: the Angular Flow, which names the thing outright.
   *
   *   <div class="ingredient-bar-container">
   *     <flow-ingredient-chip><flow-image-ingredient-chip>
   *       <button class="chip-container" aria-label="Ingredient" aria-busy="false">
   *         <img class="chip-image" src="https://flow-content.google/image/…">
   *
   * The tiers below look for button[data-card-open] and for images served
   * from media.getMediaUrlRedirect, blob: or /api/ — none of which this site
   * produces. So this returned nothing on every attach, and the ten-second
   * wait for chips to appear could only ever time out. */
  const modern = document.querySelectorAll(
    'div.ingredient-bar-container flow-ingredient-chip, flow-ingredient-chip',
  );
  for (const chip of modern) {
    const btn = chip.querySelector('button.chip-container') || chip.querySelector('button');
    if (btn) chips.push(btn);
  }
  if (chips.length > 0) return chips;

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
  /** The prompt this tile was generated from, when the page states it. */
  promptText: string;
}

/**
 * The prompt a tile was generated from.
 *
 * On the Angular Flow the prompt is NOT inside the tile: a batch renders as
 *
 *   div.batch-container
 *     ├── div.batch-tiles-section   → flow-video-tile, flow-video-tile, …
 *     └── flow-batch-info           → flow-expandable-prompt .text-part
 *
 * so the tile's own textContent is just the error message. That broke the
 * only surviving way to match a failed tile to the prompt that produced it —
 * the other way, prompt.tileIds, is empty on this Flow because getAllTileIds
 * reads data-tile-id, which these tiles do not have. With both dead, no
 * failed tile could be matched to a prompt and none was ever retried.
 */
export function promptTextOfTile(tile: Element): string {
  const batch = tile.closest('.batch-container');
  const el = batch?.querySelector('flow-expandable-prompt .text-part')
    || batch?.querySelector('flow-expandable-prompt');
  return (el?.textContent || '').trim();
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

    failed.push({ tileId, errorText, element: card, promptText: promptTextOfTile(card) });
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

      collected.set(tileId, { tileId, errorText, element: card, promptText: promptTextOfTile(card) });
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
 * The ligatures on a button, from either icon element Flow has used.
 *
 * The Angular Flow renders its icons as <mat-icon class="google-symbols">,
 * and the old selector asked for `i.google-symbols` — a tag that no longer
 * appears on the page at all. Measured on a live project: 0 `i.google-symbols`
 * against 70 `mat-icon`. A ligature is also the same word in every locale,
 * which an aria-label is not, so it is the signal to lead with.
 */
function iconLigatures(el: Element): string[] {
  const icons = el.querySelectorAll(
    'mat-icon, i.google-symbols, i[class*="google-symbols"], .material-icons, .material-symbols-outlined',
  );
  return Array.from(icons).map((i) => (i.textContent || '').trim());
}

/** A button's aria-label, which is where the Angular Flow puts its wording. */
function ariaLabelOf(el: Element): string {
  return (el.getAttribute('aria-label') || '').trim();
}

/**
 * Find the Retry button on a failed tile.
 *
 * The Angular Flow renders a failed generation as its own element, and the
 * three buttons sit together in one container:
 *
 *   <flow-error-tile>
 *     <div class="error-message">
 *       <mat-icon class="error-icon google-symbols">warning</mat-icon>
 *       <div class="error-title">Failed</div>
 *       ...
 *     <div class="buttons-container">
 *       <button aria-label="Retry"><mat-icon>refresh</mat-icon></button>
 *       <button aria-label="Reuse prompt"><mat-icon>undo</mat-icon></button>
 *       <button aria-label="Delete"><mat-icon>delete_forever</mat-icon></button>
 *
 * Two things had to change. The icon lives in <mat-icon>, not <i>, so the
 * ligature tier matched nothing; and "Retry" is an aria-label, not span text,
 * so the text tier matched nothing either. Between them the old function
 * returned null on every failed tile the current site can render.
 *
 * `refresh` is what distinguishes this button from the two beside it — `undo`
 * only refills the prompt box and `delete_forever` throws the tile away, so
 * matching either would be worse than finding nothing.
 */
export function findRetryButtonOnTile(tile: Element): Element | null {
  /* Scope to the error tile when there is one: its buttons are the retry
     controls, and nothing else on the tile can be confused for them. */
  const scope = tile.querySelector('flow-error-tile .buttons-container')
    || tile.querySelector('flow-error-tile')
    || tile;

  const buttons = Array.from(scope.querySelectorAll('button'));

  // Tier 0: the refresh ligature — the same word in every locale.
  for (const btn of buttons) {
    if (iconLigatures(btn).includes('refresh')) return btn;
  }

  // Tier 1: the aria-label, which is where the wording now lives.
  for (const btn of buttons) {
    if (exactMatchFlowText(ariaLabelOf(btn), 'retryExact')) return btn;
  }

  // Tier 2: span text, for the old Flow.
  for (const btn of buttons) {
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
  /* Same two breaks as the Retry button: <mat-icon> rather than <i>, and the
     wording in aria-label rather than a span. Flow uses `undo` for this on a
     failed tile and `keyboard_return` on the batch prompt row — both are the
     same action, so both count. */
  const buttons = Array.from(tile.querySelectorAll('button'));

  for (const btn of buttons) {
    const ligs = iconLigatures(btn);
    if (ligs.includes('undo') || ligs.includes('keyboard_return')) return btn;
  }
  for (const btn of buttons) {
    if (exactMatchFlowText(ariaLabelOf(btn), 'reusePrompt')) return btn;
  }
  for (const btn of buttons) {
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

