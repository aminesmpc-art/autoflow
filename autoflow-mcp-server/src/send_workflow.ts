/* ============================================================
   AutoFlow MCP Live Executor
   Executes studio_create_story_graph via the active MCP bridge.
   ============================================================ */

import { WebSocket } from 'ws';

const WS_PORT = 8124;

async function runLiveWorkflow() {
  console.log(`Connecting to local MCP server on port ${WS_PORT}...`);

  // We connect directly to the extension via WebSocket or trigger RPC
  const ws = new WebSocket(`ws://localhost:${WS_PORT}`);

  await new Promise<void>((resolve, reject) => {
    ws.on('open', resolve);
    ws.on('error', reject);
  });

  console.log('🟢 Connected! Sending `create_story_graph` command...');

  const reqId = `cmd_${Date.now()}`;
  const command = {
    id: reqId,
    type: 'request',
    action: 'create_story_graph',
    params: {
      brief: 'A baby dragon named Ignis learning to fly over a glowing crystal canyon at sunset.',
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
  };

  ws.send(JSON.stringify(command));

  console.log('📡 Waiting for confirmation from Studio canvas...');

  await new Promise<void>((resolve) => {
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.id === reqId || msg.action === 'create_story_graph') {
          console.log('\n========================================');
          console.log('🎉 STUDIO CANVAS UPDATED SUCCESSFULLY!');
          console.log('========================================');
          console.log('Result:', JSON.stringify(msg, null, 2));
          resolve();
        }
      } catch {}
    });

    setTimeout(() => {
      console.log('⏳ Command sent to open Studio tab!');
      resolve();
    }, 4000);
  });

  ws.close();
}

runLiveWorkflow().catch(console.error);
