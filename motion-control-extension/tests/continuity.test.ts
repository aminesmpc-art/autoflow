import { clearMotionOutput, continuityInput, continuityOutputCurrent, continuityRetryThrough, endingFrame } from '../../studio-extension/src/studio/ask/motionContinuity';
import { motionFinalPrompt } from '../../studio-extension/src/studio/ask/motionGuidance';
import { motionWork, type MotionPieceRow } from '../../studio-extension/src/studio/ask/motionControl';
import { configuration, defaults, preflight, recover } from '../src/model';

const FRAME = 'data:image/jpeg;base64,QUJD';
const row = (index: number, over: Partial<MotionPieceRow> = {}): MotionPieceRow => ({ index, of: 4, startSec: (index - 1) * 10, endSec: index * 10, seconds: 10,
  cutsSpeech: false, filename: `p${index}.mp4`, prompt: 'Follow the motion.', why: '', status: 'idle', uploaded: true, ...over });
const done = (index: number, over: Partial<MotionPieceRow> = {}) => row(index, { status: 'done', tileId: `tile-${index}`, endFrameUrl: FRAME, continuityVersion: `v${index}`, ...over });

test('continuity is opt-in and off keeps old saved configuration identities', () => {
  const data = defaults();
  expect(data.motionContinuity).toBe(false);
  expect(configuration(data)).toBe(JSON.stringify([data.sourceKey, data.motionMode, data.platform, data.wish, data.motionPreset, data.motionMuteAudio, data.motionAlternatives, data.subjectImage, data.placeImage]));
  expect(configuration({ ...data, motionContinuity: undefined })).toBe(configuration(data));
  expect(configuration({ ...data, motionContinuity: true })).not.toBe(configuration(data));
});

test('only inline decoded images are accepted; poster URLs/video bytes are not', () => {
  expect(endingFrame(FRAME)).toBe(FRAME);
  for (const value of [undefined, '', 'https://flow-content.google/image/poster', 'data:video/mp4;base64,QUJD', 'data:image/svg+xml;base64,QUJD', 'data:image/jpeg;base64,']) expect(endingFrame(value)).toBe('');
});

test('each link uses the immediately previous completed generated output, not any earlier frame', () => {
  const rows = [done(1), done(2, { endFrameUrl: 'data:image/png;base64,REVG', continuityFrom: 'v1' }), row(3)];
  expect(continuityInput(rows, rows[2])).toEqual({ frame: 'data:image/png;base64,REVG', parent: 'v2' });
  expect(continuityInput(rows, rows[0])).toEqual({ frame: '' });
  expect(continuityOutputCurrent(rows, rows[1])).toBe(true);
  rows[0].continuityVersion = 'new-v1';
  expect(continuityOutputCurrent(rows, rows[1])).toBe(false);
});

test('missing output/frame/revision blocks the next generation without accepting a poster', () => {
  expect(() => continuityInput([row(1), row(2)], row(2))).toThrow(/Finish piece 1/);
  expect(() => continuityInput([done(1, { endFrameUrl: undefined, posterUrl: FRAME }), row(2)], row(2))).toThrow(/ending frame is missing/);
  expect(() => continuityInput([done(1, { continuityVersion: undefined }), row(2)], row(2))).toThrow(/Finish piece 1/);
});

test('explicit scene resets need no predecessor and bound dependent regeneration', () => {
  const rows = [done(1), done(2, { continuityFrom: 'v1' }), done(3, { continuityReset: true }), done(4, { continuityFrom: 'v3' })];
  expect(continuityInput(rows, rows[2])).toEqual({ frame: '' });
  expect(continuityRetryThrough(rows, 1)).toBe(2);
  expect(continuityRetryThrough(rows, 3)).toBe(4);
  expect(continuityOutputCurrent(rows, rows[2])).toBe(true);
  const cleared = clearMotionOutput(rows[1]);
  expect(cleared).toMatchObject({ status: 'idle', prompt: rows[1].prompt, filename: rows[1].filename, uploaded: true });
  expect(cleared.endFrameUrl).toBeUndefined(); expect(cleared.continuityVersion).toBeUndefined(); expect(cleared.continuityFrom).toBeUndefined();
  expect(rows[1].status).toBe('done'); // pure: no unconfirmed mutation
});

test('prompt gives numbered roles to character, setting and appended continuity frame', () => {
  const prompt = motionFinalPrompt({ prompt: 'Follow motion.', mode: 'move', muted: true, characters: 1, places: 1, continuity: true });
  expect(prompt).toContain('The first image is the character');
  expect(prompt).toContain('The image 2 is the setting');
  expect(prompt).toContain('Image 3 is the previous generated clip');
  expect(prompt).not.toContain('The last image is the setting');
  expect(prompt).toContain('source-video piece still controls');
  expect(prompt.lastIndexOf('AUDIO OVERRIDE')).toBeGreaterThan(prompt.indexOf('CONTINUITY:'));
  expect(motionFinalPrompt({ prompt: 'p', mode: 'move', muted: false, characters: 0, places: 0, continuity: true })).toContain('Image 1 is the previous');
});

test('work scope includes dependent pieces but preserves separate scenes', () => {
  const rows = [row(1, { uploaded: false }), row(2, { uploaded: false }), row(3, { uploaded: false })];
  const work = motionWork({ onlyPiece: 1, throughPiece: 2 });
  expect(rows.filter(work.needsCut).map(r => r.index)).toEqual([1, 2]);
});

test('preflight checks dependent upload needs and refuses a missing parent frame', () => {
  const data = { ...defaults(), sourceKey: 'source', motionPreparedFrom: 'source', motionContinuity: true,
    motionPieces: [done(1), row(2), row(3, { uploaded: false })] };
  data.configurationAtRun = configuration(data);
  expect(preflight(data, { sourceAvailable: false, uploadAllowed: true, retry: true, piece: 2 })).toMatch(/source video/);
  data.motionPieces[2].uploaded = true;
  data.motionPieces[0].endFrameUrl = undefined;
  expect(preflight(data, { sourceAvailable: false, uploadAllowed: false, retry: true, piece: 2 })).toMatch(/ending frame is missing/);
  data.motionPieces[1].continuityReset = true;
  expect(preflight(data, { sourceAvailable: false, uploadAllowed: false, retry: true, piece: 2 })).toBeNull();
});

test('reopening a project preserves ending frames and parent revisions', () => {
  const data = { ...defaults(), motionContinuity: true, motionPieces: [done(1), done(2, { continuityFrom: 'v1' }), row(3, { status: 'running' })] };
  const restored = recover(JSON.parse(JSON.stringify(data)));
  expect(restored.motionContinuity).toBe(true);
  expect(continuityInput(restored.motionPieces, restored.motionPieces[2])).toEqual({ frame: FRAME, parent: 'v2' });
  expect(restored.motionPieces[2].status).toBe('error');
});
