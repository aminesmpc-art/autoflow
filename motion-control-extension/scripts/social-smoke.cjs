// Real unpacked extension, synthetic social pages/media only. No social login,
// live video download, backend media upload, or AI generation. Profile is temporary.
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const dist = path.resolve(__dirname, '../dist');
const youtube = 'https://www.youtube.com/watch?v=AbCdEfGh_12';
const googleVideo = 'https://r1.googlevideo.com/motion-fixture.webm';
const importServer = 'https://autoflow-extractor-production.up.railway.app/api/imports/video';
const artifacts = path.resolve(__dirname, '../test-artifacts');

function feedFixture() {
  const glyphs = ['M12 20 4 12a5 5 0 0 1 8-6 5 5 0 0 1 8 6Z', 'M4 4h16v12H9l-5 4Z', 'm4 12 9-8v5h7v6h-7v5Z'];
  return `<html><head><style>body{margin:0;background:#080808;color:#fff;font:16px system-ui}article{height:880px;position:relative}video{position:absolute;left:160px;top:24px;width:820px;height:816px;background:linear-gradient(145deg,#71655b,#272522);border-radius:20px;object-fit:contain}.caption{position:absolute;left:180px;top:770px;color:#fff}.rail{position:absolute;right:42px;top:368px;width:60px;height:458px;display:flex;flex-direction:column;justify-content:space-between;align-items:center}.avatar{width:60px;height:60px;border-radius:50%;background:#63504b}.action{text-align:center}button{display:grid;place-items:center;width:60px;height:60px;border:0;border-radius:50%;background:#242424;color:#fff;cursor:pointer}button svg{width:26px;height:26px;fill:none;stroke:currentColor;stroke-width:2}small{display:block;margin-top:8px}@media(max-width:480px){video{left:0;width:100vw;height:80vh}.rail{display:none}.caption{left:12px;top:75vh}}</style></head><body>${['123456789','987654321'].map((id, index) => `<article><video controls></video><a class="caption" href="/@creator/video/${id}">Local feed fixture ${index + 1}</a><div class="rail"><div class="avatar"></div>${['like-icon','comment-icon','share-icon'].map((name, n) => `<div class="action"><button data-e2e="${name}" aria-label="${name}"><svg viewBox="0 0 24 24"><path d="${glyphs[n]}"/></svg></button><small>100</small></div>`).join('')}</div></article>`).join('')}</body></html>`;
}

async function main() {
  const context = await chromium.launchPersistentContext('', {
    executablePath: process.env.EXTENSION_BROWSER_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    headless: true, acceptDownloads: true, args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
  });
  try {
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 15000 });
    const id = new URL(worker.url()).hostname;
    const page = await context.newPage();
    // A self-generated one-second video, not someone else's footage.
    const bytes = await page.evaluate(async () => {
      const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 64;
      const ctx = canvas.getContext('2d');
      const stream = canvas.captureStream(10), recorder = new MediaRecorder(stream, { mimeType: 'video/webm' }), chunks = [];
      recorder.ondataavailable = event => chunks.push(event.data);
      const stopped = new Promise(resolve => recorder.onstop = resolve);
      recorder.start();
      for (let frame = 0; frame < 10; frame++) { ctx.fillStyle = '#b94322'; ctx.fillRect(frame, 0, 32, 32); await new Promise(resolve => setTimeout(resolve, 100)); }
      recorder.stop(); await stopped; stream.getTracks().forEach(track => track.stop());
      return Array.from(new Uint8Array(await new Blob(chunks).arrayBuffer()));
    });
    const requests = [], serverRequests = [];
    await context.route('**/*', route => {
      const url = route.request().url(); requests.push({ url, method: route.request().method() });
      if (url.startsWith(`chrome-extension://${id}/`)) return route.continue();
      if (url === 'https://api.auto-flow.studio/api/auth/me') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ id: 1, email: 'fixture@example.test', email_verified: true }) });
      if (url === importServer && route.request().method() === 'POST') {
        serverRequests.push({ body: route.request().postDataJSON(), authorization: route.request().headers().authorization });
        return route.fulfill({ status: 200, contentType: 'video/webm', body: Buffer.from(bytes) });
      }
      if (url === googleVideo) return route.fulfill({ status: 200, contentType: 'video/webm', body: Buffer.from(bytes) });
      if (url === 'https://www.tiktok.com/foryou') return route.fulfill({ contentType: 'text/html', body: feedFixture() });
      if (url.startsWith('https://www.youtube.com/')) return route.fulfill({ contentType: 'text/html', body: `<html><head><title>Local video fixture</title><style>video{width:360px;height:640px}</style></head><body><video controls src="${googleVideo}"></video><script>var ytInitialPlayerResponse = ${JSON.stringify({ videoDetails: { videoId: 'AbCdEfGh_12' }, playabilityStatus: { status: 'OK' }, streamingData: { formats: [{ url: googleVideo, mimeType: 'video/mp4', audioQuality: 'AUDIO_QUALITY_MEDIUM' }] } })};</script></body></html>` });
      if (url.startsWith('https://www.instagram.com/') || url.startsWith('https://www.tiktok.com/')) return route.fulfill({ contentType: 'text/html', body: '<html><head><style>video{width:360px;height:640px}</style></head><body><video controls></video></body></html>' });
      return route.abort();
    });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize({ width: 420, height: 900 });
    await page.goto(`chrome-extension://${id}/sidepanel.html`);
    await page.getByRole('heading', { name: 'Motion Control', exact: true }).waitFor();
    const site = await context.newPage();
    await site.goto(youtube);
    await site.getByRole('button', { name: 'Use this video in AutoFlow Motion' }).waitFor();
    await site.getByRole('button', { name: 'Use this video in AutoFlow Motion' }).click();
    await page.getByLabel('Video link', { exact: true }).waitFor();
    assert.equal(await page.getByLabel('Video link', { exact: true }).inputValue(), youtube, 'Page badge pre-fills the selected video');
    assert.equal(await page.locator('video[aria-label="Source motion preview"]').count(), 0, 'Selecting a page must not download automatically');
    const metadata = await page.evaluate(async ({ url }) => {
      const [tab] = await chrome.tabs.query({ url: 'https://www.youtube.com/*' });
      return chrome.tabs.sendMessage(tab.id, { type: 'MOTION_SOCIAL_READ', url });
    }, { url: youtube });
    assert.equal(metadata.media.mediaUrl, googleVideo, 'Installed content script reads only the matching video');
    await page.getByLabel('Video link', { exact: true }).fill(youtube);
    await page.getByLabel('Download method', { exact: true }).selectOption('browser');
    assert(await page.getByRole('button', { name: 'Import & download', exact: true }).isDisabled());
    await page.getByRole('checkbox', { name: /I own this video/ }).check();
    await page.getByRole('button', { name: 'Import & download', exact: true }).click();
    await page.getByText(/Imported into Motion\. A copy is saving/).waitFor({ timeout: 45000 });
    await page.getByLabel('Source motion preview', { exact: true }).waitFor();
    // Playwright names saved files by GUID in its temporary download folder;
    // inspect the native download's source rather than that overridden path.
    const downloads = await page.evaluate(async () => chrome.downloads.search({ urlRegex: '^blob:chrome-extension://' }));
    assert(downloads.length > 0, 'Chrome Downloads must receive a copy of the same source');
    assert.notEqual(downloads[0].state, 'interrupted');
    const count = await page.evaluate(async () => (await chrome.tabs.query({ url: 'https://www.youtube.com/*' })).length);
    assert.equal(count, 1, 'An exact existing video tab is reused');
    // The default server path uses an existing account token and sends only
    // link + reuse confirmation. Both account authority and media are fixtures.
    await page.evaluate(async () => chrome.storage.local.set({ autoflow_auth_tokens: { access: 'synthetic-access-token', refresh: 'synthetic-refresh-token' } }));
    await page.getByLabel('Download method', { exact: true }).selectOption('server');
    assert(!(await page.getByRole('checkbox', { name: /I own this video/ }).isChecked()), 'Method changes require renewed permission');
    await page.getByRole('checkbox', { name: /I own this video/ }).check();
    await page.getByRole('button', { name: 'Import & download', exact: true }).click();
    await page.getByText(/Imported into Motion\. A copy is saving/).waitFor({ timeout: 45000 });
    assert.deepEqual(serverRequests, [{ body: { url: youtube, reuse_permission: true }, authorization: 'Bearer synthetic-access-token' }]);
    assert.equal((await page.evaluate(async () => chrome.tabs.query({ url: 'https://www.youtube.com/*' }))).length, 1, 'Server mode opens no extra platform tab');
    await page.evaluate(async () => chrome.storage.local.remove('autoflow_auth_tokens'));
    await site.goto('https://www.instagram.com/reel/AbCd_123/');
    await site.getByRole('button', { name: 'Use this video in AutoFlow Motion' }).waitFor();
    await site.goto('https://www.tiktok.com/@creator/video/123456789');
    await site.getByRole('button', { name: 'Use this video in AutoFlow Motion' }).waitFor();
    await site.goto('https://www.tiktok.com/@creator');
    assert.equal(await site.getByRole('button', { name: 'Use this video in AutoFlow Motion' }).count(), 0, 'No badge on non-video pages');
    await site.setViewportSize({ width: 1100, height: 880 });
    await site.goto('https://www.tiktok.com/foryou');
    const icon = site.getByRole('button', { name: 'Use this video in AutoFlow Motion' });
    await site.locator('#autoflow-motion-import[data-video-id="123456789"][data-placement="rail"]').waitFor();
    const bounds = await icon.boundingBox();
    assert.equal(bounds.width, 48); assert.equal(bounds.height, 48);
    assert(bounds.x > 980 && bounds.y < 368, 'Circular icon sits above the native action column, outside the video');
    assert.equal(await icon.innerText(), '', 'An icon-only action, not the previous text banner');
    await icon.hover();
    await site.waitForTimeout(200);
    assert.equal(await site.getByRole('tooltip').evaluate(el => getComputedStyle(el).opacity), '1');
    fs.mkdirSync(artifacts, { recursive: true });
    await site.screenshot({ path: path.join(artifacts, 'motion-icon-feed-desktop.png') });
    await icon.click();
    await page.waitForFunction(() => document.querySelector('#social-video-url')?.value === 'https://www.tiktok.com/@creator/video/123456789');
    assert(!(await page.getByRole('checkbox', { name: /I own this video/ }).isChecked()), 'A newly selected feed post needs fresh reuse consent');
    await site.evaluate(() => window.scrollTo(0, 880));
    await site.locator('#autoflow-motion-import[data-video-id="987654321"]').waitFor();
    await icon.click();
    await page.waitForFunction(() => document.querySelector('#social-video-url')?.value === 'https://www.tiktok.com/@creator/video/987654321');
    await site.evaluate(() => window.scrollTo(0, 0));
    await site.setViewportSize({ width: 320, height: 700 });
    await site.waitForTimeout(400);
    const narrow = await icon.boundingBox();
    assert(narrow.x >= 12 && narrow.x + narrow.width <= 308, 'Narrow fallback stays fully in the viewport');
    await site.screenshot({ path: path.join(artifacts, 'motion-icon-feed-320.png') });
    assert.deepEqual(errors, []);
    // Account/login widgets can read public auth configuration when Motion
    // opens. They must not be confused with sending video bytes to a server.
    assert(!requests.some(({ url, method }) => /auto-flow\.studio|railway\.app/.test(url) && method !== 'GET' && url !== importServer), 'Import must not upload video bytes, start AI analysis or reserve a generation');
    assert(!requests.some(({ url }) => /\/api\/(videos|clip)\//.test(url)), 'No extractor endpoint is used');
    console.log('Social fixture smoke passed: three platform icons, feed action-rail alignment, hover tooltip, scroll-safe selection, narrow fallback, real messaging, exact-tab reuse, browser-only import and authenticated server fixture import/Downloads. No live platform media tested.');
  } catch (error) {
    const panel = context.pages().find(p => p.url().includes('/sidepanel.html'));
    if (panel) console.error('Fixture panel:', (await panel.locator('body').innerText()).slice(0, 3000));
    throw error;
  } finally { await context.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
