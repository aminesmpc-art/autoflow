/* ============================================================
   ImageNode — Upload or select a reference image
   Same design language as GenerateNode: external label, hover
   action bar, media-dominant card with a bottom name strip.
   ============================================================ */

import { memo, useCallback, useRef, useState } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { useStudioStore } from '../store';
import { Lightbox } from '../components/Lightbox';
import { NodeInfoBadge } from './NodeInfoBadge';

function ImageNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as any;
  const updateNodeData = useStudioStore((s) => s.updateNodeData);
  const removeNode = useStudioStore((s) => s.removeNode);
  const duplicateNode = useStudioStore((s) => s.duplicateNode);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [zoomed, setZoomed] = useState(false);
  // Box takes the image's own ratio once known, so nothing is letterboxed
  // or cropped. Falls back to square while empty.
  const [ratio, setRatio] = useState<string | null>(null);

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
    <div className={`sn-wrap sn-wrap--input sn-wrap--kind-image ${selected ? 'sn-wrap--selected' : ''}`}>
      <div className="sn-actions">
        <button className="sn-actions__btn" onClick={() => duplicateNode(id)} title="Duplicate node">⧉</button>
        <button className="sn-actions__btn sn-actions__btn--danger" onClick={() => removeNode(id)} title="Delete node">🗑</button>
      </div>

      <div className="sn-label">
        <span className="sn-label__icon" aria-hidden="true">🖼</span>
        <span className="sn-label__text">{nodeData.label || 'Reference Image'}</span>
        <NodeInfoBadge type="image" />
      </div>

      <div className="sn sn--image">
        <div
          className={`sn-media ${!nodeData.imageData ? 'sn-media--square sn-media--empty' : ''}`}
          style={nodeData.imageData ? { aspectRatio: ratio || '1 / 1' } : undefined}
        >
          {nodeData.imageData ? (
            <>
              <img
                className="sn-media__img sn-media__img--zoom"
                src={nodeData.imageData}
                alt={nodeData.imageName || 'Reference'}
                onLoad={(e) => {
                  const el = e.currentTarget;
                  if (el.naturalWidth && el.naturalHeight) {
                    setRatio(`${el.naturalWidth} / ${el.naturalHeight}`);
                  }
                }}
                onClick={() => setZoomed(true)}
                title="Click to view full size"
              />
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

      {zoomed && nodeData.imageData && (
        <Lightbox
          src={nodeData.imageData}
          kind="image"
          alt={nodeData.imageName || 'Reference image'}
          onClose={() => setZoomed(false)}
        />
      )}
    </div>
  );
}

export const ImageNode = memo(ImageNodeComponent);
