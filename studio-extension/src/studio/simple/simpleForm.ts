/* ============================================================
   Simple view — what the form shows, read off the graph.

   The owner's call (2026-10-30): a workflow can be used as a form, with the
   graph hidden — ComfyUI's App Mode and Krea's Node Apps, for people who
   want the result rather than the wiring. Templates open this way.

   Nothing is configured per workflow. Measured across the 27 bundled
   templates: every input a person fills in is a Prompt node or an Image
   node (none keeps its prompt inside a generate node), and 7 of them ship
   with an empty Image slot waiting for the user's own photo. So the form is
   those nodes, in reading order, and the results are the nodes that make
   something — in the order the run makes them.
   ============================================================ */

import { runRanks } from '../canvas/placement';

interface AnyNode { id: string; type?: string; position?: { x: number; y: number }; data?: any }
interface AnyEdge { source: string; target: string }

export type InputKind = 'prompt' | 'image';
export type ResultKind = 'image' | 'video' | 'text';

export interface SimpleInput {
  id: string;
  kind: InputKind;
  label: string;
  /** The steps this input is wired into, by name — "used by Clip 1, Clip 2". */
  feeds: string[];
}

export interface SimpleResult {
  id: string;
  kind: ResultKind;
  label: string;
}

const typeOf = (n: AnyNode): string => n.data?.type || n.type || '';
const nameOf = (n: AnyNode, fallback: string): string => String(n.data?.label || fallback);

/* Top to bottom, then left to right: how the canvas reads. */
const byPlace = (a: AnyNode, b: AnyNode) =>
  (a.position?.y || 0) - (b.position?.y || 0) || (a.position?.x || 0) - (b.position?.x || 0);

/** The Prompt and Image nodes, as fields to fill in. */
export function simpleInputs(nodes: readonly AnyNode[], edges: readonly AnyEdge[]): SimpleInput[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return nodes
    .filter((n) => typeOf(n) === 'prompt' || typeOf(n) === 'image')
    .sort(byPlace)
    .map((n) => {
      const kind = typeOf(n) as InputKind;
      const feeds = [...new Set(edges
        .filter((e) => e.source === n.id)
        .map((e) => byId.get(e.target))
        .filter((t): t is AnyNode => !!t)
        .map((t) => nameOf(t, 'a step')))];
      return { id: n.id, kind, label: nameOf(n, kind === 'prompt' ? 'Prompt' : 'Reference image'), feeds };
    });
}

/**
 * What a generate node makes, by the same rules GenerateNode draws it with:
 * a chat node set to text (Claude only writes) writes; a clip is a clip only
 * where a clip can be made — Flow, Grok Imagine, Gemini — and otherwise the
 * chat draws a picture.
 */
export function generateMakes(data: any): ResultKind {
  const platform = data?.platform || 'flow';
  if (platform !== 'flow' && (data?.mediaType === 'text' || platform === 'claude')) return 'text';
  if (data?.mediaType === 'video' && ['flow', 'grok', 'gemini'].includes(platform)) return 'video';
  return 'image';
}

/**
 * The results: every node that makes media, and every written answer that
 * nothing else reads. A prompt a Director or an Ask AI node writes FOR a clip
 * is a step on the way, not something anyone came here for — so text only
 * counts when it is where the workflow ends.
 */
export function simpleResults(nodes: readonly AnyNode[], edges: readonly AnyEdge[]): SimpleResult[] {
  const readByAnother = new Set(edges.map((e) => e.source));
  const found: Array<SimpleResult & { node: AnyNode }> = [];
  for (const n of nodes) {
    const t = typeOf(n);
    if (t === 'generate') {
      const kind = generateMakes(n.data);
      if (kind !== 'text' || !readByAnother.has(n.id)) found.push({ id: n.id, kind, label: nameOf(n, 'Result'), node: n });
    } else if (t === 'extend' || t === 'cut') {
      found.push({ id: n.id, kind: 'video', label: nameOf(n, t === 'cut' ? 'Cut' : 'Extend'), node: n });
    } else if (t === 'agent' && !readByAnother.has(n.id)) {
      found.push({ id: n.id, kind: 'text', label: nameOf(n, 'Agent'), node: n });
    }
  }
  const rank = runRanks(nodes.map((n) => n.id), edges);
  return found
    .sort((a, b) => (rank.get(a.id)! - rank.get(b.id)!) || byPlace(a.node, b.node))
    .map(({ node: _node, ...r }) => r);
}
