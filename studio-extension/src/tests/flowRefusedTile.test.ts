/**
 * @jest-environment jsdom
 */

/// <reference types="node" />

/**
 * A refused generation, seen by the node waiting for it.
 *
 * Reported 2026-10-01: the Motion panel sat on "Generating piece 1 of 2 —
 * Generating in Flow… 4:24 elapsed" beside a tile Flow had already marked
 *
 *   Failed — This generation might violate our policies. Please try a
 *   different prompt or send feedback. You have not been charged.
 *
 * The poller read the tile as failed and then overruled itself: on this Flow
 * the API never says "failed" — it says "generating" until media arrives, and
 * a refused generation never gets media — and a guard let that "generating"
 * outrank the page. The tile below is the user's own, copied from DevTools,
 * with the signed media links replaced.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import {
  getStudioTileState, flowErrorTile, flowErrorReason, flowFailureMessage, isPriorFailure, PRIOR_FAILURE,
} from '../content/flow/tileState';
import { findRowForPrompt } from '../content/flow/selectors';

const POLICY = 'This generation might violate our policies. Please try a different prompt or send feedback.';
const PEOPLE = 'This prompt might violate our policies about generating prominent people. Please try a different prompt or send feedback.';
const PROMPT = 'The provided character from this image dancing. Keep the environment from the input video, '
  + 'match the lighting, grade and framing of the input video.';

/** One batch as the Angular Flow renders a refused generation. */
function failedBatch(reason: string, prompt = PROMPT, extraTileFurniture = ''): string {
  return `
<div class="batch-container virtual-item-container">
  <div class="batch-tiles-section"><div class="tile-row">
    <flow-grid-tile-container class="mat-context-menu-trigger" aria-label="Character dancing in video">
      <flow-tile-container><div class="container">
        <flow-video-tile><div class="container">
          <flow-error-tile><div class="error-tile"><div class="error-tile-content">
            <div class="error-message">
              <mat-icon role="img" class="mat-icon notranslate error-icon google-symbols" aria-hidden="true">warning</mat-icon>
              <div class="error-title">Failed</div>
              <div class="error-subtitle"><span class="error-message-text"><!----> ${reason} <!----></span><span class="disclaimer-message">You have not been charged for this generation.</span></div>
            </div>
            <div class="buttons-container">
              <button aria-label="Retry"><mat-icon class="mat-icon google-symbols">refresh</mat-icon></button>
              <button aria-label="Reuse prompt"><mat-icon class="mat-icon google-symbols">undo</mat-icon></button>
              <button aria-label="Delete"><mat-icon class="mat-icon google-symbols">delete_forever</mat-icon></button>
            </div>
          </div></div></flow-error-tile>${extraTileFurniture}
        </div></flow-video-tile>
      </div></flow-tile-container>
    </flow-grid-tile-container>
  </div></div>
  <flow-batch-info>
    <div class="batch-toolbar"><button aria-label="Download batch"><mat-icon>download</mat-icon></button></div>
    <div class="below-toolbar">
      <flow-expandable-prompt class="prompt inline"><div class="expandable-prompt-container">
        <div class="prompt-text"><span class="text-part">${prompt}</span></div>
        <div class="prompt-actions"><button class="action-button reuse-prompt-button" aria-label="Reuse prompt"><mat-icon>keyboard_return</mat-icon></button></div>
      </div></flow-expandable-prompt>
      <div class="ingredients-list">
        <flow-ingredient-chip><flow-image-ingredient-chip><button class="chip-container"><div class="chip-image-wrapper"><img alt="Ingredient image" class="chip-image" src="https://flow-content.google/image/00000000-0000-4000-8000-000000000001"></div></button></flow-image-ingredient-chip></flow-ingredient-chip>
        <flow-ingredient-chip><flow-video-ingredient-chip><button class="chip-container"><div class="chip-image-wrapper"><img alt="Video ingredient image" class="chip-image" src="https://flow-content.google/image/00000000-0000-4000-8000-000000000002"></div><mat-icon class="type-badge google-symbols">videocam</mat-icon></button></flow-video-ingredient-chip></flow-ingredient-chip>
      </div>
      <div class="metadata"><div class="metadata-row"> Created Oct 1, 2026 </div><div class="metadata-row"><span>Omni 1.1 Flash</span><span>720p</span><span>5s</span><span>9:16</span></div></div>
    </div>
  </flow-batch-info>
</div>`;
}

const tileIn = (root: ParentNode): Element => root.querySelector('flow-video-tile')!;
afterEach(() => { document.body.innerHTML = ''; });

describe('a refused generation reads as failed, by Flow\'s own component', () => {
  it('is failed, whether a clip or a still was asked for', () => {
    document.body.innerHTML = failedBatch(POLICY);
    expect(flowErrorTile(tileIn(document))).not.toBeNull();
    expect(getStudioTileState(tileIn(document), true)).toBe('failed');
    expect(getStudioTileState(tileIn(document), false)).toBe('failed');
  });

  it('is failed even with furniture that would otherwise read as finished', () => {
    /* A video tile's type icon is play_circle from the moment it mounts; the
       component is checked before any of that is looked at. */
    document.body.innerHTML = failedBatch(POLICY, PROMPT,
      '<div class="type-icon-container"><mat-icon class="google-symbols">play_circle</mat-icon></div>');
    expect(getStudioTileState(tileIn(document), true)).toBe('failed');
  });

  it('is not failed without the component, whatever the prompt says', () => {
    document.body.innerHTML = failedBatch(POLICY, 'A hunter rejected the shelter, the plan failed, the road was blocked');
    tileIn(document).querySelector('flow-error-tile')!.remove();
    expect(getStudioTileState(tileIn(document), true)).not.toBe('failed');
  });
});

describe('the node says what Flow said', () => {
  it('quotes the reason, and that it cost nothing', () => {
    document.body.innerHTML = failedBatch(POLICY);
    expect(flowErrorReason(tileIn(document))).toEqual({ reason: POLICY, notCharged: true });
    expect(flowFailureMessage(tileIn(document))).toBe(`Flow: ${POLICY} (Not charged.)`);
  });

  it('says plainly when rewording cannot help', () => {
    /* "Prominent people" is Flow's judgment about the picture. The user was
       retrying with new wording against an image no wording changes. */
    document.body.innerHTML = failedBatch(PEOPLE);
    const said = flowFailureMessage(tileIn(document));
    expect(said).toContain(PEOPLE);
    expect(said).toMatch(/Rewording the prompt will not change that; use a different reference\./);
    expect(flowFailureMessage(document.createElement('flow-video-tile'))).toBe('');
  });
});

describe('an earlier attempt\'s failure is not this attempt\'s', () => {
  it('finds the new failure, not the old one with the same prompt', () => {
    /* Newest first, as Flow lists them. The old one was marked before submit. */
    document.body.innerHTML = failedBatch(POLICY) + failedBatch(PEOPLE);
    const [fresh, old] = Array.from(document.querySelectorAll('flow-error-tile'));
    old.setAttribute(PRIOR_FAILURE, '');
    const skip = (row: { element: Element }) => isPriorFailure(row.element);
    const row = findRowForPrompt(PROMPT, undefined, skip);
    expect(row?.element.contains(fresh)).toBe(true);
    expect(isPriorFailure(row!.element)).toBe(false);
  });

  it('adopts no row at all when the only match is an old failure', () => {
    /* Without the mark, the poller adopts the earlier attempt's failed tile
       and fails the retry the moment it is submitted. */
    document.body.innerHTML = failedBatch(PEOPLE);
    document.querySelector('flow-error-tile')!.setAttribute(PRIOR_FAILURE, '');
    expect(findRowForPrompt(PROMPT, undefined, (row) => isPriorFailure(row.element))).toBeNull();
    expect(findRowForPrompt(PROMPT)).not.toBeNull();
  });
});

describe('the poller acts on it', () => {
  const SRC = readFileSync(join(__dirname, '..', 'content', 'flow', 'index.ts'), 'utf8');
  const poller = SRC.slice(SRC.indexOf('async function pollStudioCompletion('));
  const executor = SRC.slice(SRC.indexOf('async function handleStudioExecuteNode('), SRC.indexOf('async function pollStudioCompletion('));

  it('marks failures already on the page before it submits', () => {
    expect(executor.indexOf("failure.setAttribute(PRIOR_FAILURE, '')")).toBeGreaterThan(0);
    expect(executor.indexOf("failure.setAttribute(PRIOR_FAILURE, '')")).toBeLessThan(executor.indexOf('await startQueue(queue)'));
  });

  it('no longer lets the API\'s "generating" overrule Flow\'s own failed tile', () => {
    expect(poller).toMatch(/else if \(state === 'failed' && serviceStillWorking && !ownFailure\) \{/);
    expect(poller).toMatch(/const ownFailure = !!flowErrorTile\(trackedTile\) && !isPriorFailure\(trackedTile\);/);
  });

  it('lets a clip the service confirms outrank a failed tile', () => {
    expect(poller).toMatch(/if \(state === 'failed' && apiConfirmsCompleted\) \{[\s\S]*?state = 'generating';/);
  });

  it('skips earlier failures when it looks for its row by prompt', () => {
    expect(poller).toMatch(/findRowForPrompt\(promptText, rowsBefore, earlierFailure\)/);
    expect(poller).toMatch(/findRowForPrompt\(promptText, undefined, earlierFailure\)/);
  });

  it('fails within three reads, with Flow\'s words', () => {
    expect(poller).toMatch(/ownFailure \? consecutiveFailed >= 3 : \(consecutiveFailed >= 8 && wait > 20\)/);
    expect(poller).toMatch(/\(ownFailure && flowFailureMessage\(trackedTile\)\)/);
  });
});
