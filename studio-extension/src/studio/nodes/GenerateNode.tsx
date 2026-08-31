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
import {
  AVAILABLE_MODELS, AVAILABLE_IMAGE_MODELS, modelHasDuration, modelHasResolution,
} from '../../types';
import { getAskPresets, DEFAULT_PRESET_ID, findPreset } from '../presets';
import { portsFor, retargetImagePorts } from '../templates/validate';
import { CHAT_PLATFORMS } from '../engine/WorkflowRunner';
import { FLOW_VOICES, NO_VOICE, voiceLabel, voiceBlockedReason } from '../flowVoices';
import { GrokSettings } from './GrokSettings';
import { NodeInfoBadge } from './NodeInfoBadge';

type NodeStatus = 'idle' | 'running' | 'done' | 'error';
type Platform = 'flow' | 'chatgpt' | 'gemini' | 'grok' | 'claude' | 'zai';

/** What each chat platform is called on screen. */
const CHAT_NAMES: Record<string, string> = {
  chatgpt: 'ChatGPT',
  gemini: 'Gemini',
  grok: 'Grok',
  claude: 'Claude',
  zai: 'Z.AI',
};

/**
 * How each input port draws.
 *
 * Which ports exist is decided by portsFor; this only says what they look
 * like. Start and End get letters rather than two identical picture glyphs,
 * because which is which is the entire meaning of the mode.
 */
const PORT_SPECS: Record<string, { glyph: string; cls: string; top: string; title: string }> = {
  text: { glyph: 'T', cls: 'sn-port--text', top: '28%', title: 'Prompt input' },
  /* Prompt writers take references too, now that the ChatGPT script actually
     uploads them. Showing this frame to Ask AI and asking what happens next is
     the reason to want a prompt writer at all. */
  image_ref: { glyph: '🖼', cls: 'sn-port--image', top: '72%', title: 'Reference image' },
  frame_start: { glyph: 'S', cls: 'sn-port--image', top: '56%', title: 'Start frame — where the clip opens' },
  frame_end: { glyph: 'E', cls: 'sn-port--image', top: '80%', title: 'End frame — where the clip lands' },
};

/* Model names must match what Flow renders on the page — single source of truth */
const VIDEO_MODELS: readonly string[] = AVAILABLE_MODELS;
const IMAGE_MODELS: readonly string[] = AVAILABLE_IMAGE_MODELS;

const IMAGE_RATIOS = ['9:16', '16:9', '1:1', '4:3', '3:4'];
const VIDEO_RATIOS = ['9:16', '16:9', '1:1'];
/* Gemini's /videos route offers Landscape and Portrait, nothing else. */
const GEMINI_VIDEO_RATIOS = ['9:16', '16:9'];
/* Flow offers 10s as well — omitting it meant the longest clip length was
   simply unreachable from Studio. */
const DURATIONS = ['4s', '6s', '8s', '10s'];

/* Flow's composer offers these two and nothing else. 720p is its own default
   and the one that matches what the rest of the pipeline expects, so it is the
   default here too — 360p is a deliberate choice to spend fewer credits. */
const RESOLUTIONS = ['360p', '720p'];

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

  /* Whether any still is wired in — the ingredient tray, or either end of a
     Frames pair. Flow gives a voice to a character, so this decides whether
     the Voice control below can do anything at all. */
  const hasImageInput = useStudioStore(
    (st) => st.edges.some((e) => e.target === id
      && ['image_ref', 'image', 'frame_start', 'frame_end'].includes(e.targetHandle || '')),
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
  const isClaude = platform === 'claude';
  const mediaType = isClaude ? 'text' : (nodeData.mediaType || 'image');
  /* Grok Imagine generates video too, so "is this a clip" stopped being the
     same question as "is this Flow". Everything Flow-specific below — the
     model list, Frames mode — still checks the platform rather than this. */
  const isGrok = platform === 'grok';
  const isFlow = platform === 'flow';
  /* Gemini's /videos route generates clips, so "is this a clip" is no longer
     the same question as "is this Flow or Imagine". */
  const isGemini = platform === 'gemini';
  const isVideo = mediaType === 'video' && (platform === 'flow' || isGrok || isGemini);
  /* Frames mode: Flow takes a first and last still and interpolates between
     them. Video only — an image has no "between". */
  const isFrames = isVideo && platform === 'flow' && nodeData.creationType === 'frames';
  /* Text output only makes sense on a chat platform — Flow has no chat. */
  const isText = isChat && (mediaType === 'text' || isClaude);
  const models = isVideo ? VIDEO_MODELS : IMAGE_MODELS;
  /* Flow's, and only Flow's. Imagine's live in GrokSettings, which is the
     point of the split — these lists no longer have to know another platform
     exists. */
  const ratios = isVideo ? VIDEO_RATIOS : IMAGE_RATIOS;
  const durations = DURATIONS;
  const ratio = nodeData.aspectRatio || '9:16';
  const progress = nodeData.progress || 0;
  const enabled = nodeData.enabled !== false;

  // Self-contained data URLs built by the content script.
  const preview = nodeData.previewUrl || '';
  const previewVideo = nodeData.previewVideoUrl || '';

  return (
    /* The family this card belongs to, so a busy canvas is readable
       zoomed out. Flow, Grok and the chat writers look nothing alike in what
       they do and looked identical on screen. */
    <div className={`sn-wrap sn-wrap--kind-${
      platform === 'flow' ? 'flow' : platform === 'grok' ? 'grok' : 'chat'
    } ${selected ? 'sn-wrap--selected' : ''}`}>
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
        <NodeInfoBadge type="generate" />
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
              {isText ? (
                <div className="sn-craft-card">
                  <div className="sn-craft-card__head">
                    <span className="sn-craft-card__badge">✨ AI Prompt Master</span>
                    <span className="sn-craft-card__token">{"{{subject}}"}</span>
                  </div>
                  <div className="sn-craft-card__name">
                    {findPreset(nodeData.preset).name}
                  </div>
                  <small className="sn-craft-card__hint">
                    {hasPrompt ? '● Ready — input prompt connected' : '○ Wire a prompt into (T), then Run'}
                  </small>
                </div>
              ) : (
                <>
                  <span className="sn-media__ghost" style={{ aspectRatio: ratioToCss(ratio) }}>
                    <span className="sn-media__state-icon">{isVideo ? '🎞' : '🖼'}</span>
                  </span>
                  <small>
                    {hasPrompt
                      ? 'Ready — press Run'
                      : 'Connect a prompt, then Run'}
                  </small>
                </>
              )}
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
              onChange={(e) => {
                const newPlatform = e.target.value;
                if (newPlatform === 'claude') {
                  updateNodeData(id, { platform: 'claude', mediaType: 'text' });
                } else if (newPlatform === 'flow') {
                  updateNodeData(id, { platform: 'flow', mediaType: mediaType === 'text' ? 'video' : mediaType });
                } else {
                  set('platform', newPlatform);
                }
              }}
            >
              <option value="flow">Flow</option>
              <option value="chatgpt">ChatGPT</option>
              <option value="gemini">Gemini</option>
              <option value="grok">Grok</option>
              <option value="claude">Claude</option>
              <option value="zai">Z.AI</option>
            </select>
          </label>

          {/* Chat platforms can draw or write (except Claude which is text-only) */}
          {isChat && (
            <label className="sn-field" title={`Ask ${chatName} for an image, or for a written prompt`}>
              <span className="sn-field__label">Output</span>
              <select
                className="sn-bar__sel nodrag"
                value={isClaude
                  ? 'text'
                  : (mediaType === 'text'
                    ? 'text'
                    : (isGrok || isGemini) && mediaType === 'video' ? 'video' : 'image')}
                onChange={(e) => set('mediaType', e.target.value)}
              >
                {!isClaude && <option value="image">Image</option>}
                {/* Imagine and Gemini generate clips; ChatGPT and Claude do not. */}
                {(isGrok || isGemini) && <option value="video">Video</option>}
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

          {/* Flow's alone: Imagine has neither ingredients nor Start/End frames,
              and offering the choice there promised a mode with nothing behind
              it. */}
          {isVideo && platform === 'flow' && (
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

              {/* Render resolution, which Flow added to the composer beside
                  the length. Three things it is deliberately NOT:

                  - not the download resolution in Settings (VideoResolution:
                    'Original (720p)', '1080p Upscaled', '4K'). That one is
                    picked after generating and only changes the file on disk;
                    this one is picked before, changes what the model produces,
                    and costs different credits.
                  - not Grok's `resolution`, which is 480p/720p/1080p and has
                    its own radio group in GrokSettings. Sharing that field
                    would mean a node configured for Grok at 1080p carries an
                    impossible value into Flow, so this has its own.
                  - not offered on the Veo panels, which have no such row —
                    same rule as Length, and for the same reason.

                  Flow only, because the enclosing block is merely !isChatGPT
                  and so also covers Grok and Gemini. */}
              {isFlow && isVideo && modelHasResolution(nodeData.model || models[0]) && (
                <div className="sn-field sn-field--wide" title="Resolution Flow renders at — 360p costs fewer credits">
                  <span className="sn-field__label">Resolution</span>
                  <div className="sn-seg nodrag">
                    {RESOLUTIONS.map((r) => (
                      <button
                        key={r}
                        type="button"
                        className={`sn-seg__btn ${(nodeData.renderResolution || '720p') === r ? 'sn-seg__btn--on' : ''}`}
                        onClick={() => set('renderResolution', r)}
                      >
                        {r}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Flow attaches a voice to a CHARACTER in the ingredient tray,
                  so this is a video-with-a-reference-image control and nothing
                  else. Shown on any Flow video node rather than only wired
                  ones, because the node is usually configured before it is
                  connected — but it says plainly when it will not apply, which
                  is the part that would otherwise waste a generation. */}
              {isVideo && !isGrok && (
                <label className="sn-field sn-field--wide" title="Voice for the character in this shot">
                  <span className="sn-field__label">Voice</span>
                  <select
                    className="sn-bar__sel nodrag"
                    value={nodeData.voice || NO_VOICE}
                    onChange={(e) => set('voice', e.target.value)}
                  >
                    <option value={NO_VOICE}>None — no spoken voice</option>
                    {FLOW_VOICES.map((v) => (
                      <option key={v.id} value={v.id}>{voiceLabel(v)}</option>
                    ))}
                  </select>
                </label>
              )}

              {/* The one thing a dropdown of names cannot tell you: whether the
                  voice will be used at all. Both reasons it might not are
                  silent failures — Flow generates happily and returns a mute
                  clip — so they are stated here rather than discovered by
                  watching the output. The rule comes from the same function
                  the runner applies, so the two cannot drift apart. */}
              {isVideo && !isGrok && voiceBlockedReason(
                nodeData.voice, hasImageInput, nodeData.creationType) && (
                <small className="sn-field__hint sn-field--wide">
                  {voiceBlockedReason(nodeData.voice, hasImageInput, nodeData.creationType)}
                </small>
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
          {/* Imagine's controls live in their own component: they share no
              values with Flow's and no longer have to be told apart by a
              platform test on every row. */}
          {/* Stills too. This was `isGrok && isVideo`, so a Grok Image node —
              the case with the most controls on Imagine's toolbar — rendered
              none of them, and the Ratio the runner sent was never applied. */}
          {isGrok && !isText && <GrokSettings nodeData={nodeData} set={set} isVideo={isVideo} />}

          {/* Gemini's video ratio, and only the two it has.
              Flow's Ratio pills live in the Flow-only block above, so a Gemini
              clip node had no way to choose a shape at all - the adapter reads
              config.aspectRatio and there was nothing to set it. Two options
              rather than five because /videos offers Landscape (16:9) and
              Portrait (9:16) and nothing else. */}
          {isGemini && isVideo && (
            <div className="sn-field sn-field--wide" title="Clip shape">
              <span className="sn-field__label">Ratio</span>
              <div className="sn-seg nodrag">
                {GEMINI_VIDEO_RATIOS.map((r) => (
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
          )}

            {/* Storyboard board.
                Stills only, because a board is a picture — but on EVERY
                platform, which is where this first shipped wrong. It sat
                inside the {!isChatGPT} block alongside Model and Ratio, and
                isChatGPT means "is any chat platform", not ChatGPT: so the
                one control that has nothing to do with Flow appeared only on
                Flow. Gemini and ChatGPT image nodes can draw a board perfectly
                well, and orderShotTargets never looked at the platform.

                What it changes is which rulebook the shot is checked
                against: a board is asked to name its panels and its grid,
                and a clip is refused for doing the same. */}
            {!isVideo && !isText && (
              <label
                className="sn-check nodrag"
                title="Ask the story director for one picture holding every shot as a numbered panel, instead of a single scene"
              >
                <input
                  type="checkbox"
                  checked={nodeData.storyboardSheet === true}
                  onChange={(e) => set('storyboardSheet', e.target.checked)}
                />
                <span>Storyboard board</span>
              </label>
            )}
          {isChatGPT && (
            <span className="sn-bar__hint sn-field--wide">
              {isText
                ? `Writes a prompt · needs a ${chatName} tab`
                : isVideo
                  ? `Clip · needs a ${isGrok ? 'Grok Imagine' : chatName} tab`
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
        {!isChat ? 'Google Flow'
          : isText ? `${chatName} Writer`
          /* "Imagine" is the name of Grok's product, not a word for video.
             A Gemini clip node read "Gemini Imagine", which is a product that
             does not exist. */
          : isVideo ? (isGrok ? 'Grok Imagine' : `${chatName} Video`)
          : `${chatName} Images`}
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
