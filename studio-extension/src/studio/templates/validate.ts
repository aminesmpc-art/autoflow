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
};

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
export const RENDERABLE_NODE_TYPES = ['prompt', 'image', 'generate', 'frame'] as const;

/** Platforms this build has an adapter for. */
export const SUPPORTED_PLATFORMS = ['flow', 'chatgpt', 'gemini'] as const;

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
