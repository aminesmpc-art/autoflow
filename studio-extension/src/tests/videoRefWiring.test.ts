/**
 * V on a Flow clip: where it is drawn, what it takes, and where its wire goes
 * when the node stops drawing it.
 *
 * "You can't attach one video to another (which is core functionality)" — a
 * 1-star review, 19 Oct 2026. The only way to wire a clip into a clip was the
 * picture input, which takes its last frame. See shared/videoReference.ts.
 */

import { portsFor, releaseVideoRef, hasVideoRefPort } from '../studio/templates/validate';
import { canConnect, connectionProblem, isFlowClip } from '../studio/canvas/connect';
import { useStudioStore } from '../studio/store';

const gen = (data: any) => portsFor({ type: 'generate', data })!.in;

describe('which nodes draw V', () => {
  it('is a Flow clip built from ingredients', () => {
    expect(gen({ platform: 'flow', mediaType: 'video', creationType: 'ingredients' })).toContain('video_ref');
    // Flow is the default platform.
    expect(gen({ mediaType: 'video' })).toContain('video_ref');
  });

  it('is not Frames, whose two slots are stills', () => {
    expect(gen({ mediaType: 'video', creationType: 'frames' })).not.toContain('video_ref');
  });

  it('is not a still, nor another site\'s clip, nor a prompt writer', () => {
    expect(gen({ mediaType: 'image' })).not.toContain('video_ref');
    expect(gen({ platform: 'grok', mediaType: 'video' })).not.toContain('video_ref');
    expect(gen({ platform: 'gemini', mediaType: 'video' })).not.toContain('video_ref');
    expect(gen({ platform: 'chatgpt', mediaType: 'text' })).not.toContain('video_ref');
  });

  it('agrees with the predicate the store and the worker use', () => {
    for (const data of [
      { mediaType: 'video' }, { mediaType: 'video', creationType: 'frames' },
      { mediaType: 'image' }, { platform: 'grok', mediaType: 'video' },
    ]) {
      expect(gen(data).includes('video_ref')).toBe(hasVideoRefPort(data));
    }
  });
});

describe('what V takes', () => {
  const nodes = [
    { id: 'clip', type: 'generate', data: { platform: 'flow', mediaType: 'video' } },
    { id: 'still', type: 'generate', data: { platform: 'flow', mediaType: 'image' } },
    { id: 'grok', type: 'generate', data: { platform: 'grok', mediaType: 'video' } },
    { id: 'img', type: 'image', data: {} },
    { id: 'frame', type: 'frame', data: {} },
    { id: 'next', type: 'generate', data: { platform: 'flow', mediaType: 'video' } },
  ];
  const into = (source: string, sourceHandle: string, existing: any[] = []) =>
    connectionProblem({ source, target: 'next', sourceHandle, targetHandle: 'video_ref' }, existing, nodes);

  it('takes a Flow clip\'s result', () => {
    expect(into('clip', 'result')).toBeNull();
    expect(isFlowClip(nodes[0])).toBe(true);
  });

  it('refuses an Image or a Last Frame, and says where a still goes', () => {
    expect(into('img', 'image')).toMatch(/V takes a whole clip.*reference input/);
    expect(into('frame', 'image')).toMatch(/V takes a whole clip/);
  });

  it('refuses a generated still and another site\'s clip — Flow\'s library holds neither', () => {
    expect(into('still', 'result')).toMatch(/clip made on Flow/);
    expect(into('grok', 'result')).toMatch(/clip made on Flow/);
  });

  it('takes one clip — Flow takes one video per prompt', () => {
    const existing = [{ source: 'other', target: 'next', sourceHandle: 'result', targetHandle: 'video_ref' }];
    expect(into('clip', 'result', existing)).toMatch(/V already has a clip/);
  });

  it('leaves every other port as it was', () => {
    expect(canConnect({ source: 'img', target: 'next', sourceHandle: 'image', targetHandle: 'image_ref' }, [], nodes)).toBe(true);
    expect(canConnect({ source: 'clip', target: 'next', sourceHandle: 'result', targetHandle: 'image_ref' }, [], nodes)).toBe(true);
  });
});

describe('a V wire when the node stops drawing V', () => {
  const edges = [
    { id: 't', source: 'p', target: 'g', targetHandle: 'text' },
    { id: 'v', source: 'clip', target: 'g', targetHandle: 'video_ref' },
    { id: 'x', source: 'clip', target: 'other', targetHandle: 'video_ref' },
  ];

  it('moves to the picture input, on that node only', () => {
    expect(releaseVideoRef('g', edges).map((e) => [e.id, e.targetHandle])).toEqual([
      ['t', 'text'], ['v', 'image_ref'], ['x', 'video_ref'],
    ]);
  });

  const node = (data: any) => ({ id: 'g', type: 'generate', position: { x: 0, y: 0 }, data: { type: 'generate', ...data } });

  it('is seated in Start when the node switches to Frames', () => {
    useStudioStore.setState({ nodes: [node({ mediaType: 'video', creationType: 'ingredients' })] as any, edges: edges as any });
    useStudioStore.getState().updateNodeData('g', { creationType: 'frames' });
    expect(useStudioStore.getState().edges.find((e) => e.id === 'v')!.targetHandle).toBe('frame_start');
  });

  it('goes to 🖼 when the node switches to an image or another site', () => {
    for (const change of [{ mediaType: 'image' }, { platform: 'grok' }]) {
      useStudioStore.setState({ nodes: [node({ mediaType: 'video', creationType: 'ingredients' })] as any, edges: edges as any });
      useStudioStore.getState().updateNodeData('g', change);
      expect(useStudioStore.getState().edges.find((e) => e.id === 'v')!.targetHandle).toBe('image_ref');
    }
  });

  it('is left alone by an edit that keeps V', () => {
    useStudioStore.setState({ nodes: [node({ mediaType: 'video' })] as any, edges: edges as any });
    useStudioStore.getState().updateNodeData('g', { model: 'Veo 3.1 - Fast' });
    expect(useStudioStore.getState().edges.find((e) => e.id === 'v')!.targetHandle).toBe('video_ref');
  });
});
