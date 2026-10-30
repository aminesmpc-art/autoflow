/* ============================================================
   AutoFlow Studio — Zustand Store
   Central state management for the workflow builder.
   Persists workflows to chrome.storage.local.
   ============================================================ */

import { create } from 'zustand';
import type { Node, Edge } from '@xyflow/react';
import { applyNodeChanges, applyEdgeChanges } from '@xyflow/react';
import { hasVideoRefPort, isFramesMode, migrateFrameEdges, releaseVideoRef, retargetImagePorts } from './templates/validate';
import { MODEL_RENAMES } from '../types';
import { dropMedia, loadMedia, saveMedia } from './clip/vault';

/* ── Types ── */

export type NodeStatus = 'idle' | 'running' | 'done' | 'error';

/* Use Record for node data to avoid React Flow generic type conflicts */
export type StudioNodeData = Record<string, unknown>;

export interface WorkflowMeta {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
}

/* ── Views ── */

export type StudioView = 'gallery' | 'canvas';

/** How an open workflow is shown: as the graph, or as a form (Simple view,
    2026-10-30). Templates open as a form, a blank canvas and a saved
    workflow as the graph; the top bar switches between them. */
export type WorkMode = 'simple' | 'canvas';

/* ── Store ── */

interface StudioState {
  /* Navigation */
  view: StudioView;
  setView: (view: StudioView) => void;
  workMode: WorkMode;
  setWorkMode: (mode: WorkMode) => void;

  /* Workflow metadata */
  workflow: WorkflowMeta;
  setWorkflowName: (name: string) => void;

  /* React Flow state */
  nodes: Node[];
  edges: Edge[];
  setNodes: (nodes: Node[]) => void;
  setEdges: (edges: Edge[]) => void;
  removeEdge: (edgeId: string) => void;
  onNodesChange: (changes: any[]) => void;
  onEdgesChange: (changes: any[]) => void;

  /* Node CRUD */
  addNode: (node: Node) => void;
  removeNode: (nodeId: string) => void;
  duplicateNode: (nodeId: string) => void;
  updateNodeData: (nodeId: string, data: Record<string, unknown>) => void;

  /* Execution */
  isRunning: boolean;
  isPaused: boolean;
  currentNodeId: string | null;
  runProgress: { current: number; total: number };
  setRunning: (running: boolean) => void;
  /** Save because a run finished, even if this canvas was never saved. */
  persistAfterRun: () => Promise<void>;
  setPaused: (paused: boolean) => void;
  setCurrentNode: (nodeId: string | null) => void;
  setRunProgress: (current: number, total: number) => void;

  /* Selection */
  selectedNodeId: string | null;
  setSelectedNode: (nodeId: string | null) => void;

  /* Entitlements */
  isPro: boolean;
  runsUsed: number;
  loadEntitlements: () => Promise<void>;
  recordRun: () => Promise<void>;
  /** Sync the display counter from the server's authoritative count */
  setRunsUsed: (n: number) => void;
  /** null when allowed, otherwise a human-readable reason */
  runBlockedReason: () => string | null;
  canAddNode: () => boolean;

  /* Persistence */
  isDirty: boolean;
  saveState: 'idle' | 'saving' | 'saved' | 'error';
  saveError: string | null;
  savedWorkflows: SavedWorkflowMeta[];
  saveWorkflow: () => Promise<boolean>;
  loadWorkflow: (id: string) => Promise<void>;
  loadLastWorkflow: () => Promise<void>;
  listWorkflows: () => Promise<SavedWorkflowMeta[]>;
  deleteWorkflow: (id: string) => Promise<void>;
  newWorkflow: () => void;
  exportWorkflow: () => void;
  importWorkflow: (file: File) => Promise<void>;
}

/** Free-tier ceilings. Pro is unlimited. */
/* Free is ten runs, and build whatever you like.
   `nodes: 0` means no cap. The five-node ceiling punished exactly the
   workflows this product exists for — every template worth seeing has more
   than five nodes, so a free user could never watch one work, which is a
   strange way to sell the thing that makes them work. The server agrees:
   FREE_STUDIO_MAX_NODES is 0 there too, and it is the authoritative gate. */
/* Studio WORKFLOW RUNS per month. Not the Flow extension's daily prompt
   allowance, which is a different product and a different number —
   FREE_TEXT_DAILY_LIMIT, fifty — and confusing the two is how this briefly
   became fifty by mistake.

   Must match FREE_STUDIO_MONTHLY_LIMIT in apps/plans/services.py. There are
   three copies — here, the side panel, and the server — and they have drifted
   for real: the panel promised fifteen while the server stopped free accounts
   at ten, so a user was refused five runs before the figure in front of them
   said they would be. freeLimit.test.ts checks all three against the server,
   which is the only authority. */
export const FREE_LIMITS = { nodes: 10, runsPerMonth: 10 } as const;

/** Runs are counted per calendar month, keyed so a new month resets itself */
const runKey = () => `studio_runs_${new Date().toISOString().slice(0, 7)}`;

export interface SavedWorkflowMeta {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  nodeCount: number;
}

const STORAGE_PREFIX = 'studio_workflow_';

/**
 * Runtime fields written by the runner during a run. Changes limited to these
 * must not mark the workflow dirty or trigger autosave — otherwise every
 * progress tick would thrash storage and persist mid-run state.
 */
const RUNTIME_KEYS = new Set([
  'status', 'progress', 'previewUrl', 'previewVideoUrl',
  'resultUrl', 'resultTileId', 'errorMessage', 'resultText',
  'lastFrameUrl', 'sentPrompt',
]);

/**
 * Strip run results before persisting.
 *
 * Keeps everything the user authored (prompts, uploaded images, model and
 * ratio settings) and drops everything a run produced. Two reasons: captured
 * previews are base64 data URLs that would balloon the stored payload, and a
 * reloaded workflow showing "done" nodes with last week's images is
 * misleading — it should open ready to run.
 */
function stripResults(nodes: Node[]): Node[] {
  return nodes.map((n) => {
    const d = n.data as any;
    if (d?.type !== 'generate') return n;
    return {
      ...n,
      data: {
        ...d,
        status: 'idle',
        progress: 0,
        previewUrl: '',
        previewVideoUrl: '',
        resultUrl: null,
        resultTileId: null,
        resultText: '',
        lastFrameUrl: '',
        sentPrompt: '',
        errorMessage: null,
      },
    };
  });
}

/* ── Keeping saves small ──
   "please make the tool not slow becouse the panal get glitch and samtims stop"

   Two things made every save heavy. Measured on the built Motion panel with
   five saved projects of six 4MB clips each, storage faked in memory (a lower
   bound — real chrome.storage also crosses a process):
   - listWorkflows() read ALL of storage, get(null), after every save just to
     list names: 150–380ms frozen each time.
   - media was saved inline as data: URLs, so each save rewrote 28MB, every
     5s in a run: finished clips (up to 15MB each, content/flow/index.ts),
     subject, place and replacement photos (up to 10MB each), ending frames,
     and the image nodes that carry the same photos again.
   The list now comes from a small index, and any large data: URL lives in
   the IndexedDB vault with only a reference in the saved workflow. In memory
   nothing changes: the data URLs are still there. */
const INDEX_KEY = 'studio_index_workflows';

const metaOf = (w: any): SavedWorkflowMeta => ({
  id: w.id, name: w.name || 'Untitled', createdAt: w.createdAt || 0, updatedAt: w.updatedAt || 0,
  nodeCount: (w.nodes || []).length,
});
const sortMeta = (index: Record<string, SavedWorkflowMeta>): SavedWorkflowMeta[] =>
  Object.values(index).sort((a, b) => b.updatedAt - a.updatedAt);

async function readIndex(): Promise<Record<string, SavedWorkflowMeta>> {
  const got = await chrome.storage.local.get(INDEX_KEY);
  let index: Record<string, SavedWorkflowMeta> | undefined = got?.[INDEX_KEY];
  if (!index) {
    // Once, for workflows saved before the index: the only full read left.
    const all = await chrome.storage.local.get(null);
    index = {};
    for (const [key, w] of Object.entries(all || {})) {
      if (key.startsWith(STORAGE_PREFIX) && (w as any)?.id) index[(w as any).id] = metaOf(w);
    }
    await chrome.storage.local.set({ [INDEX_KEY]: index });
    return index;
  }
  /* Heal against the keys actually stored, without reading their values
     (getKeys, Chrome 130+): another document of the same extension may have
     saved or deleted since this index was written. */
  const local = chrome.storage.local as any;
  if (typeof local.getKeys === 'function') {
    const ids = new Set(((await local.getKeys()) as string[])
      .filter((k) => k.startsWith(STORAGE_PREFIX)).map((k) => k.slice(STORAGE_PREFIX.length)));
    let changed = false;
    for (const id of Object.keys(index)) if (!ids.has(id)) { delete index[id]; changed = true; }
    const missing = [...ids].filter((id) => !index![id]);
    if (missing.length) {
      const found = await chrome.storage.local.get(missing.map((id) => `${STORAGE_PREFIX}${id}`));
      for (const w of Object.values(found || {})) if ((w as any)?.id) { index[(w as any).id] = metaOf(w); changed = true; }
    }
    if (changed) await chrome.storage.local.set({ [INDEX_KEY]: index });
  }
  return index;
}

/* Only large, canonical base64 data URLs move: rebuilt from the header kept
   in the reference, they come back as the identical string, so fingerprints
   built from them (Motion's configuration) still match after a reopen. */
const VAULT_MIN = 256 * 1024;
const DATA_URL = /^data:([\w.+-]+\/[\w.+-]+);base64,/;
const VAULT_REF = /^vault:(wf:[^|]+)\|([\w.+-]+\/[\w.+-]+)$/;
const mediaPrefix = (workflowId: string) => `wf:${workflowId}:`;

/* What the vault already holds under each key, so unchanged media is not
   written again on every save. */
const vaulted = new Map<string, string>();
const printOf = (url: string) => `${url.length}:${url.slice(-64)}`;
/* The decoded size of a base64 data URL, without copying the payload. */
const bytesOf = (url: string) => Math.floor((url.length - url.indexOf(',') - 1) * 3 / 4)
  - (url.endsWith('==') ? 2 : url.endsWith('=') ? 1 : 0);

async function base64Of(blob: Blob): Promise<string> {
  if (typeof FileReader !== 'undefined') {
    const url = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
    return url.slice(url.indexOf(',') + 1);
  }
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}

/** Every node's data, with each string passed through `swap`. */
async function mapStrings(value: any, path: string, swap: (s: string, path: string) => Promise<any>): Promise<any> {
  if (typeof value === 'string') return swap(value, path);
  if (Array.isArray(value)) {
    const out = [];
    for (let i = 0; i < value.length; i++) out.push(await mapStrings(value[i], `${path}.${i}`, swap));
    return out;
  }
  if (value && typeof value === 'object') {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(value)) out[k] = await mapStrings(v, path ? `${path}.${k}` : k, swap);
    return out;
  }
  return value;
}

/** The workflow as saved: large media moved into the vault. */
async function mediaOut(nodes: Node[], workflowId: string): Promise<Node[]> {
  return Promise.all(nodes.map(async (n) => ({
    ...n,
    data: await mapStrings(n.data, '', async (url, path) => {
      const head = url.length >= VAULT_MIN ? DATA_URL.exec(url) : null;
      if (!head) return url;
      const key = `${mediaPrefix(workflowId)}${n.id}:${path}`;
      const print = printOf(url);
      /* Remembered AND still there: the vault evicts for room, and a
         reference to evicted media would lose it on the next open. Reading
         the record gives a Blob handle, not the bytes, so this is cheap. */
      const held = vaulted.get(key) === print && (await loadMedia(key))?.size === bytesOf(url);
      if (!held) {
        let blob: Blob;
        try { blob = await (await fetch(url)).blob(); } catch { return url; }
        // The vault refused: keep it in the workflow rather than lose it.
        if (!await saveMedia(key, blob)) return url;
        vaulted.set(key, print);
      }
      return `vault:${key}|${head[1]}`;
    }),
  })));
}

/** The workflow as used: vault references turned back into data URLs. */
async function mediaIn(nodes: Node[]): Promise<Node[]> {
  return Promise.all(nodes.map(async (n) => ({
    ...n,
    data: await mapStrings(n.data, '', async (value) => {
      const ref = value.startsWith('vault:') ? VAULT_REF.exec(value) : null;
      if (!ref) return value;
      const blob = await loadMedia(ref[1]);
      // Evicted for room. A clip is still in Flow; a photo needs adding again.
      if (!blob) return '';
      const url = `data:${ref[2]};base64,${await base64Of(blob)}`;
      vaulted.set(ref[1], printOf(url));
      return url;
    }),
  })));
}

function generateId(): string {
  return `wf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/* ── Workflow normalization ──
   Saved workflows and older templates carry stale shapes: slug model
   names that never match Flow's rendered labels, smoothstep edges from
   the previous design, and generate nodes missing enabled/previewUrl.
   Every load path runs through here so old data can't resurrect old bugs. */
/* One source of truth, in types/index.ts, because the adapter needs the same
   answer this does. The entry here used to point the other way — 'Omni 1.1
   Flash' was rewritten BACK to 'Omni Flash' on every load, which quietly
   undid the rename for anyone who had already saved the new name. */
const MODEL_SLUGS: Record<string, string> = MODEL_RENAMES;

/**
 * Turn bundled asset paths into data URLs.
 *
 * Templates can ship a reference image as a packaged file rather than inline
 * base64, which keeps the JS bundle small. The reference pipeline needs a data
 * URL (that is what gets registered and uploaded to Flow), so resolve here at
 * load time. Failures are swallowed: the node simply stays empty and the user
 * can upload their own, which is better than refusing to open the template.
 */
export async function resolveAssets(nodes: Node[]): Promise<Node[]> {
  const pending = nodes.filter((n) => {
    const d = n.data as any;
    return d?.type === 'image' && d.assetPath && !d.imageData;
  });
  if (pending.length === 0) return nodes;

  const resolved = new Map<string, string>();
  await Promise.all(pending.map(async (n) => {
    const p = (n.data as any).assetPath as string;
    if (resolved.has(p)) return;
    try {
      const res = await fetch(chrome.runtime.getURL(p));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const dataUrl = await new Promise<string>((ok, no) => {
        const r = new FileReader();
        r.onloadend = () => ok((r.result as string) || '');
        r.onerror = () => no(new Error('read failed'));
        r.readAsDataURL(blob);
      });
      resolved.set(p, dataUrl);
    } catch (e) {
      console.warn(`[Studio] Could not load bundled asset ${p}:`, e);
    }
  }));

  return nodes.map((n) => {
    const d = n.data as any;
    const url = d?.assetPath && resolved.get(d.assetPath);
    if (!url) return n;
    return { ...n, data: { ...d, imageData: url, imageName: d.imageName || 'reference' } };
  });
}

/**
 * A saved workflow's graph, without opening it. The Community composer posts
 * one straight from My Workflows, and opening it would replace whatever is on
 * the canvas. Media comes back from the vault exactly as on open, so "include
 * my images" has the pictures to include.
 */
export async function readSavedWorkflow(id: string): Promise<{ name: string; nodes: Node[]; edges: Edge[] } | null> {
  const key = `${STORAGE_PREFIX}${id}`;
  const data = (await chrome.storage.local.get(key))[key];
  if (!data) return null;
  const normalized = normalizeWorkflow(data.nodes || [], data.edges || []);
  return { name: data.name || 'Untitled', nodes: await mediaIn(normalized.nodes), edges: normalized.edges };
}

export function normalizeWorkflow(nodes: Node[], edges: Edge[]): { nodes: Node[]; edges: Edge[] } {
  const normNodes = nodes.map((node) => {
    const d: any = { ...(node.data as any) };
    if (d.type === 'generate') {
      if (typeof d.model === 'string' && MODEL_SLUGS[d.model]) d.model = MODEL_SLUGS[d.model];
      if (d.enabled === undefined) d.enabled = true;
      if (d.previewUrl === undefined) d.previewUrl = '';
    }
    return { ...node, data: d };
  });
  /* Frames-mode nodes saved before the Start/End ports existed put their
     stills on image_ref. Opening one now would draw two empty sockets and no
     wires, and generate from the prompt alone. Both loaders come through
     here, so the repair belongs here rather than at each call site. */
  const normEdges = migrateFrameEdges(normNodes, edges).map((edge) => ({
    ...edge,
    type: 'deletable',
    animated: true,
    style: { stroke: '#8b5cf6', strokeWidth: 2.5 },
  }));
  return { nodes: normNodes, edges: normEdges };
}

export const useStudioStore = create<StudioState>((set, get) => ({
  /* ── Navigation ── */
  view: 'gallery',
  setView: (view) => set({ view }),
  workMode: 'canvas',
  setWorkMode: (workMode) => set({ workMode }),

  /* ── Workflow ── */
  workflow: {
    id: generateId(),
    name: `New Workflow - ${new Date().toLocaleDateString()}`,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  setWorkflowName: (name) =>
    set((s) => ({ workflow: { ...s.workflow, name, updatedAt: Date.now() } })),

  /* ── React Flow ── */
  nodes: [],
  edges: [],
  setNodes: (nodes) => set({ nodes }),
  setEdges: (edges) => { set({ edges }); touch(); },
  onNodesChange: (changes) => {
    // Apply React Flow node changes (position, selection, removal)
    set((s) => ({ nodes: applyNodeChanges(changes, s.nodes) }));
    // Selection-only changes aren't edits — they'd mark every click dirty
    if (changes.some((c: any) => c.type !== 'select')) touch();
  },
  onEdgesChange: (changes) => {
    set((s) => ({ edges: applyEdgeChanges(changes, s.edges) }));
    if (changes.some((c: any) => c.type !== 'select')) touch();
  },
  removeEdge: (edgeId) => {
    set((s) => ({ edges: s.edges.filter((e) => e.id !== edgeId) }));
    touch();
  },

  /* ── Node CRUD ── */
  addNode: (node) => { set((s) => ({ nodes: [...s.nodes, node] })); touch(); },
  removeNode: (nodeId) => {
    set((s) => ({
      nodes: s.nodes.filter((n) => n.id !== nodeId),
      edges: s.edges.filter((e) => e.source !== nodeId && e.target !== nodeId),
    }));
    touch();
  },
  duplicateNode: (nodeId) => {
    set((s) => {
      const src = s.nodes.find((n) => n.id === nodeId);
      if (!src) return s;
      const copy: Node = {
        ...src,
        id: `${src.type || 'node'}_${Date.now()}`,
        position: { x: src.position.x + 60, y: src.position.y + 60 },
        selected: false,
        // A copy has not run yet — carry the config, drop the result
        data: { ...src.data, status: 'idle', progress: 0, previewUrl: '', resultUrl: '', resultTileId: null, lastFrameUrl: '', sentPrompt: '', errorMessage: null },
      };
      return { nodes: [...s.nodes, copy] };
    });
    touch();
  },
  updateNodeData: (nodeId, data) => {
    set((s) => {
      const node = s.nodes.find(n => n.id === nodeId);
      const nextData = { ...node?.data, ...data };
      const changedFrames = node?.type === 'generate'
        && isFramesMode(node.data) !== isFramesMode(nextData);
      // Leaving the one mode with a V port: its clip wire goes to image_ref first.
      const lostVideoRef = node?.type === 'generate'
        && hasVideoRefPort(node.data) && !hasVideoRefPort(nextData);
      const edges = lostVideoRef ? releaseVideoRef(nodeId, s.edges) : s.edges;
      const moved = changedFrames ? retargetImagePorts(nodeId, edges, isFramesMode(nextData)) : null;
      if (moved) nextData.framesNotice = moved.dropped
        ? `${moved.dropped} extra image connection${moved.dropped > 1 ? 's' : ''} removed — Frames uses two.` : '';
      return {
        nodes: s.nodes.map(n => n.id === nodeId ? { ...n, data: nextData } : n),
        ...(moved ? { edges: moved.edges } : lostVideoRef ? { edges } : {}),
      };
    });
    // Runner status/progress writes are not user edits
    if (Object.keys(data).some((k) => !RUNTIME_KEYS.has(k))) touch();
  },

  /* ── Execution ── */
  isRunning: false,
  isPaused: false,
  currentNodeId: null,
  runProgress: { current: 0, total: 0 },
  setRunning: (running) => set({ isRunning: running }),

  /**
   * Write the workflow down because a run just finished.
   *
   * Autosave deliberately ignores a canvas that has never been saved by
   * hand, so scratch workspaces do not pile up in storage. That is right
   * for a canvas somebody was poking at and wrong for one that has just
   * spent ten minutes reading a video, ranking it and cutting nine clips.
   * A finished run is the strongest possible evidence the work is worth
   * keeping, so this saves regardless of whether the workflow was known.
   *
   * Everything a run produces is node data — the stages, the reading, the
   * boundaries, the caption phrases — so writing the nodes writes the run.
   * The clips and the source live in the vault beside it.
   */
  persistAfterRun: async () => {
    const s = get();
    if (!s.nodes.length) return;
    await s.saveWorkflow();
  },
  setPaused: (paused) => set({ isPaused: paused }),
  setCurrentNode: (nodeId) => set({ currentNodeId: nodeId }),
  setRunProgress: (current, total) => set({ runProgress: { current, total } }),

  /* ── Selection ── */
  selectedNodeId: null,
  setSelectedNode: (nodeId) => set({ selectedNodeId: nodeId }),

  /* ── Entitlements ── */
  isPro: false,
  runsUsed: 0,

  /**
   * Work out whether this account is Pro.
   *
   * Cache first so the topbar does not flash "Free" on every open, then ask
   * the server, which is the authority, and write the answer back.
   *
   * The fetch is the important half. This used to read af_cached_profile and
   * stop — a key the AutoFlow sidepanel writes and nothing in this extension
   * ever does. Storage is per-extension, so the cache was always empty here
   * and a paying customer was shown Free limits, an Upgrade button, and a cap
   * of 5 nodes no matter what they had paid for.
   */
  loadEntitlements: async () => {
    const key = runKey();

    try {
      const r = await chrome.storage.local.get(['af_cached_profile', key]);
      set({
        runsUsed: r?.[key] || 0,
        // Only trust the cache upward. Absent cache means unknown, not free.
        ...(r?.af_cached_profile ? { isPro: !!r.af_cached_profile.is_pro_active } : {}),
      });
    } catch {
      // Storage unreadable — keep whatever we already had rather than
      // downgrading someone already recognised as Pro.
    }

    try {
      const { getProfile } = await import('../shared/api');
      const profile = await getProfile();
      if (profile) {
        set({ isPro: !!profile.is_pro_active });
        await chrome.storage.local.set({ af_cached_profile: profile });
      }
    } catch {
      // Offline or signed out — the cached value stands.
    }
  },

  recordRun: async () => {
    const key = runKey();
    const next = get().runsUsed + 1;
    set({ runsUsed: next });
    try { await chrome.storage.local.set({ [key]: next }); } catch { /* non-critical */ }
  },

  setRunsUsed: (n) => {
    set({ runsUsed: n });
    try { chrome.storage.local.set({ [runKey()]: n }).catch(() => {}); } catch { /* non-critical */ }
  },

  runBlockedReason: () => {
    const { isPro, runsUsed, nodes } = get();
    if (isPro) return null;
    if (FREE_LIMITS.nodes && nodes.length > FREE_LIMITS.nodes) {
      return `This workflow has ${nodes.length} nodes. Free runs up to ${FREE_LIMITS.nodes} — upgrade to Pro for unlimited.`;
    }
    if (runsUsed >= FREE_LIMITS.runsPerMonth) {
      return `You've used all ${FREE_LIMITS.runsPerMonth} free runs this month. Upgrade to Pro for unlimited runs.`;
    }
    return null;
  },

  canAddNode: () => {
    const { isPro, nodes } = get();
    // 0 means no cap, so a free user builds whatever the story needs.
    if (isPro || !FREE_LIMITS.nodes) return true;
    return nodes.length < FREE_LIMITS.nodes;
  },

  /* ── Persistence ── */
  isDirty: false,
  saveState: 'idle',
  saveError: null,
  savedWorkflows: [],

  /* One save at a time. Moving clips into the vault makes a save take a
     moment, and two overlapping ones could land out of order — an older
     snapshot written over a newer one. Each queued save reads the state when
     it starts, so the last one always writes the latest. */
  saveWorkflow: (() => {
    let chain: Promise<unknown> = Promise.resolve();
    const saveNow = async (): Promise<boolean> => {
      const { workflow, nodes, edges } = get();
      if (nodes.length === 0) return false; // nothing worth storing
      set({ saveState: 'saving', saveError: null });

      try {
        const data = {
          ...workflow,
          updatedAt: Date.now(),
          nodes: await mediaOut(stripResults(nodes), workflow.id),
          edges,
        };
        let index: Record<string, SavedWorkflowMeta> | null = null;
        try { index = await readIndex(); index[workflow.id] = metaOf(data); } catch { index = null; }
        await chrome.storage.local.set({
          [`${STORAGE_PREFIX}${workflow.id}`]: data,
          studio_last_workflow_id: workflow.id,
          ...(index ? { [INDEX_KEY]: index } : {}),
        });
        /* Changes made while this was saving are not in it, so they stay dirty. */
        const now = get();
        set({
          ...(now.nodes === nodes && now.edges === edges ? { isDirty: false } : {}),
          saveState: 'saved',
          ...(now.workflow.id === workflow.id ? { workflow: { ...now.workflow, updatedAt: data.updatedAt } } : {}),
          ...(index ? { savedWorkflows: sortMeta(index) } : {}),
        });
        setTimeout(() => {
          if (get().saveState === 'saved') set({ saveState: 'idle' });
        }, 2000);
        return true;
      } catch (e: any) {
        // Quota is the realistic failure: uploaded reference images are stored
        // as base64. Surface it instead of the old silent console.error.
        const quota = /quota/i.test(e?.message || '');
        console.error('[Studio] Failed to save workflow:', e);
        set({
          saveState: 'error',
          saveError: quota
            ? 'Storage full — delete old workflows in My Workflows'
            : e?.message || 'Save failed',
        });
        return false;
      }
    };
    return () => {
      const next = chain.then(saveNow, saveNow);
      chain = next;
      return next;
    };
  })(),

  loadWorkflow: async (id) => {
    try {
      const key = `${STORAGE_PREFIX}${id}`;
      const result = await chrome.storage.local.get(key);
      const data = result[key];
      if (!data) return;
      const normalized = normalizeWorkflow(data.nodes || [], data.edges || []);
      const nodes = await mediaIn(normalized.nodes);
      const { edges } = normalized;
      set({
        workflow: { id: data.id, name: data.name, createdAt: data.createdAt, updatedAt: data.updatedAt },
        nodes,
        edges,
        view: 'canvas',
        /* Your own saved work opens as the graph you built. */
        workMode: 'canvas',
        isDirty: false,
        saveState: 'idle',
      });
      await chrome.storage.local.set({ studio_last_workflow_id: id });
    } catch (e) {
      console.error('[Studio] Failed to load workflow:', e);
    }
  },

  loadLastWorkflow: async () => {
    try {
      const result = await chrome.storage.local.get('studio_last_workflow_id');
      const lastId = result.studio_last_workflow_id;
      if (lastId) await get().loadWorkflow(lastId);
    } catch (e) {
      console.error('[Studio] Failed to load last workflow:', e);
    }
  },

  listWorkflows: async () => {
    try {
      const list = sortMeta(await readIndex());
      set({ savedWorkflows: list });
      return list;
    } catch (e) {
      console.error('[Studio] Failed to list workflows:', e);
      return [];
    }
  },

  deleteWorkflow: async (id) => {
    try {
      await chrome.storage.local.remove(`${STORAGE_PREFIX}${id}`);
      try {
        const index = await readIndex();
        if (index[id]) { delete index[id]; await chrome.storage.local.set({ [INDEX_KEY]: index }); }
      } catch { /* the next list heals it */ }
      for (const key of [...vaulted.keys()]) if (key.startsWith(mediaPrefix(id))) vaulted.delete(key);
      void dropMedia(mediaPrefix(id));
      await get().listWorkflows();
    } catch (e) {
      console.error('[Studio] Failed to delete workflow:', e);
    }
  },

  newWorkflow: () => {
    set({
      workflow: {
        id: generateId(),
        name: `New Workflow - ${new Date().toLocaleDateString()}`,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      nodes: [],
      edges: [],
      isDirty: false,
      saveState: 'idle',
    });
  },

  exportWorkflow: () => {
    const { workflow, nodes, edges } = get();
    const payload = {
      autoflowStudio: 1, // format marker so import can reject foreign JSON
      name: workflow.name,
      exportedAt: new Date().toISOString(),
      nodes: stripResults(nodes),
      edges,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${workflow.name.replace(/[^\w\-]+/g, '_') || 'workflow'}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },

  importWorkflow: async (file) => {
    const text = await file.text();
    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error('That file is not valid JSON');
    }
    if (!Array.isArray(data?.nodes) || !Array.isArray(data?.edges)) {
      throw new Error('That JSON is not an AutoFlow Studio workflow');
    }
    const { nodes, edges } = normalizeWorkflow(data.nodes, data.edges);
    set({
      workflow: {
        id: generateId(), // never overwrite an existing saved workflow
        name: data.name || file.name.replace(/\.json$/i, ''),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      nodes,
      edges,
      view: 'canvas',
      isDirty: true,
      saveState: 'idle',
    });
    /* Persist immediately. Autosave deliberately skips workflows it has never
       seen saved (see scheduleAutosave), and an import is exactly that — so
       without this the file the user just picked sits on the canvas, unsaved,
       missing from My Workflows, and gone on the next reload with no warning.
       Importing something is a clear enough statement that they want to keep
       it. */
    await get().saveWorkflow();
  },
}));

/* ── Autosave ──
   Debounced so a burst of drags writes once. Only fires for workflows that
   have already been saved manually at least once, so scratch canvases don't
   silently accumulate in storage. */
let autosaveTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleAutosave(): void {
  if (autosaveTimer) clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(async () => {
    const s = useStudioStore.getState();
    if (!s.isDirty || s.nodes.length === 0) return;

    /* A run in progress is a reason to WAIT, not to give up.
       This used to return here, and returning armed nothing else — so the
       timer that fired during a run was the LAST one. Every node update
       afterwards happened inside the run, the run ended without touching
       anything, and a finished clipping job was never written down. Reopening
       the workflow then showed nothing and asked for the whole thing again. */
    if (s.isRunning) { scheduleAutosave(); return; }

    const known = s.savedWorkflows.some((w) => w.id === s.workflow.id);
    if (!known) return;
    await s.saveWorkflow();
  }, 2000);
}

/** Mark the workflow edited and queue an autosave */
function touch(): void {
  if (!useStudioStore.getState().isDirty) useStudioStore.setState({ isDirty: true });
  scheduleAutosave();
}
