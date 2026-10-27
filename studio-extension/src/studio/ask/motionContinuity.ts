import type { MotionPieceRow } from './motionControl';

/** Only a captured inline image, never a poster URL or a source-video frame. */
export function endingFrame(value: unknown): string {
  return typeof value === 'string' && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(value) ? value : '';
}

/** A deliberate new scene is a boundary: its descendants are a separate chain. */
export function continuityRetryThrough(rows: MotionPieceRow[], index: number): number {
  const nextScene = rows.filter(r => r.index > index && r.continuityReset).sort((a, b) => a.index - b.index)[0];
  return nextScene ? nextScene.index - 1 : Math.max(index, ...rows.map(r => r.index));
}

export function clearMotionOutput(row: MotionPieceRow): MotionPieceRow {
  return { ...row, status: 'idle', errorMessage: undefined, videoUrl: undefined, posterUrl: undefined,
    tileId: undefined, endFrameUrl: undefined, endFrameError: undefined,
    continuityVersion: undefined, continuityFrom: undefined };
}

export function continuityInput(rows: MotionPieceRow[], row: MotionPieceRow): { frame: string; parent?: string } {
  if (row.index === 1 || row.continuityReset) return { frame: '' };
  const previous = rows.find(r => r.index === row.index - 1);
  if (!previous || previous.status !== 'done' || !previous.continuityVersion) {
    throw new Error(`Finish piece ${row.index - 1} before piece ${row.index}, or select Start new scene on this piece.`);
  }
  const frame = endingFrame(previous.endFrameUrl);
  if (!frame) throw new Error(`Piece ${row.index - 1} is complete but its ending frame is missing. Recover its ending frame, or select Start new scene on piece ${row.index}. No dependent clip was generated.`);
  return { frame, parent: previous.continuityVersion };
}

export function continuityOutputCurrent(rows: MotionPieceRow[], row: MotionPieceRow): boolean {
  if (row.index === 1 || row.continuityReset) return !row.continuityFrom;
  const previous = rows.find(r => r.index === row.index - 1);
  return previous?.status === 'done' && !!previous.continuityVersion && row.continuityFrom === previous.continuityVersion;
}

export function continuityPrompt(imageNumber: number): string {
  return `CONTINUITY: Image ${imageNumber} is the previous generated clip's ending frame, not a replacement character or setting. `
    + 'Use it as a visual continuity guide for the opening: preserve the established styling, clothing, light and spatial relationships where compatible with the source footage. '
    + 'The original character and setting references remain authoritative; do not carry forward errors from the ending frame. '
    + 'The attached source-video piece still controls all movement, timing and camera. Do not freeze, loop or replace its action with this still. '
    + 'An intentional scene change in the direction takes precedence.';
}
