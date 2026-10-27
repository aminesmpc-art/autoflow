/// <reference types="node" />
/**
 * "Keep both trim points inside the source video." — on a selection that was
 * inside it.
 *
 * The panel reads a video's length from a <video> element: 22.87s. The run
 * reads it from the file's own samples (mediabunny's computeDuration), and
 * that comes out a few milliseconds shorter. The trim, dragged to the very
 * end, ended at 22.87 — accepted by the panel, which showed 2 clips — and the
 * run, checking it against its own shorter length, refused it at Generate.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { planMotionRun, planMotionVideo } from '../../studio-extension/src/studio/ask/motionRange';

const SHOWN = 22.87;
const MEASURED = 22.866;
const TO_THE_END = { motionVideoMode: 'trim' as const, motionTrimStart: 4.415, motionTrimEnd: SHOWN, sourceDuration: SHOWN };

test('the reported selection fails when checked against the run\'s own length', () => {
  /* Not hypothetical: this is the check the run used to make. */
  expect(() => planMotionVideo(MEASURED, TO_THE_END)).toThrow('Keep both trim points inside the source video.');
});

test('the run checks it against the length the panel showed, and cuts to the file\'s real end', () => {
  const chunks = planMotionRun(MEASURED, TO_THE_END);
  expect(chunks).toHaveLength(2);
  expect(chunks[0].startSec).toBe(4.415);
  expect(chunks[chunks.length - 1].endSec).toBe(MEASURED);
  expect(chunks[1].startSec).toBe(chunks[0].endSec);
  expect(chunks.every((c) => c.seconds <= 10)).toBe(true);
});

test('a selection inside both lengths is cut exactly where it was chosen', () => {
  const chunks = planMotionRun(MEASURED, { ...TO_THE_END, motionTrimEnd: 20 });
  expect(chunks[chunks.length - 1].endSec).toBe(20);
});

test('the panel\'s own rules still hold: past the length it showed is refused', () => {
  expect(() => planMotionRun(11, { motionVideoMode: 'trim', motionTrimStart: 0, motionTrimEnd: 11.001, sourceDuration: 11 }))
    .toThrow('Keep both trim points inside the source video.');
});

test('a file much shorter than the panel measured is said, not quietly cut short', () => {
  expect(() => planMotionRun(15, TO_THE_END)).toThrow(/shorter than the panel measured/);
  expect(() => planMotionRun(4, TO_THE_END)).toThrow(/shorter than the panel measured/);
});

test('with no panel length — Studio\'s node — it is the old plan', () => {
  const range = { motionVideoMode: 'trim' as const, motionTrimStart: 2, motionTrimEnd: 18 };
  expect(planMotionRun(22, range)).toEqual(planMotionVideo(22, range));
  expect(planMotionRun(22, {})).toEqual(planMotionVideo(22, {}));
});

test('the run plans with planMotionRun, from the probed length', () => {
  const runner = readFileSync(join(__dirname, '..', '..', 'studio-extension', 'src', 'studio', 'engine', 'WorkflowRunner.ts'), 'utf8');
  expect(runner).toMatch(/const chunks = planMotionRun\(probe\.durationSec, nodeData\);/);
  expect(runner).not.toMatch(/planMotionVideo\(probe\.durationSec/);
});
