/* ============================================================
   Test ASMR Director Skill on AutoFlow Studio Canvas
   Updates Story Director with the new ASMR skill presets:
   - structure: 'asmrCraft'
   - cameraProgression: 'asmrMacro'
   - audioMode: 'asmr'
   - visualPreset: 'asmrCraft'
   - colorTemp: 'amber'
   - lighting: 'intimate'
   Runs Story Director and streams generated prompts.
   ============================================================ */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import path from 'path';

async function testAsmrSkill() {
  console.log('🧪 Testing newly implemented ASMR Director Skill via MCP...');

  const transport = new StdioClientTransport({
    command: 'node',
    args: [path.resolve(__dirname, 'index.js')],
  });

  const client = new Client(
    { name: 'asmr-skill-tester', version: '1.0.0' },
    { capabilities: {} }
  );

  await client.connect(transport);
  console.log('✅ Connected over Stdio!\n');

  // Step 1: Read Canvas
  const canvasRes = await client.callTool({
    name: 'studio_get_canvas',
    arguments: {},
  });
  const canvas = JSON.parse(((canvasRes as any).content[0] as any)?.text || '{}');
  const nodes = canvas.nodes || [];
  const edges = canvas.edges || [];

  const director = nodes.find((n: any) => n.type === 'story' || n.data?.type === 'story');
  if (!director) {
    console.error('❌ Story Director node not found on canvas!');
    process.exit(1);
  }

  console.log(`Found Story Director node: "${director.data?.label || director.id}"`);

  // Step 2: Configure Story Director with new ASMR Skill suite
  director.data = {
    ...director.data,
    structure: 'asmrCraft',
    cameraProgression: 'asmrMacro',
    audioMode: 'asmr',
    visualPreset: 'asmrCraft',
    colorTemp: 'amber',
    lighting: 'intimate',
    status: 'idle',
    errorMessage: null,
  };

  // Re-save workflow
  console.log('💾 Updating canvas with full ASMR Director Skill configurations...');
  await client.callTool({
    name: 'studio_set_workflow',
    arguments: {
      name: 'ASMR Car Craftsmanship (ASMR Director Skill Active)',
      nodes,
      edges,
    },
  });

  // Step 3: Trigger execution on Story Director
  console.log('🚀 Triggering Story Director to generate with new ASMR skill...');
  const runRes = await client.callTool({
    name: 'studio_run_pipeline',
    arguments: {},
  });
  console.log('Run response:', ((runRes as any).content[0] as any)?.text);

  // Step 4: Stream and wait for prompts
  console.log('\n📡 Streaming ASMR Prompt Generation...');
  let completed = false;
  for (let i = 1; i <= 20; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const pollRes = await client.callTool({
      name: 'studio_get_canvas',
      arguments: {},
    });
    const currentCanvas = JSON.parse(((pollRes as any).content[0] as any)?.text || '{}');
    const currentDirector = (currentCanvas.nodes || []).find((n: any) => n.id === director.id);

    const status = currentDirector?.data?.status;
    const note = currentDirector?.data?.statusNote;
    const prompts = currentDirector?.data?.shotPrompts || [];
    const titles = currentDirector?.data?.shotTitles || [];

    console.log(`⏱️ [T+${i * 2}s] Status: [${status || 'idle'}] ${note ? `— ${note}` : ''} | Prompts: ${prompts.length}`);

    if (prompts.length > 0 && status === 'done') {
      console.log('\n🎉 Story Director generated prompts using the ASMR Skill!');
      console.log('====================================================');
      for (let s = 0; s < prompts.length; s++) {
        console.log(`\n▶️ [SHOT ${s + 1}] ${titles[s] || `Scene ${s + 1}`}`);
        console.log('----------------------------------------------------');
        console.log(prompts[s]);
      }
      console.log('====================================================\n');
      completed = true;
      break;
    }
  }

  if (!completed) {
    console.log('⚠️ Poll window closed. Story Director is continuing generation in browser.');
  }

  process.exit(0);
}

testAsmrSkill().catch((err) => {
  console.error('Test error:', err);
  process.exit(1);
});
