/**
 * POV Survival / GoPro Diary — what a real eight-shot run showed was wrong.
 *
 * The preset produced usable prompts. It also over-constrained them, in ways
 * that are only visible once you read eight of them side by side:
 *
 *   · every prompt opened "at chest height", though cameraHeight was eyeLevel
 *   · every prompt carried "the dark leather rim of the chest harness mount is
 *     visible along the bottom edge of the frame" — modern equipment,
 *     permanently, in a story whose same brief banned modern objects
 *   · "No pan, tilt or zoom is ever chosen" fought the head turns the format
 *     is made of
 *   · "no camera move appears twice" cost two consecutive walking shots the
 *     right to look like walking
 *   · a spoken-word budget was appended to all eight shots of a piece whose
 *     brief says nobody speaks
 *   · six actions were stacked into six seconds
 *   · the unseen creature arrived as "an enormous, indistinct silhouette"
 *
 * Each test below is one of those.
 */

/// <reference types="node" />

import {
  readPovSettings, povBriefLines, povContinuityLines, povContinuationLines,
  povProgressionLines, povAnchorLines, povIsSilent,
  POV_SURVIVAL_DEFAULTS, POV_SURVIVAL_PRESET_ID,
  ACTION_DENSITIES, DIALOGUE_DENSITIES,
  type PovSettings,
} from '../studio/ask/povSurvival';
import {
  readStorySettings, storyBrief, storyIsSilent, effectivePov,
  DEFAULT_STORY, CAMERA_PROGRESSIONS, RULES,
  type StorySettings,
} from '../studio/ask/storyPlan';
import { shotContract } from '../studio/ask/storyboard';
import { readPlan, compilePlan } from '../studio/builder/plan';
import { checkPlan } from '../studio/builder/check';
import { validateTemplate } from '../studio/templates/validate';

const clips = (n: number, duration = '6s') => Array.from({ length: n }, (_, i) => ({
  id: `s${i + 1}`, label: `${i + 1} — shot`, media: 'video', platform: 'flow',
  aspectRatio: '9:16', duration,
})) as any[];

const povStory = (pov: Partial<PovSettings> = {}): StorySettings => ({
  ...DEFAULT_STORY,
  visualPreset: POV_SURVIVAL_PRESET_ID,
  cameraProgression: 'mountedPOV',
  audioMode: 'ambient',
  structure: 'survivalDiary',
  rules: ['frameChain', 'samePerson', 'noRepeatAction'],
  cast: [{ name: 'Elder', look: 'grey-streaked hair, fur cloak' }],
  world: 'cold rocky grassland',
  pov: { ...POV_SURVIVAL_DEFAULTS, ...pov },
});

const brief = (s: StorySettings, n = 8) => storyBrief('an episode', s, clips(n));

/* ── 1. Eye level ───────────────────────────────────────────────────────── */

describe('the camera is at eye level, not chest height', () => {
  it('defaults to eye level and says so', () => {
    expect(POV_SURVIVAL_DEFAULTS.cameraHeight).toBe('eyeLevel');
    const lines = povBriefLines(POV_SURVIVAL_DEFAULTS).join('\n');
    expect(lines).toMatch(/at natural eye level/);
    expect(lines).not.toMatch(/chest height/);
  });

  it('says it drops lower only when the body does', () => {
    expect(povBriefLines(POV_SURVIVAL_DEFAULTS).join('\n'))
      .toMatch(/drops lower only when the body does/);
  });

  it('still says chest height when that is what was chosen', () => {
    const lines = povBriefLines({ ...POV_SURVIVAL_DEFAULTS, cameraHeight: 'chestLevel' })
      .join('\n');
    expect(lines).toMatch(/at chest height/);
    expect(lines).not.toMatch(/drops lower only when the body does/);
  });

  it('keeps body-mounted as a rig without it implying a height', () => {
    expect(POV_SURVIVAL_DEFAULTS.rig).toBe('bodyMounted');
    expect(povBriefLines(POV_SURVIVAL_DEFAULTS).join('\n'))
      .toMatch(/worn on the body, driven by the torso and the head/);
  });
});

/* ── 2. No visible hardware ─────────────────────────────────────────────── */

describe('the rig is not in shot', () => {
  it('is off by default, and nothing asks for a harness', () => {
    expect(POV_SURVIVAL_DEFAULTS.showCameraMount).toBe(false);
    const lines = povBriefLines(POV_SURVIVAL_DEFAULTS).join('\n');
    for (const gear of ['harness', 'strap', 'housing', 'mount is visible']) {
      expect(lines).not.toMatch(new RegExp(gear, 'i'));
    }
  });

  it('is gone from the Body-Mounted coverage too, which is where it came from', () => {
    const mounted = CAMERA_PROGRESSIONS.find((c) => c.id === 'mountedPOV')!;
    const rules = mounted.rules.join('\n');
    expect(rules).not.toMatch(/harness|housing rim|Part of the mount/i);
    /* What actually sells a worn camera stays. */
    expect(rules).toMatch(/The frame moves because the BODY moves/);
  });

  it('asks for it when the user turns it on', () => {
    const lines = povBriefLines({ ...POV_SURVIVAL_DEFAULTS, showCameraMount: true }).join('\n');
    expect(lines).toMatch(/Part of the rig is visible at the frame edge/);
  });
});

/* ── 3. Head turns are movement, not a camera move ──────────────────────── */

describe('reframing is about who moved, not whether it moved', () => {
  const lines = povBriefLines(POV_SURVIVAL_DEFAULTS).join('\n');

  it('allows the body to turn the frame', () => {
    expect(lines).toMatch(/All reframing comes from the protagonist's body or head/);
    expect(lines).toMatch(/Natural head turns, looking up and down, torso rotation/);
    expect(lines).toMatch(/dropping as they crouch and pitching as they climb/);
  });

  it('forbids only the deliberate cinematic moves', () => {
    expect(lines).toMatch(/DELIBERATE cinematic move/);
    expect(lines).toMatch(/pan, a smooth tilt, a zoom, a dolly, a crane, a drone/);
  });

  it('no longer says a pan is never chosen, which read as never turning', () => {
    const mounted = CAMERA_PROGRESSIONS.find((c) => c.id === 'mountedPOV')!;
    expect(mounted.rules.join('\n')).not.toMatch(/No pan, tilt or zoom is ever chosen/);
  });
});

/* ── 4. Variety at the right grain ──────────────────────────────────────── */

describe('shots differ by what happens, not by camera gymnastics', () => {
  it('asks for a distinct action, and says the camera may repeat', () => {
    const lines = povBriefLines(POV_SURVIVAL_DEFAULTS).join('\n');
    expect(lines).toMatch(/distinct physical action or story purpose/);
    expect(lines).toMatch(/consecutive walking shots are allowed to look like consecutive walking/);
  });

  it('drops noRepeatAction from the brief for a POV piece', () => {
    /* The rule asks for a different movement, angle and distance in every clip.
       On a worn camera there is no different angle to choose. */
    const out = brief(povStory());
    expect(out).not.toMatch(/No pose, gesture, strike, camera move or beat appears twice/);
    /* The rules the piece actually set are still there. */
    expect(out).toMatch(/Every clip opens on the exact frame the clip before it closed on/);
  });

  it('leaves noRepeatAction alone for everyone else', () => {
    const plain: StorySettings = { ...DEFAULT_STORY, rules: ['noRepeatAction'] };
    expect(brief(plain)).toMatch(/No pose, gesture, strike, camera move or beat appears twice/);
    expect(RULES.some((r) => r.id === 'noRepeatAction')).toBe(true);
  });
});

/* ── 5. Continuation phrasing ───────────────────────────────────────────── */

describe('a shot that inherits a frame is told how to open', () => {
  const lines = povContinuationLines(POV_SURVIVAL_DEFAULTS).join('\n');

  it('gives the shape: inherited state first, new action second', () => {
    expect(lines).toMatch(/Name the inherited state FIRST/);
    expect(lines).toMatch(/actual visible posture, grip and unfinished action/);
    expect(lines).toMatch(/right hand pulls it tight/);
  });

  it('does not invent ongoing motion for a newly generated opening still', () => {
    expect(lines).toMatch(/newly generated opening still/);
    expect(lines).toMatch(/does not prove motion is already underway/);
    expect(lines).toMatch(/matching the actual state/);
  });

  it('names the openings that read as a fresh take', () => {
    expect(lines).toMatch(/the camera\s+begins/);
    expect(lines).toMatch(/the scene opens/);
    /* And says WHY they fail, rather than banning them outright — the same
       opening is fine once the inherited state has been stated. */
    expect(lines).toMatch(/unless the inherited state has been stated first/);
  });

  it('reaches the brief', () => {
    expect(brief(povStory())).toMatch(/A SHOT THAT INHERITS A FRAME/);
  });
});

/* ── 6 & 7. Continuity that allows the story to happen ──────────────────── */

describe('continuity anchors bend where the story bends', () => {
  const lines = povContinuityLines(POV_SURVIVAL_DEFAULTS).join('\n');

  it('lets travel direction change when the story turns', () => {
    expect(lines).toMatch(/unless the story turns, climbs,\s*\n?\s*descends, enters somewhere, changes path or reacts/);
    expect(lines).not.toMatch(/·\s*the same direction of travel\s*$/m);
  });

  it('locks the weapon\'s identity and frees its grip', () => {
    expect(lines).toMatch(/the same object, the same wood/);
    expect(lines).toMatch(/grip and angle may change with the action/);
    expect(lines).toMatch(/braced, lowered, raised, carried one-handed/);
    expect(lines).not.toMatch(/carried the same way/);
  });

  it('still locks everything that should not move', () => {
    expect(lines).toMatch(/same recurring cast/);
    expect(lines).toMatch(/same clothing on every person/);
    expect(lines).toMatch(/same hands, forearms and sleeves/);
    expect(lines).toMatch(/same weather and the same light/);
  });
});

/* ── 8. Nobody speaks ───────────────────────────────────────────────────── */

describe('a silent piece is told so once, and never contradicted', () => {
  it('knows it is silent from two settings that already existed', () => {
    expect(POV_SURVIVAL_DEFAULTS.dialogueDensity).toBe('none');
    expect(povIsSilent(POV_SURVIVAL_DEFAULTS)).toBe(true);
    expect(storyIsSilent(povStory())).toBe(true);
    /* Both halves are required. */
    expect(storyIsSilent({ ...povStory(), audioMode: 'dialogue' })).toBe(false);
    expect(storyIsSilent(povStory({ dialogueDensity: 'low' }))).toBe(false);
  });

  it('says nobody speaks, in the brief', () => {
    const lines = povBriefLines(POV_SURVIVAL_DEFAULTS).join('\n');
    expect(lines).toMatch(/NOBODY SPEAKS/);
    expect(lines).toMatch(/no whispering/);
    expect(lines).toMatch(/Effort sounds a body makes/);
  });

  it('drops the spoken-word budget from every shot', () => {
    const silent = shotContract(clips(3), '', false, 0, true);
    expect(silent).not.toMatch(/If anyone speaks in this one/);
    /* Everything else about the shot is untouched. */
    expect(silent).toMatch(/a standard clip: one action and the reaction it causes/);
  });

  it('keeps it for every piece that does have dialogue', () => {
    expect(shotContract(clips(3))).toMatch(/If anyone speaks in this one/);
  });

  it('never tells characters to speak toward the lens', () => {
    const lines = povBriefLines(POV_SURVIVAL_DEFAULTS).join('\n');
    expect(lines).not.toMatch(/speak toward/);
    expect(lines).toMatch(/WITHOUT SPEAKING/);
    /* They still engage — that is the point of close interaction. */
    expect(lines).toMatch(/hold objects out toward it, guide or stop/);
  });
});

/* ── 9. Density ─────────────────────────────────────────────────────────── */

describe('how much fits in one clip', () => {
  const lines = povBriefLines(POV_SURVIVAL_DEFAULTS).join('\n');

  it('spells out the budget for each length', () => {
    expect(lines).toMatch(/4s — ONE simple physical action/);
    expect(lines).toMatch(/6s — ONE main physical action and ONE immediate reaction/);
    expect(lines).toMatch(/8s — ONE action, its development, and the reaction/);
    expect(lines).toMatch(/10s — up to three linked beats/);
  });

  it('names the failure it is preventing', () => {
    expect(lines).toMatch(/Stacking six actions into six seconds/);
    expect(lines).toMatch(/clarity beats completeness/);
  });

  it('asks for one thing rather than everything at medium-high', () => {
    expect(POV_SURVIVAL_DEFAULTS.actionDensity).toBe('mediumHigh');
    expect(lines).toMatch(/Every shot does something, but one thing — not a list of things/);
  });

  it('keeps the two density scales apart, because they are different scales', () => {
    expect(ACTION_DENSITIES.map((x) => x.id)).toEqual(['low', 'medium', 'mediumHigh', 'high']);
    expect(DIALOGUE_DENSITIES.map((x) => x.id)).toEqual(['none', 'low', 'medium', 'high']);
  });
});

/* ── 12. The thing that stays unseen ────────────────────────────────────── */

describe('an unseen threat stays unseen', () => {
  it('asks for suggestion, and names what not to invent', () => {
    const lines = povBriefLines(POV_SURVIVAL_DEFAULTS).join('\n');
    expect(lines).toMatch(/Where the story says a threat stays unseen, it stays unseen/);
    expect(lines).toMatch(/faint movement, a shape that does not resolve/);
    expect(lines).toMatch(/Do not invent an enormous silhouette, glowing eyes, a\s*\n?\s*roar/);
  });

  it('says nothing about it for a resolved, direct piece', () => {
    const lines = povBriefLines({
      ...POV_SURVIVAL_DEFAULTS, endingStyle: 'resolved', revealStyle: 'direct',
    }).join('\n');
    expect(lines).not.toMatch(/stays unseen/);
  });
});

/* ── 13 & 14. Anchors ───────────────────────────────────────────────────── */

describe('the two kinds of visual anchor', () => {
  it('recommends a board sized to the piece, for an 8-shot sequence', () => {
    const lines = povAnchorLines(POV_SURVIVAL_DEFAULTS, 8).join('\n');
    expect(lines).toMatch(/all 8 moments as panels/);
    expect(lines).toMatch(/4x2 board/);
  });

  it('says the board does not replace the frame chain', () => {
    const lines = povAnchorLines(POV_SURVIVAL_DEFAULTS, 8).join('\n');
    expect(lines).toMatch(/MOMENT TO MOMENT: the Last Frame chain/);
    expect(lines).toMatch(/One does not replace the other/);
  });

  it('respects Flow\'s existing five-image limit rather than inventing one', () => {
    expect(povAnchorLines(POV_SURVIVAL_DEFAULTS, 8).join('\n'))
      .toMatch(/at most five reference images/);
  });

  it('says nothing for a one or two shot piece', () => {
    expect(povAnchorLines(POV_SURVIVAL_DEFAULTS, 2)).toEqual([]);
  });
});

/* ── Everything that must not have changed ──────────────────────────────── */

describe('nothing else moved', () => {
  it('a Director with no POV block writes the brief it always wrote', () => {
    const plain: StorySettings = {
      ...DEFAULT_STORY, cast: [{ name: 'Ana', look: 'red coat' }], world: 'a wet street',
    };
    expect(effectivePov(plain)).toBeUndefined();
    const out = brief(plain, 3);
    for (const section of ['POINT OF VIEW', 'A SHOT THAT INHERITS A FRAME',
      'CONTINUITY ANCHORS', 'VISUAL ANCHORS', 'HOW THE POV MOVES']) {
      expect(out).not.toMatch(new RegExp(section));
    }
    /* And it still gets the coverage block it always got. */
    expect(out).toMatch(/CINEMATOGRAPHY & CAMERA/);
  });

  it('a non-POV piece using mountedPOV still gets the coverage block', () => {
    const mounted: StorySettings = { ...DEFAULT_STORY, cameraProgression: 'mountedPOV' };
    expect(brief(mounted, 3)).toMatch(/MOUNTED CAMERA/);
  });

  it('a POV piece gets the POV block instead of a second camera description', () => {
    const out = brief(povStory());
    expect(out).toMatch(/POINT OF VIEW/);
    expect(out).not.toMatch(/MOUNTED CAMERA/);
  });

  it('an old saved workflow with no pov key still loads', () => {
    const s = readStorySettings({
      type: 'story', cast: [], world: 'a kitchen', structure: 'hook',
      rules: ['samePerson'], cameraProgression: 'dynamic', audioMode: 'cinematic',
      visualPreset: 'liveAction',
    });
    expect(s.pov).toBeUndefined();
    expect(s.world).toBe('a kitchen');
  });

  it('a pov block written before showCameraMount existed reads as false', () => {
    const p = readPovSettings({ lens: '18mm', continuity: 'strict' })!;
    expect(p.showCameraMount).toBe(false);
    expect(p.cameraHeight).toBe('eyeLevel');
    expect(p.lens).toBe('18mm');
  });

  it('a plan with the preset still compiles and validates', () => {
    const { plan } = readPlan(JSON.stringify({
      name: 'pov', steps: [
        { id: 'director', type: 'story', prompt: 'eight beats',
          visualPreset: POV_SURVIVAL_PRESET_ID,
          pov: { showCameraMount: false, actionDensity: 'mediumHigh', dialogueDensity: 'none' } },
        { id: 's1', type: 'generate', media: 'video', platform: 'flow',
          aspectRatio: '9:16', duration: '6s', inputs: ['director'] },
        { id: 'f1', type: 'frame', inputs: ['s1'] },
        { id: 's2', type: 'generate', media: 'video', platform: 'flow',
          aspectRatio: '9:16', duration: '6s', inputs: ['f1', 'director'] },
        { id: 'f2', type: 'frame', inputs: ['s2'] },
        { id: 's3', type: 'generate', media: 'video', platform: 'flow',
          aspectRatio: '9:16', duration: '6s', inputs: ['f2', 'director'] },
      ],
    }));
    expect(checkPlan(plan!)).toEqual([]);
    const out: any = compilePlan(plan!, { id: 'pov' });
    expect(out.problems).toEqual([]);
    expect(validateTemplate(out.template)).toEqual([]);
    const d: any = out.template.nodes.find((n: any) => n.type === 'story')!.data;
    expect(d.pov.showCameraMount).toBe(false);
    expect(d.pov.actionDensity).toBe('mediumHigh');
  });

  it('the progression is still a shape rather than a schedule', () => {
    const prog = povProgressionLines(POV_SURVIVAL_DEFAULTS).join('\n');
    expect(prog).toMatch(/a shape, not a schedule/);
    expect(prog).toMatch(/Repeating one is fine when the action repeats/);
  });
});
