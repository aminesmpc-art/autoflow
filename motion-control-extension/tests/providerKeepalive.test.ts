import { ProviderKeepalive, PROVIDER_KEEPALIVE_KEY } from '../src/providerKeepalive';

let saved: Record<string, any>;
let tabs: Map<number, chrome.tabs.Tab>;
beforeEach(() => {
  saved = {};
  tabs = new Map([
    [7, { id: 7, autoDiscardable: true } as chrome.tabs.Tab],
    [8, { id: 8, autoDiscardable: false } as chrome.tabs.Tab],
  ]);
  (globalThis as any).chrome = {
    storage: { session: {
      get: jest.fn(async (key: string) => ({ [key]: saved[key] })),
      set: jest.fn(async (value: any) => { Object.assign(saved, JSON.parse(JSON.stringify(value))); }),
    } },
    tabs: {
      get: jest.fn(async (id: number) => { if (!tabs.has(id)) throw new Error('closed'); return { ...tabs.get(id) }; }),
      update: jest.fn(async (id: number, change: any) => {
        if (!tabs.has(id)) throw new Error('closed');
        Object.assign(tabs.get(id)!, change); return tabs.get(id);
      }),
    },
  };
});

test('both provider tabs stay protected across handoffs; original settings are restored', async () => {
  const guard = new ProviderKeepalive();
  await guard.hold(7, 'gemini');
  await guard.hold(8, 'flow');
  expect(tabs.get(7)?.autoDiscardable).toBe(false);
  expect(tabs.get(8)?.autoDiscardable).toBe(false);
  expect(await guard.recover()).toEqual({ tabId: 8, platform: 'flow' });
  await guard.release();
  expect(tabs.get(7)?.autoDiscardable).toBe(true);
  expect(tabs.get(8)?.autoDiscardable).toBe(false);
  expect(await guard.recover()).toBeNull();
});

test('worker replacement recovers the target and originals without resetting them', async () => {
  await new ProviderKeepalive().hold(7, 'gemini');
  const replacement = new ProviderKeepalive();
  expect(await replacement.recover()).toEqual({ tabId: 7, platform: 'gemini' });
  await replacement.hold(7, 'gemini');
  await replacement.release();
  expect(tabs.get(7)?.autoDiscardable).toBe(true);
});

test('persists the original setting before it changes the tab', async () => {
  chrome.tabs.update = jest.fn(async () => {
    expect(saved[PROVIDER_KEEPALIVE_KEY].tabs[0].autoDiscardable).toBe(true);
    return tabs.get(7)!;
  });
  await new ProviderKeepalive().hold(7, 'gemini');
});

test('serializes a stop arriving during a handoff', async () => {
  const guard = new ProviderKeepalive();
  await Promise.all([guard.hold(7, 'gemini'), guard.hold(8, 'flow'), guard.release()]);
  expect(await guard.recover()).toBeNull();
  expect(tabs.get(7)?.autoDiscardable).toBe(true);
  expect(tabs.get(8)?.autoDiscardable).toBe(false);
});

test('closed tabs do not prevent restoring the other tab', async () => {
  const guard = new ProviderKeepalive();
  await guard.hold(7, 'gemini'); await guard.hold(8, 'flow');
  tabs.delete(8);
  await guard.release();
  expect(tabs.get(7)?.autoDiscardable).toBe(true);
  expect(saved[PROVIDER_KEEPALIVE_KEY].tabs).toEqual([]);
});

test('does not overwrite a later user change to the setting', async () => {
  const guard = new ProviderKeepalive();
  await guard.hold(8, 'flow');
  tabs.get(8)!.autoDiscardable = true;
  await guard.release();
  expect(tabs.get(8)?.autoDiscardable).toBe(true);
});

test('retains failed restorations for a subsequent cleanup attempt', async () => {
  const guard = new ProviderKeepalive();
  await guard.hold(7, 'gemini');
  (chrome.tabs.update as jest.Mock).mockRejectedValueOnce(new Error('transient'));
  await guard.release();
  expect(saved[PROVIDER_KEEPALIVE_KEY].tabs).toHaveLength(1);
  await guard.release();
  expect(tabs.get(7)?.autoDiscardable).toBe(true);
  expect(saved[PROVIDER_KEEPALIVE_KEY].tabs).toEqual([]);
});

test('invalid persisted targets are ignored and unrelated platforms cannot be protected', async () => {
  saved[PROVIDER_KEEPALIVE_KEY] = { target: { tabId: 9, platform: 'arbitrary' }, tabs: [null, { tabId: 9, platform: 'arbitrary', autoDiscardable: true }] };
  const guard = new ProviderKeepalive();
  expect(await guard.recover()).toBeNull();
  await guard.hold(7, 'arbitrary');
  expect(chrome.tabs.update).not.toHaveBeenCalled();
});
