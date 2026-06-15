/**
 * AutoFlow — Offscreen Keepalive
 * 
 * This tiny script runs inside a hidden offscreen document.
 * Its only job: ping the service worker every 20 seconds
 * so Chrome doesn't kill it during long-running operations
 * like firing a scheduled chain.
 */

const PING_INTERVAL_MS = 20_000; // 20 seconds

setInterval(() => {
  chrome.runtime.sendMessage({ type: 'KEEPALIVE_PING' }).catch(() => {
    // Service worker might not be listening yet — ignore
  });
}, PING_INTERVAL_MS);

// Send an immediate first ping
chrome.runtime.sendMessage({ type: 'KEEPALIVE_PING' }).catch(() => {});

console.log('[AutoFlow Offscreen] Keepalive started — pinging every 20s');
