/* ============================================================
   GenerateNode — Core generation node for Google Flow
   Accepts text prompt + optional image references.
   Shows settings that match the sidepanel queue settings.
   Shows status: idle → running (glow) → done (preview) → error
   ============================================================ */

import { memo, useCallback } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { useStudioStore } from '../store';

type NodeStatus = 'idle' | 'running' | 'done' | 'error';

const VIDEO_MODELS = [
  { value: 'Veo 3', label: 'Veo 3' },
  { value: 'Veo 2', label: 'Veo 2' },
];

const IMAGE_MODELS = [
  { value: 'Nano Banana 2', label: 'Nano Banana 2' },
  { value: 'Imagen 4 Ultra', label: 'Imagen 4 Ultra' },
  { value: 'Imagen 4', label: 'Imagen 4' },
];

function statusClass(status: NodeStatus): string {
  switch (status) {
    case 'running': return 'studio-node--running';
    case 'done': return 'studio-node--done';
    case 'error': return 'studio-node--error';
    default: return '';
  }
}

function statusLabel(status: NodeStatus, progress: number): string {
  switch (status) {
    case 'running': return progress > 0 ? `Generating... ${progress}%` : 'Generating...';
    case 'done': return '✓ Done';
    case 'error': return '✗ Failed';
    default: return 'Ready';
  }
}

function GenerateNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as any;
  const updateNodeData = useStudioStore((s) => s.updateNodeData);

  const handleChange = useCallback(
    (field: string, value: string) => {
      updateNodeData(id, { [field]: value });
      // Reset model when switching media type
      if (field === 'mediaType') {
        updateNodeData(id, {
          model: value === 'image' ? 'Nano Banana 2' : 'Veo 3',
          aspectRatio: value === 'image' ? '9:16' : '9:16',
        });
      }
    },
    [id, updateNodeData]
  );

  const status = nodeData.status || 'idle';
  const mediaType = nodeData.mediaType || 'image';
  const models = mediaType === 'image' ? IMAGE_MODELS : VIDEO_MODELS;

  return (
    <div
      className={`studio-node studio-node--generate ${statusClass(status)} ${selected ? 'studio-node--selected' : ''}`}
    >
      <div className="studio-node__header studio-node__header--generate">
        <span className="studio-node__icon">🎬</span>
        <span className="studio-node__title">{nodeData.label || 'Generate'}</span>
        <span className={`studio-node__status studio-node__status--${status}`}>
          {statusLabel(status, nodeData.progress || 0)}
        </span>
      </div>

      <div className="studio-node__body">
        {/* Result preview */}
        {status === 'done' && nodeData.resultUrl && (
          <div className="studio-node__result-preview">
            {mediaType === 'video' ? (
              <video src={nodeData.resultUrl} controls autoPlay muted loop />
            ) : (
              <img src={nodeData.resultUrl} alt="Generated result" />
            )}
          </div>
        )}

        {/* Running animation */}
        {status === 'running' && (
          <div className="studio-node__generating">
            <div className="studio-node__spinner" />
            <span>{nodeData.progress > 0 ? `${nodeData.progress}%` : 'Processing...'}</span>
          </div>
        )}

        {/* Error message */}
        {status === 'error' && nodeData.errorMessage && (
          <div className="studio-node__error-msg">
            <span>⚠️ {nodeData.errorMessage}</span>
          </div>
        )}

        {/* Settings — match what the sidepanel queue offers */}
        <div className="studio-node__settings">
          <div className="studio-node__setting-row">
            <select
              className="studio-node__select"
              value={mediaType}
              onChange={(e) => handleChange('mediaType', e.target.value)}
            >
              <option value="image">Image</option>
              <option value="video">Video</option>
            </select>

            <select
              className="studio-node__select"
              value={nodeData.model || models[0].value}
              onChange={(e) => handleChange('model', e.target.value)}
            >
              {models.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </div>

          <div className="studio-node__setting-row">
            <select
              className="studio-node__select"
              value={nodeData.aspectRatio || '9:16'}
              onChange={(e) => handleChange('aspectRatio', e.target.value)}
            >
              <option value="9:16">9:16</option>
              <option value="16:9">16:9</option>
              <option value="1:1">1:1</option>
              {mediaType === 'image' && (
                <>
                  <option value="4:3">4:3</option>
                  <option value="3:4">3:4</option>
                </>
              )}
            </select>
          </div>
        </div>

        <div className="studio-node__platform">
          <span className="studio-node__platform-dot" />
          Google Flow
        </div>
      </div>

      {/* Input handles */}
      <Handle
        type="target"
        position={Position.Left}
        id="text"
        className="studio-handle studio-handle--text"
        style={{ top: '40%' }}
      />
      <Handle
        type="target"
        position={Position.Left}
        id="image_ref"
        className="studio-handle studio-handle--image"
        style={{ top: '65%' }}
      />

      {/* Output handle */}
      <Handle
        type="source"
        position={Position.Right}
        id="result"
        className="studio-handle studio-handle--result"
      />
    </div>
  );
}

export const GenerateNode = memo(GenerateNodeComponent);
