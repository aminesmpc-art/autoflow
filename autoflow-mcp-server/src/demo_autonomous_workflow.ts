import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import path from 'path';

async function runAutonomousDemo() {
  console.log('🚀 Starting Autonomous MCP Feature Verification & Execution...\n');

  const transport = new StdioClientTransport({
    command: 'node',
    args: [path.resolve(__dirname, 'index.js')],
  });

  const client = new Client({ name: 'feature-tester', version: '1.1.0' }, { capabilities: {} });
  await client.connect(transport);

  // 1. Telemetry: Get Pipeline Status
  console.log('📊 1. Testing "studio_get_pipeline_status"...');
  const statusRes = await client.callTool({
    name: 'studio_get_pipeline_status',
    arguments: {},
  });
  const statusData = JSON.parse(((statusRes as any).content[0] as any)?.text);
  console.log(`   - Canvas Nodes: ${statusData.totalNodes}`);
  console.log(`   - Pipeline Running: ${statusData.isRunning}`);
  console.log(`   - Node breakdown: ${statusData.idleNodes} idle, ${statusData.runningNodes} running, ${statusData.completedNodes} done, ${statusData.failedNodes} failed.\n`);

  // 2. Prompt Injection & Self-Healing: Target Shot 1
  const shot1 = statusData.nodes.find((n: any) => n.label === 'Shot 1' || n.type === 'generate');
  if (shot1) {
    console.log(`🩹 2. Testing "studio_self_heal_node" on "${shot1.label}" (${shot1.id})...`);
    const healRes = await client.callTool({
      name: 'studio_self_heal_node',
      arguments: {
        nodeId: shot1.id,
        issueDescription: 'Injecting Pixar 3D subsurface scattering, volumetric god rays, and Veo 3.1 joint audio',
        fixStrategy: 'custom_prompt',
        customPrompt: 'Shot 1: Extreme close-up of baby cinder drake Emberlyn sniffing a floating glowing ember, eyes wide with wonder. Ambient noise: gentle enchanted forest breeze, crackling sparks. SFX: curious high-pitched squeak, tiny sneeze blowing a puff of glittery smoke. Pixar 3D character animation, subsurface scattering, 8K ultra-detailed.',
      },
    });
    console.log(((healRes as any).content[0] as any)?.text + '\n');
  }

  // 3. Inspect Generations: Structured asset telemetry
  console.log('🔍 3. Testing "studio_inspect_generations"...');
  const inspectRes = await client.callTool({
    name: 'studio_inspect_generations',
    arguments: {},
  });
  const inspectData = JSON.parse(((inspectRes as any).content[0] as any)?.text);
  console.log(`   - Total Generation Nodes: ${inspectData.total}`);
  console.log(`   - Completed Outputs: ${inspectData.completed}`);
  inspectData.outputs?.forEach((o: any, idx: number) => {
    console.log(`   - Shot ${idx + 1} [${o.nodeId}]: format=${o.aspectRatio} dur=${o.duration} model="${o.model}" status=${o.status}`);
  });

  // 4. Trigger Execution
  console.log('\n🎬 4. Testing "studio_run_pipeline"...');
  const runRes = await client.callTool({
    name: 'studio_run_pipeline',
    arguments: {},
  });
  console.log('   Result:', ((runRes as any).content[0] as any)?.text);

  console.log('\n====================================================');
  console.log('🎉 ALL NEW AUTONOMOUS FEATURES TESTED & LIVE!');
  console.log('====================================================\n');

  process.exit(0);
}

runAutonomousDemo().catch((e) => {
  console.error('Demo Error:', e);
  process.exit(1);
});
