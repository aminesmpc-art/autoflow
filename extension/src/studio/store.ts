/* ============================================================
   AutoFlow Studio — Zustand Store
   Central state management for the workflow builder.
   Persists workflows to chrome.storage.local.
   ============================================================ */

import { create } from 'zustand';
import type { Node, Edge } from '@xyflow/react';
import { applyNodeChanges, applyEdgeChanges } from '@xyflow/react';

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
  onNodesChange: (changes: any[]) => void;
  onEdgesChange: (changes: any[]) => void;

  /* Node CRUD */
  addNode: (node: Node) => void;
  removeNode: (nodeId: string) => void;
  updateNodeData: (nodeId: string, data: Record<string, unknown>) => void;

  /* Execution */
  isRunning: boolean;
  isPaused: boolean;
  currentNodeId: string | null;
  runProgress: { current: number; total: number };
  setRunning: (running: boolean) => void;
  setPaused: (paused: boolean) => void;
  setCurrentNode: (nodeId: string | null) => void;
  setRunProgress: (current: number, total: number) => void;

  /* Selection */
  selectedNodeId: string | null;
  setSelectedNode: (nodeId: string | null) => void;

  /* Persistence */
  saveWorkflow: () => Promise<void>;
  loadWorkflow: (id: string) => Promise<void>;
  loadLastWorkflow: () => Promise<void>;
}

function generateId(): string {
  return `wf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
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
  setEdges: (edges) => set({ edges }),
  onNodesChange: (changes) => {
    // Apply React Flow node changes (position, selection, removal)
    set((s) => ({ nodes: applyNodeChanges(changes, s.nodes) }));
  },
  onEdgesChange: (changes) => {
    set((s) => ({ edges: applyEdgeChanges(changes, s.edges) }));
  },

  /* ── Node CRUD ── */
  addNode: (node) => set((s) => ({ nodes: [...s.nodes, node] })),
  removeNode: (nodeId) =>
    set((s) => ({
      nodes: s.nodes.filter((n) => n.id !== nodeId),
      edges: s.edges.filter((e) => e.source !== nodeId && e.target !== nodeId),
    })),
  updateNodeData: (nodeId, data) =>
    set((s) => ({
      nodes: s.nodes.map((n) =>
        n.id === nodeId ? { ...n, data: { ...n.data, ...data } } : n
      ),
    })),

  /* ── Execution ── */
  isRunning: false,
  isPaused: false,
  currentNodeId: null,
  runProgress: { current: 0, total: 0 },
  setRunning: (running) => set({ isRunning: running }),
  setPaused: (paused) => set({ isPaused: paused }),
  setCurrentNode: (nodeId) => set({ currentNodeId: nodeId }),
  setRunProgress: (current, total) => set({ runProgress: { current, total } }),

  /* ── Selection ── */
  selectedNodeId: null,
  setSelectedNode: (nodeId) => set({ selectedNodeId: nodeId }),

  /* ── Persistence ── */
  saveWorkflow: async () => {
    const { workflow, nodes, edges } = get();
    const data = { ...workflow, updatedAt: Date.now(), nodes, edges };
    try {
      await chrome.storage.local.set({ [`studio_workflow_${workflow.id}`]: data });
      // Also save as the "last opened" workflow
      await chrome.storage.local.set({ studio_last_workflow_id: workflow.id });
    } catch (e) {
      console.error('[Studio] Failed to save workflow:', e);
    }
  },

  loadWorkflow: async (id) => {
    try {
      const result = await chrome.storage.local.get(`studio_workflow_${id}`);
      const data = result[`studio_workflow_${id}`];
      if (data) {
        set({
          workflow: { id: data.id, name: data.name, createdAt: data.createdAt, updatedAt: data.updatedAt },
          nodes: data.nodes || [],
          edges: data.edges || [],
          view: 'canvas',
        });
      }
    } catch (e) {
      console.error('[Studio] Failed to load workflow:', e);
    }
  },

  loadLastWorkflow: async () => {
    try {
      const result = await chrome.storage.local.get('studio_last_workflow_id');
      const lastId = result.studio_last_workflow_id;
      if (lastId) {
        await get().loadWorkflow(lastId);
      }
    } catch (e) {
      console.error('[Studio] Failed to load last workflow:', e);
    }
  },
}));
