/**
 * A Story node, actually run.
 *
 * Everything else about this feature is tested as pure functions: the
 * contract, the checker, the repair message, the brief. That left the part
 * most likely to be wrong and least likely to be noticed — the wiring. Does
 * the runner dispatch a story node at all, does the repair loop close, and
 * does shot 2 reach the node expecting shot 2 rather than the node expecting
 * shot 1?
 *
 * That last one is the reason this file exists. Getting it wrong produces two
 * clips that both render perfectly and are each other's, which looks like the
 * model losing the plot and is impossible to diagnose from the output.
 *
 * Only the transport and the billing call are faked. The topological sort,
 * the dispatch, the JSON contract, the format checker, the repair loop and
 * the distribution are all the real code.
 */

/// <reference types="node" />

import type { Node, Edge } from '@xyflow/react';

const sent: Array<{ nodeId: string; config: any }> = [];
let replies: string[] = [];

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
        setTimeout(() => {
          /* Chat turns consume the queued replies in order, so a test can set
             up "malformed, then fixed" and watch the loop close. Generators
             just succeed — what they were handed is what is being checked. */
          const isChat = config.mediaType === 'text';
          const text = isChat ? (replies.shift() ?? '{"shots":[]}') : '';
          for (const h of handlers['STUDIO_NODE_RESULT'] || []) {
            h({ nodeId, tileId: 't', text, imageUrl: isChat ? '' : 'https://example.test/x.mp4' });
          }
        }, 5);
        return true;
      },
    },
  };
});

import { runner } from '../studio/engine/WorkflowRunner';
import { useStudioStore } from '../studio/store';

const P1 = 'One fixed medium-wide camera inside a tall pink lounge as the blonde designer in '
  + 'a red tracksuit walks in carrying glowing floor rails and lays them across the boards.';
const P2 = 'One fixed medium-wide camera inside the same tall pink lounge, floor already lit, '
  + 'as the blonde designer in a red tracksuit mounts the wall panels and moves the couch in.';

const envelope = (a: string, b: string, extra: Record<string, unknown> = {}) => JSON.stringify({
  story: 'One room, two halves.',
  anchor: 'the blonde designer in a red tracksuit, the tall pink lounge',
  ...extra,
  shots: [
    { n: 1, title: 'Part 1', prompt: a },
    { n: 2, title: 'Part 2', prompt: b },
  ],
});

/** idea → story → (clip A, clip B) */
function workflow(): { nodes: Node[]; edges: Edge[] } {
  const nodes = [
    { id: 'idea', type: 'prompt', position: { x: 0, y: 0 },
      data: { type: 'prompt', label: 'Idea', text: 'a candy lounge' } },
      /* Configured, so this file keeps testing what it is about. An
         unconfigured Story node now spends a turn choosing its settings
         before it writes anything — see storySettingsAsk.test.ts. */
    { id: 'story', type: 'story', position: { x: 200, y: 0 },
      data: { type: 'story', label: 'Story', platform: 'chatgpt', mediaType: 'text',
        structure: 'hook' } },
    { id: 'clipA', type: 'generate', position: { x: 500, y: 0 },
      data: { type: 'generate', label: 'Part 1', mediaType: 'video', platform: 'flow',
        aspectRatio: '9:16', duration: '10s' } },
    { id: 'clipB', type: 'generate', position: { x: 900, y: 0 },
      data: { type: 'generate', label: 'Part 2', mediaType: 'video', platform: 'flow',
        aspectRatio: '9:16', duration: '10s' } },
  ] as unknown as Node[];
  const edges = [
    { id: 'e1', source: 'idea', target: 'story', sourceHandle: 'text', targetHandle: 'text' },
    { id: 'e2', source: 'story', target: 'clipA', sourceHandle: 'text', targetHandle: 'text' },
    { id: 'e3', source: 'story', target: 'clipB', sourceHandle: 'text', targetHandle: 'text' },
  ] as unknown as Edge[];
  return { nodes, edges };
}

const promptSentTo = (id: string) => sent.find((s) => s.nodeId === id)?.config?.prompt as string;
const chatTurns = () => sent.filter((s) => s.config.mediaType === 'text');

beforeEach(() => {
  sent.length = 0;
  replies = [];
  useStudioStore.setState({ nodes: [], edges: [] } as any);
});

describe('a Story node run end to end', () => {
  it('writes both prompts in one chat turn and gives each clip its own', async () => {
    replies = [envelope(P1, P2)];
    const { nodes, edges } = workflow();
    useStudioStore.setState({ nodes, edges } as any);
    await runner.run(nodes, edges);

    // One conversation, not one per clip. That is the whole point.
    expect(chatTurns()).toHaveLength(1);
    expect(promptSentTo('clipA')).toBe(P1);
    expect(promptSentTo('clipB')).toBe(P2);
  });

  it('does not hand the whole reply to either clip', async () => {
    /* The failure before distribution existed: every downstream node received
       the entire text, so both clips were generated from a JSON document. */
    replies = [envelope(P1, P2)];
    const { nodes, edges } = workflow();
    useStudioStore.setState({ nodes, edges } as any);
    await runner.run(nodes, edges);

    expect(promptSentTo('clipA')).not.toContain('"shots"');
    expect(promptSentTo('clipB')).not.toContain('anchor');
  });

  it('tells the model what each clip is before asking for anything', async () => {
    replies = [envelope(P1, P2)];
    const { nodes, edges } = workflow();
    useStudioStore.setState({ nodes, edges } as any);
    await runner.run(nodes, edges);

    const brief = chatTurns()[0].config.prompt as string;
    expect(brief).toContain('Part 1 — a moving clip (9:16, 10s, flow)');
    expect(brief).toContain('Part 2 — a moving clip (9:16, 10s, flow)');
    expect(brief).toContain('WRITE ALL 2 PROMPTS');
    expect(brief).toContain('a candy lounge');
  });

  it('repairs a bad reply in the same conversation, then proceeds', async () => {
    /* A fence in shot 2 would be typed into the composer literally. The first
       reply carries one; the second does not. */
    replies = [envelope(P1, '```\n' + P2 + '\n```'), envelope(P1, P2)];
    const { nodes, edges } = workflow();
    useStudioStore.setState({ nodes, edges } as any);
    await runner.run(nodes, edges);

    const turns = chatTurns();
    expect(turns).toHaveLength(2);
    // The second turn names the problem rather than repeating the brief.
    expect(turns[1].config.prompt).toContain('code fence');
    expect(turns[1].config.prompt).toContain('the complete object');
    // And it continues in the same thread, which is what makes it a repair.
    expect(turns[1].config.newChat).toBe('never');
    expect(promptSentTo('clipB')).toBe(P2);
  });

  it('spends nothing when it cannot get a clean set', async () => {
    /* Three bad replies: the opening turn and both repairs. Generating from
       prompts known to be broken costs real money for output nobody wants,
       so the run stops instead.

       "Certainly! Here is your second clip." is the meta code, which the
       generator types in literally — one of the problems still worth
       refusing over. Most are not: a shot the checker merely judges badly
       now runs, and storyAdvisory.test.ts covers which is which. */
    const bad = envelope(P1, 'Certainly! Here is your second clip.');
    replies = [bad, bad, bad];
    const { nodes, edges } = workflow();
    useStudioStore.setState({ nodes, edges } as any);
    await runner.run(nodes, edges);

    expect(chatTurns()).toHaveLength(3);
    expect(sent.some((s) => s.nodeId === 'clipA')).toBe(false);
    expect(sent.some((s) => s.nodeId === 'clipB')).toBe(false);
    const story = useStudioStore.getState().nodes.find((n) => n.id === 'story');
    expect(String((story?.data as any)?.errorMessage || ''))
      .toMatch(/typed \s*into the generator|usable prompts/i);
  });

  it('refuses to run wired to nothing rather than asking for a plan for no one', async () => {
    const { nodes } = workflow();
    const lonely = nodes.filter((n) => n.id === 'idea' || n.id === 'story');
    const edges = [
      { id: 'e1', source: 'idea', target: 'story', sourceHandle: 'text', targetHandle: 'text' },
    ] as unknown as Edge[];
    useStudioStore.setState({ nodes: lonely, edges } as any);
    await runner.run(lonely, edges);

    expect(chatTurns()).toHaveLength(0);
    const story = useStudioStore.getState().nodes.find((n) => n.id === 'story');
    expect(String((story?.data as any)?.errorMessage || '')).toMatch(/not wired to anything/i);
  });
});

describe('what the run remembers', () => {
  it('locks the cast, world and look the model chose', async () => {
    replies = [envelope(P1, P2, {
      cast: [{ name: 'Maya', look: 'blonde ponytail, red tracksuit' }],
      world: 'a tall pink peppermint lounge',
      look: 'glossy candy pink, soft key',
    })];
    const { nodes, edges } = workflow();
    useStudioStore.setState({ nodes, edges } as any);
    await runner.run(nodes, edges);

    const d = useStudioStore.getState().nodes.find((n) => n.id === 'story')?.data as any;
    expect(d.cast).toEqual([{ name: 'Maya', look: 'blonde ponytail, red tracksuit' }]);
    expect(d.world).toBe('a tall pink peppermint lounge');
    expect(d.look).toBe('glossy candy pink, soft key');
  });

  it('does not overwrite what the user already set', async () => {
    /* A field the user typed outranks anything the model returns, or
       correcting a detail would last exactly one run. */
    const { nodes, edges } = workflow();
    (nodes.find((n) => n.id === 'story') as any).data.world = 'a concrete garage';
    replies = [envelope(P1, P2, { world: 'a tall pink lounge' })];
    useStudioStore.setState({ nodes, edges } as any);
    await runner.run(nodes, edges);

    const d = useStudioStore.getState().nodes.find((n) => n.id === 'story')?.data as any;
    expect(d.world).toBe('a concrete garage');
  });

  it('puts what the user set into the brief', async () => {
    const { nodes, edges } = workflow();
    (nodes.find((n) => n.id === 'story') as any).data.cast = [
      { name: 'Maya', look: 'blonde ponytail, red tracksuit' },
    ];
    replies = [envelope(P1, P2)];
    useStudioStore.setState({ nodes, edges } as any);
    await runner.run(nodes, edges);

    const brief = chatTurns()[0].config.prompt as string;
    expect(brief).toContain('CAST — fixed');
    expect(brief).toContain('Maya: blonde ponytail, red tracksuit');
  });
});

/**
 * A voice the Story casts has to reach Flow.
 *
 * Reported from a real run: the node on screen read "Kore — Female, firm, mid
 * pitch" and the clip came back silent, while the same voice chosen by hand on
 * the same node worked. Both of those are true at once for one reason.
 *
 * The runner sorts a snapshot of `nodes` before the first step and then reads
 * `node.data` off it. React Flow's updateNodeData replaces node objects rather
 * than mutating them, so anything written to a node DURING the run is invisible
 * to the loop. A Story node's entire job is to write to the nodes below it, and
 * every one of them runs afterwards — so a hand-set voice was in the snapshot
 * and a cast one never was.
 *
 * The worst shape a bug can take: the canvas agrees with you and the run does
 * not.
 */
describe('a voice cast by the Story', () => {
  /** idea → story → clip, with a still wired in so a voice can apply. */
  function voiceWorkflow(): { nodes: Node[]; edges: Edge[] } {
    const nodes = [
      { id: 'idea', type: 'prompt', position: { x: 0, y: 0 },
        data: { type: 'prompt', label: 'Idea', text: 'a cafe' } },
      { id: 'still', type: 'image', position: { x: 0, y: 300 },
        data: { type: 'image', label: 'Maya', imageData: 'data:image/jpeg;base64,AAAA' } },
      { id: 'story', type: 'story', position: { x: 200, y: 0 },
        data: {
          type: 'story', label: 'Story', platform: 'chatgpt', mediaType: 'text',
          audioMode: 'dialogue',
          cast: [{ name: 'Maya', look: 'red coat', voice: 'Kore' }],
        } },
      { id: 'clipA', type: 'generate', position: { x: 500, y: 0 },
        data: { type: 'generate', label: 'Part 1', mediaType: 'video', platform: 'flow',
          aspectRatio: '9:16', duration: '8s' } },
      { id: 'clipB', type: 'generate', position: { x: 900, y: 0 },
        data: { type: 'generate', label: 'Part 2', mediaType: 'video', platform: 'flow',
          aspectRatio: '9:16', duration: '8s' } },
    ] as unknown as Node[];
    const edges = [
      { id: 'e1', source: 'idea', target: 'story', sourceHandle: 'text', targetHandle: 'text' },
      { id: 'e2', source: 'story', target: 'clipA', sourceHandle: 'text', targetHandle: 'text' },
      { id: 'e3', source: 'story', target: 'clipB', sourceHandle: 'text', targetHandle: 'text' },
      { id: 'e4', source: 'still', target: 'clipA', sourceHandle: 'result', targetHandle: 'image_ref' },
      { id: 'e5', source: 'still', target: 'clipB', sourceHandle: 'result', targetHandle: 'image_ref' },
    ] as unknown as Edge[];
    return { nodes, edges };
  }

  const cast = (a: string[], b: string[]) => envelope(P1, P2, {
    cast: [{ name: 'Maya', look: 'red coat' }],
    shots: undefined,
  }).replace(
    /"shots":\[[\s\S]*\]/,
    JSON.stringify({
      shots: [
        { n: 1, title: 'Part 1', cast: a, speaker: a[0], prompt: P1 },
        { n: 2, title: 'Part 2', cast: b, speaker: b[0], prompt: P2 },
      ],
    }).slice(1, -1),
  );

  it('sends it in the config, not just onto the canvas', async () => {
    replies = [cast(['Maya'], ['Maya'])];
    const { nodes, edges } = voiceWorkflow();
    useStudioStore.setState({ nodes, edges } as any);
    await runner.run(nodes, edges);

    const clipA = sent.find((s) => s.nodeId === 'clipA');
    /* The assertion that was failing in the wild. The canvas showed Kore
       either way; only the config told the truth. */
    expect(clipA?.config?.voice).toBe('Kore');
    expect(sent.find((s) => s.nodeId === 'clipB')?.config?.voice).toBe('Kore');
  }, 30_000);

  it('still sends a voice set by hand, which always worked', async () => {
    replies = [cast(['Maya'], ['Maya'])];
    const { nodes, edges } = voiceWorkflow();
    (nodes.find((n) => n.id === 'clipB')!.data as any).voice = 'Charon';
    useStudioStore.setState({ nodes, edges } as any);
    await runner.run(nodes, edges);

    /* Hand-set outranks the Story, and is the control for the test above: if
       this one passed while the first failed, the fault is the snapshot and
       not the casting rule. */
    expect(sent.find((s) => s.nodeId === 'clipB')?.config?.voice).toBe('Charon');
  }, 30_000);

  it('sends no voice when nobody in the shot has one', async () => {
    replies = [cast(['the dog'], ['the dog'])];
    const { nodes, edges } = voiceWorkflow();
    useStudioStore.setState({ nodes, edges } as any);
    await runner.run(nodes, edges);
    expect(sent.find((s) => s.nodeId === 'clipA')?.config?.voice).toBeFalsy();
  }, 30_000);
});
