import { recoverMotionEndFrame } from '../../studio-extension/src/studio/media/motionEndFrame';
import { framesFromVideoBlob } from '../../studio-extension/src/content/flow/videoFrames';
jest.mock('../../studio-extension/src/content/flow/videoFrames', () => ({ framesFromVideoBlob: jest.fn() }));
const FRAME = 'data:image/jpeg;base64,QUJD';
beforeEach(() => {
  (globalThis as any).fetch = jest.fn(async () => ({ blob: async () => new Blob(['video'], { type: 'video/mp4' }) }));
  (globalThis as any).chrome = { runtime: { sendMessage: jest.fn(async () => ({ dataUrl: 'data:video/mp4;base64,QUJD' })) } };
  (framesFromVideoBlob as jest.Mock).mockResolvedValue({ first: 'data:image/png;base64,REVG', last: FRAME });
});
test('recovers from the generated video bytes without a generation submission', async () => {
  expect(await recoverMotionEndFrame('data:video/mp4;base64,QUJD')).toBe(FRAME);
  expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
});
test('does not mistake an opening frame for a missing ending frame', async () => {
  (framesFromVideoBlob as jest.Mock).mockResolvedValue({ first: FRAME, last: '' });
  await expect(recoverMotionEndFrame('data:video/mp4;base64,QUJD')).rejects.toThrow(/decode the ending frame/);
});
test('rejects missing media, posters and arbitrary remote URLs', async () => {
  await expect(recoverMotionEndFrame()).rejects.toThrow(/No playable/);
  await expect(recoverMotionEndFrame('https://example.test/video.mp4')).rejects.toThrow(/not a saved Flow/);
  (fetch as jest.Mock).mockResolvedValue({ blob: async () => new Blob(['poster'], { type: 'image/png' }) });
  await expect(recoverMotionEndFrame('data:video/mp4;base64,QUJD')).rejects.toThrow(/not a readable video/);
});
test('remote Flow media uses the bounded worker fetch, never the source video', async () => {
  expect(await recoverMotionEndFrame('https://flow-content.google/video/one')).toBe(FRAME);
  expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'STUDIO_FETCH_MEDIA', payload: { url: 'https://flow-content.google/video/one', maxBytes: 64 * 1024 * 1024 } });
});
