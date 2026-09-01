/**
 * The edit sheet: what to add to a finished cut, and exactly when.
 *
 * ── What this is NOT ──────────────────────────────────────────────────────
 *
 * It is not a compositor. Nothing here renders anything onto the clip. The
 * output is a list of timed instructions and, later, the assets to go with
 * them — because the finishing happens in CapCut, where a clipper already
 * works, has their own sound library, and can nudge a cutaway by four frames
 * without waiting for a re-encode.
 *
 * That is also what makes the plan tractable. Omni will only edit ten seconds
 * of video at a time, which is fatal for treating a forty second clip and
 * completely irrelevant for producing a two second cutaway — and two seconds
 * is what the research says a cutaway should be anyway.
 *
 * ── Why the numbers here are the numbers they are ─────────────────────────
 *
 * Every threshold below comes from published short-form data rather than
 * taste:
 *
 *   · a clip holding more than 70% of viewers at the 3 second mark is around
 *     five times more likely to travel, so the first visual beat lands inside
 *     the opening seconds and never later
 *   · attention resets every 5 to 8 seconds — an angle change, a punch-in, a
 *     number on screen. Past that, viewers habituate and leave
 *   · a cutaway holds 1.5 to 2 seconds in short form, up to about 4 when it is
 *     paying something off. Longer and the audio outruns the picture
 *   · roughly 85% of views are sound-off, so anything load-bearing has to be
 *     legible without audio
 *
 * One claim was deliberately NOT encoded: "cut every 10 to 15 seconds". The
 * sources that repeat it describe it as a marketing line rather than platform
 * data, and a rule with no measurement behind it has no business setting the
 * pace of somebody's clip.
 *
 * ── Trust, and the lack of it ─────────────────────────────────────────────
 *
 * The model proposes; this file disposes. Every op is checked against the clip
 * it belongs to before it can reach a node: inside the runtime, long enough to
 * register, short enough not to drag, and not on top of another op. A plan that
 * reads well and puts a cutaway at 0:52 of a 0:19 clip is worse than no plan,
 * because it looks like work has been done.
 */

/** One instruction on the sheet. */
export interface EditOp {
  /** Seconds into the CLIP, not the source video. */
  atSec: number;
  /** How long it holds. Absent for instants like a sound effect. */
  seconds?: number;
  kind: EditKind;
  /** What to do — and for a generated asset, what to generate. */
  what: string;
  /** Why here. Shown to the clipper so a call can be overruled. */
  why: string;
}

export type EditKind =
  | 'broll' | 'punch' | 'text' | 'sfx' | 'intro' | 'outro'
  /* A speed ramp — slow to about half for half a second, then snap. Named
     the strongest single retention tool in the 2026 write-ups, and placed
     in the 2-4s window where three independent sources agree the drop-off
     is decided. */
  | 'ramp'
  /* A momentary push on a word, timed to land with that word highlighted in
     the caption. Two channels saying the same thing at the same instant —
     the write-ups call it double emphasis. */
  | 'zoom';

export const EDIT_KINDS: EditKind[] = [
  'broll', 'punch', 'text', 'sfx', 'intro', 'outro', 'ramp', 'zoom',
];

/* A cutaway shorter than this does not register; longer than this and the
   voice outruns the picture. The upper bound is the payoff case. */
const BROLL_MIN_SEC = 1.0;
const BROLL_MAX_SEC = 4.0;

/* An overlay or callout may sit longer than a cutaway, since the footage keeps
   playing underneath it. */
const OVERLAY_MAX_SEC = 6.0;

/* How long each kind may hold.
 *
 * The momentary ones are bounded tightly on measured advice: an effect over
 * roughly four tenths of a second "feels like a loading screen". A ramp gets
 * a little more room because it is two moves — slow, then snap.
 *
 * A punch is deliberately NOT in that group. It is a framing change that
 * persists, not an animation that plays, so it holds as long as the shot
 * wants. Lumping the two together is how a punch-in becomes a twitch. */
const HOLD: Record<EditKind, { min: number; max: number }> = {
  broll: { min: BROLL_MIN_SEC, max: BROLL_MAX_SEC },
  intro: { min: BROLL_MIN_SEC, max: BROLL_MAX_SEC },
  outro: { min: BROLL_MIN_SEC, max: BROLL_MAX_SEC },
  text: { min: 0.6, max: OVERLAY_MAX_SEC },
  punch: { min: 0.3, max: OVERLAY_MAX_SEC },
  zoom: { min: 0.15, max: 0.6 },
  ramp: { min: 0.2, max: 0.9 },
  sfx: { min: 0.05, max: 2.0 },
};

/* Where the drop-off is decided, and where a ramp or a keyword push belongs.
   Three separate sources put the same window here. */
export const EMPHASIS_FROM_SEC = 2.0;
export const EMPHASIS_TO_SEC = 4.0;

/**
 * The opening, where the viewer decides whether to stay.
 *
 * One to three seconds is the window the 2026 write-ups agree on: long enough
 * to set an expectation, short enough that nothing may be spent establishing
 * anything. The planner was told where a RAMP belongs and nothing about the
 * opening at all, so it treated second 0 like any other second.
 */
export const HOOK_UNTIL_SEC = 3.0;

/**
 * Where the middle of a clip starts and ends, as fractions of its runtime.
 *
 * A 2025 analysis across TikTok and Reels found a shaped arc — fast open,
 * slower through the explanation, accelerating again before the end — beat
 * uniformly high-energy edits by 18-25% on completion. The planner had a
 * budget and no shape, so it spread its instructions evenly, which is the
 * "purely high-energy" edit that measured worse.
 */
export const ARC_MIDDLE_FROM = 0.3;
export const ARC_MIDDLE_TO = 0.7;

/* The window in which the first visual beat has to land. Retention at three
   seconds is what decides whether a short travels. */
export const FIRST_BEAT_BY_SEC = 3.0;

/* How often attention wants resetting. Used to size the ask and to say, on the
   node, when a plan has left a long flat stretch. */
export const RESET_EVERY_SEC = 8.0;

/* Ops per clip, so a nineteen second cut cannot come back with thirty
   instructions nobody will follow. Roughly one per reset window, plus room for
   an intro and an outro. */
const opsAllowed = (clipSeconds: number): number =>
  Math.max(3, Math.ceil(clipSeconds / RESET_EVERY_SEC) * 2 + 2);

/** Two ops of these kinds cannot occupy the same moment. */
const OCCUPIES_PICTURE: EditKind[] = ['broll', 'intro', 'outro'];

/**
 * How the clip feels, which decides what may be done to it.
 *
 * Here because of the single most uncomfortable finding in the research:
 * viewers detect EMOTIONAL misalignment about 68% faster than technical
 * flaws, and the commonest tell of an amateur edit is that "none of the cuts
 * feel motivated".
 *
 * A plan built only on timing rules will cheerfully put an air-horn on a line
 * about somebody losing their job, and every timing check in this file would
 * pass it. So the model states the tone before it plans, and the playful
 * moves are refused on serious material in code as well as in the prompt.
 */
export type ClipTone = 'upbeat' | 'neutral' | 'serious';

/* Sounds that are a joke by nature. A riser or an impact carries weight and
   belongs on serious material; a slide whistle never does. Matched on the
   name the model gives, which is why the prompt asks it to NAME the sound
   rather than describe it. */
const PLAYFUL_SFX =
  /boing|pop\b|cartoon|record.?scratch|air.?horn|slide.?whistle|ding|quack|fart|bruh|vine/i;

export interface SheetContext {
  /** How long the finished cut runs. */
  clipSeconds: number;
  /** What the clip is about, from the reply that judged it. */
  title?: string;
  why?: string;
  /** The words and their seconds, relative to the CLIP. */
  phrases: Array<{ startSec: number; endSec: number; text: string }>;
  /** Campaign work forbids footage that is not the creator's own. */
  mode?: 'campaign' | 'explainer';
  /* Where this clip was cut into pieces for Omni. A join is a real cut in
     the finished edit, and a cut is exactly what a whoosh exists to hide. */
  seams?: number[];
}

/* ────────────────────────────────────────────────────────────────────────
   The ask
   ──────────────────────────────────────────────────────────────────────── */

const stamp = (sec: number): string => {
  const s = Math.max(0, sec);
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}.${
    String(Math.round((s % 1) * 10)).slice(0, 1)}`;
};

/**
 * The brief, with the clip's own words in it.
 *
 * The transcript is included with seconds attached because every instruction
 * has to attach to something that is actually said. Without it the model
 * invents a moment, and an instruction pointing at a moment that does not
 * exist is indistinguishable from one that does until somebody opens CapCut.
 */
export function editSheetAsk(context: SheetContext): string {
  const campaign = context.mode === 'campaign';
  const budget = opsAllowed(context.clipSeconds);

  const lines: string[] = [
    `A vertical clip, ${context.clipSeconds.toFixed(1)} seconds long, is already cut and captioned.`,
    'Plan what to ADD to it. Someone will assemble this in CapCut, so every',
    'instruction needs a time and a reason.',
    '',
  ];

  if (context.title) lines.push(`It will be posted as: ${context.title}`, '');
  if (context.why) lines.push(`It was chosen because: ${context.why}`, '');

  lines.push('WHAT IS SAID, WITH ITS SECONDS INTO THE CLIP', '');
  for (const p of context.phrases) {
    lines.push(`  ${stamp(p.startSec)}  ${p.text}`);
  }

  lines.push(
    '',
    'WHAT MOVES WATCH TIME, AND THE NUMBERS BEHIND IT',
    '',
    '· A clip holding more than 70% of viewers at 3 seconds is about five times',
    `  more likely to travel. Put the first visual beat before ${FIRST_BEAT_BY_SEC}s.`,
    `· Attention resets every 5 to 8 seconds. Do not leave a stretch longer than`,
    `  ${RESET_EVERY_SEC}s with nothing happening.`,
    `· A cutaway holds ${BROLL_MIN_SEC} to 2 seconds, up to ${BROLL_MAX_SEC} when it pays something off.`,
    '  Longer and the voice outruns the picture.',
    '· About 85% of views are sound-off. Anything that carries meaning must work',
    '  with no audio at all.',
    '',
    'THE KINDS OF INSTRUCTION',
    '',
    'punch  a punch-in on the speaker. Free, costs nothing to make, and it is',
    '       the cheapest way to reset attention. Prefer it.',
    'text   a word, number or short phrase on screen. Quote or paraphrase',
    '       something actually said at that second.',
    'sfx    a named sound effect. NAME it — whoosh, impact, riser — do not',
    '       describe it. riser goes BEFORE a reveal to build it; impact goes',
    '       AFTER, to land it; whoosh covers a transition or a cut.',
    'ramp   a speed ramp: slow to about half, then snap back. The strongest',
    `       single move for retention, and it belongs between ${EMPHASIS_FROM_SEC}s and`,
    `       ${EMPHASIS_TO_SEC}s where the drop-off is decided.`,
    'zoom   a quick push on ONE word, landing exactly as that word is said.',
    '       Pair it with a text on the same word: two channels saying the',
    '       same thing at once.',
  );

  if (campaign) {
    lines.push(
      '',
      'This is CAMPAIGN work under someone else\'s brief. Footage that is not the',
      'creator\'s own is forbidden, so do NOT plan broll, intro or outro. Use only',
      'punch, text and sfx.',
    );
  } else {
    lines.push(
      'broll  a generated cutaway. Say what should be ON SCREEN in one sentence,',
      '       as an instruction to a video model. It must illustrate what is being',
      '       said at that second.',
      'intro  a card before the clip starts. Only if it earns the second it costs.',
      'outro  a card after it ends.',
    );
  }

  lines.push(
    '',
    'WHERE THINGS GO',
    '',
    `The first ${HOOK_UNTIL_SEC}s decide whether anyone stays. Something belongs`,
    'here — a text carrying the claim, or a punch on the first strong word.',
    'Nothing may be spent establishing anything.',
    '',
    'Then shape it. A clip is not a flat stretch of energy:',
    '',
    `  0 - ${HOOK_UNTIL_SEC}s        open fast, land the claim`,
    `  ${(context.clipSeconds * ARC_MIDDLE_FROM).toFixed(1)} - ${(context.clipSeconds * ARC_MIDDLE_TO).toFixed(1)}s`
      + '     the explanation. Let it breathe — this is where a cutaway',
    '                gives room, and where stacking effects hurts.',
    `  ${(context.clipSeconds * ARC_MIDDLE_TO).toFixed(1)}s - end     pick it up again before it ends.`,
    '',
    'An even spread of instructions is the edit that measures WORST. Front and',
    'back carry more than the middle.',
    '',
    'THE TEST FOR A SOUND',
    '',
    'Take it away. If the moment gets less CLEAR without it, it is doing real',
    'work. If the only thing that drops is energy, it is decoration — leave it',
    'out. Most clips need one or two sounds, not six.',
    '',
    'HOW LONG THINGS RUN',
    '',
    'A zoom or a ramp is momentary — under half a second. Anything longer',
    'reads as a loading screen. A punch-in is different: it is a framing',
    'change that stays, so it holds as long as the shot wants.',
    '',
    'RULES',
    '',
    `· At most ${budget} instructions. Fewer, placed well, beats more.`,
    `· Every "at" is between 0 and ${context.clipSeconds.toFixed(1)}.`,
    '· Two things cannot be on screen at once. Do not overlap broll with broll.',
    '· If a moment does not need anything, leave it alone.',
    `· At least one instruction lands before ${HOOK_UNTIL_SEC}s.`,
    '',
    'FIRST, SAY HOW IT FEELS',
    '',
    'Before planning anything, judge the tone of what is said: "upbeat",',
    '"neutral" or "serious". Then plan for THAT. A speed ramp or a comedy',
    'sound on a serious moment is worse than adding nothing — viewers notice',
    'a wrong feeling faster than they notice a technical mistake.',
    '',
    'Reply with JSON only:',
    '{"tone":"upbeat","ops":[{"at":2.4,"seconds":1.8,"kind":"broll",'
      + '"what":"a phone screen filling with short videos","why":"he says 400,000 a month"}]}',
  );

  return lines.join('\n');
}

/* ────────────────────────────────────────────────────────────────────────
   Reading it back
   ──────────────────────────────────────────────────────────────────────── */

const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};

function readObject(reply: unknown): Record<string, unknown> | null {
  if (reply && typeof reply === 'object') return reply as Record<string, unknown>;
  if (typeof reply !== 'string') return null;
  const text = reply.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try {
    return JSON.parse(text);
  } catch {
    /* A model that wrapped its JSON in a sentence. Take the outermost braces. */
    const from = text.indexOf('{');
    const to = text.lastIndexOf('}');
    if (from < 0 || to <= from) return null;
    try {
      return JSON.parse(text.slice(from, to + 1));
    } catch {
      return null;
    }
  }
}

export interface SheetResult {
  ops: EditOp[];
  /** Everything refused, in words a person can act on. */
  dropped: string[];
  /** How the model judged the clip, which decided what it was allowed. */
  tone: ClipTone;
}

/**
 * Turn a reply into a sheet, refusing anything that cannot be true.
 *
 * Dropped rather than repaired. A cutaway at 0:52 of a 0:19 clip is not a
 * cutaway with a typo — it is evidence the model was not working from the
 * clip in front of it, and moving it somewhere plausible would hide that.
 */
export function readEditSheet(reply: unknown, context: SheetContext): SheetResult {
  const root = readObject(reply);
  const raw = Array.isArray(root?.ops) ? (root!.ops as unknown[]) : [];
  const dropped: string[] = [];
  const ops: EditOp[] = [];

  const runtime = context.clipSeconds;
  const campaign = context.mode === 'campaign';
  const budget = opsAllowed(runtime);

  const said = String(root?.tone ?? '').trim().toLowerCase();
  const tone: ClipTone =
    said === 'upbeat' || said === 'serious' ? said : 'neutral';

  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;

    const kind = String(o.kind ?? '').trim().toLowerCase() as EditKind;
    if (!EDIT_KINDS.includes(kind)) {
      dropped.push(`"${String(o.kind ?? '')}" is not a kind of edit`);
      continue;
    }

    /* The brief says so, and the brief is not enough. A campaign clip carrying
       generated footage breaks the rule the account earns from. */
    if (campaign && (kind === 'broll' || kind === 'intro' || kind === 'outro')) {
      dropped.push(`${kind} is not allowed on campaign work — generated footage is off the brief`);
      continue;
    }

    const at = num(o.at ?? o.atSec);
    if (at === null || at < 0 || at > runtime) {
      dropped.push(`${kind} at ${String(o.at ?? o.atSec)}s is outside a ${runtime.toFixed(1)}s clip`);
      continue;
    }

    /* A punch IS its own instruction, and the model often leaves `what` empty
       for exactly that reason — the kind already says push in on the speaker.
       Dropping those was measured against the real endpoint costing three
       beats on one clip, including the only one before the 3 second mark,
       which is the threshold that most decides whether a clip travels.
       Everything else still has to say what to do: a cutaway with no
       description is nothing to generate, and a sound with no name is nothing
       to find. */
    const what = String(o.what ?? '').trim() || (kind === 'punch' ? 'punch in' : '');
    if (!what) {
      dropped.push(`${kind} at ${stamp(at)} says nothing about what to do`);
      continue;
    }

    /* Playful moves on serious material. Every timing check in this file
       would pass an air-horn over a line about somebody losing their job,
       and that is the mistake viewers catch fastest. */
    if (tone === 'serious' && kind === 'ramp') {
      dropped.push(`a speed ramp at ${stamp(at)} is the wrong feeling for this clip`);
      continue;
    }
    if (tone === 'serious' && kind === 'sfx' && PLAYFUL_SFX.test(String(o.what ?? ''))) {
      dropped.push(`"${String(o.what).trim()}" at ${stamp(at)} is the wrong feeling for this clip`);
      continue;
    }

    let seconds = num(o.seconds);
    if (seconds !== null) {
      const { min, max } = HOLD[kind];
      if (seconds < min) {
        dropped.push(`${kind} at ${stamp(at)} holds ${seconds}s, too short to register`);
        continue;
      }
      if (seconds > max) {
        dropped.push(`${kind} at ${stamp(at)} holds ${seconds}s, past the ${max}s a ${kind} should`);
        continue;
      }
      /* Never past the end. A cutaway starting at 18s of a 19s clip cannot
         hold for two. */
      seconds = Math.min(seconds, Math.max(0, runtime - at));
      if (seconds <= 0) seconds = undefined as unknown as number;
    }

    ops.push({
      atSec: at,
      seconds: seconds === null ? undefined : seconds,
      kind,
      what,
      why: String(o.why ?? '').trim(),
    });
  }

  ops.sort((a, b) => a.atSec - b.atSec);

  /* Two things cannot be on screen at once. Later ops give way, because the
     earlier one is already anchored to something said before it. */
  const kept: EditOp[] = [];
  for (const op of ops) {
    if (!OCCUPIES_PICTURE.includes(op.kind)) { kept.push(op); continue; }
    const clash = kept.find(
      (k) => OCCUPIES_PICTURE.includes(k.kind)
        && op.atSec < k.atSec + (k.seconds ?? 0)
        && k.atSec < op.atSec + (op.seconds ?? 0),
    );
    if (clash) {
      dropped.push(`${op.kind} at ${stamp(op.atSec)} lands on the ${clash.kind} already there`);
      continue;
    }
    kept.push(op);
  }

  /* A whoosh over every join.
   *
   * Masking a cut is the oldest job a whoosh has, and these are real cuts: a
   * clip too long for Omni is edited in pieces and rejoined, so each seam is a
   * splice between two independently generated treatments. That is exactly the
   * discontinuity a transition sound exists to cover.
   *
   * Added here rather than asked for, because the model is not told where the
   * seams are — they are decided by arithmetic after the plan, and a model
   * guessing at them would put sounds over cuts that are not there.
   *
   * Never on top of a sound the model already placed there: two sounds at one
   * moment is a mistake, not emphasis. */
  for (const seam of context.seams || []) {
    if (!(seam > 0) || seam >= runtime) continue;
    const alreadyCovered = kept.some(
      (op) => op.kind === 'sfx' && Math.abs(op.atSec - seam) < 0.35,
    );
    if (alreadyCovered) continue;
    kept.push({
      atSec: seam,
      kind: 'sfx',
      what: 'whoosh',
      why: 'covers the join between two generated pieces',
    });
  }
  kept.sort((a, b) => a.atSec - b.atSec);

  if (kept.length > budget) {
    dropped.push(`${kept.length - budget} more than a ${runtime.toFixed(1)}s clip has room for`);
    kept.length = budget;
  }

  return { ops: kept, dropped, tone };
}

/**
 * What the sheet does not cover, in the clipper's terms.
 *
 * Not a validation failure — a plan can be entirely legal and still leave the
 * middle of a clip flat. This is the part worth saying out loud, because it is
 * the difference between a sheet that was followed and one that worked.
 */
export function sheetGaps(ops: EditOp[], clipSeconds: number): string[] {
  const gaps: string[] = [];
  const beats = ops.map((o) => o.atSec).sort((a, b) => a - b);

  if (!beats.length) return ['nothing planned — the clip runs flat all the way through'];

  if (beats[0] > FIRST_BEAT_BY_SEC) {
    gaps.push(
      `first beat at ${stamp(beats[0])} — retention is decided by ${FIRST_BEAT_BY_SEC}s`,
    );
  }

  let previous = 0;
  for (const at of beats) {
    if (at - previous > RESET_EVERY_SEC) {
      gaps.push(`${stamp(previous)}–${stamp(at)} has nothing in it`);
    }
    previous = at;
  }
  if (clipSeconds - previous > RESET_EVERY_SEC) {
    gaps.push(`${stamp(previous)} to the end has nothing in it`);
  }

  return gaps;
}

/** The sheet as something a person can read in CapCut. */
export function sheetAsText(ops: EditOp[], title?: string): string {
  const lines: string[] = [];
  if (title) lines.push(title, '');
  for (const op of ops) {
    const held = op.seconds ? ` (${op.seconds.toFixed(1)}s)` : '';
    lines.push(`${stamp(op.atSec)}${held}  ${op.kind.toUpperCase()}  ${op.what}`);
    if (op.why) lines.push(`         ${op.why}`);
  }
  return lines.join('\n');
}
