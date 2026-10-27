/// <reference types="node" />
import { Blob as NodeBlob, File as NodeFile } from 'node:buffer';
import { ReadableStream } from 'node:stream/web';
import { TextEncoder } from 'node:util';
import { ensureSession, getAccessToken } from '../../studio-extension/src/shared/api';
import { IMPORT_SERVER, readServerVideo } from '../src/social/importVideo';
import { socialLink } from '../src/social/policy';

jest.mock('../../studio-extension/src/shared/api', () => ({ ensureSession: jest.fn(), getAccessToken: jest.fn() }));
const link = socialLink('https://www.youtube.com/shorts/AbCdEfGh_12')!;
const original = { fetch: globalThis.fetch, Blob: globalThis.Blob, File: globalThis.File };
const bytes = new Uint8Array([0,0,0,24,102,116,121,112,109,112,52,50]);
const reply = (content = bytes) => ({ ok: true, headers: new Headers({ 'content-type': 'video/mp4' }), body: new ReadableStream({ start(c) { c.enqueue(content); c.close(); } }) });
beforeEach(() => { jest.mocked(ensureSession).mockResolvedValue('valid'); jest.mocked(getAccessToken).mockResolvedValue('account-token'); Object.assign(globalThis, { Blob: NodeBlob, File: NodeFile }); });
afterEach(() => { Object.assign(globalThis, original); jest.clearAllMocks(); });

test('server download sends only the selected URL, permission confirmation and account bearer to fixed host', async () => {
  const fetch = jest.fn().mockResolvedValue(reply()); Object.assign(globalThis, { fetch });
  const progress = jest.fn(), signal = new AbortController().signal;
  const file = await readServerVideo(link, signal, progress);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch).toHaveBeenCalledWith(`${IMPORT_SERVER}/api/imports/video`, expect.objectContaining({ method: 'POST', credentials: 'omit', redirect: 'error', signal,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer account-token' },
    body: JSON.stringify({ url: link.url, reuse_permission: true }) }));
  expect(file.name).toBe('youtube-AbCdEfGh_12.mp4'); expect(file.size).toBe(bytes.length); expect(progress).toHaveBeenCalledWith(bytes.length);
});
test('missing session starts no server download', async () => {
  jest.mocked(ensureSession).mockResolvedValue('no_session'); const fetch = jest.fn(); Object.assign(globalThis, { fetch });
  await expect(readServerVideo(link, new AbortController().signal, jest.fn())).rejects.toThrow(/Sign in/);
  expect(fetch).not.toHaveBeenCalled();
});
test('cancellation during auth starts no download', async () => {
  const controller = new AbortController(); controller.abort(); const fetch = jest.fn(); Object.assign(globalThis, { fetch });
  await expect(readServerVideo(link, controller.signal, jest.fn())).rejects.toHaveProperty('name', 'AbortError'); expect(fetch).not.toHaveBeenCalled();
});
test.each([401,429,404,503])('server error %s is surfaced without implicit browser fallback or retry', async status => {
  const fetch = jest.fn().mockResolvedValue({ ok: false, status, json: async () => ({}) }); Object.assign(globalThis, { fetch });
  await expect(readServerVideo(link, new AbortController().signal, jest.fn())).rejects.toThrow(); expect(fetch).toHaveBeenCalledTimes(1);
});
test('server must return real bounded media, never an HTML error page', async () => {
  Object.assign(globalThis, { fetch: jest.fn().mockResolvedValue(reply(new TextEncoder().encode('<html>not media</html>'))) });
  await expect(readServerVideo(link, new AbortController().signal, jest.fn())).rejects.toThrow(/not a video/);
});
