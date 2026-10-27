/// <reference types="node" />

/** Exercises Motion's real protection binding through the shared worker's port
 * and alarm handlers. Provider messages are faked; nothing is generated. */
type Listener = (...args: any[]) => any;
type TabState = chrome.tabs.Tab & { frozen?: boolean };
const listeners: Record<string, Listener[]> = {};
const calls: Record<string, any[][]> = {};
let session: Record<string, any>;
let local: Record<string, any>;
let tabs: Map<number, TabState>;
let alarms: Map<string, any>;

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const capture = (name: string) => ({
  addListener: (listener: Listener) => { (listeners[name] ||= []).push(listener); },
});
const spy = (name: string, implementation?: Listener) => (...args: any[]) => {
  (calls[name] ||= []).push(args);
  return implementation ? implementation(...args) : Promise.resolve();
};
const readStorage = (data: Record<string, any>, keys: any) => Promise.resolve(clone(
  typeof keys === 'string' ? (keys in data ? { [keys]: data[keys] } : {})
    : Array.isArray(keys) ? Object.fromEntries(keys.filter(key => key in data).map(key => [key, data[key]]))
      : data,
));
const storage = (data: Record<string, any>) => ({
  get: (keys: any) => readStorage(data, keys),
  set: async (value: any) => { Object.assign(data, clone(value)); },
});

function install() {
  for (const key of Object.keys(listeners)) delete listeners[key];
  for (const key of Object.keys(calls)) delete calls[key];
  (globalThis as any).chrome = {
    runtime: {
      onConnect: capture('connect'), onMessage: capture('message'), onInstalled: capture('installed'),
      sendMessage: spy('runtime.sendMessage'), getPlatformInfo: spy('runtime.getPlatformInfo'),
      getManifest: () => ({ version: '0.1.13' }),
      getURL: (path: string) => 'chrome-extension://motion-test/' + path,
    },
    storage: { session: storage(session), local: storage(local) },
    alarms: {
      onAlarm: capture('alarm'),
      create: spy('alarms.create', async (name: string, info: any) => { alarms.set(name, info); }),
      clear: spy('alarms.clear', async (name: string) => alarms.delete(name)),
    },
    tabs: {
      onRemoved: capture('tabRemoved'), onUpdated: capture('tabUpdated'), onReplaced: capture('tabReplaced'),
      get: spy('tabs.get', async (id: number) => {
        const tab = tabs.get(id);
        if (!tab) throw new Error('No tab with id');
        return { ...tab };
      }),
      update: spy('tabs.update', async (id: number, change: any) => {
        const tab = tabs.get(id);
        if (!tab) throw new Error('No tab with id');
        Object.assign(tab, change);
        return { ...tab };
      }),
      query: spy('tabs.query', async (query: any) => {
        const patterns = query.url ? (Array.isArray(query.url) ? query.url : [query.url]) : [];
        return [...tabs.values()].filter(tab => !patterns.length
          || patterns.some((pattern: string) => tab.url?.startsWith(pattern.replace('*', ''))))
          .map(tab => ({ ...tab }));
      }),
      create: spy('tabs.create', async () => { throw new Error('No new tab is needed in this fixture'); }),
      sendMessage: spy('tabs.sendMessage', async (_id: number, message: any) =>
        message.type === 'PING' ? { pong: true } : { type: 'STUDIO_ACK' }),
    },
    windows: { update: spy('windows.update') },
    scripting: { executeScript: spy('scripting.executeScript', async () => [{}]) },
    action: { onClicked: capture('action') },
    sidePanel: { setPanelBehavior: async () => undefined },
  };
}

function loadWorker(motion = true) {
  jest.resetModules();
  install();
  const worker = require('../../studio-extension/src/background/service-worker');
  if (motion) {
    const { ProviderKeepalive } = require('../src/providerKeepalive');
    worker.bindProviderKeepalive(new ProviderKeepalive());
  }
}

function connect() {
  const port: any = {
    name: 'studio', posted: [] as any[],
    postMessage: (message: any) => port.posted.push(message),
    onMessage: { addListener: (listener: Listener) => { port.handler = listener; } },
    onDisconnect: { addListener: (listener: Listener) => { port.disconnect = listener; } },
  };
  listeners.connect.forEach(listener => listener(port));
  return port;
}

/** Event handlers intentionally launch cleanup/recovery without blocking the
 * port. Drain only the microtasks; all fixture APIs complete immediately. */
async function settle() {
  for (let index = 0; index < 60; index++) await Promise.resolve();
}
async function execute(port: any, platform: 'gemini' | 'flow') {
  await port.handler({ type: 'STUDIO_EXECUTE_NODE', payload: { nodeId: platform, config: { platform } } });
  await settle();
}
async function state(port: any, running: boolean) {
  await port.handler({ type: 'STUDIO_RUN_STATE', payload: { running } });
  await settle();
}
async function tick() {
  listeners.alarm.forEach(listener => listener({ name: 'studio-tab-ping' }));
  await settle();
}
const request = (message: any) => new Promise<any>(resolve => {
  listeners.message.forEach(listener => listener(message, {}, resolve));
});
const messages = () => (calls['tabs.sendMessage'] || []).map(([id, message]) => ({ id, message }));
const raised = () => (calls['tabs.update'] || []).filter(([, change]) => change.active === true);
const latestState = () => {
  const states = (calls['runtime.sendMessage'] || []).map(([message]) => message)
    .filter(message => message.type === 'PANEL_RUN_STATE');
  return states[states.length - 1]?.payload;
};

beforeEach(() => {
  session = {};
  local = { af_background_tabs: true, af_background_strict: true };
  tabs = new Map([
    [7, { id: 7, windowId: 3, active: false, status: 'complete', autoDiscardable: true,
      url: 'https://gemini.google.com/app/conversation' } as TabState],
    [8, { id: 8, windowId: 3, active: false, status: 'complete', autoDiscardable: false,
      url: 'https://flow.google.com/project/2797c6d7-bb3c-428d-bca2-e4bc771d3d7e' } as TabState],
  ]);
  alarms = new Map();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  loadWorker();
});
afterEach(() => jest.restoreAllMocks());

test('hidden Gemini and Flow both remain protected across handoffs, then restore their original settings', async () => {
  const port = connect();
  await state(port, true);
  await execute(port, 'gemini');
  await execute(port, 'flow');
  expect(tabs.get(7)?.autoDiscardable).toBe(false);
  expect(tabs.get(8)?.autoDiscardable).toBe(false);
  expect(raised()).toEqual([]);
  expect(calls['windows.update'] || []).toEqual([]);
  expect(alarms.has('studio-keepalive')).toBe(true);
  expect(alarms.get('studio-tab-ping').periodInMinutes).toBeGreaterThanOrEqual(0.5);

  await state(port, false);
  expect(tabs.get(7)?.autoDiscardable).toBe(true);
  expect(tabs.get(8)?.autoDiscardable).toBe(false);
  expect(session.af_motion_provider_keepalive).toEqual({ target: null, tabs: [] });
  expect(alarms.has('studio-keepalive')).toBe(false);
  expect(alarms.has('studio-tab-ping')).toBe(false);
});

test('worker recycling restores the latest target and alarms without resubmitting a generation', async () => {
  const initial = connect();
  await state(initial, true);
  await execute(initial, 'gemini');
  await execute(initial, 'flow');
  expect(messages().filter(({ message }) => message.type === 'STUDIO_EXECUTE_NODE')).toHaveLength(2);

  // Storage and provider tabs survive the worker; its JS globals and listeners
  // do not. Missing alarms must also be recreated on the live panel's state replay.
  alarms.clear();
  loadWorker();
  const resumed = connect();
  await state(resumed, true);
  expect(alarms.has('studio-keepalive')).toBe(true);
  expect(alarms.has('studio-tab-ping')).toBe(true);
  await tick();
  expect(messages().filter(({ message }) => message.type === 'PING').map(({ id }) => id)).toEqual([8]);
  expect(messages().filter(({ message }) => message.type === 'STUDIO_EXECUTE_NODE')).toEqual([]);
  expect(raised()).toEqual([]);

  await state(resumed, false);
  expect(tabs.get(7)?.autoDiscardable).toBe(true);
  expect(tabs.get(8)?.autoDiscardable).toBe(false);
});

test('a stale Gemini alarm lookup rejection cannot release the new Flow handoff', async () => {
  const port = connect();
  await state(port, true);
  await execute(port, 'gemini');
  const pending = deferred<TabState>();
  const get = chrome.tabs.get;
  chrome.tabs.get = jest.fn((id: number) => id === 7 ? pending.promise : get(id)) as any;
  await tick();
  await execute(port, 'flow');

  pending.reject(new Error('The old Gemini lookup failed after handoff'));
  await settle();
  expect(alarms.has('studio-tab-ping')).toBe(true);
  expect(alarms.has('studio-keepalive')).toBe(true);
  expect(tabs.get(7)?.autoDiscardable).toBe(false);
  expect(tabs.get(8)?.autoDiscardable).toBe(false);
  expect(session.af_motion_provider_keepalive.target).toEqual({ tabId: 8, platform: 'flow' });
});

test('a stale successful Gemini alarm lookup cannot ping, inject, or blame the new Flow target', async () => {
  const port = connect();
  await state(port, true);
  await execute(port, 'gemini');
  const pending = deferred<TabState>();
  const get = chrome.tabs.get;
  chrome.tabs.get = jest.fn((id: number) => id === 7 ? pending.promise : get(id)) as any;
  await tick();
  await execute(port, 'flow');
  for (const name of ['tabs.sendMessage', 'runtime.sendMessage', 'scripting.executeScript']) calls[name] = [];
  chrome.tabs.sendMessage = spy('tabs.sendMessage', async () => {
    throw new Error('The new Flow listener is temporarily unavailable');
  }) as any;

  pending.resolve({ ...tabs.get(7)! });
  await settle();
  expect(messages()).toEqual([]);
  expect(calls['scripting.executeScript']).toEqual([]);
  expect(latestState()?.needsAttention || '').toBe('');
  expect(alarms.has('studio-tab-ping')).toBe(true);
  expect(session.af_motion_provider_keepalive.target).toEqual({ tabId: 8, platform: 'flow' });
});

test('an upload-only resumed Motion run records the original Flow setting before the upload can change it', async () => {
  const port = connect();
  local.af_debug_upload = true;
  tabs.get(8)!.autoDiscardable = true;
  await state(port, true);
  const upload = jest.spyOn(require('../../studio-extension/src/background/debugUpload'), 'uploadToFlow')
    .mockImplementation(async () => {
      expect(tabs.get(8)?.autoDiscardable).toBe(false);
      expect(session.af_motion_provider_keepalive.tabs).toEqual([
        { tabId: 8, platform: 'flow', autoDiscardable: true },
      ]);
      return { ok: true, names: ['clip.mp4'], confirmed: true };
    });

  expect(await request({ type: 'DEBUG_UPLOAD_TO_FLOW', files: [{ filename: 'clip.mp4', dataUrl: 'data:video/mp4;base64,AA==' }] }))
    .toMatchObject({ ok: true, tabId: 8 });
  expect(upload).toHaveBeenCalledTimes(1);
  expect(alarms.has('studio-tab-ping')).toBe(true);
  expect(messages().filter(({ message }) => message.type === 'STUDIO_EXECUTE_NODE')).toEqual([]);
  await state(port, false);
  expect(tabs.get(8)?.autoDiscardable).toBe(true);
  expect(session.af_motion_provider_keepalive).toEqual({ target: null, tabs: [] });
});

test('a utility upload outside a live Motion run does not arm run-scoped protection', async () => {
  connect();
  local.af_debug_upload = true;
  tabs.get(8)!.autoDiscardable = true;
  const upload = jest.spyOn(require('../../studio-extension/src/background/debugUpload'), 'uploadToFlow')
    .mockResolvedValue({ ok: true, names: ['clip.mp4'], confirmed: true });
  expect(await request({ type: 'DEBUG_UPLOAD_TO_FLOW', files: [{ filename: 'clip.mp4', dataUrl: 'data:video/mp4;base64,AA==' }] }))
    .toMatchObject({ ok: true, tabId: 8 });
  expect(upload).toHaveBeenCalledTimes(1);
  expect(session.af_motion_provider_keepalive).toBeUndefined();
  expect(alarms.size).toBe(0);
  expect(tabs.get(8)?.autoDiscardable).toBe(true);
});

test.each(['stopped', 'disconnected'] as const)('a pending provider lookup cannot execute after its Motion run is %s', async ending => {
  const port = connect();
  tabs.get(8)!.autoDiscardable = true;
  await state(port, true);
  const pending = deferred<TabState[]>();
  chrome.tabs.query = jest.fn(() => pending.promise) as any;
  const executing = port.handler({ type: 'STUDIO_EXECUTE_NODE', payload: { nodeId: 'flow', config: { platform: 'flow' } } });
  await settle();
  if (ending === 'stopped') await state(port, false);
  else { port.disconnect(); await settle(); }

  pending.resolve([{ ...tabs.get(8)! }]);
  await executing;
  await settle();
  expect(messages()).toEqual([]);
  expect(alarms.size).toBe(0);
  expect(tabs.get(8)?.autoDiscardable).toBe(true);
  expect(session.af_motion_provider_keepalive).toEqual({ target: null, tabs: [] });
});

test('a displaced Motion port cannot stop the new owner or execute provider work', async () => {
  const old = connect();
  await state(old, true);
  await execute(old, 'gemini');
  const current = connect();
  await state(current, true);
  await execute(current, 'flow');
  for (const name of ['tabs.sendMessage', 'tabs.update', 'tabs.query']) calls[name] = [];

  await state(old, false);
  await execute(old, 'gemini');
  expect(alarms.has('studio-tab-ping')).toBe(true);
  expect(latestState().running).toBe(true);
  expect(messages()).toEqual([]);
  expect(calls['tabs.query']).toEqual([]);
  expect(calls['tabs.update']).toEqual([]);
  expect(session.af_motion_provider_keepalive.target).toEqual({ tabId: 8, platform: 'flow' });
  expect(tabs.get(7)?.autoDiscardable).toBe(false);
  expect(tabs.get(8)?.autoDiscardable).toBe(false);
  await state(current, false);
  expect(tabs.get(7)?.autoDiscardable).toBe(true);
});

test.each(['frozen', 'discarded'] as const)('%s provider requires attention without reinjection or a retry', async condition => {
  const port = connect();
  await state(port, true);
  await execute(port, 'flow');
  tabs.get(8)![condition] = true;
  for (const name of ['tabs.sendMessage', 'tabs.update', 'scripting.executeScript']) calls[name] = [];
  await tick();
  expect(latestState().needsAttention).toContain(condition);
  expect(latestState().attentionTabId).toBe(8);
  expect(messages()).toEqual([]);
  expect(calls['scripting.executeScript']).toEqual([]);
  expect(calls['tabs.update']).toEqual([]);

  tabs.get(8)![condition] = false;
  await tick();
  expect(latestState().needsAttention).toBe('');
  expect(latestState().attentionTabId).toBeNull();
  expect(messages().filter(({ message }) => message.type === 'STUDIO_EXECUTE_NODE')).toEqual([]);
});

test('the unbound Studio worker retains its existing foreground and release behavior', async () => {
  local = {};
  tabs.get(8)!.autoDiscardable = true;
  loadWorker(false);
  const port = connect();
  await state(port, true);
  await execute(port, 'flow');
  expect(raised().map(([id]) => id)).toEqual([8]);
  expect(tabs.get(8)?.autoDiscardable).toBe(false);
  await state(port, false);
  expect(tabs.get(8)?.autoDiscardable).toBe(true);
  expect(session.af_motion_provider_keepalive).toBeUndefined();
});

test.each(['stopped', 'disconnected'] as const)('original follow mode raises each step and only the current target until %s', async ending => {
  local.af_background_tabs = false;
  local.af_background_strict = false;
  const port = connect();
  await state(port, true);
  await execute(port, 'gemini');
  calls['tabs.update'] = []; calls['windows.update'] = [];
  tabs.get(7)!.active = false;
  await execute(port, 'gemini');
  expect(raised().map(([id]) => id)).toContain(7);
  expect(calls['windows.update']).toContainEqual([3, { focused: true }]);

  calls['tabs.update'] = []; calls['windows.update'] = [];
  tabs.get(7)!.active = false;
  const submissions = messages().filter(({ message }) => message.type === 'STUDIO_EXECUTE_NODE').length;
  await tick();
  expect(raised().map(([id]) => id)).toEqual([7]);
  expect(calls['windows.update']).toContainEqual([3, { focused: true }]);
  expect(messages().filter(({ message }) => message.type === 'STUDIO_EXECUTE_NODE')).toHaveLength(submissions);

  await execute(port, 'flow');
  calls['tabs.update'] = []; calls['windows.update'] = [];
  tabs.get(8)!.active = false;
  await tick();
  expect(raised().map(([id]) => id)).toEqual([8]);

  if (ending === 'stopped') await state(port, false);
  else { port.disconnect(); await settle(); }
  calls['tabs.update'] = []; calls['windows.update'] = [];
  await tick();
  expect(raised()).toEqual([]);
  expect(calls['windows.update']).toEqual([]);
});
