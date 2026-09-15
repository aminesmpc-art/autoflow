/**
 * @jest-environment jsdom
 *
 * The Start/End frame bar, as it really is.
 *
 * Both fixtures below are the live composer's own HTML, pasted by the user —
 * not written from a screenshot and not inferred from the old site. Everything
 * this file asserts is a fact about that markup.
 *
 * The two states differ completely. Empty is a bare button; filled mounts a
 * custom element with a signed image in it:
 *
 *   empty    <div cdkoverlayorigin class="frame-trigger">
 *              <button class="empty-chip"> Start </button>
 *
 *   filled   <div cdkoverlayorigin class="frame-trigger">
 *              <flow-image-ingredient-chip>
 *                <button cdkoverlayorigin class="chip-container"
 *                        aria-label="Image ingredient" aria-busy="false">
 *                  <div class="chip-image-wrapper">
 *                    <img class="chip-image" src="https://flow-content.google/image/…">
 *                  <div class="hover-icon-overlay" data-state="closed">
 *                    <mat-icon class="hover-icon …">cancel</mat-icon>
 *
 * The fault that markup exposed: a filled slot contains exactly ONE button,
 * and it is the chip itself, carrying cdkoverlayorigin. Material draws icons
 * as ligatures, so that button's textContent is literally "cancel" — and
 * findFrameSlotClearButton searched for /cancel|close|clear|remove/ over
 * button text. It matched the chip, clicking it opened the picker instead of
 * clearing anything, and the run reported that the frame would not clear.
 */

/// <reference types="node" />

import {
  findFrameSlots, frameSlotFilled, frameSlotHasChip, frameSlotEmptyChip,
  findFrameSlotClearButton,
} from '../content/flow/selectors';

const NG = '_ngcontent-ng-c3276691753=""';

const SWAP = `<button ${NG} flow-icon-button="" maticonbutton=""
  class="mdc-icon-button mat-mdc-icon-button mat-mdc-button-base mat-mdc-tooltip-trigger"
  aria-label="Swap first and last frames"><span class="mat-mdc-button-persistent-ripple mdc-icon-button__ripple"></span><mat-icon ${NG} role="img"
  class="mat-icon notranslate google-symbols mat-icon-no-color" aria-hidden="true"
  data-mat-icon-type="font">swap_horiz</mat-icon><span class="mat-focus-indicator"></span></button>`;

const emptyTrigger = (word: string) =>
  `<div ${NG} cdkoverlayorigin="" class="frame-trigger"><!----><button ${NG} class="empty-chip"> ${word} </button><!----></div>`;

const filledTrigger = (uuid: string) =>
  `<div ${NG} cdkoverlayorigin="" class="frame-trigger"><flow-image-ingredient-chip ${NG} _nghost-ng-c4205958537=""><button _ngcontent-ng-c4205958537="" cdkoverlayorigin="" class="chip-container" aria-label="Image ingredient" aria-busy="false"><div _ngcontent-ng-c4205958537="" class="chip-image-wrapper"><img _ngcontent-ng-c4205958537="" alt="Ingredient image" class="chip-image" src="https://flow-content.google/image/${uuid}?Expires=1788835489&amp;KeyName=labs-flow-prod-cdn-key&amp;Signature=Rk-U-TVFoVP7brah2_X-bhwH6IU"><!----></div><!----><div _ngcontent-ng-c4205958537="" class="hover-icon-overlay" data-state="closed"><mat-icon _ngcontent-ng-c4205958537="" role="img" class="mat-icon notranslate hover-icon flow-icon-s google-symbols mat-icon-no-color" aria-hidden="true" data-mat-icon-type="font">cancel</mat-icon></div><!----></button><!----><!----></flow-image-ingredient-chip><!----><!----></div>`;

const EMPTY_BAR = `<div ${NG} class="ingredient-bar-container">${emptyTrigger('Start')}${SWAP}${emptyTrigger('End')}<!----><!----><!----></div>`;
const FILLED_BAR = `<div ${NG} class="ingredient-bar-container">${filledTrigger('4faa31f1-bbde-45c2-892d-7f7f5b834b8a')}${SWAP}${filledTrigger('56ed3f11-f783-4e6a-ae5e-0caa3d890518')}<!----><!----><!----></div>`;

/* jsdom lays nothing out, and isVisible measures a box. Without this every
   element reads as hidden for a reason unrelated to what is being tested. */
const realRect = Element.prototype.getBoundingClientRect;
beforeAll(() => {
  Element.prototype.getBoundingClientRect = function () {
    return { width: 64, height: 64, top: 0, left: 0, right: 64, bottom: 64, x: 0, y: 0,
      toJSON: () => ({}) } as DOMRect;
  };
});
afterAll(() => { Element.prototype.getBoundingClientRect = realRect; });

const mount = (html: string) => { document.body.innerHTML = html; };

describe('finding the two slots', () => {
  it('finds them either side of the swap button when empty', () => {
    mount(EMPTY_BAR);
    const slots = findFrameSlots();
    expect(slots).not.toBeNull();
    expect(slots!.start.textContent).toContain('Start');
    expect(slots!.end.textContent).toContain('End');
  });

  it('finds them when both are filled and carry no words at all', () => {
    /* A filled slot has no "Start"/"End" text left in it — the button is
       replaced by the chip — so anything matching on those words fails here.
       Position around the swap button is what survives. */
    mount(FILLED_BAR);
    const slots = findFrameSlots();
    expect(slots).not.toBeNull();
    expect(slots!.start).not.toBe(slots!.end);
  });

  it('does not mistake the swap button for a slot', () => {
    mount(FILLED_BAR);
    const slots = findFrameSlots()!;
    expect(slots.start.querySelector('mat-icon')?.textContent).not.toBe('swap_horiz');
    expect(slots.end.querySelector('mat-icon')?.textContent).not.toBe('swap_horiz');
  });
});

describe('empty or filled', () => {
  it('reads an empty slot as empty', () => {
    mount(EMPTY_BAR);
    const slots = findFrameSlots()!;
    expect(frameSlotHasChip(slots.start)).toBe(false);
    expect(frameSlotHasChip(slots.end)).toBe(false);
  });

  it('reads a filled slot as filled', () => {
    mount(FILLED_BAR);
    const slots = findFrameSlots()!;
    expect(frameSlotHasChip(slots.start)).toBe(true);
    expect(frameSlotHasChip(slots.end)).toBe(true);
  });

  it('finds the empty slot\'s own control to paste onto', () => {
    mount(EMPTY_BAR);
    const slots = findFrameSlots()!;
    const chip = frameSlotEmptyChip(slots.start);
    expect(chip).not.toBeNull();
    expect(chip!.className).toBe('empty-chip');
    expect(chip!.textContent!.trim()).toBe('Start');
  });

  it('offers no empty-chip once the slot is filled', () => {
    mount(FILLED_BAR);
    const slots = findFrameSlots()!;
    expect(frameSlotEmptyChip(slots.start)).toBeNull();
  });

  it('is stricter than frameSlotFilled, on purpose', () => {
    /* frameSlotFilled answers "has something rendered" — any loaded img, or
       any background-image. Right for that question, too loose for "did MY
       paste land": a stale thumbnail mid-removal satisfies it. */
    mount(`<div class="ingredient-bar-container">
      <div cdkoverlayorigin class="frame-trigger"><button class="empty-chip"> Start </button>
        <img src="https://example.test/unrelated.png"></div>
      ${SWAP}
      <div cdkoverlayorigin class="frame-trigger"><button class="empty-chip"> End </button></div>
    </div>`);
    const slots = findFrameSlots()!;
    expect(frameSlotHasChip(slots.start)).toBe(false);
  });
});

describe('clearing a filled slot', () => {
  it('does not hand back the chip itself', () => {
    /* The bug. Material draws icons as ligatures, so button.chip-container's
       textContent is literally "cancel" — and it carries cdkoverlayorigin, so
       clicking it opens the picker rather than clearing the frame. */
    mount(FILLED_BAR);
    const slots = findFrameSlots()!;
    const clear = findFrameSlotClearButton(slots.start);
    expect(clear).not.toBeNull();
    expect(clear!.classList.contains('chip-container')).toBe(false);
    expect(clear!.hasAttribute('cdkoverlayorigin')).toBe(false);
  });

  it('hands back the remove icon Flow actually renders', () => {
    mount(FILLED_BAR);
    const slots = findFrameSlots()!;
    const clear = findFrameSlotClearButton(slots.start)!;
    expect(clear.tagName.toLowerCase()).toBe('mat-icon');
    expect(clear.textContent).toBe('cancel');
    expect(clear.closest('.hover-icon-overlay')).not.toBeNull();
  });

  it('still finds a real remove button on a build that has one', () => {
    /* The measured case is preferred, not exclusive. */
    mount(`<div class="ingredient-bar-container">
      <div class="frame-trigger"><img src="https://flow-content.google/image/x">
        <button aria-label="Remove image">x</button></div>
      ${SWAP}
      <div class="frame-trigger"><button class="empty-chip"> End </button></div>
    </div>`);
    const slots = findFrameSlots()!;
    const clear = findFrameSlotClearButton(slots.start)!;
    expect(clear.getAttribute('aria-label')).toBe('Remove image');
  });
});

/* ── How the engine uses all of that ─────────────────────────────────────── */

import { readFileSync } from 'fs';
import { join } from 'path';

const FLOW = readFileSync(
  join(__dirname, '..', 'content', 'flow', 'automation.ts'), 'utf8').replace(/\r\n/g, '\n');

describe('the engine', () => {
  it('hovers the chip before clicking a control that only exists on hover', () => {
    /* data-state="closed" at rest. A click with no hover in front of it lands
       on nothing. */
    const at = FLOW.indexOf('private async clearFrameSlot');
    const body = FLOW.slice(at, at + 2200);
    expect(body).toMatch(/pointerover/);
    expect(body).toMatch(/const clear = findFrameSlotClearButton\(slot\);/);
    expect(body.indexOf('pointerover')).toBeLessThan(body.indexOf('findFrameSlotClearButton'));
  });

  it('closes a picker if the click opened one anyway', () => {
    /* Leaving an overlay up would put everything downstream — the prompt, the
       Generate button — behind a backdrop. */
    const at = FLOW.indexOf('private async clearFrameSlot');
    const body = FLOW.slice(at, at + 2400);
    expect(body).toMatch(/await this\.dismissDialogs\(\);/);
  });

  it('confirms on the chip Flow mounts, not on any image', () => {
    /* frameSlotHasChip, not frameSlotFilled — measured, a filled slot mounts
       <flow-image-ingredient-chip> holding an img.chip-image, which is far
       stricter than "any loaded image is present". */
    const at = FLOW.indexOf('private async pasteBothFrames');
    const body = FLOW.slice(at, at + 3200);
    expect(body).toMatch(/\.filter\(frameSlotHasChip\)/);
  });
});

/* ── "he dont click on frams botton to switch from ingradtions to frams" ──
 *
 *   22:15:22  Settings panel opened via native .click()
 *   22:15:22  WARN: Creation: Frames menu item not found
 *   22:15:29  WARN: Flow is not showing Start/End frame slots
 *   … four attempts, all identical, then the node failed.
 *
 * The second warning was downstream of the first. The mode never switched, so
 * the frame bar was never rendered, so every later "the frame buttons could
 * not be found" was about a composer that was still in Ingredients.
 *
 * The toggle markup, pasted from the live panel, is findable — findModeButton
 * already handles button[role="radio"] and mat-button-toggle button, labelText
 * strips the crop_free ligature, and the literal "Frames" matches. What it was
 * not was findable AT THAT MOMENT: the panel opened and was searched in the
 * same second, and the group carries mat-button-toggle-animations-enabled —
 * isVisible rejects anything still at opacity 0.
 */
const TOGGLE_GROUP = `<flow-toggles aria-label="Video type" class="variant-emphasized"><mat-button-toggle-group class="mat-button-toggle-group toggle-group mat-button-toggle-group-appearance-standard" role="radiogroup" aria-disabled="false"><mat-button-toggle role="presentation" class="mat-button-toggle toggle flex-toggle mat-button-toggle-appearance-standard mat-button-toggle-animations-enabled" id="mat-button-toggle-131"><button type="button" class="mat-button-toggle-button mat-focus-indicator" id="mat-button-toggle-131-button" role="radio" tabindex="-1" aria-checked="false"><span class="mat-button-toggle-label-content"><span class="toggle-label"><mat-icon role="img" class="mat-icon notranslate flow-icon-m google-symbols mat-icon-no-color" aria-hidden="true" data-mat-icon-type="font">crop_free</mat-icon><span class="toggle-text">Frames</span></span></span></button></mat-button-toggle><mat-button-toggle role="presentation" class="mat-button-toggle toggle flex-toggle mat-button-toggle-checked mat-button-toggle-appearance-standard" id="mat-button-toggle-132"><button type="button" class="mat-button-toggle-button mat-focus-indicator" id="mat-button-toggle-132-button" role="radio" tabindex="0" aria-checked="true"><span class="mat-button-toggle-label-content"><span class="toggle-label"><mat-icon role="img" class="mat-icon notranslate flow-icon-m google-symbols mat-icon-no-color" aria-hidden="true" data-mat-icon-type="font">chrome_extension</mat-icon><span class="toggle-text">Ingredients</span></span></span></button></mat-button-toggle></mat-button-toggle-group></flow-toggles>`;

describe('the creation-type toggle, from the live panel', () => {
  const { findModeButton, labelText, isTabActive } = require('../content/flow/selectors');

  it('finds Frames', () => {
    mount(TOGGLE_GROUP);
    const btn = findModeButton('Frames');
    expect(btn).not.toBeNull();
    expect(labelText(btn!)).toBe('Frames');
  });

  it('finds Ingredients, and does not confuse the two', () => {
    mount(TOGGLE_GROUP);
    expect(labelText(findModeButton('Ingredients')!)).toBe('Ingredients');
  });

  it('drops the icon ligature rather than fusing it to the word', () => {
    /* Raw textContent is "crop_freeFrames", which matches neither the literal
       nor an exact translation. */
    mount(TOGGLE_GROUP);
    expect(labelText(findModeButton('Frames')!)).not.toContain('crop_free');
  });

  it('reads which one is already chosen', () => {
    mount(TOGGLE_GROUP);
    expect(isTabActive(findModeButton('Ingredients')!)).toBe(true);
    expect(isTabActive(findModeButton('Frames')!)).toBe(false);
  });

  it('finds nothing while the panel is still animating in', () => {
    /* Not a bug in the selector — a fact about when it is asked. This is the
       state the run was in, and why one look was not enough. */
    mount(`<div style="opacity: 0">${TOGGLE_GROUP}</div>`);
    const el = document.querySelector('button[role="radio"]') as HTMLElement;
    el.style.opacity = '0';
    expect(findModeButton('Frames')).toBeNull();
  });
});

describe('the engine waits instead of asking once', () => {
  it('polls for the toggle for a few seconds', () => {
    const at = FLOW.indexOf('let item = findModeButton(label);');
    expect(at).toBeGreaterThan(-1);
    expect(FLOW.slice(at, at + 1200)).toMatch(/for \(let waited = 0; !item && waited < 3000; waited \+= 250\)/);
  });

  it('reports the toggles it could actually see', () => {
    /* "not found" alone cannot separate a renamed label from a panel that had
       not rendered from a search looking in the wrong place. */
    expect(FLOW).toMatch(/\| visible toggles: \$\{seen\.length \? seen\.join\(' , '\) : 'none'\}/);
    expect(FLOW).toMatch(/panelOpen=\$\{isSettingsPanelOpen\(\)\}/);
  });

  it('waits for the frame bar to render before declaring it absent', () => {
    const at = FLOW.indexOf('Flow is not showing Start/End frame slots after 5s');
    expect(at).toBeGreaterThan(-1);
    expect(FLOW).toMatch(/while \(!findFrameSlots\(\) && Date\.now\(\) < deadline\)/);
  });

  it('separates "not in Frames mode" from "the bar did not render"', () => {
    /* Both produced the identical sentence, and one is a switch that failed
       while the other is Angular being slow. */
    expect(FLOW).toMatch(/The composer says it IS in Frames mode, so the bar itself did not render\./);
    expect(FLOW).toMatch(/The composer is not in Frames mode — the creation-type switch did not take\./);
  });

  it('names which detector holds the settings panel open', () => {
    expect(FLOW).toMatch(/overlay=\$\{isSettingsPanelOpen\(\)\} `/);
    /* Reports the CORRECTED reading now — "are the tabs in the overlay",
       not "do the tabs exist", which was true with the panel shut. */
    expect(FLOW).toMatch(/mediaTabsInOverlay=\$\{/);
  });
});

/* ── What the diagnostic actually found ──────────────────────────────────
 *
 *   22:47:19  Media-type tabs mounted — settings panel is open
 *   22:47:19  Settings panel opened via native .click()
 *   22:47:32  WARN: Creation: Frames menu item not found | panelOpen=false
 *             | visible toggles: none
 *
 * The panel was never open. Nothing was on screen to look at, so no amount of
 * polling or widening the selector would ever have found the Frames toggle —
 * both of which I had already tried.
 *
 * waitForSettingsPanel accepted "the media-type tabs are visible" as proof the
 * panel was open, on the premise that the tabs live inside it. This Flow
 * disproves that, and the close warning said so on four separate steps of the
 * same run, every time:
 *
 *   WARN: Settings panel would not close — overlay=false mediaTabs=true
 *
 * overlay=false with mediaTabs=true is that premise failing, stated outright.
 * The tabs are visible with the panel shut. So the open reported success
 * immediately, every caller believed it, and none of them retried — except the
 * model selector, which never trusted this and recovered by reopening.
 */
describe('the settings panel has to actually be open', () => {
  it('will not take tabs outside the overlay as proof', () => {
    const at = FLOW.indexOf('private async waitForSettingsPanel');
    const body = FLOW.slice(at, FLOW.indexOf('\n  }', at));
    expect(body).toMatch(/tab && isVisible\(tab\) && tab\.closest\('\.cdk-overlay-pane'\)/);
  });

  it('keeps the signal for a build where the tabs really are inside it', () => {
    /* Corrected, not deleted — the premise held somewhere once, and the
       overlay test is what makes it self-checking. */
    const at = FLOW.indexOf('private async waitForSettingsPanel');
    const body = FLOW.slice(at, FLOW.indexOf('\n  }', at));
    expect(body).toMatch(/Media-type tabs mounted inside the overlay/);
  });

  it('applies the same correction to the close detector', () => {
    /* Counting the tabs alone meant the panel could never read as closed, so
       it warned on every run of a queue whose prompt then filled perfectly. */
    const at = FLOW.indexOf('private async closeSettingsPanel');
    const body = FLOW.slice(at, at + 1400);
    expect(body).toMatch(/return !!\(tab && tab\.closest\('\.cdk-overlay-pane'\)\);/);
  });

  it('tries the click that is known to work on this Flow first', () => {
    /* Direct evidence in the same log: the VIEW settings panel tries
       simulateClick first and opened on the first attempt all six times, while
       this panel's native click never opened anything. */
    const at = FLOW.indexOf('private async openSettingsPanel');
    const body = FLOW.slice(at, at + 2600);
    const sim = body.indexOf("name: 'dispatched pointer+mouse+click'");
    const native = body.indexOf("name: 'native .click()'");
    const react = body.indexOf("name: 'React onPointerDown'");
    expect(sim).toBeGreaterThan(-1);
    expect(native).toBeGreaterThan(sim);
    expect(react).toBeGreaterThan(native);
  });

  it('does not list the same strategy twice', () => {
    const at = FLOW.indexOf('private async openSettingsPanel');
    const body = FLOW.slice(at, at + 3000);
    expect((body.match(/name: 'dispatched pointer\+mouse\+click'/g) || []).length).toBe(1);
  });
});

/* ── "tomatch time to start why ????" ────────────────────────────────────
 *
 * Settings went 42s → 21s once the panel actually opened. What was left in
 * those 21 seconds, from the run's own timestamps:
 *
 *   22:59:56 → 23:00:06   +9.4s   creating a new project. Real work, one-off.
 *   23:00:02 → 23:00:05   ~4s     view settings, Batch, two toggles
 *   23:00:14 → 23:00:17   ~4s     view settings, Batch, two toggles — AGAIN
 *   23:00:11 → 23:00:14    3s     a probe that was expected to miss, polling
 *
 * The last two are pure waste and both are mine: ensureToggles has no
 * once-per-run guard here (the sibling extension has had one since "it keeps
 * opening"), and the poll I added last round applies to the deliberate
 * "1x"-then-"x1" probe, which knows it will miss.
 */
describe('not doing the same work twice', () => {
  it('ensures the page toggles once per run', () => {
    expect(FLOW).toMatch(/private togglesEnsured = false;/);
    const at = FLOW.indexOf('private async ensureToggles');
    const body = FLOW.slice(at, at + 1600);
    expect(body).toMatch(/if \(this\.togglesEnsured\) return;/);
  });

  it('claims the attempt before making it, not after', () => {
    /* Claiming at the end leaves it false on every early return — the panel
       not opening, the run being stopped — and the next prompt opens the panel
       again. That is exactly the bug this guard was written for elsewhere. */
    const at = FLOW.indexOf('private async ensureToggles');
    const body = FLOW.slice(at, at + 1800);
    const claim = body.indexOf('this.togglesEnsured = true;');
    const work = body.indexOf('openViewSettingsPanel');
    expect(claim).toBeGreaterThan(-1);
    expect(work).toBeGreaterThan(claim);
  });

  it('gives the claim back when the page really does reset', () => {
    /* A new project resets the toggles for real, so that one place — and only
       that one — hands the budget back. */
    const at = FLOW.indexOf('Detected Flow homepage');
    const body = FLOW.slice(at, at + 900);
    expect(body).toMatch(/this\.togglesEnsured = false;/);
  });

  it('starts each run with the claim clear', () => {
    const at = FLOW.indexOf('this.queue = queue;');
    expect(FLOW.slice(at, at + 200)).toMatch(/this\.togglesEnsured = false;/);
  });

  it('does not make a probe sit out the poll', () => {
    /* The poll exists for a real lookup, where a miss means the panel had not
       finished animating in. A probe that knows it will miss half the time
       should not pay three seconds to confirm it. */
    const at = FLOW.indexOf('let item = findModeButton(label);');
    const body = FLOW.slice(at, at + 900);
    expect(body).toMatch(/if \(!quiet\) \{/);
    expect(body.indexOf('if (!quiet)')).toBeLessThan(body.indexOf('waited < 3000'));
  });

  it('still polls for the lookups that matter', () => {
    const at = FLOW.indexOf('let item = findModeButton(label);');
    const body = FLOW.slice(at, at + 900);
    expect(body).toMatch(/for \(let waited = 0; !item && waited < 3000; waited \+= 250\)/);
  });
});

/* ── "post imagei in one time for 1s betwin them … make the checking fester" ──
 *
 *   23:01:10  Attaching 2 frame image(s) for prompt #1
 *   23:01:39  Start frame set by paste          29s
 *   23:02:07  End frame set by paste            57s for two pictures
 *
 * The paste lands on the PROMPT BOX. Neither the slot nor its empty-chip takes
 * one — and each was offered a ten-second poll before the working target was
 * reached, so twenty of those twenty-nine seconds were spent proving what the
 * previous frame had already proved. Then the second frame did it all again.
 *
 * What decides which slot a picture goes into is ORDER: Flow fills Start, then
 * End. So both are pasted, a second apart, and waited on together — two
 * uploads overlapping instead of queueing.
 */
describe('both frames go in together', () => {
  it('pastes onto the prompt box, which is what actually takes one', () => {
    const at = FLOW.indexOf('private async pasteBothFrames');
    expect(at).toBeGreaterThan(-1);
    const body = FLOW.slice(at, at + 2600);
    expect(body).toMatch(/const promptInput = findPromptInput\(\);/);
  });

  it('no longer offers the slot and the chip a ten-second poll each', () => {
    expect(FLOW).not.toMatch(/private async pasteIntoFrameSlot/);
  });

  it('leaves a second between them, because the gap is the ordering', () => {
    /* Firing both in the same tick gives Flow no way to tell which is first,
       and which slot each lands in stops being something this can promise. */
    const at = FLOW.indexOf('private async pasteBothFrames');
    const body = FLOW.slice(at, at + 2600);
    expect(body).toMatch(/if \(i < want - 1\) await sleep\(1000\);/);
  });

  it('waits for the pair, not for one and then the other', () => {
    const at = FLOW.indexOf('private async pasteBothFrames');
    const body = FLOW.slice(at, at + 3200);
    expect(body).toMatch(/\[slots\.start, slots\.end\]\.slice\(0, want\)\.filter\(frameSlotHasChip\)\.length/);
    expect(body).toMatch(/if \(filled >= want\) \{/);
  });

  it('says how far along it is while they upload', () => {
    const at = FLOW.indexOf('private async pasteBothFrames');
    const body = FLOW.slice(at, at + 3200);
    expect(body).toMatch(/in place\./);
  });

  it('keeps the picker route for a Flow that will not take a paste', () => {
    expect(FLOW).toMatch(/The frames did not take a paste — using the asset picker instead\./);
    expect(FLOW).toMatch(/await this\.selectFrameAsset\(label, mediaId, filename\)/);
  });
});

/* ── "the api seys the video is complete and thats ture but is not geting it" ──
 *
 *   23:02:51  Flow's API says this generation is completed (VIDEO_PRESENT)
 *   23:03:01  Waiting 30s — tile 9287d711 is thumbnail-only, API completed
 *   …          45s  60s  75s  90s  105s  120s  135s  150s   — then stopped by hand
 *
 * VIDEO_PRESENT means the record carries a signed /video/ URL for this
 * generation. The clip exists. What is missing is a <video> element in a
 * virtualised grid — and the run would eventually have given up with "it will
 * have no preview and nothing chained from it will have a last frame", which
 * is the warning sitting on the canvas.
 */
describe('a clip the service already has', () => {
  const IDX = readFileSync(
    join(__dirname, '..', 'content', 'flow', 'index.ts'), 'utf8').replace(/\r\n/g, '\n');

  it('ends the thumbnail wait once the API has a playable URL', () => {
    const at = IDX.indexOf('const apiUrl = apiVideoUrl();');
    expect(at).toBeGreaterThan(-1);
    expect(IDX.slice(at, at + 600)).toMatch(/if \(apiUrl && !serviceStillWorking\) \{/);
  });

  it('does not cut a render short — only a finished one', () => {
    /* serviceStillWorking is the veto. A long render must not be declared
       finished because a poster appeared. */
    const at = IDX.indexOf('const apiUrl = apiVideoUrl();');
    expect(IDX.slice(at, at + 600)).toMatch(/!serviceStillWorking/);
  });

  it('accepts only a real clip URL, not a poster or an input still', () => {
    /* A record also carries its grid poster and, on a Frames run, the two
       stills it was built from. None of those is the clip. */
    const at = IDX.indexOf('const apiVideoUrl = ()');
    const body = IDX.slice(at, at + 700);
    expect(body).toMatch(/return url\.includes\('\/video\/'\) \? url : '';/);
  });

  it('uses the URL the service issued, not one built from an id', () => {
    /* The fallback pointed at labs.google's media.getMediaUrlRedirect — an
       endpoint flow.google.com does not serve at all, so it produced a URL
       that could never load. On this site a media URL is signed and carries an
       Expires; the only working one is the one the response came with. */
    expect(IDX).toMatch(/if \(apiMatch\?\.mediaUrl && apiMatch\.mediaUrl\.includes\('\/video\/'\)\)/);
    expect(IDX).toMatch(/Took the clip URL from the API/);
  });

  it('keeps the legacy redirect below it for the old site', () => {
    expect(IDX).toMatch(/media\.getMediaUrlRedirect\?name=\$\{apiMatch\.mediaId\}/);
  });
});

/* ── "take tomatch time for setup why all this why" ──────────────────────
 *
 * I first said the panel opened and closed once per setting. It does not —
 * the log shows them sharing one opening, and the only gap in it was the probe
 * poll:
 *
 *   23:01:02  Selected Creation: Frames
 *   23:01:03  Ratio / model
 *   23:01:06  Generations / Duration / Resolution
 *
 * What is real is the close-and-reopen around the media type:
 *
 *   23:00:59  Media: Video confirmed active
 *   23:01:00  Opening settings panel …               reopening what was just shut
 *   23:01:02  Opening settings panel via native .click()
 *
 * That close exists because switching Image<->Video re-renders the whole menu,
 * and every later lookup has to see the fresh one. Sound — but it ran whether
 * or not anything switched, and on a repeat run the type is already right
 * nearly every time. The last two seconds are the reopen landing while the
 * panel is still animating out, so the first strategy misses and the fallback
 * pays for it.
 */
describe('the settings pass does not undo its own work', () => {
  it('only closes the panel when the media type really changed', () => {
    expect(FLOW).toMatch(/let mediaTypeSwitched = false;/);
    expect(FLOW).toMatch(/if \(mediaTypeSwitched\) \{\s*\n\s*await this\.closeSettingsPanel\(\);/);
  });

  it('records the switch where the click happens, not where it is decided', () => {
    /* The tab being already correct must not count — nothing re-rendered. */
    const at = FLOW.indexOf('mediaTypeSwitched = true;');
    expect(at).toBeGreaterThan(-1);
    expect(FLOW.slice(at, at + 120)).toMatch(/simulateClick\(tab\);/);
  });

  it('waits for the panel to be gone before reopening it', () => {
    /* Not a fixed sleep guessed at. The reopen was landing mid-animation, so
       the first strategy missed and the fallback cost two seconds. */
    const at = FLOW.indexOf('if (mediaTypeSwitched) {');
    const body = FLOW.slice(at, at + 400);
    expect(body).toMatch(/for \(let i = 0; i < 12 && isSettingsPanelOpen\(\); i\+\+\) await sleep\(100\);/);
  });

  it('still re-renders the menu when it has to', () => {
    /* The close is skipped, not deleted. A real Image<->Video switch leaves
       stale pre-switch nodes that the model dropdown would read. */
    const at = FLOW.indexOf('if (mediaTypeSwitched) {');
    expect(FLOW.slice(at, at + 400)).toMatch(/await this\.closeSettingsPanel\(\);/);
  });
});
