/**
 * @jest-environment jsdom
 */

/**
 * Putting a clip Flow generated on the next prompt, from the composer's
 * picker — V on a Studio node.
 *
 * Measured on flow.google.com 2026-10-25: a clip's picker row shows the same
 * /asb/<TOKEN> thumbnail as its tile in the grid (3 of 3). The token is the
 * one thing that tells two takes of a prompt apart, since both are listed
 * under the same title. The fixture rows are pickerAssetRows.test.ts's markup
 * with a real token in the thumbnail.
 */

import { attachFromLibrary, clipAssetRow } from '../content/flow/libraryPicker';
import { encodeClipRef } from '../shared/videoReference';

const PROMPT = 'Ruby waves at the camera and says hello, warm window light';
const NEW = 'ANqvLOaxqHlZe7G4dI4IPIcHbyjnx5kK3E49';
const OLD = 'BXwq0aPLk2ZtT1fYc9H7rUeN4sVdM8gJ6oQ3';

function box(el: Element): void {
  (el as HTMLElement).getBoundingClientRect = () =>
    ({ width: 120, height: 32, left: 10, top: 400, right: 130, bottom: 432 }) as DOMRect;
}

interface Row { title: string; token: string; active?: boolean }

function rowHtml({ title, token, active = false }: Row): string {
  return `<button type="button" role="option" data-token="${token}" class="asset-item${active ? ' asset-item-active' : ''}"`
    + ' aria-selected="false"><flow-add-menu-asset-item>'
    + `<div class="asset-thumbnail"><img alt="" class="asset-thumbnail-image" src="https://flow.google.com/asb/${token}"></div>`
    + `<div class="asset-text"><span class="asset-title">${title}</span>`
    + '<span class="type-subtitle">Video</span></div>'
    + '</flow-add-menu-asset-item></button>';
}

const attached: string[] = [];

/** The picker, open, behaving as pickerAssetRows.test.ts measured it. */
function openPicker(rows: Row[]): void {
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
  const picker = document.getElementById('picker')!;
  const attach = (token: string) => {
    attached.push(token);
    picker.remove();
    document.querySelector('.ingredient-bar-container')!
      .insertAdjacentHTML('beforeend', '<flow-video-ingredient-chip></flow-video-ingredient-chip>');
  };
  picker.addEventListener('click', (e) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>('button.asset-item');
    if (row) {
      if (row.classList.contains('asset-item-active')) { attach(row.dataset.token!); return; }
      picker.querySelectorAll('.asset-item-active').forEach((r) => r.classList.remove('asset-item-active'));
      row.classList.add('asset-item-active');
      document.getElementById('preview')!.innerHTML = '<button id="add-to-prompt">Add to prompt</button>';
      box(document.getElementById('add-to-prompt')!);
      return;
    }
    if ((e.target as HTMLElement).id === 'add-to-prompt') {
      const active = picker.querySelector<HTMLElement>('.asset-item-active');
      if (active) attach(active.dataset.token!);
    }
  });
}

beforeEach(() => { attached.length = 0; document.body.innerHTML = ''; });

describe('finding the clip', () => {
  it('takes the take whose token it is, not the newest under that title', () => {
    openPicker([{ title: PROMPT, token: NEW }, { title: PROMPT, token: OLD }]);
    const row = clipAssetRow(document, { token: OLD, title: PROMPT });
    expect(row!.row.dataset.token).toBe(OLD);
  });

  it('falls back to the title only when one row fits it', () => {
    openPicker([{ title: PROMPT, token: NEW }, { title: 'Something else entirely', token: OLD }]);
    expect(clipAssetRow(document, { token: 'NotOnThisPage0000000', title: PROMPT })!.row.dataset.token).toBe(NEW);
  });

  it('will not guess between two takes when its token is on neither', () => {
    openPicker([{ title: PROMPT, token: NEW }, { title: PROMPT, token: OLD }]);
    expect(clipAssetRow(document, { token: 'NotOnThisPage0000000', title: PROMPT })).toBeNull();
  });

  it('takes the newest take when only the prompt is known', () => {
    /* A clip known by its API media id has no token — that id space does not
       convert. The picker lists Recent first. */
    openPicker([{ title: PROMPT, token: NEW }, { title: PROMPT, token: OLD }]);
    expect(clipAssetRow(document, { token: '', title: PROMPT })!.row.dataset.token).toBe(NEW);
  });

  it('reads a title Flow cut short in the page', () => {
    openPicker([{ title: 'Ruby waves at the camera and s…', token: NEW }]);
    expect(clipAssetRow(document, { token: '', title: PROMPT })!.row.dataset.token).toBe(NEW);
  });
});

describe('attaching it', () => {
  it('puts the token\'s take on the prompt', async () => {
    openPicker([{ title: PROMPT, token: NEW, active: true }, { title: PROMPT, token: OLD }]);
    const got = await attachFromLibrary(encodeClipRef({ token: OLD, title: PROMPT }), { doc: document, step: 0 });
    expect(got).toEqual({ ok: true });
    expect(attached).toEqual([OLD]);
  });

  it('says what is missing in words, never the reference\'s JSON', async () => {
    openPicker([{ title: 'A different clip altogether', token: OLD }]);
    const lines: string[] = [];
    const got = await attachFromLibrary(encodeClipRef({ token: NEW, title: PROMPT }),
      { doc: document, step: 0, log: (l) => lines.push(l) });
    expect(got.ok).toBe(false);
    expect(got.reason).toMatch(/"Ruby waves at the camera.*" is not in this Flow project's library/);
    expect(got.reason).toMatch(/same Flow project/);
    for (const text of [got.reason!, ...lines]) expect(text).not.toContain('clip:{');
    expect(attached).toEqual([]);
  });
});
