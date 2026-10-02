/* ============================================================
   AutoFlow MCP Client Pipeline Trigger
   Communicates with autoflow-mcp via standard MCP tool calls.
   ============================================================ */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import path from 'path';

async function main() {
  console.log('🤖 Connecting to AutoFlow MCP Server as Claude...');

  const transport = new StdioClientTransport({
    command: 'node',
    args: [path.resolve(__dirname, 'index.js')],
  });

  const client = new Client(
    { name: 'claude-autoflow-client', version: '1.0.0' },
    { capabilities: {} }
  );

  await client.connect(transport);
  console.log('✅ Connected to AutoFlow MCP Server over Stdio!');

  // 1. Inspect Canvas
  console.log('\n📊 Inspecting current canvas nodes via MCP...');
  const canvasRes = await client.callTool({
    name: 'studio_get_canvas',
    arguments: {},
  });
  console.log('Canvas State:', ((canvasRes as any).content[0] as any)?.text?.substring(0, 300) + '...');

  // 2. Trigger Run Pipeline
  console.log('\n🚀 Triggering `studio_run_pipeline` tool...');
  const runRes = await client.callTool({
    name: 'studio_run_pipeline',
    arguments: {},
  });
  console.log('✨ Result:', JSON.stringify(runRes, null, 2));

  process.exit(0);
}

main().catch((err) => {
  console.error('Execution error:', err);
  process.exit(1);
});
