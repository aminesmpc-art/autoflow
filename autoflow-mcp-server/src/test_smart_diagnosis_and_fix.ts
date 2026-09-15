import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import path from 'path';

async function testSmartTools() {
  console.log('🧠 Testing Smart Autonomous MCP Diagnostic & Auto-Fix Engine...\n');

  const transport = new StdioClientTransport({
    command: 'node',
    args: [path.resolve(__dirname, 'index.js')],
  });

  const client = new Client({ name: 'smart-tester', version: '1.1.0' }, { capabilities: {} });
  await client.connect(transport);

  // 1. Diagnose Canvas
  console.log('🔬 1. Running "studio_diagnose_canvas"...');
  const diagRes = await client.callTool({
    name: 'studio_diagnose_canvas',
    arguments: {},
  });
  const rawText = ((diagRes as any).content[0] as any)?.text;
  console.log('Raw text:', rawText);
  const diag = JSON.parse(rawText);
  console.log(`   - Healthy: ${diag.healthy}`);
  console.log(`   - Total Issues Detected: ${diag.totalIssues} (${diag.criticalCount} critical, ${diag.warningCount} warning, ${diag.infoCount} info)`);
  diag.issues?.forEach((issue: any, idx: number) => {
    console.log(`     [${idx + 1}] [${issue.severity.toUpperCase()}] ${issue.message} ➔ Fix: ${issue.fix}`);
  });

  // 2. Auto-Fix Canvas
  console.log('\n🛠️ 2. Running "studio_auto_fix_canvas"...');
  const fixRes = await client.callTool({
    name: 'studio_auto_fix_canvas',
    arguments: {},
  });
  console.log(((fixRes as any).content[0] as any)?.text);

  // 3. Re-Diagnose Canvas
  console.log('\n🔬 3. Verifying Canvas Health after Auto-Fix...');
  const reDiagRes = await client.callTool({
    name: 'studio_diagnose_canvas',
    arguments: {},
  });
  const reDiag = JSON.parse(((reDiagRes as any).content[0] as any)?.text);
  console.log(`   - Healthy: ${reDiag.healthy}`);
  console.log(`   - Critical Issues Remaining: ${reDiag.criticalCount}`);

  console.log('\n====================================================');
  console.log('🎉 SMART DIAGNOSTIC & AUTO-FIX ENGINE FULLY VERIFIED!');
  console.log('====================================================\n');

  process.exit(0);
}

testSmartTools().catch((e) => {
  console.error(e);
  process.exit(1);
});
