/* ============================================================
   Grok Extend — a node, not a mode.

   It was a toggle on the Grok clip node, which was wrong in a way worth
   naming: extending is a second generation. It has its own prompt, its own
   length, its own result, and it can be chained. A toggle hid all of that
   behind one node that claimed to produce a single clip.

   As a node the arithmetic also becomes visible, and Imagine's arithmetic is
   the whole difficulty: a clip starts at 6, 10 or 15 seconds, an extend adds
   6 or 10, and nothing may pass 30. So 15 + 10 + 10 is not a workflow, it is
   a generation Imagine will refuse — after spending the two before it.

   This node therefore shows what the clip is now, what it will be, and offers
   only the steps that still fit. A choice that cannot work is not presented
   as one.
   ============================================================ */

import { memo, useCallback, useMemo, useState } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { useStudioStore } from '../store';
import { Lightbox } from '../components/Lightbox';
import {
  extendChain, affordableExtendSteps, secondsOf,
  GROK_EXTEND_STEPS, GROK_MAX_TOTAL_SECONDS,
} from '../templates/validate';
import { NodeInfoBadge } from './NodeInfoBadge';

type NodeStatus = 'idle' | 'running' | 'done' | 'error';

function statusClass(status: NodeStatus): string {
  switch (status) {
    case 'running': return 'sn--running';
    case 'done': return 'sn--done';
    case 'error': return 'sn--error';
    default: return '';
  }
}

function ExtendNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as any;
  const updateNodeData = useStudioStore((s) => s.updateNodeData);
  const removeNode = useStudioStore((s) => s.removeNode);
  const [zoomed, setZoomed] = useState(false);

  // Self-contained data URLs, or the clip's own URL when it was too big to inline.
  const preview = nodeData.previewUrl || '';
  const previewVideo = nodeData.previewVideoUrl || '';
  const progress = nodeData.progress || 0;

  /* The chain is a fact about the canvas, so it is read from the canvas
     rather than stored on the node — moving a wire changes the answer, and a
     copy kept here would go stale the moment it did.

     Computed in a memo, NOT inside the selector. extendChain returns a fresh
     object every call, and Zustand v5 compares snapshots with Object.is: a
     selector returning a new object is "changed" on every store read, so the
     render loop never settles. That is not a slow node, it is a hung tab —
     selecting one turned the whole Studio window black. */
  const nodes = useStudioStore((s) => s.nodes);
  const edges = useStudioStore((s) => s.edges);
  const chain = useMemo(() => extendChain(id, nodes, edges), [id, nodes, edges]);

  const step = nodeData.extendSeconds || '+10s';
  const affordable = affordableExtendSteps(chain.secondsBefore);
  const total = chain.secondsBefore + secondsOf(step);
  const status: NodeStatus = nodeData.status || 'idle';
  const enabled = nodeData.enabled !== false;

  const pick = useCallback(
    (value: string) => updateNodeData(id, { extendSeconds: value }),
    [id, updateNodeData]
  );

  /* Connected but over the cap: the step chosen earlier no longer fits, which
     happens when the clip's own length is raised after the fact. Say it here
     rather than letting the run discover it. */
  const overCap = !chain.problem && chain.rootId && !affordable.includes(step);

  return (
    <div className={`sn-wrap sn-wrap--kind-extend ${selected ? 'sn-wrap--selected' : ''}`}>
      <div className="sn-label">
        <span className="sn-label__icon" aria-hidden="true">⏱</span>
        <span className="sn-label__text">{nodeData.label || 'Extend'}</span>
        {!enabled && <span className="sn-label__skip">SKIPPED</span>}
        <NodeInfoBadge type="extend" />
        <button
          className={`sn-toggle ${enabled ? 'sn-toggle--on' : ''}`}
          onClick={() => updateNodeData(id, { enabled: !enabled })}
          title={enabled ? 'Node enabled — click to skip it on run' : 'Node skipped — click to enable'}
          aria-label="Toggle node"
        >
          <span className="sn-toggle__knob" />
        </button>
      </div>

      <div className={`sn ${statusClass(status)} ${!enabled ? 'sn--disabled' : ''}`}>
        {/* The longer clip, where every other node shows its output.
            This node shipped without one: it ran, it produced a clip, and the
            card showed only the arithmetic — so "where do I see the result"
            had no answer on the node that made it. */}
        <div
          className={`sn-media ${status === 'done' && (preview || previewVideo) ? '' : 'sn-media--empty'}`}
          style={status === 'done' && (preview || previewVideo) ? { aspectRatio: '9 / 16' } : { height: 118 }}
        >
          {status === 'done' && previewVideo && (
            <>
              <video
                className="sn-media__img nodrag nowheel"
                src={previewVideo}
                poster={preview || undefined}
                controls loop muted playsInline
              />
              <button
                className="sn-media__expand"
                onClick={() => setZoomed(true)}
                title="View full size"
                aria-label="View full size"
              >⤢</button>
            </>
          )}

          {status === 'done' && !previewVideo && preview && (
            <img
              className="sn-media__img sn-media__img--zoom"
              src={preview}
              alt="Extended clip"
              onClick={() => setZoomed(true)}
              title="Click to view full size"
            />
          )}

          {status === 'done' && !previewVideo && !preview && (
            <div className="sn-media__state">
              <span className="sn-media__state-icon">🎞</span>
              <span>Extended on Grok</span>
              {/* The bytes live on assets.grok.com, which may refuse to be
                  fetched from here. The clip still exists — say where. */}
              <small>Preview unavailable — see the Grok tab</small>
            </div>
          )}

          {status === 'running' && (
            <div className="sn-media__state sn-media__state--running">
              <div className="sn-spinner" />
              <span>Extending…</span>
              <div className="sn-progress">
                <div className="sn-progress__fill" style={{ width: `${progress}%` }} />
              </div>
              <small>{progress > 0 ? `${progress}%` : 'Starting'}</small>
            </div>
          )}

          {status === 'error' && (
            <div className="sn-media__state sn-media__state--error">
              <span className="sn-media__state-icon">⚠</span>
              <span>Extend failed</span>
              <small title={nodeData.errorMessage}>{nodeData.errorMessage}</small>
              <button
                type="button"
                className="sn-retry-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  window.dispatchEvent(new CustomEvent('studio:retry-node', { detail: id }));
                }}
                title="Re-run just this node and anything skipped because of it"
              >↻ Retry</button>
            </div>
          )}

          {status === 'idle' && (
            <div className="sn-media__state sn-media__state--idle">
              <span className="sn-media__ghost" style={{ aspectRatio: '9 / 16' }}>
                <span className="sn-media__state-icon">⏱</span>
              </span>
              <small>{chain.problem ? 'Not ready' : 'Ready — press Run'}</small>
            </div>
          )}
        </div>

        <div className="sn-ext">
          {/* The sum, stated. Without it the cap is a rule you discover by
              hitting it, three minutes into a run. */}
          <div className="sn-ext__sum">
            {/* "—" on its own when nothing is connected. Rendering the dash
                and then appending the unit gave "—s", which reads as a broken
                number rather than as "no answer yet". */}
            <span className="sn-ext__from">{chain.rootId ? `${chain.secondsBefore}s` : '—'}</span>
            <span className="sn-ext__arrow">→</span>
            <span className={`sn-ext__to ${total > GROK_MAX_TOTAL_SECONDS ? 'sn-ext__to--over' : ''}`}>
              {chain.rootId ? `${total}s` : '—'}
            </span>
            <span className="sn-ext__cap">of {GROK_MAX_TOTAL_SECONDS}s</span>
          </div>

          {chain.problem && <div className="sn-ext__warn">{chain.problem}</div>}
          {overCap && (
            <div className="sn-ext__warn">
              {step} would make {total}s — over Grok's {GROK_MAX_TOTAL_SECONDS}s limit
            </div>
          )}

          <div className="sn-field sn-field--wide" title="How much to add">
            <span className="sn-field__label">Add</span>
            <div className="sn-seg nodrag">
              {GROK_EXTEND_STEPS.map((s) => {
                const fits = affordable.includes(s);
                return (
                  <button
                    key={s}
                    type="button"
                    disabled={!fits}
                    className={`sn-seg__btn ${step === s ? 'sn-seg__btn--on' : ''}`}
                    title={fits ? `Add ${s}` : `${s} would pass ${GROK_MAX_TOTAL_SECONDS}s`}
                    onClick={() => pick(s)}
                  >
                    {s}
                  </button>
                );
              })}
            </div>
          </div>

          {/* The run's own failure is shown in the media area above, where
              every other node shows it. Only the wiring problems belong here,
              because those are about the canvas rather than the run. */}
          {status === 'idle' && !chain.problem && (
            <small className="sn-ext__hint">
              Wire a prompt into T for what happens next.
            </small>
          )}
        </div>

        <Handle type="target" position={Position.Left} id="text" className="sn-port sn-port--text" style={{ top: '35%' }}>
          <span className="sn-port__glyph">T</span>
        </Handle>
        {/* A clip, never a still — which is why this is not image_ref. */}
        <Handle type="target" position={Position.Left} id="video" className="sn-port sn-port--image" style={{ top: '70%' }}>
          <span className="sn-port__glyph">▶</span>
        </Handle>
        <Handle type="source" position={Position.Right} id="result" className="sn-port sn-port--out" style={{ top: '50%' }}>
          <span className="sn-port__glyph">→</span>
        </Handle>
      </div>

      <div className="sn-platform">
        <span className="sn-platform__dot sn-platform__dot--grok" />
        Grok Imagine · extend
      </div>

      {zoomed && (previewVideo || preview) && (
        <Lightbox
          src={previewVideo || preview}
          kind={previewVideo ? 'video' : 'image'}
          alt="Extended clip, full size"
          onClose={() => setZoomed(false)}
        />
      )}

      <div className="sn-actions">
        <button className="sn-actions__btn sn-actions__btn--danger" onClick={() => removeNode(id)} title="Delete node">🗑</button>
      </div>
    </div>
  );
}

export const ExtendNode = memo(ExtendNodeComponent);
