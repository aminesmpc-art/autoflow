/**
 * The watchdog must outlast the work it watches.
 *
 * Reported from a live run: "Engine stalled at ATTACH_INGREDIENT_IMAGES for
 * 90s without submitting", with the reference chip on screen holding its
 * picture. Nothing was hung — the attach was still inside its own waits, which
 * add up to about 145 seconds, supervised by a 90 second limit.
 *
 * index.ts already carried the reason this must not happen, written after the
 * same fault broke long videos: "An outer wait shorter than the inner work it
 * supervises... Deriving the limit from progress rather than from a guess is
 * what stops it coming back a third time." It came back a third time because
 * the limit stayed a literal while the waits below it grew.
 *
 * So the ordering is asserted rather than described. These are arithmetic
 * tests on exported constants, which is the only kind that can fail the day
 * somebody raises a timeout in automation.ts and never opens index.ts.
 */

/// <reference types="node" />

import { readFileSync } from 'fs';
import { join } from 'path';

import {
  CHIP_APPEAR_MS, INGREDIENT_SETTLE_MS, attachStallLimitMs,
} from '../content/flow/automation';
import { INGREDIENT_WAIT_MS } from '../content/flow/selectors';

/* The general limit, copied from index.ts. Not imported because it is a local
   inside the polling function there; if that changes, this number is the
   thing to update and the test below says why it matters. */
const GENERAL_STALL_LIMIT_MS = 90_000;

describe('what an attach is allowed to take', () => {
  it('is longer than every wait the attach performs, added up', () => {
    const innerWork = INGREDIENT_WAIT_MS + CHIP_APPEAR_MS + INGREDIENT_SETTLE_MS;

    expect(attachStallLimitMs()).toBeGreaterThan(innerWork);
  });

  it('leaves room for the work between those waits', () => {
    /* Reading blobs out of the sidepanel, dismissing dialogs, the paste
       itself. Small, but a limit equal to the sum would fail on it. */
    const innerWork = INGREDIENT_WAIT_MS + CHIP_APPEAR_MS + INGREDIENT_SETTLE_MS;

    expect(attachStallLimitMs() - innerWork).toBeGreaterThanOrEqual(15_000);
  });

  it('is longer than the general limit, which is what the bug was', () => {
    /* The failing case exactly: 145s of attach under a 90s watchdog. If this
       ever inverts again, a slow upload is reported as a hang. */
    expect(attachStallLimitMs()).toBeGreaterThan(GENERAL_STALL_LIMIT_MS);
  });

  it('is not so generous that a real hang goes unnoticed', () => {
    /* A ceiling as well as a floor. Ten minutes of "still attaching" is not a
       slow upload, it is a stuck one, and the node should say so. */
    expect(attachStallLimitMs()).toBeLessThanOrEqual(5 * 60_000);
  });
});

describe('the watchdog knows which states are slow', () => {
  const SRC = readIndexSource();

  it('applies the attach limit to both attach states', () => {
    /* Frames and ingredients are different code paths with the same problem:
       both wait on an upload that Flow controls the speed of. */
    expect(SRC).toMatch(/ATTACH_INGREDIENT_IMAGES/);
    expect(SRC).toMatch(/ATTACH_FRAME_IMAGES/);
    expect(SRC).toMatch(/attachStallLimitMs/);
  });

  it('no longer compares the state age against the bare general limit', () => {
    /* The line that produced the report. If it comes back, so does the bug. */
    expect(SRC).not.toMatch(/getStateAge\(\)\s*<\s*STALL_LIMIT_MS/);
    expect(SRC).toMatch(/getStateAge\(\)\s*<\s*stallLimitFor\(/);
  });
});

function readIndexSource(): string {
  return readFileSync(join(__dirname, '..', 'content', 'flow', 'index.ts'), 'utf8');
}
