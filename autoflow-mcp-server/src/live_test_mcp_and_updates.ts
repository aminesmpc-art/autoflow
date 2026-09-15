/* ============================================================
   Live Test MCP & New Updates Suite
   Connects directly to the active AutoFlow MCP Bridge on ws://localhost:8124
   ============================================================ */

import { WebSocket } from 'ws';

async function runLiveTest() {
  console.log('🚀 Connecting to active AutoFlow MCP Bridge on ws://localhost:8124...');

  const ws = new WebSocket('ws://localhost:8124');

  await new Promise<void>((resolve, reject) => {
    ws.on('open', () => {
      console.log('✅ Connected to WebSocket Bridge!\n');
      resolve();
    });
    ws.on('error', (err) => {
      console.error('❌ Connection error:', err);
      reject(err);
    });
  });

  function sendRpc(action: string, params: any = {}): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = `test_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
      const timeout = setTimeout(() => {
        reject(new Error(`Timeout waiting for RPC response: ${action}`));
      }, 10000);

      const handler = (data: any) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'response' && msg.id === id) {
            clearTimeout(timeout);
            ws.off('message', handler);
            if (msg.error) {
              reject(new Error(msg.error));
            } else {
              resolve(msg.result);
            }
          }
        } catch { /* ignore */ }
      };

      ws.on('message', handler);
      ws.send(JSON.stringify({ id, type: 'request', action, params }));
    });
  }

  // 1. Test get_pipeline_status
  console.log('📊 1. Testing "get_pipeline_status"...');
  const status = await sendRpc('get_pipeline_status');
  console.log('   Status:', {
    isRunning: status.isRunning,
    totalNodes: status.totalNodes,
    completedNodes: status.completedNodes,
    failedNodes: status.failedNodes,
    runningNodes: status.runningNodes,
    idleNodes: status.idleNodes,
  });

  // 2. Test inspect_generations
  console.log('\n🔍 2. Testing "inspect_generations"...');
  const inspect = await sendRpc('inspect_generations');
  console.log(`   Inspected ${inspect.total} generator nodes on canvas:`);
  inspect.outputs?.slice(0, 3).forEach((o: any, idx: number) => {
    console.log(`   - Output ${idx + 1}: [${o.label}] format=${o.aspectRatio} status=${o.status} prompt="${o.prompt.substring(0, 60)}..."`);
  });

  // 3. Test self-heal / prompt modification on canvas
  const targetNode = inspect.outputs?.[0];
  if (targetNode) {
    console.log(`\n🩹 3. Testing "modify_prompt" (Self-Healing prompt injection on "${targetNode.label}")...`);
    const originalPrompt = targetNode.prompt;
    const healedPrompt = `${originalPrompt.replace(/No 2D cartoon look\./g, '').trim()} Pixar 3D subsurface scattering, volumetric god rays.`;
    
    await sendRpc('modify_prompt', {
      nodeId: targetNode.nodeId,
      prompt: healedPrompt,
    });
    console.log('   ✅ Prompt successfully updated on canvas card!');
  }

  console.log('\n====================================================');
  console.log('🎉 LIVE MCP SUITE & STUDIO CANVAS TEST PASSED 100%!');
  console.log('====================================================\n');

  ws.close();
  process.exit(0);
}

runLiveTest().catch((err) => {
  console.error('\n❌ Live Test Failed:', err.message);
  process.exit(1);
});
