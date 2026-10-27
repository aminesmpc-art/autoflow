/**
 * @jest-environment jsdom
 */

/// <reference types="node" />

/**
 * "He didn't wait for her."
 *
 * 2026-10-01: piece 2's 4K clip was in Flow's library and still processing
 * when the upload check's 45 seconds ran out. The check answered "Flow is
 * still processing Untitled-motion-silent-part2-of-2", the runner treated that
 * as a failed upload, and the whole job stopped — piece 1, uploaded and ready,
 * was never generated. The video finished processing a little later, in the
 * picker the user then opened by hand.
 *
 * Arriving and being ready are two waits. The first is spent in full only by
 * an upload that failed; the second by an upload that worked and is large.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { confirmInLibrary } from '../content/flow/libraryPicker';

const PART2 = 'Untitled-motion-silent-part2-of-2';

/** jsdom reports a zero box for everything; isShowing ranks on size. */
function box(el: Element): void {
  (el as HTMLElement).getBoundingClientRect = () =>
    ({ width: 120, height: 32, left: 10, top: 400, right: 130, bottom: 432 }) as DOMRect;
}

/** A picker row exactly as Flow draws it — `ready: false` is a clip still processing. */
function rowHtml(title: string, ready: boolean): string {
  const thumb = ready
    ? '<!----><img alt="" class="asset-thumbnail-image" src="https://lh3.googleusercontent.com/x">'
    : '<!----><mat-icon role="img" class="mat-icon notranslate google-symbols mat-icon-no-color" '
      + 'aria-hidden="true" data-mat-icon-type="font">videocam</mat-icon><!---->';
  return `<button type="button" role="option" class="asset-item" aria-selected="false"><flow-add-menu-asset-item>`
    + `<div class="asset-thumbnail">${thumb}</div>`
    + `<div class="asset-text"><span class="asset-title">${title}</span><span class="type-subtitle">Video</span></div>`
    + '</flow-add-menu-asset-item></button>';
}

function openPicker(rows: string): void {
  document.body.innerHTML = `
    <div class="cdk-overlay-pane" role="dialog" id="picker">
      <button><mat-icon>image</mat-icon>Images</button>
      <button><mat-icon>videocam</mat-icon>Videos</button>
      <input class="search-input" aria-label="Search assets" placeholder="Search assets" />
      <div id="results">${rows}</div>
    </div>`;
  for (const el of Array.from(document.querySelectorAll('button, input'))) box(el);
}

const finishProcessing = () => {
  document.querySelector('.asset-thumbnail')!.innerHTML = '<img src="https://lh3.googleusercontent.com/ready">';
};

describe('a clip Flow is still processing is waited for', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => { jest.useRealTimers(); document.body.innerHTML = ''; });

  it('past the arrival budget, until it is ready', async () => {
    /* Arrives at once, processes for three seconds — three times the time
       allowed for arriving. */
    openPicker(rowHtml(PART2, false));
    setTimeout(finishProcessing, 3000);
    const lines: string[] = [];
    const check = confirmInLibrary([PART2], { step: 0, budgetMs: 1000, readyBudgetMs: 10_000, log: (l) => lines.push(l) });
    await jest.advanceTimersByTimeAsync(3600);
    expect(await check).toMatchObject({ ok: true, found: [PART2], processing: [], missing: [] });
    expect(lines).toContain(`"${PART2}" is in the Flow library — waiting up to 10s for Flow to finish processing it`);
  });

  it('but not for ever', async () => {
    openPicker(rowHtml(PART2, false));
    const check = confirmInLibrary([PART2], { step: 0, budgetMs: 1000, readyBudgetMs: 2000 });
    await jest.advanceTimersByTimeAsync(2600);
    expect(await check).toMatchObject({ ok: false, processing: [PART2] });
  });

  it('while a clip that never arrives still costs only the arrival budget', async () => {
    openPicker('');
    const check = confirmInLibrary([PART2], { step: 0, budgetMs: 1000, readyBudgetMs: 60_000 });
    await jest.advanceTimersByTimeAsync(1600);
    expect(await check).toMatchObject({ ok: false, missing: [PART2], processing: [] });
  });
});

describe('the budgets', () => {
  const PICKER = readFileSync(join(__dirname, '..', 'content', 'flow', 'libraryPicker.ts'), 'utf8');
  const WORKER = readFileSync(join(__dirname, '..', 'background', 'debugUpload.ts'), 'utf8');
  const ms = (src: string, name: string) => Number(new RegExp(`const ${name} = ([\\d_]+);`).exec(src)![1].replace(/_/g, ''));

  it('give a processing clip what the attach already gives it', () => {
    expect(PICKER).toMatch(/const readyBudget = deps\.readyBudgetMs \?\? \(step === 0 \? 0 : READY_BUDGET_MS\);/);
  });

  it('stay inside the five minutes Chrome gives the worker for one message', () => {
    expect(ms(WORKER, 'LIBRARY_LANDING_MS') + ms(PICKER, 'READY_BUDGET_MS')).toBeLessThan(5 * 60_000);
  });
});
