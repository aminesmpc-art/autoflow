/* ============================================================
   AutoFlow — ChatGPT Images content script (v2)
   Receives a Studio node's prompt, types it into the composer,
   submits, then WAITS for the generated image, captures it as a
   data URL, and returns it — so downstream Flow nodes can use it
   as a reference/ingredient (character consistency across
   platforms).
   ============================================================ */

console.log('[AutoFlow ChatGPT] Content script loaded on', location.href);

import { cleanAssistantReply, looksLikeUsablePrompt } from './chatgptReply';

const GENERATION_TIMEOUT_MS = 6 * 60 * 1000; // ChatGPT image gen can take minutes
// Writing a prompt is a chat round-trip, not a render — a node that hangs here
// should surface quickly rather than stalling a workflow for six minutes.
const TEXT_TIMEOUT_MS = 90 * 1000;
const POLL_MS = 2000;
const MAX_CAPTURE_BYTES = 15 * 1024 * 1024;

chrome.runtime.onMessage.addListener((msg: any, _sender, sendResponse) => {
  if (msg?.type === 'PING') { sendResponse({ pong: true }); return true; }
  if (msg?.type === 'STUDIO_EXECUTE_NODE') {
    handleExecute(msg.payload).then(sendResponse);
    return true; // async
  }
  return false;
});

function send(type: string, payload: Record<string, unknown>): void {
  try { chrome.runtime.sendMessage({ type, payload }).catch(() => {}); } catch {}
}

/* Chrome throttles timers in background tabs, and the tab we open for the
   user is deliberately in the background. A message round-trip to the service
   worker keeps the main thread awake so the generation poller keeps ticking. */
let antiThrottle: ReturnType<typeof setInterval> | null = null;
function startAntiThrottle(): void {
  if (antiThrottle) return;
  antiThrottle = setInterval(() => {
    try { chrome.runtime.sendMessage({ type: 'PING' }).catch(() => {}); } catch {}
  }, 15_000);
}
function stopAntiThrottle(): void {
  if (antiThrottle) { clearInterval(antiThrottle); antiThrottle = null; }
}

/** Signed-out tabs render a login wall instead of the composer */
function looksSignedOut(): boolean {
  const text = document.body?.innerText?.slice(0, 1500).toLowerCase() || '';
  return /log in|sign up|create an account|welcome back/.test(text) && !findComposer();
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function isVisible(el: Element): boolean {
  const rect = el.getBoundingClientRect();
  if (rect.width < 5 || rect.height < 5) return false;
  const style = getComputedStyle(el);
  return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
}

/** The prompt composer: ProseMirror div on chat, textarea on some surfaces */
function findComposer(): HTMLElement | null {
  const pm = document.querySelector<HTMLElement>('#prompt-textarea');
  if (pm && isVisible(pm)) return pm;

  const candidates = Array.from(
    document.querySelectorAll<HTMLElement>('textarea, [contenteditable="true"]')
  ).filter(isVisible);

  const hinted = candidates.find((c) => {
    const hint = c.getAttribute('placeholder') || c.getAttribute('aria-label') ||
                 c.getAttribute('data-placeholder') || '';
    return /describe|image|imagine|ask anything/i.test(hint);
  });
  return hinted || candidates[0] || null;
}

function findSendButton(): HTMLElement | null {
  const testId = document.querySelector<HTMLElement>('button[data-testid="send-button"]');
  if (testId && isVisible(testId)) return testId;

  for (const btn of document.querySelectorAll<HTMLElement>('button[aria-label]')) {
    if (/send|envoyer|enviar|senden|invia/i.test(btn.getAttribute('aria-label') || '') && isVisible(btn)) {
      return btn;
    }
  }
  return null;
}

/** Fill either a textarea (native setter) or a contenteditable (insertText) */
function fillComposer(el: HTMLElement, text: string): void {
  el.focus();
  if (el instanceof HTMLTextAreaElement) {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    setter?.call(el, text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return;
  }
  const sel = window.getSelection();
  sel?.selectAllChildren(el);
  document.execCommand('insertText', false, text);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

/** True while ChatGPT is still streaming/generating */
function isGenerating(): boolean {
  const stop = document.querySelector<HTMLElement>(
    'button[data-testid="stop-button"], button[aria-label*="stop" i], button[aria-label*="arrêter" i]'
  );
  return !!(stop && isVisible(stop));
}

/**
 * Candidate result images in the conversation: large, fully loaded,
 * not avatars/icons. Sorted by document order (last = newest).
 */
function collectResultImages(): HTMLImageElement[] {
  return Array.from(document.querySelectorAll('img')).filter((img) => {
    const src = img.currentSrc || img.src || '';
    if (!src) return false;
    if (src.startsWith('data:') && src.length < 2000) return false; // inline icons
    const rect = img.getBoundingClientRect();
    if (rect.width < 180 && rect.height < 180) return false; // avatars, thumbnails
    return img.complete && img.naturalWidth >= 256 && img.naturalHeight >= 256;
  });
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve((reader.result as string) || '');
    reader.onerror = () => reject(new Error('Failed to read image blob'));
    reader.readAsDataURL(blob);
  });
}

async function captureImage(img: HTMLImageElement): Promise<string> {
  const src = img.currentSrc || img.src;
  const resp = await fetch(src);
  if (!resp.ok) throw new Error(`HTTP ${resp.status} fetching image`);
  const blob = await resp.blob();
  if (blob.size > MAX_CAPTURE_BYTES) throw new Error(`Image too large to transfer (${Math.round(blob.size / 1e6)} MB)`);
  return blobToDataUrl(blob);
}

async function handleExecute(payload: any): Promise<any> {
  const { nodeId, config } = payload || {};
  const prompt = (config?.prompt || '').trim();

  if (!nodeId) return { success: false };
  if (!prompt) {
    send('STUDIO_NODE_ERROR', { nodeId, error: 'Prompt is empty' });
    return { success: false };
  }

  console.log(`[AutoFlow ChatGPT] Executing node ${nodeId}`);
  send('STUDIO_NODE_PROGRESS', { nodeId, progress: 10 });

  // A freshly opened tab may still be mounting, so give the composer a
  // few seconds to appear before declaring it missing.
  let composer = findComposer();
  for (let i = 0; !composer && i < 10; i++) {
    await sleep(600);
    composer = findComposer();
  }
  if (!composer) {
    send('STUDIO_NODE_ERROR', {
      nodeId,
      error: looksSignedOut()
        ? 'Not signed in to ChatGPT — sign in on the ChatGPT tab, then run again'
        : 'ChatGPT prompt box not found on the page',
    });
    return { success: false };
  }

  const wantsText = config?.mediaType === 'text';

  // Snapshot what's already on screen so only a NEW result counts. For text
  // that means the reply currently showing, which is still there while ours
  // is being written.
  const preexisting = new Set(collectResultImages().map((i) => i.currentSrc || i.src));
  const priorReply = wantsText ? readLatestReply().trim() : '';

  fillComposer(composer, prompt);
  await sleep(500);

  const landed = composer instanceof HTMLTextAreaElement
    ? composer.value.trim()
    : (composer.textContent || '').trim();
  if (!landed) {
    send('STUDIO_NODE_ERROR', { nodeId, error: 'Could not type into the ChatGPT prompt box' });
    return { success: false };
  }

  const btn = findSendButton();
  if (btn) {
    btn.click();
  } else {
    composer.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter', code: 'Enter', bubbles: true, cancelable: true,
    }));
  }

  console.log(`[AutoFlow ChatGPT] Prompt submitted — waiting for the ${wantsText ? 'reply' : 'image'}...`);
  send('STUDIO_NODE_PROGRESS', { nodeId, progress: 20 });

  // Return the message channel NOW — the wait can take minutes and Chrome
  // closes a sendResponse channel long before that. Results travel back via
  // chrome.runtime.sendMessage, same pattern as the Flow content script.
  startAntiThrottle();
  const work = wantsText
    ? trackTextReply(nodeId, priorReply)
    : trackGeneration(nodeId, preexisting);
  work.finally(stopAntiThrottle);
  return { success: true };
}

/** Fire-and-forget: poll until the generated image appears, then capture it */
async function trackGeneration(nodeId: string, preexisting: Set<string>): Promise<void> {
  // Completion = a NEW large image whose src stayed stable across two polls
  // while ChatGPT is no longer streaming. Progressive previews swap srcs
  // while rendering, so stability matters as much as presence.
  const startedAt = Date.now();
  let stableSrc = '';
  let stableCount = 0;

  while (Date.now() - startedAt < GENERATION_TIMEOUT_MS) {
    await sleep(POLL_MS);

    const elapsed = Date.now() - startedAt;
    const progress = Math.min(90, 20 + Math.floor((elapsed / GENERATION_TIMEOUT_MS) * 90));
    send('STUDIO_NODE_PROGRESS', { nodeId, progress });

    const fresh = collectResultImages().filter(
      (i) => !preexisting.has(i.currentSrc || i.src)
    );
    if (fresh.length === 0) continue;

    const candidate = fresh[fresh.length - 1];
    const src = candidate.currentSrc || candidate.src;
    if (src === stableSrc) {
      stableCount++;
    } else {
      stableSrc = src;
      stableCount = 0;
    }

    if (stableCount >= 2 && !isGenerating()) {
      console.log('[AutoFlow ChatGPT] Image complete — capturing');
      try {
        const dataUrl = await captureImage(candidate);
        send('STUDIO_NODE_RESULT', {
          nodeId,
          tileId: '',
          // data URL in imageUrl → WorkflowRunner passes it downstream as a
          // reference (referenceImageData) exactly like an Image node's upload
          imageUrl: dataUrl,
          thumbnailUrl: dataUrl,
          previewUrl: dataUrl,
        });
        return;
      } catch (e: any) {
        // Do NOT report success without the image — a downstream node would
        // silently generate without its reference (the exact failure class
        // this workflow feature exists to prevent).
        send('STUDIO_NODE_ERROR', {
          nodeId,
          error: `Image generated but could not be captured: ${e.message}. It is still in the ChatGPT tab.`,
        });
        return;
      }
    }
  }

  send('STUDIO_NODE_ERROR', {
    nodeId,
    error: 'ChatGPT image did not complete within 6 minutes — check the ChatGPT tab',
  });
}

/**
 * The newest assistant turn's text.
 *
 * Found structurally rather than by class name: ChatGPT's styling churns
 * constantly, but the message role attribute has been stable and is what their
 * own accessibility tree relies on. Falls back to the last article element,
 * which is the shape the conversation has had through several redesigns.
 */
function readLatestReply(): string {
  const byRole = document.querySelectorAll('[data-message-author-role="assistant"]');
  if (byRole.length) {
    return (byRole[byRole.length - 1] as HTMLElement).innerText || '';
  }
  const articles = document.querySelectorAll('article');
  if (articles.length) {
    return (articles[articles.length - 1] as HTMLElement).innerText || '';
  }
  return '';
}

/**
 * Fire-and-forget: wait for the written answer, then hand it back as text.
 *
 * Completion needs two signals, not one. The stop button disappearing says
 * streaming ended, but the text can still be settling; requiring the content
 * to be byte-identical across consecutive polls avoids capturing a sentence
 * mid-render — the same trick the image path uses for swapping srcs.
 */
async function trackTextReply(nodeId: string, priorReply: string): Promise<void> {
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
    // Unchanged from before we asked means our answer hasn't started yet.
    if (!current || current === priorReply) continue;

    if (current === lastSeen) {
      stableCount++;
    } else {
      lastSeen = current;
      stableCount = 0;
    }

    if (stableCount >= 2 && !isGenerating()) {
      const cleaned = cleanAssistantReply(current);
      if (!looksLikeUsablePrompt(cleaned)) {
        // Usually ChatGPT asking a clarifying question instead of answering.
        send('STUDIO_NODE_ERROR', {
          nodeId,
          error: 'ChatGPT replied but not with a usable prompt — check the ChatGPT tab',
        });
        return;
      }
      console.log(`[AutoFlow ChatGPT] Reply captured (${cleaned.length} chars)`);
      send('STUDIO_NODE_RESULT', { nodeId, tileId: '', text: cleaned });
      return;
    }
  }

  send('STUDIO_NODE_ERROR', {
    nodeId,
    error: 'ChatGPT did not finish answering in time — check the ChatGPT tab',
  });
}
