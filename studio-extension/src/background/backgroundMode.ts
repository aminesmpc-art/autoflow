/**
 * AutoFlow Motion's background mode: stricter than Studio's beta.
 *
 * Studio's "Background tabs (beta)" (`af_background_tabs`) stops the routine
 * foreground grab, but still raises the provider tab at each hand-off and
 * before every Flow upload. Studio's user is watching the canvas, so showing
 * where the work went is a feature there.
 *
 * Motion's user asked for the opposite: "work fully in the background without
 * me to see the tab". So Motion sets this key as well, and then nothing raises
 * a provider tab on its own initiative. The one exception is a click that
 * cannot happen without layout, and that one hands the window back afterwards
 * (see debugUpload.ts). Anything that genuinely needs a person is reported in
 * the panel instead, as the beta already does for "needs attention".
 *
 * Studio never sets this key, so none of its behaviour changes.
 */
export const BACKGROUND_STRICT_KEY = 'af_background_strict';

/** True only when both keys are on. A stray strict key without the beta never half-enables it. */
export async function backgroundStrict(): Promise<boolean> {
  try {
    const got = await chrome.storage.local.get(['af_background_tabs', BACKGROUND_STRICT_KEY]);
    return got?.af_background_tabs === true && got?.[BACKGROUND_STRICT_KEY] === true;
  } catch {
    /* Unreadable settings must not silently change who owns the window. */
    return false;
  }
}

/** What to put back after showing a tab for a moment: the tab that was in front, and the focused window. */
export type Shown = { previousTabId?: number; windowId?: number; focusedWindowId?: number };

/**
 * Bring a tab forward for an action that needs layout, remembering what was
 * in front so `handBack` can restore it. Never throws: a tab that cannot be
 * shown is still worth trying, and the action reports what it finds.
 */
export async function showBriefly(tabId: number): Promise<Shown> {
  const shown: Shown = {};
  try {
    const tab = await chrome.tabs.get(tabId);
    shown.windowId = tab.windowId;
    /* No "tabs" permission is needed for ids: only url and title are withheld. */
    const [front] = await chrome.tabs.query({ active: true, windowId: tab.windowId });
    if (front?.id != null && front.id !== tabId) shown.previousTabId = front.id;
    const focused = await chrome.windows.getLastFocused().catch(() => undefined);
    if (focused?.id != null && focused.id !== tab.windowId) shown.focusedWindowId = focused.id;
    await chrome.tabs.update(tabId, { active: true });
    if (tab.windowId != null) await chrome.windows.update(tab.windowId, { focused: true });
  } catch { /* best effort */ }
  return shown;
}

/** Put back the tab and window that were in front before `showBriefly`. */
export async function handBack(shown: Shown): Promise<void> {
  if (shown.previousTabId != null) {
    await chrome.tabs.update(shown.previousTabId, { active: true }).catch(() => {});
  }
  if (shown.focusedWindowId != null) {
    await chrome.windows.update(shown.focusedWindowId, { focused: true }).catch(() => {});
  }
}
