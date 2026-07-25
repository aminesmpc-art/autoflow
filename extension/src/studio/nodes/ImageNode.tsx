/* ============================================================
   ImageNode — Upload or select a reference image
   ============================================================ */

import { memo, useCallback, useRef } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { useStudioStore } from '../store';

function ImageNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as any;
  const updateNodeData = useStudioStore((s) => s.updateNodeData);
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
    <div className={`studio-node studio-node--image ${selected ? 'studio-node--selected' : ''}`}>
      <div className="studio-node__header studio-node__header--image">
        <span className="studio-node__icon">🖼️</span>
        <span className="studio-node__title">{nodeData.label || 'Image'}</span>
      </div>
      <div className="studio-node__body">
        {nodeData.imageData ? (
          <div className="studio-node__image-preview">
            <img src={nodeData.imageData} alt={nodeData.imageName || 'Reference'} />
            <div className="studio-node__image-overlay" onClick={handleUpload}>
              <span>Change</span>
            </div>
          </div>
        ) : (
          <button className="studio-node__upload-btn" onClick={handleUpload}>
            <span className="studio-node__upload-icon">📎</span>
            <span>Upload Image</span>
          </button>
        )}
        <input
          className="studio-node__name-input"
          placeholder="Name (e.g., Hero Character)"
          value={nodeData.imageName || ''}
          onChange={handleNameChange}
        />
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={handleFileChange}
        />
      </div>
      {/* Output handle: Image */}
      <Handle
        type="source"
        position={Position.Right}
        id="image"
        className="studio-handle studio-handle--image"
      />
    </div>
  );
}

export const ImageNode = memo(ImageNodeComponent);
