/* ============================================================
   Story Director Prompt Inspector & Deep Analyzer
   Polls the active canvas until Story Director finishes,
   extracts all generated prompts, and performs deep analysis.
   ============================================================ */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import path from 'path';

async function waitAndAnalyze() {
  console.log('🔍 Connecting to AutoFlow MCP Server to inspect Story Director output...');

  const transport = new StdioClientTransport({
    command: 'node',
    args: [path.resolve(__dirname, 'index.js')],
  });

  const client = new Client(
    { name: 'director-prompt-analyzer', version: '1.0.0' },
    { capabilities: {} }
  );

  await client.connect(transport);
  console.log('✅ Connected over Stdio!\n');

  let canvasData: any = null;
  let storyNode: any = null;

  // Poll for up to 30 seconds for Story Director to complete or have prompts
  for (let i = 0; i < 15; i++) {
    const canvasRes = await client.callTool({
      name: 'studio_get_canvas',
      arguments: {},
    });

    canvasData = JSON.parse(((canvasRes as any).content[0] as any)?.text || '{}');
    const nodes = canvasData.nodes || [];
    storyNode = nodes.find((n: any) => n.type === 'story' || n.data?.type === 'story');

    const status = storyNode?.data?.status;
    const titles = storyNode?.data?.shotTitles || [];
    const prompts = storyNode?.data?.shotPrompts || [];

    console.log(`⏱️ Check ${i + 1}/15: Story Director Status: [${status || 'unknown'}] | Written Prompts: ${prompts.length}`);

    if (prompts.length > 0) {
      console.log('🎉 Story Director has finalized prompts!\n');
      break;
    }

    await new Promise((r) => setTimeout(r, 2000));
  }

  const nodes = canvasData?.nodes || [];
  const titles = storyNode?.data?.shotTitles || [];
  const prompts = storyNode?.data?.shotPrompts || [];
  const cast = storyNode?.data?.cast || [];

  console.log('====================================================');
  console.log(`🎬 STORY DIRECTOR DEEP PROMPT ANALYSIS`);
  console.log(`🚗 Subject: ${storyNode?.data?.brief || 'ASMR Car Craftsman'}`);
  console.log('====================================================\n');

  console.log('👥 CHARACTER & CAR IDENTITY LOCK:');
  cast.forEach((c: any, idx: number) => {
    console.log(`  [${idx + 1}] ${c.name} (${c.role}):`);
    console.log(`      Look: "${c.look}"`);
  });

  console.log('\n----------------------------------------------------');
  console.log('📜 DETAILED SHOT-BY-SHOT PROMPTS:');
  console.log('----------------------------------------------------');

  for (let i = 0; i < Math.max(titles.length, prompts.length); i++) {
    console.log(`\n▶️ [SHOT ${i + 1}] ${titles[i] || `Scene ${i + 1}`}`);
    console.log(`----------------------------------------------------`);
    console.log(prompts[i] || '(No prompt generated yet)');
  }

  console.log('\n----------------------------------------------------');
  console.log('⚡ CONNECTED GENERATION NODES ON CANVAS:');
  console.log('----------------------------------------------------');
  const genNodes = nodes.filter((n: any) => n.type === 'generate' || n.data?.type === 'generate');
  genNodes.forEach((gn: any, idx: number) => {
    console.log(`\n[Node ${idx + 1}] ${gn.data?.label || gn.id} (${gn.data?.mediaType || 'media'} / ${gn.data?.model || 'model'})`);
    console.log(`  Status: ${gn.data?.status || 'idle'}`);
    console.log(`  Prompt: "${gn.data?.prompt || gn.data?.resultText || 'Pending...'}"`);
  });

  process.exit(0);
}

waitAndAnalyze().catch((err) => {
  console.error('Analysis error:', err);
  process.exit(1);
});
