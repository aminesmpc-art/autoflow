/**
 * The Story node — one director for the whole workflow.
 *
 * An Ask AI node answers a question. This one plans a piece of work. You wire
 * its output to every generate node that needs a prompt, and it writes all of
 * them in a single reply, having been shown what each of those nodes actually
 * is: its media, platform, aspect ratio, duration, and whether its first frame
 * is already pinned by an image you connected.
 *
 * That last part is the whole reason it exists as its own node rather than a
 * mode on Ask AI. A node that writes one prompt only needs to know about one
 * node. A node that writes the set has to see the graph, and making that
 * visible on the canvas — a box with five wires coming out of it — is more
 * honest than a checkbox that quietly changes what an Ask AI does.
 *
 * It never edits the canvas. The nodes are the user's; the Story node fills
 * them in and nothing else.
 */

import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Icon } from '../components/Icon';
import { useStudioStore } from '../store';
import { getAskPresets } from '../presets';

function StoryNodeInner({ id, data, selected }: NodeProps) {
  const d = data as any;
  const updateNodeData = useStudioStore((s) => s.updateNodeData);
  const nodes = useStudioStore((s) => s.nodes);
  const edges = useStudioStore((s) => s.edges);

  /* What this node is on the hook for, counted live. A story node wired to
     nothing is the most likely way to get a confusing result, so it says so
     rather than waiting until the run to mention it. */
  const targets = edges.filter((e) => {
    if (e.source !== id || (e.targetHandle || 'default') !== 'text') return false;
    const n = nodes.find((x) => x.id === e.target);
    const td = (n?.data || {}) as any;
    return !!n && (n.type === 'generate' || td.type === 'generate') && td.mediaType !== 'text';
  });

  const shots: string[] = Array.isArray(d.shotTitles) ? d.shotTitles : [];
  const status = d.status as string | undefined;

  return (
    <div className={`sn-wrap sn-wrap--kind-story ${selected ? 'sn-wrap--selected' : ''}`}>
      <Handle type="target" position={Position.Left} id="text" className="sn-port sn-port--text" />

      <div className="sn sn--story">
        <div className="sn-bar">
          <Icon name="agent" kind="agent" className="sn-label__icon" />
          <input
            className="sn-label__name"
            value={d.label || 'Story'}
            onChange={(e) => updateNodeData(id, { label: e.target.value })}
            placeholder="Story"
          />
          {status === 'running' && <span className="sn-count">{d.statusNote || 'Writing…'}</span>}
        </div>

        <div className="sn-field">
          <label className="sn-field__label">Platform</label>
          <select
            className="sn-field__select nodrag"
            value={d.platform || 'chatgpt'}
            onChange={(e) => updateNodeData(id, { platform: e.target.value })}
          >
            <option value="chatgpt">ChatGPT</option>
            <option value="gemini">Gemini</option>
            <option value="grok">Grok</option>
            <option value="claude">Claude</option>
          </select>
        </div>

        <div className="sn-field">
          <label className="sn-field__label">Brief</label>
          <select
            className="sn-field__select nodrag"
            value={d.preset || ''}
            onChange={(e) => updateNodeData(id, { preset: e.target.value })}
          >
            <option value="">None — use the idea as written</option>
            {getAskPresets().map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>

        {/* What it will write, and for whom. */}
        <div className="sn-story__targets">
          {targets.length === 0 ? (
            <div className="sn-story__empty">
              Wire this to the nodes it should write for.
            </div>
          ) : (
            <>
              <div className="sn-story__count">
                Writes {targets.length} prompt{targets.length === 1 ? '' : 's'} in one pass
              </div>
              <ol className="sn-story__list">
                {targets.map((e, i) => {
                  const n = nodes.find((x) => x.id === e.target);
                  const nd = (n?.data || {}) as any;
                  return (
                    <li key={e.target} className="sn-story__item">
                      <span className="sn-story__n">{i + 1}</span>
                      <span className="sn-story__name">{nd.label || e.target}</span>
                      <span className="sn-story__meta">
                        {[nd.mediaType, nd.aspectRatio, nd.duration].filter(Boolean).join(' · ')}
                      </span>
                      {shots[i] && <span className="sn-story__done" title={shots[i]}>✓</span>}
                    </li>
                  );
                })}
              </ol>
            </>
          )}
        </div>

        {d.errorMessage && <div className="sn-story__error">{d.errorMessage}</div>}
      </div>

      <Handle type="source" position={Position.Right} id="text" className="sn-port sn-port--text" />
    </div>
  );
}

export const StoryNode = memo(StoryNodeInner);
export default StoryNode;
