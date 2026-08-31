/**
 * Putting a cut into the Flow media library.
 *
 * This exists because every DOM route to get a file into Flow is dead — tested
 * against the live site, including the two that looked most promising. A
 * capture listener proved a synthetic paste and a synthetic drop BOTH reached
 * the page carrying real video bytes, and Flow ignored them: synthetic events
 * are isTrusted:false and page script cannot forge that. And the Clipboard API
 * reports supports('video/mp4') === false, so there is no real clipboard route
 * either.
 *
 * What is left is the request the page itself makes, watched and replayed. The
 * start call is confirmed working against production. The upload call is NOT —
 * five header combinations came back "Chunk upload failed" — so the whole
 * thing ships as an attempt with a fallback.
 *
 * Which makes the failure paths the important tests. A generation that would
 * have worked without a style reference must still work when the reference
 * cannot be uploaded.
 */

import {
  fallbackInstruction,
  libraryName,
  projectIdFromUrl,
  uploadToLibrary,
} from '../content/flow/uploadVideo';

const PROJECT = 'a060bf74-3618-410d-8789-669c13de188e';
const clip = (size = 4096) =>
  new Blob([new Uint8Array(size)], { type: 'video/mp4' });

/** A fetch that answers the two steps however the test wants. */
function fakeFetch(plan: {
  start?: { status?: number; body?: unknown } | Error;
  upload?: { status?: number; body?: unknown } | Error;
}) {
  const calls: Array<{ url: string; method: string; headers: Record<string, string>; bytes: number }> = [];
  const fn = (async (url: string, init: any = {}) => {
    calls.push({
      url: String(url),
      method: init.method || 'GET',
      headers: init.headers || {},
      bytes: init.body instanceof Blob ? init.body.size : 0,
    });
    /* A plan that only describes one step gets a working other step. Without
       this, a test about the UPLOAD failing silently became a test about the
       start returning no session, and asserted the wrong message. */
    const isStart = String(url).includes('action=start');
    const which = isStart
      ? (plan.start ?? { body: { sessionUrl: 'https://upload.example/session/abc', status: 'ok' } })
      : (plan.upload ?? { body: { status: 'ok' } });
    if (which instanceof Error) throw which;
    const status = which?.status ?? 200;
    const body = which?.body ?? {};
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    };
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const happy = {
  start: { body: { sessionUrl: 'https://upload.example/session/abc', status: 'ok' } },
  upload: { body: { status: 'ok' } },
};

describe('finding the project to upload into', () => {
  it('reads it out of a Flow project url', () => {
    expect(projectIdFromUrl(`https://labs.google/fx/tools/flow/project/${PROJECT}`)).toBe(PROJECT);
  });

  it('gives nothing on any other Flow page', () => {
    for (const href of [
      'https://labs.google/fx/tools/flow',
      'https://labs.google/fx/tools/flow/',
      'https://example.com/project/abc',
    ]) {
      expect(projectIdFromUrl(href)).toBe('');
    }
  });
});

describe('the name it goes in under', () => {
  /* The whole point of the library is finding it again — the adapter searches
     by this string and so does the user, so a uuid would be a worse answer
     than the clip's own label. */
  it('is made from the clip label', () => {
    expect(libraryName('1. We actually have like one')).toBe('1-We-actually-have-like-one.mp4');
  });

  it('drops what a filename cannot carry', () => {
    expect(libraryName('Clip #3: "the hook" / part 2')).toBe('Clip-3-the-hook-part-2.mp4');
  });

  it('stays short enough to read in a picker', () => {
    expect(libraryName('x'.repeat(200)).length).toBeLessThanOrEqual(52);
  });

  it('always has a name, even given none', () => {
    expect(libraryName('')).toBe('clip.mp4');
    expect(libraryName('!!!')).toBe('clip.mp4');
  });
});

describe('the two steps, when they work', () => {
  it('opens the upload with the size and type Flow asks for', async () => {
    const { fn, calls } = fakeFetch(happy);
    await uploadToLibrary(clip(1234), 'my clip', { fetch: fn, projectId: PROJECT });

    const start = calls[0];
    expect(start.method).toBe('POST');
    expect(start.url).toContain('action=start');
    expect(start.headers['x-upload-content-length']).toBe('1234');
    expect(start.headers['x-upload-content-type']).toBe('video/mp4');
    expect(start.headers['x-upload-project-id']).toBe(PROJECT);
  });

  it('sends the bytes with the session it was given', async () => {
    const { fn, calls } = fakeFetch(happy);
    await uploadToLibrary(clip(4096), 'my clip', { fetch: fn, projectId: PROJECT });

    const put = calls[1];
    expect(put.method).toBe('PUT');
    expect(put.url).toContain('action=upload');
    expect(put.headers['x-upload-session-url']).toBe('https://upload.example/session/abc');
    expect(put.headers['x-upload-offset']).toBe('0');
    expect(put.bytes).toBe(4096);
  });

  it('uses the command that got furthest against production', () => {
    /* "upload" and "finalize" alone are rejected at 400; this reaches the
       chunk handler and fails at 500, which reads like a command that parsed. */
    const { fn, calls } = fakeFetch(happy);
    return uploadToLibrary(clip(), 'c', { fetch: fn, projectId: PROJECT }).then(() => {
      expect(calls[1].headers['x-upload-command']).toBe('upload, finalize');
    });
  });

  it('reports the name it can be found under', async () => {
    const { fn } = fakeFetch(happy);
    const out = await uploadToLibrary(clip(), 'Clip one', { fetch: fn, projectId: PROJECT });
    expect(out).toEqual({ ok: true, name: 'Clip-one.mp4' });
  });
});

describe('every way it can fail', () => {
  /* None of these may throw. A style reference is an improvement to a
     generation that works fine without one. */

  it('says so when it is not on a project page', async () => {
    const { fn, calls } = fakeFetch(happy);
    const out = await uploadToLibrary(clip(), 'c', { fetch: fn, projectId: '' });
    expect(out).toEqual({ ok: false, stage: 'setup', reason: 'not on a Flow project page' });
    expect(calls).toHaveLength(0);      // nothing was sent
  });

  it('says so when the clip is empty', async () => {
    const { fn } = fakeFetch(happy);
    const out = await uploadToLibrary(new Blob([]), 'c', { fetch: fn, projectId: PROJECT });
    expect(out).toMatchObject({ ok: false, stage: 'setup' });
  });

  it('reports a refused start with its status', async () => {
    const { fn } = fakeFetch({ start: { status: 403 } });
    const out = await uploadToLibrary(clip(), 'c', { fetch: fn, projectId: PROJECT });
    expect(out).toMatchObject({ ok: false, stage: 'start' });
    expect((out as any).reason).toMatch(/403/);
  });

  it('calls out a 200 with no session as the protocol changing', async () => {
    /* The most likely way this breaks one day: still 200, different shape. It
       must not read as a network blip. */
    const { fn } = fakeFetch({ start: { body: { status: 'ok' } } });
    const out = await uploadToLibrary(clip(), 'c', { fetch: fn, projectId: PROJECT });
    expect((out as any).reason).toMatch(/protocol has changed/);
  });

  it('carries the server’s own words when the upload is rejected', async () => {
    /* "Chunk upload failed" is what production actually says, and it is the
       difference between a wrong header and a rejected file. */
    const { fn } = fakeFetch({
      upload: { status: 500, body: { error: { message: 'Chunk upload failed' } } },
    });
    const out = await uploadToLibrary(clip(), 'c', { fetch: fn, projectId: PROJECT });
    expect(out).toMatchObject({ ok: false, stage: 'upload' });
    expect((out as any).reason).toMatch(/Chunk upload failed/);
  });

  it('survives the network throwing rather than answering', async () => {
    for (const plan of [
      { start: new Error('offline') },
      { upload: new Error('connection reset') },
    ]) {
      const { fn } = fakeFetch(plan as any);
      await expect(
        uploadToLibrary(clip(), 'c', { fetch: fn, projectId: PROJECT }),
      ).resolves.toMatchObject({ ok: false });
    }
  });

  it('survives a start that answers with something that is not JSON', async () => {
    const { fn } = fakeFetch({ start: { body: '<html>oops</html>' } });
    await expect(
      uploadToLibrary(clip(), 'c', { fetch: fn, projectId: PROJECT }),
    ).resolves.toMatchObject({ ok: false, stage: 'start' });
  });
});

describe('what it tells the user when it could not', () => {
  it('names the step, the remedy, and the name to use', async () => {
    /* "Something went wrong" makes a person reload and try again. Naming the
       remedy makes them do the one click that finishes the job — and naming
       the FILE means the adapter finds it automatically next time. */
    const { fn } = fakeFetch({ upload: { status: 500, body: { error: 'Chunk upload failed' } } });
    const out = await uploadToLibrary(clip(), 'Clip one', { fetch: fn, projectId: PROJECT });

    const said = fallbackInstruction(out, 'Clip one');
    expect(said).toMatch(/Chunk upload failed/);
    expect(said).toMatch(/Upload media/);
    expect(said).toMatch(/Clip-one\.mp4/);
  });

  it('says nothing at all when it worked', async () => {
    const { fn } = fakeFetch(happy);
    const out = await uploadToLibrary(clip(), 'c', { fetch: fn, projectId: PROJECT });
    expect(fallbackInstruction(out, 'c')).toBe('');
  });
});
