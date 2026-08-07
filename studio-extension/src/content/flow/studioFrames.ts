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
  /**
   * Whether the result was a clip. Decides what an empty endFrame means:
   * "there was never going to be one" for an image, or "the capture failed"
   * for a video.
   */
  isVideo?: boolean;
}

/**
 * Prefer the end frame whenever there is one.
 *
 * A clip feeding the next clip has to pass on where it ENDED, or every step in
 * a chain restarts from the same state — foam that never gets carved, a
 * character that never moves. The poster is always present, so preferring it
 * would mean the seek never mattered.
 *
 * For an image the poster IS the result, so it is the right answer.
 *
 * For a video it is the opening frame, and returning it when the seek failed
 * is worse than returning nothing. It looks like a working handoff: the Last
 * Frame node shows a plausible still, the next clip starts from it, and the
 * whole chain quietly restarts from the beginning of the previous shot with
 * nothing on screen to say so. Nothing is at least visible — the frame node
 * says it captured nothing, and the node downstream refuses to run rather
 * than generating without the reference it was wired for.
 */
export function pickReferenceStill({ endFrame, posterStill, isVideo }: ReferenceCandidates): string {
  if (endFrame) return endFrame;
  if (isVideo) return '';
  return posterStill || '';
}
