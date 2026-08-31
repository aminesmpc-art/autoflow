import React, { useState } from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
} from '@xyflow/react';
import { useStudioStore } from '../store';

/**
 * Custom Deletable Edge
 * Renders the clean, beautiful organic bezier curve connector with an interactive delete button (✕)
 * that ONLY appears when the user hovers over the line connector or selects it.
 */
export function DeletableEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style = {},
  markerEnd,
  selected,
}: EdgeProps) {
  const [isHovered, setIsHovered] = useState(false);

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const removeEdge = useStudioStore((s) => s.removeEdge);

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    removeEdge(id);
  };

  const showButton = isHovered || selected;

  return (
    <>
      <BaseEdge
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          ...style,
          stroke: selected ? '#c084fc' : (style.stroke || '#8b5cf6'),
          strokeWidth: selected ? 3 : (style.strokeWidth || 2.5),
        }}
      />
      {/* Invisible wider path for effortless mouse hover detection over the curve */}
      <path
        d={edgePath}
        fill="none"
        strokeOpacity={0}
        strokeWidth={32}
        className="react-flow__edge-interaction nodrag"
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        style={{ cursor: 'pointer' }}
      />
      <EdgeLabelRenderer>
        <div
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px) scale(${showButton ? 1 : 0.7})`,
            pointerEvents: showButton ? 'all' : 'none',
            opacity: showButton ? 1 : 0,
            transition: 'opacity 0.18s cubic-bezier(0.16, 1, 0.3, 1), transform 0.18s cubic-bezier(0.16, 1, 0.3, 1)',
          }}
          className={`nodrag nopan studio-edge__wrap ${showButton ? 'is-visible' : ''}`}
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
        >
          <button
            type="button"
            className="studio-edge__delete-btn"
            onClick={handleDelete}
            title="Disconnect line"
            aria-label="Remove line connector"
          >
            <span className="studio-edge__delete-icon" aria-hidden="true">✕</span>
          </button>
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
