/**
 * What the builder can reach.
 *
 * Three things existed in the product and could not be named from a plan, so a
 * built workflow could never use them:
 *
 *   preset      Every Ask AI preset. The presets carry the craft — the angles,
 *               the lighting, the trap to avoid — and "preset" was not a plan
 *               field at all, so the builder could only ever send a bare
 *               subject and get the flat result the presets exist to prevent.
 *   colorTemp   Added to the Story node and never told to the builder.
 *   lighting    Same.
 *
 * A field the compiler drops is a setting that silently does nothing, which is
 * this codebase's most-repeated bug — so each is checked here on the way in
 * AND on the way out.
 */

/// <reference types="node" />

import { readFileSync } from 'fs';
import { join } from 'path';
import { compilePlan } from '../studio/builder/plan';
import { buildSpec } from '../studio/builder/spec';
import { BUILTIN_ASK_PRESETS } from '../studio/presets';

const SPEC = buildSpec('a skincare ad');

const dataFor = (steps: any[], id: string) => {
  const { template, problems } = compilePlan({ name: 't', steps } as any);
  expect(problems).toEqual([]);
  return ((template?.nodes || []).find((n: any) => n.id === id)?.data || {}) as any;
};

describe('every preset the spec offers is real', () => {
  /* The preset list, read out of the spec block rather than guessed at. A spec
     naming a preset that does not exist teaches the builder to emit a value
     findPreset returns nothing for, and the step silently sends its subject
     bare — the exact failure presets exist to prevent. */
  const block = (() => {
    /* From the first listed id, not from the header — the header says
       (media "text" only) and "text" is not a preset. */
    const at = SPEC.indexOf('"storyboard_sheet"');
    return SPEC.slice(at, SPEC.indexOf('When:', at));
  })();
  const named = Array.from(block.matchAll(/"([a-z0-9_]+)"/g), (m) => m[1]);
  const real = new Set(BUILTIN_ASK_PRESETS.map((p) => p.id));

  it('names some', () => {
    expect(named.length).toBeGreaterThan(5);
  });

  it.each(Array.from(new Set(named)))('%s exists', (id) => {
    expect(real.has(id)).toBe(true);
  });

  it('offers the storyboard board, which is the point of this pass', () => {
    expect(named).toContain('storyboard_sheet');
  });
});

describe('a plan can name a preset', () => {
  it('carries it onto a text step', () => {
    const d = dataFor([{
      id: 'w', type: 'generate', media: 'text', platform: 'gemini',
      prompt: 'a 6-shot skincare ad', preset: 'storyboard_sheet',
    }], 'w');
    expect(d.preset).toBe('storyboard_sheet');
  });

  it('ignores it on an image or video step, which have no preset picker', () => {
    const img = dataFor([{
      id: 'i', type: 'generate', media: 'image', platform: 'flow',
      prompt: 'a bottle', preset: 'character_sheet',
    }], 'i');
    expect(img.preset).toBeUndefined();
  });
});

describe('a plan can set the film language', () => {
  const story = (over: Record<string, unknown> = {}) => dataFor([{
    id: 's', type: 'story', platform: 'gemini', prompt: 'a shoe ad', ...over,
  }], 's');

  it('carries both onto the director', () => {
    const d = story({ colorTemp: 'daylight', lighting: 'hero' });
    expect(d.colorTemp).toBe('daylight');
    expect(d.lighting).toBe('hero');
  });

  it('defaults to none rather than to undefined', () => {
    /* readStorySettings falls back on DEFAULT_STORY, but a node written with
       the field absent and a node written with 'none' should not behave
       differently. */
    const d = story();
    expect(d.colorTemp).toBe('none');
    expect(d.lighting).toBe('none');
  });

  it('is documented where the builder will read it', () => {
    expect(SPEC).toMatch(/colorTemp: "daylight" \(5600K\)/);
    expect(SPEC).toMatch(/lighting: "hero" \| "intimate" \| "tension" \| "none"/);
  });

  it('warns that hero lighting fights the UGC preset', () => {
    /* Measured on a real run: visualPreset "smartphonePOV" carries a negative
       banning studio lighting, while "hero" asks for a sculpted key and
       volumetric backlight. Given both, Gemini wrote "single natural light
       source" and hero lost. Better the builder never pairs them. */
    expect(SPEC).toMatch(/Do NOT pair "hero" with visualPreset\s*\n?\s*"smartphonePOV"/);
  });
});
