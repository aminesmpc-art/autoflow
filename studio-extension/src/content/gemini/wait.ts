/** Hidden page timers can be clamped even while the content script is alive.
 * A short worker response provides a second clock for Gemini's own waits.
 * It cannot unfreeze Chrome or force Gemini's app to render. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    if (document.hidden !== true || ms < 50 || ms > 2000) return;
    try {
      chrome.runtime.sendMessage({ type: 'GEMINI_WAIT', ms }).then((reply) => {
        if (reply?.elapsed === true) finish();
      }).catch(() => { /* The page timer remains the fallback. */ });
    } catch { /* Extension reloaded or the worker is unavailable. */ }
  });
}
