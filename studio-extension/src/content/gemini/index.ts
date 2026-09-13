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
import { sleepOrDomChange } from '../shared/hiddenWait';
import { insertIntoEditable } from '../shared/composerText';

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
/* Silence BEFORE the first token is a different thing from silence after it.
 *
 * TEXT_QUIET_MS is a budget for "the answer stopped growing". It was being
 * applied from the moment of asking, because lastChangeAt only moves when the
 * reply text changes and before the first token it never moves. So a model
 * that thinks for longer than 45 seconds — which Flash Extended does routinely
 * — spent the rest of its thinking one bad poll away from being abandoned.
 *
 * That is what killed a Director Chief run: the Diagnostics feed read
 *
 *     Waiting 16s — finished false, generating true, reply 0 chars
 *     Waiting 30s — finished false, generating true, reply 0 chars
 *     Waiting 47s — finished false, generating true, reply 0 chars
 *
 * and the full answer was sitting in the Gemini tab afterwards. 0 chars is not
 * a fault there; it is what thinking looks like.
 *
 * So the wait before the answer starts gets its own budget, and it is long,
 * because there is nothing to be gained by giving up on a model that is
 * visibly working. TEXT_CEILING_MS is still the outer backstop. */
const NO_ANSWER_YET_MS = 5 * 60 * 1000;
/* And an ending has to be observed twice.
 *
 * The break above needed a SINGLE poll reading "not generating" to end the
 * run. isGenerating() reads the page, and the page passes through states
 * where it is momentarily neither streaming nor finished — between a thinking
 * phase ending and the first token, the send button re-enables and every
 * other signal is absent. One flicker there ended a live turn. */
const QUIET_POLLS_REQUIRED = 2;
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
import { shouldTidy, tidyAwayConversation, waitForNoDialog, openConversation, conversationId } from './tidy';

const ADAPTER_BUILD = 'thinking-wait-v5';

/** Backstop for a wedged tab. */
const TEXT_CEILING_MS = 10 * 60 * 1000;
const POLL_MS = 2000;
const UPLOAD_TIMEOUT_MS = 45 * 1000;
const MAX_CAPTURE_BYTES = 15 * 1024 * 1024;
/* The clip is inlined as a base64 data URL and travels through
   chrome.runtime.sendMessage, which caps a message at roughly 64MB. Base64 is
   4/3 the size of the bytes, so the old 50MB ceiling produced a ~67MB message:
   over the limit, and send() swallows the rejection, so the node simply never
   received its result and nothing said why.

   32MB of video is ~43MB on the wire, which fits. A clip above it falls back
   to the Gemini-hosted URL — that will not play outside the tab, which is
   visibly wrong rather than silently missing, and is the better failure. */
const MAX_VIDEO_CAPTURE_BYTES = 32 * 1024 * 1024;

if ((window as any).__af_gemini_listener) {
  try {
    chrome.runtime?.onMessage?.removeListener?.((window as any).__af_gemini_listener);
  } catch (_) {}
}

const _geminiMessageHandler = (msg: any, _sender: any, sendResponse: (r?: any) => void) => {
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
};

(window as any).__af_gemini_listener = _geminiMessageHandler;
chrome.runtime.onMessage.addListener(_geminiMessageHandler);

function send(type: string, payload: Record<string, unknown>): void {
  /* A rejection here used to vanish. The common cause is a payload over the
     messaging limit — an inlined clip — and the symptom was a node that never
     received its result with nothing anywhere saying why. Still non-fatal:
     the tab must not die because the worker was asleep. */
  const complain = (e: any) => console.warn(
    `[AutoFlow] "${type}" did not reach the extension:`, e?.message || e,
  );
  try { chrome.runtime.sendMessage({ type, payload }).catch(complain); } catch (e) { complain(e); }
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
    'a[data-test-id="side-nav-sparkle-button"], [data-test-id="side-nav-sparkle-button"]'
  );
  if (sparkle && isVisible(sparkle)) {
    const a = sparkle.tagName.toLowerCase() === 'a' ? sparkle : sparkle.querySelector<HTMLElement>('a');
    return a || sparkle;
  }

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
/**
 * @param sinceTurns  How many model turns existed when we submitted. Until the
 *   page has more than that, THIS turn has not rendered and the newest element
 *   on the page belongs to the previous one.
 *
 * That distinction is the whole reason the parameter exists. Without it the
 * checks below read the last finished answer: its `.response-footer` carries
 * `complete`, so this returned false — "nothing is generating" — while Gemini
 * was thinking about the question we had just asked. Paired with a quiet timer
 * that had already been armed, one such poll abandoned a live turn.
 */
function isGenerating(sinceTurns = 0): boolean {
  /* Gemini states this outright. The live DOM carries aria-busy on both the
     markdown panel and the label announcer, and the footer gains a `complete`
     class when the turn ends — all of it maintained by Gemini for screen
     readers, which makes it far steadier than any button. */
  const turns = document.querySelectorAll<HTMLElement>('model-response, structured-content-container');
  /* Our turn has not appeared yet. Nothing on the page describes it, so the
     per-turn markers below cannot be consulted — fall through to the page-wide
     ones, which do still speak for the request in flight. */
  const ours = turns.length > sinceTurns;
  const latest = ours ? turns[turns.length - 1] : null;
  if (latest) {
    if (latest.querySelector('[aria-busy="true"]')) return true;

    /* A finished video turn, before the footer is consulted.
    
       The footer's `complete` class is maintained for a text answer; a clip
       arrives in a <video-player> whose controls are the footer, and waiting
       for a class that never lands leaves a rendered video reading as still
       generating. Gemini only offers Download video once the file exists, so
       its presence settles it. */
    const playable = Array.from(latest.querySelectorAll<HTMLElement>('[aria-label]'))
      .some((el) => /^\s*download\s+video\s*$/i.test(el.getAttribute('aria-label') || ''));
    if (playable) return false;

    const footer = latest.querySelector('.response-footer');
    if (footer) return !footer.classList.contains('complete');
  }

  /* Active shimmer overlay on in-flight image generation */
  const activeShimmer = document.querySelector('.shimmer-overlay:not(.done-generating)');
  if (activeShimmer) return true;

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
 * And scoped again, to that turn's FOOTER. Reported as: the reply gets cut
 * off after about a second whenever the answer contains a code block. It does,
 * because a code block ships its own controls —
 *
 *   <code-block class="enable-luminous-code-block">
 *     <button aria-label="Download code"><mat-icon fonticon="arrow_circle_down">
 *     <button aria-label="Copy code">   <mat-icon fonticon="copy">
 *
 * — and Gemini renders them the instant the block opens, long before the text
 * inside it is written. Searching the whole turn for fonticon="copy" found
 * that one first and called the answer over, so a five-scene storyboard was
 * read as its first line and a half.
 *
 * The label saved the second check by accident: "Copy code" does not match
 * /^copy$/, so only the icon query was wrong. Not something to rely on — the
 * label is translated, which is the reason the icon is checked first.
 *
 * Read off the live page rather than reasoned about: `message-actions`,
 * `.response-container-footer` and `copy-button` are each exactly one per
 * turn, and each zero inside a code block. Anything inside `code-block` is
 * excluded as well, so a renamed footer degrades to the old behaviour minus
 * this bug rather than reintroducing it.
 *
 * Returns null when no model-response exists, so a renamed element falls back
 * to the old signals rather than waiting forever for a button it cannot find.
 */
function turnFinished(): boolean | null {
  const turns = document.querySelectorAll<HTMLElement>('model-response');
  if (!turns.length) return null;
  const last = turns[turns.length - 1];

  /* The footer if it can be found, the whole turn if it cannot. */
  const scope: HTMLElement = last.querySelector<HTMLElement>(
    'message-actions, .response-container-footer'
  ) || last;

  const icon = Array.from(scope.querySelectorAll<HTMLElement>(
    'mat-icon[fonticon="copy"], mat-icon[data-mat-icon-name="copy"]'
  )).find((el) => !el.closest('code-block'));
  if (icon) return true;

  const copyBtn = Array.from(scope.querySelectorAll<HTMLElement>('button'))
    .find((b) => !b.closest('code-block')
      && /^\s*copy\s*$/i.test(b.getAttribute('aria-label') || ''));
  if (copyBtn) return true;

  /* A video turn has no Copy at all.
   *
   * Its footer is the player's own controls — Download video, Share video,
   * Mute video, Play video — and nothing else. Reading the absence of Copy as
   * "still going" is what left a finished clip waiting: Gemini had rendered
   * the whole thing, 0:10 of 0:10, while the node sat at "Generating video…"
   * because this returned false on every poll and the caller's
   * `turnFinished() !== false` never opened.
   *
   * Download video is the marker, because Gemini only offers it once there is
   * a file to download. */
  const finishedPlayer = Array.from(last.querySelectorAll<HTMLElement>('[aria-label]'))
    .some((el) => /^\s*(download|share)\s+video\s*$/i.test(el.getAttribute('aria-label') || ''));
  if (finishedPlayer) return true;

  /* A media turn without those controls yet: cannot tell. Null, not false —
     the caller blocks only on an explicit "still going". */
  if (last.querySelector('video-player, video, generated-video')) return null;

  /* A text turn, and no Copy on it. HERE the absence does mean the answer is
     still being written, because Gemini puts Copy on every finished one — so
     this stays false, and the caller keeps refusing a half-written reply.
     
     Returning null for this case as well was tried and was wrong: it let a
     turn reading "half an answ" through as a finished result. The difference
     is whether the turn is text at all, which is why it is checked and not
     assumed. */
  return false;
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
/* ── Gemini's three modes ──
 *
 * Gemini answers a bare prompt with whatever it feels like, so the adapter used
 * to type into whichever composer happened to be there and hope. That is why an
 * image node worked only when somebody had already set the mode by hand, and
 * why a video node could never work at all: mediaType 'video' fell into the
 * image tracker, which watches <img> elements and would wait out its whole
 * backstop against a page playing a video.
 *
 * Each mode is a route, which is the useful part. Read off the live page:
 *
 *   /app      "Ask Gemini"           chat
 *   /images   "Describe your image"  image generation
 *   /videos   "Describe your video"  video generation, plus an aspect ratio
 *
 * Switched by CLICKING the sidebar link rather than assigning location.href.
 * Gemini is an Angular SPA, so the anchor is a client-side route: the document
 * survives and so does this content script. A real navigation would tear down
 * the script in the middle of its own run and the node would hang until its
 * backstop — which is the failure mode this whole file exists to avoid.
 *
 * Verified rather than assumed. The composer's placeholder and the sidebar's
 * is-active class both say which mode is live, and both are POSITIVE signals:
 * present when the mode is on rather than absent when it is off. */
type GeminiMode = 'chat' | 'image' | 'video';

const MODE_ROUTE: Record<GeminiMode, string> = {
  chat: '/app', image: '/images', video: '/videos',
};
const MODE_PLACEHOLDER: Record<GeminiMode, RegExp> = {
  chat: /ask gemini/i,
  image: /describe your image/i,
  video: /describe your video/i,
};

function currentMode(): GeminiMode | null {
  /* Route check first: client-side SPA navigation updates window.location.pathname */
  const path = window.location.pathname;
  if (path === '/videos' || path.startsWith('/videos/')) return 'video';
  if (path === '/images' || path.startsWith('/images/')) return 'image';

  const box = document.querySelector('[data-placeholder]');
  const hint = (box?.getAttribute('data-placeholder') || '').trim();
  for (const mode of ['image', 'video', 'chat'] as GeminiMode[]) {
    if (MODE_PLACEHOLDER[mode].test(hint)) return mode;
  }
  /* No placeholder to read — a composer already carrying text has none. Fall
     back to the sidebar, which marks the live route. */
  const active = document.querySelector('a.gem-nav-list-item.is-active[href], gem-nav-list-item.is-active a[href], a[aria-current="page"]');
  const href = active?.getAttribute('href') || '';
  for (const mode of ['image', 'video'] as GeminiMode[]) {
    if (href === MODE_ROUTE[mode]) return mode;
  }
  if (path === '/app' || path === '/' || path.startsWith('/app/')) return 'chat';
  return null;
}

/** Put Gemini in the mode this node needs. Returns a reason on failure. */
async function ensureMode(want: GeminiMode): Promise<string | null> {
  if (currentMode() === want) return null;

  /* By data-test-id first — "images-side-nav-entry-button",
     "videos-side-nav-entry-button" — which is what Gemini's own tests hold on
     to, and survives a route or class rename. The href is the fallback.

     NOTE: The data-test-id sits on the <gem-nav-list-item> host element, but the
     actual interactive Angular routerLink sits on the inner <a href="..."> tag.
     Clicking the host element alone does not dispatch to the router link; we
     must target the <a> element. */
  const item = document.querySelector<HTMLElement>(
    `[data-test-id="${want}s-side-nav-entry-button"]`,
  ) || document.querySelector<HTMLElement>(
    `a.gem-nav-list-item[href="${MODE_ROUTE[want]}"]`,
  ) || document.querySelector<HTMLElement>(
    `a[href="${MODE_ROUTE[want]}"]`,
  );
  if (!item) {
    return `Gemini has no "${want}" mode in this account — the sidebar has no `
      + `${MODE_ROUTE[want]} link. Image and video generation need a Gemini plan that offers them.`;
  }

  const link = (item.tagName.toLowerCase() === 'a' ? item : item.querySelector<HTMLElement>('a')) || item;

  logLine(`Switching Gemini to ${want} mode`);
  link.click();

  /* Wait for the mode to actually be live rather than for a fixed delay. A
     route change re-renders the composer, and typing into the old one is how a
     prompt ends up submitted in the wrong mode. */
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    await sleep(250);
    if (currentMode() === want) return null;
  }
  return `Gemini did not switch to ${want} mode — the composer still reads `
    + `"${(document.querySelector('[data-placeholder]')?.getAttribute('data-placeholder') || '?')}".`;
}

function findAspectRatioButton(): HTMLElement | null {
  const byAria = Array.from(document.querySelectorAll<HTMLElement>('button[aria-label]'))
    .find((b) => /aspect ratio|ratio/i.test(b.getAttribute('aria-label') || '') && isVisible(b));
  if (byAria) return byAria;

  const byIcon = Array.from(document.querySelectorAll<HTMLElement>('mat-icon[fonticon*="aspect" i], mat-icon[fonticon*="crop" i]'))
    .map((i) => i.closest('button') as HTMLElement | null)
    .find((b) => b && isVisible(b));
  if (byIcon) return byIcon;

  return null;
}

/**
 * Set the clip shape, when the node asked for one.
 *
 * Video mode only, and advisory: a ratio that cannot be set is worth saying out
 * loud and not worth failing a generation over, because the clip still renders
 * — in the wrong shape, which the user can see for themselves.
 */
async function setAspectRatio(ratio: string): Promise<void> {
  const wantPortrait = /9\s*:\s*16/.test(ratio);
  const wantLandscape = /16\s*:\s*9/.test(ratio);
  if (!wantPortrait && !wantLandscape) return;

  const btn = document.querySelector<HTMLElement>('button[aria-label^="Aspect ratio"]') || findAspectRatioButton();
  if (!btn) return;

  const already = (btn.getAttribute('aria-label') || '');
  if (wantPortrait && /portrait/i.test(already)) return;
  if (wantLandscape && /landscape/i.test(already)) return;

  btn.click();

  const wanted = wantPortrait ? /portrait|9\s*:\s*16/i : /landscape|16\s*:\s*9/i;
  let option: HTMLElement | undefined;
  for (let i = 0; i < 8; i++) {
    await sleep(200);
    option = Array.from(
      document.querySelectorAll<HTMLElement>('[role="menuitem"], [role="menuitemradio"], [role="option"], .cdk-overlay-pane button, mat-option'),
    ).find((el) => wanted.test(el.textContent || el.getAttribute('aria-label') || ''));
    if (option) break;
  }

  if (!option) {
    logLine(`Could not set ${ratio} — the aspect ratio menu did not open`);
    btn.click();
    return;
  }
  option.click();
  await sleep(300);
  logLine(`Aspect ratio set to ${ratio}`);
}

function collectResultImages(): HTMLImageElement[] {
  const composer = composerRegion();

  const usable = (img: HTMLImageElement): boolean => {
    const src = img.currentSrc || img.src || '';
    if (!src) return false;
    if (src.startsWith('data:') && src.length < 2000) return false; // inline icons
    if (composer && composer.contains(img)) return false;
    if (img.closest('user-query, [data-test-id="user-query"]')) return false;
    const rect = img.getBoundingClientRect();
    const parent = img.closest('generated-image, single-image, .attachment-container');
    const parentRect = parent?.getBoundingClientRect();
    const w = Math.max(rect.width, parentRect?.width || 0);
    const h = Math.max(rect.height, parentRect?.height || 0);
    if (w < 180 && h < 180 && rect.width < 180) return false;
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

  const turns = Array.from(document.querySelectorAll<HTMLElement>(
    'model-response, structured-content-container, generated-image, .attachment-container.generated-images'
  ));
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

  /* execCommand needs the DOCUMENT to have focus, not merely to be visible,
     so in a background tab it inserts nothing and says nothing. That is why
     a hidden Gemini run sat waiting until the tab was clicked. The shared
     helper keeps that path and falls back to a synthetic paste, which needs
     no focus. */
  return insertIntoEditable(el, text);
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

function findUploadButton(): HTMLElement | null {
  const composer = findComposer();
  // Traverse up to the full input bar (beyond rich-textarea, which only holds the editor)
  const bar = composer?.closest('.chat-input-container, .input-area-container, .bottom-container, .text-input-field, form')
    || composer?.parentElement?.parentElement?.parentElement
    || document.body;

  // 1. Mat-icon check with 'add', 'add_circle', 'upload', 'attach_file' anywhere in the input bar
  const icons = Array.from(bar.querySelectorAll<HTMLElement>('mat-icon')).filter((icon) => {
    const glyph = (icon.getAttribute('fonticon') || icon.getAttribute('data-mat-icon-name') || icon.textContent || '').trim().toLowerCase();
    return glyph === 'add' || glyph === 'add_circle' || glyph === 'upload' || glyph === 'attach_file';
  });

  for (const icon of icons) {
    const btn = icon.closest('button, [role="button"]') as HTMLElement | null;
    if (btn && isVisible(btn)) return btn;
  }

  // 2. Button aria-label, testid, or class in the bar (excluding mode pills like Images/Videos/Flash)
  const byAria = Array.from(bar.querySelectorAll<HTMLElement>('button, [role="button"]')).find((b) => {
    const label = (b.getAttribute('aria-label') || '').toLowerCase();
    const testId = (b.getAttribute('data-test-id') || b.getAttribute('data-testid') || '').toLowerCase();
    const text = (b.innerText || '').trim().toLowerCase();
    if (text === 'images' || text === 'videos' || text === 'chat' || text.includes('flash') || text.includes('extended')) return false;
    return /upload|attach|tools|add|plus/i.test(label)
      || /upload|attach|tools|add|plus/i.test(testId)
      || b.classList.contains('upload-button')
      || b.classList.contains('attachment-button');
  });
  if (byAria) return byAria;

  // 3. Fallback across entire document
  const pageIcons = Array.from(document.querySelectorAll<HTMLElement>('mat-icon')).filter((icon) => {
    const glyph = (icon.getAttribute('fonticon') || icon.getAttribute('data-mat-icon-name') || icon.textContent || '').trim().toLowerCase();
    return glyph === 'add' || glyph === 'add_circle' || glyph === 'upload';
  });
  for (const icon of pageIcons) {
    const btn = icon.closest('button, [role="button"]') as HTMLElement | null;
    if (btn && isVisible(btn)) return btn;
  }

  return Array.from(document.querySelectorAll<HTMLElement>('button, [role="button"]')).find((b) => {
    const label = `${b.getAttribute('aria-label') || ''} ${b.getAttribute('data-test-id') || ''} ${b.getAttribute('data-testid') || ''} ${b.getAttribute('title') || ''}`;
    const text = (b.innerText || '').trim().toLowerCase();
    if (text === 'images' || text === 'videos' || text === 'chat') return false;
    return /add|upload|attach|image|photo|file|plus/i.test(label) && isVisible(b);
  }) || null;
}

/** Gemini mounts its upload input behind the "+" menu on some surfaces. */
async function revealFileInput(): Promise<HTMLInputElement | null> {
  const existing = findFileInput();
  if (existing) return existing;

  const opener = findUploadButton();
  if (!opener) return null;

  opener.click();
  for (let i = 0; i < 12; i++) {
    await sleep(250);
    const input = findFileInput();
    if (input) return input;

    // If a menu overlay opened, click the "Upload files" / "Upload from computer" item
    const menuUpload = Array.from(
      document.querySelectorAll<HTMLElement>('.cdk-overlay-pane [role="menuitem"], .cdk-overlay-pane button, mat-menu [role="menuitem"], mat-menu button')
    ).find((item) => {
      const label = `${item.getAttribute('aria-label') || ''} ${item.innerText || ''} ${item.textContent || ''}`;
      return /upload|files|photo|image|computer/i.test(label) && isVisible(item);
    });

    if (menuUpload) {
      menuUpload.click();
      await sleep(250);
      const afterMenuInput = findFileInput();
      if (afterMenuInput) return afterMenuInput;
    }
  }
  return findFileInput();
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

  // 1. Direct clipboard paste & drop onto the composer (works across modes without menu clicks)
  const composer = findComposer();
  if (composer) {
    composer.focus();
    try {
      composer.dispatchEvent(new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData: dt,
      }));
    } catch {}

    try {
      composer.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: dt }));
      composer.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
      composer.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
    } catch {}
  }

  // 2. File input fallback if paste didn't mount attachment chips
  await sleep(300);
  if (settledAttachmentCount() === baseline && attachmentCount() === baseline) {
    const input = await revealFileInput();
    if (input) {
      input.files = dt.files;
      triggerFileInputChange(input);
    } else if (settledAttachmentCount() === baseline && attachmentCount() === baseline) {
      return 'Could not find Gemini\'s file upload — the reference image was not sent';
    }
  }

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
  const src = img.currentSrc || img.src || '';
  if (!src) throw new Error('Image element has no src attribute');
  if (src.startsWith('data:')) return src;

  try {
    const resp = await fetch(src);
    if (resp.ok) {
      const blob = await resp.blob();
      if (blob.size > MAX_CAPTURE_BYTES) {
        throw new Error(`Image too large to transfer (${Math.round(blob.size / 1e6)} MB)`);
      }
      const dataUrl = await blobToDataUrl(blob);
      if (dataUrl && dataUrl.startsWith('data:')) return dataUrl;
    }
  } catch (e: any) {
    console.warn('[AutoFlow Gemini] fetch blob failed, trying canvas fallback:', e?.message || e);
  }

  // Fallback: draw directly to canvas from loaded <img> element
  try {
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth || img.width || 768;
    canvas.height = img.naturalHeight || img.height || 768;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(img, 0, 0);
      const dataUrl = canvas.toDataURL('image/png');
      if (dataUrl && dataUrl.startsWith('data:')) return dataUrl;
    }
  } catch (e: any) {
    console.warn('[AutoFlow Gemini] canvas capture failed:', e?.message || e);
  }

  throw new Error('Image could not be converted to data URL');
}

/* Clearing up after a node — see ./tidy.ts */

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

  /* The previous node may still be clearing up after itself. Tidying runs
     after that node's answer was sent, so the runner can legitimately start
     this one while a confirm dialog is still open — and a modal overlay
     swallows the New Chat click, which would land this node's prompt in the
     previous node's thread. Waiting a moment is cheaper than that. */
  await waitForNoDialog();

  /* Isolate this node first. It has to happen before the composer lookup and
     before the baseline snapshots below, because the reset remounts the
     composer and empties the thread — doing it after would invalidate both,
     and the "what is new on screen" baselines would be taken against the
     previous conversation.

     'never' is the agent loop mid-run: there the thread is the memory, and
     resetting between turns would drop the tool results it just read. */
  if (config?.newChat !== 'never') {
    await startNewChat();
  } else if (config?.resumeConversation) {
    /* Continue THIS node's thread, not whichever one is on screen.
     *
     * 'never' on its own means "do not open a new chat", and after a Director
     * has run, the chat on screen is the Director's. The Chief's review turn —
     * written as a follow-up to a plan it made — would arrive in a
     * conversation that had never seen one, and the reply would look fine.
     *
     * Failing is the right outcome when we cannot get back. The runner clears
     * the node's thread and asks again with the full context, which costs a
     * turn; answering in the wrong room costs the run and says nothing. */
    const back = await openConversation(config.resumeConversation);
    if (!back) {
      logLine(`Could not return to conversation ${config.resumeConversation} — not answering in the wrong thread.`);
      send('STUDIO_NODE_ERROR', {
        nodeId,
        error: 'Could not reopen this node\'s Gemini conversation. It may have been deleted. '
          + 'The run will ask again with the full context.',
        threadLost: true,
      });
      return;
    }
    logLine(`Continuing this node's own conversation (${config.resumeConversation}).`);
  } else {
    console.log('[AutoFlow Gemini] Continuing the current thread (agent turn)');
  }

  /* Read after the reset and before the prompt. Together with the path this
     lands on afterwards it is what proves the finished thread is one this node
     created, and so the only thing it may tidy away. */
  const pathBefore = location.pathname;

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
  const wantsVideo = config?.mediaType === 'video';

  /* Before anything is typed. Gemini answers a bare prompt with whatever it
     feels like, so the mode has to be chosen rather than hoped for - and the
     composer is re-rendered by the route change, so choosing it afterwards
     would mean typing into an element that is about to be replaced. */
  const modeFailure = await ensureMode(wantsText ? 'chat' : wantsVideo ? 'video' : 'image');
  if (modeFailure) {
    /* Hard for video, soft for everything else.
     *
     * A video node that cannot reach video mode is finished: chat will not
     * produce a clip however long anyone waits, so failing now with a reason
     * beats twelve minutes of silence.
     *
     * An image or text node is a different case. Typing a prompt into whatever
     * composer is there and waiting for a picture is exactly what this adapter
     * did before any of this existed, and it worked whenever the mode was
     * already right. Refusing to run because a sidebar link moved would turn a
     * cosmetic change on Gemini's part into a dead node. */
    if (wantsVideo) {
      send('STUDIO_NODE_ERROR', { nodeId, error: modeFailure });
      return { success: false };
    }
    logLine(`${modeFailure} Carrying on in whatever mode is open.`);
  }
  composer = findComposer() || composer;      // the route change re-rendered it

  if (wantsVideo && config?.aspectRatio) await setAspectRatio(String(config.aspectRatio));

  const preexisting = new Set(
    wantsVideo
      ? collectResultVideos().map((v) => videoSrc(v))
      : collectResultImages().map((i) => i.currentSrc || i.src),
  );
  const priorReply = wantsText ? readLatestReply().trim() : '';
  /* How many model turns exist BEFORE we ask. Everything after this point that
     wants to know "is our turn running" has to be able to tell our turn from
     the last one, and a count taken here is the only thing that can. */
  const turnsBefore = document.querySelectorAll('model-response, structured-content-container').length;

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

  logLine(`Submitted — waiting for the ${wantsText ? 'reply' : wantsVideo ? 'clip' : 'image'}...`);
  send('STUDIO_NODE_PROGRESS', { nodeId, progress: 20 });

  // Hand the channel back now: Chrome closes a sendResponse channel long
  // before a generation finishes. Results travel by sendMessage instead.
  startAntiThrottle();
  const work = wantsText
    ? trackTextReply(nodeId, priorReply, config?.rawReply === true, turnsBefore)
    : wantsVideo
      ? trackVideo(nodeId, preexisting)
      : trackGeneration(nodeId, preexisting);
  work.finally(stopAntiThrottle);

  /* After the answer, never instead of it. The result has already been sent by
     the time this runs, so the worst a failure here can do is leave a row in
     the sidebar. Which threads are ours to throw away is shouldTidy's
     question, and it is answered in tidy.ts where it can be tested. */
  if (shouldTidy(config)) {
    work
      .then(() => tidyAwayConversation(pathBefore))
      .catch((e: any) => console.warn('[AutoFlow Gemini] Could not tidy the thread:', e?.message || e));
  }

  return { success: true };
}

/** Every finished clip on the page, ignoring anything still buffering. */
function collectResultVideos(): HTMLVideoElement[] {
  const composer = composerRegion();
  return Array.from(document.querySelectorAll<HTMLVideoElement>('generated-video video, video-player video, video')).filter((v) => {
    if (composer && composer.contains(v)) return false;
    if (v.closest('user-query, [data-test-id="user-query"]')) return false;
    const rect = v.getBoundingClientRect();
    const parent = v.closest('generated-video, video-player, model-response');
    const parentRect = parent?.getBoundingClientRect();
    const w = Math.max(rect.width, parentRect?.width || 0);
    const h = Math.max(rect.height, parentRect?.height || 0);
    if (w < 100 && h < 100 && rect.width < 100) return false;
    return !!videoSrc(v);
  });
}

/**
 * The URL a <video> is showing, however it carries it.
 *
 * currentSrc is empty until the browser starts loading, and Gemini's finished
 * clip arrives paused behind a play button with nothing buffered - so the
 * attribute, or a <source> child, is often the only place the URL exists.
 */
function videoSrc(v: HTMLVideoElement): string {
  return v.currentSrc
    || v.getAttribute('src')
    || v.querySelector('source')?.getAttribute('src')
    || '';
}

/**
 * Wait for a clip, then hand back the URL rather than the bytes.
 *
 * Unlike an image, a generated video is not captured into a data URL here. One
 * clip is tens of megabytes; a data URL of it would be carried through
 * sendMessage, parked in session storage on a dropped port, and written into
 * the saved workflow. The URL is what every other video path in this extension
 * passes, and the runner already knows how to fetch one when it needs frames.
 */
async function trackVideo(nodeId: string, preexisting: Set<string>): Promise<void> {
  const startedAt = Date.now();
  let stableSrc = '';
  let stableCount = 0;
  let explained = false;

  while (Date.now() - startedAt < 12 * 60 * 1000) {
    await sleepOrDomChange(2000);
    /* Reading while hidden, deliberately.
       This used to `continue` on document.hidden, on the theory that a
       throttled tab reads nothing useful. The DOM of a hidden tab is
       perfectly readable — what Chrome throttles is timers and rendering,
       not querySelector. So the skip did not avoid a bad read, it avoided
       ALL reads: a run hidden for its duration span the full twelve minutes
       collecting nothing and then reported a timeout for a clip that had
       finished. Decoding is the part that genuinely degrades, and the poster
       capture below already guards on videoWidth for exactly that. */

    const elapsed = Date.now() - startedAt;
    send('STUDIO_NODE_PROGRESS', {
      nodeId, progress: Math.min(90, 20 + Math.round((elapsed / (12 * 60 * 1000)) * 70)),
    });

    const fresh = collectResultVideos().filter((v) => !preexisting.has(videoSrc(v)));
    if (!fresh.length) {
      /* "Still rendering" and "it is on screen and I cannot see it" look
         identical from out here, and the second one cost a five-minute wait
         staring at a clip that was already finished. Say which, once, well
         before the timeout - and say what IS on the page, because the useful
         detail last time was that the player existed and had decoded nothing. */
      if (!explained && elapsed > 60_000 && !isGenerating()) {
        explained = true;
        const all = Array.from(document.querySelectorAll('video'));
        logLine(
          `No clip yet and nothing is rendering. ${all.length} <video> on the page`
          + `${all.length ? ` (readyState ${all.map((v) => v.readyState).join(',')}, `
            + `${all.filter((v) => videoSrc(v)).length} with a src)` : ''}`
          + ` - open the Gemini tab and check.`,
        );
      }
      continue;
    }

    const clip = fresh[fresh.length - 1];
    const src = videoSrc(clip);
    if (src === stableSrc) stableCount++;
    else { stableSrc = src; stableCount = 0; }

    /* Two unchanged polls AND the site saying it has stopped generating.

       Both signals, not one. isGenerating() reads the composer; turnFinished()
       reads the turn's own footer, and a clip's src can settle while the turn
       is still running. turnFinished() returns null when it cannot tell — a
       renamed footer — so `!== false` blocks only on an explicit "still
       going" and degrades to the old behaviour rather than waiting for a
       button that is no longer there. The comment above claimed this pair
       before the code did. */
    if (stableCount >= 2 && !isGenerating() && turnFinished() !== false) {
      let videoDataUrl = '';
      let referenceUrl = '';

      // Capture poster / thumbnail frame if video has dimensions
      if (clip.videoWidth > 0 && clip.videoHeight > 0) {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = clip.videoWidth;
          canvas.height = clip.videoHeight;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(clip, 0, 0);
            referenceUrl = canvas.toDataURL('image/jpeg', 0.92);
          }
        } catch {}
      }

      /* Fetch the mp4 bytes in the Gemini tab context (with Google cookies)
         and inline as a data URL so the Chrome extension / studio canvas can play it */
      try {
        const resp = await fetch(src, { credentials: 'include' });
        if (resp.ok) {
          const blob = await resp.blob();
          if (blob.size <= MAX_VIDEO_CAPTURE_BYTES) {
            videoDataUrl = await blobToDataUrl(blob);
            logLine(`Video inlined (${(blob.size / 1e6).toFixed(1)} MB)`);
          } else {
            console.warn(`[AutoFlow Gemini] Video too large to inline (${(blob.size / 1e6).toFixed(1)} MB)`);
          }
        }
      } catch (e: any) {
        console.warn('[AutoFlow Gemini] Could not fetch video bytes:', e?.message || e);
      }

      logLine(`Clip captured (${Math.round((clip.duration || 0) * 10) / 10}s)`);
      send('STUDIO_NODE_RESULT', {
        nodeId,
        tileId: '',
        videoUrl: src,
        imageUrl: videoDataUrl || referenceUrl || src,
        thumbnailUrl: referenceUrl || clip.poster || '',
        previewUrl: referenceUrl || clip.poster || '',
        previewVideoUrl: videoDataUrl || src,
        referenceUrl,
      });
      return;
    }
  }

  send('STUDIO_NODE_ERROR', {
    nodeId,
    error: 'Gemini did not finish the clip in time — check the Gemini tab',
  });
}

async function trackGeneration(nodeId: string, preexisting: Set<string>): Promise<void> {
  const startedAt = Date.now();
  let stableSrc = '';
  let stableCount = 0;
  let explained = false;

  while (Date.now() - startedAt < GENERATION_TIMEOUT_MS) {
    await sleepOrDomChange(POLL_MS);
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

    /* An image has settled across two polls and the page is not generating. */
    if (stableCount >= 2 && !isGenerating()) {
      try {
        logLine(`Capturing generated image...`);
        const dataUrl = await captureImage(candidate);
        logLine(`Image captured (${Math.round(dataUrl.length / 1024)} KB)`);
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
  nodeId: string, priorReply: string, raw = false, sinceTurns = 0
): Promise<void> {
  const startedAt = Date.now();
  let lastSeen = '';
  let lastChangeAt = Date.now();
  let stableCount = 0;
  /* Has our answer produced a single character yet. Everything about how long
     to wait depends on this, and nothing did before. */
  let answerStarted = false;
  /* Consecutive polls that read "not generating". One is a flicker. */
  let quietPolls = 0;

  while (Date.now() - startedAt < TEXT_CEILING_MS) {
    await sleepOrDomChange(POLL_MS);
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
    const running = isGenerating(sinceTurns);
    if (elapsed > 10_000
        && Math.floor(elapsed / 15_000) !== Math.floor((elapsed - POLL_MS) / 15_000)) {
      logLine(
        `Waiting ${Math.round(elapsed / 1000)}s — finished ${String(turnFinished())}, generating ${running}, `
        + `reply ${current.length} chars${answerStarted ? '' : ' (not started — thinking)'}`
      );
    }

    /* Silence, and nothing in flight. Checked before the "has it started"
       skip below, so a chat that never answers at all still ends.
     *
     * Two budgets, because the two silences mean different things. After the
     * first token, no growth for TEXT_QUIET_MS is an ending. Before it, there
     * is nothing to have stopped — the model is thinking, and thinking longer
     * than 45 seconds is ordinary on an extended model. Applying the first
     * budget to the second case is what reported a Director Chief as timed out
     * with its finished answer on screen.
     *
     * And an ending must be seen twice. The page passes through moments where
     * it is neither streaming nor finished; a single reading there is not
     * evidence that anything is over. */
    quietPolls = running ? 0 : quietPolls + 1;
    const silentFor = Date.now() - lastChangeAt;
    const budget = answerStarted ? TEXT_QUIET_MS : NO_ANSWER_YET_MS;
    if (silentFor > budget && quietPolls >= QUIET_POLLS_REQUIRED) {
      logLine(
        answerStarted
          ? `Reply stopped growing ${Math.round(silentFor / 1000)}s ago and nothing is running — taking it as finished.`
          : `No answer after ${Math.round(silentFor / 1000)}s and nothing is running — giving up.`
      );
      break;
    }
    // Unchanged from before we asked means our answer has not started.
    if (!current || current === priorReply) continue;
    if (!answerStarted) {
      answerStarted = true;
      logLine(`Answer started after ${Math.round(elapsed / 1000)}s.`);
    }

    if (current === lastSeen) stableCount++;
    else { lastSeen = current; stableCount = 0; lastChangeAt = Date.now(); }

    /* Two ways to know the turn is over, and they deserve different waits.
     *
     * turnFinished() true is the site SAYING SO: Gemini renders its end-of-turn
     * action bar only once the answer is complete, and there is no state in
     * which that bar exists while the text is still growing. So waiting two
     * more polls after it appears spends four seconds per node to learn
     * nothing — a minute across a sixteen-shot story.
     *
     * stableCount is the fallback for when the marker cannot be read at all
     * (null: a redesign, a turn we failed to scope). Then unchanged text plus
     * nothing running is the best evidence there is, and it still takes two
     * polls, because a pause between chunks looks exactly like an ending.
     *
     * false vetoes both. The site saying "still writing" outranks text that
     * merely looks settled.
     *
     * TEXT ONLY. The identical rule in trackGeneration would accept the first
     * image Gemini paints, before it sharpens — the same mistake as reading
     * Flow's poster as a finished clip. An image has its own stability test
     * and must keep it.
     */
    const said = turnFinished();
    if (said !== false && (said === true || (stableCount >= 2 && !running))) {
      const cleaned = raw ? current : cleanAssistantReply(current);
      if (!raw && !looksLikeUsablePrompt(cleaned)) {
        send('STUDIO_NODE_ERROR', {
          nodeId,
          error: 'Gemini replied but not with a usable prompt — check the Gemini tab',
        });
        return;
      }
      logLine(`Reply captured (${cleaned.length} chars)`);
      /* Where this happened, so the node can be brought back here. Read at
         the moment the answer lands, which is the only time it is certainly
         this turn's thread. */
      send('STUDIO_NODE_RESULT', {
        nodeId, tileId: '', text: cleaned,
        conversationPath: conversationId(location.pathname),
      });
      return;
    }
  }

  send('STUDIO_NODE_ERROR', {
    nodeId,
    error: 'Gemini did not finish answering in time — check the Gemini tab',
  });
}
