/* ============================================================
   AutoFlow Studio — Zustand Store
   Central state management for the workflow builder.
   Persists workflows to chrome.storage.local.
   ============================================================ */

import { create } from 'zustand';
import type { Node, Edge } from '@xyflow/react';
import { applyNodeChanges, applyEdgeChanges } from '@xyflow/react';
import { migrateFrameEdges } from './templates/validate';

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

/* ── Store ── */

interface StudioState {
  /* Navigation */
  view: StudioView;
  setView: (view: StudioView) => void;

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
        errorMessage: null,
      },
    };
  });
}

function generateId(): string {
  return `wf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/* ── Workflow normalization ──
   Saved workflows and older templates carry stale shapes: slug model
   names that never match Flow's rendered labels, smoothstep edges from
   the previous design, and generate nodes missing enabled/previewUrl.
   Every load path runs through here so old data can't resurrect old bugs. */
const MODEL_SLUGS: Record<string, string> = {
  'nano-banana-2': 'Nano Banana Pro',
  'omni-flash': 'Omni Flash',
};

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
        data: { ...src.data, status: 'idle', progress: 0, previewUrl: '', resultUrl: '', resultTileId: null, errorMessage: null },
      };
      return { nodes: [...s.nodes, copy] };
    });
    touch();
  },
  updateNodeData: (nodeId, data) => {
    set((s) => ({
      nodes: s.nodes.map((n) =>
        n.id === nodeId ? { ...n, data: { ...n.data, ...data } } : n
      ),
    }));
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

  saveWorkflow: async () => {
    const { workflow, nodes, edges } = get();
    if (nodes.length === 0) return false; // nothing worth storing
    set({ saveState: 'saving', saveError: null });

    const data = {
      ...workflow,
      updatedAt: Date.now(),
      nodes: stripResults(nodes),
      edges,
    };
    try {
      await chrome.storage.local.set({
        [`${STORAGE_PREFIX}${workflow.id}`]: data,
        studio_last_workflow_id: workflow.id,
      });
      set({
        isDirty: false,
        saveState: 'saved',
        workflow: { ...workflow, updatedAt: data.updatedAt },
      });
      get().listWorkflows();
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
  },

  loadWorkflow: async (id) => {
    try {
      const key = `${STORAGE_PREFIX}${id}`;
      const result = await chrome.storage.local.get(key);
      const data = result[key];
      if (!data) return;
      const { nodes, edges } = normalizeWorkflow(data.nodes || [], data.edges || []);
      set({
        workflow: { id: data.id, name: data.name, createdAt: data.createdAt, updatedAt: data.updatedAt },
        nodes,
        edges,
        view: 'canvas',
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
      const all = await chrome.storage.local.get(null);
      const list: SavedWorkflowMeta[] = Object.keys(all)
        .filter((k) => k.startsWith(STORAGE_PREFIX))
        .map((k) => all[k])
        .filter((w) => w && w.id)
        .map((w) => ({
          id: w.id,
          name: w.name || 'Untitled',
          createdAt: w.createdAt || 0,
          updatedAt: w.updatedAt || 0,
          nodeCount: (w.nodes || []).length,
        }))
        .sort((a, b) => b.updatedAt - a.updatedAt);
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
