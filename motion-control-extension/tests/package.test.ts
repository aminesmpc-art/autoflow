/// <reference types="node" />
import { readFileSync, existsSync, readdirSync } from 'fs';
import { resolve } from 'path';

const root = resolve(__dirname, '..');
const dist = resolve(root, 'dist');
const manifest = JSON.parse(readFileSync(resolve(root, 'manifest.json'), 'utf8'));

test('standalone identity does not impersonate the Studio extension', () => {
  expect(manifest.name).toMatch(/Motion/);
  expect(manifest.key).toBeUndefined();
  expect(manifest.externally_connectable).toBeUndefined();
  expect(manifest.host_permissions).not.toContain('<all_urls>');
  expect(manifest.permissions).not.toContain('activeTab');
  expect(manifest.content_security_policy.extension_pages).not.toMatch(/localhost|127\.0\.0\.1|https:\/\/\*;|unsafe-eval/);
});

test('all declared runtime files exist in the independent build', () => {
  const files = [manifest.background.service_worker, manifest.side_panel.default_path,
    ...Object.values(manifest.icons), ...manifest.content_scripts.flatMap((script: any) => script.js),
    'motion.js', 'motion.css'];
  for (const file of files) expect(existsSync(resolve(dist, file as string))).toBe(true);
  expect(JSON.parse(readFileSync(resolve(dist, 'manifest.json'), 'utf8'))).toEqual(manifest);
});

/* The store rejects a permission the extension requests and never uses, and
   each one needs a justification a reviewer checks against the code. Motion
   shipped `offscreen` (only Studio's background opens that document) and
   `notifications` (only Studio's background run engine sends them; Motion's
   jobs always run in the panel) until 0.1.6. */
test('requests only permissions the shipped code calls', () => {
  const shipped = readdirSync(dist).filter((file) => file.endsWith('.js'))
    .map((file) => readFileSync(resolve(dist, file), 'utf8')).join('\n');
  for (const permission of manifest.permissions as string[]) {
    if (permission === 'unlimitedStorage') expect(shipped).toContain('indexedDB');
    else expect(shipped).toContain(`chrome.${permission}.`);
  }
  expect(manifest.permissions).not.toContain('offscreen');
  expect(manifest.permissions).not.toContain('notifications');
  expect(existsSync(resolve(dist, 'offscreen.html'))).toBe(false);
});

test('content scripts have no lazy script loader pointing at the provider origin', () => {
  for (const file of manifest.content_scripts.flatMap((script: any) => script.js)) {
    const source = readFileSync(resolve(dist, file), 'utf8');
    expect(source).not.toMatch(/Automatic publicPath is not supported|Loading chunk .* failed/);
  }
});

test('workspace HTML uses only bundled executable assets', () => {
  const html = readFileSync(resolve(dist, 'sidepanel.html'), 'utf8');
  expect(html).not.toMatch(/<script[^>]+src=["']https?:/);
  expect(html).toContain('motion.js');
});

test('only the working side panel is shipped, not a Studio page or launcher', () => {
  expect(manifest.side_panel.default_path).toBe('sidepanel.html');
  expect(manifest.action.default_popup).toBeUndefined();
  expect(manifest.web_accessible_resources).toBeUndefined();
  expect(existsSync(resolve(dist, 'studio.html'))).toBe(false);
  expect(existsSync(resolve(dist, 'launcher.js'))).toBe(false);
  expect(readFileSync(resolve(dist, 'flow-content.js'), 'utf8')).not.toContain('af-open-studio-btn');
});

/* ── The icons ────────────────────────────────────────────────────────────
   Motion used to ship Studio's icons, copied by the build. Installed side by
   side, the two were the same square in the toolbar. */
const png = (file: string) => {
  const b = readFileSync(file);
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20), colourType: b[25], bytes: b };
};

test('ships its own icons, not Studio\'s', () => {
  for (const [size, file] of Object.entries(manifest.icons) as [string, string][]) {
    const ours = png(resolve(dist, file));
    const studio = resolve(root, '../studio-extension', file);
    if (existsSync(studio)) expect(ours.bytes.equals(readFileSync(studio))).toBe(false);
    /* The size its name promises, with an alpha channel — transparent corners,
       where Studio's are painted opaque and show square on a light toolbar. */
    expect([ours.width, ours.height]).toEqual([Number(size), Number(size)]);
    expect(ours.colourType).toBe(6);
  }
});

test('gives the toolbar a real 2x icon rather than a scaled 48', () => {
  expect(manifest.action.default_icon['32']).toBe('icons/icon32.png');
  expect(manifest.icons['32']).toBe('icons/icon32.png');
});

test('draws the header mark with the icon\'s own chevrons', () => {
  const { chevrons } = require('../scripts/make-icons.cjs');
  const { BRAND_CHEVRONS } = require('../src/BrandMark');
  const master = chevrons(12, 104);
  expect([...BRAND_CHEVRONS]).toEqual([master.a, master.b]);
});
