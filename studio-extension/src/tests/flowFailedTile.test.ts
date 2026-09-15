/**
 * @jest-environment jsdom
 *
 * The Flow adapter's two blind spots, both carried here from the sibling
 * extension where they were found and measured.
 *
 * ── 1. A failure invented from the prompt ─────────────────────────────────
 *
 * inferState scanned every string in an API record for FAIL / SAFETY / BLOCK
 * / REJECT / CANCEL as a SUBSTRING, and the record carries the user's own
 * prompt. "a city block at night" contains BLOCK; "cancel the wedding"
 * contains CANCEL. The scan ran BEFORE the media check, so a finished video
 * came back failed, and the prompt itself was handed on as the reason — where
 * classifyError reads a word like "prominent" and calls it a safety block,
 * the one class that never retries.
 *
 * It could never have been right: a search of real response bodies for any
 * capitalised enum-looking token found none. This API does not state failures
 * in words, so the scan had no true positive available to it — only false
 * ones, from user content.
 *
 * It cost a run of ten prompts next door: the first died three times in a
 * minute while the grid showed it generating, then finishing correctly.
 * automation.ts here acts on `entry.state === 'failed'` the same way, so the
 * same run was available to this adapter.
 *
 * ── 2. A Retry button that could not be found ─────────────────────────────
 *
 * The fixture below is the real markup of a failed tile. findRetryButtonOnTile
 * asked for `i.google-symbols` holding "refresh", and for a <span> reading
 * "Retry". This Flow renders <mat-icon>refresh</mat-icon> and puts the word in
 * aria-label. Measured live: 0 elements match `i.google-symbols`, against 70
 * <mat-icon>. So it returned null on every failed tile the site can produce.
 */

/// <reference types="node" />

import * as fs from 'fs';
import * as path from 'path';
import { findRetryButtonOnTile } from '../content/flow/selectors';
import { inferState } from '../content/flow/flowBatch';

/** The real markup of a failed tile, trimmed only of ripple spans. */
const FAILED_TILE = `
  <div class="batch-container">
    <flow-video-tile>
      <div class="container">
        <flow-error-tile>
          <div class="error-tile"><div class="error-tile-content">
            <div class="error-message">
              <mat-icon class="mat-icon notranslate error-icon google-symbols">warning</mat-icon>
              <div class="error-title">Failed</div>
              <div class="error-subtitle">
                <span class="error-message-text"> This prompt might violate our policies about generating prominent people. </span>
                <span class="disclaimer-message">You have not been charged for this generation.</span>
              </div>
            </div>
            <div class="buttons-container">
              <button class="mdc-icon-button" aria-label="Retry"><mat-icon class="mat-icon notranslate google-symbols">refresh</mat-icon></button>
              <button class="mdc-icon-button" aria-label="Reuse prompt"><mat-icon class="mat-icon notranslate google-symbols">undo</mat-icon></button>
              <button class="mdc-icon-button" aria-label="Delete"><mat-icon class="mat-icon notranslate google-symbols">delete_forever</mat-icon></button>
            </div>
          </div></div>
        </flow-error-tile>
      </div>
    </flow-video-tile>
  </div>`;

const mount = (html: string): Element => {
  document.body.innerHTML = html;
  return document.querySelector('flow-video-tile')!;
};

describe('the Retry button on a failed tile', () => {
  it('is found', () => {
    const btn = findRetryButtonOnTile(mount(FAILED_TILE));
    expect(btn).not.toBeNull();
    expect(btn!.getAttribute('aria-label')).toBe('Retry');
  });

  it('is not confused with Reuse prompt', () => {
    /* It refills the prompt box and generates nothing, so a run that clicked
       it would wait out its timeout and report a failure it caused itself. */
    expect(findRetryButtonOnTile(mount(FAILED_TILE))!.getAttribute('aria-label'))
      .not.toBe('Reuse prompt');
  });

  it('is not confused with Delete', () => {
    expect(findRetryButtonOnTile(mount(FAILED_TILE))!.getAttribute('aria-label'))
      .not.toBe('Delete');
  });

  it('is found by its icon when the wording is missing', () => {
    /* A ligature is the same word in every locale; an aria-label is not, and
       this site is served in several. */
    const tile = mount(FAILED_TILE);
    tile.querySelectorAll('button').forEach((b) => b.removeAttribute('aria-label'));
    const btn = findRetryButtonOnTile(tile);
    expect(btn!.querySelector('mat-icon')!.textContent).toBe('refresh');
  });

  it('is found by its wording when the icon font has not resolved', () => {
    const tile = mount(FAILED_TILE);
    tile.querySelectorAll('mat-icon').forEach((i) => { i.textContent = ''; });
    expect(findRetryButtonOnTile(tile)!.getAttribute('aria-label')).toBe('Retry');
  });

  it('offers nothing on a tile that has not failed', () => {
    /* A finished tile's buttons, read off the live page: favorite, redo,
       more_vert. None regenerates, and `redo` must not pass for `refresh`. */
    const tile = mount(`
      <div class="batch-container"><flow-video-tile>
        <button aria-label="Favourite"><mat-icon>favorite</mat-icon></button>
        <button aria-label="Reuse prompt"><mat-icon>redo</mat-icon></button>
        <button aria-label="More options"><mat-icon>more_vert</mat-icon></button>
      </flow-video-tile></div>`);
    expect(findRetryButtonOnTile(tile)).toBeNull();
  });

  it('still matches the old Flow', () => {
    const tile = mount(`
      <div class="batch-container"><flow-video-tile>
        <button><i class="google-symbols">refresh</i><span>Retry</span></button>
      </flow-video-tile></div>`);
    expect(findRetryButtonOnTile(tile)).not.toBeNull();
  });
});

describe('the API does not get to invent a failure', () => {
  /* A record is a positional array; these carry a UUID, a prompt and a
     timestamp the way a real one does. */
  const record = (prompt: string, media?: string) => [
    '6a5b21d8-ce58-4745-8b9d-0f48014bb65e',
    ['title', prompt, [1788000000, 0]],
    media ? [media] : [],
  ] as unknown[];

  it('does not fail a video over a word in its own prompt', () => {
    for (const prompt of [
      'a city block at night, neon reflections',
      'she cancels the meeting and walks out',
      'the failing engine of an old truck',
      'a safety barrier above a construction site',
      'orange leaves rejected by the wind',
    ]) {
      expect(inferState(record(prompt)).state).not.toBe('failed');
    }
  });

  it('still reports a finished generation as completed', () => {
    const done = record('a quiet lake', 'https://flow-content.google/video/abc-123-def-456');
    expect(inferState(done).state).toBe('completed');
  });

  it('reports an unfinished one as still running', () => {
    /* The safe direction: a wrong "generating" costs one more poll, a wrong
       "completed" moves the run past a video that is not there. */
    expect(inferState(record('a quiet lake')).state).toBe('generating');
  });

  it('never returns failed at all', () => {
    /* The page states failure — flow-error-tile, with the reason in it. This
       API does not, so nothing here should claim otherwise. */
    const src = fs.readFileSync(
      path.resolve(__dirname, '../content/flow/flowBatch.ts'), 'utf8');
    expect(src).not.toMatch(/FAILURE_WORDS/);
  });
});
