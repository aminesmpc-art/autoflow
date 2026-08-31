/**
 * The Clipping node's spine.
 *
 * The claim this file exists to defend is a single sentence from the spec:
 * a failure at the cut must never re-trigger eight minutes of transcription.
 * That is not a performance nicety — it is the difference between a node
 * someone uses twice and one they use once. So the central tests count how
 * many times each runner was CALLED, not what came back.
 *
 * The second claim is subtler and easier to get wrong: invalidation runs
 * forward. Re-picking the window makes the cut and the beat map stale, because
 * both describe a clip that no longer exists. Keeping them because they are
 * marked "done" is how the node ends up showing a confident beat map for a
 * different sixty seconds — no error, no warning, just the wrong answer.
 */

import {
  STAGE_ORDER, emptyRun, forSource, invalidateFrom, nextPending, isComplete,
  resultOf, advance, describeRun, progressOf,
  type ClipRun, type StageId, type StageRunner,
} from '../studio/clip/stages';

/** Runners that record their calls, so caching can be asserted on directly. */
function spies(overrides: Partial<Record<StageId, StageRunner>> = {}) {
  const calls: StageId[] = [];
  const runners = {} as Record<StageId, StageRunner>;
  for (const id of STAGE_ORDER) {
    runners[id] = overrides[id]
      ? (async (prev, sig) => { calls.push(id); return overrides[id]!(prev, sig); })
      : (async () => { calls.push(id); return `${id}-result`; });
  }
  return { calls, runners };
}

const countOf = (calls: StageId[], id: StageId) => calls.filter((c) => c === id).length;

/* ------------------------------------------------------------------ */

describe('a fresh run', () => {
  it('starts with every stage waiting', () => {
    const run = emptyRun('src-1');
    expect(nextPending(run)).toBe('ingest');
    expect(isComplete(run)).toBe(false);
    expect(progressOf(run)).toBe(0);
  });

  it('runs the stages in pipeline order', async () => {
    const { calls, runners } = spies();
    const out = await advance(emptyRun('src-1'), { runners });
    expect(calls).toEqual([...STAGE_ORDER]);
    expect(isComplete(out)).toBe(true);
    expect(progressOf(out)).toBe(1);
  });

  it('hands each stage the previous stage result', async () => {
    const seen: unknown[] = [];
    const { runners } = spies({
      transcribe: async (prev) => { seen.push(prev); return 'transcript'; },
      survey: async (prev) => { seen.push(prev); return 'survey'; },
      layout: async (prev) => { seen.push(prev); return 'clip'; },
    });
    await advance(emptyRun('src-1'), { runners });
    expect(seen).toEqual(['ingest-result', 'transcript', 'survey']);
  });

  it('keeps each result reachable by name afterwards', async () => {
    const { runners } = spies({ survey: async () => ({ hook: 'the housing market' }) });
    const out = await advance(emptyRun('src-1'), { runners });
    expect(resultOf(out, 'survey')).toEqual({ hook: 'the housing market' });
    expect(resultOf(out, 'layout')).toBe('layout-result');
  });
});

/* ------------------------------------------------------------------ */

describe('caching — the reason this file exists', () => {
  it('does NOT re-run transcription when a later stage failed', async () => {
    /* THE test. Transcribing is minutes of wall clock and a dozen round trips
       to a chat UI; the cut is seconds of local arithmetic. A cut that fails
       must cost the cut, not the transcription. */
    const first = spies({ layout: async () => { throw new Error('encoder said no'); } });
    const failed = await advance(emptyRun('src-1'), { runners: first.runners });
    expect(countOf(first.calls, 'transcribe')).toBe(1);
    expect(failed.stages.layout.status).toBe('failed');

    const second = spies();
    const fixed = await advance(failed, { runners: second.runners });
    expect(countOf(second.calls, 'transcribe')).toBe(0);
    expect(countOf(second.calls, 'ingest')).toBe(0);
    expect(countOf(second.calls, 'layout')).toBe(1);
    expect(isComplete(fixed)).toBe(true);
  });

  it('resumes from the failed stage, not from the beginning', async () => {
    const first = spies({ survey: async () => { throw new Error('no good moment'); } });
    const failed = await advance(emptyRun('src-1'), { runners: first.runners });

    const second = spies();
    await advance(failed, { runners: second.runners });
    expect(second.calls).toEqual(['survey', 'layout']);
  });

  it('does nothing at all on a completed run', async () => {
    const { runners } = spies();
    const done = await advance(emptyRun('src-1'), { runners });
    const again = spies();
    const out = await advance(done, { runners: again.runners });
    expect(again.calls).toEqual([]);
    expect(isComplete(out)).toBe(true);
  });

  it('keeps the work when the node is reopened on the same file', async () => {
    const { runners } = spies();
    const done = await advance(emptyRun('src-1'), { runners });
    const reopened = forSource(done, 'src-1');
    expect(isComplete(reopened)).toBe(true);
    expect(resultOf(reopened, 'transcribe')).toBe('transcribe-result');
  });

  it('throws all of it away when the file changes', async () => {
    /* A transcript of a different podcast is worse than no transcript: it is
       wrong and it looks finished. */
    const { runners } = spies();
    const done = await advance(emptyRun('src-1'), { runners });
    const swapped = forSource(done, 'src-2');
    expect(isComplete(swapped)).toBe(false);
    expect(nextPending(swapped)).toBe('ingest');
    expect(resultOf(swapped, 'transcribe')).toBeUndefined();
  });
});

/* ------------------------------------------------------------------ */

describe('invalidation runs forward', () => {
  const completed = async (): Promise<ClipRun> => {
    const { runners } = spies();
    return advance(emptyRun('src-1'), { runners });
  };

  it('clears the stage and everything after it', async () => {
    const out = invalidateFrom(await completed(), 'survey');
    expect(out.stages.ingest.status).toBe('done');
    expect(out.stages.transcribe.status).toBe('done');
    expect(out.stages.survey.status).toBe('pending');
    expect(out.stages.layout.status).toBe('pending');
    expect(out.stages.layout.status).toBe('pending');
  });

  it('re-runs exactly the stages it cleared', async () => {
    const out = invalidateFrom(await completed(), 'survey');
    const { calls, runners } = spies();
    await advance(out, { runners });
    expect(calls).toEqual(['survey', 'layout']);
  });

  it('does not strand a stale beat map after the window is re-picked', async () => {
    /* The failure this rule prevents. Both the cut and the beat map were made
       from the old window; keeping them because they are "done" shows a
       confident plan for a clip that no longer exists. */
    const done = await completed();
    expect(resultOf(done, 'layout')).toBe('layout-result');
    const out = invalidateFrom(done, 'survey');
    expect(resultOf(out, 'layout')).toBeUndefined();
    expect(resultOf(out, 'layout')).toBeUndefined();
  });

  it('leaves everything alone for an unknown stage', async () => {
    const done = await completed();
    const out = invalidateFrom(done, 'nonsense' as StageId);
    expect(isComplete(out)).toBe(true);
  });

  it('does not mutate the run it was given', async () => {
    const done = await completed();
    invalidateFrom(done, 'ingest');
    expect(isComplete(done)).toBe(true);
  });
});

/* ------------------------------------------------------------------ */

describe('failure', () => {
  it('records a reason a person can act on', async () => {
    const { runners } = spies({
      layout: async () => { throw new Error('The clip ends before it starts.'); },
    });
    const out = await advance(emptyRun('src-1'), { runners });
    expect(out.stages.layout.status).toBe('failed');
    expect(out.stages.layout.error).toBe('The clip ends before it starts.');
  });

  it('leaves the stages after it waiting, not failed', async () => {
    /* They were never attempted. Marking them failed reports four problems
       where there is one, and hides which one actually broke. */
    const { runners } = spies({ survey: async () => { throw new Error('nope'); } });
    const out = await advance(emptyRun('src-1'), { runners });
    expect(out.stages.survey.status).toBe('failed');
    expect(out.stages.layout.status).toBe('pending');
    expect(out.stages.layout.status).toBe('pending');
  });

  it('survives a runner that throws something that is not an Error', async () => {
    const { runners } = spies({ layout: async () => { throw 'just a string'; } });
    const out = await advance(emptyRun('src-1'), { runners });
    expect(out.stages.layout.error).toContain('just a string');
  });

  it('says so plainly when a stage has no runner wired up', async () => {
    const { runners } = spies();
    delete (runners as Partial<Record<StageId, StageRunner>>).layout;
    const out = await advance(emptyRun('src-1'), { runners });
    expect(out.stages.layout.status).toBe('failed');
    expect(out.stages.layout.error).toMatch(/Lay out the cuts/);
  });
});

/* ------------------------------------------------------------------ */

describe('cancelling', () => {
  it('leaves the cancelled stage resumable rather than failed', async () => {
    /* Stopping a run must not look like a broken node, and must not leave an
       error the user has to clear before pressing run again. */
    const abort = new DOMException('aborted', 'AbortError');
    const { runners } = spies({ transcribe: async () => { throw abort; } });
    const out = await advance(emptyRun('src-1'), { runners });
    expect(out.stages.transcribe.status).toBe('pending');
    expect(out.stages.transcribe.error).toBeUndefined();
    expect(nextPending(out)).toBe('transcribe');
  });

  it('stops before starting anything once the signal is aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const { calls, runners } = spies();
    await advance(emptyRun('src-1'), { runners, signal: controller.signal });
    expect(calls).toEqual([]);
  });

  it('passes the signal down so a runner can stop its own work', async () => {
    const controller = new AbortController();
    let got: AbortSignal | undefined;
    const { runners } = spies({ ingest: async (_p, sig) => { got = sig; return 'x'; } });
    await advance(emptyRun('src-1'), { runners, signal: controller.signal });
    expect(got).toBe(controller.signal);
  });
});

/* ------------------------------------------------------------------ */

describe('reporting', () => {
  it('emits a change per transition so the node can redraw as it goes', async () => {
    const seen: string[] = [];
    const { runners } = spies();
    await advance(emptyRun('src-1'), {
      runners,
      onChange: (r) => seen.push(STAGE_ORDER.map((id) => r.stages[id].status[0]).join('')),
    });
    /* running then done for each stage. Written against STAGE_ORDER rather
       than a literal 'rpppp', because the pipeline has changed shape once and
       the literal failed for a reason that had nothing to do with the claim. */
    expect(seen.length).toBe(STAGE_ORDER.length * 2);
    expect(seen[0]).toBe('r' + 'p'.repeat(STAGE_ORDER.length - 1));
    expect(seen[seen.length - 1]).toBe('d'.repeat(STAGE_ORDER.length));
  });

  it('hands onChange a copy, not the live object', async () => {
    const grabbed: ClipRun[] = [];
    const { runners } = spies();
    await advance(emptyRun('src-1'), { runners, onChange: (r) => grabbed.push(r) });
    /* The first snapshot must still show stage one running, not the finished
       state — otherwise a UI that keeps history shows five identical rows. */
    expect(grabbed[0].stages.ingest.status).toBe('running');
    expect(grabbed[grabbed.length - 1].stages.ingest.status).toBe('done');
  });

  it('describes every stage in words', async () => {
    const { runners } = spies({ layout: async () => { throw new Error('encoder said no'); } });
    const out = await advance(emptyRun('src-1'), { runners });
    const lines = describeRun(out);
    expect(lines).toHaveLength(STAGE_ORDER.length);
    expect(lines[0]).toMatch(/^Read the file: done/);
    expect(lines[STAGE_ORDER.indexOf('layout')]).toMatch(/failed — encoder said no/);
  });

  it('reports progress by stages finished', async () => {
    const { runners } = spies({ survey: async () => { throw new Error('x'); } });
    const out = await advance(emptyRun('src-1'), { runners });
    /* ingest and transcribe finished; survey failed and layout never ran. */
    expect(progressOf(out)).toBeCloseTo(2 / STAGE_ORDER.length, 5);
  });
});

/* ------------------------------------------------------------------ */

describe('skipping a stage the run does not need', () => {
  it('never calls a skipped stage runner', async () => {
    /* Campaign clipping draws no motion graphics, because the brief forbids
       content that is not affiliated with it. */
    const { calls, runners } = spies();
    const out = await advance(emptyRun('src-1'), {
      runners,
      skip: { layout: 'the campaign brief forbids unaffiliated content' },
    });
    expect(calls).not.toContain('layout');
    expect(out.stages.layout.status).toBe('skipped');
  });

  it('does not call a skipped stage DONE', async () => {
    /* THE distinction. A rail reporting "Direct the beats: done" for a run
       that drew nothing is a lie the node then repeats to its user. */
    const { runners } = spies();
    const out = await advance(emptyRun('src-1'), { runners, skip: { layout: 'not needed here' } });
    expect(out.stages.layout.status).not.toBe('done');
    expect(resultOf(out, 'layout')).toBeUndefined();
  });

  it('keeps the reason, so the node can say why', async () => {
    const { runners } = spies();
    const out = await advance(emptyRun('src-1'), {
      runners, skip: { layout: 'the campaign brief forbids unaffiliated content' },
    });
    expect(out.stages.layout.reason).toMatch(/campaign brief/);
    expect(describeRun(out)[STAGE_ORDER.indexOf('layout')]).toMatch(/skipped — the campaign brief/);
  });

  it('still counts the run as finished', async () => {
    /* A skipped stage must settle the run, or the node waits forever for a
       stage that is never going to run. */
    const { runners } = spies();
    const out = await advance(emptyRun('src-1'), { runners, skip: { layout: 'x' } });
    expect(nextPending(out)).toBeNull();
    expect(isComplete(out)).toBe(true);
    expect(progressOf(out)).toBe(1);
  });

  it('runs everything that is not skipped', async () => {
    const { calls, runners } = spies();
    await advance(emptyRun('src-1'), { runners, skip: { layout: 'x' } });
    expect(calls).toEqual(STAGE_ORDER.filter((id) => id !== 'layout'));
  });

  it('passes the last real result forward across a skipped stage', async () => {
    /* A skipped stage is not a gap in the chain: the one after it still has
       to receive the last result that actually exists. */
    const seen: unknown[] = [];
    const { runners } = spies({ layout: async (prev) => { seen.push(prev); return 'b'; } });
    await advance(emptyRun('src-1'), { runners, skip: { survey: 'x' } });
    /* layout receives transcribe's result, because survey never produced one. */
    const out = await advance(emptyRun('src-2'), {
      runners: spies({ layout: async (prev) => { seen.push(prev); return 'c'; } }).runners,
      skip: { survey: 'x' },
    });
    expect(seen[seen.length - 1]).toBe('transcribe-result');
    expect(isComplete(out)).toBe(true);
  });
});
