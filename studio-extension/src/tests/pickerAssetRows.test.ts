/**
 * @jest-environment jsdom
 */

/**
 * "fix this problem in the motion controle"
 *
 *   23:59:04  Motion  Uploading 2 piece(s) to Flow
 *   00:00:02  Flow    "Motion-Control-1-silent-part2-of-2" is in the Flow library
 *   00:00:02  Motion  The upload failed: Chrome handed the file(s) to Flow but
 *                     nothing named Motion-Control-1-silent-part1-of-2 appeared
 *                     in its library within 45s. Nothing was generated.
 *
 * On the same screen, both pieces sat in the project, and part1 was in the
 * picker named in full.
 *
 * ── What the picker actually is ─────────────────────────────────────────
 *
 * Read off a live project, not inferred. Every result is a
 *
 *   <button role="option" class="asset-item [asset-item-active]">
 *     <flow-add-menu-asset-item>
 *       <div class="asset-thumbnail"> img.asset-thumbnail-image  (finished)
 *                                     mat-icon "videocam"        (processing)
 *       <div class="asset-text"><span class="asset-title">NAME</span>
 *                               <span class="type-subtitle">Video</span>
 *
 * and across twelve rows the list held ZERO <video> elements. The only one
 * Flow ever mounts is the preview pane's player, for the active row, once it
 * has finished processing.
 *
 * namedVideoRow finds a clip by climbing out from a <video>. So it could only
 * ever match through the preview pane — and part1, still processing when it
 * was searched, got no preview and so no <video>, for all 45 seconds. Part2
 * was searched second, had finished by then, was previewed, and matched.
 *
 * The processing row the user pasted, verbatim, is the fixture below.
 *
 * ── And one thing measured the hard way ─────────────────────────────────
 *
 * Pressing an inactive row selects it and mounts its preview. Pressing the
 * ACTIVE row attaches it immediately and closes the picker — found by doing
 * exactly that on the live page (and then removing the chip it added). The
 * attach used to press first and look for "Add to prompt" second; on an
 * already-active row that attaches, finds no button, reports failure, and the
 * prompt's retry attaches the clip a second time.
 */

import {
  namedAssetRow, namedVideoRow, drawsAssetRows,
  confirmInLibrary, attachFromLibrary, attachedCount,
} from '../content/flow/libraryPicker';

const PART1 = 'Motion-Control-1-silent-part1-of-2';
const PART2 = 'Motion-Control-1-silent-part2-of-2';

/** jsdom reports a zero box for everything; isShowing ranks on size. */
function box(el: Element): void {
  (el as HTMLElement).getBoundingClientRect = () =>
    ({ width: 120, height: 32, left: 10, top: 400, right: 130, bottom: 432 }) as DOMRect;
}

interface Row { title: string; ready?: boolean; active?: boolean }

/** A row exactly as Flow draws it. `ready: false` is the markup the user pasted. */
function rowHtml({ title, ready = true, active = false }: Row): string {
  const thumb = ready
    ? '<!----><img alt="" class="asset-thumbnail-image" src="https://lh3.googleusercontent.com/x">'
    : '<!----><!----><!----><mat-icon role="img" class="mat-icon notranslate google-symbols '
      + 'mat-icon-no-color" aria-hidden="true" data-mat-icon-type="font">videocam</mat-icon><!---->';
  return `<button type="button" role="option" class="asset-item${active ? ' asset-item-active' : ''}"`
    + ' aria-selected="false"><flow-add-menu-asset-item>'
    + `<div class="asset-thumbnail">${thumb}</div>`
    + `<div class="asset-text"><span class="asset-title">${title}</span><!---->`
    + '<span class="type-subtitle">Video</span><!----></div>'
    + '</flow-add-menu-asset-item></button>';
}

let presses: string[] = [];

/**
 * The picker, open, behaving as it was measured to:
 *   - pressing an inactive row makes it active and mounts a preview <video>
 *     and an "Add to prompt" button — OUTSIDE the row, in the preview pane
 *   - pressing the active row attaches it and closes the picker
 *   - "Add to prompt" attaches the active row and closes the picker
 */
function openPicker(rows: Row[], opts: { previewOf?: string } = {}): void {
  presses = [];
  document.body.innerHTML = `
    <flow-ingredient-bar><div class="ingredient-bar-container"></div></flow-ingredient-bar>
    <div class="cdk-overlay-pane" role="dialog" id="picker">
      <button><mat-icon>image</mat-icon>Images</button>
      <button><mat-icon>videocam</mat-icon>Videos</button>
      <input class="search-input" aria-label="Search assets" placeholder="Search assets" />
      <div id="results">${rows.map(rowHtml).join('')}</div>
      <div id="preview"></div>
    </div>`;
  for (const el of Array.from(document.querySelectorAll('button, input'))) box(el);
  if (opts.previewOf) mountPreview(opts.previewOf);

  const picker = document.getElementById('picker')!;
  picker.addEventListener('click', (e) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>('button.asset-item');
    if (row) {
      const title = row.querySelector('.asset-title')!.textContent!;
      presses.push(title);
      if (row.classList.contains('asset-item-active')) { attach(title); return; }
      picker.querySelectorAll('.asset-item-active').forEach((r) => r.classList.remove('asset-item-active'));
      row.classList.add('asset-item-active');
      if (row.querySelector('.asset-thumbnail img')) mountPreview(title);
      return;
    }
    if ((e.target as HTMLElement).id === 'add-to-prompt') {
      const active = picker.querySelector('.asset-item-active .asset-title');
      if (active) attach(active.textContent!);
    }
  });
}

/**
 * The preview pane: the one <video> the picker ever holds.
 *
 * Nested the way an Angular component tree nests it — deeper than the six
 * levels namedVideoRow will climb — unless `shallow`. The depth matters, and
 * that is the point of the two tests that use it: the old matcher's answer
 * for part1 changed with it.
 */
function mountPreview(title: string, shallow = false): void {
  const preview = document.getElementById('preview')!;
  const player = `<div class="player"><div class="preview-head">${title}</div>`
    + `<video src="blob:${title}"></video></div>`;
  const wrapped = shallow ? player
    : '<div><div><div><div><div><div>' + player + '</div></div></div></div></div></div>';
  preview.innerHTML = wrapped + '<button id="add-to-prompt">Add to prompt</button>';
  box(document.getElementById('add-to-prompt')!);
}

const attached: string[] = [];
function attach(title: string): void {
  attached.push(title);
  document.getElementById('picker')?.remove();
  document.querySelector('.ingredient-bar-container')!
    .insertAdjacentHTML('beforeend', '<flow-video-ingredient-chip></flow-video-ingredient-chip>');
}

beforeEach(() => { attached.length = 0; presses = []; document.body.innerHTML = ''; });

/* ────────────────────────────────────────────────────────────────────────── */

describe('the reported failure', () => {
  it('is what the old matcher does with a processing row', () => {
    /* part1 still processing, part2 finished and previewed — the screen at
       00:00:02. The old reading finds part2 through the preview pane and
       cannot find part1 at all, however long it is given. */
    openPicker([{ title: PART1, ready: false }, { title: PART2, active: true }], { previewOf: PART2 });
    expect(namedVideoRow(document, PART2)).not.toBeNull();
    expect(namedVideoRow(document, PART1)).toBeNull();
  });

  it('and with a shallower preview, the old matcher picks the WRONG clip', () => {
    /* Found by this test's own first run, which nested the preview two levels
       deep instead of eight. The climb from part2's player then reached the
       whole picker — whose text holds part1's title in the list — and handed
       back part2's <video> as "part1". Six seconds of the wrong half, attached
       with a green tick. Which of the two failures you got depended on how
       deeply Flow happened to nest a component: not a thing to build on. */
    openPicker([{ title: PART1, ready: false }, { title: PART2, active: true }]);
    mountPreview(PART2, true);
    const wrong = namedVideoRow(document, PART1);
    expect(wrong).not.toBeNull();
    expect(wrong!.getAttribute('src')).toBe(`blob:${PART2}`);
    /* The title reading is indifferent to depth. */
    expect(namedAssetRow(document, PART1)!.row.querySelector('.asset-title')!.textContent).toBe(PART1);
  });

  it('is fixed: part1 is found by its title, and known to be processing', () => {
    openPicker([{ title: PART1, ready: false }, { title: PART2, active: true }], { previewOf: PART2 });
    const row = namedAssetRow(document, PART1);
    expect(row).not.toBeNull();
    expect(row!.ready).toBe(false);
    expect(row!.row.querySelector('.asset-title')!.textContent).toBe(PART1);
  });

  it('records processing as landed but not ready for generation', async () => {
    openPicker([{ title: PART1, ready: false }, { title: PART2, active: true }], { previewOf: PART2 });
    const lines: string[] = [];
    const seen = await confirmInLibrary([`${PART1}.mp4`, `${PART2}.mp4`],
      { doc: document, step: 0, log: (l) => lines.push(l) });
    expect(seen.ok).toBe(false);
    expect(seen.missing).toEqual([]);
    expect(seen.found).toEqual([PART1, PART2]);
    expect(seen.processing).toEqual([PART1]);
    expect(lines).toContain(`"${PART1}" is in the Flow library — Flow is still processing it`);
    expect(lines).toContain(`"${PART2}" is in the Flow library`);
  });

  it('rejects an explicitly failed upload even if its thumbnail still exists', async () => {
    openPicker([{ title: PART1 }]);
    document.querySelector('.asset-thumbnail')!.insertAdjacentHTML('beforeend', '<span>Video upload failed. Please try again.</span>');
    const seen = await confirmInLibrary([PART1], { step: 0 });
    expect(seen.ok).toBe(false);
    expect(seen.failed).toEqual([PART1]);
    expect(seen.processing).toEqual([]);
    const attached = await attachFromLibrary(PART1, { step: 0 });
    expect(attached.ok).toBe(false);
    expect(attached.reason).toContain('Video upload failed in Flow:');
  });

  it('does not treat a clip named Failed as an upload failure', async () => {
    openPicker([{ title: 'Failed' }]);
    expect((await confirmInLibrary(['Failed.mp4'], { step: 0 })).ok).toBe(true);
  });

  it('does not guess readiness when a row has no thumbnail container', async () => {
    openPicker([{ title: PART1 }]);
    document.querySelector('.asset-thumbnail')!.remove();
    const seen = await confirmInLibrary([PART1], { step: 0 });
    expect(seen.ok).toBe(false);
    expect(seen.processing).toEqual([PART1]);
  });

  it('waits while processing and confirms only after the thumbnail arrives', async () => {
    jest.useFakeTimers();
    try {
      openPicker([{ title: PART1, ready: false }]);
      setTimeout(() => {
        document.querySelector('.asset-thumbnail')!.innerHTML = '<img src="https://lh3.googleusercontent.com/ready">';
      }, 600);
      const check = confirmInLibrary([PART1], { step: 0, budgetMs: 2000 });
      await jest.advanceTimersByTimeAsync(2100);
      expect(await check).toMatchObject({ ok: true, processing: [], failed: [] });
    } finally { jest.useRealTimers(); }
  });

  it('recognizes a failure that appears after processing started', async () => {
    jest.useFakeTimers();
    try {
      openPicker([{ title: PART1, ready: false }]);
      setTimeout(() => {
        document.querySelector('.asset-thumbnail')!.innerHTML = '<mat-icon>warning</mat-icon>Video upload failed';
      }, 600);
      const check = confirmInLibrary([PART1], { step: 0, budgetMs: 2000 });
      await jest.advanceTimersByTimeAsync(2100);
      expect(await check).toMatchObject({ ok: false, failed: [PART1], processing: [] });
    } finally { jest.useRealTimers(); }
  });

  it('still reports a piece that is genuinely absent', async () => {
    openPicker([{ title: PART2 }]);
    const seen = await confirmInLibrary([`${PART1}.mp4`, `${PART2}.mp4`], { doc: document, step: 0 });
    expect(seen.ok).toBe(false);
    expect(seen.missing).toEqual([PART1]);
  });
});

describe('matching a row by its name', () => {
  it('compares the whole title, not a substring', () => {
    /* includes() let part1-of-2 match part1-of-20 — a plausible clip of the
       wrong seconds, which nothing downstream can detect. */
    openPicker([{ title: 'Motion-Control-1-silent-part1-of-20' }]);
    expect(namedAssetRow(document, PART1)).toBeNull();
  });

  it('ignores the extension and the case', () => {
    openPicker([{ title: PART1 }]);
    expect(namedAssetRow(document, `${PART1.toUpperCase()}.mp4`)).not.toBeNull();
  });

  it('takes the newest of several rows with the same name', () => {
    /* Every run re-uploads under the same names; a live library held three
       part1-of-2 rows. Recent is first. The newest is the one just uploaded. */
    openPicker([{ title: PART1, ready: false }, { title: PART2 }, { title: PART1 }]);
    const row = namedAssetRow(document, PART1)!;
    expect(row.row).toBe(document.querySelectorAll('button.asset-item')[0]);
    expect(row.ready).toBe(false);
  });

  it('is not fooled by the preview pane, which names a different clip', () => {
    /* The preview holds a <video> and part2's name. The old climb could reach
       the whole picker from it; the title lookup never looks there. */
    openPicker([{ title: PART2, active: true }], { previewOf: PART2 });
    expect(namedAssetRow(document, PART1)).toBeNull();
  });

  it('reads active off the class Flow actually sets', () => {
    /* aria-selected stayed "false" on every row, selected or not — measured.
       asset-item-active is the signal. */
    openPicker([{ title: PART1, active: true }, { title: PART2 }]);
    expect(namedAssetRow(document, PART1)!.active).toBe(true);
    expect(namedAssetRow(document, PART2)!.active).toBe(false);
  });

  it('leaves an older picker, with no titled rows, to the old matcher', () => {
    document.body.innerHTML = `<div class="cdk-overlay-pane" role="dialog">
      <input class="search-input" /><div class="tile"><video></video><span>${PART1}</span></div></div>`;
    expect(drawsAssetRows(document)).toBe(false);
    expect(namedAssetRow(document, PART1)).toBeNull();
    expect(namedVideoRow(document, PART1)).not.toBeNull();
  });
});

describe('a title Flow has shortened', () => {
  /* Measured: "Character dancing using video mo…", the ellipsis in the text
     itself, and the full name in no attribute anywhere on the row. A piece
     name can run to forty characters of label plus "-partN-of-M". */
  const LONG = 'Neon-Rooftop-Dance-Reference-Take-Three-part1-of-12';
  const CUT = 'Neon-Rooftop-Dance-Reference-Ta…';

  it('is taken once the search has narrowed the list to it', () => {
    openPicker([{ title: CUT }, { title: CUT }]);
    const row = namedAssetRow(document, LONG);
    expect(row).not.toBeNull();
    expect(row!.shortened).toBe(true);
  });

  it('is NOT taken while unrelated rows are still showing', () => {
    /* Before the filter lands, a prefix is a guess. The caller's poll goes
       round again rather than take it. */
    openPicker([{ title: CUT }, { title: 'af_8c75d955.png' }]);
    expect(namedAssetRow(document, LONG)).toBeNull();
  });

  it('is NOT taken when it says too little to tell clips apart', () => {
    openPicker([{ title: 'Neon-Roo…' }]);
    expect(namedAssetRow(document, LONG)).toBeNull();
  });

  it('is NOT taken when it is not the start of the name at all', () => {
    openPicker([{ title: 'Neon-Rooftop-Dance-Reference-Tb…' }]);
    expect(namedAssetRow(document, LONG)).toBeNull();
  });

  it('never beats an exact title', () => {
    openPicker([{ title: CUT }, { title: LONG, active: true }]);
    const row = namedAssetRow(document, LONG)!;
    expect(row.shortened).toBe(false);
    expect(row.row.querySelector('.asset-title')!.textContent).toBe(LONG);
  });
});

describe('attaching a finished clip', () => {
  it('selects the row once, then adds it with the button', async () => {
    openPicker([{ title: PART2, active: true }, { title: PART1 }], { previewOf: PART2 });
    const got = await attachFromLibrary(`${PART1}.mp4`, { doc: document, step: 0 });
    expect(got).toEqual({ ok: true });
    expect(presses).toEqual([PART1]);
    expect(attached).toEqual([PART1]);
    expect(attachedCount(document)).toBe(1);
  });

  it('does NOT press a row that is already active', async () => {
    /* Pressing it would attach it and close the picker, and the "Add to
       prompt" lookup that followed would find nothing and report failure —
       with the clip already on the prompt, for the retry to add again. */
    openPicker([{ title: PART1, active: true }, { title: PART2 }], { previewOf: PART1 });
    const got = await attachFromLibrary(`${PART1}.mp4`, { doc: document, step: 0 });
    expect(got).toEqual({ ok: true });
    expect(presses).toEqual([]);
    expect(attached).toEqual([PART1]);
  });

  it('attaches the named clip, not whichever one was previewed', async () => {
    /* "Add to prompt" adds the ACTIVE row. With part2 previewed, pressing it
       without selecting part1 first would put the wrong six seconds on. */
    openPicker([{ title: PART2, active: true }, { title: PART1 }], { previewOf: PART2 });
    await attachFromLibrary(`${PART1}.mp4`, { doc: document, step: 0 });
    expect(attached).toEqual([PART1]);
  });
});

describe('attaching a clip Flow is still processing', () => {
  it('waits rather than pressing it, and names the state when it runs out', async () => {
    /* step 0 is "no real waits", so the budget is spent at once — which is
       exactly the timed-out case. A processing row cannot be previewed or
       added, so pressing it achieves nothing; it is left alone. */
    openPicker([{ title: PART1, ready: false }, { title: PART2, active: true }], { previewOf: PART2 });
    const got = await attachFromLibrary(`${PART1}.mp4`, { doc: document, step: 0 });
    expect(got.ok).toBe(false);
    expect(got.reason).toMatch(/is in the Flow library, but Flow was still processing it/);
    expect(presses).toEqual([]);
    expect(attached).toEqual([]);
  });
});

describe('when the name is not there at all', () => {
  it('says what the picker IS showing', async () => {
    /* "Nothing matches" has several causes — wrong name, wrong tab, never
       uploaded — and the titles on screen tell them apart at a glance. */
    openPicker([{ title: PART2 }, { title: 'af_8c75d955.png' }]);
    const got = await attachFromLibrary(`${PART1}.mp4`, { doc: document, step: 0 });
    expect(got.ok).toBe(false);
    expect(got.reason).toMatch(/nothing in the library matches "Motion-Control-1-silent-part1-of-2\.mp4"/);
    expect(got.reason).toMatch(/the picker shows "Motion-Control-1-silent-part2-of-2", "af_8c75d955\.png"/);
  });
});
