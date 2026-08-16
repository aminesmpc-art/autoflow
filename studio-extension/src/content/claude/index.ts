/* ============================================================
   AutoFlow Studio — Claude content script.

   Text only. Claude draws nothing, so this adapter answers Ask AI nodes and
   the Build tab, and refuses anything asking for a picture rather than
   producing something that looks like one.

   What was read off a live, signed-in claude.ai rather than guessed:

     composer      div[contenteditable="true"].ProseMirror[data-testid="chat-input"]
                   aria-label="Write your prompt to Claude"
     model picker  button[data-testid="model-selector-dropdown"]
                   aria-label="Model: Sonnet 5 Max", text "Sonnet 5 Max"
     new chat      a[aria-label="New chat"]
     send          DOES NOT EXIST until React knows there is text

   That last one is the whole reason this file needs the worker. Measured: with
   "hello" sitting in the composer — the text was there, innerText confirmed it
   — no send control existed, and the type="submit" slot was occupied by "Use
   voice mode". A synthetic paste puts characters in the DOM without convincing
   React, so the button never mounts. The model dropdown behaves the same way:
   a full pointer sequence left aria-expanded="false".

   Both already have cures in this extension, and this file uses them rather
   than inventing a third: MAIN_WORLD_PASTE fills through the page's own world
   (Flow's route), and REACT_TRIGGER calls a control's React onClick directly
   (what made Grok submit). Neither is speculative here — they are the same
   two failures, on a third site.
   ============================================================ */

console.log('[AutoFlow Claude] Content script loaded on', location.href);

import { cleanAssistantReply, looksLikeUsablePrompt } from '../chatgpt/chatgptReply';

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

/* Bumped whenever this adapter's completion logic changes. A content
   script already injected into an open tab is NOT replaced when the
   extension is rebuilt — the tab must be reloaded too — and a stale
   script is indistinguishable from a broken fix unless it says which
   one it is. */
const ADAPTER_BUILD = 'base-v1';

/** Backstop for a wedged tab. */
const TEXT_CEILING_MS = 10 * 60 * 1000;
const POLL_MS = 1000;

chrome.runtime.onMessage.addListener((msg: any, _sender, sendResponse) => {
  if (msg?.type === 'PING') { sendResponse({ pong: true }); return true; }
  if (msg?.type === 'STUDIO_EXECUTE_NODE') {
    handleExecute(msg.payload)
      .catch((e: any) => {
        const error = `Claude step failed: ${e?.message || e}`;
        console.error('[AutoFlow Claude]', e);
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
  console.log(`[AutoFlow Claude] ${line}`);
  try {
    chrome.runtime.sendMessage({ type: 'STUDIO_LOG', payload: { source: 'Claude', line } })
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

/* ── Page pieces ── */

function findComposer(): HTMLElement | null {
  const byTestId = document.querySelector<HTMLElement>('[data-testid="chat-input"]');
  if (byTestId && isVisible(byTestId)) return byTestId;
  const tiptap = document.querySelector<HTMLElement>('div[contenteditable="true"].ProseMirror');
  return tiptap && isVisible(tiptap) ? tiptap : null;
}

/**
 * The send control, which does not exist for an empty composer.
 *
 * Matched on the label rather than on type="submit": measured, that attribute
 * sits on "Use voice mode" while the box is empty, so a type-based lookup
 * finds the microphone and presses it.
 */
function findSendButton(): HTMLElement | null {
  for (const btn of Array.from(document.querySelectorAll<HTMLElement>('button[aria-label]'))) {
    const label = (btn.getAttribute('aria-label') || '').toLowerCase();
    if (/^send/.test(label) && isVisible(btn)) return btn;
  }
  const byTestId = document.querySelector<HTMLElement>('[data-testid="send-button"]');
  return byTestId && isVisible(byTestId) ? byTestId : null;
}

function findStopButton(): HTMLElement | null {
  for (const btn of Array.from(document.querySelectorAll<HTMLElement>('button[aria-label]'))) {
    const label = (btn.getAttribute('aria-label') || '').toLowerCase();
    if (/stop response|stop generating/.test(label) && isVisible(btn)) return btn;
  }
  return null;
}

function looksSignedOut(): boolean {
  const text = document.body?.innerText?.slice(0, 1200).toLowerCase() || '';
  return /sign in|log in|create account/.test(text) && !findComposer();
}

/* ── The two things Claude will not accept from a content script ── */

/**
 * Fill the composer through the page's own world.
 *
 * A dispatched paste lands characters in the DOM and leaves React unaware, so
 * the send button never mounts. The worker's MAIN_WORLD_PASTE runs inside the
 * page, where the editor's own handlers are real.
 */
async function fillComposer(el: HTMLElement, text: string): Promise<boolean> {
  const tempId = el.id || `af-claude-${Math.random().toString(36).slice(2)}`;
  const hadId = !!el.id;
  el.id = tempId;
  try {
    await chrome.runtime.sendMessage({ type: 'MAIN_WORLD_PASTE', payload: { elId: tempId, text } });
  } catch (e: any) {
    logLine(`MAIN_WORLD_PASTE could not run: ${e?.message || e}`);
  } finally {
    if (!hadId) el.removeAttribute('id');
  }

  for (let i = 0; i < 20; i++) {
    await sleep(150);
    if ((el.innerText || el.textContent || '').trim().length >= Math.min(8, text.length)) return true;
  }

  /* Fall back to the ordinary route. It fills the DOM, and on a build of
     Claude that does not gate on React state it is enough. */
  el.focus();
  try {
    const dt = new DataTransfer();
    dt.setData('text/plain', text);
    el.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }));
  } catch { /* no DataTransfer here */ }
  await sleep(400);
  return (el.innerText || el.textContent || '').trim().length > 0;
}

/** Press a control by calling its React onClick, in the page's own world. */
async function reactPress(el: Element, handlerName = 'onClick'): Promise<boolean> {
  const tempId = `af-claude-${Math.random().toString(36).slice(2)}`;
  const oldId = el.id;
  el.id = tempId;
  try {
    const res: any = await chrome.runtime.sendMessage({
      type: 'REACT_TRIGGER',
      payload: { elId: tempId, handlerName, isKey: false, keyVal: '' },
    });
    return !!res?.success;
  } catch {
    return false;
  } finally {
    if (oldId) el.id = oldId;
    else el.removeAttribute('id');
  }
}

/* ── Model ── */

/** What the picker is showing, e.g. "Sonnet 5 Max". */
function currentModel(): string {
  const trigger = document.querySelector<HTMLElement>('[data-testid="model-selector-dropdown"]');
  if (!trigger) return '';
  const label = trigger.getAttribute('aria-label') || '';
  const fromLabel = /^model:\s*(.+)$/i.exec(label.trim());
  return (fromLabel ? fromLabel[1] : trigger.textContent || '').trim();
}

/**
 * Choose a model by name, loosely.
 *
 * "Sonnet" should match "Sonnet 5 Max" — the exact string carries a version
 * that moves, and a node saved last month should not stop working because the
 * suffix changed. Confirmed from the trigger afterwards, which is what the
 * next message will actually use.
 */
async function selectModel(want: string): Promise<boolean> {
  const target = want.trim().toLowerCase();
  if (!target) return true;
  if (currentModel().toLowerCase().includes(target)) return true;

  const trigger = document.querySelector<HTMLElement>('[data-testid="model-selector-dropdown"]');
  if (!trigger) return false;

  // The menu is React-gated: a pointer sequence leaves aria-expanded false.
  if (!(await reactPress(trigger))) return false;

  let item: HTMLElement | undefined;
  for (let i = 0; i < 20 && !item; i++) {
    await sleep(150);
    item = Array.from(document.querySelectorAll<HTMLElement>(
      '[role="menuitem"], [role="menuitemradio"], [role="option"]'
    )).find((el) => isVisible(el) && (el.innerText || '').trim().toLowerCase().includes(target));
  }
  if (!item) {
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    return false;
  }

  if (!(await reactPress(item))) item.click();
  for (let i = 0; i < 20; i++) {
    await sleep(150);
    if (currentModel().toLowerCase().includes(target)) return true;
  }
  return false;
}

/* ── Reply ── */

function readLatestReply(): string {
  const blocks = Array.from(document.querySelectorAll<HTMLElement>(
    '[data-testid="assistant-message"], .font-claude-response, [data-is-streaming]'
  )).filter(isVisible);
  if (blocks.length) return blocks[blocks.length - 1].innerText || '';

  const proses = Array.from(document.querySelectorAll<HTMLElement>('[class*="prose"], [class*="markdown"]'))
    .filter((el) => isVisible(el) && (el.innerText || '').trim().length > 0);
  return proses.length ? proses[proses.length - 1].innerText || '' : '';
}

function isGenerating(): boolean {
  if (findStopButton()) return true;
  return !!document.querySelector('[data-is-streaming="true"]');
}

async function startNewChat(): Promise<void> {
  const link = Array.from(document.querySelectorAll<HTMLElement>('a[aria-label], button[aria-label]'))
    .find((el) => /^new chat$/i.test((el.getAttribute('aria-label') || '').trim()) && isVisible(el));
  if (!link) { logLine('WARNING: no New chat control — this answer may follow the previous one'); return; }
  link.click();
  for (let i = 0; i < 24; i++) {
    await sleep(250);
    const composer = findComposer();
    if (composer && !(composer.innerText || '').trim() && !readLatestReply()) return;
  }
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

  /* Claude has no image or video surface. Saying so beats returning its
     description of a picture as though it were one. */
  if (config?.mediaType && config.mediaType !== 'text') {
    send('STUDIO_NODE_ERROR', {
      nodeId,
      error: `Claude cannot make ${config.mediaType}. Use it for Ask AI and prompt writing, `
        + 'and send this node to Flow, Grok or Gemini.',
    });
    return { success: false };
  }

  logLine(`Executing node ${nodeId} [adapter ${ADAPTER_BUILD}]`);
  send('STUDIO_NODE_PROGRESS', { nodeId, progress: 10 });

  if (config?.newChat !== 'never') await startNewChat();

  let composer = findComposer();
  for (let i = 0; !composer && i < 10; i++) {
    await sleep(600);
    composer = findComposer();
  }
  if (!composer) {
    send('STUDIO_NODE_ERROR', {
      nodeId,
      error: looksSignedOut()
        ? 'Not signed in to Claude — sign in on the Claude tab, then run again'
        : 'Claude prompt box not found on the page',
    });
    return { success: false };
  }

  if (config?.model) {
    const ok = await selectModel(config.model);
    logLine(`Model: ${config.model}${ok ? '' : ` — not offered, staying on ${currentModel() || 'the current one'}`}`);
  }

  const priorReply = readLatestReply().trim();

  if (!(await fillComposer(composer, prompt))) {
    send('STUDIO_NODE_ERROR', { nodeId, error: 'Could not type into the Claude prompt box' });
    return { success: false };
  }

  /* The send button only mounts once React has the text, so waiting for it IS
     the check that the fill landed. */
  let btn: HTMLElement | null = null;
  for (let i = 0; i < 40; i++) {
    btn = findSendButton();
    if (btn) break;
    await sleep(150);
  }
  if (!btn) {
    send('STUDIO_NODE_ERROR', {
      nodeId,
      error: 'Claude never showed a send button for this prompt, which means it did not '
        + 'register the text. The prompt is still in the Claude composer.',
    });
    return { success: false };
  }

  if (!(await reactPress(btn))) btn.click();
  send('STUDIO_NODE_PROGRESS', { nodeId, progress: 20 });
  logLine('Sent — waiting for the reply…');

  trackReply(nodeId, priorReply, config?.rawReply === true).catch((e: any) => {
    send('STUDIO_NODE_ERROR', { nodeId, error: `Tracking the Claude reply failed: ${e?.message || e}` });
  });
  return { success: true };
}

async function trackReply(nodeId: string, priorReply: string, raw: boolean): Promise<void> {
  const startedAt = Date.now();
  let stable = '';
  let lastChangeAt = Date.now();
  let stableCount = 0;

  while (Date.now() - startedAt < TEXT_CEILING_MS) {
    await sleep(POLL_MS);
    const elapsed = Date.now() - startedAt;
    send('STUDIO_NODE_PROGRESS', {
      nodeId, progress: Math.min(90, 20 + Math.floor((elapsed / TEXT_TIMEOUT_MS) * 90)),
    });

    const now = readLatestReply().trim();

    /* Say WHY it is still waiting, every fifteen seconds.
       A node sat at 83% for four minutes with the finished reply on screen
       and Diagnostics said only "waiting for the reply". Nothing separated a
       model still thinking from an adapter that could no longer recognise the
       end — nor from a tab running a previously injected script, which no
       amount of rebuilding fixes and nothing anywhere reported. */
    if (elapsed > 10_000
        && Math.floor(elapsed / 15_000) !== Math.floor((elapsed - POLL_MS) / 15_000)) {
      logLine(`Waiting ${Math.round(elapsed / 1000)}s — generating ${isGenerating()}, reply ${now.length} chars`);
    }

    if (Date.now() - lastChangeAt > TEXT_QUIET_MS && !isGenerating()) break;
    if (!now || now === priorReply) continue;

    if (now === stable) stableCount++;
    else { stable = now; stableCount = 0; lastChangeAt = Date.now(); }

    if (stableCount >= 2 && !isGenerating()) {
      /* raw for the workflow builder: cleanAssistantReply strips code fences
         and leading lines, which is right for a prompt and destroys JSON. */
      const text = raw ? now : cleanAssistantReply(now);
      if (!raw && !looksLikeUsablePrompt(text)) {
        send('STUDIO_NODE_ERROR', {
          nodeId,
          error: `Claude answered, but not with something usable as a prompt: "${text.slice(0, 80)}"`,
        });
        return;
      }
      logLine(`Reply captured (${text.length} chars)`);
      send('STUDIO_NODE_RESULT', { nodeId, tileId: '', text });
      return;
    }
  }

  send('STUDIO_NODE_ERROR', { nodeId, error: 'Claude did not finish answering within three minutes' });
}
