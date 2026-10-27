/** @jest-environment jsdom */
/// <reference types="node" />
import { readFileSync } from 'fs';
import { join } from 'path';
import { getStudioTileState } from '../content/flow/tileState';
import { MotionNativeRetry, motionRetryReady } from '../content/flow/motionRetry';

jest.mock('../content/flow/selectors', () => ({
  ...jest.requireActual('../content/flow/selectors'),
  simulateClick: jest.fn((button: HTMLElement) => button.click()),
}));

function card(content: string): Element {
  document.body.innerHTML = `<flow-video-tile><div class="container">${content}
    <div class="type-icon-container"><mat-icon class="google-symbols">play_circle</mat-icon></div>
    </div></flow-video-tile>`;
  return document.querySelector('flow-video-tile')!;
}
afterEach(() => { document.body.innerHTML = ''; });

test('an empty Retry transition with a play icon is not a completed clip', () => {
  expect(getStudioTileState(card(''), true)).not.toBe('completed');
});
test('the retried tile is generating at 10%, even with a play icon', () => {
  expect(getStudioTileState(card('<div class="progress-text">10%</div>'), true)).toBe('generating');
});
test('a retried thumbnail with no output source remains pending', () => {
  expect(getStudioTileState(card('<img src="https://flow-content.google/image/poster">'), true)).toBe('thumbnail-only');
});
test('100% encoding with only a poster does not complete a video', () => {
  expect(getStudioTileState(card('<span>100%</span><img src="https://flow-content.google/image/poster">'), true)).toBe('generating');
});
test('a real video source at 100% completes instead of waiting forever after Retry', () => {
  expect(getStudioTileState(card('<span>100%</span><video src="https://flow-content.google/video/new"></video>'), true)).toBe('completed');
});
test('a real video source at 10% is not proof the new render is finished', () => {
  expect(getStudioTileState(card('<span>10%</span><video src="https://flow-content.google/video/new"></video>'), true)).toBe('generating');
});

test('Retry transitions never enter frame capture; only the finished new video does', () => {
  const tile = card('<flow-error-tile><div class="error-message-text">Failed</div><div class="buttons-container"><button aria-label="Retry"><mat-icon>refresh</mat-icon></button></div></flow-error-tile>');
  const retry = new MotionNativeRetry();
  const capture = jest.fn();
  const startedAt = 100_000;
  retry.step(tile, () => true, startedAt - 5000);
  expect(retry.step(tile, () => true, startedAt).action).toBe('clicked');
  const frames = [
    ['', 101_000],
    ['<img src="https://flow-content.google/image/poster">', 102_000],
    ['<span>10%</span>', 111_000],
    ['<img src="https://flow-content.google/image/poster">', 200_000],
    ['<span>100%</span><img src="https://flow-content.google/image/poster">', 201_000],
    ['<video src="https://flow-content.google/video/new"></video>', 202_000],
  ] as const;
  for (const [html, now] of frames) {
    tile.innerHTML = html + '<mat-icon class="google-symbols">play_circle</mat-icon>';
    retry.observe(getStudioTileState(tile, true));
    if (motionRetryReady(tile, startedAt, now)) capture(now);
  }
  expect(capture.mock.calls).toEqual([[202_000]]);
  expect(retry.attempts).toBe(1);
});

test('the new attempt gets its own ten-second completion guard', () => {
  const tile = card('<video src="https://flow-content.google/video/new"></video>');
  expect(motionRetryReady(tile, 100_000, 109_999)).toBe(false);
  expect(motionRetryReady(tile, 100_000, 110_000)).toBe(true);
  expect(motionRetryReady(tile, 110_000, 111_000)).toBe(false);
});

test('the watcher resets Retry timers, gates capture and avoids stale API URLs', () => {
  const content = readFileSync(join(__dirname, '..', 'content', 'flow', 'index.ts'), 'utf8');
  const clicked = content.slice(content.indexOf("if (decision.action === 'clicked')"), content.indexOf("if (decision.action !== 'stop')"));
  expect(clicked).toContain('attemptStartedAt = Date.now();');
  expect(clicked).toContain('thumbnailOnlySince = 0;');
  expect(clicked).toContain('lastNudgeAt = 0;');
  expect(content).toContain('held < grace || nativeRetry?.attempts');
  expect(content).toContain('if (nativeRetry?.attempts && !motionRetryReady(trackedTile, attemptStartedAt))');
  expect(content).toContain('if (isVideoNode && !mediaUrl && !nativeRetry?.attempts)');
  expect(content).toContain('nativeRetry?.attempts ? undefined : promptText');
});
