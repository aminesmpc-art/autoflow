#!/usr/bin/env node
/**
 * Fail the build when a copied engine file has drifted from its source.
 *
 * This extension copies its automation engines from the AutoFlow extension and
 * grok-auto rather than sharing them. That was a deliberate choice, and this is
 * the guard that makes it survivable.
 *
 * The failure mode is not hypothetical. grok-auto was copied the same way and
 * went three months and fifteen selector fixes out of date, still shipping a
 * checkout bug that stranded paying customers — silently, because nothing ever
 * said the copy had fallen behind.
 *
 * How it works: engine-sync.json records the hash of each UPSTREAM file at the
 * moment its copy was last reviewed. When upstream changes, this fails and
 * names the file. You then port the change (or decide it doesn't apply) and run
 * with --accept to record the new hash.
 *
 * It deliberately does not compare the copies to each other. They are expected
 * to diverge — this extension trims and adapts them. What must not happen is a
 * fix landing upstream that nobody ever looks at over here.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const MANIFEST = path.join(ROOT, 'engine-sync.json');
const accept = process.argv.includes('--accept');

function sha(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 16);
}

if (!fs.existsSync(MANIFEST)) {
  console.error(`No engine-sync.json at ${MANIFEST}`);
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
const entries = Object.entries(manifest.files || {});

if (entries.length === 0) {
  console.log('engine-sync.json lists no files yet — nothing to check.');
  process.exit(0);
}

const drifted = [];
const missing = [];

for (const [copyPath, info] of entries) {
  const upstream = path.resolve(ROOT, info.from);
  if (!fs.existsSync(upstream)) {
    missing.push(`${copyPath}  (upstream gone: ${info.from})`);
    continue;
  }
  const current = sha(upstream);
  if (current !== info.upstreamSha) {
    drifted.push({ copyPath, from: info.from, was: info.upstreamSha, now: current });
    if (accept) info.upstreamSha = current;
  }
}

if (missing.length) {
  console.error('\nUpstream files no longer exist:\n');
  missing.forEach((m) => console.error('  ' + m));
  console.error('\nUpdate engine-sync.json — a moved file cannot be tracked.\n');
  process.exit(1);
}

if (!drifted.length) {
  console.log(`Engine in sync — ${entries.length} file(s) match their recorded upstream.`);
  process.exit(0);
}

if (accept) {
  fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`Accepted ${drifted.length} upstream change(s):\n`);
  drifted.forEach((d) => console.log(`  ${d.from}`));
  console.log('\nRecorded. Make sure the change was actually ported, not just acknowledged.\n');
  process.exit(0);
}

console.error('\nUPSTREAM CHANGED — these engines have moved on without their copies:\n');
for (const d of drifted) {
  console.error(`  ${d.from}`);
  console.error(`    copy: ${d.copyPath}`);
  console.error(`    ${d.was} -> ${d.now}\n`);
}
console.error('Review each change, port what applies, then run:');
console.error('  npm run check:drift -- --accept\n');
console.error('Skipping this is how grok-auto ended up three months stale.\n');
process.exit(1);
