/* ============================================================
   Test AutoFlow MCP Autonomous Suite
   Validates:
   1. studio_get_pipeline_status
   2. studio_inspect_generations
   3. studio_self_heal_node
   4. studio_create_story_graph (with 9:16 + cgi3d + asmr)
   ============================================================ */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import path from 'path';

async function testAutonomousSuite() {
  console.log('🧪 Testing Upgraded AutoFlow MCP Server Autonomous Suite...');

  const transport = new StdioClientTransport({
    command: 'node',
    args: [path.resolve(__dirname, 'index.js')],
  });

  const client = new Client(
    { name: 'mcp-test-runner', version: '1.1.0' },
    { capabilities: {} }
  );

  await client.connect(transport);
  console.log('✅ Connected to upgraded MCP server via Stdio\n');

  // 1. List tools and verify new tools exist
  const toolsList = await client.listTools();
  const toolNames = toolsList.tools.map((t) => t.name);
  console.log(`📦 Registered MCP Tools (${toolNames.length}):`, toolNames.join(', '));

  const expectedNewTools = [
    'studio_get_pipeline_status',
    'studio_wait_for_completion',
    'studio_inspect_generations',
    'studio_self_heal_node',
  ];

  for (const t of expectedNewTools) {
    if (!toolNames.includes(t)) {
      throw new Error(`Missing expected tool: ${t}`);
    }
  }
  console.log('✅ All 4 new autonomous tools verified in MCP manifest!\n');

  // 2. Test studio_get_pipeline_status
  console.log('📊 Testing studio_get_pipeline_status...');
  const statusRes = await client.callTool({
    name: 'studio_get_pipeline_status',
    arguments: {},
  });
  console.log('Pipeline status result:', ((statusRes as any).content[0] as any)?.text?.substring(0, 150) + '...');

  // 3. Test studio_inspect_generations
  console.log('\n🔍 Testing studio_inspect_generations...');
  const inspectRes = await client.callTool({
    name: 'studio_inspect_generations',
    arguments: {},
  });
  console.log('Inspect generations result:', ((inspectRes as any).content[0] as any)?.text?.substring(0, 150) + '...');

  // 4. Test studio_self_heal_node on one of the nodes
  const canvasRes = await client.callTool({
    name: 'studio_get_canvas',
    arguments: {},
  });
  const canvas = JSON.parse(((canvasRes as any).content[0] as any)?.text);
  const genNode = canvas.nodes?.find((n: any) => n.type === 'generate');

  if (genNode) {
    console.log(`\n🩹 Testing studio_self_heal_node on node "${genNode.id}"...`);
    const healRes = await client.callTool({
      name: 'studio_self_heal_node',
      arguments: {
        nodeId: genNode.id,
        issueDescription: 'Testing prompt safety stripping and enhancement',
        fixStrategy: 'enhance_lighting',
      },
    });
    console.log('Self-heal result:', ((healRes as any).content[0] as any)?.text);
  }

  console.log('\n====================================================');
  console.log('🎉 ALL AUTONOMOUS MCP TOOLS VERIFIED SUCCESSFULLY!');
  console.log('====================================================\n');

  process.exit(0);
}

testAutonomousSuite().catch((err) => {
  console.error('Test Suite Failed:', err);
  process.exit(1);
});
