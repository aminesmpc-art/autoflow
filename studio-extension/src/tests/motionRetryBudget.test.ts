/** @jest-environment jsdom */
import type { Node } from '@xyflow/react';
import { WorkflowRunner } from '../studio/engine/WorkflowRunner';
import { useStudioStore } from '../studio/store';
import { MotionNativeRetry } from '../content/flow/motionRetry';
import { simulateClick } from '../content/flow/selectors';
import { AutomationEngine } from '../content/flow/automation';

jest.mock('../shared/api', () => ({ trackUsage: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../shared/runJournal', () => ({
  beginRun: jest.fn().mockResolvedValue(undefined),
  finishRun: jest.fn().mockResolvedValue(undefined),
  beginAttempt: jest.fn().mockResolvedValue(undefined),
  recoverable: jest.fn().mockResolvedValue(undefined),
  settleAttempt: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../studio/engine/bridge', () => ({ bridge: { send: jest.fn() } }));
jest.mock('../content/flow/selectors', () => ({
  ...jest.requireActual('../content/flow/selectors'),
  simulateClick: jest.fn((button: HTMLElement) => button.click()),
  sleep: jest.fn().mockResolvedValue(undefined),
}));

beforeEach(() => {
  jest.clearAllMocks();
  useStudioStore.setState({ nodes: [], edges: [], isRunning: false });
  jest.spyOn(useStudioStore.getState(), 'persistAfterRun').mockResolvedValue(undefined);
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => { jest.restoreAllMocks(); document.body.innerHTML = ''; });

test('a transient failure on another piece cannot restart three exhausted native retries', async () => {
  document.body.innerHTML = '<flow-video-tile><flow-error-tile><div class="buttons-container"><button aria-label="Retry"><mat-icon>refresh</mat-icon></button></div></flow-error-tile></flow-video-tile>';
  const tile = document.querySelector('flow-video-tile')!;
  const nodes: Node[] = [{ id: 'motion', type: 'motion', position: { x: 0, y: 0 }, data: { label: 'Motion', enabled: true } }];
  useStudioStore.setState({ nodes, edges: [] });
  const runner = new WorkflowRunner();
  const execute = jest.spyOn(runner as any, 'executeGenerateNode').mockImplementation(async () => {
    const retry = new MotionNativeRetry();
    for (let attempt = 0; attempt < 3; attempt++) {
      const now = attempt * 20_000;
      retry.step(tile, () => true, now);
      retry.step(tile, () => true, now + 5000);
      retry.observe('generating');
    }
    throw new Error('0 of 2 pieces generated. Piece 1: failed after 3 automatic Retry clicks. Piece 2: Lost connection to the Flow tab.');
  });
  jest.spyOn(runner as any, 'sleep').mockResolvedValue(undefined);
  await (runner as any).runLocal(nodes, []);
  expect(execute).toHaveBeenCalledTimes(1);
  expect(simulateClick).toHaveBeenCalledTimes(3);
  expect(useStudioStore.getState().nodes[0].data.status).toBe('error');
});

test('ordinary generate nodes keep their single transient retry', async () => {
  const nodes: Node[] = [{ id: 'clip', type: 'generate', position: { x: 0, y: 0 }, data: { label: 'Clip', enabled: true } }];
  useStudioStore.setState({ nodes, edges: [] });
  const runner = new WorkflowRunner();
  const execute = jest.spyOn(runner as any, 'executeGenerateNode').mockRejectedValue(new Error('Lost connection to the Flow tab'));
  jest.spyOn(runner as any, 'sleep').mockResolvedValue(undefined);
  await (runner as any).runLocal(nodes, []);
  expect(execute).toHaveBeenCalledTimes(2);
});

test('the Motion submit engine cannot add its own retries before the native watcher', async () => {
  const engine = new AutomationEngine() as any;
  const prompt = { text: 'Keep the same motion', status: 'pending' };
  engine.queue = { settings: { retryFailedMotion: true }, prompts: [prompt] };
  const verify = jest.spyOn(engine, 'verifyOrReapplySettings').mockRejectedValue(new Error('Network error'));
  jest.spyOn(engine, 'log').mockImplementation(() => undefined);
  const update = jest.spyOn(engine, 'updatePromptStatus').mockImplementation(() => undefined);
  await engine.processPrompt(prompt, 0);
  expect(verify).toHaveBeenCalledTimes(1);
  expect(update).toHaveBeenCalledWith(0, 'failed', 'Network error');
});

test('the submit-engine change leaves non-Motion retries unchanged', async () => {
  const engine = new AutomationEngine() as any;
  const prompt = { text: 'A scenic landscape', status: 'pending' };
  engine.queue = { settings: { retryFailedMotion: false }, prompts: [prompt] };
  const verify = jest.spyOn(engine, 'verifyOrReapplySettings').mockRejectedValue(new Error('Network error'));
  jest.spyOn(engine, 'log').mockImplementation(() => undefined);
  jest.spyOn(engine, 'updatePromptStatus').mockImplementation(() => undefined);
  await engine.processPrompt(prompt, 0);
  expect(verify).toHaveBeenCalledTimes(4);
});
