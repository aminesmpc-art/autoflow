/**
 * The Clipping node.
 *
 * One node on the canvas, four stages inside it. The stages are separated
 * because they cost wildly different amounts — transcribing a twenty-minute
 * source is minutes of wall clock, laying out the cuts is instant — and
 * because a failure in a late one must not throw away an early one. That
 * logic lives in clip/stages.ts; this file draws it.
 *
 * ── What this node has to answer, and used to not ─────────────────────────
 *
 * Watching a run, there are exactly three questions: what is it doing, why did
 * it stop, and what can I change. The first version answered none of them. A
 * stage that failed showed a red cross and a duration, with the reason hidden
 * in a title attribute; a stage transcribing six chunks showed nothing for
 * minutes, which reads as a hang; and the chat platform, the shape, the clip
 * length and the size of the shortlist were all settings the runner used and
 * the node never mentioned — so a run could fail on a platform the user had
 * never chosen and could not see.
 *
 * So: the rail says what it is doing now, a failed stage opens with its real
 * error and a button to retry just that stage, and every setting the run
 * actually reads has a control.
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
import { runner } from '../engine/WorkflowRunner';

type Tab = 'source' | 'moments' | 'settings';

/** What the model is asked for when the node has not been told otherwise. */
const DEFAULT_WANTED = 10;
/** How many moments the audio shortlists for the model to rank. */
const DEFAULT_SHORTLIST = 14;
/** The cap on a finished clip, in seconds. */
const DEFAULT_LONGEST = 200;

/* Every chat this build can drive, and what to call it on screen.
   The node used to name none of them and silently fall back to ChatGPT, which
   is fine until the fallback is the thing that fails — then the node reports a
   stage failing on a platform the user never chose and cannot see. */
const CHATS: Array<{ id: string; name: string }> = [
  { id: 'chatgpt', name: 'ChatGPT' },
  { id: 'gemini', name: 'Gemini' },
  { id: 'grok', name: 'Grok' },
  { id: 'claude', name: 'Claude' },
  { id: 'zai', name: 'Z.AI' },
];

const ASPECTS: Array<{ id: string; name: string }> = [
  { id: '9:16', name: '9:16' },
  { id: '1:1', name: '1:1' },
  { id: '16:9', name: '16:9' },
];

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
    wanted?: number;
    dropped?: string[];
  }>(run, 'survey');
  const moments = Array.isArray((survey as any)?.moments) ? (survey as any).moments : [];
  const asked: number = typeof survey?.wanted === 'number' ? survey.wanted : 0;
  const dropped: string[] = Array.isArray(survey?.dropped) ? survey!.dropped! : [];
  /* Fewer clips than asked for is normal and needs saying, because the
     alternative is a user counting eight nodes, expecting ten, and having no
     way at all to tell whether two were refused or two were lost. */
  const short = !!asked && moments.length < asked;

  const laid = resultOf<{ count?: number }>(run, 'layout');
  const cutCount: number = typeof laid?.count === 'number' ? laid.count : 0;

  /* What to do next, in one line.
     The node used to reach 100% and stop, with no sign that the work had
     moved to eight other nodes — so a finished survey and a broken one
     looked the same from here. */
  const nextStep: string = !sourceName
    ? 'Choose a video to start.'
    : d.status === 'running'
      ? ''
      : cutCount
        ? `${cutCount} cut${cutCount === 1 ? '' : 's'} laid out beside this node — they run with the workflow.`
        : nextPending(run) === 'ingest'
          ? 'Ready. Press Run.'
          : '';

  const mode: 'campaign' | 'explainer' = d.clipMode === 'explainer' ? 'explainer' : 'campaign';
  const wanted: number = typeof d.wantedClips === 'number' ? d.wantedClips : DEFAULT_WANTED;
  const shortlist: number = typeof d.surveyCandidates === 'number' ? d.surveyCandidates : DEFAULT_SHORTLIST;
  const longest: number = typeof d.longestSeconds === 'number' ? d.longestSeconds : DEFAULT_LONGEST;
  /* Defaults shown as the value rather than as a blank: a control whose box is
     empty reads as "not set", and the runner is using a default regardless. */
  const chat: string = CHATS.some((c) => c.id === d.platform) ? d.platform : 'chatgpt';
  /* Defaults on. Reading the video on the server is one call instead of six
     chat transcriptions, and it returns the timings that let every cut skip
     its own locating — so the slow path has to be chosen, not fallen into. */
  const readOnServer: boolean = d.readOnServer !== false;
  const aspect: string = ASPECTS.some((a) => a.id === d.aspect) ? d.aspect : '9:16';

  const redoFrom = useCallback((stage: StageId) => {
    updateNodeData(id, { clipRun: invalidateFrom(run, stage) } as any);
  }, [id, run, updateNodeData]);

  /**
   * Try a failed stage again, without re-running the ones above it.
   *
   * The rail already let you re-run from a stage that SUCCEEDED, which is the
   * less useful half: the stage you actually want to retry is the one that
   * just failed, and until now the only way was to run the whole node — paying
   * for the transcription again to retry the ranking after it.
   *
   * `only` keeps the run to this node. Everything above the retried stage is
   * still marked done, so the machine skips it and starts where it broke.
   */
  const retryFrom = useCallback((stage: StageId) => {
    const next = invalidateFrom(run, stage);
    updateNodeData(id, { clipRun: next, status: 'idle', errorMessage: '' } as any);
    const { nodes, edges } = useStudioStore.getState();
    /* Read after the update so the runner sees the invalidated run rather than
       the failed one it was just handed. */
    const fresh = nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, clipRun: next } } : n));
    runner.run(fresh, edges, { only: new Set([id]) });
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

        {/* ── stage rail: the whole pipeline, always visible ──
            A failed stage opens rather than just turning red. The error used
            to live only in the row's title attribute, so the node reported a
            red cross and a duration and nothing whatsoever about what went
            wrong — which is indistinguishable from the node being broken. */}
        <div className="sn-clip__stages">
          {STAGE_ORDER.map((stageId, i) => {
            const rec = run.stages[stageId];
            const failed = rec.status === 'failed';
            const running = rec.status === 'running';
            return (
              <div key={stageId} className={`sn-clip__stage-row sn-clip__stage-row--${rec.status}`}>
                <button
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

                {/* What it is doing right now. A stage that transcribes six
                    chunks is silent for minutes, and silence reads as a hang. */}
                {running && d.statusNote && (
                  <div className="sn-clip__note">{d.statusNote}</div>
                )}

                {failed && (
                  <div className="sn-clip__error">
                    <p className="sn-clip__error-text">{rec.error || 'It failed without saying why.'}</p>
                    <button
                      type="button"
                      className="sn-clip__retry nodrag"
                      onClick={() => retryFrom(stageId)}
                    >
                      Try {STAGE_LABEL[stageId].toLowerCase()} again
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* ── the settings that change what a run does, on the face ──
            These were behind a tab, which meant the chat, the job and the
            number of clips were all discoverable only by knowing to look.
            A run reads them every time; the node should state them every
            time. The rest — the brief, and the two numbers most people never
            touch — stay in a tab. */}
        <div className="sn-clip__strip">
          <select
            className="sn-clip__pick nodrag"
            value={chat}
            title="Which chat does the thinking"
            onChange={(e) => updateNodeData(id, { platform: e.target.value })}
          >
            {CHATS.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select
            className="sn-clip__pick nodrag"
            value={mode}
            title="Campaign work follows someone else's brief"
            onChange={(e) => updateNodeData(id, { clipMode: e.target.value })}
          >
            <option value="campaign">Campaign</option>
            <option value="explainer">Explainer</option>
          </select>
          <label className="sn-clip__pick sn-clip__pick--num" title="How many clips to make">
            <input
              type="number" min={1} max={20} className="nodrag"
              value={wanted}
              onChange={(e) => updateNodeData(id, {
                wantedClips: Math.max(1, Math.min(20, Number(e.target.value) || DEFAULT_WANTED)),
              })}
            />
            <span>clips</span>
          </label>
          <select
            className="sn-clip__pick nodrag"
            value={aspect}
            title="The shape of the finished clips"
            onChange={(e) => updateNodeData(id, { aspect: e.target.value })}
          >
            {ASPECTS.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>

        <div className="sn-clip__tabs">
          {(['source', 'moments', 'settings'] as Tab[]).map((t) => (
            <button
              key={t}
              type="button"
              className={`sn-clip__tab nodrag ${tab === t ? 'sn-clip__tab--on' : ''}`}
              onClick={() => setTab(t)}
            >
              {t === 'source' ? 'Video' : t === 'moments' ? `Moments${moments.length ? ` (${moments.length})` : ''}` : 'The brief'}
            </button>
          ))}
        </div>

        {tab === 'source' && (
          <div className="sn-clip__panel">
            {/* One control, not two. The native input renders its own
                "Choisir un fichier / no file chosen" in the browser's
                language beside a filename the node was already showing, so
                the video appeared twice and neither looked clickable. The
                input is still the input — it is just wearing the label. */}
            <label className={`sn-clip__drop nodrag ${sourceName ? 'sn-clip__drop--full' : ''}`}>
              <input
                type="file"
                accept="video/*"
                onChange={(e) => onFile(e.target.files?.[0] ?? null)}
              />
              {sourceName ? (
                <>
                  <strong className="sn-clip__drop-name">{sourceName}</strong>
                  <span className="sn-clip__drop-meta">
                    {d.sourceSize ? `${(d.sourceSize / 1e6).toFixed(0)} MB` : ''} · click to replace
                  </span>
                </>
              ) : (
                <>
                  <strong className="sn-clip__drop-name">Choose the creator&rsquo;s video</strong>
                  <span className="sn-clip__drop-meta">
                    A long recording — this finds the moments worth posting
                  </span>
                </>
              )}
            </label>
            <p className="sn-clip__hint">
              <strong>T</strong> takes a <strong>transcript</strong> of this video, if the
              creator published one — it skips the slowest stage. Direction and campaign
              rules go in <strong>the brief</strong>, not here.
            </p>
          </div>
        )}

        {tab === 'moments' && (
          <div className="sn-clip__panel">
            {(short || dropped.length > 0) && (
              <div className="sn-clip__tally">
                {short && (
                  <span>
                    {moments.length} of {asked} asked for — the rest were not judged
                    worth posting.
                  </span>
                )}
                {dropped.map((reason, i) => (
                  <span key={i} className="sn-clip__tally-drop">{reason}</span>
                ))}
              </div>
            )}

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

        {tab === 'settings' && (
          <div className="sn-clip__panel sn-clip__settings">
            {/* Which chat does the work. It was never on the node, so a run
                silently used ChatGPT and a failure named a platform nobody
                had chosen. */}
            <label className="sn-set">
              <span className="sn-set__label">Chat</span>
              <select
                className="sn-set__control nodrag"
                value={chat}
                onChange={(e) => updateNodeData(id, { platform: e.target.value })}
              >
                {CHATS.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>

            <div className="sn-set">
              <span className="sn-set__label">Job</span>
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
              </div>
            </div>

            <p className="sn-clip__hint">
              {mode === 'campaign'
                ? 'Paid clipping under someone else’s brief. The cuts are the creator’s own footage and nothing else.'
                : 'Your own content. Cuts can be laid out with generated B-roll beside them.'}
            </p>

            <label className="sn-set">
              <span className="sn-set__label">Read the video</span>
              <select
                className="sn-set__control nodrag"
                value={readOnServer ? 'server' : 'chat'}
                onChange={(e) => updateNodeData(id, { readOnServer: e.target.value === 'server' })}
              >
                <option value="server">On the server — fast</option>
                <option value="chat">In the chat — slow</option>
              </select>
            </label>
            <p className="sn-clip__hint">
              {readOnServer
                ? 'One call reads the whole video and returns the timings, so each cut needs no further questions. Needs you to be signed in.'
                : 'The audio is transcribed in the chat four minutes at a time. No account needed, but a twenty-minute video takes minutes and every cut then has to find its own lines.'}
            </p>

            <label className="sn-set">
              <span className="sn-set__label">Clips to make</span>
              <input
                type="number" min={1} max={20} className="sn-set__control sn-set__control--num nodrag"
                value={wanted}
                onChange={(e) => updateNodeData(id, {
                  wantedClips: Math.max(1, Math.min(20, Number(e.target.value) || DEFAULT_WANTED)),
                })}
              />
            </label>

            <label className="sn-set">
              <span className="sn-set__label">Moments to weigh</span>
              <input
                type="number" min={4} max={30} className="sn-set__control sn-set__control--num nodrag"
                value={shortlist}
                onChange={(e) => updateNodeData(id, {
                  surveyCandidates: Math.max(4, Math.min(30, Number(e.target.value) || DEFAULT_SHORTLIST)),
                })}
              />
            </label>
            <p className="sn-clip__hint">
              How many moments the audio shortlists for the chat to rank. More gives
              it something to reject; too many and the question stops being read.
            </p>

            <label className="sn-set">
              <span className="sn-set__label">Shape</span>
              <select
                className="sn-set__control nodrag"
                value={aspect}
                onChange={(e) => updateNodeData(id, { aspect: e.target.value })}
              >
                {ASPECTS.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </label>

            <label className="sn-set">
              <span className="sn-set__label">Longest clip</span>
              <input
                type="number" min={15} max={600} className="sn-set__control sn-set__control--num nodrag"
                value={longest}
                onChange={(e) => updateNodeData(id, {
                  longestSeconds: Math.max(15, Math.min(600, Number(e.target.value) || DEFAULT_LONGEST)),
                })}
              />
            </label>

            <span className="sn-set__label sn-set__label--block">
              {mode === 'campaign' ? 'The brief' : 'Anything the clips must respect'}
            </span>
            <textarea
              className="sn-clip__rules nodrag"
              value={d.campaignRules || ''}
              placeholder={'Paste the campaign brief here — word for word.\n\nThe rules are shown to the chat when it ranks the moments, so a brief that bans misrepresentation or engagement farming actually changes what gets chosen.'}
              onChange={(e) => updateNodeData(id, { campaignRules: e.target.value })}
            />
          </div>
        )}

        {nextStep && <div className="sn-clip__next">{nextStep}</div>}

        <Handle type="source" position={Position.Right} id="text" className="sn-port sn-port--text">
          <span className="sn-port__glyph">T</span>
        </Handle>
      </div>
    </div>
  );
}

export const ClippingNode = memo(ClippingNodeInner);
export default ClippingNode;
