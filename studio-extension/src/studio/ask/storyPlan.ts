/**
 * The story a Story node is working from, and the brief it turns into.
 *
 * Three layers, kept apart on purpose. The research on multi-shot AI video is
 * unanimous about this and it matches what the room template learned the hard
 * way: mixing identity into per-shot action is what makes a character drift.
 *
 *   CAST + WORLD   Identity. Fixed for the whole piece, and written into
 *                  EVERY prompt in full. A generator reads one prompt at a
 *                  time and remembers nothing, so this is the only mechanism
 *                  that keeps the same person in shot 4 as in shot 1.
 *   LOOK           Style. Global, applied to all, changes nothing about who
 *                  or what is on screen.
 *   STRUCTURE      Action. The only layer allowed to differ per shot.
 *
 * Upgraded with:
 *   - Camera Progression (Director's Coverage: Wide ➜ Medium ➜ Detail ➜ Reaction)
 *   - Layered Native Audio & Dialogue (Ambience + SFX + Dialogue for Veo 3.1 & Flow)
 *   - Visual Style & Negative Guardrails Presets
 */

import type { ShotTarget } from './storyboard';

export interface CastMember {
  /** How the story refers to them: "the designer", "Maya". */
  name: string;
  /** Everything that must be identical every time they appear. */
  look: string;
  /** Screen blocking or role: e.g. "center", "left", "lead", "creature". */
  role?: string;
  /* Which of Flow's voices this character speaks in, or absent for none.
     It belongs here rather than on each clip because that is where it belongs
     in Flow too: a voice is attached to a CHARACTER ingredient, not to a
     prompt. Set once, every shot this character appears in inherits it, and a
     two-hander gets two voices without anything being set per shot. */
  voice?: string;
}

export type CameraProgressionId = 'dynamic' | 'establishingToClose' | 'actionTracking' | 'fixed';

export interface CameraProgressionOption {
  id: CameraProgressionId;
  name: string;
  hint: string;
  rules: string[];
}

export const CAMERA_PROGRESSIONS: CameraProgressionOption[] = [
  {
    id: 'dynamic',
    name: 'Director Coverage',
    hint: 'Varies shot angles intelligently across the narrative arc.',
    rules: [
      'SHOT COVERAGE: Vary camera distance and angles across shots to feel like a directed film.',
      '  · Shot 1: Wide establishing context or subject entrance.',
      '  · Middle shots: Dynamic medium tracking or over-the-shoulder action.',
      '  · Climax/Final shot: Punchy close-up, high-impact angle, or dramatic pull-back.',
    ],
  },
  {
    id: 'establishingToClose',
    name: 'Establishing ➜ Push In',
    hint: 'Opens broad and pushes closer with each successive shot.',
    rules: [
      'PROGRESSIVE LENS: Move camera closer with each consecutive shot.',
      '  · Start wide with full room/landscape, step into medium, and end in tight macro/close-up.',
    ],
  },
  {
    id: 'actionTracking',
    name: 'Action Tracking',
    hint: 'Steadicam, handheld tracking, and energetic subject movement.',
    rules: [
      'MOTION CAMERA: Keep camera actively tracking, dollying, or following the primary subject with dynamic steadicam or handheld motion.',
    ],
  },
  {
    id: 'fixed',
    name: 'Locked Tripod',
    hint: 'Locked-off camera for precise hyperlapses and room builds.',
    rules: [
      'ONE fixed camera for the entire sequence. No pan, tilt, zoom, or camera movement.',
    ],
  },
];

export type AudioModeId = 'cinematic' | 'ambient' | 'dialogue' | 'none';

export interface AudioModeOption {
  id: AudioModeId;
  name: string;
  hint: string;
  guide: string[];
}

export const AUDIO_MODES: AudioModeOption[] = [
  {
    id: 'cinematic',
    name: 'Layered Cinematic Audio',
    hint: 'Full sound design layer with room tone, physical foley, and spoken lines.',
    guide: [
      /* The prefixes are Google's, not ours. Its Veo guide asks for "SFX:" and
         "Ambient noise:" as separate sentences, with dialogue in quotation
         marks — we had invented one "Audio:" heading with three numbered
         layers stacked under it. Close enough to look right, and not the
         wording the model was trained to act on. */
      'SOUND: end each video prompt with three separate audio sentences, in this order:',
      '  1. "Ambient noise: ..." — the room or the weather (e.g. "Ambient noise: quiet kitchen room tone, rain on glass")',
      '  2. "SFX: ..." — the physical sounds the action makes (e.g. "SFX: clicking claws, a jar lid squeaking, a sudden sizzle")',
      '  3. The line itself, attributed and in quotation marks (e.g. She whispers, "Look at that.")',
    ],
  },
  {
    id: 'ambient',
    name: 'Environment & Foley',
    hint: 'Atmospheric room tone, footsteps, and physical interactions.',
    guide: [
      'SOUND: end each video prompt with "Ambient noise: ..." for the room or weather and',
      '"SFX: ..." for the physical sounds the action makes. Separate sentences, both of them.',
      'Nobody speaks — no dialogue, no voice-over, no whispering.',
    ],
  },
  {
    id: 'dialogue',
    name: 'Dialogue & Voice',
    hint: 'Clear spoken character lines with delivery notes.',
    guide: [
      'SOUND: give each shot one spoken line, written the way Veo expects it —',
      'attributed, in quotation marks, with the delivery inside the attribution:',
      '  She says urgently, "We have to leave now."',
      'One line per shot. Two people talking inside eight seconds is a scene, not a shot.',
    ],
  },
  {
    id: 'none',
    name: 'Visual Only',
    hint: 'Focus prompt strictly on visuals and motion.',
    guide: [],
  },
];

export type VisualPresetId = 'liveAction' | 'smartphonePOV' | 'cinema35mm' | 'cgi3d' | 'anime' | 'none';

export interface VisualPresetOption {
  id: VisualPresetId;
  name: string;
  stylePrompt: string;
  negativePrompt: string;
}

export const VISUAL_PRESETS: VisualPresetOption[] = [
  {
    id: 'liveAction',
    name: 'Live-Action 8K',
    stylePrompt: 'Photorealistic 8K live-action cinematography, natural cinematic lighting, rich depth of field, authentic textures.',
    negativePrompt: 'No 3D render look, no cartoon styling, no distorted anatomy, no plastic skin.',
  },
  {
    id: 'smartphonePOV',
    name: 'Smartphone POV (TikTok)',
    stylePrompt: 'Authentic vertical 9:16 handheld smartphone POV camera, natural everyday indoor/outdoor lighting, raw realism, viral social video aesthetic.',
    negativePrompt: 'No Hollywood tripod rigidity, no artificial stage lighting, no subtitles.',
  },
  {
    id: 'cinema35mm',
    name: '35mm Kodak Film',
    stylePrompt: 'Shot on 35mm anamorphic lens, moody volumetric lighting, fine film grain, Kodak film stock color science, shallow focus.',
    negativePrompt: 'No clean digital video sheen, no oversaturated cartoon colors.',
  },
  {
    id: 'cgi3d',
    name: '3D CGI Animation',
    stylePrompt: 'High-end stylized 3D feature animation aesthetic, subsurface scattering on skin, vibrant expressive lighting, Pixar/Dreamworks level character fidelity.',
    negativePrompt: 'No live-action photography, no uncanny valley distortion.',
  },
  {
    id: 'anime',
    name: 'Cinematic Anime',
    stylePrompt: 'Modern cinematic anime aesthetic, hand-painted atmospheric backgrounds, expressive cel-shaded character art, Makoto Shinkai lighting.',
    negativePrompt: 'No western 3D CGI, no live-action photos.',
  },
  {
    id: 'none',
    name: 'Custom (Defined in Look)',
    stylePrompt: '',
    negativePrompt: '',
  },
];

export interface StorySettings {
  cast: CastMember[];
  world: string;
  look: string;
  structure: StructureId;
  /** Story beats across the whole piece. 0 means derive it from the clips. */
  beats: number;
  /** Continuity rules, by id. Each one is a line in the brief. */
  rules: RuleId[];
  /** Camera progression across shots. */
  cameraProgression?: CameraProgressionId;
  /** Sound design and dialogue generation mode. */
  audioMode?: AudioModeId;
  /** Visual style preset. */
  visualPreset?: VisualPresetId;
  /**
   * Break each clip into timed segments — "[00:00-00:02] ...".
   *
   * Google's own Veo guide calls this timestamp prompting and gives it for
   * clips up to eight seconds. It is the difference between a shot that holds
   * one moment and a shot that MOVES through one: without it an eight-second
   * clip tends to describe a tableau and then loop it.
   *
   * Off by default. It suits a shot with a beginning and an end — a hand
   * reaching, a reveal — and works against a held mood, where cutting the
   * eight seconds into four instructions produces four half-seconds of
   * nothing.
   */
  timedBeats?: boolean;
  /**
   * What must not appear.
   *
   * Google is explicit that a negation works better stated as a positive
   * absence: "a desolate landscape with no buildings or roads" rather than
   * "no buildings". The brief passes this through with that instruction
   * attached, so what the user types plainly comes out phrased the way the
   * model actually obeys.
   */
  avoid?: string;
}

export type RuleId = 'cumulative' | 'fixedCamera' | 'samePerson' | 'inHand';

/**
 * The rules the room template used to hardcode, as switches.
 */
export const RULES: Array<{ id: RuleId; name: string; line: string }> = [
  {
    id: 'cumulative',
    name: 'Nothing already built disappears',
    line: 'Everything completed stays visible and active for the rest of the piece — '
      + 'installed lights keep glowing, layers stay in place, nothing is removed, reset, '
      + 'hidden, turned off or replaced.',
  },
  {
    id: 'fixedCamera',
    name: 'The camera never moves',
    line: 'ONE fixed camera for the whole piece. No zoom, rotation, dolly, orbit, push-in '
      + 'or angle change, and no cuts.',
  },
  {
    id: 'samePerson',
    name: 'The same person throughout',
    line: 'The same person appears in every shot they are in, described identically each '
      + 'time — same face, build, clothing and hair.',
  },
  {
    id: 'inHand',
    name: 'Things arrive in someone’s hands',
    line: 'Every tool or material enters the frame in a person’s hands before it changes '
      + 'anything. Nothing appears, builds, floats or installs itself.',
  },
];

export type StructureId = 'hook' | 'transform' | 'loop' | 'free';

export const STRUCTURES: Array<{ id: StructureId; name: string; hint: string; shape: string[] }> = [
  {
    id: 'hook',
    name: 'Hook → Build → Payoff',
    hint: 'The short-form default. Stop the scroll, escalate, reveal.',
    shape: [
      'HOOK — the opening seconds. Something large and legible happens immediately;',
      '  a viewer decides in about a second and a half whether to keep watching.',
      'BUILD — each beat visibly larger than the last. Never a beat that only',
      '  repeats the one before it.',
      'PAYOFF — the strongest image in the piece, and the reason to have stayed.',
    ],
  },
  {
    id: 'transform',
    name: 'Before → Process → Reveal',
    hint: 'Transformations, builds, makeovers, restorations.',
    shape: [
      'BEFORE — the untouched state, established fast and in full.',
      'PROCESS — the work itself, in order, each stage building on the last and',
      '  everything completed staying visible for the rest of the piece.',
      'REVEAL — the finished state, framed so the change is unmistakable.',
    ],
  },
  {
    id: 'loop',
    name: 'Seamless loop',
    hint: 'The last frame flows back into the first.',
    shape: [
      'The final shot must end in a state visually continuous with the opening',
      'of the first, so the piece can play twice with no visible seam. Say so',
      'explicitly in both the first and last prompt.',
    ],
  },
  { id: 'free', name: 'No fixed structure', hint: 'Let the idea decide.', shape: [] },
];

export const DEFAULT_STORY: StorySettings = {
  cast: [],
  world: '',
  look: '',
  structure: 'hook',
  beats: 0,
  rules: [],
  cameraProgression: 'dynamic',
  audioMode: 'cinematic',
  visualPreset: 'none',
};

/** Seconds in a target, or 0 for a still. */
function secondsOf(t: ShotTarget): number {
  const m = /([\d.]+)\s*s/i.exec(t.duration || '');
  return m ? Number(m[1]) : 0;
}

/**
 * How many beats the piece should hold.
 */
export function beatsFor(targets: ShotTarget[], override = 0): number {
  if (override > 0) return override;
  const seconds = targets.reduce((n, t) => n + secondsOf(t), 0);
  if (!seconds) return Math.max(1, targets.length);
  return Math.max(targets.length, Math.round(seconds / 4));
}

/** "5 beats · about 4s each", for the node to show its own arithmetic. */
export function beatSummary(targets: ShotTarget[], override = 0): string {
  const beats = beatsFor(targets, override);
  const seconds = targets.reduce((n, t) => n + secondsOf(t), 0);
  if (!seconds) return `${beats} beat${beats === 1 ? '' : 's'}`;
  return `${beats} beats · about ${Math.round((seconds / beats) * 10) / 10}s each`;
}

/** Whether a section has anything in it yet. */
export const hasStory = (s: StorySettings): boolean =>
  !!(s.cast.some((c) => c.name.trim() || c.look.trim()) || s.world.trim() || s.look.trim());

/**
 * The brief, assembled from what the user has locked plus what the canvas
 * already knows.
 */
export function storyBrief(
  idea: string,
  s: StorySettings,
  targets: ShotTarget[],
): string {
  const out: string[] = [];
  const structure = STRUCTURES.find((x) => x.id === s.structure) || STRUCTURES[0];
  const beats = beatsFor(targets, s.beats);
  const named = s.cast.filter((c) => c.name.trim() || c.look.trim());

  out.push('You are directing one short piece of work. Everything below is one story.');
  out.push('');
  out.push('THE IDEA');
  out.push(idea.trim() || '(none given — take it from the cast and world below)');
  out.push('');

  if (named.length) {
    out.push('CAST — fixed. Write each of these into EVERY prompt they appear in, in full.');
    out.push('A generator reads one prompt at a time and remembers nothing, so a reference');
    out.push('to "the same woman as before" produces a stranger.');
    for (const c of named) {
      const roleStr = c.role ? ` [Role/Position: ${c.role}]` : '';
      out.push(`  · ${c.name.trim() || 'Unnamed'}${roleStr}: ${c.look.trim() || '(describe them)'}`);
    }
    out.push('');
  } else {
    out.push('CAST — decide who appears, then describe them once and identically in every');
    out.push('prompt they are in. Return them in the "cast" field so they can be locked.');
    out.push('');
  }

  if (s.world.trim()) {
    out.push('WORLD — fixed. Present in every prompt, described the same way.');
    out.push(`  ${s.world.trim()}`);
    out.push('');
  } else {
    out.push('WORLD — decide the place and keep it identical across shots. Return it in');
    out.push('the "world" field.');
    out.push('');
  }

  // Visual Preset + Look
  const preset = s.visualPreset && s.visualPreset !== 'none'
    ? VISUAL_PRESETS.find((p) => p.id === s.visualPreset)
    : undefined;
  const lookParts: string[] = [];
  if (preset && preset.stylePrompt) lookParts.push(preset.stylePrompt);
  if (s.look.trim()) lookParts.push(s.look.trim());

  if (lookParts.length) {
    out.push('LOOK — applies to every shot without changing what is in them.');
    out.push(`  ${lookParts.join(' ')}`);
    if (preset?.negativePrompt) {
      out.push(`  Guardrails (Negative): ${preset.negativePrompt}`);
    }
    out.push('');
  } else {
    out.push('LOOK — decide the palette, lens and lighting, apply it to all shots, and');
    out.push('return it in the "look" field.');
    out.push('');
  }

  /* What must not be in it.
     Written as a presence rather than an absence, which is Google's own
     guidance and not a style preference: "a desolate landscape with no
     buildings or roads" lands, "no buildings" often puts buildings in. The
     user types the thing they do not want and this asks for the rephrasing,
     so nobody has to know the trick. */
  if (s.avoid && s.avoid.trim()) {
    out.push('MUST NOT APPEAR');
    out.push(`  ${s.avoid.trim()}`);
    out.push('  Write these as things the scene is WITHOUT, inside the description —');
    out.push('  "an empty road with no cars or people" — never as a bare "no cars".');
    out.push('  A bare negation tends to summon the thing it names.');
    out.push('');
  }

  /* Timestamped beats.
     Google's Veo guide gives this for clips up to eight seconds, and it is
     what separates a shot that MOVES through a moment from one that describes
     a tableau and loops it. Only offered for clips — a still has no seconds
     to divide. */
  if (s.timedBeats && targets.some((t) => t.media === 'video')) {
    out.push('TIME INSIDE EACH CLIP');
    out.push("  Break every clip prompt into timed segments, in Veo's own notation:");
    out.push('    [00:00-00:02] what happens first');
    out.push('    [00:02-00:05] what happens next');
    out.push('    [00:05-00:08] where it lands');
    out.push("  Cover the clip's whole length and no more — a segment past the end is");
    out.push('  an instruction the generator cannot obey. Two to four segments; more');
    out.push('  than that in eight seconds is a trailer, not a shot.');
    out.push('');
  }

  // Camera Progression
  const cameraMode = CAMERA_PROGRESSIONS.find((c) => c.id === (s.cameraProgression || 'dynamic'));
  if (cameraMode && cameraMode.rules.length) {
    out.push(`CINEMATOGRAPHY & CAMERA — ${cameraMode.name}`);
    for (const line of cameraMode.rules) out.push(line);
    out.push('');
  }

  // Audio Mode
  const audio = AUDIO_MODES.find((a) => a.id === (s.audioMode || 'cinematic'));
  if (audio && audio.guide.length) {
    out.push(`AUDIO & SOUND DESIGN — ${audio.name}`);
    for (const line of audio.guide) out.push(line);
    out.push('');
  }

  if (structure.shape.length) {
    out.push(`STRUCTURE — ${structure.name}`);
    for (const line of structure.shape) out.push(line);
    out.push('');
  }

  const chosen = RULES.filter((r) => s.rules.includes(r.id));
  if (chosen.length) {
    out.push('RULES — these hold for every shot without exception.');
    for (const r of chosen) out.push(`  · ${r.line}`);
    out.push('');
  }

  out.push(`BEATS — ${beats} across the whole piece, distributed over the shots below in`);
  out.push('proportion to their length. A 4s shot gets a single punchy action; a 6-8s shot gets');
  out.push('a 2-stage build; a 10s shot gets a 3-stage progression (Setup ➜ Escalation ➜ Payoff).');
  out.push('');

  return out.join('\n');
}

/**
 * The extra envelope fields a Story node asks for on top of the shots.
 */
export const STORY_FIELDS = [
  '  "cast": [ { "name": "short name", "look": "everything that must stay identical", "role": "optional position or role" } ],',
  '  "world": "the place, described once",',
  '  "look": "palette, lens, lighting",',
].join('\n');

/**
 * Which voice a shot's clip should speak in.
 *
 * The join between two things that already existed and never met: the Story's
 * cast, where each character is described once, and each shot's `cast` list,
 * naming who appears in it. Flow's own model is the same shape — a voice
 * attaches to a character ingredient, not to a prompt — so matching them is
 * the whole feature.
 *
 * Returns '' for no voice, which is the right answer more often than not:
 *
 *   - audioMode 'none' means the piece has no spoken lines at all, so a voice
 *     would be attached to every clip and heard in none of them;
 *   - a shot with nobody in it — an establishing shot, a product on a table —
 *     has no character to speak through, and Flow drops the voice anyway;
 *   - a character with no voice set is the default, and silence is what the
 *     user asked for by not choosing one.
 *
 * The speaker rule matters for dialogue. Flow allows exactly one voice per
 * clip, so a two-hander has to choose, and choosing wrong is invisible: the
 * clip is generated, it has a voice, and it is the wrong character's. The
 * writer names the speaker; falling back to the first listed is a guess, and
 * is only reached when it did not.
 */
export function voiceForShot(
  shotCast: string[] | undefined,
  speaker: string | undefined,
  cast: CastMember[],
  audioMode?: AudioModeId,
): string {
  if (audioMode === 'none') return '';
  const find = (name: string) => cast.find(
    (c) => c.name.trim().toLowerCase() === name.trim().toLowerCase(),
  );

  /* Named speaker wins, even if the shot's cast list forgot to include them —
     a writer that says "Maya speaks" and lists only "the barista" has told us
     something true about the audio and something sloppy about the blocking. */
  if (speaker) {
    const named = find(speaker);
    if (named?.voice) return named.voice;
  }

  const present = (shotCast || []).map(find).filter(Boolean) as CastMember[];
  const withVoice = present.filter((c) => c.voice);
  if (withVoice.length === 1) return withVoice[0].voice!;

  /* Two voiced characters and nobody named as speaker. Taking the first is a
     coin toss on which one is heard, and a wrong voice is harder to notice
     than no voice — the clip sounds finished. */
  return '';
}
