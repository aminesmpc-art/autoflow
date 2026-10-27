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

import { readJsonObject } from './storyboard';

/** What the user is asking Omni to do with the motion. */
export type MotionMode = 'move' | 'swap' | 'restyle';

/* With "Keep exact lip sync" on, a silent source still has mouths moving in
   it, and the user wants them copied — so the override forbids the sound, not
   the mouth movement the lip-sync block above it asks for. */
export function motionAudioPrompt(prompt: string, muted: boolean, lipSync = false): string {
  if (!muted) return prompt;
  return lipSync
    ? `${prompt}\nAUDIO OVERRIDE: The source video has no audio track. Do not generate speech, dialogue or singing; the mouth movements still follow the input video exactly, as above. Any other earlier audio instructions do not apply. Produce silent output.`
    : `${prompt}\nAUDIO OVERRIDE: The source video has no audio track. Perform only the visual edit. Do not generate speech, dialogue, singing, or lip-sync; any earlier audio instructions do not apply. Produce silent output.`;
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
  /** Last usable frame decoded from THIS generated output, never its poster. */
  endFrameUrl?: string;
  endFrameError?: string;
  /** Revision and parent revision make saved/retried chains lineage-safe. */
  continuityVersion?: string;
  continuityFrom?: string;
  /** Explicit permission to start a separate scene without the previous frame. */
  continuityReset?: boolean;
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
  /**
   * This piece is in Flow's library, under `filename`.
   *
   * Per piece, because a retry should redo only the pieces that are not. It
   * used to be one flag for the whole node, so one failed upload re-cut and
   * re-uploaded every piece — duplicating the ones Flow already had. Cleared
   * again when a generation finds the name missing from the library: the
   * library, not the upload's own report, is the proof.
   */
  uploaded?: boolean;
  /** Bytes handed to Flow, but not yet proven ready. Retry checks before uploading. */
  uploadPending?: { tabId?: number; projectUrl?: string };
}

export interface MotionBrief {
  mode: MotionMode;
  /** What the user typed. The subject of the whole job. */
  wish: string;
  /** Whether a character/subject still was wired in. */
  hasCharacter: boolean;
  /**
   * Whether a setting image was wired into P. It changes where the light comes
   * from — the setting image, not the input video — and adds the rule that the
   * setting is named, never described, so it stays the same place in every piece.
   */
  hasPlace?: boolean;
  referenceRules?: string;
  offerAlternatives?: boolean;
  /**
   * How many chosen people/items are replaced (motionTargets.ts). When set,
   * referenceRules names each image's target and pointer, and the one-character
   * wording below ("the provided character from this image") must not be asked
   * for: it would name one subject where there are several.
   */
  replacements?: number;
  /** "Keep exact lip sync": the mouths and the speech come from the footage, untouched. */
  lipSync?: boolean;
}

const REPLACEMENT_BRIEF = 'The chosen people and objects are listed in REPLACEMENTS above, and every piece replaces them the same way. '
  + 'One with an image: the image goes to every generation, so refer to it ONLY by its pointer, the same words every time. '
  + 'One described in words: use those words for it, the same way every time. Never describe a different subject.';
const REPLACEMENT_PIECE = '  · each replacement with an image named ONLY by its pointer ("the person from image 1", "the object from image 2") '
  + 'plus any words given for it, and nothing else about its appearance; each one without an image in the user\'s '
  + 'words for it. The same words as last time. Leave out a target that is not in this '
  + 'piece, and keep every other person and object as the footage shows them';

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
 *
 * ── `narrateSubject`, and why the same argument applies to the person ─────
 *
 * Count the words again in Google's wording for `move`. Thirteen, and not one
 * of them describes the movement — and not one of them describes the PERSON
 * either. "provided character from this image" is the whole of it.
 *
 * That second omission was missed here for as long as the first one was
 * honoured. The director was told the prompt is for "who is performing it and
 * what they look like", told the reference defines "identity, face, body and
 * clothing", and told to describe the subject "identically" on every piece. It
 * did all three:
 *
 *   "… The woman from the provided image, with short dark hair and clear
 *    glasses, wearing a black sleeveless top and black shorts with a white
 *    waistband, performing a dance. …"
 *
 * Every generation came back "This generation might violate our policies", and
 * uncharged — the input filter, before any frame was made. A face photo, plus
 * an identifiable person described down to the waistband of her shorts, plus a
 * dance clip, is what that filter is for. Repeating the description "identically
 * every time" then guaranteed that one refused prompt became all of them.
 *
 * The description was never carrying information. The image is attached to
 * every generation; the model can see her. It carried only risk, and the fix is
 * the one already used for the lighting two paragraphs down: point at the
 * reference instead of restating it.
 *
 * `restyle` is again the exception, and again genuinely: its subject is a
 * material rather than a person, and a material cannot be pointed at and left
 * undescribed.
 */
export const MODE_INTENT: Record<MotionMode, {
  title: string;
  googleWording: string;
  keeps: string;
  replaces: string;
  /** May the prompt describe the movement, or does that compete with the clip? */
  narrateMotion: boolean;
  /** May the prompt describe the SUBJECT, or does the reference image carry them? */
  narrateSubject: boolean;
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
    narrateSubject: false,
    writes: 'WHICH reference the performer comes from — pointed at, never described',
  },
  swap: {
    title: 'Swap the character',
    googleWording:
      'Swap characters or objects with a reference image — the new character will '
      + 'match your motion and dialogue seamlessly.',
    keeps: 'the motion AND the dialogue, so lip-sync survives',
    replaces: 'the character or object, everything else in the shot standing',
    narrateMotion: false,
    narrateSubject: false,
    writes: 'which reference the new character comes from, and what in the shot must stay exactly as it is',
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
    /* A material is not a person. It has to be described to be generated, and
       no filter is looking for "fluid reflective surface". */
    narrateSubject: true,
    writes: 'the movement as a shape, the material carrying it, and what must NOT appear',
  },
};

/** The reply contract, repeated on every turn because the model drifts off it. */
const CONTRACT =
  'Answer with ONE JSON object and nothing else: {"prompt":"…","why":"…"}. '
  + '"prompt" is what will be sent to the video model, verbatim. '
  + '"why" is one short sentence for the person reading the run log. '
  /* Gemini quoted an on-screen caption with straight quotes, which end a JSON
     string, and a reply right in every other way was thrown away. Curly
     quotes are quotation marks to the video model and plain characters to the
     parser; readMotionPrompt repairs straight ones anyway. */
  + 'Inside the text, quote any words or on-screen text with curly quotes “like this” — '
  + 'never straight double quotes, which break the JSON.';

/**
 * How a setting is named when a setting image is attached: the same words in
 * every piece, and never a description. Each piece is generated on its own,
 * so a place put into words is a place each piece re-imagines.
 */
export const SETTING_POINTER = 'the provided setting image';
/** The phrase the director repeats in every prompt, the light included. */
const SETTING_PHRASE = `in ${SETTING_POINTER}, lit by its light`;

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
    `It keeps ${m.keeps}. It replaces ${m.replaces}.`
    /* Said here because swap's "everything else in the shot standing" would
       otherwise keep the old place. */
    + (brief.hasPlace
      ? ' A setting image is attached as well, so the place is replaced too: it comes from '
        + 'that image, not from the video.'
      : ''),
    '',
    `WHAT THE USER ASKED FOR: ${brief.wish || '(nothing beyond the mode itself)'}`,
    brief.referenceRules || '',
    brief.replacements ? REPLACEMENT_BRIEF : brief.hasCharacter
      ? 'A character/subject still is attached, and it goes to every generation. Every '
        + 'piece uses that same still, '
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
        + 'it. Do not name the action either — not "a dance", not "a workout", not the '
        + 'exercise. A name is a paraphrase too, and a wrong or rough one pulls the model '
        + 'toward the word instead of the footage. Say only that the motion comes from '
        + 'the input video; never list the steps, the beats or the body parts, and never '
        + 'name a camera move or a framing, which come from the video too.',
    '',
    /* The other half of the same rule. Not narrating the motion keeps the
       director from competing with it; this keeps it from CHANGING it — the
       commonest way a prompt made the output drift from the source. */
    'THE MOTION IS FIXED. Each piece\'s footage decides every movement, its order, its '
    + 'speed and its timing, and the video model is told to follow it frame for frame. '
    + 'Never write anything that would change it: no new poses, moves, gestures or endings, '
    + 'nothing faster, slower, smoother, bigger or more dramatic, no slow motion. If what '
    + 'the user asked for would change the movement, apply it to everything else — the '
    /* Not into an attached setting: that would re-describe it piece by piece. */
    + `character, the look${brief.hasPlace ? '' : ', the setting'} — and leave the movement `
    + 'as the footage has it.',
    '',
    /* The same rule for the mouths, when the user asked for it by name. The
       video model gets its own LIP SYNC block; this keeps the director's words,
       which come first in that prompt, from asking for anything it forbids. */
    ...(brief.lipSync
      ? ['EXACT LIP SYNC IS ON. Every mouth in the footage must move exactly as it does there, in '
        + 'time with the speech. Never write anything about mouths, speaking, the words or the '
        + 'voice, and never ask for new dialogue, a different line or different timing: the '
        + 'video model is told to copy them from the footage.', '']
      : []),
    /* The movement rule's twin, and the one that was missing while every
       prompt was coming back refused. Same argument, different carrier: the
       reference image holds the person, so a description of them competes with
       it — and unlike the movement case, it also gets the generation rejected
       before a single frame is made. */
    m.narrateSubject
      ? ''
      : 'DO NOT DESCRIBE THE SUBJECT. The reference image is attached to every '
        + 'generation and the model can see who it is looking at — the hair, the face, '
        + 'the build, the clothes. Writing them out hands the model two versions of the '
        + 'same person, and it blends them, so the result resembles your sentence rather '
        + 'than the photograph. It is also the single most common reason a generation '
        + 'comes back refused: an identifiable person described in text, sitting next to '
        + 'a photo of them, reads to the safety filter as a likeness request, and the '
        + 'whole prompt is rejected before anything is made. Write "the provided '
        + 'character from this image" and stop there. No hair, no face, no skin, no '
        + 'build, no age, no clothing — not once, and not in passing.',
    '',
    /* The setting's twin of the subject rule. Every piece is generated on its
       own, so a setting put into words is a setting re-imagined per piece —
       which is how a new place came out different from clip to clip. And with
       a setting attached, the "match the input video's lighting" rule below
       for keeping the original place is the wrong one: it was given anyway,
       beside "use the place's light", and each piece settled the contradiction
       its own way. Spread rather than '' so a job with no setting reads
       exactly as it did. */
    ...(brief.hasPlace ? [
      'DO NOT DESCRIBE THE SETTING. The setting image is attached to every generation, '
      + 'and it IS the place: its layout, its objects, its colours, its light. Put it into '
      + 'words and each piece, generated on its own, re-imagines it slightly differently — '
      + 'which is exactly how a new setting drifts from clip to clip. Write '
      + `"${SETTING_POINTER}" and stop there, in the same words in every prompt. Its light `
      + 'and colour come from that image; only the framing and the camera come from the '
      + 'video. Never write "match the lighting of the input video", "keep the environment" '
      + 'or "keep the background" while a setting image is attached. If the user asked for '
      + 'a change to the place itself — night, rain, another colour — write that change, in '
      + 'the same words in every prompt, and nothing else about it.',
      '',
    ] : []),
    `WHAT THE PROMPT IS FOR: ${m.writes}.`,
    '',
    `I will show you the ${pieces} pieces one at a time, in order. For each one you `
    + 'write the prompt for THAT piece only.',
    '',
    'Three things to hold across all of them, because each piece is generated '
    + 'independently and drift between them is the main way this fails:',
    /* "Described the same way every time" is right for a material and wrong
       for a person: it takes one refused description and makes it every
       piece's description. Both failing generations carried the same thirty
       words about the same woman. */
    m.narrateSubject
      ? '  1. The same subject, described the same way every time.'
      : '  1. The same subject, REFERRED TO the same way every time — "the provided '
        + 'character from this image", word for word. Not described the same way. Not '
        + 'described at all.',
    /* With a setting attached, the light belongs to it — pointing at the input
       video's lighting here would hand every piece the contradiction again. */
    brief.hasPlace
      ? (m.narrateMotion
        ? '  2. The same look — the material, the grade, the lens feel — named explicitly in '
          + `each prompt, and the same place: "${SETTING_PHRASE}", word for word.`
        : `  2. The same setting and light — "${SETTING_PHRASE}", word for word in each `
          + 'prompt. With a new setting, light and colour come from that image; only the '
          + 'framing comes from the input video.')
      : m.narrateMotion
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
 * goes with it. It carries the piece's position — information the model
 * cannot get from the footage — for continuity, and for nothing else.
 *
 * It used to say more: the opening piece "carries the hook — whatever makes
 * someone stay", the final one "has to land rather than trail off". Both are
 * invitations to change the motion — a punchier start, a bigger finish — and
 * the same turn then told the director never to change the motion. The
 * footage decides how a piece opens and how it ends.
 */
export function motionPieceAsk(brief: MotionBrief, piece: MotionPiece): string {
  const m = MODE_INTENT[brief.mode];
  const where = piece.index === 1
    ? 'This is the OPENING piece.'
    : piece.index === piece.of
      ? 'This is the FINAL piece.'
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
      /* Not even named. A director told it could label the action wrote
         "a dance" — and a label that is wrong for a workout pulls the output
         toward the word instead of the footage. */
      : '  · NOT the movement, and no name for it either ("a dance", "push-ups"). The '
        + 'clip carries it; write only that the motion comes from the input video',
    brief.replacements ? REPLACEMENT_PIECE : brief.hasCharacter
      ? (m.narrateSubject
        ? '  · the provided image as the subject, described identically to last time'
        : '  · the subject named ONLY as "the provided character from this image", the '
          + 'same words as last time — and nothing about their hair, face, build, age or '
          + 'clothing. The image goes with this clip; the model can see them')
      : '  · the subject as it appears in the footage — name it in a few words, and do '
        + 'not describe a person\'s appearance',
    brief.hasPlace
      /* restyle still names its material on every piece; the light is the setting's. */
      ? (m.narrateMotion
        ? '  · the material\'s look, named again in full — the model has no memory of the '
          + 'other pieces. The light is the setting image\'s, not yours to name'
        : '')
      : m.narrateMotion
        ? '  · the look, named again in full — the model has no memory of the other pieces'
        : '  · "match the lighting, grade and framing of the input video" — do not invent '
          + 'lighting or a camera move, both of those come from the clip',
    brief.hasPlace
      ? `  · the setting ONLY as "${SETTING_PHRASE}" — the same words as last time, and `
        + 'nothing about what is in it. A change the user asked for to the place goes in the '
        + 'same words as last time too. Not "match the lighting of the input video": with a '
        + 'new setting, only the framing and the camera come from the clip'
      : '',
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
    'Reference-role rules above take precedence over generic instructions to preserve source lighting or background.',
    'The footage fixes this piece\'s motion — every movement, its order, its speed and its timing. '
    + 'Write nothing that would add, cut, re-time or change any of it.',
    CONTRACT,
    brief.offerAlternatives ? 'Also include "alternatives": ["...", "..."] in that same JSON object: two complete alternative prompts, each at least 25 characters. Vary wording or visual emphasis only; keep the same reference roles, movement, timing, audio policy and user intent. These are for review, not extra generations.' : '',
  ].filter(Boolean).join('\n');
}

/**
 * The one corrective turn, when the director described the person anyway.
 *
 * ── Why this is worth a whole extra turn ──────────────────────────────────
 *
 * The instruction not to describe the subject is now said three times — in the
 * brief, in the prohibition beside it, and in the bullets on every piece — and
 * a model that has just watched a video of a person will still sometimes write
 * down what she looks like. It is the most natural sentence in the world to
 * write, which is exactly why three prohibitions do not reliably stop it.
 *
 * What it costs to let one through is a refused generation: the prompt goes to
 * Omni, comes back "This generation might violate our policies", and the row
 * has to be retried by hand. What it costs to catch it is one message in a
 * conversation that is already open, with no video attached and nothing
 * generated. Those are not close.
 *
 * The offending words are quoted back deliberately. "Your prompt describes the
 * subject" is an opinion the model can disagree with; "you wrote sleeveless,
 * shorts, waistband" is a fact it can act on.
 */
export function motionSubjectRedoAsk(piece: MotionPiece, terms: string[], hasPlace = false): string {
  /* With a setting attached, "keep the environment and the input video's
     lighting" would undo the setting rule in the very turn that rewrites the
     prompt. */
  const rest = hasPlace
    ? `the action named in a few words, and "${SETTING_PHRASE}".`
    : 'the action named in a few words, the environment, and the instruction to match '
      + 'the lighting, grade and framing of the input video.';
  return [
    `STOP — do not generate. The prompt you just wrote for piece ${piece.index} describes `
    + `what the subject looks like. These words are the problem: ${terms.join(', ')}.`,
    '',
    'The character image is attached to the generation. The model can see her hair, her '
    + 'face and her clothes without being told, so those words add nothing — and an '
    + 'identifiable person described in text beside a photo of them is read as a likeness '
    + 'request and refused outright. A refused prompt produces no video at all.',
    '',
    'Write the same prompt again with every physical description removed. The subject is '
    + '"the provided character from this image" and nothing more — no hair, no face, '
    + 'no skin, no build, no age, no clothing. Keep everything else exactly as you had '
    + `it: ${rest}`,
    '',
    CONTRACT,
  ].join('\n');
}

/**
 * What a Motion run still has to do, piece by piece.
 *
 * Each piece passes three steps — a prompt, a place in Flow's library, a
 * clip — and a retry resumes every piece at the first one it has not passed.
 * Cutting is not a step of its own: a piece is cut only when a later step
 * still needs its footage (the director watches it; the upload sends it).
 *
 *   onlyPiece       "Retry piece" — every rule is scoped to that piece
 *   legacyUploaded  rows written before `uploaded` was per piece fall back to
 *                   the old node-wide flag
 *
 * Pure, so the rules are tested against rows rather than against the source
 * of the runner that applies them.
 */
export function motionWork(opts: { onlyPiece?: number; throughPiece?: number; legacyUploaded?: boolean } = {}) {
  const inScope = (r: MotionPieceRow) => !opts.onlyPiece || (r.index >= opts.onlyPiece && r.index <= (opts.throughPiece || opts.onlyPiece));
  const uploaded = (r: MotionPieceRow) => r.uploaded ?? (opts.legacyUploaded === true);
  const needsPrompt = (r: MotionPieceRow) => inScope(r) && !String(r.prompt || '').trim();
  /* A piece already made needs nothing from Flow's library any more. */
  const needsUpload = (r: MotionPieceRow) => inScope(r) && r.status !== 'done' && !uploaded(r);
  const needsCut = (r: MotionPieceRow) => needsPrompt(r) || (needsUpload(r) && !r.uploadPending);
  return { uploaded, needsPrompt, needsUpload, needsCut };
}

/** A file handed to the chooser is not yet a usable Flow ingredient. */
/**
 * The shorter side a Motion piece is cut at, in pixels.
 *
 * The source's own size was used, so a 4K phone clip went to Flow as 4K —
 * several times the bytes to upload and a processing wait Flow could run past
 * minutes on, for a generation made at 720p. Omni reads the motion from the
 * frames; 1080 keeps every movement and pose legible for it.
 */
export const MOTION_CUT_SHORT_SIDE = 1080;

export function recordMotionUpload(row: MotionPieceRow, reply: {
  ok?: boolean; confirmed?: boolean; uploadState?: string; names?: string[];
  tabId?: number; projectUrl?: string;
} | undefined): boolean {
  const actual = String(reply?.names?.[0] || '').trim();
  if (actual && !/[\\/]/.test(actual)) row.filename = actual;
  row.uploaded = reply?.ok === true && reply.confirmed === true;
  row.uploadPending = !row.uploaded && (reply?.uploadState === 'pending' || reply?.ok === true)
    ? { tabId: reply.tabId, projectUrl: reply.projectUrl } : undefined;
  return row.uploaded;
}

/**
 * The opening turn's addition when a director pass is RESUMED.
 *
 * The director used to be all or nothing: failing on piece two threw away
 * piece one's prompt with it, and a retry never asked again. Now the prompts
 * already written are kept, and a retry asks only for the missing ones — in a
 * new conversation, because the old one is gone (Gemini deletes its own). So
 * the new one is shown what the old one wrote, which is what lets a piece in
 * the middle still start where its neighbour ends.
 */
export function motionResumeNote(written: Array<{ index: number; prompt: string }>, missing: number[]): string {
  return [
    'CONTINUING AN EARLIER SESSION. These prompts were already written for these same',
    'pieces of this same video. They stand as they are — do not rewrite them:',
    '',
    ...written.map((w) => `  Piece ${w.index}: ${w.prompt}`),
    '',
    `You will be shown only the piece${missing.length === 1 ? '' : 's'} still missing a prompt: `
    + `${missing.join(', ')}. Write each so it continues from the piece before it and leads into `
    + 'the piece after it, exactly as if all of them had been written in one pass.',
  ].join('\n');
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
    /* Says WHAT was read. Reported 2026-10-19 with the JSON reply sitting on
       the Gemini tab while this said there was none: the text the adapter
       handed back was something else — an earlier turn, or half an answer —
       and without it the banner could not say which. */
    const seen = raw.replace(/\s+/g, ' ').trim();
    throw new Error(`Piece ${index}: the director replied with no JSON object. `
      + (seen ? `What was read: "${seen.length > 140 ? `${seen.slice(0, 140)}…` : seen}"` : 'The reply read was empty.'));
  }

  /* The storyboard's reader: plain JSON first, then with the straight quotes
     inside a value escaped. Gemini wrote
       {"prompt":"… Translate the on-screen text to English: "I scolded him and he got mad 😨".", …}
     — every field right, the caption quoted the way a person would — and the
     director stopped the run on two characters. A retry would have been asked
     the same question and answered it the same way. */
  const parsed: any = readJsonObject(raw);
  if (!parsed) {
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
    parts.push(brief.hasPlace
      ? `Keep the setting identical across parts: ${SETTING_PHRASE}, with the framing of the input video.`
      : m.narrateMotion
        ? 'Keep the lighting and framing identical across parts.'
        : 'Match the lighting, grade and framing of the input video.');
  }
  return parts.join(' ');
}
