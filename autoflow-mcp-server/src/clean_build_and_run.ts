import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import path from 'path';

async function cleanBuildAndRun() {
  console.log('=== AutoFlow v2.0 — Clean Build & Run ===\n');

  const transport = new StdioClientTransport({
    command: 'node',
    args: [path.resolve(__dirname, 'index.js')],
  });

  const client = new Client({ name: 'clean-builder', version: '2.0.0' }, { capabilities: {} });
  await client.connect(transport);

  // ── STEP 1: Clear everything ──
  console.log('━━━ STEP 1: CLEAR CANVAS ━━━');
  const clearRes = await client.callTool({ name: 'studio_clear_canvas', arguments: {} });
  console.log(((clearRes as any).content[0] as any)?.text);
  console.log('');

  // ── STEP 2: Build a fresh story graph (everything pre-wired) ──
  console.log('━━━ STEP 2: CREATE FRESH STORY GRAPH ━━━');
  const createRes = await client.callTool({
    name: 'studio_create_story_graph',
    arguments: {
      brief: 'An adorable thumb-sized baby cinder drake named Emberlyn with shimmering ruby scales, tiny golden wings, and big round amber eyes tries to toast a tiny marshmallow on a twig. She takes a deep breath and hiccups out a burst of sparkling embers instead of fire. She giggles, her tail curling with delight, and tiny glowing fireflies swirl around her.',
      shotCount: 4,
      structure: 'hook',
      camera: 'dynamic',
      audioMode: 'cinematic',
      visualPreset: 'cgi3d',
      aspectRatio: '9:16',
      duration: '6s',
      world: 'A cozy enchanted forest clearing at golden hour with mossy rocks, tiny mushroom houses, and soft firefly light.',
      look: 'Pixar 3D CGI, warm golden volumetric lighting, shallow depth of field, 8K ultra-detailed render, soft bokeh background.',
      cast: [
        {
          name: 'Emberlyn',
          look: 'Thumb-sized baby cinder drake, shimmering ruby red scales with gold shimmer edges, tiny golden translucent wings, big round amber eyes with star-shaped pupils, small curved ivory horns, a curly tail tip that glows orange when happy, wearing a tiny braided flower crown.',
          role: 'protagonist',
          voice: 'Tiny squeaky baby dragon voice, adorable giggles',
        },
      ],
    },
  });
  console.log(((createRes as any).content[0] as any)?.text);
  console.log('');

  // ── STEP 3: Diagnose (should be clean) ──
  console.log('━━━ STEP 3: DIAGNOSE FRESH CANVAS ━━━');
  const diagRes = await client.callTool({ name: 'studio_diagnose_canvas', arguments: {} });
  console.log(((diagRes as any).content[0] as any)?.text);
  console.log('');

  // ── STEP 4: Auto-fix any warnings (audio tags etc) ──
  console.log('━━━ STEP 4: AUTO-FIX (inject audio tags) ━━━');
  const fixRes = await client.callTool({ name: 'studio_auto_fix_canvas', arguments: {} });
  console.log(((fixRes as any).content[0] as any)?.text);
  console.log('');

  // ── STEP 5: Run Pipeline ──
  console.log('━━━ STEP 5: RUN PIPELINE ━━━');
  const runRes = await client.callTool({ name: 'studio_run_pipeline', arguments: {} });
  console.log(((runRes as any).content[0] as any)?.text);

  if ((runRes as any).isError) {
    console.log('\n⛔ Pipeline was BLOCKED. See errors above.');
  } else {
    console.log('\n✅ Pipeline is running! Watch the canvas in Chrome.');
  }

  // ── STEP 6: Status snapshot after 3s ──
  await new Promise(r => setTimeout(r, 3000));
  console.log('\n━━━ STEP 6: PIPELINE STATUS ━━━');
  const statusRes = await client.callTool({ name: 'studio_get_pipeline_status', arguments: {} });
  console.log(((statusRes as any).content[0] as any)?.text);

  console.log('\n=== Done. Canvas is live in Chrome. ===');
  process.exit(0);
}

cleanBuildAndRun().catch((e) => { console.error(e); process.exit(1); });
