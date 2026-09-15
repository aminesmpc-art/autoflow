/**
 * @jest-environment jsdom
 */

/**
 * Two ways a Motion Control piece came out wrong, and neither of them said so.
 *
 * ── 1. The character was wired with a port name its source does not have ──
 *
 * When this node still spawned an Omni node per piece, the edge from the still
 * to each of them was written with `sourceHandle: 'result'`. Only a generate
 * node has a port called that. An Image node's output handle is 'image', and
 * so is a Frame node's.
 *
 * React Flow does not report this. It resolves the handle, finds nothing, and
 * declines to draw the edge — the edge stays in the store, getNodeInputs still
 * reads it (it keys on targetHandle alone), so the picture WAS reaching the
 * generation while the canvas showed two Omni nodes hanging unconnected beside
 * it. That is the worst shape a bug can take: it looks broken, it is not, and
 * there is no way to tell from the screen which.
 *
 * The node no longer spawns anything — the pieces are rows on it, and the
 * still is sent with each generation as an ingredient. There is no edge left
 * to get wrong, which is the real fix; what remains here guards the fact that
 * made the old one wrong, for whatever writes an edge next.
 *
 * ── 2. The video was searched for on the Images tab ──
 *
 * attachFromLibrary leans on openMediaDialog to select Videos. openMediaDialog
 * presses that tab on its long route only — it has two early returns that skip
 * it, both correct for the UPLOAD path they were written for:
 *
 *   · an Upload button is already on the page, so the dialog is open
 *   · "Add Media" produced one
 *
 * Neither checks WHICH tab is showing, and Flow opens on Images. The search
 * then ran, and the result lookup is `dialog.querySelector('video')` — of
 * which the Images tab has none. So a library holding the clip answered
 * "nothing in the library matches …": a missing-file message for a file that
 * was one tab away.
 *
 * And the whole attach is best-effort: the reason was logged and the node
 * generated anyway. For a cutaway that is right — a plainer shot beats no
 * shot. For a motion piece the video IS the motion, so what came back was an
 * unrelated clip written from the prompt alone, at full price, with a green
 * tick on the node.
 */

/// <reference types="node" />

import * as fs from 'fs';
import * as path from 'path';

import {
  attachFromLibrary, videosTab, selectVideosTab, mediaDialogRoot,
  openMediaDialog, flowUiPresent, waitForFlowUi,
} from '../content/flow/libraryPicker';
import { NODE_PORTS } from '../studio/templates/validate';

const read = (rel: string) =>
  fs.readFileSync(path.resolve(__dirname, rel), 'utf8').replace(/\r\n/g, '\n');

const RUNNER = read('../studio/engine/WorkflowRunner.ts');
const FLOW = read('../content/flow/index.ts');
const BRIDGE = read('../studio/engine/bridge.ts');
const ENGINE = read('../content/flow/automation.ts');

/** jsdom reports zero for every box; the picker ranks on size. */
function box(el: Element, w = 120, h = 32, top = 400): void {
  (el as HTMLElement).getBoundingClientRect = () =>
    ({ width: w, height: h, left: 10, top, right: 10 + w, bottom: top + h }) as DOMRect;
}

function boxAll(sel: string): void {
  for (const el of Array.from(document.querySelectorAll(sel))) box(el);
}

/* ────────────────────────────────────────────────────────────────────────
   1. The character edge
   ──────────────────────────────────────────────────────────────────────── */

describe('the character reaches every piece, without an edge to draw it', () => {
  const at = () => RUNNER.indexOf('private async executeMotionNode');
  const body = () => RUNNER.slice(at(), RUNNER.indexOf('private async askAgent(', at()));

  it('is the reason a hard-coded handle was never safe', () => {
    /* The bug the spawning version shipped: an edge was written with
       `sourceHandle: 'result'`, and only a generate node has a port by that
       name. Kept as a statement of the fact, because the port table is what
       any future spawn would have to consult. */
    expect(NODE_PORTS.image.out).toContain('image');
    expect(NODE_PORTS.image.out).not.toContain('result');
    expect(NODE_PORTS.frame.out).toEqual(NODE_PORTS.image.out);
    expect(NODE_PORTS.generate.out).toContain('result');
  });

  it('reads the still off the I port of this very node', () => {
    expect(body()).toMatch(/getNodeInputs\(nodeId, edges\)\.get\('image_ref'\)/);
  });

  it('sends it with every piece, as an ingredient', () => {
    /* The same still on all of them — that is what stops the subject drifting
       between independently generated clips. */
    expect(body()).toContain('const references = [...character, ...place]');
    expect(body()).toMatch(/referenceImageData: references\.length \? references : undefined/);
  });

  it('draws no edges at all any more, so none can be wrong', () => {
    expect(body()).not.toMatch(/sourceHandle:/);
    expect(body()).not.toMatch(/setEdges/);
  });
});

/* ────────────────────────────────────────────────────────────────────────
   2. The Videos tab
   ──────────────────────────────────────────────────────────────────────── */

/**
 * A media dialog that is ALREADY OPEN, on Images, with an Upload button in it.
 *
 * This is the state openMediaDialog returns `{ok: true}` for without pressing
 * anything — and the state Flow is in right after Motion Control's own upload
 * step, which is the run where it matters most.
 */
function openOnImagesTab(): void {
  document.body.innerHTML = `
    <flow-ingredient-bar><div class="ingredient-bar-container"></div></flow-ingredient-bar>
    <div role="dialog">
      <button id="tab-images"><i class="google-symbols">image</i>Images</button>
      <button id="tab-videos"><i class="google-symbols">videocam</i>Videos</button>
      <input placeholder="Search assets" />
      <button id="up"><i class="google-symbols">upload</i>Upload</button>
      <div id="results">
        <img id="a-still" src="https://flow-content.google/image/abc" />
      </div>
      <button id="add">Add to Prompt</button>
    </div>`;
  boxAll('button');
  boxAll('input');
}

/**
 * Pressing Videos swaps the results over, and Add to Prompt closes the dialog
 * and leaves a chip — which is what attachedCount is looking at when it
 * confirms the attach really landed.
 */
function wireTabSwap(): void {
  document.getElementById('tab-videos')!.addEventListener('click', () => {
    document.getElementById('results')!.innerHTML =
      '<div class="tile" role="button"><video id="the-clip" src="blob:one"></video></div>';
    boxAll('video');
  });
  document.getElementById('add')!.addEventListener('click', () => {
    document.querySelector('[role="dialog"]')!.remove();
    document.querySelector('.ingredient-bar-container')!.innerHTML =
      '<flow-image-ingredient-chip></flow-image-ingredient-chip>';
  });
}

describe('the search runs on the Videos tab, however the dialog got open', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('finds the tab as the button, not a wrapper around it', () => {
    openOnImagesTab();
    expect(videosTab(document)?.id).toBe('tab-videos');
  });

  it('presses it, and says so when there is none', async () => {
    openOnImagesTab();
    let pressed = false;
    document.getElementById('tab-videos')!.addEventListener('click', () => { pressed = true; });
    expect(await selectVideosTab({ doc: document, step: 0 })).toBe(true);
    expect(pressed).toBe(true);

    document.body.innerHTML = '<div role="dialog"></div>';
    expect(await selectVideosTab({ doc: document, step: 0 })).toBe(false);
  });

  it('selects Videos even though openMediaDialog returned early', async () => {
    /* The regression. openMediaDialog sees an Upload button, says "already
       open", and presses nothing — so before the fix the search ran against
       the Images tab and the clip was invisible. */
    openOnImagesTab();
    wireTabSwap();

    const seen: string[] = [];
    const got = await attachFromLibrary('Motion-Control-1-part1-of-2.mp4', {
      doc: document, step: 0, log: (l) => seen.push(l),
    });

    expect(got.ok).toBe(true);
    expect(seen.join('\n')).toMatch(/attached "Motion-Control-1-part1-of-2\.mp4"/);
  });

  it('searches under the name without the extension', async () => {
    openOnImagesTab();
    wireTabSwap();
    /* Held before the run: a successful attach closes the dialog, and the
       search box goes with it. */
    const search = document.querySelector<HTMLInputElement>('input[placeholder="Search assets"]')!;
    await attachFromLibrary('Motion-Control-1-part1-of-2.mp4', { doc: document, step: 0 });
    expect(search.value).toBe('Motion-Control-1-part1-of-2');
  });

  it('says the tab is wrong rather than "nothing matches" when stills came back', async () => {
    /* Two causes, two fixes. "Nothing matches" sends someone to re-upload a
       file that is already there; naming the tab sends them here. */
    openOnImagesTab();               // no tab swap: the results stay stills
    const got = await attachFromLibrary('Motion-Control-1-part1-of-2.mp4', {
      doc: document, step: 0,
    });
    expect(got.ok).toBe(false);
    expect(got.reason).toMatch(/Images tab/);
  });
});

/* ────────────────────────────────────────────────────────────────────────
   2b. The picker with no dialog role — the live page, 01:06:52
   ──────────────────────────────────────────────────────────────────────── */

/**
 * The run that got everything right and still failed.
 *
 *   01:06:52  Flow    Stopping: the asset search box is not where it was.
 *   01:06:52  Motion  Piece 2/2 failed: The motion source
 *                     "Motion-Control-1-part2-of-2.mp4" could not be put on
 *                     the prompt — the asset search box is not where it was.
 *
 * Both pieces were cut, directed, uploaded and listed in the library. The
 * picker was open, on the Videos tab, with both clips visible in it and the
 * search box on screen. The box was exactly where it was.
 *
 * What the picker did NOT have was a dialog role. mediaDialogOpen already
 * allows for that — an Upload button is its second signal — and that is the
 * signal openMediaDialog returned ok on. attachFromLibrary then reached for
 * the picker by the other one.
 */
function pickerWithNoDialogRole(): void {
  document.body.innerHTML = `
    <flow-ingredient-bar><div class="ingredient-bar-container"></div></flow-ingredient-bar>
    <input class="search-input" aria-label="Search" placeholder="Search" id="page-search" />
    <div class="cdk-overlay-container">
      <div class="cdk-overlay-pane">
        <input class="search-input" aria-label="Search assets" placeholder="Search assets" id="asset-search" />
        <button id="tab-images"><i class="google-symbols">image</i>Images</button>
        <button id="tab-videos"><i class="google-symbols">videocam</i>Videos</button>
        <div id="results">
          <div class="tile" role="button"><video id="clip-2" src="blob:two"></video><span>Motion-Control-1-part2-of-2</span></div>
          <div class="tile" role="button"><video id="clip-1" src="blob:one"></video><span>Motion-Control-1-part1-of-2</span></div>
        </div>
        <button id="up"><i class="google-symbols">upload</i>Upload media</button>
        <button id="add">Add to prompt</button>
      </div>
    </div>`;
  boxAll('button');
  boxAll('input');
  boxAll('video');
  document.getElementById('add')!.addEventListener('click', () => {
    document.querySelector('.cdk-overlay-container')!.remove();
    document.querySelector('.ingredient-bar-container')!.innerHTML =
      '<flow-image-ingredient-chip></flow-image-ingredient-chip>';
  });
}

describe('the picker is found even with no dialog role on it', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('locates it from the Upload button, not a role', () => {
    pickerWithNoDialogRole();
    expect(document.querySelector('[role="dialog"], mat-dialog-container')).toBeNull();
    expect(mediaDialogRoot(document)?.className).toContain('cdk-overlay-pane');
  });

  it('does not answer with the whole page when there is no picker', () => {
    /* The walk up has to stop short of <body>. Returning the document would
       make every query inside it match the project page's own controls. */
    document.body.innerHTML = '<input class="search-input" placeholder="Search" />';
    expect(mediaDialogRoot(document)).toBeNull();
  });

  it('finds the picker search box and not the page one', () => {
    pickerWithNoDialogRole();
    const root = mediaDialogRoot(document)!;
    expect(root.querySelector('input.search-input')?.id).toBe('asset-search');
  });

  it('attaches the clip that this run could not', async () => {
    pickerWithNoDialogRole();
    /* Held before the run: a successful attach takes the overlay down and the
       search box goes with it. */
    const search = document.getElementById('asset-search') as HTMLInputElement;
    const seen: string[] = [];
    const got = await attachFromLibrary('Motion-Control-1-part2-of-2.mp4', {
      doc: document, step: 0, log: (l) => seen.push(l),
    });
    expect(got.reason).toBeUndefined();
    expect(got.ok).toBe(true);
    expect(search.value).toBe('Motion-Control-1-part2-of-2');
  });

  it('takes the clip it searched for, not the first one showing', () => {
    /* part1 and part2 are the same job cut in half, so grabbing the wrong one
       produces a plausible video of the wrong six seconds and nothing
       downstream can tell. The old code took the first <video> in the picker,
       which before the filter lands is whatever happened to be on screen. */
    pickerWithNoDialogRole();
    let clicked = '';
    for (const v of Array.from(document.querySelectorAll('video'))) {
      v.parentElement!.addEventListener('click', () => { clicked = v.id; });
    }
    return attachFromLibrary('Motion-Control-1-part1-of-2.mp4', { doc: document, step: 0 })
      .then((got) => {
        expect(got.ok).toBe(true);
        expect(clicked).toBe('clip-1');
      });
  });

  it('says which of the two steps failed, not one line for both', () => {
    /* "not where it was" described a missing picker and a missing search box
       equally, and they need different fixes. */
    document.body.innerHTML = '';
    return attachFromLibrary('x.mp4', { doc: document, step: 0 })
      .then((got) => expect(got.reason).not.toMatch(/asset search box is not where it was/));
  });
});

/* ────────────────────────────────────────────────────────────────────────
   2c. The add-a-video button is not the Videos tab — the live page, 01:45:35
   ──────────────────────────────────────────────────────────────────────── */

/**
 * The test that could never fail.
 *
 *   const text = (e.textContent || '').trim();
 *   return text.includes('videocam') && matchesFlowText(text, 'video');
 *
 * "videocam" CONTAINS "video". So the second half rejected nothing the first
 * half accepted, and every element carrying the icon matched — including the
 * composer's add-a-video control, which the run reported by name:
 *
 *   01:45:35  The upload failed: the media dialog did not open.
 *             Buttons on the page: … | add | addvideocam | favorite
 *
 * That button was pressed as though it were the Videos tab. Nothing opened,
 * and the failure named a tab that had never been touched.
 */
describe('the Videos tab is a tab, not an add button', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('the word test it used to rely on cannot reject anything', () => {
    /* Stated outright, because it is the whole bug and it looks like a real
       check when you read it. */
    expect('addvideocam'.includes('videocam')).toBe(true);
    expect('addvideocam'.toLowerCase().includes('video')).toBe(true);
  });

  it('does not press add-a-video believing it is the tab', () => {
    document.body.innerHTML = `
      <button id="add-video"><i class="google-symbols">add</i><i class="google-symbols">videocam</i></button>`;
    boxAll('button');
    expect(videosTab(document)).toBeNull();
  });

  it('still finds the real tab when both are on the page', () => {
    /* Exactly the composer state from that run: the add control and the tab
       side by side, the add control first in document order. */
    document.body.innerHTML = `
      <button id="add-video"><i class="google-symbols">add</i><i class="google-symbols">videocam</i></button>
      <button id="tab-videos"><i class="google-symbols">videocam</i>Videos</button>`;
    boxAll('button');
    expect(videosTab(document)?.id).toBe('tab-videos');
  });

  it('prefers the labelled tab over a bare icon, without excluding it', () => {
    /* Ranked, never filtered — this file's rule. An icon-only tab is still
       the best answer when nothing on the page carries a label. */
    document.body.innerHTML = `
      <button id="icon-only"><i class="google-symbols">videocam</i></button>
      <button id="tab-videos"><i class="google-symbols">videocam</i>Videos</button>`;
    boxAll('button');
    expect(videosTab(document)?.id).toBe('tab-videos');

    document.body.innerHTML = `
      <button id="icon-only"><i class="google-symbols">videocam</i></button>`;
    boxAll('button');
    expect(videosTab(document)?.id).toBe('icon-only');
  });

  it('waits for the dialog instead of sampling once', () => {
    /* Flow fetches the project's assets before it paints the picker, so a
       single read one step after the click calls a slow open a failure. */
    const PICKER = read('../content/flow/libraryPicker.ts');
    expect(PICKER).toMatch(/for \(let waited = 0; waited < 6000 && !mediaDialogOpen\(doc, need\); waited \+= 250\)/);
  });
});

/* ────────────────────────────────────────────────────────────────────────
   2d. The blank tab — the live page, 02:01:44
   ──────────────────────────────────────────────────────────────────────── */

/**
 * Eighty seconds of Gemini, then two seconds of Flow.
 *
 *   02:01:42  Piece 2: Ensures seamless continuity…
 *   02:01:42  Uploading 2 piece(s) to Flow
 *   02:01:44  The upload failed: the Videos tab is not where it was —
 *             Flow has changed. Buttons on the page: ⚡ Open Studio
 *
 * ONE button, and it is AutoFlow's own. Flow had painted nothing: the tab had
 * been in the background for the whole director conversation, and Chrome
 * throttles background tabs and discards them under memory pressure.
 *
 * Three separate faults in that one line:
 *
 *   · nothing brought the tab to the front first, which is what makes Chrome
 *     restore and repaint a discarded one
 *   · nothing waited for the page — every step read it once and gave up
 *   · nothing retried; one blank read cost the cut AND the director pass
 *
 * And the message blamed Google for changing a tab it had never seen.
 */
describe('a tab that has not painted is waited for, not blamed', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('knows the difference between an empty page and a loaded one', () => {
    /* The precondition stated as itself: is ANY of the things openMediaDialog
       is about to look for actually here?
     *
       A BARE `add` button is deliberately not enough. The project toolbar has
       one — aria="Add media menu" — from the instant the frame paints, and
       accepting it is what let a reloaded tab through with no composer on it.
       What counts is the composer's own +, which lives in the ingredient bar. */
    document.body.innerHTML = '<button id="ours">⚡ Open Studio</button>';
    boxAll('button');
    expect(flowUiPresent(document)).toBe(false);

    document.body.innerHTML = '<button id="ours">⚡ Open Studio</button>'
      + '<button id="toolbar-add">add</button>';
    boxAll('button');
    expect(flowUiPresent(document)).toBe(false);

    /* The composer as it really is: the + lives in flow-add-menu, inside the
       prompt box — never in the ingredient bar. flowEntryPoints.test.ts holds
       the full markup and the reason. */
    document.body.innerHTML = '<flow-base-prompt-box><div class="base-prompt-box">'
      + '<flow-add-menu><div class="add-menu-container">'
      + '<button id="plus" aria-label="Add ingredients to the prompt box">add</button>'
      + '</div></flow-add-menu></div></flow-base-prompt-box>';
    boxAll('button');
    expect(flowUiPresent(document)).toBe(true);
  });

  it('counts an open picker as painted', () => {
    document.body.innerHTML = '<button id="up"><i class="google-symbols">upload</i>Upload media</button>';
    boxAll('button');
    expect(flowUiPresent(document)).toBe(true);
  });

  it('waits for the composer to appear and returns the moment it does', async () => {
    document.body.innerHTML = '<button id="ours">⚡ Open Studio</button>';
    boxAll('button');
    setTimeout(() => {
      document.body.insertAdjacentHTML('beforeend',
        '<flow-base-prompt-box><div class="base-prompt-box">'
      + '<flow-add-menu><div class="add-menu-container">'
      + '<button id="plus" aria-label="Add ingredients to the prompt box">add</button>'
      + '</div></flow-add-menu></div></flow-base-prompt-box>');
      boxAll('button');
    }, 400);

    const said: string[] = [];
    const ok = await waitForFlowUi({ doc: document, uiWaitMs: 4000, log: (l) => said.push(l) });
    expect(ok).toBe(true);
    expect(said.join(' ')).toMatch(/has not painted its composer yet/);
    expect(said.join(' ')).toMatch(/composer appeared after/);
  });

  it('says the page never loaded rather than that Flow has changed', async () => {
    /* Two different problems needing two different answers, and the old
       message gave the wrong one for both. */
    document.body.innerHTML = '<button id="ours">⚡ Open Studio</button>';
    boxAll('button');
    const got = await openMediaDialog({ doc: document, step: 0, uiWaitMs: 60 });
    expect(got.ok).toBe(false);
    expect((got as any).reason).toMatch(/had not finished loading/);
    expect((got as any).reason).not.toMatch(/Flow has changed/);
  });

  it('brings the Flow tab to the front before asking it anything', () => {
    /* The fix that stops it happening, as opposed to recovering from it: a
       background tab is throttled, and a discarded one only repaints when it
       is activated. */
    const UP = read('../background/debugUpload.ts');
    const focus = UP.indexOf('chrome.tabs.update(tabId, { active: true })');
    const ask = UP.indexOf("chrome.tabs.sendMessage(tabId, { type: 'PREPARE_VIDEO_UPLOAD' })");
    expect(focus).toBeGreaterThan(-1);
    expect(ask).toBeGreaterThan(focus);
    expect(UP).toMatch(/chrome\.windows\.update\(tab\.windowId, \{ focused: true \}\)/);
  });

  it('tries three times, reloading the tab before the last one', () => {
    const UP = read('../background/debugUpload.ts');
    expect(UP).toMatch(/const PREPARE_ATTEMPTS = 3;/);
    expect(UP).toMatch(/for \(let attempt = 1; attempt <= PREPARE_ATTEMPTS; attempt\+\+\)/);
    expect(UP).toMatch(/if \(attempt === PREPARE_ATTEMPTS - 1\) \{/);
    expect(UP).toMatch(/tried \$\{PREPARE_ATTEMPTS\} times, reloading the tab in between/);
  });

  it('does not save the clips to disk until the picker is actually open', () => {
    /* Retrying is only cheap if nothing irreversible happened first. */
    const UP = read('../background/debugUpload.ts');
    const attempts = UP.indexOf('const PREPARE_ATTEMPTS = 3;');
    const save = UP.indexOf('await saveToDisk(file.dataUrl, file.filename)');
    expect(attempts).toBeGreaterThan(-1);
    expect(save).toBeGreaterThan(attempts);
  });
});

/* ────────────────────────────────────────────────────────────────────────
   3. A motion piece does not generate without its motion
   ──────────────────────────────────────────────────────────────────────── */

describe('a missing motion source stops the node instead of costing a clip', () => {
  it('is declared by the caller, not guessed at the far end', () => {
    expect(BRIDGE).toMatch(/styleReferenceRequired\?: boolean/);
    expect(RUNNER).toMatch(/styleReferenceRequired: nodeData\.styleReferenceRequired === true/);
  });

  it('still covers the Omni nodes an older build spawned', () => {
    /* motionFrom was stamped on every node the spawning version built and on
       nothing else. Those nodes are still sitting on canvases, and they are
       still motion pieces: a clip generated without its footage is the wrong
       job whichever build made the node. */
    expect(RUNNER).toMatch(/\|\| typeof nodeData\.motionFrom === 'string'/);
  });

  it('is handed to the engine rather than attached before it', () => {
    /* The whole reason this moved. Attached before startQueue, the chip was
       put on and taken straight off again: the engine opens the media dialog
       for the reference images, opens the ingredient menu for the voice, and
       fills the prompt, all after that point. */
    expect(FLOW).toMatch(/styleReference: String\(config\.styleReference \|\| ''\)\.trim\(\) \|\| undefined/);
    expect(FLOW).toMatch(/styleReferenceRequired: config\.styleReferenceRequired === true/);
    expect(FLOW).not.toMatch(/attachFromLibrary/);
  });

  it('attaches it at the last quiet moment before Generate', () => {
    /* After the ingredient images and the voice — both of which open dialogs
       over the composer — and before the prompt is filled. */
    const images = ENGINE.indexOf("this.state = 'ATTACH_INGREDIENT_IMAGES'");
    const voice = ENGINE.indexOf("this.state = 'APPLY_VOICE'");
    const clip = ENGINE.indexOf("this.state = 'ATTACH_LIBRARY_VIDEO'");
    const fill = ENGINE.indexOf("this.state = 'FILL_PROMPT'");
    expect(clip).toBeGreaterThan(images);
    expect(clip).toBeGreaterThan(voice);
    expect(fill).toBeGreaterThan(clip);
  });

  it('fails the prompt with the reason the attach gave', () => {
    const at = ENGINE.indexOf("this.state = 'ATTACH_LIBRARY_VIDEO'");
    const body = ENGINE.slice(at, at + 1800);
    expect(body).toMatch(/this\.queue!\.settings\.styleReferenceRequired/);
    expect(body).toMatch(/throw new Error\(/);
    expect(body).toMatch(/\$\{got\.reason\}/);
  });

  it('still steps over a failure when the reference is only a nice-to-have', () => {
    /* A cutaway's style reference. Losing it costs a plainer shot, and failing
       the node there would be a regression, not a fix. */
    const at = ENGINE.indexOf("this.state = 'ATTACH_LIBRARY_VIDEO'");
    expect(ENGINE.slice(at, at + 1800)).toMatch(/Generating without it/);
  });

  it('counts the clip as a chip before it presses Generate', () => {
    /* The guard used to run only when there were reference images, so a piece
       with no character still skipped it entirely — and that is exactly the
       run where the clip is the only ingredient there is. */
    expect(ENGINE).toMatch(/const chipsBeforeGenerate = \(prompt\.images\?\.length \|\| 0\) \+ \(libraryVideoOn \? 1 : 0\)/);
    expect(ENGINE).toMatch(/if \(chipsBeforeGenerate > 0\) \{/);
    expect(ENGINE).toMatch(/await waitForIngredients\(chipsBeforeGenerate, 20_000\)/);
  });
});
