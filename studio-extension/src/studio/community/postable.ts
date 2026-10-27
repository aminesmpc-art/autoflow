/* ============================================================
   What a posted workflow carries — and what it must not.

   A post is the workflow as its author SET IT UP, never what a run left in
   it: finished clips and stills are data: URLs megabytes long (the server
   refuses anything over 400 KB), and a stranger opening the post should get a
   workflow ready to run, not last week's results. And the author's own photos
   (image nodes, character and place pictures) stay on their machine unless
   they tick the box: a public feed is not where a face someone uploaded for
   themselves should end up by default.

   Pure functions, so the feed's rules are tested without a browser.
   ============================================================ */

import type { Outline } from './feedApi';

/* Written by a run, not by the author. Reset or dropped before posting. */
const RUN_STATE = new Set([
  'progress', 'previewUrl', 'previewVideoUrl', 'resultUrl', 'resultTileId', 'errorMessage',
  'resultText', 'lastFrameUrl', 'sentPrompt', 'statusNote', 'frameUrl', 'text',
  'motionPieces', 'motionRetryPiece', 'motionJob', 'motionPreparedFrom', 'configurationAtRun',
  'motionUploaded', 'agentSteps', 'clipRun', 'chiefReview', 'chiefCheckpoint', 'chiefSaveWarning',
  'brollCount', 'conversationPath', 'resumeConversation',
]);

/* A string holding media rather than words: inline files and local refs. */
const isMedia = (s: string) => /^(data:|blob:|vault:)/.test(s);

/** The server refuses a template over 400 KB; stay clear of the edge. */
export const MAX_POST_BYTES = 380_000;

/** A photo the author put in: an image node's own picture. */
function isPhoto(node: any, key: string, value: unknown): boolean {
  return typeof value === 'string' && isMedia(value)
    && (key === 'imageData' || key === 'image' || key === 'referenceImage')
    && (node?.type === 'image' || node?.data?.type === 'image');
}

function clean(value: any, keep: (key: string, v: unknown) => boolean, key = ''): any {
  if (typeof value === 'string') return isMedia(value) && !keep(key, value) ? '' : value;
  if (Array.isArray(value)) return value.map((v) => clean(v, keep, key));
  if (value && typeof value === 'object') {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(value)) {
      if (RUN_STATE.has(k)) continue;
      out[k] = clean(v, keep, k);
    }
    return out;
  }
  return value;
}

export interface Postable {
  template: Record<string, any>;
  /** Photos the author put in, whether or not they are included. */
  photos: number;
  /** JSON size of what would be sent. */
  bytes: number;
  tooBig: boolean;
}

export function postableWorkflow(
  name: string, nodes: any[], edges: any[], opts: { includePhotos: boolean; description?: string },
): Postable {
  let photos = 0;
  const cleanNodes = (nodes || []).map((node) => {
    const keep = (key: string, v: unknown) => {
      if (!isPhoto(node, key, v)) return false;
      return opts.includePhotos;
    };
    for (const [k, v] of Object.entries(node?.data || {})) if (isPhoto(node, k, v)) photos++;
    const data = clean(node?.data || {}, keep);
    if ('status' in data) data.status = 'idle';
    return {
      id: node.id, type: node.type, position: { x: node.position?.x ?? 0, y: node.position?.y ?? 0 }, data,
    };
  });
  const cleanEdges = (edges || []).map((e) => ({
    id: e.id, source: e.source, target: e.target,
    ...(e.sourceHandle ? { sourceHandle: e.sourceHandle } : {}),
    ...(e.targetHandle ? { targetHandle: e.targetHandle } : {}),
  }));
  const template = {
    id: `post_${Date.now().toString(36)}`,
    name: name.trim() || 'Untitled',
    description: opts.description || '',
    category: 'Community',
    difficulty: 'Medium',
    thumbnail: '🧩',
    useCase: opts.description || '',
    nodeCount: cleanNodes.length,
    nodes: cleanNodes,
    edges: cleanEdges,
  };
  const bytes = new TextEncoder().encode(JSON.stringify(template)).length;
  return { template, photos, bytes, tooBig: bytes > MAX_POST_BYTES };
}

/** The same outline the server stores (apps/workflows/community.py outline_of). */
export function outlineOf(nodes: any[], edges: any[]): Outline {
  const index = new Map<string, number>();
  const out = (nodes || []).slice(0, 60).map((node, i) => {
    index.set(String(node?.id ?? ''), i);
    const d = node?.data || {};
    return {
      type: String(node?.type || d.type || 'node').slice(0, 24),
      label: String(d.label || '').slice(0, 40),
      platform: String(d.platform || '').slice(0, 16),
      media: String(d.mediaType || '').slice(0, 8),
      x: Math.round(Number(node?.position?.x) || 0),
      y: Math.round(Number(node?.position?.y) || 0),
    };
  });
  const pairs: [number, number][] = [];
  for (const e of edges || []) {
    const s = index.get(String(e?.source)); const t = index.get(String(e?.target));
    if (s !== undefined && t !== undefined && s !== t && !pairs.some(([a, b]) => a === s && b === t)) pairs.push([s, t]);
  }
  return { nodes: out, edges: pairs.slice(0, 200) };
}
