import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';

import { chiefLayoutProblem, connectedDirectors } from '../ask/chief';
import { Icon } from '../components/Icon';
import { runner } from '../engine/WorkflowRunner';
import { useStudioStore } from '../store';
import { NodeInfoBadge } from './NodeInfoBadge';

function ChiefNodeInner({ id, data, selected }: NodeProps) {
  const d = data as any;
  const updateNodeData = useStudioStore((state) => state.updateNodeData);
  const removeNode = useStudioStore((state) => state.removeNode);
  const duplicateNode = useStudioStore((state) => state.duplicateNode);
  const nodes = useStudioStore((state) => state.nodes);
  const edges = useStudioStore((state) => state.edges);
  const isRunning = useStudioStore((state) => state.isRunning);
  const directors = connectedDirectors(id, nodes as any, edges as any);
  const shots = directors.reduce((total, director) => total + director.targets.length, 0);
  const layoutProblem = chiefLayoutProblem(directors);

  return (
    <div className={`sn-wrap sn-wrap--kind-chief ${selected ? 'sn-wrap--selected' : ''}`}>
      <div className="sn-actions">
        <button className="sn-actions__btn nodrag" onClick={() => duplicateNode(id)} title="Duplicate node" aria-label="Duplicate node"><Icon name="copy" /></button>
        <button className="sn-actions__btn sn-actions__btn--danger nodrag" onClick={() => removeNode(id)} title="Delete node" aria-label="Delete node"><Icon name="trash" /></button>
      </div>

      <div className="sn sn--chief">
        <Handle type="target" position={Position.Left} id="text" className="sn-port sn-port--text" style={{ top: 72 }}>
          <span className="sn-port__glyph">T</span>
        </Handle>

        <div className="sn-bar">
          <Icon name="chief" kind="agent" className="sn-label__icon" />
          <input
            className="sn-label__name nodrag"
            aria-label="Director Chief name"
            value={d.label || 'Director Chief'}
            onChange={(event) => updateNodeData(id, { label: event.target.value })}
            placeholder="Director Chief"
          />
          <NodeInfoBadge type="chief" />
          <span className={`sn-count ${d.status === 'running' ? 'sn-count--running' : ''}`}>
            {d.status === 'running' ? d.statusNote || 'Planning…' : 'Coordinator'}
          </span>
        </div>

        <div className="sn-chief__body">
          <div className="sn-chief__intro"><span>Production overview</span><p>One shared plan. Every director in sync.</p></div>
          <div className="sn-chief__stats" aria-label="Connected production">
            <div><strong>{directors.length}<small> / 2–3</small></strong><span>Directors connected</span></div>
            <div><strong>{shots}</strong><span>Shots assigned</span></div>
          </div>
          <div className="sn-chief__field">
          <label className="sn-field__label" htmlFor={`chief-engine-${id}`}>Chief AI Engine</label>
          <select
            id={`chief-engine-${id}`}
            className="sn-bar__sel nodrag nowheel"
            aria-describedby={`chief-engine-note-${id}`}
            value={d.platform || 'chatgpt'}
            onChange={(event) => updateNodeData(id, { platform: event.target.value })}
          >
            <option value="chatgpt">ChatGPT</option>
            <option value="gemini">Gemini</option>
            <option value="grok">Grok</option>
            <option value="claude">Claude</option>
            <option value="zai">Z.AI</option>
          </select>

          <div className="sn-chief__hint" id={`chief-engine-note-${id}`}>
            Plans each scene’s starting state, action and voiceover. Reviews all
            Directors together before media generation, with up to two repair passes.
          </div>
          </div>

          <div className="sn-chief__section-title"><Icon name="chief" /><strong>Connected directors</strong></div>

          {directors.length ? (
            <div className="sn-chief__directors">
              {directors.map((director, index) => (
                <div className="sn-chief__director" key={director.id}>
                  <span className="sn-story__n">{String(index + 1).padStart(2, '0')}</span>
                  <span className="sn-story__name" title={director.label}>{director.label}</span>
                  <span className="sn-story__meta">{director.targets.length} shots</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="sn-chief__empty">
              <Icon name="nodes" />
              <strong>Build your directing team</strong>
              <p>Connect the Chief’s right <b>T</b> output to the <b>T</b> input of two or three Director nodes.</p>
              <span>Each Director manages its own shots.</span>
            </div>
          )}
          {directors.length > 0 && layoutProblem && (
            <div className="sn-chief__notice" role="status"><Icon name="alert" /><span>{layoutProblem}</span></div>
          )}
          {d.chiefCheckpoint && (
            <div className="sn-chief__checkpoint" aria-live="polite">
              <strong>Saved production plan</strong>
              <p>{Object.keys(d.chiefCheckpoint.prompts || {}).length} / {directors.length} Director groups prepared.</p>
              <p>{d.chiefReview || 'Awaiting production review.'}</p>
              <p>{d.chiefSaveWarning || 'Resume rechecks inputs and reuses matching saved work.'}</p>
              <button type="button" className="sn-story__retry-btn nodrag" disabled={isRunning || !!layoutProblem}
                onClick={() => window.dispatchEvent(new CustomEvent('studio:retry-node', { detail: id }))}>
                Resume production
              </button>
              {' '}
              <button type="button" className="sn-story__retry-btn nodrag" disabled={isRunning}
                title="Discard the saved plan and prompts. Existing media stays available. Run again to replan."
                onClick={() => {
                  if (window.confirm('Clear the saved Chief plan and prompts? Existing media stays available. The next run will create a new plan.')) {
                    updateNodeData(id, { chiefCheckpoint: null, chiefReview: '', chiefSaveWarning: '', errorMessage: '', status: 'idle' });
                    /* The Directors' conversations were written under the plan
                       being discarded. Left open, the next run's first turn
                       would arrive as a follow-up to a story that no longer
                       exists — "fix scene 4" in a chat about the old one. */
                    runner.forgetThreads();
                  }
                }}>
                Clear plan
              </button>
            </div>
          )}
        </div>

        {d.errorMessage && (
          <div className="sn-story__error">
            <div className="sn-story__error-head">
              <span className="sn-story__error-title"><Icon name="alert" /> Planning Notice</span>
              <button
                type="button"
                className="sn-story__retry-btn nodrag"
                onClick={() => window.dispatchEvent(new CustomEvent('studio:retry-node', { detail: id }))}
              >
                <Icon name="retry" /> Retry
              </button>
            </div>
            <p className="sn-story__error-msg">{d.errorMessage}</p>
          </div>
        )}

        <Handle type="source" position={Position.Right} id="text" className="sn-port sn-port--text" style={{ top: 72 }}>
          <span className="sn-port__glyph">T</span>
        </Handle>
      </div>
    </div>
  );
}

export const ChiefNode = memo(ChiefNodeInner);
export default ChiefNode;
