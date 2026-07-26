/* ============================================================
   AutoFlow — ChatGPT Images content script (v1, minimal)
   Runs on chatgpt.com. One job: receive a Studio node's prompt,
   type it into the image composer, and submit it.

   v1 deliberately does NOT track the generation result — ChatGPT
   renders results in a gallery we don't scrape yet. The node
   reports "submitted" and the user watches the ChatGPT tab.
   ============================================================ */

console.log('[AutoFlow ChatGPT] Content script loaded on', location.href);

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
  // Main chat / images composer (ProseMirror contenteditable)
  const pm = document.querySelector<HTMLElement>('#prompt-textarea');
  if (pm && isVisible(pm)) return pm;

  const candidates = Array.from(
    document.querySelectorAll<HTMLElement>('textarea, [contenteditable="true"]')
  ).filter(isVisible);

  // Prefer an input that hints at image prompting ("Describe a new image")
  const hinted = candidates.find((c) => {
    const hint = c.getAttribute('placeholder') || c.getAttribute('aria-label') ||
                 c.getAttribute('data-placeholder') || '';
    return /describe|image|imagine/i.test(hint);
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
  // ProseMirror: execCommand routes through its input handling
  const sel = window.getSelection();
  sel?.selectAllChildren(el);
  document.execCommand('insertText', false, text);
  el.dispatchEvent(new Event('input', { bubbles: true }));
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
  send('STUDIO_NODE_PROGRESS', { nodeId, progress: 20 });

  const composer = findComposer();
  if (!composer) {
    send('STUDIO_NODE_ERROR', {
      nodeId,
      error: 'ChatGPT prompt box not found — open chatgpt.com/images in that tab',
    });
    return { success: false };
  }

  fillComposer(composer, prompt);
  await sleep(500);

  // Verify the text actually landed before submitting
  const landed = composer instanceof HTMLTextAreaElement
    ? composer.value.trim()
    : (composer.textContent || '').trim();
  if (!landed) {
    send('STUDIO_NODE_ERROR', { nodeId, error: 'Could not type into the ChatGPT prompt box' });
    return { success: false };
  }

  send('STUDIO_NODE_PROGRESS', { nodeId, progress: 60 });

  const btn = findSendButton();
  if (btn) {
    btn.click();
  } else {
    composer.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter', code: 'Enter', bubbles: true, cancelable: true,
    }));
  }

  // v1: fire-and-forget — no result scraping on ChatGPT yet
  await sleep(1200);
  send('STUDIO_NODE_RESULT', { nodeId, tileId: '', imageUrl: '', thumbnailUrl: '', previewUrl: '' });
  return { success: true };
}
