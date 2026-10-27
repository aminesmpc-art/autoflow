import { findRetryButtonOnTile, simulateClick } from './selectors';
import { flowErrorTile, getStudioTileState, isPriorFailure, type StudioTileState } from './tileState';

export const MOTION_NATIVE_RETRIES = 3;
const RETRY_DELAY_MS = 5000;
const RETRY_ACK_MS = 30_000;

type RetryDecision = { action: 'waiting' | 'clicked' | 'stop'; reason?: string };

export function motionRetryReady(tile: Element, startedAt: number, now = Date.now()): boolean {
  return now - startedAt >= 10_000 && getStudioTileState(tile, true) === 'completed';
}

/** One budget per piece; a click must visibly start work before another is allowed. */
export class MotionNativeRetry {
  attempts = 0;
  private failedSince: number | undefined;
  private clickedAt: number | undefined;

  observe(state: StudioTileState): void {
    if (state === 'generating' || state === 'completed') {
      this.failedSince = undefined;
      this.clickedAt = undefined;
    }
  }

  step(tile: Element, active: () => boolean, now = Date.now()): RetryDecision {
    if (!active()) return { action: 'stop', reason: 'Motion Control stopped.' };
    if (!flowErrorTile(tile) || isPriorFailure(tile)) return { action: 'stop', reason: 'The failed tile is not this generation.' };
    if (this.clickedAt !== undefined) {
      return now - this.clickedAt < RETRY_ACK_MS
        ? { action: 'waiting' }
        : { action: 'stop', reason: 'Flow did not acknowledge Retry. Stopped to avoid duplicate submissions.' };
    }
    if (this.attempts >= MOTION_NATIVE_RETRIES) {
      return { action: 'stop', reason: `Flow still failed after ${MOTION_NATIVE_RETRIES} automatic Retry clicks.` };
    }
    this.failedSince ??= now;
    if (now - this.failedSince < RETRY_DELAY_MS) return { action: 'waiting' };
    // Use only Flow's own available Retry action. Never rewrite inputs or
    // fall back to a new submission when that action is unavailable.
    const button = findRetryButtonOnTile(tile);
    if (!button || button.hasAttribute('disabled') || button.getAttribute('aria-disabled') === 'true') {
      return { action: 'stop', reason: 'Flow Retry button is missing or disabled.' };
    }
    if (!active() || !button.isConnected) return { action: 'stop', reason: 'Motion stopped or its Retry button disappeared.' };
    // Count before dispatch: never multiply retries if an event handler throws.
    this.attempts++;
    this.clickedAt = now;
    simulateClick(button);
    return { action: 'clicked' };
  }
}
