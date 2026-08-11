/* ============================================================
   AutoFlow Studio — Grok chat content script.

   Fourth platform, same contract as ChatGPT and Gemini: take a Studio node's
   prompt, put it in the composer, submit, wait for what comes back, hand it to
   the runner. Text replies become the prompt for a downstream node; images
   become a reference.

   Chat only — no API key anywhere in this extension, by design.

   What was read off a live, signed-in grok.com rather than guessed:
   - The composer is TipTap/ProseMirror: div[contenteditable="true"].tiptap.
     ProseMirror ignores textContent assignment, but a paste event carrying
     text/plain lands — confirmed by reading the text back.
   - There is no send button until the composer has text. Once it does, one
     appears as button[type="submit"][aria-label="Submit"], and the dictation
     and voice-mode buttons beside it disappear.
   - An input[type=file][multiple] is already in the document, so references
     do not need the Attach menu opened first.
   - The attach control is button[aria-label="Attach"], kept as the fallback
     for a build that mounts its input lazily.

   What is NOT verified: the shape of a finished turn. Reading it needs a real
   conversation on the account, and this was written against an empty history,
   so nothing here spends one of the user's generations to find out. Every
   read-back path is a ladder ending in a page-wide search, and says what it
   saw when it comes up empty — see describePage.
   ============================================================ */

console.log('[AutoFlow Grok] Content script loaded on', location.href);

import { cleanAssistantReply, looksLikeUsablePrompt } from '../chatgpt/chatgptReply';

/* Ten minutes, not six. Imagine takes minutes on a long clip, and the cost of
   the two limits is not symmetric: waiting too long wastes time, giving up too
   early throws away a generation that was going to succeed. */
const GENERATION_TIMEOUT_MS = 10 * 60 * 1000;
const TEXT_TIMEOUT_MS = 90 * 1000;
const POLL_MS = 2000;
const UPLOAD_TIMEOUT_MS = 45 * 1000;
const MAX_CAPTURE_BYTES = 15 * 1024 * 1024;
/** Videos are much larger than stills — 50 MB lets a 15 s 1080p clip through. */
const MAX_VIDEO_CAPTURE_BYTES = 50 * 1024 * 1024;

chrome.runtime.onMessage.addListener((msg: any, _sender, sendResponse) => {
  if (msg?.type === 'PING') { sendResponse({ pong: true }); return true; }
  if (msg?.type === 'STUDIO_EXECUTE_NODE') {
    handleExecute(msg.payload)
      .catch((e: any) => {
        // A rejection here would leave sendResponse uncalled and the node stuck
        // at "running" until stopped by hand. An error beats a hang.
        const error = `Grok step failed: ${e?.message || e}`;
        console.error('[AutoFlow Grok]', e);
        send('STUDIO_NODE_ERROR', { nodeId: msg.payload?.nodeId, error });
        return { success: false };
      })
      .then(sendResponse);
    return true;
  }
  return false;
});

function send(type: string, payload: Record<string, unknown>): void {
  try { chrome.runtime.sendMessage({ type, payload }).catch(() => {}); } catch {}
}

/** A line for the side panel's diagnostics, and for the console. */
function logLine(line: string): void {
  console.log(`[AutoFlow Grok] ${line}`);
  try {
    chrome.runtime.sendMessage({ type: 'STUDIO_LOG', payload: { source: 'Grok', line } })
      .catch(() => {});
  } catch {}
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function isVisible(el: Element): boolean {
  const rect = el.getBoundingClientRect();
  if (rect.width < 5 || rect.height < 5) return false;
  const style = getComputedStyle(el);
  return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
}

/* Chrome throttles timers in background tabs, and the tab we open is
   deliberately in the background. A round-trip to the worker keeps this thread
   awake so the poller keeps ticking. */
let antiThrottle: ReturnType<typeof setInterval> | null = null;
const startAntiThrottle = () => {
  if (!antiThrottle) {
    antiThrottle = setInterval(() => {
      try { chrome.runtime.sendMessage({ type: 'PING' }).catch(() => {}); } catch {}
    }, 15_000);
  }
};
const stopAntiThrottle = () => {
  if (antiThrottle) { clearInterval(antiThrottle); antiThrottle = null; }
};

/* ── Page pieces ── */

/** Grok's composer: a TipTap/ProseMirror contenteditable. */
function findComposer(): HTMLElement | null {
  const tiptap = document.querySelector<HTMLElement>(
    'div[contenteditable="true"].tiptap, div[contenteditable="true"].ProseMirror'
  );
  if (tiptap && isVisible(tiptap)) return tiptap;

  const byRole = Array.from(
    document.querySelectorAll<HTMLElement>('[contenteditable="true"], textarea')
  ).filter(isVisible);
  return byRole[0] || null;
}

/**
 * The send control, which does not exist until there is something to send.
 *
 * Grok renders no submit button for an empty composer — the live DOM shows
 * dictation and voice-mode buttons in its place, and they disappear the moment
 * text arrives. Anything reading "is there a send button" as a health check has
 * to account for that.
 */
function findSendButton(): HTMLElement | null {
  const submit = document.querySelector<HTMLElement>('button[type="submit"]');
  if (submit && isVisible(submit)) return submit;

  for (const btn of document.querySelectorAll<HTMLElement>('button[aria-label]')) {
    const label = btn.getAttribute('aria-label') || '';
    /* Imagine's re-prompt page labels its button "Make video" or "Make image"
       rather than "Submit". Without matching those, every generation after the
       first falls back to pressing Enter, which may or may not work. */
    if (/^(submit|send|make (video|image))/i.test(label) && isVisible(btn)) return btn;
  }
  return null;
}

/** An explicit stop control, shown only while Grok is answering. */
function findStopButton(): HTMLElement | null {
  for (const btn of document.querySelectorAll<HTMLElement>('button[aria-label]')) {
    const label = btn.getAttribute('aria-label') || '';
    if (/stop|cancel generat/i.test(label) && isVisible(btn)) return btn;
  }
  return null;
}

/** Signed-out pages show a marketing splash instead of a composer. */
function looksSignedOut(): boolean {
  const text = document.body?.innerText?.slice(0, 1500).toLowerCase() || '';
  return /sign in|log in|sign up/.test(text) && !findComposer();
}

/**
 * Whether Grok is still answering.
 *
 * Busy only on positive evidence. A missing send button must read as idle, not
 * busy: Grok renders none for an empty composer, which is exactly the state the
 * page returns to after answering. Treating that as "still generating" would
 * mean `stable && !isGenerating()` could never pass and every node would run to
 * its timeout with the answer sitting on screen — the bug this shape of check
 * caused on Gemini.
 *
 * The real completion signal is the reply holding still across polls; this is
 * the secondary guard.
 */
function isGenerating(): boolean {
  if (findStopButton()) return true;

  /* Searched across the result area, not inside `article`.
     The previous version scoped to document.querySelector('article'), an
     element never confirmed to exist on /imagine — so this returned false for
     the entire render, every time. That alone was harmless; combined with a
     stall detector that read "no visible progress" as "failed", it killed
     nodes at sixty seconds while Grok was still working and the clip arrived
     minutes later. */
  const composer = composerRegion();
  const scope = document.querySelector<HTMLElement>('main') || document.body;

  for (const el of Array.from(scope.querySelectorAll<HTMLElement>(
    '[role="progressbar"], [class*="spinner"], [class*="skeleton"], '
    + '[class*="animate-pulse"], [class*="animate-spin"]'
  ))) {
    if (composer && composer.contains(el)) continue;
    if (isVisible(el)) return true;
  }

  const text = scope.innerText || '';
  if (/generating|creating your|rendering|queued|in progress|processing/i.test(text)) return true;

  return false;
}

/* ── Grok Imagine ──────────────────────────────────────────────
   /imagine is a generator rather than a chat, and its controls are a row of
   aria-labelled radio groups, which is about as good as this gets:

     [role="radiogroup"][aria-label="Generation mode"]  Image | Video | Agent
     [role="radiogroup"][aria-label="Video resolution"] 480p | 720p | 1080p
     [role="radiogroup"][aria-label="Video duration"]   6s | 10s | 15s
     button[aria-label="Aspect Ratio"]                  opens a menu

   Mode buttons carry an aria-label; the resolution and duration buttons carry
   only a <span> of text, so both are matched.
   ──────────────────────────────────────────────────────────── */

/**
 * Turns rendered in the chat thread. Zero means a fresh chat.
 *
 * `.message-bubble` — read off a live conversation, where it counted 2 against
 * 0 on an empty one. Both user and assistant turns carry it.
 */
function chatTurnCount(): number {
  return document.querySelectorAll('.message-bubble').length;
}

/**
 * The chat surface's New Chat control.
 *
 * Two anchors point at "/": the logo, which carries aria-label="Home page",
 * and New Chat, which carries no label at all. Taking the first visible one
 * picks the logo — it happens to land on a fresh chat today, but it is the
 * wrong element and would follow the logo anywhere it is later pointed. So
 * the unlabelled anchor is preferred, which distinguishes them without
 * depending on the words, since "New Chat" is localised and this account's
 * browser is not in English.
 */
function findNewChatControl(): HTMLElement | null {
  const labelled = Array.from(
    document.querySelectorAll<HTMLElement>('a[aria-label], button[aria-label]')
  ).find((el) => /new chat/i.test(el.getAttribute('aria-label') || '') && isVisible(el));
  if (labelled) return labelled;

  const roots = Array.from(document.querySelectorAll<HTMLElement>('a[href="/"]')).filter(isVisible);
  const byText = roots.find((a) => /new chat/i.test((a.textContent || '').trim()));
  if (byText) return byText;

  const unlabelled = roots.find((a) => !a.getAttribute('aria-label'));
  return unlabelled || roots[0] || null;
}

/**
 * Start a fresh chat before a text node.
 *
 * Text runs on the chat surface, where the thread persists between runs, so
 * without this Grok answers each node in the light of the previous ones —
 * the same defect fixed in the ChatGPT and Gemini adapters.
 *
 * Deliberately not applied to image or video. Those run on /imagine, whose
 * reset is "New Generation", and clearing it would also throw away the clip
 * an Extend node is about to continue.
 */
async function startNewChat(): Promise<boolean> {
  if (chatTurnCount() === 0) {
    logLine('Already on an empty chat — reusing it');
    return true;
  }
  const control = findNewChatControl();
  if (!control) {
    logLine('WARNING: New Chat control not found — continuing in the current thread, so this answer may be influenced by the previous one');
    return false;
  }
  control.click();
  for (let i = 0; i < 24; i++) {
    await sleep(250);
    if (chatTurnCount() === 0 && findComposer()) {
      logLine('Started a new chat');
      return true;
    }
  }
  logLine('WARNING: new chat did not settle in 6s — continuing anyway');
  return false;
}

/**
 * Put the generator's controls back on screen.
 *
 * A finished video leaves the tab on /imagine/post/<id>?conversation=<id>.
 * Measured there: `[role="radiogroup"]` matches NOTHING — no mode, no
 * resolution, no duration — while the composer is still present and still
 * accepts a prompt. So the mode guard found no group, declined to fire, and
 * the next node typed into that composer and generated in whatever mode the
 * previous run had left. An image node after a video node made a video, spent
 * the credits, and handed a clip to something expecting a still.
 *
 * The sidebar's New Generation button goes back to /imagine and the controls
 * return in about 800ms — measured — as a client-side navigation, so this
 * script survives it. Assigning location.href would reload the tab and kill
 * the run in progress instead.
 */
async function ensureGeneratorControls(): Promise<boolean> {
  if (findRadioGroup('Generation mode')) return true;

  const control =
    Array.from(document.querySelectorAll<HTMLElement>('button[aria-label], a[aria-label]'))
      .find((el) => /new generation/i.test(el.getAttribute('aria-label') || '') && isVisible(el))
    // The result view's own way out, kept as the fallback: it is an anchor to
    // /imagine rather than a button, so it survives a sidebar redesign.
    || Array.from(document.querySelectorAll<HTMLElement>('a[href="/imagine"]')).find(isVisible);

  if (!control) return false;

  logLine('This view has no generator controls — returning to /imagine first');
  control.click();
  for (let i = 0; i < 30; i++) {          // up to 6s
    await sleep(200);
    if (findRadioGroup('Generation mode')) return true;
  }
  return false;
}

function findRadioGroup(label: string): HTMLElement | null {
  const group = document.querySelector<HTMLElement>(`[role="radiogroup"][aria-label="${label}"]`);
  return group && isVisible(group) ? group : null;
}

/** Set one radio group, and confirm from aria-checked that it took. */
/**
 * @param loose also accept a button whose label merely STARTS WITH the value.
 *
 * For the speed pair only, whose second option carries a model version in its
 * text: it read "Quality (2.0)" this morning and "Quality (v2.0)" this
 * evening. Exact matching found neither, so `quality` silently did nothing and
 * the node's Speed setting never reached the page — visible as a node saying
 * Quality beside a Grok toolbar saying Speed. Left off everywhere else, where
 * exact values like "6s" and "720p" should not match a longer neighbour.
 */
async function selectRadio(groupLabel: string, value: string, loose = false): Promise<boolean> {
  const group = findRadioGroup(groupLabel);
  if (!group) return false;

  const want = value.trim().toLowerCase();
  const label = (b: Element) => ((b.getAttribute('aria-label') || b.textContent || '')).trim().toLowerCase();
  const radios = Array.from(group.querySelectorAll<HTMLElement>('[role="radio"]'));
  const btn = radios.find((b) =>
    (b.getAttribute('aria-label') || '').trim().toLowerCase() === want ||
    (b.textContent || '').trim().toLowerCase() === want
  ) || (loose ? radios.find((b) => label(b).startsWith(want)) : undefined);
  if (!btn) return false;
  if (btn.getAttribute('aria-checked') === 'true') return true;

  btn.click();
  for (let i = 0; i < 8; i++) {
    await sleep(150);
    if (btn.getAttribute('aria-checked') === 'true') return true;
  }
  return false;
}

/**
 * A pointerdown the menu library will accept.
 *
 * The listener is keyed on the event *type*, and Radix's handler additionally
 * checks `button === 0`, which MouseEvent carries — so MouseEvent is a working
 * stand-in where PointerEvent is missing. Chrome always has PointerEvent; the
 * fallback exists because an unguarded constructor throwing here would fail
 * the whole node over a menu that could have been opened.
 */
function pointerDown(): Event {
  const Ctor: any = (globalThis as any).PointerEvent || MouseEvent;
  return new Ctor('pointerdown', { bubbles: true, cancelable: true, button: 0 });
}

/**
 * Open a menu trigger and wait until it says it is open.
 *
 * click() does not open these. Measured on the live page: after a click the
 * trigger still reads aria-expanded="false" / data-state="closed" and the
 * document contains no menuitem at all. After pointerdown it reads "open" and
 * five items exist. Radix binds the open to pointerdown, and a synthetic click
 * never produces one.
 *
 * That is why the aspect ratio silently never applied — the item lookup ran
 * against a menu that had not opened, found nothing, and reported "not
 * offered, left as is" while the ratio stayed on whatever Grok had.
 *
 * data-state is the confirmation rather than a fixed sleep: the menu animates,
 * and the old 500ms guess was both slower than the common case and too short
 * for a loaded page.
 */
async function openMenuTrigger(trigger: HTMLElement): Promise<boolean> {
  if (trigger.getAttribute('data-state') === 'open') return true;
  /* Re-sent while waiting, not fired once and hoped for.
     Switching Generation mode remounts this row, and a pointerdown that
     lands during that remount goes to an element already thrown away — the
     poll then runs out against a trigger that never heard it. Seen exactly
     once live, immediately after switching to Image, and it worked on the
     next attempt with nothing else changed. */
  for (let i = 0; i < 12; i++) {
    if (i % 3 === 0) trigger.dispatchEvent(pointerDown());
    await sleep(100);
    if (trigger.getAttribute('data-state') === 'open') return true;
  }
  return false;
}

/** Aspect ratio lives behind a menu rather than in a radio group. */
async function selectAspectRatio(value: string): Promise<boolean> {
  const trigger = Array.from(document.querySelectorAll<HTMLElement>('button[aria-label="Aspect Ratio"]'))
    .find(isVisible);
  if (!trigger) return false;
  // The trigger shows the current value, so this is already-correct, not a skip.
  if ((trigger.textContent || '').includes(value)) return true;

  if (!(await openMenuTrigger(trigger))) return false;

  const item = Array.from(
    document.querySelectorAll<HTMLElement>('[role="menuitem"], [role="menuitemradio"], [role="option"]')
  ).find((el) => (el.textContent || '').trim().includes(value));
  if (!item) {
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    return false;
  }
  item.click();
  await sleep(400);
  // Confirmed from the trigger's own label, which is what the generator reads.
  return (trigger.textContent || '').includes(value);
}

/* ── Extend ────────────────────────────────────────────────────
   Imagine can continue a finished clip instead of starting a new one. The
   sequence, read off the live viewer:

     button[aria-label="Extend"]        on the open clip
       → button[aria-label="Cancel Extend"] replaces it   ← the proof
       → a "+6s" / "+10s" pill row appears
       → the composer takes a prompt and submits as usual

   "Cancel Extend" appearing is what makes this checkable. Without it, a click
   that did nothing would be indistinguishable from one that worked, and the
   node would generate a fresh clip while reporting that it had extended one.
   ──────────────────────────────────────────────────────────── */

const buttonByLabel = (label: string): HTMLElement | null =>
  Array.from(document.querySelectorAll<HTMLElement>('button[aria-label]'))
    .find((b) => (b.getAttribute('aria-label') || '').trim().toLowerCase() === label.toLowerCase()
      && isVisible(b)) || null;

/**
 * Whether the composer is in extend mode.
 *
 * The composer's placeholder becomes "Extend video" — that is the signal the
 * working grok-auto extension uses, and it is better than the one this file
 * originally had: it sits on the box we are about to type into, so it answers
 * "will this prompt extend the clip" rather than "is a button on screen
 * somewhere". The Cancel Extend button is kept as a second opinion.
 */
function inExtendMode(): boolean {
  for (const p of Array.from(document.querySelectorAll('[data-placeholder]'))) {
    if (/extend/i.test(p.getAttribute('data-placeholder') || '')) return true;
  }
  if (buttonByLabel('Cancel Extend')) return true;
  // The "× Extend Video" chip beside the composer.
  return Array.from(document.querySelectorAll<HTMLElement>('button'))
    .some((b) => /extend video/i.test((b.textContent || '').trim()) && isVisible(b));
}

/**
 * Open the clip this node is extending.
 *
 * Matched on the generation id in its mp4 URL, because the visible label is
 * the model's summary of the prompt and repeats across clips.
 */
/**
 * The Extend control, revealing the collapsed panel if that is where it is.
 *
 * Every place that asks "is Extend available" has to go through here. The
 * previous fix taught only startExtend to click "Post actions", and left
 * openClipForExtend testing for the bare button — so with the Studio side
 * panel open, which narrows the window and collapses that whole column, this
 * function could never succeed. It waited six seconds and reported the clip
 * was not in Grok's history, which was never the problem.
 */
async function findExtendControl(): Promise<HTMLElement | null> {
  const direct = buttonByLabel('Extend');
  if (direct) return direct;

  const reveal = buttonByLabel('Post actions');
  if (!reveal) return null;

  reveal.click();
  for (let i = 0; i < 12; i++) {
    await sleep(250);
    const revealed = buttonByLabel('Extend');
    if (revealed) return revealed;
  }
  return null;
}

async function openClipForExtend(videoUrl: string): Promise<boolean> {
  const id = /generated\/([^/]+)\//.exec(videoUrl || '')?.[1] || '';
  if (!id) {
    /* No generation id in the address. The one way this happens is a data:
       URL — the inlined copy of the clip made for playback — which identifies
       nothing on Grok. Named, because "not in Grok's history" sent the last
       two investigations to the page instead of to the value. */
    logLine(
      `Cannot locate the clip to extend: its address carries no generation id `
      + `(${(videoUrl || '(empty)').slice(0, 40)}…)`
    );
    return false;
  }

  const already = document.querySelector<HTMLVideoElement>(`video[src*="${id}"]`);
  // Already open in the viewer? Extend is only offered on an open clip.
  if (already && await findExtendControl()) return true;

  const thumb = Array.from(document.querySelectorAll<HTMLVideoElement>('video[src]'))
    .find((v) => v.src.includes(id));
  const openable = thumb?.closest('button') as HTMLElement | null;
  if (!openable) return false;

  openable.click();
  for (let i = 0; i < 20; i++) {
    await sleep(300);
    if (await findExtendControl()) return true;
  }
  return false;
}

/**
 * Put the composer into extend mode on the right clip.
 *
 * Returns a reason when it could not. Falling through to an ordinary
 * generation would produce a brand-new clip that looks like a success and
 * breaks the continuity the node existed for.
 */
/**
 * Why Grok is not offering Extend, when it is not.
 *
 * Measured on a live account: Extend appears on a 10s clip and a 20s clip and
 * is absent on a 30s one. Grok removes the control once a clip reaches its
 * limit — the same 30s ceiling the Extend node computes against, arrived at
 * from the other side. So an absent button is usually not a broken selector,
 * and saying "not offering Extend" sends the next investigation to the DOM
 * for a page that is behaving correctly.
 */
function extendUnavailableReason(): string {
  const viewer = Array.from(document.querySelectorAll('video'))
    .filter(isVisible)
    .sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width)[0];
  const seconds = viewer && isFinite(viewer.duration) ? Math.round(viewer.duration) : 0;

  if (seconds >= 30) {
    return `this clip is already ${seconds}s, and Grok stops offering Extend at its 30s limit`;
  }
  return 'Grok is not offering Extend on this clip';
}

async function startExtend(videoUrl: string, seconds: string | undefined): Promise<string | null> {
  if (!inExtendMode()) {
    if (!(await openClipForExtend(videoUrl))) {
      return 'Could not open the clip to extend — it is not in Grok\'s history on this page';
    }

    /* Three ways in, tried in the order they are cheapest to confirm.

       1. The Extend button itself, in the panel beside Regenerate and Share.

       2. That panel is not always on screen. Running Studio in the side panel
          narrows the window, and Grok collapses the whole column behind
          button[aria-label="Post actions"] — so the button this looked for
          existed in every screenshot taken with the panel closed and in none
          taken with it open. Reveal it, then look again.

       3. The "More options" menu, which is what the working grok-auto
          extension uses: its entries are div[role="menuitem"] with no button
          among them. */
    const extend = await findExtendControl();

    if (extend) {
      extend.click();
    } else {
      const more = buttonByLabel('More options');
      if (!more) return extendUnavailableReason();
      more.click();
      await sleep(900);
      const item = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'))
        .find((el) => /extend/i.test(el.textContent || '') && isVisible(el));
      if (!item) {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        return extendUnavailableReason();
      }
      item.click();
    }

    /* 15s, and it is not generous: entering extend mode re-renders the
       composer and grok-auto found it needed the room. */
    let engaged = false;
    for (let i = 0; i < 50 && !engaged; i++) {
      await sleep(300);
      engaged = inExtendMode();
    }
    if (!engaged) return 'Clicked Extend but Grok did not switch into extend mode';
    await sleep(800); // let the re-render settle before anything is typed
  }

  /* Optional. A node that names no length keeps whatever Imagine offers by
     default rather than guessing on the user's behalf. */
  if (seconds) {
    const want = seconds.startsWith('+') ? seconds : `+${seconds}`;
    const pill = Array.from(document.querySelectorAll<HTMLElement>('button'))
      .find((b) => (b.textContent || '').trim() === want && isVisible(b));
    if (pill) {
      pill.click();
      await sleep(300);
    } else {
      console.warn(`[AutoFlow Grok] Extend length ${want} is not offered — left as is`);
    }
  }
  return null;
}

/**
 * Finished clips.
 *
 * Grok renders a result as a <video> with the mp4 on src and a still on
 * poster — there is no <img> anywhere in it, which is why an image-only
 * search found nothing on this surface however long it waited.
 */
function collectResultVideos(): HTMLVideoElement[] {
  return Array.from(document.querySelectorAll<HTMLVideoElement>('video[src]'))
    .filter((v) => /generated_video|assets\.grok\.com/.test(v.src));
}

/** The composer's own container, used to keep attachments out of results. */
function composerRegion(): HTMLElement | null {
  const composer = findComposer();
  if (!composer) return null;
  /* Never document.body: callers exclude images inside this region, and a
     body-shaped region excludes every image on the page — the poller then finds
     nothing, ever. Learned the hard way on the ChatGPT script. */
  const host = composer.closest('form') as HTMLElement | null;
  if (host && host !== document.body) return host;
  const near = composer.parentElement?.parentElement as HTMLElement | null;
  return near && near !== document.body && near !== document.documentElement ? near : null;
}

/**
 * Blocks that look like rendered assistant prose.
 *
 * A ladder rather than one selector, because the turn markup is the part of
 * Grok that was not verified against a live conversation. Markdown output is
 * rendered into a prose/markdown container on every build of every chat app
 * this extension talks to, which makes it the steadiest thing to reach for
 * without a sample to read.
 */
function replyBlocks(): HTMLElement[] {
  const composer = composerRegion();
  const known = Array.from(document.querySelectorAll<HTMLElement>(
    '.response-content-markdown, [class*="response-content"], .message-bubble, ' +
    '[data-testid*="response"], [data-testid*="message"]'
  )).filter(isVisible);
  if (known.length) return known;

  return Array.from(document.querySelectorAll<HTMLElement>('[class*="prose"], [class*="markdown"]'))
    .filter((el) => {
      if (!isVisible(el)) return false;
      if (composer && composer.contains(el)) return false;
      // Skip wrappers whose only content is another candidate.
      return (el.innerText || '').trim().length > 0;
    });
}

/** The newest assistant turn's text. */
function readLatestReply(): string {
  const blocks = replyBlocks();
  return blocks.length ? (blocks[blocks.length - 1].innerText || '') : '';
}

/**
 * Images Grok produced — not ones we uploaded, and not UI chrome.
 *
 * Preferring reply blocks, with a page-wide fallback. Requiring the block would
 * mean an image rendered anywhere else is invisible rather than ambiguous, and
 * invisible is the failure that wastes six minutes.
 */
/**
 * The prompt this tab is currently generating for.
 *
 * Module-level because the result view is identified by carrying this text,
 * and the poller runs long after handleExecute has returned.
 */
let activePrompt = '';

/** The node this tab is currently working for. Stamped on messages that carry
    no nodeId of their own, so a caller can tell whose ask it is. */
let activeNodeId = '';

/**
 * The masonry section holding OUR generation.
 *
 * On a finished render Grok puts the submitted prompt in a chip at the top of
 * the section that holds its results — `div.bg-surface-l1 > span` with the
 * prompt as its only text. Discover sections have no such chip. That is the
 * one thing on the page that distinguishes our images from other people's,
 * since the markup around them is byte-for-byte the same component.
 *
 * Long prompts may be shortened in the chip, so a chip that is a prefix of
 * what we sent counts — but only a substantial one, so a two-word chip cannot
 * claim a section by accident.
 */
/** Whitespace-collapsed, case-folded — how prompt text is compared here. */
const normText = (s: string | null) => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();

function ourResultSection(): Element | null {
  const norm = normText;
  const want = norm(activePrompt);
  if (!want) return null;

  for (const section of Array.from(document.querySelectorAll('[id^="imagine-masonry-section"]'))) {
    for (const el of Array.from(section.querySelectorAll('span, p, h1, h2, h3'))) {
      if (el.children.length) continue;
      const text = norm(el.textContent);
      if (!text) continue;
      if (text === want) return section;
      // Truncated by the chip, or by Grok's own rewrite of a long prompt.
      const stem = text.replace(/[.…]+$/, '');
      if (stem.length >= 24 && want.startsWith(stem)) return section;
    }
  }
  return null;
}

function collectResultImages(): HTMLImageElement[] {
  const composer = composerRegion();
  const ourSection = ourResultSection();

  const usable = (img: HTMLImageElement): boolean => {
    const src = img.currentSrc || img.src || '';
    if (!src) return false;
    if (src.startsWith('data:') && src.length < 2000) return false; // inline icons
    if (composer && composer.contains(img)) return false;
    /* Discover, not your generation — but only when it really is Discover.

       /imagine renders a masonry feed of other people's public posts whose
       tiles pass every other test here, and a tile that lazy-loads during the
       wait is NEW, so the baseline diff does not stop it: a stranger's picture
       returned as the node's output, silently, reported as a success.

       The first attempt at this excluded the masonry markup outright. That was
       wrong, and wrong in the worse direction. Measured on a real completed
       render: OUR results sit in exactly the same component —

         div#imagine-masonry-section-0 > div.min-h-[100vh] > div
           > div.relative.group/media-post-masonry-card > div > img

       — identical to the Discover tiles, because it is the same component.
       So the blanket exclusion rejected every genuine result too, and the
       node waited out its timeout with two finished images on screen. The
       earlier "4 matches became 0" reading was not the filter working; it was
       the same component showing Discover at that moment.

       What actually separates them is on the page: the result view carries a
       chip holding the prompt we just submitted, and Discover carries none.
       So a section proven to be ours is searched, and any other section is
       skipped. With no prompt to match — a text node, an unknown state — the
       old exclusion stands, which errs toward returning nothing rather than
       returning someone else's picture. */
    const inMasonry = img.closest('[id^="imagine-masonry-section"]');
    if (inMasonry && inMasonry !== ourSection) return false;
    if (!inMasonry && img.closest('[class*="media-post-masonry-card"]')) return false;
    /* Grok Imagine results are hosted at assets.grok.com — recognise them
       even while still loading, since the URL alone confirms they are results
       rather than UI chrome. The old size check rejected them during the
       lazy-load window, so the poller saw nothing until it timed out. */
    const isGrokAsset = /assets\.grok\.com\/users\/.*\/(preview_image|generated_image)/i.test(src);
    if (isGrokAsset) return true;
    const rect = img.getBoundingClientRect();
    if (rect.width < 180 && rect.height < 180) return false;
    return img.complete && img.naturalWidth >= 256 && img.naturalHeight >= 256;
  };

  const gather = (roots: ParentNode[]): HTMLImageElement[] => {
    const seen = new Set<HTMLImageElement>();
    const out: HTMLImageElement[] = [];
    for (const root of roots) {
      for (const img of Array.from(root.querySelectorAll('img'))) {
        if (seen.has(img) || !usable(img)) continue;
        seen.add(img);
        out.push(img);
      }
    }
    return out;
  };

  const blocks = replyBlocks();
  const scoped = blocks.length ? gather(blocks) : [];
  return scoped.length ? scoped : gather([document]);
}

/**
 * What the page looks like when the expected result is not on it.
 *
 * The turn markup here is the unverified part, so a run that finds nothing has
 * to report what it did find. Without this the next report is "it didn't work",
 * and the fix costs another round of guessing.
 */
function describePage(): string {
  const imgs = Array.from(document.querySelectorAll('img'));
  return (
    `${imgs.length} images, ${imgs.filter((i) => i.complete && i.naturalWidth >= 256).length} at result size; ` +
    `${collectResultVideos().length} generated clip(s); ` +
    `${replyBlocks().length} reply block(s); ` +
    `mode=${findRadioGroup('Generation mode')
      ?.querySelector('[role="radio"][aria-checked="true"]')?.getAttribute('aria-label') || 'unknown'}; ` +
    `composer region ${composerRegion() ? 'identified' : 'NOT identified'}; ` +
    `generating=${isGenerating()}`
  );
}

/* ── Composer input ── */

/**
 * Put text in the composer and confirm it landed.
 *
 * ProseMirror rebuilds from its own document model, so assigning textContent
 * puts characters on screen that vanish on the next keystroke and send an empty
 * message. A paste event carrying text/plain goes through the editor's own
 * handler — verified on the live page by reading the text back, which is also
 * what this does rather than assuming.
 */
function fillComposer(el: HTMLElement, text: string): boolean {
  el.focus();

  if (el instanceof HTMLTextAreaElement) {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    setter?.call(el, text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return el.value.trim().length > 0;
  }

  /* Put the caret in the editor's paragraph before typing.
     Focus alone is not enough in extend mode: entering it re-renders the
     composer around a fresh <p data-placeholder="Extend video"> holding a
     trailing <br>, and execCommand acts on the selection rather than on the
     focused element. The working grok-auto extension does this for the same
     reason, and clears the break first so the text does not land after it. */
  const para = el.querySelector('p[data-placeholder]') || el.querySelector('p');
  if (para) {
    try {
      const range = document.createRange();
      range.selectNodeContents(para);
      range.collapse(false);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    } catch { /* selection APIs unavailable — the paths below still try */ }
  }

  const enough = () =>
    (el.innerText || el.textContent || '').trim().length >=
    // Proportional, with no ceiling: a fixed floor passes a 27-character
    // placeholder for a 200-character prompt.
    Math.max(4, Math.floor(text.trim().length * 0.6));

  /* Wrapped because constructing either of these can throw outright — a
     browser build that blocks synthetic clipboard events, or any environment
     without DataTransfer. Unguarded, that took down the whole node with
     "Grok step failed: DataTransfer is not defined" rather than falling
     through to the path below, which works fine. */
  try {
    const dt = new DataTransfer();
    dt.setData('text/plain', text);
    el.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }));
    if (enough()) return true;
  } catch {
    /* fall through */
  }

  // Fallback: the editor's own insertText path.
  window.getSelection()?.selectAllChildren(el);
  document.execCommand('insertText', false, text);
  el.dispatchEvent(new InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' }));
  return enough();
}

/* ── Reference images ── */

function dataUrlToFile(dataUrl: string, filename: string): File {
  const comma = dataUrl.indexOf(',');
  const header = dataUrl.slice(0, comma);
  const mime = /data:([^;,]+)/.exec(header)?.[1] || 'image/png';
  const body = dataUrl.slice(comma + 1);
  const binary = header.includes(';base64') ? atob(body) : decodeURIComponent(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const ext = mime.split('/')[1]?.replace('jpeg', 'jpg') || 'png';
  return new File([bytes], `${filename}.${ext}`, { type: mime });
}

function findFileInput(): HTMLInputElement | null {
  return document.querySelector<HTMLInputElement>('input[type="file"][accept*="image"]')
    || document.querySelector<HTMLInputElement>('input[type="file"]');
}

/** Grok ships its upload input in the page already; Attach is the fallback. */
async function revealFileInput(): Promise<HTMLInputElement | null> {
  const existing = findFileInput();
  if (existing) return existing;

  const opener = Array.from(document.querySelectorAll<HTMLElement>('button')).find((b) => {
    const label = b.getAttribute('aria-label') || '';
    return /attach|upload|add|file|image/i.test(label) && isVisible(b);
  });
  if (!opener) return null;

  opener.click();
  for (let i = 0; i < 10; i++) {
    await sleep(300);
    const input = findFileInput();
    if (input) {
      // Close the menu: an open overlay swallows the send click later.
      document.body.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Escape', code: 'Escape', bubbles: true,
      }));
      return input;
    }
  }
  return null;
}

function triggerFileInputChange(input: HTMLInputElement): void {
  input.dispatchEvent(new Event('change', { bubbles: true }));
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

const attachmentCount = () =>
  (composerRegion() || document.body).querySelectorAll('img').length;

/**
 * Attach references and confirm they are on screen before returning.
 *
 * Submitting mid-upload sends the text alone, and Grok then answers about an
 * image it never received — a run that looks perfect and is wrong.
 */
async function attachReferences(dataUrls: string[]): Promise<string | null> {
  const input = await revealFileInput();
  if (!input) return 'Could not find Grok\'s file upload — the reference image was not sent';

  let files: File[];
  try {
    files = dataUrls.map((url, i) => dataUrlToFile(url, `reference-${i + 1}`));
  } catch (e: any) {
    return `Reference image could not be decoded: ${e.message}`;
  }

  const baseline = attachmentCount();
  const dt = new DataTransfer();
  for (const f of files) dt.items.add(f);
  input.files = dt.files;
  triggerFileInputChange(input);

  const deadline = Date.now() + UPLOAD_TIMEOUT_MS;
  let stable = 0;
  while (Date.now() < deadline) {
    await sleep(500);
    const arrived = attachmentCount() - baseline;
    /* Not-disabled, rather than present-and-enabled. References are attached
       before the prompt is typed, and Grok renders no send button for an empty
       composer — requiring one here would time out every upload at 45s and call
       a working attachment a failure. */
    const btn = findSendButton() as HTMLButtonElement | null;
    const ready = !btn || (!btn.disabled && btn.getAttribute('aria-disabled') !== 'true');
    if (arrived >= files.length && ready) {
      if (++stable >= 2) return null; // two clean polls, not one
    } else {
      stable = 0;
    }
  }
  return files.length > 1
    ? `Only some of the ${files.length} reference images finished uploading to Grok`
    : 'Reference image did not finish uploading to Grok';
}

/* ── Capture ── */

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve((reader.result as string) || '');
    reader.onerror = () => reject(new Error('Failed to read image blob'));
    reader.readAsDataURL(blob);
  });
}

async function captureImage(img: HTMLImageElement): Promise<string> {
  const resp = await fetch(img.currentSrc || img.src);
  if (!resp.ok) throw new Error(`HTTP ${resp.status} fetching image`);
  const blob = await resp.blob();
  if (blob.size > MAX_CAPTURE_BYTES) {
    throw new Error(`Image too large to transfer (${Math.round(blob.size / 1e6)} MB)`);
  }
  return blobToDataUrl(blob);
}

/**
 * Imagine's image-only controls.
 *
 * Read off the live toolbar, which carries three things a still can set and
 * that nothing in this extension was touching:
 *
 *   button[aria-label="Image Count"]     menu: Auto ×2 ×4 ×8 ×12
 *   button[aria-label="Aspect Ratio"]    menu: 2:3 3:2 1:1 9:16 16:9
 *   [role="radiogroup"][aria-label="Image generation speed"]   Speed | Quality (2.0)
 *
 * Aspect ratio was already wired, but only inside the video branch, so an
 * image node asked for 9:16 and silently got whatever the toolbar was last
 * left on. The speed radios carry no aria-label — only a text span — which
 * `selectRadio` already handles, since it matches on either.
 */
async function selectImageCount(value: string): Promise<boolean> {
  const trigger = Array.from(document.querySelectorAll<HTMLElement>('button[aria-label="Image Count"]'))
    .find(isVisible);
  if (!trigger) return false;

  // The multiplication sign is U+00D7, not the letter x, in both the trigger
  // and the menu — normalise so a config of "x4" or "4" still matches.
  const norm = (s: string) => s.replace(/[×x]/gi, '').trim().toLowerCase();
  const want = norm(value);
  if (norm(trigger.textContent || '') === want) return true;

  if (!(await openMenuTrigger(trigger))) return false;

  const item = Array.from(document.querySelectorAll<HTMLElement>(
    '[role="menuitem"], [role="menuitemradio"], [role="option"]'
  )).find((el) => norm(el.textContent || '') === want);
  if (!item) {
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    return false;
  }
  item.click();
  await sleep(400);
  return norm(trigger.textContent || '') === want;
}

/**
 * Press a control by calling its React handler, in the page's own world.
 *
 * Grok's image submit ignores every event a content script can dispatch — a
 * pointer sequence, a bare .click(), Enter — while the identical press by hand
 * generates in ten seconds. Measured five ways; see submitPrompt.
 *
 * This is the route the Flow adapter already uses for the same refusal, and it
 * works on Grok: the worker runs a MAIN-world script that walks up from the
 * element to its React fiber, finds the `onClick` prop, and calls it with an
 * event object whose `isTrusted` is true and whose `nativeEvent` is a real
 * Event behind a Proxy reporting the same. Nothing is dispatched, so there is
 * no DOM event to be untrusted — the handler is simply invoked.
 *
 * Verified live on grok.com/imagine: onClick found at depth 0, accepted within
 * a second, two images produced from a fully scripted press.
 *
 * The element is addressed by a temporary id because the worker's script runs
 * in another world and cannot be handed a node reference.
 */
async function reactPress(el: Element, handlerName = 'onClick'): Promise<boolean> {
  const tempId = `af-grok-${Math.random().toString(36).slice(2)}`;
  const oldId = el.id;
  el.id = tempId;
  try {
    const res: any = await chrome.runtime.sendMessage({
      type: 'REACT_TRIGGER',
      payload: { elId: tempId, handlerName, isKey: false, keyVal: '' },
    });
    if (!res?.found) logLine(`React ${handlerName} not found on the send button${res?.error ? ` (${res.error})` : ''}`);
    return !!res?.success;
  } catch (e: any) {
    logLine(`Could not reach the worker for the React press: ${e?.message || e}`);
    return false;
  } finally {
    if (oldId) el.id = oldId;
    else el.removeAttribute('id');
  }
}

/**
 * Send the prompt, and confirm Grok took it.
 *
 * Grok disables the submit button whenever the composer is empty, and it
 * re-enables on React's next render rather than on the DOM mutation. Measured
 * on the live page: 646ms between the paste landing and `disabled` clearing.
 * The old code slept a flat 400ms and clicked whatever `findSendButton()`
 * returned — a disabled button, which swallows a click in complete silence.
 * Nothing threw, nothing logged, and the tracker then sat out its full ten
 * minutes waiting for a generation that had never been requested. That is the
 * node stuck at 52%.
 *
 * So: wait for enabled rather than guess at a delay, then verify the submit
 * was actually accepted. Grok clears the composer when it accepts, which is
 * the one signal available before the result exists.
 *
 * Returns an error string, or null when the prompt is away.
 */
async function submitPrompt(composer: HTMLElement): Promise<string | null> {
  const typed = (composer.innerText || composer.textContent || '').trim();
  const urlBefore = location.href;

  /* Positive evidence that GROK TOOK THIS PROMPT — nothing weaker.

     The previous version accepted a cleared composer, and a send button back
     to disabled, and anything that looked busy. Every one of those is produced
     by the failure it was meant to catch: a rejected image submit empties the
     composer, drops the page on Discover, and disables the button again,
     exactly as a successful one would. So `accepted()` returned true on the
     first poll, the handover never ran, no line reached the panel, and the
     node went back to waiting out its ten minutes. That is the hang, restored
     by the fix for the hang.

     What actually separates the two, measured on both paths:

       success (image)  the page starts showing OUR prompt — the result chip,
                        and the tab title, which flips within a second of a
                        real click
       success (video)  the URL moves to /imagine/post/<id>
       failure          title goes to "Imagine - Grok", no chip, URL unchanged

     A false positive costs ten minutes of silence; a false negative costs one
     needless button press. So this asks for proof, not for the absence of
     contradiction. */
  const promptOnPage = () => {
    const want = normText(typed);
    if (!want) return false;
    // "<prompt> - Grok" — and Grok truncates a long one, so a prefix counts.
    const title = normText(document.title.replace(/\s*[-–—]\s*grok\s*$/i, ''));
    if (title && title !== 'imagine') {
      const stem = title.replace(/[.…]+$/, '');
      if (stem === want || (stem.length >= 24 && want.startsWith(stem))) return true;
    }
    return !!ourResultSection();
  };

  const accepted = () =>
    location.href !== urlBefore     // the video flow navigates to a post
    || promptOnPage()               // the image flow starts showing the prompt
    || !!findStopButton();          // and anything mid-flight offers a stop

  /* Enabled, not merely present. `findSendButton()` answers "is there a
     button", which was never the question. */
  let btn: HTMLElement | null = null;
  for (let i = 0; i < 40; i++) {          // up to 6s
    const candidate = findSendButton();
    if (candidate && !(candidate as HTMLButtonElement).disabled) { btn = candidate; break; }
    await sleep(150);
  }

  if (!btn) {
    /* Enter is the fallback, and it is a real one — but if it also fails we
       must say so now rather than time out in six minutes. */
    composer.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter', code: 'Enter', bubbles: true, cancelable: true,
    }));
    for (let i = 0; i < 20; i++) { await sleep(150); if (accepted()) return null; }
    return 'Grok never enabled its send button for this prompt, and Enter did '
      + 'not submit either — the prompt is still sitting in the Grok composer.';
  }

  /* One press, then hand over.

     Grok gates generation on transient user activation, and nothing a content
     script dispatches carries it. Measured on the live page, same prompt and
     same settings, three ways:

       synthetic pointer sequence  composer cleared, went to Discover, nothing
       bare .click()               composer cleared, went to Discover, nothing
       real click                  two images in about ten seconds

     and at the moment of a synthetic submit, navigator.userActivation reads
     { isActive: false }. Enter fails identically. So this is not a selector to
     find or a delay to tune — it is a deliberate gate, and pressing harder
     cannot pass it.

     The press below is still worth making: it costs nothing, and if Grok ever
     drops the gate the node goes back to being hands-off with no code change.
     When it does not take, the run does not fail — everything else is already
     set up, so the one thing left is a click, and asking for it beats throwing
     the prepared prompt away. */
  /* React handler FIRST, dispatched events second.

     Order matters, and getting it backwards wasted a run. A dispatched press
     does reach Grok's submit handler — the handler runs, sees an untrusted
     event, and responds by clearing the composer and dropping the page on
     Discover WITHOUT generating. That is a destructive no-op: it consumes the
     prompt. Pressing the React handler afterwards then finds an empty composer
     on the wrong view and can do nothing, which is exactly what the panel
     showed — "calling its React handler directly" at 23:03:11, "Grok needs
     your click" six seconds later, with the composer empty behind it.

     Called first, on a page still holding the prompt, the same React handler
     generates. Measured on grok.com/imagine: onClick at depth 0, accepted in
     about a second, two images. So the strongest press goes first, and the
     dispatched one is kept only as the fallback for a Grok that stops
     exposing React props. */
  const confirm = async (polls: number): Promise<boolean> => {
    for (let i = 0; i < polls; i++) {
      await sleep(150);
      if (accepted()) return true;
    }
    return false;
  };

  if (await reactPress(btn, 'onClick')) {
    if (await confirm(40)) {            // 6s; it lands in about one
      logLine('Submitted via Grok’s React handler');
      return null;
    }
  }

  /* Fallback. Only reached when the React route is gone, and the composer may
     have been emptied by then, so put the prompt back before pressing. */
  const stillTyped = (composer.innerText || composer.textContent || '').trim();
  if (!stillTyped && typed) {
    logLine('React press did not take — refilling the prompt for one ordinary press');
    fillComposer(composer, typed);
    for (let i = 0; i < 40; i++) {
      const b = findSendButton();
      if (b && !(b as HTMLButtonElement).disabled) { btn = b; break; }
      await sleep(150);
    }
  }

  {
    const r = btn.getBoundingClientRect();
    const o: any = {
      bubbles: true, cancelable: true, composed: true,
      clientX: r.x + r.width / 2, clientY: r.y + r.height / 2,
      button: 0, buttons: 1, pointerId: 1, pointerType: 'mouse', isPrimary: true, detail: 1,
    };
    const Ptr: any = (globalThis as any).PointerEvent || MouseEvent;
    btn.dispatchEvent(new Ptr('pointerdown', o));
    btn.dispatchEvent(new MouseEvent('mousedown', o));
    btn.dispatchEvent(new Ptr('pointerup', { ...o, buttons: 0 }));
    btn.dispatchEvent(new MouseEvent('mouseup', { ...o, buttons: 0 }));
    (btn as HTMLButtonElement).click();
    if (await confirm(24)) return null;
  }

  return awaitUserSubmit(btn, accepted);
}

/** How long the run waits for the click before giving the prompt back. */
const HANDOFF_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Ask for the one click only a person can make, and wait for it.
 *
 * Everything else is done by the time this runs: the tab is open, the mode is
 * Image, the ratio, count and quality are set, and the prompt is in the box.
 * The alternative to waiting is discarding all of that and failing, which is
 * strictly worse for the user than being asked to press one button.
 *
 * The button is marked and scrolled into view, because "press the arrow in
 * Grok" is no use to someone looking at the canvas in another tab — the panel
 * line and the pulsing ring have to meet in the same place.
 */
async function awaitUserSubmit(
  btn: HTMLElement,
  accepted: () => boolean,
): Promise<string | null> {
  logLine('Grok needs your click — the prompt and settings are ready, press the ↑ arrow in the Grok tab');
  /* Grok blocks generation unless the click carries real user activation, and
     an extension cannot produce one. Say that once, plainly, rather than
     letting it look like the extension is broken. */
  send('STUDIO_NEEDS_CLICK', {
    nodeId: activeNodeId,
    platform: 'Grok',
    message: 'Press the ↑ arrow in the Grok tab to start this generation.',
  });

  /* The ring is a courtesy; the waiting below is the substance. Wrapped
     because decoration must never be able to fail a run — an unguarded
     scrollIntoView threw on a page shape that did not implement it and took
     the whole handover down with it, turning "press this button" into "Grok
     step failed". */
  let ring: HTMLElement | null = null;
  let style: HTMLElement | null = null;
  try {
    btn.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
    ring = document.createElement('div');
    ring.setAttribute('data-autoflow-hint', '1');
    const r = btn.getBoundingClientRect();
    Object.assign(ring.style, {
      position: 'fixed',
      left: `${r.left - 6}px`, top: `${r.top - 6}px`,
      width: `${r.width + 12}px`, height: `${r.height + 12}px`,
      border: '2px solid #b5f602', borderRadius: '999px',
      boxShadow: '0 0 0 4px rgba(181,246,2,0.25)',
      pointerEvents: 'none', zIndex: '2147483647',
      animation: 'autoflow-pulse 1.2s ease-in-out infinite',
    } as Partial<CSSStyleDeclaration>);
    style = document.createElement('style');
    style.textContent = '@keyframes autoflow-pulse{0%,100%{opacity:1}50%{opacity:.35}}';
    document.documentElement.append(style, ring);
  } catch { /* no highlight, still waiting */ }

  const started = Date.now();
  try {
    while (Date.now() - started < HANDOFF_TIMEOUT_MS) {
      await sleep(400);
      if (accepted()) {
        logLine(`Thanks — Grok took it after ${Math.round((Date.now() - started) / 1000)}s`);
        return null;
      }
      // The composer re-renders; keep the ring on the button wherever it went.
      const live = ring && findSendButton();
      if (live && ring) {
        const b2 = live.getBoundingClientRect();
        ring.style.left = `${b2.left - 6}px`;
        ring.style.top = `${b2.top - 6}px`;
        ring.style.width = `${b2.width + 12}px`;
        ring.style.height = `${b2.height + 12}px`;
      }
    }
  } finally {
    ring?.remove();
    style?.remove();
  }

  return 'Grok was ready but nobody pressed send within 5 minutes. Grok only '
    + 'starts a generation on a real click — an extension cannot make one — so '
    + 'this node needs the ↑ arrow pressed in the Grok tab while it runs.';
}

/* ── Execution ── */

async function handleExecute(payload: any): Promise<any> {
  const { nodeId, config } = payload || {};
  const prompt = (config?.prompt || '').trim();

  if (!nodeId) return { success: false };
  if (!prompt) {
    send('STUDIO_NODE_ERROR', { nodeId, error: 'Prompt is empty' });
    return { success: false };
  }

  console.log(`[AutoFlow Grok] Executing node ${nodeId}`);
  send('STUDIO_NODE_PROGRESS', { nodeId, progress: 10 });

  /* What the result view will be carrying if it is ours. Set before anything
     else touches the page, and cleared by the next node's run. */
  activePrompt = prompt;
  activeNodeId = nodeId;

  /* Text nodes only, and before the composer lookup and the baselines below,
     since the reset remounts the composer and empties the thread. Image and
     video are left alone on purpose: they run on /imagine, where the reset
     would also discard the clip an Extend node is about to continue. */
  // 'never' is the agent loop mid-run — there the thread is the memory.
  if (config?.mediaType === 'text' && config?.newChat !== 'never') {
    await startNewChat();
  }

  let composer = findComposer();
  for (let i = 0; !composer && i < 10; i++) {
    await sleep(600);
    composer = findComposer();
  }
  if (!composer) {
    send('STUDIO_NODE_ERROR', {
      nodeId,
      error: looksSignedOut()
        ? 'Not signed in to Grok — sign in on the Grok tab, then run again'
        : 'Grok prompt box not found on the page',
    });
    return { success: false };
  }

  const wantsText = config?.mediaType === 'text';
  const wantsVideo = config?.mediaType === 'video';
  /* What is on the page before we ask for anything, so the result can be told
     from it later. Re-taken after references are attached — see below. */
  const snapshot = () => new Set(
    wantsVideo
      ? collectResultVideos().map((v) => v.src)
      : collectResultImages().map((i) => i.currentSrc || i.src)
  );
  let preexisting = snapshot();
  const priorReply = wantsText ? readLatestReply().trim() : '';

  /* Imagine's controls, applied before the prompt goes in. Each one reports
     rather than assuming: a mode that did not take produces a still where a
     clip was asked for, and nothing downstream can tell the difference. */
  if (wantsVideo || config?.mediaType === 'image') {
    /* Extend continues a clip that lives on the view we are standing on, so
       it must not be sent back to a blank generator. Every other node needs
       the controls, and a view without them is not a view to type into. */
    if (!config?.extend && !findRadioGroup('Generation mode')) {
      if (await ensureGeneratorControls()) {
        // New Generation replaces the page: the composer found earlier is
        // detached, and the baseline was taken against a document that is gone.
        composer = findComposer() || composer;
        preexisting = snapshot();
      }
    }

    const mode = wantsVideo ? 'Video' : 'Image';
    if (await selectRadio('Generation mode', mode)) {
      console.log(`[AutoFlow Grok] Mode: ${mode}`);
    } else if (config?.extend) {
      /* Extend stands on the clip's own view, which carries no mode control
         and does not need one — the clip already fixes the medium, and
         startExtend below enters Imagine's extend flow from there. Refusing
         here would block the one node that is legitimately on that page. */
      logLine('Extending from the clip view — no mode control here, and none needed');
    } else {
      /* Unconditional now. This used to fire only when a mode group existed,
         so the one case that actually happens — no group at all, on the post
         view a video leaves behind — fell through and generated in the wrong
         mode without a word. Refusing costs a node; guessing costs a
         generation and returns the wrong kind of media. */
      send('STUDIO_NODE_ERROR', {
        nodeId,
        error: findRadioGroup('Generation mode')
          ? `Could not switch Grok to ${mode} mode — it is still set to something else`
          : `Grok is showing a view with no mode controls (${location.pathname}) and `
            + 'returning to /imagine did not bring them back, so this node cannot '
            + `confirm it would generate ${mode.toLowerCase()}. Open Grok Imagine and run it again.`,
      });
      return { success: false };
    }
  }

  /* Extending continues an existing clip, so none of the settings below apply
     — Imagine offers only a length, and the shot is already framed. Done
     before the prompt goes in, because entering extend mode re-renders the
     composer. */
  const wantsExtend = wantsVideo && !!config?.extend;
  if (wantsExtend) {
    if (!config?.extendFromVideo) {
      send('STUDIO_NODE_ERROR', {
        nodeId,
        error: 'Nothing to extend — wire this node to the Grok clip it should continue',
      });
      return { success: false };
    }
    const problem = await startExtend(config.extendFromVideo, config.extendSeconds);
    if (problem) {
      /* Also to the panel. The Diagnostics section was empty for a failure
         that happened entirely inside this tab, which left the console on
         grok.com as the only place the reason existed. */
      logLine(`Extend failed: ${problem}`);
      send('STUDIO_NODE_ERROR', {
        nodeId,
        error: `${problem}. Generating now would make a new clip instead of continuing this one.`,
      });
      return { success: false };
    }
    logLine(`Extending the previous clip${config.extendSeconds ? ` by ${config.extendSeconds}` : ''}`);
    composer = findComposer() || composer;
  }

  /* Image settings. These exist on the toolbar and were never applied — an
     image node's Ratio pill moved a value that reached the runner, went into
     the config, and stopped there, because the only call site was the video
     branch below. */
  if (config?.mediaType === 'image') {
    if (config?.aspectRatio) {
      const ok = await selectAspectRatio(config.aspectRatio);
      console.log(`[AutoFlow Grok] Aspect ratio: ${config.aspectRatio}${ok ? '' : ' — not offered, left as is'}`);
    }
    if (config?.imageCount) {
      const ok = await selectImageCount(config.imageCount);
      console.log(`[AutoFlow Grok] Image count: ${config.imageCount}${ok ? '' : ' — not offered, left as is'}`);
    }
    if (config?.quality) {
      // loose: the label carries a model version — 'Quality (v2.0)'.
      const ok = await selectRadio('Image generation speed', config.quality, true);
      console.log(`[AutoFlow Grok] Speed: ${config.quality}${ok ? '' : ' — not offered, left as is'}`);
    }
  }

  if (wantsVideo && !wantsExtend) {
    // Optional: a node that names none of these keeps whatever Grok has.
    for (const [group, value] of [
      ['Video resolution', config?.resolution],
      ['Video duration', config?.duration],
    ] as Array<[string, string | undefined]>) {
      if (!value) continue;
      const ok = await selectRadio(group, value);
      console.log(`[AutoFlow Grok] ${group}: ${value}${ok ? '' : ' — not offered, left as is'}`);
    }
    if (config?.aspectRatio) {
      const ok = await selectAspectRatio(config.aspectRatio);
      console.log(`[AutoFlow Grok] Aspect ratio: ${config.aspectRatio}${ok ? '' : ' — not offered, left as is'}`);
    }
  }

  const references: string[] = (config?.referenceImageData || [])
    .filter((d: unknown): d is string => typeof d === 'string' && d.startsWith('data:'));

  // Flow tile ids name a tile in another site's grid; Grok cannot resolve one.
  if (!references.length && (config?.referenceImageIds || []).length) {
    send('STUDIO_NODE_ERROR', {
      nodeId,
      error: 'Reference image could not be sent to Grok — the upstream node produced a Flow tile, not an image file',
    });
    return { success: false };
  }

  if (references.length) {
    const failure = await attachReferences(references);
    if (failure) {
      send('STUDIO_NODE_ERROR', { nodeId, error: failure });
      return { success: false };
    }
    console.log(`[AutoFlow Grok] ${references.length} reference image(s) attached`);
    send('STUDIO_NODE_PROGRESS', { nodeId, progress: 15 });
    /* The thumbnails we just uploaded are on the page now, and they are not
       results. Without this they count as new images, and since
       composerRegion() returns null whenever the composer has no <form>
       ancestor, one of them can be captured and returned as the generated
       image — a silently wrong result rather than a visible failure. */
    preexisting = snapshot();
    composer = findComposer() || composer; // uploading re-renders the composer
  }

  if (!fillComposer(composer, prompt)) {
    send('STUDIO_NODE_ERROR', { nodeId, error: 'Could not type into the Grok prompt box' });
    return { success: false };
  }

  const refused = await submitPrompt(composer);
  if (refused) {
    send('STUDIO_NODE_ERROR', { nodeId, error: refused });
    return { success: false };
  }

  console.log(`[AutoFlow Grok] Submitted — waiting for the ${wantsText ? 'reply' : 'image'}...`);
  send('STUDIO_NODE_PROGRESS', { nodeId, progress: 20 });

  // Hand the channel back now: Chrome closes a sendResponse channel long before
  // a generation finishes. Results travel by sendMessage instead.
  startAntiThrottle();
  const work = wantsText
    ? trackTextReply(nodeId, priorReply, config?.rawReply === true)
    : wantsVideo
      ? trackVideoGeneration(nodeId, preexisting)
      : trackGeneration(nodeId, preexisting);
  /* .finally re-raises, so without this a throw inside either tracker becomes
     an unhandled rejection: no STUDIO_NODE_ERROR is sent and the node sits
     pending until the runner's own budget turns a precise cause into a generic
     timeout. The Flow script handles the same case the same way. */
  work
    .catch((e: any) => {
      send('STUDIO_NODE_ERROR', {
        nodeId,
        error: `Tracking the Grok result failed: ${e?.message || e}`,
      });
    })
    .finally(stopAntiThrottle);
  return { success: true };
}

async function trackGeneration(nodeId: string, preexisting: Set<string>): Promise<void> {
  const startedAt = Date.now();
  let stableSrc = '';
  let stableCount = 0;
  let explained = false;

  while (Date.now() - startedAt < GENERATION_TIMEOUT_MS) {
    await sleep(POLL_MS);
    const elapsed = Date.now() - startedAt;
    send('STUDIO_NODE_PROGRESS', {
      nodeId,
      progress: Math.min(90, 20 + Math.floor((elapsed / GENERATION_TIMEOUT_MS) * 90)),
    });

    const fresh = collectResultImages().filter((i) => !preexisting.has(i.currentSrc || i.src));
    if (fresh.length === 0) {
      // "Still generating" and "it is on screen and I cannot see it" look
      // identical from outside. Say which, once, well before the timeout.
      if (!explained && elapsed > 45_000 && !isGenerating()) {
        explained = true;
        console.warn(`[AutoFlow Grok] No result yet and nothing is streaming. ${describePage()}`);
      }
      continue;
    }

    const candidate = fresh[fresh.length - 1];
    const src = candidate.currentSrc || candidate.src;
    if (src === stableSrc) stableCount++;
    else { stableSrc = src; stableCount = 0; }

    if (stableCount >= 3 && !isGenerating()) {
      try {
        const dataUrl = await captureImage(candidate);
        send('STUDIO_NODE_RESULT', {
          nodeId, tileId: '',
          imageUrl: dataUrl, thumbnailUrl: dataUrl, previewUrl: dataUrl,
        });
      } catch (e: any) {
        // Never report success without the bytes: a downstream node would
        // generate with no reference and look like it worked.
        send('STUDIO_NODE_ERROR', {
          nodeId,
          error: `Image generated but could not be captured: ${e.message}. It is still in the Grok tab.`,
        });
      }
      return;
    }
  }

  send('STUDIO_NODE_ERROR', {
    nodeId,
    error: `Grok image did not complete within 6 minutes — check the Grok tab (${describePage()})`,
  });
}

/** Consecutive quiet polls before a silent page is called a failure. */
/** Polls of silence before the log says so. Diagnostic only — see below. */
const STALL_POLLS = 45; // 45 x 2s = 90s

/**
 * Grok refusing to show what it made.
 *
 * A blocked generation renders a placeholder rather than a clip — the video
 * area becomes a grey box with an eye-off glyph — and it never turns into
 * anything. Distinguishing that from "still rendering" is the difference
 * between failing in seconds with a reason and spending six minutes to report
 * a timeout.
 *
 * Read from the result area only. The prompt is on the page too, and a prompt
 * about moderation must not be mistaken for a moderation notice.
 */
function readWithheldNotice(): string {
  const stage = document.querySelector<HTMLElement>('main') || document.body;
  const composer = composerRegion();

  const PATTERNS: Array<[RegExp, string]> = [
    [/moderat|content polic|guidelines|not allowed|violat|unsafe|inappropriate/i,
      'Grok withheld this generation'],
    [/couldn'?t (create|generate|make)|unable to (create|generate)|failed to generate/i,
      'Grok could not generate this'],
    [/hidden|blocked|unavailable/i, 'Grok is not showing this generation'],
  ];

  for (const [pattern, label] of PATTERNS) {
    for (const el of Array.from(stage.querySelectorAll<HTMLElement>('div, p, span'))) {
      if (el.children.length > 2) continue;
      if (composer && composer.contains(el)) continue;
      const text = (el.textContent || '').trim();
      if (text.length < 8 || text.length > 300) continue;
      if (!pattern.test(text)) continue;
      return `${label}: ${text.slice(0, 200)}`;
    }
  }
  return '';
}

/**
 * Wait for a clip that was not there when we started.
 *
 * Identified by its mp4 URL, which carries a generation id — the visible
 * label is the model's own summary of the prompt and is neither unique nor
 * predictable.
 *
 * The bytes are on assets.grok.com rather than grok.com, so fetching them may
 * be refused. That is survivable for showing the clip, since the Studio page
 * can load the URL directly; it is not survivable for chaining, so the poster
 * is fetched separately and a failure there is said out loud rather than
 * leaving a downstream node to fail with a missing reference.
 */
async function trackVideoGeneration(nodeId: string, preexisting: Set<string>): Promise<void> {
  const startedAt = Date.now();
  let stableSrc = '';
  let stableCount = 0;
  let explained = false;
  let stalled = 0;

  while (Date.now() - startedAt < GENERATION_TIMEOUT_MS) {
    await sleep(POLL_MS);
    const elapsed = Date.now() - startedAt;
    send('STUDIO_NODE_PROGRESS', {
      nodeId,
      progress: Math.min(90, 20 + Math.floor((elapsed / GENERATION_TIMEOUT_MS) * 90)),
    });

    /* Grok withheld it. A blocked generation never becomes a clip, so waiting
       out the full six minutes spends the run and then blames the timeout. */
    const withheld = readWithheldNotice();
    if (withheld) {
      logLine(`Generation withheld: ${withheld}`);
      send('STUDIO_NODE_ERROR', { nodeId, error: withheld });
      return;
    }

    const fresh = collectResultVideos().filter((v) => !preexisting.has(v.src));
    if (fresh.length === 0) {
      /* Nothing arriving and nothing streaming. Counted rather than timed
         from the start, so a genuinely slow render — which does show as
         generating — is never cut off; only a page that has gone quiet is.
         Six minutes of an unchanging screen is not patience, it is the run
         failing slowly and then reporting the wrong cause. */
      /* Counted and reported, never acted on.
         This block used to END the node after a minute of "nothing visible is
         happening", which inverted the burden of proof: not being able to SEE
         progress is not evidence there is none. Grok renders a clip for
         minutes with no indicator this script can reliably find, so that
         check failed good generations at sixty seconds and reported them as
         refusals — while the clip arrived later and sat on screen, exactly as
         asked for.

         A generation now ends early only on positive evidence — a refusal
         notice — and otherwise runs to its full budget. Slow and right beats
         fast and wrong: the timeout costs minutes, a false refusal costs the
         generation AND every node downstream of it. */
      if (!isGenerating()) stalled++; else stalled = 0;

      if (!explained && stalled >= STALL_POLLS) {
        explained = true;
        logLine(`Still waiting, nothing visibly streaming. ${describePage()}`);
      }
      continue;
    }
    stalled = 0;

    const candidate = fresh[fresh.length - 1];
    if (candidate.src === stableSrc) stableCount++;
    else { stableSrc = candidate.src; stableCount = 0; }

    if (stableCount >= 2 && !isGenerating()) {
      const poster = candidate.getAttribute('poster') || '';

      /* ── Poster (still image) ──
         Three layers, each compensating for the one above failing:
         1. fetch() the poster URL with credentials — works when cookies travel
         2. Draw the <video> frame onto a canvas — works regardless of CORS
         3. Give up — the node shows "done" with no preview, which is better
            than timing out pretending nothing happened. */
      let referenceUrl = '';

      // Layer 1: fetch the poster URL directly
      if (poster) {
        try {
          const resp = await fetch(poster, { credentials: 'include' });
          if (resp.ok) referenceUrl = await blobToDataUrl(await resp.blob());
        } catch {
          /* fall through to canvas */
        }
      }

      // Layer 2: canvas capture from the playing <video> element
      if (!referenceUrl && candidate.videoWidth > 0 && candidate.videoHeight > 0) {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = candidate.videoWidth;
          canvas.height = candidate.videoHeight;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(candidate, 0, 0);
            referenceUrl = canvas.toDataURL('image/jpeg', 0.92);
            console.log('[AutoFlow Grok] Poster captured via canvas fallback');
          }
        } catch {
          console.warn('[AutoFlow Grok] Canvas poster capture also failed (CORS-tainted)');
        }
      }

      if (!referenceUrl) {
        console.warn('[AutoFlow Grok] Could not capture a still — a node chained '
          + 'from this one will report a missing reference.');
      }

      /* ── Video bytes ──
         The extension page is chrome-extension:// and cannot reach
         assets.grok.com (no cookies, different origin). Fetch the mp4 here
         where the content script shares grok.com's session. */
      let videoDataUrl = '';
      try {
        const resp = await fetch(candidate.src, { credentials: 'include' });
        if (resp.ok) {
          const blob = await resp.blob();
          if (blob.size <= MAX_VIDEO_CAPTURE_BYTES) {
            videoDataUrl = await blobToDataUrl(blob);
            console.log(`[AutoFlow Grok] Video inlined (${(blob.size / 1e6).toFixed(1)} MB)`);
          } else {
            console.warn(`[AutoFlow Grok] Video too large to inline (${(blob.size / 1e6).toFixed(1)} MB)`);
          }
        } else {
          console.warn(`[AutoFlow Grok] Video fetch returned HTTP ${resp.status}`);
        }
      } catch (e: any) {
        console.warn('[AutoFlow Grok] Could not fetch video bytes:', e?.message);
      }

      send('STUDIO_NODE_RESULT', {
        nodeId,
        tileId: '',
        /* The clip's own address on Grok, ALWAYS the real URL and never the
           inlined copy. Extend needs it to find this clip again in Grok's
           history, and it locates it by the generation id in the path — which
           a data: URL does not have. Inlining the bytes for playback was
           therefore enough to break extending, at two layers at once. */
        videoUrl: candidate.src,
        imageUrl: videoDataUrl || referenceUrl || candidate.src,
        thumbnailUrl: referenceUrl || poster,
        previewUrl: referenceUrl || poster,
        previewVideoUrl: videoDataUrl || candidate.src,
        referenceUrl,
      });
      console.log(`[AutoFlow Grok] Clip captured — video=${videoDataUrl ? 'inlined' : 'URL only'}, still=${referenceUrl ? 'inlined' : 'unavailable'}`);
      return;
    }
  }

  send('STUDIO_NODE_ERROR', {
    nodeId,
    error: `Grok clip did not finish within 6 minutes — check the Grok tab (${describePage()})`,
  });
}

/**
 * @param raw  Return the reply verbatim and skip the prompt-shaped checks.
 *
 * An agent turn is a protocol message, not a prompt, and the prompt heuristic
 * rejects anything under 20 characters. `TOOL: read_canvas {}` is exactly 20,
 * which is the only reason the first live agent run worked at all — a shorter
 * action name would have been reported as "not a usable prompt" and failed the
 * node. Cleaning is skipped too: the agent parser does its own unwrapping, and
 * cleanAssistantReply strips surrounding quotes, which can be part of the JSON.
 */
async function trackTextReply(
  nodeId: string, priorReply: string, raw = false
): Promise<void> {
  const startedAt = Date.now();
  let lastSeen = '';
  let stableCount = 0;

  while (Date.now() - startedAt < TEXT_TIMEOUT_MS) {
    await sleep(POLL_MS);
    const elapsed = Date.now() - startedAt;
    send('STUDIO_NODE_PROGRESS', {
      nodeId,
      progress: Math.min(90, 20 + Math.floor((elapsed / TEXT_TIMEOUT_MS) * 90)),
    });

    const current = readLatestReply().trim();
    // Unchanged from before we asked means our answer has not started.
    if (!current || current === priorReply) continue;

    if (current === lastSeen) stableCount++;
    else { lastSeen = current; stableCount = 0; }

    if (stableCount >= 2 && !isGenerating()) {
      const cleaned = raw ? current : cleanAssistantReply(current);
      if (!raw && !looksLikeUsablePrompt(cleaned)) {
        send('STUDIO_NODE_ERROR', {
          nodeId,
          error: 'Grok replied but not with a usable prompt — check the Grok tab',
        });
        return;
      }
      console.log(`[AutoFlow Grok] Reply captured (${cleaned.length} chars)`);
      send('STUDIO_NODE_RESULT', { nodeId, tileId: '', text: cleaned });
      return;
    }
  }

  send('STUDIO_NODE_ERROR', {
    nodeId,
    error: `Grok did not finish answering in time — check the Grok tab (${describePage()})`,
  });
}
