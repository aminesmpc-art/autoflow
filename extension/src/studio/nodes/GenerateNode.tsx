/* ============================================================
   GenerateNode — Core generation node for Google Flow
   Media-dominant layout: the result IS the node. Title and
   platform badge sit outside the card; settings collapse into
   a compact strip along the bottom.
   ============================================================ */

import { memo, useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { useStudioStore } from '../store';
import { AVAILABLE_MODELS, AVAILABLE_IMAGE_MODELS } from '../../types';

type NodeStatus = 'idle' | 'running' | 'done' | 'error';

/* Model names must match what Flow renders on the page — single source of truth */
const VIDEO_MODELS: readonly string[] = AVAILABLE_MODELS;
const IMAGE_MODELS: readonly string[] = AVAILABLE_IMAGE_MODELS;

const IMAGE_RATIOS = ['9:16', '16:9', '1:1', '4:3', '3:4'];
const VIDEO_RATIOS = ['9:16', '16:9', '1:1'];
const DURATIONS = ['4s', '6s', '8s'];

/** CSS aspect-ratio for the media area, so the node takes the shape of its output */
function ratioToCss(ratio: string): string {
  const [w, h] = (ratio || '9:16').split(':');
  return `${w || 9} / ${h || 16}`;
}

function statusClass(status: NodeStatus): string {
  switch (status) {
    case 'running': return 'sn--running';
    case 'done': return 'sn--done';
    case 'error': return 'sn--error';
    default: return '';
  }
}

function GenerateNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as any;
  const updateNodeData = useStudioStore((s) => s.updateNodeData);
  const removeNode = useStudioStore((s) => s.removeNode);
  const duplicateNode = useStudioStore((s) => s.duplicateNode);
  const [zoomed, setZoomed] = useState(false);

  const set = useCallback(
    (field: string, value: unknown) => updateNodeData(id, { [field]: value }),
    [id, updateNodeData]
  );

  const handleMediaType = useCallback(
    (value: string) => {
      // Model and ratio must stay valid for the selected media type
      updateNodeData(id, {
        mediaType: value,
        model: value === 'image' ? IMAGE_MODELS[0] : VIDEO_MODELS[0],
        aspectRatio: '9:16',
      });
    },
    [id, updateNodeData]
  );

  const status: NodeStatus = nodeData.status || 'idle';
  const platform: 'flow' | 'chatgpt' = nodeData.platform === 'chatgpt' ? 'chatgpt' : 'flow';
  const isChatGPT = platform === 'chatgpt';
  const mediaType = nodeData.mediaType || 'image';
  const isVideo = !isChatGPT && mediaType === 'video';
  const models = isVideo ? VIDEO_MODELS : IMAGE_MODELS;
  const ratios = isVideo ? VIDEO_RATIOS : IMAGE_RATIOS;
  const ratio = nodeData.aspectRatio || '9:16';
  const progress = nodeData.progress || 0;
  const enabled = nodeData.enabled !== false;

  // Self-contained data URLs built by the content script.
  const preview = nodeData.previewUrl || '';
  const previewVideo = nodeData.previewVideoUrl || '';

  return (
    <div className={`sn-wrap ${selected ? 'sn-wrap--selected' : ''}`}>
      {/* ── Floating action bar (above the card) ── */}
      <div className="sn-actions">
        {preview && (
          <a className="sn-actions__btn" href={preview} download={`autoflow-${id}.jpg`} title="Download result">↓</a>
        )}
        <button className="sn-actions__btn" onClick={() => duplicateNode(id)} title="Duplicate node">⧉</button>
        <button className="sn-actions__btn sn-actions__btn--danger" onClick={() => removeNode(id)} title="Delete node">🗑</button>
      </div>

      {/* ── External title ── */}
      <div className="sn-label">
        <span className="sn-label__icon" aria-hidden="true">{isVideo ? '🎞' : '🖼'}</span>
        <span className="sn-label__text">{nodeData.label || 'Flow — Image/Video Generate'}</span>
      </div>

      {/* ── The card ── */}
      <div className={`sn ${statusClass(status)} ${!enabled ? 'sn--disabled' : ''}`}>
        {/* Enable/disable toggle */}
        <button
          className={`sn-toggle ${enabled ? 'sn-toggle--on' : ''}`}
          onClick={() => set('enabled', !enabled)}
          title={enabled ? 'Node enabled — click to skip it on run' : 'Node skipped — click to enable'}
          aria-label="Toggle node"
        >
          <span className="sn-toggle__knob" />
        </button>

        {/* ── Media area — full ratio only once there's something to show ── */}
        <div
          className={`sn-media ${!(status === 'done' && (preview || previewVideo)) ? 'sn-media--empty' : ''}`}
          style={{ aspectRatio: ratioToCss(ratio) }}
        >
          {status === 'done' && previewVideo && (
            /* nodrag/nowheel: using the player must not pan or zoom the canvas */
            <video
              className="sn-media__img nodrag nowheel"
              src={previewVideo}
              poster={preview || undefined}
              controls
              loop
              muted
              playsInline
            />
          )}

          {status === 'done' && !previewVideo && preview && (
            <>
              <img className="sn-media__img" src={preview} alt="Generated result" onClick={() => setZoomed(true)} />
              {isVideo && <span className="sn-media__badge">▶ Video — open in Flow to play</span>}
            </>
          )}

          {status === 'done' && !previewVideo && !preview && (
            <div className="sn-media__state">
              <span className="sn-media__state-icon">🖼</span>
              <span>Generated on {isChatGPT ? 'ChatGPT' : 'Flow'}</span>
              <small>{isChatGPT ? 'Prompt submitted — see the ChatGPT tab' : 'Preview unavailable'}</small>
            </div>
          )}

          {status === 'running' && (
            <div className="sn-media__state sn-media__state--running">
              <div className="sn-spinner" />
              <span>Generating {isVideo ? 'video' : 'image'}…</span>
              <div className="sn-progress">
                <div className="sn-progress__fill" style={{ width: `${progress}%` }} />
              </div>
              <small>{progress > 0 ? `${progress}%` : 'Starting'}</small>
            </div>
          )}

          {status === 'error' && (
            <div className="sn-media__state sn-media__state--error">
              <span className="sn-media__state-icon">⚠</span>
              <span>Generation failed</span>
              <small title={nodeData.errorMessage}>{nodeData.errorMessage}</small>
            </div>
          )}

          {status === 'idle' && (
            <div className="sn-media__state sn-media__state--idle">
              <span className="sn-media__state-icon">{isVideo ? '🎞' : '🖼'}</span>
              <small>Connect a prompt, then Run</small>
            </div>
          )}
        </div>

        {/* ── Compact settings strip ── */}
        <div className="sn-bar">
          <select
            className="sn-bar__sel"
            value={platform}
            onChange={(e) => set('platform', e.target.value)}
            title="Platform"
          >
            <option value="flow">Flow</option>
            <option value="chatgpt">ChatGPT</option>
          </select>

          {/* ChatGPT v1 is prompt-only: the composer has no model/ratio/duration controls */}
          {!isChatGPT && (
            <>
              <select className="sn-bar__sel" value={mediaType} onChange={(e) => handleMediaType(e.target.value)} title="Output type">
                <option value="image">Image</option>
                <option value="video">Video</option>
              </select>

              <select className="sn-bar__sel sn-bar__sel--grow" value={nodeData.model || models[0]} onChange={(e) => set('model', e.target.value)} title="Model">
                {models.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>

              {isVideo && (
                <select className="sn-bar__sel" value={nodeData.duration || '6s'} onChange={(e) => set('duration', e.target.value)} title="Duration">
                  {DURATIONS.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              )}

              <select className="sn-bar__sel" value={ratio} onChange={(e) => set('aspectRatio', e.target.value)} title="Aspect ratio">
                {ratios.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </>
          )}
          {isChatGPT && <span className="sn-bar__hint">Image · prompt only</span>}
        </div>

        {/* ── Handles: large, labelled, outside the edge ── */}
        <Handle type="target" position={Position.Left} id="text" className="sn-port sn-port--text" style={{ top: '38%' }}>
          <span className="sn-port__glyph">T</span>
        </Handle>
        <Handle type="target" position={Position.Left} id="image_ref" className="sn-port sn-port--image" style={{ top: '62%' }}>
          <span className="sn-port__glyph">🖼</span>
        </Handle>
        <Handle type="source" position={Position.Right} id="result" className="sn-port sn-port--out" style={{ top: '50%' }}>
          <span className="sn-port__glyph">→</span>
        </Handle>
      </div>

      {/* ── External platform badge ── */}
      <div className="sn-platform">
        <span className={`sn-platform__dot ${isChatGPT ? 'sn-platform__dot--chatgpt' : ''}`} />
        {isChatGPT ? 'ChatGPT Images' : 'Google Flow'}
      </div>

      {/* Portaled: React Flow transforms nodes, which breaks position:fixed inside them */}
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
