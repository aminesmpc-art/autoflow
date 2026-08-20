/**
 * A reply that arrives while the canvas port is down.
 *
 * The bug, in full: an adapter finished, logged "Reply captured (7446 chars)",
 * and sent STUDIO_NODE_RESULT. The worker's replyToStudio was
 *
 *     if (studioPort) { try { studioPort.postMessage(msg); } catch {} }
 *
 * with no else. When the port happened to be down the finished answer was
 * discarded — no buffer, no retry, no log. The runner, blocked in awaitBridge
 * waiting for exactly that message, then sat out its full sixteen-minute
 * backstop still showing "Writing 4 prompts…" while the completed JSON sat
 * visible in the chat tab.
 *
 * The port goes down as a matter of routine: MV3 recycles the worker, the port
 * dies with it, the canvas reconnects two seconds later. Anything that landed
 * inside that gap was gone permanently, which is why it struck at random and
 * why it was always the long Story nodes.
 *
 * These tests drive the real service worker — its own onConnect and onMessage
 * listeners, not a description of them — because the whole nature of this bug
 * was that dropping a reply had no observable consequence. A test that only
 * reads the source for a keyword could not have failed on the old code either.
 */

/// <reference types="node" />

type Listener = (...args: any[]) => any;

const listeners: Record<string, Listener[]> = {};
const capture = (name: string) => ({
  addListener: (fn: Listener) => {
    (listeners[name] ||= []).push(fn);
  },
});

/** Stands in for chrome.storage.session, which survives a worker restart. */
let sessionStore: Record<string, any> = {};

function installChrome() {
  for (const k of Object.keys(listeners)) delete listeners[k];
  sessionStore = {};

  (global as any).chrome = {
    runtime: {
      onConnect: capture('connect'),
      onMessage: capture('message'),
      onInstalled: capture('installed'),
      sendMessage: jest.fn(() => Promise.resolve()),
      getManifest: () => ({ version: '0.27.0' }),
      getPlatformInfo: () => Promise.resolve({}),
      getURL: (path: string) => `chrome-extension://test/${path}`,
    },
    storage: {
      session: {
        get: jest.fn((key: string) => Promise.resolve({ [key]: sessionStore[key] })),
        set: jest.fn((items: Record<string, any>) => {
          // Structured-clone, as the real one does — otherwise the test would
          // share the worker's live array and prove nothing about persistence.
          Object.assign(sessionStore, JSON.parse(JSON.stringify(items)));
          return Promise.resolve();
        }),
      },
      local: {
        get: jest.fn(() => Promise.resolve({})),
        set: jest.fn(() => Promise.resolve()),
      },
    },
    alarms: {
      onAlarm: capture('alarm'),
      create: jest.fn(),
      clear: jest.fn(() => Promise.resolve()),
    },
    tabs: {
      update: jest.fn(() => Promise.resolve()),
      get: jest.fn(() => Promise.resolve({ url: '' })),
      query: jest.fn(() => Promise.resolve([])),
    },
    action: { onClicked: capture('action') },
    sidePanel: { setPanelBehavior: jest.fn(() => Promise.resolve()) },
    scripting: { executeScript: jest.fn(() => Promise.resolve([{ result: null }])) },
  };
}

/** A canvas port, with everything it posted and a way to kill it. */
function fakePort() {
  const posted: any[] = [];
  const disconnectHandlers: Listener[] = [];
  const port: any = {
    name: 'studio',
    posted,
    postMessage: jest.fn((m: any) => { posted.push(m); }),
    onMessage: { addListener: jest.fn() },
    onDisconnect: { addListener: (fn: Listener) => disconnectHandlers.push(fn) },
    die: () => disconnectHandlers.forEach((fn) => fn()),
  };
  return port;
}

const connect = (port: any) => listeners.connect.forEach((fn) => fn(port));

/** A message from a content script, i.e. one carrying a sender.tab. */
const fromTab = (msg: any) =>
  listeners.message.forEach((fn) => fn(msg, { tab: { id: 7 } }, () => {}));

const RESULT = {
  type: 'STUDIO_NODE_RESULT',
  payload: { nodeId: 'story-1', tileId: '', text: '{"shots":[…]}' },
};

function loadWorker() {
  jest.resetModules();
  installChrome();
  require('../background/service-worker');
}

beforeEach(loadWorker);

describe('the port is up', () => {
  it('delivers straight through, holding nothing', async () => {
    const port = fakePort();
    connect(port);
    fromTab(RESULT);
    await Promise.resolve();

    expect(port.posted).toContainEqual(RESULT);
    expect(sessionStore.studio_parked_replies || []).toHaveLength(0);
  });
});

describe('the port is down when the reply lands', () => {
  it('holds the reply instead of dropping it', async () => {
    const port = fakePort();
    connect(port);
    port.die();

    fromTab(RESULT);
    await Promise.resolve();

    expect(sessionStore.studio_parked_replies).toEqual([RESULT]);
  });

  it('delivers it the moment the canvas comes back', async () => {
    const first = fakePort();
    connect(first);
    first.die();

    fromTab(RESULT);          // the answer arrives with nowhere to go
    await Promise.resolve();

    const second = fakePort(); // …and two seconds later the bridge reconnects
    connect(second);
    await Promise.resolve();

    expect(second.posted).toContainEqual(RESULT);
  });

  it('holds an error too, because a lost error hangs the node just as long', async () => {
    const port = fakePort();
    connect(port);
    port.die();

    const failure = {
      type: 'STUDIO_NODE_ERROR',
      payload: { nodeId: 'story-1', error: 'Gemini did not finish answering in time' },
    };
    fromTab(failure);
    await Promise.resolve();

    const back = fakePort();
    connect(back);
    await Promise.resolve();

    expect(back.posted).toContainEqual(failure);
  });

  it('says so in the diagnostics, so the drop is never silent again', async () => {
    const port = fakePort();
    connect(port);
    port.die();

    fromTab(RESULT);
    await Promise.resolve();

    const pushes = (chrome.runtime.sendMessage as jest.Mock).mock.calls
      .map(([m]) => m)
      .filter((m: any) => m?.type === 'PANEL_LOG_PUSH');
    expect(pushes.some((m: any) => /held a reply for node story-1/.test(m.payload.line))).toBe(true);
  });

  it('does not hold progress ticks — a replayed one tells nobody anything', async () => {
    const port = fakePort();
    connect(port);
    port.die();

    fromTab({ type: 'STUDIO_NODE_PROGRESS', payload: { nodeId: 'story-1', progress: 40 } });
    await Promise.resolve();

    expect(sessionStore.studio_parked_replies || []).toHaveLength(0);
  });
});

describe('the worker was recycled, not just the port', () => {
  it('recovers a reply held by the worker that died', async () => {
    /* The case in-memory state cannot cover, and the reason this is kept in
       session storage: the adapter's message wakes a brand-new worker, which
       has no port and no memory of the run. */
    const port = fakePort();
    connect(port);
    port.die();
    fromTab(RESULT);
    await Promise.resolve();

    const carried = sessionStore;         // survives the restart
    loadWorker();                          // …everything else does not
    sessionStore = carried;

    const afterRestart = fakePort();
    connect(afterRestart);
    await Promise.resolve();
    await Promise.resolve();

    expect(afterRestart.posted).toContainEqual(RESULT);
  });
});

describe('delivering twice is safe', () => {
  it('empties the hold once flushed, so a later reconnect replays nothing', async () => {
    const first = fakePort();
    connect(first);
    first.die();
    fromTab(RESULT);
    await Promise.resolve();

    const second = fakePort();
    connect(second);
    await Promise.resolve();
    expect(second.posted).toContainEqual(RESULT);

    const third = fakePort();
    connect(third);
    await Promise.resolve();
    await Promise.resolve();
    expect(third.posted).toHaveLength(0);
  });
});
