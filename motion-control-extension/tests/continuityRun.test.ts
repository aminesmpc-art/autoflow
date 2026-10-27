/** @jest-environment node */
/// <reference types="node" />
import { webcrypto } from 'crypto';
import { WorkflowRunner } from '../../studio-extension/src/studio/engine/WorkflowRunner';
import { useStudioStore } from '../../studio-extension/src/studio/store';
import { recoverMotionEndFrame } from '../../studio-extension/src/studio/media/motionEndFrame';
import type { MotionPieceRow } from '../../studio-extension/src/studio/ask/motionControl';

jest.mock('../../studio-extension/src/studio/store', () => ({ useStudioStore: { getState: jest.fn() } }));
jest.mock('../../studio-extension/src/studio/engine/bridge', () => ({ bridge: {} }));
jest.mock('../../studio-extension/src/studio/engine/tools', () => ({ toolsByName: {} }));
jest.mock('../../studio-extension/src/studio/clip/clipMedia', () => ({ clipMedia: { cut: jest.fn(), probe: jest.fn() } }));
jest.mock('../../studio-extension/src/studio/clip/sourceStore', () => ({ getSource: jest.fn(), getMedia: jest.fn(), putMedia: jest.fn() }));
jest.mock('../../studio-extension/src/studio/media/motionEndFrame', () => ({ recoverMotionEndFrame: jest.fn() }));

const FRAME = (n: number) => `data:image/jpeg;base64,${Buffer.from(`frame-${n}`).toString('base64')}`;
const rows = (): MotionPieceRow[] => [1, 2, 3].map(index => ({ index, of: 3, startSec: (index - 1) * 10, endSec: index * 10, seconds: 10,
  cutsSpeech: false, filename: `p${index}.mp4`, prompt: `motion ${index}`, why: '', status: 'idle', uploaded: true }));
let data: any;
let subject: string;
let machine: any;
let generated: jest.Mock;
let send: jest.Mock;
beforeEach(() => {
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: webcrypto });
  data = { sourceKey: 'source', motionPreparedFrom: 'source', motionPreparedContinuity: true, motionContinuity: true, motionPieces: rows(), motionMode: 'move', label: 'test' };
  subject = 'data:image/png;base64,QUJD';
  const state = { nodes: [], updateNodeData: jest.fn((_id, patch) => Object.assign(data, patch)) };
  (useStudioStore.getState as jest.Mock).mockReturnValue(state);
  send = jest.fn(async msg => msg.type === 'DEBUG_UPLOAD_TO_FLOW' ? { ok: true, confirmed: true, names: msg.names } : {});
  (globalThis as any).chrome = { storage: { local: { get: async () => ({ af_debug_upload: true }) } }, runtime: { sendMessage: send } };
  machine = new WorkflowRunner(); machine.targetedRun = true;
  generated = jest.fn(async (_id, config) => {
    const index = Number(config.styleReference.match(/p(\d)/)[1]);
    return { tileId: `result-${index}`, previewVideoUrl: 'data:video/mp4;base64,QUJD', referenceUrl: FRAME(index) };
  });
  machine.awaitBridge = generated;
  machine.nodeResults.set('subject', { imageUrl: subject });
  (recoverMotionEndFrame as jest.Mock).mockReset().mockRejectedValue(new Error('Ending frame unavailable'));
});
const execute = () => machine.executeMotionNode('motion', data, '', [{ source: 'subject', target: 'motion', targetHandle: 'image_ref' }]);

test.each(['9:16', '16:9'])('actual Motion runner passes %s to every Flow clip', async aspectRatio => {
  data.aspectRatio = aspectRatio;
  await execute();
  expect(generated).toHaveBeenCalledTimes(3);
  expect(generated.mock.calls.map(call => call[1].aspectRatio)).toEqual([aspectRatio, aspectRatio, aspectRatio]);
});

test('actual Motion runner attaches each generated ending frame in order and persists lineage', async () => {
  await execute();
  const configs = generated.mock.calls.map(call => call[1]);
  expect(configs.every(config => config.retryFailedMotion === true)).toBe(true);
  expect(configs.map(c => c.styleReference)).toEqual(['p1.mp4', 'p2.mp4', 'p3.mp4']);
  expect(configs.map(c => c.referenceImageData)).toEqual([[subject], [subject, FRAME(1)], [subject, FRAME(2)]]);
  expect(configs[1].prompt).toContain('Image 2 is the previous generated');
  expect(data.motionPieces[1].continuityFrom).toBe(data.motionPieces[0].continuityVersion);
  expect(data.motionPieces[2].continuityFrom).toBe(data.motionPieces[1].continuityVersion);
  expect(data.motionPieces[2].endFrameUrl).toBe(FRAME(3));
  expect(recoverMotionEndFrame).not.toHaveBeenCalled();
});

test('continuity respects chronological order even when the first upload is slow', async () => {
  data.motionPieces[0].uploaded = false;
  data.motionPieces[0].uploadPending = { tabId: 7, projectUrl: 'https://flow.google.com/project/x' };
  const events: string[] = [];
  let checks = 0;
  send.mockImplementation(async msg => {
    if (msg.type !== 'DEBUG_UPLOAD_TO_FLOW') return {};
    events.push('verify 1'); checks++;
    return checks === 1 ? { ok: false, uploadState: 'pending', tabId: 7 } : { ok: true, confirmed: true, names: ['p1.mp4'] };
  });
  generated.mockImplementation(async (_id, config) => {
    const index = Number(config.styleReference.match(/p(\d)/)[1]); events.push(`generate ${index}`);
    return { tileId: `result-${index}`, referenceUrl: FRAME(index) };
  });
  await execute();
  expect(events).toEqual(['verify 1', 'verify 1', 'generate 1', 'generate 2', 'generate 3']);
});

test('a failed first generation blocks dependent clips without any extra submissions', async () => {
  generated.mockRejectedValue(new Error('Generation refused'));
  await expect(execute()).rejects.toThrow(/Finish piece 1/);
  expect(generated).toHaveBeenCalledTimes(1);
  expect(data.motionPieces.map((r: any) => r.status)).toEqual(['error', 'error', 'error']);
});

test('missing generated ending frame keeps the clip complete and blocks the next instead of using a poster', async () => {
  generated.mockResolvedValue({ tileId: 'one', previewVideoUrl: 'data:video/mp4;base64,QUJD', previewUrl: FRAME(99) });
  await expect(execute()).rejects.toThrow(/ending frame is missing/);
  expect(generated).toHaveBeenCalledTimes(1);
  expect(data.motionPieces[0].status).toBe('done');
  expect(data.motionPieces[0].endFrameUrl).toBeUndefined();
  expect(data.motionPieces[0].endFrameError).toBe('Ending frame unavailable');
});

test('a scene reset deliberately breaks dependency on a failed prior scene', async () => {
  data.motionPieces[1].continuityReset = true;
  generated.mockRejectedValueOnce(new Error('Generation refused'));
  await expect(execute()).rejects.toThrow(/piece 1/);
  expect(generated).toHaveBeenCalledTimes(3);
  expect(generated.mock.calls[1][1].referenceImageData).toEqual([subject]);
  expect(generated.mock.calls[2][1].referenceImageData).toEqual([subject, FRAME(2)]);
});

test('off preserves independent ready-first execution and never appends continuity frames', async () => {
  data.motionContinuity = false; data.motionPreparedContinuity = false;
  data.motionPieces[0].uploaded = false; data.motionPieces[0].uploadPending = { tabId: 7 };
  let checks = 0;
  send.mockImplementation(async msg => msg.type === 'DEBUG_UPLOAD_TO_FLOW' ? (++checks === 1 ? { ok: false, uploadState: 'pending' } : { ok: true, confirmed: true }) : {});
  await execute();
  expect(generated.mock.calls.map(c => c[1].styleReference)).toEqual(['p2.mp4', 'p3.mp4', 'p1.mp4']);
  expect(generated.mock.calls.every(c => c[1].referenceImageData.length === 1)).toBe(true);
});

test('a saved parent is reused without generating it again', async () => {
  data.motionPieces[0] = { ...data.motionPieces[0], status: 'done', tileId: 'one', endFrameUrl: FRAME(1), continuityVersion: 'saved-v1' };
  await execute();
  expect(generated.mock.calls.map(c => c[1].styleReference)).toEqual(['p2.mp4', 'p3.mp4']);
  expect(data.motionPieces[1].continuityFrom).toBe('saved-v1');
});

test('changing continuity on an old prepared run is rejected before any submission', async () => {
  data.motionPreparedContinuity = undefined;
  await expect(execute()).rejects.toThrow(/continuity changed/);
  expect(generated).not.toHaveBeenCalled();
});

test('a changed parent cannot silently retain a stale completed descendant or generate past it', async () => {
  data.motionPieces[0] = { ...data.motionPieces[0], status: 'done', tileId: 'one', endFrameUrl: FRAME(1), continuityVersion: 'new-v1' };
  data.motionPieces[1] = { ...data.motionPieces[1], status: 'done', tileId: 'kept-two', endFrameUrl: FRAME(2), continuityVersion: 'v2', continuityFrom: 'old-v1' };
  await expect(execute()).rejects.toThrow(/continuity changed/);
  expect(generated).not.toHaveBeenCalled();
  expect(data.motionPieces[1]).toMatchObject({ status: 'error', tileId: 'kept-two', endFrameUrl: FRAME(2) });
});

test('local decoding can rescue a missing adapter frame before the next generation', async () => {
  generated.mockResolvedValueOnce({ tileId: 'one', previewVideoUrl: 'data:video/mp4;base64,QUJD' });
  (recoverMotionEndFrame as jest.Mock).mockResolvedValue(FRAME(1));
  await execute();
  expect(recoverMotionEndFrame).toHaveBeenCalledTimes(1);
  expect(generated.mock.calls[1][1].referenceImageData).toEqual([subject, FRAME(1)]);
  expect(data.motionPieces[0].status).toBe('done');
});
