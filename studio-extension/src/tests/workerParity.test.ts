/**
 * The worker runs a node the way the canvas does.
 *
 * Since v1.5.0 every ordinary run is handed to the service worker
 * (RunCoordinator), which builds each node's settings in its own copy of the
 * canvas runner's logic. The copy had drifted, and every difference was
 * silent — the run "worked" and produced the wrong thing:
 *
 *   - a node switched off (SKIPPED) was run anyway, and charged;
 *   - a Grok Extend went to Flow as an image, because its settings carry no
 *     platform and nothing passed it the clip to continue;
 *   - a clip with no ratio, model or length set was made at 1:1 on a model
 *     named "default", while the node showed 9:16 and Omni;
 *   - a clip with no prompt was submitted, and Flow charged for it;
 *   - retrying one shot of a Director's set sent it every shot, labelled;
 *   - a clip whose upstream gave up nothing was generated anyway, with no
 *     continuity, where the canvas stops and names the broken link;
 *   - a result with no tile id was given the canvas node id instead, the one
 *     thing the tile lane must never hold.
 *
 * Driven through the real class with a fake platform tab, because what
 * matters is what reaches the tab, not which line builds it.
 */

/// <reference types="node" />

jest.mock('../shared/api', () => ({
  trackUsage: jest.fn(async () => {}), trackSubmission: jest.fn(async () => {}),
}));
jest.mock('../shared/runJournal', () => ({
  beginRun: jest.fn(async () => {}), finishRun: jest.fn(async () => {}), cancelRun: jest.fn(async () => {}),
  isRunCancelled: jest.fn(async () => false), beginAttempt: jest.fn(async () => {}),
  recordSubmitted: jest.fn(async () => {}), settleAttempt: jest.fn(async () => {}),
  recoverable: jest.fn(async () => []),
}));
jest.mock('../background/coordinatorState', () => ({
  saveSnapshot: jest.fn(async () => {}), loadSnapshot: jest.fn(async () => null), clearSnapshot: jest.fn(async () => {}),
}));

import { RunCoordinator } from '../background/runCoordinator';
import type { SerializedNode, SerializedEdge } from '../shared/executionTypes';

const node = (id: string, type: string, data: Record<string, unknown> = {}, x = 0): SerializedNode =>
  ({ id, type, data: { type, ...data }, position: { x, y: 0 } } as SerializedNode);
const edge = (source: string, target: string, targetHandle: string, sourceHandle?: string): SerializedEdge =>
  ({ id: `${source}->${target}:${targetHandle}`, source, target, targetHandle, sourceHandle } as SerializedEdge);

interface Sent { nodeId: string; config: any }

/** Run a manifest with a tab that answers every node with `answer(nodeId)`. */
async function run(
  nodes: SerializedNode[], edges: SerializedEdge[],
  answer: (nodeId: string, config: any) => Record<string, unknown> = () => ({ tileId: 'T1' }),
  only?: string[],
) {
  const c = new RunCoordinator();
  const sent: Sent[] = [];
  const statuses: any[] = [];
  c.bind({
    async executeOnPlatform(nodeId, config) {
      sent.push({ nodeId, config });
      setTimeout(() => c.handleNodeResult({ nodeId, ...answer(nodeId, config) }), 0);
      return true;
    },
    sendControl() {},
    broadcast(m: any) { if (m.type === 'SW_NODE_STATUS') statuses.push(m.payload); },
    notify() {},
  });
  await c.start({ runId: 'r', workflowId: 'w', nodes, edges, options: {}, startedAt: 0 } as any,
    only ? { only } : {});
  const last = (id: string) => [...statuses].reverse().find((s) => s.nodeId === id);
  return { sent, last };
}

const prompt = (id: string, text: string) => node(id, 'prompt', { text });

describe('a node switched off', () => {
  it('is not sent, and nothing after it is charged for it', async () => {
    const { sent } = await run(
      [prompt('p', 'a cat'), node('g', 'generate', { platform: 'flow', mediaType: 'video', enabled: false })],
      [edge('p', 'g', 'text')],
    );
    expect(sent).toEqual([]);
  });
});

describe('a clip with nothing chosen', () => {
  it('is made the way the node shows it: 9:16, Omni, 6s, 720p', async () => {
    const { sent } = await run(
      [prompt('p', 'a cat'), node('g', 'generate', { platform: 'flow', mediaType: 'video' })],
      [edge('p', 'g', 'text')],
    );
    expect(sent[0].config).toEqual(expect.objectContaining({
      aspectRatio: '9:16', model: 'Omni 1.1 Flash', duration: '6s', renderResolution: '720p',
    }));
  });

  it('is an image on the canvas runner\'s image model when it is a still', async () => {
    const { sent } = await run(
      [prompt('p', 'a cat'), node('g', 'generate', { platform: 'flow', mediaType: 'image' })],
      [edge('p', 'g', 'text')],
    );
    expect(sent[0].config).toEqual(expect.objectContaining({ model: 'Nano Banana Pro', aspectRatio: '9:16' }));
  });
});

describe('a clip with no prompt', () => {
  it('is refused before anything is sent', async () => {
    const { sent, last } = await run([node('g', 'generate', { platform: 'flow', mediaType: 'video' })], []);
    expect(sent).toEqual([]);
    expect(last('g')).toEqual(expect.objectContaining({ status: 'error' }));
    expect(last('g').errorMessage).toMatch(/No prompt connected/);
  });

  it('is refused when the wired prompt is empty', async () => {
    const { sent, last } = await run(
      [prompt('p', '   '), node('g', 'generate', { platform: 'flow', mediaType: 'video' })],
      [edge('p', 'g', 'text')],
    );
    expect(sent).toEqual([]);
    expect(last('g').errorMessage).toMatch(/prompt node is empty/i);
  });

  it('ignores a prompt field the node never shows', async () => {
    /* The MCP builder writes placeholders like this onto clip nodes. The
       canvas never sends them, and the node says "Connect a prompt". */
    const { sent } = await run(
      [prompt('p', 'a cat'), node('g', 'generate', { platform: 'flow', mediaType: 'video',
        prompt: 'Shot 1 cinematic visual sequence.' })],
      [edge('p', 'g', 'text')],
    );
    expect(sent[0].config.prompt).toBe('a cat');
  });
});

describe('a Grok Extend', () => {
  const grokClip = node('clip', 'generate', { platform: 'grok', mediaType: 'video' });
  const ext = node('ext', 'extend', { extendSeconds: '+10s' });
  const nodes = [prompt('p', 'she walks on'), grokClip, prompt('p2', 'and keeps walking'), ext];
  const edges = [edge('p', 'clip', 'text'), edge('clip', 'ext', 'video', 'result'), edge('p2', 'ext', 'text')];
  const GROK_MP4 = 'https://assets.grok.com/users/u/generated/abc/generated_video.mp4';

  it('goes to Grok as an extension of the clip before it', async () => {
    const { sent } = await run(nodes, edges, (id) => (id === 'clip' ? { tileId: '', videoUrl: GROK_MP4 } : { tileId: '' }));
    const out = sent.find((s) => s.nodeId === 'ext')!.config;
    expect(out).toEqual(expect.objectContaining({
      platform: 'grok', mediaType: 'video', extend: true, extendSeconds: '+10s', extendFromVideo: GROK_MP4,
    }));
  });

  it('is refused, not sent to Flow, when there is no Grok clip to continue', async () => {
    const { sent, last } = await run(nodes, edges, () => ({ tileId: '' }));
    expect(sent.map((s) => s.nodeId)).toEqual(['clip']);
    expect(last('ext').errorMessage).toMatch(/Extend has no clip to continue/);
  });
});

describe('retrying one shot of a Director\'s set', () => {
  /* Done in an earlier pass: the Director holds the set, each shot in its
     targets' order. The retry runs on the worker — no canvas-only node is in
     the retried set — and adopts the Director's result off the canvas. */
  const director = node('dir', 'story', {
    status: 'done',
    resultText: 'Shot A\nfirst prompt\n\nShot B\nsecond prompt',
    shotPrompts: ['first prompt', 'second prompt'],
    shotPromptsByTarget: { a: 'first prompt', b: 'second prompt' },
  });
  const a = node('a', 'generate', { platform: 'flow', mediaType: 'video', status: 'done', resultUrl: 'https://flow.google.com/asb/X' }, 0);
  const b = node('b', 'generate', { platform: 'flow', mediaType: 'video' }, 400);
  const edges = [edge('dir', 'a', 'text', 'text'), edge('dir', 'b', 'text', 'text')];

  it('sends that shot\'s prompt, not the whole set', async () => {
    const { sent } = await run([director, a, b], edges, undefined, ['b']);
    expect(sent.map((s) => s.nodeId)).toEqual(['b']);
    expect(sent[0].config.prompt).toBe('second prompt');
  });

  it('finds it by position when the set predates the by-target map', async () => {
    const old = node('dir', 'story', { ...director.data, shotPromptsByTarget: undefined });
    const { sent } = await run([old, a, b], edges, undefined, ['b']);
    expect(sent[0].config.prompt).toBe('second prompt');
  });
});

describe('a broken link in a chain', () => {
  it('stops the clip rather than generate it with no continuity', async () => {
    const first = node('one', 'generate', { platform: 'flow', mediaType: 'video' });
    const second = node('two', 'generate', { platform: 'flow', mediaType: 'video' });
    const { sent, last } = await run(
      [prompt('p', 'a'), first, prompt('p2', 'b'), second],
      [edge('p', 'one', 'text'), edge('p2', 'two', 'text'), edge('one', 'two', 'image_ref', 'result')],
      () => ({ tileId: '' }),               // the first clip came back with nothing to continue from
    );
    expect(sent.map((s) => s.nodeId)).toEqual(['one']);
    expect(last('two').errorMessage).toMatch(/Nothing to continue from/);
  });

  it('refuses Frames mode with no stills', async () => {
    // frameReferencesFor says it first, on both paths.
    const { sent, last } = await run(
      [prompt('p', 'a'), node('g', 'generate', { platform: 'flow', mediaType: 'video', creationType: 'frames' })],
      [edge('p', 'g', 'text')],
    );
    expect(sent).toEqual([]);
    expect(last('g').errorMessage).toMatch(/Frames mode needs a start frame/);
  });
});

describe('handing a node to the tab', () => {
  const nodes = [prompt('p', 'a cat'), node('g', 'generate', { platform: 'flow', mediaType: 'image' })];
  const edges = [edge('p', 'g', 'text')];

  /** A tab whose hand-off is supplied by the test. */
  async function runWith(executeOnPlatform: (c: RunCoordinator, nodeId: string) => Promise<boolean>) {
    const c = new RunCoordinator();
    const statuses: any[] = [];
    c.bind({
      executeOnPlatform: (nodeId) => executeOnPlatform(c, nodeId),
      sendControl() {}, notify() {},
      broadcast(m: any) { if (m.type === 'SW_NODE_STATUS') statuses.push(m.payload); },
    });
    const done = c.start({ runId: 'r', workflowId: 'w', nodes, edges, options: {}, startedAt: 0 } as any);
    const outcome = await Promise.race([done.then(() => 'settled'), new Promise((r) => setTimeout(() => r('hung'), 2000))]);
    return { outcome, last: [...statuses].reverse().find((s) => s.nodeId === 'g') };
  }

  it('hears an adapter that fails before it replies', async () => {
    /* A reference the adapter cannot fetch is reported, then the reply comes.
       Listening only after the reply, the report was dropped and the node hung
       for the sixteen-minute backstop. */
    const { outcome, last } = await runWith(async (c, nodeId) => {
      c.handleNodeError({ nodeId, error: 'Failed to resolve reference images' });
      return true;
    });
    expect(outcome).toBe('settled');
    expect(last.errorMessage).toBe('Failed to resolve reference images');
  });

  it('fails the node with the reason the hand-off gave', async () => {
    const { outcome, last } = await runWith(async () => {
      throw new Error('Google Flow tab not reachable after injecting: no listener. Reload that tab and run again.');
    });
    expect(outcome).toBe('settled');
    expect(last.errorMessage).toMatch(/not reachable after injecting.*Reload that tab/);
  });

  it('sends the worker\'s hand-off through the checked delivery, not a bare send', () => {
    /* Source-level: the bare unawaited sendMessage is the bug, and the fake
       tab above cannot see which one the service worker uses. */
    const SW = require('fs').readFileSync(require('path').join(__dirname, '..', 'background', 'service-worker.ts'), 'utf8');
    const at = SW.indexOf('async executeOnPlatform(');
    const body = SW.slice(at, SW.indexOf('\n  },', at));
    expect(body).toMatch(/await deliverToProvider\(tabId, platform, \{/);
    expect(body).not.toMatch(/\n\s+chrome\.tabs\.sendMessage\(/);
  });
});

describe('what the worker is not given', () => {
  /* An Ask AI node is a generate node in text mode. Wired to clips, the
     canvas asks it for a checked JSON set and hands each clip its own; the
     worker sent the bare prompt and gave every clip the whole reply. So a run
     holding one stays on the canvas, like a Director's. */
  const { needsCanvasNode } = require('../shared/executionTypes');

  it('keeps an Ask AI node, and anything Claude writes, on the canvas', () => {
    expect(needsCanvasNode(node('ask', 'generate', { platform: 'chatgpt', mediaType: 'text' }))).toBe(true);
    expect(needsCanvasNode(node('ask', 'generate', { platform: 'claude' }))).toBe(true);
    expect(needsCanvasNode(node('dir', 'story'))).toBe(true);
  });

  it('still hands the worker every clip, still and Extend', () => {
    for (const n of [
      node('g', 'generate', { platform: 'flow', mediaType: 'video' }),
      node('g', 'generate', { platform: 'chatgpt', mediaType: 'image' }),
      node('g', 'generate', { platform: 'grok', mediaType: 'video' }),
      node('e', 'extend'),
    ]) expect(needsCanvasNode(n)).toBe(false);
  });
});

describe('a result with no tile id', () => {
  it('keeps the tile lane empty rather than filling it with the canvas node id', async () => {
    const { last } = await run(
      [prompt('p', 'a'), node('g', 'generate', { platform: 'flow', mediaType: 'image' })],
      [edge('p', 'g', 'text')],
      () => ({ imageUrl: 'https://flow.google.com/asb/X' }),
    );
    expect(last('g').resultTileId).toBe('');
  });
});
