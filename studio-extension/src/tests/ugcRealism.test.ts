/**
 * Making UGC the thing it is pretending to be.
 *
 * The research is unanimous on why AI UGC reads as AI, and it is not subtle:
 * the models are trained toward "good". Even soft light, retouched skin,
 * symmetrical framing, a tidy room, shallow cinematic focus. Every one of
 * those is the opposite of what a phone in someone's kitchen produces, and
 * every one is a separate default the model applies unless told otherwise.
 *
 * Which is why the old preset did nothing. "Authentic vertical 9:16 handheld
 * smartphone POV camera, raw realism, viral social video aesthetic" is a mood.
 * A generator can satisfy every word of it and still return a poreless face
 * under an even key, because none of those words contradicts a default.
 *
 * So the upgrade is specifics, in three places:
 *   - the preset, rewritten as decisions rather than adjectives;
 *   - a realism section that overturns each default by name, placed last so
 *     it wins where it contradicts the sections above it;
 *   - a checker rule, because the realism instructions are the only part of
 *     the brief asking a model to make something WORSE than it knows how to,
 *     and that is the hardest kind of instruction to keep.
 */

/// <reference types="node" />

import {
  storyBrief, mergeNegatives, isUgc, UGC_NEGATIVE, ALWAYS_NEGATIVE,
  STRUCTURES, VISUAL_PRESETS, DEFAULT_STORY, type StorySettings,
} from '../studio/ask/storyPlan';
import { checkShots, type Shot, type ShotTarget } from '../studio/ask/storyboard';
import { TEMPLATES } from '../studio/templates';

const targets: ShotTarget[] = [
  { id: 'a', label: 'One', media: 'video', platform: 'flow', duration: '8s' },
  { id: 'b', label: 'Two', media: 'video', platform: 'flow', duration: '8s' },
];

const brief = (over: Partial<StorySettings>) =>
  storyBrief('a woman reviews a serum', { ...DEFAULT_STORY, ...over }, targets);

const codes = (prompt: string, ugc: boolean) =>
  checkShots(
    [{ n: 1, title: 'One', prompt } as Shot],
    [targets[0]],
    'a woman in a beige ribbed tank top',
    undefined,
    ugc,
  ).map((p) => p.code);

describe('what counts as a UGC piece', () => {
  it('is any of the three settings that mean it, not all of them', () => {
    expect(isUgc({ ...DEFAULT_STORY, cameraProgression: 'propped' })).toBe(true);
    expect(isUgc({ ...DEFAULT_STORY, visualPreset: 'smartphonePOV' })).toBe(true);
    expect(isUgc({ ...DEFAULT_STORY, structure: 'ugcAd' })).toBe(true);
  });

  it('is not the default — a Story node is not a UGC node', () => {
    expect(isUgc(DEFAULT_STORY)).toBe(false);
    expect(brief({})).not.toContain('SHOT AS UGC');
  });
});

describe('the realism section', () => {
  const text = brief({ visualPreset: 'smartphonePOV' });

  it('names the tell that matters most first', () => {
    const body = text.slice(text.indexOf('SHOT AS UGC'));
    expect(body.indexOf('SKIN —')).toBeLessThan(body.indexOf('LIGHT —'));
    expect(body).toContain('pores');
    expect(body).toContain('No smoothing, no beauty filter');
  });

  it('overturns each default the model applies on its own', () => {
    for (const rule of ['LIGHT —', 'LENS —', 'FRAME —', 'ROOM —', 'WARDROBE —',
      'DELIVERY —', 'SOUND —']) {
      expect(text).toContain(rule);
    }
    /* The specific defaults, not just the headings. */
    expect(text).toMatch(/does not melt into bokeh/);
    expect(text).toMatch(/lands on the thirds means a crew/);
    expect(text).toMatch(/Nothing cleared or styled for camera/);
    expect(text).toMatch(/No music\s+underneath/);   // wraps across two lines
  });

  it('says it wins where it contradicts what is above it — and is placed there', () => {
    expect(text).toContain('this wins');
    /* Position is the mechanism, not the sentence: a later instruction is the
       one that survives, so the section has to come after the camera and the
       audio it overrules. */
    expect(text.indexOf('SHOT AS UGC'))
      .toBeGreaterThan(text.indexOf('CINEMATOGRAPHY & CAMERA'));
    expect(text.indexOf('SHOT AS UGC'))
      .toBeGreaterThan(text.indexOf('AUDIO & SOUND DESIGN'));
  });

  it('demands the realism reach every prompt, not just this brief', () => {
    /* The same reason the CAST block insists on it: each clip is generated
       alone from its own prompt and remembers nothing. */
    expect(text).toMatch(/Carry SKIN, LIGHT and LENS into EVERY video prompt/);
    expect(text).toMatch(/generated alone and remembers nothing/);
  });
});

describe('the smartphone preset', () => {
  const preset = VISUAL_PRESETS.find((p) => p.id === 'smartphonePOV')!;

  it('is decisions now, not adjectives', () => {
    /* Each of these is something the generator has to do differently. The
       words it replaced — "raw realism", "viral social video aesthetic" —
       could be satisfied by the default output. */
    for (const decision of ['other side of the face left dark', 'visible pores',
      'stays legible', 'sensor noise', 'off level']) {
      expect(preset.stylePrompt).toContain(decision);
    }
  });

  it('no longer claims an aspect ratio the node decides', () => {
    /* It used to say "vertical 9:16" while the generate node has its own
       aspect setting, so a 16:9 node was asking for both. */
    expect(preset.stylePrompt).not.toMatch(/9:16|vertical/i);
  });
});

describe('the guardrail line', () => {
  it('folds the UGC exclusions in for a UGC piece only', () => {
    expect(brief({ visualPreset: 'smartphonePOV' })).toContain('no music bed');
    expect(brief({ visualPreset: 'cinema35mm' })).not.toContain('no music bed');
  });

  it('says nothing twice, however much the lists overlap', () => {
    const line = brief({ visualPreset: 'smartphonePOV' })
      .split('\n').find((l) => l.includes('Guardrails (Negative):'))!;
    const clauses = line.split('Guardrails (Negative):')[1].split(',').map((c) => c.trim().toLowerCase());
    expect(new Set(clauses).size).toBe(clauses.length);
  });

  it('reads as one sentence rather than three stuck together', () => {
    const line = brief({ visualPreset: 'smartphonePOV' })
      .split('\n').find((l) => l.includes('Guardrails (Negative):'))!;
    /* The join used to leave "...tidied set no on-screen text" with no comma
       and a capital N in the middle of the sentence. */
    expect(line).not.toMatch(/set no on-screen/);
    expect(line.split('Guardrails (Negative): ')[1]).not.toMatch(/[a-z] No /);
    expect(line.trimEnd().endsWith('.')).toBe(true);
  });

  it('merges cleanly on its own', () => {
    expect(mergeNegatives('No a, no b.', 'no b, no c')).toBe('No a, no b, no c.');
    expect(mergeNegatives('', undefined, '')).toBe('');
    expect(mergeNegatives('No Hollywood rigidity.')).toBe('No Hollywood rigidity.');
  });

  it('never drops a clause that is only in one of the lists', () => {
    const merged = mergeNegatives(UGC_NEGATIVE, ALWAYS_NEGATIVE).toLowerCase();
    for (const only of ['no lens flare', 'no slow motion', 'no styled or tidied set',
      'no watermark', 'no fake app interface']) {
      expect(merged).toContain(only);
    }
  });
});

describe('the UGC ad structure', () => {
  const shape = STRUCTURES.find((s) => s.id === 'ugcAd')!;

  it('opens on the hook with no throat-clearing', () => {
    expect(shape.shape.join(' ')).toMatch(/FIRST words are the hook/);
    expect(shape.shape.join(' ')).toMatch(/hey guys/i);
  });

  it('is the four parts a creator ad has, in order', () => {
    const joined = shape.shape.join('\n');
    expect(joined.indexOf('HOOK')).toBeLessThan(joined.indexOf('PROBLEM'));
    expect(joined.indexOf('PROBLEM')).toBeLessThan(joined.indexOf('PROOF'));
    expect(joined.indexOf('PROOF')).toBeLessThan(joined.indexOf('CTA'));
  });

  it('reaches the brief and brings the realism with it', () => {
    const text = brief({ structure: 'ugcAd' });
    expect(text).toContain('UGC Ad — Hook ➜ Problem ➜ Proof ➜ CTA');
    expect(text).toContain('SHOT AS UGC');
  });

  it('leaves the other structures alone', () => {
    expect(brief({ structure: 'transform' })).not.toContain('the FIRST words are the hook');
  });
});

describe('the checker catches the film vocabulary a writer reaches for', () => {
  const REAL = 'A woman in a beige ribbed tank top presses the cream into her cheek and turns '
    + 'toward the window, one bright window source with the far side of her face dark, skin '
    + 'with visible pores and a faint shine. Ambient noise: a quiet bathroom.';

  it('passes a prompt that describes phone footage', () => {
    expect(codes(REAL, true)).not.toContain('ugcProduced');
  });

  it('fails the words a phone cannot produce', () => {
    for (const tell of ['cinematic lighting', 'shallow depth of field', 'creamy bokeh',
      'studio lighting', 'a slow dolly in', 'lens flare', 'in slow motion',
      'colour graded', 'flawless skin', 'shot on 35mm film']) {
      expect(codes(`${REAL} ${tell}.`, true)).toContain('ugcProduced');
    }
  });

  it('names the words it found, so the repair knows what to remove', () => {
    const problem = checkShots(
      [{ n: 1, title: 'One', prompt: `${REAL} Cinematic, shallow depth of field.` } as Shot],
      [targets[0]], 'a woman in a beige ribbed tank top', undefined, true,
    ).find((p) => p.code === 'ugcProduced')!;
    expect(problem.detail).toContain('cinematic');
    expect(problem.detail).toContain('shallow depth of field');
  });

  it('says each word once however often it appears', () => {
    const problem = checkShots(
      [{ n: 1, title: 'One', prompt: `${REAL} Cinematic, cinematic, CINEMATIC.` } as Shot],
      [targets[0]], 'a woman in a beige ribbed tank top', undefined, true,
    ).find((p) => p.code === 'ugcProduced')!;
    expect(problem.detail.match(/cinematic/gi)).toHaveLength(1);
  });

  it('is silent on a piece that is not UGC — this is not a house style', () => {
    expect(codes(`${REAL} Cinematic, shallow depth of field, a slow dolly in.`, false))
      .not.toContain('ugcProduced');
  });

  it('leaves alone the things a phone really does do', () => {
    /* Deliberately narrower than the brief. Someone really does walk while
       holding their phone, and a window really is gold at six o'clock —
       flagging those would fail correct prompts. */
    for (const fine of ['a tracking shot as she walks', 'golden hour through the window',
      'shot in 4K', 'handheld', 'she moves out of focus for a moment']) {
      expect(codes(`${REAL} ${fine}.`, true)).not.toContain('ugcProduced');
    }
  });
});

describe('nothing shipped trips the new rule', () => {
  it('no template prompt reads as a production', () => {
    for (const tpl of TEMPLATES) {
      for (const node of tpl.nodes as any[]) {
        const prompt = String(node.data?.prompt || node.data?.text || '');
        if (!prompt.trim() || node.data?.mediaType === 'text') continue;
        /* Only the ones a UGC story would be writing for. A cinema template
           saying "cinematic" is the template working. */
        const story = (tpl.nodes as any[]).find((n) => n.type === 'story');
        if (!story || !isUgc({ ...DEFAULT_STORY, ...story.data })) continue;
        expect(codes(prompt, true)).not.toContain('ugcProduced');
      }
    }
  });

  it('every template still builds a brief', () => {
    for (const tpl of TEMPLATES) {
      for (const node of tpl.nodes as any[]) {
        if (node.type !== 'story') continue;
        expect(() => storyBrief('an idea', { ...DEFAULT_STORY, ...node.data }, targets))
          .not.toThrow();
      }
    }
  });
});
