// Offline real-canvas mouse test. Never clicks Run or contacts a provider.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const webpack = require('webpack');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const root = path.resolve(__dirname, '..');
const out = path.join(root, '_harness/connections');
async function main() {
  if (!process.argv.includes('--skip-build')) await new Promise((resolve, reject) => webpack({
    mode: 'development', context: root, entry: './scripts/fixtures/studioConnections.tsx',
    output: { path: out, filename: 'test.js' }, devtool: false,
    resolve: { extensions: ['.tsx', '.ts', '.js'] },
    module: { rules: [
      { test: /\.tsx?$/, exclude: /node_modules/, use: { loader: 'ts-loader', options: { transpileOnly: true } } },
      { test: /\.css$/, use: [MiniCssExtractPlugin.loader, 'css-loader'] },
    ] }, plugins: [new MiniCssExtractPlugin({ filename: 'test.css' })],
  }, (err, stats) => err || stats.hasErrors() ? reject(err || new Error(stats.toString({ all: false, errors: true }))) : resolve()));
  console.log('Local canvas fixture built.');
  const server = http.createServer((req, res) => {
    const name = new URL(req.url, 'http://localhost').pathname;
    if (name === '/') { res.setHeader('Content-Type', 'text/html'); res.end('<html><head><meta charset="utf-8"><link rel="stylesheet" href="/test.css"><style>html,body,#root{margin:0;width:100%;height:100%;overflow:hidden}</style></head><body><div id="root"></div><script src="/test.js"></script></body></html>'); return; }
    const file = name === '/workflow.json' ? path.join(root, 'test-workflows/studio-connection-test.json') : path.resolve(out, '.' + name);
    if ((!file.startsWith(out + path.sep) && name !== '/workflow.json') || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404).end(); return; }
    res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'application/json');
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    page.setDefaultTimeout(12000);
    const errors = []; page.on('pageerror', error => { errors.push(error.message); console.error('Page:', error.message); });
    await page.route('**/*', route => route.request().url().startsWith('http://127.0.0.1:') ? route.continue() : route.abort());
    await page.addInitScript(() => {
      const memory = {};
      const listener = { addListener() {}, removeListener() {} };
      window.chrome = { storage: { onChanged: listener, local: {
        get: async keys => Object.fromEntries((typeof keys === 'string' ? [keys] : keys || Object.keys(memory)).filter(k => k in memory).map(k => [k, memory[k]])),
        set: async values => Object.assign(memory, values), remove: async key => { delete memory[key]; },
      } }, runtime: { lastError: null, sendMessage: async () => ({}), getURL: path => path,
        connect: () => ({ onMessage: listener, onDisconnect: listener, postMessage() {}, disconnect() {} }),
      } };
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    const node = id => page.locator(`.react-flow__node[data-id="${id}"]`);
    await node('clip_3').waitFor();
    await page.waitForFunction(() => document.querySelectorAll('.react-flow__edge').length === 8);
    const mode = node('clip_1').locator('select').filter({ has: page.locator('option[value="frames"]') });
    await mode.selectOption('ingredients');
    await page.waitForFunction(() => window.connectionTest.state().edges.find(e => e.source === 'start_image').targetHandle === 'image_ref');
    await mode.selectOption('frames');
    await page.waitForFunction(() => window.connectionTest.state().edges.find(e => e.source === 'start_image').targetHandle === 'frame_start');
    await page.evaluate(() => window.connectionTest.removeEdge('start_image-clip_1-frame_start'));
    const drag = async (sourceId, sourceHandle, targetId, targetHandle) => {
      await page.getByRole('button', { name: /Recenter/ }).click();
      // Recenter animates for 300ms; wait for the viewport's transform to settle.
      await page.waitForTimeout(350);
      const a = await node(sourceId).locator(`.react-flow__handle.source[data-handleid="${sourceHandle}"]`).boundingBox();
      const b = await node(targetId).locator(`.react-flow__handle.target[data-handleid="${targetHandle}"]`).boundingBox();
      assert(a && b, 'Both connection handles are mounted');
      assert(b.x >= 0 && b.x + b.width <= 1920, 'Target handle is within the viewport');
      await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
      await page.mouse.down(); await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 }); await page.mouse.up();
      await page.screenshot({ path: path.join(out, `drag-${sourceId}-${targetId}.png`) });
    };
    await drag('start_image', 'image', 'clip_1', 'frame_start');
    await page.waitForFunction(() => window.connectionTest.state().edges.some(e => e.source === 'start_image' && e.target === 'clip_1' && e.targetHandle === 'frame_start'));
    await page.evaluate(() => window.connectionTest.removeEdge('clip_2-clip_3-frame_start'));
    await drag('clip_2', 'result', 'clip_3', 'frame_start');
    await page.waitForFunction(() => window.connectionTest.state().edges.some(e => e.source === 'clip_2' && e.target === 'clip_3' && e.targetHandle === 'frame_start'));
    await drag('clip_1', 'result', 'clip_2', 'frame_start');
    await page.getByText(/start frame already has an image/i).waitFor();
    assert.equal(await page.locator('.studio-limit__cta').count(), 0, 'Wiring guidance must not ask for an upgrade');
    assert.equal((await page.evaluate(() => window.connectionTest.state().edges.filter(e => e.target === 'clip_2' && e.targetHandle === 'frame_start'))).length, 1);
    await page.screenshot({ path: path.join(out, 'studio-connections.png'), fullPage: true });
    assert.deepEqual(errors, []);
    console.log('PASS: JSON import; mode-switch wire migration; image-to-Start drag; video-to-next-Start drag; duplicate-slot feedback; no page errors. No generations submitted.');
  } finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
