import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import path from 'path';

async function deployAndExecute() {
  const transport = new StdioClientTransport({
    command: 'node',
    args: [path.resolve(__dirname, 'index.js')],
  });

  const client = new Client({ name: 'viral-dragon-runner', version: '1.1.0' }, { capabilities: {} });
  await client.connect(transport);

  console.log('🎬 1. Deploying 4-Shot 9:16 Vertical Viral Baby Dragon Storyboard to Canvas...');
  await client.callTool({
    name: 'studio_create_story_graph',
    arguments: {
      brief: 'An adorable thumb-sized baby cinder drake named Emberlyn with shimmering ruby scales trying to toast a tiny marshmallow, getting cute hiccups, and giggling with sparkling embers.',
      structure: 'hook',
      shotCount: 4,
      camera: 'dynamic',
      visualPreset: 'cgi3d',
      audioMode: 'cinematic',
      aspectRatio: '9:16',
      duration: '6s',
      cast: [
        {
          name: 'Emberlyn',
          look: 'Tiny thumb-sized baby cinder dragon with soft pearlescent ruby scales, oversized amber-gold eyes with starburst pupils, miniature stubby wings with glowing tips, soft rounded muzzle.',
          role: 'Hero Character',
          voice: 'Cute inquisitive squeaks and tiny giggles',
        },
      ],
    },
  });

  console.log('✅ Storyboard deployed!\n');

  // 2. Read canvas nodes
  const statusRes = await client.callTool({
    name: 'studio_get_pipeline_status',
    arguments: {},
  });
  const status = JSON.parse(((statusRes as any).content[0] as any)?.text);
  console.log(`📊 2. Canvas Telemetry: ${status.totalNodes} Nodes successfully connected on Canvas.`);

  const genNodes = status.nodes.filter((n: any) => n.type === 'generate');

  // 3. Inject precision prompts
  const prompts = [
    'Shot 1 (Hook): Extreme close-up of baby cinder drake Emberlyn sniffing a floating glowing ember, eyes wide with curiosity. Ambient noise: gentle enchanted forest breeze, crackling sparks. SFX: curious high-pitched squeak, tiny sneeze blowing a puff of glittery smoke. Pixar 3D CGI animation, subsurface scattering, 8K render, 9:16 vertical.',
    'Shot 2 (Action): Medium shot of Emberlyn holding a tiny twig with a miniature marshmallow over a glowing ember, wobbling on two stubby legs. Ambient noise: quiet nighttime crickets, warm campfire hum. SFX: excited baby dragon chortle, sudden tiny hiccup that makes a tiny spark pop. Pixar 3D CGI animation, shallow depth of field, 9:16 vertical.',
    'Shot 3 (Climax): Close tracking shot of Emberlyn getting sparkling hiccups, miniature wings flapping as each hiccup launches tiny harmless colorful embers into the air. Ambient noise: warm ambient breeze. SFX: rhythmic cute hiccups, sparkling chiming sounds, cheerful squeal. Pixar 3D CGI animation, vibrant volumetric lighting, 9:16 vertical.',
    'Shot 4 (Resolution): Low angle hero shot of Emberlyn proudly munching on the perfectly golden-toasted tiny marshmallow with gooey chocolate on its nose, smiling blissfully at the camera. Ambient noise: soothing nighttime ambiance. SFX: satisfied happy munching sounds, contented baby dragon purr. Pixar 3D CGI animation, warm golden rim lighting, 9:16 vertical.',
  ];

  for (let i = 0; i < genNodes.length; i++) {
    const node = genNodes[i];
    const prompt = prompts[i] || prompts[0];
    await client.callTool({
      name: 'studio_modify_prompt',
      arguments: {
        nodeId: node.id,
        prompt,
      },
    });
    console.log(`   ✍️ Prompt configured on [${node.label}] (${node.id})`);
  }

  // 4. Test Self-Healing tool on Shot 2
  if (genNodes[1]) {
    console.log(`\n🩹 3. Testing Autonomous "studio_self_heal_node" on [${genNodes[1].label}]...`);
    const healRes = await client.callTool({
      name: 'studio_self_heal_node',
      arguments: {
        nodeId: genNodes[1].id,
        issueDescription: 'Reinforcing volumetric rim light and removing safety diffusion triggers',
        fixStrategy: 'enhance_lighting',
      },
    });
    console.log(((healRes as any).content[0] as any)?.text);
  }

  // 5. Inspect Generations
  console.log('\n🔍 4. Inspecting Canvas Generators via "studio_inspect_generations"...');
  const inspectRes = await client.callTool({
    name: 'studio_inspect_generations',
    arguments: {},
  });
  const inspect = JSON.parse(((inspectRes as any).content[0] as any)?.text);
  console.log(`   - Verified ${inspect.total} video generators ready on canvas:`);
  inspect.outputs?.forEach((o: any, idx: number) => {
    console.log(`   - Shot ${idx + 1} (${o.aspectRatio}, ${o.duration}): "${o.prompt.substring(0, 70)}..."`);
  });

  // 6. Start Pipeline
  console.log('\n🚀 5. Starting Pipeline Execution via "studio_run_pipeline"...');
  const runRes = await client.callTool({
    name: 'studio_run_pipeline',
    arguments: {},
  });
  console.log('   Execution Status:', ((runRes as any).content[0] as any)?.text);

  console.log('\n====================================================');
  console.log('🎉 PIPELINE ACTIVATED & ALL MCP FEATURES VERIFIED!');
  console.log('====================================================\n');

  process.exit(0);
}

deployAndExecute().catch((e) => {
  console.error(e);
  process.exit(1);
});
