/**
 * POV Survival / GoPro Diary — a Director preset for first-person pieces.
 *
 * The format this exists for: prehistoric survival, Viking, medieval,
 * post-apocalyptic, wilderness, historical diary. The viewer should believe
 * the camera is strapped to the person whose story it is.
 *
 * ── What it is, and what it deliberately is not ───────────────────────────
 *
 * Eighteen settings in ONE optional object on the Director, not eighteen
 * fields on StorySettings and PlanStep. They are eighteen answers about a
 * single decision — how the camera relates to the body carrying it.
 *
 * Three of the settings the format needs already existed and are reused
 * rather than duplicated, and these tests hold that line:
 *
 *   audio strategy → audioMode ('ambient' is environment-only)
 *   camera rig     → cameraProgression 'mountedPOV' for the coarse choice
 *   shot duration  → each shot's own `duration`
 *
 * And none of it is a generation parameter. Flow exposes no lens, no
 * stabilisation and no camera height; there is nothing to send them to. They
 * exist to become prose the video model obeys.
 *
 * ── The invariant every test here protects ────────────────────────────────
 *
 * A Director that has never heard of this writes exactly the brief it always
 * wrote. Not one word different.
 */

/// <reference types="node" />

import {
  readPovSettings, povBriefLines, povContinuityLines, povProgressionLines,
  POV_SURVIVAL_DEFAULTS, POV_SURVIVAL_PRESET_ID, povSheetGuidance,
} from '../studio/ask/povSurvival';
import {
  readStorySettings, effectivePov, povSurvivalPresetPatch, storyBrief,
  DEFAULT_STORY, VISUAL_PRESETS, STRUCTURES,
  type StorySettings,
} from '../studio/ask/storyPlan';
import { readPlan, compilePlan } from '../studio/builder/plan';
import { checkPlan, summarisePlan } from '../studio/builder/check';
import { validateTemplate } from '../studio/templates/validate';
import { NODE_MANUAL } from '../studio/builder/spec';

const shot = (id: string, extra: Record<string, unknown> = {}) => ({
  id, type: 'generate', media: 'video', platform: 'flow',
  aspectRatio: '9:16', duration: '6s', inputs: ['director'], ...extra,
});

/** A Director plan in the new format, with the frame chain underneath it. */
const povPlan = (directorExtra: Record<string, unknown> = {}) => ({
  name: 'POV episode',
  steps: [
    {
      id: 'director', type: 'story', label: 'POV Director', platform: 'gemini',
      prompt: 'Eight beats of a first-person prehistoric survival episode.',
      visualPreset: POV_SURVIVAL_PRESET_ID,
      structure: 'survivalDiary',
      cameraProgression: 'mountedPOV',
      audioMode: 'ambient',
      cast: [{ name: 'Elder', look: 'weathered, grey-streaked hair, fur cloak' }],
      world: 'cold rocky grassland',
      rules: ['frameChain', 'samePerson'],
      ...directorExtra,
    },
    shot('s1'),
    { id: 'f1', type: 'frame', inputs: ['s1'] },
    { ...shot('s2'), inputs: ['f1', 'director'] },
    { id: 'f2', type: 'frame', inputs: ['s2'] },
    { ...shot('s3'), inputs: ['f2', 'director'] },
  ],
});

/* ────────────────────────────────────────────────────────────────────────
   1. Nothing that existed before behaves differently
   ──────────────────────────────────────────────────────────────────────── */

describe('a Director that knows nothing about POV is untouched', () => {
  const plain: StorySettings = {
    ...DEFAULT_STORY,
    cast: [{ name: 'Ana', look: 'red coat' }],
    world: 'a wet street',
    look: 'neon',
  };

  it('resolves no POV settings at all', () => {
    expect(readStorySettings({ cast: [], world: '' }).pov).toBeUndefined();
    expect(effectivePov(plain)).toBeUndefined();
  });

  it('writes a brief with no POV section in it', () => {
    const brief = storyBrief('a walk in the rain', plain, [
      { id: 'a', label: 'one', media: 'video', platform: 'flow', aspectRatio: '9:16', duration: '6s' },
    ] as any);
    expect(brief).not.toMatch(/POINT OF VIEW/);
    expect(brief).not.toMatch(/CONTINUITY ANCHORS/);
    expect(brief).not.toMatch(/HOW THE POV MOVES/);
  });

  it('compiles an existing Director plan unchanged, with no pov on the node', () => {
    const { plan } = readPlan(JSON.stringify({
      name: 'ordinary',
      steps: [
        { id: 'director', type: 'story', prompt: 'three shots of a cat', platform: 'chatgpt' },
        shot('a', { inputs: ['director'] }),
        shot('b', { inputs: ['director'] }),
        shot('c', { inputs: ['director'] }),
      ],
    }));
    const out: any = compilePlan(plan!, { id: 'ordinary' });
    expect(out.problems).toEqual([]);
    expect(validateTemplate(out.template)).toEqual([]);
    const director = out.template.nodes.find((n: any) => n.type === 'story')!;
    expect((director.data as any).pov).toBeUndefined();
  });

  it('loads an old saved workflow that has no pov key', () => {
    /* Backward compatibility, stated as the thing it actually is: node data
       written before this feature existed, read by the reader that now knows
       about it. */
    const old = {
      type: 'story', label: 'Director', platform: 'chatgpt',
      cast: [], world: 'a kitchen', look: '', structure: 'hook', beats: 0,
      rules: ['samePerson'], cameraProgression: 'dynamic', audioMode: 'cinematic',
      visualPreset: 'liveAction', colorTemp: 'none', lighting: 'none',
    };
    const s = readStorySettings(old);
    expect(s.pov).toBeUndefined();
    expect(s.world).toBe('a kitchen');
    expect(s.visualPreset).toBe('liveAction');
  });
});

/* ────────────────────────────────────────────────────────────────────────
   2. The preset
   ──────────────────────────────────────────────────────────────────────── */

describe('the preset', () => {
  it('is offered where every other visual preset is', () => {
    const entry = VISUAL_PRESETS.find((p) => p.id === POV_SURVIVAL_PRESET_ID);
    expect(entry).toBeDefined();
    expect(entry!.name).toBe('POV Survival / GoPro Diary');
    /* A style preset's job: what it looks like, and what it must not. */
    expect(entry!.stylePrompt).toMatch(/first-person/i);
    expect(entry!.negativePrompt).toMatch(/gimbal|drone|floating/i);
  });

  it('uses the codebase\'s camelCase preset naming, not snake_case', () => {
    for (const p of VISUAL_PRESETS) expect(p.id).not.toMatch(/_/);
    expect(POV_SURVIVAL_PRESET_ID).toBe('povSurvival');
  });

  it('turns the format on by itself, with no pov block', () => {
    /* Naming the preset and nothing else has to produce a coherent
       first-person piece, or the preset is decoration. */
    const s: StorySettings = { ...DEFAULT_STORY, visualPreset: POV_SURVIVAL_PRESET_ID };
    expect(effectivePov(s)).toEqual(POV_SURVIVAL_DEFAULTS);
  });

  it('applies the documented defaults', () => {
    const d = POV_SURVIVAL_DEFAULTS;
    expect(d.perspective).toBe('firstPerson');
    expect(d.rig).toBe('bodyMounted');
    expect(d.lens).toBe('20mm');
    expect(d.stabilization).toBe('low');
    expect(d.bodyMovement).toBe('natural');
    expect(d.cameraHeight).toBe('eyeLevel');
    expect(d.framing).toBe('imperfectDocumentary');
    expect(d.showHands).toBe(true);
    expect(d.showForearms).toBe(true);
    expect(d.showForegroundProp).toBe(true);
    expect(d.protagonistFaceVisible).toBe(false);
    expect(d.awareness).toBe('natural');
    expect(d.interactionDistance).toBe('close');
    expect(d.continuity).toBe('strict');
    expect(d.preferredShotDuration).toBe('8s');
    expect(d.narrationStrategy).toBe('firstPersonDiary');
    expect(d.narrationPerson).toBe('firstPerson');
    expect(d.hookTiming).toBe('immediate');
    /* mediumHigh, not high: "every shot does something" was producing six
       actions inside six seconds. The new value asks for one thing per shot. */
    expect(d.actionDensity).toBe('mediumHigh');
    /* none, not low. 'low' still invited speech, and this preset's whole
       audio contract is environmental sound with narration added later. */
    expect(d.dialogueDensity).toBe('none');
    /* The rig is not in shot unless somebody asks for it. */
    expect(d.showCameraMount).toBe(false);
    expect(d.endingStyle).toBe('cliffhanger');
    expect(d.revealStyle).toBe('visualBeforeExplanation');
    /* The three new behaviour settings. */
    expect(d.povParticipation).toBe('active');
    expect(d.animalStyle).toBe('naturalRealism');
    expect(d.groupStaging).toBe('embedded');
  });

  it('never erases the story when it is selected', () => {
    /* The requirement in one test: cast, world, look, avoid and beats are the
       user's work. A preset is how the piece is shot, not what it is about. */
    const written: StorySettings = {
      ...DEFAULT_STORY,
      cast: [{ name: 'Noor', look: 'teal blouse' }],
      world: 'a design office',
      look: 'muted',
      avoid: 'no logos',
      beats: 5,
    };
    const patch = povSurvivalPresetPatch(written);
    expect(patch.cast).toBeUndefined();
    expect(patch.world).toBeUndefined();
    expect(patch.look).toBeUndefined();
    expect(patch.avoid).toBeUndefined();
    expect(patch.beats).toBeUndefined();
    expect(patch.visualPreset).toBe(POV_SURVIVAL_PRESET_ID);
    expect(patch.pov).toEqual(POV_SURVIVAL_DEFAULTS);
  });

  it('fills the format settings only while they are still factory defaults', () => {
    const untouched = povSurvivalPresetPatch({ ...DEFAULT_STORY });
    expect(untouched.structure).toBe('survivalDiary');
    expect(untouched.cameraProgression).toBe('mountedPOV');
    expect(untouched.audioMode).toBe('ambient');

    /* Someone who chose ASMR Craftsmanship chose it. */
    const chosen = povSurvivalPresetPatch({
      ...DEFAULT_STORY, audioMode: 'asmrCraft', structure: 'craftTransform',
      cameraProgression: 'macroOrbit',
    });
    expect(chosen.audioMode).toBeUndefined();
    expect(chosen.structure).toBeUndefined();
    expect(chosen.cameraProgression).toBeUndefined();
  });

  it('adds the diary structures without disturbing the existing ones', () => {
    const ids = STRUCTURES.map((x) => x.id);
    for (const was of ['hook', 'twist', 'transform', 'buildTimelapse',
      'craftTransform', 'loop', 'ugcAd', 'free']) {
      expect(ids).toContain(was);
    }
    expect(ids).toContain('survivalDiary');
    const diary = STRUCTURES.find((x) => x.id === 'survivalDiary')!;
    /* The eight-beat shape lives in the STRUCTURE, as guidance. It is not a
       graph requirement — beatsFor still counts the shots actually wired. */
    expect(diary.shape.join(' ')).toMatch(/HOOK[\s\S]*TACTILE[\s\S]*REVEAL[\s\S]*UNRESOLVED/);
  });
});

/* ────────────────────────────────────────────────────────────────────────
   3. Normalising, not rejecting
   ──────────────────────────────────────────────────────────────────────── */

describe('unknown values', () => {
  it('become the preset default rather than failing the build', () => {
    /* How readStorySettings already treats a setting it does not recognise.
       A plan naming a 50mm lens gets a working piece, not a dead build. */
    const p = readPovSettings({ lens: '50mm', perspective: 'sideways', continuity: 7 })!;
    expect(p.lens).toBe('20mm');
    expect(p.perspective).toBe('firstPerson');
    expect(p.continuity).toBe(POV_SURVIVAL_DEFAULTS.continuity);
  });

  it('keeps the values it does recognise', () => {
    const p = readPovSettings({ lens: '14mm', protagonistFaceVisible: true })!;
    expect(p.lens).toBe('14mm');
    expect(p.protagonistFaceVisible).toBe(true);
    expect(p.rig).toBe('bodyMounted');
  });

  it('is undefined for anything that is not an object', () => {
    for (const junk of [undefined, null, '', 0, 'povSurvival', []]) {
      const got = readPovSettings(junk as unknown);
      if (Array.isArray(junk)) expect(got).toBeDefined();  // an array IS an object
      else expect(got).toBeUndefined();
    }
  });
});

/* ────────────────────────────────────────────────────────────────────────
   4. The brief the settings actually produce
   ──────────────────────────────────────────────────────────────────────── */

describe('the settings change what the Director writes', () => {
  const lines = povBriefLines(POV_SURVIVAL_DEFAULTS).join('\n');

  it('states the perspective as a fact about every shot', () => {
    expect(lines).toMatch(/first-person piece/i);
    expect(lines).toMatch(/IS the protagonist's viewpoint/);
  });

  it('forbids the face, the gimbal and the third-person cutaway', () => {
    expect(lines).toMatch(/face is never visible/i);
    expect(lines).toMatch(/DELIBERATE cinematic move/);
    expect(lines).toMatch(/No third-person cutaway/);
  });

  it('allows the body parts the toggles allow, and no others', () => {
    expect(lines).toMatch(/their hands, their forearms and whatever they are carrying/);
    const noHands = povBriefLines({
      ...POV_SURVIVAL_DEFAULTS, showHands: false, showForearms: false, showForegroundProp: false,
    }).join('\n');
    expect(noHands).toMatch(/No part of the camera's owner enters the frame/);
  });

  it('writes prose, never the enum names', () => {
    /* "imperfectDocumentary" means nothing to a generator. This is the whole
       difference between a setting and a parameter. */
    for (const enumName of ['imperfectDocumentary', 'bodyMounted', 'firstPersonDiary',
      'visualBeforeExplanation', 'eyeLevel', 'softCliffhanger']) {
      expect(lines).not.toContain(enumName);
    }
    expect(lines).toMatch(/framing is allowed to be imperfect/);
    expect(lines).toMatch(/worn on the body, driven by the torso and the head/);
  });

  it('keeps narration out of the clips', () => {
    expect(lines).toMatch(/Do NOT write narration, voice-over or spoken/);
    expect(lines).toMatch(/recorded separately/);
    const silent = povBriefLines({ ...POV_SURVIVAL_DEFAULTS, narrationStrategy: 'none' }).join('\n');
    expect(silent).not.toMatch(/recorded separately/);
  });

  it('repeats the continuity anchors only when asked to', () => {
    expect(povContinuityLines({ ...POV_SURVIVAL_DEFAULTS, continuity: 'normal' })).toEqual([]);
    const high = povContinuityLines(POV_SURVIVAL_DEFAULTS).join('\n');
    expect(high).toMatch(/same recurring cast/);
    expect(high).toMatch(/same hands, forearms and sleeves/);
    expect(high).toMatch(/same direction of travel/);
    const strict = povContinuityLines({ ...POV_SURVIVAL_DEFAULTS, continuity: 'strict' }).join('\n');
    expect(strict).toMatch(/WORD FOR WORD/);
  });

  it('offers a camera progression rather than imposing one', () => {
    const prog = povProgressionLines(POV_SURVIVAL_DEFAULTS).join('\n');
    expect(prog).toMatch(/a shape, not a schedule/);
    expect(prog).toMatch(/do not use them in this order/i);
    /* Third person has no POV progression to suggest. */
    expect(povProgressionLines({ ...POV_SURVIVAL_DEFAULTS, perspective: 'thirdPerson' })).toEqual([]);
  });

  it('reaches the real brief, in front of the camera coverage', () => {
    const s: StorySettings = {
      ...DEFAULT_STORY, visualPreset: POV_SURVIVAL_PRESET_ID, cameraProgression: 'mountedPOV',
      world: 'cold grassland', cast: [{ name: 'Elder', look: 'fur cloak' }],
    };
    const brief = storyBrief('a survival episode', s, [
      { id: 'a', label: 'one', media: 'video', platform: 'flow', aspectRatio: '9:16', duration: '6s' },
    ] as any);
    expect(brief).toMatch(/POINT OF VIEW/);
    expect(brief).toMatch(/CONTINUITY ANCHORS/);
    /* Perspective is a fact about the piece; coverage is a choice about how to
       shoot it. On a POV piece shot with Body-Mounted POV coverage they are
       now the same subject, so the POV block speaks and the coverage block
       stands down rather than describing one camera twice. */
    expect(brief).not.toMatch(/MOUNTED CAMERA/);
    /* Any other coverage is a real combination and still prints. */
    const withCoverage = storyBrief('a survival episode',
      { ...s, cameraProgression: 'establishingToClose' }, [
        { id: 'a', label: 'one', media: 'video', platform: 'flow', aspectRatio: '9:16', duration: '6s' },
      ] as any);
    expect(withCoverage.indexOf('POINT OF VIEW'))
      .toBeLessThan(withCoverage.indexOf('CINEMATOGRAPHY & CAMERA'));
  });
});

/* ────────────────────────────────────────────────────────────────────────
   5. Through the plan, into a real graph
   ──────────────────────────────────────────────────────────────────────── */

describe('a POV plan compiles and validates', () => {
  it('parses, checks clean and produces a valid template', () => {
    const { plan, problem } = readPlan(JSON.stringify(povPlan()));
    expect(problem).toBeUndefined();
    expect(summarisePlan(checkPlan(plan!))).toBe('no problems');

    const out: any = compilePlan(plan!, { id: 'pov' });
    expect(out.problems).toEqual([]);
    expect(validateTemplate(out.template)).toEqual([]);
  });

  it('feeds every Flow video shot from the one Director', () => {
    const { plan } = readPlan(JSON.stringify(povPlan()));
    const out: any = compilePlan(plan!, { id: 'pov' });
    const fed = out.template.edges
      .filter((e: any) => e.source === 'director' && e.targetHandle === 'text')
      .map((e: any) => e.target);
    expect(fed.sort()).toEqual(['s1', 's2', 's3']);
  });

  it('keeps the clip -> frame -> clip continuity underneath it', () => {
    const { plan } = readPlan(JSON.stringify(povPlan()));
    const out: any = compilePlan(plan!, { id: 'pov' });
    const chain = out.template.edges
      .filter((e: any) => e.targetHandle === 'image_ref')
      .map((e: any) => `${e.source}->${e.target}`);
    expect(chain).toEqual(['s1->f1', 'f1->s2', 's2->f2', 'f2->s3']);
  });

  it('carries the pov block onto the Director node', () => {
    const { plan } = readPlan(JSON.stringify(povPlan({
      pov: { lens: '14mm', continuity: 'strict', protagonistFaceVisible: false },
    })));
    const out: any = compilePlan(plan!, { id: 'pov' });
    const d: any = out.template.nodes.find((n: any) => n.type === 'story')!.data;
    expect(d.pov.lens).toBe('14mm');
    expect(d.pov.continuity).toBe('strict');
    /* Filled in from the preset, not dropped. */
    expect(d.pov.rig).toBe('bodyMounted');
    /* And it survives the round trip a saved workflow makes. */
    expect(readStorySettings(d).pov!.lens).toBe('14mm');
  });

  it('is documented in the brief a model reads', () => {
    expect(NODE_MANUAL).toMatch(/povSurvival/);
    expect(NODE_MANUAL).toMatch(/survivalDiary/);
    expect(NODE_MANUAL).toMatch(/protagonistFaceVisible/);
    /* The reuse, said where a model will see it. */
    expect(NODE_MANUAL).toMatch(/audioMode "ambient"; there is no/);
  });
});

/* ────────────────────────────────────────────────────────────────────────
   6. Every existing rule still fires
   ──────────────────────────────────────────────────────────────────────── */

describe('checkPlan is unchanged by any of this', () => {
  const codes = (p: any) => checkPlan(p).map((x) => x.code);

  it('storyAndPrompts — a shot that writes itself while a Director writes the rest', () => {
    /* The rule catches a shot BYPASSING the director: its own prompt, and the
       director absent from its inputs. Such a shot sits outside the cast,
       world and look every other shot shares. */
    const p = povPlan();
    const s2: any = p.steps.find((s: any) => s.id === 's2');
    s2.prompt = 'its own words';
    s2.inputs = ['f1'];
    expect(codes(p)).toContain('storyAndPrompts');
  });

  it('a shot fed by the Director AND carrying a prompt is caught by the compiler', () => {
    /* checkPlan deliberately leaves this one alone — compilePlan already
       reports it, and a repair message listing the same fault twice reads as
       two faults, so the model "fixes" one and resends. */
    const p = povPlan();
    (p.steps.find((s: any) => s.id === 's2') as any).prompt = 'its own words';
    expect(codes(p)).not.toContain('storyAndPrompts');
    const out: any = compilePlan(readPlan(JSON.stringify(p)).plan!, { id: 'both' });
    expect(out.problems.join(' ')).toMatch(/s2/);
  });

  it('storyUnused — a POV Director nothing reads is still an error', () => {
    const p = povPlan();
    for (const s of p.steps as any[]) {
      if (s.inputs) s.inputs = s.inputs.filter((i: string) => i !== 'director');
    }
    expect(codes(p)).toContain('storyUnused');
  });

  it('noContinuity — still fires on three unlinked clips', () => {
    const p: any = {
      name: 'x',
      steps: [
        { id: 'director', type: 'story', prompt: 'three moments',
          visualPreset: POV_SURVIVAL_PRESET_ID },
        shot('a'), shot('b'), shot('c'),
      ],
    };
    expect(codes(p)).toContain('noContinuity');
    /* And still does NOT fire once the frame chain is there. */
    expect(codes(povPlan())).not.toContain('noContinuity');
  });

  it('mixedAspect — still fires when the clips disagree', () => {
    const p = povPlan();
    (p.steps.find((s: any) => s.id === 's3') as any).aspectRatio = '16:9';
    expect(codes(p)).toContain('mixedAspect');
  });

  it('voiceOnFrames — a POV piece cannot put a voice on a Frames shot', () => {
    /* Flow removes the ingredient menu in Frames mode, so no voice can
       attach. Unchanged by this feature, and checked because a POV piece is
       exactly the kind that reaches for start/end frames. */
    const p: any = povPlan();
    const s2: any = p.steps.find((x: any) => x.id === 's2');
    s2.startFrame = 'f1';
    s2.endFrame = 'f1';
    s2.voice = 'Achernar';
    expect(codes(p)).toContain('voiceOnFrames');
  });
});

/* ────────────────────────────────────────────────────────────────────────
   6. The upgrade — new behaviour settings and brief sections
   ──────────────────────────────────────────────────────────────────────── */

describe('the upgrade — new behaviour settings', () => {
  const d = POV_SURVIVAL_DEFAULTS;
  const brief = () => povBriefLines(d);
  const briefText = () => brief().join('\n');

  /* ── active participation ── */
  it('includes PARTICIPATION section when active', () => {
    expect(briefText()).toMatch(/POV PARTICIPATION/);
    expect(briefText()).toMatch(/IN the group, not behind it/);
  });

  it('omits PARTICIPATION section when passive', () => {
    const passive = { ...d, povParticipation: 'passive' as const };
    expect(povBriefLines(passive).join('\n')).not.toMatch(/POV PARTICIPATION/);
  });

  it('includes a lighter note when natural', () => {
    const natural = { ...d, povParticipation: 'natural' as const };
    const text = povBriefLines(natural).join('\n');
    expect(text).toMatch(/POV PARTICIPATION/);
    expect(text).toMatch(/participates when the story calls for it/);
  });

  /* ── group staging ── */
  it('includes GROUP STAGING section when embedded', () => {
    expect(briefText()).toMatch(/GROUP STAGING/);
    expect(briefText()).toMatch(/hands working close to lens/);
  });

  it('omits GROUP STAGING when distant', () => {
    const distant = { ...d, groupStaging: 'distant' as const };
    expect(povBriefLines(distant).join('\n')).not.toMatch(/GROUP STAGING/);
  });

  /* ── animal realism ── */
  it('includes ANIMAL REALISM section when naturalRealism', () => {
    expect(briefText()).toMatch(/ANIMAL REALISM/);
    expect(briefText()).toMatch(/Do not escalate/);
  });

  it('omits ANIMAL REALISM when fantasy', () => {
    const fantasy = { ...d, animalStyle: 'fantasy' as const };
    expect(povBriefLines(fantasy).join('\n')).not.toMatch(/ANIMAL REALISM/);
  });

  /* ── fight choreography ── */
  it('includes FIGHT CHOREOGRAPHY when naturalRealism', () => {
    expect(briefText()).toMatch(/FIGHT CHOREOGRAPHY/);
    expect(briefText()).toMatch(/one readable action at a time/);
  });

  it('omits FIGHT CHOREOGRAPHY when fantasy', () => {
    const fantasy = { ...d, animalStyle: 'fantasy' as const };
    expect(povBriefLines(fantasy).join('\n')).not.toMatch(/FIGHT CHOREOGRAPHY/);
  });

  /* ── readPovSettings normalizes unknowns ── */
  it('normalizes unknown values for new fields to defaults', () => {
    const raw = {
      perspective: 'firstPerson',
      povParticipation: 'INVALID',
      animalStyle: 'bogus',
      groupStaging: 999,
    };
    const parsed = readPovSettings(raw)!;
    expect(parsed.povParticipation).toBe(d.povParticipation);
    expect(parsed.animalStyle).toBe(d.animalStyle);
    expect(parsed.groupStaging).toBe(d.groupStaging);
  });

  /* ── old saved workflows without new fields still load ── */
  it('old saved workflows without new fields produce valid defaults', () => {
    const old = {
      perspective: 'firstPerson', rig: 'bodyMounted', lens: '20mm',
      stabilization: 'low', bodyMovement: 'natural', cameraHeight: 'eyeLevel',
      framing: 'imperfectDocumentary', showHands: true, showForearms: true,
      showForegroundProp: true, protagonistFaceVisible: false,
      showCameraMount: false, awareness: 'natural', interactionDistance: 'close',
      continuity: 'high', preferredShotDuration: '6s',
      narrationStrategy: 'firstPersonDiary', narrationPerson: 'firstPerson',
      hookTiming: 'immediate', actionDensity: 'mediumHigh',
      dialogueDensity: 'none', endingStyle: 'cliffhanger',
      revealStyle: 'visualBeforeExplanation',
      /* No povParticipation, animalStyle, or groupStaging */
    };
    const parsed = readPovSettings(old)!;
    expect(parsed).toBeDefined();
    /* Should fall back to preset defaults for the missing new fields. */
    expect(parsed.povParticipation).toBe('active');
    expect(parsed.animalStyle).toBe('naturalRealism');
    expect(parsed.groupStaging).toBe('embedded');
    /* And preserve the old values as-is. */
    expect(parsed.continuity).toBe('high');
    expect(parsed.preferredShotDuration).toBe('6s');
  });
});

/* ────────────────────────────────────────────────────────────────────────
   7. POV storyboard composition
   ──────────────────────────────────────────────────────────────────────── */

describe('POV storyboard composition rules', () => {
  it('returns guidance for a first-person piece', () => {
    const lines = povSheetGuidance(POV_SURVIVAL_DEFAULTS);
    expect(lines.length).toBeGreaterThan(0);
    const text = lines.join('\n');
    expect(text).toMatch(/POV STORYBOARD COMPOSITION/);
    expect(text).toMatch(/foreground hands/);
    expect(text).toMatch(/family lineup/);
    expect(text).toMatch(/No dialogue captions/);
  });

  it('includes prop guidance when showForegroundProp is true', () => {
    const text = povSheetGuidance(POV_SURVIVAL_DEFAULTS).join('\n');
    expect(text).toMatch(/primary prop or weapon/);
  });

  it('omits prop guidance when showForegroundProp is false', () => {
    const noProp = { ...POV_SURVIVAL_DEFAULTS, showForegroundProp: false };
    const text = povSheetGuidance(noProp).join('\n');
    expect(text).not.toMatch(/primary prop or weapon/);
  });

  it('returns nothing for a third-person piece', () => {
    const thirdPerson = { ...POV_SURVIVAL_DEFAULTS, perspective: 'thirdPerson' as const };
    expect(povSheetGuidance(thirdPerson)).toEqual([]);
  });

  it('returns nothing for undefined POV', () => {
    expect(povSheetGuidance(undefined)).toEqual([]);
  });
});
