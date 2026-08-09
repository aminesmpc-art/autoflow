/* ============================================================
   GenerateNode — Core generation node for Google Flow
   Media-dominant layout: the result IS the node. Title and
   platform badge sit outside the card; settings collapse into
   a compact strip along the bottom.
   ============================================================ */

import { memo, useCallback, useState } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Lightbox } from '../components/Lightbox';
import { useStudioStore } from '../store';
import { AVAILABLE_MODELS, AVAILABLE_IMAGE_MODELS, modelHasDuration } from '../../types';
import { getAskPresets, DEFAULT_PRESET_ID, findPreset } from '../presets';
import { portsFor, retargetImagePorts } from '../templates/validate';
import { CHAT_PLATFORMS } from '../engine/WorkflowRunner';

type NodeStatus = 'idle' | 'running' | 'done' | 'error';
type Platform = 'flow' | 'chatgpt' | 'gemini' | 'grok';

/** What each chat platform is called on screen. */
const CHAT_NAMES: Record<string, string> = {
  chatgpt: 'ChatGPT',
  gemini: 'Gemini',
  grok: 'Grok',
};

/**
 * How each input port draws.
 *
 * Which ports exist is decided by portsFor; this only says what they look
 * like. Start and End get letters rather than two identical picture glyphs,
 * because which is which is the entire meaning of the mode.
 */
const PORT_SPECS: Record<string, { glyph: string; cls: string; top: string; title: string }> = {
  text: { glyph: 'T', cls: 'sn-port--text', top: '38%', title: 'Prompt' },
  /* Prompt writers take references too, now that the ChatGPT script actually
     uploads them. Showing this frame to Ask AI and asking what happens next is
     the reason to want a prompt writer at all — it was hidden only while an
     attached image would have been dropped. */
  image_ref: { glyph: '🖼', cls: 'sn-port--image', top: '62%', title: 'Reference image' },
  frame_start: { glyph: 'S', cls: 'sn-port--image', top: '58%', title: 'Start frame — where the clip opens' },
  frame_end: { glyph: 'E', cls: 'sn-port--image', top: '78%', title: 'End frame — where the clip lands' },
};

/* Model names must match what Flow renders on the page — single source of truth */
const VIDEO_MODELS: readonly string[] = AVAILABLE_MODELS;
const IMAGE_MODELS: readonly string[] = AVAILABLE_IMAGE_MODELS;

const IMAGE_RATIOS = ['9:16', '16:9', '1:1', '4:3', '3:4'];
const VIDEO_RATIOS = ['9:16', '16:9', '1:1'];
/* Flow offers 10s as well — omitting it meant the longest clip length was
   simply unreachable from Studio. */
const DURATIONS = ['4s', '6s', '8s', '10s'];

/* Grok Imagine's own sets, read off its controls. Its duration radio group
   offers 6/10/15 and its resolution group 480/720/1080 — none of which
   overlap Flow's, which is why they are separate lists rather than a merged
   one that would offer a button Grok does not have. */
const GROK_DURATIONS = ['6s', '10s', '15s'];
const GROK_RESOLUTIONS = ['480p', '720p', '1080p'];
const GROK_RATIOS = ['9:16', '16:9', '1:1'];

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

  /* Switching FROM changes which image ports the node draws, so the wires
     already attached have to move with it. Left alone they point at a handle
     that is no longer rendered: React Flow stops drawing the edge, the runner
     stops finding it, and the clip comes back generated from the prompt with
     no sign anything was lost. */
  const handleCreationType = useCallback(
    (value: string) => {
      const toFrames = value === 'frames';
      const { edges, setEdges } = useStudioStore.getState();
      const { edges: moved, dropped } = retargetImagePorts(id, edges, toFrames);
      setEdges(moved);
      updateNodeData(id, {
        creationType: value,
        // Two stills is the whole mode; say what happened to the third.
        framesNotice: dropped
          ? `${dropped} extra image connection${dropped > 1 ? 's' : ''} removed — Frames uses two.`
          : '',
      });
    },
    [id, updateNodeData]
  );

  /* Whether anything is wired into the T input. React Flow keeps the edges in
     the store, so the node can answer this itself rather than being told. */
  const hasPrompt = useStudioStore(
    (st) => st.edges.some((e) => e.target === id && e.targetHandle === 'text')
  );

  const status: NodeStatus = nodeData.status || 'idle';
  /* Chat platforms behave identically here: they answer in text or images and
     have no model, ratio or duration to choose. One flag for "is a chat" is
     what let Grok become the fourth without rewiring this file. */
  const platform: Platform =
    CHAT_PLATFORMS.includes(nodeData.platform) ? nodeData.platform : 'flow';
  const isChat = platform !== 'flow';
  const isChatGPT = isChat;
  const chatName = CHAT_NAMES[platform] || 'ChatGPT';
  const mediaType = nodeData.mediaType || 'image';
  /* Grok Imagine generates video too, so "is this a clip" stopped being the
     same question as "is this Flow". Everything Flow-specific below — the
     model list, Frames mode — still checks the platform rather than this. */
  const isGrok = platform === 'grok';
  const isVideo = mediaType === 'video' && (platform === 'flow' || isGrok);
  /* Frames mode: Flow takes a first and last still and interpolates between
     them. Video only — an image has no "between". */
  const isFrames = isVideo && platform === 'flow' && nodeData.creationType === 'frames';
  /* Text output only makes sense on a chat platform — Flow has no chat. */
  const isText = isChat && mediaType === 'text';
  const models = isVideo ? VIDEO_MODELS : IMAGE_MODELS;
  /* Grok offers its own values and only its own. Showing Flow's would let a
     node ask for 4s or 4:3, which Imagine has no button for — the run would
     keep whatever was already set and nothing would say why. */
  const ratios = isGrok ? GROK_RATIOS : isVideo ? VIDEO_RATIOS : IMAGE_RATIOS;
  const durations = isGrok ? GROK_DURATIONS : DURATIONS;
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

      {/* ── External title ──
          The toggle lives up here rather than floating inside the card. It was
          pinned over the top-right of the media area, where it sat on top of
          empty space on an idle node and on top of the result once there was
          one. */}
      <div className="sn-label">
        <span className="sn-label__icon" aria-hidden="true">{isText ? '💬' : isVideo ? '🎞' : '🖼'}</span>
        <span className="sn-label__text">
          {nodeData.label || (isText ? 'Ask AI' : 'Flow — Image/Video Generate')}
        </span>
        {!enabled && <span className="sn-label__skip">SKIPPED</span>}
        <button
          className={`sn-toggle ${enabled ? 'sn-toggle--on' : ''}`}
          onClick={() => set('enabled', !enabled)}
          title={enabled ? 'Node enabled — click to skip it on run' : 'Node skipped — click to enable'}
          aria-label="Toggle node"
        >
          <span className="sn-toggle__knob" />
        </button>
      </div>

      {/* ── The card ── */}
      <div className={`sn ${statusClass(status)} ${!enabled ? 'sn--disabled' : ''}`}>

        {/* ── Media area — full ratio only once there's something to show ── */}
        {/* Text has no aspect ratio — a 9:16 box of empty space reads as a
            broken image node. Give it a compact panel that grows with the
            answer instead. */}
        {/* Hold the chosen aspect ratio only once there is something in it.
            A 9:16 node reserved 400px of empty black before it had run, so a
            three-node workflow scrolled like a ten-node one and the settings
            — the part you actually touch before running — sat below the fold. */}
        <div
          className={`sn-media ${!(status === 'done' && (preview || previewVideo)) ? 'sn-media--empty' : ''}`}
          style={
            isText
              ? { minHeight: 120, maxHeight: 260 }
              : (status === 'done' && (preview || previewVideo))
                ? { aspectRatio: ratioToCss(ratio) }
                : { height: 132 }
          }
        >
          {status === 'done' && previewVideo && (
            <>
              {/* nodrag/nowheel: using the player must not pan or zoom the canvas */}
              <video
                className="sn-media__img nodrag nowheel"
                src={previewVideo}
                poster={preview || undefined}
                controls
                loop
                muted
                playsInline
              />
              {/* The player owns clicks, so full-size needs its own control */}
              <button
                className="sn-media__expand"
                onClick={() => setZoomed(true)}
                title="View full size"
                aria-label="View full size"
              >⤢</button>
            </>
          )}

          {status === 'done' && !previewVideo && preview && (
            <>
              <img className="sn-media__img sn-media__img--zoom" src={preview} alt="Generated result" onClick={() => setZoomed(true)} title="Click to view full size" />
              {isVideo && <span className="sn-media__badge">▶ Video — open in Flow to play</span>}
            </>
          )}

          {/* A written prompt is the result here, so show it — it is the thing
              the next node will run, and worth reading before it does. */}
          {status === 'done' && isText && nodeData.resultText && (
            <div className="sn-reply" title={nodeData.resultText}>
              {nodeData.resultText}
            </div>
          )}

          {status === 'done' && !isText && !previewVideo && !preview && (
            <div className="sn-media__state">
              <span className="sn-media__state-icon">🖼</span>
              <span>Generated on {isChat ? chatName : 'Flow'}</span>
              <small>{isChat ? `Prompt submitted — see the ${chatName} tab` : 'Preview unavailable'}</small>
            </div>
          )}

          {status === 'running' && (
            <div className="sn-media__state sn-media__state--running">
              <div className="sn-spinner" />
              <span>{isText ? `Asking ${chatName}…` : `Generating ${isVideo ? 'video' : 'image'}…`}</span>
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
              {/* Retry this node and whatever was skipped below it, without
                  re-running the clips that already succeeded. Dispatched as an
                  event so the node needs no wiring to the runner. */}
              <button
                type="button"
                className="sn-retry-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  window.dispatchEvent(new CustomEvent('studio:retry-node', { detail: id }));
                }}
                title="Re-run just this node and anything skipped because of it"
              >
                ↻ Retry
              </button>
            </div>
          )}

          {status === 'idle' && (
            <div className="sn-media__state sn-media__state--idle">
              {/* An outline in the chosen ratio. The box itself is compact
                  until there is a result to show, so without this nothing on
                  an idle node said whether it was making a portrait or a
                  landscape — and the ratio buttons are three identical pills
                  otherwise. */}
              {isText ? (
                <span className="sn-media__state-icon">💬</span>
              ) : (
                <span className="sn-media__ghost" style={{ aspectRatio: ratioToCss(ratio) }}>
                  <span className="sn-media__state-icon">{isVideo ? '🎞' : '🖼'}</span>
                </span>
              )}
              {/* Said "Connect a prompt" even when one was connected, so a
                  ready node looked unfinished. It knows the answer — the T
                  handle either has an edge or it does not. */}
              <small>
                {hasPrompt
                  ? 'Ready — press Run'
                  : isText
                    ? 'Connect what to ask, then Run — the answer feeds the next node'
                    : 'Connect a prompt, then Run'}
              </small>
            </div>
          )}
        </div>

        {/* ── Settings ──
            A two-column grid rather than a wrapping row. As a flex row the
            controls paired up differently every time an option appeared or
            vanished — Ratio would end a line alone with half the card empty
            beside it — and only some of them carried a label, so Flow and
            Video were two unexplained dropdowns. Everything is labelled and
            everything lands on a column now. */}
        <div className="sn-bar sn-bar--grid">
          <label className="sn-field" title="Which service runs this node">
            <span className="sn-field__label">Platform</span>
            <select
              className="sn-bar__sel nodrag"
              value={platform}
              onChange={(e) => set('platform', e.target.value)}
            >
              <option value="flow">Flow</option>
              <option value="chatgpt">ChatGPT</option>
              <option value="gemini">Gemini</option>
              <option value="grok">Grok</option>
            </select>
          </label>

          {/* ChatGPT can either draw or write. Asking it to write turns this
              node into a prompt writer whose answer feeds the next node. */}
          {isChatGPT && (
            <label className="sn-field" title={`Ask ${chatName} for an image, or for a written prompt`}>
              <span className="sn-field__label">Output</span>
              <select
                className="sn-bar__sel nodrag"
                value={mediaType === 'text' ? 'text' : isGrok && mediaType === 'video' ? 'video' : 'image'}
                onChange={(e) => set('mediaType', e.target.value)}
              >
                <option value="image">Image</option>
                {/* Imagine generates clips; the other chats do not. */}
                {isGrok && <option value="video">Video</option>}
                <option value="text">Text</option>
              </select>
            </label>
          )}

          {!isChatGPT && (
            <label className="sn-field" title="Output type">
              <span className="sn-field__label">Output</span>
              <select
                className="sn-bar__sel nodrag"
                value={mediaType}
                onChange={(e) => handleMediaType(e.target.value)}
              >
                <option value="image">Image</option>
                <option value="video">Video</option>
              </select>
            </label>
          )}

          {isVideo && (
            <label className="sn-field sn-field--wide" title="Ingredients: reference images. Frames: a first and last still, interpolated.">
              <span className="sn-field__label">Build from</span>
              <select
                className="sn-bar__sel nodrag"
                value={nodeData.creationType || 'ingredients'}
                onChange={(e) => handleCreationType(e.target.value)}
              >
                <option value="ingredients">Ingredients — reference images</option>
                <option value="frames">Start &amp; End frames</option>
              </select>
            </label>
          )}

          {isVideo && isFrames && (
            <small className="sn-field__hint sn-field--wide">
              {nodeData.framesNotice
                ? nodeData.framesNotice
                : 'Wire an image into S and one into E — S is where the clip opens.'}
            </small>
          )}

          {isText && (
            <label className="sn-field sn-field--wide" title="Wraps what you type in a brief, so a few words produce a usable prompt">
              <span className="sn-field__label">Preset</span>
              <select
                className="sn-bar__sel nodrag"
                value={nodeData.preset || DEFAULT_PRESET_ID}
                onChange={(e) => set('preset', e.target.value)}
              >
                {getAskPresets().map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </label>
          )}

          {/* The hint is the whole point: a dropdown of names teaches nothing,
              and the difference between these is what they ask the model to do. */}
          {isText && (
            <small className="sn-field__hint sn-field--wide">{findPreset(nodeData.preset).hint}</small>
          )}

          {/* Flow exposes model/ratio/duration; the ChatGPT composer has none */}
          {!isChatGPT && (
            <>
              {/* Model takes the full width — the names are long
                  ("Veo 3.1 - Lite [Lower Priority]") and it is the setting
                  people change most after the prompt. */}
              <label className="sn-field sn-field--wide" title="Model">
                <span className="sn-field__label">Model</span>
                <select
                  className="sn-bar__sel nodrag"
                  /* Fall back when the saved model is no longer offered.
                     Imagen 4 left Flow's menu; a workflow saved with it kept
                     rendering a select with a value not in its options, which
                     shows blank and leaves setModel asking for a model that
                     does not exist — so the run silently used Flow's default. */
                  value={models.includes(nodeData.model) ? nodeData.model : models[0]}
                  onChange={(e) => set('model', e.target.value)}
                >
                  {models.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </label>

              {/* Only Omni lets you choose a length. The Veo panels have no
                  duration row, so offering the control there promised a
                  setting that could not be applied — the run asked for 6s and
                  got whatever Flow decided, with a warning that read like a
                  failed click. */}
              {isVideo && modelHasDuration(nodeData.model || models[0]) && (
                <div className="sn-field sn-field--wide" title="Clip length">
                  <span className="sn-field__label">Length</span>
                  <div className="sn-seg nodrag">
                    {DURATIONS.map((d) => (
                      <button
                        key={d}
                        type="button"
                        className={`sn-seg__btn ${(nodeData.duration || '6s') === d ? 'sn-seg__btn--on' : ''}`}
                        onClick={() => set('duration', d)}
                      >
                        {d}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Pills rather than a dropdown: there are only three or five,
                  the current one is readable without opening anything, and the
                  node takes the shape you pick — so this is the control most
                  worth being able to see at a glance. */}
              <div className="sn-field sn-field--wide" title="Aspect ratio">
                <span className="sn-field__label">Ratio</span>
                <div className="sn-seg nodrag">
                  {ratios.map((r) => (
                    <button
                      key={r}
                      type="button"
                      className={`sn-seg__btn ${ratio === r ? 'sn-seg__btn--on' : ''}`}
                      onClick={() => set('aspectRatio', r)}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
          {/* Grok Imagine has no model list, but it does have the three
              controls its own toolbar shows. */}
          {isGrok && isVideo && (
            <>
              <div className="sn-field sn-field--wide" title="Clip length">
                <span className="sn-field__label">Length</span>
                <div className="sn-seg nodrag">
                  {durations.map((d) => (
                    <button
                      key={d}
                      type="button"
                      className={`sn-seg__btn ${(nodeData.duration || '10s') === d ? 'sn-seg__btn--on' : ''}`}
                      onClick={() => set('duration', d)}
                    >
                      {d}
                    </button>
                  ))}
                </div>
              </div>

              <div className="sn-field sn-field--wide" title="Resolution">
                <span className="sn-field__label">Resolution</span>
                <div className="sn-seg nodrag">
                  {GROK_RESOLUTIONS.map((r) => (
                    <button
                      key={r}
                      type="button"
                      className={`sn-seg__btn ${(nodeData.resolution || '720p') === r ? 'sn-seg__btn--on' : ''}`}
                      onClick={() => set('resolution', r)}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              </div>

              <div className="sn-field sn-field--wide" title="Aspect ratio">
                <span className="sn-field__label">Ratio</span>
                <div className="sn-seg nodrag">
                  {ratios.map((r) => (
                    <button
                      key={r}
                      type="button"
                      className={`sn-seg__btn ${ratio === r ? 'sn-seg__btn--on' : ''}`}
                      onClick={() => set('aspectRatio', r)}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {isChatGPT && (
            <span className="sn-bar__hint sn-field--wide">
              {isText
                ? `Writes a prompt · needs a ${chatName} tab`
                : isGrok && isVideo
                  ? 'Clip · needs a Grok Imagine tab'
                  : `Image · needs a ${chatName} tab`}
            </span>
          )}
        </div>

        {/* ── Handles: large, labelled, outside the edge ──
            Drawn from portsFor, the same function the validator checks edges
            against. Hard-coding them here is how Frames mode shipped with two
            ports the runner read and the node never drew: every image landed
            on image_ref, the runner looked at frame_start, and the node
            generated from the prompt alone. */}
        {(portsFor({ type: 'generate', data: nodeData })?.in || []).map((port) => {
          const spec = PORT_SPECS[port];
          if (!spec) return null;
          return (
            <Handle
              key={port}
              type="target"
              position={Position.Left}
              id={port}
              className={`sn-port ${spec.cls}`}
              style={{ top: spec.top }}
              title={spec.title}
            >
              <span className="sn-port__glyph">{spec.glyph}</span>
            </Handle>
          );
        })}
        {/* Text answers leave on the text port so they land on the next node's
            T input; media leaves on result, which carries the reference. */}
        {isText ? (
          <Handle type="source" position={Position.Right} id="text" className="sn-port sn-port--text" style={{ top: '50%' }}>
            <span className="sn-port__glyph">T</span>
          </Handle>
        ) : (
          <Handle type="source" position={Position.Right} id="result" className="sn-port sn-port--out" style={{ top: '50%' }}>
            <span className="sn-port__glyph">→</span>
          </Handle>
        )}
      </div>

      {/* ── External platform badge ── */}
      <div className="sn-platform">
        <span className={`sn-platform__dot ${isChat ? `sn-platform__dot--${platform}` : ''}`} />
        {isChat ? `${chatName} ${isText ? 'Writer' : 'Images'}` : 'Google Flow'}
      </div>

      {/* Prefer the video when there is one — previously only the still could
          be opened, so a generated clip had no full-size view at all. */}
      {zoomed && (previewVideo || preview) && (
        <Lightbox
          src={previewVideo || preview}
          kind={previewVideo ? 'video' : 'image'}
          alt="Generated result, full size"
          onClose={() => setZoomed(false)}
        />
      )}
    </div>
  );
}

export const GenerateNode = memo(GenerateNodeComponent);
