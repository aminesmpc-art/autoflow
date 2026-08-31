/**
 * The animal-comedy template.
 *
 * Built from a 28-section master prompt, and built as a TEMPLATE — every rule
 * lives in this workflow's own nodes. Nothing in the Story node's code knows
 * this format exists, which is the point: one format belongs in a workflow you
 * can edit, copy or delete, not in the machinery every workflow runs through.
 *
 * Three adaptations, and the first is the one that shaped the canvas:
 *
 *   - the source is Seedance 2.0 at fifteen seconds; Flow generates 4, 6, 8 or
 *     10. Its six segments are spread across two 8s clips joined on a last
 *     frame. Its own pacing puts the payoff at 5–8.5s, so compressing into one
 *     clip would lose the reaction and the final gag.
 *   - its output format is prose under bold headings; the Story node answers
 *     in JSON, so the shape is dropped and the content kept.
 *   - its cast/world/look/continuity sections already exist as node fields, so
 *     they are set as fields rather than repeated as prose.
 */

/// <reference types="node" />

import { readFileSync } from 'fs';
import { join } from 'path';
import { TEMPLATES } from '../studio/templates/index';

const t = TEMPLATES.find((x: any) => x.id === 'tpl_animal_comedy') as any;
const node = (id: string) => t.nodes.find((n: any) => n.id === id);

describe('it ships as a workflow', () => {
  it('is in the gallery with the node count it claims', () => {
    expect(t).toBeTruthy();
    expect(t.nodes).toHaveLength(t.nodeCount);
  });

  it('changes nothing about the Story node itself', () => {
    /* The whole reason this is a template. If the format needed a new field,
       a new preset family or a new dropdown, every other workflow would carry
       the weight of one format for ever. */
    const plan = readFileSync(
      join(__dirname, '..', 'studio', 'ask', 'storyPlan.ts'), 'utf8');
    const story = readFileSync(
      join(__dirname, '..', 'studio', 'nodes', 'StoryNode.tsx'), 'utf8');
    for (const src of [plan, story]) {
      expect(src).not.toMatch(/animalComedy|STORY_GENRES|GenreId/);
    }
  });
});

describe('the format travels with the template', () => {
  const idea = () => node('idea').data.text as string;

  it('carries the laws in its own prompt node', () => {
    expect(idea()).toMatch(/THE ANIMAL IS A REAL ANIMAL/);
    expect(idea()).toMatch(/80% ordinary animal physicality, 15% simple/);
    expect(idea()).toMatch(/DEAD SERIOUS/);
    expect(idea()).toMatch(/ONE JOKE/);
    expect(idea()).toMatch(/OPEN IN THE MIDDLE OF IT/);
  });

  it('keeps the no-fingers limit, which is what Seedance actually fails at', () => {
    expect(idea()).toMatch(/may NOT do anything needing fingers/);
  });

  it('keeps the family-safe lock', () => {
    expect(idea()).toMatch(/No injury, no distress, no cruelty/);
  });

  it('leaves an obvious place for the user to put their own idea', () => {
    /* A template whose brief is fixed is a template you can run once. */
    expect(idea()).toMatch(/THE IDEA — replace this with your own/);
  });

  it('sets the rest as node settings rather than repeating them as prose', () => {
    const d = node('director').data;
    expect(d.cameraProgression).toBe('fixed');       // one locked phone
    expect(d.audioMode).toBe('ambient');             // room sound, no dialogue
    expect(d.visualPreset).toBe('smartphonePOV');    // raw phone footage
    expect(d.timedBeats).toBe(true);                 // the six-segment pacing
    expect(d.rules).toContain('samePerson');         // the animal never changes
    expect(d.avoid).toMatch(/furry humanoid/);       // the realism negatives
    expect(d.avoid).toMatch(/five human fingers/);
  });
});

describe('the shape of the piece', () => {
  it('is two 8s clips, not one compressed one', () => {
    const clips = t.nodes.filter((n: any) => n.data.mediaType === 'video');
    expect(clips).toHaveLength(2);
    for (const c of clips) expect(c.data.duration).toBe('8s');
  });

  it('joins them on a last frame so the animal survives the cut', () => {
    expect(t.nodes.some((n: any) => n.data.type === 'frame')).toBe(true);
    expect(t.edges.some((e: any) => e.source === 'shot1' && e.target === 'handoff')).toBe(true);
    expect(t.edges.some((e: any) => e.source === 'handoff' && e.target === 'shot2')).toBe(true);
  });

  it('gives the first clip the reference still as well', () => {
    /* The still is the breed and the markings; the handoff frame is the pose.
       A chain with only the frame drifts on what the animal IS. */
    expect(t.edges.some((e: any) => e.source === 'ref_still' && e.target === 'shot1')).toBe(true);
  });

  it('has the director writing every shot', () => {
    for (const id of ['ref_still', 'shot1', 'shot2']) {
      expect(t.edges.some((e: any) => e.source === 'director' && e.target === id)).toBe(true);
    }
  });
});
