/* ============================================================
   AutoFlow Studio — Z.AI (chat.z.ai) content script.

   Text & workflow plan generation on Z.AI (GLM-4 / GLM-5).
   Automates typing into the composer, submitting, and tracking
   streaming replies for workflow planning (Build tab) and
   canvas Ask AI / Story Director nodes.
   ============================================================ */

console.log('[AutoFlow Z.AI] Content script loaded on', location.href);

import { cleanAssistantReply, looksLikeUsablePrompt } from '../chatgpt/chatgptReply';

const TEXT_TIMEOUT_MS = 180 * 1000;
const TEXT_QUIET_MS = 60 * 1000;
const TEXT_CEILING_MS = 15 * 60 * 1000; // 15 minutes ceiling for Deep Think Max
const POLL_MS = 800;

/* Bumped whenever this adapter's completion logic changes, so a stale
   content script is visible in Diagnostics instead of being guessed at. */
const ADAPTER_BUILD = 'copy-first-v2';

chrome.runtime.onMessage.addListener((msg: any, _sender, sendResponse) => {
  if (msg?.type === 'PING') { sendResponse({ pong: true }); return true; }
  if (msg?.type === 'STUDIO_EXECUTE_NODE') {
    handleExecute(msg.payload)
      .catch((e: any) => {
        const error = `Z.AI step failed: ${e?.message || e}`;
        console.error('[AutoFlow Z.AI]', e);
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

function logLine(line: string): void {
  console.log(`[AutoFlow Z.AI] ${line}`);
  try {
    chrome.runtime.sendMessage({ type: 'STUDIO_LOG', payload: { source: 'Z.AI', line } })
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

/* Chrome background tab anti-throttle */
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

/* ── DOM Selectors & Thinking Detectors ── */

function findComposer(): HTMLElement | null {
  const byId = document.querySelector<HTMLElement>('#chat-input, #message-input, [data-testid="chat-input"]');
  if (byId && isVisible(byId)) return byId;

  const textareas = Array.from(document.querySelectorAll<HTMLElement>('textarea')).filter(isVisible);
  if (textareas.length) return textareas[textareas.length - 1];

  const editable = Array.from(document.querySelectorAll<HTMLElement>('div[contenteditable="true"]')).filter(isVisible);
  if (editable.length) return editable[editable.length - 1];

  const inputs = Array.from(document.querySelectorAll<HTMLElement>('input[type="text"]')).filter(isVisible);
  return inputs[0] || null;
}

function findSendButton(): HTMLElement | null {
  const exact = document.querySelector<HTMLElement>(
    'button#send-message-button, button.sendMessageButton, button[id="send-message-button"]'
  );
  if (exact && isVisible(exact)) return exact;

  for (const btn of Array.from(document.querySelectorAll<HTMLElement>('button'))) {
    const label = (
      (btn.getAttribute('aria-label') || '') + ' ' +
      (btn.getAttribute('data-testid') || '') + ' ' +
      (btn.className || '') + ' ' +
      (btn.id || '')
    ).toLowerCase();
    if (/send-message-button|sendmessagebutton|send|submit/i.test(label) && isVisible(btn)) return btn;
  }

  const composer = findComposer();
  if (composer) {
    const parent = composer.closest('form, [class*="input"], [class*="box"], [class*="container"]') || composer.parentElement;
    if (parent) {
      const btns = Array.from(parent.querySelectorAll<HTMLElement>('button')).filter(isVisible);
      if (btns.length) return btns[btns.length - 1];
    }
  }
  return null;
}

/** Z.AI's copy control, wherever it renders. */
const COPY_SELECTOR = 'button.copy-response-button, button[class*="copy-response-button"], '
  + '[data-testid="copy-button"]';

function getAllCopyButtons(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(COPY_SELECTOR)).filter(isVisible);
}

/**
 * The newest turn on the page, assistant or user.
 *
 * Read off the live page on 2026-08-17. Z.AI wraps every turn in
 * `div[id^="message-<uuid>"]`, which is the same shape ChatGPT's <article> and
 * Gemini's <model-response> give — a scope. The id appears twice per turn
 * (an outer and an inner), the second carrying no text, so the empty ones are
 * dropped rather than trusted.
 */
function lastTurn(): HTMLElement | null {
  const turns = Array.from(document.querySelectorAll<HTMLElement>('div[id^="message-"]'))
    .filter((m) => (m.innerText || '').trim());
  return turns.length ? turns[turns.length - 1] : null;
}

/**
 * Has THIS turn finished?
 *
 * Z.AI renders a copy button on an assistant turn once it is complete, and
 * never on a user turn — so scoped to the newest turn this answers cleanly:
 *
 *   user's message showing, no reply yet  → no button → false
 *   assistant still streaming             → no button → false
 *   assistant done                        → button    → true
 *
 * PRESENCE, not visibility. Measured on the page: an older assistant turn's
 * button is `class="invisible group-hover:visible"` — in the DOM, hidden until
 * the pointer is over it. Filtering by isVisible drops it, and that is what
 * broke the second round of every threaded conversation.
 *
 * This replaces a page-wide count compared against a baseline taken before
 * submitting. That could not work here for two compounding reasons, both
 * visible in one live log — "copy buttons 0 (started at 1)" then "1 (started
 * at 1)": submitting re-rendered the thread so the old turn's button went
 * invisible and the count fell to 0, then the new turn brought it back to 1.
 * One is never greater than one, so the turn never finished and the reply read
 * 0 chars for as long as anyone waited. A new chat hid it — with a baseline of
 * 0, the first button was always an increase.
 */
function turnFinished(): boolean | null {
  const last = lastTurn();
  if (!last) return null;
  return !!last.querySelector(COPY_SELECTOR);
}


/**
 * Is GLM still working?
 *
 * Rewritten against the real markup, because the previous version answered
 * "yes" almost always and nobody could tell. Two of its checks matched
 * ordinary Tailwind utilities rather than anything about generation:
 *
 *   [class*="cursor"]  matches `cursor-pointer`, which is on nearly every
 *                      button Z.AI renders. This alone made the function
 *                      return true on a completely idle page.
 *   .animate-pulse     matches skeletons and the promo cards in the sidebar.
 *
 * So every node ran to the fifteen-minute ceiling no matter what GLM did, and
 * the symptom — "Z.AI nodes take forever" — pointed at the model.
 *
 * The page states this actually distinguishes, in order of trust:
 *
 *   FINISHED  the newest turn carries .copy-response-button. Z.AI renders it
 *             only once a response is complete, which makes it a positive
 *             statement rather than the absence of a spinner.
 *   THINKING  .thinking-pulse (the icon) or .shimmer (the label), or the
 *             Skip control. Class names, not text, so Deep Think does not stop
 *             being recognised on a Chinese or French account.
 *   STREAMING the composer's send button is in stop mode.
 *
 * Everything else was removed. A heuristic that cannot be wrong is not
 * evidence, and three of the old five could never be false.
 */
function isThinkingOrGenerating(): boolean {
  /* FINISHED WINS.
     The copy button on the newest turn is proof that turn is over, and it is
     checked first and final. The busy signals below are ambiguous in a way
     this is not: Z.AI leaves the collapsed thinking accordion in the page
     after the answer lands ("Thought for 12s") and it keeps its .shimmer
     class, so consulting that first meant a finished reply could read as busy
     forever — the same mistake as the cursor-pointer check this replaced. */
  if (turnFinished() === true) return false;

  /* Thinking, said by the page itself. The icon and the label carry
     purpose-built class names; the Skip control exists only while reasoning
     is happening. Class names rather than text, so Deep Think is still
     recognised on a Chinese or French account. */
  const thinking = document.querySelector<HTMLElement>(
    'svg.thinking-pulse, .shimmer, [aria-label="Skip Thinking"]'
  );
  if (thinking && isVisible(thinking)) return true;

  /* Streaming: the send control becomes a stop control. By shape rather than
     by icon path, since the path changes with their icon set. */
  const composer = findComposer();
  if (composer) {
    const parent = composer.closest('form, [class*="input"], [class*="box"], [class*="container"]')
      || composer.parentElement;
    const sendBtn = parent?.querySelector<HTMLElement>(
      '#send-message-button, .sendMessageButton, button[type="submit"]'
    );
    if (sendBtn) {
      const label = (sendBtn.getAttribute('aria-label') || '').toLowerCase();
      if (/stop|abort|停止/.test(label)) return true;
      if (sendBtn.innerHTML.toLowerCase().includes('<rect')) return true;
    }
  }

  /* No copy button yet and nothing visibly working. Still treated as busy:
     the gap between pressing send and the first token is real, and the outer
     silence timeout ends a genuinely dead turn in under a minute. */
  return true;
}

function findNewChatControl(): HTMLElement | null {
  for (const el of Array.from(document.querySelectorAll<HTMLElement>('a, button'))) {
    const label = (
      (el.getAttribute('aria-label') || '') + ' ' +
      (el.getAttribute('data-testid') || '') + ' ' +
      (el.innerText || '')
    ).toLowerCase();
    if (/new chat|new conversation|\+ chat|新建/i.test(label) && isVisible(el)) return el;
  }
  const byHref = Array.from(document.querySelectorAll<HTMLElement>('a[href="/"], a[href="/chat"]')).find(isVisible);
  return byHref || null;
}

function looksSignedOut(): boolean {
  const text = document.body?.innerText?.slice(0, 1200).toLowerCase() || '';
  return /sign in|log in|create account|welcome back|登录|注册/.test(text) && !findComposer();
}

function fillComposer(el: HTMLElement, text: string): boolean {
  el.focus();

  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
    const setter = Object.getOwnPropertyDescriptor(
      el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
      'value'
    )?.set;
    setter?.call(el, text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return el.value.trim().length > 0;
  }

  const sel = window.getSelection();
  sel?.selectAllChildren(el);
  document.execCommand('insertText', false, text);
  el.dispatchEvent(new InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' }));

  const landed = (el.innerText || el.textContent || '').trim();
  return landed.length >= Math.max(4, Math.floor(text.trim().length * 0.6));
}

/** Extract text from the latest assistant message only, thoroughly stripping thinking blocks */
function readLatestAssistantReply(): string {
  /* The newest turn, whether or not it has finished. Reading a streaming
     reply is the point — the poller compares it against the last poll to see
     whether it is still growing.

     This used to start from a page-wide copy-button count exceeding a
     baseline, and inherited that comparison's failure exactly: in a threaded
     conversation the count never rose, so this returned nothing at all and
     Diagnostics reported "reply 0 chars" beside a reply that was fully on
     screen. */
  {
    const container = lastTurn();
    if (container) {
      const cloned = container.cloneNode(true) as HTMLElement;
      // Remove all thought/thinking accordions, skip buttons, and action buttons
      cloned.querySelectorAll(
        '.thinking, [class*="thought"], [class*="think"], [data-testid*="think"], button, details'
      ).forEach((n) => n.remove());
      let text = (cloned.innerText || cloned.textContent || '').trim();
      text = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
      if (text) return text;
    }
  }

  // Fallback: look for assistant-specific containers
  const selectors = [
    '[data-role="assistant"] .markdown-body',
    '[data-role="assistant"] .prose',
    '[data-role="assistant"]',
    '.message-assistant .markdown-body',
    '.message-assistant',
    '.assistant-message',
  ];

  for (const s of selectors) {
    const nodes = Array.from(document.querySelectorAll<HTMLElement>(s));
    if (nodes.length) {
      const last = nodes[nodes.length - 1];
      const cloned = last.cloneNode(true) as HTMLElement;
      cloned.querySelectorAll(
        '.thinking, [class*="thought"], [class*="think"], [data-testid*="think"], button, details'
      ).forEach((n) => n.remove());
      let text = (cloned.innerText || cloned.textContent || '').trim();
      text = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
      if (text) return text;
    }
  }
  return '';
}

/* ── Main Execution ── */

async function handleExecute(payload: any): Promise<{ success: boolean }> {
  const { nodeId, config } = payload || {};
  const prompt = (config?.prompt || '').trim();

  if (!prompt) {
    send('STUDIO_NODE_ERROR', { nodeId, error: 'Empty prompt supplied to Z.AI' });
    return { success: false };
  }

  logLine(`Executing node ${nodeId}`);
  send('STUDIO_NODE_PROGRESS', { nodeId, progress: 10 });

  if (config?.newChat !== 'never') {
    const newChatBtn = findNewChatControl();
    if (newChatBtn) {
      newChatBtn.click();
      await sleep(1000);
    }
  }

  let composer = findComposer();
  for (let i = 0; !composer && i < 10; i++) {
    await sleep(500);
    composer = findComposer();
  }

  if (!composer) {
    send('STUDIO_NODE_ERROR', {
      nodeId,
      error: looksSignedOut()
        ? 'Not signed in to Z.AI — sign in at chat.z.ai, then run again'
        : 'Z.AI prompt box not found on the page',
    });
    return { success: false };
  }


  if (!fillComposer(composer, prompt)) {
    send('STUDIO_NODE_ERROR', { nodeId, error: 'Could not type into Z.AI prompt box' });
    return { success: false };
  }
  await sleep(300);

  const btn = findSendButton();
  if (btn) {
    btn.click();
  } else {
    composer.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true,
    }));
  }

  /* The build, named. A content script already injected into an open tab is
     NOT replaced when the extension is rebuilt — the tab has to be reloaded
     too. That has cost hours: a fix ships, the tab keeps running the old
     script, and the symptom is identical to the fix not working. */
  logLine(`Submitted prompt to Z.AI — waiting for Deep Think & reply (adapter ${ADAPTER_BUILD})...`);
  send('STUDIO_NODE_PROGRESS', { nodeId, progress: 20 });

  startAntiThrottle();
  const work = trackTextReply(nodeId, config?.rawReply === true);
  work.finally(stopAntiThrottle);
  return { success: true };
}

async function trackTextReply(nodeId: string, raw = false): Promise<void> {
  const startedAt = Date.now();
  let lastSeen = '';
  let stableCount = 0;

  while (Date.now() - startedAt < TEXT_CEILING_MS) {
    await sleep(POLL_MS);
    const elapsed = Date.now() - startedAt;
    send('STUDIO_NODE_PROGRESS', {
      nodeId,
      progress: Math.min(90, 20 + Math.floor((elapsed / TEXT_TIMEOUT_MS) * 90)),
    });

    const isBusy = isThinkingOrGenerating();
    const current = readLatestAssistantReply();

    /* Say WHY it is still waiting, every fifteen seconds.
       A node sat at 83% for four minutes while the finished reply was on
       screen, and Diagnostics said only "waiting for Deep Think & reply".
       There was no way to tell a model still thinking from an adapter that
       could no longer recognise the end — and the actual cause that time was
       a tab still running the previously injected script, which no amount of
       rebuilding fixes and nothing anywhere reported.

       These four numbers separate all of it: copy buttons against the
       baseline says whether the turn finished, the thinking count says
       whether GLM is working, and the reply length says whether anything has
       been read at all. */
    if (elapsed > 10_000 && Math.floor(elapsed / 15_000) !== Math.floor((elapsed - POLL_MS) / 15_000)) {
      const thinking = document.querySelectorAll(
        'svg.thinking-pulse, .shimmer, [aria-label="Skip Thinking"]'
      ).length;
      /* The turn's own verdict rather than a page-wide tally against a
         baseline. The old line read "copy buttons 1 (started at 1)" for
         ninety seconds, which was true and told nobody that one can never
         exceed one. */
      logLine(
        `Waiting ${Math.round(elapsed / 1000)}s — turn finished ${String(turnFinished())}, `
        + `thinking marks ${thinking}, reply ${current.length} chars`
      );
    }

    if (current && current === lastSeen) {
      stableCount++;
    } else if (current) {
      lastSeen = current;
      stableCount = 0;
    }

    /* Finished when the turn says so, or when the text has settled and
       nothing reads as busy. Same two paths as ChatGPT and Gemini: the
       marker is immediate because there is no state where it exists and the
       text is still growing; stableCount is the fallback for when it cannot
       be read. */
    if (current && (turnFinished() === true || (!isBusy && stableCount >= 2))) {
      const cleaned = raw ? current : cleanAssistantReply(current);
      if (!raw && !looksLikeUsablePrompt(cleaned)) {
        send('STUDIO_NODE_ERROR', {
          nodeId,
          error: 'Z.AI replied but not with a usable prompt — check the Z.AI tab',
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
    error: 'Z.AI did not finish answering in time — check the Z.AI tab',
  });
}
