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

export type EditKind = 'broll' | 'punch' | 'text' | 'sfx' | 'intro' | 'outro';

export const EDIT_KINDS: EditKind[] = ['broll', 'punch', 'text', 'sfx', 'intro', 'outro'];

/* A cutaway shorter than this does not register; longer than this and the
   voice outruns the picture. The upper bound is the payoff case. */
const BROLL_MIN_SEC = 1.0;
const BROLL_MAX_SEC = 4.0;

/* An overlay or callout may sit longer than a cutaway, since the footage keeps
   playing underneath it. */
const OVERLAY_MAX_SEC = 6.0;

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
    'sfx    a named sound effect — whoosh, impact, riser. Name it; do not',
    '       describe it at length.',
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
    'RULES',
    '',
    `· At most ${budget} instructions. Fewer, placed well, beats more.`,
    `· Every "at" is between 0 and ${context.clipSeconds.toFixed(1)}.`,
    '· Two things cannot be on screen at once. Do not overlap broll with broll.',
    '· If a moment does not need anything, leave it alone.',
    '',
    'Reply with JSON only:',
    '{"ops":[{"at":2.4,"seconds":1.8,"kind":"broll",'
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

    let seconds = num(o.seconds);
    if (seconds !== null) {
      const cap = kind === 'broll' || kind === 'intro' || kind === 'outro'
        ? BROLL_MAX_SEC
        : OVERLAY_MAX_SEC;
      if (seconds < BROLL_MIN_SEC && kind !== 'sfx' && kind !== 'punch') {
        dropped.push(`${kind} at ${stamp(at)} holds ${seconds}s, too short to register`);
        continue;
      }
      if (seconds > cap) {
        dropped.push(`${kind} at ${stamp(at)} holds ${seconds}s, past the ${cap}s a ${kind} should`);
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

  if (kept.length > budget) {
    dropped.push(`${kept.length - budget} more than a ${runtime.toFixed(1)}s clip has room for`);
    kept.length = budget;
  }

  return { ops: kept, dropped };
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
