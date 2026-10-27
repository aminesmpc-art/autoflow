/**
 * Which Flow tab the worker uses.
 *
 * The upload and the generation each ask for a Flow tab, separately. "The
 * first tab that matched" could be a Flow homepage for one and a project for
 * the other — the pieces uploaded into one project's library while the
 * generation searched another's and found nothing. And the match is all of
 * labs.google, so it could be another Labs tool altogether.
 *
 * Same harness as tabKeepalive.test.ts: the real worker, Chrome mocked.
 */

/// <reference types="node" />

type Listener = (...args: any[]) => any;
const listeners: Record<string, Listener[]> = {};
const capture = (name: string) => ({ addListener: (fn: Listener) => { (listeners[name] ||= []).push(fn); } });
const calls: Record<string, any[][]> = {};
const spy = (name: string, impl?: (...a: any[]) => any) => (...args: any[]) => {
  (calls[name] ||= []).push(args);
  return impl ? impl(...args) : Promise.resolve();
};

const LAST_PROJECT = 'https://flow.google.com/project/last-one';
let openTabs: any[] = [];

function install() {
  for (const k of Object.keys(listeners)) delete listeners[k];
  for (const k of Object.keys(calls)) delete calls[k];
  let nextId = 100;
  (global as any).chrome = {
    runtime: {
      onConnect: capture('connect'), onMessage: capture('message'), onInstalled: capture('installed'),
      sendMessage: spy('runtime.sendMessage'), getManifest: () => ({ version: '0.27.0' }),
      getPlatformInfo: spy('getPlatformInfo'), getURL: (p: string) => 'chrome-extension://test/' + p,
    },
    storage: {
      session: { get: () => Promise.resolve({}), set: () => Promise.resolve() },
      local: { get: () => Promise.resolve({ af_debug_upload: true, af_last_flow_project: LAST_PROJECT }), set: () => Promise.resolve() },
    },
    alarms: { onAlarm: capture('alarm'), create: spy('alarms.create'), clear: spy('alarms.clear') },
    tabs: {
      query: () => Promise.resolve(openTabs),
      create: spy('tabs.create', (props: any) => {
        const tab = { id: nextId++, url: props.url, status: 'complete', active: false, windowId: 1 };
        openTabs.push(tab);
        return Promise.resolve(tab);
      }),
      get: (id: number) => Promise.resolve(openTabs.find((t) => t.id === id) || { id, status: 'complete' }),
      update: spy('tabs.update', (id: number, props: any) => Promise.resolve({ id, windowId: 1, ...props })),
      sendMessage: spy('tabs.sendMessage', () => Promise.resolve({ pong: true })),
    },
    windows: { update: spy('windows.update') },
    action: { onClicked: capture('action') },
    sidePanel: { setPanelBehavior: () => Promise.resolve() },
    scripting: { executeScript: spy('scripting.executeScript', () => Promise.resolve([{}])) },
  };
}

const load = () => { jest.resetModules(); install(); require('../background/service-worker'); };
const settle = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
const port = () => {
  const p: any = { name: 'studio', posted: [], postMessage: (m: any) => p.posted.push(m),
    onMessage: { addListener: (fn: Listener) => { p.handler = fn; } }, onDisconnect: { addListener: () => {} } };
  listeners.connect.forEach((fn) => fn(p));
  return p;
};

/** A Flow generation — the other step that asks for a Flow tab. */
const generate = async () => {
  void port().handler({ type: 'STUDIO_EXECUTE_NODE', payload: { nodeId: 'n', config: { platform: 'flow' } } });
  await settle();
};
/** The tab the run was given: the keepalive marks it undiscardable first thing. */
const heldTab = () => (calls['tabs.update'] || []).find(([, p]) => p.autoDiscardable === false)?.[0];

const upload = async (extra: object = {}) => {
  listeners.message.forEach((fn) => fn(
    { type: 'DEBUG_UPLOAD_TO_FLOW', files: [{ dataUrl: 'data:video/mp4;base64,AA==', filename: 'p.mp4' }], ...extra },
    {}, () => {},
  ));
  await settle();
};

beforeEach(() => { openTabs = []; load(); });

describe('choosing among the Flow tabs that are open', () => {
  it('takes the tab that is inside a project over a homepage listed first', async () => {
    openTabs = [
      { id: 1, url: 'https://flow.google.com/', status: 'complete', windowId: 1 },
      { id: 2, url: 'https://flow.google.com/project/abc', status: 'complete', windowId: 1 },
    ];
    await generate();
    expect(heldTab()).toBe(2);
  });

  it('takes a Flow page over another Labs tool', async () => {
    openTabs = [
      { id: 3, url: 'https://labs.google/fx/tools/whisk', status: 'complete', windowId: 1 },
      { id: 4, url: 'https://labs.google/fx/tools/flow', status: 'complete', windowId: 1 },
    ];
    await generate();
    expect(heldTab()).toBe(4);
  });
});

describe('opening Flow when it is not open', () => {
  it('opens the homepage for Motion Control, so a NEW project is made', async () => {
    await upload({ newProjectIfClosed: true });
    const created = (calls['tabs.create'] || []).map(([p]) => p.url);
    expect(created).toEqual(['https://flow.google.com/']);
  });

  it('still returns to the last project for everything else', async () => {
    /* The Cut node, and every generation: unchanged. */
    await upload();
    const created = (calls['tabs.create'] || []).map(([p]) => p.url);
    expect(created).toEqual([LAST_PROJECT]);
  });

  it('uses an open project rather than opening anything, even for Motion', async () => {
    openTabs = [{ id: 5, url: 'https://flow.google.com/project/in-use', status: 'complete', windowId: 1 }];
    await upload({ newProjectIfClosed: true });
    expect(calls['tabs.create'] || []).toEqual([]);
  });
});

/* A module, not a script: its helpers share names with other test files, and
   two scripts type-checked together collide (TS6200). */
export {};
