/**
 * @jest-environment jsdom
 *
 * "can you see how autoflow done this becouse is not dedaction the the image
 * is there" — a Generate Ad Clip node stopped at 20%, and af_784b3e1c.jpg
 * sitting in the Flow library on the left of the same screenshot.
 *
 * A paste does TWO things, and only one of them was being watched:
 *
 *   Flow TAKES the file      it becomes a tile in the project and the tile
 *                            prints its name once the upload has finished
 *   the composer ATTACHES    a chip appears on the prompt
 *
 * waitForIngredients watches the second. When the chip did not attach, the
 * node threw "Only 0 of 1 reference image(s) finished uploading to Flow" —
 * which was not true. The upload had finished. It was in the library.
 *
 * The sibling extension had already learned this. Its wait breaks on either
 * signal:
 *
 *     named   = mediaNamesOnPage().filter(n => !namesBefore.has(n)).length
 *     arrived = ingredientChipIds().filter(id => !before.has(id)).length
 *     if (named >= newIndices.length) break;
 *
 * Studio needs the name for a different purpose, though. A name proves the
 * file is in the PROJECT; generating still needs it on the PROMPT. So the name
 * is not taken as success here — it is taken as "the file is in the library,
 * go and pick it from there", which is the route a cached image already uses.
 */

/// <reference types="node" />

import { mediaNamesOnPage, uploadIsOnPage } from '../content/flow/selectors';

const mount = (html: string) => { document.body.innerHTML = html; };

describe('has Flow taken the file', () => {
  it('reads the name off a finished tile', () => {
    /* The footer, as Flow renders it once the upload completes. */
    mount('<span class="footer-title">af_784b3e1c.jpg</span>');
    expect(mediaNamesOnPage()).toContain('af_784b3e1c.jpg');
    expect(uploadIsOnPage('af_784b3e1c.jpg')).toBe(true);
  });

  it('reads it off the grid tile\'s label too', () => {
    /* The footer is only rendered while the tile is hovered on some builds. */
    mount('<flow-grid-tile-container aria-label="af_784b3e1c.jpg"></flow-grid-tile-container>');
    expect(uploadIsOnPage('af_784b3e1c.jpg')).toBe(true);
  });

  it('matches a name shown without its extension', () => {
    mount('<span class="footer-title">af_784b3e1c</span>');
    expect(uploadIsOnPage('af_784b3e1c.jpg')).toBe(true);
  });

  it('says no while the tile is still a percentage', () => {
    /* Mid-upload the tile exists but is blank with a percentage on it — 7% in
       the case that first showed this up. The name IS the completion. */
    mount('<flow-grid-tile-container aria-label=""><span>7%</span></flow-grid-tile-container>');
    expect(uploadIsOnPage('af_784b3e1c.jpg')).toBe(false);
  });

  it('does not match somebody else\'s upload', () => {
    mount('<span class="footer-title">VICTORIAN GENTLEMAN.jpeg</span>');
    expect(uploadIsOnPage('af_784b3e1c.jpg')).toBe(false);
  });

  it('is not fooled by an empty page', () => {
    mount('');
    expect(mediaNamesOnPage()).toEqual([]);
    expect(uploadIsOnPage('af_784b3e1c.jpg')).toBe(false);
  });

  it('refuses an empty filename rather than matching everything', () => {
    mount('<span class="footer-title">af_784b3e1c.jpg</span>');
    expect(uploadIsOnPage('')).toBe(false);
  });
});

/* ── What the node does with that ────────────────────────────────────────── */

import { readFileSync } from 'fs';
import { join } from 'path';

const FLOW = readFileSync(
  join(__dirname, '..', 'content', 'flow', 'automation.ts'), 'utf8').replace(/\r\n/g, '\n');

describe('an upload that landed but did not attach', () => {
  it('snapshots the project\'s names before pasting', () => {
    expect(FLOW).toMatch(/const namesBefore = new Set\(mediaNamesOnPage\(\)\);/);
  });

  it('asks whether the file reached Flow before calling it a failed upload', () => {
    const at = FLOW.indexOf('await waitForIngredients(wantChips');
    expect(at).toBeGreaterThan(-1);
    const body = FLOW.slice(at, at + 2600);
    expect(body).toMatch(/const landed = mediaNamesOnPage\(\)\.filter\(\(n\) => !namesBefore\.has\(n\)\)\.length;/);
    expect(body).toMatch(/uploadIsOnPage\(filenames\[idx\]\)/);
  });

  it('picks it out of the library instead of giving up', () => {
    /* The file is in the project. searchAndSelectAsset is the route a cached
       image already takes, and it is the same route here. */
    const at = FLOW.indexOf('await waitForIngredients(wantChips');
    const body = FLOW.slice(at, at + 2600);
    expect(body).toMatch(/if \(landed > 0 \|\| named\.length > 0\)/);
    expect(body).toMatch(/await this\.searchAndSelectAsset\(filenames\[idx\], addBtn as HTMLElement\);/);
  });

  it('still refuses to generate without the reference', () => {
    /* The guard this replaces was right about the important thing: generating
       with the reference silently dropped looks like it worked. What was wrong
       was the reason it gave and the recovery it never tried. */
    const at = FLOW.indexOf('await waitForIngredients(wantChips');
    const body = FLOW.slice(at, at + 2600);
    expect(body).toMatch(/Generating now would drop the reference, so this node stopped instead\./);
  });

  it('and says which of the two problems it actually hit', () => {
    /* "finished uploading" was the wrong words for a file that had finished
       uploading. The two cases need different words because they need
       different fixes. */
    const at = FLOW.indexOf('await waitForIngredients(wantChips');
    const body = FLOW.slice(at, at + 2600);
    expect(body).toMatch(/the upload is in the project but could not be attached to the prompt/);
    expect(body).not.toMatch(/reference image\(s\) finished uploading to Flow/);
  });
});

/* ── Why neither of us could see any of this ─────────────────────────────
 *
 * "same problem the imge attach but no move from the bot whyyyyyyyy" — and a
 * Live Feed showing one line, from the bridge, for the whole run.
 *
 * The Flow adapter's this.log sends type 'LOG'. That is the STANDALONE
 * extension's queue log, which its side panel reads. The Studio worker has no
 * handler for it at all — the comment above studioLog() said so in as many
 * words — so every line this adapter has ever written was invisible on the
 * canvas, which is the only place a Studio user is looking.
 *
 * "Pasted 1 image(s) — waiting for them to attach..." was in the Flow tab's
 * console the entire time. Two rounds were spent guessing at a stalled upload
 * from a screenshot instead.
 */
describe('the Flow adapter can be heard from', () => {
  it('mirrors every line into the Diagnostics feed', () => {
    const at = FLOW.indexOf('private log(level:');
    expect(at).toBeGreaterThan(-1);
    const body = FLOW.slice(at, at + 1600);
    expect(body).toMatch(/this\.studioLog\(/);
  });

  it('keeps sending the standalone extension its own log', () => {
    /* Mirrored, not moved: this file is shared with the extension whose side
       panel reads 'LOG'. Replacing it would blind that one instead. */
    const at = FLOW.indexOf('private log(level:');
    const body = FLOW.slice(at, at + 1600);
    expect(body).toMatch(/chrome\.runtime\.sendMessage\(\{ type: 'LOG', payload: entry \}\)/);
  });

  it('marks a warning as a warning in the feed', () => {
    /* The feed is one stream of plain lines and has no level of its own, so
       the level has to survive in the text or a warning reads as progress. */
    const at = FLOW.indexOf('private log(level:');
    const body = FLOW.slice(at, at + 1600);
    expect(body).toMatch(/level === 'info' \? message : `\$\{level\.toUpperCase\(\)\}: \$\{message\}`/);
  });

  it('reports what it is waiting for while it waits', () => {
    /* The ingredient wait can run ninety seconds and said nothing until it
       ended — a node at 20% with no reason given, which is what produced the
       question. */
    const SEL = readFileSync(
      join(__dirname, '..', 'content', 'flow', 'selectors.ts'), 'utf8').replace(/\r\n/g, '\n');
    const at = SEL.indexOf('export async function waitForIngredients');
    const body = SEL.slice(at, SEL.indexOf('\n}', at));
    expect(body).toMatch(/say\?: \(line: string\) => void/);
    expect(body).toMatch(/loaded\}\/\$\{expected\} loaded, \$\{boxes\} chip\(s\) attached/);
  });

  it('separates "no chip yet" from "chip with no picture"', () => {
    /* Two different problems that were reported identically — one is Flow
       still uploading, the other is the composer never attaching. */
    const SEL = readFileSync(
      join(__dirname, '..', 'content', 'flow', 'selectors.ts'), 'utf8').replace(/\r\n/g, '\n');
    const at = SEL.indexOf('export async function waitForIngredients');
    const body = SEL.slice(at, SEL.indexOf('\n}', at));
    expect(body).toMatch(/const boxes = findIngredientChips\(\)\.length;/);
    expect(body).toMatch(/const loaded = findLoadedIngredients\(\)\.length;/);
  });

  it('gives the ingredient waits a voice at every call site', () => {
    expect(FLOW).toMatch(/waitForIngredients\(wantChips, undefined, \(l\) => this\.log\('info', l\)\)/);
    expect(FLOW).toMatch(/waitForIngredients\(wantAfterUpload, undefined, \(l\) => this\.log\('info', l\)\)/);
  });
});

/* ── The picker that never closed ────────────────────────────────────────
 *
 * "STUCK HER WHYYY", with the asset picker open on screen, its search box
 * still holding af_7f075deb.jpg, and the feed ending on a success:
 *
 *   20:32:49  Found result row for "af_7f075deb.jpg". Clicking to attach...
 *   20:32:50  Searched 1/1 cached image(s)
 *   20:32:50  All 3 chip(s) attached — done!
 *
 * dismissDialogs looked for [role="dialog"], [data-radix-popper-content-wrapper]
 * and [data-state="open"][aria-haspopup]. Two of those three are Radix — the
 * Next.js Flow that no longer exists. On the Angular rebuild nothing matched,
 * `if (!openDialog) break` fired on the first pass, and no Escape was ever
 * sent. A CDK overlay lays a backdrop over the page, so every click after that
 * point went into a sheet of glass. The engine was not computing; it was
 * locked out of its own composer.
 */
describe('closing a dialog on the Flow that actually exists', () => {
  it('knows the Angular overlay, not only the Radix one', () => {
    const at = FLOW.indexOf('private async dismissDialogs()');
    expect(at).toBeGreaterThan(-1);
    const body = FLOW.slice(at, FLOW.indexOf('\n  }', FLOW.indexOf('const isOpen', at)));
    expect(body).toMatch(/\.cdk-overlay-backdrop/);
    expect(body).toMatch(/\.cdk-overlay-pane/);
    expect(body).toMatch(/\.add-menu-popover-container/);
    expect(body).toMatch(/mat-dialog-container/);
  });

  it('keeps the old selectors for anyone still on the old site', () => {
    const at = FLOW.indexOf('private async dismissDialogs()');
    const body = FLOW.slice(at, at + 2200);
    expect(body).toMatch(/data-radix-popper-content-wrapper/);
  });

  it('waits long enough for Angular to actually remove it', () => {
    /* Measured in the sibling extension: one Escape lands in about 400-500ms
       and it regularly takes two. The old 300-400ms wait checked before the
       first one had taken effect. */
    const at = FLOW.indexOf('private async dismissDialogs()');
    const body = FLOW.slice(at, at + 2400);
    expect(body).toMatch(/await sleep\(450\);/);
    expect(body).not.toMatch(/await humanDelay\(300, 500\);/);
  });

  it('clicks the backdrop when Escape will not do it', () => {
    /* document.body.click() cannot reach the body while an overlay is up —
       the backdrop is on top, so the backdrop is what has to be clicked. */
    const at = FLOW.indexOf('private async dismissDialogs()');
    const body = FLOW.slice(at, at + 2400);
    expect(body).toMatch(/const backdrop = document\.querySelector\('\.cdk-overlay-backdrop'\)/);
    expect(body).toMatch(/backdrop\.click\(\);/);
  });

  it('says so when it cannot close one, instead of carrying on silently', () => {
    /* Everything downstream — filling the prompt, clicking Generate — is
       clicking into glass at that point. That deserves a line. */
    const at = FLOW.indexOf('private async dismissDialogs()');
    const body = FLOW.slice(at, at + 2600);
    expect(body).toMatch(/A Flow dialog would not close/);
  });
});

describe('the tray settle loop stops going quiet', () => {
  it('reports the counts while it waits', () => {
    const at = FLOW.indexOf('let said = 0;');
    expect(at).toBeGreaterThan(-1);
    const body = FLOW.slice(at, at + 3200);
    expect(body).toMatch(/ingredient\(s\) ready/);
  });

  it('does not invent a reason for the extra ones', () => {
    /* This test asserted the opposite one round ago: that the line should name
       the extra chips as "left over from an earlier prompt". That was wrong.
       Omni 1.1 Flash takes up to five images AND a video, and the clipper
       attaches a video style reference from the library before the queue even
       starts — so more chips than uploaded images is the normal case.
       Narrating a cause for the difference pointed at a problem that did not
       exist, and the real one (a video chip that could never satisfy an
       img-only readiness test) went unlooked-at for a round because of it.
       Report the counts. Let the reader see them. */
    const at = FLOW.indexOf('let said = 0;');
    const body = FLOW.slice(at, at + 3200);
    expect(body).not.toMatch(/left over from an earlier prompt/);
    expect(body).toMatch(/uploaded by this prompt/);
  });
});

describe('chipSettleReport', () => {
  const SEL = readFileSync(
    join(__dirname, '..', 'content', 'flow', 'selectors.ts'), 'utf8').replace(/\r\n/g, '\n');

  it('exists so the wait can say more than yes or no', () => {
    expect(SEL).toMatch(/export function chipSettleReport\(\): \{ total: number; settled: number \}/);
  });

  it('counts a placeholder chip as not settled', () => {
    /* The pending state: a chip is present, its picture is not. That is the
       one this run was stuck on. */
    expect(SEL).toMatch(/if \(chip\.querySelector\('\.chip-placeholder'\)\) continue;/);
  });
});

/* ── "THE LOGIC IS SIMPTLE" ──────────────────────────────────────────────
 *
 * "COPY POST THE IMAHE WIAT INTELL THE NAME SHOW IN THE PAGE AND FILL THE
 * PROMPT AND START GENERETE"
 *
 * Which is what the sibling extension has always done, and what this had
 * grown out of. The gate here was ingredientChipsSettled() — PAGE-WIDE, so
 * every chip in the tray had to be showing its picture, including ones an
 * earlier prompt left behind. One image uploaded, three chips found, ninety
 * seconds spent waiting on two it never attached.
 *
 * The name is the test. Flow puts an uploaded file in the project as a tile
 * and prints its filename once it has taken it; until then the tile is blank
 * with a percentage on it.
 */
describe('the name on the page is what finishes the upload', () => {
  it('breaks the wait as soon as Flow shows the name', () => {
    const at = FLOW.indexOf('let said = 0;');
    const body = FLOW.slice(at, at + 3200);
    expect(body).toMatch(/if \(namesNow\(\)\.length >= images\.length\) break;/);
  });

  it('succeeds on the name alone', () => {
    expect(FLOW).toMatch(/if \(named >= images\.length\) \{/);
    expect(FLOW).toMatch(/the name is on the page/);
  });

  it('matches the names this prompt sent, not any new tile', () => {
    /* Another prompt's tiles must not be able to make the count up on their
       own — the same reason chip ids are compared rather than chip totals. */
    expect(FLOW).toMatch(/const namesNow = \(\): string\[\] => wantedNames\.filter\(\(f: string\) => uploadIsOnPage\(f\)\);/);
  });

  it('derives those names the same way the upload does', () => {
    /* One rule, one place. The verification cannot look for a name that only
       the batch loop knows how to build. */
    expect(FLOW).toMatch(/function uploadFilename\(file: \{ mime\?: string; id\?: string \}, fallback: string\): string/);
    expect(FLOW).toMatch(/const filenames: string\[\] = batch\.map\(/);
    expect(FLOW).toMatch(/uploadFilename\(f, `\$\{batchIdx\}_\$\{i\}`\)\)/);
    expect(FLOW).toMatch(/allFiles\.map\(\(f: any, i: number\) => uploadFilename\(f, `x_\$\{i\}`\)\)/);
  });

  it('keeps the chip route as the other way of seeing the same thing', () => {
    /* Either is enough; neither waits for the other. */
    const at = FLOW.indexOf('let said = 0;');
    const body = FLOW.slice(at, at + 3200);
    expect(body).toMatch(/if \(ready >= images\.length && ingredientChipsSettled\(\)\) break;/);
  });

  it('says the name never appeared, rather than counting boxes', () => {
    expect(FLOW).toMatch(/Flow never showed a name for \$\{images\.length - named\} of/);
  });
});

/* ── "BUT OMNI 1.1 FLASH CAN ADD UP TO 5 IMAGES AND 1 VIDEO" ─────────────
 *
 * Which is the whole thing, and the adapter did not know it.
 *
 * An ingredient chip was assumed to hold an <img>. findLoadedIngredients
 * required `img[src]` with naturalWidth > 0, and ingredientChipsSettled asks
 * that of EVERY chip in the tray — so one video reference made the answer
 * permanently false. The clipper attaches exactly that: a video already in the
 * Flow library, put on the prompt before the queue starts, so the generation
 * matches the footage it belongs beside.
 *
 * A node with a style reference therefore sat out the entire ninety-second
 * settle wait and failed, with every one of its ingredients correctly attached
 * and plainly visible on screen.
 *
 * The previous round of this file blamed the extra chips on an earlier prompt.
 * That was wrong. They were the node's own.
 */
describe('an ingredient is not always an image', () => {
  const SEL = readFileSync(
    join(__dirname, '..', 'content', 'flow', 'selectors.ts'), 'utf8').replace(/\r\n/g, '\n');

  it('counts a chip holding a clip as ready', () => {
    expect(SEL).toMatch(/function chipMediaReady\(chip: Element\): boolean/);
    const at = SEL.indexOf('function chipMediaReady');
    const body = SEL.slice(at, SEL.indexOf('\n}', at));
    expect(body).toMatch(/chip\.querySelector<HTMLVideoElement>\('video'\)/);
  });

  it('tests the clip weakly, on purpose', () => {
    /* A source or a poster. NOT readyState, which is about playback buffering
       rather than about the reference existing — and not a class name, which
       would be a guess. `video` is a tag. */
    const at = SEL.indexOf('function chipMediaReady');
    const body = SEL.slice(at, SEL.indexOf('\n}', at));
    expect(body).toMatch(/video\.getAttribute\('src'\) \|\| video\.querySelector\('source'\) \|\| video\.poster/);
    expect(body).not.toMatch(/readyState/);
  });

  it('lets a tray holding one video settle', () => {
    /* The exact condition that hung: every chip must be ready, and the video
       chip could never be. */
    const at = SEL.indexOf('export function ingredientChipsSettled');
    const body = SEL.slice(at, SEL.indexOf('\n}', at));
    expect(body).toMatch(/const video = chip\.querySelector<HTMLVideoElement>\('video'\);/);
  });

  it('counts it in the settle report too', () => {
    const at = SEL.indexOf('export function chipSettleReport');
    const body = SEL.slice(at, SEL.indexOf('\n}', at));
    expect(body).toMatch(/video && \(video\.getAttribute\('src'\)/);
  });

  it('no longer calls extra chips leftovers', () => {
    /* More chips than uploaded images is normal for Omni — up to five images
       and a video. Narrating a cause for the difference was wrong and pointed
       at a problem that did not exist. */
    expect(FLOW).not.toMatch(/left over from an earlier prompt/);
    expect(FLOW).toMatch(/ingredient\(s\) ready `\s*\n\s*\+ `\(\$\{images\.length\} uploaded by this prompt\)/);
  });

  it('says out loud that the style reference is being attached', () => {
    /* It logged to the console only, so the chip it adds looked unexplained in
       Diagnostics. It now runs INSIDE the engine — attached before the queue
       started, the chip did not survive as far as Generate — so the line goes
       through this.log like every other step. */
    expect(FLOW).toMatch(/ATTACH_LIBRARY_VIDEO/);
    expect(FLOW).toMatch(/is on the prompt as an ingredient/);
    expect(FLOW).toMatch(/log: \(line\) => this\.log\('info', line\)/);
  });
});

/* ── The run that worked, and the four things still wrong in its log ─────
 *
 * 21:14:22  Bridge  The Google Flow tab still does not answer after
 *                   re-injecting. The adapter is failing as it loads.
 * 21:14:24  Flow    Starting queue "STUDIO" with 1 prompts     ← two seconds later
 * 21:14:28  Flow    WARN: Settings panel would not close — prompt entry could
 *                   be blocked                                 ← it had closed
 * 21:14:31  Flow    WARN: Generations: 1x menu item not found
 * 21:14:31  Flow    Generations: x1 already active             ← the probe worked
 * 21:14:51  Flow    Fallback 1: simulateClick                  ← 9 seconds of
 * 21:14:53  Flow    Fallback 2: native .click()                   strategies that
 * 21:14:56  Flow    Fallback 3: dispatched Enter on prompt        do not work here
 * 21:15:03  Flow    Queue finished — Done: 0, Failed: 0, Skipped: 1
 *
 * Every one of those is a false alarm about a run that succeeded. A log that
 * cries wolf on a good run is worse than a quiet one, because the next real
 * warning is read as more of the same.
 */
describe('a good run should read like a good run', () => {
  it('tries Enter before the clicks that do not work here', () => {
    const at = FLOW.indexOf("Fallback 1: dispatched Enter on prompt");
    const clicks = FLOW.indexOf("Fallback 2: simulateClick");
    expect(at).toBeGreaterThan(-1);
    expect(clicks).toBeGreaterThan(at);
  });

  it('keeps the clicks, for the site where they are what works', () => {
    /* An ordering read off one run is a preference, not a proof. */
    expect(FLOW).toMatch(/Fallback 2: simulateClick/);
    expect(FLOW).toMatch(/Fallback 3: native \.click\(\)/);
  });

  it('says why the React strategies printed nothing', () => {
    /* They are Radix — the old Next.js Flow. On Angular none of the three
       handlers exist, so all three were skipped without a word and the silence
       read as "they ran and said nothing". */
    expect(FLOW).toMatch(/let reactSeen = false;/);
    expect(FLOW).toMatch(/No React handlers on the Generate button/);
  });

  it('does not warn about a probe that was expected to miss', () => {
    /* Generations is asked for as "1x" then "x1" because Flow has used both
       and only one exists on a given build. Warning on the first is warning
       about the expected outcome of a deliberate probe. */
    expect(FLOW).toMatch(/const applyMenuItem = async \(label: string, description: string, quiet = false\)/);
    expect(FLOW).toMatch(/if \(!quiet\) \{/);
    expect(FLOW).toMatch(/\$\{description\} menu item not found \| panelOpen=/);
    expect(FLOW).toMatch(/applyMenuItem\(genNewFmt, `Generations: \$\{genNewFmt\}`, true\)/);
  });

  it('but does warn when neither format exists', () => {
    expect(FLOW).toMatch(/neither "\$\{genNewFmt\}" nor "\$\{genOldFmt\}" is on this panel/);
  });

  it('calls a submitted prompt submitted, not skipped', () => {
    /* LITE hands a prompt to Flow and moves on, so it ends as 'submitted' and
       never reaches 'done'. Counting skipped as "neither done nor failed" made
       every successful LITE run report Skipped: 1 for a prompt Flow had
       accepted, generated and returned a clip for. */
    expect(FLOW).toMatch(/const submittedCount = this\.queue\.prompts\.filter\(p => p\.status === 'submitted'\)\.length;/);
    expect(FLOW).toMatch(/const skipped = totalPrompts - doneCount - failedCount - submittedCount;/);
    expect(FLOW).toMatch(/submittedCount \? `Submitted: \$\{submittedCount\}, ` : ''/);
  });

  it('closes the settings panel the way this Flow closes things', () => {
    /* The routine pressed on document.body — Radix's idea of an outside click.
       On this Flow the panel is a CDK overlay with a backdrop over the page, so
       a body press reaches nothing, and it warned twice in a run where the
       panel had closed and the prompt filled perfectly. */
    const at = FLOW.indexOf('private async closeSettingsPanel');
    const body = FLOW.slice(at, at + 2600);
    expect(body).toMatch(/keyCode: 27, which: 27/);
    expect(body).toMatch(/await sleep\(450\);/);
    expect(body).toMatch(/document\.querySelector\('\.cdk-overlay-backdrop'\)/);
  });

  it('names a tile it tracked correctly', () => {
    /* data-tile-id and .id are both absent on this Flow, so every line naming
       a tile said "tile ?" and every completion "(id=unknown)". */
    const IDX = readFileSync(
      join(__dirname, '..', 'content', 'flow', 'index.ts'), 'utf8').replace(/\r\n/g, '\n');
    expect(IDX).toMatch(/function tileLabel\(tile: Element\): string/);
    expect(IDX).toMatch(/\|\| flowTileIdentity\(tile\)\.slice\(0, 8\)/);
    expect(IDX).toMatch(/Tile completed! \(id=\$\{tileLabel\(trackedTile\)\}\)/);
    expect(IDX).not.toMatch(/trackedTile\.id \|\| '\?'/);
  });
});

/* ── "the new version on flow need just to port the image and itshow there
 *     without any search" ──────────────────────────────────────────────────
 *
 * Frames used to cost four dialogs and a library scan to place one picture:
 *
 *   1. open the Start picker, read EVERY asset id in the library
 *   2. open a picker, paste, poll up to 90s for a row that was not there
 *   3. open a picker, find that row by id, click it
 *   4. click "Add to Prompt", wait for the slot to fill
 *
 * All of it existed to answer "which row is ours?" — Flow renames uploads to a
 * UUID of its own, so the filename we chose is not in the picker to search
 * for. On the new Flow the question does not arise: paste the image and the
 * slot shows it.
 */
/* ── Why neither of us could see any of this ─────────────────────────────
 *
 * "same problem the imge attach but no move from the bot whyyyyyyyy" — and a
 * Live Feed showing one line, from the bridge, for the whole run.
 *
 * The Flow adapter's this.log sends type 'LOG'. That is the STANDALONE
 * extension's queue log, which its side panel reads. The Studio worker has no
 * handler for it at all — the comment above studioLog() said so in as many
 * words — so every line this adapter has ever written was invisible on the
 * canvas, which is the only place a Studio user is looking.
 *
 * "Pasted 1 image(s) — waiting for them to attach..." was in the Flow tab's
 * console the entire time. Two rounds were spent guessing at a stalled upload
 * from a screenshot instead.
 */
describe('the Flow adapter can be heard from', () => {
  it('mirrors every line into the Diagnostics feed', () => {
    const at = FLOW.indexOf('private log(level:');
    expect(at).toBeGreaterThan(-1);
    const body = FLOW.slice(at, at + 1600);
    expect(body).toMatch(/this\.studioLog\(/);
  });

  it('keeps sending the standalone extension its own log', () => {
    /* Mirrored, not moved: this file is shared with the extension whose side
       panel reads 'LOG'. Replacing it would blind that one instead. */
    const at = FLOW.indexOf('private log(level:');
    const body = FLOW.slice(at, at + 1600);
    expect(body).toMatch(/chrome\.runtime\.sendMessage\(\{ type: 'LOG', payload: entry \}\)/);
  });

  it('marks a warning as a warning in the feed', () => {
    /* The feed is one stream of plain lines and has no level of its own, so
       the level has to survive in the text or a warning reads as progress. */
    const at = FLOW.indexOf('private log(level:');
    const body = FLOW.slice(at, at + 1600);
    expect(body).toMatch(/level === 'info' \? message : `\$\{level\.toUpperCase\(\)\}: \$\{message\}`/);
  });

  it('reports what it is waiting for while it waits', () => {
    /* The ingredient wait can run ninety seconds and said nothing until it
       ended — a node at 20% with no reason given, which is what produced the
       question. */
    const SEL = readFileSync(
      join(__dirname, '..', 'content', 'flow', 'selectors.ts'), 'utf8').replace(/\r\n/g, '\n');
    const at = SEL.indexOf('export async function waitForIngredients');
    const body = SEL.slice(at, SEL.indexOf('\n}', at));
    expect(body).toMatch(/say\?: \(line: string\) => void/);
    expect(body).toMatch(/loaded\}\/\$\{expected\} loaded, \$\{boxes\} chip\(s\) attached/);
  });

  it('separates "no chip yet" from "chip with no picture"', () => {
    /* Two different problems that were reported identically — one is Flow
       still uploading, the other is the composer never attaching. */
    const SEL = readFileSync(
      join(__dirname, '..', 'content', 'flow', 'selectors.ts'), 'utf8').replace(/\r\n/g, '\n');
    const at = SEL.indexOf('export async function waitForIngredients');
    const body = SEL.slice(at, SEL.indexOf('\n}', at));
    expect(body).toMatch(/const boxes = findIngredientChips\(\)\.length;/);
    expect(body).toMatch(/const loaded = findLoadedIngredients\(\)\.length;/);
  });

  it('gives the ingredient waits a voice at every call site', () => {
    expect(FLOW).toMatch(/waitForIngredients\(wantChips, undefined, \(l\) => this\.log\('info', l\)\)/);
    expect(FLOW).toMatch(/waitForIngredients\(wantAfterUpload, undefined, \(l\) => this\.log\('info', l\)\)/);
  });
});

/* ── The picker that never closed ────────────────────────────────────────
 *
 * "STUCK HER WHYYY", with the asset picker open on screen, its search box
 * still holding af_7f075deb.jpg, and the feed ending on a success:
 *
 *   20:32:49  Found result row for "af_7f075deb.jpg". Clicking to attach...
 *   20:32:50  Searched 1/1 cached image(s)
 *   20:32:50  All 3 chip(s) attached — done!
 *
 * dismissDialogs looked for [role="dialog"], [data-radix-popper-content-wrapper]
 * and [data-state="open"][aria-haspopup]. Two of those three are Radix — the
 * Next.js Flow that no longer exists. On the Angular rebuild nothing matched,
 * `if (!openDialog) break` fired on the first pass, and no Escape was ever
 * sent. A CDK overlay lays a backdrop over the page, so every click after that
 * point went into a sheet of glass. The engine was not computing; it was
 * locked out of its own composer.
 */
describe('closing a dialog on the Flow that actually exists', () => {
  it('knows the Angular overlay, not only the Radix one', () => {
    const at = FLOW.indexOf('private async dismissDialogs()');
    expect(at).toBeGreaterThan(-1);
    const body = FLOW.slice(at, FLOW.indexOf('\n  }', FLOW.indexOf('const isOpen', at)));
    expect(body).toMatch(/\.cdk-overlay-backdrop/);
    expect(body).toMatch(/\.cdk-overlay-pane/);
    expect(body).toMatch(/\.add-menu-popover-container/);
    expect(body).toMatch(/mat-dialog-container/);
  });

  it('keeps the old selectors for anyone still on the old site', () => {
    const at = FLOW.indexOf('private async dismissDialogs()');
    const body = FLOW.slice(at, at + 2200);
    expect(body).toMatch(/data-radix-popper-content-wrapper/);
  });

  it('waits long enough for Angular to actually remove it', () => {
    /* Measured in the sibling extension: one Escape lands in about 400-500ms
       and it regularly takes two. The old 300-400ms wait checked before the
       first one had taken effect. */
    const at = FLOW.indexOf('private async dismissDialogs()');
    const body = FLOW.slice(at, at + 2400);
    expect(body).toMatch(/await sleep\(450\);/);
    expect(body).not.toMatch(/await humanDelay\(300, 500\);/);
  });

  it('clicks the backdrop when Escape will not do it', () => {
    /* document.body.click() cannot reach the body while an overlay is up —
       the backdrop is on top, so the backdrop is what has to be clicked. */
    const at = FLOW.indexOf('private async dismissDialogs()');
    const body = FLOW.slice(at, at + 2400);
    expect(body).toMatch(/const backdrop = document\.querySelector\('\.cdk-overlay-backdrop'\)/);
    expect(body).toMatch(/backdrop\.click\(\);/);
  });

  it('says so when it cannot close one, instead of carrying on silently', () => {
    /* Everything downstream — filling the prompt, clicking Generate — is
       clicking into glass at that point. That deserves a line. */
    const at = FLOW.indexOf('private async dismissDialogs()');
    const body = FLOW.slice(at, at + 2600);
    expect(body).toMatch(/A Flow dialog would not close/);
  });
});

describe('the tray settle loop stops going quiet', () => {
  it('reports the counts while it waits', () => {
    const at = FLOW.indexOf('let said = 0;');
    expect(at).toBeGreaterThan(-1);
    const body = FLOW.slice(at, at + 3200);
    expect(body).toMatch(/ingredient\(s\) ready/);
  });

  it('does not invent a reason for the extra ones', () => {
    /* This test asserted the opposite one round ago: that the line should name
       the extra chips as "left over from an earlier prompt". That was wrong.
       Omni 1.1 Flash takes up to five images AND a video, and the clipper
       attaches a video style reference from the library before the queue even
       starts — so more chips than uploaded images is the normal case.
       Narrating a cause for the difference pointed at a problem that did not
       exist, and the real one (a video chip that could never satisfy an
       img-only readiness test) went unlooked-at for a round because of it.
       Report the counts. Let the reader see them. */
    const at = FLOW.indexOf('let said = 0;');
    const body = FLOW.slice(at, at + 3200);
    expect(body).not.toMatch(/left over from an earlier prompt/);
    expect(body).toMatch(/uploaded by this prompt/);
  });
});

describe('chipSettleReport', () => {
  const SEL = readFileSync(
    join(__dirname, '..', 'content', 'flow', 'selectors.ts'), 'utf8').replace(/\r\n/g, '\n');

  it('exists so the wait can say more than yes or no', () => {
    expect(SEL).toMatch(/export function chipSettleReport\(\): \{ total: number; settled: number \}/);
  });

  it('counts a placeholder chip as not settled', () => {
    /* The pending state: a chip is present, its picture is not. That is the
       one this run was stuck on. */
    expect(SEL).toMatch(/if \(chip\.querySelector\('\.chip-placeholder'\)\) continue;/);
  });
});

/* ── "THE LOGIC IS SIMPTLE" ──────────────────────────────────────────────
 *
 * "COPY POST THE IMAHE WIAT INTELL THE NAME SHOW IN THE PAGE AND FILL THE
 * PROMPT AND START GENERETE"
 *
 * Which is what the sibling extension has always done, and what this had
 * grown out of. The gate here was ingredientChipsSettled() — PAGE-WIDE, so
 * every chip in the tray had to be showing its picture, including ones an
 * earlier prompt left behind. One image uploaded, three chips found, ninety
 * seconds spent waiting on two it never attached.
 *
 * The name is the test. Flow puts an uploaded file in the project as a tile
 * and prints its filename once it has taken it; until then the tile is blank
 * with a percentage on it.
 */
describe('the name on the page is what finishes the upload', () => {
  it('breaks the wait as soon as Flow shows the name', () => {
    const at = FLOW.indexOf('let said = 0;');
    const body = FLOW.slice(at, at + 3200);
    expect(body).toMatch(/if \(namesNow\(\)\.length >= images\.length\) break;/);
  });

  it('succeeds on the name alone', () => {
    expect(FLOW).toMatch(/if \(named >= images\.length\) \{/);
    expect(FLOW).toMatch(/the name is on the page/);
  });

  it('matches the names this prompt sent, not any new tile', () => {
    /* Another prompt's tiles must not be able to make the count up on their
       own — the same reason chip ids are compared rather than chip totals. */
    expect(FLOW).toMatch(/const namesNow = \(\): string\[\] => wantedNames\.filter\(\(f: string\) => uploadIsOnPage\(f\)\);/);
  });

  it('derives those names the same way the upload does', () => {
    /* One rule, one place. The verification cannot look for a name that only
       the batch loop knows how to build. */
    expect(FLOW).toMatch(/function uploadFilename\(file: \{ mime\?: string; id\?: string \}, fallback: string\): string/);
    expect(FLOW).toMatch(/const filenames: string\[\] = batch\.map\(/);
    expect(FLOW).toMatch(/uploadFilename\(f, `\$\{batchIdx\}_\$\{i\}`\)\)/);
    expect(FLOW).toMatch(/allFiles\.map\(\(f: any, i: number\) => uploadFilename\(f, `x_\$\{i\}`\)\)/);
  });

  it('keeps the chip route as the other way of seeing the same thing', () => {
    /* Either is enough; neither waits for the other. */
    const at = FLOW.indexOf('let said = 0;');
    const body = FLOW.slice(at, at + 3200);
    expect(body).toMatch(/if \(ready >= images\.length && ingredientChipsSettled\(\)\) break;/);
  });

  it('says the name never appeared, rather than counting boxes', () => {
    expect(FLOW).toMatch(/Flow never showed a name for \$\{images\.length - named\} of/);
  });
});

/* ── "BUT OMNI 1.1 FLASH CAN ADD UP TO 5 IMAGES AND 1 VIDEO" ─────────────
 *
 * Which is the whole thing, and the adapter did not know it.
 *
 * An ingredient chip was assumed to hold an <img>. findLoadedIngredients
 * required `img[src]` with naturalWidth > 0, and ingredientChipsSettled asks
 * that of EVERY chip in the tray — so one video reference made the answer
 * permanently false. The clipper attaches exactly that: a video already in the
 * Flow library, put on the prompt before the queue starts, so the generation
 * matches the footage it belongs beside.
 *
 * A node with a style reference therefore sat out the entire ninety-second
 * settle wait and failed, with every one of its ingredients correctly attached
 * and plainly visible on screen.
 *
 * The previous round of this file blamed the extra chips on an earlier prompt.
 * That was wrong. They were the node's own.
 */
describe('an ingredient is not always an image', () => {
  const SEL = readFileSync(
    join(__dirname, '..', 'content', 'flow', 'selectors.ts'), 'utf8').replace(/\r\n/g, '\n');

  it('counts a chip holding a clip as ready', () => {
    expect(SEL).toMatch(/function chipMediaReady\(chip: Element\): boolean/);
    const at = SEL.indexOf('function chipMediaReady');
    const body = SEL.slice(at, SEL.indexOf('\n}', at));
    expect(body).toMatch(/chip\.querySelector<HTMLVideoElement>\('video'\)/);
  });

  it('tests the clip weakly, on purpose', () => {
    /* A source or a poster. NOT readyState, which is about playback buffering
       rather than about the reference existing — and not a class name, which
       would be a guess. `video` is a tag. */
    const at = SEL.indexOf('function chipMediaReady');
    const body = SEL.slice(at, SEL.indexOf('\n}', at));
    expect(body).toMatch(/video\.getAttribute\('src'\) \|\| video\.querySelector\('source'\) \|\| video\.poster/);
    expect(body).not.toMatch(/readyState/);
  });

  it('lets a tray holding one video settle', () => {
    /* The exact condition that hung: every chip must be ready, and the video
       chip could never be. */
    const at = SEL.indexOf('export function ingredientChipsSettled');
    const body = SEL.slice(at, SEL.indexOf('\n}', at));
    expect(body).toMatch(/const video = chip\.querySelector<HTMLVideoElement>\('video'\);/);
  });

  it('counts it in the settle report too', () => {
    const at = SEL.indexOf('export function chipSettleReport');
    const body = SEL.slice(at, SEL.indexOf('\n}', at));
    expect(body).toMatch(/video && \(video\.getAttribute\('src'\)/);
  });

  it('no longer calls extra chips leftovers', () => {
    /* More chips than uploaded images is normal for Omni — up to five images
       and a video. Narrating a cause for the difference was wrong and pointed
       at a problem that did not exist. */
    expect(FLOW).not.toMatch(/left over from an earlier prompt/);
    expect(FLOW).toMatch(/ingredient\(s\) ready `\s*\n\s*\+ `\(\$\{images\.length\} uploaded by this prompt\)/);
  });

  it('says out loud that the style reference is being attached', () => {
    /* It logged to the console only, so the chip it adds looked unexplained in
       Diagnostics. It now runs INSIDE the engine — attached before the queue
       started, the chip did not survive as far as Generate — so the line goes
       through this.log like every other step. */
    expect(FLOW).toMatch(/ATTACH_LIBRARY_VIDEO/);
    expect(FLOW).toMatch(/is on the prompt as an ingredient/);
    expect(FLOW).toMatch(/log: \(line\) => this\.log\('info', line\)/);
  });
});

/* ── The run that worked, and the four things still wrong in its log ─────
 *
 * 21:14:22  Bridge  The Google Flow tab still does not answer after
 *                   re-injecting. The adapter is failing as it loads.
 * 21:14:24  Flow    Starting queue "STUDIO" with 1 prompts     ← two seconds later
 * 21:14:28  Flow    WARN: Settings panel would not close — prompt entry could
 *                   be blocked                                 ← it had closed
 * 21:14:31  Flow    WARN: Generations: 1x menu item not found
 * 21:14:31  Flow    Generations: x1 already active             ← the probe worked
 * 21:14:51  Flow    Fallback 1: simulateClick                  ← 9 seconds of
 * 21:14:53  Flow    Fallback 2: native .click()                   strategies that
 * 21:14:56  Flow    Fallback 3: dispatched Enter on prompt        do not work here
 * 21:15:03  Flow    Queue finished — Done: 0, Failed: 0, Skipped: 1
 *
 * Every one of those is a false alarm about a run that succeeded. A log that
 * cries wolf on a good run is worse than a quiet one, because the next real
 * warning is read as more of the same.
 */
describe('a good run should read like a good run', () => {
  it('tries Enter before the clicks that do not work here', () => {
    const at = FLOW.indexOf("Fallback 1: dispatched Enter on prompt");
    const clicks = FLOW.indexOf("Fallback 2: simulateClick");
    expect(at).toBeGreaterThan(-1);
    expect(clicks).toBeGreaterThan(at);
  });

  it('keeps the clicks, for the site where they are what works', () => {
    /* An ordering read off one run is a preference, not a proof. */
    expect(FLOW).toMatch(/Fallback 2: simulateClick/);
    expect(FLOW).toMatch(/Fallback 3: native \.click\(\)/);
  });

  it('says why the React strategies printed nothing', () => {
    /* They are Radix — the old Next.js Flow. On Angular none of the three
       handlers exist, so all three were skipped without a word and the silence
       read as "they ran and said nothing". */
    expect(FLOW).toMatch(/let reactSeen = false;/);
    expect(FLOW).toMatch(/No React handlers on the Generate button/);
  });

  it('does not warn about a probe that was expected to miss', () => {
    /* Generations is asked for as "1x" then "x1" because Flow has used both
       and only one exists on a given build. Warning on the first is warning
       about the expected outcome of a deliberate probe. */
    expect(FLOW).toMatch(/const applyMenuItem = async \(label: string, description: string, quiet = false\)/);
    expect(FLOW).toMatch(/if \(!quiet\) \{/);
    expect(FLOW).toMatch(/\$\{description\} menu item not found \| panelOpen=/);
    expect(FLOW).toMatch(/applyMenuItem\(genNewFmt, `Generations: \$\{genNewFmt\}`, true\)/);
  });

  it('but does warn when neither format exists', () => {
    expect(FLOW).toMatch(/neither "\$\{genNewFmt\}" nor "\$\{genOldFmt\}" is on this panel/);
  });

  it('calls a submitted prompt submitted, not skipped', () => {
    /* LITE hands a prompt to Flow and moves on, so it ends as 'submitted' and
       never reaches 'done'. Counting skipped as "neither done nor failed" made
       every successful LITE run report Skipped: 1 for a prompt Flow had
       accepted, generated and returned a clip for. */
    expect(FLOW).toMatch(/const submittedCount = this\.queue\.prompts\.filter\(p => p\.status === 'submitted'\)\.length;/);
    expect(FLOW).toMatch(/const skipped = totalPrompts - doneCount - failedCount - submittedCount;/);
    expect(FLOW).toMatch(/submittedCount \? `Submitted: \$\{submittedCount\}, ` : ''/);
  });

  it('closes the settings panel the way this Flow closes things', () => {
    /* The routine pressed on document.body — Radix's idea of an outside click.
       On this Flow the panel is a CDK overlay with a backdrop over the page, so
       a body press reaches nothing, and it warned twice in a run where the
       panel had closed and the prompt filled perfectly. */
    const at = FLOW.indexOf('private async closeSettingsPanel');
    const body = FLOW.slice(at, at + 2600);
    expect(body).toMatch(/keyCode: 27, which: 27/);
    expect(body).toMatch(/await sleep\(450\);/);
    expect(body).toMatch(/document\.querySelector\('\.cdk-overlay-backdrop'\)/);
  });

  it('names a tile it tracked correctly', () => {
    /* data-tile-id and .id are both absent on this Flow, so every line naming
       a tile said "tile ?" and every completion "(id=unknown)". */
    const IDX = readFileSync(
      join(__dirname, '..', 'content', 'flow', 'index.ts'), 'utf8').replace(/\r\n/g, '\n');
    expect(IDX).toMatch(/function tileLabel\(tile: Element\): string/);
    expect(IDX).toMatch(/\|\| flowTileIdentity\(tile\)\.slice\(0, 8\)/);
    expect(IDX).toMatch(/Tile completed! \(id=\$\{tileLabel\(trackedTile\)\}\)/);
    expect(IDX).not.toMatch(/trackedTile\.id \|\| '\?'/);
  });
});
