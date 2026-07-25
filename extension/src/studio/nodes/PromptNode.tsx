/* ============================================================
   PromptNode — Text input node for character/scene descriptions
   ============================================================ */

import { memo, useCallback } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { useStudioStore } from '../store';

function PromptNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as any;
  const updateNodeData = useStudioStore((s) => s.updateNodeData);

  const handleTextChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      updateNodeData(id, { text: e.target.value });
    },
    [id, updateNodeData]
  );

  const charCount = nodeData.text?.length || 0;

  return (
    <div className={`studio-node studio-node--prompt ${selected ? 'studio-node--selected' : ''}`}>
      <div className="studio-node__header studio-node__header--prompt">
        <span className="studio-node__icon">✏️</span>
        <span className="studio-node__title">{nodeData.label || 'Prompt'}</span>
      </div>
      <div className="studio-node__body">
        <textarea
          className="studio-node__textarea"
          placeholder="Describe your character or scene..."
          value={nodeData.text || ''}
          onChange={handleTextChange}
          rows={5}
        />
        <div className="studio-node__meta">
          <span className="studio-node__charcount">{charCount.toLocaleString()}/20,000</span>
        </div>
      </div>
      {/* Output handle: Text */}
      <Handle
        type="source"
        position={Position.Right}
        id="text"
        className="studio-handle studio-handle--text"
      />
    </div>
  );
}

export const PromptNode = memo(PromptNodeComponent);
