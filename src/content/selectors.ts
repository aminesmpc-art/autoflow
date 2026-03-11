/* ============================================================
   AutoFlow – DOM Selectors for Google Flow UI
   Robust selectors using aria-labels, roles, visible text,
   and stable data-* attributes. Avoids brittle CSS paths.
   ============================================================ */

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
      placeholder.includes('prompt') ||
      placeholder.includes('describe') ||
      placeholder.includes('enter') ||
      placeholder.includes('create') ||
      placeholder.includes('what do you want') ||
      label.includes('prompt') ||
      label.includes('describe') ||
      label.includes('create')
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

  // Fallback: match by known model name keywords in button text
  const btns = document.querySelectorAll('button[aria-haspopup="menu"]');
  for (const btn of btns) {
    const text = (btn.textContent || '').toLowerCase();
    if ((text.includes('veo') || text.includes('imagen') || text.includes('banana')) && isVisible(btn)) {
      // Skip the settings trigger chip (contains media type + generation count like "Video x1")
      if (/x\d/.test(text) && (text.includes('video') || text.includes('image'))) continue;
      return btn;
    }
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
  const moreBtn = assetElement.querySelector('[aria-label*="More"], [aria-label*="more"], button[aria-label*="menu"]');
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
  // Primary: tile elements with data-tile-id attribute
  const tiles = document.querySelectorAll('div[data-tile-id]');
  if (tiles.length > 0) return Array.from(tiles);

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

/** Find the "Start" or "End" frame button in Frames mode.
 *  In Flow's Frames creation mode, the UI shows two div-buttons
 *  (div[type="button"][aria-haspopup="dialog"]) labeled "Start" and "End"
 *  instead of the "+" ingredient button.
 *  Each is a 50×50 square with text "Start" or "End" inside.
 */
export function findFrameButton(label: 'Start' | 'End'): Element | null {
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

  // Strategy 3: Search near the prompt input area
  const promptArea = findPromptInput();
  if (promptArea) {
    let container = promptArea.parentElement;
    for (let i = 0; i < 8 && container; i++) {
      container = container.parentElement;
    }
    if (container) {
      const allEls = container.querySelectorAll('[aria-haspopup="dialog"]');
      for (const el of allEls) {
        const text = (el.textContent || '').trim();
        if (text === label && isVisible(el)) return el;
      }
    }
  }

  return null;
}

/** Find the "+" ingredient attachment button near the prompt.
 *  In Flow this is <button aria-haspopup="dialog"> containing a
 *  Google Symbols icon with text "add_2" and a hidden <span>Create</span>.
 */
export function findIngredientAttachButton(): Element | null {
  // Strategy 1: button with aria-haspopup="dialog" in the prompt area
  const promptArea = findPromptInput();
  if (promptArea) {
    let container = promptArea.parentElement;
    for (let i = 0; i < 5 && container; i++) {
      container = container.parentElement;
    }
    if (container) {
      const dialogBtns = container.querySelectorAll('button[aria-haspopup="dialog"]');
      for (const btn of dialogBtns) {
        if (isVisible(btn)) return btn;
      }
    }
  }

  // Strategy 2: button containing Google Symbols icon with "add_2" or "add"
  const buttons = document.querySelectorAll('button');
  for (const btn of buttons) {
    const icons = btn.querySelectorAll('i.google-symbols, i.material-icons, .google-symbols');
    for (const icon of icons) {
      const iconText = (icon.textContent || '').trim().toLowerCase();
      if (iconText === 'add_2' || iconText === 'add') {
        if (isVisible(btn)) return btn;
      }
    }
  }

  // Strategy 3: button[aria-haspopup="dialog"] anywhere visible on page
  const globalDialogBtns = document.querySelectorAll('button[aria-haspopup="dialog"]');
  for (const btn of globalDialogBtns) {
    if (isVisible(btn)) return btn;
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
  // Primary: Find the Radix dialog (role="dialog") that contains
  // the "Search for Assets" input. This is the inner dialog element,
  // not the outer data-radix-popper-content-wrapper.
  const dialogs = document.querySelectorAll('[role="dialog"]');
  for (const dialog of dialogs) {
    if (!isVisible(dialog)) continue;
    const searchInput = dialog.querySelector('input[placeholder*="Search"]');
    if (searchInput) return dialog;
  }

  // Fallback 1: data-radix-popper-content-wrapper with a Search input
  const wrappers = document.querySelectorAll('[data-radix-popper-content-wrapper]');
  for (const wrapper of wrappers) {
    if (!isVisible(wrapper)) continue;
    const searchInput = wrapper.querySelector('input[placeholder*="Search"]');
    if (searchInput) return wrapper;
  }

  // Fallback 2: any visible popover/overlay containing a "Search for Assets" input
  const popovers = document.querySelectorAll(
    '[class*="popover"], [class*="modal"], [class*="overlay"], [class*="dialog"]'
  );
  for (const p of popovers) {
    if (!isVisible(p)) continue;
    const searchInput = p.querySelector('input[placeholder*="Search"]');
    if (searchInput) return p;
  }

  return null;
}

/** Find the search input inside the "Search for Assets" dialog */
export function findAssetSearchInput(dialog: Element): HTMLInputElement | null {
  // Look for input with placeholder containing "Search"
  const inputs = dialog.querySelectorAll('input');
  for (const input of inputs) {
    const placeholder = input.getAttribute('placeholder') || '';
    if (placeholder.toLowerCase().includes('search')) {
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

  // ── Signal 3: loading spinner / circular progress indicator ──
  // Flow may use a material icon 'progress_activity' or a CSS spinner
  const icons = tile.querySelectorAll('i.google-symbols, i.material-icons, i.material-symbols-outlined');
  for (const icon of icons) {
    const txt = icon.textContent?.trim() || '';
    if (txt === 'progress_activity' || txt === 'hourglass_empty' || txt === 'pending') {
      return 'generating';
    }
  }

  // ── Signal 4: error/warning/failure icons → FAILED ──
  for (const icon of icons) {
    const txt = icon.textContent?.trim() || '';
    if (txt === 'error' || txt === 'error_outline' || txt === 'warning' ||
      txt === 'report' || txt === 'report_problem' || txt === 'cancel' ||
      txt === 'block' || txt === 'dangerous') {
      // Make sure this isn't the ingredient chip cancel icon
      const parent = icon.closest('[data-card-open]');
      if (!parent) return 'failed';
    }
  }

  // ── Signal 5: error text overlay ("failed", "error", "violated") ──
  const tileText = tile.textContent?.toLowerCase() || '';
  if (tileText.includes('generation failed') || tileText.includes('violate') ||
    tileText.includes('try again') || tileText.includes('unable to generate') ||
    tileText.includes('blocked')) {
    return 'failed';
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
 *  Uses coordinate jitter for anti-detection.
 *  Does NOT also call native .click() — that would double-fire on
 *  Radix toggle buttons (open → close = net no change).
 */
export function simulateClick(el: Element): void {
  if (el instanceof HTMLElement) el.focus();
  const rect = el.getBoundingClientRect();
  // ±2px coordinate jitter for anti-detection
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
 *  This bypasses React's event delegation entirely — the nuclear option
 *  when dispatched events don't trigger React/Radix state changes.
 *  @param el  The DOM element rendered by React
 *  @param handlerName  e.g. 'onPointerDown', 'onClick'
 *  @returns true if the handler was found and invoked
 */
export function reactTrigger(el: Element, handlerName: string): boolean {
  const propsKey = Object.keys(el).find(k => k.startsWith('__reactProps$'));
  if (!propsKey) return false;
  const props = (el as any)[propsKey];
  if (!props || typeof props[handlerName] !== 'function') return false;

  const rect = el.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  const fakeEvent: Record<string, any> = {
    type: handlerName.replace(/^on/, '').toLowerCase(),
    target: el, currentTarget: el,
    clientX: x, clientY: y, screenX: x, screenY: y,
    pageX: x + window.scrollX, pageY: y + window.scrollY,
    button: 0, buttons: 1,
    ctrlKey: false, metaKey: false, shiftKey: false, altKey: false,
    isPrimary: true, pointerId: 1, pointerType: 'mouse',
    bubbles: true, cancelable: true,
    nativeEvent: { button: 0, ctrlKey: false },
    preventDefault: () => { }, stopPropagation: () => { },
    isPropagationStopped: () => false, isDefaultPrevented: () => false,
    persist: () => { },
  };
  try {
    props[handlerName](fakeEvent);
    return true;
  } catch {
    return false;
  }
}

/** Random human-like delay for anti-detection (ms range) */
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
function slatePaste(el: HTMLElement, text: string): void {
  const dt = new DataTransfer();
  dt.setData('text/plain', text);

  // Dispatch beforeinput with insertFromPaste type — Slate processes this
  const beforeInput = new InputEvent('beforeinput', {
    bubbles: true,
    cancelable: true,
    inputType: 'insertFromPaste',
    dataTransfer: dt,
  } as InputEventInit);
  el.dispatchEvent(beforeInput);

  // Also fire a ClipboardEvent paste as backup — this is what Slate's
  // onPaste handler directly listens for
  const pasteEvent = new ClipboardEvent('paste', {
    bubbles: true,
    cancelable: true,
    clipboardData: dt,
  });
  el.dispatchEvent(pasteEvent);
}

/** Set text in an input/textarea/contenteditable.
 *  For Slate.js editors we use clipboard paste events to avoid
 *  breaking Slate's internal DOM model.
 */
export function setInputValue(el: HTMLElement, text: string): void {
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
      slatePaste(el, text);
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
 * textContent contains a generation count token like "x1".
 * In Video mode the chip text is "Video x1", in Image mode it shows
 * the model name like "Nano Banana 2 x1".
 */
export function findSettingsPanelTrigger(): Element | null {
  const btns = document.querySelectorAll('button[aria-haspopup="menu"]');
  for (const btn of btns) {
    const text = btn.textContent?.toLowerCase() || '';
    if (/x\d/.test(text) && isVisible(btn)) {
      return btn;
    }
  }
  return null;
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

    // Skip the model settings chip (contains "x1", "x2", etc.)
    if (/x\d/.test(text)) continue;

    // Method 1: Look for the hidden span with "View Tile Grid Settings"
    const spans = btn.querySelectorAll('span');
    for (const span of spans) {
      if (span.textContent?.trim().toLowerCase().includes('view tile grid settings')) {
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
 * Find a settings option inside the opened Radix dropdown menu.
 * Flow uses a dropdown menu (aria-haspopup="menu") for settings — NOT tabs.
 * When the menu opens, options appear as role="menuitem" or role="menuitemradio"
 * or as buttons within [role="menu"] / [data-radix-menu-content].
 *
 * Returns the matching element, excluding the settings trigger chip itself.
 */
export function findModeButton(modeName: string): Element | null {
  const lower = modeName.toLowerCase();

  // Primary: role="menuitem" or role="menuitemradio" within the open menu
  const menuItems = document.querySelectorAll(
    '[role="menuitem"], [role="menuitemradio"], [role="option"], [data-radix-collection-item]'
  );
  for (const item of menuItems) {
    const text = item.textContent?.trim().toLowerCase() || '';
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
      const text = btn.textContent?.trim().toLowerCase() || '';
      if (text.includes(lower) && isVisible(btn)) {
        return btn;
      }
    }
  }

  // Tertiary: role="tab" buttons (just in case the UI changes back to tabs)
  const tabs = document.querySelectorAll('button[role="tab"]');
  for (const tab of tabs) {
    const text = tab.textContent?.trim().toLowerCase() || '';
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
      slatePaste(el, ''); // clears selection
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

        slatePaste(el, chunk);

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
 *  In Flow, each ingredient appears as:
 *    <button data-card-open="false" data-state="closed">
 *      <div><img src="/fx/api/trpc/media.getMediaUrlRedirect?name=..." /></div>
 *      <div><i class="google-symbols">cancel</i></div>
 *    </button>
 *  The chips sit inside the prompt composer (div.sc-21faa80e-0)
 *  in an ingredient strip container (div.sc-8f31d1ba-0).
 */
export function findIngredientChips(): Element[] {
  const chips: Element[] = [];

  // Primary: button[data-card-open] within the prompt composer
  // These are the actual ingredient chip buttons with thumbnails
  const promptComposer = findPromptComposer();
  if (promptComposer) {
    const cardBtns = promptComposer.querySelectorAll('button[data-card-open]');
    for (const btn of cardBtns) {
      if (isVisible(btn)) chips.push(btn);
    }
  }

  // If we found chips via the primary method, return them
  if (chips.length > 0) return chips;

  // Fallback 1: button[data-card-open] anywhere on the page
  const globalCards = document.querySelectorAll('button[data-card-open]');
  for (const btn of globalCards) {
    if (isVisible(btn) && !chips.includes(btn)) chips.push(btn);
  }
  if (chips.length > 0) return chips;

  // Fallback 2: img elements within the ingredient strip container
  const strips = document.querySelectorAll('[class*="sc-8f31d1ba"], [class*="sc-d9d2dca3"]');
  for (const strip of strips) {
    const imgs = strip.querySelectorAll('img');
    for (const img of imgs) {
      if (isVisible(img) && !chips.includes(img)) chips.push(img);
    }
  }

  // Fallback 3: look for images near the prompt input (inside its ancestor containers)
  if (chips.length === 0) {
    const promptInput = findPromptInput();
    if (promptInput) {
      let container: Element | null = promptInput;
      for (let i = 0; i < 6 && container; i++) container = container.parentElement;
      if (container) {
        const imgs = container.querySelectorAll('img[src*="media.getMediaUrlRedirect"], img[src*="blob:"]');
        for (const img of imgs) {
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
        text.toLowerCase().includes('try again') ||
        text.toLowerCase().includes('violate') ||
        text.toLowerCase().includes('unable') ||
        text.toLowerCase().includes('not been charged'))) {
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
      if (span.textContent?.trim() === 'Retry') return btn;
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
      if (span.textContent?.trim() === 'Reuse Prompt') return btn;
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
    const id = findTileId(card);
    if (id) ids.push(id);
  }
  return ids;
}

/**
 * Get the state of a specific tile by its data-tile-id.
 * Returns null if the tile is not found.
 */
export function getTileStateById(tileId: string): TileState | null {
  const el = document.querySelector(`div[data-tile-id="${CSS.escape(tileId)}"]`);
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
export async function scrollAndCollectAllTileStates(): Promise<Array<{ tileId: string; state: TileState }>> {
  const scroller = findOutputScroller();

  // Helper: collect all data-tile-id elements currently in the DOM
  const collected = new Map<string, { state: TileState; order: number }>();

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

      collected.set(tileId, { state: getTileState(tile), order });
    }
  }

  if (!scroller) {
    // No scrollable area — just collect what is visible now
    collectVisible();
    const sorted = Array.from(collected.entries()).sort((a, b) => a[1].order - b[1].order);
    return sorted.map(([tileId, { state }]) => ({ tileId, state }));
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
  return sorted.map(([tileId, { state }]) => ({ tileId, state }));
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

