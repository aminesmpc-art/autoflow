// Local-only UI verification. No provider requests or generation.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const os = require('node:os');
const playwrightPath = process.env.PLAYWRIGHT_PATH || path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const { chromium } = require(playwrightPath);
const root = path.resolve(__dirname, '../dist');
const artifacts = path.resolve(__dirname, '../test-artifacts');
const executablePath = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';

async function main() {
  fs.mkdirSync(artifacts, { recursive: true });
  const server = http.createServer((req, res) => {
    const file = path.resolve(root, '.' + new URL(req.url, 'http://localhost').pathname);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end(); return; }
    const types = { '.js': 'application/javascript', '.css': 'text/css', '.html': 'text/html', '.png': 'image/png' };
    res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ executablePath, headless: true });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/*', route => route.request().url().startsWith('http://127.0.0.1:') ? route.continue() : route.abort());
    const url = `http://127.0.0.1:${server.address().port}/sidepanel.html`;
    await page.goto(url);
    await page.getByRole('heading', { name: 'Motion Control', exact: true }).waitFor();
    assert(await page.getByRole('button', { name: 'Generate motion' }).isDisabled());
    const continuityOption = page.getByRole('checkbox', { name: /Keep clips consistent/ });
    assert(!(await continuityOption.isChecked()), 'Continuity is off by default');
    await continuityOption.check();
    assert(await page.getByText(/Clips run in order/).isVisible());
    await continuityOption.uncheck();
    const lipSyncOption = page.getByRole('checkbox', { name: /Keep exact lip sync/ });
    assert(!(await lipSyncOption.isChecked()), 'Lip sync is off by default');
    const landscape = page.getByRole('radio', { name: /Landscape/ });
    await landscape.check();
    assert(await landscape.isChecked());
    await landscape.focus();
    await page.keyboard.press('ArrowLeft');
    assert(await page.getByRole('radio', { name: /Portrait/ }).isChecked(), 'Format picker supports native keyboard navigation');
    const linkImport = page.getByRole('button', { name: /Import a video link/ });
    await linkImport.click();
    await page.getByLabel('Video link', { exact: true }).fill('https://www.tiktok.com/@creator/video/123456789');
    assert(await page.getByRole('button', { name: 'Import & download', exact: true }).isDisabled(), 'Import requires reuse permission');
    await page.getByRole('checkbox', { name: /I own this video/ }).check();
    await page.getByRole('button', { name: 'Import & download', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'Load AutoFlow Motion in Chrome' }).waitFor();
    for (const colorScheme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme });
      for (const width of [320, 420]) {
        await page.setViewportSize({ width, height: 900 });
        await page.screenshot({ path: path.join(artifacts, `social-import-${width}-${colorScheme}.png`), fullPage: true });
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Social import overflow at ${width} ${colorScheme}`);
      }
    }
    await linkImport.click();
    await page.emulateMedia({ colorScheme: 'light' });
    await page.evaluate(() => { document.activeElement?.blur(); window.scrollTo(0, 0); });
    for (const width of [1440, 768, 420, 375, 320]) {
      await page.setViewportSize({ width, height: 1050 });
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: path.join(artifacts, `workspace-${width}.png`), fullPage: true });
      if (width === 420) await page.screenshot({ path: path.join(artifacts, 'panel-420-light.png') });
      const overflow = await page.evaluate(() => Array.from(document.querySelectorAll('body *')).filter(el => el.getBoundingClientRect().right > innerWidth + 1).map(el => el.tagName + '.' + el.className));
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Horizontal overflow at ${width}: ${overflow.join(', ')}`);
      assert((await page.getByRole('button', { name: 'Generate motion' }).boundingBox()).height >= 44, `Generate keeps its 44px target at ${width}`);
    }
    /* The panel follows Chrome's theme, so the dark palette is checked at a
       real panel width too — for overflow and for a capture to look at. */
    await page.emulateMedia({ colorScheme: 'dark' });
    /* Let the theme change finish. Buttons and tabs fade their background over
       150ms, so a capture taken at once caught them half-way between the two
       palettes — a pale grey "Create" tab that never exists on screen. */
    await page.waitForTimeout(400);
    for (const width of [420, 320]) {
      await page.setViewportSize({ width, height: 1050 });
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: path.join(artifacts, `workspace-${width}-dark.png`), fullPage: true });
      if (width === 420) await page.screenshot({ path: path.join(artifacts, 'panel-420-dark.png') });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Horizontal overflow in dark at ${width}`);
    }
    await page.emulateMedia({ colorScheme: 'light' });
    await page.setViewportSize({ width: 1440, height: 1050 });
    await page.getByRole('radio', { name: /Replace subject/ }).check();
    assert(await page.getByText('Required', { exact: true }).isVisible());
    await page.getByText('Advanced controls', { exact: true }).click();
    await page.getByLabel('AI analysis engine').selectOption('claude');
    assert(await page.getByRole('link', { name: /Claude/ }).isVisible());
    await page.getByRole('checkbox', { name: /Remove source audio/ }).check();
    /* Lip sync with the audio removed: the clips are silent, so the panel says
       the mouths still follow the video and the sound goes back on later. */
    await page.getByRole('checkbox', { name: /Keep exact lip sync/ }).check();
    assert(await page.getByText(/Clips come back silent, with the mouths still moving/).isVisible(), 'Lip sync + silent explains itself');
    await page.getByRole('checkbox', { name: /Keep exact lip sync/ }).uncheck();
    assert(!(await page.getByText(/Clips come back silent, with the mouths still moving/).isVisible()), 'The note goes with the switch');
    await page.getByLabel('Your character or subject', { exact: true }).setInputFiles({ name: 'invalid.txt', mimeType: 'text/plain', buffer: Buffer.from('invalid') });
    await page.getByRole('alert').filter({ hasText: 'Choose a PNG' }).waitFor();
    await page.getByRole('button', { name: /Your results/ }).click();
    await page.getByRole('heading', { name: 'Your next performance starts here.' }).waitFor();
    /* The header's account button — the checklist has a contextual "Sign in" of its own. */
    await page.getByRole('banner').getByRole('button', { name: /Sign in/ }).click();
    await page.getByRole('button', { name: 'Create an AutoFlow account', exact: true }).click();
    await page.getByRole('heading', { name: 'Create your account', exact: true }).waitFor();
    assert.equal(await page.getByRole('link', { name: /Create.*account/ }).count(), 0);
    for (const colorScheme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme });
      for (const width of [320, 420]) {
        await page.setViewportSize({ width, height: 650 });
        await page.screenshot({ path: path.join(artifacts, `signup-${width}-${colorScheme}.png`), fullPage: true });
        assert(await page.getByRole('dialog').evaluate(el => el.scrollWidth <= el.clientWidth), `Signup overflows at ${width} ${colorScheme}`);
      }
    }
    await page.getByRole('button', { name: 'Already have an account? Sign in', exact: true }).click();
    await page.getByLabel('Email', { exact: true }).fill('preview@example.test');
    await page.getByLabel('Password', { exact: true }).fill('preview-only');
    await page.getByRole('dialog').getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'Load this extension' }).waitFor();
    await page.keyboard.press('Escape');
    assert.equal(await page.getByRole('dialog').count(), 0);
    if (process.env.MOTION_TRIM_FIXTURE) {
      await page.getByRole('button', { name: 'Create', exact: true }).click();
      await page.getByLabel('Drop your motion video here', { exact: true }).setInputFiles(process.env.MOTION_TRIM_FIXTURE);
      await page.getByRole('radio', { name: /Keep full video/ }).waitFor();
      assert(await page.getByText(/11s · 2 clips/).isVisible());
      const sourcePlayer = page.getByLabel('Source motion preview', { exact: true });
      const compactHeight = await sourcePlayer.evaluate(el => el.clientHeight);
      await page.getByRole('button', { name: 'Expand video preview', exact: true }).click();
      assert(await sourcePlayer.evaluate(el => el.clientHeight) > compactHeight, 'Expand preview increases the player height');
      await page.getByRole('button', { name: 'Compact video preview', exact: true }).click();
      assert.equal(await sourcePlayer.evaluate(el => el.clientHeight), compactHeight);
      await page.getByRole('radio', { name: /Trim start & end/ }).check();
      assert.equal(await page.getByLabel('Start (seconds)', { exact: true }).inputValue(), '0.5');
      assert.equal(await page.getByLabel('End (seconds)', { exact: true }).inputValue(), '10.5');
      assert(await page.getByRole('status').filter({ hasText: '10s selected · 1 clip' }).isVisible());
      for (const colorScheme of ['light', 'dark']) {
        await page.emulateMedia({ colorScheme });
        for (const width of [320, 420]) {
          await page.setViewportSize({ width, height: 1050 });
          await page.locator('#step-video').scrollIntoViewIfNeeded();
          await page.screenshot({ path: path.join(artifacts, `trim-${width}-${colorScheme}.png`), fullPage: true });
          assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Trim overflows at ${width} ${colorScheme}`);
        }
      }
      await page.getByRole('button', { name: 'Keep end', exact: true }).click();
      assert.equal(await page.getByLabel('Start (seconds)', { exact: true }).inputValue(), '1');
      await page.getByLabel('Start (seconds)', { exact: true }).fill('9');
      await page.getByLabel('End (seconds)', { exact: true }).fill('10');
      const player = page.getByLabel('Source motion preview', { exact: true });
      await page.getByRole('button', { name: 'Preview', exact: true }).click();
      await page.waitForTimeout(1600);
      const stopped = await player.evaluate(video => ({ at: video.currentTime, paused: video.paused }));
      assert(stopped.paused && Math.abs(stopped.at - 10) < 0.05, `Preview did not stop at selected end: ${JSON.stringify(stopped)}`);
      await page.getByLabel('End (seconds)', { exact: true }).fill('8');
      await page.getByRole('alert').filter({ hasText: 'End must be after start' }).waitFor();
      await page.getByRole('radio', { name: /Keep full video/ }).check();
      assert.equal(await page.getByLabel('Start (seconds)', { exact: true }).count(), 0);
      assert(await page.getByText(/11s · 2 clips/).isVisible());
      console.log('Trim UI passed: real 11s file, center/end shortcuts, exact inputs, 1-clip count, light/dark 320/420px, preview stops at end, invalid range, full-video restore.');
    }
    if (process.env.MOTION_LONG_TRIM_FIXTURE) {
      await page.getByRole('button', { name: 'Create', exact: true }).click();
      await page.getByLabel('Drop your motion video here', { exact: true }).setInputFiles(process.env.MOTION_LONG_TRIM_FIXTURE);
      await page.getByText(/41s · 5 clips/).waitFor();
      await page.getByRole('radio', { name: /Trim start & end/ }).check();
      await page.getByRole('status').filter({ hasText: '40s selected · 4 clips' }).waitFor();
      await page.getByLabel('End (seconds)', { exact: true }).fill('30.5');
      await page.getByRole('status').filter({ hasText: '30s selected · 3 clips' }).waitFor();
      await page.setViewportSize({ width: 320, height: 1050 });
      await page.locator('#video-range').screenshot({ path: path.join(artifacts, 'trim-three-clips.png') });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Long trim overflows at 320px');
      await page.getByRole('button', { name: 'Keep end', exact: true }).click();
      assert.equal(await page.getByLabel('Start (seconds)', { exact: true }).inputValue(), '1');
      assert.equal(await page.getByLabel('End (seconds)', { exact: true }).inputValue(), '41');
      await page.getByRole('status').filter({ hasText: '40s selected · 4 clips' }).waitFor();
      const startHandle = page.getByRole('slider', { name: 'Trim start position', exact: true });
      await startHandle.focus();
      await page.keyboard.press('ArrowRight');
      assert.equal(await page.getByLabel('Start (seconds)', { exact: true }).inputValue(), '1.001');
      const box = await startHandle.boundingBox();
      const x = box.x + 9 + (1.001 / 41) * (box.width - 18);
      await page.mouse.move(x, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(x + 25, box.y + box.height / 2, { steps: 5 });
      await page.mouse.up();
      assert(Number(await page.getByLabel('Start (seconds)', { exact: true }).inputValue()) > 1.1, 'Timeline handle must drag');
      await page.getByRole('button', { name: 'Reset trim', exact: true }).click();
      assert.equal(await page.getByLabel('Start (seconds)', { exact: true }).inputValue(), '0');
      assert.equal(await page.getByLabel('End (seconds)', { exact: true }).inputValue(), '41');
      assert(await page.getByRole('button', { name: 'Reset trim', exact: true }).isDisabled());
      console.log('Long trim UI passed: real 41s source, 5 full clips → 4 trimmed clips → 3 custom clips, 320px layout and Keep end.');
    }
    /* Synthetic saved results only: exercise navigation and filtering without
       calling any provider or charging a generation. */
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await page.getByRole('navigation', { name: 'Setup sections' }).getByRole('button', { name: /Direction/ }).click();
    await page.getByRole('radio', { name: /Restyle video/ }).check();
    // Each mode card carries its own description; the chosen one says what it keeps and changes.
    assert(await page.locator('.mode.is-selected').getByText('Keeps the movement. Changes the whole look.', { exact: true }).isVisible());
    await page.evaluate(async () => {
      const { store, id } = globalThis.__motionPreview;
      const canvas = document.createElement('canvas'); canvas.width = 270; canvas.height = 480;
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#334155'; ctx.fillRect(0, 0, 270, 480);
      ctx.fillStyle = '#fb923c'; ctx.fillRect(100, 120, 70, 200);
      const base = { of: 3, seconds: 10, cutsSpeech: false, filename: 'preview.mp4', prompt: 'Keep the movement and camera. Use the reference character.', why: 'UI fixture only.' };
      // Synthetic generated-output fixture: 3s red, then 3s blue. The recovery
      // assertion must get the blue frame, never the red opening.
      // Encoded at fixed timestamps, not recorded live. In a fresh headless
      // Chrome, MediaRecorder took up to 1.4s to start while Chrome probed the
      // GPU's video encoders, so the 1.2s recording this used to make sometimes
      // stopped first and came out as an empty webm. Software VP8 skips the
      // probe, and every run produces the same bytes.
      // No Duration element, as a live recorder writes it, and longer than Chrome
      // reads ahead, so its length is only found by reading to the end.
      const film = document.createElement('canvas'); film.width = 64; film.height = 64;
      const paint = film.getContext('2d'), blocks = [];
      const encoder = new VideoEncoder({ output: chunk => { const data = new Uint8Array(chunk.byteLength); chunk.copyTo(data); blocks.push({ ms: chunk.timestamp / 1000, key: chunk.type === 'key', data }); }, error: e => { throw e; } });
      encoder.configure({ codec: 'vp8', width: 64, height: 64, bitrate: 100_000, framerate: 10, hardwareAcceleration: 'prefer-software' });
      for (let frame = 0; frame < 60; frame++) {
        paint.fillStyle = frame < 30 ? '#ff0000' : '#0000ff'; paint.fillRect(0, 0, 64, 64);
        const still = new VideoFrame(film, { timestamp: frame * 100_000, duration: 100_000 });
        encoder.encode(still, { keyFrame: frame % 30 === 0 }); still.close();
      }
      await encoder.flush(); encoder.close();
      // Minimal WebM: each EBML element is its ID, an 8-byte size, then the payload.
      const el = (id, ...parts) => { const body = parts.flatMap(part => [...part]), n = body.length; return [...id, 1, 0, 0, 0, n >>> 24 & 255, n >>> 16 & 255, n >>> 8 & 255, n & 255, ...body]; };
      const uint = (id, n) => el(id, [n >>> 24 & 255, n >>> 16 & 255, n >>> 8 & 255, n & 255]);
      const text = (id, s) => el(id, [...s].map(c => c.charCodeAt(0)));
      const webm = new Uint8Array([
        ...el([0x1a, 0x45, 0xdf, 0xa3], text([0x42, 0x82], 'webm'), uint([0x42, 0x87], 2), uint([0x42, 0x85], 2)),
        ...el([0x18, 0x53, 0x80, 0x67],
          el([0x15, 0x49, 0xa9, 0x66], uint([0x2a, 0xd7, 0xb1], 1e6)), // Info: millisecond timecodes, no Duration
          el([0x16, 0x54, 0xae, 0x6b], el([0xae], uint([0xd7], 1), uint([0x73, 0xc5], 1), uint([0x83], 1), text([0x86], 'V_VP8'), el([0xe0], uint([0xb0], 64), uint([0xba], 64)))),
          el([0x1f, 0x43, 0xb6, 0x75], uint([0xe7], 0), ...blocks.map(b => el([0xa3], [0x81, b.ms >>> 8 & 255, b.ms & 255, b.key ? 0x80 : 0], b.data)))),
      ]);
      const videoUrl = await new Promise(resolve => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.readAsDataURL(new Blob([webm], { type: 'video/webm' })); });
      store.getState().updateNodeData(id, { motionContinuity: true, motionPieces: [
        { ...base, index: 1, startSec: 0, endSec: 10, status: 'done', posterUrl: canvas.toDataURL(), videoUrl, continuityVersion: 'fixture-v1', uploaded: true },
        { ...base, index: 2, startSec: 10, endSec: 20, status: 'error', errorMessage: 'The upload failed. Retry this piece to resume.', uploaded: false },
        { ...base, index: 3, startSec: 20, endSec: 30, status: 'idle' },
      ] });
    });
    await page.getByRole('button', { name: /Your results/ }).click();
    await page.getByRole('button', { name: 'Recover ending frame', exact: true }).click();
    const recovered = page.getByRole('img', { name: 'Ending frame for piece 1', exact: true });
    await recovered.waitFor();
    await recovered.evaluate(img => img.decode());
    const pixel = await recovered.evaluate(img => { const c = document.createElement('canvas'); c.width = 1; c.height = 1; const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0, 1, 1); return Array.from(ctx.getImageData(0, 0, 1, 1).data); });
    assert(pixel[2] > 200 && pixel[0] < 30, `Recovery must use the blue ending, not the red opening: ${pixel}`);
    assert.equal(await page.getByRole('article', { name: 'Piece 1', exact: true }).getByText('Complete', { exact: true }).count(), 1, 'Frame recovery preserves completion');
    const second = page.getByRole('article', { name: 'Piece 2', exact: true });
    await second.getByRole('checkbox', { name: /Start new scene/ }).check();
    assert(await second.getByText('No previous ending frame attached', { exact: true }).isVisible());
    await second.getByRole('checkbox', { name: /Start new scene/ }).uncheck();
    assert(await second.getByText('Previous ending frame ready', { exact: true }).isVisible());
    const filters = page.getByRole('navigation', { name: 'Filter clips' });
    assert.equal(await page.getByRole('article').count(), 3);
    await filters.getByRole('button', { name: /Needs attention/ }).click();
    assert.equal(await page.getByRole('article').count(), 1);
    assert(await page.getByRole('article', { name: 'Piece 2', exact: true }).isVisible());
    await filters.getByRole('button', { name: /Ready/ }).click();
    assert.equal(await page.getByRole('article').count(), 1);
    assert(await page.getByRole('article', { name: 'Piece 1', exact: true }).isVisible());
    await filters.getByRole('button', { name: /All clips/ }).click();
    for (const colorScheme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme });
      for (const width of [320, 420]) {
        await page.setViewportSize({ width, height: 1050 });
        await page.screenshot({ path: path.join(artifacts, `results-${width}-${colorScheme}.png`), fullPage: true });
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Results overflow at ${width} ${colorScheme}`);
      }
    }
    await page.evaluate(() => globalThis.__motionPreview.store.setState({ isRunning: true }));
    assert(await filters.getByRole('button', { name: /Ready/ }).isDisabled());
    assert.equal(await page.getByRole('article').count(), 3, 'An active run always shows all clips');
    assert(await second.getByRole('checkbox', { name: /Start new scene/ }).isDisabled());
    await page.evaluate(() => globalThis.__motionPreview.store.setState({ isRunning: false }));
    console.log('Workspace refresh passed: compact/expanded preview, setup navigation, transformation descriptions, result filters, running locks, light/dark 320/420px results. Continuity: opt-in, real end-frame recovery from a webm with no declared length (blue ending, not red opening), scene reset, completed clip preserved.');
    assert.deepEqual(errors, []);
    console.log('UI passed: five responsive widths (including 320px panel), references, advanced settings, upload rejection, results and sign-in preview. No external requests allowed.');
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
