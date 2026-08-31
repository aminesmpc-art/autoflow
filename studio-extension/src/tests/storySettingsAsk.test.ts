/**
 * A Story node that has not been told anything.
 *
 * Drag one onto the canvas and it runs on Director Coverage, Layered Cinematic
 * Audio and no visual preset — which is a decision about the piece that nobody
 * made. For a lot of ideas it is the wrong one, and for UGC it is the worst
 * available: directed coverage opens on a wide establishing shot, which is
 * exactly what makes a phone review look staged.
 *
 * So when nothing is set, the director is asked to choose first, in its own
 * turn, and the answer is written onto the node — visible in the dropdowns,
 * still there next run, chosen once rather than re-decided every time.
 *
 * Its own turn rather than folded into the shot request, for two reasons. The
 * settings decide what the brief SAYS, so they have to exist before it can be
 * written. And a model asked for eleven settings and five prompts in a single
 * reply does both worse than a model asked for each in turn.
 *
 * The same conversation throughout: a new chat for the second turn would throw
 * away the piece it just described and pay for saying it twice.
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
import {
  storyIsUnset, settingsAsk, readSettingsReply,
  CAMERA_PROGRESSIONS, AUDIO_MODES, VISUAL_PRESETS, STRUCTURES, RULES,
} from '../studio/ask/storyPlan';
import { readJsonObject } from '../studio/ask/storyboard';

const targets = [
  { id: 'a', label: 'Clip 1', media: 'video' as const, platform: 'flow', duration: '8s', aspectRatio: '9:16' },
  { id: 'b', label: 'Clip 2', media: 'video' as const, platform: 'flow', duration: '8s', aspectRatio: '9:16' },
];

const P = (s: string) => `One propped phone in a small sunlit bathroom as ${s} and turns `
  + 'toward the window, skin with visible pores and a faint shine on the forehead.';

const SHOTS = JSON.stringify({
  story: 'One bathroom, two halves.',
  anchor: 'a woman in a beige ribbed tank, the small sunlit bathroom',
  shots: [
    { n: 1, title: 'Clip 1', prompt: P('she unscrews the jar') },
    { n: 2, title: 'Clip 2', prompt: P('she presses it into her cheek') },
  ],
});

const CHOSEN = JSON.stringify({
  structure: 'ugcAd',
  cameraProgression: 'propped',
  audioMode: 'dialogue',
  visualPreset: 'smartphonePOV',
  rules: ['samePerson'],
  timedBeats: false,
  avoid: 'other people in shot',
});

function workflow(storyData: Record<string, unknown>): { nodes: Node[]; edges: Edge[] } {
  const nodes = [
    { id: 'idea', type: 'prompt', position: { x: 0, y: 0 },
      data: { type: 'prompt', label: 'Idea', text: 'a serum that fixed her dry patches' } },
    { id: 'story', type: 'story', position: { x: 200, y: 0 },
      data: { type: 'story', label: 'Story', platform: 'chatgpt', mediaType: 'text', ...storyData } },
    { id: 'clipA', type: 'generate', position: { x: 500, y: 0 },
      data: { type: 'generate', label: 'Clip 1', mediaType: 'video', platform: 'flow',
        aspectRatio: '9:16', duration: '8s' } },
    { id: 'clipB', type: 'generate', position: { x: 900, y: 0 },
      data: { type: 'generate', label: 'Clip 2', mediaType: 'video', platform: 'flow',
        aspectRatio: '9:16', duration: '8s' } },
  ] as unknown as Node[];
  const edges = [
    { id: 'e1', source: 'idea', target: 'story', sourceHandle: 'text', targetHandle: 'text' },
    { id: 'e2', source: 'story', target: 'clipA', sourceHandle: 'text', targetHandle: 'text' },
    { id: 'e3', source: 'story', target: 'clipB', sourceHandle: 'text', targetHandle: 'text' },
  ] as unknown as Edge[];
  return { nodes, edges };
}

const chatTurns = () => sent.filter((s) => s.config.mediaType === 'text');

async function run(storyData: Record<string, unknown>, queue: string[]) {
  replies = [...queue];
  const { nodes, edges } = workflow(storyData);
  useStudioStore.setState({ nodes, edges } as any);
  await runner.run(nodes, edges);
}

beforeEach(() => {
  sent.length = 0;
  replies = [];
  useStudioStore.setState({ nodes: [], edges: [] } as any);
});

describe('knowing whether anybody has configured the node', () => {
  it('is true for the node you drag onto the canvas', () => {
    /* Exactly what Canvas.tsx seeds: a label, a platform, a media type. */
    expect(storyIsUnset({
      type: 'story', label: 'Story 1', platform: 'chatgpt', mediaType: 'text',
      preset: '', status: 'idle',
    })).toBe(true);
    expect(storyIsUnset({})).toBe(true);
    expect(storyIsUnset(undefined)).toBe(true);
  });

  it('is false the moment any one setting is chosen', () => {
    for (const set of [
      { structure: 'hook' }, { cameraProgression: 'fixed' }, { audioMode: 'none' },
      { visualPreset: 'liveAction' }, { rules: ['samePerson'] }, { beats: 5 },
      { timedBeats: true }, { avoid: 'traffic' }, { world: 'a kitchen' },
      { look: 'warm' }, { cast: [{ name: 'A', look: 'b' }] },
    ]) {
      expect(storyIsUnset({ type: 'story', ...set })).toBe(false);
    }
  });

  it('is false for a node the builder made, whatever the plan said', () => {
    /* plan.ts writes the four settings unconditionally, so a built node has
       been decided even when the model left them out. Asking again would be
       overruling a choice. */
    expect(storyIsUnset({
      type: 'story', structure: 'hook', cameraProgression: 'dynamic',
      audioMode: 'cinematic', visualPreset: 'liveAction',
    })).toBe(false);
  });

  it('is not confused by an empty string or an empty list', () => {
    expect(storyIsUnset({ type: 'story', world: '', look: '  ', rules: [], cast: [], beats: 0 }))
      .toBe(true);
  });
});

describe('the question it asks', () => {
  const ask = settingsAsk('a serum that fixed her dry patches', targets);

  it('gives it the idea and what is being made', () => {
    expect(ask).toContain('a serum that fixed her dry patches');
    expect(ask).toContain('Clip 1 — a moving clip (9:16, 8s)');
    expect(ask).toContain('IT IS BEING MADE AS 2 SHOTS');
  });

  it('offers every value that exists, so it can choose the new ones', () => {
    for (const list of [CAMERA_PROGRESSIONS, AUDIO_MODES, VISUAL_PRESETS, STRUCTURES, RULES]) {
      for (const item of list) expect(ask).toContain(`"${item.id}"`);
    }
  });

  it('explains what each one is for rather than listing bare ids', () => {
    expect(ask).toContain('Phone on a Surface (UGC)');
    expect(ask).toContain('Hook ➜ Problem ➜ Proof ➜ CTA');
  });

  it('says the defaults are not neutral', () => {
    expect(ask).toMatch(/the\s+defaults suit a directed short film/);
  });

  it('asks for JSON and nothing else', () => {
    expect(ask).toContain('No prose, no code fence, no explanation.');
  });
});

describe('reading the answer', () => {
  const read = (s: string) => readSettingsReply(readJsonObject(s));

  it('keeps every value that exists', () => {
    expect(read(CHOSEN)).toEqual({
      structure: 'ugcAd',
      cameraProgression: 'propped',
      audioMode: 'dialogue',
      visualPreset: 'smartphonePOV',
      rules: ['samePerson'],
      timedBeats: false,
      avoid: 'other people in shot',
    });
  });

  it('drops an invented value rather than writing it to the node', () => {
    /* A dropdown cannot render "handheldVlog": the control would show blank
       and the brief would fall back to the default anyway, with nobody able
       to see why. Dropping it leaves the default visible and honest. */
    const s = read(JSON.stringify({
      cameraProgression: 'handheldVlog', audioMode: 'asmr',
      structure: 'ugcAd', rules: ['samePerson', 'noZoom'],
    }));
    expect(s.cameraProgression).toBeUndefined();
    expect(s.audioMode).toBeUndefined();
    expect(s.structure).toBe('ugcAd');
    expect(s.rules).toEqual(['samePerson']);
  });

  it('survives a fenced reply and prose around it', () => {
    expect(read('Sure! Here you go:\n```json\n' + CHOSEN + '\n```\nHope that helps.')
      .cameraProgression).toBe('propped');
  });

  it('returns nothing at all for a reply that is not JSON', () => {
    expect(read('I think we should go with a handheld look.')).toEqual({});
    expect(readSettingsReply(null)).toEqual({});
  });

  it('keeps a false timedBeats, which is a choice and not an absence', () => {
    expect(read('{"timedBeats": false}')).toEqual({ timedBeats: false });
  });
});

describe('an unconfigured node, actually run', () => {
  it('asks for the settings first, then the prompts', async () => {
    await run({}, [CHOSEN, SHOTS]);
    const turns = chatTurns();
    expect(turns).toHaveLength(2);
    expect(turns[0].config.prompt).toContain('Before writing anything, decide');
    expect(turns[1].config.prompt).toContain('WRITE ALL 2 PROMPTS');
  });

  it('keeps both turns in one conversation', async () => {
    /* A new chat for the second turn would throw away the piece it just
       described and pay for describing it twice. */
    await run({}, [CHOSEN, SHOTS]);
    const turns = chatTurns();
    expect(turns[0].config.newChat).toBe('auto');
    expect(turns[1].config.newChat).toBe('never');
  });

  it('writes the brief from what it chose, not from the defaults', async () => {
    await run({}, [CHOSEN, SHOTS]);
    const brief = chatTurns()[1].config.prompt as string;
    expect(brief).toContain('Phone on a Surface (UGC)');
    expect(brief).toContain('SHOT AS UGC');
    expect(brief).toContain('Hook ➜ Problem ➜ Proof ➜ CTA');
    expect(brief).toContain('other people in shot');
    expect(brief).not.toContain('Director Coverage');
  });

  it('writes the choices onto the node, so they show and they last', async () => {
    await run({}, [CHOSEN, SHOTS]);
    const node: any = useStudioStore.getState().nodes.find((n: any) => n.id === 'story');
    expect(node.data.cameraProgression).toBe('propped');
    expect(node.data.visualPreset).toBe('smartphonePOV');
    expect(node.data.structure).toBe('ugcAd');
    expect(node.data.avoid).toBe('other people in shot');
    // And it is no longer unset, so the next run will not ask again.
    expect(storyIsUnset(node.data)).toBe(false);
  });

  it('still delivers the prompts to the clips', async () => {
    await run({}, [CHOSEN, SHOTS]);
    expect(sent.find((s) => s.nodeId === 'clipA')?.config.prompt)
      .toContain('she unscrews the jar');
    expect(sent.find((s) => s.nodeId === 'clipB')?.config.prompt)
      .toContain('she presses it into her cheek');
  });

  it('carries on with the defaults when the answer is unusable', async () => {
    /* Losing a whole run over a settings turn would be worse than making the
       piece on the defaults, which is what it did before this existed. */
    await run({}, ['I would go with something handheld and warm.', SHOTS]);
    const turns = chatTurns();
    expect(turns).toHaveLength(2);
    expect(turns[1].config.prompt).toContain('Director Coverage');
    expect(sent.find((s) => s.nodeId === 'clipA')?.config.prompt)
      .toContain('she unscrews the jar');
  });
});

describe('a node somebody has configured', () => {
  it('is not asked, and its choices are used', async () => {
    await run({ cameraProgression: 'fixed', audioMode: 'ambient' }, [SHOTS]);
    const turns = chatTurns();
    expect(turns).toHaveLength(1);
    expect(turns[0].config.prompt).not.toContain('Before writing anything, decide');
    expect(turns[0].config.prompt).toContain('Locked Tripod');
    expect(turns[0].config.prompt).toContain('Environment & Foley');
  });

  it('opens its own conversation, since nothing came before it', async () => {
    await run({ cameraProgression: 'fixed' }, [SHOTS]);
    expect(chatTurns()[0].config.newChat).toBe('auto');
  });
});
