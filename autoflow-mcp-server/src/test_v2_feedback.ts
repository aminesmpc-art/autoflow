import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import path from 'path';

async function testStructuredFeedback() {
  console.log('=== AutoFlow MCP v2.0 — Structured Feedback Test ===\n');

  const transport = new StdioClientTransport({
    command: 'node',
    args: [path.resolve(__dirname, 'index.js')],
  });

  const client = new Client({ name: 'test-v2', version: '2.0.0' }, { capabilities: {} });
  await client.connect(transport);

  // Test 1: Diagnose Canvas
  console.log('─── TEST 1: studio_diagnose_canvas ───');
  const diagRes = await client.callTool({ name: 'studio_diagnose_canvas', arguments: {} });
  for (const c of (diagRes as any).content) {
    console.log(c.text);
    console.log('');
  }

  // Test 2: Pipeline Status
  console.log('\n─── TEST 2: studio_get_pipeline_status ───');
  const statusRes = await client.callTool({ name: 'studio_get_pipeline_status', arguments: {} });
  // Only print the summary (first content block)
  console.log(((statusRes as any).content[0] as any)?.text);

  // Test 3: Run Pipeline (should refuse if critical issues)
  console.log('\n─── TEST 3: studio_run_pipeline (with pre-flight) ───');
  const runRes = await client.callTool({ name: 'studio_run_pipeline', arguments: {} });
  console.log(((runRes as any).content[0] as any)?.text);
  if ((runRes as any).isError) {
    console.log('\n[isError: true — pipeline was blocked as expected]');
  }

  // Test 4: Auto-Fix Canvas
  console.log('\n─── TEST 4: studio_auto_fix_canvas ───');
  const fixRes = await client.callTool({ name: 'studio_auto_fix_canvas', arguments: {} });
  console.log(((fixRes as any).content[0] as any)?.text);

  // Test 5: Diagnose again after fix
  console.log('\n─── TEST 5: studio_diagnose_canvas (post-fix) ───');
  const diag2Res = await client.callTool({ name: 'studio_diagnose_canvas', arguments: {} });
  console.log(((diag2Res as any).content[0] as any)?.text);

  console.log('\n=== All tests complete ===');
  process.exit(0);
}

testStructuredFeedback().catch((e) => { console.error(e); process.exit(1); });
