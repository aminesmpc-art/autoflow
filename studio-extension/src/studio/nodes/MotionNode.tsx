/**
 * Motion Control — a Director for motion.
 *
 * Omni takes ten seconds of video at a time, so anything longer is several
 * generations. This node cuts the source, shows each piece to a model in one
 * conversation, and then generates every piece itself.
 *
 * ── Why the pieces live on this node ──────────────────────────────────────
 *
 * It used to build a Prompt node and an Omni node per piece. That reads better
 * — real nodes, editable, re-runnable — and it could not work in one press:
 * the runner sorts its plan once, before the first step, so nodes created
 * during a run are not in it. The clips only appeared on a SECOND press, which
 * re-entered this node from the top and replaced the nodes whose prompts had
 * just been edited.
 *
 * So the pieces are rows here instead, and they keep what mattered about being
 * nodes: each row shows its prompt, the prompt can be edited, and one bad
 * piece is redone on its own. A retry reuses the cut, the prompts and the
 * upload, and regenerates only the rows that are not already done.
 */

import { memo, useCallback, useEffect, useState } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';

import { Icon } from '../components/Icon';
import { MotionPreview } from '../components/MotionPreview';
import { useStudioStore } from '../store';
import { NodeInfoBadge } from './NodeInfoBadge';
import { hasSource, putSource, sourceKeyFor } from '../clip/sourceStore';
import { MODE_INTENT, type MotionMode, type MotionPieceRow } from '../ask/motionControl';

const MODES: MotionMode[] = ['move', 'swap', 'restyle'];

const STATE_WORD: Record<MotionPieceRow['status'], string> = {
  idle: 'ready',
  running: 'working…',
  done: 'done',
  error: 'failed',
};

function MotionNodeInner({ id, data, selected }: NodeProps) {
  const d = data as any;
  const updateNodeData = useStudioStore((s) => s.updateNodeData);
  const removeNode = useStudioStore((s) => s.removeNode);
  const duplicateNode = useStudioStore((s) => s.duplicateNode);
  const isRunning = useStudioStore((s) => s.isRunning);

  const mode: MotionMode = MODES.includes(d.motionMode) ? d.motionMode : 'move';
  const pieces: MotionPieceRow[] = Array.isArray(d.motionPieces) ? d.motionPieces : [];
  const done = pieces.filter((p) => p.status === 'done').length;

  /* The bytes go to the store and the KEY goes to node data. Node data is
     serialised — saved, exported, round-tripped through the template format —
     and a File cannot survive that. The same split the Clipping node makes,
     for the same reason. */
  const onFile = useCallback((file: File | null) => {
    if (!file) return;
    const key = sourceKeyFor(file);
    putSource(key, file);
    if (key === d.sourceKey) {
      updateNodeData(id, { sourceName: file.name, sourceSize: file.size });
      return;
    }
    updateNodeData(id, {
      sourceName: file.name,
      sourceSize: file.size,
      sourceKey: key,
      /* A different video means the pieces already cut are of something else.
         Their prompts were written about footage this node no longer holds,
         and the clips in Flow's library are of the old one, so both go. */
      motionPieces: [],
      motionPreparedFrom: '',
      motionUploaded: false,
    });
  }, [id, d.sourceKey, updateNodeData]);

  const sourceKey: string = d.sourceKey || '';
  const haveSource = !!sourceKey && hasSource(sourceKey);

  /* Putting the pieces into Flow drives a real file chooser through Chrome's
     debugger, so it is off until somebody says yes — and the switch lived
     ONLY on a Cut node.
   *
     Which made this node unrunnable on a canvas that has no Cut node, and the
     failure said "turn it on in Settings", where it has never been. A run
     stopped dead before the first cut, pointing at a place that does not
     exist. The node that cannot run without the switch is the node that
     should carry it.

     null, not false, until the flag has actually been read — otherwise the
     banner flashes up on every paint before the answer comes back. */
  const [uploadOn, setUploadOn] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    chrome.storage.local.get(['af_debug_upload'])
      .then((got) => { if (alive) setUploadOn(got?.af_debug_upload === true); })
      .catch(() => { if (alive) setUploadOn(false); });
    return () => { alive = false; };
  }, []);

  const allowUploads = useCallback(async () => {
    try {
      await chrome.storage.local.set({ af_debug_upload: true });
      setUploadOn(true);
    } catch { /* leave it as it was; the run will say so again */ }
  }, []);

  /** Rewrite one row, leaving the rest of the list exactly as it was. */
  const patchPiece = useCallback((index: number, patch: Partial<MotionPieceRow>) => {
    const next = (Array.isArray(d.motionPieces) ? d.motionPieces : [] as MotionPieceRow[])
      .map((p: MotionPieceRow) => (p.index === index ? { ...p, ...patch } : p));
    updateNodeData(id, { motionPieces: next });
  }, [id, d.motionPieces, updateNodeData]);

  /**
   * Redo one piece.
   *
   * Marking the row idle and retrying the NODE is the whole mechanism: the run
   * skips rows that are already done, so "retry this node" and "make this one
   * piece again" are the same request. It also means the reuse rule is written
   * once, in the runner, rather than once here and once there.
   */
  const retryPiece = useCallback((index: number) => {
    patchPiece(index, {
      status: 'idle', errorMessage: undefined,
      videoUrl: undefined, posterUrl: undefined, tileId: undefined,
    });
    window.dispatchEvent(new CustomEvent('studio:retry-node', { detail: id }));
  }, [id, patchPiece]);

  return (
    <div className={`sn-wrap sn-wrap--kind-motion ${selected ? 'sn-wrap--selected' : ''}`}>
      <div className="sn-actions">
        <button className="sn-actions__btn nodrag" onClick={() => duplicateNode(id)} title="Duplicate node" aria-label="Duplicate node"><Icon name="copy" /></button>
        <button className="sn-actions__btn sn-actions__btn--danger nodrag" onClick={() => removeNode(id)} title="Delete node" aria-label="Delete node"><Icon name="trash" /></button>
      </div>

      <div className="sn sn--motion">
        <Handle type="target" position={Position.Left} id="text" className="sn-port sn-port--text" style={{ top: 72 }}>
          <span className="sn-port__glyph">T</span>
        </Handle>
        <Handle type="target" position={Position.Left} id="video" className="sn-port sn-port--video" style={{ top: 116 }}>
          <span className="sn-port__glyph">V</span>
        </Handle>
        <Handle type="target" position={Position.Left} id="image_ref" className="sn-port sn-port--image" style={{ top: 160 }}>
          <span className="sn-port__glyph">I</span>
        </Handle>

        <div className="sn-bar">
          <Icon name="motion" kind="video" className="sn-label__icon" />
          <input
            className="sn-label__name nodrag"
            value={d.label || 'Motion Control'}
            onChange={(e) => updateNodeData(id, { label: e.target.value })}
            placeholder="Motion Control"
            aria-label="Motion Control node name"
          />
          <NodeInfoBadge type="motion" />
          {d.status === 'running' ? (
            <span className="sn-count sn-count--running">{d.statusNote || 'Working…'}</span>
          ) : (
            <span className="sn-motion__badge">
              {pieces.length ? `${done}/${pieces.length} clips` : '10s each'}
            </span>
          )}
        </div>

        <div className="sn-motion__body">
          <div className="sn-motion__intro"><span>Motion studio</span><p>Borrow the movement. Make it your own.</p></div>
          <div className="sn-motion__field">
          <label className="sn-field__label" htmlFor={`motion-mode-${id}`}><span className="sn-motion__step">01</span>Choose a transformation</label>
          <select
            id={`motion-mode-${id}`}
            className="sn-bar__sel nodrag nowheel"
            aria-describedby={`motion-intent-${id}`}
            value={mode}
            onChange={(e) => updateNodeData(id, { motionMode: e.target.value })}
          >
            {MODES.map((m) => (
              <option key={m} value={m}>{MODE_INTENT[m].title}</option>
            ))}
          </select>

          {/* What the chosen mode actually preserves. The three are easy to
              confuse, and choosing the wrong one wastes a generation. */}
          <div className="sn-motion__intent" id={`motion-intent-${id}`}>
            <p><strong>Keeps</strong><span>{MODE_INTENT[mode].keeps}</span></p>
            <p><strong>Changes</strong><span>{MODE_INTENT[mode].replaces}</span></p>
          </div>
          </div>

          <div className="sn-motion__field">
          <label className="sn-field__label" htmlFor={`motion-engine-${id}`}><span className="sn-motion__step">02</span>Director AI engine</label>
          <select
            id={`motion-engine-${id}`}
            className="sn-bar__sel nodrag nowheel"
            aria-describedby={`motion-engine-note-${id}`}
            value={d.platform || 'gemini'}
            onChange={(e) => updateNodeData(id, { platform: e.target.value })}
          >
            <option value="gemini">Gemini</option>
            <option value="chatgpt">ChatGPT</option>
          </select>
          <div className="sn-motion__hint" id={`motion-engine-note-${id}`}>
            Reviews each piece in sequence to write connected prompts.
          </div>
          </div>

          {/* Two ways in, and the node has to offer both. V takes the video
              from a Cut or Clipping node upstream; this takes one straight
              from disk when there is no pipeline in front of it. */}
          <div className="sn-motion__field">
          <div className="sn-field__label"><span className="sn-motion__step">03</span>Source video</div>
          <label className={`sn-motion__upload nodrag ${d.sourceName ? 'sn-motion__upload--full' : ''}`}>
            <input
              type="file"
              accept="video/*"
              aria-label={d.sourceName ? 'Replace source video' : 'Choose source video'}
              onChange={(e) => onFile(e.target.files?.[0] ?? null)}
            />
            <span className="sn-motion__upload-icon"><Icon name={d.sourceName ? 'clip' : 'import'} /></span>
            {d.sourceName ? (
              <>
                <strong className="sn-motion__filename" title={d.sourceName}>{d.sourceName}</strong>
                <span className="sn-motion__hint">
                  {d.sourceSize ? `${(d.sourceSize / 1e6).toFixed(0)} MB · ` : ''}Click to replace
                </span>
              </>
            ) : (
              <>
                <strong>Choose source video</strong>
                <span className="sn-motion__hint">Browse a video on your computer</span>
              </>
            )}
          </label>
          <p className="sn-motion__hint">Or connect the <strong>V</strong> input to a Cut or Clipping node. Split into pieces up to 10s.</p>
          <label className="sn-motion__audio-toggle nodrag">
            <input type="checkbox" checked={d.motionMuteAudio === true} disabled={isRunning}
              onChange={(e) => updateNodeData(id, { motionMuteAudio: e.target.checked })} />
            <span><strong>Remove source audio</strong><small>For the next full Run. Uploads silent pieces; your original file stays unchanged. Audio is not restored afterward.</small></span>
          </label>
          </div>

          <div className="sn-motion__connections" aria-label="Node connections">
            <span><b>T</b> Instructions</span><span><b>V</b> Motion source</span><span><b>I</b> Reference image</span>
          </div>

          {/* Only worth saying while there is nothing to fall back on. Once the
              pieces are cut and uploaded they generate from their names, so a
              retry does not need the file and this would be a false alarm. */}
          {!haveSource && !!d.sourceName && !pieces.length && (
            <div className="sn-story__empty">
              {d.sourceName} is not loaded any more — the bytes do not survive a
              reload. Choose it again.
            </div>
          )}

          {pieces.length > 0 && <div className="sn-motion__results-heading"><strong>Generated pieces</strong><span>{done} of {pieces.length} complete</span></div>}
          {pieces.map((p) => (
            <div className={`sn-motion__piece sn-motion__piece--${p.status}`} key={p.index}>
              <div className="sn-motion__piece-head">
                <span className="sn-story__n">{String(p.index).padStart(2, '0')}</span>
                <span className="sn-story__name" title={p.filename}>
                  {p.startSec.toFixed(1)}s–{p.endSec.toFixed(1)}s
                  {p.cutsSpeech ? ' · cuts mid-speech' : ''}
                </span>
                <span className="sn-story__meta" title={p.why || ''}>{STATE_WORD[p.status]}</span>
              </div>
              {p.audioMuted && <span className="sn-motion__hint">Source audio removed</span>}

              {p.status === 'done' && <MotionPreview key={`${p.videoUrl || ''}|${p.posterUrl || ''}`}
                videoUrl={p.videoUrl} posterUrl={p.posterUrl} index={p.index} />}

              <details className="sn-motion__prompt nodrag nowheel">
              <summary>Review or edit prompt</summary>
              {/* Editable, because a piece that came back wrong is usually a
                  wording problem and re-asking the director costs a whole
                  conversation. */}
              <textarea
                className="sn-text nodrag nowheel"
                rows={3}
                value={p.prompt}
                placeholder="What should happen in this piece"
                aria-label={`Prompt for piece ${p.index}`}
                disabled={isRunning}
                onChange={(e) => patchPiece(p.index, { prompt: e.target.value })}
              />
              </details>

              {p.status === 'error' && (
                <small className="sn-motion__err" title={p.errorMessage}>
                  {p.errorMessage}
                </small>
              )}
              {p.status === 'error' && !p.audioMuted && (
                <button type="button" className="sn-motion__reload nodrag" disabled={isRunning}
                  onClick={() => {
                    if (!window.confirm('Remove the audio track from this piece and retry its generation? The original file stays unchanged. This may use generation credits.')) return;
                    updateNodeData(id, {
                      motionRetryPiece: p.index,
                      motionPieces: pieces.map((row) => row.index === p.index
                        ? { ...row, muteRequested: true, status: 'idle', errorMessage: undefined } : row),
                    });
                    window.dispatchEvent(new CustomEvent('studio:retry-node', { detail: id }));
                  }}>Retry without audio</button>
              )}

              <button
                type="button"
                className="sn-retry-btn nodrag"
                disabled={isRunning || p.status === 'running'}
                onClick={(e) => {
                  e.stopPropagation();
                  if (p.status !== 'done' || window.confirm('Regenerate this completed clip? This runs a new generation and may use credits. To fix playback, use Reload preview instead.')) retryPiece(p.index);
                }}
                title={p.status === 'done'
                  ? 'Throw this clip away and make it again from the same footage'
                  : 'Make just this piece — the others are left alone'}
              >
                <Icon name="retry" /> {p.status === 'done' ? 'Regenerate clip' : 'Make this piece'}
              </button>
            </div>
          ))}

          {/* Said plainly, because it is the honest cost of going over 10s and
              nothing downstream can fix it. */}
          {pieces.length > 1 && (
            <div className="sn-story__note">
              {pieces.length} separately generated clips. Review the transitions before combining them; visual continuity may vary.
            </div>
          )}

          {/* Asked BEFORE the run, not after it has stopped. The switch is the
              one prerequisite this node cannot work around, and finding out
              about it by failing costs the cut, the director conversation and
              the uploads that came before the question. */}
          {uploadOn === false && (
            <div className="sn-story__error">
              <div className="sn-story__error-head">
                <span className="sn-story__error-title">⚠️ Uploads are off</span>
                <button
                  type="button"
                  className="sn-story__retry-btn nodrag"
                  onClick={(e) => { e.stopPropagation(); allowUploads(); }}
                >
                  Turn on
                </button>
              </div>
              <p className="sn-story__error-msg">
                This node has to put the video pieces into Flow, and that drives a real
                file chooser — Chrome shows a debugging banner while it runs. Nothing
                happens until you allow it.
              </p>
            </div>
          )}

          {/* The node's OWN failure, as opposed to a piece's.
           *
           * Everything before the first cut fails here: no video, the upload
           * switch off, a source with no readable duration. None of those
           * produce a piece, so with only per-piece errors on the node a run
           * that stopped at the very first step showed nothing at all — the
           * toolbar said "1 failed" and the node looked untouched. The message
           * being long and specific made that worse, not better: it existed
           * and there was nowhere for it to be read.
           *
           * Same shape as the Chief's, because it is the same situation. */}
          {d.status === 'error' && !!d.errorMessage && (
            <div className="sn-story__error">
              <div className="sn-story__error-head">
                <span className="sn-story__error-title">⚠️ Did not start</span>
                <button
                  type="button"
                  className="sn-story__retry-btn nodrag"
                  onClick={(e) => {
                    e.stopPropagation();
                    window.dispatchEvent(new CustomEvent('studio:retry-node', { detail: id }));
                  }}
                >
                  ↻ Retry
                </button>
              </div>
              <p className="sn-story__error-msg">{d.errorMessage}</p>
            </div>
          )}

          {d.motionDirected === false && (
            <div className="sn-story__empty">
              These prompts are the plain instruction — the director could not be
              reached, so every piece got the same sentence.
            </div>
          )}
        </div>

        <Handle type="source" position={Position.Right} id="text" className="sn-port sn-port--out" style={{ top: '50%' }}>
          <span className="sn-port__glyph">→</span>
        </Handle>
      </div>
    </div>
  );
}

export const MotionNode = memo(MotionNodeInner);
export default MotionNode;
