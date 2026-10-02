/**
 * "when i stop to fix same mastik or samting in the workfow an rerun /
 *  it not working"
 *
 *   22:12:41  Flow  Queue stop requested
 *   22:12:42  Flow  ERROR: Another queue is already running. Stop it before
 *                   starting a new one.
 *
 * One second apart. The queue had been told to stop and still held the lock.
 *
 * stop() set `stopped = true` and returned. The lock was a module-level
 * boolean cleared only at the release points INSIDE the run loop, and the
 * engine was somewhere in a long await — an ingredient wait runs up to 90
 * seconds, a generation wait minutes — so it would not reach one for a long
 * time. Every attempt to fix the workflow and run again was refused by a run
 * that was already over.
 *
 * A second fault lived in the same boolean, and this is the one that would
 * have bitten quietly afterwards: a new engine is built for every run, so the
 * OLD one finishes unwinding some time later and clears the lock — the lock
 * belonging to the run that started in the meantime. A release now only counts
 * from the engine that took it.
 */

/// <reference types="node" />

import { readFileSync } from 'fs';
import { join } from 'path';

const FLOW = readFileSync(
  join(__dirname, '..', 'content', 'flow', 'automation.ts'), 'utf8').replace(/\r\n/g, '\n');

describe('stopping a run actually ends it', () => {
  it('releases the lock in stop(), not at the loop\'s convenience', () => {
    const at = FLOW.indexOf('  stop(): void {');
    expect(at).toBeGreaterThan(-1);
    const body = FLOW.slice(at, FLOW.indexOf('\n  }', at));
    expect(body).toMatch(/releaseRunLock\(this\);/);
  });

  it('tells the panel the lock is gone, so the button re-enables', () => {
    const at = FLOW.indexOf('  stop(): void {');
    const body = FLOW.slice(at, FLOW.indexOf('\n  }', at));
    expect(body).toMatch(/this\.sendRunLockChanged\(false\);/);
  });

  it('still marks the engine stopped, so nothing further acts', () => {
    /* Releasing the lock does not interrupt an await. What keeps the old
       engine from doing anything more is the flag every step checks. */
    const at = FLOW.indexOf('  stop(): void {');
    const body = FLOW.slice(at, FLOW.indexOf('\n  }', at));
    expect(body).toMatch(/this\.stopped = true;/);
  });
});

describe('the lock knows who holds it', () => {
  it('is an engine, not a boolean', () => {
    expect(FLOW).toMatch(/let runLockOwner: AutomationEngine \| null = null;/);
    expect(FLOW).not.toMatch(/let globalRunLock = false;/);
  });

  it('lets a new run start when the holder has stopped', () => {
    /* The reported bug, in one condition. A stopped engine may still be
       unwinding out of an await it cannot be interrupted inside, but it has no
       claim on the next run. */
    expect(FLOW).toMatch(
      /if \(runLockOwner && runLockOwner !== this && !runLockOwner\.isStopped\(\)\)/);
  });

  it('still refuses a second run while one is genuinely going', () => {
    /* The guard is narrowed, not removed — two engines driving one composer is
       the thing it exists to prevent. */
    expect(FLOW).toMatch(/Another queue is already running\. Stop it before starting a new one\./);
  });

  it('does not let a stale engine release somebody else\'s lock', () => {
    /* The quiet one. The old engine unwinds minutes later and clears the flag
       — which by then belongs to the run that started in the meantime, letting
       a third in on top of it. */
    expect(FLOW).toMatch(/function releaseRunLock\(engine: AutomationEngine\): void \{\s*\n\s*if \(runLockOwner === engine\) runLockOwner = null;/);
  });

  it('routes every release through that check', () => {
    /* Eleven sites set the flag directly. One left behind is one engine that
       can still stamp on another's lock. */
    expect(FLOW).not.toMatch(/globalRunLock = false;/);
    expect((FLOW.match(/releaseRunLock\(this\);/g) || []).length).toBeGreaterThan(8);
  });

  it('reports a stopped holder as not locked', () => {
    /* index.ts answers PING with runLocked, and the panel believes it. */
    expect(FLOW).toMatch(/return !!runLockOwner && !runLockOwner\.isStopped\(\);/);
  });

  it('exposes stopped without making the field public', () => {
    expect(FLOW).toMatch(/isStopped\(\): boolean \{\s*\n\s*return this\.stopped;/);
    expect(FLOW).toMatch(/private stopped = false;/);
  });
});

/* ── "he reload the flow page when the generetion finich … the bot craching
 *     and show in the viewer still generetion" ──────────────────────────────
 *
 * A reload destroys the content script in the middle of its own run. The
 * poller watching the tile dies with it, no result is ever sent, and the node
 * sits at "Generating video…" for ever while the finished clip is on the page
 * behind it.
 *
 * The reload exists to restart the STANDALONE extension's recovery scan, which
 * reads the library after the page comes back. Studio has no such pass — it
 * takes its result from the tile and the API while the page is still up — so
 * there is nothing on the other side of a reload for it. Only a lost run.
 *
 * Three of the four reloads were properly gated to full/flow. The recovery one
 * was gated on `mode === 'full'` alone, so LITE fell into its else branch —
 * and LITE is the only mode Studio ever uses.
 */
describe('Studio\'s run is never destroyed by a reload', () => {
  it('gates the recovery reload against Lite as well as Full', () => {
    expect(FLOW).toMatch(/if \(this\.mode === 'full' \|\| this\.mode === 'lite'\) \{/);
  });

  it('says which mode declined it, rather than going quiet', () => {
    expect(FLOW).toMatch(/Not reloading `/);
    expect(FLOW).toMatch(/\$\{this\.mode === 'lite' \? 'Lite' : 'Full'\} mode/);
  });

  it('leaves no reload reachable from Lite', () => {
    /* Every remaining window.location.reload() must sit under a full or flow
       branch. Walking back to the nearest mode guard is crude, but a reload
       that has drifted out from under one is exactly the regression worth
       catching, and it is what happened here. */
    const lines = FLOW.split('\n');
    const unguarded: number[] = [];
    lines.forEach((line, i) => {
      if (!line.includes('window.location.reload()')) return;
      let guarded = false;
      for (let j = i; j >= Math.max(0, i - 260); j--) {
        if (/this\.mode === 'full'\)/.test(lines[j])
          || /this\.mode === 'flow'\)/.test(lines[j])
          || /this\.mode === 'full' \|\| this\.mode === 'lite'\)/.test(lines[j])) {
          guarded = true;
          break;
        }
      }
      if (!guarded) unguarded.push(i + 1);
    });
    expect(unguarded).toEqual([]);
  });

  it('keeps the reload for the standalone extension, which needs it', () => {
    /* Removed from Lite, not from the file. Full and Flow really do read the
       library after the page comes back. */
    expect(FLOW).toMatch(/window\.location\.reload\(\);/);
  });
});
