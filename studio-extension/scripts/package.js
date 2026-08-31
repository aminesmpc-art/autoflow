/**
 * Zip the built extension for loading or uploading.
 *
 * `dist/` is already the whole package — webpack copies the manifest, the HTML,
 * the icons and the assets in beside the bundles, and every path in the
 * manifest is flat. So packaging is zipping that folder and nothing else.
 *
 * Two things it does beyond zipping:
 *
 *   · it CHECKS the manifest first, following every path it names — service
 *     worker, content scripts, icons, side panel, web-accessible resources —
 *     and refuses to produce a zip with a hole in it. A missing content script
 *     does not fail at load time; it fails when somebody opens the one site
 *     that needed it, which is a much worse place to find out.
 *
 *   · it names the file after the version in the manifest, so two builds are
 *     never the same filename with different contents.
 *
 * Run it with `npm run package`.
 */

/// <reference types="node" />

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');

function fail(message) {
  console.error(`\n  ✗ ${message}\n`);
  process.exit(1);
}

if (!fs.existsSync(path.join(dist, 'manifest.json'))) {
  fail('dist/manifest.json is missing — run `npm run build:publish` first.');
}

const manifest = JSON.parse(fs.readFileSync(path.join(dist, 'manifest.json'), 'utf8'));

/* Every path the manifest promises the browser will be there. */
const promised = [];
const add = (p) => { if (p && !p.includes('*')) promised.push(p); };

add(manifest.background?.service_worker);
add(manifest.side_panel?.default_path);
for (const entry of manifest.content_scripts || []) {
  for (const js of entry.js || []) add(js);
  for (const css of entry.css || []) add(css);
}
for (const icon of Object.values(manifest.icons || {})) add(icon);
for (const icon of Object.values(manifest.action?.default_icon || {})) add(icon);
for (const war of manifest.web_accessible_resources || []) {
  for (const resource of war.resources || []) add(resource);
}

const missing = [...new Set(promised)].filter((p) => !fs.existsSync(path.join(dist, p)));
if (missing.length) {
  fail(`the manifest names files that are not in dist:\n    ${missing.join('\n    ')}`);
}

/* Source maps are a debugging aid and a way to hand out the source. Neither
   belongs in a package somebody is going to publish. */
const maps = fs.readdirSync(dist).filter((f) => f.endsWith('.map'));
if (maps.length) {
  fail(`${maps.length} source map(s) in dist — build with \`npm run build:publish\`.`);
}

const name = `autoflow-studio-${manifest.version}.zip`;
const out = path.join(root, name);
if (fs.existsSync(out)) fs.rmSync(out);

/* PowerShell's own compressor, so this needs nothing installed. The contents of
   dist go in at the ROOT of the zip, not inside a dist/ folder — Chrome expects
   the manifest at the top level, and a nested one is the commonest way a
   perfectly good build refuses to load. */
execFileSync('powershell', [
  '-NoProfile', '-NonInteractive', '-Command',
  `Compress-Archive -Path '${path.join(dist, '*')}' -DestinationPath '${out}' -Force`,
], { stdio: 'inherit' });

const size = fs.statSync(out).size;
console.log(`\n  ${name}  ${(size / 1024 / 1024).toFixed(2)} MB`);
console.log(`  ${[...new Set(promised)].length} manifest paths checked, all present`);
console.log(`  load it with chrome://extensions → Load unpacked → dist/`);
console.log(`  or upload the zip to the Web Store\n`);
