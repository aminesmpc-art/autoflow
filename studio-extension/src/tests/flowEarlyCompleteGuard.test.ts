/**
 * @jest-environment jsdom
 */

/// <reference types="node" />

import { readFileSync } from 'fs';
import { join } from 'path';
import { getStudioTileState } from '../content/flow/tileState';

const SRC = readFileSync(join(__dirname, '..', 'content', 'flow', 'index.ts'), 'utf8');

describe('Flow Early Completion Guard & Video Resolution', () => {
  it('overrides DOM completed state when API status is generating or queued', () => {
    expect(SRC).toMatch(/if \(state === 'completed' && serviceStillWorking\) \{\s*state = 'generating';/);
  });

  it('rejects video completion under 10 seconds without API confirmation', () => {
    expect(SRC).toMatch(/else if \(state === 'completed' && isVideoNode && wait < 10 && apiState !== 'completed'\) \{[\s\S]*?state = 'generating';/);
  });

  it('falls back to resolving mediaUrl from API mediaId or detail view video', () => {
    expect(SRC).toMatch(/https:\/\/labs\.google\/fx\/api\/trpc\/media\.getMediaUrlRedirect\?name=\$\{apiMatch\.mediaId\}/);
    expect(SRC).toMatch(/document\.querySelector\('main video, \[class\*="detail"\] video/);
  });

  it('tileState returns thumbnail-only for play icon if expectVideo is true and no source attached', () => {
    const tile = document.createElement('div');
    tile.innerHTML = '<span class="material-icons">play_arrow</span><img src="https://lh3.googleusercontent.com/test">';
    tile.querySelector('img')!.getBoundingClientRect = () => ({
      width: 400, height: 700, top: 0, left: 0, right: 400, bottom: 700, x: 0, y: 0, toJSON() {},
    }) as DOMRect;
    
    // As video without source attached, should return thumbnail-only (NOT completed)
    expect(getStudioTileState(tile, true)).toBe('thumbnail-only');

    // As image/still, returns completed
    expect(getStudioTileState(tile, false)).toBe('completed');
  });
});
