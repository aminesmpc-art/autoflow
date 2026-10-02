import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import path from 'path';

async function checkLiveCanvas() {
  const transport = new StdioClientTransport({
    command: 'node',
    args: [path.resolve(__dirname, 'index.js')],
  });

  const client = new Client({ name: 'checker', version: '1.1.0' }, { capabilities: {} });
  await client.connect(transport);

  const canvasRes = await client.callTool({
    name: 'studio_get_canvas',
    arguments: {},
  });
  const canvas = JSON.parse(((canvasRes as any).content[0] as any)?.text);
  console.log('--- CANVAS NODES COUNT:', canvas.nodes?.length, '---');
  canvas.nodes?.forEach((n: any) => {
    console.log(`Node [${n.id}] type=${n.type} label="${n.data?.label}" status="${n.data?.status}" error="${n.data?.errorMessage || n.data?.statusNote || ''}"`);
  });

  const statusRes = await client.callTool({
    name: 'studio_get_pipeline_status',
    arguments: {},
  });
  console.log('\n--- PIPELINE STATUS ---');
  console.log(JSON.parse(((statusRes as any).content[0] as any)?.text));

  process.exit(0);
}

checkLiveCanvas().catch(console.error);
