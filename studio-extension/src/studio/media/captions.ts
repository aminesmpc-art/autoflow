/**
 * Burned-in captions, from timings that were already measured.
 *
 * ── Why they are not optional ─────────────────────────────────────────────
 *
 * About 85% of short-form views happen with the sound off. A clip without
 * captions is a clip most of its audience cannot follow, whatever it says. Of
 * everything that moves retention, this is the cheapest: the words and their
 * seconds come back with the reading, so nothing here costs a model call, a
 * round trip, or a second of anyone's time.
 *
 * ── How much they move is a choice ────────────────────────────────────────
 *
 * This shipped with one plain style, on the reasoning that animation cheapens
 * serious content. That reasoning holds — and it was still the wrong thing to
 * decide for everybody, because the word-by-word highlight is the most used
 * style on high-performing explainer content and the numbers behind it are not
 * subtle. So there are presets and the clipper picks: a campaign clip of
 * someone else's footage can stay plain, an explainer can shout. See
 * CaptionPreset below.
 *
 * ── Where they sit ────────────────────────────────────────────────────────
 *
 * Not at the bottom. TikTok, Reels and Shorts all paint their own furniture
 * over the lower fifth of the frame — the caption, the handle, the sound name,
 * the buttons — so text placed there is covered on the one screen it exists
 * for. These sit above that band, and the band is left empty.
 */

export interface CaptionWord {
  text: string;
  startSec: number;
  endSec: number;
}

export interface CaptionCue {
  /** Seconds from the START OF THE CLIP, not of the source video. */
  startSec: number;
  endSec: number;
  text: string;
  /* When each word inside the cue is spoken, for the styles that light one up
     at a time. Weighted by characters across the cue's own span — the same
     approximation the cue boundaries use, and defensible for the same reason:
     a cue is a second or so long, so the error inside it is a fraction of a
     second, and a highlight tolerates that where a CUT POINT does not.

     Optional because it is genuinely absent sometimes: a cut node laid out
     before word spans existed carries cues without them, and drawCaption falls
     back to splitting the line rather than drawing nothing. */
  words?: CaptionWord[];
}

/** A phrase with its seconds, as the reading returns them. */
export interface TimedPhrase {
  start: number;
  end: number;
  text: string;
}

/* How much text may be on screen at once.
   Short cues read as punchy; long ones read as a subtitle track and pull the
   eye away from the face. Four words is the shape most short-form editors
   settle on, with a character cap so four long words do not overflow. */
export const MAX_WORDS_PER_CUE = 4;
export const MAX_CHARS_PER_CUE = 26;

/* A cue shorter than this is a flicker. Where the arithmetic produces one,
   it is held longer and the next cue starts late rather than both being
   unreadable. */
const MIN_CUE_SEC = 0.4;


/** Divide a cue's span between its words, by characters. */
function spanWords(words: string[], startSec: number, endSec: number): CaptionWord[] {
  const span = Math.max(endSec - startSec, 0);
  const weights = words.map((w) => w.length);
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  let at = startSec;
  return words.map((text, i) => {
    const end = i === words.length - 1 ? endSec : at + (weights[i] / total) * span;
    const word = { text, startSec: at, endSec: end };
    at = end;
    return word;
  });
}

/**
 * Split a phrase into cues, timed proportionally across it.
 *
 * Proportional is an approximation, and a defensible one: a phrase is a second
 * or two long, so the error inside it is a fraction of a second, and a caption
 * is forgiving of that in a way a CUT POINT is not. This is why the same trick
 * is refused for finding clip boundaries — there, being half a second out
 * opens the clip mid-word.
 */
export function cuesFromPhrase(phrase: TimedPhrase): CaptionCue[] {
  const words = (phrase.text || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];

  const span = phrase.end - phrase.start;
  if (!(span > 0)) return [];

  /* Grouped by words AND by characters, so "extraordinarily" does not share a
     line with three more of its kind. */
  const groups: string[][] = [];
  let current: string[] = [];
  let chars = 0;
  for (const word of words) {
    const wouldBe = chars + word.length + (current.length ? 1 : 0);
    if (current.length >= MAX_WORDS_PER_CUE || (current.length && wouldBe > MAX_CHARS_PER_CUE)) {
      groups.push(current);
      current = [];
      chars = 0;
    }
    current.push(word);
    chars += word.length + (current.length > 1 ? 1 : 0);
  }
  if (current.length) groups.push(current);

  /* Weighted by characters rather than by word count: "I am" and
     "extraordinary circumstances" do not take the same time to say, and
     splitting the span evenly would run the short one long and clip the
     long one short. */
  const weights = groups.map((g) => g.join(' ').length);
  const total = weights.reduce((a, b) => a + b, 0) || 1;

  const cues: CaptionCue[] = [];
  let at = phrase.start;
  groups.forEach((group, i) => {
    const share = (weights[i] / total) * span;
    const end = i === groups.length - 1 ? phrase.end : at + share;
    cues.push({ startSec: at, endSec: end, text: group.join(' '), words: spanWords(group, at, end) });
    at = end;
  });

  return cues;
}

/**
 * The cues for one clip, in the clip's own timeline.
 *
 * Phrases are clipped to the cut rather than dropped when they straddle it: a
 * clip that opens mid-sentence still shows the part of that sentence it
 * contains, which is what a viewer hears.
 */
export function cuesForClip(
  phrases: TimedPhrase[],
  clipStartSec: number,
  clipEndSec: number,
): CaptionCue[] {
  const out: CaptionCue[] = [];

  for (const phrase of phrases) {
    if (phrase.end <= clipStartSec || phrase.start >= clipEndSec) continue;
    for (const cue of cuesFromPhrase(phrase)) {
      const start = Math.max(cue.startSec, clipStartSec) - clipStartSec;
      const end = Math.min(cue.endSec, clipEndSec) - clipStartSec;
      if (end - start < 0.08) continue;                 // nothing readable left
      /* Word spans rebased with the cue. Left in the video's timeline they
         would never match the playhead and nothing would ever highlight. */
      const shift = cue.startSec - start;
      out.push({
        startSec: start,
        endSec: end,
        text: cue.text,
        words: (cue.words || []).map((w) => ({
          text: w.text,
          startSec: w.startSec - shift,
          endSec: w.endSec - shift,
        })),
      });
    }
  }

  out.sort((a, b) => a.startSec - b.startSec);

  const clipLength = clipEndSec - clipStartSec;

  /* Hold a very short cue longer, but ONLY into time nothing else wants.
   *
   * This used to run after the overlap trim below and take the minimum
   * unconditionally, which put the previous cue back on top of the next one:
   *
   *     so   [0    -> 0.25]  became  [0    -> 0.40]
   *     then [0.25 -> 0.50]  became  [0.25 -> 0.65]
   *
   * and cueAt returns the first cue that matches, so at 0.30s the screen said
   * "so" while "then" was being spoken. A whole word behind, on exactly the
   * fast speech where the words are shortest. That is the intermittent timing
   * fault — it fires only when a cue is under MIN_CUE_SEC, so most lines look
   * perfect and some lag.
   *
   * A brief flicker of the right words beats a longer look at the wrong ones,
   * so where there is no room the cue simply stays short. */
  for (let i = 0; i < out.length; i++) {
    const ceiling = i + 1 < out.length ? out[i + 1].startSec : clipLength;
    const wanted = out[i].startSec + MIN_CUE_SEC;
    out[i].endSec = Math.max(out[i].endSec, Math.min(wanted, ceiling));
  }

  /* Two cues on screen at once is a rendering bug, not a style. Kept after the
     hold above rather than before it, so nothing can reintroduce an overlap
     once this has run. */
  for (let i = 0; i < out.length - 1; i++) {
    if (out[i].endSec > out[i + 1].startSec) out[i].endSec = out[i + 1].startSec;
  }

  return out.filter((c) => c.endSec > c.startSec);
}

/** Which cue is on screen at a given second, or null. */
export function cueAt(cues: CaptionCue[], t: number): CaptionCue | null {
  for (const cue of cues) {
    if (t >= cue.startSec && t < cue.endSec) return cue;
  }
  return null;
}

/**
 * How the words look.
 *
 * ── Why there is a choice at all ──────────────────────────────────────────
 *
 * This started with one style and a note saying animation cheapens serious
 * content. That is still true, and it is still the default — but it was the
 * wrong thing to decide on the user's behalf, because what actually performs
 * is measured and it is not subtle:
 *
 *   · captioned clips take about 40% more views than uncaptioned ones, and
 *     viewers are around 80% more likely to watch one to the end
 *   · the word-by-word highlight is the most used style on high-performing
 *     explainer content: each word lighting up is a micro-event, and the
 *     colour moving left to right pulls the eye along the line
 *
 * So the styles are presets and the clipper picks. A campaign clip of someone
 * else's footage can stay plain; an explainer can shout.
 *
 * ── The highlight is estimated, and that is fine here ─────────────────────
 *
 * Word timings are divided across a cue by characters, exactly as cues are
 * divided across a phrase. A cue is a second or so long, so a word lands
 * within a fraction of a second of when it is said. That tolerance is real for
 * a highlight and NOT real for a cut point, which is why the same arithmetic
 * is refused there.
 */
export type CaptionPreset = 'clean' | 'bold' | 'karaoke' | 'minimal';

export interface CaptionStyle {
  preset?: CaptionPreset;
  /** Fraction of frame height the text block is centred on. */
  y?: number;
  /** Fraction of frame height for the cap height of the type. */
  size?: number;
  uppercase?: boolean;
  color?: string;
  strokeColor?: string;
  /** The word being spoken, for the presets that light one up. */
  activeColor?: string;
  /** Words not being spoken, where the preset dims them. */
  restColor?: string;
}

interface ResolvedStyle {
  y: number;
  size: number;
  uppercase: boolean;
  color: string;
  strokeColor: string;
  activeColor: string;
  restColor: string;
  highlight: boolean;
  weight: number;
}

/* Above the platform's own furniture. TikTok, Reels and Shorts all paint the
   caption, handle and buttons over roughly the lower fifth; 0.72 puts the text
   clear of it while staying in the lower half where the eye expects it. */
const DEFAULT_Y = 0.72;

/* Of frame height. On a 1080-tall clip this is about 52px of cap height,
   which is legible on a phone at arm's length without covering the face. */
const DEFAULT_SIZE = 0.048;

const PRESETS: Record<CaptionPreset, Omit<ResolvedStyle, 'y'>> = {
  /* What shipped first, and still the default. One thing moves: a cue appears,
     holds, is replaced. Nothing to distract from footage that is not yours. */
  clean: {
    size: DEFAULT_SIZE, uppercase: true, weight: 800,
    color: '#ffffff', strokeColor: 'rgba(0,0,0,0.92)',
    activeColor: '#ffffff', restColor: '#ffffff', highlight: false,
  },

  /* The one people mean when they say "those captions". Large, uppercase, very
     heavy, with the spoken word in amber. Bright yellow on white is the
     highest-contrast pairing that survives a stroke at this weight. */
  bold: {
    size: 0.058, uppercase: true, weight: 900,
    color: '#ffffff', strokeColor: 'rgba(0,0,0,0.95)',
    activeColor: '#ffd400', restColor: '#ffffff', highlight: true,
  },

  /* The same idea with the contrast the other way up: what has not been said
     yet recedes, so the line reads as a track being played rather than a
     sentence with one word shouted. */
  karaoke: {
    size: 0.052, uppercase: true, weight: 800,
    color: '#ffffff', strokeColor: 'rgba(0,0,0,0.92)',
    activeColor: '#4ade80', restColor: 'rgba(255,255,255,0.55)', highlight: true,
  },

  /* For content where shouting is wrong — an interview, anything sombre. Keeps
     the speaker's own capitalisation and says nothing with colour. */
  minimal: {
    size: 0.040, uppercase: false, weight: 600,
    color: '#ffffff', strokeColor: 'rgba(0,0,0,0.75)',
    activeColor: '#ffffff', restColor: '#ffffff', highlight: false,
  },
};

export const CAPTION_PRESETS: CaptionPreset[] = ['clean', 'bold', 'karaoke', 'minimal'];

function resolve(style: CaptionStyle): ResolvedStyle {
  const base = PRESETS[style.preset || 'clean'] || PRESETS.clean;
  return {
    y: style.y ?? DEFAULT_Y,
    size: style.size ?? base.size,
    uppercase: style.uppercase ?? base.uppercase,
    color: style.color ?? base.color,
    strokeColor: style.strokeColor ?? base.strokeColor,
    activeColor: style.activeColor ?? base.activeColor,
    restColor: style.restColor ?? base.restColor,
    highlight: base.highlight,
    weight: base.weight,
  };
}

const FONT_STACK = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** Words laid into lines that fit, keeping each word's own timing. */
function layOut(ctx: Ctx, words: CaptionWord[], maxWidth: number, spaceWidth: number): CaptionWord[][] {
  const lines: CaptionWord[][] = [];
  let line: CaptionWord[] = [];
  let width = 0;
  for (const word of words) {
    const w = ctx.measureText(word.text).width;
    const withSpace = line.length ? width + spaceWidth + w : w;
    if (line.length && withSpace > maxWidth) {
      lines.push(line);
      line = [word];
      width = w;
    } else {
      line.push(word);
      width = withSpace;
    }
  }
  if (line.length) lines.push(line);
  return lines;
}

/**
 * Draw one cue onto a frame.
 *
 * Stroke before fill, on every word. A drop shadow alone fails over a bright
 * background and a flat background box covers the picture; an outline survives
 * both, which matters because the footage underneath is someone else's and
 * cannot be adjusted to suit the text.
 *
 * `atSec` is where the playhead is within the clip. Without it nothing is
 * highlighted and every preset renders as its plain form, which is the right
 * behaviour for a caller that does not know the time rather than a reason to
 * throw.
 */
export function drawCaption(
  ctx: Ctx,
  cue: CaptionCue,
  width: number,
  height: number,
  style: CaptionStyle = {},
  atSec?: number,
): void {
  const s = resolve(style);
  const raw = (cue.text || '').trim();
  if (!raw) return;

  const fontSize = Math.max(12, Math.round(height * s.size));
  const lineHeight = Math.round(fontSize * 1.18);
  const maxWidth = width * 0.86;

  ctx.save();
  ctx.font = `${s.weight} ${fontSize}px ${FONT_STACK}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;
  ctx.lineWidth = Math.max(3, Math.round(fontSize * 0.18));
  ctx.strokeStyle = s.strokeColor;

  /* Fall back to the cue's own text when no word timings came with it — a cue
     built by an older version, or restored from node data written before word
     spans existed. */
  const source: CaptionWord[] = cue.words?.length
    ? cue.words
    : raw.split(/\s+/).map((text) => ({ text, startSec: cue.startSec, endSec: cue.endSec }));

  const words = source.map((w) => ({
    ...w,
    text: s.uppercase ? w.text.toUpperCase() : w.text,
  }));

  const spaceWidth = ctx.measureText(' ').width;
  const lines = layOut(ctx, words, maxWidth, spaceWidth);

  const block = lines.length * lineHeight;
  let y = height * s.y - block / 2 + lineHeight / 2;

  for (const line of lines) {
    const lineWidth = line.reduce(
      (sum, w, i) => sum + ctx.measureText(w.text).width + (i ? spaceWidth : 0),
      0,
    );
    let x = (width - lineWidth) / 2;

    for (const word of line) {
      const spoken =
        s.highlight
        && typeof atSec === 'number'
        && atSec >= word.startSec
        && atSec < word.endSec;

      ctx.fillStyle = !s.highlight
        ? s.color
        : spoken ? s.activeColor : s.restColor;

      ctx.strokeText(word.text, x, y);
      ctx.fillText(word.text, x, y);
      x += ctx.measureText(word.text).width + spaceWidth;
    }
    y += lineHeight;
  }

  ctx.restore();
}
