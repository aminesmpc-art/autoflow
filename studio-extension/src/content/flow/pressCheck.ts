import type { TileSnapshot } from './selectors';

type Tiles = Pick<TileSnapshot, 'total' | 'generating'>;

/**
 * What proves a Generate press landed: only a change THIS press could make.
 *
 * The prompt leaving the composer, a tile more than before the press, or one
 * more tile generating than before. Never "a tile is generating": that is true
 * of any busy project, and it confirmed presses that never went — the prompt
 * sat in Flow's box while the piece waited 14 minutes for a clip (2026-10-20).
 */
export function pressLanded(
  textBefore: string, textNow: string, before: Tiles, now: Tiles,
): 'prompt' | 'tiles' | null {
  if (textBefore.length > 0 && textNow !== textBefore) return 'prompt';
  if (now.total > before.total || now.generating > before.generating) return 'tiles';
  return null;
}
