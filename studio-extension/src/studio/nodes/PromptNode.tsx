/* ============================================================
   PromptNode — Text input node for character/scene descriptions
   Same design language as GenerateNode: external label, hover
   action bar, card with a bottom meta strip.
   ============================================================ */

import { memo, useCallback } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { useStudioStore } from '../store';

const MAX_CHARS = 20000;

function PromptNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as any;
  const updateNodeData = useStudioStore((s) => s.updateNodeData);
  const removeNode = useStudioStore((s) => s.removeNode);
  const duplicateNode = useStudioStore((s) => s.duplicateNode);

  const handleTextChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      updateNodeData(id, { text: e.target.value });
    },
    [id, updateNodeData]
  );

  const charCount = nodeData.text?.length || 0;

  return (
    <div className={`sn-wrap sn-wrap--input sn-wrap--kind-prompt ${selected ? 'sn-wrap--selected' : ''}`}>
      <div className="sn-actions">
        <button className="sn-actions__btn" onClick={() => duplicateNode(id)} title="Duplicate node">⧉</button>
        <button className="sn-actions__btn sn-actions__btn--danger" onClick={() => removeNode(id)} title="Delete node">🗑</button>
      </div>

      <div className="sn-label">
        <span className="sn-label__icon" aria-hidden="true">✏️</span>
        <span className="sn-label__text">{nodeData.label || 'Prompt'}</span>
      </div>

      <div className="sn sn--prompt">
        {/* nodrag/nowheel: typing and scrolling must not drag or zoom the canvas */}
        <textarea
          className="sn-text nodrag nowheel"
          placeholder="Describe your character or scene…"
          value={nodeData.text || ''}
          onChange={handleTextChange}
          maxLength={MAX_CHARS}
          rows={6}
        />
        <div className="sn-bar sn-bar--meta">
          <span className={`sn-count ${charCount > MAX_CHARS * 0.9 ? 'sn-count--warn' : ''}`}>
            {charCount.toLocaleString()}/{MAX_CHARS.toLocaleString()}
          </span>
        </div>

        <Handle type="source" position={Position.Right} id="text" className="sn-port sn-port--text" style={{ top: '50%' }}>
          <span className="sn-port__glyph">T</span>
        </Handle>
      </div>
    </div>
  );
}

export const PromptNode = memo(PromptNodeComponent);
