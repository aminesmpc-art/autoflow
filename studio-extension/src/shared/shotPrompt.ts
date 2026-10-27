/**
 * The one prompt a Director (or an Ask AI writing a set) wrote for this clip.
 *
 * A writer that covers several clips keeps the whole set on itself —
 * `resultText` holds every shot under its label, `shotPrompts` the prompts in
 * its targets' order. The canvas runner hands each clip its own from a plan
 * it holds in memory. A retry after a reload has no such plan, and a retry on
 * the worker never had one: it took `resultText` and sent the retried clip
 * every shot of the set, labels and all.
 *
 * So the set is also kept by target id (`shotPromptsByTarget`), which does
 * not depend on where the clips sit on the canvas. Sets written before that
 * map existed are read by position, the order orderShotTargets gives — the
 * same order they were written in, as long as the clips have not been moved.
 */

import { orderShotTargets } from '../studio/ask/storyboard';

interface NodeLike { id: string; type?: string; position?: { x: number; y: number }; data?: any }
interface EdgeLike { source: string; target: string; targetHandle?: string | null }

export function shotPromptFor(
  source: NodeLike | undefined, targetId: string, nodes: NodeLike[], edges: EdgeLike[],
): string | null {
  const d = source?.data || {};
  const mine = d.shotPromptsByTarget?.[targetId];
  if (typeof mine === 'string' && mine.trim()) return mine;

  const set = Array.isArray(d.shotPrompts) ? d.shotPrompts : null;
  if (!source || !set?.length) return null;
  const idx = orderShotTargets(source.id, nodes, edges).findIndex((t) => t.id === targetId);
  const byPosition = idx >= 0 && idx < set.length ? set[idx] : null;
  return typeof byPosition === 'string' && byPosition.trim() ? byPosition : null;
}

/** The same set, keyed by the clip it was written for. */
export function shotPromptsByTarget(targets: Array<{ id: string }>, prompts: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  targets.forEach((t, i) => { if (typeof prompts[i] === 'string') out[t.id] = prompts[i]; });
  return out;
}
