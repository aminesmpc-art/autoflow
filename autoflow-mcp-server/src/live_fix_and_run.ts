import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import path from 'path';

async function fixAndRun() {
  console.log('=== AutoFlow MCP v2.0 — Live Canvas Fix & Run ===\n');

  const transport = new StdioClientTransport({
    command: 'node',
    args: [path.resolve(__dirname, 'index.js')],
  });

  const client = new Client({ name: 'live-fixer', version: '2.0.0' }, { capabilities: {} });
  await client.connect(transport);

  // ── STEP 1: Diagnose ──
  console.log('━━━ STEP 1: DIAGNOSE CANVAS ━━━');
  const diagRes = await client.callTool({ name: 'studio_diagnose_canvas', arguments: {} });
  console.log(((diagRes as any).content[0] as any)?.text);
  console.log('');

  // ── STEP 2: Get Canvas to understand structure ──
  console.log('━━━ STEP 2: READ CANVAS STATE ━━━');
  const canvasRes = await client.callTool({ name: 'studio_get_canvas', arguments: {} });
  const canvasSummary = ((canvasRes as any).content[0] as any)?.text || '';
  console.log(canvasSummary);
  console.log('');

  // Parse structured data from second content block
  const canvasJson = ((canvasRes as any).content[1] as any)?.text || '{}';
  const canvasMatch = canvasJson.match(/```json\n([\s\S]*?)\n```/);
  const canvasData = canvasMatch ? JSON.parse(canvasMatch[1]) : {};
  const nodes = canvasData?.data?.nodes || [];
  const edges = canvasData?.data?.edges || [];

  // Find key nodes
  const storyNode = nodes.find((n: any) => n.type === 'story' || (n.data as any)?.type === 'story');
  const promptNodes = nodes.filter((n: any) => n.type === 'prompt' || (n.data as any)?.type === 'prompt');
  const genNodes = nodes.filter((n: any) => n.type === 'generate' || (n.data as any)?.type === 'generate');

  console.log(`  Found: ${promptNodes.length} prompt nodes, ${storyNode ? 1 : 0} story director, ${genNodes.length} generators`);

  // ── STEP 3: Auto-Fix (reset errors, inject audio tags) ──
  console.log('\n━━━ STEP 3: AUTO-FIX CANVAS ━━━');
  const fixRes = await client.callTool({ name: 'studio_auto_fix_canvas', arguments: {} });
  console.log(((fixRes as any).content[0] as any)?.text);
  console.log('');

  // ── STEP 4: Wire Story Brief Prompt → Story Director if not connected ──
  if (storyNode && promptNodes.length > 0) {
    const storyId = storyNode.id;
    const hasTextWire = edges.some((e: any) =>
      e.target === storyId && (e.targetHandle === 'text' || !e.targetHandle)
    );

    if (!hasTextWire) {
      // Find the best prompt node (one with actual text content)
      const bestPrompt = promptNodes.find((p: any) => {
        const d = (p.data || {}) as any;
        return (d.text || d.prompt || '').trim().length > 10;
      }) || promptNodes[0];

      console.log('━━━ STEP 4: WIRE PROMPT → STORY DIRECTOR ━━━');
      console.log(`  Connecting: "${(bestPrompt.data as any)?.label || bestPrompt.id}" → "${(storyNode.data as any)?.label || storyNode.id}"`);

      const wireRes = await client.callTool({
        name: 'studio_connect_nodes',
        arguments: {
          source: bestPrompt.id,
          target: storyId,
          sourceHandle: 'text',
          targetHandle: 'text',
        },
      });
      console.log(((wireRes as any).content[0] as any)?.text);
      console.log('');
    } else {
      console.log('━━━ STEP 4: WIRING CHECK ━━━');
      console.log('  Story Director already has a text input wired. Skipping.');
      console.log('');
    }
  }

  // ── STEP 5: Verify post-fix ──
  console.log('━━━ STEP 5: VERIFY POST-FIX DIAGNOSIS ━━━');
  const diag2Res = await client.callTool({ name: 'studio_diagnose_canvas', arguments: {} });
  console.log(((diag2Res as any).content[0] as any)?.text);
  console.log('');

  // ── STEP 6: Run Pipeline ──
  console.log('━━━ STEP 6: RUN PIPELINE ━━━');
  const runRes = await client.callTool({ name: 'studio_run_pipeline', arguments: {} });
  console.log(((runRes as any).content[0] as any)?.text);

  if ((runRes as any).isError) {
    console.log('\n⚠️  Pipeline was BLOCKED by pre-flight check. See errors above.');
  } else {
    console.log('\n✅ Pipeline is running! Check the AutoFlow Studio canvas in Chrome.');
  }

  // ── STEP 7: Quick status snapshot ──
  console.log('\n━━━ STEP 7: PIPELINE STATUS ━━━');
  // Wait 2s for pipeline to initialize
  await new Promise(r => setTimeout(r, 2000));
  const statusRes = await client.callTool({ name: 'studio_get_pipeline_status', arguments: {} });
  console.log(((statusRes as any).content[0] as any)?.text);

  console.log('\n=== Done. Watch the canvas in Chrome for live generation. ===');
  process.exit(0);
}

fixAndRun().catch((e) => { console.error(e); process.exit(1); });
