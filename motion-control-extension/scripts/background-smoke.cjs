// Disposable browser profile and synthetic provider pages. No sign-in or real AI generation.
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const dist = path.resolve(__dirname, '../dist');

async function main() {
  const context = await chromium.launchPersistentContext('', {
    executablePath: process.env.EXTENSION_BROWSER_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    headless: true, args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
  });
  try {
    await context.route('https://gemini.google.com/**', route => route.fulfill({ contentType: 'text/html', body: '<html><body>Gemini fixture</body></html>' }));
    await context.route('https://flow.google.com/**', route => route.fulfill({ contentType: 'text/html', body: '<html><body>Flow fixture</body></html>' }));
    await context.setOffline(true);
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 15000 });
    const extensionId = new URL(worker.url()).hostname;
    // Intercept execution commands only. Keep the real tabs, worker, storage,
    // alarms, and content-script PING responses. No provider can be submitted.
    await worker.evaluate(() => {
      const send = chrome.tabs.sendMessage.bind(chrome.tabs);
      globalThis.fixtureExecutions = [];
      chrome.tabs.sendMessage = async (tabId, message, ...options) => {
        if (message.type === 'STUDIO_EXECUTE_NODE') {
          globalThis.fixtureExecutions.push({ tabId, platform: message.payload.config.platform });
          return { type: 'STUDIO_ACK' };
        }
        return send(tabId, message, ...options);
      };
    });
    const gemini = await context.newPage(); await gemini.goto('https://gemini.google.com/app/fixture');
    const flow = await context.newPage(); await flow.goto('https://flow.google.com/project/2797c6d7-bb3c-428d-bca2-e4bc771d3d7e');
    const panel = await context.newPage(); await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await panel.getByRole('heading', { name: 'Motion Control', exact: true }).waitFor();
    await assert.doesNotReject(() => worker.evaluate(async () => {
      const tabs = await chrome.tabs.query({ url: ['https://gemini.google.com/*', 'https://flow.google.com/*'] });
      for (const tab of tabs) await chrome.tabs.sendMessage(tab.id, { type: 'PING' });
    }));
    const targets = await worker.evaluate(async () => {
      const [geminiTab] = await chrome.tabs.query({ url: 'https://gemini.google.com/*' });
      const [flowTab] = await chrome.tabs.query({ url: 'https://flow.google.com/*' });
      await chrome.tabs.update(geminiTab.id, { autoDiscardable: true });
      await chrome.tabs.update(flowTab.id, { autoDiscardable: false });
      return { gemini: geminiTab.id, flow: flowTab.id };
    });
    await panel.evaluate(async () => {
      await chrome.storage.local.set({ af_background_tabs: true, af_background_strict: true });
      globalThis.fixturePort = chrome.runtime.connect({ name: 'studio' });
      globalThis.fixturePort.onMessage.addListener(() => {});
      globalThis.fixturePort.postMessage({ type: 'STUDIO_RUN_STATE', payload: { running: true } });
      globalThis.fixturePort.postMessage({ type: 'STUDIO_EXECUTE_NODE', payload: { nodeId: 'fixture-gemini', config: { platform: 'gemini' } } });
    });
    const waitFor = async predicate => {
      for (let attempt = 0; attempt < 100; attempt++) {
        if (await predicate()) return;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      throw new Error('Background fixture did not reach its expected state');
    };
    await waitFor(() => worker.evaluate(() => globalThis.fixtureExecutions.length === 1));
    await panel.evaluate(() => globalThis.fixturePort.postMessage({ type: 'STUDIO_EXECUTE_NODE', payload: { nodeId: 'fixture-flow', config: { platform: 'flow' } } }));
    await waitFor(() => worker.evaluate(() => globalThis.fixtureExecutions.length === 2));
    const protectedState = await worker.evaluate(async ids => ({
      gemini: await chrome.tabs.get(ids.gemini), flow: await chrome.tabs.get(ids.flow),
      registry: (await chrome.storage.session.get('af_motion_provider_keepalive')).af_motion_provider_keepalive,
      alarm: await chrome.alarms.get('studio-tab-ping'),
    }), targets);
    assert.equal(protectedState.gemini.autoDiscardable, false);
    assert.equal(protectedState.flow.autoDiscardable, false);
    assert.equal(protectedState.gemini.active, false);
    assert.equal(protectedState.flow.active, false);
    assert.equal(protectedState.registry.tabs.length, 2);
    assert.equal(protectedState.registry.target.tabId, targets.flow);
    assert.equal(protectedState.alarm.periodInMinutes, 0.5);
    await panel.evaluate(() => globalThis.fixturePort.postMessage({ type: 'STUDIO_RUN_STATE', payload: { running: false } }));
    await waitFor(() => worker.evaluate(async () => (await chrome.storage.session.get('af_motion_provider_keepalive')).af_motion_provider_keepalive?.tabs.length === 0));
    const restored = await worker.evaluate(async ids => ({
      gemini: (await chrome.tabs.get(ids.gemini)).autoDiscardable,
      flow: (await chrome.tabs.get(ids.flow)).autoDiscardable,
      alarm: await chrome.alarms.get('studio-tab-ping'),
    }), targets);
    assert.deepEqual(restored, { gemini: true, flow: false, alarm: undefined });
    await panel.evaluate(async () => {
      await chrome.storage.local.set({ af_background_tabs: false, af_background_strict: false });
      globalThis.fixturePort.postMessage({ type: 'STUDIO_RUN_STATE', payload: { running: true } });
      globalThis.fixturePort.postMessage({ type: 'STUDIO_EXECUTE_NODE', payload: { nodeId: 'follow-gemini', config: { platform: 'gemini' } } });
    });
    await waitFor(() => worker.evaluate(async id => (await chrome.tabs.get(id)).active, targets.gemini));
    // A second step on the same provider must reclaim its tab too.
    await worker.evaluate(async id => chrome.tabs.update(id, { active: true }), targets.flow);
    await panel.evaluate(() => globalThis.fixturePort.postMessage({ type: 'STUDIO_EXECUTE_NODE', payload: { nodeId: 'follow-gemini-again', config: { platform: 'gemini' } } }));
    await waitFor(() => worker.evaluate(async id => (await chrome.tabs.get(id)).active, targets.gemini));
    await panel.evaluate(() => globalThis.fixturePort.postMessage({ type: 'STUDIO_EXECUTE_NODE', payload: { nodeId: 'follow-flow', config: { platform: 'flow' } } }));
    await waitFor(() => worker.evaluate(async id => (await chrome.tabs.get(id)).active, targets.flow));
    await panel.evaluate(() => globalThis.fixturePort.postMessage({ type: 'STUDIO_RUN_STATE', payload: { running: false } }));
    await waitFor(() => worker.evaluate(async () => (await chrome.storage.session.get('af_motion_provider_keepalive')).af_motion_provider_keepalive?.tabs.length === 0));
    console.log('Provider tab smoke passed: background protection/restoration, repeated Gemini foreground steps, then handoff to Flow. Synthetic pages; no AI generation.');
  } finally { await context.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
