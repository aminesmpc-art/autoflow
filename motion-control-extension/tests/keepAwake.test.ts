/// <reference types="node" />
/**
 * "Is it going to work if I set up all the things and go do other things?"
 * Not if Windows puts the computer to sleep. A job now holds it awake from
 * Generate to the end of the run, and lets go however the run ends, when the
 * panel closes, and when a panel opens with nothing running.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { startGeneration } from '../src/controller';
import { defaults } from '../src/model';
import { getProfile } from '../../studio-extension/src/shared/api';
import { admitMotionJob, jobFor } from '../src/billing';
import { runner } from '../../studio-extension/src/studio/engine/WorkflowRunner';

jest.mock('../../studio-extension/src/shared/api', () => ({ getProfile: jest.fn() }));
jest.mock('../src/billing', () => ({ admitMotionJob: jest.fn(), jobFor: jest.fn() }));
jest.mock('../../studio-extension/src/studio/clip/sourceStore', () => ({ getSource: jest.fn(() => ({})) }));
jest.mock('../../studio-extension/src/studio/engine/bridge', () => ({ bridge: { getStatus: () => 'connected' } }));
jest.mock('../../studio-extension/src/studio/engine/WorkflowRunner', () => ({ runner: { run: jest.fn(async () => undefined) } }));
jest.mock('../../studio-extension/src/studio/store', () => ({ useStudioStore: {
  getState: () => ({ isRunning: false, saveWorkflow: async () => true }), setState: jest.fn(),
} }));

const order: string[] = [];
beforeEach(() => {
  jest.clearAllMocks(); order.length = 0;
  (globalThis as any).chrome = {
    storage: { local: { get: jest.fn(async () => ({ af_debug_upload: true })), set: jest.fn(async () => {}) } },
    power: {
      requestKeepAwake: jest.fn((level: string) => order.push(`hold:${level}`)),
      releaseKeepAwake: jest.fn(() => order.push('release')),
    },
  };
  (getProfile as jest.Mock).mockResolvedValue({ email: 'user@example.test' });
  (jobFor as jest.Mock).mockResolvedValue({ jobId: 'uuid', fingerprint: 'hash', started: false });
  (admitMotionJob as jest.Mock).mockResolvedValue(undefined);
  (runner.run as jest.Mock).mockImplementation(async () => { order.push('run'); });
});

test('holds the computer awake for the run, letting the screen sleep', async () => {
  await startGeneration(defaults());
  expect(order).toEqual(['hold:system', 'run', 'release']);
});

test('lets go when the run fails, too', async () => {
  (runner.run as jest.Mock).mockImplementation(async () => { order.push('run'); throw new Error('Flow went away'); });
  await expect(startGeneration(defaults())).rejects.toThrow('Flow went away');
  expect(order).toEqual(['hold:system', 'run', 'release']);
});

test('holds nothing for a job that was never admitted', async () => {
  (admitMotionJob as jest.Mock).mockRejectedValue(new Error('Free limit reached'));
  await expect(startGeneration(defaults())).rejects.toThrow('Free limit reached');
  expect(order).toEqual([]);
});

test('a missing power API never stops a job', async () => {
  delete (globalThis as any).chrome.power;
  await startGeneration(defaults());
  expect(order).toEqual(['run']);
});

describe('the panel and the package', () => {
  const read = (...parts: string[]) => readFileSync(join(__dirname, '..', ...parts), 'utf8');

  it('lets go when it opens and when it goes away', () => {
    const app = read('src', 'App.tsx');
    expect(app).toMatch(/letSleep\(\);\s*window\.addEventListener\('pagehide', letSleep\);/);
  });

  it('asks for the power permission, and says on the progress what it is for', () => {
    expect(JSON.parse(read('manifest.json')).permissions).toContain('power');
    expect(read('src', 'App.tsx')).toMatch(/Your computer stays awake until the job ends\./);
  });
});
