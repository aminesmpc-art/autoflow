/**
 * Giving a Flow video node a voice.
 *
 * Every part of this except the wiring already existed. applyVoiceIngredient
 * has opened the "+" menu, clicked the Voices tab, searched and picked a name
 * since the original extension shipped it; QueueSettings.voiceIngredient is
 * plumbed the whole way through. What was missing was any way for the canvas
 * to say which voice — the Studio queue builder passed the literal string
 * 'none' for every node ever run.
 *
 * So these tests are about the wiring, and about the one rule that is easy to
 * get wrong: Flow attaches a voice to a CHARACTER in the ingredient tray. Set
 * a voice on a shot with no reference image and Flow accepts the selection,
 * generates, and returns a silent clip. No error, nothing in the log, and the
 * only way to notice is to watch the output — which is exactly the class of
 * failure this project keeps being bitten by.
 */

/// <reference types="node" />

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { FLOW_VOICES, NO_VOICE, effectiveVoice, voiceLabel } from '../studio/flowVoices';

const ROOT = join(__dirname, '..', '..');

describe('a voice needs a character to speak through', () => {
  it('applies the voice when an image is wired in', () => {
    expect(effectiveVoice('Sulafat', true)).toBe('Sulafat');
  });

  it('drops it when there is no image', () => {
    /* Not an error: several templates legitimately set a voice on a node and
       wire the image later. Passing it through anyway would spend a
       generation to produce a clip that is silent for a reason nothing
       reports. */
    expect(effectiveVoice('Sulafat', false)).toBe(NO_VOICE);
  });

  it('passes none through untouched', () => {
    expect(effectiveVoice(NO_VOICE, true)).toBe(NO_VOICE);
    expect(effectiveVoice(undefined, true)).toBe(NO_VOICE);
    expect(effectiveVoice('', true)).toBe(NO_VOICE);
  });
});

describe('the voice list', () => {
  it('carries the descriptor, not just the name', () => {
    /* "Sadaltager" tells you nothing whatsoever. Flow's own picker shows the
       character note beside every name for that reason, and a dropdown of
       thirty star names without it would be unusable. The exact wording is
       Flow's, read off the live picker — matching it means the dropdown and
       the site agree rather than nearly agreeing. */
    const v = FLOW_VOICES.find((x) => x.id === 'Sulafat')!;
    expect(voiceLabel(v)).toBe('Sulafat — Female, warm, mid pitch');
    expect(FLOW_VOICES.every((x) => x.hint && x.sex)).toBe(true);
  });

  it('has no duplicates and is alphabetical, like the picker', () => {
    const ids = FLOW_VOICES.map((v) => v.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(ids);
  });

  it('matches the list the original extension ships', () => {
    /* The source of truth, and a claim about a file in another package. The
       two extensions drift — RUN_ACTIVE_CHECK existed in one service worker
       and not the other for months — so this reads the other file rather than
       trusting that they were copied correctly once. */
    const panel = join(ROOT, '..', 'extension', 'sidepanel.html');
    if (!existsSync(panel)) throw new Error(`Cannot verify: ${panel} is missing`);
    const html = readFileSync(panel, 'utf8');
    /* Scoped to the voice select. The panel's other dropdowns are full of
       capitalised single words too — the first version of this test read
       "English", "Arabic", "French" out of the language picker and demanded
       they be voices. */
    const at = html.indexOf('id="setting-voice"');
    expect(at).toBeGreaterThan(-1);
    const block = html.slice(at, html.indexOf('</select>', at));
    const shipped = Array.from(block.matchAll(/<option value="([A-Z][a-z]+)">/g))
      .map((m) => m[1]);
    expect(shipped.length).toBeGreaterThan(25);
    const ours = new Set(FLOW_VOICES.map((v) => v.id));
    const missing = shipped.filter((n) => !ours.has(n));
    expect(missing).toEqual([]);
  });
});

describe('the setting reaches Flow', () => {
  const runner = readFileSync(
    join(ROOT, 'src', 'studio', 'engine', 'WorkflowRunner.ts'), 'utf8');
  const flow = readFileSync(
    join(ROOT, 'src', 'content', 'flow', 'index.ts'), 'utf8');
  const node = readFileSync(
    join(ROOT, 'src', 'studio', 'nodes', 'GenerateNode.tsx'), 'utf8');

  it('the node writes it', () => {
    expect(node).toMatch(/onChange=\{\(e\) => set\('voice', e\.target\.value\)\}/);
  });

  it('the runner sends it', () => {
    /* Left out of this payload, the node's dropdown would set a field nothing
       ever read — a control that looks like it works and changes nothing. */
    expect(runner).toMatch(/voice: nodeData\.voice \|\| undefined/);
  });

  it('the queue builder uses it instead of the hardcoded none', () => {
    expect(flow).toMatch(/voiceIngredient: effectiveVoice\(config\.voice/);
    expect(flow).not.toMatch(/voiceIngredient: 'none'/);
  });

  it('the rule about images is applied where the images are known', () => {
    /* refImages is what actually reaches Flow's tray — resolved, fetched and
       registered. Deciding from the node's edges instead would say "yes" for
       a wire whose upstream produced nothing, which is the exact case the
       last-frame bug produced all afternoon. */
    expect(flow).toMatch(/effectiveVoice\(config\.voice, refImages\.length > 0\)/);
  });
});

describe('finding the picker on the page', () => {
  const automation = readFileSync(
    join(ROOT, 'src', 'content', 'flow', 'automation.ts'), 'utf8');
  const selectors = readFileSync(
    join(ROOT, 'src', 'content', 'flow', 'selectors.ts'), 'utf8');

  it('searches by the input id, not by translated placeholder text', () => {
    /* The placeholder list is a guess at which languages Flow has been
       translated into. "Search assets" is "Rechercher" for a French user, and
       a miss means the voice list is never filtered — so a name below the
       virtualised fold is never in the DOM to click, and the voice silently
       does not apply. */
    expect(automation).toMatch(/querySelector\('#add-menu-input'\)/);
  });

  it('finds the Voices tab by role and text, not by a styled-components hash', () => {
    /* The live DOM shows class="sc-16c4830a-1 dnFqQq sc-e7a64add-0 …" — those
       change on every Flow deploy. role="tab" and the word "Voices" do not. */
    expect(selectors).toMatch(/button\[role="tab"\]/);
    expect(selectors).toMatch(/endsWith\('Voices'\)/);
    expect(selectors).not.toMatch(/sc-16c4830a/);
  });
});

/**
 * Reading back which voice is set.
 *
 * Verified against the live page on 2026-08-16. After picking Sulafat, the
 * composer holds:
 *
 *   <button aria-label="Sulafat" …>
 *     <i class="google-symbols">voice_selection</i>
 *
 * The old selector looked for button[aria-label="Play audio"] and read an
 * h4[title] out of it. Neither exists — the chip has no h4 at all and its
 * label IS the name — so getActiveVoiceName returned null every single time.
 * Nothing failed loudly, which is why it survived: the voice applied fine, but
 * the "already active" shortcut could never fire, so every node reopened the
 * dialog and reselected a voice that was already set, and the closing check
 * always warned that it had found "none".
 */
describe('reading the active voice off the composer', () => {
  const selectors = readFileSync(
    join(ROOT, 'src', 'content', 'flow', 'selectors.ts'), 'utf8');
  /* Comments stripped: this file explains what the old selector got wrong, so
     the words "Play audio" and "h4[title]" appear in the prose describing the
     bug. Asserting against the raw text would have the explanation fail the
     test that the explanation is about. */
  const chip = selectors
    .slice(selectors.indexOf('export function findVoiceChip'),
           selectors.indexOf('export function isIngredientMenuOpen'))
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');

  it('matches the voice_selection icon, not a Play audio label', () => {
    expect(chip).toMatch(/voice_selection/);
    expect(chip).not.toMatch(/Play audio/);
  });

  it('takes the name from aria-label, not from an h4 that is not there', () => {
    expect(chip).toMatch(/getAttribute\('aria-label'\)/);
    expect(chip).not.toMatch(/h4\[title\]/);
  });

  it('excludes the Voices tab, which carries the same icon', () => {
    /* The tab reads "voice_selectionVoices". Matching it would report the
       tab's own label as the currently selected voice. */
    expect(chip).toMatch(/role'\) === 'tab'/);
  });
});
