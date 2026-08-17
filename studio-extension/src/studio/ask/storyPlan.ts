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

export type CameraProgressionId =
  'dynamic' | 'establishingToClose' | 'actionTracking' | 'fixed' | 'propped';

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
    /* The one that makes a talking piece look real rather than shot.
       A dolly move reads as stock footage; a phone leaning on a counter reads
       as somebody's actual video, which is the entire point of UGC. It is
       also the framing lip sync needs — chest-up, the face large enough to
       animate — so it answers the camera question and the dialogue question
       with the same instruction. */
    id: 'propped',
    name: 'Phone on a Surface (UGC)',
    hint: 'A phone leaning on a counter. Locked frame, chest-up, no camera moves.',
    rules: [
      'PROPPED PHONE: the phone is resting on a surface and nobody is holding it.',
      '  · The frame never pans, tilts, zooms, dollies or orbits. It is leaning on something.',
      '  · Because it is leaning, it is not level. A degree or two off, and the subject',
      '    sits slightly off-centre. A perfectly squared frame means a tripod and a crew.',
      '  · Frame the subject chest-up, close enough to read their face clearly.',
      '  · ONE slow deliberate physical action per shot. Fast hand movement falls apart.',
      '  · The phone itself is never visible, and nobody looks at a second camera.',
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
      '  3. The line itself, attributed and in curly quotes (e.g. She whispers, “Look at that.”)',
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
      'SOUND: give each shot ONE spoken line, written the way Veo expects it —',
      'attributed, in curly quotes, with the delivery inside the attribution:',
      '  She says urgently, “We have to leave now.”',
      'The lead-in verb and the quotes are what drive the lip sync. Without them the',
      'model may narrate the line instead of having anyone say it.',
      '',
      'Two things decide whether it sounds like a person:',
      '  · LENGTH. About two words a second is natural. Each shot below says how many',
      '    words fit in it. Over that, the generator does not make the shot longer — it',
      '    speeds the delivery up or cuts the end off.',
      '  · FRAMING. Lip sync is animated on the face, so a speaking shot has to be close',
      '    enough to see one: chest-up or a medium close-up. Nobody speaks in a wide or',
      '    establishing frame — there is not enough mouth to animate.',
      '',
      'One voice per clip. Two lines inside eight seconds is a scene, and the generator',
      'decides for itself which face said what. If two people must talk, give the reply',
      'to the next shot.',
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

/**
 * Never wanted, in any style.
 *
 * These lived only in the smartphone preset, so a Live-Action or 35mm piece
 * could come back with subtitles burned into the picture — and burned in is
 * exactly the problem: there is no removing them without paying for the
 * generation again.
 *
 * A style preset says what a piece should look LIKE. Whether it has captions
 * welded to it is not a style question, so this is appended to every preset
 * rather than copied into each one and forgotten in the next.
 */
export const ALWAYS_NEGATIVE =
  'no on-screen text, no captions, no subtitles, no watermark, no stickers, '
  + 'no fake app interface, no logos overlaid on the picture';

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
    /* "Raw realism, viral social video aesthetic" is a mood, not an
       instruction — a generator can satisfy every word of it and still hand
       back a retouched face under an even key. Replaced with the things that
       actually separate phone footage from an advert, each of which is a
       decision the model has to make differently. */
    stylePrompt: 'Footage a real person shot on their own phone: one everyday light source with '
      + 'the other side of the face left dark, unretouched skin with visible pores and a faint '
      + 'shine, phone-lens depth where the background stays legible instead of melting into '
      + 'bokeh, mild sensor noise in the shadows, framing that is slightly off-centre and a '
      + 'degree off level.',
    negativePrompt: 'No studio or three-point lighting, no colour grading, no cinematic '
      + 'shallow-focus bokeh, no retouched or poreless skin, no tripod-perfect framing, no '
      + 'Hollywood rigidity.',
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

/**
 * Why AI UGC looks like AI.
 *
 * The models are trained toward "good": even soft light, retouched skin,
 * symmetrical composition, a tidy room, shallow cinematic focus. Every one of
 * those is the opposite of what a phone in someone's kitchen produces, and
 * every one of them is a separate decision the model makes by default. That
 * is why "authentic raw UGC" in a prompt does nothing — it is a mood, and the
 * defaults are specifics. Each line below overturns one specific default.
 *
 * Ordered by how loudly each one gives the game away. Skin is first for a
 * reason: a retouched face reads as an advert however right everything else
 * is, and no amount of handheld wobble rescues it.
 *
 * The last line is the one that is easy to skip and expensive to skip. Each
 * clip is generated on its own from its own prompt, so a realism instruction
 * that lives only here is a realism instruction the generator never sees.
 * The same reason the CAST block insists on being written into every prompt.
 */
export const UGC_REALISM: string[] = [
  'SHOT AS UGC — this is phone footage a real person made, not a production.',
  'Where anything above pulls it back toward looking produced, this wins.',
  '',
  '  SKIN — pores, a faint shine on the forehead and nose, a small blemish or two,',
  '    flyaway hairs, a face that is not symmetrical. No smoothing, no beauty filter.',
  '    This is the strongest tell there is: a retouched face reads as an advert',
  '    however good everything else is.',
  '  LIGHT — one everyday source and nothing filling the other side: a window that',
  '    slightly blows out, or a ceiling fitting at whatever colour it actually is.',
  '    One side of the face darker than the other. Never an even, balanced key.',
  '  LENS — a phone lens. Almost everything stays in focus and the background stays',
  '    legible; it does not melt into bokeh. Mild noise in the shadows, and a little',
  '    softness where things move quickly.',
  '  FRAME — not composed. Slightly off-centre, a little too much or too little',
  '    headroom, a degree off level. A frame that lands on the thirds means a crew.',
  '  ROOM — somewhere someone actually lives. Something in shot is out of place —',
  '    a cable, a used mug, a towel not folded. Nothing cleared or styled for camera.',
  '  WARDROBE — worn, not new. No styling: a hair tie on the wrist, a shirt that has',
  '    been washed a hundred times.',
  '  DELIVERY — talking to the lens, not past it. Contractions, plain words, the',
  '    register of telling one friend one thing. Ordinary blinks and small head',
  '    movement while speaking. No presenting, no announcing, no advertising voice.',
  '  SOUND — the phone’s own microphone in that room: a little reflection off hard',
  '    surfaces and the room’s real background — a fridge, a street, a fan. No music',
  '    underneath and no clean studio voice.',
  '',
  '  Carry SKIN, LIGHT and LENS into EVERY video prompt as three or four short',
  '  phrases in the prompt’s own words — not the whole list, and not stated once',
  '  here and assumed. Each clip is generated alone and remembers nothing.',
];

/** The defaults a UGC piece has to overturn, as exclusions. */
export const UGC_NEGATIVE =
  'no studio or three-point lighting, no colour grading, no cinematic shallow-focus '
  + 'bokeh, no lens flare, no slow motion, no music bed, no retouched or poreless skin, '
  + 'no cinema-camera look, no styled or tidied set';

/**
 * One guardrail line out of several overlapping lists.
 *
 * The UGC exclusions and the smartphone preset's exclusions describe the same
 * defaults, so joining them raw produced "no cinematic shallow-focus bokeh"
 * twice in one sentence, a missing separator where one list ended in a full
 * stop and the next did not, and a capital N mid-sentence. A prompt is read,
 * and a sentence that repeats itself reads as noise around the parts that
 * matter.
 *
 * Splitting on the comma is safe here because every clause in every list has
 * the same shape: "no <thing>".
 */
export function mergeNegatives(...parts: Array<string | undefined>): string {
  const seen = new Set<string>();
  const clauses: string[] = [];
  for (const part of parts) {
    for (const raw of (part || '').split(/[,.]/)) {
      const clause = raw.trim().replace(/\s+/g, ' ');
      if (!clause) continue;
      const key = clause.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      /* Sentence case belongs to the first clause only — the rest are mid-list. */
      clauses.push(clauses.length ? key.charAt(0) + clause.slice(1) : clause);
    }
  }
  return clauses.length ? `${clauses.join(', ')}.` : '';
}

/** The three settings that each mean "this is a UGC piece". */
export const isUgc = (s: StorySettings): boolean =>
  s.cameraProgression === 'propped'
  || s.visualPreset === 'smartphonePOV'
  || s.structure === 'ugcAd';

export type StructureId = 'hook' | 'transform' | 'loop' | 'free' | 'ugcAd';

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
  {
    /* Hook ➜ Build ➜ Payoff is the shape of a short film. This is the shape of
       a creator ad, which is a different thing: it argues. The one rule every
       source agrees on is the one nobody follows — the first words ARE the
       hook. "Hey guys, so I wanted to share something" is three seconds spent
       on nothing, and three seconds is the whole audition. */
    id: 'ugcAd',
    name: 'UGC Ad — Hook ➜ Problem ➜ Proof ➜ CTA',
    hint: 'What a creator ad actually does. Opens on the hook, no throat-clearing.',
    shape: [
      'HOOK — the FIRST words are the hook, and the first shot is already in motion.',
      '  No greeting, no "hey guys", no "so I wanted to share". Start mid-thought on',
      '  the most surprising or most useful thing there is to say.',
      'PROBLEM — the annoyance, named the way somebody says it to a friend rather',
      '  than the way a brand writes it. Specific and small beats broad and important.',
      'PROOF — the hands do the arguing, not the words. The actual thing, actually',
      '  used, in one unhurried continuous movement close enough to see.',
      'CTA — one plain sentence. What to do, said the way a person says it.',
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

/**
 * A Story node's stored data, as settings.
 *
 * There were two of these, written months apart, and each forgot a different
 * set of fields. The node's own reader dropped `avoid` and `timedBeats`, so
 * those did not survive a reload. The runner's dropped `cameraProgression`,
 * `audioMode`, `visualPreset`, `avoid` and `timedBeats` — and since it spread
 * DEFAULT_STORY first, they did not arrive empty, they arrived as the
 * defaults. A user who chose the smartphone preset got a brief that said
 * Custom, and nothing anywhere reported a problem.
 *
 * The bug is not that either was written carelessly. It is that adding a
 * setting meant remembering two places, and a new field is invisible in the
 * one you forget. One function, so there is only ever one place.
 */
export function readStorySettings(d: any): StorySettings {
  const n = d || {};
  return {
    cast: Array.isArray(n.cast) ? n.cast : [],
    world: typeof n.world === 'string' ? n.world : '',
    look: typeof n.look === 'string' ? n.look : '',
    structure: (n.structure as StructureId) || DEFAULT_STORY.structure,
    beats: Number(n.beats) || 0,
    rules: Array.isArray(n.rules) ? n.rules : [],
    cameraProgression:
      (n.cameraProgression as CameraProgressionId) || DEFAULT_STORY.cameraProgression,
    audioMode: (n.audioMode as AudioModeId) || DEFAULT_STORY.audioMode,
    visualPreset: (n.visualPreset as VisualPresetId) || DEFAULT_STORY.visualPreset,
    timedBeats: !!n.timedBeats,
    avoid: typeof n.avoid === 'string' ? n.avoid : '',
  };
}

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

  /* Always, not only when a preset happens to mention it, and with the UGC
     exclusions folded in when this is a UGC piece — those are the model's
     defaults rather than a style, so they have to be named to be beaten. */
  const ugc = isUgc(s);
  const guards = mergeNegatives(preset?.negativePrompt, ugc ? UGC_NEGATIVE : '', ALWAYS_NEGATIVE);

  if (lookParts.length) {
    out.push('LOOK — applies to every shot without changing what is in them.');
    out.push(`  ${lookParts.join(' ')}`);
    out.push(`  Guardrails (Negative): ${guards}`);
    out.push('');
  } else {
    out.push('LOOK — decide the palette, lens and lighting, apply it to all shots, and');
    out.push('return it in the "look" field.');
    out.push(`  Guardrails (Negative): ${guards}`);
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
    /* Two settings that can contradict each other, reconciled here rather
       than left for the model to guess.
       Director Coverage opens on a wide establishing shot and Establishing ➜
       Push In starts wider still. Neither can carry a spoken line: lip sync
       is animated on the face, and a wide frame has too little of one. Said
       explicitly because otherwise the brief asks for both and the writer
       picks whichever it read last. */
    const opensWide = cameraMode.id === 'dynamic' || cameraMode.id === 'establishingToClose';
    const speaks = (s.audioMode || 'cinematic') !== 'ambient'
      && (s.audioMode || 'cinematic') !== 'none';
    if (opensWide && speaks) {
      out.push('  · Where a shot has someone SPEAKING, that shot is chest-up or a medium');
      out.push('    close-up regardless of the coverage above. A wide frame cannot hold a');
      out.push('    line — there is not enough face to animate. Put the wide shot on a');
      out.push('    moment where nobody talks.');
    }
    out.push('');
  }

  // Audio Mode
  const audio = AUDIO_MODES.find((a) => a.id === (s.audioMode || 'cinematic'));
  if (audio && audio.guide.length) {
    out.push(`AUDIO & SOUND DESIGN — ${audio.name}`);
    for (const line of audio.guide) out.push(line);
    out.push('');
  }

  /* After the camera and the audio, deliberately.
     The realism rules contradict things those sections legitimately ask for —
     a preset's lighting, a coverage's composure — and the later instruction
     is the one that survives. It is the reconciliation layer, so it goes last
     of the three. */
  if (ugc) {
    for (const line of UGC_REALISM) out.push(line);
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
  out.push('proportion to their length. A 4s shot holds one action. A 6-8s shot has an');
  out.push('action and the reaction to it. A 10s shot moves through three: what begins,');
  out.push('what it turns into, and where it lands.');
  /* Said because the last version was not. Handed "Setup ➜ Escalation ➜
     Payoff", a model writes "Setup: she holds the jar. Escalation: she dabs
     it on." verbatim into the prompt, and the generator receives three words
     that are not in the scene. Naming the shape without naming the labels is
     half the fix; saying so outright is the other half. */
  out.push('Write that as one continuous description. "Setup", "Escalation", "Climax"');
  out.push('and "Payoff" are how this brief talks about shape — they are not words that');
  out.push('belong in a prompt, and a generator handed them will try to render them.');
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
