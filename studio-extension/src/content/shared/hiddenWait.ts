/* ============================================================
   Waiting in a tab nobody is looking at

   Every adapter watches for its result the same way: sleep, read the DOM,
   decide. That is fine while the tab is in front and wrong the moment it is
   not — Chrome clamps a hidden tab's timers to roughly once a minute, so a
   loop asking for 800ms gets 60 seconds and a result that arrived a second
   after the last poll waits most of a minute to be noticed.

   Nothing is broken by that on its own; the adapters read the DOM perfectly
   well while hidden. What suffers is everything measured in POLLS rather
   than seconds:

     Grok wants three unchanged polls   → three minutes, not six seconds
     Z.AI and ChatGPT want two          → two minutes, not four seconds
     Gemini wants two                   → the same

   MutationObserver is NOT throttled by visibility. So the DOM itself becomes
   the faster of the two signals and the timer becomes the backstop — the
   "DOM events plus bounded reconciliation" the rollout plan asks for.

   Extracted from the Gemini adapter, which had it first, so the other three
   get the same behaviour rather than three more copies of it.
   ============================================================ */

/**
 * Wait up to `ms`, or until the DOM changes — whichever comes first.
 *
 * `minMs` stops a chatty page turning the poll loop into a busy loop:
 * mutations before it are ignored, so the observer only ever shortens the
 * tail of a wait. Never rejects, and always settles exactly once.
 */
export function sleepOrDomChange(ms: number, minMs = 250): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const startedAt = Date.now();
    let obs: MutationObserver | null = null;

    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { obs?.disconnect(); } catch { /* already gone */ }
      resolve();
    };

    const timer = setTimeout(finish, ms);

    try {
      obs = new MutationObserver(() => {
        if (Date.now() - startedAt >= minMs) finish();
      });
      obs.observe(document.body, {
        childList: true,
        subtree: true,
        /* src covers an <img>/<video> whose element is reused and only
           repointed, which is how several of these sites swap in a result. */
        attributes: true,
        attributeFilter: ['src'],
      });
    } catch {
      /* No body yet, or observers unavailable. The timer alone still carries
         it, which is exactly the behaviour every adapter had before this. */
    }
  });
}
