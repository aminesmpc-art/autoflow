/**
 * The Motion Control director.
 *
 * ── Why this is a director and not a template ─────────────────────────────
 *
 * Omni will not take more than ten seconds of video in one generation — Flow
 * says so in its own error: "Videos longer than 10s can't be edited. Trim to
 * 10s or under to edit." So a thirty second source is three generations, and
 * the obvious thing to do is send the same sentence three times.
 *
 * That produces three unrelated clips. The model has no idea that piece two
 * opens on a hand already reaching, or that the turn to camera happens eight
 * seconds in and is the whole point of piece three. It writes each one as if
 * it were the only one.
 *
 * So the pieces are SHOWN to a model first, one at a time, in a single
 * conversation. It watches piece one, writes its prompt, and is then shown
 * piece two — knowing what it just asked for. That is the same thing Director
 * Chief does for a story, and it is the only part of this feature that is not
 * already built somewhere in this repo.
 *
 * ── The three jobs ────────────────────────────────────────────────────────
 *
 * Google names these separately and gives the wording for each. They are not
 * three phrasings of one idea — they differ in what is kept and what is
 * replaced, and a prompt that blurs them gets a blurred result.
 */

/** What the user is asking Omni to do with the motion. */
export type MotionMode = 'move' | 'swap' | 'restyle';

export function motionAudioPrompt(prompt: string, muted: boolean): string {
  return muted
    ? `${prompt}\nAUDIO OVERRIDE: The source video has no audio track. Perform only the visual edit. Do not generate speech, dialogue, singing, or lip-sync; any earlier audio instructions do not apply. Produce silent output.`
    : prompt;
}

export interface MotionPiece {
  /** 1-based, matching OmniChunk.index. */
  index: number;
  of: number;
  startSec: number;
  endSec: number;
  seconds: number;
  /** True when the split had to land inside somebody speaking. */
  cutsSpeech: boolean;
}

/**
 * One piece as the node keeps it: the cut, the prompt written for it, and how
 * its generation went.
 *
 * ── Why the node holds these instead of building a node per piece ─────────
 *
 * It used to spawn a Prompt node and an Omni node for every piece. That reads
 * well — real nodes, editable, re-runnable — and it cannot work in one press:
 * the runner sorts its plan ONCE, before the first step, so nodes created
 * during a run are not in it. Motion Control could never produce a clip on the
 * run that built them. The second press then re-ran Motion Control from the
 * top — a fresh cut, a fresh upload, a fresh director conversation — and
 * replaced the very nodes whose prompts had just been edited.
 *
 * Everything spawning bought is kept by keeping the pieces HERE: the prompt is
 * still editable, a piece can still be redone on its own, and the row says
 * what happened to it. What is given up is wiring one piece onward into
 * another node, which nothing in the graph consumes today — there is no stitch
 * node — and which cost a two-press run for every job.
 */
export interface MotionPieceRow {
  index: number;
  of: number;
  startSec: number;
  endSec: number;
  seconds: number;
  cutsSpeech: boolean;
  /** The name it was uploaded under, and the name Flow's library shows. */
  filename: string;
  /** What the director wrote. Editable on the node before a retry. */
  prompt: string;
  /** The director's one line about why, for the row's tooltip. */
  why: string;
  status: 'idle' | 'running' | 'done' | 'error';
  errorMessage?: string;
  /**
   * A PLAYABLE clip, or nothing.
   *
   * The Flow adapter's result carries no `videoUrl` field at all — it sends
   * imageUrl / thumbnailUrl / previewUrl / previewVideoUrl — so reading one was
   * always undefined, and the fallback chain behind it could put a still into a
   * <video src>, which renders an empty player rather than a picture.
   *
   * Only two things belong here: previewVideoUrl, which is a data: URL of the
   * clip itself and always plays, or a media URL that is demonstrably a video.
   */
  videoUrl?: string;
  /**
   * The still to show when there is no playable clip.
   *
   * previewVideoUrl is best effort: buildStudioVideoData caps at 15MB and gives
   * up on a fetch it cannot make, so one piece of a pair can come back with a
   * clip and the other with only a frame. Both should show something.
   */
  posterUrl?: string;
  tileId?: string;
  /** Remove audio from a new upload before retrying this piece. */
  muteRequested?: boolean;
  /** The uploaded ingredient has no audio track. */
  audioMuted?: boolean;
  alternatives?: string[];
}

export interface MotionBrief {
  mode: MotionMode;
  /** What the user typed. The subject of the whole job. */
  wish: string;
  /** Whether a character/subject still was wired in. */
  hasCharacter: boolean;
  referenceRules?: string;
  offerAlternatives?: boolean;
}

/**
 * What each mode is, in Google's own words.
 *
 * Quoted rather than paraphrased on purpose. These are the phrasings the model
 * was demonstrated with, and a rewrite of them is a guess dressed as a
 * refinement.
 *
 * ── `narrateMotion`, and why two of the three say no ──────────────────────
 *
 * Read Google's own wording for `move` again and count what it describes:
 *
 *   "Apply the pose and motion from input video to provided character from
 *    this image."
 *
 * Thirteen words, and not one of them describes a movement. That is not
 * brevity, it is the point. The video IS the motion source — Omni reads pose
 * and timing off the frames — so a prompt that ALSO describes the motion hands
 * the model two specifications of the same thing: the exact frames, and a
 * lossy paraphrase of them. It blends the two, and the paraphrase wins wherever
 * it is the more confident of the pair.
 *
 * The director was asked for "what MOVES, precisely", did exactly that, and
 * produced:
 *
 *   "Transfer the exact opening dance choreography from 0.0s to 6.0s,
 *    including the bouncy side-to-side footwork, rhythmic hip sways, chest
 *    pops, and dynamic arm pumps. Maintain … fixed eye-level camera framing."
 *
 * Sixty words of motion description over a clip that already contained the
 * motion — and a camera named in text, for a mode whose whole claim is that it
 * keeps the camera from the video. The result was a generic bouncy dance
 * rather than HER dance, which is exactly what a blend of the two looks like.
 *
 * `restyle` is the exception, and genuinely so: it re-expresses the movement in
 * another material, so the movement has to be described to be transformed.
 */
export const MODE_INTENT: Record<MotionMode, {
  title: string;
  googleWording: string;
  keeps: string;
  replaces: string;
  /** May the prompt describe the movement, or does that compete with the clip? */
  narrateMotion: boolean;
  /** What the prompt is FOR — the things the video cannot carry. */
  writes: string;
}> = {
  move: {
    title: 'Move like this',
    googleWording:
      'Apply the pose and motion from input video to provided character from this image.',
    keeps: 'the motion, the pose, the timing and the camera',
    replaces: 'who or what is performing it — taken from the still',
    narrateMotion: false,
    writes: 'who is performing it and what they look like — the one thing the footage does not carry',
  },
  swap: {
    title: 'Swap the character',
    googleWording:
      'Swap characters or objects with a reference image — the new character will '
      + 'match your motion and dialogue seamlessly.',
    keeps: 'the motion AND the dialogue, so lip-sync survives',
    replaces: 'the character or object, everything else in the shot standing',
    narrateMotion: false,
    writes: 'the new character, and what in the shot must stay exactly as it is',
  },
  restyle: {
    title: 'Restyle, keep the motion',
    googleWording:
      'Apply the motion of the whale swimming from the provided video to the provided '
      + 'image of fluid reflective material. Do not show the whale or water; instead, '
      + 'have this reflective moving material form a shape that resembles the whale as '
      + 'it swims.',
    keeps: 'the movement, abstracted rather than copied',
    replaces: 'the material, the medium, the entire look — and it must say what NOT to show',
    /* The one mode that must describe the movement: it is being re-expressed
       in another material, and a material cannot be told to copy frames. */
    narrateMotion: true,
    writes: 'the movement as a shape, the material carrying it, and what must NOT appear',
  },
};

/** The reply contract, repeated on every turn because the model drifts off it. */
const CONTRACT =
  'Answer with ONE JSON object and nothing else: {"prompt":"…","why":"…"}. '
  + '"prompt" is what will be sent to the video model, verbatim. '
  + '"why" is one short sentence for the person reading the run log.';

/**
 * The opening turn: what the job is, before any footage is shown.
 *
 * Sent once. Everything after it is a piece, and the thread carries this.
 */
export function motionBriefAsk(brief: MotionBrief, pieces: number): string {
  const m = MODE_INTENT[brief.mode];
  return [
    `You are directing a motion-transfer job that has to be done in ${pieces} `
    + `separate generations, because the video model refuses anything longer than `
    + `10 seconds at a time.`,
    '',
    `THE JOB: ${m.title}.`,
    `The model's own instruction for this is: "${m.googleWording}"`,
    `It keeps ${m.keeps}. It replaces ${m.replaces}.`,
    '',
    `WHAT THE USER ASKED FOR: ${brief.wish || '(nothing beyond the mode itself)'}`,
    brief.referenceRules || '',
    brief.hasCharacter
      ? 'A character/subject still is attached. Every piece uses that same still, '
        + 'so refer to it as "the provided image" and never describe a different subject.'
      : 'NO character still was provided. Do not write prompts that refer to one — '
        + 'work from the footage and the user\'s words alone.',
    '',
    /* The single most important line in this brief, and it is a prohibition.
       Told to describe the motion, the director does — and the description then
       competes with the footage that already contains it. */
    m.narrateMotion
      ? 'THIS MODE NEEDS THE MOVEMENT DESCRIBED. The motion is being re-expressed in '
        + 'another material, so it has to be put into words before it can be '
        + 'transformed. Describe it as shape and rhythm, not as a person.'
      : 'DO NOT DESCRIBE THE MOVEMENT. The video is attached to every generation and '
        + 'the model reads the pose, the timing and the camera straight off its frames. '
        + 'A prompt that also narrates the movement gives the model two versions of the '
        + 'same thing — the exact frames, and your paraphrase of them — and it blends '
        + 'them. The result then moves roughly like the source instead of exactly like '
        + 'it. Name the action in a few words at most ("a dance", "she walks and '
        + 'turns"); never list the steps, the beats or the body parts, and never name '
        + 'a camera move or a framing, which come from the video too.',
    '',
    `WHAT THE PROMPT IS FOR: ${m.writes}.`,
    '',
    `I will show you the ${pieces} pieces one at a time, in order. For each one you `
    + 'write the prompt for THAT piece only.',
    '',
    'Three things to hold across all of them, because each piece is generated '
    + 'independently and drift between them is the main way this fails:',
    '  1. The same subject, described the same way every time.',
    m.narrateMotion
      ? '  2. The same look — lighting, grade, lens feel — named explicitly in each prompt.'
      /* Named as a REFERENCE rather than as values. Inventing "bright soft studio
         lighting" makes the pieces agree with each other and disagree with the
         footage; pointing at the footage makes them agree with both. */
      : '  2. The same look — say "match the lighting, grade and framing of the input '
        + 'video" in each prompt rather than inventing values, so the pieces agree '
        + 'with each other AND with the source.',
    '  3. Continuity at the joins: a piece must start where the one before it ended.',
    '',
    'Reply "READY" and nothing else. The first piece follows.',
  ].join('\n');
}

/**
 * A turn for one piece.
 *
 * The piece's own footage is attached by the caller; this is the sentence that
 * goes with it. It carries the piece's position deliberately — "this is the
 * last one, it has to land" is information the model cannot get from the
 * footage.
 */
export function motionPieceAsk(brief: MotionBrief, piece: MotionPiece): string {
  const m = MODE_INTENT[brief.mode];
  const where = piece.index === 1
    ? 'This is the OPENING piece. It carries the hook — whatever makes someone stay.'
    : piece.index === piece.of
      ? 'This is the FINAL piece. It has to land rather than trail off.'
      : `This is piece ${piece.index} of ${piece.of}, in the middle.`;

  return [
    `PIECE ${piece.index} of ${piece.of} is attached — `
    + `${piece.startSec.toFixed(1)}s to ${piece.endSec.toFixed(1)}s of the source `
    + `(${piece.seconds.toFixed(1)}s long).`,
    where,
    piece.index > 1
      ? 'It continues directly from the piece you just wrote for. Whatever you asked '
        + 'for there is where this one begins.'
      : '',
    piece.cutsSpeech
      ? 'NOTE: this piece begins mid-sentence — the split could not find a pause. '
        + 'Say so in the prompt so the model does not treat the opening as a fresh start.'
      : '',
    '',
    /* Repeated on EVERY piece rather than said once in the opening turn.
     *
       It used to live in the brief alone. By piece three that is five turns and
       two watched videos ago, and a specific instruction — "slow motion", "keep
       the background", "she stays facing forward" — was free to be dropped,
       with nothing in the output to show it ever existed. */
    brief.wish
      ? `WHAT THE USER ASKED FOR, WHICH STILL APPLIES TO THIS PIECE: ${brief.wish}`
      : '',
    '',
    'Watch it. Then write the prompt for this piece:',
    m.narrateMotion
      ? `  · the movement as shape and rhythm — that is what ${m.title.toLowerCase()} transforms`
      : '  · NOT the movement. The clip carries it, and describing it competes with '
        + 'it. Name the action in a few words at most and move on',
    brief.hasCharacter
      ? '  · the provided image as the subject, described identically to last time'
      : '  · the subject as it appears in the footage',
    m.narrateMotion
      ? '  · the look, named again in full — the model has no memory of the other pieces'
      : '  · "match the lighting, grade and framing of the input video" — do not invent '
        + 'lighting or a camera move, both of those come from the clip',
    /* The timecodes above are context for YOU. They were being copied into the
       prompt — "Transfer the exact choreography from 0.0s to 6.0s" — and the
       video model is handed this clip alone, so a source timeline it cannot
       see is at best noise and at worst an instruction about time it will try
       to act on. */
    '  · no timecodes and no "part 2 of 2". The model is given this clip on its own '
    + 'and knows nothing of the source timeline.',
    brief.mode === 'restyle'
      ? '  · and what must NOT appear, which this mode needs stated outright'
      : '',
    '',
    brief.referenceRules || '',
    'Reference-role rules above take precedence over generic instructions to preserve source lighting or background. Never change the source motion to create a new hook or ending.',
    CONTRACT,
    brief.offerAlternatives ? 'Also include "alternatives": ["...", "..."] in that same JSON object: two complete alternative prompts, each at least 25 characters. Vary wording or visual emphasis only; keep the same reference roles, movement, timing, audio policy and user intent. These are for review, not extra generations.' : '',
  ].filter(Boolean).join('\n');
}

/** One piece's answer. */
export interface MotionPrompt {
  index: number;
  prompt: string;
  why: string;
  alternatives?: string[];
}

/**
 * Read one piece's reply.
 *
 * Throws rather than guessing. A prompt is what gets spent on a generation, so
 * a half-parsed one is worse than a clear failure — the caller can retry in the
 * same thread, which is what makes the retry cheap.
 */
export function readMotionPrompt(reply: string, index: number): MotionPrompt {
  const raw = String(reply || '');
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) {
    throw new Error(`Piece ${index}: the director replied with no JSON object.`);
  }

  let parsed: any;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    throw new Error(`Piece ${index}: the director's JSON could not be read.`);
  }

  const prompt = String(parsed?.prompt ?? '').trim();
  if (!prompt) throw new Error(`Piece ${index}: the director returned an empty prompt.`);
  /* Long enough to be a direction rather than an acknowledgement. Measured
     against the shortest usable prompt in the templates: anything under this
     is "OK" or "Understood", which reads as success and generates nothing. */
  if (prompt.length < 25) {
    throw new Error(`Piece ${index}: "${prompt}" is too short to be a prompt.`);
  }

  const alternatives = Array.isArray(parsed?.alternatives)
    ? [...new Set<string>(parsed.alternatives.filter((x: unknown): x is string => typeof x === 'string')
      .map((x: string) => x.trim()).filter((x: string) => x.length >= 25 && x !== prompt))].slice(0, 2) : [];
  return { index, prompt, why: String(parsed?.why ?? '').trim(), ...(alternatives.length ? { alternatives } : {}) };
}

/**
 * The prompt to fall back on when the director cannot be reached at all.
 *
 * Deliberately the plain template — the same sentence for every piece, which is
 * exactly what the director exists to improve on. It is here so a Flow outage
 * on the chat side does not cost the whole run, and the caller says out loud
 * that it used this.
 */
export function plainMotionPrompt(brief: MotionBrief, piece: MotionPiece): string {
  const m = MODE_INTENT[brief.mode];
  const parts = [m.googleWording];
  if (brief.wish) parts.push(brief.wish);
  if (piece.of > 1) {
    parts.push(
      `This is part ${piece.index} of ${piece.of} of one continuous shot — keep the `
      + 'subject identical across parts.',
    );
    /* Pointed at the footage rather than at invented values, for the same
       reason the director is told to: naming a look in words makes the parts
       agree with each other and disagree with the clip they came from. */
    parts.push(m.narrateMotion
      ? 'Keep the lighting and framing identical across parts.'
      : 'Match the lighting, grade and framing of the input video.');
  }
  return parts.join(' ');
}
