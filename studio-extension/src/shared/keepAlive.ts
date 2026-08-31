/**
 * Keep-alive for background tabs.
 *
 * Chrome aggressively throttles background tabs: timers slow to once per
 * minute, requestAnimationFrame stops entirely, and after 5 minutes the
 * tab can be frozen outright. For an extension that automates page
 * interactions in tabs the user isn't looking at, this is fatal.
 *
 * Two complementary strategies:
 *
 * 1. **Silent AudioContext** — Chrome exempts tabs marked as "playing audio"
 *    from its intensive throttling. We create a silent oscillator (gain = 0)
 *    that produces no audible sound but keeps the tab's audio flag alive.
 *    This is the same technique used by major extensions (e.g. Tab Suspender
 *    bypass, Keep Awake). No speaker icon appears because gain is zero.
 *
 * 2. **Service Worker ping** — A round-trip message to the extension's
 *    service worker every 15 seconds. The act of receiving the response
 *    wakes the content script's thread even if Chrome has deprioritized it.
 *
 * Usage:
 *   import { startKeepAlive, stopKeepAlive } from '../../shared/keepAlive';
 *
 *   // When work begins:
 *   startKeepAlive();
 *
 *   // When work ends:
 *   stopKeepAlive();
 */

let audioCtx: AudioContext | null = null;
let oscillator: OscillatorNode | null = null;
let gainNode: GainNode | null = null;
let pingInterval: ReturnType<typeof setInterval> | null = null;
let refCount = 0;

function startAudio(): void {
  if (audioCtx) return;
  try {
    audioCtx = new AudioContext();
    oscillator = audioCtx.createOscillator();
    gainNode = audioCtx.createGain();

    // Completely silent — no audible output, no speaker icon
    gainNode.gain.value = 0;
    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    oscillator.start();
  } catch {
    // AudioContext may not be available in all contexts (e.g. some CSP).
    // Fall back to ping-only mode silently.
    audioCtx = null;
    oscillator = null;
    gainNode = null;
  }
}

function stopAudio(): void {
  try {
    oscillator?.stop();
    oscillator?.disconnect();
    gainNode?.disconnect();
    audioCtx?.close();
  } catch { /* already stopped */ }
  oscillator = null;
  gainNode = null;
  audioCtx = null;
}

function startPing(): void {
  if (pingInterval) return;
  pingInterval = setInterval(() => {
    try { chrome.runtime.sendMessage({ type: 'PING' }).catch(() => {}); } catch {}
  }, 15_000);
}

function stopPing(): void {
  if (pingInterval) {
    clearInterval(pingInterval);
    pingInterval = null;
  }
}

/**
 * Start keeping this tab alive in the background.
 *
 * Reference-counted: multiple callers can start/stop independently.
 * The keep-alive only truly stops when every caller has stopped.
 */
export function startKeepAlive(): void {
  refCount++;
  if (refCount === 1) {
    startAudio();
    startPing();
  }
}

/**
 * Stop keeping this tab alive.
 * Only actually stops when all callers have balanced their starts.
 */
export function stopKeepAlive(): void {
  refCount = Math.max(0, refCount - 1);
  if (refCount === 0) {
    stopAudio();
    stopPing();
  }
}
