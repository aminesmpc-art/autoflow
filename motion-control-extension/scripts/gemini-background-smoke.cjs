// Actual built Gemini adapter and worker on an offline fixture. No provider requests.
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const dist = path.resolve(__dirname, '../dist');
const answer = 'The person steps forward and raises their right hand. Preserve the camera angle and exact motion timing.';
const generationPath = '/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate';
const responseBody = [];
responseBody[1] = ['c_network_fixture', 'r_fixture'];
responseBody[4] = [['rc_fixture', [answer], null, null, null, null, null, null, [2]]];
const frame = JSON.stringify([['wrb.fr', null, JSON.stringify(responseBody)]]);
const networkAnswer = ")]}'\n\n" + frame.length + '\n' + frame;
const fixture = `<html><body>
  <a href="/app" id="new-chat">New chat</a>
  <model-response><message-content>Old answer</message-content></model-response>
  <div class="attachment-preview-wrapper"></div>
  <rich-textarea><div class="ql-editor" contenteditable="true" role="textbox" data-placeholder="Ask Gemini"></div></rich-textarea>
  <button class="send-button">Send</button>
  <script>
    window.submissions = 0; window.uploads = 0; window.newChats = 0; window.fixtureTransport = 'dom';
    document.querySelector('#new-chat').onclick = event => {
      event.preventDefault();
      window.newChats++;
      setTimeout(() => {
        document.querySelectorAll('model-response').forEach(el => el.remove());
        document.querySelector('.ql-editor').textContent = '';
        document.querySelector('.attachment-preview-wrapper').innerHTML = '';
        history.replaceState({}, '', '/app');
      }, 100);
    };
    const composer = document.querySelector('.ql-editor');
    composer.addEventListener('paste', event => {
      event.preventDefault();
      if (event.clipboardData.files.length) {
        window.uploads += event.clipboardData.files.length;
        document.querySelector('.attachment-preview-wrapper').innerHTML = '<uploader-file-preview><mat-spinner></mat-spinner></uploader-file-preview>';
        setTimeout(() => {
          document.querySelector('mat-spinner').remove();
          document.querySelector('uploader-file-preview').append(document.createElement('gem-media-attachment'));
        }, 700);
      } else composer.textContent = event.clipboardData.getData('text/plain');
    });
    document.querySelector('.send-button').onclick = () => {
      window.submissions++;
      window.submittedText = composer.textContent;
      window.sentWhileUploading = !!document.querySelector('mat-spinner');
      if (window.fixtureTransport !== 'dom') {
        // No composer clear, answer DOM or completion footer while hidden.
        const body = new URLSearchParams({ 'f.req': JSON.stringify([null, JSON.stringify([[composer.textContent]])]) }).toString();
        if (window.fixtureTransport === 'fetch') {
          void fetch(${JSON.stringify(generationPath)}, { method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
          return;
        }
        const xhr = new XMLHttpRequest();
        xhr.open('POST', ${JSON.stringify(generationPath)});
        xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
        xhr.send(body);
        return;
      }
      composer.textContent = '';
      const response = document.createElement('model-response');
      response.innerHTML = '<message-content aria-busy="true">Working</message-content><message-actions></message-actions>';
      document.body.append(response);
      setTimeout(() => {
        response.querySelector('message-content').firstChild.data = ${JSON.stringify(answer)};
        response.querySelector('message-content').setAttribute('aria-busy', 'false');
        response.querySelector('message-actions').innerHTML = '<button aria-label="Copy">Copy</button>';
      }, 500);
    };
  </script></body></html>`;

async function main() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'autoflow-gemini-smoke-'));
  const child = spawn(process.env.EXTENSION_BROWSER_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    ['--headless=new', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0',
      `--user-data-dir=${profile}`, `--disable-extensions-except=${dist}`, `--load-extension=${dist}`, 'about:blank'],
    { windowsHide: true, stdio: 'ignore' });
  let launchError; child.on('error', error => { launchError = error; });
  const exited = new Promise(resolve => child.once('exit', resolve));
  let browser;
  try {
    const portFile = path.join(profile, 'DevToolsActivePort');
    const launchDeadline = Date.now() + 15000;
    while (!fs.existsSync(portFile)) {
      if (launchError) throw launchError;
      if (child.exitCode !== null || Date.now() > launchDeadline) throw new Error('Disposable browser did not start');
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const port = Number(fs.readFileSync(portFile, 'utf8').split('\n')[0]);
    // noDefaults is supported by the bundled runtime's connectOverCDP API.
    // It prevents focus emulation, so document.hidden is Chrome's real state.
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { noDefaults: true });
    const context = browser.contexts()[0];
    await context.route('https://gemini.google.com/**', route => new URL(route.request().url()).pathname === generationPath
      ? route.fulfill({ contentType: 'application/json', body: networkAnswer })
      : route.fulfill({ contentType: 'text/html', body: fixture }));
    await context.setOffline(true);
    const isMotionWorker = item => item.url().startsWith('chrome-extension://') && item.url().endsWith('/background.js');
    const worker = context.serviceWorkers().find(isMotionWorker)
      || await context.waitForEvent('serviceworker', { predicate: isMotionWorker, timeout: 15000 });
    const workerInfo = await worker.evaluate(() => ({
      name: chrome.runtime?.getManifest?.().name, scripting: typeof chrome.scripting,
      permissions: chrome.runtime?.getManifest?.().permissions,
    }));
    assert.equal(workerInfo.name, 'AutoFlow Motion — Motion Control', JSON.stringify(workerInfo));
    assert.equal(workerInfo.scripting, 'object', JSON.stringify(workerInfo));
    const gemini = await context.newPage(); await gemini.goto('https://gemini.google.com/app/fixture');
    assert.equal(await gemini.locator('#new-chat').count(), 1, 'Offline Gemini fixture must be loaded');
    gemini.on('console', message => { if (message.type() === 'error') console.error(message.text()); });
    await worker.evaluate(() => chrome.tabs.create({ url: 'about:blank', active: true }));
    const tabId = await worker.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ url: 'https://gemini.google.com/*' });
      // Match the worker's recovery route when idle injection is deferred.
      try { await chrome.tabs.sendMessage(tab.id, { type: 'PING' }); }
      catch { await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['gemini-content.js'] }); }
      // document_idle injection can finish just after navigation resolves.
      let ready = false;
      for (let i = 0; i < 40; i++) {
        try { await chrome.tabs.sendMessage(tab.id, { type: 'PING' }); ready = true; break; } catch {}
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      if (!ready) throw new Error('Gemini content script did not initialize on the offline fixture');
      globalThis.fixtureResults = [];
      chrome.runtime.onMessage.addListener(message => {
        if (message.payload?.nodeId === 'fixture-gemini-execute') globalThis.fixtureResults.push(message);
      });
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: 'ISOLATED', func: () => {
        // Simulate hidden-tab throttling, not foreground timer throttling.
        const native = globalThis.setTimeout.bind(globalThis);
        globalThis.setTimeout = (fn, ms, ...args) => native(fn, document.hidden ? Math.max(60000, ms || 0) : ms, ...args);
      } });
      return tab.id;
    });
    assert.equal(await gemini.evaluate(() => document.hidden), true,
      JSON.stringify(await worker.evaluate(async () => (await chrome.tabs.query({})).map(tab => ({ active: tab.active, url: tab.url })))));
    const prompt = 'Describe every movement and preserve the exact camera angle from this video.';
    const ack = await worker.evaluate(({ tabId, prompt }) => chrome.tabs.sendMessage(tabId, {
      type: 'STUDIO_EXECUTE_NODE', payload: { nodeId: 'fixture-gemini-execute', config: {
        mediaType: 'text', prompt, rawReply: true, deleteWhenDone: false,
        referenceImageData: ['data:video/mp4;base64,Y2xpcA=='],
      } },
    }), { tabId, prompt });
    assert.equal(ack.success, true);
    const deadline = Date.now() + 12000;
    let terminal;
    do {
      terminal = await worker.evaluate(() => globalThis.fixtureResults.find(message =>
        message.type === 'STUDIO_NODE_RESULT' || message.type === 'STUDIO_NODE_ERROR'));
      if (terminal) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    } while (Date.now() < deadline);
    assert.equal(terminal?.type, 'STUDIO_NODE_RESULT', JSON.stringify(terminal));
    assert.equal(terminal.payload.text, answer);
    assert.deepEqual(await gemini.evaluate(() => ({ submissions: window.submissions, uploads: window.uploads,
      text: window.submittedText, premature: window.sentWhileUploading, hidden: document.hidden })),
    { submissions: 1, uploads: 1, text: prompt, premature: false, hidden: true });
    const chatsBefore = await gemini.evaluate(() => { window.fixtureTransport = 'network'; return window.newChats; });
    for (let networkTurn = 0; networkTurn < 2; networkTurn++) {
    if (networkTurn === 1) await gemini.evaluate(() => { window.fixtureTransport = 'fetch'; });
    await worker.evaluate(() => { globalThis.fixtureResults = []; });
    const networkAck = await worker.evaluate(({ tabId, prompt }) => chrome.tabs.sendMessage(tabId, {
      type: 'STUDIO_EXECUTE_NODE', payload: { nodeId: 'fixture-gemini-execute', config: {
        mediaType: 'text', prompt, rawReply: true, deleteWhenDone: false,
      } },
    }), { tabId, prompt });
    assert.equal(networkAck.success, true);
    const networkDeadline = Date.now() + 12000;
    let networkResult;
    do {
      networkResult = await worker.evaluate(() => globalThis.fixtureResults.find(message =>
        message.type === 'STUDIO_NODE_RESULT' || message.type === 'STUDIO_NODE_ERROR'));
      if (networkResult) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    } while (Date.now() < networkDeadline);
    assert.equal(networkResult?.type, 'STUDIO_NODE_RESULT', JSON.stringify(networkResult));
    assert.equal(networkResult.payload.text, answer);
    assert.equal(networkResult.payload.conversationPath, 'network_fixture');
    assert.deepEqual(await gemini.evaluate(() => ({ submissions: window.submissions,
      composer: document.querySelector('.ql-editor').textContent,
      turns: document.querySelectorAll('model-response').length, hidden: document.hidden })),
    { submissions: 2 + networkTurn, composer: prompt, turns: 0, hidden: true });
    assert.equal(await worker.evaluate(() => globalThis.fixtureResults.filter(message => message.type === 'STUDIO_NODE_RESULT').length), 1);
    assert.equal(await gemini.evaluate(() => window.newChats), chatsBefore + 1 + networkTurn,
      'A fresh piece must reset the previous server conversation even when it rendered no turn DOM');
    }
    console.log('Gemini background smoke passed: hidden upload fixture and DOM/XHR/fetch replies, one submit per turn. Offline fixture; no AI requests.');
  } finally {
    if (browser) {
      try { const session = await browser.newBrowserCDPSession(); await session.send('Browser.close'); } catch {}
      await browser.close().catch(() => {});
    }
    if (child.exitCode === null) child.kill();
    await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 3000))]);
    // Only remove the exact disposable directory created for this test.
    if (path.dirname(profile) === path.resolve(os.tmpdir()) && path.basename(profile).startsWith('autoflow-gemini-smoke-')) {
      try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); }
      catch (error) { console.warn(`Disposable test profile retained at ${profile}: ${error.code}`); }
    }
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
