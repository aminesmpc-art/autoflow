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

const labelled = (doc: Document, text: string): HTMLElement | undefined =>
  Array.from(doc.querySelectorAll<HTMLElement>('button,[role="menuitem"],div,span'))
    .find((e) => (e.textContent || '').trim() === text);

const containing = (doc: Document, pattern: RegExp): HTMLElement | undefined =>
  Array.from(doc.querySelectorAll<HTMLElement>('button'))
    .find((b) => pattern.test((b.textContent || '').trim()));

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

  const composer = containing(doc, /add_2Create/);
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

  const videos = labelled(doc, 'videocamVideos');
  if (!videos) return { ok: false, reason: 'the Videos tab is not where it was — Flow has changed' };
  press(videos);
  await sleep(step);

  const dialog = doc.querySelector('[role="dialog"], mat-dialog-container');
  const search = dialog
    && Array.from(dialog.querySelectorAll('input'))
      .find((i) => /search/i.test(i.getAttribute('placeholder') || ''));
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

  const confirm = containing(doc, /Add to Prompt/i);
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
