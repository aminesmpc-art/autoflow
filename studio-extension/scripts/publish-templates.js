#!/usr/bin/env node
/* ============================================================
   Export the bundled templates to JSON, and optionally publish them.

     npm run templates:export        write dist-templates/templates.json
     npm run templates:publish       export, then POST it to the backend

   Authoring stays in src/studio/templates/index.ts — TypeScript, type-checked,
   covered by templates.test.ts. This turns that into the payload the extension
   fetches, so adding a template stops costing a Chrome Web Store review.

   Nothing is published that has not passed the same validation the tests run.
   That check is the only thing standing between a typo and every user's
   gallery: store review is slow, but it is review, and this pipeline has none.

   The publish token is read from AUTOFLOW_ADMIN_TOKEN and never written
   anywhere. It must not exist inside the extension.
   ============================================================ */

const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'dist-templates');
const OUT_FILE = path.join(OUT_DIR, 'templates.json');
const SCHEMA_VERSION = 1;

/**
 * Read the TypeScript sources without a compiler subprocess.
 *
 * transpileModule strips types and emits CommonJS in-process — no tsc
 * invocation, no tsconfig, nothing to go wrong differently on Windows. Type
 * checking is not this script's job: `npm run build` already does that, and
 * the validation below is what actually protects the payload.
 *
 * This works because both files import types only, so nothing survives
 * erasure that would need resolving.
 */
function loadSources() {
  const tmp = path.join(ROOT, 'node_modules', '.cache', 'template-export');
  fs.mkdirSync(tmp, { recursive: true });

  const compile = (rel) => {
    const src = fs.readFileSync(path.join(ROOT, 'src/studio/templates', rel + '.ts'), 'utf8');
    const { outputText } = ts.transpileModule(src, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
      fileName: rel + '.ts',
    });
    const out = path.join(tmp, rel + '.js');
    fs.writeFileSync(out, outputText);
    return out;
  };

  // validate first: index does not import it, but requiring in dependency
  // order keeps a future import from surprising us.
  const validatePath = compile('validate');
  const indexPath = compile('index');
  return {
    validate: require(validatePath),
    templates: require(indexPath),
  };
}

/**
 * What a template needs from the build that renders it.
 *
 * Derived from the template itself rather than typed by hand, because a
 * hand-maintained list is a list that goes stale — and a template claiming it
 * needs less than it does is exactly the failure the gate exists to prevent.
 */
function deriveRequirements(tpl) {
  const nodeTypes = [...new Set(tpl.nodes.map((n) => n.type))].sort();
  const platforms = [...new Set(
    tpl.nodes.map((n) => n.data && n.data.platform).filter(Boolean)
  )].sort();

  /* Version floors for capabilities that are not expressible as a node type.
     Anything absent from here needs no floor. */
  const FLOORS = [
    // Last Frame nodes; a build before this cannot draw one.
    { when: () => nodeTypes.includes('frame'), version: '0.6.0' },
    // The Gemini adapter.
    { when: () => platforms.includes('gemini'), version: '0.8.0' },
  ];
  const floors = FLOORS.filter((f) => f.when()).map((f) => f.version);
  const minExtensionVersion = floors.length
    ? floors.sort((a, b) => (validateMod.compareVersions(a, b)))[floors.length - 1]
    : undefined;

  return {
    requiresNodeTypes: nodeTypes,
    ...(platforms.length ? { requiresPlatforms: platforms } : {}),
    ...(minExtensionVersion ? { minExtensionVersion } : {}),
  };
}

/**
 * Inline card artwork as a data URI.
 *
 * A bundled template resolves `assets/templates/x.svg` against studio.html.
 * A cloud template has no such folder to resolve against, and a remote URL
 * would add a request, a CSP rule and a way to fail. These files are ~2KB.
 */
function inlineArtwork(tpl) {
  if (!tpl.thumbnailImage || tpl.thumbnailImage.startsWith('data:')) return tpl.thumbnailImage;
  const file = path.join(ROOT, tpl.thumbnailImage);
  if (!fs.existsSync(file)) {
    console.warn(`  ! ${tpl.id}: artwork ${tpl.thumbnailImage} does not exist — card will fall back to its emoji`);
    return undefined;
  }
  const svg = fs.readFileSync(file);
  return `data:image/svg+xml;base64,${svg.toString('base64')}`;
}

let validateMod;

function main() {
  const { templates: mod, validate } = loadSources();
  validateMod = validate;

  const source = mod.BUILTIN_TEMPLATES;
  if (!Array.isArray(source) || !source.length) {
    console.error('No templates found in BUILTIN_TEMPLATES.');
    process.exit(1);
  }

  console.log(`Validating ${source.length} template(s)...`);
  const out = [];
  let bad = 0;

  for (const tpl of source) {
    const problems = validate.validateTemplate(tpl);
    if (problems.length) {
      bad++;
      console.error(`  ✗ ${tpl.id}\n      - ${problems.join('\n      - ')}`);
      continue;
    }
    console.log(`  ✓ ${tpl.id}`);
    out.push({
      ...tpl,
      ...deriveRequirements(tpl),
      thumbnailImage: inlineArtwork(tpl),
      tier: tpl.tier || 'free',
    });
  }

  if (bad) {
    // Publishing a partial set would silently remove templates from every
    // user's gallery. Fix it and run again.
    console.error(`\n${bad} template(s) failed validation. Nothing was written.`);
    process.exit(1);
  }

  const payload = {
    schemaVersion: SCHEMA_VERSION,
    publishedAt: new Date().toISOString(),
    templates: out,
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(payload, null, 2));
  const kb = Math.round(fs.statSync(OUT_FILE).size / 1024);
  console.log(`\nWrote ${OUT_FILE} — ${out.length} templates, ${kb}KB`);

  if (!process.argv.includes('--publish')) {
    console.log('Dry run. Add --publish to send it to the backend.');
    return;
  }

  const token = process.env.AUTOFLOW_ADMIN_TOKEN;
  if (!token) {
    console.error('AUTOFLOW_ADMIN_TOKEN is not set — refusing to publish.');
    process.exit(1);
  }

  const base = process.env.AUTOFLOW_API_BASE || 'https://api.auto-flow.studio';
  fetch(`${base}/api/templates/publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  })
    .then(async (res) => {
      const body = await res.text();
      if (!res.ok) {
        console.error(`Publish failed: HTTP ${res.status}\n${body}`);
        process.exit(1);
      }
      console.log(`Published ${out.length} templates to ${base}`);
      console.log(body);
    })
    .catch((e) => {
      console.error(`Publish failed: ${e.message}`);
      process.exit(1);
    });
}

main();
