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
 *   the composer      a button whose label contains "add_2Create"
 *   the + beside it   a small button labelled exactly "add", low in the window
 *   the Videos tab    an element labelled "videocamVideos"
 *   the search box    an input placeholdered "Search assets"
 *   a result          the <video> INSIDE the dialog
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

import { matchesFlowText, placeholderSelector } from './flowStrings';

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
  const box = Array.from(doc.querySelectorAll('textarea,[contenteditable="true"]')).pop();
  if (!box) return 0;
  let scope: HTMLElement | null = box as HTMLElement;
  for (let i = 0; i < 4 && scope?.parentElement; i++) scope = scope.parentElement;
  return scope ? scope.querySelectorAll('img[src*="media.getMediaUrlRedirect"]').length : 0;
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

  /* ── Already there? ──
     Calling this twice must not close what the first call opened. */
  if (uploadButtons(doc).length) return { ok: true };

  /* ── The library page's own entry: "Add Media" ──
     The composer route below (Create -> + -> Videos) is the one that was
     written, and it is right when the composer is on screen. On the project
     media page there is no composer row and no bare "+", only

         <button><i class="google-symbols">add</i>Add Media</button>

     and the run reported the whole toolbar with no upload button in it:

         arrow_backGo Back | searchSearch | addAdd Media | add_2Create | …

     The `plus` lookup below deliberately EXCLUDES this button, by size and
     position, because in the composer "add" alone would match it by mistake.
     That exclusion is right there and wrong here, so this is tried first and
     only kept if it actually produced an upload control. */
  const addMedia = Array.from(doc.querySelectorAll<HTMLElement>('button')).find((b) => {
    const text = (b.textContent || '').trim();
    return text.toLowerCase().includes('add') && hasMediaWord(text);
  });
  if (addMedia) {
    press(addMedia);
    await sleep(step);
    if (uploadButtons(doc).length) return { ok: true };
  }

  const composer = Array.from(doc.querySelectorAll<HTMLElement>('button'))
    .find((b) => {
      const text = (b.textContent || '').trim();
      return text.includes('add_2') && matchesFlowText(text, 'create');
    });
  if (composer) { press(composer); await sleep(step); }

  /* The + sits in the composer row. Matched by size and position as well as
     label because "add" alone also matches the project's "Add Media". */
  const plus = Array.from(doc.querySelectorAll<HTMLElement>('button')).find((b) => {
    const r = b.getBoundingClientRect();
    const view = doc.defaultView || window;
    return r.width > 0 && r.width < 60
      && r.top > view.innerHeight * 0.5
      && (b.textContent || '').trim() === 'add';
  });
  if (plus) { press(plus); await sleep(step); }

  /* Every element whose text carries the videocam ligature AND a word for
     video — then the most specific one, not the first in document order.

     This used to take the first match, and the search includes div and span,
     so an ANCESTOR always won: a wrapper whose textContent happens to contain
     "videocam" and "Videos" appears before the tab it contains. Pressing a
     layout div does nothing, the Images tab stayed selected, and the upload
     went on to deliver mp4s into the image picker — which answered
     "Unsupported image format. Please upload a: .heif, .heic, .png, .jpg,
     .webp, .gif", once per part, blaming the file rather than the tab.

     Interactive elements first, then the shortest text, which is the tab
     itself rather than anything wrapping it. */
  const videoTabs = Array.from(doc.querySelectorAll<HTMLElement>(
    'button,[role="tab"],[role="menuitem"],[role="option"],div,span',
  )).filter((e) => {
    const text = (e.textContent || '').trim();
    return text.includes('videocam') && matchesFlowText(text, 'video');
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
  const anyVisible = videoTabs.some((e) => visible(e) === 0);

  videoTabs.sort((a, b) => (
    (anyVisible ? visible(a) - visible(b) : 0)
    || interactive(a) - interactive(b)
    || (a.textContent || '').trim().length - (b.textContent || '').trim().length
  ));

  const videos = videoTabs[0];
  if (!videos) {
    return {
      ok: false,
      reason: 'the Videos tab is not where it was — Flow has changed'
        + buttonsOnPage(doc),
    };
  }
  press(videos);
  await sleep(step);

  if (!mediaDialogOpen(doc)) {
    return {
      ok: false,
      reason: `the media dialog did not open${buttonsOnPage(doc)}`,
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
export function mediaDialogOpen(doc: Document = document): boolean {
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

  const opened = await openMediaDialog(deps);
  if (!opened.ok) return { ok: false, reason: opened.reason };

  const dialog = doc.querySelector('[role="dialog"], mat-dialog-container');
  const search = dialog
    && dialog.querySelector<HTMLInputElement>(placeholderSelector('search'));
  if (!search) return { ok: false, reason: 'the asset search box is not where it was' };

  /* Searched by the name it was uploaded under. uploadVideo.libraryName is
     what produces that name, so the two must not drift. */
  typeInto(search as HTMLInputElement, name.replace(/\.mp4$/i, ''));
  await sleep(step + 400);

  const open = doc.querySelector('[role="dialog"], mat-dialog-container');
  const hit = open?.querySelector<HTMLElement>('video');
  if (!hit) return { ok: false, reason: `nothing in the library matches "${name}" — upload it once by hand` };

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
