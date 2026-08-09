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

import { memo, useCallback } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { useStudioStore } from '../store';
import {
  extendChain, affordableExtendSteps, secondsOf,
  GROK_EXTEND_STEPS, GROK_MAX_TOTAL_SECONDS,
} from '../templates/validate';

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

  /* The chain is a fact about the canvas, so it is read from the canvas
     rather than stored on the node — moving a wire changes the answer, and a
     copy kept here would go stale the moment it did. */
  const chain = useStudioStore((s) => extendChain(id, s.nodes, s.edges));

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

          {status === 'error' && nodeData.errorMessage && (
            <div className="sn-ext__warn">{nodeData.errorMessage}</div>
          )}
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

      <div className="sn-actions">
        <button className="sn-actions__btn sn-actions__btn--danger" onClick={() => removeNode(id)} title="Delete node">🗑</button>
      </div>
    </div>
  );
}

export const ExtendNode = memo(ExtendNodeComponent);
