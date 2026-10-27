/// <reference types="node" />
import { Blob as NodeBlob, File as NodeFile } from 'node:buffer';
import { ReadableStream } from 'node:stream/web';
import { allowedMedia, MAX_IMPORT_BYTES, MEDIA_ORIGINS, sameVideo, socialLink } from '../src/social/policy';
import { jsonAssignment, pageMedia } from '../src/social/pageMedia';
import { readVideo, requestMediaAccess, resolveVideo, saveVideo } from '../src/social/importVideo';

const tik = 'https://www.tiktok.com/@creator/video/123456789';
const insta = 'https://www.instagram.com/reel/AbCd_123/';
const youtube = 'https://www.youtube.com/watch?v=AbCdEfGh_12';
const parse = (url: string) => socialLink(url)!;
const doc = (html: string) => new DOMParser().parseFromString(html, 'text/html');
const media = { pageUrl: tik, mediaUrl: 'https://v16.tiktokcdn.com/video.mp4', name: 'tiktok-123456789.mp4' };
const original = { chrome: globalThis.chrome, fetch: globalThis.fetch, Blob: globalThis.Blob, File: globalThis.File };

afterEach(() => { Object.assign(globalThis, original); jest.restoreAllMocks(); });

test.each([
  [tik + '?tracking=remove', 'tiktok', '123456789'], [insta, 'instagram', 'AbCd_123'],
  ['https://www.instagram.com/p/AbCd_123/', 'instagram', 'AbCd_123'],
  [youtube + '&utm=remove', 'youtube', 'AbCdEfGh_12'], ['https://youtu.be/AbCdEfGh_12?si=remove', 'youtube', 'AbCdEfGh_12'],
  ['https://www.youtube.com/shorts/AbCdEfGh_12', 'youtube', 'AbCdEfGh_12'], ['https://vm.tiktok.com/AbC123/', 'tiktok', ''],
])('accepts and cleans supported video link %s', (url, platform, id) => {
  expect(socialLink(url)).toMatchObject({ platform, id });
  expect(socialLink(url)?.url).not.toMatch(/tracking|utm|si=/);
});
test.each(['http://www.tiktok.com/@c/video/1', 'https://www.tiktok.com.evil.test/@c/video/1', 'https://evil.test/?url=' + tik,
  'https://www.instagram.com/accounts/login/', 'https://www.youtube.com/playlist?list=test', 'https://127.0.0.1/video.mp4',
  'javascript:alert(1)', 'https://user:pass@www.tiktok.com/@c/video/1', 'https://www.tiktok.com:444/@c/video/1', 'https://www.youtube.com/@channel'])
('rejects non-video and untrusted URL %s', url => expect(socialLink(url)).toBeNull());

test('media allowlist rejects lookalikes, credentials, redirects targets and other platforms', () => {
  expect(allowedMedia(media.mediaUrl, 'tiktok')).toBe(true);
  expect(allowedMedia('https://a.cdninstagram.com/file', 'instagram')).toBe(true);
  expect(allowedMedia('https://r1.googlevideo.com/videoplayback', 'youtube')).toBe(true);
  for (const url of ['https://tiktokcdn.com.evil.test/file', 'https://user@v.tiktokcdn.com/file', 'http://v.tiktokcdn.com/file', 'blob:https://www.tiktok.com/abc', 'https://localhost/file']) expect(allowedMedia(url, 'tiktok')).toBe(false);
  expect(allowedMedia(media.mediaUrl, 'instagram')).toBe(false);
  expect(sameVideo(parse(tik), parse(tik.replace('123456789', '987654321')))).toBe(false);
});

const tikDoc = (item: any) => doc(`<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">${JSON.stringify({ __DEFAULT_SCOPE__: { 'webapp.video-detail': { itemInfo: { itemStruct: item } } } })}</script>`);
test('TikTok uses matching explicit download media, never a playAddr substitute', () => {
  expect(pageMedia(tikDoc({ id: '123456789', video: { downloadAddr: media.mediaUrl } }), tik, parse(tik))).toEqual(media);
  for (const item of [
    { id: 'wrong', video: { downloadAddr: media.mediaUrl } },
    { id: '123456789', preventDownload: true, video: { downloadAddr: media.mediaUrl } },
    { id: '123456789', video: { downloadEnabled: false, downloadAddr: media.mediaUrl } },
    { id: '123456789', item_control: { prevent_download: true }, video: { downloadAddr: media.mediaUrl } },
    { id: '123456789', video: { playAddr: media.mediaUrl } },
  ]) expect(() => pageMedia(tikDoc(item), tik, parse(tik))).toThrow(/downloadable/);
});

test('TikTok short links read the resolved post but ordinary links cannot return a different video', () => {
  const d = tikDoc({ id: '123456789', video: { downloadAddr: { urlList: [media.mediaUrl] } } });
  expect(pageMedia(d, tik, parse('https://vm.tiktok.com/abc/')).pageUrl).toBe(tik);
  expect(() => pageMedia(d, tik.replace('123456789', '123'), parse(tik))).toThrow(/different/);
});

test('Instagram reads an ordinary video file from a single visible player', () => {
  const d = doc('<video src="https://a.cdninstagram.com/video.mp4"></video>');
  jest.spyOn(d.querySelector('video')!, 'getBoundingClientRect').mockReturnValue({ width: 300, height: 400, bottom: 400, top: 0 } as DOMRect);
  expect(pageMedia(d, insta, parse(insta)).mediaUrl).toBe('https://a.cdninstagram.com/video.mp4');
  d.querySelector('video')!.setAttribute('src', 'blob:https://www.instagram.com/test');
  expect(() => pageMedia(d, insta, parse(insta))).toThrow(/segmented/);
});

test('JSON assignments are parsed as data without running script code', () => {
  expect(jsonAssignment('var ytInitialPlayerResponse = {"a":"escaped \\" quote }","b":{}}; window.sideEffect=true;', 'ytInitialPlayerResponse =')).toEqual({ a: 'escaped " quote }', b: {} });
  expect(jsonAssignment('ytInitialPlayerResponse = {bad}', 'ytInitialPlayerResponse =')).toBeNull();
  expect((window as any).sideEffect).toBeUndefined();
});

test('YouTube only accepts an already signed, muxed file for the exact video', () => {
  const format = { url: 'https://r1.googlevideo.com/videoplayback?expire=1', mimeType: 'video/mp4', audioQuality: 'AUDIO_QUALITY_MEDIUM', height: 360 };
  const ytDoc = (changes: any = {}) => doc(`<script>var ytInitialPlayerResponse = ${JSON.stringify({ videoDetails: { videoId: parse(youtube).id }, playabilityStatus: { status: 'OK' }, streamingData: { formats: [format] }, ...changes })};</script>`);
  expect(pageMedia(ytDoc(), youtube, parse(youtube)).mediaUrl).toBe(format.url);
  for (const changes of [{ videoDetails: { videoId: 'wrong' } }, { playabilityStatus: { status: 'LOGIN_REQUIRED' } },
    { streamingData: { formats: [{ ...format, signatureCipher: 'protected' }] } },
    { streamingData: { adaptiveFormats: [format] } }, { streamingData: { formats: [{ ...format, audioQuality: undefined }] } }]) {
    expect(() => pageMedia(ytDoc(changes), youtube, parse(youtube))).toThrow(/downloadable/);
  }
});

test('requests only the selected media hosts, before resolving any video', async () => {
  const request = jest.fn().mockResolvedValue(false);
  Object.assign(globalThis, { chrome: { permissions: { request } } });
  expect(await requestMediaAccess(parse(insta))).toBe(false);
  expect(request).toHaveBeenCalledWith({ origins: MEDIA_ORIGINS.instagram });
  expect(await requestMediaAccess(parse(youtube))).toBe(true);
  expect(request).toHaveBeenCalledTimes(1);
});

test('reuses an existing exact video tab and distrusts its returned media', async () => {
  const sendMessage = jest.fn().mockResolvedValue({ media });
  const create = jest.fn();
  Object.assign(globalThis, { chrome: { tabs: { query: jest.fn().mockResolvedValue([{ id: 42, url: tik }]), get: jest.fn().mockResolvedValue({ status: 'complete' }), create, sendMessage } } });
  expect(await resolveVideo(parse(tik), new AbortController().signal)).toEqual(media);
  expect(create).not.toHaveBeenCalled();
  expect(sendMessage).toHaveBeenCalledWith(42, { type: 'MOTION_SOCIAL_READ', url: tik });
  sendMessage.mockResolvedValue({ media: { ...media, mediaUrl: 'https://127.0.0.1/secret' } });
  await expect(resolveVideo(parse(tik), new AbortController().signal)).rejects.toThrow(/unsupported/);
});

test('feed selection reuses an already-open canonical video even if the badge came from another tab', async () => {
  const create = jest.fn();
  Object.assign(globalThis, { chrome: { tabs: { query: jest.fn().mockResolvedValue([{ id: 11, url: 'https://www.tiktok.com/foryou' }, { id: 42, url: tik }]),
    get: jest.fn().mockResolvedValue({ status: 'complete' }), create, sendMessage: jest.fn().mockResolvedValue({ media }) } } });
  expect(await resolveVideo(parse(tik), new AbortController().signal, 11)).toEqual(media);
  expect(create).not.toHaveBeenCalled();
});

function fetchResponse(chunks: Uint8Array[], type = 'video/mp4', length?: string) {
  Object.assign(globalThis, { Blob: NodeBlob, File: NodeFile, fetch: jest.fn().mockResolvedValue({ ok: true,
    headers: { get: (name: string) => name === 'content-type' ? type : length || null },
    body: new ReadableStream({ start(controller) { chunks.forEach(c => controller.enqueue(c)); controller.close(); } }),
  }) });
}
const mp4 = new Uint8Array([0, 0, 0, 12, 102, 116, 121, 112, 109, 112, 52, 50]);
test('download is bounded and never sends credentials or follows redirects', async () => {
  fetchResponse([mp4]);
  const signal = new AbortController().signal, progress = jest.fn();
  const file = await readVideo(media, signal, progress);
  expect(file.name).toBe(media.name); expect(file.type).toBe('video/mp4'); expect(file.size).toBe(12);
  expect(globalThis.fetch).toHaveBeenCalledWith(media.mediaUrl, { credentials: 'omit', redirect: 'error', signal });
  expect(progress).toHaveBeenCalledWith(12);
});
test('rejects HTML, disguised non-video bytes and both declared and streamed oversize responses', async () => {
  fetchResponse([mp4], 'text/html'); await expect(readVideo(media, new AbortController().signal, () => {})).rejects.toThrow(/downloadable/);
  fetchResponse([new Uint8Array([1, 2, 3])]); await expect(readVideo(media, new AbortController().signal, () => {})).rejects.toThrow(/not a video/);
  fetchResponse([mp4], 'video/mp4', String(MAX_IMPORT_BYTES + 1)); await expect(readVideo(media, new AbortController().signal, () => {})).rejects.toThrow(/100 MB/);
  fetchResponse([{ byteLength: MAX_IMPORT_BYTES + 1 } as Uint8Array]); await expect(readVideo(media, new AbortController().signal, () => {})).rejects.toThrow(/100 MB/);
});
test('cancellation cannot return a half-downloaded file', async () => {
  const controller = new AbortController(); controller.abort(); fetchResponse([mp4]);
  await expect(readVideo(media, controller.signal, () => {})).rejects.toMatchObject({ name: 'AbortError' });
});
test('Downloads uses the same local bytes, safe names, and releases object URLs on completion', async () => {
  Object.assign(URL, { createObjectURL: jest.fn().mockReturnValue('blob:local-file'), revokeObjectURL: jest.fn() });
  const addListener = jest.fn(), removeListener = jest.fn(), download = jest.fn().mockResolvedValue(10);
  Object.assign(globalThis, { chrome: { downloads: { download, search: jest.fn().mockResolvedValue([{ state: 'in_progress' }]), onChanged: { addListener, removeListener } } } });
  expect(await saveVideo(new File(['bytes'], 'tiktok-123.mp4'))).toBe(10);
  expect(download).toHaveBeenCalledWith({ url: 'blob:local-file', filename: 'AutoFlow Motion/tiktok-123.mp4', conflictAction: 'uniquify', saveAs: false });
  expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  addListener.mock.calls[0][0]({ id: 10, state: { current: 'complete' } });
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:local-file'); expect(removeListener).toHaveBeenCalled();
});
