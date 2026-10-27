/// <reference types="node" />
/**
 * AutoFlow Motion's background mode: "I want Flow and Gemini to work fully in
 * the background without me seeing the tab."
 *
 * Studio's Background tabs beta (af_background_tabs) already stopped the
 * routine grab every 30 seconds. It still raised the provider tab at each
 * hand-off, and debugUpload raised Flow before every upload. Motion sets a
 * second key, af_background_strict, and then nothing raises a tab on its own.
 * The exception is the click route of an upload, which needs layout: it shows
 * Flow for the moment of the click and hands the window back. Studio never
 * sets the key, so it keeps every behaviour it had.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

type Listener = (...args: any[]) => any;
const listeners: Record<string, Listener[]> = {};
const calls: Record<string, any[][]> = {};
let stored: Record<string, any> = {};

const spy = (name: string, impl?: (...a: any[]) => any) => (...args: any[]) => {
  (calls[name] ||= []).push(args);
  return impl ? impl(...args) : Promise.resolve();
};
const capture = (name: string) => ({ addListener: (fn: Listener) => { (listeners[name] ||= []).push(fn); } });

function install(keys: Record<string, any>) {
  for (const k of Object.keys(listeners)) delete listeners[k];
  for (const k of Object.keys(calls)) delete calls[k];
  stored = { ...keys };
  /* Loaded and answering, so the run does not sit in a readiness wait past the test. */
  const tabState: any = { id: 7, active: false, windowId: 3, status: 'complete' };
  (global as any).chrome = {
    runtime: {
      onConnect: capture('connect'), onMessage: capture('message'), onInstalled: capture('installed'),
      sendMessage: spy('runtime.sendMessage'),
      getManifest: () => ({ version: '0.1.10' }),
      getPlatformInfo: spy('getPlatformInfo'),
      getURL: (path: string) => 'chrome-extension://test/' + path,
    },
    storage: {
      session: { get: () => Promise.resolve({}), set: () => Promise.resolve() },
      local: {
        get: (wanted: any) => Promise.resolve(Array.isArray(wanted)
          ? Object.fromEntries(wanted.filter((k: string) => k in stored).map((k: string) => [k, stored[k]]))
          : typeof wanted === 'string' ? (wanted in stored ? { [wanted]: stored[wanted] } : {}) : { ...stored }),
        set: () => Promise.resolve(),
      },
    },
    alarms: { onAlarm: capture('alarm'), create: spy('alarms.create'), clear: spy('alarms.clear') },
    tabs: {
      create: spy('tabs.create', () => Promise.resolve({ id: 7 })),
      get: spy('tabs.get', () => Promise.resolve(tabState)),
      update: spy('tabs.update', (_id: number, props: any) => { Object.assign(tabState, props); return Promise.resolve(tabState); }),
      query: spy('tabs.query', () => Promise.resolve([{ id: 7 }])),
      sendMessage: spy('tabs.sendMessage', () => Promise.resolve({ pong: true })),
    },
    windows: {
      update: spy('windows.update'),
      getLastFocused: spy('windows.getLastFocused', () => Promise.resolve({ id: 3 })),
    },
    action: { onClicked: capture('action') },
    sidePanel: { setPanelBehavior: () => Promise.resolve() },
    scripting: { executeScript: spy('scripting.executeScript', () => Promise.resolve([{}])) },
  };
}

const raised = () => (calls['tabs.update'] || []).filter(([, p]) => p?.active === true);

describe('the key', () => {
  beforeEach(() => jest.resetModules());

  it.each([
    [{ af_background_tabs: true, af_background_strict: true }, true],
    [{ af_background_tabs: true }, false],
    [{ af_background_strict: true }, false],
    [{}, false],
  ])('%j → %s', async (keys, expected) => {
    install(keys);
    const { backgroundStrict } = require('../background/backgroundMode');
    expect(await backgroundStrict()).toBe(expected);
  });

  it('fails closed when settings cannot be read', async () => {
    install({});
    (global as any).chrome.storage.local.get = () => Promise.reject(new Error('gone'));
    const { backgroundStrict } = require('../background/backgroundMode');
    expect(await backgroundStrict()).toBe(false);
  });
});

describe('showing a tab for a moment', () => {
  beforeEach(() => jest.resetModules());

  it('brings it forward and puts back the tab and window that were in front', async () => {
    install({});
    const chrome = (global as any).chrome;
    chrome.tabs.get = spy('tabs.get', () => Promise.resolve({ id: 7, windowId: 3 }));
    chrome.tabs.query = spy('tabs.query', () => Promise.resolve([{ id: 11 }]));
    chrome.windows.getLastFocused = spy('windows.getLastFocused', () => Promise.resolve({ id: 9 }));
    const { showBriefly, handBack } = require('../background/backgroundMode');
    const shown = await showBriefly(7);
    expect(shown).toEqual({ previousTabId: 11, windowId: 3, focusedWindowId: 9 });
    expect(raised().map(([id]) => id)).toEqual([7]);
    await handBack(shown);
    expect(raised().map(([id]) => id)).toEqual([7, 11]);
    expect((calls['windows.update'] || []).map(([id]) => id)).toEqual([3, 9]);
  });

  it('puts nothing back when Flow was already in front', async () => {
    install({});
    const chrome = (global as any).chrome;
    chrome.tabs.get = spy('tabs.get', () => Promise.resolve({ id: 7, windowId: 3 }));
    chrome.tabs.query = spy('tabs.query', () => Promise.resolve([{ id: 7 }]));
    chrome.windows.getLastFocused = spy('windows.getLastFocused', () => Promise.resolve({ id: 3 }));
    const { showBriefly, handBack } = require('../background/backgroundMode');
    const shown = await showBriefly(7);
    expect(shown).toEqual({ windowId: 3 });
    (calls['tabs.update'] || []).length = 0;
    (calls['windows.update'] || []).length = 0;
    await handBack(shown);
    expect(calls['tabs.update'] || []).toEqual([]);
    expect(calls['windows.update'] || []).toEqual([]);
  });
});

describe('the hand-off to a provider', () => {
  /* Started and deliberately not awaited, as in tabKeepalive.test: the
     hand-off happens before anything the mock cannot answer. */
  const startRun = async () => {
    jest.resetModules();
    require('../background/service-worker');
    const port: any = {
      name: 'studio', postMessage: () => undefined,
      onMessage: { addListener: (fn: Listener) => { port.handler = fn; } },
      onDisconnect: { addListener: () => undefined },
    };
    listeners.connect.forEach((fn) => fn(port));
    void port.handler({ type: 'STUDIO_EXECUTE_NODE', payload: { nodeId: 'n', config: { platform: 'flow' } } });
    for (let i = 0; i < 30; i++) await Promise.resolve();
  };

  it('still brings the tab forward for Studio', async () => {
    install({});
    await startRun();
    expect(raised().length).toBeGreaterThan(0);
  });

  it('still brings it forward under Studio\'s beta alone, as before', async () => {
    install({ af_background_tabs: true });
    await startRun();
    expect(raised().length).toBeGreaterThan(0);
  });

  it('leaves it where it is in Motion\'s background mode, and says so', async () => {
    install({ af_background_tabs: true, af_background_strict: true });
    await startRun();
    expect(raised()).toEqual([]);
    expect((calls['alarms.create'] || []).some(([n]) => n === 'studio-tab-ping')).toBe(true);
    expect((calls['tabs.update'] || []).some(([, p]) => p?.autoDiscardable === false)).toBe(true);
    const logged = (calls['runtime.sendMessage'] || []).map(([m]) => m?.payload?.line).filter(Boolean);
    expect(logged.some((line: string) => /left its tab where it is \(background mode\)/.test(line))).toBe(true);
  });
});

describe('the upload', () => {
  const SRC = readFileSync(join(__dirname, '..', 'background', 'debugUpload.ts'), 'utf8');

  it('does not raise Flow before an upload in background mode, but keeps it from being discarded', () => {
    const at = SRC.indexOf('export async function uploadToFlow(');
    const step0 = SRC.slice(at, SRC.indexOf('Step 1: Have the content script open the upload dialog', at));
    expect(step0).toMatch(/if \(await backgroundStrict\(\)\) \{\s*await chrome\.tabs\.update\(tabId, \{ autoDiscardable: false \}\);\s*\} else \{\s*await chrome\.tabs\.update\(tabId, \{ active: true \}\);/);
  });

  it('shows Flow only when the click route is the one left, after the direct route failed', () => {
    const fn = SRC.slice(SRC.indexOf('export async function uploadViaFileChooser('), SRC.indexOf('export async function uploadToFlow('));
    const direct = fn.indexOf("return { ok: true, route: 'direct' };");
    const show = fn.indexOf('shown = await showBriefly(tabId);');
    const measure = fn.indexOf('── 3. Get FRESH button coordinates');
    expect(direct).toBeGreaterThan(-1);
    expect(show).toBeGreaterThan(direct);
    expect(measure).toBeGreaterThan(show);
    expect(fn.slice(show - 80, show)).toMatch(/if \(await backgroundStrict\(\)\) \{/);
  });

  it('hands the window back however the upload ends', () => {
    const fn = SRC.slice(SRC.indexOf('export async function uploadViaFileChooser('), SRC.indexOf('export async function uploadToFlow('));
    const fin = fn.lastIndexOf('} finally {');
    expect(fn.slice(fin, fin + 80)).toMatch(/if \(shown\) await handBack\(shown\);/);
  });
});
