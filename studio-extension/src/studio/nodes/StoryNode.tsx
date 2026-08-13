/**
 * The Story node — one director for the whole workflow.
 *
 * You wire its output to every generate node that needs a prompt. It writes
 * all of them in a single reply, having been shown what each of those nodes
 * actually is: media, platform, aspect ratio, duration, and whether its first
 * frame is already pinned by an image you connected.
 *
 * It never edits the canvas. The nodes are yours; this fills them in.
 *
 * ADAPTIVE, in three senses, because a node that shows everything at all
 * times is a form, and nobody reads a form on a canvas:
 *
 *   · It shows what it knows. Shot count, durations and beat arithmetic come
 *     from the wires, so none of it is typed twice — and the beat count is
 *     derived rather than entered, because a number you have to keep in sync
 *     with the canvas is a number that will be wrong.
 *   · It shows what is missing. Empty cast, world and look read as "the AI
 *     will decide" rather than as blank inputs, because that is what happens.
 *   · It fills in as it learns. After a run the model's cast, world and look
 *     are written back as locked, editable fields. Describe once, correct one
 *     word, and every later run holds to it.
 */

import { memo, useState } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Icon } from '../components/Icon';
import { useStudioStore } from '../store';
import { getAskPresets } from '../presets';
import { orderShotTargets } from '../ask/storyboard';
import {
  STRUCTURES, DEFAULT_STORY, beatSummary, beatsFor, hasStory,
  type CastMember, type StorySettings, type StructureId,
} from '../ask/storyPlan';

function readStory(d: any): StorySettings {
  return {
    cast: Array.isArray(d.cast) ? d.cast : DEFAULT_STORY.cast,
    world: typeof d.world === 'string' ? d.world : '',
    look: typeof d.look === 'string' ? d.look : '',
    structure: (d.structure as StructureId) || DEFAULT_STORY.structure,
    beats: Number(d.beats) || 0,
  };
}

function StoryNodeInner({ id, data, selected }: NodeProps) {
  const d = data as any;
  const updateNodeData = useStudioStore((s) => s.updateNodeData);
  const nodes = useStudioStore((s) => s.nodes);
  const edges = useStudioStore((s) => s.edges);
  const [open, setOpen] = useState(false);

  const story = readStory(d);
  const targets = orderShotTargets(id, nodes as any, edges as any);
  const written: string[] = Array.isArray(d.shotTitles) ? d.shotTitles : [];
  const set = (patch: Partial<StorySettings>) => updateNodeData(id, patch as any);

  const setCast = (i: number, patch: Partial<CastMember>) => {
    const next = story.cast.map((c, k) => (k === i ? { ...c, ...patch } : c));
    set({ cast: next });
  };

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
          {d.status === 'running' && (
            <span className="sn-count">{d.statusNote || 'Writing…'}</span>
          )}
        </div>

        <div className="sn-story__what">
          Writes the prompts for the nodes you connect — all in one go, so they
          match each other.
        </div>

        {/* ── What it will write, straight from the wires ── */}
        {targets.length === 0 ? (
          <div className="sn-story__empty">
            <strong>Not connected yet.</strong>
            Drag from the dot on the right to each video or image node you want
            it to write.
          </div>
        ) : (
          <div className="sn-story__targets">
            <div className="sn-story__count">
              Will write {targets.length} prompt{targets.length === 1 ? '' : 's'}
              <span className="sn-story__beats">{beatSummary(targets, story.beats)}</span>
            </div>
            <ol className="sn-story__list">
              {targets.map((t, i) => (
                <li key={t.id} className="sn-story__item">
                  <span className="sn-story__n">{i + 1}</span>
                  <span className="sn-story__name">{t.label || t.id}</span>
                  <span className="sn-story__meta">
                    {[t.media === 'video' ? 'clip' : 'still', t.aspectRatio, t.duration]
                      .filter(Boolean).join(' · ')}
                  </span>
                  {written[i] && <span className="sn-story__done">✓</span>}
                </li>
              ))}
            </ol>
          </div>
        )}

        <div className="sn-field">
          <label className="sn-field__label">Which AI writes them</label>
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
          <label className="sn-field__label">How the story flows</label>
          <select
            className="sn-field__select nodrag"
            value={story.structure}
            onChange={(e) => set({ structure: e.target.value as StructureId })}
          >
            {STRUCTURES.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
          <div className="sn-field__hint">
            {STRUCTURES.find((x) => x.id === story.structure)?.hint}
          </div>
        </div>

        {/* ── The story itself. Collapsed until asked for, because it is empty
             until the first run and a row of blank inputs on a canvas reads as
             work to do rather than as something already handled. ── */}
        <button
          type="button"
          className="sn-story__toggle nodrag"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
        >
          <span>{open ? '▾' : '▸'} Who is in it, and where</span>
          <span className="sn-story__toggle-state">
            {/* hasStory ignores the empty row the + button adds: pressing Add
                and typing nothing has locked nothing, and saying otherwise
                would claim the AI is being held to a blank description. */}
            {hasStory(story) ? 'You set this' : 'AI will choose'}
          </span>
        </button>

        {open && (
          <div className="sn-story__panel">
            <div className="sn-story__note">
              Leave these empty and the AI decides them on the first run, then fills
              them in here so you can change a word. Anything you write is used
              exactly as written, in every prompt.
            </div>

            <div className="sn-story__section">
              <div className="sn-story__section-head">
                <span>People</span>
                <button
                  type="button"
                  className="sn-story__add nodrag"
                  onClick={() => set({ cast: [...story.cast, { name: '', look: '' }] })}
                >
                  + Add
                </button>
              </div>
              {story.cast.length === 0 && (
                <div className="sn-story__blank">Nobody set — the AI will choose.</div>
              )}
              {story.cast.map((c, i) => (
                <div key={i} className="sn-story__cast">
                  <div className="sn-story__cast-row">
                    <input
                      className="sn-story__input nodrag"
                      value={c.name}
                      placeholder="Name"
                      onChange={(e) => setCast(i, { name: e.target.value })}
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
                    placeholder="What they look like — repeated in every shot so they stay the same person"
                    onChange={(e) => setCast(i, { look: e.target.value })}
                  />
                </div>
              ))}
            </div>

            <div className="sn-story__section">
              <div className="sn-story__section-head"><span>Place</span></div>
              <textarea
                className="sn-story__area nodrag"
                rows={2}
                value={story.world}
                placeholder="Where it happens — the AI will fill this in"
                onChange={(e) => set({ world: e.target.value })}
              />
            </div>

            <div className="sn-story__section">
              <div className="sn-story__section-head"><span>Style</span></div>
              <textarea
                className="sn-story__area nodrag"
                rows={2}
                value={story.look}
                placeholder="Colours, lighting, camera feel — the AI will fill this in"
                onChange={(e) => set({ look: e.target.value })}
              />
            </div>

            <div className="sn-story__section">
              <div className="sn-story__section-head"><span>How many moments</span></div>
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
                    ? 'You set this.'
                    : `Worked out from the clip lengths — ${beatSummary(targets)}.`}
                </span>
              </div>
            </div>

            <div className="sn-field">
              <label className="sn-field__label">Extra instructions (optional)</label>
              <select
                className="sn-field__select nodrag"
                value={d.preset || ''}
                onChange={(e) => updateNodeData(id, { preset: e.target.value })}
              >
                <option value="">None</option>
                {getAskPresets().map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
          </div>
        )}

        {d.errorMessage && <div className="sn-story__error">{d.errorMessage}</div>}
      </div>

      <Handle type="source" position={Position.Right} id="text" className="sn-port sn-port--text" />
    </div>
  );
}

export const StoryNode = memo(StoryNodeInner);
export default StoryNode;
