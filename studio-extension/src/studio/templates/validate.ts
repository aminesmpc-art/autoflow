/* ============================================================
   Template validation — one implementation, three callers.

   - templates.test.ts     build time, over everything bundled
   - scripts/publish-templates.js  before anything reaches the backend
   - loader.ts             runtime, over everything fetched

   Cloud delivery is why this had to stop being a test. A test protects what
   we compile; it protects nothing about a JSON payload that reaches every
   user seconds after it is pushed, with no store review in the way. Same
   rules, applied at every point a template can enter the app, so they cannot
   drift apart.

   Every check here exists because it caught something real.
   ============================================================ */

/** Ports each node type actually renders. Mirrors src/studio/nodes/. */
export const NODE_PORTS: Record<string, { in: string[]; out: string[] }> = {
  prompt: { in: [], out: ['text'] },
  image: { in: [], out: ['image'] },
  frame: { in: ['image_ref'], out: ['image'] },
  /* frame_start / frame_end are the Frames mode ports. Two named handles
     rather than one image_ref taking a list, because "which image is the
     first frame" cannot be answered by edge order — that is invisible on the
     canvas and changes when a connection is remade. */
  /* Every port a generate node can have in any mode. Not what any single node
     draws — portsFor picks the subset for the mode it is actually in. */
  generate: { in: ['text', 'image_ref', 'frame_start', 'frame_end'], out: ['result'] },
  // A prompt writer emits text rather than a result.
  'generate:text': { in: ['text', 'image_ref'], out: ['text'] },
  /* Frames mode swaps the one image port for the two frame ports. It is a
     swap rather than an addition: in this mode the runner reads only
     frame_start and frame_end, so leaving image_ref on the node would offer a
     socket that accepts a wire and then ignores it. The same argument runs
     the other way, which is why Ingredients has its own entry rather than
     falling back to the union — a plain image node drawing S and E would take
     a wire the runner never looks at. */
  'generate:ingredients': { in: ['text', 'image_ref'], out: ['result'] },
  'generate:frames': { in: ['text', 'frame_start', 'frame_end'], out: ['result'] },
  /* Grok's extend. A clip in, a prompt for what happens next, a longer clip
     out — so a second extend can chain from the first. `video` rather than
     `image_ref` because a still is exactly what this cannot take. */
  extend: { in: ['text', 'video'], out: ['result'] },
  /* The agent takes a goal and returns its final answer, so it wires exactly
     where an Ask AI node does — text in, text out. What happens between is a
     loop rather than one round trip, but nothing on the canvas needs to know
     that, and giving it a distinct port shape would make it un-swappable with
     the node it is meant to grow out of. */
  agent: { in: ['text'], out: ['text'] },
};

/**
 * Node types that actually execute.
 *
 * One list, because it was four scattered `type === 'generate'` checks and
 * they drifted the moment a new runnable type appeared: adding the agent left
 * the Run button disabled on a canvas made entirely of agents, the retry
 * filter unable to re-run one, and the runner's own step filter the only
 * place that knew. Prompt, image and frame carry data and never run.
 */
export const RUNNABLE_NODE_TYPES = ['generate', 'extend', 'agent'] as const;

export const isRunnableType = (type: unknown): boolean =>
  typeof type === 'string' && (RUNNABLE_NODE_TYPES as readonly string[]).includes(type);

/**
 * Whether a generate node's dropdowns put it in Start/End frames mode.
 *
 * Flow only — the slots are Flow's video composer. The platform check matters
 * because switching a node from Flow to ChatGPT leaves mediaType and
 * creationType behind in its data, and without it the node would draw S and E
 * ports on a platform that has no such thing.
 */
export const isFramesMode = (data: any): boolean =>
  (data?.platform || 'flow') === 'flow' &&
  data?.mediaType === 'video' &&
  data?.creationType === 'frames';

/**
 * The ports a node draws, given its current settings.
 *
 * GenerateNode renders its handles from this, and validateTemplate checks
 * edges against it, so the two cannot drift. They did drift once: the frame
 * ports were added here and to the runner but never to the node, so Frames
 * mode had no socket to plug into and every image landed on image_ref, where
 * the runner no longer looked. The node generated from the prompt alone.
 */
export const portsFor = (node: any) => {
  if (node?.type === 'generate') {
    if (node?.data?.mediaType === 'text') return NODE_PORTS['generate:text'];
    return NODE_PORTS[isFramesMode(node?.data) ? 'generate:frames' : 'generate:ingredients'];
  }
  return NODE_PORTS[node?.type];
};

/** Node types this build can actually draw — Canvas.tsx's nodeTypes map. */
export const RENDERABLE_NODE_TYPES = ['prompt', 'image', 'generate', 'frame', 'extend'] as const;

/* ── Grok's extend arithmetic ──────────────────────────────────
   Imagine starts a clip at 6, 10 or 15 seconds and extends it by 6 or 10,
   and the finished clip cannot pass 30. Those three facts together are why
   an extend node cannot just offer both steps: 15 + 10 + 10 is 35, and the
   third of those is a generation Imagine will not complete.

   So the node asks what is left rather than offering what exists. Kept here
   because the node, the validator and the runner each need the same answer,
   and three copies of a rule like this drift.
   ──────────────────────────────────────────────────────────── */

export const GROK_MAX_TOTAL_SECONDS = 30;
export const GROK_EXTEND_STEPS = ['+6s', '+10s'] as const;
/** 15 + 6 + 6 = 27 fits; a third extend cannot, from any starting length. */
export const GROK_MAX_EXTENDS = 2;

/** Seconds out of "10s", "+6s", 15 — anything the canvas might hold. */
export const secondsOf = (value: unknown): number =>
  parseInt(String(value ?? '').replace(/[^\d]/g, ''), 10) || 0;

export interface ExtendChain {
  /** Length of the clip before this node adds to it. */
  secondsBefore: number;
  /** This node's position in the chain, 1-based. */
  index: number;
  /** The Grok clip the chain starts from, if it starts from one. */
  rootId: string | null;
  /** Why this chain cannot run, in the user's terms. */
  problem: string | null;
}

/**
 * Walk back from an extend node to the clip it is lengthening.
 *
 * An extend is only meaningful against a Grok video — there is nothing to
 * continue on a Flow tile or a still — so the walk reports what it found
 * rather than assuming, and the node, the validator and the runner all read
 * the same verdict.
 */
export function extendChain(nodeId: string, nodes: any[], edges: any[]): ExtendChain {
  const byId = new Map((nodes || []).map((n: any) => [n.id, n]));
  const sourceOf = (id: string) =>
    (edges || []).find((e: any) => e.target === id && e.targetHandle === 'video')?.source;

  let steps = 0;
  let current = nodeId;
  const seen = new Set<string>([nodeId]);

  for (;;) {
    steps++;
    const parentId = sourceOf(current);
    if (!parentId) {
      return { secondsBefore: 0, index: steps, rootId: null,
        problem: 'Nothing to extend — connect this to a Grok video node' };
    }
    if (seen.has(parentId)) {
      return { secondsBefore: 0, index: steps, rootId: null, problem: 'These nodes form a loop' };
    }
    seen.add(parentId);

    const parent = byId.get(parentId);
    const data = parent?.data || {};

    if (parent?.type === 'extend') {
      current = parentId;
      continue;
    }

    if (parent?.type !== 'generate' || data.platform !== 'grok' || data.mediaType !== 'video') {
      return { secondsBefore: 0, index: steps, rootId: null,
        problem: 'Extend only continues a Grok video node' };
    }

    /* Sum the chain now that the root is known: the clip's own length plus
       every extend between it and here. */
    let total = secondsOf(data.duration || '10s');
    let walk = nodeId;
    const between: string[] = [];
    while (walk !== parentId) {
      const up = sourceOf(walk)!;
      if (up !== parentId) between.push(up);
      walk = up;
    }
    for (const id of between) total += secondsOf(byId.get(id)?.data?.extendSeconds || '+10s');

    const problem = steps > GROK_MAX_EXTENDS
      ? `Grok allows ${GROK_MAX_EXTENDS} extends; this is number ${steps}`
      : null;
    return { secondsBefore: total, index: steps, rootId: parentId, problem };
  }
}

/** The steps that still fit under the cap. Empty means the clip is full. */
export const affordableExtendSteps = (secondsBefore: number): string[] =>
  GROK_EXTEND_STEPS.filter((s) => secondsBefore + secondsOf(s) <= GROK_MAX_TOTAL_SECONDS);

/** Platforms this build has an adapter for. */
export const SUPPORTED_PLATFORMS = ['flow', 'chatgpt', 'gemini', 'grok'] as const;

/**
 * Problems with a template, as a list of human-readable strings.
 *
 * Empty means valid. Returns every problem rather than the first, so a bad
 * publish tells the author everything at once instead of one round-trip per
 * mistake.
 */
export function validateTemplate(tpl: any): string[] {
  const problems: string[] = [];
  const fail = (msg: string) => problems.push(msg);

  if (!tpl || typeof tpl !== 'object') return ['not an object'];
  if (!tpl.id) fail('missing id');
  if (!tpl.name) fail('missing name');
  if (!Array.isArray(tpl.nodes)) fail('nodes is not an array');
  if (!Array.isArray(tpl.edges)) fail('edges is not an array');
  if (problems.length) return problems;

  const byId = new Map<string, any>();
  for (const n of tpl.nodes) {
    if (!n?.id) { fail('a node has no id'); continue; }
    if (byId.has(n.id)) fail(`duplicate node id "${n.id}"`);
    byId.set(n.id, n);
    if (!portsFor(n)) fail(`node "${n.id}" has unknown type "${n.type}"`);
    if (!n.position || typeof n.position.x !== 'number' || typeof n.position.y !== 'number') {
      fail(`node "${n.id}" has no usable position`);
    }
  }

  // The card shows this number before the user commits to loading it.
  if (typeof tpl.nodeCount === 'number' && tpl.nodeCount !== tpl.nodes.length) {
    fail(`declares ${tpl.nodeCount} nodes but has ${tpl.nodes.length}`);
  }

  const edgeIds = new Set<string>();
  for (const e of tpl.edges) {
    if (!e?.id) { fail('an edge has no id'); continue; }
    if (edgeIds.has(e.id)) fail(`duplicate edge id "${e.id}"`);
    edgeIds.add(e.id);

    const source = byId.get(e.source);
    const target = byId.get(e.target);
    if (!source) { fail(`edge "${e.id}" starts at "${e.source}", which is not in this template`); continue; }
    if (!target) { fail(`edge "${e.id}" ends at "${e.target}", which is not in this template`); continue; }

    /* A wrong handle is an edge React Flow drops on render — the canvas looks
       fine and the node downstream generates with no input. `result` vs
       `image` has bitten twice. */
    const outs = portsFor(source)?.out || [];
    const ins = portsFor(target)?.in || [];
    if (!outs.includes(String(e.sourceHandle))) {
      fail(`edge "${e.id}" leaves "${e.source}" on "${e.sourceHandle}", which it does not have (has: ${outs.join(', ') || 'none'})`);
    }
    if (!ins.includes(String(e.targetHandle))) {
      fail(`edge "${e.id}" enters "${e.target}" on "${e.targetHandle}", which it does not have (has: ${ins.join(', ') || 'none'})`);
    }
  }

  // Two nodes at the same point read as one node the user cannot separate.
  const seen = new Set<string>();
  for (const n of tpl.nodes) {
    const at = `${n.position?.x},${n.position?.y}`;
    if (seen.has(at)) fail(`node "${n.id}" is stacked exactly on another at ${at}`);
    seen.add(at);
  }

  // A generate node with no text input submits an empty prompt to Flow.
  const hasText = new Set(
    tpl.edges.filter((e: any) => e.targetHandle === 'text').map((e: any) => e.target)
  );
  for (const n of tpl.nodes.filter((n: any) => n.type === 'generate')) {
    if (!hasText.has(n.id)) fail(`generate node "${n.id}" has no prompt connected`);
  }

  /* Extend continues a Grok clip and cannot pass 30 seconds. Both are checked
     here so a published template cannot ship a chain that spends two
     generations before Imagine refuses the third. */
  for (const n of tpl.nodes.filter((n: any) => n.type === 'extend')) {
    const chain = extendChain(n.id, tpl.nodes, tpl.edges);
    if (chain.problem) {
      fail(`extend node "${n.id}": ${chain.problem}`);
      continue;
    }
    const total = chain.secondsBefore + secondsOf(n.data?.extendSeconds || '+10s');
    if (total > GROK_MAX_TOTAL_SECONDS) {
      fail(`extend node "${n.id}" would make ${total}s, past Grok's ${GROK_MAX_TOTAL_SECONDS}s limit`);
    }
  }

  // A frame shows *the* last frame; two upstream clips make that a race.
  for (const n of tpl.nodes.filter((n: any) => n.type === 'frame')) {
    const incoming = tpl.edges.filter((e: any) => e.target === n.id);
    if (incoming.length !== 1) {
      fail(`frame node "${n.id}" has ${incoming.length} inputs, needs exactly 1`);
      continue;
    }
    const from = byId.get(incoming[0].source);
    if (from?.type !== 'generate' || from?.data?.mediaType !== 'video') {
      fail(`frame node "${n.id}" takes its frame from a ${from?.type || 'missing'} node, which produces no video`);
    }
  }

  /* A prompt has one reader and it is not the user. "↑ Change this line to any
     car" was written as a hint for whoever opened the template; ChatGPT could
     not tell it was not being spoken to, and returned a different car. */
  for (const n of tpl.nodes.filter((n: any) => n.type === 'prompt')) {
    const text: string = n.data?.text || '';
    if (/(change|edit|replace|swap) (this|the) (line|text)|↑ ?change|paste your|type your/i.test(text)) {
      fail(`prompt node "${n.id}" contains an instruction aimed at the user, which the model will read as its own`);
    }
  }

  return problems;
}

/**
 * Whether this build can render a template at all.
 *
 * Separate from validity on purpose: a template requiring Last Frame nodes is
 * perfectly valid, and simply undrawable by a build from before they existed.
 * That is a reason to hide it, not to call the payload broken.
 */
export function capabilityGap(
  tpl: any,
  build: { version: string; nodeTypes?: readonly string[]; platforms?: readonly string[] }
): string | null {
  const nodeTypes = build.nodeTypes || RENDERABLE_NODE_TYPES;
  const platforms = build.platforms || SUPPORTED_PLATFORMS;

  /* Declared requirements first, then the nodes themselves. The declaration is
     what lets a template say "needs frame" before this build has ever seen the
     word; scanning the nodes catches a template whose author forgot to. */
  const needTypes: string[] = Array.isArray(tpl.requiresNodeTypes)
    ? tpl.requiresNodeTypes
    : [];
  for (const t of [...needTypes, ...(tpl.nodes || []).map((n: any) => n.type)]) {
    if (t && !nodeTypes.includes(t)) return `needs the "${t}" node, which this version cannot draw`;
  }

  const needPlatforms: string[] = Array.isArray(tpl.requiresPlatforms)
    ? tpl.requiresPlatforms
    : [];
  for (const p of [...needPlatforms, ...(tpl.nodes || []).map((n: any) => n.data?.platform)]) {
    if (p && !platforms.includes(p)) return `needs the ${p} platform, which this version does not have`;
  }

  if (tpl.minExtensionVersion && compareVersions(build.version, tpl.minExtensionVersion) < 0) {
    return `needs version ${tpl.minExtensionVersion} or newer`;
  }
  return null;
}

/* ============================================================
   Moving wires when the mode changes.

   Switching FROM between Ingredients and Frames changes which ports the node
   draws. An edge pointing at a handle that is no longer rendered does not
   error and does not disappear from the file — React Flow simply stops
   drawing it, and the runner stops finding it. The canvas looks connected,
   the clip comes back built from the prompt alone, and nothing anywhere says
   why. So the wires move with the mode.
   ============================================================ */

const FRAME_HANDLES = ['frame_start', 'frame_end'];

/**
 * Re-point one node's image wires for the mode it is switching into.
 *
 * Into Frames: the first two image wires become Start and End, in the order
 * they were drawn. Any beyond the second are dropped — the mode takes exactly
 * two stills — and the count comes back so the caller can say so rather than
 * letting connections vanish quietly.
 *
 * Back to Ingredients: both frame wires become ordinary references. Nothing
 * is dropped; image_ref takes a list.
 */
export function retargetImagePorts(
  nodeId: string,
  edges: any[],
  toFrames: boolean
): { edges: any[]; dropped: number } {
  let slot = 0;
  let dropped = 0;

  const next: any[] = [];
  for (const e of edges) {
    if (e?.target !== nodeId) { next.push(e); continue; }

    if (toFrames && e.targetHandle === 'image_ref') {
      if (slot >= FRAME_HANDLES.length) { dropped++; continue; }
      next.push({ ...e, targetHandle: FRAME_HANDLES[slot++] });
      continue;
    }
    if (!toFrames && FRAME_HANDLES.includes(e.targetHandle)) {
      next.push({ ...e, targetHandle: 'image_ref' });
      continue;
    }
    next.push(e);
  }

  return { edges: next, dropped };
}

/**
 * The same repair, applied to a whole workflow as it loads.
 *
 * Saved workflows and published templates written before the frame ports
 * existed put their stills on image_ref with creationType already set to
 * frames. Opening one now would draw two empty sockets and no wires. Only
 * nodes that have no frame wiring at all are touched, so a workflow that was
 * built correctly is left exactly as it is.
 */
export function migrateFrameEdges(nodes: any[], edges: any[]): any[] {
  let out = edges;
  for (const n of nodes || []) {
    if (n?.type !== 'generate' || !isFramesMode(n.data)) continue;
    const mine = out.filter((e: any) => e?.target === n.id);
    if (mine.some((e: any) => FRAME_HANDLES.includes(e.targetHandle))) continue;
    if (!mine.some((e: any) => e.targetHandle === 'image_ref')) continue;
    out = retargetImagePorts(n.id, out, true).edges;
  }
  return out;
}

/** Numeric-segment compare. -1, 0, 1. Handles "0.9.0" vs "0.10.0" correctly. */
export function compareVersions(a: string, b: string): number {
  const pa = String(a || '0').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b || '0').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}
