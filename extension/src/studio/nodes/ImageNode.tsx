/* ============================================================
   ImageNode — Upload or select a reference image
   Same design language as GenerateNode: external label, hover
   action bar, media-dominant card with a bottom name strip.
   ============================================================ */

import { memo, useCallback, useRef } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { useStudioStore } from '../store';

function ImageNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as any;
  const updateNodeData = useStudioStore((s) => s.updateNodeData);
  const removeNode = useStudioStore((s) => s.removeNode);
  const duplicateNode = useStudioStore((s) => s.duplicateNode);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleUpload = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = () => {
        updateNodeData(id, {
          imageData: reader.result as string,
          imageName: nodeData.imageName || file.name.replace(/\.[^.]+$/, ''),
        });
      };
      reader.readAsDataURL(file);
    },
    [id, nodeData.imageName, updateNodeData]
  );

  const handleNameChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      updateNodeData(id, { imageName: e.target.value });
    },
    [id, updateNodeData]
  );

  return (
    <div className={`sn-wrap sn-wrap--input ${selected ? 'sn-wrap--selected' : ''}`}>
      <div className="sn-actions">
        <button className="sn-actions__btn" onClick={() => duplicateNode(id)} title="Duplicate node">⧉</button>
        <button className="sn-actions__btn sn-actions__btn--danger" onClick={() => removeNode(id)} title="Delete node">🗑</button>
      </div>

      <div className="sn-label">
        <span className="sn-label__icon" aria-hidden="true">🖼</span>
        <span className="sn-label__text">{nodeData.label || 'Reference Image'}</span>
      </div>

      <div className="sn sn--image">
        <div className="sn-media sn-media--square">
          {nodeData.imageData ? (
            <>
              <img className="sn-media__img" src={nodeData.imageData} alt={nodeData.imageName || 'Reference'} />
              <button className="sn-media__change" onClick={handleUpload}>Change</button>
            </>
          ) : (
            <button className="sn-upload" onClick={handleUpload}>
              <span className="sn-upload__icon" aria-hidden="true">📎</span>
              <span>Upload image</span>
              <small>Used as a reference / ingredient</small>
            </button>
          )}
        </div>

        <div className="sn-bar">
          <input
            className="sn-name nodrag"
            placeholder="Name (e.g., Hero Character)"
            value={nodeData.imageName || ''}
            onChange={handleNameChange}
          />
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={handleFileChange}
        />

        <Handle type="source" position={Position.Right} id="image" className="sn-port sn-port--image" style={{ top: '50%' }}>
          <span className="sn-port__glyph">🖼</span>
        </Handle>
      </div>
    </div>
  );
}

export const ImageNode = memo(ImageNodeComponent);
