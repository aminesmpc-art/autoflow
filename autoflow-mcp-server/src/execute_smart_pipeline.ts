import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import path from 'path';

async function executeSmartWorkflow() {
  console.log('🚀 Running Complete Auto-Fix & Smart Pipeline Execution...\n');

  const transport = new StdioClientTransport({
    command: 'node',
    args: [path.resolve(__dirname, 'index.js')],
  });

  const client = new Client({ name: 'executor', version: '1.1.0' }, { capabilities: {} });
  await client.connect(transport);

  // 1. Auto-Fix Canvas
  console.log('🛠️ 1. Applying "studio_auto_fix_canvas"...');
  const fixRes = await client.callTool({
    name: 'studio_auto_fix_canvas',
    arguments: {},
  });
  console.log(((fixRes as any).content[0] as any)?.text + '\n');

  // 2. Diagnose Canvas
  console.log('🔬 2. Verifying Canvas Health via "studio_diagnose_canvas"...');
  const diagRes = await client.callTool({
    name: 'studio_diagnose_canvas',
    arguments: {},
  });
  const diag = JSON.parse(((diagRes as any).content[0] as any)?.text);
  console.log(`   - Canvas Status: ${diag.healthy ? '✅ HEALTHY & READY TO RUN' : '❌ ISSUES DETECTED'}`);
  console.log(`   - Critical Blockers: ${diag.criticalCount}, Warnings: ${diag.warningCount}\n`);

  // 3. Start Pipeline
  console.log('🎬 3. Starting Pipeline Execution via "studio_run_pipeline"...');
  const runRes = await client.callTool({
    name: 'studio_run_pipeline',
    arguments: {},
  });
  console.log(((runRes as any).content[0] as any)?.text + '\n');

  // 4. Check Initial Telemetry
  console.log('📊 4. Reading Live Telemetry via "studio_get_pipeline_status"...');
  const statusRes = await client.callTool({
    name: 'studio_get_pipeline_status',
    arguments: {},
  });
  const status = JSON.parse(((statusRes as any).content[0] as any)?.text);
  console.log(`   - Pipeline Is Running: ${status.isRunning}`);
  console.log(`   - Active Node: ${status.currentNodeId || 'Starting...'}`);
  console.log(`   - Nodes Overview: ${status.totalNodes} total (${status.idleNodes} idle, ${status.runningNodes} running, ${status.completedNodes} done)`);

  console.log('\n====================================================');
  console.log('🎉 PIPELINE AUTO-FIXED AND RUNNING LIVE IN CHROME!');
  console.log('====================================================\n');

  process.exit(0);
}

executeSmartWorkflow().catch((e) => {
  console.error(e);
  process.exit(1);
});
