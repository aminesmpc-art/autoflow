/**
 * The Clipping node's spine: five stages, run in order, each cached.
 *
 * The node is one node on the canvas but five quite different jobs inside it,
 * and they cost wildly different amounts. Transcribing a twenty-minute source
 * is minutes of wall clock and a dozen round trips to a chat UI; picking the
 * window from the finished text is one ask; the cut is seconds of local
 * arithmetic. Running them as one opaque operation means a failure in the last
 * one throws away the first — which is not a performance detail, it is the
 * difference between a node someone will use twice and a node they will use
 * once.
 *
 * So: every stage records its own result, and a re-run starts from the first
 * stage that has not finished.
 *
 * ── The rule that is easy to get wrong ────────────────────────────────────
 *
 * Invalidation runs FORWARD. Re-picking the window does not just re-run the
 * window stage: the cut was made from the old window and the beat map was
 * directed against the old cut, so both are now describing a clip that no
 * longer exists. Keeping them because they are "done" is how a node ends up
 * showing a confident beat map for a different sixty seconds.
 *
 * Nothing here knows what a transcript or a beat map is. Stage results are
 * opaque, and the runners are injected — which is what lets the whole machine
 * be tested without a browser, a network, or a video file.
 */

/* The Clipping node surveys; it no longer cuts.
   It used to run one video down to one clip — choose the moment, cut it,
   direct the beats over it. Paid clipping is paid per view, so the useful
   output of reading a video once is not the best clip but the ranked FIELD of
   them, laid out as nodes the clipper can run, edit or delete. The cutting
   moved to those nodes; see clip/emitPlan.ts. */
export type StageId = 'ingest' | 'transcribe' | 'survey' | 'layout';

/** The order is the pipeline. Everything else derives from it. */
export const STAGE_ORDER: readonly StageId[] = [
  'ingest', 'transcribe', 'survey', 'layout',
] as const;

/** What each stage is called on the node, for the report and the tabs. */
export const STAGE_LABEL: Record<StageId, string> = {
  ingest: 'Read the file',
  transcribe: 'Transcribe',
  survey: 'Rank the moments',
  layout: 'Lay out the cuts',
};

export type StageStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped';

export interface StageRecord {
  status: StageStatus;
  /** Present when done. Opaque to this file. */
  result?: unknown;
  /** Present when failed. Written to be read by a person, not parsed. */
  error?: string;
  /** Present when skipped. Why it did not need to run. */
  reason?: string;
  tookMs?: number;
}

export interface ClipRun {
  /**
   * Identifies the source file. When this changes, everything is stale —
   * a transcript of a different podcast is worse than no transcript.
   */
  sourceKey: string;
  stages: Record<StageId, StageRecord>;
}

export type StageRunner = (previous: unknown, signal?: AbortSignal) => Promise<unknown>;

export interface AdvanceOptions {
  runners: Partial<Record<StageId, StageRunner>>;
  /**
   * Stages this run does not need, and why.
   *
   * A skipped stage is NOT a done stage, and conflating them would be a lie
   * the node then repeats: campaign clipping produces no motion graphics
   * because the brief forbids unaffiliated content, and a rail reporting
   * "Direct the beats: done" for a run that drew nothing is worse than
   * useless. The reason is shown where the timing would be.
   */
  skip?: Partial<Record<StageId, string>>;
  /** Called after every transition, so the node can redraw as it goes. */
  onChange?: (run: ClipRun) => void;
  signal?: AbortSignal;
}

const blank = (): Record<StageId, StageRecord> => {
  const out = {} as Record<StageId, StageRecord>;
  for (const id of STAGE_ORDER) out[id] = { status: 'pending' };
  return out;
};

export function emptyRun(sourceKey: string): ClipRun {
  return { sourceKey, stages: blank() };
}

/** A shallow copy deep enough that callers cannot mutate a previous state. */
const cloneRun = (run: ClipRun): ClipRun => ({
  sourceKey: run.sourceKey,
  stages: STAGE_ORDER.reduce((acc, id) => {
    acc[id] = { ...run.stages[id] };
    return acc;
  }, {} as Record<StageId, StageRecord>),
});

/**
 * Clear a stage and everything after it.
 *
 * The forward rule. Called when the user edits something a stage depends on —
 * a different window, a nudged cut, a re-picked moment.
 */
export function invalidateFrom(run: ClipRun, stage: StageId): ClipRun {
  const from = STAGE_ORDER.indexOf(stage);
  if (from < 0) return cloneRun(run);
  const next = cloneRun(run);
  for (let i = from; i < STAGE_ORDER.length; i++) {
    next.stages[STAGE_ORDER[i]] = { status: 'pending' };
  }
  return next;
}

/**
 * The run for this source, keeping what is still valid.
 *
 * A different file means everything is stale. The same file means the user
 * re-opened the node, and the eight minutes already spent still count.
 */
export function forSource(run: ClipRun | null | undefined, sourceKey: string): ClipRun {
  if (!run || run.sourceKey !== sourceKey) return emptyRun(sourceKey);
  return cloneRun(run);
}

/** Stages that will not run again: finished, or deliberately not needed. */
const settled = (status: StageStatus): boolean => status === 'done' || status === 'skipped';

/** The first stage still to run, or null when there is nothing left. */
export function nextPending(run: ClipRun): StageId | null {
  for (const id of STAGE_ORDER) {
    if (!settled(run.stages[id].status)) return id;
  }
  return null;
}

export const isComplete = (run: ClipRun): boolean => nextPending(run) === null;

/** The result of a finished stage, or undefined. */
export function resultOf<T = unknown>(run: ClipRun, stage: StageId): T | undefined {
  const rec = run.stages[stage];
  return rec.status === 'done' ? (rec.result as T) : undefined;
}

/** The last finished result before `stage`, which is what that stage receives. */
function inputFor(run: ClipRun, stage: StageId): unknown {
  const idx = STAGE_ORDER.indexOf(stage);
  for (let i = idx - 1; i >= 0; i--) {
    const rec = run.stages[STAGE_ORDER[i]];
    if (rec.status === 'done') return rec.result;
  }
  return undefined;
}

/**
 * Whether an error is the run being cancelled rather than failing.
 *
 * The distinction matters: a cancelled stage goes back to pending so the next
 * run picks it up again, where a failed one stays failed and shows its reason.
 * Marking a cancellation as a failure would make stopping a run look like a
 * broken node.
 */
const isAbort = (e: unknown): boolean =>
  !!e && typeof e === 'object' && (e as { name?: string }).name === 'AbortError';

const messageOf = (e: unknown): string => {
  if (e && typeof e === 'object' && typeof (e as { message?: string }).message === 'string') {
    return (e as { message: string }).message;
  }
  return String(e);
};

/**
 * Run from the first unfinished stage to the end.
 *
 * Stops at the first failure and leaves the stages after it pending — they
 * were never attempted, and marking them failed would report four problems
 * where there is one.
 */
export async function advance(run: ClipRun, options: AdvanceOptions): Promise<ClipRun> {
  const { runners, onChange, signal } = options;
  let current = cloneRun(run);
  const emit = () => onChange?.(cloneRun(current));

  for (const id of STAGE_ORDER) {
    if (settled(current.stages[id].status)) continue;
    if (signal?.aborted) break;

    const reason = options.skip?.[id];
    if (reason) {
      current.stages[id] = { status: 'skipped', reason };
      emit();
      continue;
    }

    const runner = runners[id];
    if (!runner) {
      current.stages[id] = {
        status: 'failed',
        error: `No runner is wired up for the "${STAGE_LABEL[id]}" stage.`,
      };
      emit();
      return current;
    }

    const startedAt = Date.now();
    current.stages[id] = { status: 'running' };
    emit();

    try {
      const result = await runner(inputFor(current, id), signal);
      current.stages[id] = { status: 'done', result, tookMs: Date.now() - startedAt };
      emit();
    } catch (e) {
      /* Cancelled work is resumable, so it goes back to pending rather than
         carrying an error somebody has to clear before running again. */
      current.stages[id] = isAbort(e)
        ? { status: 'pending' }
        : { status: 'failed', error: messageOf(e), tookMs: Date.now() - startedAt };
      emit();
      return current;
    }
  }

  return current;
}

/** One line per stage, for the node's report. */
export function describeRun(run: ClipRun): string[] {
  return STAGE_ORDER.map((id) => {
    const rec = run.stages[id];
    const took = rec.tookMs !== undefined ? ` (${(rec.tookMs / 1000).toFixed(1)}s)` : '';
    switch (rec.status) {
      case 'done': return `${STAGE_LABEL[id]}: done${took}`;
      case 'skipped': return `${STAGE_LABEL[id]}: skipped — ${rec.reason}`;
      case 'running': return `${STAGE_LABEL[id]}: running…`;
      case 'failed': return `${STAGE_LABEL[id]}: failed — ${rec.error}`;
      default: return `${STAGE_LABEL[id]}: waiting`;
    }
  });
}

/** 0..1, for a progress bar. Counts finished stages, not time. */
export function progressOf(run: ClipRun): number {
  const done = STAGE_ORDER.filter((id) => settled(run.stages[id].status)).length;
  return done / STAGE_ORDER.length;
}
