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
