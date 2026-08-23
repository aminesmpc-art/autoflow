/**
 * The Clipping node.
 *
 * One node on the canvas, five stages inside it. The stages are separated
 * because they cost wildly different amounts — transcribing a twenty-minute
 * source is minutes of wall clock, the cut is seconds of local arithmetic —
 * and because a failure in a late one must not throw away an early one. That
 * logic lives in clip/stages.ts; this file draws it.
 *
 * The tab layout is the one the blueprint asked for, kept because it maps
 * onto something real: each tab is a stage the user might want to look at,
 * disagree with, and re-run from. Re-running from a stage clears everything
 * after it, which is why the tabs are in pipeline order rather than in order
 * of interest.
 */

import { memo, useCallback, useMemo, useState } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';

import { Icon } from '../components/Icon';
import { useStudioStore } from '../store';
import { NodeInfoBadge } from './NodeInfoBadge';
import {
  STAGE_ORDER, STAGE_LABEL, describeRun, progressOf, nextPending,
  forSource, invalidateFrom, resultOf,
  type ClipRun, type StageId,
} from '../clip/stages';
import { putSource, sourceKeyFor } from '../clip/sourceStore';

type Tab = 'source' | 'moments' | 'rules';

/** What the model is asked for when the node has not been told otherwise. */
const DEFAULT_WANTED = 10;

const STATUS_GLYPH: Record<string, string> = {
  pending: '·',
  running: '◐',
  done: '✓',
  failed: '✕',
};

function ClippingNodeInner({ id, data, selected }: NodeProps) {
  const d = data as any;
  const updateNodeData = useStudioStore((s) => s.updateNodeData);
  const removeNode = useStudioStore((s) => s.removeNode);
  const duplicateNode = useStudioStore((s) => s.duplicateNode);

  const [tab, setTab] = useState<Tab>('source');

  const sourceName: string = d.sourceName || '';
  const sourceKey: string = d.sourceKey || '';

  /* The run is stored on the node so reopening Studio keeps the eight minutes
     already spent. forSource is what decides whether it still counts. */
  const run: ClipRun = useMemo(
    () => forSource(d.clipRun as ClipRun | undefined, sourceKey),
    [d.clipRun, sourceKey],
  );

  const pending = nextPending(run);
  const progress = progressOf(run);
  const lines = describeRun(run);

  const survey = resultOf<{
    moments?: Array<{ rank: number; hookLine: string; closingLine: string; why: string }>;
  }>(run, 'survey');
  const moments = Array.isArray((survey as any)?.moments) ? (survey as any).moments : [];

  const mode: 'campaign' | 'explainer' = d.clipMode === 'explainer' ? 'explainer' : 'campaign';
  const wanted: number = typeof d.wantedClips === 'number' ? d.wantedClips : DEFAULT_WANTED;

  const redoFrom = useCallback((stage: StageId) => {
    updateNodeData(id, { clipRun: invalidateFrom(run, stage) } as any);
  }, [id, run, updateNodeData]);

  const onFile = useCallback((file: File | null) => {
    if (!file) return;
    const key = sourceKeyFor(file);

    /* The bytes go to the store and the KEY goes to node data. Node data is
       serialised — saved, exported, round-tripped through the template format
       — and a File cannot survive that. Forgetting this line is the version
       of the node where every stage reports the video is not loaded. */
    putSource(key, file);

    updateNodeData(id, {
      sourceName: file.name,
      sourceSize: file.size,
      sourceKey: key,
      /* forSource keeps the run when the same file comes back — which is what
         re-dropping after a reload is — and clears it when it is a different
         one, because a transcript of another podcast is worse than none. */
      clipRun: forSource(d.clipRun as ClipRun | undefined, key),
    } as any);
  }, [id, updateNodeData, d.clipRun]);

  return (
    <div className={`sn-wrap sn-wrap--kind-clip ${selected ? 'sn-wrap--selected' : ''}`}>
      <div className="sn-actions">
        <button className="sn-actions__btn" onClick={() => duplicateNode(id)} title="Duplicate node">⧉</button>
        <button className="sn-actions__btn sn-actions__btn--danger" onClick={() => removeNode(id)} title="Delete node">🗑</button>
      </div>

      <div className="sn sn--clip">
        <Handle type="target" position={Position.Left} id="text" className="sn-port sn-port--text" style={{ top: 72 }}>
          <span className="sn-port__glyph">T</span>
        </Handle>

        <div className="sn-bar">
          <Icon name="story" kind="video" className="sn-label__icon" />
          <input
            className="sn-label__name nodrag"
            value={d.label || 'Clipping'}
            onChange={(e) => updateNodeData(id, { label: e.target.value })}
            placeholder="Clipping"
          />
          <NodeInfoBadge type="clip" />
          {d.status === 'running' ? (
            <span className="sn-count sn-count--running">
              {pending ? STAGE_LABEL[pending] + '…' : 'Working…'}
            </span>
          ) : (
            <span className="sn-story__badge">
              {sourceName ? `${Math.round(progress * 100)}%` : 'No video'}
            </span>
          )}
        </div>

        {/* ── stage rail: the whole pipeline, always visible ── */}
        <div className="sn-clip__stages">
          {STAGE_ORDER.map((stageId, i) => {
            const rec = run.stages[stageId];
            return (
              <button
                key={stageId}
                type="button"
                className={`sn-clip__stage sn-clip__stage--${rec.status} nodrag`}
                title={lines[i] + (rec.status === 'done' ? ' — click to run again from here' : '')}
                onClick={() => rec.status === 'done' && redoFrom(stageId)}
              >
                <span className="sn-clip__glyph">{STATUS_GLYPH[rec.status]}</span>
                <span className="sn-clip__stage-name">{STAGE_LABEL[stageId]}</span>
                {rec.tookMs !== undefined && (
                  <span className="sn-clip__took">{(rec.tookMs / 1000).toFixed(1)}s</span>
                )}
              </button>
            );
          })}
        </div>

        <div className="sn-clip__tabs">
          {(['source', 'moments', 'rules'] as Tab[]).map((t) => (
            <button
              key={t}
              type="button"
              className={`sn-clip__tab nodrag ${tab === t ? 'sn-clip__tab--on' : ''}`}
              onClick={() => setTab(t)}
            >
              {t === 'source' ? 'Video' : t === 'moments' ? `Moments${moments.length ? ` (${moments.length})` : ''}` : 'Rules'}
            </button>
          ))}
        </div>

        {tab === 'source' && (
          <div className="sn-clip__panel">
            {sourceName ? (
              <div className="sn-clip__file">
                <strong>{sourceName}</strong>
                <span>{d.sourceSize ? `${(d.sourceSize / 1e6).toFixed(1)} MB` : ''}</span>
              </div>
            ) : (
              <div className="sn-story__empty">
                <strong>Drop the creator&rsquo;s video here.</strong>
                A long recording — the node finds the minute worth posting.
              </div>
            )}
            <input
              type="file"
              accept="video/*"
              className="nodrag"
              onChange={(e) => onFile(e.target.files?.[0] ?? null)}
            />
            <p className="sn-clip__hint">
              Already have a transcript? Wire a Prompt node into <strong>T</strong> and the
              slowest stage is skipped.
            </p>
          </div>
        )}

        {tab === 'moments' && (
          <div className="sn-clip__panel">
            {moments.length ? (
              <div className="sn-clip__moments">
                {moments.map((m: any) => (
                  <div key={m.rank} className="sn-clip__moment">
                    <span className="sn-clip__rank">{m.rank}</span>
                    <div className="sn-clip__moment-body">
                      <div className="sn-clip__quote">&ldquo;{m.hookLine}&rdquo;</div>
                      {m.why && <p className="sn-clip__why">{m.why}</p>}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="sn-story__empty">
                <strong>No moments ranked yet.</strong>
                The audio shortlists them and the model ranks what is said —
                never a timestamp.
              </div>
            )}
          </div>
        )}

        {tab === 'rules' && (
          <div className="sn-clip__panel">
            <div className="sn-clip__modes">
              {(['campaign', 'explainer'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  className={`sn-clip__mode nodrag ${mode === m ? 'sn-clip__mode--on' : ''}`}
                  onClick={() => updateNodeData(id, { clipMode: m })}
                >
                  {m === 'campaign' ? 'Campaign' : 'Explainer'}
                </button>
              ))}
              <label className="sn-clip__count">
                <span>Clips</span>
                <input
                  type="number"
                  min={1}
                  max={20}
                  className="nodrag"
                  value={wanted}
                  onChange={(e) => updateNodeData(id, {
                    wantedClips: Math.max(1, Math.min(20, Number(e.target.value) || DEFAULT_WANTED)),
                  })}
                />
              </label>
            </div>

            <p className="sn-clip__hint">
              {mode === 'campaign'
                ? 'Paid clipping under someone else’s brief. The cuts are the creator’s own footage and nothing else.'
                : 'Your own content. Cuts can be laid out with generated B-roll beside them.'}
            </p>

            <textarea
              className="sn-clip__rules nodrag"
              value={d.campaignRules || ''}
              placeholder={'Paste the campaign brief here — word for word.\n\nThe rules are shown to the model when it ranks the moments, so a brief that bans misrepresentation or engagement farming actually changes what gets chosen.'}
              onChange={(e) => updateNodeData(id, { campaignRules: e.target.value })}
            />
          </div>
        )}

        <Handle type="source" position={Position.Right} id="text" className="sn-port sn-port--text">
          <span className="sn-port__glyph">T</span>
        </Handle>
      </div>
    </div>
  );
}

export const ClippingNode = memo(ClippingNodeInner);
export default ClippingNode;
