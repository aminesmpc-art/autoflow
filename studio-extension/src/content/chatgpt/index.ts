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
// Uploading happens before the question is even asked, so this is spent out of
// the same budget as the answer — see waitForAttachments.
const UPLOAD_TIMEOUT_MS = 45 * 1000;

chrome.runtime.onMessage.addListener((msg: any, _sender, sendResponse) => {
  if (msg?.type === 'PING') { sendResponse({ pong: true }); return true; }
  if (msg?.type === 'STUDIO_EXECUTE_NODE') {
    handleExecute(msg.payload)
      .catch((e: any) => {
        // Without this the promise rejects, sendResponse is never called, and
        // the node sits at "running" until the run is stopped by hand — a
        // thrown error becoming a hang is strictly worse than an error.
        const error = `ChatGPT step failed: ${e?.message || e}`;
        console.error('[AutoFlow ChatGPT]', e);
        send('STUDIO_NODE_ERROR', { nodeId: msg.payload?.nodeId, error });
        return { success: false };
      })
      .then(sendResponse);
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

/* ── Reference images ──
   A ChatGPT node wired to an image node or a Last Frame was typing its prompt
   and sending, with the reference silently dropped: the whole point of wiring
   it — "make this character do X" — never reached the model. The route below
   is the one already proven against Flow in content/flow/automation.ts: build
   a File, assign it to the page's own file input, then push React into
   noticing. Nothing here reports success it has not seen on screen. */

/** data: URL → File, without a fetch (which CSP can block on chatgpt.com). */
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
 * ChatGPT's own upload input.
 *
 * It is usually already in the DOM but hidden; on some surfaces it is only
 * mounted once the attach menu opens. Ours is never a candidate — we don't
 * inject one — so any file input on the page belongs to ChatGPT.
 */
function findFileInput(): HTMLInputElement | null {
  const byAccept = document.querySelector<HTMLInputElement>('input[type="file"][accept*="image"]');
  if (byAccept) return byAccept;
  return document.querySelector<HTMLInputElement>('input[type="file"]');
}

/** Open the attach menu, for the case where the input mounts on demand. */
async function revealFileInput(): Promise<HTMLInputElement | null> {
  const existing = findFileInput();
  if (existing) return existing;

  const attach = Array.from(document.querySelectorAll<HTMLElement>('button')).find((b) => {
    const label = `${b.getAttribute('aria-label') || ''} ${b.getAttribute('data-testid') || ''}`;
    return /attach|upload|plus|add.?file|photo/i.test(label) && isVisible(b);
  });
  if (!attach) return null;

  attach.click();
  for (let i = 0; i < 10; i++) {
    await sleep(300);
    const input = findFileInput();
    if (input) {
      // Leave the menu as we found it — an open popover swallows the click on
      // the send button later.
      document.body.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Escape', code: 'Escape', bubbles: true,
      }));
      return input;
    }
  }
  return null;
}

/**
 * React tracks file inputs through its own synthetic system, so a bare
 * dispatched change event often reaches nothing. Same three-way approach the
 * Flow path uses: the element's React props, then its fibre's, then native
 * events for anything still listening the ordinary way.
 */
function triggerFileInputChange(input: HTMLInputElement): void {
  const synthetic = {
    target: input,
    currentTarget: input,
    type: 'change',
    bubbles: true,
    preventDefault: () => {},
    stopPropagation: () => {},
    isPropagationStopped: () => false,
    isDefaultPrevented: () => false,
    persist: () => {},
    nativeEvent: new Event('change', { bubbles: true }),
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
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

/**
 * The composer's surrounding form — where attachment thumbnails appear.
 *
 * Returns null rather than falling back to document.body. Callers use this to
 * exclude composer images from results, and a body-shaped "composer" excludes
 * every image on the page: the poller then finds nothing, forever, and the
 * node sits at "Generating…" until it times out six minutes later. Better to
 * exclude nothing than everything.
 */
function composerRegion(): HTMLElement | null {
  const composer = findComposer();
  if (!composer) return null;
  const form = composer.closest('form') as HTMLElement | null;
  if (form && form !== document.body) return form;
  const near = composer.parentElement?.parentElement as HTMLElement | null;
  return near && near !== document.body && near !== document.documentElement ? near : null;
}

/** Images inside the composer — attachment previews, not conversation results. */
function attachmentCount(): number {
  return (composerRegion() || document.body).querySelectorAll('img').length;
}

/**
 * Wait until the attachments are visibly on the composer and finished
 * uploading.
 *
 * Submitting mid-upload is the failure that matters: ChatGPT sends the text
 * alone and answers without ever seeing the image, which reads as a working
 * run producing a wrong result. Two signals, because either alone lies — a
 * thumbnail appears the instant the file is picked, and the send button is
 * briefly enabled before upload starts.
 */
async function waitForAttachments(baseline: number, expected: number): Promise<boolean> {
  // 45s, chosen against the runner's outer budgets rather than by feel: a text
  // node has 3 minutes total and its reply alone may take 90s. See
  // tests/timeoutOrdering.test.ts, which pins the sum.
  const deadline = Date.now() + UPLOAD_TIMEOUT_MS;
  let stable = 0;

  while (Date.now() < deadline) {
    await sleep(500);
    const arrived = attachmentCount() - baseline;
    const sendReady = (() => {
      const btn = findSendButton() as HTMLButtonElement | null;
      return !!btn && !btn.disabled && btn.getAttribute('aria-disabled') !== 'true';
    })();

    if (arrived >= expected && sendReady && !isGenerating()) {
      // Two consecutive clean polls: an upload that finishes between them
      // would otherwise let a half-attached file through.
      if (++stable >= 2) return true;
    } else {
      stable = 0;
    }
  }
  return false;
}

/**
 * Put the reference images on the composer.
 *
 * Returns an error message, or null when the attachments are confirmed
 * on screen. Never returns null on a guess — a silent miss here produces an
 * answer about an image ChatGPT never received, which looks like success.
 */
async function attachReferences(dataUrls: string[]): Promise<string | null> {
  const input = await revealFileInput();
  if (!input) {
    return 'Could not find ChatGPT\'s file upload — the reference image was not sent';
  }

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

  if (!(await waitForAttachments(baseline, files.length))) {
    return files.length > 1
      ? `Only some of the ${files.length} reference images finished uploading to ChatGPT`
      : 'Reference image did not finish uploading to ChatGPT';
  }
  return null;
}

/** True while ChatGPT is still streaming/generating */
function isGenerating(): boolean {
  const stop = document.querySelector<HTMLElement>(
    'button[data-testid="stop-button"], button[aria-label*="stop" i], button[aria-label*="arrêter" i]'
  );
  return !!(stop && isVisible(stop));
}

/**
 * Candidate result images: what ChatGPT drew, not what we handed it.
 *
 * Uploading a reference broke every test this used to apply. The uploaded
 * image lands in the conversation as part of the user's own turn — same size
 * as a result, fully loaded, and there several seconds earlier — so "largest",
 * "newest" and "not previously seen" all select it. Studio then showed the
 * product photo as the generated scene and passed it downstream as the
 * reference for the video, which is how a run completes green with the wrong
 * image in it.
 *
 * Scoping to assistant turns is the only thing that actually separates them.
 * That attribute is what ChatGPT's own accessibility tree uses and is already
 * what readLatestReply() depends on.
 */
function collectResultImages(): HTMLImageElement[] {
  const composer = composerRegion();

  const usable = (img: HTMLImageElement): boolean => {
    const src = img.currentSrc || img.src || '';
    if (!src) return false;
    if (src.startsWith('data:') && src.length < 2000) return false; // inline icons
    // Composer thumbnails are attachments waiting to be sent, never results.
    if (composer && composer.contains(img)) return false;
    // The uploaded reference echoes back inside the user's turn, at result size.
    if (img.closest('[data-message-author-role="user"]')) return false;
    const rect = img.getBoundingClientRect();
    if (rect.width < 180 && rect.height < 180) return false; // avatars, thumbnails
    return img.complete && img.naturalWidth >= 256 && img.naturalHeight >= 256;
  };

  const gather = (roots: ParentNode[]): HTMLImageElement[] => {
    const seen = new Set<HTMLImageElement>();
    const out: HTMLImageElement[] = [];
    for (const root of roots) {
      for (const img of Array.from(root.querySelectorAll('img'))) {
        if (seen.has(img) || !usable(img)) continue;
        seen.add(img);
        out.push(img); // document order, so the last one is the newest
      }
    }
    return out;
  };

  /* Assistant turns first, because that is the cleanest separation between
     what ChatGPT drew and what we handed it.

     But only as a preference. Requiring it meant that if a result rendered
     anywhere other than inside a message element — a different surface, a
     changed attribute, an image-generation card mounted beside the turn — the
     poller found nothing at all and the node sat at "Generating…" until it
     timed out, with the finished image plainly on screen the whole time.
     Falling back to the whole page still excludes the user's own turn and the
     composer, which is what actually kept the wrong image out. */
  const assistantTurns = Array.from(
    document.querySelectorAll<HTMLElement>('[data-message-author-role="assistant"]')
  );
  const scoped = assistantTurns.length ? gather(assistantTurns) : [];
  return scoped.length ? scoped : gather([document]);
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

  /* Attach references before typing.
     Order matters: uploading can re-render the composer, and a prompt typed
     first would be wiped by that re-render — the text is re-read below either
     way, but attaching first avoids the retype entirely. */
  const references: string[] = (config?.referenceImageData || [])
    .filter((d: unknown): d is string => typeof d === 'string' && d.startsWith('data:'));

  // Flow tile ids mean nothing here — they name a tile in another site's grid.
  // A node wired for a reference that arrived in that form has no reference at
  // all, and saying so beats answering about an image ChatGPT never saw.
  if (!references.length && (config?.referenceImageIds || []).length) {
    send('STUDIO_NODE_ERROR', {
      nodeId,
      error: 'Reference image could not be sent to ChatGPT — the upstream node produced a Flow tile, not an image file',
    });
    return { success: false };
  }

  if (references.length) {
    const failure = await attachReferences(references);
    if (failure) {
      send('STUDIO_NODE_ERROR', { nodeId, error: failure });
      return { success: false };
    }
    console.log(`[AutoFlow ChatGPT] ${references.length} reference image(s) attached`);
    send('STUDIO_NODE_PROGRESS', { nodeId, progress: 15 });
    // The upload re-renders the composer, so the element found earlier may be
    // detached. Re-find it rather than typing into a node no longer on screen.
    composer = findComposer() || composer;
  }

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
  let explained = false;

  while (Date.now() - startedAt < GENERATION_TIMEOUT_MS) {
    await sleep(POLL_MS);

    const elapsed = Date.now() - startedAt;
    const progress = Math.min(90, 20 + Math.floor((elapsed / GENERATION_TIMEOUT_MS) * 90));
    send('STUDIO_NODE_PROGRESS', { nodeId, progress });

    const fresh = collectResultImages().filter(
      (i) => !preexisting.has(i.currentSrc || i.src)
    );
    if (fresh.length === 0) {
      /* Say why, once, well before the six-minute timeout.
         "Still generating" and "the image is right there and I cannot see it"
         look identical from the outside — a progress bar climbing on a timer.
         This turns the second one into a line in the console naming which
         filter ate it, instead of a node that hangs and then blames ChatGPT. */
      if (!explained && elapsed > 45_000 && !isGenerating()) {
        explained = true;
        const all = Array.from(document.querySelectorAll('img'));
        const bigEnough = all.filter((i) =>
          i.complete && i.naturalWidth >= 256 && i.naturalHeight >= 256);
        console.warn(
          '[AutoFlow ChatGPT] No result found yet and nothing is streaming. ' +
          `Page has ${all.length} images, ${bigEnough.length} at result size; ` +
          `${document.querySelectorAll('[data-message-author-role="assistant"]').length} assistant turns; ` +
          `composer region ${composerRegion() ? 'identified' : 'NOT identified'}. ` +
          'If the image is visible on screen, one of those filters is wrong.'
        );
      }
      continue;
    }

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
