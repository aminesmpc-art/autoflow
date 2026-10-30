/**
 * Where a node added from the library goes.
 *
 * Every add used to be `{ x: fixed, y: fixed + nodes.length * 50 }`: a 50px
 * step for nodes 200-380px tall, so the second Flow clip landed 50px below
 * the first and covered almost all of it, a Prompt sat on top of the Image
 * above it, and the ports of whatever was underneath could not be grabbed.
 * A 1-star review summed the result up as "nodes don't properly connect".
 * The fixed anchor also ignored where you were looking: pan away from the
 * origin and new nodes appeared off screen.
 *
 * Now: start at the middle of what is on screen and take the nearest spot
 * that overlaps no node, with a gap around each.
 */

export interface Box { x: number; y: number; w: number; h: number }
export interface Size { w: number; h: number }

/** Rendered sizes, measured in the canvas harness at 100% zoom. Used only
    for a node React Flow has not measured yet — the one being added. The
    generate size is a video clip's (551px), the default a Flow clip starts
    in; an image one is shorter, and too big a guess only costs a gap. */
export const NODE_SIZE: Record<string, Size> = {
  prompt: { w: 270, h: 200 },
  image: { w: 270, h: 300 },
  // Covers the widest and tallest generate: Ask AI is 360 wide, a Flow
  // video clip 551 tall.
  generate: { w: 360, h: 560 },
  frame: { w: 220, h: 180 },
  extend: { w: 300, h: 330 },
  agent: { w: 300, h: 340 },
  story: { w: 450, h: 690 },
  chief: { w: 390, h: 580 },
  clip: { w: 470, h: 900 },
  cut: { w: 300, h: 320 },
  motion: { w: 470, h: 1100 },
};
const FALLBACK: Size = { w: 300, h: 340 };

export const sizeOf = (type: string | undefined): Size => NODE_SIZE[type || ''] || FALLBACK;

/** The space a node already on the canvas takes, measured when React Flow has. */
export function boxOf(node: {
  position: { x: number; y: number };
  type?: string;
  measured?: { width?: number; height?: number };
  width?: number;
  height?: number;
}): Box {
  const fallback = sizeOf(node.type);
  return {
    x: node.position.x,
    y: node.position.y,
    w: node.measured?.width || node.width || fallback.w,
    h: node.measured?.height || node.height || fallback.h,
  };
}

const overlaps = (a: Box, b: Box, gap: number): boolean =>
  a.x < b.x + b.w + gap && b.x < a.x + a.w + gap &&
  a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;

/**
 * The free spot nearest to `anchor` (the top-left the node would like) for a
 * node of `size`, given the boxes already `taken`.
 *
 * Candidates sit on a grid around the anchor and are tried nearest first, so
 * an empty view keeps the node in the middle and a crowded one puts it
 * beside the nearest neighbour rather than across the canvas. Bounded: past
 * the search radius it gives up and returns the anchor, which can only
 * overlap on a canvas packed solid for screens in every direction.
 */
export function freeSpot(
  anchor: { x: number; y: number },
  size: Size,
  taken: readonly Box[],
  gap = 40,
): { x: number; y: number } {
  const step = 40;
  const radius = 40;
  const candidates: Array<{ x: number; y: number; d: number }> = [];
  for (let i = -radius; i <= radius; i++) {
    for (let j = -radius; j <= radius; j++) {
      // Slightly prefer going right and down: that is where a pipeline grows.
      const d = Math.hypot(i * step * (i < 0 ? 1.15 : 1), j * step * (j < 0 ? 1.15 : 1));
      candidates.push({ x: anchor.x + i * step, y: anchor.y + j * step, d });
    }
  }
  candidates.sort((a, b) => a.d - b.d);
  for (const c of candidates) {
    const box = { x: c.x, y: c.y, w: size.w, h: size.h };
    if (!taken.some((t) => overlaps(box, t, gap))) return { x: Math.round(c.x), y: Math.round(c.y) };
  }
  return { x: Math.round(anchor.x), y: Math.round(anchor.y) };
}

export type Placed = Box & { id: string };

/**
 * How far into the run each node is: the length of the longest chain of
 * wires leading into it. Tidy lays columns out by it and Simple view lists
 * results by it, so both show the workflow in the order it runs. A wire that
 * loops back ranks nothing.
 */
export function runRanks(
  ids: readonly string[],
  edges: readonly { source: string; target: string }[],
): Map<string, number> {
  const known = new Set(ids);
  const into = new Map<string, string[]>();
  for (const e of edges) {
    if (!known.has(e.source) || !known.has(e.target) || e.source === e.target) continue;
    into.set(e.target, [...(into.get(e.target) || []), e.source]);
  }
  const rank = new Map<string, number>();
  const visiting = new Set<string>();
  const rankOf = (id: string): number => {
    const done = rank.get(id);
    if (done !== undefined) return done;
    if (visiting.has(id)) return -1;
    visiting.add(id);
    let r = 0;
    for (const s of into.get(id) || []) r = Math.max(r, rankOf(s) + 1);
    visiting.delete(id);
    rank.set(id, r);
    return r;
  };
  ids.forEach(rankOf);
  return rank;
}

/**
 * Move overlapping nodes apart, changing as little as possible.
 *
 * freeSpot keeps a node being ADDED clear; this is for a workflow that
 * arrives with nodes already on top of each other. A bundled template did:
 * measured in the canvas harness on 2026-10-30, Wrong Room Challenge opened
 * with 24 overlapping pairs, because its positions were laid out for nodes
 * far shorter than they render (a Director 140px left of the 300px board it
 * feeds). Covered ports cannot be grabbed, which is the 1-star "nodes don't
 * properly connect" by another road. Community posts, imports and workflows
 * the AI builds can arrive the same way.
 *
 * Every node keeps its x, so the author's columns survive. Top to bottom,
 * each one moves down below whatever already-placed node it hits. Returns
 * only the nodes that moved.
 */
export function separate(boxes: readonly Placed[], gap = 24): Map<string, { x: number; y: number }> {
  const placed: Box[] = [];
  const moved = new Map<string, { x: number; y: number }>();
  for (const b of [...boxes].sort((p, q) => p.y - q.y || p.x - q.x)) {
    let y = b.y;
    for (;;) {
      const hit = placed.find((p) => overlaps({ ...b, y }, p, gap));
      if (!hit) break;
      y = hit.y + hit.h + gap;
    }
    placed.push({ ...b, y });
    if (y !== b.y) moved.set(b.id, { x: Math.round(b.x), y: Math.round(y) });
  }
  return moved;
}

/**
 * Lay the whole workflow out left to right, in the order it runs.
 *
 * A node's column is the length of the longest chain of wires leading into
 * it, so everything sits to the right of what it reads from. Inside a column
 * the nodes keep the top-to-bottom order they had, and stack by their
 * measured heights. Wires that loop back cannot rank anything, so a node on
 * a cycle is ranked by the wires that do resolve. Deterministic, so pressing
 * Tidy twice changes nothing the second time.
 */
export function tidy(
  boxes: readonly Placed[],
  edges: readonly { source: string; target: string }[],
  gapX = 96,
  gapY = 40,
): Map<string, { x: number; y: number }> {
  const out = new Map<string, { x: number; y: number }>();
  if (!boxes.length) return out;
  const rank = runRanks(boxes.map((b) => b.id), edges);

  const columns = new Map<number, Placed[]>();
  for (const b of boxes) columns.set(rank.get(b.id)!, [...(columns.get(rank.get(b.id)!) || []), b]);
  const left = Math.min(...boxes.map((b) => b.x));
  const top = Math.min(...boxes.map((b) => b.y));

  let x = left;
  for (const r of [...columns.keys()].sort((a, b) => a - b)) {
    const col = columns.get(r)!.sort((p, q) => p.y - q.y || p.x - q.x);
    let y = top;
    for (const b of col) {
      out.set(b.id, { x: Math.round(x), y: Math.round(y) });
      y += b.h + gapY;
    }
    x += Math.max(...col.map((b) => b.w)) + gapX;
  }
  return out;
}
