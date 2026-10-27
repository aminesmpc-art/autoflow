/// <reference types="node" />
/**
 * "I want when I finish, I click on download and download all the videos in
 * one folder that I pick." Every ready clip goes into the picked folder, named
 * after the project and numbered by piece, never over an existing file. A clip
 * that cannot be read is named in the result and the rest are still saved.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { clipFileName, extensionFor, freeName, pickFolder, safeName, saveClips, saveSummary, type Folder } from '../src/saveClips';

/** An in-memory folder with the parts of FileSystemDirectoryHandle that saving uses. */
function folder(name = 'Clips', existing: string[] = []) {
  const files = new Map<string, Blob>(existing.map(f => [f, new Blob(['old'])]));
  const handle: Folder = {
    name,
    async getFileHandle(file, options) {
      if (!files.has(file) && !options?.create) throw Object.assign(new Error('missing'), { name: 'NotFoundError' });
      return {
        async createWritable() {
          return { async write(data: Blob) { files.set(file, data); }, async close() { /* written */ } };
        },
      };
    },
  };
  return { handle, files };
}

const videoResponse = (type = 'video/mp4') => ({ ok: true, status: 200, blob: async () => new Blob(['clip'], { type }) });
beforeEach(() => {
  (globalThis as any).fetch = jest.fn(async () => videoResponse());
  delete (globalThis as any).showDirectoryPicker;
});

describe('names', () => {
  it('names clips after the project, numbered by piece', () => {
    expect(clipFileName('My Dance', 3, 4, 'mp4')).toBe('My Dance - 03.mp4');
    expect(clipFileName('My Dance', 7, 120, 'mp4')).toBe('My Dance - 007.mp4');
  });

  it('keeps only what Windows accepts', () => {
    expect(safeName('a/b\\c:d*e?"f<g>h|i')).toBe('a b c d e f g h i');
    expect(safeName('  ending.  ')).toBe('ending');
    expect(safeName('')).toBe('Motion');
    expect(safeName('CON')).toBe('CON_');
  });

  it('keeps the kind of video', () => {
    expect(extensionFor('video/mp4')).toBe('mp4');
    expect(extensionFor('video/webm')).toBe('webm');
    expect(extensionFor('')).toBe('mp4');
  });

  it('never takes a name that is already there', async () => {
    const { handle } = folder('Clips', ['Dance - 01.mp4', 'Dance - 01 (2).mp4']);
    expect(await freeName(handle, 'Dance - 01.mp4')).toBe('Dance - 01 (3).mp4');
    expect(await freeName(handle, 'Dance - 02.mp4')).toBe('Dance - 02.mp4');
  });
});

describe('saving', () => {
  it('saves every clip into the folder, in piece order', async () => {
    const { handle, files } = folder('Clips', ['Dance - 01.mp4']);
    const progress: number[] = [];
    const result = await saveClips(handle, [
      { index: 1, url: 'data:video/mp4;base64,AAAA' },
      { index: 3, url: 'data:video/mp4;base64,BBBB' },
    ], 'Dance', 3, done => progress.push(done));
    expect(result).toEqual({ saved: ['Dance - 01 (2).mp4', 'Dance - 03.mp4'], failed: [] });
    expect([...files.keys()]).toEqual(['Dance - 01.mp4', 'Dance - 01 (2).mp4', 'Dance - 03.mp4']);
    expect(progress).toEqual([1, 2]);
  });

  it('reads a Flow address with the Google session, and says so when the link has expired', async () => {
    (globalThis as any).fetch = jest.fn(async (url: string) => (url.includes('expired')
      ? { ok: false, status: 403, blob: async () => new Blob() } : videoResponse()));
    const { handle } = folder();
    const result = await saveClips(handle, [
      { index: 1, url: 'https://flow-content.google/video/abc' },
      { index: 2, url: 'https://flow-content.google/video/expired' },
    ], 'Dance', 2);
    expect((globalThis as any).fetch).toHaveBeenCalledWith('https://flow-content.google/video/abc', { credentials: 'include' });
    expect(result.saved).toEqual(['Dance - 01.mp4']);
    expect(result.failed).toEqual([{ index: 2, why: "Flow's link to this clip has expired. Download it from Flow" }]);
  });

  it('refuses an address that is not a Flow video', async () => {
    const { handle } = folder();
    const result = await saveClips(handle, [{ index: 1, url: 'https://example.com/x.mp4' }], 'Dance', 1);
    expect(result.failed[0].why).toBe('this clip has no saved video');
    expect((globalThis as any).fetch).not.toHaveBeenCalled();
  });

  it('says what happened in one sentence', () => {
    expect(saveSummary({ saved: ['a', 'b'], failed: [] }, 'Clips')).toEqual({ ok: true, text: 'Saved 2 clips to "Clips".' });
    expect(saveSummary({ saved: ['a'], failed: [] }, 'Clips').text).toBe('Saved 1 clip to "Clips".');
    expect(saveSummary({ saved: ['a'], failed: [{ index: 2, why: 'gone' }] }, 'Clips'))
      .toEqual({ ok: false, text: 'Saved 1 of 2 clips to "Clips". Not saved — piece 2: gone.' });
  });
});

describe('the folder picker', () => {
  it('opens Chrome\'s picker where the user saved last time, able to write', async () => {
    const picked = folder().handle;
    const picker = jest.fn(async () => picked);
    (globalThis as any).showDirectoryPicker = picker;
    expect(await pickFolder()).toBe(picked);
    expect(picker).toHaveBeenCalledWith({ id: 'motion-clips', mode: 'readwrite' });
  });

  it('does nothing when the user closes it', async () => {
    (globalThis as any).showDirectoryPicker = async () => { throw Object.assign(new Error('closed'), { name: 'AbortError' }); };
    expect(await pickFolder()).toBeNull();
  });

  it('says so when the browser has no folder picker', async () => {
    await expect(pickFolder()).rejects.toThrow(/cannot save into a folder/);
  });
});

describe('the panel', () => {
  const APP = readFileSync(join(__dirname, '..', 'src', 'App.tsx'), 'utf8');

  it('offers it once a clip is ready, and not while a job runs or a save is going', () => {
    // Beside the clip filters, once there is something to save.
    expect(APP).toMatch(/\{complete > 0 && <button type="button" className="btn btn--secondary btn--sm" disabled=\{running \|\| !!exporting \|\| !extension\} onClick=\{\(\) => void downloadAll\(\)\}>/);
    expect(APP).toMatch(/disabled=\{running \|\| !!exporting \|\| !extension\}/);
    expect(APP).toMatch(/complete === 1 \? 'Download the clip' : `Download all \$\{complete\} clips`/);
  });

  it('picks the folder on the click itself, then saves only ready clips', () => {
    const at = APP.indexOf('const downloadAll = async');
    const body = APP.slice(at, APP.indexOf('const setUploadConsent', at));
    expect(body).toMatch(/pieces\.filter\(p => p\.status === 'done' && p\.videoUrl\)/);
    expect(body.indexOf('pickFolder()')).toBeLessThan(body.indexOf('saveClips('));
  });
});
