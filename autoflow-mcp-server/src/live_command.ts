/* ============================================================
   AutoFlow Live Canvas Commander
   Connects to ws://localhost:8124 and beams a live workflow 
   into the user's open Studio Chrome tab.
   ============================================================ */

import { WebSocket } from 'ws';

const WS_PORT = 8124;

async function sendLiveCommand() {
  console.log(`📡 Connecting to AutoFlow Studio on ws://localhost:${WS_PORT}...`);

  const ws = new WebSocket(`ws://localhost:${WS_PORT}`);

  await new Promise<void>((resolve, reject) => {
    ws.on('open', resolve);
    ws.on('error', reject);
  });

  console.log('🟢 Connected to live Studio bridge!');

  // Helper to send RPC
  function callAction(action: string, params: any = {}): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = `live_${Date.now()}`;
      const msg = { id, type: 'request', action, params };

      const timeout = setTimeout(() => {
        reject(new Error(`Timeout waiting for action: ${action}`));
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

  console.log('\n🎬 Sending `create_story_graph` to user canvas...');
  
  const createResult = await callAction('create_story_graph', {
    brief: 'A cute baby dragon with emerald eyes learning to breathe tiny sparks in a glowing crystal canyon.',
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
  });

  console.log('✅ Response from Studio:', JSON.stringify(createResult, null, 2));

  console.log('\n🔍 Reading updated canvas state...');
  const canvasState = await callAction('get_canvas');
  console.log('📊 Current Canvas Summary:', {
    nodesCount: canvasState?.result?.nodes?.length ?? 0,
    edgesCount: canvasState?.result?.edges?.length ?? 0,
    nodeTypes: canvasState?.result?.nodes?.map((n: any) => `${n.type}: ${n.data?.label || n.id}`),
  });

  ws.close();
  console.log('\n✨ Live workflow transmission completed successfully!');
}

sendLiveCommand().catch((err) => {
  console.error('❌ Error sending live command:', err);
  process.exit(1);
});
