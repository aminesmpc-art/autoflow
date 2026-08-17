/**
 * The other half of why UGC looks fake: the camera, and what the frame carries.
 *
 * A dolly move reads as stock footage no matter how good the person in it is.
 * Real phone video is a phone leaning on something — locked, chest-up, one
 * unhurried action. That is also the framing lip sync needs, so the camera
 * option and the dialogue rules want the same thing.
 *
 * Which exposes a contradiction that was already shipping. Director Coverage —
 * the default — asks for a WIDE establishing shot first. With dialogue on,
 * shot 1 is then simultaneously "wide" and "someone speaks", and the checker
 * fails what the brief asked for. The brief now reconciles the two itself
 * instead of leaving the writer to pick whichever line it read last.
 *
 * And the negatives: on-screen captions were only excluded by one preset out
 * of five. Veo puts subtitles on unprompted often enough that it has to be
 * unconditional.
 */

/// <reference types="node" />

import {
  storyBrief, ALWAYS_NEGATIVE, CAMERA_PROGRESSIONS, VISUAL_PRESETS, DEFAULT_STORY,
  type StorySettings,
} from '../studio/ask/storyPlan';
import { TEMPLATES } from '../studio/templates';

const targets = [
  { id: 'a', label: 'One', media: 'video' as const, platform: 'flow', duration: '8s' },
  { id: 'b', label: 'Two', media: 'video' as const, platform: 'flow', duration: '8s' },
];

const brief = (over: Partial<StorySettings>) =>
  storyBrief('a woman reviews a serum', { ...DEFAULT_STORY, ...over }, targets);

describe('the propped-phone camera option', () => {
  const propped = CAMERA_PROGRESSIONS.find((c) => c.id === 'propped');

  it('exists as a coverage choice, not a new control to configure', () => {
    /* Deliberately an entry in the dropdown that is already on the node. The
       Story node's own UI is not touched. */
    expect(propped).toBeTruthy();
    expect(propped!.name).toMatch(/UGC/i);
  });

  it('forbids every camera move, because one move gives it away', () => {
    const text = brief({ cameraProgression: 'propped' });
    for (const move of ['pan', 'tilt', 'zoom', 'doll', 'orbit']) {
      expect(text.toLowerCase()).toContain(move);
    }
    expect(text).toMatch(/never pans|no pans/i);
  });

  it('asks for the framing lip sync actually needs', () => {
    expect(brief({ cameraProgression: 'propped' })).toMatch(/chest-up/i);
  });

  it('keeps the action slow, and the phone out of its own shot', () => {
    const text = brief({ cameraProgression: 'propped' });
    expect(text).toMatch(/ONE slow deliberate/);
    expect(text).toMatch(/phone itself is never visible/i);
  });

  it('does not disturb the other coverage options', () => {
    const dynamic = brief({ cameraProgression: 'dynamic', audioMode: 'none' });
    expect(dynamic).toContain('Director Coverage');
    expect(dynamic).not.toContain('PROPPED PHONE');
  });
});

describe('the wide-opener contradiction', () => {
  it('resolves it when the coverage opens wide and someone has to speak', () => {
    const text = brief({ cameraProgression: 'dynamic', audioMode: 'dialogue' });
    expect(text).toContain('Wide establishing context');   // still asked for
    expect(text).toMatch(/SPEAKING.*chest-up|chest-up or a medium/is);
    expect(text).toMatch(/wide shot on a[\s\S]*moment where nobody talks/i);
  });

  it('covers the push-in progression too — it starts wider still', () => {
    expect(brief({ cameraProgression: 'establishingToClose', audioMode: 'dialogue' }))
      .toMatch(/A wide frame cannot hold a/);
  });

  it('applies on the defaults, where the clash actually bites', () => {
    /* Director Coverage + Layered Cinematic Audio are what an untouched Story
       node runs with, so an unconfigured node is exactly the failing case. */
    expect(DEFAULT_STORY.cameraProgression ?? 'dynamic').toBe('dynamic');
    const text = brief({});
    expect(text).toMatch(/there is not enough face to animate/);
  });

  it('stays quiet when nobody speaks — there is nothing to reconcile', () => {
    for (const audioMode of ['ambient', 'none'] as const) {
      expect(brief({ cameraProgression: 'dynamic', audioMode }))
        .not.toMatch(/not enough face to animate/);
    }
  });

  it('stays quiet when the coverage never goes wide', () => {
    for (const cameraProgression of ['propped', 'fixed', 'actionTracking'] as const) {
      expect(brief({ cameraProgression, audioMode: 'dialogue' }))
        .not.toMatch(/not enough face to animate/);
    }
  });
});

describe('caption guardrails', () => {
  it('excludes burnt-in text on every shot', () => {
    for (const word of ['captions', 'subtitles', 'watermark']) {
      expect(ALWAYS_NEGATIVE).toContain(word);
    }
  });

  it('is present with a visual preset', () => {
    const text = brief({ visualPreset: 'cinema35mm' });
    expect(text).toContain('Guardrails (Negative):');
    expect(text).toContain('no captions');
  });

  it('is present with NO visual preset — the case it was missing from', () => {
    const text = brief({ visualPreset: 'none', look: '' });
    expect(text).toContain('Guardrails (Negative):');
    expect(text).toContain('no subtitles');
  });

  it('keeps the preset\'s own negatives rather than replacing them', () => {
    const preset = VISUAL_PRESETS.find((p) => p.id === 'cinema35mm')!;
    const line = brief({ visualPreset: 'cinema35mm' })
      .split('\n').find((l) => l.includes('Guardrails (Negative):'))!;
    /* Both halves on the one line: what the preset excludes, then what is
       excluded everywhere. Asserted clause by clause on the preset's actual
       words — a length comparison passes even when the preset half has been
       dropped, and the clauses are re-punctuated when the lists are merged. */
    expect(preset.negativePrompt).toBeTruthy();
    for (const clause of preset.negativePrompt.split(/[,.]/)) {
      if (clause.trim()) expect(line.toLowerCase()).toContain(clause.trim().toLowerCase());
    }
    for (const clause of ALWAYS_NEGATIVE.split(',')) {
      expect(line.toLowerCase()).toContain(clause.trim().toLowerCase());
    }
  });

  it('appears exactly once, not repeated per shot', () => {
    const hits = brief({ visualPreset: 'cinema35mm' }).match(/Guardrails \(Negative\)/g) || [];
    expect(hits).toHaveLength(1);
  });
});

describe('nothing shipped is broken by either change', () => {
  it('every template with a story still produces a brief', () => {
    const withStory = TEMPLATES.filter((t) =>
      t.nodes.some((n: any) => n.type === 'story'));
    expect(withStory.length).toBeGreaterThan(0);

    for (const tpl of withStory) {
      for (const node of tpl.nodes as any[]) {
        if (node.type !== 'story') continue;
        const text = storyBrief('an idea', { ...DEFAULT_STORY, ...node.data }, targets);
        expect(text).toContain('Guardrails (Negative):');
        /* A template that picked a locked camera must not be handed the
           wide-shot reconciliation — it has no wide shot. */
        if (node.data?.cameraProgression === 'fixed') {
          expect(text).not.toMatch(/not enough face to animate/);
        }
      }
    }
  });
});
