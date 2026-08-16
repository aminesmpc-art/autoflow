/* ============================================================
   The Agent node — Ask AI, but it can act.

   Ask AI is one round trip: a prompt in, an answer out. An agent is the same
   two ports with a loop between them, so it wires anywhere Ask AI does and
   nothing downstream has to know the difference.

   What the node has to show, and why:

   - The step log. n8n calls this "return intermediate steps" and hides it
     behind an option; here it is the node's face, because an agent that
     silently spends four generations is not something you can debug after the
     fact. Every tool call, every result, every refusal is a line.

   - The iteration cap, in the open. Each iteration is a real generation with
     a real cost. A number buried in a settings panel is a bill you find later.

   - Which tools are on. An agent's behaviour is mostly decided by what it can
     reach, so that list belongs on the node rather than three clicks away.

   The chrome — wrapper, external label, toggle, ports — is deliberately the
   same markup GenerateNode uses. The first version of this file invented its
   own class names and rendered as unstyled white boxes on a dark canvas.
   ============================================================ */

import { memo, useCallback } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { useStudioStore } from '../store';
import { AGENT_TOOLS } from '../engine/tools';
import { CHAT_PLATFORMS } from '../engine/WorkflowRunner';
import type { AgentStep } from '../engine/agent';
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

/** A glyph per step kind, so the log scans without being read. */
const STEP_ICON: Record<string, string> = {
  tool: '⚙',
  observation: '←',
  done: '✓',
  repair: '↻',
  error: '⚠',
};

const PLATFORM_LABEL: Record<string, string> = {
  chatgpt: 'ChatGPT',
  gemini: 'Gemini',
  grok: 'Grok',
  claude: 'Claude',
  zai: 'Z.AI',
};

/** Iteration caps offered. Ten matches n8n's default ceiling; four is a
    sensible start when every step costs a generation. */
const CAPS = [2, 4, 6, 10];

function AgentNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as any;
  const updateNodeData = useStudioStore((s) => s.updateNodeData);
  const removeNode = useStudioStore((s) => s.removeNode);
  const duplicateNode = useStudioStore((s) => s.duplicateNode);

  const status: NodeStatus = nodeData.status || 'idle';
  const enabled = nodeData.enabled !== false;
  const steps: AgentStep[] = nodeData.agentSteps || [];
  const enabledTools: string[] = nodeData.tools?.length ? nodeData.tools : ['read_canvas'];
  const maxIterations: number = nodeData.maxIterations || 4;
  const platform: string = nodeData.platform || 'chatgpt';

  const set = useCallback(
    (patch: Record<string, unknown>) => updateNodeData(id, patch),
    [id, updateNodeData]
  );

  const toggleTool = useCallback((name: string) => {
    const next = enabledTools.includes(name)
      ? enabledTools.filter((t) => t !== name)
      : [...enabledTools, name];
    /* Never all-off: an agent with no tools is an Ask AI node with extra
       steps, and the loop would just answer on the first turn. */
    set({ tools: next.length ? next : [name] });
  }, [enabledTools, set]);

  const toolsRun = steps.filter((s) => s.kind === 'tool').length;

  return (
    <div className={`sn-wrap sn-wrap--kind-chat ${selected ? 'sn-wrap--selected' : ''}`}>
      <div className="sn-actions">
        <button className="sn-actions__btn" onClick={() => duplicateNode(id)} title="Duplicate node">⧉</button>
        <button className="sn-actions__btn sn-actions__btn--danger" onClick={() => removeNode(id)} title="Delete node">🗑</button>
      </div>

      <div className="sn-label">
        <span className="sn-label__icon" aria-hidden="true">🧠</span>
        <span className="sn-label__text">{nodeData.label || 'Agent'}</span>
        {!enabled && <span className="sn-label__skip">SKIPPED</span>}
        <NodeInfoBadge type="agent" />
        <button
          className={`sn-toggle ${enabled ? 'sn-toggle--on' : ''}`}
          onClick={() => set({ enabled: !enabled })}
          title={enabled ? 'Node enabled — click to skip it on run' : 'Node skipped — click to enable'}
          aria-label="Toggle node"
        >
          <span className="sn-toggle__knob" />
        </button>
      </div>

      <div className={`sn ${statusClass(status)} ${!enabled ? 'sn--disabled' : ''}`}>

        {/* ── The log. The reason this node is legible at all. ── */}
        <div className="sn-agent__log">
          {steps.length === 0 && (
            <div className="sn-agent__empty">
              {status === 'running' ? 'Thinking…' : 'Ready — press Run'}
            </div>
          )}
          {steps.map((s, i) => (
            <div key={i} className={`sn-agent__step sn-agent__step--${s.kind}`} title={s.detail}>
              <span className="sn-agent__step-n">{s.iteration}</span>
              <span className="sn-agent__step-icon">{STEP_ICON[s.kind] || '·'}</span>
              <span className="sn-agent__step-text">{s.summary}</span>
            </div>
          ))}
        </div>

        {status === 'error' && (
          <div className="sn-agent__error" title={nodeData.errorMessage}>
            ⚠ {nodeData.errorMessage}
            <button
              type="button"
              className="sn-retry-btn"
              onClick={(e) => {
                e.stopPropagation();
                window.dispatchEvent(new CustomEvent('studio:retry-node', { detail: id }));
              }}
            >↻ Retry</button>
          </div>
        )}

        {status === 'done' && nodeData.resultText && (
          <div className="sn-agent__answer" title={nodeData.resultText}>
            {nodeData.resultText}
          </div>
        )}

        <div className="sn-bar sn-bar--grid">
          <label className="sn-field" title="Which chat drives the loop">
            <span className="sn-field__label">Platform</span>
            <select
              className="sn-bar__sel nodrag"
              value={platform}
              onChange={(e) => set({ platform: e.target.value })}
            >
              {CHAT_PLATFORMS.map((p) => (
                <option key={p} value={p}>{PLATFORM_LABEL[p] || p}</option>
              ))}
            </select>
          </label>

          <div className="sn-field" title="Every step is a real generation">
            <span className="sn-field__label">Max steps</span>
            <div className="sn-seg nodrag">
              {CAPS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`sn-seg__btn ${maxIterations === c ? 'sn-seg__btn--on' : ''}`}
                  onClick={() => set({ maxIterations: c })}
                >{c}</button>
              ))}
            </div>
          </div>
        </div>

        <div className="sn-bar">
          <div className="sn-field sn-field--wide" title="What the agent is allowed to do">
            <span className="sn-field__label">Tools</span>
            <div className="sn-agent__tools nodrag">
              {AGENT_TOOLS.map((t) => (
                <button
                  key={t.name}
                  type="button"
                  title={t.description}
                  className={`sn-agent__tool ${enabledTools.includes(t.name) ? 'sn-agent__tool--on' : ''}`}
                  onClick={() => toggleTool(t.name)}
                >
                  {t.name}
                </button>
              ))}
            </div>
          </div>
        </div>

        <textarea
          className="sn-agent__system nodrag"
          value={nodeData.system || ''}
          onChange={(e) => set({ system: e.target.value })}
          placeholder="System message (optional) — how it should behave"
          rows={2}
        />

        {/* Watching a clip needs a model that reads video. ChatGPT does not,
            so this combination spends a run to discover it — said here instead. */}
        {enabledTools.includes('inspect_clip') && platform !== 'gemini' && (
          <div className="sn-agent__hint">
            inspect_clip needs a model that can watch video — switch Platform to Gemini
          </div>
        )}

        <div className="sn-agent__foot">
          {toolsRun > 0
            ? `${toolsRun} tool call${toolsRun === 1 ? '' : 's'} · up to ${maxIterations} steps`
            : `Goal comes from the T input · up to ${maxIterations} steps`}
        </div>

        <Handle
          type="target"
          position={Position.Left}
          id="text"
          className="sn-port sn-port--text"
          style={{ top: '50%' }}
        >
          <span className="sn-port__glyph">T</span>
        </Handle>
        <Handle
          type="source"
          position={Position.Right}
          id="text"
          className="sn-port sn-port--text"
          style={{ top: '50%' }}
        >
          <span className="sn-port__glyph">T</span>
        </Handle>
      </div>
    </div>
  );
}

export const AgentNode = memo(AgentNodeComponent);
