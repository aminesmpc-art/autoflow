/**
 * "When it uploads the video to Flow, it switches the tab to Gemini."
 *
 * The keepalive brings the working tab forward every thirty seconds, and it
 * learns which tab that is only when a NODE executes. The upload is not a
 * node. In Motion Control it runs between the Director's last Gemini turn and
 * the first Flow generation — so the keepalive was still holding Gemini while
 * the upload was working in Flow, and its next tick pulled Gemini back to the
 * front, mid-upload.
 *
 * Same harness as tabKeepalive.test.ts — the real worker, Chrome mocked —
 * with two tabs instead of one, because the bug is which of two tabs wins.
 */

/// <reference types="node" />

type Listener = (...args: any[]) => any;
const listeners: Record<string, Listener[]> = {};
const capture = (name: string) => ({
  addListener: (fn: Listener) => { (listeners[name] ||= []).push(fn); },
});
const calls: Record<string, any[][]> = {};
const spy = (name: string, impl?: (...a: any[]) => any) => (...args: any[]) => {
  (calls[name] ||= []).push(args);
  return impl ? impl(...args) : Promise.resolve();
};

const GEMINI = 7;
const FLOW = 9;
let tabs: Record<number, any> = {};

function install() {
  for (const k of Object.keys(listeners)) delete listeners[k];
  for (const k of Object.keys(calls)) delete calls[k];
  tabs = {
    [GEMINI]: { id: GEMINI, active: false, windowId: 1, url: 'https://gemini.google.com/app' },
    [FLOW]: { id: FLOW, active: false, windowId: 1, url: 'https://flow.google.com/project/p' },
  };
  (global as any).chrome = {
    runtime: {
      onConnect: capture('connect'),
      onMessage: capture('message'),
      onInstalled: capture('installed'),
      sendMessage: spy('runtime.sendMessage'),
      getManifest: () => ({ version: '0.27.0' }),
      getPlatformInfo: spy('getPlatformInfo'),
      getURL: (path: string) => 'chrome-extension://test/' + path,
    },
    storage: {
      session: { get: () => Promise.resolve({}), set: () => Promise.resolve() },
      /* The upload refuses outright unless the user allowed it. */
      local: { get: () => Promise.resolve({ af_debug_upload: true }), set: () => Promise.resolve() },
    },
    alarms: { onAlarm: capture('alarm'), create: spy('alarms.create'), clear: spy('alarms.clear') },
    tabs: {
      create: spy('tabs.create', () => Promise.resolve(tabs[GEMINI])),
      get: spy('tabs.get', (id: number) => (tabs[id] ? Promise.resolve(tabs[id]) : Promise.reject(new Error('gone')))),
      update: spy('tabs.update', (id: number, props: any) => {
        if (props.active) for (const t of Object.values(tabs)) t.active = false;
        Object.assign(tabs[id], props);
        return Promise.resolve(tabs[id]);
      }),
      /* The run is on Gemini: the Director's turns ask for a Gemini tab. */
      query: () => Promise.resolve([tabs[GEMINI]]),
      sendMessage: spy('tabs.sendMessage', () => Promise.resolve({ pong: true })),
    },
    windows: { update: spy('windows.update') },
    action: { onClicked: capture('action') },
    sidePanel: { setPanelBehavior: () => Promise.resolve() },
    scripting: { executeScript: spy('scripting.executeScript', () => Promise.resolve([{}])) },
  };
}

const load = () => { jest.resetModules(); install(); require('../background/service-worker'); };
const settle = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
const fireAlarm = async (name: string) => { listeners.alarm.forEach((fn) => fn({ name })); await settle(); };

const port = () => {
  const p: any = {
    name: 'studio', posted: [] as any[], postMessage: (m: any) => p.posted.push(m),
    onMessage: { addListener: (fn: Listener) => { p.handler = fn; } },
    onDisconnect: { addListener: () => { /* not under test */ } },
  };
  listeners.connect.forEach((fn) => fn(p));
  return p;
};

/** A Director turn on Gemini — what arms the keepalive on the Gemini tab. */
const directorTurn = async (p: any) => {
  void p.handler({ type: 'STUDIO_EXECUTE_NODE', payload: { nodeId: 'motion', config: { platform: 'gemini' } } });
  await settle();
};

/** Motion Control's upload, aimed at the Flow tab. The upload itself fails
    against the mocks; what is under test happens before it starts. */
const upload = async () => {
  listeners.message.forEach((fn) => fn(
    { type: 'DEBUG_UPLOAD_TO_FLOW', tabId: FLOW, files: [{ dataUrl: 'data:video/mp4;base64,AA==', filename: 'p.mp4' }] },
    {}, () => { /* response not under test */ },
  ));
  await settle();
};

/** The tab the most recent "bring forward" went to. */
const lastRaised = () => [...(calls['tabs.update'] || [])].reverse().find(([, p]) => p.active === true)?.[0];

beforeEach(load);

describe('the upload is Flow work, and the keepalive knows it', () => {
  it('keeps Flow in front after the upload starts — not Gemini', async () => {
    await directorTurn(port());
    await upload();
    /* The user was looking at Flow — that is where the upload is working. */
    tabs[FLOW].active = true; tabs[GEMINI].active = false;
    (calls['tabs.update'] || []).length = 0;

    await fireAlarm('studio-tab-ping');

    /* The bug: this tick raised GEMINI. A Flow tab already in front is now
       left alone, and nothing else is raised. */
    expect(lastRaised()).not.toBe(GEMINI);
    expect(tabs[FLOW].active).toBe(true);
  });

  it('brings Flow back if something else took the front during the upload', async () => {
    await directorTurn(port());
    await upload();
    tabs[FLOW].active = false; tabs[GEMINI].active = true;
    /* Cleared, or the upload's own "bring Flow forward" would pass this for
       it — which it did, with the fix removed. Only the tick counts here. */
    (calls['tabs.update'] || []).length = 0;

    await fireAlarm('studio-tab-ping');

    expect(lastRaised()).toBe(FLOW);
  });

  it('does not start a keepalive for an upload outside a run', async () => {
    /* No run, nothing holding a tab — nothing to fight with, and no reason to
       start pulling tabs forward every thirty seconds. */
    await upload();
    expect((calls['alarms.create'] || []).some(([n]) => n === 'studio-tab-ping')).toBe(false);
  });
});

/* A module, not a script: its helpers share names with other test files, and
   two scripts type-checked together collide (TS6200). */
export {};
