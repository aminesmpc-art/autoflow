import { startGeneration } from '../src/controller';
import { configuration, defaults } from '../src/model';
import { getProfile } from '../../studio-extension/src/shared/api';
import { admitMotionJob, jobFor } from '../src/billing';
import { runner } from '../../studio-extension/src/studio/engine/WorkflowRunner';
import { useStudioStore } from '../../studio-extension/src/studio/store';

jest.mock('../../studio-extension/src/shared/api', () => ({ getProfile: jest.fn() }));
jest.mock('../src/billing', () => ({ admitMotionJob: jest.fn(), jobFor: jest.fn() }));
jest.mock('../../studio-extension/src/studio/clip/sourceStore', () => ({ getSource: jest.fn(() => ({})) }));
jest.mock('../../studio-extension/src/studio/engine/bridge', () => ({ bridge: { getStatus: () => 'connected' } }));
jest.mock('../../studio-extension/src/studio/engine/WorkflowRunner', () => ({ runner: { run: jest.fn(async () => undefined) } }));
const save = jest.fn(async () => true);
jest.mock('../../studio-extension/src/studio/store', () => ({ useStudioStore: {
  getState: () => ({ isRunning: false, saveWorkflow: () => save() }), setState: jest.fn(),
} }));
const job = { jobId: 'uuid', fingerprint: 'hash', started: false };
beforeEach(() => {
  jest.clearAllMocks(); save.mockResolvedValue(true);
  (globalThis as any).chrome = { storage: { local: { get: jest.fn(async () => ({ af_debug_upload: true })), set: jest.fn(async () => {}) } } };
  (getProfile as jest.Mock).mockResolvedValue({ email: 'user@example.test', is_pro_active: true });
  (jobFor as jest.Mock).mockResolvedValue(job);
  (admitMotionJob as jest.Mock).mockResolvedValue(undefined);
});
test('Studio Pro cannot bypass unavailable or denied Motion admission', async () => {
  (admitMotionJob as jest.Mock).mockRejectedValue(new Error('Motion unavailable'));
  await expect(startGeneration(defaults())).rejects.toThrow('Motion unavailable');
  expect(runner.run).not.toHaveBeenCalled(); expect(save).toHaveBeenCalledTimes(1);
});
test('requires a valid AutoFlow account', async () => {
  (getProfile as jest.Mock).mockResolvedValue(null);
  await expect(startGeneration(defaults())).rejects.toThrow(/Sign in/);
  expect(admitMotionJob).not.toHaveBeenCalled();
});

test('denied file access stops before job admission and preserves prepared pieces', async () => {
  (globalThis as any).chrome.extension = { isAllowedFileSchemeAccess: jest.fn(async () => false) };
  const data = defaults(); data.configurationAtRun = configuration(data);
  await expect(startGeneration(data, true)).rejects.toThrow('Allow access to file URLs');
  expect(jobFor).not.toHaveBeenCalled();
  expect(admitMotionJob).not.toHaveBeenCalled();
  expect(useStudioStore.setState).not.toHaveBeenCalled();
  expect(runner.run).not.toHaveBeenCalled();
});

test('worker flags are saved before executing provider work', async () => {
  (runner.run as jest.Mock).mockImplementationOnce(async () => {
    expect(chrome.storage.local.set).toHaveBeenCalledWith({ af_background_tabs: false, af_background_strict: false });
  });
  await startGeneration({ ...defaults(), platform: 'gemini' });
});

test('a new install enables automatic uploads before checking browser readiness', async () => {
  (chrome.storage.local.get as jest.Mock).mockResolvedValue({});
  (globalThis as any).chrome.extension = { isAllowedFileSchemeAccess: jest.fn(async () => false) };
  await expect(startGeneration(defaults())).rejects.toThrow('Allow access to file URLs');
  expect(chrome.storage.local.set).toHaveBeenCalledWith({ af_debug_upload: true });
  expect(admitMotionJob).not.toHaveBeenCalled();
});
test('persists identity before admission and started state before execution', async () => {
  (admitMotionJob as jest.Mock).mockImplementation(async () => { expect(save).toHaveBeenCalledTimes(1); });
  await startGeneration(defaults());
  expect(admitMotionJob).toHaveBeenCalledWith(job); expect(save).toHaveBeenCalledTimes(3);
  expect(runner.run).toHaveBeenCalledWith([expect.objectContaining({ type: 'motion', data: expect.objectContaining({ motionJob: { ...job, started: true } }) })], [], {});
});
test('failed durable save stops before admission', async () => {
  save.mockResolvedValue(false);
  await expect(startGeneration(defaults())).rejects.toThrow(/save the job safely/);
  expect(admitMotionJob).not.toHaveBeenCalled(); expect(runner.run).not.toHaveBeenCalled();
});
test('retry always rechecks membership with the same job', async () => {
  const data = defaults(); data.configurationAtRun = configuration(data);
  await startGeneration(data, true);
  expect(jobFor).toHaveBeenCalledWith(data, 'user@example.test', true, expect.anything());
  expect(admitMotionJob).toHaveBeenCalledWith(job);
});
test('double-click cannot consume allowance twice', async () => {
  let release: () => void = () => undefined;
  (admitMotionJob as jest.Mock).mockImplementation(() => new Promise<void>(resolve => { release = resolve; }));
  const first = startGeneration(defaults());
  await expect(startGeneration(defaults())).rejects.toThrow(/already/);
  await new Promise(resolve => setTimeout(resolve, 0)); release(); await first;
  expect(admitMotionJob).toHaveBeenCalledTimes(1);
});

test('continuity retry clears only this scene chain and preserves prepared prompts/uploads', async () => {
  const data = { ...defaults(), motionContinuity: true, sourceKey: 'source', motionPreparedFrom: 'source', motionPreparedContinuity: true };
  data.motionPieces = [1, 2, 3, 4].map(index => ({ index, of: 4, startSec: index * 10 - 10, endSec: index * 10, seconds: 10, cutsSpeech: false,
    filename: `p${index}`, prompt: `prompt${index}`, why: '', status: 'done', uploaded: true, tileId: `tile${index}`,
    endFrameUrl: 'data:image/png;base64,QUJD', continuityVersion: `v${index}`, continuityFrom: index > 1 && index !== 3 ? `v${index - 1}` : undefined, continuityReset: index === 3 }));
  data.configurationAtRun = configuration(data);
  await startGeneration(data, true, 1);
  const nodes = (runner.run as jest.Mock).mock.calls[0][0];
  const next = nodes[0].data;
  expect(next.motionRetryPiece).toBe(1); expect(next.motionRetryThrough).toBe(2);
  expect(next.motionPieces.map((p: any) => p.status)).toEqual(['idle', 'idle', 'done', 'done']);
  expect(next.motionPieces[1]).toMatchObject({ prompt: 'prompt2', uploaded: true, filename: 'p2' });
  expect(next.motionPieces[1].endFrameUrl).toBeUndefined();
  expect(next.motionPieces[2].endFrameUrl).toBe('data:image/png;base64,QUJD');
});

test('denied retry admission does not clear existing completed clips', async () => {
  const data = defaults(); data.configurationAtRun = configuration(data);
  data.motionPieces = [{ index: 1, of: 1, startSec: 0, endSec: 5, seconds: 5, cutsSpeech: false, filename: 'p1', prompt: 'p', why: '', status: 'done', uploaded: true, tileId: 'kept' }];
  (admitMotionJob as jest.Mock).mockRejectedValue(new Error('Unavailable'));
  await expect(startGeneration(data, true, 1)).rejects.toThrow('Unavailable');
  const graph = (useStudioStore.setState as jest.Mock).mock.calls[0][0];
  expect(graph.nodes[0].data.motionPieces[0]).toMatchObject({ status: 'done', tileId: 'kept' });
  expect(runner.run).not.toHaveBeenCalled();
});

test('Retry unfinished does not inherit a stopped single-piece retry scope', async () => {
  const data = { ...defaults(), motionRetryPiece: 2, motionRetryThrough: 3 };
  data.configurationAtRun = configuration(data);
  await startGeneration(data, true);
  const next = (runner.run as jest.Mock).mock.calls[0][0][0].data;
  expect(next.motionRetryPiece).toBeUndefined();
  expect(next.motionRetryThrough).toBeUndefined();
});
