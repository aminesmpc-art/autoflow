/**
 * @jest-environment jsdom
 */

/* ============================================================
   Telling our generation apart from everything else in the grid.

   The poller used to fall back to allCards[0] — the newest card on the page —
   whenever nothing had looked like it was generating. That is correct only
   when the submit landed. When it silently did not, the node returned the
   previous node's clip, or something made yesterday, and the run finished
   green with the wrong video in it. Nothing surfaces that except watching the
   output.

   Flow prints each row's prompt beside its media, so the row can be asked for
   by name. The markup below is verbatim from a live page.
   ============================================================ */

import { readGenerationRows, findRowForPrompt } from '../content/flow/selectors';

const PROMPT =
  'Handheld UGC-style video of this exact scene, subtle natural movement, ' +
  'slight camera sway, the person smiles and turns the product toward the ' +
  'camera. Low motion intensity, no warping.';

const TILE = 'fe_id_5d9e1323-29cc-44f2-8b61-385c2e0069ec';

/** One row, shaped like Flow's: media with a tile id, then prompt + metadata. */
function mountRow(prompt: string, tileId: string, model = 'Omni Flash'): void {
  const row = document.createElement('div');
  row.innerHTML = `
    <div>
      <div data-tile-id="${tileId}">
        <video src="/fx/api/trpc/media.getMediaUrlRedirect?name=a2adfd84"></video>
        <img src="/fx/api/trpc/media.getMediaUrlRedirect?name=a2adfd84&amp;mediaUrlType=MEDIA_URL_TYPE_THUMBNAIL" alt="Video thumbnail">
      </div>
    </div>
    <div>
      <div class="sc-7f95703a-0 gAhVjE">
        <div class="sc-7f95703a-1 iEkYZi">${prompt}</div>
        <div class="sc-7f95703a-2 fFPzdq">
          <button class="sc-e8425ea6-0 sc-7f95703a-4 reuse-prompt-button" data-state="closed">
            <i class="google-symbols">redo</i><span>Reuse text prompt</span>
          </button>
        </div>
      </div>
      <div class="sc-c8e6b852-0 fIkWMv">
        <div>Created Aug 4, 2026</div>
        <div>${model}</div>
        <div class="sc-c8e6b852-1 XggeM"><i>crop_9_16</i>9:16</div>
        <div>Video length: 6s</div>
        <div>Resolution: 720p</div>
      </div>
    </div>`;
  document.body.append(row);
}

beforeEach(() => { document.body.innerHTML = ''; });

describe('readGenerationRows', () => {
  it('reads a row from the real markup', () => {
    mountRow(PROMPT, TILE);
    const rows = readGenerationRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      tileId: TILE,
      prompt: PROMPT,
      model: 'Omni Flash',
      duration: '6s',
    });
  });

  it('reads the aspect ratio out of its icon line', () => {
    mountRow(PROMPT, TILE);
    // The ratio shares its div with a crop_9_16 glyph, so it cannot be read
    // by position — only by shape.
    expect(readGenerationRows()[0].aspectRatio).toContain('9:16');
  });

  it('finds nothing on a page with no generations', () => {
    expect(readGenerationRows()).toEqual([]);
  });
});

describe('findRowForPrompt', () => {
  it('picks our row out of several', () => {
    mountRow('An entirely different video about a cat', 'fe_id_older');
    mountRow(PROMPT, TILE);
    mountRow('Something generated yesterday', 'fe_id_yesterday');
    expect(findRowForPrompt(PROMPT)!.tileId).toBe(TILE);
  });

  it('does not hand back the newest row when ours is absent', () => {
    /* The bug this replaces: with no row of ours, the poller took whatever
       was newest and called it this node's result. */
    mountRow('Someone else\'s clip entirely', 'fe_id_newest');
    expect(findRowForPrompt(PROMPT)).toBeNull();
  });

  it('survives whitespace and case differences', () => {
    mountRow(PROMPT.toUpperCase().replace(/, /g, ',\n  '), TILE);
    expect(findRowForPrompt(PROMPT)!.tileId).toBe(TILE);
  });

  it('matches on a long opening when Flow clipped the text', () => {
    // Cards truncate very long prompts; 80 shared characters is still
    // conclusive between two prompts that were not written to collide.
    mountRow(PROMPT.slice(0, 110), TILE);
    expect(findRowForPrompt(PROMPT)!.tileId).toBe(TILE);
  });

  it('refuses to match on a prompt too short to identify anything', () => {
    mountRow('a car', 'fe_id_short');
    expect(findRowForPrompt('a car')).toBeNull();
  });

  it('does not confuse two prompts that only share a short opening', () => {
    mountRow('Wide shot of a red car driving fast down a coastal road', 'fe_id_a');
    expect(findRowForPrompt('Wide shot of a blue van parked outside a shop')).toBeNull();
  });
});
