/** @jest-environment jsdom */
/// <reference types="node" />
import { readFileSync } from 'fs';
import { join } from 'path';
import { MotionNativeRetry, MOTION_NATIVE_RETRIES } from '../content/flow/motionRetry';
import { simulateClick } from '../content/flow/selectors';
import { PRIOR_FAILURE } from '../content/flow/tileState';

jest.mock('../content/flow/selectors', () => ({
  ...jest.requireActual('../content/flow/selectors'),
  simulateClick: jest.fn((button: HTMLElement) => button.click()),
}));

function tile(reason = 'Oops, something went wrong!', disclaimer = ''): Element {
  document.body.innerHTML = '<flow-video-tile><flow-error-tile><div class="error-message-text"></div>'
    + '<span class="disclaimer-message"></span><div class="buttons-container">'
    + '<button aria-label="Retry"><mat-icon>refresh</mat-icon></button>'
    + '<button aria-label="Reuse prompt"><mat-icon>undo</mat-icon></button>'
    + '<button aria-label="Delete"><mat-icon>delete_forever</mat-icon></button>'
    + '</div></flow-error-tile></flow-video-tile>';
  document.querySelector('.error-message-text')!.textContent = reason;
  document.querySelector('.disclaimer-message')!.textContent = disclaimer;
  return document.querySelector('flow-video-tile')!;
}
const active = () => true;
beforeEach(() => jest.clearAllMocks());
afterEach(() => { document.body.innerHTML = ''; });

test.each([
  ['Audio generation failed.', 'You have not been charged for this generation.'],
  ['Oops, something went wrong!', ''],
  ['Unable to edit the speech in this video. Please try again.', ''],
  ['Service temporarily unavailable.', ''],
  ['Connection refused by server.', ''],
  ['', ''],
])('clicks the actual Retry button for failure: %s', (reason, disclaimer) => {
  const card = tile(reason, disclaimer);
  const buttons = Array.from(card.querySelectorAll('button'));
  const listeners = buttons.map(button => { const listener = jest.fn(); button.addEventListener('click', listener); return listener; });
  const retry = new MotionNativeRetry();
  expect(retry.step(card, active, 0).action).toBe('waiting');
  expect(retry.step(card, active, 4999).action).toBe('waiting');
  expect(retry.step(card, active, 5000).action).toBe('clicked');
  expect(listeners.map(listener => listener.mock.calls.length)).toEqual([1, 0, 0]);
  expect(simulateClick).toHaveBeenCalledWith(buttons[0]);
});

test.each([
  'This generation might violate our policies. Please try a different prompt or send feedback.',
  'We do not support generating prominent people.',
  'Safety filter rejected this request.',
  'Cette génération pourrait enfreindre nos règles.',
])('uses the offered Retry action without rewriting inputs for: %s', reason => {
  const card = tile(reason);
  const before = card.outerHTML;
  const retry = new MotionNativeRetry();
  expect(retry.step(card, active, 0).action).toBe('waiting');
  expect(retry.step(card, active, 5000).action).toBe('clicked');
  expect(card.outerHTML).toBe(before);
  expect(simulateClick).toHaveBeenCalledTimes(1);
  expect(retry.attempts).toBe(1);
});

test.each(['Oops, something went wrong!', 'This generation might violate our policies.'])('allows exactly three Retry clicks after acknowledged failures: %s', reason => {
  expect(MOTION_NATIVE_RETRIES).toBe(3);
  const card = tile(reason); const retry = new MotionNativeRetry();
  for (let attempt = 0; attempt < 3; attempt++) {
    const now = attempt * 20_000;
    expect(retry.step(card, active, now).action).toBe('waiting');
    expect(retry.step(card, active, now + 5000).action).toBe('clicked');
    retry.observe('generating');
  }
  expect(retry.step(card, active, 70_000)).toEqual({ action: 'stop', reason: expect.stringContaining('3 automatic Retry clicks') });
  retry.observe('generating');
  expect(retry.step(card, active, 80_000).action).toBe('stop');
  expect(retry.step(card, active, 100_000).action).toBe('stop');
  expect(simulateClick).toHaveBeenCalledTimes(3);
});

test('never clicks repeatedly while the old failed tile is unchanged', () => {
  const card = tile(); const retry = new MotionNativeRetry();
  retry.step(card, active, 0); retry.step(card, active, 5000);
  expect(retry.step(card, active, 10_000).action).toBe('waiting');
  retry.observe('unknown');
  expect(retry.step(card, active, 34_999).action).toBe('waiting');
  expect(retry.step(card, active, 35_000).reason).toContain('did not acknowledge');
  expect(simulateClick).toHaveBeenCalledTimes(1);
});

test('a changed error message is not enough to acknowledge the previous click', () => {
  const card = tile(); const retry = new MotionNativeRetry();
  retry.step(card, active, 0); retry.step(card, active, 5000);
  card.querySelector('.error-message-text')!.textContent = 'This generation might violate our policies.';
  expect(retry.step(card, active, 6000).action).toBe('waiting');
  expect(simulateClick).toHaveBeenCalledTimes(1);
});

test.each(['missing', 'disabled', 'aria-disabled'])('does not click a %s Retry button', condition => {
  const card = tile(); const retry = new MotionNativeRetry();
  const button = card.querySelector('button')!;
  if (condition === 'missing') button.remove();
  else button.setAttribute(condition, condition === 'aria-disabled' ? 'true' : '');
  retry.step(card, active, 0);
  expect(retry.step(card, active, 5000).action).toBe('stop');
  expect(simulateClick).not.toHaveBeenCalled();
});

test('ignores stale failures, text-only errors and cancellation', () => {
  let card = tile();
  card.querySelector('flow-error-tile')!.setAttribute(PRIOR_FAILURE, '');
  expect(new MotionNativeRetry().step(card, active).action).toBe('stop');
  card = tile(); card.querySelector('flow-error-tile')!.remove();
  expect(new MotionNativeRetry().step(card, active).action).toBe('stop');
  card = tile();
  expect(new MotionNativeRetry().step(card, () => false).reason).toContain('stopped');
  expect(simulateClick).not.toHaveBeenCalled();
});

test('honours Stop during the retry delay and rechecks before dispatch', () => {
  const card = tile(); const retry = new MotionNativeRetry();
  retry.step(card, active, 0);
  expect(retry.step(card, () => false, 5000).action).toBe('stop');
  const current = jest.fn().mockReturnValueOnce(true).mockReturnValue(false);
  expect(retry.step(card, current, 6000).action).toBe('stop');
  expect(simulateClick).not.toHaveBeenCalled();
});

test('a disconnected button cannot receive a click', () => {
  const card = tile(); const retry = new MotionNativeRetry();
  retry.step(card, active, 0); card.remove();
  expect(retry.step(card, active, 5000).action).toBe('stop');
  expect(simulateClick).not.toHaveBeenCalled();
});

describe('Motion uses one content-side budget, not nested resubmissions', () => {
  const runner = readFileSync(join(__dirname, '..', 'studio', 'engine', 'WorkflowRunner.ts'), 'utf8');
  const body = runner.slice(runner.indexOf('private async executeMotionNode'), runner.indexOf('private async askAgent('));
  const content = readFileSync(join(__dirname, '..', 'content', 'flow', 'index.ts'), 'utf8');
  test('opts in only through the generation configuration', () => {
    expect(body).toContain('retryFailedMotion: true');
    expect(body).not.toContain('motionRetryable');
    expect(body).not.toContain('for (let attempt = 0;');
    expect(content).toContain('retryFailedMotion: config.retryFailedMotion === true');
    expect(content).toContain('isVideoNode && queue?.settings?.retryFailedMotion === true ? new MotionNativeRetry() : null');
    expect(content).not.toContain("if (!nativeRetry || why === 'safety')");
  });
  test('ignores old API records after native retry, retaining current tile ownership', () => {
    expect(content).toContain('isApiAvailable() && !nativeRetry?.attempts');
    expect(content).toContain("if (nativeRetry?.attempts) return '';");
    expect(content).toContain('retryTile?.isConnected && isVisible(retryTile)');
    expect(content).toContain('trackedTileIds.length = 0;');
    expect(content).toContain('prompt.mediaId = undefined;');
    expect(content).toContain('nativeRetry.step(trackedTile, () => isCurrentRun(nodeId, run))');
  });
});
