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
  if (!videos) return { ok: false, reason: 'the Videos tab is not where it was — Flow has changed' };
  press(videos);
  await sleep(step);

  if (!mediaDialogOpen(doc)) return { ok: false, reason: 'the media dialog did not open' };
  return { ok: true };
}

/**
 * Is Flow's media dialog on screen?
 *
 * Not "is there a [role=\"dialog\"]". Flow's picker is styled-components all
 * the way down and carries no roles or test ids — its Upload button is
 *
 *   <button class="sc-16c4830a-1 dnFqQq …">
 *     <i class="google-symbols">upload</i>Upload media
 *     <div data-type="button-overlay"></div>
 *   </button>
 *
 * so a role check is a guess about markup that was never verified. When it is
 * wrong this reported "the media dialog did not open" for a dialog that was
 * open on screen, and the debugger upload gave up before it ever attached.
 *
 * The role is still the first and best signal when it is there. What follows
 * are the things the dialog demonstrably contains: its asset search box, and
 * its Upload button, matched by the translated verb and by the Material
 * ligature "upload", which renders as text and is the same in every language.
 */
export function mediaDialogOpen(doc: Document = document): boolean {
  if (doc.querySelector('[role="dialog"], mat-dialog-container')) return true;

  const search = doc.querySelector<HTMLElement>(placeholderSelector('search'));
  if (search && search.getBoundingClientRect().width > 0) return true;

  return Array.from(doc.querySelectorAll<HTMLElement>('button')).some((b) => {
    const r = b.getBoundingClientRect();
    if (!r.width || !r.height) return false;
    const text = (b.textContent || '').trim();
    /* The ligature makes this "uploadUpload media" — one word of which is
       language-independent. */
    return text.toLowerCase().includes('upload') || matchesFlowText(text, 'upload');
  });
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
