jest.mock('../shared/api', () => ({ trackUsage: jest.fn().mockResolvedValue(undefined), trackSubmission: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../background/coordinatorState', () => ({ saveSnapshot: jest.fn(), clearSnapshot: jest.fn(), loadSnapshot: jest.fn() }));
jest.mock('../shared/runJournal', () => ({
  beginRun: jest.fn(), beginAttempt: jest.fn(), finishRun: jest.fn(), settleAttempt: jest.fn(),
  cancelRun: jest.fn(), recordSubmitted: jest.fn(),
}));
import { RunCoordinator } from '../background/runCoordinator';
import { WorkflowRunner } from '../studio/engine/WorkflowRunner';
import { bridge } from '../studio/engine/bridge';
import { useStudioStore } from '../studio/store';
const FRAME = 'data:image/png;base64,RlJBTUU=';
const node = (id: string, type: string, data: any = {}): any => ({ id, type, data });
function harness() {
  const worker = new RunCoordinator();
  const messages: any[] = [];
  const execute = jest.fn(async (nodeId: string) => {
    setTimeout(() => worker.handleNodeResult({ nodeId, tileId: 'fe_clip', videoUrl: 'https://example.test/clip.mp4',
      previewUrl: FRAME, previewVideoUrl: 'data:video/mp4;base64,VklERU8=', referenceUrl: FRAME }), 0);
    return true;
  });
  worker.bind({ executeOnPlatform: execute, broadcast: m => messages.push(m), sendControl() {}, notify() {} });
  return { worker, messages, execute };
}
const manifest = (withStart: boolean): any => ({
  runId: 'local-test', workflowId: 'test', nodes: [node('p', 'prompt', { text: 'Roll the ball' }),
    node('s', 'image', { imageData: FRAME }), node('g', 'generate', { mediaType: 'video', creationType: 'frames' })],
  edges: [{ source: 'p', target: 'g', targetHandle: 'text' }, ...(withStart ? [{ source: 's', target: 'g', targetHandle: 'frame_start' }] : [])],
});
test('a worker completion sends the actual clip, preview and captured ending to the canvas', async () => {
  const { worker, messages } = harness();
  await worker.start(manifest(true));
  const done = messages.find(m => m.type === 'SW_NODE_STATUS' && m.payload.nodeId === 'g' && m.payload.status === 'done');
  expect(done.payload).toMatchObject({ resultUrl: 'https://example.test/clip.mp4', previewUrl: FRAME,
    resultTileId: 'fe_clip', lastFrameUrl: FRAME, previewVideoUrl: 'data:video/mp4;base64,VklERU8=' });
});
test('a missing frame marks that node failed without sending a provider request', async () => {
  const { worker, execute } = harness();
  await worker.start(manifest(false));
  expect(execute).not.toHaveBeenCalled();
  expect(worker.getSnapshot().nodeStatuses.g).toMatchObject({ status: 'error', errorMessage: expect.stringMatching(/start frame/i) });
});

test('the canvas receives and retains completed clip and ending-frame fields', () => {
  new WorkflowRunner().requestCoordinatorSync();
  useStudioStore.setState({ nodes: [node('g', 'generate', { type: 'generate', mediaType: 'video' })], edges: [] });
  (bridge as any).emit('SW_NODE_STATUS', { nodeId: 'g', status: 'done', progress: 100,
    resultUrl: 'https://example.test/clip.mp4', lastFrameUrl: FRAME, previewUrl: FRAME, resultTileId: 'fe_clip' });
  expect(useStudioStore.getState().nodes[0].data).toMatchObject({
    status: 'done', resultUrl: 'https://example.test/clip.mp4', lastFrameUrl: FRAME, previewUrl: FRAME,
  });
});
