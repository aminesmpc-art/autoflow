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
  STRUCTURES, RULES, DEFAULT_STORY, beatSummary, beatsFor, readStorySettings,
  CAMERA_PROGRESSIONS, AUDIO_MODES, VISUAL_PRESETS,
  effectivePov, povSurvivalPresetPatch, chestDocumentaryPresetPatch, LIGHTING_GRAMMARS,
  type CastMember, type StorySettings, type StructureId,
  type CameraProgressionId, type AudioModeId, type VisualPresetId,
} from '../ask/storyPlan';
import {
  PERSPECTIVES, CAMERA_RIGS, POV_LENSES, STABILIZATIONS, BODY_MOVEMENTS,
  CAMERA_HEIGHTS, FRAMINGS, AWARENESS, INTERACTION_DISTANCES, POV_CONTINUITIES,
  POV_DURATIONS, NARRATION_STRATEGIES, NARRATION_PERSONS, HOOK_TIMINGS,
  ACTION_DENSITIES, DIALOGUE_DENSITIES, ENDING_STYLES, REVEAL_STYLES,
  POV_PARTICIPATIONS, ANIMAL_STYLES, GROUP_STAGINGS,
  POV_SURVIVAL_DEFAULTS, POV_SURVIVAL_PRESET_ID,
  type PovSettings, type PovOption,
} from '../ask/povSurvival';
import { FLOW_VOICES, NO_VOICE, voiceLabel } from '../flowVoices';
import { DISTORTIONS, FOCUS_DEPTHS, MOTION_BLURS, MOVEMENT_RESPONSES, COLOR_TREATMENTS } from '../ask/actionCameraLook';
import { NodeInfoBadge } from './NodeInfoBadge';

/* One reader, shared with the runner. Kept as a local name because this
   file uses it a dozen times, and because the two used to differ. */
const readStory = readStorySettings;

/** One labelled dropdown, for the POV panel's eighteen of them. */
function PovSelect<T extends string>({ label, value, options, disabled, onPick }: {
  label: string; value: T; options: readonly PovOption<T>[];
  disabled?: boolean; onPick: (v: T) => void;
}) {
  return (
    <div className="sn-field">
      <label className="sn-field__label">{label}</label>
      <select
        className="sn-bar__sel nodrag"
        value={value}
        aria-label={label}
        disabled={disabled}
        onChange={(e) => onPick(e.target.value as T)}
      >
        {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
      </select>
    </div>
  );
}

/** One labelled checkbox, for what the camera's owner shows of themselves. */
function PovCheck({ label, checked, disabled, onPick }: {
  label: string; checked: boolean; disabled?: boolean; onPick: (v: boolean) => void;
}) {
  return (
    <label className="sn-story__timing-label nodrag">
      <input
        type="checkbox"
        className="sn-story__check"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onPick(e.target.checked)}
      />
      <span>{label}</span>
    </label>
  );
}

function StoryNodeInner({ id, data, selected }: NodeProps) {
  const d = data as any;
  const updateNodeData = useStudioStore((s) => s.updateNodeData);
  const removeNode = useStudioStore((s) => s.removeNode);
  const duplicateNode = useStudioStore((s) => s.duplicateNode);
  const nodes = useStudioStore((s) => s.nodes);
  const edges = useStudioStore((s) => s.edges);
  const [activeTab, setActiveTab] = useState<'direct' | 'pov' | 'flow' | 'cast'>('direct');

  const story = readStory(d);
  const chiefConnected = edges.some((edge) => edge.source === d.chiefId
    && edge.target === id && edge.targetHandle === 'text');
  const chiefControlled = chiefConnected && !!d.chiefLocked && !!d.chiefId;

  /* Which part of the production this Director writes.
     The Chief's assignments are sequential — each group opens where the last
     one closed — and the order is taken from where the nodes sit on the
     canvas, left to right. That makes dragging a node past its neighbour a
     STORY edit, which is not a thing anybody would expect a drag to be. So the
     position is shown: if the numbering is not what was intended, it is
     visible before the run rather than inferable from the output. */
  const chiefGroup = (() => {
    if (!chiefControlled) return null;
    const siblings = edges
      .filter((e) => e.source === d.chiefId && e.targetHandle === 'text')
      .map((e) => nodes.find((n) => n.id === e.target))
      .filter((n): n is NonNullable<typeof n> => !!n
        && (n.type === 'story' || (n.data as any)?.type === 'story'))
      .sort((a, b) => ((a.position?.x || 0) - (b.position?.x || 0))
        || ((a.position?.y || 0) - (b.position?.y || 0)));
    const at = siblings.findIndex((n) => n.id === id);
    return at === -1 || siblings.length < 2 ? null : { part: at + 1, of: siblings.length };
  })();
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

  /* The POV block the panel is editing.
     effectivePov resolves the preset-without-a-block case, so a Director that
     only names the preset opens on its real values rather than on blanks. */
  const pov: PovSettings = effectivePov(story) || POV_SURVIVAL_DEFAULTS;
  const setPov = (patch: Partial<PovSettings>) => set({ pov: { ...pov, ...patch } });
  const povOn = !!effectivePov(story);

  const setCast = (i: number, patch: Partial<CastMember>) => {
    const next = story.cast.map((c, k) => (k === i ? { ...c, ...patch } : c));
    set({ cast: next });
  };

  return (
    <div className={`sn-wrap sn-wrap--kind-story ${selected ? 'sn-wrap--selected' : ''}`}>
      <div className="sn-actions">
        <button className="sn-actions__btn nodrag" onClick={() => duplicateNode(id)} title="Duplicate node" aria-label="Duplicate node"><Icon name="copy" /></button>
        <button className="sn-actions__btn sn-actions__btn--danger nodrag" onClick={() => removeNode(id)} title="Delete node" aria-label="Delete node"><Icon name="trash" /></button>
      </div>

      <div className="sn sn--story">
        <Handle type="target" position={Position.Left} id="text" className="sn-port sn-port--text" style={{ top: 72 }}>
          <span className="sn-port__glyph">T</span>
        </Handle>

        <div className="sn-bar">
          <Icon name="story" className="sn-label__icon" />
          <input
            className="sn-label__name nodrag"
            value={d.label || 'Director'}
            onChange={(e) => updateNodeData(id, { label: e.target.value })}
            placeholder="Director"
            aria-label="Director node name"
          />
          <NodeInfoBadge type="story" />
          {d.status === 'running' ? (
            <span className="sn-count sn-count--running">{d.statusNote || 'Writing…'}</span>
          ) : (
            <span className="sn-story__badge">
              {targets.length ? `${targets.length} Shots` : 'No shots'}
            </span>
          )}
        </div>

        <div className="sn-director__intro"><span>Creative direction</span><p>Shape the look, rhythm, and cast of your sequence.</p></div>
        {/* ── Connected Shot Sequencer Ribbon ── */}
        {targets.length === 0 ? (
          <div className="sn-director__empty">
            <Icon name="nodes" />
            <strong>Add shots to your sequence</strong>
            <p>Connect the right <b>T</b> output to video or image nodes. The Director writes a prompt for each shot.</p>
          </div>
        ) : (
          <div className="sn-story__targets">
            <div className="sn-story__count">
              <span>Shot sequence</span>
              <span className="sn-story__beats">{beatSummary(targets, story.beats)}</span>
            </div>
            <div className="sn-story__ribbon">
              {targets.map((t, i) => (
                <div key={t.id} className="sn-story__item">
                  <span className="sn-story__n">{String(i + 1).padStart(2, '0')}</span>
                  <span className="sn-story__name" title={t.label || t.id}>{t.label || t.id}</span>
                  <span className="sn-story__chip">
                    <Icon name={t.media === 'video' ? 'clip' : 'image'} />{t.media === 'video' ? 'clip' : 'still'}
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
                          aria-label={`${openShot === i ? 'Hide' : 'Show'} prompt for ${t.label || `shot ${i + 1}`}`}
                          aria-expanded={openShot === i}
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
        <div className="sn-story__tabs" role="group" aria-label="Director settings sections">
          <button
            type="button"
            className={`sn-story__tab nodrag ${activeTab === 'direct' ? 'sn-story__tab--active' : ''}`}
            onClick={() => setActiveTab('direct')}
            aria-pressed={activeTab === 'direct'}
          >
            <Icon name="clip" /> Director
          </button>
          <button
            type="button"
            className={`sn-story__tab nodrag ${activeTab === 'pov' ? 'sn-story__tab--active' : ''}`}
            onClick={() => setActiveTab('pov')}
            aria-pressed={activeTab === 'pov'}
          >
            <Icon name="frame" /> POV {povOn && '\u2713'}
          </button>
          <button
            type="button"
            className={`sn-story__tab nodrag ${activeTab === 'flow' ? 'sn-story__tab--active' : ''}`}
            onClick={() => setActiveTab('flow')}
            aria-pressed={activeTab === 'flow'}
          >
            <Icon name="motion" /> Flow & Beats
          </button>
          <button
            type="button"
            className={`sn-story__tab nodrag ${activeTab === 'cast' ? 'sn-story__tab--active' : ''}`}
            onClick={() => setActiveTab('cast')}
            aria-pressed={activeTab === 'cast'}
          >
            <Icon name="chief" /> Cast & World {story.cast.length > 0 && `(${story.cast.length})`}
          </button>
        </div>

        {chiefControlled && (
          <div className="sn-story__note">
            <strong>
              Controlled by Director Chief
              {chiefGroup ? ` — part ${chiefGroup.part} of ${chiefGroup.of}` : ''}.
            </strong>{' '}
            Cast, world, look, pacing, and production rules are inherited and locked.
            This Director writes only its connected shots.
            {chiefGroup && (
              <>
                {' '}The parts run left to right across the canvas, and each one opens
                where the one before it closed — so moving this node past its
                neighbour changes the order of the story.
              </>
            )}
          </div>
        )}

        {/* ── TAB 1: Director Settings ── */}
        {activeTab === 'direct' && (
          <div className="sn-story__panel">
            <button className="sn-director__mini-btn nodrag" disabled={chiefControlled}
              title="Apply chest mount, 14mm fisheye, deep focus, adaptive motion, overcast daylight and earth tones"
              onClick={() => { set(chestDocumentaryPresetPatch(story)); setActiveTab('pov'); }}>
              Use chest-camera documentary look
            </button>
            <div className="sn-story__grid">
              <div className="sn-field">
                <label className="sn-field__label">AI Engine</label>
                <select
                  className="sn-bar__sel nodrag"
                  value={d.platform || 'chatgpt'}
                  aria-label="AI Engine"
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
                  aria-label="Visual Style"
                  disabled={chiefControlled}
                  onChange={(e) => {
                    const next = e.target.value as VisualPresetId;
                    /* Selecting the POV preset fills the format's settings.
                       Everything it may touch is decided in
                       povSurvivalPresetPatch — never cast, world, look, avoid
                       or beats, and never a story setting already moved off
                       its default. Any other preset is one field, as before. */
                    set(next === POV_SURVIVAL_PRESET_ID
                      ? povSurvivalPresetPatch(story)
                      : { visualPreset: next });
                  }}
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
                  aria-label="Camera Coverage"
                  disabled={chiefControlled}
                  onChange={(e) => set({ cameraProgression: e.target.value as CameraProgressionId })}
                >
                  {CAMERA_PROGRESSIONS.map((x) => (
                    <option key={x.id} value={x.id}>{x.name}</option>
                  ))}
                </select>
              </div>

              <div className="sn-field">
                <label className="sn-field__label">Sound & Audio</label>
                <select
                  className="sn-bar__sel nodrag"
                  value={story.audioMode || 'cinematic'}
                  aria-label="Sound & Audio"
                  disabled={chiefControlled}
                  onChange={(e) => set({ audioMode: e.target.value as AudioModeId })}
                >
                  {AUDIO_MODES.map((x) => (
                    <option key={x.id} value={x.id}>{x.name}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Timestamp prompting as a clean full-width toggle row */}
            <div className="sn-story__timing-row">
              <label className="sn-story__timing-label nodrag" title="Break each clip into [00:00-00:02] segments">
                <input
                  type="checkbox"
                  className="sn-story__check"
                  checked={!!story.timedBeats}
                  disabled={chiefControlled}
                  onChange={(e) => set({ timedBeats: e.target.checked })}
                />
                <span>Timed beats — [00:00-00:02] pacing per clip</span>
              </label>
            </div>

            <div className="sn-story__hint">
              {CAMERA_PROGRESSIONS.find((x) => x.id === story.cameraProgression)?.hint}
            </div>
          </div>
        )}

        {/* ── TAB 2: POV / Action Camera ──

            Absent from every Director until somebody opens it. The panel reads
            the preset's defaults so it is never blank, but nothing is written
            to the node until a control is touched — which is what keeps an old
            saved workflow writing exactly the brief it always wrote. */}
        {activeTab === 'pov' && (
          <div className="sn-story__panel">
            {!povOn && (
              <div className="sn-story__note">
                Off. Pick <strong>POV Survival / GoPro Diary</strong> under Visual Style,
                or change anything below, to shoot this piece first-person.
              </div>
            )}

            <div className="sn-story__section">
              <div className="sn-story__section-head"><span>Camera</span></div>
              <div className="sn-story__grid">
                <PovSelect label="Perspective" value={pov.perspective} options={PERSPECTIVES}
                  disabled={chiefControlled} onPick={(v) => setPov({ perspective: v })} />
                <PovSelect label="Camera rig" value={pov.rig} options={CAMERA_RIGS}
                  disabled={chiefControlled} onPick={(v) => setPov({ rig: v })} />
                <PovSelect label="Lens / FOV" value={pov.lens} options={POV_LENSES}
                  disabled={chiefControlled} onPick={(v) => setPov({ lens: v })} />
                <PovSelect label="Stabilisation" value={pov.stabilization} options={STABILIZATIONS}
                  disabled={chiefControlled} onPick={(v) => setPov({ stabilization: v })} />
                <PovSelect label="Body movement" value={pov.bodyMovement} options={BODY_MOVEMENTS}
                  disabled={chiefControlled} onPick={(v) => setPov({ bodyMovement: v })} />
                <PovSelect label="Camera height" value={pov.cameraHeight} options={CAMERA_HEIGHTS}
                  disabled={chiefControlled} onPick={(v) => setPov({ cameraHeight: v })} />
                <PovSelect label="Framing" value={pov.framing} options={FRAMINGS}
                  disabled={chiefControlled} onPick={(v) => setPov({ framing: v })} />
                <PovSelect label="Shot length (pacing)" value={pov.preferredShotDuration}
                  options={POV_DURATIONS} disabled={chiefControlled}
                  onPick={(v) => setPov({ preferredShotDuration: v })} />
              </div>
              <div className="sn-story__hint">
                {CAMERA_RIGS.find((x) => x.id === pov.rig)?.hint}
              </div>
            </div>

            <details className="sn-story__section nodrag">
              <summary>Lens, motion &amp; documentary look</summary>
              <div className="sn-story__grid">
                <PovSelect label="Lens distortion" value={pov.distortion || 'auto'} options={DISTORTIONS}
                  disabled={chiefControlled} onPick={v => setPov({ distortion: v })} />
                <PovSelect label="Focus depth" value={pov.focusDepth || 'auto'} options={FOCUS_DEPTHS}
                  disabled={chiefControlled} onPick={v => setPov({ focusDepth: v })} />
                <PovSelect label="Motion blur" value={pov.motionBlur || 'auto'} options={MOTION_BLURS}
                  disabled={chiefControlled} onPick={v => setPov({ motionBlur: v })} />
                <PovSelect label="Movement response" value={pov.movementResponse || 'auto'} options={MOVEMENT_RESPONSES}
                  disabled={chiefControlled} onPick={v => setPov({ movementResponse: v })} />
                <PovSelect label="Colour treatment" value={pov.colorTreatment || 'auto'} options={COLOR_TREATMENTS}
                  disabled={chiefControlled} onPick={v => setPov({ colorTreatment: v })} />
                <PovSelect label="Lighting" value={story.lighting || 'none'} options={LIGHTING_GRAMMARS}
                  disabled={chiefControlled} onPick={v => set({ lighting: v })} />
              </div>
              <div className="sn-story__hint">Follow the action adjusts walking, crouching, pauses and running to each beat. The connected video nodes keep their own clip durations.</div>
            </details>

            <div className="sn-story__section">
              <div className="sn-story__section-head"><span>What the camera's owner shows</span></div>
              <PovCheck label="Hands may enter the frame" checked={pov.showHands}
                disabled={chiefControlled} onPick={(v) => setPov({ showHands: v })} />
              <PovCheck label="Forearms may enter the frame" checked={pov.showForearms}
                disabled={chiefControlled} onPick={(v) => setPov({ showForearms: v })} />
              <PovCheck label="Weapon or held prop in the foreground" checked={pov.showForegroundProp}
                disabled={chiefControlled} onPick={(v) => setPov({ showForegroundProp: v })} />
              <PovCheck label="Protagonist's face may be seen" checked={pov.protagonistFaceVisible}
                disabled={chiefControlled} onPick={(v) => setPov({ protagonistFaceVisible: v })} />
              <PovCheck label="The rig itself is in shot (strap, harness rim)"
                checked={pov.showCameraMount} disabled={chiefControlled}
                onPick={(v) => setPov({ showCameraMount: v })} />
            </div>

            <div className="sn-story__section">
              <div className="sn-story__section-head"><span>The people in it</span></div>
              <div className="sn-story__grid">
                <PovSelect label="Camera awareness" value={pov.awareness} options={AWARENESS}
                  disabled={chiefControlled} onPick={(v) => setPov({ awareness: v })} />
                <PovSelect label="Interaction distance" value={pov.interactionDistance}
                  options={INTERACTION_DISTANCES} disabled={chiefControlled}
                  onPick={(v) => setPov({ interactionDistance: v })} />
              </div>
              <div className="sn-story__hint">
                {AWARENESS.find((x) => x.id === pov.awareness)?.hint}
              </div>
            </div>

            <div className="sn-story__section">
              <div className="sn-story__section-head"><span>Behaviour</span></div>
              <div className="sn-story__grid">
                <PovSelect label="POV participation" value={pov.povParticipation}
                  options={POV_PARTICIPATIONS} disabled={chiefControlled}
                  onPick={(v) => setPov({ povParticipation: v })} />
                <PovSelect label="Group staging" value={pov.groupStaging}
                  options={GROUP_STAGINGS} disabled={chiefControlled}
                  onPick={(v) => setPov({ groupStaging: v })} />
                <PovSelect label="Animal style" value={pov.animalStyle}
                  options={ANIMAL_STYLES} disabled={chiefControlled}
                  onPick={(v) => setPov({ animalStyle: v })} />
              </div>
              <div className="sn-story__hint">
                {POV_PARTICIPATIONS.find((x) => x.id === pov.povParticipation)?.hint}
              </div>
            </div>

            <div className="sn-story__section">
              <div className="sn-story__section-head"><span>Story &amp; retention</span></div>
              <div className="sn-story__grid">
                <PovSelect label="Hook timing" value={pov.hookTiming} options={HOOK_TIMINGS}
                  disabled={chiefControlled} onPick={(v) => setPov({ hookTiming: v })} />
                <PovSelect label="Reveal style" value={pov.revealStyle} options={REVEAL_STYLES}
                  disabled={chiefControlled} onPick={(v) => setPov({ revealStyle: v })} />
                <PovSelect label="Ending style" value={pov.endingStyle} options={ENDING_STYLES}
                  disabled={chiefControlled} onPick={(v) => setPov({ endingStyle: v })} />
                <PovSelect label="Action density" value={pov.actionDensity} options={ACTION_DENSITIES}
                  disabled={chiefControlled} onPick={(v) => setPov({ actionDensity: v })} />
                <PovSelect label="Dialogue density" value={pov.dialogueDensity} options={DIALOGUE_DENSITIES}
                  disabled={chiefControlled} onPick={(v) => setPov({ dialogueDensity: v })} />
                <PovSelect label="Continuity" value={pov.continuity} options={POV_CONTINUITIES}
                  disabled={chiefControlled} onPick={(v) => setPov({ continuity: v })} />
                <PovSelect label="Narration" value={pov.narrationStrategy}
                  options={NARRATION_STRATEGIES} disabled={chiefControlled}
                  onPick={(v) => setPov({ narrationStrategy: v })} />
                <PovSelect label="Narration person" value={pov.narrationPerson}
                  options={NARRATION_PERSONS} disabled={chiefControlled}
                  onPick={(v) => setPov({ narrationPerson: v })} />
              </div>
              <div className="sn-story__hint">
                Narration is written and recorded separately — the Director is told not to
                put spoken lines in the clips. Environmental sound is set under
                Sound &amp; Audio.
              </div>
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
                aria-label="Story Progression Arc"
                disabled={chiefControlled}
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
                      disabled={chiefControlled}
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
                  aria-label="Beat count"
                  min={0}
                  max={40}
                  value={story.beats || ''}
                  disabled={chiefControlled}
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
              {chiefControlled
                ? 'Inherited from Director Chief for cross-Director consistency.'
                : 'Leave empty for AI auto-generation, or lock specific characters & world details.'}
            </div>

            <div className="sn-story__section">
              <div className="sn-story__section-head">
                <span>Cast & Characters</span>
                <button
                  type="button"
                  className="sn-story__add nodrag"
                  disabled={chiefControlled}
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
                      disabled={chiefControlled}
                      placeholder="Character Name"
                      aria-label={`Character ${i + 1} name`}
                      onChange={(e) => setCast(i, { name: e.target.value })}
                    />
                    <input
                      className="sn-story__input nodrag"
                      value={c.role || ''}
                      disabled={chiefControlled}
                      placeholder="Role / Position"
                      aria-label={`Character ${i + 1} role`}
                      onChange={(e) => setCast(i, { role: e.target.value })}
                    />
                    <button
                      type="button"
                      className="sn-story__del nodrag"
                      aria-label="Remove"
                      disabled={chiefControlled}
                      onClick={() => set({ cast: story.cast.filter((_, k) => k !== i) })}
                    >
                      ✕
                    </button>
                  </div>
                  <textarea
                    className="sn-story__area nodrag"
                    rows={2}
                    value={c.look}
                    aria-label={`Character ${i + 1} appearance`}
                    disabled={chiefControlled}
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
                    aria-label={`Character ${i + 1} voice`}
                    disabled={chiefControlled}
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
                aria-label="World and environment"
                disabled={chiefControlled}
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
                aria-label="Must not appear"
                disabled={chiefControlled}
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
                aria-label="Custom look and lighting"
                disabled={chiefControlled}
                placeholder="Specific color palette, lighting rules, camera lens"
                onChange={(e) => set({ look: e.target.value })}
              />
            </div>
          </div>
        )}

        {d.errorMessage && (
          <div className="sn-story__error">
            <div className="sn-story__error-head">
              <span className="sn-story__error-title"><Icon name="alert" /> Generation Notice</span>
              <button
                type="button"
                className="sn-story__retry-btn nodrag"
                onClick={() => {
                  window.dispatchEvent(new CustomEvent('studio:retry-node', { detail: id }));
                }}
                title="Re-run the Director"
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

export const StoryNode = memo(StoryNodeInner);
export default StoryNode;
