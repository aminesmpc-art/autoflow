/**
 * The journal that makes a hidden run explicable.
 *
 * Step 1 of the background-working plan is "measure before changing focus
 * behaviour", and the reason is that today the three interesting outcomes
 * are indistinguishable after the fact:
 *
 *   never submitted        the composer was not ready, nothing was sent
 *   submitted, uncollected Flow has it; the tab stopped watching
 *   submitted, collected   worked, and looked like nothing to the user
 *
 * All three present as a node with no result, which is precisely why the
 * plan forbids blind resubmission — one of them costs money to repeat.
 */
import {
  record, readAll, readAttempt, clear, summarise, scrubDetail,
  newAttemptId, __setStorage, MAX_ENTRIES, AttemptEntry,
} from '../shared/attemptLog';

/** chrome.storage.local, minus chrome. */
function memoryStorage() {
  const bag: Record<string, unknown> = {};
  return {
    bag,
    get: async (key: string) => ({ [key]: bag[key] }),
    set: async (items: Record<string, unknown>) => { Object.assign(bag, items); },
  };
}

beforeEach(() => {
  __setStorage(memoryStorage());
});

describe('an attempt can be reconstructed afterwards', () => {
  it('keeps entries in order across contexts', async () => {
    const id = 'n1-abc';
    await record(id, 'attempt_start', { provider: 'flow', nodeId: 'n1' });
    await record(id, 'composer_ready', { tabId: 7, hidden: false });
    await record(id, 'submitted', { tabId: 7, mediaId: 'media-123', hidden: true });
    await record(id, 'collected', { tabId: 7 });

    const story = await readAttempt(id);
    expect(story.map((e) => e.phase)).toEqual([
      'attempt_start', 'composer_ready', 'submitted', 'collected',
    ]);
  });

  it('separates one attempt from another', async () => {
    await record('a-1', 'attempt_start', {});
    await record('b-2', 'attempt_start', {});
    await record('a-1', 'submitted', { mediaId: 'm' });

    expect((await readAttempt('a-1')).length).toBe(2);
    expect((await readAttempt('b-2')).length).toBe(1);
  });

  /* Entries written in the same millisecond must not reorder — which they
     do if only `at` is used, and these are written in tight loops. */
  it('orders entries written within the same millisecond', async () => {
    const now = 1_700_000_000_000;
    jest.spyOn(Date, 'now').mockReturnValue(now);
    const id = 'same-ms';
    await record(id, 'attempt_start', {});
    await record(id, 'composer_ready', {});
    await record(id, 'submitted', {});
    (Date.now as jest.Mock).mockRestore();

    const story = await readAttempt(id);
    expect(story.map((e) => e.phase)).toEqual(
      ['attempt_start', 'composer_ready', 'submitted']);
    expect(story[0].seq).toBeLessThan(story[2].seq);
  });
});

describe('it answers the question the plan asks', () => {
  const story = async (id: string): Promise<AttemptEntry[]> => readAttempt(id);

  it('distinguishes never-submitted from submitted-and-uncollected', async () => {
    await record('never', 'attempt_start', {});
    await record('never', 'composer_blocked', { detail: 'composer not found' });
    await record('never', 'gave_up', {});

    await record('orphan', 'attempt_start', {});
    await record('orphan', 'submitted', { mediaId: 'm-9', hidden: true });
    await record('orphan', 'tab_discarded', {});

    const a = summarise(await story('never'));
    const b = summarise(await story('orphan'));

    expect(a.submitted).toBe(false);
    expect(b.submitted).toBe(true);
    expect(b.mediaId).toBe('m-9');
    expect(b.collected).toBe(false);
    // The one that must never be blindly retried: Flow already has it.
    expect(b.tabLost).toBe(true);
  });

  it('records whether the tab was hidden at the moment of submission', async () => {
    await record('h', 'attempt_start', {});
    await record('h', 'tab_hidden', {});
    await record('h', 'submitted', { mediaId: 'm', hidden: true });
    const s = summarise(await story('h'));
    expect(s.everHidden).toBe(true);
    expect(s.hiddenAtSubmit).toBe(true);
  });

  it('says nothing about hiddenAtSubmit when nothing was submitted', async () => {
    await record('q', 'attempt_start', {});
    expect(summarise(await story('q')).hiddenAtSubmit).toBeUndefined();
  });

  it('reports how long the attempt took', async () => {
    const id = 'timed';
    jest.spyOn(Date, 'now').mockReturnValue(1000);
    await record(id, 'attempt_start', {});
    (Date.now as jest.Mock).mockReturnValue(4500);
    await record(id, 'attempt_end', {});
    (Date.now as jest.Mock).mockRestore();
    expect(summarise(await story(id)).ms).toBe(3500);
  });
});

describe('it refuses to store anything sensitive', () => {
  it('redacts a bearer token', () => {
    expect(scrubDetail('Authorization: Bearer abc.def-ghi')).toContain('[redacted]');
    expect(scrubDetail('Authorization: Bearer abc.def-ghi')).not.toContain('abc.def');
  });

  it('redacts a JWT', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9payload';
    expect(scrubDetail(`token=${jwt}`)).not.toContain('eyJhbGci');
  });

  it('redacts an api key', () => {
    expect(scrubDetail('sk-ABCDEFGHIJKLMNOP')).not.toContain('ABCDEFGHIJKLMNOP');
  });

  it('caps a long detail rather than storing a prompt', () => {
    const essay = 'a cinematic shot of '.repeat(40);
    const out = scrubDetail(essay)!;
    expect(out.length).toBeLessThanOrEqual(120);
  });

  it('scrubs on the way into storage, not merely on the way out', async () => {
    await record('s', 'composer_blocked', { detail: 'failed with Bearer sekrit-value' });
    const raw = JSON.stringify(await readAll());
    expect(raw).not.toContain('sekrit-value');
  });

  it('has no field that would carry a prompt', async () => {
    await record('s2', 'submitted', { mediaId: 'm1', nodeId: 'n', provider: 'flow' });
    const e = (await readAttempt('s2'))[0];
    expect(Object.keys(e).sort()).toEqual(
      ['at', 'attemptId', 'mediaId', 'nodeId', 'phase', 'provider', 'seq'].sort());
  });
});

describe('it cannot break what it measures', () => {
  it('is a no-op without storage rather than throwing', async () => {
    __setStorage(null);
    await expect(record('x', 'attempt_start', {})).resolves.toBeUndefined();
    await expect(readAll()).resolves.toEqual([]);
  });

  it('survives storage that throws', async () => {
    __setStorage({
      get: async () => { throw new Error('quota'); },
      set: async () => { throw new Error('quota'); },
    });
    await expect(record('x', 'submitted', { mediaId: 'm' })).resolves.toBeUndefined();
    await expect(readAll()).resolves.toEqual([]);
  });

  it('ignores an entry with no attempt id instead of orphaning it', async () => {
    await record('', 'attempt_start', {});
    expect(await readAll()).toEqual([]);
  });

  it('survives a corrupted journal', async () => {
    const s = memoryStorage();
    (s.bag as any).af_attempt_log = 'not an array';
    __setStorage(s);
    await record('ok', 'attempt_start', {});
    expect((await readAll()).length).toBe(1);
  });
});

describe('it stays bounded', () => {
  it('keeps the newest entries and drops the oldest', async () => {
    for (let i = 0; i < MAX_ENTRIES + 25; i++) {
      await record('bulk', 'status_observed', { detail: `i${i}` });
    }
    const all = await readAll();
    expect(all.length).toBe(MAX_ENTRIES);
    // The tail explains the run that just ended, so the tail is what survives.
    expect(all[all.length - 1].detail).toBe(`i${MAX_ENTRIES + 24}`);
    expect(all.some((e) => e.detail === 'i0')).toBe(false);
  });

  it('can be cleared', async () => {
    await record('z', 'attempt_start', {});
    await clear();
    expect(await readAll()).toEqual([]);
  });
});

describe('attempt ids line up across contexts', () => {
  it('is stable for the same node and stamp', () => {
    expect(newAttemptId('node-abc', 1234)).toBe(newAttemptId('node-abc', 1234));
  });

  it('differs per run of the same node', () => {
    expect(newAttemptId('node-abc', 1234)).not.toBe(newAttemptId('node-abc', 1235));
  });

  it('survives an id with awkward characters', () => {
    expect(newAttemptId('a/b c:d', 1)).toMatch(/^[A-Za-z0-9_-]+-[a-z0-9]+$/);
  });
});
