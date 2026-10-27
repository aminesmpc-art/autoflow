import { planMotionVideo, suggestedTrim, trimProblem, motionRangeKey } from '../../studio-extension/src/studio/ask/motionRange';
import { configuration, defaults, preflight } from '../src/model';

test('a true 10s source is one piece; a 10.03s or 11s full source remains split without discarding footage', () => {
  expect(planMotionVideo(10, {})).toHaveLength(1);
  for (const duration of [10.03, 11, 26]) {
    const pieces = planMotionVideo(duration, {});
    expect(pieces).toHaveLength(Math.ceil(duration / 10));
    expect(pieces[0].startSec).toBe(0);
    expect(pieces[pieces.length - 1].endSec).toBe(duration);
    expect(pieces.every(p => p.seconds <= 10)).toBe(true);
  }
});

test.each([10, 10.03, 11, 21, 31, 41, 65.783])('quick trim keeps legal chunks for %ss', duration => {
  for (const anchor of ['start', 'center', 'end'] as const) {
    const range = suggestedTrim(duration, anchor);
    expect(trimProblem(duration, range)).toBeNull();
    const chunks = planMotionVideo(duration, range);
    expect(chunks).toHaveLength(Math.max(1, Math.floor(duration / 10)));
    expect(chunks[0].startSec).toBe(range.motionTrimStart);
    expect(chunks[chunks.length - 1].endSec).toBe(range.motionTrimEnd);
    expect(chunks.every(c => c.seconds <= 10)).toBe(true);
    chunks.forEach((chunk, i) => {
      expect(chunk.index).toBe(i + 1);
      expect(chunk.of).toBe(chunks.length);
      if (i) expect(chunk.startSec).toBe(chunks[i - 1].endSec);
    });
  }
});

test('11s center trim removes half a second at both ends; arbitrary offsets stay source-relative', () => {
  expect(planMotionVideo(11, suggestedTrim(11))[0]).toMatchObject({ startSec: 0.5, endSec: 10.5, seconds: 10 });
  expect(planMotionVideo(50, { motionVideoMode: 'trim', motionTrimStart: 21.25, motionTrimEnd: 29.5 })[0])
    .toMatchObject({ startSec: 21.25, endSec: 29.5, seconds: 8.25 });
});

test.each([
  [-1, 8], [4, 4], [8, 4], [0, 11.001], [4, 15], [NaN, 8], [0, Infinity], [1, 1.1],
])('invalid selection %s to %s is rejected before a job is admitted', (start, end) => {
  const data = { ...defaults(), sourceDuration: 11, motionVideoMode: 'trim' as const, motionTrimStart: start, motionTrimEnd: end };
  expect(trimProblem(11, data)).toBeTruthy();
  expect(() => planMotionVideo(11, data)).toThrow();
  expect(preflight(data, { sourceAvailable: true, uploadAllowed: true, retry: false })).toBeTruthy();
});

test.each([[31, 3], [41, 4]])('%ss trims to %s clips instead of an extra generation', (duration, count) => {
  expect(planMotionVideo(duration, {})).toHaveLength(count + 1);
  const chunks = planMotionVideo(duration, suggestedTrim(duration));
  expect(chunks).toHaveLength(count);
  expect(chunks.map(c => c.seconds)).toEqual(Array(count).fill(10));
  expect(chunks[0].startSec).toBe(0.5);
  expect(chunks[count - 1].endSec).toBe(duration - 0.5);
});

test('arbitrary long ranges keep every selected frame with source-relative joins', () => {
  const chunks = planMotionVideo(60, { motionVideoMode: 'trim', motionTrimStart: 3.7, motionTrimEnd: 36.9 });
  expect(chunks).toHaveLength(4);
  expect(chunks[0].startSec).toBe(3.7);
  expect(chunks[3].endSec).toBe(36.9);
  expect(chunks.reduce((sum, c) => sum + c.seconds, 0)).toBeCloseTo(33.2);
  chunks.forEach((c, i) => { if (i) expect(c.startSec).toBe(chunks[i - 1].endSec); });
});

test('decimal subtraction cannot invent a fourth clip for a 30s selection', () => {
  expect(planMotionVideo(40, { motionVideoMode: 'trim', motionTrimStart: 2.3, motionTrimEnd: 32.3 })).toHaveLength(3);
});

test('switching to full ignores stored trim; legacy configurations and retries remain valid', () => {
  const data = defaults();
  expect(motionRangeKey(data)).toBeNull();
  expect(configuration({ ...data, motionVideoMode: 'full', motionTrimStart: 1, motionTrimEnd: 9 })).toBe(configuration(data));
  expect(planMotionVideo(11, { motionVideoMode: 'full', motionTrimStart: 1, motionTrimEnd: 9 })).toHaveLength(2);
});

test('changed selection invalidates old results instead of retrying the wrong bytes', () => {
  const data = { ...defaults(), sourceDuration: 11, ...suggestedTrim(11) };
  data.configurationAtRun = configuration(data);
  expect(preflight({ ...data, motionTrimStart: 1 }, { sourceAvailable: true, uploadAllowed: true, retry: true })).toMatch(/changed/);
});
