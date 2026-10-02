/* ============================================================
   "Is this element on the page?" — asked from a tab nobody is watching

   Reported twice from real background runs: Gemini does nothing until the
   tab is clicked. This is why.

   ── The bug ─────────────────────────────────────────────────────────────

   Every adapter had its own copy of this, all five byte-identical, all
   gating on size:

     const rect = el.getBoundingClientRect();
     if (rect.width < 5 || rect.height < 5) return false;

   A tab Chrome is not rendering computes NO LAYOUT, so getBoundingClientRect
   returns 0×0 for every element on the page. The test therefore answers
   "invisible" for everything, and findComposer() — which filters by it —
   returns null. The adapter never finds the box to type into, so it never
   types, never submits, and waits until it gives up.

   Clicking the tab computes layout, the rects become real, and the very next
   attempt works. That is the whole reported symptom.

   Flow is the proof: it is the only adapter with no getBoundingClientRect
   gate anywhere, and it is the only one that ran hidden without complaint.

   ── The fix ─────────────────────────────────────────────────────────────

   0×0 on a hidden tab means UNKNOWN, not hidden. Style still answers
   honestly — display, visibility and opacity are computed without layout —
   so that check stays and carries the decision on its own while hidden.

   The size test is kept for visible tabs, where it is doing real work:
   rejecting the collapsed and zero-sized elements these sites leave in the
   DOM. It is only skipped where it cannot mean anything.
   ============================================================ */

/** Whether the tab can currently compute layout at all. */
function hasLayout(): boolean {
  try {
    return document.hidden !== true;
  } catch {
    /* No document: assume layout rather than declare everything invisible. */
    return true;
  }
}

/**
 * Is the element really on the page and shown?
 *
 * Never throws: an adapter that cannot answer this cannot do anything, and
 * throwing here would fail a run rather than degrade it.
 */
export function isVisible(el: Element): boolean {
  if (!el) return false;

  /* Style first, because it is the half that still works without layout. */
  let style: CSSStyleDeclaration | null = null;
  try {
    style = getComputedStyle(el as HTMLElement);
  } catch {
    return false;
  }
  if (!style) return false;
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
    return false;
  }

  let rect: DOMRect;
  try {
    rect = el.getBoundingClientRect();
  } catch {
    /* Same reasoning as below: unmeasurable is not the same as absent. */
    return !hasLayout();
  }

  /* Nothing measured, and nothing could have been. Style has already said
     the element is shown, and that is the best answer available. */
  if (rect.width === 0 && rect.height === 0 && !hasLayout()) return true;

  return rect.width >= 5 && rect.height >= 5;
}
