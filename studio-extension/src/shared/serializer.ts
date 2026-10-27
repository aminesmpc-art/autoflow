/* ============================================================
   Serializer — Converts between React Flow's Node/Edge types
   and JSON-safe SerializedNode/SerializedEdge.
   
   The Canvas calls serializeNodes/Edges before sending a
   SW_START_RUN. The Canvas calls deserializeNodes when applying
   SW_LAYOUT_REQUEST from the coordinator.
   ============================================================ */

import type { Node, Edge } from '@xyflow/react';
import type { SerializedNode, SerializedEdge } from './executionTypes';

export function serializeNodes(nodes: Node[]): SerializedNode[] {
  return nodes.map((node) => {
    let safeData: Record<string, unknown> = {};
    try {
      safeData = JSON.parse(JSON.stringify(node.data || {}));
    } catch (e) {
      console.warn(`Failed to serialize node data for node ${node.id}`, e);
    }

    return {
      id: node.id,
      type: node.type || (node.data?.type as string) || 'unknown',
      data: safeData,
      position: node.position ? { x: node.position.x, y: node.position.y } : { x: 0, y: 0 }
    };
  });
}

export function serializeEdges(edges: Edge[]): SerializedEdge[] {
  return edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.sourceHandle ?? undefined,
    targetHandle: edge.targetHandle ?? undefined
  }));
}

export function deserializeForCanvas(nodes: SerializedNode[]): Node[] {
  return nodes.map((node) => ({
    id: node.id,
    type: node.type,
    data: node.data,
    position: node.position,
    selected: false,
    dragging: false
  }));
}

export function deserializeEdgesForCanvas(edges: SerializedEdge[]): Edge[] {
  return edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.sourceHandle ?? null,
    targetHandle: edge.targetHandle ?? null
  }));
}
