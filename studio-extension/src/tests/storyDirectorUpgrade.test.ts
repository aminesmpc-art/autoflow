import {
  storyBrief,
  DEFAULT_STORY,
  CAMERA_PROGRESSIONS,
  AUDIO_MODES,
  VISUAL_PRESETS,
  type StorySettings,
} from '../studio/ask/storyPlan';
import { checkShots, shotContract, type ShotTarget, type Shot } from '../studio/ask/storyboard';
import { buildFromReply } from '../studio/builder/plan';

describe('Upgraded Story Director System', () => {
  const mockTargets: ShotTarget[] = [
    { id: 'shot1', media: 'video', platform: 'flow', duration: '4s', aspectRatio: '9:16', label: 'Shot 1 — The Hook' },
    { id: 'shot2', media: 'video', platform: 'flow', duration: '6s', aspectRatio: '9:16', label: 'Shot 2 — Build' },
    { id: 'shot3', media: 'video', platform: 'flow', duration: '10s', aspectRatio: '9:16', label: 'Shot 3 — Finale' },
  ];

  it('generates an enriched storyBrief with camera progression, native audio, and visual style guardrails', () => {
    const settings: StorySettings = {
      ...DEFAULT_STORY,
      cast: [
        { name: 'Commander Maya', look: 'White copper pressurized EVA suit, cracked gold visor', role: 'Lead explorer' },
      ],
      world: 'Frozen ice plains of Europa with giant Jupiter rising in the black sky',
      look: 'Moody anamorphic cinematic lighting with cyan highlights',
      structure: 'hook',
      cameraProgression: 'dynamic',
      audioMode: 'cinematic',
      visualPreset: 'liveAction',
      rules: ['samePerson', 'cumulative'],
    };

    const brief = storyBrief('Maya activates an alien monolith', settings, mockTargets);

    // Verify Cast & Role
    expect(brief).toContain('Commander Maya [Role/Position: Lead explorer]');
    expect(brief).toContain('White copper pressurized EVA suit, cracked gold visor');

    // Verify World & Look
    expect(brief).toContain('Frozen ice plains of Europa');
    expect(brief).toContain('Photorealistic 8K live-action cinematography');
    expect(brief).toContain('Guardrails (Negative): No 3D render look, no cartoon styling');

    // Verify Camera Progression
    expect(brief).toContain('CINEMATOGRAPHY & CAMERA — Director Coverage');
    expect(brief).toContain('Shot 1: Wide establishing context');

    // Verify Audio Layer
    expect(brief).toContain('AUDIO & SOUND DESIGN — Layered Cinematic Audio');
    expect(brief).toContain('[Ambience/Environment]');
    expect(brief).toContain('[Foley/SFX]');
    expect(brief).toContain('[Dialogue/Vocalization]');

    // Verify Duration-Aware Pacing
    expect(brief).toContain('BEATS —');
    expect(brief).toContain('proportion to their length');
  });

  it('generates duration-aware micro-pacing notes inside shotContract', () => {
    const contract = shotContract(mockTargets);

    // 4s shot gets single punchy beat note
    expect(contract).toContain('4s is a fast clip: write ONE single punchy action or reaction beat.');
    // 6s shot gets 2-stage build note
    expect(contract).toContain('6s is a standard clip: write a 2-stage build (action ➜ immediate reaction/escalation).');
    // 10s shot gets 3-stage progression note
    expect(contract).toContain('10s is an extended clip: write a 3-stage progression (setup ➜ escalation ➜ dramatic climax/twist).');
  });

  it('catches and rejects video-editing jargon (cut to, fade in, split screen) in checkShots', () => {
    const invalidShots: Shot[] = [
      {
        n: 1,
        title: 'Bad Shot 1',
        prompt: 'Commander Maya treks across the snow, then cut to a close up of her face smiling.',
      },
      {
        n: 2,
        title: 'Bad Shot 2',
        prompt: 'Fade in on the alien monolith as it starts glowing with bright cyan lights.',
      },
      {
        n: 3,
        title: 'Good Shot 3',
        prompt: 'The camera dollies forward smoothly as Maya reaches out and activates the glowing monolith on Europa. Audio: Ambient blizzard winds, heavy boots crunching ice, quiet breath inside helmet.',
      },
    ];

    const problems = checkShots(invalidShots, mockTargets);

    const jargonProblems = problems.filter((p) => p.code === 'editingJargon');
    expect(jargonProblems.length).toBe(2);
    expect(jargonProblems[0].shot).toBe(1);
    expect(jargonProblems[0].detail).toContain('uses video-editing jargon like "cut to"');
    expect(jargonProblems[1].shot).toBe(2);
    expect(jargonProblems[1].detail).toContain('uses video-editing jargon like "cut to"');
  });

  it('compiles an upgraded Story Director workflow JSON into fully-typed canvas nodes and edges', () => {
    const storyAiReply = `
\`\`\`json
{
  "thinking": {
    "shots": ["1. Establishing Europa", "2. Monolith Activation", "3. Beam Ignition"],
    "continuity": "Story Director locks Maya's EVA suit and audio atmosphere across all 3 clips.",
    "platforms": "ChatGPT for director; Flow for 3 video clips.",
    "risks": "Audio drift prevented by specifying layered sound design."
  },
  "name": "Europa Awakening — Director Cut",
  "description": "A 3-shot cinematic sci-fi sequence directed with native sound layers and dynamic camera coverage.",
  "steps": [
    {
      "id": "director",
      "type": "story",
      "platform": "chatgpt",
      "label": "Series Director",
      "prompt": "Commander Maya discovers and activates the monolith on Europa.",
      "cast": [{ "name": "Maya", "look": "White copper suit, gold visor", "role": "Lead" }],
      "world": "Frozen icy canyon of Europa",
      "look": "35mm anamorphic film, volumetric lighting",
      "structure": "hook",
      "cameraProgression": "establishingToClose",
      "audioMode": "cinematic",
      "visualPreset": "cinema35mm"
    },
    {
      "id": "shot1",
      "type": "generate",
      "media": "video",
      "platform": "flow",
      "label": "Shot 1 — Establishing",
      "inputs": ["director"],
      "aspectRatio": "16:9",
      "duration": "4s"
    },
    {
      "id": "shot2",
      "type": "generate",
      "media": "video",
      "platform": "flow",
      "label": "Shot 2 — Approach",
      "inputs": ["director"],
      "aspectRatio": "16:9",
      "duration": "6s"
    },
    {
      "id": "shot3",
      "type": "generate",
      "media": "video",
      "platform": "flow",
      "label": "Shot 3 — Activation",
      "inputs": ["director"],
      "aspectRatio": "16:9",
      "duration": "10s"
    }
  ]
}
\`\`\`
`;

    const { template, problems } = buildFromReply(storyAiReply);
    expect(problems).toEqual([]);
    expect(template).not.toBeNull();

    const storyNode = template!.nodes.find((n: any) => n.id === 'director');
    expect(storyNode).toBeDefined();
    expect(storyNode!.data.cameraProgression).toBe('establishingToClose');
    expect(storyNode!.data.audioMode).toBe('cinematic');
    expect(storyNode!.data.visualPreset).toBe('cinema35mm');
  });
});
