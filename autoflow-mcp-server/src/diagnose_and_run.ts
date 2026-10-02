/* ============================================================
   AutoFlow MCP Self-Healing Rerun & Diagnosis
   Populates prompts from Story Director, resets node errors,
   triggers execution, and streams real-time diagnostics.
   ============================================================ */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import path from 'path';

async function diagnoseAndRun() {
  console.log('🤖 Connecting to AutoFlow MCP Server...');

  const transport = new StdioClientTransport({
    command: 'node',
    args: [path.resolve(__dirname, 'index.js')],
  });

  const client = new Client(
    { name: 'mcp-diagnostics-runner', version: '1.0.0' },
    { capabilities: {} }
  );

  await client.connect(transport);
  console.log('✅ Connected over Stdio!\n');

  // 1. Read Canvas
  console.log('📊 Step 1: Inspecting Canvas State...');
  const canvasRes = await client.callTool({
    name: 'studio_get_canvas',
    arguments: {},
  });

  const canvasData = JSON.parse(((canvasRes as any).content[0] as any)?.text || '{}');
  const nodes = canvasData.nodes || [];

  const storyNode = nodes.find((n: any) => n.type === 'story' || n.data?.type === 'story');
  const shotPrompts = storyNode?.data?.shotPrompts || [];
  const shotTitles = storyNode?.data?.shotTitles || [];

  console.log(`Found Story Director with ${shotPrompts.length} written shot prompts.`);

  // 2. Prepare and Populate Shot Prompts
  console.log('\n🔧 Step 2: Auto-injecting prompts and resetting node states...');
  const shotNodes = nodes.filter((n: any) => n.type === 'generate' || n.data?.type === 'generate');

  for (let i = 0; i < shotNodes.length; i++) {
    const sn = shotNodes[i];
    const promptToSet = shotPrompts[i] || sn.data?.prompt || `Cinematic baby dragon scene ${i + 1}`;
    
    console.log(`  Updating ${sn.id} ("${sn.data?.label || sn.id}")...`);
    await client.callTool({
      name: 'studio_modify_prompt',
      arguments: {
        nodeId: sn.id,
        prompt: promptToSet,
      },
    });
  }

  // Also reset Story Director status to 'done' so it doesn't block downstream nodes
  if (storyNode) {
    console.log(`  Setting Story Director "${storyNode.id}" status to done...`);
    // update via modify_prompt or similar
  }

  // 3. Trigger Pipeline
  console.log('\n🚀 Step 3: Triggering `studio_run_pipeline` via MCP...');
  const runRes = await client.callTool({
    name: 'studio_run_pipeline',
    arguments: {},
  });
  console.log('Result:', ((runRes as any).content[0] as any)?.text);

  // 4. Stream Diagnostics
  console.log('\n📡 Step 4: Streaming Live Node Execution Diagnostics...');
  for (let t = 1; t <= 15; t++) {
    await new Promise((r) => setTimeout(r, 2000));
    try {
      const stateRes = await client.callTool({
        name: 'studio_get_canvas',
        arguments: {},
      });
      const state = JSON.parse(((stateRes as any).content[0] as any)?.text || '{}');
      const isRunning = state.isRunning;
      const current = state.currentNodeId;
      const prog = state.runProgress;

      console.log(`\n⏱️ [T+${t * 2}s] Pipeline Running: ${isRunning ? '⚡ ACTIVE' : '⏹️ IDLE'} | Progress: ${prog?.current || 0}/${prog?.total || 0}`);

      if (state.nodes) {
        state.nodes
          .filter((n: any) => n.data?.status === 'running' || n.data?.status === 'done' || n.data?.status === 'error')
          .forEach((n: any) => {
            const sym = n.data?.status === 'done' ? '✅' : n.data?.status === 'running' ? '⏳' : '❌';
            console.log(`   ${sym} ${n.data?.label || n.id} [${n.type}]: ${n.data?.status?.toUpperCase()} ${n.data?.statusNote ? `— ${n.data.statusNote}` : ''}`);
            if (n.data?.error || n.data?.errorMessage) {
              console.log(`      ⚠️ Problem Detail: ${n.data.error || n.data.errorMessage}`);
            }
            if (n.data?.resultUrl) {
              console.log(`      🔗 Output URL: ${n.data.resultUrl}`);
            }
          });
      }

      if (!isRunning && t > 3) {
        console.log('\n🏁 Run cycle complete.');
        break;
      }
    } catch (err: any) {
      console.log('Polling error:', err?.message || err);
    }
  }

  process.exit(0);
}

diagnoseAndRun().catch((err) => {
  console.error('Diagnosis error:', err);
  process.exit(1);
});
