/* ============================================================
   Does an agent node actually run when the workflow runs?

   Twice now the answer was no, for reasons no unit test could see. The loop
   was written and tested, the node rendered, the Run button lit up — and the
   node was still never executed, because the runner's dispatch switch had no
   case for it and skipped it as an unknown type. Counted in the progress
   total, silently not run, no error anywhere.

   So this drives the real runner, with only the bridge and usage reporting
   faked, and checks the things that were broken: that the node executes at
   all, that the chat turns carry the right thread flag, that the tool result
   comes back from the real tool implementation, and that a fabricated
   completion still fails the node.
   ============================================================ */

import type { Node, Edge } from '@xyflow/react';

/* The transport and the billing call are the only things faked. Everything
   else — topo sort, dispatch, the agent loop, the tool — is the real code. */
const sent: Array<{ nodeId: string; config: any }> = [];
let replyFor: (config: any) => string;

jest.mock('../shared/api', () => ({
  trackUsage: jest.fn().mockResolvedValue(undefined),
  consumeStudioRun: jest.fn().mockResolvedValue(null),
  getUpgradeTarget: jest.fn().mockResolvedValue({ url: '' }),
}));

jest.mock('../studio/engine/bridge', () => {
  const handlers: Record<string, Function[]> = {};
  return {
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
        sent.push({ nodeId, config });
        // Answer asynchronously, as the real bridge does.
        setTimeout(() => {
          const text = replyFor(config);
          for (const h of handlers['STUDIO_NODE_RESULT'] || []) {
            h({ nodeId, text, tileId: '', imageUrl: '' });
          }
        }, 5);
        return true;
      },
    },
  };
});

import { runner } from '../studio/engine/WorkflowRunner';
import { useStudioStore } from '../studio/store';

const GOAL = 'Report exactly what is on this canvas.';

function workflow(): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [
    {
      id: 'p_goal', type: 'prompt', position: { x: 0, y: 0 },
      data: { type: 'prompt', label: 'Goal', text: GOAL },
    } as any,
    {
      id: 'agent_1', type: 'agent', position: { x: 400, y: 0 },
      data: {
        type: 'agent', label: 'Canvas Agent', platform: 'chatgpt', mediaType: 'text',
        maxIterations: 4, tools: ['read_canvas'], system: '', agentSteps: [],
        enabled: true, status: 'idle', progress: 0, errorMessage: null,
      },
    } as any,
    {
      id: 'marker_alpha', type: 'prompt', position: { x: 0, y: 300 },
      data: { type: 'prompt', label: 'Marker ALPHA-7731', text: 'x' },
    } as any,
  ];
  const edges: Edge[] = [{
    id: 'e1', source: 'p_goal', target: 'agent_1',
    sourceHandle: 'text', targetHandle: 'text',
  } as any];
  return { nodes, edges };
}

beforeEach(() => {
  sent.length = 0;
  const { nodes, edges } = workflow();
  useStudioStore.setState({ nodes, edges } as any);
});

test('the agent node executes, loops, and lands its answer', async () => {
  let turn = 0;
  replyFor = () => (++turn === 1
    ? 'TOOL: read_canvas\n{}'
    : 'DONE\n3 nodes, including Marker ALPHA-7731.');

  const { nodes, edges } = workflow();
  await runner.run(nodes, edges);

  // 1. It ran at all. This is what the missing switch case broke.
  expect(sent.length).toBeGreaterThanOrEqual(2);
  expect(sent.every((s) => s.nodeId === 'agent_1')).toBe(true);

  // 2. The goal reached the model.
  expect(sent[0].config.prompt).toContain(GOAL);

  // 3. Only the opening turn may reset the thread — the loop IS the memory.
  expect(sent[0].config.newChat).toBe('auto');
  expect(sent[1].config.newChat).toBe('never');
  expect(sent[0].config.platform).toBe('chatgpt');
  expect(sent[0].config.mediaType).toBe('text');

  // 4. The real read_canvas ran and its output went back to the model.
  expect(sent[1].config.prompt).toContain('Result of read_canvas');
  expect(sent[1].config.prompt).toContain('marker_alpha');
  expect(sent[1].config.prompt).toContain('Marker ALPHA-7731');

  // 5. The answer landed on the node.
  const node = useStudioStore.getState().nodes.find((n) => n.id === 'agent_1')!;
  expect((node.data as any).status).toBe('done');
  expect((node.data as any).resultText).toContain('ALPHA-7731');

  // 6. The step log the user reads is populated.
  const steps = (node.data as any).agentSteps || [];
  expect(steps.map((s: any) => s.kind)).toEqual(['tool', 'observation', 'done']);
});

test('a fabricated completion fails the node instead of passing it on', async () => {
  // The live failure: says it finished, never called anything.
  replyFor = () => 'DONE\n3 nodes: I have read the canvas.';

  const { nodes, edges } = workflow();
  await runner.run(nodes, edges);

  const node = useStudioStore.getState().nodes.find((n) => n.id === 'agent_1')!;
  expect((node.data as any).status).toBe('error');
  expect((node.data as any).errorMessage).toMatch(/never ran a tool/i);
  // And it was challenged once before being failed.
  expect(sent[1]?.config.prompt).toMatch(/no tool has run/i);
});
