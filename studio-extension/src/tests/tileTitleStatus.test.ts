/**
 * @jest-environment jsdom
 */

/**
 * "tile 34142166 is generating, API completed" — for twenty minutes.
 *
 *   05:14:57  Waiting 90s  — tile 34142166 is generating, API completed
 *   05:15:13  Waiting 105s — tile 34142166 is generating, API completed
 *   05:15:28  Waiting 120s — tile 34142166 is generating, API completed
 *
 * The clip was in the grid the whole time. The Flow tab showed it, with its
 * thumbnail, its prompt and "Omni 1.1 Flash · 720p · 6s · 9:16".
 *
 * ── Why the tile read as generating ──────────────────────────────────────
 *
 * Tile state is decided partly by scanning the tile's text for status words:
 * 'preparing' and 'queued' mean a generation in flight, 'failed', 'blocked',
 * 'violate' and 'rejected' mean one that died.
 *
 * Flow auto-writes a TITLE for every generation, from the prompt, and prints
 * it inside the tile. This shot's title was
 *
 *   "Protagonist preparing to leave camp"
 *
 * and `preparing` is a generating cue. So the tile announced itself as
 * generating for as long as anyone watched it.
 *
 * ── The third time ───────────────────────────────────────────────────────
 *
 * Same shape, three times now:
 *
 *   a prompt saying a shelter was REJECTED    → read as a rejected generation
 *   a landscape described as EMPTY            → read as an unstarted scene
 *   a title containing PREPARING              → read as a tile still working
 *
 * The fix is the same each time: ask the question of the thing that answers
 * it. Machine status is not read out of prose a model wrote.
 *
 * ── And why it cost twenty minutes rather than correcting itself ─────────
 *
 * Every other disagreement between the DOM and Flow's API is reconciled: a
 * DOM `completed` while the service is still working is pushed back, a DOM
 * `failed` likewise, a `thumbnail-only` whose record holds a signed URL is
 * taken from the record. DOM generating + API completed had nothing at all.
 */

/// <reference types="node" />

import { readFileSync } from 'fs';
import { join } from 'path';
import { getStudioTileState, statusText } from '../content/flow/tileState';

const TILE = readFileSync(join(__dirname, 'fixtures-flowBatchTile.html'), 'utf8');

/** Retitle the fixture the way Flow titled the shot that broke. */
function titled(title: string): void {
  document.body.innerHTML = TILE;
  document.querySelector('.footer-title')!.textContent = title;
  document.querySelector('flow-grid-tile-container')!.setAttribute('aria-label', title);
}

describe('a tile is not described by its own name', () => {
  it('reads completed even when its title says "preparing"', () => {
    titled('Protagonist preparing to leave camp');
    expect(getStudioTileState(document.querySelector('.batch-container')!, true))
      .toBe('completed');
  });

  it('reads completed when the title says "queued" too', () => {
    titled('Hunters queued along the ridge');
    expect(getStudioTileState(document.querySelector('.batch-container')!, true))
      .toBe('completed');
  });

  it('is not failed because a prompt says a shelter was rejected', () => {
    /* The same hazard on the other vocabulary, and the reason readGenerationRows
       already hands back the tile rather than the batch container. Now the
       state reader is safe on its own too. */
    document.body.innerHTML = TILE;
    document.querySelector('.text-part')!.textContent =
      'Hunter 2 rejected the shelter as too exposed and the group turned away. '
      + 'The plan had failed and the overhang was blocked by fallen rock.';
    expect(getStudioTileState(document.querySelector('.batch-container')!, true))
      .toBe('completed');
  });

  it('strips the title, the prompt and the metadata from the status text', () => {
    titled('Protagonist preparing to leave camp');
    const text = statusText(document.querySelector('.batch-container')!);
    expect(text).not.toMatch(/preparing/);
    expect(text).not.toMatch(/continuity lock/);
    expect(text).not.toMatch(/omni 1\.1 flash/);
  });
});

describe('real status still reaches the reader', () => {
  it('a genuine progress badge still means generating', () => {
    /* The badge is Flow's own, in the tile body, not in anything it wrote
       about the generation. Scoping must not cost us this. */
    document.body.innerHTML = TILE;
    const body = document.querySelector('flow-video-tile .container')!;
    body.insertAdjacentHTML('afterbegin', '<div class="progress-text">42%</div>');
    expect(getStudioTileState(document.querySelector('.batch-container')!, true))
      .toBe('generating');
  });

  it('a genuine failure in the tile body still means failed', () => {
    document.body.innerHTML = TILE;
    /* A failed tile has no playable source AND no play control — the
       play_circle in type-icon-container is a finished clip's furniture, and
       leaving it in would build a tile Flow never renders. */
    document.querySelector('flow-video-tile video')!.remove();
    document.querySelector('flow-video-tile .type-icon-container')!.remove();
    for (const el of Array.from(document.querySelectorAll('flow-video-tile mat-icon'))) {
      if ((el.textContent || '').trim() === 'play_circle') el.remove();
    }
    document.querySelector('flow-video-tile .container')!
      .insertAdjacentHTML('afterbegin', '<div>Failed — Oops, something went wrong!</div>');
    expect(getStudioTileState(document.querySelector('.batch-container')!, true))
      .toBe('failed');
  });

  it('falls back to the whole tile when there is nothing to strip', () => {
    /* A tile shape with no prompt or footer — an older Flow, or a detail view.
       Scoping to nothing would read as an empty string and silence every cue. */
    document.body.innerHTML = '<div id="t"><span>Queued</span></div>';
    expect(statusText(document.getElementById('t')!)).toMatch(/queued/);
  });
});

describe('the DOM and the service are reconciled in both directions', () => {
  const SRC = readFileSync(join(__dirname, '..', 'content', 'flow', 'index.ts'), 'utf8');

  it('takes the finished clip when the tile still reads as generating', () => {
    const at = SRC.indexOf('const doneUrl = apiVideoUrl();');
    expect(at).toBeGreaterThan(-1);
    const body = SRC.slice(at, at + 400);
    expect(body).toMatch(/apiConfirmsCompleted && !serviceStillWorking/);
    expect(body).toMatch(/state = 'completed';/);
  });

  it('waits ten seconds first, so a just-flipped record is not raced', () => {
    const at = SRC.indexOf('const doneUrl = apiVideoUrl();');
    expect(SRC.slice(at, at + 400)).toMatch(/wait > 10/);
  });

  it('still refuses to trust the DOM over a service that is working', () => {
    /* The three guards that already existed must all survive. */
    expect(SRC).toMatch(/state === 'completed' && serviceStillWorking/);
    expect(SRC).toMatch(/state === 'failed' && serviceStillWorking/);
    expect(SRC).toMatch(/apiUrl && !serviceStillWorking/);
  });
});
