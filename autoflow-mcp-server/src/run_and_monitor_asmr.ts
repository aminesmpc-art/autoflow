/* ============================================================
   AutoFlow MCP ASMR Car Pipeline Execution & Live Monitor
   Triggers `studio_run_pipeline` and streams real-time execution
   diagnostics across the 10-node First-Frame + Last-Frame chain.
   ============================================================ */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import path from 'path';

async function runAndMonitor() {
  console.log('🤖 Connecting to AutoFlow MCP Server to start ASMR Car pipeline...');

  const transport = new StdioClientTransport({
    command: 'node',
    args: [path.resolve(__dirname, 'index.js')],
  });

  const client = new Client(
    { name: 'asmr-live-runner', version: '1.0.0' },
    { capabilities: {} }
  );

  await client.connect(transport);
  console.log('✅ Connected over Stdio!\n');

  // Step 1: Trigger Pipeline
  console.log('🚀 Triggering `studio_run_pipeline` via MCP...');
  const runRes = await client.callTool({
    name: 'studio_run_pipeline',
    arguments: {},
  });
  console.log('Result:', ((runRes as any).content[0] as any)?.text);

  // Step 2: Stream Diagnostics for up to 30s
  console.log('\n📡 Streaming Real-Time Node Generation Diagnostics...');
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

      console.log(`\n⏱️ [T+${t * 2}s] Pipeline Running: ${isRunning ? '⚡ ACTIVE' : '⏹️ IDLE'} | Current Step: ${current || 'Starting'} | Progress: ${prog?.current || 0}/${prog?.total || 0}`);

      if (state.nodes) {
        state.nodes
          .filter((n: any) => n.data?.status === 'running' || n.data?.status === 'done' || n.data?.status === 'error')
          .forEach((n: any) => {
            const sym = n.data?.status === 'done' ? '✅' : n.data?.status === 'running' ? '⏳' : '❌';
            console.log(`   ${sym} ${n.data?.label || n.id} [${n.type}]: ${n.data?.status?.toUpperCase()} ${n.data?.statusNote ? `— ${n.data.statusNote}` : ''}`);
            if (n.data?.error || n.data?.errorMessage) {
              console.log(`      ⚠️ Error: ${n.data.error || n.data.errorMessage}`);
            }
            if (n.data?.resultUrl) {
              console.log(`      🔗 Output: ${n.data.resultUrl}`);
            }
          });
      }

      if (!isRunning && t > 4) {
        console.log('\n🏁 Run cycle complete.');
        break;
      }
    } catch (err: any) {
      console.log('Polling error:', err?.message || err);
    }
  }

  process.exit(0);
}

runAndMonitor().catch((err) => {
  console.error('Execution error:', err);
  process.exit(1);
});
