/* ============================================================
   Which still a finished node hands to the node after it.

   Split out of the content script so the rule can be tested: it lives or dies
   on the ORDER the candidates are considered, and getting that backwards is
   invisible — the chain still runs, it just silently reuses the same opening
   frame for every clip.
   ============================================================ */

export interface ReferenceCandidates {
  /** The clip's final frame, captured by seeking the <video>. Empty for images. */
  endFrame: string;
  /**
   * Still built from the tile's poster or thumbnail. For a video tile the
   * poster is the clip's OPENING frame, which is exactly what a chain must not
   * hand forward.
   */
  posterStill: string;
}

/**
 * Prefer the end frame whenever there is one.
 *
 * A clip feeding the next clip has to pass on where it ENDED, or every step in
 * a chain restarts from the same state — foam that never gets carved, a
 * character that never moves. The poster is always present, so preferring it
 * would mean the seek never mattered.
 *
 * The poster remains the fallback: image results have no end frame, and a
 * video whose frame could not be captured is better represented by its poster
 * than by nothing.
 */
export function pickReferenceStill({ endFrame, posterStill }: ReferenceCandidates): string {
  return endFrame || posterStill || '';
}
