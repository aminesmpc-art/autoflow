/// <reference types="node" />
const originalChrome = globalThis.chrome;
afterEach(() => { Object.assign(globalThis, { chrome: originalChrome }); jest.resetModules(); });

function harness() {
  const addListener = jest.fn(), open = jest.fn().mockResolvedValue(undefined), set = jest.fn().mockResolvedValue(undefined);
  Object.assign(globalThis, { chrome: { runtime: { id: 'motion-id', onMessage: { addListener } }, sidePanel: { open }, storage: { session: { set } } } });
  jest.isolateModules(() => require('../src/social/worker'));
  return { heard: addListener.mock.calls[0][0], open, set };
}
const url = 'https://www.tiktok.com/@creator/video/123';
const sender = { id: 'motion-id', url, frameId: 0, tab: { id: 42, windowId: 7 } };

test('page click opens the side panel in the user gesture and stores only the selected page URL', async () => {
  const { heard, open, set } = harness(), respond = jest.fn();
  expect(heard({ type: 'MOTION_SOCIAL_OPEN', url }, sender, respond)).toBe(true);
  expect(open).toHaveBeenCalledWith({ windowId: 7 });
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  expect(set).toHaveBeenCalledWith({ motion_social_selection: { url, tabId: 42, windowId: 7, selectedAt: expect.any(Number) } });
  expect(respond).toHaveBeenCalledWith({ ok: true });
});
test.each([{ ...sender, id: 'other' }, { ...sender, frameId: 1 }, { ...sender, url: 'https://evil.test/' }, { ...sender, tab: {} }])('untrusted source cannot open a panel or queue an import', value => {
  const { heard, open, set } = harness(), respond = jest.fn();
  expect(heard({ type: 'MOTION_SOCIAL_OPEN', url }, value, respond)).toBe(false);
  expect(respond).toHaveBeenCalledWith({ error: expect.any(String) });
  expect(open).not.toHaveBeenCalled(); expect(set).not.toHaveBeenCalled();
});
test('a page cannot request a different video, and unrelated runtime messages remain untouched', () => {
  const { heard, open } = harness(), respond = jest.fn();
  heard({ type: 'MOTION_SOCIAL_OPEN', url: url.replace('/123', '/456') }, sender, respond);
  expect(open).not.toHaveBeenCalled();
  expect(heard({ type: 'PANEL_RUN_STATE' }, sender, respond)).toBe(false);
});
test('failed side-panel opening retains the video and offers a toolbar fallback, not a new Studio page', async () => {
  const { heard, open, set } = harness(), respond = jest.fn();
  open.mockRejectedValue(new Error('no gesture'));
  heard({ type: 'MOTION_SOCIAL_OPEN', url }, sender, respond);
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  expect(respond).toHaveBeenCalledWith({ error: expect.stringContaining('toolbar icon') });
  expect(set).toHaveBeenCalledWith({ motion_social_selection: expect.objectContaining({ url }) });
});

test('a trusted feed can select an associated permalink on the same platform', async () => {
  const { heard, open, set } = harness(), respond = jest.fn();
  expect(heard({ type: 'MOTION_SOCIAL_OPEN', url }, { ...sender, url: 'https://www.tiktok.com/foryou' }, respond)).toBe(true);
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  expect(open).toHaveBeenCalledWith({ windowId: 7 });
  expect(set).toHaveBeenCalledWith({ motion_social_selection: expect.objectContaining({ url }) });
  expect(respond).toHaveBeenCalledWith({ ok: true });
});

test('a feed cannot queue another platform or a link without a video ID', () => {
  const { heard, open } = harness(), respond = jest.fn();
  const feedSender = { ...sender, url: 'https://www.tiktok.com/foryou' };
  expect(heard({ type: 'MOTION_SOCIAL_OPEN', url: 'https://www.instagram.com/reel/AbCd123/' }, feedSender, respond)).toBe(false);
  expect(heard({ type: 'MOTION_SOCIAL_OPEN', url: 'https://vm.tiktok.com/abc/' }, feedSender, respond)).toBe(false);
  expect(open).not.toHaveBeenCalled();
});
