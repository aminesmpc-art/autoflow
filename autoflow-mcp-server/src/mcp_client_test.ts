/* ============================================================
   AutoFlow MCP Client Simulator
   Acts as Claude Desktop communicating with autoflow-mcp 
   over standard input/output (Stdio).
   ============================================================ */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import path from 'path';

async function main() {
  console.log('🤖 Simulating Claude Desktop executing AutoFlow MCP...');

  const transport = new StdioClientTransport({
    command: 'node',
    args: [path.resolve(__dirname, 'index.js')],
  });

  const client = new Client(
    { name: 'claude-desktop-simulator', version: '1.0.0' },
    { capabilities: {} }
  );

  await client.connect(transport);
  console.log('✅ Connected to AutoFlow MCP Server over stdio!');

  // 1. List Tools
  const tools = await client.listTools();
  console.log(`\n📋 Discovered ${tools.tools.length} AutoFlow MCP Tools:`);
  tools.tools.forEach((t) => console.log(`  • ${t.name}: ${(t.description || '').substring(0, 70)}...`));

  // 2. Call create_story_graph
  console.log('\n🎬 Calling `studio_create_story_graph` tool through Claude:');
  try {
    const result = await client.callTool({
      name: 'studio_create_story_graph',
      arguments: {
        brief: 'Baby dragon Ignis learning to fly in a glowing crystal canyon.',
        structure: 'threeAct',
        shotCount: 3,
        camera: 'dynamic',
        cast: [
          {
            name: 'Ignis',
            look: 'Small red baby dragon with gold belly scales, tiny bat wings, and glowing emerald eyes',
            role: 'lead',
          },
        ],
      },
    });

    console.log('✨ Result from MCP:', JSON.stringify(result, null, 2));
  } catch (err: any) {
    console.log('ℹ️ Tool Call Result:', err?.message || err);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('Test error:', err);
  process.exit(1);
});
