let capturedConfig: any = null;
const handlers: Record<string, Function[]> = {};

jest.mock('../studio/engine/bridge', () => ({
  bridge: {
    connect: jest.fn(),
    disconnect: jest.fn(),
    send: jest.fn(),
    stopExecution: jest.fn(),
    pauseExecution: jest.fn(),
    resumeExecution: jest.fn(),
    on: (t: string, h: Function) => { (handlers[t] ||= []).push(h); },
    off: (t: string, h: Function) => {
      handlers[t] = (handlers[t] || []).filter((x) => x !== h);
    },
    executeNode: (nodeId: string, config: any) => {
      capturedConfig = config;
      setTimeout(() => {
        for (const h of handlers['STUDIO_NODE_RESULT'] || []) {
          h({
            nodeId,
            tileId: '',
            text: 'White engineered-mesh adidas GameCourt 2 tennis shoe with deep purple-grey collar...',
            imageUrl: '',
          });
        }
      }, 5);
      return true;
    },
  },
}));

import { WorkflowRunner } from '../studio/engine/WorkflowRunner';
import { useStudioStore } from '../studio/store';
import type { Node, Edge } from '@xyflow/react';

describe('Image-only to Character Sheet Ask AI', () => {
  it('successfully generates character sheet prompt with only an image connected', async () => {
    const runner = new WorkflowRunner();

    const nodes: Node[] = [
      {
        id: 'img_1',
        type: 'image',
        position: { x: 0, y: 0 },
        data: {
          type: 'image',
          label: 'Product photo of the shoes',
          imageData: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD...',
          imageName: '1e19fdc6-d426-40e8-9050-410ce575dc2a',
        },
      },
      {
        id: 'ask_1',
        type: 'generate',
        position: { x: 300, y: 0 },
        data: {
          type: 'generate',
          label: 'Write character sheet prompt',
          platform: 'gemini',
          mediaType: 'text',
          preset: 'character_sheet',
          status: 'idle',
        },
      },
    ];

    const edges: Edge[] = [
      {
        id: 'e1',
        source: 'img_1',
        target: 'ask_1',
        targetHandle: 'image_ref',
      },
    ];

    useStudioStore.setState({ nodes, edges, currentNodeId: null });

    await runner.run(nodes, edges);

    const askNode = useStudioStore.getState().nodes.find((n) => n.id === 'ask_1');
    expect(askNode?.data.status).toBe('done');
    expect(capturedConfig).toBeDefined();
    expect(capturedConfig.prompt).toContain('character');
    expect(capturedConfig.referenceImageData).toHaveLength(1);
  });
});
