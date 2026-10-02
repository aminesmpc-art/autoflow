/**
 * What survives a restart, and what it stops you buying twice.
 *
 * Cancellation today is `this.abortRequested` — a field on a runner that
 * lives in the Studio page. Run progress is not stored anywhere at all. Each
 * of the three events step 5 names destroys both:
 *
 *   the worker is recycled   Chrome does this on idle, routinely
 *   Studio is closed         the runner goes with the tab
 *   the tab is discarded     the same, without the user doing anything
 *
 * Afterwards the honest answer to "did node 7 submit?" is a shrug, and a
 * shrug means resubmitting — while Flow already has the first one and Google
 * has already charged for it.
 *
 * So the property under test is narrow and expensive to get wrong: an
 * attempt holding a media id with no settlement is never a candidate for
 * retry, however the process died in between.
 */
import {
  beginRun, cancelRun, isRunCancelled, finishRun,
  beginAttempt, recordSubmitted, settleAttempt,
  recoverable, outstanding, outstandingAcrossRuns, readJournal, clearJournal,
  __setStorage, MAX_ATTEMPTS,
} from '../shared/runJournal';

/** chrome.storage.local, minus chrome — and shared, so a "restart" is just
    a fresh set of module calls against the same bag. */
function memoryStorage() {
  const bag: Record<string, unknown> = {};
  return {
    bag,
    get: async (key: string) => ({ [key]: bag[key] }),
    set: async (items: Record<string, unknown>) => { Object.assign(bag, items); },
  };
}

let store: ReturnType<typeof memoryStorage>;
beforeEach(() => {
  store = memoryStorage();
  __setStorage(store);
});

describe('a submitted generation is never bought twice', () => {
  it('hands back the attempt already in flight instead of a new one', async () => {
    await beginRun('run1');
    const first = await beginAttempt('run1', 'node7', 'a-1');
    await recordSubmitted('run1', 'node7', 'media-abc');

    // The worker restarts. Nothing in memory survives; the journal does.
    const again = await beginAttempt('run1', 'node7', 'a-2');

    expect(again.attemptId).toBe(first.attemptId);   // not 'a-2'
    expect(again.mediaId).toBe('media-abc');
  });

  it('names it as recoverable, which means observe rather than submit', async () => {
    await beginRun('run1');
    await beginAttempt('run1', 'node7', 'a-1');
    await recordSubmitted('run1', 'node7', 'media-abc');

    const rec = await recoverable('run1', 'node7');
    expect(rec).not.toBeNull();
    expect(rec!.mediaId).toBe('media-abc');
  });

  it('is not recoverable once it has settled', async () => {
    await beginRun('run1');
    await beginAttempt('run1', 'node7', 'a-1');
    await recordSubmitted('run1', 'node7', 'media-abc');
    await settleAttempt('run1', 'node7', 'done');

    expect(await recoverable('run1', 'node7')).toBeNull();
  });

  /* An attempt that never reached Flow owes nothing and may be retried —
     that is the whole point of distinguishing them. */
  it('an attempt that never submitted is not recoverable', async () => {
    await beginRun('run1');
    await beginAttempt('run1', 'node7', 'a-1');
    expect(await recoverable('run1', 'node7')).toBeNull();
  });

  it('starts a fresh attempt for the node once the old one settled', async () => {
    await beginRun('run1');
    await beginAttempt('run1', 'node7', 'a-1');
    await recordSubmitted('run1', 'node7', 'm1');
    await settleAttempt('run1', 'node7', 'failed');

    const next = await beginAttempt('run1', 'node7', 'a-2');
    expect(next.attemptId).toBe('a-2');
    expect(next.mediaId).toBeUndefined();
  });

  it('keeps nodes and runs apart', async () => {
    await beginRun('run1');
    await beginAttempt('run1', 'nodeA', 'a-1');
    await recordSubmitted('run1', 'nodeA', 'mA');

    expect(await recoverable('run1', 'nodeB')).toBeNull();
    expect(await recoverable('run2', 'nodeA')).toBeNull();
  });

  /* The id already recorded is the one still owed a result. Replacing it
     would lose track of the generation that is actually outstanding. */
  it('does not let a later id displace the outstanding one', async () => {
    await beginRun('run1');
    await beginAttempt('run1', 'node7', 'a-1');
    await recordSubmitted('run1', 'node7', 'first');
    await recordSubmitted('run1', 'node7', 'second');
    expect((await recoverable('run1', 'node7'))!.mediaId).toBe('first');
  });
});

describe('cancellation outlives the page that asked for it', () => {
  it('is remembered', async () => {
    await beginRun('run1');
    await cancelRun('run1');
    expect(await isRunCancelled('run1')).toBe(true);
  });

  /* A run stopped seconds before the worker recycled must not come back to
     life and resubmit everything it still owed. */
  it('is still set after a restart', async () => {
    await beginRun('run1');
    await cancelRun('run1');
    __setStorage(store);          // "restart": same storage, no memory
    expect(await isRunCancelled('run1')).toBe(true);
  });

  it('can be recorded for a run nobody registered', async () => {
    await cancelRun('ghost');
    expect(await isRunCancelled('ghost')).toBe(true);
  });

  it('keeps the first cancellation time', async () => {
    await beginRun('run1');
    await cancelRun('run1', 1000);
    await cancelRun('run1', 5000);
    const j = await readJournal();
    expect(j.runs.find((r) => r.runId === 'run1')!.cancelledAt).toBe(1000);
  });

  it('says nothing about a run it has never seen', async () => {
    expect(await isRunCancelled('unknown')).toBe(false);
  });

  it('records a finish without erasing the record', async () => {
    await beginRun('run1', 100);
    await finishRun('run1', 900);
    const j = await readJournal();
    expect(j.runs[0].finishedAt).toBe(900);
    expect(j.runs[0].startedAt).toBe(100);
  });
});

describe('what a restart has to reconcile', () => {
  it('lists everything still outstanding for the run', async () => {
    await beginRun('r');
    for (const n of ['n1', 'n2', 'n3']) {
      await beginAttempt('r', n, `a-${n}`);
      await recordSubmitted('r', n, `m-${n}`);
    }
    await settleAttempt('r', 'n2', 'done');

    const left = await outstanding('r');
    expect(left.map((a) => a.nodeId).sort()).toEqual(['n1', 'n3']);
  });

  it('is empty when everything settled', async () => {
    await beginRun('r');
    await beginAttempt('r', 'n1', 'a1');
    await recordSubmitted('r', 'n1', 'm1');
    await settleAttempt('r', 'n1', 'done');
    expect(await outstanding('r')).toEqual([]);
  });
});

describe('what a restart inherits', () => {
  it('lists submissions left open by a run that never finished', async () => {
    await beginRun('r1');
    await beginAttempt('r1', 'n1', 'a1');
    await recordSubmitted('r1', 'n1', 'm1');

    const left = await outstandingAcrossRuns();
    expect(left.map((a) => a.mediaId)).toEqual(['m1']);
  });

  it('ignores a run the user finished', async () => {
    await beginRun('r1');
    await beginAttempt('r1', 'n1', 'a1');
    await recordSubmitted('r1', 'n1', 'm1');
    await finishRun('r1');
    expect(await outstandingAcrossRuns()).toEqual([]);
  });

  /* Listing a cancelled run as outstanding work invites the user to undo
     their own decision — and pay for it. */
  it('ignores a run the user cancelled', async () => {
    await beginRun('r1');
    await beginAttempt('r1', 'n1', 'a1');
    await recordSubmitted('r1', 'n1', 'm1');
    await cancelRun('r1');
    expect(await outstandingAcrossRuns()).toEqual([]);
  });

  it('ignores an attempt that never reached Flow', async () => {
    await beginRun('r1');
    await beginAttempt('r1', 'n1', 'a1');
    expect(await outstandingAcrossRuns()).toEqual([]);
  });
});

describe('it stays bounded without losing what is owed', () => {
  /**
   * Trimming drops settled records first and never an unsettled one. An
   * unsettled attempt is the only evidence that a generation was paid for;
   * dropping it under pressure is precisely how the duplicate gets bought,
   * and it would happen on the busiest profiles.
   */
  it('never discards an attempt that is still owed a result', async () => {
    await beginRun('r');
    // One outstanding, then flood the journal with settled ones.
    await beginAttempt('r', 'owed', 'a-owed');
    await recordSubmitted('r', 'owed', 'm-owed');

    for (let i = 0; i < MAX_ATTEMPTS + 50; i++) {
      await beginAttempt('r', `n${i}`, `a${i}`);
      await settleAttempt('r', `n${i}`, 'done');
    }

    const j = await readJournal();
    expect(j.attempts.length).toBeLessThanOrEqual(MAX_ATTEMPTS);
    expect(await recoverable('r', 'owed')).not.toBeNull();
  });
});

describe('it cannot break the run it records', () => {
  it('is a no-op without storage', async () => {
    __setStorage(null);
    await expect(beginRun('r')).resolves.toBeUndefined();
    await expect(beginAttempt('r', 'n', 'a')).resolves.toBeTruthy();
    await expect(recoverable('r', 'n')).resolves.toBeNull();
    await expect(isRunCancelled('r')).resolves.toBe(false);
  });

  it('survives storage that throws', async () => {
    __setStorage({
      get: async () => { throw new Error('quota'); },
      set: async () => { throw new Error('quota'); },
    });
    await expect(cancelRun('r')).resolves.toBeUndefined();
    await expect(recoverable('r', 'n')).resolves.toBeNull();
  });

  it('survives a corrupted journal', async () => {
    (store.bag as any).af_run_journal = { runs: 'nope', attempts: 7 };
    await beginRun('r');
    await beginAttempt('r', 'n', 'a');
    await recordSubmitted('r', 'n', 'm');
    expect((await recoverable('r', 'n'))!.mediaId).toBe('m');
  });

  it('ignores a submission with no id to be recovered by', async () => {
    await beginRun('r');
    await beginAttempt('r', 'n', 'a');
    await recordSubmitted('r', 'n', '');
    expect(await recoverable('r', 'n')).toBeNull();
  });

  it('can be cleared', async () => {
    await beginRun('r');
    await beginAttempt('r', 'n', 'a');
    await clearJournal();
    const j = await readJournal();
    expect(j.runs).toEqual([]);
    expect(j.attempts).toEqual([]);
  });
});
