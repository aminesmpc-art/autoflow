/* ============================================================
   AutoFlow MCP Live Pipeline Trigger & Monitor
   Triggers `run_pipeline` over the active MCP bridge and streams
   real-time node generation progress.
   ============================================================ */

import { WebSocket } from 'ws';

const WS_PORT = 8124;

async function startAndMonitorRun() {
  console.log(`Connecting to AutoFlow MCP on ws://localhost:${WS_PORT}...`);

  const ws = new WebSocket(`ws://localhost:${WS_PORT}`);

  await new Promise<void>((resolve, reject) => {
    ws.on('open', resolve);
    ws.on('error', reject);
  });

  console.log('🟢 Connected to live Studio MCP bridge!');

  function sendRpc(action: string, params: any = {}): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = `run_${Date.now()}`;
      const msg = { id, type: 'request', action, params };

      const timeout = setTimeout(() => {
        reject(new Error(`Timeout on action: ${action}`));
      }, 10000);

      const handler = (data: any) => {
        try {
          const res = JSON.parse(data.toString());
          if (res.id === id || res.action === action) {
            clearTimeout(timeout);
            ws.removeListener('message', handler);
            resolve(res);
          }
        } catch {}
      };

      ws.on('message', handler);
      ws.send(JSON.stringify(msg));
    });
  }

  console.log('\n🚀 Triggering `run_pipeline` on your open canvas...');
  const runResult = await sendRpc('run_pipeline');
  console.log('✅ Pipeline status:', JSON.stringify(runResult, null, 2));

  console.log('\n📡 Polling live node generation status every 3 seconds...');

  // Monitor for up to 30 seconds
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    try {
      const state = await sendRpc('get_canvas');
      const canvas = state?.result || state;
      const isRunning = canvas?.isRunning;
      const currentNodeId = canvas?.currentNodeId;
      const progress = canvas?.runProgress;

      console.log(`⏱️ [T+${(i + 1) * 3}s] Running: ${isRunning ? '⚡ YES' : '⏹️ NO'} | Current Node: ${currentNodeId || 'None'} | Progress: ${progress?.current || 0}/${progress?.total || 0}`);

      if (canvas?.nodes) {
        const activeOrDone = canvas.nodes.filter((n: any) => n.data?.status === 'running' || n.data?.status === 'done' || n.data?.status === 'error');
        activeOrDone.forEach((n: any) => {
          console.log(`   👉 ${n.data?.label || n.id} [${n.type}]: ${n.data?.status?.toUpperCase()} ${n.data?.statusNote ? `(${n.data.statusNote})` : ''} ${n.data?.error ? `❌ ${n.data.error}` : ''}`);
        });
      }

      if (!isRunning && i > 1) {
        console.log('\n🎉 Pipeline execution finished or idle.');
        break;
      }
    } catch (err: any) {
      console.log(`Polling status error:`, err?.message || err);
    }
  }

  ws.close();
  console.log('\n✨ Done monitoring pipeline run.');
}

startAndMonitorRun().catch(console.error);
