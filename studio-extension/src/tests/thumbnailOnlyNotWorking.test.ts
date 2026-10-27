/**
 * "Why doesn't it find that the generation is done — the video is there?"
 * (Motion, 2026-10-16: piece 1 of 6 still "Generating" after 14 minutes, the
 * finished Omni clip on screen.)
 *
 * Measured live the same day: Flow loads its data over fetch now, and the
 * project media list (rpc Zzl0ze) carries only the /asb/ poster for every
 * clip, finished or not. The signed /video/ URL comes only in the per-clip
 * reply (as29s) Flow fetches when the tile is hovered, and a finished tile
 * holds no <video> until then (a synthetic hover mounted one with a src).
 *
 * flowBatch reads a poster-only record as THUMBNAIL_ONLY / generating. The
 * watcher took that as "the service is still working", which also switched
 * off the nudge that hovers the tile, so nothing ever mounted the player.
 */

/// <reference types="node" />

import { readFileSync } from 'fs';
import { join } from 'path';
import { inferState } from '../content/flow/flowBatch';

const INDEX = readFileSync(join(__dirname, '..', 'content', 'flow', 'index.ts'), 'utf8');

const POSTER = 'https://flow.google.com/fx/api/trpc/media/asb/ABCDEFGHIJ=s512';
const VIDEO = 'https://flow-content.google/video/11111111-1111-1111-1111-111111111111?Expires=1';
const ID = '11111111-1111-1111-1111-111111111111';

describe('what Flow\'s two replies mean', () => {
  it('a media-list record with only a poster reads as THUMBNAIL_ONLY', () => {
    expect(inferState(['w', 'p', ID, null, null, [[1760000000, 1], POSTER]], [ID]))
      .toMatchObject({ state: 'generating', rawStatus: 'THUMBNAIL_ONLY' });
  });

  it('the per-clip record with the signed video reads as finished', () => {
    expect(inferState(['w', 'p', ID, null, null, [[1760000000, 1], VIDEO]], [ID]))
      .toMatchObject({ state: 'completed', rawStatus: 'VIDEO_PRESENT' });
  });
});

describe('the watcher', () => {
  it('does not count a poster-only record as the service still working', () => {
    expect(INDEX).toMatch(/const serviceStillWorking = \(apiState === 'generating' \|\| apiState === 'queued'\)\s*&& apiReported !== 'THUMBNAIL_ONLY';/);
  });

  it('so the nudge that hovers the tile runs while the record says THUMBNAIL_ONLY', () => {
    const at = INDEX.indexOf('if (!serviceStillWorking && Date.now() - lastNudgeAt > NUDGE_EVERY_MS) {');
    expect(at).toBeGreaterThan(-1);
    expect(INDEX.slice(at, at + 400)).toMatch(/bringTileIntoView\(trackedTile\)/);
    const nudge = readFileSync(join(__dirname, '..', 'content', 'flow', 'selectors.ts'), 'utf8');
    const fn = nudge.slice(nudge.indexOf('export async function bringTileIntoView'), nudge.indexOf('export async function hoverTile'));
    expect(fn).toMatch(/if \(!tile\.querySelector\('video'\)\) await hoverTile\(tile\);/);
  });

  it('reads the label it compares against from the same status', () => {
    expect(INDEX).toMatch(/if \(status\) apiReported = status\.rawStatus;/);
  });
});
