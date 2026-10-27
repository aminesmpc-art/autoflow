import { framesFromVideoBlob } from '../../studio-extension/src/content/flow/videoFrames';

/* jsdom decodes nothing, so a real <video> is given the timings Chrome 154
   showed: a live webm (no Duration element) reports Infinity once loaded, and
   a seek far past the end makes Chrome read to the last frame, fire
   durationchange with the real length, and settle the seek there. */
const RED = 'data:image/jpeg;base64,UkVE', BLUE = 'data:image/jpeg;base64,Qkx1ZQ==';
let drawnAt = -1;
function clip(length: number, { declared = false, endFound = true } = {}) {
  const video = document.createElement('video'), seeks: number[] = [];
  let duration = NaN, readyState = 0, currentTime = 0;
  const fire = (type: string) => video.dispatchEvent(new Event(type));
  Object.defineProperties(video, {
    duration: { get: () => duration }, readyState: { get: () => readyState },
    videoWidth: { get: () => 64 }, videoHeight: { get: () => 64 },
    currentTime: { get: () => currentTime, set: (t: number) => {
      seeks.push(t); readyState = 1; currentTime = duration === Infinity ? Infinity : Math.min(t, duration);
      setTimeout(() => {
        if (duration === Infinity && endFound) { duration = length; fire('durationchange'); currentTime = Math.min(t, length); }
        readyState = 4; fire('seeked');
      }, 10);
    } },
    load: { value: () => {
      if (!video.getAttribute('src')) return;
      setTimeout(() => { duration = declared ? length : Infinity; readyState = 1; fire('loadedmetadata'); readyState = 4; fire('loadeddata'); }, 5);
    } },
  });
  const create = document.createElement.bind(document);
  jest.spyOn(document, 'createElement').mockImplementation(((tag: string) => tag === 'video' ? video : create(tag)) as any);
  return seeks;
}
beforeEach(() => {
  drawnAt = -1;
  Object.assign(URL, { createObjectURL: () => 'blob:clip', revokeObjectURL: () => {} });
  /* Red until 3s, blue after: the frame drawn says where the playhead was. */
  (HTMLCanvasElement.prototype as any).getContext = () => ({ drawImage: (video: HTMLVideoElement) => { drawnAt = video.currentTime; } });
  (HTMLCanvasElement.prototype as any).toDataURL = () => drawnAt >= 3 ? BLUE : RED;
});
afterEach(() => jest.restoreAllMocks());
const webm = () => new Blob(['webm'], { type: 'video/webm' });

test('a clip that does not declare its length is measured, then read from its end', async () => {
  const seeks = clip(6);
  const lines: string[] = [];
  expect(await framesFromVideoBlob(webm(), line => lines.push(line))).toEqual({ first: RED, last: BLUE });
  expect(seeks[0]).toBeGreaterThan(1e9);
  expect(seeks[1]).toBeCloseTo(5.95);
  expect(lines).toEqual([]);
});

test('a length that stays unknown gives no ending frame, never the opening one', async () => {
  clip(6, { endFound: false });
  const lines: string[] = [];
  expect(await framesFromVideoBlob(webm(), line => lines.push(line))).toEqual({ first: RED, last: '' });
  expect(lines.join('\n')).toMatch(/does not record its length/);
});

test('a clip that declares its length is never seeked past its end', async () => {
  const seeks = clip(6, { declared: true });
  expect(await framesFromVideoBlob(webm())).toEqual({ first: RED, last: BLUE });
  expect(seeks).toHaveLength(1);
  expect(seeks[0]).toBeCloseTo(5.95);
});
