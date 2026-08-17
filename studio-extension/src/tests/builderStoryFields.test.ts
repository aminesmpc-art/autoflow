/**
 * The builder's menu, against the settings that actually exist.
 *
 * spec.ts lists the legal values for a Story node's settings as literal text
 * inside a prompt, because that is what the model reads. Nothing connects that
 * text to the unions it is describing, so when a setting was added the list
 * quietly stayed as it was — and a value the model is never told about is a
 * value the builder can never choose.
 *
 * That is how it stood: `propped` (the UGC camera) and `ugcAd` (the UGC ad
 * structure) both existed, both were exactly what a "make me a UGC ad" request
 * needs, and the builder could not pick either. Worse than a crash, because
 * the workflow still built and still ran — just never as UGC.
 *
 * And in the other direction: plan.ts read `step.rules` and `step.beats` while
 * spec.ts documented neither, so every built Story node got the same default
 * rules however much the piece needed different ones.
 *
 * So this reads the prompt as text and checks it against the code. It is not a
 * type check — the strings live in a template literal and TypeScript cannot
 * see inside one.
 */

/// <reference types="node" />

import { readFileSync } from 'fs';
import { join } from 'path';
import {
  CAMERA_PROGRESSIONS, AUDIO_MODES, VISUAL_PRESETS, STRUCTURES, RULES,
  readStorySettings, DEFAULT_STORY,
} from '../studio/ask/storyPlan';
import { compilePlan } from '../studio/builder/plan';

const src = (f: string) =>
  readFileSync(join(__dirname, '..', 'studio', 'builder', f), 'utf8');

const SPEC = src('spec.ts');

/** Every quoted token on the lines that offer a value for `key`. */
function offered(key: string): string[][] {
  const lines = SPEC.split('\n').filter((l) =>
    new RegExp(`^\\s*(?:-\\s*${key}:|"${key}":)`).test(l));
  return lines.map((l) => Array.from(l.matchAll(/"([A-Za-z][A-Za-z0-9]*)"/g))
    .map((m) => m[1])
    .filter((v) => v !== key));
}

describe('what the builder is told it can choose', () => {
  const cases: Array<[string, string[]]> = [
    ['structure', STRUCTURES.map((x) => x.id)],
    ['cameraProgression', CAMERA_PROGRESSIONS.map((x) => x.id)],
    ['audioMode', AUDIO_MODES.map((x) => x.id)],
    ['visualPreset', VISUAL_PRESETS.map((x) => x.id)],
    ['rules', RULES.map((x) => x.id)],
  ];

  it.each(cases)('offers every %s the code has, and no invented one', (key, expected) => {
    const lists = offered(key);
    /* Twice: once in the node's field list, once in the JSON shape. Both are
       read by the model and either one being wrong is enough. */
    expect(lists.length).toBeGreaterThanOrEqual(2);
    for (const list of lists) {
      expect([...list].sort()).toEqual([...expected].sort());
    }
  });

  it('names the settings plan.ts actually reads', () => {
    /* The other direction of the same drift: a field the plan reads and the
       spec never mentions is a setting the model has no way to know exists. */
    const PLAN = src('plan.ts');
    const read = Array.from(PLAN.matchAll(/\bstep\.([a-zA-Z]+)/g)).map((m) => m[1]);
    const storyFields = ['structure', 'cameraProgression', 'audioMode', 'visualPreset',
      'rules', 'beats', 'timedBeats', 'avoid', 'cast', 'world', 'look'];
    for (const field of storyFields) {
      if (!read.includes(field)) continue;
      expect(SPEC).toContain(field);
    }
  });
});

describe('what the builder plans reaches the node', () => {
  const storyStep = {
    id: 's1', type: 'story', label: 'Director',
    structure: 'ugcAd',
    cameraProgression: 'propped',
    audioMode: 'dialogue',
    visualPreset: 'smartphonePOV',
    rules: ['samePerson', 'cumulative'],
    beats: 4,
    timedBeats: true,
    avoid: 'traffic',
    world: 'a small bathroom',
    look: 'plain',
  };

  const built = () => {
    const { template, problems } = compilePlan({ steps: [storyStep] } as any);
    expect(problems).toEqual([]);
    return (template!.nodes as any[]).find((n) => n.id === 's1')!;
  };

  it('carries every setting the plan chose, through the node reader', () => {
    /* Checked through readStorySettings rather than off the raw data, because
       that is the path the brief takes — a field written to the node and then
       dropped by the reader is no better than one never written. */
    const s = readStorySettings((built() as any).data);
    expect(s.structure).toBe('ugcAd');
    expect(s.cameraProgression).toBe('propped');
    expect(s.audioMode).toBe('dialogue');
    expect(s.visualPreset).toBe('smartphonePOV');
    expect(s.rules).toEqual(['samePerson', 'cumulative']);
    expect(s.beats).toBe(4);
    expect(s.timedBeats).toBe(true);
    expect(s.avoid).toBe('traffic');
  });

  it('can build the UGC set, which is the one it could not choose before', () => {
    const s = readStorySettings((built() as any).data);
    expect([s.cameraProgression, s.visualPreset, s.structure])
      .toEqual(['propped', 'smartphonePOV', 'ugcAd']);
  });

  it('still fills in sensible defaults for a plan that says nothing', () => {
    const { template } = compilePlan({ steps: [{ id: 's2', type: 'story', label: 'D' }] } as any);
    const s = readStorySettings((template!.nodes as any[]).find((n) => n.id === 's2')!.data);
    expect(s.structure).toBe(DEFAULT_STORY.structure);
    expect(s.cameraProgression).toBe(DEFAULT_STORY.cameraProgression);
    expect(s.audioMode).toBe(DEFAULT_STORY.audioMode);
    expect(s.timedBeats).toBe(false);
    expect(s.avoid).toBe('');
  });
});
