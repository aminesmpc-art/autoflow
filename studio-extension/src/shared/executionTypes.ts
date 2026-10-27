/* ============================================================
   Execution Types — Shared contracts between Service Worker
   coordinator and Studio Canvas.
   
   Everything in this file must be JSON-serializable and free of
   DOM, React, or @xyflow/react dependencies. The service worker
   imports it, and it cannot touch any of those.
   ============================================================ */

export type RunState = 'idle' | 'running' | 'paused' | 'stopped' | 'done' | 'error';

export interface SerializedNode {
  id: string;
  type: string;
  data: Record<string, unknown>;
  position: { x: number; y: number };
}

export interface SerializedEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
}

export interface RunOptions {
  only?: string[];
}

export interface RunManifest {
  runId: string;
  workflowId: string;
  nodes: SerializedNode[];
  edges: SerializedEdge[];
  options: RunOptions;
  startedAt: number;
}

export interface NodeExecutionStatus {
  nodeId: string;
  status: 'idle' | 'running' | 'done' | 'error' | 'skipped';
  progress?: number;
  resultUrl?: string;
  previewUrl?: string;
  previewVideoUrl?: string;
  /** Actual captured ending of a video, never its poster/preview. */
  lastFrameUrl?: string;
  resultTileId?: string;
  resultText?: string;
  errorMessage?: string | null;
  statusNote?: string;
  mediaId?: string;
  /** The prompt a Flow clip went out with — shared/videoReference.ts. */
  sentPrompt?: string;
  /**
   * A Last Frame node's captured still.
   *
   * Frame nodes are not runnable, so nothing else here describes one — and
   * that was the gap: a delegated run captured every frame into the worker's
   * memory and sent none of it back, so the canvas kept empty frame nodes and
   * the run's continuity died with the worker. The NEXT retry then had
   * nothing to resume from and re-ran the episode.
   *
   * Only ever carries a FRESH capture. A pass that produced nothing new must
   * leave the frame the canvas is already holding alone.
   */
  frameUrl?: string;
}

export interface ExecutionSnapshot {
  runId: string;
  workflowId: string;
  state: RunState;
  currentNodeId: string | null;
  progress: { current: number; total: number };
  nodeStatuses: Record<string, NodeExecutionStatus>;
  startedAt: number;
  updatedAt: number;
  lastError?: string;
}

/** Canvas → Service Worker commands */
export type CanvasToSwMessage =
  | { type: 'SW_START_RUN'; payload: RunManifest }
  | { type: 'SW_STOP_RUN' }
  | { type: 'SW_PAUSE_RUN' }
  | { type: 'SW_RESUME_RUN' }
  | { type: 'SW_RETRY_NODES'; payload: { nodeIds: string[]; nodes: SerializedNode[]; edges: SerializedEdge[] } }
  | { type: 'SW_GET_SNAPSHOT' };

/** Service Worker → Canvas broadcasts */
export type SwToCanvasMessage =
  | { type: 'SW_RUN_STATE'; payload: ExecutionSnapshot }
  | { type: 'SW_NODE_STATUS'; payload: NodeExecutionStatus }
  | { type: 'SW_RUN_COMPLETE'; payload: { runId: string; succeeded: number; failed: number; total: number } }
  | { type: 'SW_RUN_ERROR'; payload: { runId: string; error: string } }
  | { type: 'SW_SNAPSHOT'; payload: ExecutionSnapshot | null }
  | { type: 'SW_LAYOUT_REQUEST'; payload: { nodes: SerializedNode[]; edges: SerializedEdge[] } };

export function isCanvasToSwMessage(msg: unknown): msg is CanvasToSwMessage {
  return typeof msg === 'object' && msg !== null && 'type' in msg
    && typeof (msg as any).type === 'string'
    && (msg as any).type.startsWith('SW_');
}

/* ============================================================
   What the worker can actually run on its own

   The coordinator drives the execution loop inside the service worker so a
   run survives the Studio tab being closed. It can do that for exactly two
   node types, `generate` and `extend`, because those are the only two its
   buildConfig describes: a prompt, a platform, a model, an aspect ratio.
   Every type below needs the tab.

     motion  Motion Control cuts the source, asks the director and uploads
             the pieces. The cutting is done by a <video> and a canvas, and
             a service worker has neither — there is no DOM in it at all.
     agent   The multi-turn repair loop reads the canvas as it works and
             rewrites nodes between turns. Scheduled for v1.6.0.
     story   The Director produces no result of its own. It reads the nodes
             wired to its output, asks over several turns, and WRITES the
             prompt into each of them. From a worker there is nothing to
             write into: executeStoryNode is a canvas method that holds the
             store and the edges.
     chief   Plans across the connected Directors and checkpoints the plan
             back onto its own node between repair attempts. Same reason.
     clip    Five staged asks, each cached on the node, over a recording it
             demuxes with mediabunny — a browser media library.
     cut     Encodes footage with that same library. No platform is involved
             at all; it never reaches the bridge.

   This list is the ONE place that decides. It used to be decided twice:
   `isRunnableType` in the coordinator accepted 'motion', and the coordinator
   then threw when it reached one — so a Motion node in a delegated run went
   straight to "Did not start: motion node type requires Canvas presence in
   v1.5.0", and Retry did it again, because the retry took the same path.

   The runner's comment said such nodes "fall back to the local execution
   path", which was the right design and was never wired up: the delegate-or-
   not decision was made once for the whole run, before any node was looked
   at. Deciding it here, from the graph, is what makes that comment true.

   The first version of this list held only motion and agent, because those
   were the two the comment above it happened to name. That left the Director
   and the Chief delegated, and the coordinator has no branch for either: it
   sent the brief as one ordinary prompt and handed the reply straight back
   as node text. The storyboard came back WRITTEN — a wall of prose sitting
   on the Director, every shot node still empty, nothing marked red. Which is
   why it read as the Director having quietly stopped working rather than as
   a run that failed. The list is the whole fix; add a type here the moment
   the runner gives it an execute*Node method of its own.
   ============================================================ */

/** Node types that can only run with the Studio canvas present. */
export const CANVAS_ONLY_NODE_TYPES: readonly string[] = [
  'agent', 'motion', 'story', 'chief', 'clip', 'cut',
];

/** Does this node type need the Studio canvas — i.e. must the run stay local? */
export function needsCanvas(type: unknown): boolean {
  return CANVAS_ONLY_NODE_TYPES.includes(String(type || ''));
}

/**
 * Does this NODE need the canvas — its type, or what its settings make it.
 *
 * An Ask AI node is a generate node in text mode, so the type list cannot see
 * it, and it is the Director's failure over again. Wired to clips, the canvas
 * asks it for a JSON set, checks every shot, repairs a bad one in the same
 * thread and hands each clip its own (executeStoryboardAsk); alone, it wraps
 * the words in the node's preset and brief (composeAskRequest). The worker
 * has neither: it sent the bare prompt and gave every clip below the whole
 * reply. Claude is text-only, whatever mediaType the node carries.
 */
export function needsCanvasNode(node: { type?: unknown; data?: any } | undefined): boolean {
  if (!node) return false;
  if (needsCanvas(node.type)) return true;
  const d = node.data || {};
  return node.type === 'generate' && (d.mediaType === 'text' || d.platform === 'claude');
}
