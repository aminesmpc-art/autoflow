/**
 * @jest-environment jsdom
 */

/**
 * Attaching a style reference that is already in the Flow library.
 *
 * Getting a file INTO Flow cannot be automated — five routes tried against the
 * live site, all dead. What CAN be automated is everything after: finding it by
 * name and putting it on the prompt. So a style reference costs one file pick
 * ever rather than one per clip.
 *
 * The DOM below mirrors what was read off the live page: a composer button
 * whose label carries Material's icon ligature ("add_2Create"), a small "add"
 * beside it, a "videocamVideos" tab, an input placeholdered "Search assets",
 * and a <video> preview with an "Add to Prompt" button. The picker's real tiles
 * are styled-components with hashed classes and no test ids, which is exactly
 * why nothing here selects by class.
 */

import { attachFromLibrary, attachedCount } from '../content/flow/libraryPicker';

/* Real geometry, because the + is found by size and position as well as label —
   "add" alone also matches the project's "Add Media" button. */
function place(el: Element, box: { top: number; width: number }) {
  (el as HTMLElement).getBoundingClientRect = () => ({
    top: box.top, left: 0, width: box.width, height: 24,
    right: box.width, bottom: box.top + 24, x: 0, y: box.top, toJSON: () => ({}),
  }) as DOMRect;
}

interface FlowOptions {
  /** What the library holds, by name. */
  library?: string[];
  /** Drop a step to prove it is reported rather than assumed. */
  without?: 'videos' | 'search' | 'confirm';
  /** Pressing Add to Prompt does nothing — the silent-miss case. */
  attachSilentlyFails?: boolean;
}

function buildFlow(opts: FlowOptions = {}) {
  const library = opts.library ?? ['Clip-one'];
  document.body.innerHTML = `
    <button id="composer">add_2Create</button>
    <button id="plus">add</button>
    <button id="addmedia">addAdd Media</button>
    <div id="promptbox">
      <div><div><div><div contenteditable="true"></div></div></div></div>
    </div>
    <div id="picker" role="dialog" style="display:none">
      ${opts.without === 'videos' ? '' : '<span id="videostab">videocamVideos</span>'}
      ${opts.without === 'search' ? '' : '<input placeholder="Search assets" />'}
      <div id="results"></div>
      ${opts.without === 'confirm' ? '' : '<button id="confirm">Add to Prompt</button>'}
    </div>`;

  const picker = document.getElementById('picker')!;
  place(document.getElementById('plus')!, { top: 600, width: 32 });
  place(document.getElementById('addmedia')!, { top: 40, width: 120 });

  document.getElementById('videostab')?.addEventListener('click', () => {
    picker.style.display = 'block';
  });

  const input = picker.querySelector('input');
  input?.addEventListener('input', () => {
    const q = (input.value || '').toLowerCase();
    const hit = library.find((n) => n.toLowerCase().includes(q) && q);
    document.getElementById('results')!.innerHTML = hit
      ? `<div class="sc-441e676a-0 TtAWs"><video data-name="${hit}"></video></div>`
      : '';
  });

  document.getElementById('confirm')?.addEventListener('click', () => {
    picker.remove();                                    // Flow closes the picker
    if (opts.attachSilentlyFails) return;
    document.querySelector('#promptbox div')!.insertAdjacentHTML(
      'beforeend',
      '<img src="/fx/api/trpc/media.getMediaUrlRedirect?name=abc" />',
    );
  });

  Object.defineProperty(window, 'innerHeight', { value: 1000, configurable: true });
}

const attach = (name: string) => attachFromLibrary(name, { step: 0 });

beforeEach(() => { document.body.innerHTML = ''; });

describe('counting what is on the prompt', () => {
  it('sees nothing on an empty composer', () => {
    buildFlow();
    expect(attachedCount()).toBe(0);
  });

  it('does not count the picker’s own preview as an ingredient', () => {
    /* The picker shows the video it is about to attach. Counting that would
       report success the moment the dialog opened. */
    buildFlow();
    document.getElementById('picker')!.style.display = 'block';
    document.getElementById('results')!.innerHTML =
      '<img src="/fx/api/trpc/media.getMediaUrlRedirect?name=x" />';
    expect(attachedCount()).toBe(0);
  });
});

describe('attaching a reference that is there', () => {
  it('finds it by name and puts it on the prompt', async () => {
    buildFlow({ library: ['Clip-one'] });
    await expect(attach('Clip-one.mp4')).resolves.toEqual({ ok: true });
    expect(attachedCount()).toBe(1);
  });

  it('searches without the extension, since the library has no .mp4 in its names', async () => {
    buildFlow({ library: ['Clip-one'] });
    await attach('Clip-one.mp4');
    expect(attachedCount()).toBe(1);
  });

  it('finds a result structurally, never by the hashed class', async () => {
    /* Flow's tiles are styled-components — sc-441e676a-0 TtAWs — and those
       hashes change on every deploy. The fixture uses a real one so a class
       selector would pass today and fail on Friday. */
    buildFlow({ library: ['Clip-one'] });
    await attach('Clip-one');
    expect(attachedCount()).toBe(1);
  });
});

describe('saying why it could not', () => {
  /* None of these may throw. A style reference improves a generation that
     works fine without one; losing it should cost a plainer cutaway, never
     the cutaway. */

  it('refuses an empty name rather than attaching whatever is first', async () => {
    buildFlow();
    await expect(attach('  ')).resolves.toMatchObject({ ok: false });
  });

  it('says the reference is not in the library', async () => {
    buildFlow({ library: ['something-else'] });
    const out = await attach('Clip-one.mp4');
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/upload it once by hand/);
  });

  it('says so when the Videos tab has moved', async () => {
    buildFlow({ without: 'videos' });
    const out = await attach('Clip-one');
    expect(out.reason).toMatch(/Videos tab/);
  });

  it('says so when the search box has moved', async () => {
    buildFlow({ without: 'search' });
    const out = await attach('Clip-one');
    expect(out.reason).toMatch(/search box/);
  });

  it('says so when there is nothing to confirm with', async () => {
    buildFlow({ without: 'confirm' });
    const out = await attach('Clip-one');
    expect(out.reason).toMatch(/Add to Prompt/);
  });

  it('catches a click that was accepted but attached nothing', async () => {
    /* Pressing the button is not the same as the ingredient arriving. A silent
       miss would generate a cutaway that ignored the style reference entirely,
       with nothing on screen saying so. */
    buildFlow({ attachSilentlyFails: true });
    const out = await attach('Clip-one');
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/no ingredient appeared/);
  });
});
