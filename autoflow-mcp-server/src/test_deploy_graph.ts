import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import path from 'path';

async function deployStory() {
  const transport = new StdioClientTransport({
    command: 'node',
    args: [path.resolve(__dirname, 'index.js')],
  });

  const client = new Client({ name: 'deployer', version: '1.1.0' }, { capabilities: {} });
  await client.connect(transport);

  console.log('🎬 Deploying 4-Shot 9:16 Baby Dragon CGI Story Graph to Canvas via MCP...');
  const res = await client.callTool({
    name: 'studio_create_story_graph',
    arguments: {
      brief: 'An adorable pygmy baby cinder drake named Emberlyn with shimmering ruby scales trying to toast a tiny marshmallow, getting cute hiccups, and giggling with sparkling embers.',
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
          voice: 'Cute inquisitive squeaks',
        },
      ],
    },
  });

  console.log('Result:', ((res as any).content[0] as any)?.text);

  console.log('\n📊 Reading canvas status back via MCP:');
  const status = await client.callTool({
    name: 'studio_get_pipeline_status',
    arguments: {},
  });
  console.log('Status:', JSON.parse(((status as any).content[0] as any)?.text));

  process.exit(0);
}

deployStory().catch((e) => {
  console.error(e);
  process.exit(1);
});
