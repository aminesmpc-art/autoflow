/* ============================================================
   Coordinator State — Persists the RunCoordinator's execution
   snapshot to chrome.storage.session.

   Session storage survives service worker recycling (Chrome can
   kill and restart the worker at any time) but not a full browser
   restart — which is correct: a run interrupted by closing Chrome
   cannot be resumed because the platform tabs are gone.

   Separate from runJournal.ts on purpose:
   - Journal = crash recovery for PAID generations (mediaIds).
     Lives in chrome.storage.local because the cost survives
     everything the browser does.
   - Snapshot = full execution state (which step, what progress,
     node statuses). Lives in session because it is only meaningful
     while the browser is open.
   ============================================================ */

import type { ExecutionSnapshot } from '../shared/executionTypes';

const STORAGE_KEY = 'af_coordinator_snapshot';

/* Debounce writes to avoid storage thrashing during rapid progress
   updates. A generation can fire 20+ progress events in a second,
   and each would write 5-10KB — 200KB/s of storage churn that
   accomplishes nothing beyond waking up every storage listener. */
let pendingWrite: ExecutionSnapshot | null = null;
let writeTimer: ReturnType<typeof setTimeout> | null = null;
const DEBOUNCE_MS = 500;

/**
 * Save the execution snapshot to session storage.
 *
 * Writes are debounced: the last snapshot wins. A forced flush is
 * available for critical transitions (run start, run end) where the
 * caller cannot afford to lose the write.
 */
export function saveSnapshot(snapshot: ExecutionSnapshot, force = false): void {
  pendingWrite = snapshot;

  if (force) {
    flushSnapshot();
    return;
  }

  if (!writeTimer) {
    writeTimer = setTimeout(flushSnapshot, DEBOUNCE_MS);
  }
}

/** Write immediately, cancelling any pending debounce. */
function flushSnapshot(): void {
  if (writeTimer) {
    clearTimeout(writeTimer);
    writeTimer = null;
  }
  if (!pendingWrite) return;

  const data = pendingWrite;
  pendingWrite = null;

  try {
    chrome.storage.session.set({ [STORAGE_KEY]: data }).catch((err) => {
      console.warn('[CoordinatorState] Failed to persist snapshot:', err);
    });
  } catch (err) {
    /* chrome.storage may not be available in test environments. */
    console.warn('[CoordinatorState] Storage unavailable:', err);
  }
}

/**
 * Load the last persisted snapshot, if any.
 *
 * Called on worker startup to discover whether a run was in flight
 * when the worker was last recycled.
 */
export async function loadSnapshot(): Promise<ExecutionSnapshot | null> {
  try {
    const result = await chrome.storage.session.get(STORAGE_KEY);
    return (result[STORAGE_KEY] as ExecutionSnapshot) ?? null;
  } catch {
    return null;
  }
}

/**
 * Clear the persisted snapshot.
 *
 * Called when a run finishes (done, stopped, or errored) so a
 * worker restart does not attempt to resume a completed run.
 */
export async function clearSnapshot(): Promise<void> {
  pendingWrite = null;
  if (writeTimer) {
    clearTimeout(writeTimer);
    writeTimer = null;
  }
  try {
    await chrome.storage.session.remove(STORAGE_KEY);
  } catch {
    /* Not critical — worst case is a stale snapshot that loadSnapshot
       reads and immediately discards because the journal says the run
       is finished. */
  }
}

/**
 * For tests: inject a mock storage implementation.
 */
export function __resetForTest(): void {
  pendingWrite = null;
  if (writeTimer) {
    clearTimeout(writeTimer);
    writeTimer = null;
  }
}
