/**
 * The settings on a Story node, and whether the brief ever sees them.
 *
 * Found while making UGC better, and it is the reason UGC was bad. The runner
 * builds the StorySettings object it hands to storyBrief by hand:
 *
 *   const settings: StorySettings = {
 *     ...DEFAULT_STORY,
 *     ...(nodeData.cast ? { cast: nodeData.cast } : {}),
 *     world, look, structure, beats, rules,
 *   };
 *
 * Six fields copied, five forgotten — and because DEFAULT_STORY is spread
 * first, the five did not come through as empty. They came through as the
 * defaults. Pick "Smartphone POV (TikTok)" and the brief said Custom. Pick the
 * locked phone and the brief asked for Director Coverage. Turn dialogue off
 * and the brief asked for dialogue anyway.
 *
 * Nothing looked broken, which is why it lasted: the node showed the choice,
 * the run succeeded, and the prompts came back well-formed. They were just
 * prompts for a different piece.
 *
 * Two readers of the same node existed, each dropping a different set —
 * StoryNode's own readStory drops `avoid` and `timedBeats`, so those two did
 * not survive a reload either. Both now go through one function, which is why
 * these tests check it directly as well as through a run.
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
import { readStorySettings, DEFAULT_STORY } from '../studio/ask/storyPlan';

const P = (s: string) => `One propped phone in a small sunlit bathroom as ${s} and turns `
  + 'toward the window, skin with visible pores and a faint shine on the forehead.';

const envelope = () => JSON.stringify({
  story: 'One bathroom, two halves.',
  anchor: 'a woman in a beige ribbed tank, the small sunlit bathroom',
  shots: [
    { n: 1, title: 'Part 1', prompt: P('she unscrews the jar') },
    { n: 2, title: 'Part 2', prompt: P('she presses it into her cheek') },
  ],
});

/** idea → story → (clip A, clip B), with whatever the story node was set to. */
function workflow(storyData: Record<string, unknown>): { nodes: Node[]; edges: Edge[] } {
  const nodes = [
    { id: 'idea', type: 'prompt', position: { x: 0, y: 0 },
      data: { type: 'prompt', label: 'Idea', text: 'a serum that fixed her dry patches' } },
    { id: 'story', type: 'story', position: { x: 200, y: 0 },
      data: { type: 'story', label: 'Story', platform: 'chatgpt', mediaType: 'text', ...storyData } },
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
  ] as unknown as Edge[];
  return { nodes, edges };
}

async function briefFor(storyData: Record<string, unknown>): Promise<string> {
  replies = [envelope()];
  const { nodes, edges } = workflow(storyData);
  useStudioStore.setState({ nodes, edges } as any);
  await runner.run(nodes, edges);
  const chat = sent.find((s) => s.config.mediaType === 'text');
  return (chat?.config?.prompt as string) || '';
}

beforeEach(() => {
  sent.length = 0;
  replies = [];
  useStudioStore.setState({ nodes: [], edges: [] } as any);
});

describe('what the node was set to reaches the brief', () => {
  it('carries the visual preset', async () => {
    const brief = await briefFor({ visualPreset: 'smartphonePOV' });
    expect(brief).toContain('shot on their own phone');
    expect(brief).toContain('SHOT AS UGC');
  });

  it('carries the camera coverage', async () => {
    const brief = await briefFor({ cameraProgression: 'propped' });
    expect(brief).toContain('Phone on a Surface (UGC)');
    expect(brief).toContain('PROPPED PHONE');
    expect(brief).not.toContain('Director Coverage');
  });

  it('carries the audio mode, including turning sound off', async () => {
    const spoken = await briefFor({ audioMode: 'dialogue' });
    expect(spoken).toContain('Dialogue & Voice');

    sent.length = 0;
    const silent = await briefFor({ audioMode: 'none' });
    expect(silent).not.toContain('AUDIO & SOUND DESIGN');
  });

  it('carries timed beats', async () => {
    const brief = await briefFor({ timedBeats: true });
    expect(brief).toMatch(/\[00:00-00:02\]/);
  });

  it('carries what must not appear', async () => {
    const brief = await briefFor({ avoid: 'traffic, other people' });
    expect(brief).toContain('MUST NOT APPEAR');
    expect(brief).toContain('traffic, other people');
  });

  it('still carries the six that always did', async () => {
    const brief = await briefFor({
      world: 'a small sunlit bathroom',
      look: 'warm and plain',
      structure: 'transform',
      rules: ['samePerson'],
      cast: [{ name: 'Maya', look: 'late 20s, beige ribbed tank' }],
    });
    expect(brief).toContain('a small sunlit bathroom');
    expect(brief).toContain('warm and plain');
    expect(brief).toContain('Before → Process → Reveal');
    expect(brief).toContain('The same person appears in every shot');
    expect(brief).toContain('Maya');
  });
});

describe('one reader for a Story node, used by both readers', () => {
  it('keeps every field a node can hold', () => {
    const s = readStorySettings({
      cast: [{ name: 'Maya', look: 'tank top' }],
      world: 'a bathroom',
      look: 'plain',
      structure: 'ugcAd',
      beats: 5,
      rules: ['samePerson'],
      cameraProgression: 'propped',
      audioMode: 'dialogue',
      visualPreset: 'smartphonePOV',
      timedBeats: true,
      avoid: 'traffic',
    });
    expect(s).toEqual({
      cast: [{ name: 'Maya', look: 'tank top' }],
      world: 'a bathroom',
      look: 'plain',
      structure: 'ugcAd',
      beats: 5,
      rules: ['samePerson'],
      cameraProgression: 'propped',
      audioMode: 'dialogue',
      visualPreset: 'smartphonePOV',
      timedBeats: true,
      avoid: 'traffic',
    });
  });

  it('falls back to the defaults for a node that has never been touched', () => {
    const s = readStorySettings({});
    expect(s.structure).toBe(DEFAULT_STORY.structure);
    expect(s.cameraProgression).toBe(DEFAULT_STORY.cameraProgression);
    expect(s.audioMode).toBe(DEFAULT_STORY.audioMode);
    expect(s.visualPreset).toBe(DEFAULT_STORY.visualPreset);
    expect(s.cast).toEqual([]);
    expect(s.rules).toEqual([]);
    expect(s.timedBeats).toBe(false);
    expect(s.avoid).toBe('');
  });

  it('survives the shapes a stored node actually arrives in', () => {
    /* Node data comes off disk and out of a template, so a field can be the
       wrong type or missing entirely without anything having gone wrong. */
    const s = readStorySettings({ cast: 'not an array', rules: null, beats: 'seven' });
    expect(s.cast).toEqual([]);
    expect(s.rules).toEqual([]);
    expect(s.beats).toBe(0);
  });

  it('reads undefined node data without throwing', () => {
    expect(() => readStorySettings(undefined)).not.toThrow();
    expect(readStorySettings(undefined).structure).toBe(DEFAULT_STORY.structure);
  });
});
