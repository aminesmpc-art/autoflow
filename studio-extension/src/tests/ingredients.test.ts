/**
 * @jest-environment jsdom
 */

/* ============================================================
   Knowing when a reference image is actually attached.

   Reported from a real run: the bot filled the prompt and clicked Generate
   while the image was still uploading. Flow generated from the text alone —
   the reference silently dropped, the clip subtly wrong, and the run green
   from start to finish.

   The old code was three fixed sleeps (6s, 8s, 8s) followed by an
   unconditional "uploaded successfully". A stopwatch cannot tell a finished
   upload from a slow one.

   Markup below is from a live prompt bar.
   ============================================================ */

import {
  findAttachedIngredients,
  findLoadedIngredients,
  waitForIngredients,
} from '../content/flow/selectors';

const box = (w: number, h: number) => () =>
  ({ width: w, height: h, top: 0, left: 0, bottom: h, right: w, x: 0, y: 0, toJSON() {} });

/** One attached-reference chip, exactly as Flow renders it. */
function chip({ loaded }: { loaded: boolean }): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = `
    <div class="sc-273a6a40-0 hpgSgT">
      <div class="sc-784d6f75-0 bEnOCH sc-621e6fb9-0 buIBIg">
        <div class="sc-784d6f75-1 cbvblO">
          <button class="sc-272106cb-0 iPeszA" data-card-open="false" data-state="closed">
            <div class="sc-272106cb-1 dziwlH">
              <img src="/fx/api/trpc/media.getMediaUrlRedirect?name=ff367fc6-760c-4eda-a898-78ebe5d2a3f1"
                   alt="A piece of media generated or uploaded by you, that is present in your collection."
                   crossorigin="anonymous" style="opacity: 1;">
            </div>
            <div class="sc-272106cb-2 gDtvdv">
              <i class="google-symbols" color="white">cancel</i>
            </div>
          </button>
        </div>
      </div>
    </div>`;
  document.body.append(host);
  for (const el of Array.from(host.querySelectorAll<HTMLElement>('*'))) {
    (el as any).getBoundingClientRect = box(50, 50);
  }
  const img = host.querySelector('img')!;
  // An <img> exists the instant the upload starts; these two say the bytes
  // have actually arrived.
  Object.defineProperty(img, 'complete', { value: loaded, configurable: true });
  Object.defineProperty(img, 'naturalWidth', { value: loaded ? 512 : 0, configurable: true });
  return host;
}

/** A grid tile — same media URL, no remove button. */
function gridTile(): void {
  const host = document.createElement('div');
  host.innerHTML = `
    <button data-tile-id="fe_id_1">
      <img src="/fx/api/trpc/media.getMediaUrlRedirect?name=a2adfd84" alt="Video thumbnail">
    </button>`;
  document.body.append(host);
  for (const el of Array.from(host.querySelectorAll<HTMLElement>('*'))) {
    (el as any).getBoundingClientRect = box(140, 250);
  }
  const img = host.querySelector('img')!;
  Object.defineProperty(img, 'complete', { value: true });
  Object.defineProperty(img, 'naturalWidth', { value: 512 });
}

beforeEach(() => { document.body.innerHTML = ''; });

describe('findAttachedIngredients', () => {
  it('finds a chip from the real markup', () => {
    chip({ loaded: true });
    expect(findAttachedIngredients()).toHaveLength(1);
  });

  it('does not count grid tiles', () => {
    /* Tiles use the same getMediaUrlRedirect URL. Counting them would make
       every prompt look like it already had its references and skip the wait
       entirely — the exact bug, via a different route. */
    gridTile();
    gridTile();
    expect(findAttachedIngredients()).toHaveLength(0);
  });

  it('separates chips from tiles on the same page', () => {
    gridTile();
    chip({ loaded: true });
    gridTile();
    expect(findAttachedIngredients()).toHaveLength(1);
  });
});

describe('findLoadedIngredients', () => {
  it('ignores a chip whose image has not arrived', () => {
    // The chip appears when the upload starts, so counting chips alone still
    // races the upload.
    chip({ loaded: false });
    expect(findAttachedIngredients()).toHaveLength(1);
    expect(findLoadedIngredients()).toHaveLength(0);
  });

  it('counts it once the image has loaded', () => {
    chip({ loaded: true });
    expect(findLoadedIngredients()).toHaveLength(1);
  });
});

describe('waitForIngredients', () => {
  it('returns immediately when nothing is expected', async () => {
    await expect(waitForIngredients(0)).resolves.toBe(true);
  });

  it('waits for a slow upload rather than giving up on a timer', async () => {
    const pending = chip({ loaded: false });
    // Arrives after the old code would already have clicked Generate.
    setTimeout(() => {
      const img = pending.querySelector('img')!;
      Object.defineProperty(img, 'complete', { value: true, configurable: true });
      Object.defineProperty(img, 'naturalWidth', { value: 512, configurable: true });
    }, 2500);

    await expect(waitForIngredients(1, 20_000)).resolves.toBe(true);
  }, 30_000);

  it('reports failure instead of proceeding when it never arrives', async () => {
    chip({ loaded: false });
    // The whole point: false, so the caller stops rather than generating from
    // the prompt text alone.
    await expect(waitForIngredients(1, 3000)).resolves.toBe(false);
  }, 10_000);

  it('will not accept a partial set', async () => {
    chip({ loaded: true });
    chip({ loaded: false });
    await expect(waitForIngredients(2, 3000)).resolves.toBe(false);
  }, 10_000);
});
