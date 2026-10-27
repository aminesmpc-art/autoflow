/// <reference types="node" />
/**
 * Reported 2026-10-20 from Motion: the prompt and both ingredients sat in
 * Flow's box, Generate never went, and the piece read "Generating in Flow…"
 * for 14 minutes. A press was "confirmed" because some tile in the project was
 * generating. Only a change the press itself made counts now.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { pressLanded } from '../content/flow/pressCheck';

const FLOW = readFileSync(join(__dirname, '..', 'content', 'flow', 'automation.ts'), 'utf8').replace(/\r\n/g, '\n');
const PROMPT = 'Apply the pose and motion from input video to the provided character from this image.';

describe('a Generate press counts only by what it changed', () => {
  it('a project already busy is not a press that landed', () => {
    const busy = { total: 6, generating: 1 };
    expect(pressLanded(PROMPT, PROMPT, busy, { ...busy })).toBeNull();
  });

  it('the prompt leaving the composer is', () => {
    expect(pressLanded(PROMPT, '', { total: 6, generating: 1 }, { total: 6, generating: 1 })).toBe('prompt');
  });

  it('a new tile, or one more generating, is', () => {
    expect(pressLanded(PROMPT, PROMPT, { total: 6, generating: 0 }, { total: 7, generating: 0 })).toBe('tiles');
    expect(pressLanded(PROMPT, PROMPT, { total: 6, generating: 1 }, { total: 6, generating: 2 })).toBe('tiles');
  });

  it('with no prompt text to compare, only the tiles can say', () => {
    expect(pressLanded('', '', { total: 2, generating: 1 }, { total: 2, generating: 1 })).toBeNull();
  });

  it('clickGenerate takes its baseline before the first press and no longer asks "is anything generating"', () => {
    const at = FLOW.indexOf('private async clickGenerate(');
    const body = FLOW.slice(at, FLOW.indexOf('\n  // -- Control methods --', at));
    expect(body).toContain('const tilesBefore = snapshotTiles();');
    expect(body.indexOf('const tilesBefore = snapshotTiles();')).toBeLessThan(body.indexOf('beforeSubmit?.();'));
    expect(body).toContain('pressLanded(promptTextBefore, getPromptText(), tilesBefore, now)');
    expect(body).not.toContain('tilesHaveProgress()');
  });
});
