/**
 * @jest-environment jsdom
 */

/// <reference types="node" />

/**
 * "The director stopped at piece 1 of 2: Engine stalled at IDLE for 132s
 *  without submitting. Check the Flow tab."
 *
 * 2026-10-01. A Flow error inside a Gemini step: the director's question had
 * gone to Gemini — the worker routes by platform — and the error came from
 * the Flow tab, where a watcher from an EARLIER run of the same Motion node
 * was still waiting. Stop had stopped the Flow engine and not its watcher, so
 * the watcher sat on an engine back at IDLE and, past its limit, reported a
 * stall. Replies are matched on the node, so the next run's director — waiting
 * on that same node — took it as its own answer. The tab was in the
 * background, which is only why the 90-second limit read 132.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

jest.mock('../studio/engine/bridge', () => {
  const handlers = new Map<string, Array<(payload: any) => void>>();
  return {
    bridge: {
      on: (type: string, fn: (payload: any) => void) => { handlers.set(type, [...(handlers.get(type) || []), fn]); },
      off: (type: string, fn: (payload: any) => void) => {
        handlers.set(type, (handlers.get(type) || []).filter((h) => h !== fn));
      },
      executeNode: jest.fn(() => true),
      emit: (type: string, payload: any) => { for (const fn of [...(handlers.get(type) || [])]) fn(payload); },
    },
  };
});

import { runner } from '../studio/engine/WorkflowRunner';

const { bridge } = jest.requireMock('../studio/engine/bridge');
const wait = (node = 'motion'): Promise<any> =>
  (runner as any).awaitBridge(node, { platform: 'gemini', prompt: 'The brief.' }, 60_000, 'a minute');
const sentId = (): string => bridge.executeNode.mock.calls[bridge.executeNode.mock.calls.length - 1][1].execId;

beforeEach(() => bridge.executeNode.mockClear());

describe('a wait hears its own run only', () => {
  it('ignores a late error from an earlier run of the same node', async () => {
    const asked = wait();
    bridge.emit('STUDIO_NODE_ERROR', {
      nodeId: 'motion', execId: 'motion#earlier-1',
      error: 'Engine stalled at IDLE for 132s without submitting. Check the Flow tab.',
    });
    bridge.emit('STUDIO_NODE_RESULT', { nodeId: 'motion', execId: sentId(), text: 'READY' });
    await expect(asked).resolves.toMatchObject({ text: 'READY' });
  });

  it('and a late result from one', async () => {
    const asked = wait();
    bridge.emit('STUDIO_NODE_RESULT', { nodeId: 'motion', execId: 'motion#earlier-1', imageUrl: 'https://flow/old.mp4' });
    bridge.emit('STUDIO_NODE_RESULT', { nodeId: 'motion', execId: sentId(), text: 'READY' });
    await expect(asked).resolves.toMatchObject({ text: 'READY' });
  });

  it('still fails on its own error', async () => {
    const asked = wait();
    bridge.emit('STUDIO_NODE_ERROR', { nodeId: 'motion', execId: sentId(), error: 'Flow: refused' });
    await expect(asked).rejects.toThrow('Flow: refused');
  });

  it('hears an adapter that echoes no id exactly as before', async () => {
    /* Every chat site, and any Flow tab still running an older script. */
    const asked = wait();
    bridge.emit('STUDIO_NODE_RESULT', { nodeId: 'motion', text: 'READY' });
    await expect(asked).resolves.toMatchObject({ text: 'READY' });
  });

  it('gives every wait its own id, sent with the request', async () => {
    const first = wait();
    const one = sentId();
    const second = wait('other');
    const two = sentId();
    expect(one).toMatch(/^motion#/);
    expect(two).not.toBe(one);
    bridge.emit('STUDIO_NODE_RESULT', { nodeId: 'motion', execId: one, text: 'a' });
    bridge.emit('STUDIO_NODE_RESULT', { nodeId: 'other', execId: two, text: 'b' });
    await expect(first).resolves.toMatchObject({ text: 'a' });
    await expect(second).resolves.toMatchObject({ text: 'b' });
  });
});

describe('the Flow tab retires a watcher whose run is over', () => {
  const FLOW = readFileSync(join(__dirname, '..', 'content', 'flow', 'index.ts'), 'utf8');
  const poller = FLOW.slice(FLOW.indexOf('async function pollStudioCompletion('));
  const executor = FLOW.slice(FLOW.indexOf('async function handleStudioExecuteNode('), FLOW.indexOf('async function pollStudioCompletion('));

  it('on Stop, not only the engine', () => {
    const stop = FLOW.slice(FLOW.indexOf("case 'STUDIO_STOP' as any:"), FLOW.indexOf("case 'STUDIO_PAUSE' as any:"));
    expect(stop.indexOf('executions.clear();')).toBeGreaterThan(-1);
    expect(stop.indexOf('executions.clear();')).toBeLessThan(stop.indexOf('if (engine) engine.stop();'));
  });

  it('when its node is run again', () => {
    expect(executor).toMatch(/const run: StudioExecution = \{ execId: typeof config\.execId === 'string' \? config\.execId : undefined \};\s*executions\.set\(nodeId, run\);/);
    expect(executor).toMatch(/pollStudioCompletion\(nodeId, queue, run\)/);
  });

  it('checks on every turn of both of its waits', () => {
    expect(poller).toMatch(/await sleep\(500\);\s*if \(retired\(\)\) return;/);
    expect(poller).toMatch(/await sleep\(1000\);\s*if \(retired\(\)\) return;/);
  });

  it('says nothing once retired, and stamps everything it says with its run', () => {
    expect(poller).toMatch(/const sendStudioError = \(id: string, error: string\): void => \{\s*if \(isCurrentRun\(id, run\)\) postStudioError\(id, error, run\.execId\);/);
    expect(poller).toMatch(/const sendStudioProgress = \(id: string, progress: number\): void => \{\s*if \(isCurrentRun\(id, run\)\) postStudioProgress\(id, progress, run\.execId\);/);
    expect(poller).toMatch(/await postStudioResult\(id, tileId, mediaUrl, previewSrc, tile, promptText, mediaId, expectVideo, run\.execId\);/);
    expect(FLOW).toMatch(/payload: \{ nodeId, error, \.\.\.\(execId \? \{ execId \} : \{\}\) \}/);
    expect(FLOW).toMatch(/type: 'STUDIO_NODE_RESULT',\s*payload: \{\s*nodeId,\s*\.\.\.\(execId \? \{ execId \} : \{\}\),/);
  });
});
