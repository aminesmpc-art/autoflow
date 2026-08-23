/**
 * The clipper's brain: which sixty seconds, and what the viewer looks at.
 *
 * ── Why this file does NOT ask for timestamps ──────────────────────────────
 *
 * Measured, 23 Aug 2026, against synthetic audio with ffprobe-exact ground
 * truth (see Clipping Pipeline v4 §2). Gemini locating a GIVEN phrase:
 *
 *      57s  0.57s      183s  1.23s      400s  3.12s
 *      60s  0.68s      289s  0.84s      728s  4.77s  ← and fabricated
 *     120s  0.65s
 *
 * At 728s every answer was early by exactly the mean — systematic drift, not
 * noise — and the gaps between its answers had a standard deviation of 0.000s
 * against a real 1.148s. It stopped measuring and emitted an arithmetic
 * sequence. That is the failure this file is built around: not imprecision,
 * but a confident, well-formed invention.
 *
 * So the window is chosen from TEXT ALONE. The model is never asked when
 * something happens in a twenty-minute file, because it cannot answer and
 * will not say so. It is asked which lines are the good ones; we already know
 * which chunk those lines came from, because we cut the chunks ourselves.
 * Only afterwards is one focused location ask made, inside one chunk — the
 * regime with numbers behind it.
 *
 * Two failures in that measurement run were the PROMPT's fault, and both are
 * defended against here:
 *
 *   · a prompt whose JSON example read `"start_seconds": 0.0` got 0.0 back
 *     nine times. Every example value in this file is a sentinel, and an
 *     answer carrying it is read as no answer at all. See LOCATE_SENTINEL.
 *
 *   · markers spaced evenly invited extrapolation, and a total failure came
 *     back looking like a 4.8s error. looksFabricated() is the runtime form
 *     of that lesson.
 */

import type { Problem } from './storyboard';
import { jsonCandidates, repairInnerQuotes } from './storyboard';

/* ------------------------------------------------------------------ */
/* The transcript                                                      */
/* ------------------------------------------------------------------ */

/**
 * One chunk of the source, as text.
 *
 * `start` and `end` are exact because WE cut the chunk — no model was
 * involved in producing them. That is the whole reason this shape exists
 * instead of a word-level timing array: every line inherits "somewhere
 * between 240 and 480 seconds" for free and for certain.
 */
export interface TranscriptChunk {
  index: number;
  start: number;
  end: number;
  text: string;
}

export interface Transcript {
  chunks: TranscriptChunk[];
  /** Duration of the whole source, seconds. */
  duration: number;
}

/** What the Clipper returns: the boundaries as QUOTED TEXT, never as times. */
export interface WindowPick {
  /** The opening line, copied from the transcript. */
  hookLine: string;
  /** The line the clip ends on, copied from the transcript. */
  closingLine: string;
  why?: string;
}

/**
 * A window once it has been found in the transcript.
 *
 * `chunk` is which chunk the hook sits in, which is what the location ask is
 * then pointed at. `estimatedSeconds` comes from counting words, not from
 * asking anyone.
 */
export interface LocatedWindow {
  pick: WindowPick;
  chunk: number;
  firstWord: number;
  lastWord: number;
  estimatedSeconds: number;
}

export type EditType = 'a-roll' | 'b-roll';

export interface Beat {
  n: number;
  start: number;
  end: number;
  edit: EditType;
  caption: string;
  stillPrompt?: string;
  motionPrompt?: string;
  /** What carries the single accent colour in this beat. */
  focus?: string;
}

/* ------------------------------------------------------------------ */
/* Limits                                                              */
/* ------------------------------------------------------------------ */

export const TARGET_SECONDS = 60;
export const MIN_CLIP_SECONDS = 30;
export const MAX_CLIP_SECONDS = 200;

/**
 * The ceiling on one generated graphic.
 *
 * Not a style choice. Omni Flash renders about ten seconds and Studio's own
 * VideoDuration type has no value above '10s', so a longer beat cannot be
 * built by any node this canvas can spawn. It would fail at generation time,
 * which is the expensive place to find out.
 */
export const MAX_BROLL_SECONDS = 10;

/**
 * How long the viewer may look at an unbroken talking head.
 *
 * Advisory, not blocking: the hook and the closing loop are deliberately
 * face-only, and a personal story sometimes earns a longer hold. Blocking on
 * taste is how a repair loop spends three rounds arguing.
 */
export const MAX_AROLL_RUN_SECONDS = 8;

/** Shorter than this is a cut, not a beat — nothing can be read in it. */
export const MIN_BEAT_SECONDS = 1.5;

/** Gaps and overlaps below this are rounding, not holes. */
const TILE_TOLERANCE = 0.35;

/**
 * Speaking rate used to estimate a span's duration from its word count.
 *
 * 2.5 words/second is about 150 wpm, ordinary conversational English. This
 * exists so the window's length can be checked WITHOUT asking anyone for a
 * timestamp — the one number in this file that would otherwise have to come
 * from the thing we just proved cannot supply it.
 */
export const WORDS_PER_SECOND = 2.5;

/** Generous, because the estimate is a sanity check and not a measurement. */
const RATE_SLACK_LOW = 0.55;
const RATE_SLACK_HIGH = 1.9;

/* ------------------------------------------------------------------ */
/* Text handling                                                       */
/* ------------------------------------------------------------------ */

const normalise = (s: string): string =>
  (s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

export const wordsOf = (s: string): string[] => normalise(s).split(' ').filter(Boolean);

const round = (n: number): number => Math.round(n * 100) / 100;

/** Seconds a stretch of text probably takes to say. */
export const estimateSeconds = (text: string): number =>
  wordsOf(text).length / WORDS_PER_SECOND;

interface FlatWord { word: string; chunk: number; }

/** Every word in the transcript, tagged with the chunk it came from. */
export function flatten(t: Transcript): FlatWord[] {
  const out: FlatWord[] = [];
  for (const c of [...t.chunks].sort((a, b) => a.index - b.index)) {
    for (const w of wordsOf(c.text)) out.push({ word: w, chunk: c.index });
  }
  return out;
}

/**
 * Where a quoted phrase sits in the transcript, or -1.
 *
 * Deliberately fuzzy. An exact sequence match fails the moment a model
 * retypes a quote with a contraction expanded or a filler word dropped, and
 * a repair round spent on that is a round wasted. Scoring the best window of
 * the right length tolerates that while still refusing a paraphrase, which is
 * the thing actually worth catching: a model that paraphrases the hook is
 * answering from an impression of the transcript rather than from the
 * transcript, and everything else it says about that passage is a guess too.
 */
export function findPhrase(
  words: FlatWord[],
  phrase: string,
  threshold = 0.7,
): number {
  const want = wordsOf(phrase);
  if (!want.length || want.length > words.length) return -1;

  const wanted = new Set(want);
  let bestAt = -1;
  let bestScore = 0;

  for (let i = 0; i + want.length <= words.length; i++) {
    let hits = 0;
    for (let k = 0; k < want.length; k++) {
      if (wanted.has(words[i + k].word)) hits++;
    }
    const score = hits / want.length;
    if (score > bestScore) { bestScore = score; bestAt = i; }
    if (bestScore === 1) break;
  }

  return bestScore >= threshold ? bestAt : -1;
}

/* ------------------------------------------------------------------ */
/* Ask 1 — the window, from text alone                                 */
/* ------------------------------------------------------------------ */

/**
 * Render the transcript for the window ask.
 *
 * Chunk ranges are shown, but only as coarse orientation — the reply is not
 * allowed to contain a number, so there is nothing here for a model to
 * extrapolate a rhythm from.
 */
export function renderTranscript(t: Transcript): string {
  return [...t.chunks]
    .sort((a, b) => a.index - b.index)
    .map((c) => `[${Math.round(c.start)}-${Math.round(c.end)}s]\n${c.text.trim()}`)
    .join('\n\n');
}

export function windowAsk(t: Transcript): string {
  const target = Math.round(TARGET_SECONDS * WORDS_PER_SECOND);
  return [
    'You are choosing one clip out of a long recording for TikTok, Reels and Shorts.',
    '',
    'Pick the single strongest CONTINUOUS stretch. It must satisfy all three:',
    '',
    '1. HOOK. Opens on a claim, a number, or a reframe that contradicts what the',
    '   viewer expects. Not a preamble, not "so anyway", not mid-sentence.',
    '2. CLIMB. Every sentence adds something. Concrete things — numbers, places,',
    '   names — because the next stage has to draw them.',
    '3. LOOP. The final line resolves the claim and lands somewhere that reads',
    '   naturally as the sentence before the hook, so a replay feels continuous.',
    '',
    `Aim for roughly ${target} words between the two lines — about ${TARGET_SECONDS} seconds of speech.`,
    '',
    'DO NOT give timestamps. Do not estimate times. Quote the two lines instead:',
    '',
    '{"hook_line": "...", "closing_line": "...", "why": "..."}',
    '',
    'Both lines must be copied from the transcript WORD FOR WORD. They are used to',
    'find the clip in the audio, so a paraphrase makes the clip unfindable.',
    'Reply with that JSON object and nothing else — no code fence, no preamble.',
    '',
    '--- TRANSCRIPT ---',
    renderTranscript(t),
  ].join('\n');
}

/** Accept an object, or the first JSON object inside a scraped reply. */
export function readObject(reply: unknown): Record<string, unknown> | null {
  if (reply && typeof reply === 'object' && !Array.isArray(reply)) {
    return reply as Record<string, unknown>;
  }
  if (typeof reply !== 'string') return null;
  for (const c of jsonCandidates(reply)) {
    for (const attempt of [c.trim(), repairInnerQuotes(c.trim())]) {
      try {
        const parsed = JSON.parse(attempt);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          return parsed as Record<string, unknown>;
        }
        /* A model answering with a one-element array is answering correctly
           in the wrong wrapper, and that is not worth a repair round. */
        if (Array.isArray(parsed) && parsed.length && typeof parsed[0] === 'object') {
          return parsed[0] as Record<string, unknown>;
        }
      } catch { /* next candidate */ }
    }
  }
  return null;
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

export function readWindow(reply: unknown): WindowPick | null {
  const o = readObject(reply);
  if (!o) return null;
  const hookLine = str(o.hook_line ?? o.hookLine ?? o.hook);
  const closingLine = str(o.closing_line ?? o.closingLine ?? o.closing ?? o.close);
  if (!hookLine || !closingLine) return null;
  return { hookLine, closingLine, why: str(o.why ?? o.reason) || undefined };
}

/**
 * Find the picked window in the transcript, and say what is wrong with it.
 *
 * Returns the located window when it is usable, so callers do not have to
 * search twice. Every problem here is one a schema check cannot find, because
 * the reply is always well-formed — the question is only ever whether it
 * agrees with the transcript we already have.
 */
export function locateWindow(
  pick: WindowPick,
  t: Transcript,
): { window: LocatedWindow | null; problems: Problem[] } {
  const problems: Problem[] = [];
  const p = (code: string, detail: string) => problems.push({ shot: 0, code, detail });

  const words = flatten(t);
  if (!words.length) {
    p('transcriptEmpty', 'The transcript has no text in it.');
    return { window: null, problems };
  }

  const hookAt = findPhrase(words, pick.hookLine);
  if (hookAt < 0) {
    p('hookMissing',
      `quotes an opening line that is not in the transcript: "${pick.hookLine}". `
      + 'Copy it word for word from the transcript.');
  }

  const closeAt = findPhrase(words, pick.closingLine);
  if (closeAt < 0) {
    p('closingMissing',
      `quotes a closing line that is not in the transcript: "${pick.closingLine}". `
      + 'Copy it word for word from the transcript.');
  }

  if (hookAt < 0 || closeAt < 0) return { window: null, problems };

  const closeEnd = closeAt + wordsOf(pick.closingLine).length;
  if (closeEnd <= hookAt) {
    p('windowOrder',
      'has its closing line before its opening line. The clip must run forwards.');
    return { window: null, problems };
  }

  /* Length, estimated from word count rather than asked for. The model is
     never given the chance to invent a duration. */
  const spanWords = closeEnd - hookAt;
  const estimatedSeconds = round(spanWords / WORDS_PER_SECOND);
  if (estimatedSeconds < MIN_CLIP_SECONDS * RATE_SLACK_LOW) {
    p('windowShort',
      `is only about ${estimatedSeconds}s of speech (${spanWords} words). `
      + `Choose a longer stretch — around ${TARGET_SECONDS}s.`);
  }
  if (estimatedSeconds > MAX_CLIP_SECONDS * RATE_SLACK_HIGH) {
    p('windowLong',
      `is about ${estimatedSeconds}s of speech (${spanWords} words), far past the `
      + `${MAX_CLIP_SECONDS}s maximum. Tighten it to around ${TARGET_SECONDS}s.`);
  }

  return {
    window: {
      pick,
      chunk: words[hookAt].chunk,
      firstWord: hookAt,
      lastWord: closeEnd - 1,
      estimatedSeconds,
    },
    problems,
  };
}

/* ------------------------------------------------------------------ */
/* Ask 2 — locate one phrase inside one chunk                          */
/* ------------------------------------------------------------------ */

/**
 * The example value in the location prompt.
 *
 * A prompt whose example read `"start_seconds": 0.0` got 0.0 back for every
 * phrase, and it took a second experiment to notice that the model had copied
 * the placeholder rather than answered. The example must therefore be a value
 * no real answer would land on exactly, so the echo is detectable.
 */
export const LOCATE_SENTINEL = 12.34;

export function locateAsk(phrase: string, chunkSeconds: number): string {
  return [
    `This audio clip is ${Math.round(chunkSeconds)} seconds long.`,
    '',
    `At what second does the speaker BEGIN saying this line?`,
    '',
    `  "${phrase}"`,
    '',
    'Locate it in the audio itself. Do not estimate from where you would expect it',
    'to fall, and do not assume it is evenly placed.',
    '',
    `Reply with JSON only, nothing else: {"start_seconds": ${LOCATE_SENTINEL}}`,
  ].join('\n');
}

const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};

/**
 * Read a located time back, or null when nothing was actually answered.
 *
 * The sentinel check is the measured lesson: an answer equal to the prompt's
 * own example is the model copying the shape, not reporting a position. Read
 * as no answer rather than as data, because treating it as data is how nine
 * zeroes once became a finding.
 */
export function readLocate(reply: unknown, chunkSeconds?: number): number | null {
  const o = readObject(reply);
  let v: number | null = null;

  if (o) {
    v = num(o.start_seconds ?? o.startSeconds ?? o.start ?? o.seconds);
  } else if (typeof reply === 'string') {
    /* "595" on its own line is a legitimate answer to this question. */
    const bare = reply.trim().match(/-?\d+(\.\d+)?/);
    if (bare) v = num(bare[0]);
  } else {
    v = num(reply);
  }

  if (v === null) return null;
  if (v === LOCATE_SENTINEL) return null;
  if (v < 0) return null;
  if (chunkSeconds !== undefined && v > chunkSeconds) return null;
  return v;
}

/**
 * Whether a set of timestamps was patterned rather than measured.
 *
 * The fingerprint, straight from the measurements: at twelve minutes the gaps
 * between Gemini's answers had a standard deviation of 0.000s against a real
 * 1.148s, and every working length tracked the true spacing closely (2.43 vs
 * 2.58, 9.12 vs 9.33, 25.38 vs 24.91). Perfectly even gaps are not what
 * measurement produces.
 *
 * Both conditions are required, and both are deliberately conservative: this
 * refuses work, so a false positive costs a re-ask, and firing on genuinely
 * regular content would be worse than missing an occasional fabrication.
 */
export function looksFabricated(times: number[]): boolean {
  if (times.length < 4) return false;
  const sorted = [...times].sort((a, b) => a - b);
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) gaps.push(sorted[i] - sorted[i - 1]);

  const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  if (mean <= 0) return false;
  const variance = gaps.reduce((a, g) => a + (g - mean) * (g - mean), 0) / gaps.length;
  const sd = Math.sqrt(variance);

  return sd < 0.3 && sd / mean < 0.02;
}

/* ------------------------------------------------------------------ */
/* Ask 3 — the beat map, on the cut clip                               */
/* ------------------------------------------------------------------ */

/** The look every still is drawn in. Stated once here, restated per beat. */
export interface ClipStyle {
  name: string;
  palette: string;
  accent: string;
  texture: string;
  motion: string;
}

export const VOX_PAPER: ClipStyle = {
  name: 'Vox paper collage',
  palette: 'cream paper (#F5F0E8) ground, charcoal slate (#3A3A3C) shapes and type',
  accent: 'exactly one bright orange (#FF6B35), on the single thing this beat is about',
  texture: 'torn paper edges, soft drop shadows as if the pieces lie on a desk, fine paper grain',
  motion: 'slow deliberate camera moves, pieces sliding and settling with weight',
};

/**
 * The directing turn, run on the CUT CLIP rather than on the transcript.
 *
 * Two reasons, and the second is the one that matters. A sixty-second clip is
 * the regime measured at 0.68s, the best available. And the model can hear
 * the delivery — where the speaker leans in, speeds up, pauses before the
 * punchline — which is exactly what a human editor uses to decide when to cut
 * away from a face, and which a transcript cannot carry.
 *
 * The still and the motion prompt are asked for separately on purpose: the
 * still locks the layout, the motion prompt only has to move it. One prompt
 * doing both is what lets the style drift between beats.
 */
export function beatAsk(clipSeconds: number, clipText: string, style: ClipStyle = VOX_PAPER): string {
  return [
    `You are directing the visual edit of a ${round(clipSeconds)}-second vertical (9:16) clip.`,
    '',
    'The viewer either sees the SPEAKER (a-roll) or sees a motion graphic covering the',
    'speaker (b-roll). Decide line by line, on this rule:',
    '',
    '  a-roll — the sentence carries emotion, opinion, or a personal story, or it is',
    '           the opening claim or the closing line. A face is what makes those land.',
    '  b-roll — the sentence names a number, a place, a quantity, a mechanism, or',
    '           anything abstract the viewer cannot picture.',
    '',
    `Never leave one face on screen longer than about ${MAX_AROLL_RUN_SECONDS} seconds unbroken.`,
    'Open on a-roll and close on a-roll.',
    '',
    `Every b-roll beat must be ${MAX_BROLL_SECONDS} seconds or shorter — that is the hard limit`,
    'of the generator. A longer visual idea becomes two consecutive b-roll beats.',
    '',
    `THE LOOK — every still is drawn in one style, "${style.name}":`,
    `  Palette: ${style.palette}`,
    `  Accent: ${style.accent}`,
    `  Texture: ${style.texture}`,
    `  Motion: ${style.motion}`,
    'Write the style into every still_prompt. The generator has no memory between',
    'beats, so a beat that does not restate the look will not match the ones either',
    'side of it.',
    '',
    'Do not write text, letters, numerals or labels into a still_prompt. Type is added',
    'afterwards, and a generator asked to draw words produces misspelt ones.',
    '',
    'BEATS must tile the whole clip: the first starts at 0, the last ends at',
    `${round(clipSeconds)}, and each one starts exactly where the last ended.`,
    `No gaps, no overlaps, nothing shorter than ${MIN_BEAT_SECONDS} seconds.`,
    '',
    'Reply with this JSON and nothing else — no code fence, no preamble:',
    '',
    '{"beats":[',
    `  {"n":1,"start":0,"end":${LOCATE_SENTINEL},"edit":"a-roll","caption":"exact words spoken here"},`,
    `  {"n":2,"start":${LOCATE_SENTINEL},"end":21.5,"edit":"b-roll","caption":"exact words spoken here",`,
    '   "still_prompt":"...","motion_prompt":"...","focus":"what the orange picks out"}',
    ']}',
    '',
    'Timestamps are seconds from the START OF THE CLIP, so the first beat starts at 0',
    `and the last ends at ${round(clipSeconds)}.`,
    '"caption" is the words actually spoken in that beat, copied from the transcript.',
    '',
    '--- CLIP TRANSCRIPT ---',
    clipText.trim(),
  ].join('\n');
}

const optStr = (v: unknown): string | undefined => {
  const s = typeof v === 'string' ? v.trim() : '';
  return s || undefined;
};

/** Read a beat map back. Unreadable beats are dropped, never guessed at. */
export function readBeats(reply: unknown): Beat[] {
  let list: unknown = reply;

  if (typeof reply === 'string') {
    let parsed: unknown = null;
    for (const c of jsonCandidates(reply)) {
      for (const attempt of [c.trim(), repairInnerQuotes(c.trim())]) {
        try {
          const v = JSON.parse(attempt);
          if (v && (Array.isArray(v) || typeof v === 'object')) { parsed = v; break; }
        } catch { /* next */ }
      }
      if (parsed) break;
    }
    if (!parsed) return [];
    list = parsed;
  }

  if (list && typeof list === 'object' && !Array.isArray(list)) {
    list = (list as Record<string, unknown>).beats;
  }
  if (!Array.isArray(list)) return [];

  const beats: Beat[] = [];
  list.forEach((raw, i) => {
    if (!raw || typeof raw !== 'object') return;
    const b = raw as Record<string, unknown>;
    const start = num(b.start ?? b.start_time ?? b.startTime);
    const end = num(b.end ?? b.end_time ?? b.endTime);
    if (start === null || end === null) return;

    /* 'B-Roll-Graphic', 'broll', 'B Roll' — the planning documents spell it
       four different ways and models copy whichever they saw. Anything that
       is not a-roll is treated as a graphic, because that is the safe
       reading: a graphic beat gets prompts written for it, so the worst case
       is an unused prompt. Guessing a-roll leaves a silent hole where a
       graphic should have been. */
    const editRaw = String(b.edit ?? b.edit_type ?? b.editType ?? '').trim().toLowerCase();
    const edit: EditType = /^a[\s_-]*roll/.test(editRaw) ? 'a-roll' : 'b-roll';

    beats.push({
      n: num(b.n ?? b.scene_index ?? b.sceneIndex) ?? i + 1,
      start,
      end,
      edit,
      caption: String(b.caption ?? b.text ?? '').trim(),
      stillPrompt: optStr(b.still_prompt ?? b.stillPrompt ?? b.still_image_prompt),
      motionPrompt: optStr(b.motion_prompt ?? b.motionPrompt),
      focus: optStr(b.focus ?? b.visual_focus ?? b.visualFocus),
    });
  });

  /* Sorted and renumbered so `n` is always the running order. A model that
     emits beats out of order, or numbers them from zero, must not leave the
     compositor splicing them in reply order. */
  return beats.sort((a, b) => a.start - b.start).map((b, i) => ({ ...b, n: i + 1 }));
}

/**
 * Check the beat map against the clip it describes.
 *
 * The tiling checks are the expensive ones to skip. A gap means the finished
 * video has a stretch with nothing assigned to it and an overlap means two
 * things claim the same second; neither is visible in a reply that otherwise
 * looks immaculate, and both surface at the very end of a run that has
 * already spent every generation.
 */
export function checkBeats(beats: Beat[], clipSeconds: number, clipText = ''): Problem[] {
  const problems: Problem[] = [];
  const p = (shot: number, code: string, detail: string) =>
    problems.push({ shot, code, detail });

  if (!beats.length) {
    p(0, 'beatsEmpty', 'No beats came back. Send the JSON object with a "beats" array.');
    return problems;
  }

  /* The fabrication fingerprint, applied to the beat boundaries themselves. */
  if (looksFabricated(beats.map((b) => b.start))) {
    p(0, 'beatsFabricated',
      'has beats spaced perfectly evenly, which is what a guessed answer looks like '
      + 'rather than a directed one. Place each beat where the sentence actually turns.');
  }

  beats.forEach((b, i) => {
    const n = i + 1;
    const length = b.end - b.start;

    if (!(b.end > b.start)) {
      p(n, 'beatOrder', `ends at ${round(b.end)} which is not after its start at ${round(b.start)}.`);
      return;
    }
    if (length < MIN_BEAT_SECONDS) {
      p(n, 'beatShort',
        `is only ${round(length)}s. Nothing reads that fast — merge it with the beat beside it.`);
    }
    if (b.edit === 'b-roll') {
      if (length > MAX_BROLL_SECONDS) {
        p(n, 'beatTooLong',
          `is ${round(length)}s of b-roll. The generator cannot make more than `
          + `${MAX_BROLL_SECONDS}s — split it into two consecutive b-roll beats.`);
      }
      if (!b.stillPrompt) {
        p(n, 'beatNoStill', 'is b-roll with no still_prompt. Describe the image to be drawn.');
      }
      if (!b.motionPrompt) {
        p(n, 'beatNoMotion', 'is b-roll with no motion_prompt. Describe how that image moves.');
      }
      /* A generator asked for letters produces misspelt letters, every time.
         Caught here because the still is the last place it is free to fix. */
      if (b.stillPrompt && /\b(text|caption|label|title|word|words|letter|letters|subtitle|typography)\b/i.test(b.stillPrompt)) {
        p(n, 'beatDrawnText',
          'asks for text inside the image. Type is added afterwards — describe the shapes only.');
      }
    }
    if (!b.caption) {
      p(n, 'beatNoCaption', 'has no caption. Copy the words spoken during it from the transcript.');
    }
  });

  /* --- the tiling --- */
  if (Math.abs(beats[0].start) > TILE_TOLERANCE) {
    p(1, 'beatsStart', `starts at ${round(beats[0].start)}. The first beat must start at 0.`);
  }
  const last = beats[beats.length - 1];
  if (Math.abs(last.end - clipSeconds) > TILE_TOLERANCE) {
    p(beats.length, 'beatsEnd',
      `ends at ${round(last.end)}, but the clip is ${round(clipSeconds)}s long. `
      + `The last beat must end at ${round(clipSeconds)}.`);
  }
  for (let i = 1; i < beats.length; i++) {
    const gap = beats[i].start - beats[i - 1].end;
    if (Math.abs(gap) <= TILE_TOLERANCE) continue;
    p(i + 1, gap > 0 ? 'beatsGap' : 'beatsOverlap',
      gap > 0
        ? `starts at ${round(beats[i].start)} but beat ${i} ended at ${round(beats[i - 1].end)}, `
          + `leaving ${round(gap)}s with nothing on screen.`
        : `starts at ${round(beats[i].start)}, before beat ${i} ended at ${round(beats[i - 1].end)}.`);
  }

  /* --- captions against the clip's own words --- */
  if (clipText.trim()) {
    const spoken = new Set(wordsOf(clipText));
    const flat = wordsOf(clipText);
    let searchFrom = 0;
    beats.forEach((b, i) => {
      if (!b.caption) return;
      const want = wordsOf(b.caption);
      if (!want.length) return;
      const hit = want.filter((w) => spoken.has(w)).length / want.length;
      if (hit < 0.5) {
        p(i + 1, 'beatCaptionDrift',
          `has a caption that is not in the clip: "${b.caption}". `
          + 'Copy the words from the transcript.');
        return;
      }
      /* Order, checked without any timing at all: beat 3's words must not
         appear in the transcript before beat 2's. A caption set that runs
         backwards means the beats were assigned to the wrong moments even
         when every individual caption is real. */
      const at = findPhrase(flat.map((w) => ({ word: w, chunk: 0 })), b.caption, 0.5);
      if (at >= 0) {
        if (at + 1 < searchFrom) {
          p(i + 1, 'beatCaptionOrder',
            'has a caption that is spoken earlier in the clip than the beat before it. '
            + 'The beats are in the wrong order, or assigned to the wrong moments.');
        }
        searchFrom = Math.max(searchFrom, at);
      }
    });
  }

  /* --- the retention rules, advisory --- */
  let run = 0;
  let runStart = 0;
  beats.forEach((b, i) => {
    if (b.edit === 'a-roll') {
      if (run === 0) runStart = i + 1;
      run += b.end - b.start;
      if (run > MAX_AROLL_RUN_SECONDS) {
        p(runStart, 'aRollRun',
          `begins ${round(run)}s of unbroken talking head. Attention goes after about `
          + `${MAX_AROLL_RUN_SECONDS}s — cover part of it with a graphic.`);
        run = 0;
      }
    } else {
      run = 0;
    }
  });

  if (beats[0].edit !== 'a-roll') {
    p(1, 'openNotFace', 'opens on a graphic. The first claim lands better on a face.');
  }
  if (last.edit !== 'a-roll') {
    p(beats.length, 'closeNotFace',
      'closes on a graphic. The loop back to the hook lands better on a face.');
  }
  if (!beats.some((b) => b.edit === 'b-roll')) {
    p(0, 'noGraphics', 'is entirely talking head. That is the clip this node exists to avoid.');
  }

  return problems;
}

/**
 * The problems worth refusing to spend on.
 *
 * The split is between "this cannot be built" and "this could be better". A
 * gap in the tiling cannot be built. Opening on a graphic is a preference,
 * and a director that had a reason for it should be allowed to keep it.
 */
export const CLIP_BLOCKING: ReadonlySet<string> = new Set([
  'transcriptEmpty', 'hookMissing', 'closingMissing', 'windowOrder',
  'windowShort', 'windowLong',
  'beatsEmpty', 'beatsFabricated', 'beatOrder', 'beatShort', 'beatTooLong',
  'beatNoStill', 'beatNoMotion', 'beatDrawnText', 'beatNoCaption',
  'beatCaptionDrift', 'beatCaptionOrder',
  'beatsStart', 'beatsEnd', 'beatsGap', 'beatsOverlap',
]);

export const blockingClipProblems = (problems: Problem[]): Problem[] =>
  problems.filter((p) => CLIP_BLOCKING.has(p.code));

/**
 * The follow-up turn.
 *
 * Names the beats that failed and asks for those back, rather than the whole
 * map again. Re-asking for everything is how one bad timestamp in beat 7
 * loses the six good beats before it.
 */
export function repairBeats(problems: Problem[], clipSeconds: number): string {
  const blocking = blockingClipProblems(problems);
  const use = blocking.length ? blocking : problems;
  const lines = [...use]
    .sort((a, b) => a.shot - b.shot)
    .map((p) => (p.shot ? `- Beat ${p.shot} ${p.detail}` : `- ${p.detail}`));

  const numbers = [...new Set(use.map((p) => p.shot).filter((n) => n > 0))]
    .sort((a, b) => a - b);

  return [
    'That beat map cannot be built as written:',
    '',
    ...lines,
    '',
    numbers.length
      ? `Send back the corrected beats — ${numbers.map((n) => `beat ${n}`).join(', ')} — in the same JSON shape.`
      : 'Send the corrected beat map in the same JSON shape.',
    `The beats must still tile the clip end to end, from 0 to ${round(clipSeconds)}.`,
    'JSON only, no code fence, no preamble.',
  ].join('\n');
}

/** The follow-up turn for a window that could not be found. */
export function repairWindow(problems: Problem[]): string {
  const use = blockingClipProblems(problems);
  return [
    'That choice cannot be used:',
    '',
    ...(use.length ? use : problems).map((p) => `- It ${p.detail}`),
    '',
    'Pick again, and copy both lines from the transcript word for word.',
    'JSON only, no code fence, no preamble.',
  ].join('\n');
}

/** One line per problem, in the order the beats run. */
export function describeClipProblems(problems: Problem[]): string[] {
  return [...problems]
    .sort((a, b) => a.shot - b.shot)
    .map((p) => (p.shot ? `Beat ${p.shot} ${p.detail}` : p.detail));
}

/* ------------------------------------------------------------------ */
/* Campaign clipping                                                   */
/* ------------------------------------------------------------------ */

/** A moment the audio suggested, for the model to judge. */
export interface MomentCandidate {
  n: number;
  start: number;
  end: number;
  /** What the sound was doing there, in words. */
  why: string;
  /** What was said during it. */
  text: string;
}

/**
 * Choosing a moment from a shortlist, for a paid clipping campaign.
 *
 * A different job from windowAsk, because the content is a different shape.
 * An explainer is chosen by argument — a hook, a climb, a line that closes the
 * loop. A chase has no thesis to circle back to: the best sixty seconds is a
 * PEAK, and the words during it are usually "go, go, go".
 *
 * So the audio makes the shortlist and the model judges it. That division
 * matters: asked to find a moment in a transcript, a model reaches for the
 * most quotable sentence, which in this content is narration — the calmest
 * part of the video.
 *
 * The reply shape is deliberately identical to windowAsk's, so the same
 * verbatim-quote checking applies. A campaign clip that opens mid-word is
 * exactly the "low quality post" a brief rejects.
 */
export function campaignAsk(candidates: MomentCandidate[], rules?: string): string {
  return [
    'You are picking ONE moment from a video to post as a short vertical clip.',
    'This is paid clipping work: the clip has to stand on its own in a feed,',
    'to someone who has never seen the video.',
    '',
    'What makes a good one:',
    '  · Something HAPPENS — a chase, a catch, a reveal, a reaction, a twist.',
    '  · It makes sense with no setup. Nobody watching knows the premise.',
    '  · It is entertaining on its own, not a fragment of a longer explanation.',
    '  · It does not need an outside caption to land.',
    '',
    'What to avoid:',
    '  · Narration or scene-setting, however well phrased.',
    '  · A moment that only pays off if you watched what came before.',
    '  · Anything that would misrepresent what actually happens in the video.',
    ...(rules ? ['', 'The campaign also requires:', rules] : []),
    '',
    'The moments below were shortlisted from the audio — where the recording',
    'gets loud, or busy, or suddenly stops. Judge them on what is SAID and what',
    'is happening. Pick the single best one.',
    '',
    ...candidates.flatMap((c) => [
      `--- MOMENT ${c.n}  (${Math.round(c.start)}s, ${c.why}) ---`,
      c.text,
      '',
    ]),
    'Reply with this JSON and nothing else — no code fence, no preamble:',
    '',
    '{"moment": 2, "hook_line": "...", "closing_line": "...", "why": "..."}',
    '',
    '"hook_line" is the first thing said in your clip and "closing_line" is the',
    'last. Both must be copied from the text above WORD FOR WORD — they are used',
    'to find the clip in the audio, so a paraphrase makes it unfindable.',
    'Start and end on a sentence boundary. A clip that opens mid-sentence is',
    'unusable however good the moment is.',
  ].join('\n');
}

/** Which shortlisted moment the reply chose, when it said. */
export function readChosenMoment(reply: unknown): number | null {
  const o = readObject(reply);
  if (!o) return null;
  const n = num(o.moment ?? o.n ?? o.candidate);
  return n !== null && n > 0 ? Math.round(n) : null;
}

/* ============================================================
   Surveying a whole video, rather than picking one moment from it.

   campaignAsk chooses the single best of four candidates. That is the right
   question when the answer is one clip. It is the wrong question when the
   answer is a workflow: paid clipping is paid per view, so ten posted clips
   beat one perfect one, and the model should be ranking a field rather than
   crowning a winner.

   The property that made campaignAsk work is kept exactly: the model NEVER
   invents a timestamp. The audio shortlists the candidates, the model ranks
   them and quotes their ends, and the seconds are found later from the sound.
   Widening the question does not widen what the model is trusted with — which
   matters, because a bigger question is precisely where the fabricated
   arithmetic sequence showed up when this was measured.
   ============================================================ */

export interface SurveyMoment {
  /** Which shortlisted candidate this is. */
  moment: number;
  /** 1 is the strongest. Ranked so a clipper can run the top few and stop. */
  rank: number;
  hookLine: string;
  closingLine: string;
  why: string;
  /** Explainer mode only: generated shots to cut in over the footage. */
  broll: Array<{ prompt: string; seconds: number }>;
}

export interface SurveyOptions {
  rules?: string;
  /** How many clips to come back with. */
  count?: number;
  /** Whether generated B-roll is allowed at all. Campaign briefs forbid it. */
  broll?: boolean;
}

/** What a survey asks for when nothing says otherwise. */
export const SURVEY_COUNT = 10;

export function surveyAsk(candidates: MomentCandidate[], options: SurveyOptions = {}): string {
  const count = Math.max(1, Math.min(candidates.length, options.count ?? SURVEY_COUNT));
  const broll = !!options.broll;

  return [
    `You are choosing the ${count} best moments from one video to post as short`,
    'vertical clips. This is paid clipping work, paid per view: every clip has to',
    'stand on its own in a feed, to someone who has never seen the video.',
    '',
    'What makes a good one:',
    '  · Something HAPPENS — a chase, a catch, a reveal, a reaction, a twist.',
    '  · It makes sense with no setup. Nobody watching knows the premise.',
    '  · It is entertaining on its own, not a fragment of a longer explanation.',
    '  · It does not need an outside caption to land.',
    '',
    'What to avoid:',
    '  · Narration or scene-setting, however well phrased.',
    '  · A moment that only pays off if you watched what came before.',
    '  · Anything that would misrepresent what actually happens in the video.',
    '  · Two clips covering the same event. They compete with each other.',
    ...(options.rules ? ['', 'The campaign also requires:', options.rules] : []),
    '',
    'The moments below were shortlisted from the audio — where the recording',
    'gets loud, or busy, or suddenly stops. Judge them on what is SAID and what',
    'is happening.',
    '',
    ...candidates.flatMap((c) => [
      `--- MOMENT ${c.n}  (${Math.round(c.start)}s, ${c.why}) ---`,
      c.text,
      '',
    ]),
    `Choose up to ${count}, best first. Reply with this JSON and nothing else —`,
    'no code fence, no preamble:',
    '',
    broll
      ? '{"clips":[{"moment":2,"hook_line":"...","closing_line":"...","why":"...",'
        + '"broll":[{"prompt":"a wide shot of ...","seconds":6}]}]}'
      : '{"clips":[{"moment":2,"hook_line":"...","closing_line":"...","why":"..."}]}',
    '',
    '"moment" is the number of one of the moments above. Use each at most once.',
    '"hook_line" is the first thing said in that clip and "closing_line" is the',
    'last. Both must be copied from the text above WORD FOR WORD — they are used',
    'to find the clip in the audio, so a paraphrase makes it unfindable.',
    'Start and end on a sentence boundary. A clip that opens mid-sentence is',
    'unusable however good the moment is.',
    ...(broll
      ? [
        '"broll" is optional: generated shots to cut in over the footage, as',
        'prompts for a video model. Leave it out where the real footage is',
        'stronger on its own, which is most of the time.',
      ]
      : [
        'Do not suggest any added footage, graphics or overlays. The clip is the',
        'creator\u2019s own footage and nothing else.',
      ]),
    '',
    `Fewer than ${count} is a fine answer if the video does not have ${count} moments`,
    'worth posting. Do not pad the list.',
  ].join('\n');
}

/**
 * The ranked clips a survey reply chose.
 *
 * Every moment number is checked against the shortlist it was offered, because
 * a moment the audio never proposed has no seconds behind it — the node built
 * from it would search the recording for a line that is not in it. Repeats are
 * dropped rather than repaired: two nodes cutting the same seconds is the one
 * outcome the ask explicitly told it to avoid, and keeping the first is what a
 * ranked list means.
 */
export function readSurvey(
  reply: unknown,
  candidateCount: number,
  /* Called once per entry thrown away, with a reason a person can act on.
     Dropping silently is how a run asked for ten clips, laid out eight, and
     offered nothing anywhere to say whether the model declined to pad the
     list or whether two of its answers were unusable. Those are opposite
     problems and they looked identical. */
  onDrop?: (reason: string) => void,
): SurveyMoment[] {
  const drop = (reason: string) => { if (onDrop) onDrop(reason); };
  const o = readObject(reply);
  const raw = o && Array.isArray(o.clips) ? o.clips
    : Array.isArray(reply) ? reply
      : null;
  if (!raw) return [];

  const out: SurveyMoment[] = [];
  const taken = new Set<number>();

  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') { drop('an entry was not an object'); continue; }
    const e = entry as Record<string, unknown>;

    const moment = num(e.moment ?? e.n ?? e.candidate);
    if (moment === null) { drop('a clip named no moment'); continue; }
    const n = Math.round(moment);
    if (n < 1 || n > candidateCount) {
      drop(`a clip named moment ${n}, which was not on the shortlist of ${candidateCount}`);
      continue;
    }
    if (taken.has(n)) { drop(`two clips both chose moment ${n}; kept the first`); continue; }

    const hookLine = String(e.hook_line ?? e.hookLine ?? '').trim();
    const closingLine = String(e.closing_line ?? e.closingLine ?? '').trim();
    if (!hookLine || !closingLine) {
      drop(`moment ${n} quoted no ${hookLine ? 'closing' : 'opening'} line to cut on`);
      continue;
    }

    const broll: Array<{ prompt: string; seconds: number }> = [];
    for (const b of Array.isArray(e.broll) ? e.broll : []) {
      if (!b || typeof b !== 'object') continue;
      const prompt = String((b as any).prompt ?? '').trim();
      if (!prompt) continue;
      /* Clamped to what the video platforms actually offer. A plan naming 30s
         compiles into a node whose dropdown has no such option. */
      const secs = num((b as any).seconds) ?? 6;
      broll.push({ prompt, seconds: Math.max(4, Math.min(10, Math.round(secs))) });
    }

    taken.add(n);
    out.push({
      moment: n,
      rank: out.length + 1,
      hookLine,
      closingLine,
      why: String(e.why ?? '').trim(),
      broll,
    });
  }

  return out;
}
