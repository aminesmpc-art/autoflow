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
let resultFor: (config: any) => Record<string, unknown>;

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
          const payload = resultFor(config);
          for (const h of handlers['STUDIO_NODE_RESULT'] || []) {
            h({ nodeId, tileId: '', ...payload });
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
  resultFor = () => ({
    text: ++turn === 1
      ? 'TOOL: read_canvas\n{}'
      : 'DONE\n3 nodes, including Marker ALPHA-7731.',
  });

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
  resultFor = () => ({ text: 'DONE\n3 nodes: I have read the canvas.' });

  const { nodes, edges } = workflow();
  await runner.run(nodes, edges);

  const node = useStudioStore.getState().nodes.find((n) => n.id === 'agent_1')!;
  expect((node.data as any).status).toBe('error');
  expect((node.data as any).errorMessage).toMatch(/never ran a tool/i);
  // And it was challenged once before being failed.
  expect(sent[1]?.config.prompt).toMatch(/no tool has run/i);
});

test('a rendered image comes back attached, so the agent can judge it', async () => {
  /* The loop a fixed canvas cannot do: render on Flow, LOOK at the result,
     re-prompt if it is wrong. It only works if the picture reaches the chat —
     an observation that merely says "rendered" leaves the model reviewing a
     sentence, and it will approve something it never saw. */
  const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';
  const prompts: string[] = [];
  let chatTurn = 0;

  useStudioStore.setState({
    nodes: useStudioStore.getState().nodes.map((n) => (n.id === 'agent_1'
      ? { ...n, data: { ...(n.data as any), tools: ['generate_image'] } }
      : n)),
  } as any);

  resultFor = (config) => {
    if (config.platform === 'flow') {
      prompts.push(config.prompt);
      // previewUrl is the captured bytes; imageUrl is an address on Flow that
      // a chat tab cannot fetch, which is why only the former is attachable.
      return { previewUrl: PNG, imageUrl: 'https://labs.google/result/abc.png' };
    }
    chatTurn++;
    if (chatTurn === 1) return { text: 'TOOL: generate_image\n{"prompt": "a sneaker"}' };
    if (chatTurn === 2) return { text: 'TOOL: generate_image\n{"prompt": "a RED sneaker, wet concrete"}' };
    return { text: 'DONE\nThe second render is correct.' };
  };

  const nodes = useStudioStore.getState().nodes;
  const edges = useStudioStore.getState().edges;
  await runner.run(nodes as any, edges as any);

  const chats = sent.filter((s) => s.config.platform === 'chatgpt');
  const flows = sent.filter((s) => s.config.platform === 'flow');

  expect(flows).toHaveLength(2);                       // it rendered twice
  expect(prompts[1]).toContain('RED');                 // and corrected itself

  // The picture is attached to the turn straight after each render...
  expect(chats[1].config.referenceImageData).toEqual([PNG]);
  expect(chats[1].config.prompt).toMatch(/attached to this message/i);
  // ...the remote URL is never sent, because the chat cannot open it.
  expect(JSON.stringify(chats[1].config)).not.toContain('labs.google');
  // ...and the opening turn has nothing to show.
  expect(chats[0].config.referenceImageData).toBeUndefined();

  const node = useStudioStore.getState().nodes.find((n) => n.id === 'agent_1')!;
  expect((node.data as any).status).toBe('done');
});

test('a short TOOL block is not rejected as "not a usable prompt"', async () => {
  /* The adapters guard Ask AI against half-streamed replies with a
     20-character floor. An agent turn is a protocol message, not a prompt:
     `TOOL: read_canvas {}` is exactly 20 characters, so the first live run
     passed by one character. A shorter action name would have been failed as
     unusable. The agent therefore asks for the reply verbatim. */
  let turn = 0;
  resultFor = () => ({
    text: ++turn === 1 ? 'TOOL: read_canvas\n{}' : 'DONE\nok',
  });

  const { nodes, edges } = workflow();
  await runner.run(nodes, edges);

  for (const s of sent) {
    expect(s.config.rawReply).toBe(true);
  }
  const node = useStudioStore.getState().nodes.find((n) => n.id === 'agent_1')!;
  // 'DONE\nok' has a 2-character answer — well under the prompt floor.
  expect((node.data as any).status).toBe('done');
  expect((node.data as any).resultText).toBe('ok');
});

describe('inspect_clip', () => {
  const MP4 = 'data:video/mp4;base64,AAAAIGZ0eXBpc29t';

  /** A canvas with a finished video node the agent can be pointed at. */
  function withClip(result: Record<string, unknown>) {
    const nodes = [
      ...workflow().nodes,
      {
        id: 'gen_vid', type: 'generate', position: { x: 0, y: 600 },
        data: { type: 'generate', label: 'Commercial Clip', mediaType: 'video', enabled: false },
      } as any,
    ];
    useStudioStore.setState({ nodes, edges: workflow().edges } as any);
    /* Pretend that node already ran. Seeded AFTER the clear that run() does
       on a full run, which is why every test here goes through the retry path
       — the realistic case anyway: the clip exists, the agent is re-run. */
    (runner as any).nodeResults.set('gen_vid', result);
    return nodes;
  }

  function agentWith(nodes: any[], tools: string[]) {
    return nodes.map((n) => (n.id === 'agent_1'
      ? { ...n, data: { ...n.data, tools } }
      : n));
  }

  it('attaches the clip and asks the model to watch it', async () => {
    const nodes = agentWith(withClip({ tileId: '', previewVideoUrl: MP4, videoUrl: 'https://grok/x.mp4' }),
      ['inspect_clip']);
    let turn = 0;
    resultFor = () => ({
      text: ++turn === 1
        ? 'TOOL: inspect_clip\n{"node": "gen_vid"}'
        : 'DONE\nThe product stays consistent across the shot.',
    });

    await runner.run(nodes as any, workflow().edges as any, { only: new Set(['agent_1']) });

    const chats = sent.filter((s) => s.config.platform === 'chatgpt');
    expect(chats[1].config.referenceImageData).toEqual([MP4]);
    // "Watch it", not "look at it" — and never the remote URL.
    expect(chats[1].config.prompt).toMatch(/The clip is attached/i);
    expect(chats[1].config.prompt).toMatch(/Watch it/i);
    expect(JSON.stringify(chats[1].config)).not.toContain('https://grok');
  });

  it('says a clip cannot be watched rather than letting it be described', async () => {
    // Only a remote URL — nothing a chat tab can open.
    const nodes = agentWith(withClip({ tileId: '', videoUrl: 'https://grok.com/generated_video/x.mp4' }),
      ['inspect_clip']);
    let turn = 0;
    resultFor = () => ({
      text: ++turn === 1
        ? 'TOOL: inspect_clip\n{"node": "gen_vid"}'
        : 'DONE\nIt could not be inspected.',
    });

    await runner.run(nodes as any, workflow().edges as any, { only: new Set(['agent_1']) });

    const chats = sent.filter((s) => s.config.platform === 'chatgpt');
    expect(chats[1].config.referenceImageData).toBeUndefined();
    expect(chats[1].config.prompt).toMatch(/cannot watch it. Do not describe it/i);
  });

  it('distinguishes a node that has not run from one that does not exist', async () => {
    const nodes = agentWith(workflow().nodes, ['inspect_clip']);
    useStudioStore.setState({ nodes } as any);
    let turn = 0;
    resultFor = () => ({
      text: ++turn === 1
        ? 'TOOL: inspect_clip\n{"node": "gen_vid"}'
        : 'DONE\nNothing to inspect yet.',
    });

    await runner.run(nodes as any, workflow().edges as any);

    const chats = sent.filter((s) => s.config.platform === 'chatgpt');
    expect(chats[1].config.prompt).toMatch(/has not produced anything in this run/i);
  });
});

/* ============================================================
   Acting on the workflow — read a node, fix its prompt, run it again.

   The loop a fixed canvas cannot do, and the reason the agent exists at all:
   today this is done by hand, node by node, watching each render come back.
   ============================================================ */
describe('fixing and re-running a node', () => {
  const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';

  /** Canvas: a prompt feeding a Flow image node, plus the agent. */
  function repairCanvas(nodeStatus = 'error', errorMessage = 'Content policy refusal') {
    const nodes = [
      {
        id: 'p_shot', type: 'prompt', position: { x: 0, y: 0 },
        data: { type: 'prompt', label: 'Shot Prompt', text: 'a sneaker' },
      } as any,
      {
        id: 'g_shot', type: 'generate', position: { x: 400, y: 0 },
        data: {
          type: 'generate', label: 'Hero Shot', platform: 'flow', mediaType: 'image',
          model: 'Nano Banana Pro', aspectRatio: '16:9', creationType: 'ingredients',
          enabled: true, status: nodeStatus, errorMessage,
        },
      } as any,
      {
        id: 'p_goal', type: 'prompt', position: { x: 0, y: 400 },
        data: { type: 'prompt', label: 'Goal', text: 'Fix the failed node.' },
      } as any,
      {
        id: 'agent_1', type: 'agent', position: { x: 400, y: 400 },
        data: {
          type: 'agent', label: 'Fixer', platform: 'chatgpt', mediaType: 'text',
          maxIterations: 8, tools: ['read_node', 'set_prompt', 'rerun_node'],
          system: '', agentSteps: [], enabled: true, status: 'idle',
        },
      } as any,
    ];
    const edges = [
      { id: 'e1', source: 'p_shot', target: 'g_shot', sourceHandle: 'text', targetHandle: 'text' },
      { id: 'e2', source: 'p_goal', target: 'agent_1', sourceHandle: 'text', targetHandle: 'text' },
    ] as any[];
    useStudioStore.setState({ nodes, edges } as any);
    return { nodes, edges };
  }

  it('reads the failure and the prompt behind it', async () => {
    const { nodes, edges } = repairCanvas();
    let turn = 0;
    resultFor = () => ({
      text: ++turn === 1 ? 'TOOL: read_node\n{"node": "g_shot"}' : 'DONE\nI see the problem.',
    });

    await runner.run(nodes, edges, { only: new Set(['agent_1']) });

    const obs = sent[1].config.prompt;
    expect(obs).toContain('status: error');
    expect(obs).toContain('Content policy refusal');
    // A generate node does not hold its prompt — the wire has to be followed.
    expect(obs).toContain('held by node "p_shot"');
    expect(obs).toContain('a sneaker');
  });

  it('rewrites the PROMPT node, not the generate node', async () => {
    const { nodes, edges } = repairCanvas();
    let turn = 0;
    resultFor = () => ({
      text: ++turn === 1
        ? 'TOOL: set_prompt\n{"node": "g_shot", "text": "a red sneaker on wet concrete"}'
        : 'DONE\nRewritten.',
    });

    await runner.run(nodes, edges, { only: new Set(['agent_1']) });

    const after = useStudioStore.getState().nodes;
    expect((after.find((n) => n.id === 'p_shot')!.data as any).text)
      .toBe('a red sneaker on wet concrete');
    // The generate node is untouched — it never held the text.
    expect((after.find((n) => n.id === 'g_shot')!.data as any).text).toBeUndefined();
    expect(sent[1].config.prompt).toMatch(/Rewrote "p_shot", the prompt feeding "g_shot"/);
  });

  it('re-runs with the NEW prompt, not the cached one', async () => {
    /* The trap. The runner reads a node's prompt out of nodeResults, filled
       when the Prompt node was visited at the start of the run. Updating only
       the canvas would re-run the old text while the screen showed the new. */
    const { nodes, edges } = repairCanvas();
    (runner as any).nodeResults.set('p_shot', { tileId: '', imageUrl: 'a sneaker' });

    const flowPrompts: string[] = [];
    let turn = 0;
    resultFor = (config) => {
      if (config.platform === 'flow') {
        flowPrompts.push(config.prompt);
        return { previewUrl: PNG };
      }
      turn++;
      if (turn === 1) return { text: 'TOOL: set_prompt\n{"node": "g_shot", "text": "a RED sneaker, wet concrete"}' };
      if (turn === 2) return { text: 'TOOL: rerun_node\n{"node": "g_shot"}' };
      return { text: 'DONE\nFixed and re-rendered.' };
    };

    await runner.run(nodes, edges, { only: new Set(['agent_1']) });

    expect(flowPrompts).toEqual(['a RED sneaker, wet concrete']);
    const g = useStudioStore.getState().nodes.find((n) => n.id === 'g_shot')!;
    expect((g.data as any).status).toBe('done');
    expect((g.data as any).errorMessage).toBeNull();
    // The new render comes back attached, so the fix can be judged.
    const chats = sent.filter((s) => s.config.platform === 'chatgpt');
    expect(chats[2].config.referenceImageData).toEqual([PNG]);
  });

  it('refuses to re-run the agent itself', async () => {
    const { nodes, edges } = repairCanvas();
    let turn = 0;
    resultFor = () => ({
      text: ++turn === 1 ? 'TOOL: rerun_node\n{"node": "agent_1"}' : 'DONE\nStopped.',
    });

    await runner.run(nodes, edges, { only: new Set(['agent_1']) });

    // An agent re-running itself spends a generation per turn until the cap.
    expect(sent[1].config.prompt).toMatch(/cannot re-run itself/i);
  });

  it('caps how many nodes one run may re-render', async () => {
    const { nodes, edges } = repairCanvas('done', '');
    let turn = 0;
    resultFor = (config) => {
      if (config.platform === 'flow') return { previewUrl: PNG };
      turn++;
      return turn <= 6
        ? { text: 'TOOL: rerun_node\n{"node": "g_shot"}' }
        : { text: 'DONE\nEnough.' };
    };

    await runner.run(nodes, edges, { only: new Set(['agent_1']) });

    const flows = sent.filter((s) => s.config.platform === 'flow');
    expect(flows).toHaveLength(3);          // AGENT_MAX_RERUNS
    expect(JSON.stringify(sent)).toMatch(/which is the limit/);
  });

  it('tells the model a failed re-run failed, instead of aborting', async () => {
    const { nodes, edges } = repairCanvas();
    let turn = 0;
    resultFor = (config) => {
      if (config.platform === 'flow') return { error: 'Flow tab was closed' };
      turn++;
      return turn === 1
        ? { text: 'TOOL: rerun_node\n{"node": "g_shot"}' }
        : { text: 'DONE\nIt still fails; the Flow tab is closed.' };
    };

    await runner.run(nodes, edges, { only: new Set(['agent_1']) });

    // sent interleaves the Flow re-run with the chat turns, so filter.
    const chats = sent.filter((s) => s.config.platform === 'chatgpt');
    expect(chats[1].config.prompt).toMatch(/failed again: Flow tab was closed/);
    const agent = useStudioStore.getState().nodes.find((n) => n.id === 'agent_1')!;
    expect((agent.data as any).status).toBe('done');
    // The node it tried to fix is left marked failed, not quietly "done".
    const g = useStudioStore.getState().nodes.find((n) => n.id === 'g_shot')!;
    expect((g.data as any).status).toBe('error');
  });

  it('will not re-run a node that carries data rather than running', async () => {
    const { nodes, edges } = repairCanvas();
    let turn = 0;
    resultFor = () => ({
      text: ++turn === 1 ? 'TOOL: rerun_node\n{"node": "p_shot"}' : 'DONE\nUnderstood.',
    });

    await runner.run(nodes, edges, { only: new Set(['agent_1']) });

    expect(sent[1].config.prompt).toMatch(/is a prompt node/i);
  });
});
