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
   ============================================================ */

import { memo, useCallback } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { useStudioStore } from '../store';
import { AGENT_TOOLS } from '../engine/tools';
import { CHAT_PLATFORMS } from '../engine/WorkflowRunner';
import type { AgentStep } from '../engine/agent';

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

/** Iteration caps offered. Ten matches n8n's default ceiling; four is a
    sensible starting point when every step costs a generation. */
const CAPS = [2, 4, 6, 10];

function AgentNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as any;
  const updateNodeData = useStudioStore((s) => s.updateNodeData);

  const status: NodeStatus = nodeData.status || 'idle';
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
    <div className={`studio-node sn sn--agent ${statusClass(status)} ${selected ? 'sn--selected' : ''}`}>
      <Handle type="target" position={Position.Left} id="text" className="sn-handle sn-handle--text" />

      <div className="sn-head">
        <span className="sn-head__icon">🧠</span>
        <input
          className="sn-head__title nodrag"
          value={nodeData.label || 'Agent'}
          onChange={(e) => set({ label: e.target.value })}
          placeholder="Agent"
        />
        <label className="sn-switch nodrag" title="Skip this node when running">
          <input
            type="checkbox"
            checked={nodeData.enabled !== false}
            onChange={(e) => set({ enabled: e.target.checked })}
          />
          <span className="sn-switch__track" />
        </label>
      </div>

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

      <div className="sn-body">
        <div className="sn-row">
          <div className="sn-field" title="Which chat drives the loop">
            <span className="sn-field__label">Platform</span>
            <select
              className="sn-select nodrag"
              value={platform}
              onChange={(e) => set({ platform: e.target.value })}
            >
              {CHAT_PLATFORMS.map((p) => (
                <option key={p} value={p}>{p === 'chatgpt' ? 'ChatGPT' : p === 'gemini' ? 'Gemini' : 'Grok'}</option>
              ))}
            </select>
          </div>

          <div className="sn-field" title="Every iteration is a real generation">
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

        <textarea
          className="sn-agent__system nodrag"
          value={nodeData.system || ''}
          onChange={(e) => set({ system: e.target.value })}
          placeholder="System message (optional) — how it should behave"
          rows={2}
        />

        <div className="sn-agent__foot">
          {toolsRun > 0
            ? `${toolsRun} tool call${toolsRun === 1 ? '' : 's'} · up to ${maxIterations} steps`
            : `Goal comes from the T input · up to ${maxIterations} steps`}
        </div>
      </div>

      <Handle type="source" position={Position.Right} id="text" className="sn-handle sn-handle--text" />
    </div>
  );
}

export const AgentNode = memo(AgentNodeComponent);
