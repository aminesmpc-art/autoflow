jest.mock('../shared/api', () => ({ trackUsage: jest.fn(), trackSubmission: jest.fn() }));
jest.mock('../studio/engine/bridge', () => ({ bridge: { on: jest.fn() } }));

import { WorkflowRunner } from '../studio/engine/WorkflowRunner';
import { RunCoordinator } from '../background/runCoordinator';
import { useStudioStore } from '../studio/store';

const START = 'data:image/png;base64,U1RBUlQ=';
const END = 'data:image/png;base64,RU5E';
const target: any = { id: 'next', type: 'generate', data: {
  platform: 'flow', mediaType: 'video', creationType: 'frames', prompt: 'Continue walking',
} };
const wire = (source: string, targetHandle: string): any => ({
  id: `${source}-${targetHandle}`, source, target: 'next', sourceHandle: 'image', targetHandle,
});

describe.each(['canvas', 'worker'])('%s frame configuration', (path) => {
  let engine: any;
  let sent: any;
  beforeEach(() => {
    engine = path === 'canvas' ? new WorkflowRunner() : new RunCoordinator();
    sent = undefined;
    engine.awaitBridge = async (_id: string, config: any) => { sent = config; return { tileId: 'done' }; };
    engine.nodeResults.set('prompt', { imageUrl: 'Continue walking' });
    useStudioStore.setState({ nodes: [target], edges: [] });
  });
  const configure = async (edges: any[], results: Record<string, any>) => {
    for (const [id, result] of Object.entries(results)) engine.nodeResults.set(id, result);
    // The same prompt wire on both paths; the worker no longer reads data.prompt.
    if (path === 'worker') return engine.buildConfig(target, [wire('prompt', 'text'), ...edges], [target]);
    await engine.executeGenerateNode('next', target, [wire('prompt', 'text'), ...edges]);
    return sent;
  };

  test('keeps Start before End, including a tile followed by an uploaded image', async () => {
    const config = await configure([wire('end', 'frame_end'), wire('start', 'frame_start')], {
      start: { tileId: 'fe_start' }, end: { imageUrl: END },
    });
    expect(config.frameReferences).toEqual([
      { kind: 'tile', tileId: 'fe_start' }, { kind: 'data', dataUrl: END },
    ]);
  });

  test('does not send End as Start when Start is not connected', async () => {
    await expect(configure([wire('end', 'frame_end')], { end: { imageUrl: END } }))
      .rejects.toThrow(/start frame/i);
    expect(sent).toBeUndefined();
  });

  test('does not skip an empty Start when End resolved', async () => {
    await expect(configure([wire('start', 'frame_start'), wire('end', 'frame_end')], {
      start: { imageUrl: '' }, end: { imageUrl: END },
    })).rejects.toThrow(/start frame/i);
    expect(sent).toBeUndefined();
  });

  test('does not silently drop a connected End that did not resolve', async () => {
    await expect(configure([wire('start', 'frame_start'), wire('end', 'frame_end')], {
      start: { imageUrl: START },
    })).rejects.toThrow(/end frame/i);
  });

  test('refuses two sources on the same frame socket', async () => {
    await expect(configure([wire('a', 'frame_start'), wire('b', 'frame_start')], {
      a: { imageUrl: START }, b: { imageUrl: END },
    })).rejects.toThrow(/one.*start frame/i);
  });

  test('accepts Start alone and uses a previous clip\'s captured ending', async () => {
    const config = await configure([wire('clip', 'frame_start')], {
      clip: { referenceUrl: START, imageUrl: 'https://example.test/clip.mp4', tileId: 'fe_clip' },
    });
    expect(config.referenceImageData).toEqual([START]);
    expect(config.frameReferences).toEqual([{ kind: 'data', dataUrl: START }]);
  });

  test('a direct video chain keeps its captured ending on a targeted retry', async () => {
    const prior: any = { id: 'clip', type: 'generate', data: {
      type: 'generate', mediaType: 'video', status: 'done', resultUrl: 'https://example.test/clip.mp4',
      resultTileId: 'fe_clip', previewUrl: END, lastFrameUrl: START,
    } };
    engine.adoptCanvasResults([prior], ['next']);
    const config = await configure([wire('clip', 'frame_start')], {});
    expect(config.frameReferences).toEqual([{ kind: 'data', dataUrl: START }]);
  });
});
