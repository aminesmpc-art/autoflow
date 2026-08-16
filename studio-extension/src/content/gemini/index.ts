/* ============================================================
   AutoFlow Studio — Gemini chat content script.

   Third platform, same contract as the ChatGPT one: take a Studio node's
   prompt, put it in the composer, submit, wait for what comes back, hand it
   to the runner. Text replies become the prompt for a downstream node; images
   become a reference.

   Chat only — no API key anywhere in this extension, by design. Everything
   here works the page the way a person would.

   Gemini's DOM differs from ChatGPT's in three ways that matter:
   - The composer is Quill (`.ql-editor`), not ProseMirror, so it takes plain
     text insertion but re-renders more eagerly.
   - Replies live in `<model-response>` custom elements. Those tag names are
     part of Gemini's component contract and have outlasted several visual
     redesigns, which makes them better anchors than any class.
   - There is no persistent "stop" button to read streaming from; the send
     button flipping back to enabled is the reliable end-of-turn signal.
   ============================================================ */

console.log('[AutoFlow Gemini] Content script loaded on', location.href);

import { cleanAssistantReply, looksLikeUsablePrompt } from '../chatgpt/chatgptReply';

const GENERATION_TIMEOUT_MS = 6 * 60 * 1000;
/* A reply is finished when it STOPS GROWING, not when a clock runs out.

   This was a flat 90 seconds from the moment of asking. A workflow plan is a
   long answer — Gemini streamed a fifteen-step JSON past that limit and the
   node reported "did not finish answering in time" while the finished reply
   sat on screen. Failing a request the site is still serving is the worst
   shape of timeout: it wastes the work and blames the wrong thing.

   So the budget is silence. While the text is still changing, or the page is
   still visibly generating, there is nothing to give up on. The ceiling below
   exists only to stop a wedged tab waiting forever. */
/** Nominal budget, used for the progress bar only. */
const TEXT_TIMEOUT_MS = 90 * 1000;
/** No change and nothing running for this long means it is over. */
const TEXT_QUIET_MS = 45 * 1000;
/* Gemini had no logger. Every wait it ever performed was invisible in
   Diagnostics, so a Gemini node that hung told the user nothing at all —
   the other three adapters have had this since they were written. */
function logLine(line: string): void {
  console.log(`[AutoFlow Gemini] ${line}`);
  try {
    chrome.runtime.sendMessage({ type: 'STUDIO_LOG', payload: { source: 'Gemini', line } })
      .catch(() => {});
  } catch {}
}

/* Bumped whenever this adapter's completion logic changes. A content
   script already injected into an open tab is NOT replaced when the
   extension is rebuilt — the tab must be reloaded too — and a stale
   script is indistinguishable from a broken fix unless it says which
   one it is. */
const ADAPTER_BUILD = 'footer-v2';

/** Backstop for a wedged tab. */
const TEXT_CEILING_MS = 10 * 60 * 1000;
const POLL_MS = 2000;
const UPLOAD_TIMEOUT_MS = 45 * 1000;
const MAX_CAPTURE_BYTES = 15 * 1024 * 1024;

chrome.runtime.onMessage.addListener((msg: any, _sender, sendResponse) => {
  if (msg?.type === 'PING') { sendResponse({ pong: true }); return true; }
  if (msg?.type === 'STUDIO_EXECUTE_NODE') {
    handleExecute(msg.payload)
      .catch((e: any) => {
        // A rejection here would leave sendResponse uncalled and the node
        // stuck at "running" until stopped by hand. Same trap the ChatGPT
        // script fell into; an error beats a hang.
        const error = `Gemini step failed: ${e?.message || e}`;
        console.error('[AutoFlow Gemini]', e);
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

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function isVisible(el: Element): boolean {
  const rect = el.getBoundingClientRect();
  if (rect.width < 5 || rect.height < 5) return false;
  const style = getComputedStyle(el);
  return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
}

/* Chrome throttles timers in background tabs, and the tab we open is
   deliberately in the background. A round-trip to the worker keeps this
   thread awake so the poller keeps ticking. */
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

/** Gemini's composer: a Quill editor inside a `rich-textarea`. */
function findComposer(): HTMLElement | null {
  const quill = document.querySelector<HTMLElement>('rich-textarea .ql-editor[contenteditable="true"]');
  if (quill && isVisible(quill)) return quill;

  const byRole = Array.from(
    document.querySelectorAll<HTMLElement>('[contenteditable="true"][role="textbox"], textarea')
  ).filter(isVisible);
  return byRole[0] || null;
}

/**
 * The send control — which does not exist until there is something to send.
 *
 * Gemini renders no send button at all while the composer is blank (the live
 * DOM shows only the model picker and a mic button beside an empty
 * `ql-editor.ql-blank`). Anything reading "is there a send button" as a
 * health check has to account for that.
 */
/**
 * Turns rendered in the thread. Zero means a fresh, unused chat.
 *
 * `user-query, model-response` — NOT `conversation-container`, which was the
 * obvious guess and is wrong: measured on a live hydrated thread, that element
 * is absent while these two are present. A count built on it reads every
 * conversation as empty, so the reset below would never fire and the bug it
 * exists to fix would look fixed.
 */
function turnCount(): number {
  return document.querySelectorAll('user-query, model-response').length;
}

/**
 * Gemini's New Chat control.
 *
 * The side-nav sparkle carries a data-test-id, so it is matched first: the
 * other control identifies itself only by aria-label="New chat", which is
 * localised and would miss on a non-English account. The href fallback is
 * structural for the same reason — no translation table to keep current.
 */
function findNewChatControl(): HTMLElement | null {
  const sparkle = document.querySelector<HTMLElement>(
    'a[data-test-id="side-nav-sparkle-button"]'
  );
  if (sparkle && isVisible(sparkle)) return sparkle;

  const byHref = Array.from(document.querySelectorAll<HTMLElement>('a[href="/app"]'))
    .find(isVisible);
  return byHref || sparkle || null;
}

/**
 * Start a fresh thread before running a node.
 *
 * Same reasoning as the ChatGPT adapter: without it every node appends to one
 * conversation, so Gemini answers each prompt in the light of the previous
 * ones and a reference image attached for one node stays in context for the
 * next. It matters more here than for text — an image model given a stale
 * picture in context will happily blend it into the new one.
 *
 * Clicks rather than assigning location: these are Angular router links, and a
 * real navigation would tear down this content script mid-run.
 *
 * Soft-fails. Losing isolation is bad; refusing to run because a nav control
 * moved is worse, and the log says which happened.
 */
async function startNewChat(): Promise<boolean> {
  if (turnCount() === 0) {
    console.log('[AutoFlow Gemini] Already on an empty chat — reusing it');
    return true;
  }
  const control = findNewChatControl();
  if (!control) {
    console.warn('[AutoFlow Gemini] WARNING: New Chat control not found — continuing in the current thread, so this answer may be influenced by the previous one');
    return false;
  }
  control.click();
  for (let i = 0; i < 24; i++) {
    await sleep(250);
    if (turnCount() === 0 && findComposer()) {
      console.log('[AutoFlow Gemini] Started a new chat');
      return true;
    }
  }
  console.warn('[AutoFlow Gemini] WARNING: new chat did not settle in 6s — continuing anyway');
  return false;
}

function findSendButton(): HTMLElement | null {
  const known = document.querySelector<HTMLElement>(
    'button.send-button, [data-test-id="send-button"]'
  );
  if (known && isVisible(known)) return known;

  /* Angular Material draws its icons as ligature text on mat-icon, so the
     glyph name is readable and does not translate.

     Both names, because Gemini changed it. Measured on the live composer:
     the control is now aria-label="Send message" with fonticon="arrow_upward",
     and no fonticon="send" exists anywhere on the page. With only the old
     name, this rung and the .send-button rung above are both dead, leaving a
     localised aria-label as the sole way to find the send button. */
  const byIcon = Array.from(document.querySelectorAll<HTMLElement>(
    'mat-icon[fonticon="send"], mat-icon[fonticon="arrow_upward"]'
  ))
    .map((i) => i.closest('button') as HTMLElement | null)
    .find((b) => b && isVisible(b));
  if (byIcon) return byIcon;

  for (const btn of document.querySelectorAll<HTMLElement>('button[aria-label]')) {
    const label = btn.getAttribute('aria-label') || '';
    // "Dictate" and "Upload and tools" sit right beside it; match send only.
    if (/^send|send message|envoyer|enviar|senden|invia|送信|보내기|发送/i.test(label) && isVisible(btn)) {
      return btn;
    }
  }
  return null;
}

/** An explicit stop control, shown only while Gemini is writing. */
function findStopButton(): HTMLElement | null {
  const byIcon = Array.from(document.querySelectorAll<HTMLElement>('mat-icon[fonticon="stop"]'))
    .map((i) => i.closest('button') as HTMLElement | null)
    .find((b) => b && isVisible(b));
  if (byIcon) return byIcon;

  for (const btn of document.querySelectorAll<HTMLElement>('button[aria-label]')) {
    const label = btn.getAttribute('aria-label') || '';
    if (/stop|arrêter|detener|parar|anhalten|停止|중지/i.test(label) && isVisible(btn)) return btn;
  }
  return null;
}

/** Signed-out pages show a marketing splash instead of a composer. */
function looksSignedOut(): boolean {
  const text = document.body?.innerText?.slice(0, 1500).toLowerCase() || '';
  return /sign in|log in|get started with gemini/.test(text) && !findComposer();
}

/**
 * Whether Gemini is still writing.
 *
 * A missing send button must read as idle, not busy. Gemini renders no send
 * control while the composer is empty — which is exactly the state the page
 * returns to after answering. Treating that as "still generating" meant the
 * completion check `stable && !isGenerating()` could never pass, and every
 * node would have run to its timeout with the answer sitting on screen.
 *
 * So: busy only on positive evidence — a stop control, or a send button that
 * is present and disabled. The real completion signal is the reply text
 * holding still across consecutive polls; this is the secondary guard.
 */
function isGenerating(): boolean {
  /* Gemini states this outright. The live DOM carries aria-busy on both the
     markdown panel and the label announcer, and the footer gains a `complete`
     class when the turn ends — all of it maintained by Gemini for screen
     readers, which makes it far steadier than any button. */
  const turns = document.querySelectorAll<HTMLElement>('model-response');
  const latest = turns[turns.length - 1];
  if (latest) {
    if (latest.querySelector('[aria-busy="true"]')) return true;
    const footer = latest.querySelector('.response-footer');
    if (footer) return !footer.classList.contains('complete');
  }

  if (findStopButton()) return true;
  const btn = findSendButton() as HTMLButtonElement | null;
  if (!btn) return false;
  return btn.disabled || btn.getAttribute('aria-disabled') === 'true';
}

/** The composer's own container, used to keep attachments out of results. */
function composerRegion(): HTMLElement | null {
  const composer = findComposer();
  if (!composer) return null;
  // Never document.body: callers exclude images inside this region, and a
  // body-shaped region excludes every image on the page — the poller then
  // finds nothing, ever. Learned the hard way on the ChatGPT script.
  const host = composer.closest('rich-textarea, form') as HTMLElement | null;
  if (host && host !== document.body) return host;
  const near = composer.parentElement?.parentElement as HTMLElement | null;
  return near && near !== document.body && near !== document.documentElement ? near : null;
}

/**
 * Whether the newest reply has finished, or null if it cannot be told.
 *
 * Gemini renders its footer — Good response, Bad response, Redo, Copy — only
 * once a turn is complete, so the copy control is a positive statement that
 * the answer is over. Everything else here is an absence: no stop control,
 * text unchanged for two polls. Absences lie. A pause mid-answer is
 * indistinguishable from a finished one, and this adapter has no persistent
 * stop button to fall back on, which makes the guess weaker here than on
 * ChatGPT rather than stronger.
 *
 * Matched on the icon first. fonticon="copy" is semantic and survives
 * translation; aria-label="Copy" does not, and a French or German UI would
 * silently never finish. Nothing here reads the Angular class names in that
 * markup — _ngcontent-ng-c2488831720 is a build id that changes on every
 * Gemini deploy — nor the jslog attribute, which is telemetry.
 *
 * Scoped to the LAST model-response, because every earlier one carries a copy
 * button too and a page-wide query would report "finished" the moment the
 * conversation had any history at all.
 *
 * Returns null when no model-response exists, so a renamed element falls back
 * to the old signals rather than waiting forever for a button it cannot find.
 */
function turnFinished(): boolean | null {
  const turns = document.querySelectorAll<HTMLElement>('model-response');
  if (!turns.length) return null;
  const last = turns[turns.length - 1];
  if (last.querySelector('mat-icon[fonticon="copy"], mat-icon[data-mat-icon-name="copy"]')) {
    return true;
  }
  return !!Array.from(last.querySelectorAll<HTMLElement>('button'))
    .find((b) => /^\s*copy\s*$/i.test(b.getAttribute('aria-label') || ''));
}

/**
 * The newest model turn's text.
 *
 * Read from `message-content` rather than the whole `model-response`. The
 * response element also contains the footer — Good response, Bad response,
 * Redo, Copy, Show more options — and taking its innerText would append that
 * button text to every prompt the next node runs.
 */
function readLatestReply(): string {
  const inner = document.querySelectorAll<HTMLElement>(
    'message-content, .model-response-text, .markdown-main-panel'
  );
  if (inner.length) return inner[inner.length - 1].innerText || '';
  const turns = document.querySelectorAll<HTMLElement>('model-response');
  return turns.length ? turns[turns.length - 1].innerText || '' : '';
}

/**
 * Images Gemini produced — not ones we uploaded, and not UI chrome.
 *
 * Preferring model turns, with a page-wide fallback. Requiring the turn would
 * mean an image rendered anywhere else is invisible rather than ambiguous,
 * and invisible is the failure that wastes six minutes.
 */
function collectResultImages(): HTMLImageElement[] {
  const composer = composerRegion();

  const usable = (img: HTMLImageElement): boolean => {
    const src = img.currentSrc || img.src || '';
    if (!src) return false;
    if (src.startsWith('data:') && src.length < 2000) return false; // inline icons
    if (composer && composer.contains(img)) return false;
    if (img.closest('user-query, [data-test-id="user-query"]')) return false;
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

  const turns = Array.from(document.querySelectorAll<HTMLElement>('model-response'));
  const scoped = turns.length ? gather(turns) : [];
  return scoped.length ? scoped : gather([document]);
}

/* ── Composer input ── */

/**
 * Put text in the composer and confirm it landed.
 *
 * Quill ignores a bare textContent assignment — it re-renders from its own
 * model and the text vanishes on the next keystroke, so the send goes out
 * empty. insertText goes through the editor, and the result is read back
 * rather than assumed.
 */
function fillComposer(el: HTMLElement, text: string): boolean {
  el.focus();

  if (el instanceof HTMLTextAreaElement) {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    setter?.call(el, text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return el.value.trim().length > 0;
  }

  const sel = window.getSelection();
  sel?.selectAllChildren(el);
  document.execCommand('insertText', false, text);
  el.dispatchEvent(new InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' }));

  const landed = (el.innerText || el.textContent || '').trim();
  // Proportional, with no ceiling: a fixed floor passes a 27-character
  // placeholder for a 200-character prompt.
  return landed.length >= Math.max(4, Math.floor(text.trim().length * 0.6));
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

/** Gemini mounts its upload input behind the "+" menu on some surfaces. */
async function revealFileInput(): Promise<HTMLInputElement | null> {
  const existing = findFileInput();
  if (existing) return existing;

  const opener = Array.from(document.querySelectorAll<HTMLElement>('button')).find((b) => {
    const label = `${b.getAttribute('aria-label') || ''} ${b.getAttribute('data-test-id') || ''}`;
    return /add|upload|attach|image|file|plus/i.test(label) && isVisible(b);
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

/** Angular tracks file inputs through its own change plumbing. */
function triggerFileInputChange(input: HTMLInputElement): void {
  input.dispatchEvent(new Event('change', { bubbles: true }));
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

/**
 * Attachments sitting in the composer, waiting to be sent.
 *
 * Counted from Gemini's own preview component, not by looking for <img> inside
 * the composer. Measured on the live page: the chip renders in
 * `.attachment-preview-wrapper`, which is a SIBLING of `rich-textarea`, so a
 * count scoped to composerRegion() returned zero no matter what had uploaded.
 * Every reference therefore spun the whole 45s and was reported as a failed
 * upload while the file sat attached and visible on screen.
 *
 * A clip renders the same chip with a duration badge ("0:06") instead of a
 * thumbnail, which is the other reason this counts the component rather than
 * the picture inside it — video uploads have no <img> at all.
 *
 * `uploader-file-preview` is an Angular component tag, in the same family as
 * `model-response`: those have outlasted several redesigns, where classes have
 * not. The wrapper fallback covers a rename of the tag.
 */
function attachmentCount(): number {
  const chips = document.querySelectorAll('uploader-file-preview, .file-preview-chip');
  if (chips.length) return chips.length;
  return document.querySelectorAll(
    '.attachment-preview-wrapper img, .attachment-preview-wrapper video'
  ).length;
}

/** Progress indicators Angular Material can draw for an in-flight upload. */
const PROGRESS = 'mat-spinner, mat-progress-spinner, [role="progressbar"], '
  + '.mat-mdc-progress-spinner, .mat-mdc-progress-bar';

/**
 * Whether a file is still going up.
 *
 * The chip is NOT the finish line. Measured on a 119KB clip: the chip appears
 * at ~400ms with a spinner on it and the upload only completes at ~1200ms, and
 * the send button is never disabled at any point. So "a chip exists" plus "the
 * send button works" — the old condition — was satisfiable while the file was
 * still uploading, and submitting there sends the prompt alone. Gemini then
 * answers about a file it never received, which reads as a working run with a
 * wrong answer.
 *
 * Scoped to the attachment wrapper on purpose: Gemini keeps an unrelated
 * page-level spinner mounted, so a document-wide check would never clear.
 */
function uploadInProgress(): boolean {
  const wrapper = document.querySelector('.attachment-preview-wrapper');
  if (!wrapper) return false;
  return wrapper.querySelectorAll(PROGRESS).length > 0;
}

/**
 * Attachments that have finished uploading.
 *
 * `gem-media-attachment` is what a finished image or clip chip contains — the
 * positive signal, rather than inferring completion from an absent spinner.
 * Falls back to the chip count for anything that is not media, so a format
 * that renders differently is not stuck waiting forever.
 */
function settledAttachmentCount(): number {
  const media = document.querySelectorAll('gem-media-attachment').length;
  return media || (uploadInProgress() ? 0 : attachmentCount());
}

/**
 * Attach references and confirm they are on screen before returning.
 *
 * Submitting mid-upload sends the text alone, and Gemini then answers about
 * an image it never received — a run that looks perfect and is wrong.
 */
async function attachReferences(dataUrls: string[]): Promise<string | null> {
  const input = await revealFileInput();
  if (!input) return 'Could not find Gemini\'s file upload — the reference image was not sent';

  let files: File[];
  try {
    files = dataUrls.map((url, i) => dataUrlToFile(url, `reference-${i + 1}`));
  } catch (e: any) {
    return `Reference image could not be decoded: ${e.message}`;
  }

  // Measured the same way it is compared below, or the delta is nonsense.
  const baseline = settledAttachmentCount();
  const dt = new DataTransfer();
  for (const f of files) dt.items.add(f);
  input.files = dt.files;
  triggerFileInputChange(input);

  const deadline = Date.now() + UPLOAD_TIMEOUT_MS;
  let stable = 0;
  while (Date.now() < deadline) {
    await sleep(500);
    /* SETTLED, not merely present. A chip appears the instant the file is
       picked and sits there spinning while the bytes go up; counting chips
       alone let a submit through mid-upload. */
    const arrived = settledAttachmentCount() - baseline;
    /* Not-disabled, rather than present-and-enabled. References are attached
       before the prompt is typed, and Gemini renders no send button for an
       empty composer — requiring one here would have timed out every upload
       at 45s and called a working attachment a failure.

       It is not a completion signal either way: measured live, this button
       stays enabled throughout the upload, which is why the spinner check
       above is doing the real work. */
    const btn = findSendButton() as HTMLButtonElement | null;
    const ready = !btn || (!btn.disabled && btn.getAttribute('aria-disabled') !== 'true');
    if (arrived >= files.length && !uploadInProgress() && ready) {
      if (++stable >= 2) return null; // two clean polls, not one
    } else {
      stable = 0;
    }
  }
  return files.length > 1
    ? `Only some of the ${files.length} reference images finished uploading to Gemini`
    : 'Reference image did not finish uploading to Gemini';
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

/* ── Execution ── */

async function handleExecute(payload: any): Promise<any> {
  const { nodeId, config } = payload || {};
  const prompt = (config?.prompt || '').trim();

  if (!nodeId) return { success: false };
  if (!prompt) {
    send('STUDIO_NODE_ERROR', { nodeId, error: 'Prompt is empty' });
    return { success: false };
  }

  logLine(`Executing node ${nodeId} [adapter ${ADAPTER_BUILD}]`);
  send('STUDIO_NODE_PROGRESS', { nodeId, progress: 10 });

  /* Isolate this node first. It has to happen before the composer lookup and
     before the baseline snapshots below, because the reset remounts the
     composer and empties the thread — doing it after would invalidate both,
     and the "what is new on screen" baselines would be taken against the
     previous conversation.

     'never' is the agent loop mid-run: there the thread is the memory, and
     resetting between turns would drop the tool results it just read. */
  if (config?.newChat !== 'never') {
    await startNewChat();
  } else {
    console.log('[AutoFlow Gemini] Continuing the current thread (agent turn)');
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
        ? 'Not signed in to Gemini — sign in on the Gemini tab, then run again'
        : 'Gemini prompt box not found on the page',
    });
    return { success: false };
  }

  const wantsText = config?.mediaType === 'text';
  const preexisting = new Set(collectResultImages().map((i) => i.currentSrc || i.src));
  const priorReply = wantsText ? readLatestReply().trim() : '';

  const references: string[] = (config?.referenceImageData || [])
    .filter((d: unknown): d is string => typeof d === 'string' && d.startsWith('data:'));

  // Flow tile ids name a tile in another site's grid; Gemini cannot resolve one.
  if (!references.length && (config?.referenceImageIds || []).length) {
    send('STUDIO_NODE_ERROR', {
      nodeId,
      error: 'Reference image could not be sent to Gemini — the upstream node produced a Flow tile, not an image file',
    });
    return { success: false };
  }

  if (references.length) {
    const failure = await attachReferences(references);
    if (failure) {
      send('STUDIO_NODE_ERROR', { nodeId, error: failure });
      return { success: false };
    }
    logLine(`${references.length} reference image(s) attached`);
    send('STUDIO_NODE_PROGRESS', { nodeId, progress: 15 });
    composer = findComposer() || composer; // uploading re-renders the composer
  }

  if (!fillComposer(composer, prompt)) {
    send('STUDIO_NODE_ERROR', { nodeId, error: 'Could not type into the Gemini prompt box' });
    return { success: false };
  }
  await sleep(400);

  const btn = findSendButton();
  if (btn) {
    btn.click();
  } else {
    composer.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter', code: 'Enter', bubbles: true, cancelable: true,
    }));
  }

  logLine(`Submitted — waiting for the ${wantsText ? 'reply' : 'image'}...`);
  send('STUDIO_NODE_PROGRESS', { nodeId, progress: 20 });

  // Hand the channel back now: Chrome closes a sendResponse channel long
  // before a generation finishes. Results travel by sendMessage instead.
  startAntiThrottle();
  const work = wantsText
    ? trackTextReply(nodeId, priorReply, config?.rawReply === true)
    : trackGeneration(nodeId, preexisting);
  work.finally(stopAntiThrottle);
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
        const all = Array.from(document.querySelectorAll('img'));
        console.warn(
          '[AutoFlow Gemini] No result yet and nothing is streaming. ' +
          `${all.length} images on the page, ` +
          `${all.filter((i) => i.complete && i.naturalWidth >= 256).length} at result size; ` +
          `${document.querySelectorAll('model-response').length} model turns; ` +
          `composer region ${composerRegion() ? 'identified' : 'NOT identified'}.`
        );
      }
      continue;
    }

    const candidate = fresh[fresh.length - 1];
    const src = candidate.currentSrc || candidate.src;
    if (src === stableSrc) stableCount++;
    else { stableSrc = src; stableCount = 0; }

    /* The footer is the only positive signal that the turn is over, so it has
       the deciding vote when it can be read. false means still writing — keep
       waiting even though the text looks settled. */
    if (stableCount >= 2 && !isGenerating() && turnFinished() !== false) {
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
          error: `Image generated but could not be captured: ${e.message}. It is still in the Gemini tab.`,
        });
      }
      return;
    }
  }

  send('STUDIO_NODE_ERROR', {
    nodeId,
    error: 'Gemini image did not complete within 6 minutes — check the Gemini tab',
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
  let lastChangeAt = Date.now();
  let stableCount = 0;

  while (Date.now() - startedAt < TEXT_CEILING_MS) {
    await sleep(POLL_MS);
    const elapsed = Date.now() - startedAt;
    send('STUDIO_NODE_PROGRESS', {
      nodeId,
      progress: Math.min(90, 20 + Math.floor((elapsed / TEXT_TIMEOUT_MS) * 90)),
    });

    const current = readLatestReply().trim();
    /* Say WHY it is still waiting, every fifteen seconds.
       A node sat at 83% for four minutes with the finished reply on screen
       and Diagnostics said only "waiting for the reply". Nothing separated a
       model still thinking from an adapter that could no longer recognise the
       end — nor from a tab running a previously injected script, which no
       amount of rebuilding fixes and nothing anywhere reported. */
    if (elapsed > 10_000
        && Math.floor(elapsed / 15_000) !== Math.floor((elapsed - POLL_MS) / 15_000)) {
      logLine(
        `Waiting ${Math.round(elapsed / 1000)}s — finished ${String(turnFinished())}, generating ${isGenerating()}, reply ${current.length} chars`
      );
    }

    /* Silence, and nothing in flight. Checked before the "has it started"
       skip below, so a chat that never answers at all still ends. */
    if (Date.now() - lastChangeAt > TEXT_QUIET_MS && !isGenerating()) break;
    // Unchanged from before we asked means our answer has not started.
    if (!current || current === priorReply) continue;

    if (current === lastSeen) stableCount++;
    else { lastSeen = current; stableCount = 0; lastChangeAt = Date.now(); }

    /* The footer is the only positive signal that the turn is over, so it has
       the deciding vote when it can be read. false means still writing — keep
       waiting even though the text looks settled. */
    if (stableCount >= 2 && !isGenerating() && turnFinished() !== false) {
      const cleaned = raw ? current : cleanAssistantReply(current);
      if (!raw && !looksLikeUsablePrompt(cleaned)) {
        send('STUDIO_NODE_ERROR', {
          nodeId,
          error: 'Gemini replied but not with a usable prompt — check the Gemini tab',
        });
        return;
      }
      logLine(`Reply captured (${cleaned.length} chars)`);
      send('STUDIO_NODE_RESULT', { nodeId, tileId: '', text: cleaned });
      return;
    }
  }

  send('STUDIO_NODE_ERROR', {
    nodeId,
    error: 'Gemini did not finish answering in time — check the Gemini tab',
  });
}
