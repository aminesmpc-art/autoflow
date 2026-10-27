/**
 * @jest-environment jsdom
 */

/**
 * "The video is generated but the node shows an error on every node."
 *
 * ── What was happening ───────────────────────────────────────────────────
 *
 * An eight-shot episode, every clip rendered correctly in Flow, every node
 * red. The tiles were fine; identifying them was not.
 *
 * A Flow tile carries no id of any kind — measured on the live grid and kept
 * as the fixture beside this file: no data-tile-id, no data-media-id, nothing
 * on the <video> but its src. So a node finds its own generation by the one
 * thing Flow prints beside the media: the prompt.
 *
 * findRowForPrompt tried an exact match, then fell back to sharing the first
 * 80 characters, on this reasoning:
 *
 *   "A long shared opening is still conclusive — two different prompts
 *    agreeing on their first 80 characters would have to be deliberate."
 *
 * It IS deliberate. A multi-shot episode repeats a continuity lock VERBATIM
 * at the head of every prompt, because repeated wording is the single biggest
 * lever there is on holding a character, a palette and a world together
 * across shots — and this project's own workflow builder emits exactly that.
 *
 * Measured on the real episode: the eight shots share their first 1,499
 * characters. So `findRowForPrompt(shot2)` returned shot 1's finished tile on
 * a page that did not contain shot 2 at all. The caller's guard —
 * `!rowsBefore.has(mine.tileId) || wait > 45` — rejected it for 45 seconds
 * and then took it anyway.
 *
 * ── The fix ──────────────────────────────────────────────────────────────
 *
 * Both ends of the prompt have to agree. What makes two shots different lives
 * at the END; a row whose head matches and whose tail does not is somebody
 * else's generation.
 *
 * And the head-only route, which exists because Flow can clip a long prompt
 * in the card, now asks the question clipping actually poses: is this card a
 * PREFIX of my prompt? Shot 1's card is not a prefix of shot 2's prompt, and
 * that is the whole difference.
 *
 * Finally the caller passes the rows that existed before it submitted, so a
 * tile that predates the node cannot be adopted by it however similar the
 * words beside it are.
 */

/// <reference types="node" />

import { readFileSync } from 'fs';
import { join } from 'path';
import {
  readGenerationRows, findRowForPrompt, flowTileIdentity,
} from '../content/flow/selectors';
import { getStudioTileState } from '../content/flow/tileState';

/** A finished 9:16 Omni clip, copied off flow.google.com on 2026-09-18. */
const TILE = readFileSync(join(__dirname, 'fixtures-flowBatchTile.html'), 'utf8');

/* The lock, exactly as the builder emits it: identical in every shot. */
const LOCK = [
  'CONTINUITY LOCK — identical in every shot of this episode.',
  'STYLE: Photorealistic prehistoric survival. Realistic dirt, skin, fur, rock and mud.',
  'POV: True first-person GoPro/body-mounted POV from the same young tribe member'
  + " throughout. The protagonist's face is never visible. Only their dirty hands, rough"
  + ' fur wrist wraps, weathered forearms and a crude wooden spear may enter frame.',
  'CAST — the same people in every shot: ELDER, an older weathered man with tangled'
  + ' grey-streaked hair and a heavy rough fur cloak. HUNTER 1, an adult male with dark'
  + ' tangled hair, rough animal-hide clothing and a wooden spear. HUNTER 2, an adult male'
  + ' with medium rough hair, layered animal-hide clothing and primitive tools. A small'
  + ' recurring family tribe carrying hides, bundles, tools and spears.',
  'WORLD: Cold rocky prehistoric grassland, pale dead grass, frost patches, dark rocks,'
  + ' hills and caves. Cold grey overcast daylight. Muted brown, grey, charcoal and'
  + ' dirty-beige palette.',
  'CAMERA: Raw action-camera feeling, 18-22mm-equivalent wide lens at natural human eye'
  + ' height, body-mounted walking bounce, slight lateral sway, organic head turns, minor'
  + ' roll and tilt, imperfect framing, realistic motion blur.',
  'NEVER: third-person camera, drone shots, crane shots, smooth cinematic gimbal, floating'
  + ' camera, modern objects, generated text, subtitles, logos.',
  'AUDIO: Environmental only — wind, footsteps, breathing, hide movement, rocks and distant'
  + ' tribe sounds. No narration, no voice-over, no spoken dialogue, no music.',
].join('\n') + '\n\n';

/* Shot 1 verbatim — this is the prompt the fixture's card actually shows. */
const SHOT1 = LOCK
  + "SHOT 1 — PACKING THE OLD CAMP. Cold dawn at the tribe's old camp. Open looking DOWN at"
  + " the POV character's dirty hands gathering a small bundle of hides and primitive tools"
  + ' on the ground beside the crude wooden spear. Around them the tribe packs hurriedly'
  + ' among large dark rocks. The elder stands worried and scans the distance. Hunter 1'
  + ' stoops and picks up a bundle. Partway through, the head lifts naturally from the hands'
  + ' toward the group. END ON: the tribe beginning to move away from the camp, the POV'
  + ' still at the packing spot.';

const SHOT2 = LOCK
  + 'Continue from this exact frame without resetting the scene. SHOT 2 — WALKING. Walk'
  + ' directly behind the same tribe across cold uneven grassland. END ON: the group slowing'
  + ' as they notice a shallow rock overhang ahead.';

beforeEach(() => { document.body.innerHTML = TILE; });

describe('the tile itself is readable', () => {
  it('names a video tile that carries no id attribute', () => {
    /* Nothing on this tile states an id. The uuid in the signed media URL is
       the only name it has. */
    expect(document.querySelector('[data-tile-id], [data-media-id]')).toBeNull();
    expect(flowTileIdentity(document.querySelector('flow-video-tile')!))
      .toBe('689f27ed-d71d-420c-ac45-f75cc03bf0d9');
  });

  it('reads as completed, because the clip is playable', () => {
    expect(getStudioTileState(document.querySelector('flow-video-tile')!, true))
      .toBe('completed');
    expect(getStudioTileState(document.querySelector('.batch-container')!, true))
      .toBe('completed');
  });

  it('is not fooled by the playback progress bar into reading generating', () => {
    /* The tile carries style="--progress-percent: 46.3%". extractTileProgress
       walks TEXT nodes, so a percentage living in a style attribute is not a
       generation badge — and must not be read as one. */
    expect(document.querySelector('[style*="--progress-percent"]')).not.toBeNull();
    expect(getStudioTileState(document.querySelector('.batch-container')!, true))
      .toBe('completed');
  });

  it('finds the row, with the prompt and the media in different subtrees', () => {
    const rows = readGenerationRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].tileId).toBe('689f27ed-d71d-420c-ac45-f75cc03bf0d9');
    expect(rows[0].element.tagName.toLowerCase()).toBe('flow-video-tile');
  });
});

describe('a repeated continuity lock is not a name', () => {
  it('the shots really do share a very long opening', () => {
    let i = 0;
    while (SHOT1[i] === SHOT2[i]) i++;
    /* The number that broke it. 80 characters cannot tell these apart. */
    expect(i).toBeGreaterThan(1000);
  });

  it('matches the shot whose prompt the card actually shows', () => {
    expect(findRowForPrompt(SHOT1)?.tileId).toBe('689f27ed-d71d-420c-ac45-f75cc03bf0d9');
  });

  it('does NOT hand shot 2 the tile belonging to shot 1', () => {
    /* The bug, in one assertion. Shot 2 has not been generated; the page holds
       only shot 1. Before the fix this returned shot 1's finished clip. */
    expect(findRowForPrompt(SHOT2)).toBeNull();
  });

  it('refuses a tile that was already on the page when the node started', () => {
    /* Even for the shot whose prompt it is: a row that predates the submit is
       a previous run's, and adopting it is how a node goes green carrying the
       wrong video. */
    const before = new Set(['689f27ed-d71d-420c-ac45-f75cc03bf0d9']);
    expect(findRowForPrompt(SHOT1, before)).toBeNull();
    expect(findRowForPrompt(SHOT1, new Set(['something-else']))).not.toBeNull();
  });

  it('a card clipped inside the lock is identified by novelty, or not at all', () => {
    /* This case cannot be solved by reading the page, and pretending
       otherwise is what the whole bug was.

       Clip the card at 1,200 characters and the visible text stops INSIDE the
       shared lock — so it is a prefix of shot 1, of shot 2, and of all eight.
       Flow simply has not rendered the part that says which shot it is.

       So the prefix route answers only when the caller has already narrowed
       the candidates to rows that appeared after it submitted. Then novelty
       identifies the row and the prefix merely agrees with it. */
    const card = document.querySelector('.text-part')!;
    card.textContent = (card.textContent || '').slice(0, 1200) + '…';

    // Narrowed to new rows: this row is new, so it is ours.
    expect(findRowForPrompt(SHOT1, new Set())?.tileId)
      .toBe('689f27ed-d71d-420c-ac45-f75cc03bf0d9');

    // The same row, known to predate the node: refused.
    expect(findRowForPrompt(SHOT1, new Set(['689f27ed-d71d-420c-ac45-f75cc03bf0d9'])))
      .toBeNull();

    // Un-narrowed — the widened second attempt — refuses to guess from a
    // prefix, which is what stopped shot 2 adopting shot 1's clip.
    expect(findRowForPrompt(SHOT1)).toBeNull();
    expect(findRowForPrompt(SHOT2)).toBeNull();
  });
});

describe('the caller asks for a NEW row first', () => {
  const SRC = readFileSync(join(__dirname, '..', 'content', 'flow', 'index.ts'), 'utf8');

  /* Both calls also skip an earlier attempt's failed tile — see
     flowRefusedTile.test.ts. */
  it('passes the rows that existed before it submitted', () => {
    expect(SRC).toMatch(/findRowForPrompt\(promptText, rowsBefore, earlierFailure\)/);
  });

  it('only widens the search once the strict question has failed', () => {
    const at = SRC.indexOf('findRowForPrompt(promptText, rowsBefore, earlierFailure)');
    expect(at).toBeGreaterThan(-1);
    expect(SRC.slice(at, at + 160)).toMatch(/\|\|\s*\(wait > 45 \? findRowForPrompt\(promptText, undefined, earlierFailure\)/);
  });
});

/* ────────────────────────────────────────────────────────────────────────
   The other half of the same run: one clip failed, the episode went red
   ──────────────────────────────────────────────────────────────────────── */

describe('the service decides that a generation failed, not the DOM', () => {
  const SRC = readFileSync(join(__dirname, '..', 'content', 'flow', 'index.ts'), 'utf8');

  it('treats a DOM failure as still-generating while the API says generating', () => {
    /*   22:36:51  Waiting 15s — tile unknown is failed, API generating
     *
     * There was a guard for a false 'completed' and none for a false
     * 'failed', so the DOM won. Every shot is chained to the last frame of
     * the one before it, so the rest of the episode went red behind it. */
    /* The whole branch, not a fixed number of characters after it. Flow's own
       failed tile is the one exception (flowRefusedTile.test.ts), and its
       explanation pushed the assignment past a 2000-character window. */
    const at = SRC.indexOf("state === 'failed' && serviceStillWorking");
    expect(at).toBeGreaterThan(-1);
    expect(SRC.slice(at, SRC.indexOf('} else if', at))).toMatch(/state = 'generating';/);
  });

  it('keeps the DOM authoritative when the service knows nothing', () => {
    /* serviceStillWorking is only true for 'generating' or 'queued'. With no
       API entry it is false, and the DOM stays the only signal there is —
       this must not become a blanket "ignore DOM failures". */
    expect(SRC).toMatch(
      /const serviceStillWorking = \(apiState === 'generating' \|\| apiState === 'queued'\)\s*&& apiReported !== 'THUMBNAIL_ONLY';/);
  });

  it('is why a prompt may not be scanned for failure words', () => {
    /* Tile state is decided by scanning text for 'failed', 'blocked',
       'violate', 'oops' and friends. Flow prints the PROMPT beside the media,
       so readGenerationRows hands back the tile element rather than the batch
       container that holds both. */
    const ROWS = readFileSync(join(__dirname, '..', 'content', 'flow', 'selectors.ts'), 'utf8');
    expect(ROWS).toMatch(
      /element: \(tile\.matches\('flow-video-tile, flow-image-tile'\) \? tile as HTMLElement : row\)/);
  });
});
