/* ============================================================
   Grok Auto – DOM Selectors for grok.com/imagine
   Tiptap/ProseMirror editor + Radix UI components
   ============================================================ */

/** Check if an element is visible on the page */
export function isVisible(el: Element): boolean {
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return false;
  const style = window.getComputedStyle(el);
  return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
}

/** Find the prompt input (Tiptap ProseMirror editor) */
export function findPromptInput(): HTMLElement | null {
  // Primary: Tiptap ProseMirror editor
  const tiptap = document.querySelector('div.tiptap.ProseMirror') as HTMLElement;
  if (tiptap && isVisible(tiptap)) return tiptap;

  // Fallback: any contenteditable with prompt-like context
  const editables = document.querySelectorAll('[contenteditable="true"]');
  for (const el of editables) {
    if (isVisible(el as HTMLElement)) return el as HTMLElement;
  }

  // Fallback: textarea
  const textareas = document.querySelectorAll('textarea');
  for (const ta of textareas) {
    if (isVisible(ta)) return ta;
  }
  return null;
}

/** Find the generate/submit button */
export function findGenerateButton(): HTMLElement | null {
  // Look for the submit button near the input area
  // It's typically a button with an arrow icon
  const buttons = document.querySelectorAll('button');
  for (const btn of buttons) {
    const ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase();
    // Match common submit labels across languages
    if (
      ariaLabel.includes('submit') ||
      ariaLabel.includes('send') ||
      ariaLabel.includes('generate') ||
      ariaLabel.includes('make video') ||  // Grok video mode
      ariaLabel.includes('make image') ||  // Grok image mode
      ariaLabel.includes('valider') ||  // French
      ariaLabel.includes('إرسال')      // Arabic
    ) {
      if (isVisible(btn) && !btn.disabled) return btn;
    }
  }

  // Fallback: find the button with an up-arrow SVG near the prompt input
  const input = findPromptInput();
  if (input) {
    let parent = input.parentElement;
    for (let i = 0; i < 5 && parent; i++) {
      parent = parent.parentElement;
    }
    if (parent) {
      const btns = parent.querySelectorAll('button');
      // The last button near the input is usually the submit
      const visibleBtns = Array.from(btns).filter(b => isVisible(b) && !b.disabled);
      if (visibleBtns.length > 0) return visibleBtns[visibleBtns.length - 1];
    }
  }
  return null;
}

/** Check if the generate button is enabled */
export function isGenerateEnabled(): boolean {
  const btn = findGenerateButton();
  if (!btn) return false;
  return !btn.hasAttribute('disabled') && btn.getAttribute('aria-disabled') !== 'true';
}

/** Find a radio button by its text content */
export function findRadioButton(text: string): HTMLElement | null {
  const radios = document.querySelectorAll('button[role="radio"]');
  for (const radio of radios) {
    const content = radio.textContent?.trim().toLowerCase() || '';
    if (content === text.toLowerCase() && isVisible(radio as HTMLElement)) {
      return radio as HTMLElement;
    }
  }
  return null;
}

/** Check if a radio button is active/selected */
export function isRadioActive(el: HTMLElement): boolean {
  return (
    el.getAttribute('data-state') === 'on' ||
    el.getAttribute('aria-checked') === 'true' ||
    el.getAttribute('data-state') === 'active' ||
    el.classList.contains('active')
  );
}

/** Find the aspect ratio/proportions trigger button */
export function findProportionsButton(): HTMLElement | null {
  const buttons = document.querySelectorAll('button');
  for (const btn of buttons) {
    const label = (btn.getAttribute('aria-label') || '').toLowerCase();
    if (
      label.includes('proportion') ||
      label.includes('aspect') ||
      label.includes('ratio')
    ) {
      if (isVisible(btn)) return btn;
    }
  }
  // Fallback: look for button with ratio text like "2:3"
  for (const btn of buttons) {
    const text = btn.textContent?.trim() || '';
    if (/^\d+:\d+$/.test(text) && isVisible(btn)) return btn;
  }
  return null;
}

/** Find a menu item by text (for aspect ratio dropdown) */
export function findMenuItem(text: string): HTMLElement | null {
  const items = document.querySelectorAll('[role="menuitem"], [role="menuitemradio"], [role="option"]');
  for (const item of items) {
    const content = item.textContent?.trim().toLowerCase() || '';
    if (content.includes(text.toLowerCase()) && isVisible(item as HTMLElement)) {
      return item as HTMLElement;
    }
  }
  return null;
}

/** Find all output tiles/cards in the gallery */
export function findOutputTiles(): HTMLElement[] {
  // Grok uses a grid of generated images
  const selectors = [
    '[data-testid*="image"]',
    '[data-testid*="output"]',
    '.grid img',
    'main img[src*="grok"]',
  ];
  for (const sel of selectors) {
    const els = document.querySelectorAll(sel);
    if (els.length > 0) return Array.from(els) as HTMLElement[];
  }

  // Fallback: find image cards in main content
  const main = document.querySelector('main') || document.body;
  const images = main.querySelectorAll('img[src]');
  return Array.from(images).filter(img => {
    const src = (img as HTMLImageElement).src || '';
    return isVisible(img as HTMLElement) && !src.startsWith('data:') && !src.includes('icon');
  }) as HTMLElement[];
}

/** Check if generation is in progress (loading indicators) */
export function isGenerating(): boolean {
  // Look for loading spinners, progress indicators
  const spinners = document.querySelectorAll(
    '[class*="loading"], [class*="spinner"], [class*="progress"], [role="progressbar"]'
  );
  for (const s of spinners) {
    if (isVisible(s as HTMLElement)) return true;
  }

  // Check for skeleton/placeholder elements
  const skeletons = document.querySelectorAll('[class*="skeleton"], [class*="pulse"]');
  for (const s of skeletons) {
    if (isVisible(s as HTMLElement)) return true;
  }

  // Check if generate button is disabled (in-progress)
  const btn = findGenerateButton();
  if (btn && (btn.hasAttribute('disabled') || btn.getAttribute('aria-disabled') === 'true')) {
    return true;
  }

  return false;
}

/** Simulate a natural click on an element */
export function simulateClick(el: Element) {
  if (el instanceof HTMLElement) el.focus();
  const rect = el.getBoundingClientRect();
  const x = rect.left + rect.width / 2 + (Math.random() * 4 - 2);
  const y = rect.top + rect.height / 2 + (Math.random() * 4 - 2);

  const eventOpts: any = {
    bubbles: true, cancelable: true, view: window,
    clientX: x, clientY: y, screenX: x, screenY: y,
    button: 0, buttons: 1,
  };

  const pointerOpts = { ...eventOpts, pointerId: 1, pointerType: 'mouse', isPrimary: true };
  el.dispatchEvent(new PointerEvent('pointerdown', pointerOpts));
  el.dispatchEvent(new MouseEvent('mousedown', eventOpts));
  el.dispatchEvent(new PointerEvent('pointerup', pointerOpts));
  el.dispatchEvent(new MouseEvent('mouseup', eventOpts));
  el.dispatchEvent(new MouseEvent('click', eventOpts));
}

/** Fill a contenteditable/textarea with text via paste simulation */
export function fillPromptText(el: HTMLElement, text: string) {
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
    const setter = Object.getOwnPropertyDescriptor(
      el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
      'value'
    )?.set;
    if (setter) setter.call(el, text);
    else el.value = text;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  } else if (el.getAttribute('contenteditable') === 'true') {
    el.focus();
    // Select all existing content
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(el);
    sel?.removeAllRanges();
    sel?.addRange(range);

    // Paste new text
    const dt = new DataTransfer();
    dt.setData('text/plain', text);
    const pasteEvent = new ClipboardEvent('paste', {
      bubbles: true, cancelable: true, clipboardData: dt,
    });
    el.dispatchEvent(pasteEvent);

    // Fallback: insertText only if paste clearly failed (almost nothing was inserted)
    // Use length check instead of exact match — ProseMirror may transform content
    // (e.g. @Image1 becomes a mention chip, changing textContent)
    const insertedLength = (el.textContent || '').trim().length;
    if (insertedLength < Math.min(text.length * 0.3, 5)) {
      document.execCommand('insertText', false, text);
    }

    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

/** Find the image upload button (the + or Upload button) */
export function findUploadButton(): HTMLElement | null {
  // Primary: button with aria-label "Upload"
  const buttons = document.querySelectorAll('button');
  for (const btn of buttons) {
    const label = (btn.getAttribute('aria-label') || '').toLowerCase();
    if (
      label.includes('upload') ||
      label.includes('télécharger') ||  // French
      label.includes('attach') ||
      label.includes('add image') ||
      label.includes('ajouter')
    ) {
      if (isVisible(btn)) return btn;
    }
  }

  // Fallback: find a button with a "+" icon near the prompt input
  const input = findPromptInput();
  if (input) {
    let parent = input.parentElement;
    for (let i = 0; i < 5 && parent; i++) {
      parent = parent.parentElement;
    }
    if (parent) {
      const btns = parent.querySelectorAll('button');
      for (const btn of btns) {
        const text = btn.textContent?.trim() || '';
        const svg = btn.querySelector('svg');
        // Look for a "+" icon or upload icon button
        if (svg && isVisible(btn) && !btn.hasAttribute('type')) {
          return btn;
        }
      }
    }
  }
  return null;
}

/** Find the hidden file input for image uploads */
export function findFileInput(): HTMLInputElement | null {
  // Primary: input with name="files"
  const byName = document.querySelector('input[name="files"][type="file"]') as HTMLInputElement;
  if (byName) return byName;

  // Fallback: any file input that accepts images
  const fileInputs = document.querySelectorAll('input[type="file"]');
  for (const fi of fileInputs) {
    const accept = fi.getAttribute('accept') || '';
    if (accept.includes('image')) return fi as HTMLInputElement;
  }

  // Last resort: any hidden file input
  for (const fi of fileInputs) {
    return fi as HTMLInputElement;
  }
  return null;
}

/**
 * Inject files into a file input element programmatically.
 * Uses DataTransfer API to simulate file selection.
 */
export function injectFilesToInput(input: HTMLInputElement, files: File[]): boolean {
  try {
    const dt = new DataTransfer();
    for (const file of files) {
      dt.items.add(file);
    }
    input.files = dt.files;

    // Dispatch change event to notify React/framework
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  } catch (err) {
    console.error('[GrokAuto] Failed to inject files:', err);
    return false;
  }
}

/** Check if images/uploads are currently visible in the upload area */
export function hasUploadedImages(): boolean {
  // Look for thumbnail images in the upload area
  const uploadArea = document.querySelector('[class*="upload"], [class*="preview"]');
  if (uploadArea) {
    const imgs = uploadArea.querySelectorAll('img');
    return imgs.length > 0;
  }
  // Fallback: check for remove/delete buttons near images
  const removeButtons = document.querySelectorAll('button[aria-label*="remove"], button[aria-label*="delete"], button[aria-label*="supprimer"]');
  return removeButtons.length > 0;
}

/** Random delay between min and max milliseconds */
export function randomDelay(min: number, max: number): Promise<void> {
  const ms = min + Math.random() * (max - min);
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Simple delay */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ================================================================
// TILE STATE DETECTION (Generation Progress Monitoring)
// ================================================================

export type TileState = 'generating' | 'completed' | 'failed' | 'idle';

export interface TileInfo {
  element: Element;
  state: TileState;
  progress: number | null;  // 0-100 if generating, null otherwise
  hasVideo: boolean;
  hasCancelBtn: boolean;
  textContent: string;
}

export interface PageSnapshot {
  totalTiles: number;
  generating: number;
  completed: number;
  failed: number;
  idle: number;
  tiles: TileInfo[];
}

/**
 * Find all generation tiles on the page.
 * Grok renders each generation as a button.snap-start inside
 * the output area, or as cards in the main feed.
 */
export function getGenerationTiles(): Element[] {
  const tiles: Element[] = [];

  // Strategy 1: button.snap-start tiles (Grok Imagine output area)
  const snapTiles = document.querySelectorAll('button.snap-start');
  for (const t of snapTiles) {
    if (isVisible(t as HTMLElement)) tiles.push(t);
  }

  // Strategy 2: If no snap-start tiles, look for video containers
  if (tiles.length === 0) {
    const videos = document.querySelectorAll('video');
    for (const v of videos) {
      // Walk up to find the tile container (usually 3-5 levels up)
      let parent: Element | null = v.parentElement;
      for (let i = 0; i < 5 && parent; i++) {
        if (parent.tagName === 'BUTTON' || parent.classList.contains('snap-start')) {
          if (isVisible(parent as HTMLElement) && !tiles.includes(parent)) tiles.push(parent);
          break;
        }
        parent = parent.parentElement;
      }
    }
  }

  // Strategy 3: Sidebar video/image tiles (button.relative)
  if (tiles.length === 0) {
    const allBtns = document.querySelectorAll('button.relative');
    for (const btn of allBtns) {
      if (!isVisible(btn as HTMLElement)) continue;
      
      // If the button has a valid tile state (generating/completed/failed), it's a generation tile
      const state = getTileState(btn);
      if (state !== 'idle' && !tiles.includes(btn)) {
        tiles.push(btn);
      }
    }
  }

  return tiles;
}

/**
 * Detect the state of a single generation tile.
 * - generating: has progress % text or "Génération en cours" or cancel button
 * - completed: has a video element with src, no cancel button
 * - failed: has error text or failed indicators
 * - idle: none of the above
 */
export function getTileState(tile: Element): TileState {
  const text = (tile.textContent || '').toLowerCase();

  // Check for cancel button = generating
  if (findCancelButton(tile)) return 'generating';

  // Check for progress text = generating
  if (/génération en cours/i.test(text) || /generation in progress/i.test(text)) return 'generating';
  if (/\d+%/.test(tile.textContent || '') && !text.includes('download')) return 'generating';

  // Check for error indicators = failed
  if (text.includes('failed') || text.includes('échoué') || text.includes('error') ||
      text.includes('erreur') || text.includes('try again') || text.includes('réessayer')) {
    return 'failed';
  }

  // Check for completed video/image = completed
  const hasVideo = !!tile.querySelector('video[src], video source[src]');
  const hasImg = !!tile.querySelector('img[src*="grok"], img[src*="blob:"]');
  if (hasVideo || hasImg) return 'completed';

  // Check for action buttons (download, heart) = completed
  const btns = tile.querySelectorAll('button[aria-label]');
  for (const b of btns) {
    const label = (b.getAttribute('aria-label') || '').toLowerCase();
    if (label.includes('download') || label.includes('télécharger') ||
        label.includes('save') || label.includes('enregistrer')) {
      return 'completed';
    }
  }

  return 'idle';
}

/**
 * Extract the progress percentage from a generating tile.
 * Looks for text like "16%", "39%", etc.
 * Returns null if no progress found.
 */
export function getProgressPercent(tile: Element): number | null {
  const text = tile.textContent || '';
  // Match standalone percentages (not part of "720p" etc.)
  const matches = text.match(/(\d{1,3})%/g);
  if (!matches) return null;

  // Filter out resolution strings like "720p" that might be nearby
  for (const match of matches) {
    const num = parseInt(match, 10);
    if (num >= 0 && num <= 100) return num;
  }
  return null;
}

/**
 * Find the "Annuler" (Cancel) or "Cancel" button on a tile.
 * Present only during active generation.
 */
export function findCancelButton(tile: Element): HTMLElement | null {
  const btns = tile.querySelectorAll('button');
  for (const btn of btns) {
    const text = (btn.textContent || '').trim().toLowerCase();
    if (text === 'annuler' || text === 'cancel') {
      if (isVisible(btn as HTMLElement)) return btn as HTMLElement;
    }
  }
  // Also check for aria-label
  for (const btn of btns) {
    const label = (btn.getAttribute('aria-label') || '').toLowerCase();
    if (label.includes('annuler') || label.includes('cancel')) {
      if (isVisible(btn as HTMLElement)) return btn as HTMLElement;
    }
  }
  return null;
}

/**
 * Find the scrollable container for the generation output.
 * Grok uses data-imagine-scroll attribute or a scrollable div.
 */
export function findScrollContainer(): HTMLElement | null {
  // Primary: data-imagine-scroll
  const imgScroll = document.querySelector('[data-imagine-scroll="true"]') as HTMLElement;
  if (imgScroll) return imgScroll;

  // Fallback: scrollable parent of tiles
  const tiles = getGenerationTiles();
  if (tiles.length > 0) {
    let parent: Element | null = tiles[0].parentElement;
    while (parent && parent !== document.documentElement) {
      const el = parent as HTMLElement;
      if (el.scrollHeight > el.clientHeight + 10) return el;
      parent = parent.parentElement;
    }
  }

  return null;
}

/**
 * Check if ALL current generations are done (no more generating tiles).
 */
export function isGenerationDone(): boolean {
  const tiles = getGenerationTiles();
  if (tiles.length === 0) return true;
  return tiles.every(t => getTileState(t) !== 'generating');
}

/**
 * Take a snapshot of all tiles on the page with their states.
 * Returns counts and per-tile details.
 */
export function getPageSnapshot(): PageSnapshot {
  const tiles = getGenerationTiles();
  const infos: TileInfo[] = [];
  let generating = 0, completed = 0, failed = 0, idle = 0;

  for (const tile of tiles) {
    const state = getTileState(tile);
    const progress = state === 'generating' ? getProgressPercent(tile) : null;
    const hasVideo = !!tile.querySelector('video[src], video source[src]');
    const hasCancelBtn = !!findCancelButton(tile);
    const textContent = (tile.textContent || '').trim().substring(0, 200);

    infos.push({ element: tile, state, progress, hasVideo, hasCancelBtn, textContent });

    if (state === 'generating') generating++;
    else if (state === 'completed') completed++;
    else if (state === 'failed') failed++;
    else idle++;
  }

  return { totalTiles: tiles.length, generating, completed, failed, idle, tiles: infos };
}

// ================================================================
// VIDEO EXTEND SELECTORS
// ================================================================

/**
 * Find the "More options" (...) button on a completed tile.
 * Grok renders this as button[aria-label="More options"] inside the tile area.
 */
export function findMoreOptionsButton(tile?: Element): HTMLElement | null {
  // If a specific tile is provided, look inside it
  if (tile) {
    const btn = tile.querySelector('button[aria-label="More options"]') as HTMLElement;
    if (btn && isVisible(btn)) return btn;
  }

  // Also check the floating action buttons near the current video view
  const allBtns = document.querySelectorAll('button[aria-label="More options"]');
  for (const btn of allBtns) {
    if (isVisible(btn as HTMLElement)) return btn as HTMLElement;
  }
  return null;
}

/**
 * Find the "Extend video" menu item in the Radix dropdown.
 * It's a div[role="menuitem"] that contains "Extend" text.
 */
export function findExtendVideoMenuItem(): HTMLElement | null {
  const menuItems = document.querySelectorAll('div[role="menuitem"]');
  for (const item of menuItems) {
    const text = (item.textContent || '').toLowerCase();
    if (text.includes('extend') && isVisible(item as HTMLElement)) {
      return item as HTMLElement;
    }
  }
  return null;
}

/**
 * Find the duration chip button for video extend (+6s or +10s).
 * These appear as small chip buttons in the extend mode UI.
 */
export function findExtendDurationChip(duration: '+6s' | '+10s'): HTMLElement | null {
  const allBtns = document.querySelectorAll('button');
  for (const btn of allBtns) {
    const text = (btn.textContent || '').trim();
    if (text === duration && isVisible(btn as HTMLElement)) return btn as HTMLElement;
  }
  return null;
}

/**
 * Check if the page is in "Extend video" mode.
 * Detected by a child <p data-placeholder="Extend video"> inside the Tiptap editor.
 */
export function isInExtendMode(): boolean {
  // Method 1: Check for <p data-placeholder="Extend video"> inside the editor
  const placeholderPs = document.querySelectorAll('p[data-placeholder]');
  for (const p of placeholderPs) {
    const ph = (p.getAttribute('data-placeholder') || '').toLowerCase();
    if (ph.includes('extend')) return true;
  }

  // Method 2: Check data-placeholder on the editor itself
  const input = findPromptInput();
  if (input) {
    const placeholder = input.getAttribute('data-placeholder') || '';
    if (placeholder.toLowerCase().includes('extend')) return true;
  }

  // Method 3: Check for the "× Extend Video" chip near the input
  const allBtns = document.querySelectorAll('button');
  for (const btn of allBtns) {
    const text = (btn.textContent || '').toLowerCase().trim();
    if (text.includes('extend video') && isVisible(btn as HTMLElement)) return true;
  }

  return false;
}

// ================================================================
// PAGE-LEVEL VIDEO STATE DETECTION
// These detect the state of the MAIN video player area (full-page view),
// NOT sidebar tiles. Used by the Video Extend chain workflow.
// ================================================================

/**
 * Check if the page is actively generating a video.
 * Detects: "Generating" text with animate-pulse class, or "Cancel Video" button.
 */
export function isPageVideoGenerating(): boolean {
  // Method 1: Look for "Generating" text in animate-pulse spans
  const pulseSpans = document.querySelectorAll('span.animate-pulse');
  for (const span of pulseSpans) {
    const text = (span.textContent || '').trim().toLowerCase();
    if (text === 'generating' || /^\d+%$/.test(span.textContent?.trim() || '')) {
      return true;
    }
  }

  // Method 2: Look for "Cancel Video" button
  const allBtns = document.querySelectorAll('button');
  for (const btn of allBtns) {
    const text = (btn.textContent || '').trim().toLowerCase();
    if (text.includes('cancel video') && isVisible(btn as HTMLElement)) return true;
  }

  return false;
}

/**
 * Check if the page shows a completed video.
 * Detects: video#sd-video with src, or action buttons (Download, More options).
 */
export function isPageVideoCompleted(): boolean {
  // Method 1: video#sd-video with a real src URL
  const sdVideo = document.querySelector('video#sd-video') as HTMLVideoElement;
  if (sdVideo && sdVideo.src && sdVideo.src.includes('generated_video')) {
    return true;
  }

  // Method 2: Any video with a generated_video src
  const allVideos = document.querySelectorAll('video[src]');
  for (const v of allVideos) {
    const src = (v as HTMLVideoElement).src || '';
    if (src.includes('generated_video') && isVisible(v as HTMLElement)) return true;
  }

  // Method 3: Download + More options buttons visible together = completed
  let hasDownload = false;
  let hasMoreOptions = false;
  const btns = document.querySelectorAll('button[aria-label]');
  for (const btn of btns) {
    if (!isVisible(btn as HTMLElement)) continue;
    const label = (btn.getAttribute('aria-label') || '').toLowerCase();
    if (label === 'download') hasDownload = true;
    if (label === 'more options') hasMoreOptions = true;
  }
  if (hasDownload && hasMoreOptions) return true;

  return false;
}

/**
 * Get the current video generation progress percentage from the page.
 * Reads the animate-pulse span that contains "XX%".
 * Returns -1 if no progress found.
 */
export function getPageVideoProgress(): number {
  const pulseSpans = document.querySelectorAll('span.animate-pulse');
  for (const span of pulseSpans) {
    const text = (span.textContent || '').trim();
    const match = text.match(/^(\d+)%$/);
    if (match) return parseInt(match[1], 10);
  }

  // Fallback: search all text on page for generating percentage
  const allText = document.body.innerText || '';
  const genMatch = allText.match(/Generating\s+(\d+)%/i);
  if (genMatch) return parseInt(genMatch[1], 10);

  return -1;
}
