/**
 * Keeping the cuts across a reopen.
 *
 * The bug: a workflow that ran perfectly, reopened the next day, showed eight
 * Cut nodes all saying "the video is not loaded" and had nothing to show for a
 * finished run. The clips existed — in a Map belonging to a tab that had been
 * closed.
 *
 * These run against a real IndexedDB implementation rather than a hand-written
 * fake, because the parts most likely to be wrong are the parts a fake would
 * let me get away with: key prefixes, the shape that comes back out, and
 * whether a File survives the round trip still being a File.
 */

import 'fake-indexeddb/auto';

import * as vault from '../studio/clip/vault';

const bytes = (n: number) => new Blob([new Uint8Array(n)], { type: 'video/mp4' });

beforeEach(async () => {
  await vault.clear();
});

describe('keeping and restoring clips', () => {
  it('gives a clip back after the tab is gone', async () => {
    await vault.saveMedia('src-1#Look at these straw', bytes(2048));

    const back = await vault.restore();

    expect(back.media).toHaveLength(1);
    expect(back.media[0].key).toBe('src-1#Look at these straw');
    expect(back.media[0].blob.size).toBe(2048);
  });

  it('gives a source back as a File, not a Blob', async () => {
    /* The pipeline probes `name` to pick a demuxer and keys off name, size and
       modified time. A Blob would be a different file by the only definition
       that matters here. */
    const file = new File([new Uint8Array(64)], 'podcast.mp4', {
      type: 'video/mp4', lastModified: 1727000000000,
    });
    await vault.saveSource('podcast.mp4:64:1727000000000', file);

    const back = await vault.restore();
    const restored = back.sources[0].file;

    expect(restored).toBeInstanceOf(File);
    expect(restored.name).toBe('podcast.mp4');
    expect(restored.lastModified).toBe(1727000000000);
    expect(restored.size).toBe(64);
  });

  it('keeps clips and sources apart', async () => {
    /* Both are keyed by the same source key. Without the prefix a clip would
       come back as a source and be handed to the demuxer. */
    await vault.saveMedia('shared-key', bytes(10));
    await vault.saveSource('shared-key', new File([new Uint8Array(20)], 'v.mp4'));

    const back = await vault.restore();

    expect(back.media.map((m) => m.key)).toEqual(['shared-key']);
    expect(back.sources.map((s) => s.key)).toEqual(['shared-key']);
    expect(back.media[0].blob.size).toBe(10);
    expect(back.sources[0].file.size).toBe(20);
  });

  it('replaces rather than duplicating when the same clip is cut again', async () => {
    await vault.saveMedia('k', bytes(10));
    await vault.saveMedia('k', bytes(99));

    const back = await vault.restore();

    expect(back.media).toHaveLength(1);
    expect(back.media[0].blob.size).toBe(99);
  });

  it('starts empty', async () => {
    expect(await vault.restore()).toEqual({ media: [], sources: [] });
  });
});

describe('forgetting a video', () => {
  it('drops the source and everything cut from it', async () => {
    await vault.saveSource('ep7', new File([new Uint8Array(8)], 'ep7.mp4'));
    await vault.saveMedia('ep7#opening line here', bytes(10));
    await vault.saveMedia('ep7#closing line here', bytes(10));
    await vault.saveMedia('ep8#a different video', bytes(10));

    await vault.drop('ep7');
    const back = await vault.restore();

    expect(back.sources).toHaveLength(0);
    expect(back.media.map((m) => m.key)).toEqual(['ep8#a different video']);
  });

  it('does not drop a video whose key merely starts the same', async () => {
    /* "ep7" and "ep70" are different episodes. Matching on prefix alone would
       take the second with the first. */
    await vault.saveSource('ep7', new File([new Uint8Array(8)], 'a.mp4'));
    await vault.saveSource('ep70', new File([new Uint8Array(8)], 'b.mp4'));

    await vault.drop('ep7');
    const back = await vault.restore();

    expect(back.sources.map((s) => s.key)).toEqual(['ep70']);
  });
});

describe('staying inside a budget', () => {
  it('refuses a source too large to be worth keeping', async () => {
    /* A four gigabyte camera master would evict everything else on its way in,
       to serve one workflow. */
    const huge = new File([new Uint8Array(8)], 'master.mov');
    Object.defineProperty(huge, 'size', { value: 4 * 1024 * 1024 * 1024 });

    await vault.saveSource('master', huge);

    expect((await vault.restore()).sources).toHaveLength(0);
  });

  it('keeps a source of ordinary size', async () => {
    await vault.saveSource('ok', new File([new Uint8Array(1024)], 'ok.mp4'));
    expect((await vault.restore()).sources).toHaveLength(1);
  });
});

describe('when the browser has no IndexedDB', () => {
  /* Everything must no-op rather than throw. Losing persistence is the OLD
     behaviour — drop the file in again — and it has to stay available as the
     fallback rather than becoming a crash. */
  const real = globalThis.indexedDB;
  beforeAll(() => { (globalThis as any).indexedDB = undefined; });
  afterAll(() => { (globalThis as any).indexedDB = real; });

  it('says it cannot persist', () => {
    expect(vault.canPersist()).toBe(false);
  });

  it('saves without complaining', async () => {
    await expect(vault.saveMedia('k', bytes(4))).resolves.toBeUndefined();
    await expect(vault.saveSource('k', new File([new Uint8Array(4)], 'v.mp4')))
      .resolves.toBeUndefined();
  });

  it('restores nothing rather than failing', async () => {
    await expect(vault.restore()).resolves.toEqual({ media: [], sources: [] });
  });

  it('forgets and clears without failing', async () => {
    await expect(vault.drop('k')).resolves.toBeUndefined();
    await expect(vault.clear()).resolves.toBeUndefined();
  });
});

describe('putting it back into the store on reopen', () => {
  /* The integration point. sourceStore's Maps are the fast path in front of
     the vault; hydrate is what fills them when a tab starts cold, and it runs
     before the canvas renders so a Cut node mounts with its clip already in
     hand rather than mounting broken. */

  let store: typeof import('../studio/clip/sourceStore');

  beforeEach(async () => {
    jest.resetModules();
    store = await import('../studio/clip/sourceStore');
    store.forgetAll();
  });

  it('brings back a finished clip so no re-run is needed', async () => {
    await vault.saveMedia('src-1#Look at these straw', bytes(512));

    const counts = await store.hydrate();

    expect(counts.media).toBe(1);
    expect(store.getMedia('src-1#Look at these straw')?.size).toBe(512);
  });

  it('brings back the source so a cut can run again', async () => {
    /* Without this, every Cut node on a reopened workflow threw "the video is
       not loaded" — which is the failure that started all of this. */
    await vault.saveSource('ep.mp4:99:5', new File([new Uint8Array(99)], 'ep.mp4', { lastModified: 5 }));

    await store.hydrate();

    expect(store.hasSource('ep.mp4:99:5')).toBe(true);
    expect(store.getSource('ep.mp4:99:5')?.name).toBe('ep.mp4');
  });

  it('never overwrites a file dropped in this session', async () => {
    /* A restored copy of the same key is the same bytes at best and a stale
       namesake at worst. What the user just chose wins. */
    await vault.saveSource('k', new File([new Uint8Array(1)], 'old.mp4'));
    store.putSource('k', new File([new Uint8Array(2)], 'just-dropped.mp4'));

    await store.hydrate();

    expect(store.getSource('k')?.name).toBe('just-dropped.mp4');
  });

  it('reports nothing when there is nothing kept', async () => {
    expect(await store.hydrate()).toEqual({ sources: 0, media: 0 });
  });
});

describe('evicting to stay inside the browser quota', () => {
  /* Measured, not assumed: navigator.storage.estimate() reported a 3GB quota
     on the harness origin — exactly what the fixed ceiling used to be. The
     vault would have tried to fill the whole allowance and met
     QuotaExceededError halfway through keeping a run that had just succeeded. */

  const withQuota = (quota: number) => {
    Object.defineProperty(globalThis, 'navigator', {
      value: { storage: { estimate: async () => ({ quota, usage: 0 }) } },
      configurable: true,
    });
  };
  const realNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  afterAll(() => {
    if (realNavigator) Object.defineProperty(globalThis, 'navigator', realNavigator);
  });

  it('drops the oldest when the quota is nearly full', async () => {
    withQuota(20_000);                       // budget is half of this: 10,000

    await vault.saveMedia('oldest', bytes(4000));
    await vault.saveMedia('middle', bytes(4000));
    await vault.saveMedia('newest', bytes(4000));

    const kept = (await vault.restore()).media.map((m) => m.key);
    expect(kept).not.toContain('oldest');
    expect(kept).toContain('newest');
  });

  it('gives up a source before a clip of the same age', async () => {
    /* A source can be dropped in again. A clip cannot be remade without one. */
    withQuota(20_000);

    await vault.saveSource('vid', new File([new Uint8Array(6000)], 'vid.mp4'));
    await vault.saveMedia('vid#a quoted line here', bytes(6000));

    const back = await vault.restore();
    expect(back.sources).toHaveLength(0);
    expect(back.media).toHaveLength(1);
  });

  it('keeps everything when there is plenty of room', async () => {
    withQuota(500 * 1024 * 1024);

    await vault.saveMedia('a', bytes(1000));
    await vault.saveMedia('b', bytes(1000));

    expect((await vault.restore()).media).toHaveLength(2);
  });
});
