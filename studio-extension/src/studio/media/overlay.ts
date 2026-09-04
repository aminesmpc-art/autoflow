/**
 * Putting the edit sheet on the picture.
 *
 * ── What this is, and what it is not ──────────────────────────────────────
 *
 * editSheet.ts plans what to ADD to a clip and says plainly that it is not a
 * compositor — the output is a list of timed instructions for someone
 * finishing in CapCut. This is the half that renders the ones which CAN be
 * rendered here, so a clip arrives with them already on it.
 *
 * It handles three of the eight kinds, and only three:
 *
 *   text    a word, number or phrase on screen
 *   punch   a framing change that holds
 *   zoom    a momentary push on one word
 *
 * The other five are not drawing problems. `broll` needs a second decoder,
 * `sfx` needs an audio mixdown, and `ramp`, `intro` and `outro` change the
 * clip's duration rather than its pixels — no canvas operation can express
 * any of them. They stay on the sheet for CapCut, and the node still shows
 * them, so nothing is silently dropped.
 *
 * ── Why it looks like captions.ts ─────────────────────────────────────────
 *
 * Deliberately. cut.ts already runs a per-frame hook that asks "which caption
 * applies at this timestamp" and paints it. This asks the same question of the
 * sheet and paints the answer into the same canvas, in the same pass. There is
 * no second encode and no second decode — an op costs a lookup and a draw.
 */

import type { EditOp } from '../clip/editSheet';

/* ────────────────────────────────────────────────────────────────────────
   When an op is live
   ──────────────────────────────────────────────────────────────────────── */

/**
 * An op with no `seconds` is an instant — a sound, a cut point. Nothing that
 * can be drawn is instantaneous, so a drawable op with no duration is given
 * one rather than being skipped: a text card that flashes for a single frame
 * is worse than no text card, and harder to diagnose.
 */
const DEFAULT_HOLD_SEC = 1.6;

export const holdOf = (op: EditOp): number =>
  typeof op.seconds === 'number' && op.seconds > 0 ? op.seconds : DEFAULT_HOLD_SEC;

/** Ops of these kinds, live at `t` seconds into the clip. */
export function opsAt(sheet: readonly EditOp[], t: number, kinds: readonly string[]): EditOp[] {
  const out: EditOp[] = [];
  for (const op of sheet) {
    if (!kinds.includes(op.kind)) continue;
    const from = op.atSec;
    if (t < from || t >= from + holdOf(op)) continue;
    out.push(op);
  }
  return out;
}

/* ────────────────────────────────────────────────────────────────────────
   Framing: punch and zoom
   ──────────────────────────────────────────────────────────────────────── */

/**
 * How much tighter the frame goes, as a fraction of the source rectangle.
 *
 * A punch is the cheapest way to reset attention and the sheet is told to
 * prefer it, so it is the one most likely to arrive — which makes getting the
 * amount right worth more than getting the rare ones right.
 *
 * 0.88 is 12% tighter. Enough to read as a deliberate cut on a phone, small
 * enough that it costs no visible sharpness: the source rectangle is being
 * scaled DOWN before it fills the same output, so the picture is upsampled by
 * exactly 1/0.88 — about 14%, which a 1080-tall crop absorbs without
 * softening. A 25% push would look decisive and arrive visibly mushy.
 */
const PUNCH_SCALE = 0.88;

/** A zoom peaks harder because it is gone again in under half a second. */
const ZOOM_PEAK = 0.93;

/**
 * How long a punch takes to arrive.
 *
 * Not instant. A single-frame jump to a tighter frame reads as a dropped
 * frame — the eye reports it as a glitch rather than as emphasis, which is
 * the opposite of the intent.
 */
const PUNCH_EASE_SEC = 0.22;

/** Smoothstep. Zero slope at both ends, so nothing starts or stops abruptly. */
const ease = (x: number): number => {
  const c = Math.max(0, Math.min(1, x));
  return c * c * (3 - 2 * c);
};

/**
 * The framing scale at `t` — 1 is untouched, smaller is tighter.
 *
 * When two ops overlap, the tightest wins rather than the two multiplying.
 * Multiplying would compound a punch and a zoom into a much harder push than
 * either asked for, and the sheet plans them independently without knowing
 * they collide.
 */
export function framingAt(sheet: readonly EditOp[], t: number): number {
  let scale = 1;

  for (const op of opsAt(sheet, t, ['punch', 'zoom'])) {
    const into = t - op.atSec;
    const hold = holdOf(op);
    let s: number;

    if (op.kind === 'punch') {
      /* Arrives over PUNCH_EASE_SEC and then stays for the rest of its hold —
         "a framing change that stays", which is how editSheet describes it. */
      s = 1 - (1 - PUNCH_SCALE) * ease(into / Math.min(PUNCH_EASE_SEC, hold));
    } else {
      /* A pulse: in and back out across the whole hold, peaking in the middle
         so it lands with the word rather than after it. */
      const half = hold / 2;
      const rise = into <= half ? into / half : (hold - into) / half;
      s = 1 - (1 - ZOOM_PEAK) * ease(rise);
    }

    scale = Math.min(scale, s);
  }

  return scale;
}

export interface SourceRect { left: number; top: number; width: number; height: number; }

/**
 * The same rectangle, tightened about its own centre.
 *
 * Centre-anchored so a tracked crop keeps pointing at the speaker: the rect
 * arriving here already follows their face, and pushing in toward a fixed
 * point would drift off them over a long hold.
 */
export function tighten(rect: SourceRect, scale: number): SourceRect {
  if (!(scale < 1)) return rect;
  const w = rect.width * scale;
  const h = rect.height * scale;
  return {
    left: rect.left + (rect.width - w) / 2,
    top: rect.top + (rect.height - h) / 2,
    width: w,
    height: h,
  };
}

/* ────────────────────────────────────────────────────────────────────────
   Text
   ──────────────────────────────────────────────────────────────────────── */

/**
 * Where a text card sits, as a fraction of frame height.
 *
 * Captions default to 0.72 and the platforms paint their own furniture over
 * the lower fifth, so both of those are taken. 0.24 is the upper third: clear
 * of the captions with room to spare, and clear of the very top, where a
 * phone's status bar and the app's own back button sit.
 */
const TEXT_Y = 0.24;

/** Fraction of the frame width a card may occupy before it wraps. */
const TEXT_MAX_W = 0.84;

/** Fade in and out, so a card does not appear between one frame and the next. */
const TEXT_FADE_SEC = 0.18;

/** Opacity of a card at `t`, including its fades. */
export function textAlphaAt(op: EditOp, t: number): number {
  const into = t - op.atSec;
  const hold = holdOf(op);
  if (into < 0 || into >= hold) return 0;
  const fade = Math.min(TEXT_FADE_SEC, hold / 2);
  if (into < fade) return ease(into / fade);
  if (into > hold - fade) return ease((hold - into) / fade);
  return 1;
}

/** Break a line into as few lines as fit the width. */
export function wrapText(
  measure: (s: string) => number,
  text: string,
  maxWidth: number,
): string[] {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const lines: string[] = [];
  let line = words[0];
  for (const word of words.slice(1)) {
    const next = `${line} ${word}`;
    if (measure(next) <= maxWidth) line = next;
    else { lines.push(line); line = word; }
  }
  lines.push(line);
  return lines;
}

/** The minimum a 2D context has to offer for a card to be drawn. */
export interface DrawTarget {
  save(): void;
  restore(): void;
  measureText(text: string): { width: number };
  fillText(text: string, x: number, y: number): void;
  strokeText(text: string, x: number, y: number): void;
  font: string;
  fillStyle: string | CanvasGradient | CanvasPattern;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  lineJoin: CanvasLineJoin;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
  globalAlpha: number;
}

/**
 * Draw one text card.
 *
 * Stroked before filled, which is the same trick captions.ts uses: a clip can
 * cut to a white shirt or a window mid-card, and text with no outline vanishes
 * for exactly as long as that shot lasts.
 */
export function drawTextOp(
  ctx: DrawTarget,
  op: EditOp,
  width: number,
  height: number,
  t: number,
): void {
  const alpha = textAlphaAt(op, t);
  if (alpha <= 0) return;

  const text = String(op.what || '').trim();
  if (!text) return;

  /* Scales with the frame so a 304-wide crop and a 1080-wide one read the
     same, rather than one arriving with text the height of a thumbnail. */
  const size = Math.round(height * 0.062);
  const lineHeight = Math.round(size * 1.22);

  ctx.save();
  ctx.font = `700 ${size}px "Archivo", "Helvetica Neue", Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.globalAlpha = alpha;

  const lines = wrapText((s) => ctx.measureText(s).width, text, width * TEXT_MAX_W);
  const block = lines.length * lineHeight;
  let y = height * TEXT_Y - block / 2 + lineHeight / 2;

  for (const line of lines) {
    ctx.lineWidth = Math.max(2, Math.round(size * 0.17));
    ctx.strokeStyle = 'rgba(0,0,0,0.82)';
    ctx.strokeText(line, width / 2, y);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(line, width / 2, y);
    y += lineHeight;
  }

  ctx.restore();
}

/* ────────────────────────────────────────────────────────────────────────
   What this can and cannot take
   ──────────────────────────────────────────────────────────────────────── */

/** The kinds this module renders. Everything else is left for CapCut. */
export const DRAWN_KINDS = ['text', 'punch', 'zoom'] as const;

/** True when a sheet contains anything worth turning the canvas on for. */
export function sheetDraws(sheet: readonly EditOp[] | undefined | null): boolean {
  return !!sheet?.some((op) => (DRAWN_KINDS as readonly string[]).includes(op.kind));
}
