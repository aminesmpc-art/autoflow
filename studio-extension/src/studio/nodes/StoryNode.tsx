/**
 * The Story node — one director for the whole workflow.
 *
 * You wire its output to every generate node that needs a prompt. It writes
 * all of them in a single reply, having been shown what each of those nodes
 * actually is: media, platform, aspect ratio, duration, and whether its first
 * frame is already pinned by an image you connected.
 *
 * Upgraded with:
 *   · Modern tabbed Director Panel (Director | Flow & Beats | Cast & World)
 *   · Cinematic Camera Progression & Audio Mode
 *   · Shot Sequencer Ribbon
 *   · Compact 2-column settings grid
 */

import { memo, useState } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Icon } from '../components/Icon';
import { useStudioStore } from '../store';
import { orderShotTargets } from '../ask/storyboard';
import {
  STRUCTURES, RULES, DEFAULT_STORY, beatSummary, beatsFor,
  CAMERA_PROGRESSIONS, AUDIO_MODES, VISUAL_PRESETS,
  type CastMember, type StorySettings, type StructureId,
  type CameraProgressionId, type AudioModeId, type VisualPresetId,
} from '../ask/storyPlan';
import { FLOW_VOICES, NO_VOICE, voiceLabel } from '../flowVoices';
import { NodeInfoBadge } from './NodeInfoBadge';

function readStory(d: any): StorySettings {
  return {
    cast: Array.isArray(d.cast) ? d.cast : DEFAULT_STORY.cast,
    world: typeof d.world === 'string' ? d.world : '',
    look: typeof d.look === 'string' ? d.look : '',
    structure: (d.structure as StructureId) || DEFAULT_STORY.structure,
    beats: Number(d.beats) || 0,
    rules: Array.isArray(d.rules) ? d.rules : DEFAULT_STORY.rules,
    cameraProgression: (d.cameraProgression as CameraProgressionId) || DEFAULT_STORY.cameraProgression || 'dynamic',
    audioMode: (d.audioMode as AudioModeId) || DEFAULT_STORY.audioMode || 'cinematic',
    visualPreset: (d.visualPreset as VisualPresetId) || DEFAULT_STORY.visualPreset || 'liveAction',
  };
}

function StoryNodeInner({ id, data, selected }: NodeProps) {
  const d = data as any;
  const updateNodeData = useStudioStore((s) => s.updateNodeData);
  const removeNode = useStudioStore((s) => s.removeNode);
  const duplicateNode = useStudioStore((s) => s.duplicateNode);
  const nodes = useStudioStore((s) => s.nodes);
  const edges = useStudioStore((s) => s.edges);
  const [activeTab, setActiveTab] = useState<'direct' | 'flow' | 'cast'>('direct');

  const story = readStory(d);
  const targets = orderShotTargets(id, nodes as any, edges as any);
  const written: string[] = Array.isArray(d.shotTitles) ? d.shotTitles : [];
  /* The prompt each target received, in the targets' order. Kept beside the
     titles rather than in the combined resultText, because the question worth
     answering on the canvas is not "what did it write" but "what did THIS
     clip get" — and a misalignment between the two is invisible in a single
     block of text. */
  const prompts: string[] = Array.isArray(d.shotPrompts) ? d.shotPrompts : [];
  const [openShot, setOpenShot] = useState<number | null>(null);
  const set = (patch: Partial<StorySettings>) => updateNodeData(id, patch as any);

  const setCast = (i: number, patch: Partial<CastMember>) => {
    const next = story.cast.map((c, k) => (k === i ? { ...c, ...patch } : c));
    set({ cast: next });
  };

  return (
    <div className={`sn-wrap sn-wrap--kind-story ${selected ? 'sn-wrap--selected' : ''}`}>
      <div className="sn-actions">
        <button className="sn-actions__btn" onClick={() => duplicateNode(id)} title="Duplicate node">⧉</button>
        <button className="sn-actions__btn sn-actions__btn--danger" onClick={() => removeNode(id)} title="Delete node">🗑</button>
      </div>

      <Handle type="target" position={Position.Left} id="text" className="sn-port sn-port--text" style={{ top: '50%' }}>
        <span className="sn-port__glyph">T</span>
      </Handle>

      <div className="sn sn--story">
        <div className="sn-bar">
          <Icon name="agent" kind="agent" className="sn-label__icon" />
          <input
            className="sn-label__name nodrag"
            value={d.label || 'Story Director'}
            onChange={(e) => updateNodeData(id, { label: e.target.value })}
            placeholder="Story Director"
          />
          <NodeInfoBadge type="story" />
          {d.status === 'running' ? (
            <span className="sn-count sn-count--running">{d.statusNote || 'Writing…'}</span>
          ) : (
            <span className="sn-story__badge">
              {targets.length ? `🎬 ${targets.length} Shots` : 'Unwired'}
            </span>
          )}
        </div>

        {/* ── Connected Shot Sequencer Ribbon ── */}
        {targets.length === 0 ? (
          <div className="sn-story__empty">
            <strong>Not connected yet.</strong>
            Connect the (T) dot on the right to video or image nodes to direct the sequence.
          </div>
        ) : (
          <div className="sn-story__targets">
            <div className="sn-story__count">
              <span>Connected Sequence Timeline</span>
              <span className="sn-story__beats">{beatSummary(targets, story.beats)}</span>
            </div>
            <div className="sn-story__ribbon">
              {targets.map((t, i) => (
                <div key={t.id} className="sn-story__item">
                  <span className="sn-story__n">{String(i + 1).padStart(2, '0')}</span>
                  <span className="sn-story__name">{t.label || t.id}</span>
                  <span className="sn-story__chip">
                    {t.media === 'video' ? '🎬 clip' : '🖼 still'}
                  </span>
                  {t.aspectRatio && (
                    <span className="sn-story__meta">{t.aspectRatio}</span>
                  )}
                  {t.duration && (
                    <span className="sn-story__meta">{t.duration}</span>
                  )}
                  {t.role === 'reference' && (
                    <span className="sn-story__role" title={`Reference for ${t.referenceFor}`}>
                      ref
                    </span>
                  )}
                  {t.role === 'continuation' && (
                    <span className="sn-story__role" title={`Continues ${t.continues}`}>
                      cont
                    </span>
                  )}
                  {written[i] && (
                    prompts[i]
                      ? <button
                          type="button"
                          className="sn-story__done nodrag"
                          title={openShot === i ? 'Hide the prompt' : 'Show the prompt this shot got'}
                          onClick={() => setOpenShot(openShot === i ? null : i)}
                        >
                          {openShot === i ? '▾' : '✓'}
                        </button>
                      : <span className="sn-story__done" title="Prompt generated">✓</span>
                  )}
                </div>
              ))}
              {openShot !== null && prompts[openShot] && (
                <div className="sn-story__shottext nodrag">
                  <div className="sn-story__shottext-head">
                    {targets[openShot]?.label || `Shot ${openShot + 1}`}
                    <span className="sn-story__meta">
                      {prompts[openShot].length} chars
                    </span>
                  </div>
                  {prompts[openShot]}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Directorial Segmented Tabs ── */}
        <div className="sn-story__tabs">
          <button
            type="button"
            className={`sn-story__tab nodrag ${activeTab === 'direct' ? 'sn-story__tab--active' : ''}`}
            onClick={() => setActiveTab('direct')}
          >
            🎬 Director
          </button>
          <button
            type="button"
            className={`sn-story__tab nodrag ${activeTab === 'flow' ? 'sn-story__tab--active' : ''}`}
            onClick={() => setActiveTab('flow')}
          >
            📐 Flow & Beats
          </button>
          <button
            type="button"
            className={`sn-story__tab nodrag ${activeTab === 'cast' ? 'sn-story__tab--active' : ''}`}
            onClick={() => setActiveTab('cast')}
          >
            👥 Cast & World {story.cast.length > 0 && `(${story.cast.length})`}
          </button>
        </div>

        {/* ── TAB 1: Director Settings ── */}
        {activeTab === 'direct' && (
          <div className="sn-story__panel">
            <div className="sn-story__grid">
              <div className="sn-field">
                <label className="sn-field__label">AI Engine</label>
                <select
                  className="sn-bar__sel nodrag"
                  value={d.platform || 'chatgpt'}
                  onChange={(e) => updateNodeData(id, { platform: e.target.value })}
                >
                  <option value="chatgpt">ChatGPT</option>
                  <option value="gemini">Gemini</option>
                  <option value="grok">Grok</option>
                  <option value="claude">Claude</option>
                  <option value="zai">Z.AI</option>
                </select>
              </div>

              <div className="sn-field">
                <label className="sn-field__label">Visual Style</label>
                <select
                  className="sn-bar__sel nodrag"
                  value={story.visualPreset || 'liveAction'}
                  onChange={(e) => set({ visualPreset: e.target.value as VisualPresetId })}
                >
                  {VISUAL_PRESETS.map((x) => (
                    <option key={x.id} value={x.id}>{x.name}</option>
                  ))}
                </select>
              </div>

              <div className="sn-field">
                <label className="sn-field__label">Camera Coverage</label>
                <select
                  className="sn-bar__sel nodrag"
                  value={story.cameraProgression || 'dynamic'}
                  onChange={(e) => set({ cameraProgression: e.target.value as CameraProgressionId })}
                >
                  {CAMERA_PROGRESSIONS.map((x) => (
                    <option key={x.id} value={x.id}>{x.name}</option>
                  ))}
                </select>
              </div>

              {/* Timestamp prompting, straight out of Google's Veo guide: an
                  eight-second clip told what happens at [00:00-00:02] moves
                  through a moment instead of describing a tableau and looping
                  it. Off by default because it fights a held mood — four
                  instructions inside eight seconds is four half-seconds of
                  nothing. */}
              <div className="sn-field">
                <label className="sn-field__label">Time inside each clip</label>
                <label className="sn-story__check nodrag" title="Break each clip into [00:00-00:02] segments">
                  <input
                    type="checkbox"
                    checked={!!story.timedBeats}
                    onChange={(e) => set({ timedBeats: e.target.checked })}
                  />
                  <span>Timed beats — [00:00-00:02] segments per clip</span>
                </label>
              </div>

              <div className="sn-field">
                <label className="sn-field__label">Sound & Audio</label>
                <select
                  className="sn-bar__sel nodrag"
                  value={story.audioMode || 'cinematic'}
                  onChange={(e) => set({ audioMode: e.target.value as AudioModeId })}
                >
                  {AUDIO_MODES.map((x) => (
                    <option key={x.id} value={x.id}>{x.name}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="sn-story__hint">
              {CAMERA_PROGRESSIONS.find((x) => x.id === story.cameraProgression)?.hint}
            </div>
          </div>
        )}

        {/* ── TAB 2: Story Flow & Beats ── */}
        {activeTab === 'flow' && (
          <div className="sn-story__panel">
            <div className="sn-field">
              <label className="sn-field__label">Story Progression Arc</label>
              <select
                className="sn-bar__sel nodrag"
                value={story.structure}
                onChange={(e) => set({ structure: e.target.value as StructureId })}
              >
                {STRUCTURES.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
              <div className="sn-story__hint">
                {STRUCTURES.find((x) => x.id === story.structure)?.hint}
              </div>
            </div>

            <div className="sn-story__section">
              <div className="sn-story__section-head"><span>Directorial Rules</span></div>
              <div className="sn-story__rules-grid">
                {RULES.map((r) => (
                  <label key={r.id} className="sn-story__rule">
                    <input
                      type="checkbox"
                      className="sn-story__check nodrag"
                      checked={story.rules.includes(r.id)}
                      onChange={(e) => set({
                        rules: e.target.checked
                          ? [...story.rules, r.id]
                          : story.rules.filter((x) => x !== r.id),
                      })}
                    />
                    <span>{r.name}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="sn-story__section">
              <div className="sn-story__section-head"><span>Pacing & Beats</span></div>
              <div className="sn-story__beatrow">
                <input
                  className="sn-story__input sn-story__input--num nodrag"
                  type="number"
                  min={0}
                  max={40}
                  value={story.beats || ''}
                  placeholder={String(beatsFor(targets))}
                  onChange={(e) => set({ beats: Number(e.target.value) || 0 })}
                />
                <span className="sn-story__blank">
                  {story.beats
                    ? 'Custom beat count.'
                    : `Auto derived from clip lengths — ${beatSummary(targets)}.`}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* ── TAB 3: Cast & World ── */}
        {activeTab === 'cast' && (
          <div className="sn-story__panel">
            <div className="sn-story__note">
              Leave empty for AI auto-generation, or lock specific characters & world details.
            </div>

            <div className="sn-story__section">
              <div className="sn-story__section-head">
                <span>Cast & Characters</span>
                <button
                  type="button"
                  className="sn-story__add nodrag"
                  onClick={() => set({ cast: [...story.cast, { name: '', look: '', role: '' }] })}
                >
                  + Add Character
                </button>
              </div>
              {story.cast.length === 0 && (
                <div className="sn-story__blank">Nobody locked — AI will design dynamically.</div>
              )}
              {story.cast.map((c, i) => (
                <div key={i} className="sn-story__cast">
                  <div className="sn-story__cast-row">
                    <input
                      className="sn-story__input nodrag"
                      value={c.name}
                      placeholder="Character Name"
                      onChange={(e) => setCast(i, { name: e.target.value })}
                    />
                    <input
                      className="sn-story__input nodrag"
                      value={c.role || ''}
                      placeholder="Role / Position"
                      onChange={(e) => setCast(i, { role: e.target.value })}
                    />
                    <button
                      type="button"
                      className="sn-story__del nodrag"
                      aria-label="Remove"
                      onClick={() => set({ cast: story.cast.filter((_, k) => k !== i) })}
                    >
                      ✕
                    </button>
                  </div>
                  <textarea
                    className="sn-story__area nodrag"
                    rows={2}
                    value={c.look}
                    placeholder="Physical appearance (repeated in prompts for consistency)"
                    onChange={(e) => setCast(i, { look: e.target.value })}
                  />
                  {/* A voice belongs to a character, which is why it is set
                      here and not on sixteen clips. Flow agrees: it attaches a
                      voice to a character ingredient, not to a prompt. Every
                      shot this character appears in inherits it, and a
                      two-hander gets two voices without anything being set
                      per shot. */}
                  <select
                    className="sn-bar__sel nodrag"
                    value={c.voice || NO_VOICE}
                    onChange={(e) => setCast(i, { voice: e.target.value })}
                    title="The Flow voice this character speaks in"
                  >
                    <option value={NO_VOICE}>No voice — this character does not speak</option>
                    {FLOW_VOICES.map((v) => (
                      <option key={v.id} value={v.id}>{voiceLabel(v)}</option>
                    ))}
                  </select>
                </div>
              ))}
              {story.cast.some((c) => c.voice && c.voice !== NO_VOICE) && (
                <small className="sn-field__hint">
                  {story.audioMode === 'none'
                    ? 'Sound & Audio is set to none, so no voice will be applied — '
                      + 'the story has no spoken lines to carry one.'
                    : 'Each clip takes the voice of whoever speaks in it. A clip needs a '
                      + 'reference image for Flow to attach a voice, and Frames mode has no '
                      + 'voice at all.'}
                </small>
              )}
            </div>

            <div className="sn-story__section">
              <div className="sn-story__section-head"><span>World / Environment</span></div>
              <textarea
                className="sn-story__area nodrag"
                rows={2}
                value={story.world}
                placeholder="Setting, atmosphere, and environmental context"
                onChange={(e) => set({ world: e.target.value })}
              />
            </div>

            {/* Google is explicit that a bare negation tends to summon the thing
                it names — "no buildings" puts buildings in — and that the fix is
                to state the absence as part of the scene. The user types what
                they do not want; the brief carries the rephrasing instruction
                so nobody has to know the trick. */}
            <div className="sn-story__section">
              <div className="sn-story__section-head"><span>Must not appear</span></div>
              <textarea
                className="sn-story__area nodrag"
                rows={2}
                value={story.avoid || ''}
                placeholder="Things to keep out of every shot — text on screen, other people, modern cars"
                onChange={(e) => set({ avoid: e.target.value })}
              />
            </div>

            <div className="sn-story__section">
              <div className="sn-story__section-head"><span>Custom Look & Lighting</span></div>
              <textarea
                className="sn-story__area nodrag"
                rows={2}
                value={story.look}
                placeholder="Specific color palette, lighting rules, camera lens"
                onChange={(e) => set({ look: e.target.value })}
              />
            </div>
          </div>
        )}

        {d.errorMessage && (
          <div className="sn-story__error">
            <div className="sn-story__error-head">
              <span className="sn-story__error-title">⚠️ Generation Notice</span>
              <button
                type="button"
                className="sn-story__retry-btn nodrag"
                onClick={() => {
                  window.dispatchEvent(new CustomEvent('studio:retry-node', { detail: id }));
                }}
                title="Re-run Story Director"
              >
                ↻ Retry
              </button>
            </div>
            <p className="sn-story__error-msg">{d.errorMessage}</p>
          </div>
        )}
      </div>

      <Handle type="source" position={Position.Right} id="text" className="sn-port sn-port--text" style={{ top: '50%' }}>
        <span className="sn-port__glyph">T</span>
      </Handle>
    </div>
  );
}

export const StoryNode = memo(StoryNodeInner);
export default StoryNode;
