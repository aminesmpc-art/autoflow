// Fresh, disposable browser profile. No login, uploads, or generation.
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
    await context.setOffline(true);
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 15000 });
    const id = new URL(worker.url()).hostname;
    assert.equal(await worker.evaluate(() => chrome.runtime.getManifest().name), 'AutoFlow Motion — Motion Control');
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.setViewportSize({ width: 420, height: 900 });
    await page.goto(`chrome-extension://${id}/sidepanel.html`);
    await page.getByRole('heading', { name: 'Motion Control', exact: true }).waitFor();
    assert.equal(await page.getByText('Design preview only.', { exact: false }).count(), 0);
    await page.getByLabel('Project name').fill('Smoke project');
    const media = await page.evaluate(async () => {
      const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 64;
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#b94322'; ctx.fillRect(0, 0, 64, 64);
      /* A photo-sized subject (noise does not compress), so the save takes
         the vault path that keeps large media out of chrome.storage. */
      const photo = document.createElement('canvas'); photo.width = 700; photo.height = 700;
      const pctx = photo.getContext('2d'); const pixels = pctx.createImageData(700, 700);
      for (let i = 0; i < pixels.data.length; i++) pixels.data[i] = (i * 2654435761) >>> 24 ^ (i & 255);
      pctx.putImageData(pixels, 0, 0);
      const image = photo.toDataURL('image/png').split(',')[1];
      /* A fresh headless Chrome's first MediaRecorder spends a second or two
         probing the GPU encoder, and a real-time recording made in that window
         can come out with no frames: the source preview then never appears and
         the smoke times out (2 of 5 runs on 2026-10-19). One throwaway
         recording warms the encoder first. */
      {
        const warm = new MediaRecorder(canvas.captureStream(10), { mimeType: 'video/webm' });
        const warmed = new Promise(resolve => warm.onstop = resolve);
        warm.start();
        for (let frame = 0; frame < 15; frame++) {
          ctx.fillRect(frame, 0, 20, 20);
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        warm.stop(); await warmed; warm.stream.getTracks().forEach(track => track.stop());
      }
      const stream = canvas.captureStream(10);
      const recorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
      const chunks = [];
      recorder.ondataavailable = event => chunks.push(event.data);
      const stopped = new Promise(resolve => recorder.onstop = resolve);
      recorder.start();
      for (let frame = 0; frame < 10; frame++) {
        ctx.fillRect(frame, 0, 20, 20);
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      recorder.stop(); await stopped; stream.getTracks().forEach(track => track.stop());
      return { image, video: Array.from(new Uint8Array(await new Blob(chunks).arrayBuffer())) };
    });
    await page.getByLabel('Your character or subject', { exact: true }).setInputFiles({ name: 'test-subject.png', mimeType: 'image/png', buffer: Buffer.from(media.image, 'base64') });
    await page.getByRole('img', { name: 'Your character or subject', exact: true }).waitFor();
    await page.getByLabel('Drop your motion video here', { exact: true }).setInputFiles({ name: 'test-motion.webm', mimeType: 'video/webm', buffer: Buffer.from(media.video) });
    await page.locator('video[aria-label="Source motion preview"]').waitFor();
    await page.getByRole('radio', { name: /Trim start & end/ }).check();
    await page.getByRole('checkbox', { name: /Keep clips consistent/ }).check();
    assert(await page.getByRole('radio', { name: /Portrait/ }).isChecked());
    await page.getByRole('radio', { name: /Landscape/ }).check();
    const trimStart = await page.getByLabel('Start (seconds)', { exact: true }).inputValue();
    const trimEnd = await page.getByLabel('End (seconds)', { exact: true }).inputValue();
    let saved = false;
    for (let attempt = 0; attempt < 50; attempt++) {
      saved = await page.evaluate(async () => {
        const storage = await chrome.storage.local.get(null);
        return Object.values(storage).some(v => v?.name === 'Smoke project' && v.nodes?.[0]?.data?.sourceName === 'test-motion.webm' && /^vault:wf:.*\|image\/png$/.test(v.nodes?.[0]?.data?.subjectImage || '') && v.nodes?.[0]?.data?.motionVideoMode === 'trim' && v.nodes?.[0]?.data?.motionContinuity === true && v.nodes?.[0]?.data?.aspectRatio === '16:9');
      });
      if (saved) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert(saved, 'Project must be persisted, with the photo kept in the vault, before reloading');
    assert(media.image.length > 256 * 1024, 'The smoke photo must be large enough to take the vault path');
    const listed = await page.evaluate(async () => Object.values((await chrome.storage.local.get('studio_index_workflows')).studio_index_workflows || {}).map(w => w.name));
    assert(listed.includes('Smoke project'), 'Saved projects must be listed from the index');
    await page.waitForFunction(async () => (await chrome.storage.local.get('af_debug_upload')).af_debug_upload === true);
    assert(await page.getByRole('checkbox', { name: /Automatic video uploads/ }).isChecked());
    assert.equal(await page.locator('#motion-tabs').inputValue(), 'show');
    if (!await worker.evaluate(() => chrome.extension.isAllowedFileSchemeAccess())) {
      assert.equal(await page.getByRole('button', { name: 'Open extension settings', exact: true }).count(), 1);
      assert(await page.getByText('Enable browser file access', { exact: true }).isVisible());
    }
    assert.equal(await page.evaluate(async () => (await chrome.storage.local.get('af_debug_upload')).af_debug_upload), true);
    await page.getByRole('checkbox', { name: /Automatic video uploads/ }).uncheck();
    await page.reload();
    await page.getByRole('heading', { name: 'Motion Control', exact: true }).waitFor();
    assert.equal(await page.getByRole('checkbox', { name: /Automatic video uploads/ }).isChecked(), false);
    assert.equal(await page.getByLabel('Project name').inputValue(), 'Smoke project');
    assert(await page.getByRole('radio', { name: /Trim start & end/ }).isChecked());
    assert(await page.getByRole('checkbox', { name: /Keep clips consistent/ }).isChecked());
    assert(await page.getByRole('radio', { name: /Landscape/ }).isChecked());
    assert.equal(await page.getByLabel('Start (seconds)', { exact: true }).inputValue(), trimStart);
    assert.equal(await page.getByLabel('End (seconds)', { exact: true }).inputValue(), trimEnd);
    await page.locator('video[aria-label="Source motion preview"]').waitFor();
    await page.getByRole('img', { name: 'Your character or subject', exact: true }).waitFor();
    assert.equal(await page.getByRole('img', { name: 'Your character or subject', exact: true }).getAttribute('src'),
      `data:image/png;base64,${media.image}`, 'The photo must come back from the vault byte for byte');
    await page.getByRole('button', { name: 'Saved projects', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: /Smoke project/ }).click();
    // Closes once the project is loaded, which now includes reading its photo back from the vault.
    await page.getByRole('dialog').waitFor({ state: 'hidden', timeout: 10000 });
    assert.equal(await page.getByRole('dialog').count(), 0);
    const duplicate = await context.newPage();
    await duplicate.goto(`chrome-extension://${id}/sidepanel.html`);
    await duplicate.getByText(/Motion is already open/).waitFor();
    assert(await page.getByRole('button', { name: 'Generate motion' }).isDisabled());
    assert.deepEqual(errors, []);
    const countBefore = await worker.evaluate(async () => ({ tabs: (await chrome.tabs.query({})).length, windows: (await chrome.windows.getAll()).length }));
    await page.evaluate(() => chrome.runtime.sendMessage({ type: 'OPEN_STUDIO' }).catch(() => undefined));
    await page.evaluate(() => chrome.runtime.sendMessage({ type: 'PANEL_OPEN_STUDIO' }).catch(() => undefined));
    const countAfter = await worker.evaluate(async () => ({ tabs: (await chrome.tabs.query({})).length, windows: (await chrome.windows.getAll()).length }));
    assert.deepEqual(countAfter, countBefore, 'Inherited Studio messages must never create a page/window');
    console.log('Extension passed offline: service worker, real local video/image inputs, storage/reload, saved projects, upload consent, duplicate-window lock. No provider generation attempted.');
  } catch (error) {
    const panel = context.pages().find(p => p.url().includes('/sidepanel.html'));
    if (panel) console.error('Offline fixture panel:', (await panel.locator('body').innerText()).slice(0, 2500));
    throw error;
  } finally { await context.close(); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
