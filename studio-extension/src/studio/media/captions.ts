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
 * ── Why they are not animated ─────────────────────────────────────────────
 *
 * Word-by-word pop, bounce and colour-cycling do lift retention on some
 * content and make everything else look cheap — and a campaign clip of
 * someone else's footage is exactly the everything else. So the motion here is
 * one thing: a cue appears, holds, and is replaced. What does the work instead
 * is legibility — heavy weight, a stroke that survives any background, and a
 * cap on line length.
 *
 * ── Where they sit ────────────────────────────────────────────────────────
 *
 * Not at the bottom. TikTok, Reels and Shorts all paint their own furniture
 * over the lower fifth of the frame — the caption, the handle, the sound name,
 * the buttons — so text placed there is covered on the one screen it exists
 * for. These sit above that band, and the band is left empty.
 */

export interface CaptionCue {
  /** Seconds from the START OF THE CLIP, not of the source video. */
  startSec: number;
  endSec: number;
  text: string;
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
    cues.push({ startSec: at, endSec: end, text: group.join(' ') });
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
      out.push({ startSec: start, endSec: end, text: cue.text });
    }
  }

  out.sort((a, b) => a.startSec - b.startSec);

  /* Two cues on screen at once is a rendering bug, not a style. Where the
     arithmetic overlaps them, the earlier one gives way. */
  for (let i = 0; i < out.length - 1; i++) {
    if (out[i].endSec > out[i + 1].startSec) out[i].endSec = out[i + 1].startSec;
  }

  return out.filter((c) => c.endSec > c.startSec).map((c) => ({
    ...c,
    endSec: Math.max(c.endSec, Math.min(c.startSec + MIN_CUE_SEC, clipEndSec - clipStartSec)),
  }));
}

/** Which cue is on screen at a given second, or null. */
export function cueAt(cues: CaptionCue[], t: number): CaptionCue | null {
  for (const cue of cues) {
    if (t >= cue.startSec && t < cue.endSec) return cue;
  }
  return null;
}

export interface CaptionStyle {
  /** Fraction of frame height the text baseline block sits at. */
  y?: number;
  /** Fraction of frame height for the cap height of the type. */
  size?: number;
  uppercase?: boolean;
  color?: string;
  strokeColor?: string;
}

/* Above the platform's own furniture. TikTok, Reels and Shorts all paint the
   caption, handle and buttons over roughly the lower fifth; 0.72 puts the
   text clear of it while staying in the lower half where the eye expects it. */
const DEFAULT_Y = 0.72;

/* Of frame height. On a 1080-tall clip this is about 52px of cap height,
   which is legible on a phone at arm's length without covering the face. */
const DEFAULT_SIZE = 0.048;

const FONT_STACK = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

function wrap(
  ctx: { measureText(s: string): { width: number } },
  text: string,
  maxWidth: number,
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(candidate).width > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * Draw one cue onto a frame.
 *
 * Stroke before fill, both on every line. A drop shadow alone fails over a
 * bright background and a flat background box covers the picture; an outline
 * survives both, which matters because the footage underneath is someone
 * else's and cannot be adjusted to suit the text.
 */
export function drawCaption(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  cue: CaptionCue,
  width: number,
  height: number,
  style: CaptionStyle = {},
): void {
  const text = style.uppercase === false ? cue.text : cue.text.toUpperCase();
  if (!text.trim()) return;

  const fontSize = Math.max(12, Math.round(height * (style.size ?? DEFAULT_SIZE)));
  const lineHeight = Math.round(fontSize * 1.18);
  const maxWidth = width * 0.86;

  ctx.save();
  ctx.font = `800 ${fontSize}px ${FONT_STACK}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;

  const lines = wrap(ctx, text, maxWidth);
  const block = lines.length * lineHeight;
  const centreY = height * (style.y ?? DEFAULT_Y);
  let y = centreY - block / 2 + lineHeight / 2;

  ctx.strokeStyle = style.strokeColor ?? 'rgba(0, 0, 0, 0.92)';
  ctx.lineWidth = Math.max(3, Math.round(fontSize * 0.18));
  ctx.fillStyle = style.color ?? '#ffffff';

  for (const line of lines) {
    ctx.strokeText(line, width / 2, y);
    ctx.fillText(line, width / 2, y);
    y += lineHeight;
  }

  ctx.restore();
}
