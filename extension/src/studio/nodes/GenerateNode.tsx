/* ============================================================
   GenerateNode — Core generation node for Google Flow
   Accepts text prompt + optional image references.
   Shows settings that match the sidepanel queue settings.
   Shows status: idle → running (glow) → done (preview) → error
   ============================================================ */

import { memo, useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
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

const IMAGE_RATIOS = ['9:16', '16:9', '1:1', '4:3', '3:4'];
const VIDEO_RATIOS = ['9:16', '16:9', '1:1'];

function statusClass(status: NodeStatus): string {
  switch (status) {
    case 'running': return 'studio-node--running';
    case 'done': return 'studio-node--done';
    case 'error': return 'studio-node--error';
    default: return '';
  }
}

function statusLabel(status: NodeStatus): string {
  switch (status) {
    case 'running': return 'Generating';
    case 'done': return 'Done';
    case 'error': return 'Failed';
    default: return 'Ready';
  }
}

function GenerateNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as any;
  const updateNodeData = useStudioStore((s) => s.updateNodeData);
  const removeNode = useStudioStore((s) => s.removeNode);
  const [zoomed, setZoomed] = useState(false);

  const handleChange = useCallback(
    (field: string, value: string) => {
      if (field === 'mediaType') {
        // Switching media type resets model + ratio to valid defaults for that type
        updateNodeData(id, {
          mediaType: value,
          model: value === 'image' ? 'Nano Banana 2' : 'Veo 3',
          aspectRatio: '9:16',
        });
        return;
      }
      updateNodeData(id, { [field]: value });
    },
    [id, updateNodeData]
  );

  const status: NodeStatus = nodeData.status || 'idle';
  const mediaType = nodeData.mediaType || 'image';
  const models = mediaType === 'image' ? IMAGE_MODELS : VIDEO_MODELS;
  const ratios = mediaType === 'image' ? IMAGE_RATIOS : VIDEO_RATIOS;
  const progress = nodeData.progress || 0;

  // previewUrl is a self-contained data URL from the content script.
  // resultUrl is the original Flow URL — only usable inside the Flow tab.
  const preview = nodeData.previewUrl || '';
  const hasResult = status === 'done';

  return (
    <div
      className={`studio-node studio-node--generate ${statusClass(status)} ${selected ? 'studio-node--selected' : ''}`}
    >
      <div className="studio-node__header studio-node__header--generate">
        <span className="studio-node__icon" aria-hidden="true">🎬</span>
        <span className="studio-node__title">{nodeData.label || 'Generate'}</span>
        <span className={`studio-node__status studio-node__status--${status}`}>
          {status === 'running' && <span className="studio-node__status-dot" />}
          {statusLabel(status)}
        </span>
        <button
          className="studio-node__close"
          onClick={() => removeNode(id)}
          title="Delete node"
          aria-label="Delete node"
        >
          ×
        </button>
      </div>

      <div className="studio-node__body">
        {/* ── Result preview ── */}
        {hasResult && preview && (
          <figure className="studio-node__result-preview">
            <img src={preview} alt="Generated result" onClick={() => setZoomed(true)} />
            <figcaption className="studio-node__result-actions">
              <button onClick={() => setZoomed(true)} title="View full size">⤢ View</button>
              <a href={preview} download={`autoflow-${id}.jpg`} title="Download preview">↓ Save</a>
            </figcaption>
          </figure>
        )}

        {/* Result exists but the preview could not be captured */}
        {hasResult && !preview && (
          <div className="studio-node__result-placeholder">
            <span className="studio-node__result-placeholder-icon">🖼</span>
            <span>Generated on Flow — preview unavailable</span>
          </div>
        )}

        {/* ── Running ── */}
        {status === 'running' && (
          <div className="studio-node__generating">
            <div className="studio-node__spinner" />
            <div className="studio-node__progress-track">
              <div className="studio-node__progress-fill" style={{ width: `${progress}%` }} />
            </div>
            <span className="studio-node__generating-label">
              {progress > 0 ? `${progress}%` : 'Starting…'}
            </span>
          </div>
        )}

        {/* ── Error ── */}
        {status === 'error' && nodeData.errorMessage && (
          <div className="studio-node__error-msg" title={nodeData.errorMessage}>
            <span className="studio-node__error-icon" aria-hidden="true">⚠</span>
            <span className="studio-node__error-text">{nodeData.errorMessage}</span>
          </div>
        )}

        {/* ── Settings ── */}
        <div className="studio-node__settings">
          <label className="studio-node__field">
            <span className="studio-node__field-label">Type</span>
            <select
              className="studio-node__select"
              value={mediaType}
              onChange={(e) => handleChange('mediaType', e.target.value)}
            >
              <option value="image">Image</option>
              <option value="video">Video</option>
            </select>
          </label>

          <label className="studio-node__field studio-node__field--wide">
            <span className="studio-node__field-label">Model</span>
            <select
              className="studio-node__select"
              value={nodeData.model || models[0].value}
              onChange={(e) => handleChange('model', e.target.value)}
            >
              {models.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </label>

          <label className="studio-node__field">
            <span className="studio-node__field-label">Ratio</span>
            <select
              className="studio-node__select"
              value={nodeData.aspectRatio || '9:16'}
              onChange={(e) => handleChange('aspectRatio', e.target.value)}
            >
              {ratios.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="studio-node__platform">
          <span className="studio-node__platform-dot" />
          Google Flow
        </div>
      </div>

      {/* ── Handles ── */}
      <div className="studio-node__port-label studio-node__port-label--text">Text</div>
      <Handle
        type="target"
        position={Position.Left}
        id="text"
        className="studio-handle studio-handle--text"
        style={{ top: '38%' }}
      />

      <div className="studio-node__port-label studio-node__port-label--image">Image</div>
      <Handle
        type="target"
        position={Position.Left}
        id="image_ref"
        className="studio-handle studio-handle--image"
        style={{ top: '62%' }}
      />

      <Handle
        type="source"
        position={Position.Right}
        id="result"
        className="studio-handle studio-handle--result"
      />

      {/* ── Lightbox ──
          Portaled to <body>: React Flow transforms node containers, which would
          otherwise make position:fixed resolve against the node, not the viewport. */}
      {zoomed && preview && createPortal(
        <div className="studio-lightbox" onClick={() => setZoomed(false)} role="dialog">
          <img src={preview} alt="Generated result, full size" onClick={(e) => e.stopPropagation()} />
          <button className="studio-lightbox__close" onClick={() => setZoomed(false)} aria-label="Close">×</button>
        </div>,
        document.body
      )}
    </div>
  );
}

export const GenerateNode = memo(GenerateNodeComponent);
