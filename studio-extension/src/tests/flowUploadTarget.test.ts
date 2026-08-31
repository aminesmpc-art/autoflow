/**
 * @jest-environment jsdom
 */

/**
 * The mp4s went into the image picker.
 *
 * Flow answered, once per clip part:
 *
 *   "Unsupported image format. Please upload a: .heif, .heic, .png, .jpg,
 *    .webp, .gif"
 *
 * which is an accept list read back — that input's own. Everything before it
 * had worked: the debugger attached, the banner showed, the button was found,
 * the files were delivered. They went to the wrong element, and it read as a
 * Flow problem rather than ours.
 *
 * Two independent causes, either of which produces exactly that:
 *
 * 1. The direct route took document.querySelector('input[type=file]') — the
 *    FIRST file input on the page, which is the image one. It now runs only
 *    when exactly one input admits video, and hands back to the chooser path
 *    otherwise. The chooser path never had this failure, because
 *    Page.fileChooserOpened names the input that actually opened.
 *
 * 2. The Videos tab was selected by taking the first element whose text
 *    contains "videocam" and a word for video — from a query that includes div
 *    and span. Ancestors come first in document order, so a wrapper always won
 *    and the click landed on a layout div. The Images tab stayed selected, and
 *    then even a correct chooser would have offered the image input.
 */

/// <reference types="node" />

import * as fs from 'fs';
import * as path from 'path';

import { openMediaDialog } from '../content/flow/libraryPicker';

const read = (rel: string) =>
  fs.readFileSync(path.resolve(__dirname, rel), 'utf8').replace(/\r\n/g, '\n');

const UPLOAD = read('../background/debugUpload.ts');
const PICKER = read('../content/flow/libraryPicker.ts');

/** Give an element a real box; jsdom reports zero for everything. */
function box(el: Element, w = 120, h = 32, top = 400): void {
  (el as HTMLElement).getBoundingClientRect = () =>
    ({ width: w, height: h, left: 10, top, right: 10 + w, bottom: top + h }) as DOMRect;
}

function boxAll(sel: string, w = 120, h = 32, top = 400): void {
  for (const el of Array.from(document.querySelectorAll(sel))) box(el, w, h, top);
}

describe('choosing the input to upload into', () => {
  /* The rule the direct route applies, mirrored so it can be exercised on a
     DOM. The source check at the end keeps this copy honest. */
  const admitsVideo = (accept: string) => {
    const a = accept.toLowerCase();
    return !a || a === '*/*' || a.includes('video') || a.includes('mp4');
  };

  const survey = () => {
    const ins = Array.from(document.querySelectorAll('input[type="file"]'));
    const accepts = ins.map((i) => (i.getAttribute('accept') || '').toLowerCase());
    return { total: ins.length, video: accepts.filter(admitsVideo).length, accepts };
  };

  it('refuses the image input that caused this', () => {
    /* The exact accept list Flow read back in the error. */
    expect(admitsVideo('.heif,.heic,.png,.jpg,.webp,.gif')).toBe(false);
  });

  it('accepts a video input, and one with no accept at all', () => {
    expect(admitsVideo('video/mp4')).toBe(true);
    expect(admitsVideo('.mp4,.mov')).toBe(true);
    expect(admitsVideo('')).toBe(true);
    expect(admitsVideo('*/*')).toBe(true);
  });

  it('does not fire when the only inputs are image-only', () => {
    /* What an Images-tab dialog looks like. Falling back is right: delivering
       here is what produced the three rejections. */
    document.body.innerHTML = `
      <input type="file" accept=".heif,.heic,.png,.jpg,.webp,.gif">
      <input type="file" accept="image/*">`;
    const s = survey();
    expect(s.total).toBe(2);
    expect(s.video).toBe(0);
  });

  it('fires when exactly one input admits video, even if it is not first', () => {
    /* The regression in one line: the image input comes first in the DOM. */
    document.body.innerHTML = `
      <input type="file" accept=".heif,.heic,.png,.jpg,.webp,.gif">
      <input type="file" accept="video/mp4">`;
    const s = survey();
    expect(s.video).toBe(1);
    const chosen = Array.from(document.querySelectorAll('input[type="file"]'))
      .find((i) => admitsVideo(i.getAttribute('accept') || ''));
    expect(chosen?.getAttribute('accept')).toBe('video/mp4');
  });

  it('hands back to the chooser when two inputs both admit video', () => {
    /* Guessing between them is the mistake this whole file is about. */
    document.body.innerHTML = `
      <input type="file" accept="video/mp4">
      <input type="file">`;
    expect(survey().video).toBe(2);
  });
});

describe('selecting the Videos tab', () => {
  /* Flow's tab, with the Material ligature rendering as text beside the word,
     wrapped in the kind of layout div that used to win. */
  /* No Upload button in the starting DOM on purpose: openMediaDialog returns
     immediately when one is already visible — correctly, since a second call
     must not close what the first opened — and the tab would never be
     reached. Pressing Videos is what reveals it, as on the real page. */
  const DIALOG = `
    <div id="wrap">
      <div id="tabs">
        <button id="images"><i class="google-symbols">image</i>Images</button>
        <button id="videos"><i class="google-symbols">videocam</i>Videos</button>
      </div>
      <input type="file" accept="video/mp4">
      <div id="revealed"></div>
    </div>`;

  /** What pressing the Videos tab does on the real page. */
  function revealUploadOnClick(id: string): void {
    document.getElementById(id)?.addEventListener('click', () => {
      const slot = document.getElementById('revealed') as HTMLElement;
      slot.innerHTML = '<button id="up"><i class="google-symbols">upload</i>Upload media</button>';
      box(slot.firstElementChild as HTMLElement);
    });
  }

  beforeEach(() => {
    document.body.innerHTML = DIALOG;
    boxAll('button, input, div');
    revealUploadOnClick('videos');
  });

  it('presses the tab, not the div that contains it', async () => {
    /* #wrap and #tabs both have textContent containing "videocam" and
       "Videos", and both come before #videos in document order — so
       first-match-wins pressed a layout div.

       Asserted on the event TARGET, not on which listeners ran: a click on the
       tab bubbles through its ancestors by design, and counting those would
       fail a correct implementation. */
    const targets: string[] = [];
    document.addEventListener('click', (e) => {
      targets.push((e.target as HTMLElement).id || 'anon');
    }, true);

    await openMediaDialog({ doc: document, step: 0 });

    expect(targets).toContain('videos');
    expect(targets).not.toContain('wrap');
    expect(targets).not.toContain('tabs');
  });

  it('the wrapper really would have matched, which is why order mattered', () => {
    const wrap = document.getElementById('wrap') as HTMLElement;
    const text = (wrap.textContent || '');
    expect(text).toContain('videocam');
    expect(text.toLowerCase()).toContain('videos');
    /* And it precedes the tab, so first-match-wins picked it. */
    const all = Array.from(document.querySelectorAll('button,div'));
    expect(all.indexOf(wrap)).toBeLessThan(
      all.indexOf(document.getElementById('videos') as HTMLElement));
  });

  it('takes the innermost match when the tab is a styled div', async () => {
    /* Flow's picker really is divs — the Upload button it ships has no role at
       all. So the rule cannot be "buttons only"; it has to be "the most
       specific element that matches", which is what makes a nested div tab
       work while its wrappers lose. */
    document.body.innerHTML = `
      <div id="outer">
        <div id="mid">
          <div id="tab" role="tab"><i class="google-symbols">videocam</i>Videos</div>
        </div>
        <input type="file" accept="video/mp4">
        <div id="revealed"></div>
      </div>`;
    boxAll('button, input, div');
    revealUploadOnClick('tab');

    const targets: string[] = [];
    document.addEventListener('click', (e) => {
      targets.push((e.target as HTMLElement).id || 'anon');
    }, true);

    await openMediaDialog({ doc: document, step: 0 });

    expect(targets).toContain('tab');
    expect(targets).not.toContain('outer');
    expect(targets).not.toContain('mid');
  });
});

describe('the shipped code matches the rules above', () => {
  it('the direct route surveys accepts before setting anything', () => {
    const fn = /async function trySetFilesDirectly\([\s\S]*?\n\}/.exec(UPLOAD) as RegExpExecArray;
    expect(fn).not.toBeNull();
    expect(fn[0].indexOf('accept')).toBeLessThan(fn[0].indexOf('DOM.setFileInputFiles'));
    expect(fn[0]).toMatch(/seen\.video !== 1/);
  });

  it('it no longer takes the first input it finds', () => {
    expect(UPLOAD).not.toMatch(/DOM\.querySelector'?,?\s*\{[\s\S]{0,80}input\[type="file"\]/);
  });

  it('it says when everything on screen is image-only', () => {
    expect(UPLOAD).toMatch(/the dialog may be on the Images tab/);
  });

  it('the tab search ranks interactive elements above wrappers', () => {
    expect(PICKER).toMatch(/const interactive = \(e: HTMLElement\): number/);
    expect(PICKER).toMatch(/videoTabs\.sort/);
    expect(PICKER).toMatch(/interactive\(a\) - interactive\(b\)/);
  });

  it('ranks by visibility without excluding on it', () => {
    /* A zero rect means "hidden" in a browser and "no layout engine" anywhere
       else. Excluding on it threw away the right answer in the second case,
       which is how seven existing picker tests went red. */
    expect(PICKER).toMatch(/const anyVisible = videoTabs\.some/);
    expect(PICKER).toMatch(/anyVisible \? visible\(a\) - visible\(b\) : 0/);
    /* The filter must test text only — no rect in it. */
    const filter = /\)\)\.filter\(\(e\) => \{[\s\S]*?\}\);/.exec(PICKER) as RegExpExecArray;
    expect(filter).not.toBeNull();
    expect(filter[0]).not.toMatch(/getBoundingClientRect/);
  });
});

describe('the project media page, as it was reported', () => {
  /* The toolbar the run listed when it could not find an upload button. There
     is no composer row and no bare "+" — the only way in is "Add Media". */
  const TOOLBAR = [
    'arrow_backGo Back', 'more_vertMore options', 'searchSearch',
    'filter_listSort & Filter', 'addAdd Media', 'helpProduct Help',
    'settings_2View Settings', 'dashboardAll Media',
    'accessibility_newCharacters', 'movieView scenes', 'apps_spark_2Tools',
    'deleteView Trash', 'left_panel_openExpand', 'add_2Create',
  ];

  function buildPage(): void {
    document.body.innerHTML = `
      <input placeholder="Search assets" />
      <div id="bar">${TOOLBAR.map((t, i) => `<button id="b${i}">${t}</button>`).join('')}</div>
      <div id="revealed"></div>`;
    boxAll('button, input, div');
  }

  it('does not call the page a dialog just because it has a search box', async () => {
    /* The regression that turned a true "the dialog did not open" into a run
       that attached the debugger and failed one step later. */
    buildPage();
    const opened = await openMediaDialog({ doc: document, step: 0 });
    expect(opened.ok).toBe(false);
  });

  it('names the toolbar when it gives up, instead of just saying no', async () => {
    buildPage();
    const opened = await openMediaDialog({ doc: document, step: 0 });
    expect(opened.ok === false && /Buttons on the page/.test(opened.reason)).toBe(true);
    expect(opened.ok === false && /addAdd Media/.test(opened.reason)).toBe(true);
  });

  it('presses Add Media, which is the only way in on this page', async () => {
    buildPage();
    const addMedia = TOOLBAR.indexOf('addAdd Media');
    document.getElementById(`b${addMedia}`)?.addEventListener('click', () => {
      const slot = document.getElementById('revealed') as HTMLElement;
      slot.innerHTML =
        '<button id="up"><i class="google-symbols">upload</i>Upload media</button>';
      box(slot.firstElementChild as HTMLElement);
    });

    const opened = await openMediaDialog({ doc: document, step: 0 });
    expect(opened.ok).toBe(true);
    expect(document.getElementById('up')).not.toBeNull();
  });

  it('is not fooled by "All Media", which opens nothing', async () => {
    /* dashboardAll Media carries a media word but no add. Pressing it filters
       the library and leaves the page exactly as it was. */
    buildPage();
    const pressed: string[] = [];
    document.addEventListener('click', (e) => {
      pressed.push(((e.target as HTMLElement).textContent || '').trim());
    }, true);

    await openMediaDialog({ doc: document, step: 0 });
    expect(pressed).not.toContain('dashboardAll Media');
  });

  it('finds Add Media in French, where the label is not English', async () => {
    document.body.innerHTML = `
      <button id="fr"><i class="google-symbols">add</i>Ajouter un média</button>
      <div id="revealed"></div>`;
    boxAll('button, div');
    document.getElementById('fr')?.addEventListener('click', () => {
      const slot = document.getElementById('revealed') as HTMLElement;
      slot.innerHTML =
        '<button id="up"><i class="google-symbols">upload</i>Importer un média</button>';
      box(slot.firstElementChild as HTMLElement);
    });

    const opened = await openMediaDialog({ doc: document, step: 0 });
    expect(opened.ok).toBe(true);
  });
});
