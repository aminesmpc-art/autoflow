/* ============================================================
   Topological Sort — Determines node execution order
   Uses Kahn's algorithm (BFS-based) for DAG ordering.
   ============================================================ */

import type { Node, Edge } from '@xyflow/react';

export interface ExecutionStep {
  nodeId: string;
  nodeType: string;
  /** IDs of nodes this step depends on (must finish first) */
  dependencies: string[];
}

/**
 * Topological sort of workflow nodes based on edges.
 * Returns nodes in execution order (dependencies first).
 * Throws if the graph has a cycle.
 */
export function topologicalSort(nodes: Node[], edges: Edge[]): ExecutionStep[] {
  const nodeMap = new Map<string, Node>();
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();
  const deps = new Map<string, string[]>();

  // Initialize
  for (const node of nodes) {
    nodeMap.set(node.id, node);
    inDegree.set(node.id, 0);
    adj.set(node.id, []);
    deps.set(node.id, []);
  }

  // Build adjacency + in-degree from edges
  for (const edge of edges) {
    if (!nodeMap.has(edge.source) || !nodeMap.has(edge.target)) continue;
    adj.get(edge.source)!.push(edge.target);
    inDegree.set(edge.target, (inDegree.get(edge.target) || 0) + 1);
    deps.get(edge.target)!.push(edge.source);
  }

  // Start with nodes that have no incoming edges (in-degree = 0)
  const queue: string[] = [];
  inDegree.forEach((deg, id) => {
    if (deg === 0) queue.push(id);
  });

  const order: ExecutionStep[] = [];

  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    const node = nodeMap.get(nodeId)!;

    order.push({
      nodeId,
      nodeType: (node.data as any)?.type || node.type || 'unknown',
      dependencies: deps.get(nodeId) || [],
    });

    for (const child of adj.get(nodeId)!) {
      const newDeg = (inDegree.get(child) || 1) - 1;
      inDegree.set(child, newDeg);
      if (newDeg === 0) {
        queue.push(child);
      }
    }
  }

  // If we didn't visit all nodes, there's a cycle
  if (order.length !== nodes.length) {
    throw new Error('Workflow has a cycle — nodes cannot depend on each other in a loop.');
  }

  return order;
}

/**
 * Get the upstream edges for a specific node.
 * Returns which source nodes connect to which input handle.
 *
 * Values are ARRAYS: Flow accepts several reference images on one node, and
 * the previous Map<handle, sourceId> silently kept only the last edge — extra
 * image connections drawn on the canvas were dropped without any warning.
 */
export function getNodeInputs(nodeId: string, edges: Edge[]): Map<string, string[]> {
  const inputs = new Map<string, string[]>();
  for (const edge of edges) {
    if (edge.target !== nodeId) continue;
    const handle = edge.targetHandle || 'default';
    const list = inputs.get(handle);
    if (list) {
      if (!list.includes(edge.source)) list.push(edge.source);
    } else {
      inputs.set(handle, [edge.source]);
    }
  }
  return inputs;
}

/** All upstream node ids feeding this node, across every handle */
export function getUpstreamNodeIds(nodeId: string, edges: Edge[]): string[] {
  const ids = new Set<string>();
  for (const edge of edges) {
    if (edge.target === nodeId) ids.add(edge.source);
  }
  return Array.from(ids);
}

/**
 * Every node reachable downstream of `nodeId`, transitively.
 *
 * Retrying a failed node is only useful together with everything that was
 * skipped because of it — those are exactly its descendants.
 */
export function getDownstreamNodeIds(nodeId: string, edges: Edge[]): string[] {
  const out = new Set<string>();
  const stack = [nodeId];
  while (stack.length) {
    const current = stack.pop()!;
    for (const edge of edges) {
      if (edge.source === current && !out.has(edge.target)) {
        out.add(edge.target);
        stack.push(edge.target);
      }
    }
  }
  return Array.from(out);
}
