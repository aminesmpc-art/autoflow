/**
 * Attaching a video that is already in the Flow library.
 *
 * ── Why this is the half worth automating ─────────────────────────────────
 *
 * Getting a file INTO Flow cannot be automated. Five routes were tried against
 * the live site and all are dead — see ./uploadVideo.ts for the list and the
 * evidence. What that leaves is a division of labour:
 *
 *   once, by hand   the clipper picks the file through Flow's own dialog
 *   every time      this finds it by name and attaches it
 *
 * So a style reference costs one file pick ever, not one per clip. That is the
 * difference between a usable feature and a chore.
 *
 * ── The selectors, and where they came from ───────────────────────────────
 *
 * Every one was read off the live page rather than guessed:
 *
 *   the composer +    button inside flow-add-menu / .add-menu-container,
 *                     aria "Add ingredients to the prompt box". NOT in the
 *                     ingredient bar, and not the toolbar's "Add media menu"
 *   the Videos tab    mat-list-item[role=tab] reading "videocamVideos",
 *                     INSIDE the overlay — the project's left rail has an
 *                     identical one that navigates away instead
 *   the picker itself the overlay holding the Upload button — see
 *                     mediaDialogRoot, and note it has NO dialog role
 *   the search box    input.search-input, whose label and placeholder are
 *                     translated but whose class is not
 *   a result          the <video> INSIDE the picker
 *   the confirm       a button reading "Add to Prompt"
 *
 * The result is found STRUCTURALLY and never by class. Flow's picker tiles are
 * styled-components — `class="sc-441e676a-0 TtAWs"`, no role, no data-test-id,
 * cursor:auto at every level — and those hashes change on every deploy. A
 * class selector here would work until the next Friday and then fail silently.
 *
 * Material's icon ligatures are why the labels look like "videocamVideos": the
 * glyph name renders as text next to the word. It does not translate, which
 * makes it a better anchor than the word beside it.
 */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

import { matchesFlowText, searchInputSelector } from './flowStrings';
import { ingredientChips, isMediaImage, MEDIA_IMG_SELECTOR } from './flowDom';

export interface AttachResult {
  ok: boolean;
  /** What stopped it, in words the clipper can act on. */
  reason?: string;
}

interface Deps {
  /** Injected so the whole thing can be exercised against a built DOM. */
  doc?: Document;
  log?: (line: string) => void;
  /** Shortened in tests; these are real waits on a real page. */
  step?: number;
  /**
   * How long to wait for Flow to paint before giving up — see waitForFlowUi.
   *
   * Defaults to 30s on a real page and to nothing when `step` is 0, which is
   * this file's existing signal for "a test, no real waits".
   */
  uiWaitMs?: number;
  /**
   * What the caller actually needs open.
   *
   * 'upload' — anything that can raise a file chooser. The project toolbar's
   *   Add-media menu qualifies, and the CDP upload has always used it happily.
   * 'library' — the asset picker itself, with its tabs and its search box.
   *   Nothing else will do: attachFromLibrary has to search by name.
   *
   * They were the same test until the toolbar menu satisfied it and the attach
   * then failed inside a menu with no search box.
   */
  need?: 'upload' | 'library';
}



/**
 * A click Flow will believe.
 *
 * The picker's controls are React/Angular composites that listen for the
 * pointer sequence rather than a bare click, so a lone `.click()` lands on
 * some of them and not others.
 */
function press(el: HTMLElement): void {
  const rect = el.getBoundingClientRect();
  const at = {
    clientX: rect.left + rect.width / 2,
    clientY: rect.top + rect.height / 2,
    bubbles: true,
    cancelable: true,
  };
  for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
    const Ctor = type.startsWith('pointer') && typeof PointerEvent === 'function'
      ? PointerEvent
      : MouseEvent;
    el.dispatchEvent(new Ctor(type, at as any));
  }
}

/** Type into a React-controlled input so the framework sees the change. */
function typeInto(input: HTMLInputElement, value: string): void {
  const proto = Object.getOwnPropertyDescriptor(
    (input.ownerDocument?.defaultView || window).HTMLInputElement.prototype,
    'value',
  );
  input.focus();
  proto?.set?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

/** The ingredients currently on the prompt, so an attach can be confirmed. */
export function attachedCount(doc: Document = document): number {
  const dialogOpen = doc.querySelector('[role="dialog"], mat-dialog-container');
  if (dialogOpen) return 0;                    // the picker's own media is not a chip
  /* Counted by component first. Measured on flow.google.com, the old test —
     img[src*="media.getMediaUrlRedirect"] — matches ZERO images while the real
     ingredients match four: the tRPC endpoint it named is gone, and media now
     comes from flow-content.google. An ingredient is an ingredient because it
     is an ingredient chip, not because of where its thumbnail is served from,
     so the component name is both more durable and more honest. */
  const chips = ingredientChips(doc);
  if (chips.length) return chips.length;

  /* The old site, which still resolves on labs.google. */
  const box = Array.from(doc.querySelectorAll('textarea,[contenteditable="true"]')).pop();
  if (!box) return 0;
  let scope: HTMLElement | null = box as HTMLElement;
  for (let i = 0; i < 4 && scope?.parentElement; i++) scope = scope.parentElement;
  return scope ? scope.querySelectorAll(MEDIA_IMG_SELECTOR).length : 0;
}

/**
 * Has Flow painted anything this can act on?
 *
 * ── Why the precondition is stated as itself ──────────────────────────────
 *
 * Not "is the page loaded" — that is unanswerable from here and every proxy
 * for it is a guess. The question openMediaDialog actually needs answered is
 * narrower and exact: is ANY of the things it is about to look for on the
 * page? If none of them are, it has nothing to do and no amount of clicking
 * will change that.
 *
 * It matters because of what the failure looked like without it:
 *
 *   02:01:44  The upload failed: the Videos tab is not where it was —
 *             Flow has changed. Buttons on the page: ⚡ Open Studio
 *
 * One button, and it is AutoFlow's own. Flow had rendered nothing at all. The
 * run had just spent eighty seconds in a Gemini conversation, and Chrome had
 * discarded or was still repainting the backgrounded Flow tab — so the picker
 * was asked to open on a blank page, gave up in under two seconds, and blamed
 * Google for changing a tab it had never seen.
 */
export function flowUiPresent(doc: Document = document): boolean {
  /* A real Videos tab counts too: it exists only inside the picker, so seeing
     one means the picker is already open. That signal was unsafe until the
     attached ingredient chip stopped matching it — see videosTab — because the
     chip's videocam badge is on the page whether the picker is up or not. */
  return !!(uploadButtons(doc).length || videosTab(doc)
    || composerAddButton(doc) || mediaMenuButton(doc));
}

/**
 * Flow's asset picker, told apart from every other overlay on the page.
 *
 * ── Why "has an Upload button" was never enough ───────────────────────────
 *
 * The project toolbar's Add-media button opens a small menu, and that menu
 * contains an Upload item. Read off the live page:
 *
 *   div.cdk-overlay-pane
 *     "uploadUpload · folderNew collection · account_circleCreate character
 *      · play_moviesNew scene"
 *     hasSearch: false   tabs: 0
 *
 * uploadButtons() matches that "uploadUpload" — correctly, it does open a file
 * chooser — so openMediaDialog reported success on it, and the attach that
 * followed then said "no Videos tab in the dialog" and "the picker is open but
 * has no search box in it". Both true. It was not the picker.
 *
 * The picker itself, from the same read:
 *
 *   div.cdk-overlay-pane > flow-add-menu-popover-content
 *     > .add-menu-popover-container.flow-menu-panel > .panels-layout
 *       > flow-add-menu-side-nav > mat-nav-list > mat-list-item   (7 tabs)
 *       > .right-panel > header.search-header > input.search-input
 *
 * Named Angular components, which is the anchor this file trusts. The
 * search-box-and-tabs test is the fallback for a layout that renames them.
 */
const PICKER_PARTS =
  'flow-add-menu-popover-content, .add-menu-popover-container, flow-add-menu-side-nav';

export function assetPickerPane(doc: Document = document): HTMLElement | null {
  const panes = Array.from(doc.querySelectorAll<HTMLElement>(
    '.cdk-overlay-pane, [role="dialog"], mat-dialog-container',
  ));
  /* A search box is the whole discriminator, and it is the thing the caller
     came for. The toolbar menu has none — measured, not assumed:

       toolbar menu   hasSearch: false   tabs: 0
       asset picker   hasSearch: true    tabs: 7

     Requiring a [role="tab"] as well was tried and is too strict: an older
     Flow renders its tabs as plain buttons, and a picker with a search box and
     no ARIA roles is still a picker. */
  const isDialog = (p: HTMLElement) =>
    p.matches('[role="dialog"], mat-dialog-container')
    || !!p.querySelector('[role="dialog"], mat-dialog-container');

  return panes.find((p) => (
    p.querySelector(PICKER_PARTS) || p.querySelector(searchInputSelector()) || isDialog(p)
  )) || null;
}

/**
 * Where the picker's contents live once it is open, and where they do NOT.
 *
 * `.ingredients-list` is deliberately absent: it belongs to flow-batch-info —
 * a PAST generation's ingredient row — not to the composer. flowDom.ts has
 * always listed it under BATCH_INGREDIENTS for exactly that reason, and
 * putting it here treated an old batch's chips as the live prompt.
 */
const CHIP_AREAS =
  'flow-ingredient-chip, flow-video-ingredient-chip, flow-image-ingredient-chip, '
  + 'flow-ingredient-bar, .ingredient-bar-container, .ingredients-list, flow-batch-info';

/** The project's own left rail, which carries its own "videocamVideos" item. */
const PROJECT_RAIL = 'mat-drawer, .mat-drawer-inner-container, mat-sidenav';

/**
 * The composer's "+", the one control that opens the media picker.
 *
 * ── Read off the live page, because guessing cost a working build ─────────
 *
 *   button[aria-label="Add ingredients to the prompt box"]
 *     < div.add-menu-container < flow-add-menu < div.bottom-controls
 *     < div.base-prompt-box < flow-base-prompt-box
 *
 * It is NOT in the ingredient bar. A previous version of this function looked
 * for it there and returned null on every page, which made the readiness wait
 * burn its full budget and then press the project toolbar's Add-media button
 * instead — a different control that opens a different thing.
 *
 * Pressing this one was verified against the live page: it opens a
 * cdk-overlay-pane holding All / Images / Videos / Voices / Characters /
 * Avatars / Uploads and an "uploadUpload media" button.
 *
 * The other two `add` buttons on the page, for the record:
 *
 *   aria="Add media menu"  in flow-tile-view-header  — the project toolbar
 *   aria="Ingredient"      in flow-ingredient-chip   — a chip on an old batch
 */
export function composerAddButton(doc: Document = document): HTMLElement | null {
  const trigger = doc.querySelector<HTMLElement>('button.add-menu-trigger');
  if (trigger) return trigger;

  for (const menu of Array.from(doc.querySelectorAll<HTMLElement>('flow-add-menu, .add-menu-container'))) {
    const found = Array.from(menu.querySelectorAll<HTMLElement>('button'))
      .find((b) => (b.textContent || '').trim() === 'add');
    if (found) return found;
  }

  /* A layout without those wrappers: a small `add` inside the prompt box that
     is neither a chip nor part of a finished batch. */
  for (const box of Array.from(doc.querySelectorAll<HTMLElement>('flow-base-prompt-box, .base-prompt-box'))) {
    const found = Array.from(box.querySelectorAll<HTMLElement>('button')).find(
      (b) => (b.textContent || '').trim() === 'add' && !b.closest(CHIP_AREAS),
    );
    if (found) return found;
  }
  return null;
}

/**
 * The project toolbar's Add-media entry.
 *
 * A real entry point, but the second choice: it opens a menu rather than the
 * picker, and it exists from the moment the toolbar paints — long before the
 * composer does. Treating it as proof that Flow was ready is what let a
 * half-rendered page through.
 *
 * Matched on aria-label as well as text, because on the live page it carries
 * no visible label at all: `aria-label="Add media menu"`, ligature "add",
 * 40px. A text-only test could never see it, which is why the Add Media branch
 * below has been dead on this page.
 */
export function mediaMenuButton(doc: Document = document): HTMLElement | null {
  return Array.from(doc.querySelectorAll<HTMLElement>('button')).find((b) => {
    const text = (b.textContent || '').trim();
    const aria = b.getAttribute('aria-label') || '';
    if (!text.toLowerCase().includes('add') && !aria.toLowerCase().includes('add')) return false;
    return hasMediaWord(text) || hasMediaWord(aria);
  }) || null;
}

/**
 * Wait for it, rather than reading the page once and calling it a change to
 * Flow.
 *
 * Polled, not slept: it returns the moment the toolbar is there, so a page
 * that is already up waits for nothing. Thirty seconds because a discarded tab
 * has to re-fetch the project before it paints, and the alternative — failing
 * — throws away the cut and the whole director conversation that came before.
 */
export async function waitForFlowUi(deps: Deps = {}): Promise<boolean> {
  const doc = deps.doc || document;
  const say = deps.log || (() => {});
  const budget = deps.uiWaitMs ?? (deps.step === 0 ? 0 : 30_000);

  /* What it waits FOR is the composer, not the toolbar.
   *
   * The toolbar's Add-media button exists the instant the page frame paints,
   * and the old check accepted it — so on a tab that had just been reloaded
   * this returned true immediately, and everything after it ran against a page
   * with no composer on it yet. The route that actually opens the picker is
   * the composer's +, so that is what "ready" has to mean. */
  const ready = () => !!(uploadButtons(doc).length || videosTab(doc) || composerAddButton(doc));
  if (ready()) return true;
  if (budget <= 0) return flowUiPresent(doc);

  say('Flow has not painted its composer yet — waiting for it before opening the picker.');
  for (let waited = 0; waited < budget; waited += 300) {
    await sleep(300);
    if (ready()) {
      say(`Flow's composer appeared after ${((waited + 300) / 1000).toFixed(1)}s.`);
      return true;
    }
  }

  /* Out of time, but the toolbar's Add-media entry is a real route and some
     project views genuinely have no composer. Proceed on it rather than
     failing outright — and say so, because it is the weaker of the two. */
  if (mediaMenuButton(doc)) {
    say('No composer appeared; going in through the project Add-media menu instead.');
    return true;
  }
  return false;
}

/**
 * The element the media picker actually is, so the things inside it can be
 * found.
 *
 * ── Why this is not just querySelector('[role="dialog"]') ─────────────────
 *
 * Because the picker often has no such element. mediaDialogOpen already knows
 * this — it accepts an Upload button as a second, independent signal that the
 * picker is up — and openMediaDialog returns `{ok: true}` on that signal
 * alone. attachFromLibrary then addressed the picker by the FIRST signal, got
 * null, and reported:
 *
 *   the asset search box is not where it was
 *
 * with the picker open on the Videos tab, both clips listed in it, and the
 * search box plainly on screen. The box was exactly where it was. What was
 * missing was a dialog role on the thing containing it.
 *
 * This is the state Motion Control leaves the page in every single time: its
 * own upload step opens this picker through CDP and does not close it, so the
 * attach that follows always meets an already-open picker.
 */
export function mediaDialogRoot(doc: Document = document): HTMLElement | null {
  /* The picker first, by name. Taking the first [role="dialog"] or the first
     .cdk-overlay-pane picks whichever overlay happens to be earliest in the
     DOM — and with the toolbar menu also open that is the wrong one. */
  const picker = assetPickerPane(doc);
  if (picker) return picker;

  const named = doc.querySelector<HTMLElement>('[role="dialog"], mat-dialog-container');
  if (named) return named;

  /* Found from the Upload button instead — the same anchor mediaDialogOpen
     trusts, so the two can no longer disagree about whether the picker is up. */
  const up = uploadButtons(doc)[0];
  if (!up) return null;

  const pane = up.closest<HTMLElement>(
    '.cdk-overlay-pane, mat-bottom-sheet-container, [role="dialog"], mat-dialog-container',
  );
  if (pane) return pane;

  /* Last resort: the nearest ancestor holding both the upload control and a
     search box. Capped short of <body> on purpose — the project page has its
     own search, so an unbounded walk always "succeeds" by returning the whole
     document, and then every query inside it matches the wrong thing. */
  let el: HTMLElement | null = up.parentElement;
  for (let i = 0; i < 6 && el && el !== doc.body; i++) {
    if (el.querySelector(searchInputSelector())) return el;
    el = el.parentElement;
  }
  return null;
}

/**
 * The Videos tab in Flow's media dialog, or null when it is not on screen.
 *
 * Every element whose text carries the videocam ligature AND a word for
 * video — then the most specific one, not the first in document order.
 *
 * This used to take the first match, and the search includes div and span,
 * so an ANCESTOR always won: a wrapper whose textContent happens to contain
 * "videocam" and "Videos" appears before the tab it contains. Pressing a
 * layout div does nothing, the Images tab stayed selected, and the upload
 * went on to deliver mp4s into the image picker — which answered
 * "Unsupported image format. Please upload a: .heif, .heic, .png, .jpg,
 * .webp, .gif", once per part, blaming the file rather than the tab.
 *
 * Interactive elements first, then the shortest text, which is the tab
 * itself rather than anything wrapping it.
 *
 * Lifted out of openMediaDialog because two callers need it and only one of
 * them was getting it — see selectVideosTab.
 */
export function videosTab(doc: Document = document): HTMLElement | null {
  /* Scoped to the picker when the picker is open.
   *
   * The project's LEFT RAIL carries its own "videocamVideos" — the same
   * mat-list-item markup as the picker's tab, read off the live page:
   *
   *   mat-drawer-inner-container: dashboard All media | image Images |
   *                               videocam Videos | … | drive_folder_upload
   *   cdk-overlay-pane:           dashboardAll | imageImages |
   *                               videocamVideos | … | drive_folder_uploadUploads
   *
   * No amount of ranking separates those two — they are the same element type
   * with the same text. Pressing the rail's navigates the project to its
   * Videos listing instead of switching the picker's tab, which looks exactly
   * like "the dialog did not open". Which one is meant depends entirely on
   * where it is. */
  const pane = assetPickerPane(doc)
    || doc.querySelector<HTMLElement>('.cdk-overlay-pane, [role="dialog"], mat-dialog-container');
  const scope: ParentNode = pane || doc;

  const videoTabs = Array.from(scope.querySelectorAll<HTMLElement>(
    'button,[role="tab"],[role="menuitem"],[role="option"],div,span',
  )).filter((e) => {
    const text = (e.textContent || '').trim();
    if (!text.includes('videocam')) return false;

    /* Not the chip already ON the prompt. A video ingredient carries a
       videocam type-badge, so the whole chip and every wrapper around it match
       the icon test — and on the live project page they are the ONLY videocam
       elements, because the real Videos tab exists solely inside the picker:

         div.ingredients-list         add,add,videocam
         flow-ingredient-chip         add,videocam
         flow-video-ingredient-chip   add,videocam
         button.chip-container        add,videocam
         mat-icon.type-badge          videocam        <- no icons of its own

       The ADD_ICONS rule below rejects the first four and leaves the bare
       mat-icon, which is how a run came to click an icon and report that the
       dialog never opened. Where the element lives settles it; what it looks
       like never could. */
    if (e.closest(`${CHIP_AREAS}, ${PROJECT_RAIL}`)) return false;

    /* The second half of this test used to be matchesFlowText(text, 'video'),
       which can never reject anything the first half accepted: "videocam"
       CONTAINS "video". So the word check was decoration, and every element
       carrying the icon matched — including the composer's add-a-video
       button, which the live page reports as
    *
         Buttons on the page: … | add | addvideocam | favorite
    *
       and which this pressed as though it were the Videos tab. The dialog
       never opened, and the run blamed a tab that had never been touched.
    *
       An ADD icon settles it: a control that adds a video is an action, not a
       tab, whatever else it carries. Judged on the icon rather than the label
       because the label is translated and, on that button, empty. */
    if (iconNames(e).some((n) => ADD_ICONS.has(n))) return false;
    return true;
  });

  /* Ranked, never filtered.

     Visibility was a hard filter for one revision, and that is wrong twice
     over: a zero rect means "hidden" in a browser but "no layout engine"
     everywhere else, so it threw away the right answer whenever rects were
     unavailable. Preferring beats excluding — the visible interactive tab
     still wins when there is one, and when nothing reports a size the best
     remaining match is still pressed rather than nothing at all. */
  const visible = (e: HTMLElement): number => {
    const r = e.getBoundingClientRect();
    return (r.width > 0 && r.height > 0) ? 0 : 1;
  };
  const interactive = (e: HTMLElement): number => {
    const role = e.getAttribute('role') || '';
    return (e.tagName.toLowerCase() === 'button'
      || ['tab', 'menuitem', 'option'].includes(role)) ? 0 : 1;
  };
  /* A real tab says "Videos" beside its icon. Preferred, not required — an
     icon-only tab is still the best answer when nothing on the page is
     labelled, and this file's rule is to rank rather than exclude. Judged with
     the ligature removed, or "videocam" would satisfy it by itself. */
  const labelled = (e: HTMLElement): number =>
    (matchesFlowText(labelWithoutIcons(e), 'video') ? 0 : 1);

  const anyVisible = videoTabs.some((e) => visible(e) === 0);
  const anyLabelled = videoTabs.some((e) => labelled(e) === 0);

  videoTabs.sort((a, b) => (
    (anyVisible ? visible(a) - visible(b) : 0)
    || (anyLabelled ? labelled(a) - labelled(b) : 0)
    || interactive(a) - interactive(b)
    || (a.textContent || '').trim().length - (b.textContent || '').trim().length
  ));

  return videoTabs[0] || null;
}

/**
 * Make sure the dialog is showing VIDEOS before anything reads it.
 *
 * ── The bug this exists for ───────────────────────────────────────────────
 *
 * openMediaDialog presses the Videos tab, but only on its long route. It has
 * two early returns that skip it:
 *
 *   1. `if (uploadButtons(doc).length) return { ok: true }` at the top — the
 *      dialog is already open, so nothing more is pressed. Which tab it is
 *      open ON is not checked, and Flow opens on Images.
 *   2. the "Add Media" branch, which returns as soon as an upload control
 *      appears — again without touching the tabs.
 *
 * For the UPLOAD path both are right: CDP only needs the Upload button, and
 * the long route presses the tab when it takes it. For attachFromLibrary they
 * are not: it searches, then looks for a <video> among the results. On the
 * Images tab there are no <video> elements, so a library holding the clip
 * answered `nothing in the library matches "…"` — a missing-file message for
 * a file that was right there, one tab over.
 *
 * Idempotent on purpose. Pressing the tab that is already selected is a
 * no-op on Flow, so this can be called without first working out how the
 * dialog came to be open.
 */
export async function selectVideosTab(deps: Deps = {}): Promise<boolean> {
  const doc = deps.doc || document;
  const tab = videosTab(doc);
  if (!tab) return false;
  press(tab);
  await sleep((deps.step ?? 700) / 2);
  return true;
}

/**
 * Open Flow's video media dialog.
 *
 * Lifted out of attachFromLibrary rather than written fresh, because these
 * three clicks are the only part of reaching Flow's media UI that is known to
 * work, and a second copy would drift from the one that does. Two callers
 * need it now: picking an existing asset by name, and the debugger upload,
 * which needs the dialog on screen before CDP can find the Upload button
 * inside it.
 *
 * Every step is tolerant of already being there — pressing "create" when the
 * composer is open is harmless — so calling this twice is not an error.
 */
export async function openMediaDialog(deps: Deps = {}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const doc = deps.doc || document;
  const step = deps.step ?? 700;

  const need = deps.need ?? 'upload';

  /* ── Already there? ──
     Calling this twice must not close what the first call opened. */
  if (mediaDialogOpen(doc, need)) return { ok: true };

  /* ── Is Flow even on screen? ──
     Asked FIRST, because every step below reads the page and reports what it
     did not find. On a page that has painted nothing they all report the same
     thing — that Flow has changed — which is both wrong and unactionable. */
  if (!(await waitForFlowUi(deps))) {
    return {
      ok: false,
      reason: 'Flow had not finished loading — its toolbar never appeared, so there was '
        + `nothing here to open the picker with${buttonsOnPage(doc)}`,
    };
  }

  /* ── 1. The composer's +, which is the route to the PICKER ──
   *
   * Tried first, always. It is the only control that opens the thing with the
   * tabs and the search box in it — verified live — and it is what the attach
   * path needs. The toolbar's Add-media below opens a four-item menu instead:
   *
   *   uploadUpload · folderNew collection · account_circleCreate character
   *   · play_moviesNew scene
   *
   * That menu has an Upload item, so it satisfies "can raise a file chooser"
   * and nothing more. Reaching for it first — which a previous revision did —
   * ended every attach with "the picker is open but has no search box in it". */
  const plus = composerAddButton(doc);
  if (plus) {
    press(plus);
    await sleep(step);
    if (assetPickerPane(doc)) {
      /* The picker is up. Nothing else to press, and pressing more would
         close it. */
      return { ok: true };
    }
  }

  /* ── 2. The project toolbar's Add-media menu ──
     A real way to a file chooser and nothing more, so it is only offered to a
     caller that asked for 'upload'. */
  if (need === 'upload') {
    const addMedia = mediaMenuButton(doc);
    if (addMedia) {
      press(addMedia);
      await sleep(step);
      if (mediaDialogOpen(doc, need)) return { ok: true };
    }
  }

  /* ── 3. The old composer route, for a layout the two above did not fit ── */
  const composer = Array.from(doc.querySelectorAll<HTMLElement>('button'))
    .find((b) => {
      const text = (b.textContent || '').trim();
      return text.includes('add_2') && matchesFlowText(text, 'create');
    });
  if (composer) { press(composer); await sleep(step); }

  if (!plus) {
    /* Position sorting, kept only for a layout whose ingredient bar and add
       menu carry none of the names composerAddButton knows. It was never a
       good test: it assumes innerHeight describes the area being painted, and
       in an anti-detect browser it does not — MultiLogin spoofs screen size as
       part of the fingerprint. */
    const loose = Array.from(doc.querySelectorAll<HTMLElement>('button')).filter((b) => {
      const r = b.getBoundingClientRect();
      return r.width > 0 && r.width < 60 && (b.textContent || '').trim() === 'add';
    });
    const view = doc.defaultView || window;
    const lower = (x: HTMLElement): number =>
      (x.getBoundingClientRect().top > (view.innerHeight || 0) * 0.5 ? 0 : 1);
    loose.sort((x, y) => lower(x) - lower(y));
    if (loose[0]) { press(loose[0]); await sleep(step); }
  }

  /* An attach needs the picker, and only the picker. Reporting a missing
     Videos tab here would blame the tab for an overlay that was never going
     to have one — the toolbar's four-item menu has no tabs at all. */
  if (need === 'library' && !assetPickerPane(doc)) {
    return {
      ok: false,
      reason: `the asset picker did not open — only Flow's own menus did${buttonsOnPage(doc)}`,
    };
  }

  const videos = videosTab(doc);
  if (!videos) {
    return {
      ok: false,
      reason: 'the Videos tab is not where it was — Flow has changed'
        + buttonsOnPage(doc),
    };
  }
  press(videos);
  await sleep(step);

  /* Waited for, not sampled once.
   *
   * The old check read the page a single `step` after the click and called it
   * a failure. Flow's picker fetches the project's assets before it paints, so
   * on a cold project that verdict lands while the dialog is still on its way
   * — and the run reports "the media dialog did not open" about a dialog that
   * opened a second later. Cheap either way: this returns the moment it is
   * there, so a fast page waits no longer than it did. */
  for (let waited = 0; waited < 6000 && !mediaDialogOpen(doc, need); waited += 250) {
    await sleep(250);
  }

  if (!mediaDialogOpen(doc, need)) {
    return {
      ok: false,
      reason: need === 'library'
        ? `the asset picker did not open — only Flow's own menus did${buttonsOnPage(doc)}`
        : `the media dialog did not open${buttonsOnPage(doc)}`,
    };
  }
  return { ok: true };
}

/**
 * What was on screen when it gave up.
 *
 * Every failure out of openMediaDialog carries this. The first run without it
 * cost a whole round trip to establish that the dialog had simply never
 * opened — the labels say that at a glance, and they said it: the reply was
 * the project toolbar, "addAdd Media" and "add_2Create" among them, with no
 * upload control anywhere.
 */
function buttonsOnPage(doc: Document): string {
  const labels = Array.from(doc.querySelectorAll<HTMLElement>('button'))
    .map((b) => (b.textContent || '').trim())
    .filter(Boolean)
    .slice(0, 24)
    .join(' | ');
  return labels ? `. Buttons on the page: ${labels}` : '';
}

/** Words for "media", for the Add Media entry point and the Upload button. */
const MEDIA_WORDS = [
  'media', 'média', 'medios', 'mídia', 'medien', 'multimedia', 'multimédia',
  'メディア', '미디어', '媒体', 'وسائط',
];

const hasMediaWord = (text: string): boolean => {
  const low = text.toLowerCase();
  return MEDIA_WORDS.some((w) => low.includes(w));
};

/**
 * Material icon names that mean "put a file in", and only that.
 *
 * Matched EXACTLY, which is the whole point. Substring matching on "upload"
 * picked Flow's sidebar item
 *
 *     <button><i class="google-symbols">drive_folder_upload</i>View uploaded media</button>
 *
 * a 40x40 nav icon that opens a listing. Its ligature contains "upload" and
 * its label contains "media", so it beat everything on both tests — the run
 * clicked it at 40,311, no file chooser opened, and fifteen seconds later the
 * upload gave up. It also made uploadButtons() true, so openMediaDialog
 * returned "already open" and never pressed Add Media at all.
 *
 * The ligature is the right anchor because it is an icon NAME: it renders as
 * text, it is identical in every language, and it distinguishes an action from
 * a view in a way the label cannot.
 */
const UPLOAD_ICONS = new Set([
  'upload', 'file_upload', 'cloud_upload', 'upload_file', 'upload_2',
]);

/**
 * Material icon names that mean "add one of these".
 *
 * An element carrying one of these is an action, never a tab — see videosTab,
 * which pressed the composer's `addvideocam` button believing it was the
 * Videos tab, because "videocam" contains "video" and the word test that was
 * supposed to separate them could not.
 */
const ADD_ICONS = new Set(['add', 'add_2', 'add_circle', 'add_box']);

/** Icon ligatures inside an element — the untranslated names, not the label. */
function iconNames(el: Element): string[] {
  return Array.from(el.querySelectorAll('i, [class*="symbols"], [class*="material-icons"]'))
    .map((i) => (i.textContent || '').trim().toLowerCase())
    .filter(Boolean);
}

/** An element's visible words with the icon ligatures taken out. */
export function labelWithoutIcons(el: Element): string {
  const icons = iconNames(el);
  let text = (el.textContent || '').trim();
  for (const name of icons) {
    const at = text.toLowerCase().indexOf(name);
    if (at !== -1) text = text.slice(0, at) + text.slice(at + name.length);
  }
  return text.trim();
}

/**
 * Every visible button that actually uploads — the dialog's own control.
 *
 * An icon whose name is exactly an upload icon settles it. Failing that, the
 * LABEL has to carry an upload verb, judged with the ligature removed so a
 * button named drive_folder_upload cannot qualify on its icon alone.
 */
export function uploadButtons(doc: Document = document): HTMLElement[] {
  return Array.from(doc.querySelectorAll<HTMLElement>('button')).filter((b) => {
    const r = b.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;

    /* When a button carries an icon, the icon DECIDES — the label is not
       consulted at all. That is the whole lesson of drive_folder_upload:
       its label is "View uploaded media", and "uploaded" contains "upload",
       so any label test passes it. Flow labels its controls with ligatures,
       so an icon that is not an upload icon is a positive answer of "no",
       not an absence of evidence.

       The label is the fallback only for a button with no icon at all, where
       there is nothing better to go on. */
    const icons = iconNames(b);
    if (icons.length) return icons.some((n) => UPLOAD_ICONS.has(n));

    const label = labelWithoutIcons(b);
    return !!label && matchesFlowText(label, 'upload');
  });
}

/**
 * Is Flow's media dialog on screen?
 *
 * Two signals, and deliberately not a third. A [role="dialog"] is the best
 * answer when it is there, and an Upload button is the thing this is looking
 * for anyway.
 *
 * What is NOT a signal is a search box. That was tried, and it matched Flow's
 * own library search on the main page — so this reported an open dialog for a
 * page that had none, the upload went ahead, and the CDP lookup then reported
 * "no upload button on the page" while listing the whole project toolbar:
 *
 *   arrow_backGo Back | searchSearch | addAdd Media | add_2Create | …
 *
 * A false positive here is worse than a false negative: "the dialog did not
 * open" is true and actionable, while proceeding wastes the debugger attach
 * and blames the step after the one that actually failed.
 */
export function mediaDialogOpen(doc: Document = document, need: 'upload' | 'library' = 'upload'): boolean {
  if (assetPickerPane(doc)) return true;
  /* A caller that only needs a file chooser is satisfied by the toolbar's
     Add-media menu; one that needs to SEARCH the library is not. */
  if (need === 'library') return false;
  if (doc.querySelector('[role="dialog"], mat-dialog-container')) return true;
  return uploadButtons(doc).length > 0;
}

/**
 * Find a video in the library by name and put it on the prompt.
 *
 * Returns rather than throws at every step, because a style reference is an
 * improvement to a generation that works without one. Losing it should cost a
 * plainer cutaway, never the cutaway.
 */
export async function attachFromLibrary(
  name: string,
  deps: Deps = {},
): Promise<AttachResult> {
  const doc = deps.doc || document;
  const step = deps.step ?? 700;
  const say = deps.log || (() => {});

  if (!name.trim()) return { ok: false, reason: 'no style reference named' };

  const before = attachedCount(doc);

  const opened = await openMediaDialog({ ...deps, need: 'library' });
  if (!opened.ok) return { ok: false, reason: opened.reason };

  /* However the dialog came to be open, it has to be showing VIDEOS before
     the search runs — openMediaDialog's two early returns skip its own tab
     press, and the search below looks for a <video>. See selectVideosTab. */
  const onVideos = await selectVideosTab(deps);
  if (!onVideos) {
    say('no Videos tab in the dialog — searching whatever tab is showing');
  }

  const dialog = mediaDialogRoot(doc);
  /* searchInputSelector, not placeholderSelector: the Angular picker renders
     <input class="search-input" aria-label="Search assets" placeholder="…">
     and the wording under it is TRANSLATED. The class is not, which is why
     automation.ts has reached for this selector since the rebuild — this was
     the one caller still matching on the placeholder alone. */
  const search = dialog
    && dialog.querySelector<HTMLInputElement>(searchInputSelector());
  if (!search) {
    /* Which of the two steps failed, because they need different fixes and
       "not where it was" described both. */
    return {
      ok: false,
      reason: dialog
        ? 'the picker is open but has no search box in it'
        : `the media picker could not be located in the page${buttonsOnPage(doc)}`,
    };
  }

  /* Searched by the name it was uploaded under. uploadVideo.libraryName is
     what produces that name, so the two must not drift. */
  const wanted = name.replace(/\.mp4$/i, '');
  typeInto(search as HTMLInputElement, wanted);

  /* ── Wait for the search, and take the row that NAMES it ──────────────────
   *
   * This used to sleep 1.1s and then take the first <video> in the picker.
   * Both halves were wrong.
   *
   * The wait: Flow fetches the filtered results, and 1.1s is sometimes enough
   * and sometimes not. Watched live, three attempts out of four gave up 3s in
   * and the fourth found it at 6s — so a clip that was sitting in the library
   * the whole time cost four attempts and 80 seconds of backoff:
   *
   *   02:15:20  nothing in the library matches "Motion-Control-1-part1-of-2.mp4"
   *   02:15:32  nothing in the library matches "Motion-Control-1-part1-of-2.mp4"
   *   02:15:51  attached "Motion-Control-1-part1-of-2.mp4" as the style reference
   *
   * The pick: "the first video in the picker" is not "the video I searched
   * for". Before the filter lands, the first video is whatever was showing —
   * and for a job whose pieces are part1 and part2 of the same clip, grabbing
   * the wrong one produces a plausible video of the wrong six seconds, which
   * nothing downstream can detect.
   *
   * So it polls for a result that carries the name, which is both the correct
   * answer and the proof that the search finished. */
  const namedRow = (): HTMLElement | null => {
    const open = mediaDialogRoot(doc);
    if (!open) return null;
    for (const video of Array.from(open.querySelectorAll<HTMLElement>('video'))) {
      let row: HTMLElement | null = video;
      for (let up = 0; up < 6 && row; up++) {
        /* Stop at the row's edge. Climbing one level too far reaches the
           container that holds EVERY result, whose text carries every name —
           so searching for part1 matched on part2's row and clicked part2.
           An ancestor holding a second clip is not this clip's row. */
        if (row.querySelectorAll('video').length > 1) break;
        if ((row.textContent || '').toLowerCase().includes(wanted.toLowerCase())) return video;
        row = row.parentElement;
      }
    }
    return null;
  };

  const budget = step === 0 ? 0 : 10_000;
  let hit: HTMLElement | null = namedRow();
  for (let waited = 0; !hit && waited < budget; waited += 250) {
    await sleep(250);
    hit = namedRow();
  }

  /* Nothing named it. One lone result is still almost certainly the answer —
     the search filtered down to a single clip — but it is a guess, so it is
     said out loud rather than taken silently. */
  const open = mediaDialogRoot(doc);
  if (!hit) {
    const videos = open ? Array.from(open.querySelectorAll<HTMLElement>('video')) : [];
    if (videos.length === 1) {
      say(`the result is not labelled, taking the only clip the search left for "${name}"`);
      hit = videos[0];
    }
  }

  if (!hit) {
    /* What the dialog DOES hold, because "nothing matches" has several very
       different causes and they need different fixes. Stills in the results
       means the search worked and the tab is wrong; several unnamed videos
       means the search did not filter; nothing at all means the name is wrong
       or the clip was never uploaded. */
    const stills = open ? open.querySelectorAll('img').length : 0;
    const videos = open ? open.querySelectorAll('video').length : 0;
    return {
      ok: false,
      reason: videos
        ? `the picker is showing ${videos} clip(s) and none of them is named "${wanted}"`
        : stills
          ? `the dialog is showing ${stills} still(s) and no video — it is on the `
            + `Images tab, so "${name}" could not be seen from here`
          : `nothing in the library matches "${name}" — check the name, or upload it once by hand`,
    };
  }

  /* Walk out to whatever actually takes the click. The <video> itself is a
     preview; the selectable row is one of its ancestors, and which one is not
     stable enough to hard-code. */
  let target: HTMLElement = hit;
  for (let i = 0; i < 5 && target.parentElement; i++) {
    if (target.tagName === 'BUTTON' || target.getAttribute('role') === 'button') break;
    target = target.parentElement;
  }
  press(target);
  await sleep(step);

  const confirm = Array.from(doc.querySelectorAll<HTMLElement>('button'))
    .find((b) => matchesFlowText((b.textContent || '').trim(), 'addToPrompt'));
  if (!confirm) return { ok: false, reason: 'no "Add to Prompt" to press' };
  press(confirm);
  await sleep(step + 500);

  /* Confirmed, not assumed. Pressing the button is not the same as the
     ingredient arriving, and a silent miss would produce a cutaway that
     ignored the style reference with nothing saying so. */
  const after = attachedCount(doc);
  if (after <= before) {
    return { ok: false, reason: 'Flow accepted the click but no ingredient appeared' };
  }

  say(`attached "${name}" as the style reference`);
  return { ok: true };
}

/* ──────────────────────────────────────────────────────────────────────── */
/* The rights consent                                                      */
/* ──────────────────────────────────────────────────────────────────────── */

/**
 * The "Rights to use this video" dialog, and the button that retires it.
 *
 * ── What it is ────────────────────────────────────────────────────────────
 *
 * Flow puts a consent dialog in front of the FIRST upload and will not ingest
 * the file until it is answered:
 *
 *   Rights to use this video
 *   Make sure you have the necessary rights to any content or files that you
 *   upload … you must comply with Google's Prohibited Use Policy.
 *
 *   [Cancel]              [I agree, do not show again]   [I agree]
 *
 * It is not an error and nothing reports it as one. The file chooser has
 * already been satisfied by CDP, so the upload looks like it went through —
 * and then nothing arrives in the library, and the attach that follows says
 * "No assets found", which is true and useless.
 *
 * ── Which button ──────────────────────────────────────────────────────────
 *
 * The middle one. "I agree" alone answers this upload and comes back on the
 * next one; "do not show again" is what makes the run after this one work
 * without a person in front of it.
 *
 * ── How it is found ───────────────────────────────────────────────────────
 *
 * By the button's own text, inside a dialog, and never by class — the same
 * rule as everything else in this file, and for the same reason: Flow's
 * overlays are styled-components whose hashes change on every deploy.
 *
 * Order matters. `matchesFlowText` uses `includes`, so "i agree" matches "i
 * agree, do not show again" too — the dismiss-forever variant is therefore
 * tested FIRST and the plain one is only a fallback. Cancel is checked for
 * explicitly and refused, because getting that wrong throws the upload away.
 */
export function rightsConsentButton(doc: Document = document): HTMLElement | null {
  /* Scoped to overlays. An unscoped sweep for "I agree" across the whole page
     would be free to find a footer link or a settings row on the project page
     behind the dialog. */
  const panes = Array.from(doc.querySelectorAll<HTMLElement>(
    '[role="dialog"], [role="alertdialog"], mat-dialog-container, .cdk-overlay-pane',
  )).filter(isShowing);

  for (const pass of ['rightsDismissForever', 'rightsAgree'] as const) {
    for (const pane of panes) {
      const hit = Array.from(pane.querySelectorAll<HTMLElement>('button, [role="button"]'))
        .filter(isShowing)
        .find((b) => {
          const text = (b.textContent || '').trim();
          if (!text) return false;
          /* Never the one that throws the upload away. Checked even though no
             known translation of "cancel" contains "agree": the guard is one
             comparison and the failure it prevents is a discarded upload. */
          if (matchesFlowText(text, 'rightsDecline')) return false;
          return matchesFlowText(text, pass);
        });
      if (hit) return hit;
    }
  }
  return null;
}

/** On screen and not merely present. Overlays are kept in the DOM when shut. */
function isShowing(el: HTMLElement): boolean {
  if (el.getAttribute('aria-hidden') === 'true') return false;
  const rect = el.getBoundingClientRect();
  if (!rect.width && !rect.height) return false;
  const style = el.ownerDocument?.defaultView?.getComputedStyle(el);
  if (!style) return true;
  return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
}

/** Press it if it is there. Says whether it was, and never throws. */
export function dismissRightsConsent(deps: Deps = {}): boolean {
  const doc = document;
  try {
    const button = rightsConsentButton(doc);
    if (!button) return false;
    const label = (button.textContent || '').trim().slice(0, 60);
    press(button);
    deps.log?.(`agreed to Flow's upload rights notice ("${label}")`);
    return true;
  } catch {
    /* A consent dialog that cannot be pressed is the user's one manual click,
       not a failed upload. */
    return false;
  }
}

/**
 * Watch for it for a while, because nobody knows exactly when it arrives.
 *
 * It has been SEEN over the media dialog with the file already chosen. Whether
 * Flow raises it when the Upload button is pressed or once the bytes are
 * handed over is not something the screenshot settles, and the two orderings
 * want the hook in different places.
 *
 * So this does not pick one. It is armed before the chooser runs and polls
 * across the whole upload, which covers both without needing to know — and
 * costs one querySelectorAll every quarter second.
 *
 * Returns how many it dismissed. Zero is the ordinary case after the first
 * upload, and it is not a failure.
 */
export async function watchForRightsConsent(
  ms: number = 30_000,
  deps: Deps = {},
): Promise<number> {
  const until = Date.now() + Math.max(0, ms);
  let dismissed = 0;
  while (Date.now() < until) {
    if (dismissRightsConsent(deps)) {
      dismissed++;
      /* Keep watching rather than returning. A multi-part upload can raise it
         again if the first press landed on "I agree" — the translation for
         "do not show again" may be missing in this language — and stopping
         here would leave the second part stuck. */
      await sleep(1000);
    } else {
      await sleep(250);
    }
  }
  return dismissed;
}
