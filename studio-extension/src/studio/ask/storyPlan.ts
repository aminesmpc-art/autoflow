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
 * A caveat worth keeping in the code rather than only in a chat message:
 * text cannot guarantee consistency. Diffusion models re-roll per-pixel
 * randomness on every generation, so identical descriptions still produce
 * visibly different people. Reference images do the heavy lifting; this
 * reduces drift, it does not remove it. The UI should never imply otherwise.
 */

import type { ShotTarget } from './storyboard';

export interface CastMember {
  /** How the story refers to them: "the designer", "Maya". */
  name: string;
  /** Everything that must be identical every time they appear. */
  look: string;
}

export interface StorySettings {
  cast: CastMember[];
  world: string;
  look: string;
  structure: StructureId;
  /** Story beats across the whole piece. 0 means derive it from the clips. */
  beats: number;
  /** Continuity rules, by id. Each one is a line in the brief. */
  rules: RuleId[];
}

export type RuleId = 'cumulative' | 'fixedCamera' | 'samePerson' | 'inHand';

/**
 * The rules the room template used to hardcode, as switches.
 *
 * Each is a real failure this kind of piece hits without it, which is why
 * they are a short fixed list rather than a free-text box: a rule that can be
 * written any way cannot also be checked, and these are worth checking.
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
  cast: [], world: '', look: '', structure: 'hook', beats: 0, rules: [],
};

/** Seconds in a target, or 0 for a still. */
function secondsOf(t: ShotTarget): number {
  const m = /([\d.]+)\s*s/i.exec(t.duration || '');
  return m ? Number(m[1]) : 0;
}

/**
 * How many beats the piece should hold.
 *
 * About four seconds each, which is where short-form advice lands and what
 * the room template already assumed — five scenes across twenty seconds.
 * Derived rather than typed, because the durations are on the canvas and
 * asking someone to keep a number in sync with them is asking for it to be
 * wrong.
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
 *
 * Anything left empty is asked for rather than invented silently: the model
 * fills it, the run writes it back to the node, and from then on it is a
 * locked field the user can correct. Describing a cast once and editing one
 * word beats retyping it into five prompts.
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
      out.push(`  · ${c.name.trim() || 'Unnamed'}: ${c.look.trim() || '(describe them)'}`);
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

  if (s.look.trim()) {
    out.push('LOOK — applies to every shot without changing what is in them.');
    out.push(`  ${s.look.trim()}`);
    out.push('');
  } else {
    out.push('LOOK — decide the palette, lens and lighting, apply it to all shots, and');
    out.push('return it in the "look" field.');
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
  out.push('proportion to their length. A shot long enough for two beats gets two; a still');
  out.push('gets one. Every beat is a visible change, not a mood.');
  out.push('');

  return out.join('\n');
}

/**
 * The extra envelope fields a Story node asks for on top of the shots.
 *
 * Appended to shotContract's object so one reply carries both the prompts and
 * the story that produced them — which is what lets the node lock the cast
 * and world afterwards instead of asking again next run.
 */
export const STORY_FIELDS = [
  '  "cast": [ { "name": "short name", "look": "everything that must stay identical" } ],',
  '  "world": "the place, described once",',
  '  "look": "palette, lens, lighting",',
].join('\n');
