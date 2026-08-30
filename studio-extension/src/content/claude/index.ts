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

/* ── Showing Claude a picture ──
   Every selector here was read off claude.ai rather than reasoned about,
   which is the only reason it is three lines instead of a hunt.

   The file input is already in the document — no button to click first, no
   menu to open. It is hidden with `absolute -z-10 h-0 w-0 opacity-0` rather
   than display:none, which is why it can be filled directly:

     <input type="file" data-testid="file-upload"
            id="chat-input-file-upload-onpage" multiple>

   And an attached file appears as exactly one [data-testid="file-thumbnail"],
   which is what tells us the upload finished rather than merely started.
   Verified by attaching a 1×1 PNG to a live composer and watching it. */

const CLAUDE_FILE_INPUT = 'input[type="file"][data-testid="file-upload"], #chat-input-file-upload-onpage';
const CLAUDE_THUMBNAIL = '[data-testid="file-thumbnail"]';

/** How many files the composer is currently holding. */
function attachmentCount(): number {
  return document.querySelectorAll(CLAUDE_THUMBNAIL).length;
}

/** A data URL as a File the composer will take. */
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

/**
 * Poke React, not just the DOM.
 *
 * Setting input.files and dispatching 'change' updates the element and tells
 * React nothing — its onChange is bound through a synthetic event system that
 * a plain dispatch does not reach. The same three routes the ChatGPT adapter
 * uses, in the same order, because the same framework is underneath.
 */
function triggerFileInputChange(input: HTMLInputElement): void {
  const synthetic = {
    target: input, currentTarget: input, type: 'change', bubbles: true,
    preventDefault: () => {}, stopPropagation: () => {},
    isPropagationStopped: () => false, isDefaultPrevented: () => false,
    persist: () => {}, nativeEvent: new Event('change', { bubbles: true }),
  };
  const propsKey = Object.keys(input).find((k) => k.startsWith('__reactProps$'));
  const props = propsKey ? (input as any)[propsKey] : null;
  if (typeof props?.onChange === 'function') {
    try { props.onChange(synthetic); } catch { /* try the next route */ }
  }
  const fiberKey = Object.keys(input).find((k) => k.startsWith('__reactFiber$'));
  if (fiberKey) {
    let fiber: any = (input as any)[fiberKey];
    for (let i = 0; i < 15 && fiber; i++) {
      if (typeof fiber.memoizedProps?.onChange === 'function') {
        try { fiber.memoizedProps.onChange(synthetic); } catch { /* fall through */ }
        break;
      }
      fiber = fiber.return;
    }
  }
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

/** Wait for the thumbnails to appear, so we never send before the upload lands. */
async function waitForAttachments(baseline: number, added: number): Promise<boolean> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (attachmentCount() >= baseline + added) return true;
    await sleep(400);
  }
  return false;
}

/**
 * Attach the pictures, or say why not.
 *
 * Returns a message on failure rather than throwing: a reference that did not
 * upload must fail the node loudly. Answering from the words alone while the
 * panel shows thumbnails is the exact failure this whole path exists to stop.
 */
async function attachReferences(dataUrls: string[]): Promise<string | null> {
  const input = document.querySelector<HTMLInputElement>(CLAUDE_FILE_INPUT);
  if (!input) return 'Could not find Claude\'s file upload — the picture was not sent';

  let files: File[];
  try {
    files = dataUrls.map((url, i) => dataUrlToFile(url, `reference-${i + 1}`));
  } catch (e: any) {
    return `Picture could not be decoded: ${e.message}`;
  }

  const baseline = attachmentCount();
  const dt = new DataTransfer();
  for (const f of files) dt.items.add(f);
  input.files = dt.files;
  triggerFileInputChange(input);

  if (!(await waitForAttachments(baseline, files.length))) {
    return files.length > 1
      ? `Only some of the ${files.length} pictures finished uploading to Claude`
      : 'The picture did not finish uploading to Claude';
  }
  return null;
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

/**
 * Start a fresh conversation, by whichever route still exists.
 *
 * The aria-label is the one read off a live signed-in claude.ai and is tried
 * first for that reason. Everything after it is a fallback, and fallbacks are
 * cheap here: a selector that matches nothing costs one failed querySelector,
 * while the old single-route version degraded to a WARNING and then answered
 * the NEXT node inside the previous conversation — which reads as the model
 * ignoring the prompt, with nothing on screen connecting the two.
 *
 * Ordered by how specific each signal is, so a rename lower down the list can
 * never shadow a control that is genuinely there.
 */
async function startNewChat(): Promise<void> {
  const settled = async (): Promise<boolean> => {
    for (let i = 0; i < 24; i++) {
      await sleep(250);
      const composer = findComposer();
      if (composer && !(composer.innerText || '').trim() && !readLatestReply()) return true;
    }
    return false;
  };

  /* 1. The label. Verified against the live site. */
  const byLabel = Array.from(document.querySelectorAll<HTMLElement>('a[aria-label], button[aria-label]'))
    .find((el) => /^new chat$/i.test((el.getAttribute('aria-label') || '').trim()) && isVisible(el));
  if (byLabel) { byLabel.click(); if (await settled()) return; }

  /* 2. The control that advertises Claude's own Ctrl/Cmd+Shift+O shortcut.
        A label can be translated; the shortcut it announces cannot. */
  const byShortcut = document.querySelector<HTMLElement>(
    'button[aria-keyshortcuts*="Shift+O"], a[aria-keyshortcuts*="Shift+O"]',
  );
  if (byShortcut && isVisible(byShortcut)) { byShortcut.click(); if (await settled()) return; }

  /* 3. A plain link to the route, which survives any amount of restyling. */
  const byHref = document.querySelector<HTMLElement>('a[href="/new"], a[href="/chat/new"]');
  if (byHref && isVisible(byHref)) { byHref.click(); if (await settled()) return; }

  /* 4. The words on the button, for a build where nothing above is labelled. */
  const byText = Array.from(document.querySelectorAll<HTMLElement>('button, a')).find((el) => {
    const t = (el.textContent || '').trim().toLowerCase();
    return (t === '+ new' || t === 'new chat') && isVisible(el);
  });
  if (byText) { byText.click(); if (await settled()) return; }

  /* 5. Press the shortcut itself. Claude binds it on the document, so this
        works even when the control is inside something we cannot see. */
  document.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'O', code: 'KeyO', ctrlKey: true, shiftKey: true, bubbles: true,
  }));
  if (await settled()) return;

  /* 6. Navigate. Last because it throws away anything unsent in the composer,
        and only from a conversation — on /new already there is nowhere to go
        and reloading would be a pointless round trip. */
  if (window.location.pathname.startsWith('/chat/')) {
    logLine('No New chat control found — navigating to /new');
    window.location.href = '/new';
    if (await settled()) return;
  }

  logLine('WARNING: no New chat control — this answer may follow the previous one');
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

  /* Pictures first. Uploading re-renders the composer, so a prompt typed
     before it would be wiped — the same ordering the ChatGPT adapter settled
     on for the same reason. */
  const references: string[] = (config?.referenceImageData || [])
    .filter((d: unknown): d is string => typeof d === 'string' && d.startsWith('data:'));
  if (references.length) {
    const failure = await attachReferences(references);
    if (failure) {
      send('STUDIO_NODE_ERROR', { nodeId, error: failure });
      return { success: false };
    }
    logLine(`${references.length} picture(s) attached`);
    send('STUDIO_NODE_PROGRESS', { nodeId, progress: 15 });
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
