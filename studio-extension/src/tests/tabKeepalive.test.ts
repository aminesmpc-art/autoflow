/**
 * Keeping the working tab awake.
 *
 * Studio opens every platform tab with active:false, so it is hidden from the
 * moment it exists. Chrome applies intensive throttling to a hidden tab after
 * five minutes and clamps its timers to once a minute — and every adapter
 * polls with sleep() loops, so a run that outlives that window drops to one
 * check a minute and looks frozen.
 *
 * Studio's keepalive did two things, neither of which addresses that: it kept
 * the SERVICE WORKER alive, and it set autoDiscardable:false. Alive is not
 * un-throttled, and not-discarded is not either. The only thing that resets
 * Chrome's clock is the tab being visible.
 *
 * The Flow extension has had the missing half all along — a second alarm that
 * brings the tab forward and pings the content script. This is that, ported,
 * plus the stop condition it needs and Studio did not have.
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

let tabState: any = { id: 7, active: false };
let sendShouldFail = false;

function install() {
  for (const k of Object.keys(listeners)) delete listeners[k];
  for (const k of Object.keys(calls)) delete calls[k];
  tabState = { id: 7, active: false };
  sendShouldFail = false;

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
      local: { get: () => Promise.resolve({}), set: () => Promise.resolve() },
    },
    alarms: {
      onAlarm: capture('alarm'),
      create: spy('alarms.create'),
      clear: spy('alarms.clear'),
    },
    tabs: {
      create: spy('tabs.create', () => Promise.resolve({ id: 7 })),
      get: spy('tabs.get', () => Promise.resolve(tabState)),
      update: spy('tabs.update', (_id: number, props: any) => {
        Object.assign(tabState, props);
        return Promise.resolve(tabState);
      }),
      query: () => Promise.resolve([{ id: 7 }]),
      sendMessage: spy('tabs.sendMessage', () => (sendShouldFail
        ? Promise.reject(new Error('no receiver'))
        : Promise.resolve({ pong: true }))),
    },
    action: { onClicked: capture('action') },
    sidePanel: { setPanelBehavior: () => Promise.resolve() },
    scripting: { executeScript: spy('scripting.executeScript', () => Promise.resolve([{}])) },
  };
}

const load = () => { jest.resetModules(); install(); require('../background/service-worker'); };

/** Drive one alarm tick and let its promises settle. */
const fireAlarm = async (name: string) => {
  listeners.alarm.forEach((fn) => fn({ name }));
  for (let i = 0; i < 8; i++) await Promise.resolve();
};

const port = () => {
  const p: any = {
    name: 'studio',
    posted: [] as any[],
    postMessage: (m: any) => p.posted.push(m),
    onMessage: { addListener: (fn: Listener) => { p.handler = fn; } },
    onDisconnect: { addListener: () => { /* not under test */ } },
  };
  listeners.connect.forEach((fn) => fn(p));
  return p;
};

/* Deliberately not awaited. The handler goes on to wait for the tab to be
   ready, which never completes against a mock — but startKeepalive runs before
   that, so the alarms exist by the time the microtask queue drains. */
const startRun = async (p: any) => {
  void p.handler({
    type: 'STUDIO_EXECUTE_NODE',
    payload: { nodeId: 'n', config: { platform: 'flow' } },
  });
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

const created = (name: string) => (calls['alarms.create'] || []).some(([n]) => n === name);
const cleared = (name: string) => (calls['alarms.clear'] || []).some(([n]) => n === name);

beforeEach(load);

describe('starting a run', () => {
  it('arms the alarm that keeps the tab visible', async () => {
    await startRun(port());
    expect(created('studio-tab-ping')).toBe(true);
  });

  it('asks for a period Chrome will honour', async () => {
    /* Chrome clamps a packed extension's alarms to 30 seconds however small a
       number is asked for. Anything under that is a wish, not a schedule. */
    await startRun(port());
    const call = (calls['alarms.create'] || []).find(([n]) => n === 'studio-tab-ping');
    expect(call?.[1].periodInMinutes).toBeGreaterThanOrEqual(0.5);
  });

  it('still stops the tab being discarded', async () => {
    await startRun(port());
    expect((calls['tabs.update'] || []).some(([, p]) => p.autoDiscardable === false)).toBe(true);
  });
});

describe('each tick', () => {
  it('brings the tab forward, which is the thing that un-throttles it', async () => {
    await startRun(port());
    await fireAlarm('studio-tab-ping');
    expect((calls['tabs.update'] || []).some(([, p]) => p.active === true)).toBe(true);
  });

  it('leaves a tab that is already in front alone', async () => {
    await startRun(port());
    tabState.active = true;
    (calls['tabs.update'] || []).length = 0;
    await fireAlarm('studio-tab-ping');
    expect((calls['tabs.update'] || []).some(([, p]) => p.active === true)).toBe(false);
  });

  it('pings whatever is listening in it', async () => {
    await startRun(port());
    await fireAlarm('studio-tab-ping');
    expect((calls['tabs.sendMessage'] || []).some(([, m]) => m?.type === 'PING')).toBe(true);
  });

  it('re-injects the right script when nothing answers', async () => {
    /* Every adapter answers PING, so silence means nothing is listening rather
       than that the message was ignored. That happens after an extension
       reload, which orphans the content script in a tab that is still open —
       and the run then waits out its whole backstop against a page that cannot
       hear it. */
    await startRun(port());
    sendShouldFail = true;
    await fireAlarm('studio-tab-ping');
    const files = (calls['scripting.executeScript'] || []).map(([o]) => o.files?.[0]);
    expect(files).toContain('flow-content.js');
  });

  it('does not re-inject while something is answering', async () => {
    await startRun(port());
    await fireAlarm('studio-tab-ping');
    expect(calls['scripting.executeScript']).toBeUndefined();
  });
});

describe('stopping', () => {
  it('lets go the moment the run reports it has finished', async () => {
    /* THE stop condition. The keepalive used to end only when the canvas was
       closed, which cost nothing while all it did was poke an API. It brings a
       tab to the front twice a minute now, so an alarm outliving its run would
       pull the user off whatever they moved on to, indefinitely, with no run
       left to justify it. */
    const p = port();
    await startRun(p);
    await p.handler({ type: 'STUDIO_RUN_STATE', payload: { running: false } });
    for (let i = 0; i < 6; i++) await Promise.resolve();
    expect(cleared('studio-tab-ping')).toBe(true);
  });

  it('keeps going while the run is still going', async () => {
    const p = port();
    await startRun(p);
    await p.handler({ type: 'STUDIO_RUN_STATE', payload: { running: true, progress: 40 } });
    for (let i = 0; i < 6; i++) await Promise.resolve();
    expect(cleared('studio-tab-ping')).toBe(false);
  });

  it('lets go when the tab it was holding is closed', async () => {
    await startRun(port());
    (global as any).chrome.tabs.get = () => Promise.reject(new Error('No tab with id'));
    await fireAlarm('studio-tab-ping');
    expect(cleared('studio-tab-ping')).toBe(true);
  });
});
