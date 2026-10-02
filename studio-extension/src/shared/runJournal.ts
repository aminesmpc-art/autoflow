/* ============================================================
   Run journal — what has already been paid for

   Step 5 asks for durable orchestration, and this is the part everything
   else in it rests on: knowing, after a restart, which generations were
   ALREADY SUBMITTED so they are recovered rather than bought twice.

   ── Why memory is not enough ─────────────────────────────────────────────

   Cancellation today is `this.abortRequested`, a field on a runner that
   lives in the Studio page. Progress is not stored anywhere at all. All
   three of the events step 5 names destroy that state:

     the worker is recycled      Chrome does this on idle, routinely
     Studio is closed            the runner and its progress go with the tab
     the tab is discarded        same, without the user doing anything

   After any of them the honest answer to "did node 7 submit?" is a shrug,
   and a shrug means resubmitting. Flow has already accepted the first one
   and Google has already charged for it, so the user pays twice and gets a
   duplicate they did not ask for.

   ── The rule ─────────────────────────────────────────────────────────────

   An attempt with a media id and no settlement is NOT a candidate for
   retry. It is a candidate for observation. beginAttempt returns the
   unsettled attempt rather than minting a new one, which is what makes
   "recover submitted jobs before retrying" true by construction instead of
   by everyone remembering to check.

   Cancellation is written down for the same reason: a run cancelled a
   moment before the worker recycled must not come back to life.
   ============================================================ */

export type AttemptOutcome = 'done' | 'failed' | 'abandoned';

export interface AttemptRecord {
  runId: string;
  nodeId: string;
  attemptId: string;
  startedAt: number;
  /** Flow's own id. Its presence is proof the generation was paid for. */
  mediaId?: string;
  submittedAt?: number;
  settledAt?: number;
  outcome?: AttemptOutcome;
}

export interface RunRecord {
  runId: string;
  startedAt: number;
  cancelledAt?: number;
  finishedAt?: number;
}

interface Journal {
  runs: RunRecord[];
  attempts: AttemptRecord[];
}

const KEY = 'af_run_journal';

/** Bounded so a long-lived profile cannot fill the extension's quota. */
export const MAX_ATTEMPTS = 500;
export const MAX_RUNS = 50;

type Storage = {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
};

function defaultStorage(): Storage | null {
  try {
    const area = (globalThis as any)?.chrome?.storage?.local;
    if (!area) return null;
    return {
      get: (key: string) => new Promise((res) => area.get(key, (v: any) => res(v || {}))),
      set: (items: Record<string, unknown>) =>
        new Promise((res) => area.set(items, () => res())),
    };
  } catch {
    return null;
  }
}

let _storage: Storage | null | undefined;

/** Test seam. Passing null forces the no-op path. */
export function __setStorage(s: Storage | null): void {
  _storage = s;
}

function storage(): Storage | null {
  if (_storage === undefined) _storage = defaultStorage();
  return _storage;
}

const empty = (): Journal => ({ runs: [], attempts: [] });

async function load(): Promise<Journal> {
  try {
    const store = storage();
    if (!store) return empty();
    const bag = await store.get(KEY);
    const j = bag?.[KEY] as Journal | undefined;
    if (!j || !Array.isArray(j.runs) || !Array.isArray(j.attempts)) return empty();
    return j;
  } catch {
    return empty();
  }
}

async function save(j: Journal): Promise<void> {
  try {
    const store = storage();
    if (!store) return;
    /* Trim the SETTLED first and never an unsettled attempt: an unsettled one
       is the only record that a generation was paid for, and dropping it is
       how the duplicate this file exists to prevent gets bought. */
    if (j.attempts.length > MAX_ATTEMPTS) {
      const unsettled = j.attempts.filter((a) => !a.settledAt);
      const settled = j.attempts.filter((a) => a.settledAt);
      const room = Math.max(0, MAX_ATTEMPTS - unsettled.length);
      j.attempts = [...settled.slice(settled.length - room), ...unsettled];
    }
    if (j.runs.length > MAX_RUNS) j.runs = j.runs.slice(j.runs.length - MAX_RUNS);
    await store.set({ [KEY]: j });
  } catch {
    /* Instrumentation must never fail the thing it records. */
  }
}

// ── Runs ────────────────────────────────────────────────────────────────

export async function beginRun(runId: string, now = Date.now()): Promise<void> {
  if (!runId) return;
  const j = await load();
  if (!j.runs.some((r) => r.runId === runId)) {
    j.runs.push({ runId, startedAt: now });
    await save(j);
  }
}

/**
 * Write the cancellation down.
 *
 * In memory it is a field on an object that a recycled worker does not have,
 * so a run stopped seconds before a restart would otherwise resume as though
 * nothing had happened — and every node still owing a generation would be
 * submitted again.
 */
export async function cancelRun(runId: string, now = Date.now()): Promise<void> {
  if (!runId) return;
  const j = await load();
  const run = j.runs.find((r) => r.runId === runId);
  if (run) { if (!run.cancelledAt) run.cancelledAt = now; }
  else j.runs.push({ runId, startedAt: now, cancelledAt: now });
  await save(j);
}

export async function isRunCancelled(runId: string): Promise<boolean> {
  if (!runId) return false;
  const j = await load();
  return !!j.runs.find((r) => r.runId === runId)?.cancelledAt;
}

export async function finishRun(runId: string, now = Date.now()): Promise<void> {
  if (!runId) return;
  const j = await load();
  const run = j.runs.find((r) => r.runId === runId);
  if (run && !run.finishedAt) { run.finishedAt = now; await save(j); }
}

// ── Attempts ────────────────────────────────────────────────────────────

/**
 * Claim an attempt for this node, or hand back the one already in flight.
 *
 * The whole anti-duplicate mechanism. An attempt that has a media id and no
 * settlement is a generation Flow accepted and Google charged for; minting a
 * fresh attempt for that node would submit a second one. So the unsettled
 * record is returned instead, and the caller's job becomes observation.
 */
export async function beginAttempt(
  runId: string,
  nodeId: string,
  attemptId: string,
  now = Date.now(),
): Promise<AttemptRecord> {
  const j = await load();
  const existing = j.attempts.find(
    (a) => a.runId === runId && a.nodeId === nodeId && !a.settledAt);
  if (existing) return existing;

  const rec: AttemptRecord = { runId, nodeId, attemptId, startedAt: now };
  j.attempts.push(rec);
  await save(j);
  return rec;
}

/** Flow acknowledged. From here the generation exists and has been charged. */
export async function recordSubmitted(
  runId: string,
  nodeId: string,
  mediaId: string,
  now = Date.now(),
): Promise<void> {
  if (!mediaId) return;
  const j = await load();
  const rec = j.attempts.find(
    (a) => a.runId === runId && a.nodeId === nodeId && !a.settledAt);
  if (!rec) return;
  /* First id wins here, unlike the queue extension's per-prompt reporting.
     There, a retry is a second billable generation and must be counted. Here
     the question is only "is something outstanding for this node", and
     overwriting would lose the id that is still owed a result. */
  if (!rec.mediaId) { rec.mediaId = mediaId; rec.submittedAt = now; }
  await save(j);
}

export async function settleAttempt(
  runId: string,
  nodeId: string,
  outcome: AttemptOutcome,
  now = Date.now(),
): Promise<void> {
  const j = await load();
  const rec = j.attempts.find(
    (a) => a.runId === runId && a.nodeId === nodeId && !a.settledAt);
  if (!rec) return;
  rec.settledAt = now;
  rec.outcome = outcome;
  await save(j);
}

/**
 * A generation that was submitted and never settled.
 *
 * The caller must observe this rather than submit: Flow has it, and asking
 * again produces a second video at full price. Returns null when there is
 * nothing outstanding, which is the ordinary case.
 */
export async function recoverable(
  runId: string,
  nodeId: string,
): Promise<AttemptRecord | null> {
  const j = await load();
  return j.attempts.find(
    (a) => a.runId === runId && a.nodeId === nodeId && !!a.mediaId && !a.settledAt,
  ) || null;
}

/** Everything still outstanding for a run — what a restart has to reconcile. */
export async function outstanding(runId: string): Promise<AttemptRecord[]> {
  const j = await load();
  return j.attempts.filter((a) => a.runId === runId && !!a.mediaId && !a.settledAt);
}

/**
 * Everything a restart inherited: generations submitted, never settled, and
 * belonging to a run that was neither finished nor cancelled.
 *
 * This is what the worker has to say out loud after it comes back. Without
 * it the user's only evidence that three videos were paid for and never
 * collected is that the canvas looks unfinished — and the natural response
 * to that is to press Run again, which buys them a second time.
 *
 * A cancelled run is excluded deliberately: the user already said they did
 * not want it, and listing it as outstanding work invites them to undo their
 * own decision.
 */
export async function outstandingAcrossRuns(): Promise<AttemptRecord[]> {
  const j = await load();
  const live = new Set(
    j.runs.filter((r) => !r.cancelledAt && !r.finishedAt).map((r) => r.runId));
  return j.attempts.filter((a) => live.has(a.runId) && !!a.mediaId && !a.settledAt);
}

export async function readJournal(): Promise<Journal> {
  return load();
}

export async function clearJournal(): Promise<void> {
  try {
    const store = storage();
    if (store) await store.set({ [KEY]: empty() });
  } catch { /* no-op */ }
}
