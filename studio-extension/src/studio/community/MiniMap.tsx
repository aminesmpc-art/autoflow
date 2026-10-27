/* ============================================================
   MiniMap — a post's workflow, drawn from its outline.

   The only picture a post has (the owner chose "just json files": no videos,
   no images). So it draws the real thing: every node where the author put
   it on the canvas, coloured by kind the way the canvas colours it, with the
   platform's mark, and the wires between them. A reader sees at a glance
   "a prompt into Gemini into three Flow clips" before opening anything.
   ============================================================ */

import { useMemo } from 'react';
import { BRAND_MARKS } from '../components/brandMarks';
import type { Outline, OutlineNode } from './feedApi';

const NODE_W = 240;
const NODE_H = 72;
const PAD = 48;

/** The canvas's own node colours (shared/tokens.css --n-*). */
export function kindOf(node: Pick<OutlineNode, 'type' | 'media'>): { color: string; name: string } {
  switch (node.type) {
    case 'prompt': return { color: 'var(--n-prompt)', name: 'Prompt' };
    case 'image': return { color: 'var(--n-image)', name: 'Image' };
    case 'agent': return { color: 'var(--n-agent)', name: 'Agent' };
    case 'frame': return { color: 'var(--n-frame)', name: 'Frame' };
    case 'story': return { color: 'var(--n-story)', name: 'Story' };
    case 'extend': return { color: 'var(--n-extend)', name: 'Extend' };
    case 'motion': return { color: 'var(--n-video)', name: 'Motion' };
    case 'chief': return { color: 'var(--n-agent)', name: 'Chief' };
    case 'cut': case 'clipping': return { color: 'var(--n-video)', name: 'Clip' };
    case 'generate':
      if (node.media === 'video') return { color: 'var(--n-video)', name: 'Video' };
      if (node.media === 'text') return { color: 'var(--n-ask)', name: 'Ask AI' };
      return { color: 'var(--n-image)', name: 'Image' };
    default: return { color: 'var(--text-3)', name: node.type || 'Step' };
  }
}

const brandOf = (platform: string) => (platform in BRAND_MARKS ? BRAND_MARKS[platform as keyof typeof BRAND_MARKS] : null);

interface Props {
  outline: Outline;
  /** Taller in the post view; labels stay readable there for bigger graphs. */
  size?: 'card' | 'large';
  className?: string;
}

export default function MiniMap({ outline, size = 'card', className }: Props) {
  const layout = useMemo(() => {
    let nodes = outline?.nodes || [];
    if (!nodes.length) return null;
    /* A long chain laid out in one row (a 14-shot story is 14 nodes side by
       side) became a strip of slivers in a 16:7 card. Wrapped into rows,
       left to right in canvas order, it stays readable; wires still join
       the same steps. */
    const spanX = Math.max(...nodes.map((n) => n.x)) - Math.min(...nodes.map((n) => n.x)) + NODE_W;
    const spanY = Math.max(...nodes.map((n) => n.y)) - Math.min(...nodes.map((n) => n.y)) + NODE_H;
    const wrapped = nodes.length > 4 && spanX / spanY > 4;
    if (wrapped) {
      const cols = Math.max(3, Math.ceil(Math.sqrt(nodes.length * 2.2)));
      const order = nodes.map((n, i) => i).sort((a, b) => nodes[a].x - nodes[b].x || nodes[a].y - nodes[b].y);
      const placed = [...nodes];
      order.forEach((idx, k) => {
        placed[idx] = { ...nodes[idx], x: (k % cols) * (NODE_W + 70), y: Math.floor(k / cols) * (NODE_H + 70) };
      });
      nodes = placed;
    }
    const xs = nodes.map((n) => n.x); const ys = nodes.map((n) => n.y);
    const minX = Math.min(...xs) - PAD; const minY = Math.min(...ys) - PAD;
    const width = Math.max(...xs) + NODE_W + PAD - minX;
    const height = Math.max(...ys) + NODE_H + PAD - minY;
    /* Labels are drawn only where they would still be legible: a sprawling
       graph squeezed into a card becomes coloured blocks and wires instead. */
    const labels = width <= (size === 'large' ? 4200 : 2600);
    return { nodes, minX, minY, width, height, labels, wrapped };
  }, [outline, size]);

  if (!layout) {
    return <div className={`cf-map cf-map--${size} cf-map--empty ${className || ''}`}>No steps to show</div>;
  }
  const { nodes, minX, minY, width, height, labels, wrapped } = layout;
  const at = (i: number) => ({ x: nodes[i].x - minX, y: nodes[i].y - minY });

  return (
    <div className={`cf-map cf-map--${size} ${className || ''}`}>
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet" role="img"
        aria-label={`Workflow with ${nodes.length} step${nodes.length === 1 ? '' : 's'}`}>
        <g className={`cf-map__wires ${wrapped ? 'cf-map__wires--faint' : ''}`}>
          {(outline.edges || []).map(([s, t], i) => {
            if (!nodes[s] || !nodes[t]) return null;
            const a = at(s); const b = at(t);
            const x1 = a.x + NODE_W; const y1 = a.y + NODE_H / 2;
            const x2 = b.x; const y2 = b.y + NODE_H / 2;
            const bend = Math.max(60, Math.abs(x2 - x1) / 2);
            return <path key={i} d={`M${x1},${y1} C${x1 + bend},${y1} ${x2 - bend},${y2} ${x2},${y2}`} />;
          })}
        </g>
        {nodes.map((n, i) => {
          const { x, y } = at(i);
          const kind = kindOf(n);
          const mark = brandOf(n.platform);
          const text = n.label || kind.name;
          return (
            <g key={i} transform={`translate(${x},${y})`} className="cf-map__node">
              <rect width={NODE_W} height={NODE_H} rx={14} style={{ stroke: kind.color }} />
              <rect width={8} height={NODE_H} rx={4} style={{ fill: kind.color }} />
              {mark && (
                <svg x={22} y={NODE_H / 2 - 16} width={32} height={32} viewBox={mark.viewBox}
                  fill={mark.color} dangerouslySetInnerHTML={{ __html: mark.body }} />
              )}
              {labels && (
                <text x={mark ? 66 : 26} y={NODE_H / 2 + 9} style={{ fontSize: 26 }}>
                  {text.length > (mark ? 12 : 14) ? `${text.slice(0, mark ? 11 : 13)}…` : text}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/** The platforms a workflow drives, in the order they first appear left to right. */
export function platformsOf(outline: Outline): string[] {
  return [...(outline?.nodes || [])]
    .sort((a, b) => a.x - b.x)
    .map((n) => n.platform)
    .filter((p, i, all) => p && brandOf(p) && all.indexOf(p) === i);
}

export function BrandMark({ name, className }: { name: string; className?: string }) {
  const mark = brandOf(name);
  if (!mark) return null;
  return (
    <svg className={className} viewBox={mark.viewBox} fill={mark.color} aria-hidden="true" focusable="false"
      dangerouslySetInnerHTML={{ __html: mark.body }} />
  );
}
