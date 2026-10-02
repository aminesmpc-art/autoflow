/* ============================================================
   Create ASMR Car Story Graph via studio_create_story_graph
   Replaces the canvas with a clean Story Director + 4 Shot 
   Video Pipeline and Last Frame continuity chaining.
   ============================================================ */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import path from 'path';

async function createAsmrStory() {
  console.log('🚀 Connecting to AutoFlow MCP Server...');

  const transport = new StdioClientTransport({
    command: 'node',
    args: [path.resolve(__dirname, 'index.js')],
  });

  const client = new Client(
    { name: 'asmr-story-creator', version: '1.0.0' },
    { capabilities: {} }
  );

  await client.connect(transport);
  console.log('✅ Connected over Stdio!\n');

  const defaultVehicle = 'Porsche 911 GT3 RS (992) in Ruby Star Neo with Carbon Aero';

  console.log('🎬 Executing `studio_create_story_graph` for ASMR Car Craftsman...');

  const result = await client.callTool({
    name: 'studio_create_story_graph',
    arguments: {
      brief: `Ultra-cinematic ASMR craftsmanship sequence: Master artisan carves a solid block of premium hardwood into a detailed miniature ${defaultVehicle}, finishing with a match-cut transition to the real-life automobile on rain-soaked city pavement.`,
      structure: 'commercial',
      shotCount: 4,
      camera: 'dynamic',
      cast: [
        {
          name: 'Master Craftsman',
          look: 'Weathered artisan hands with subtle wood dust, rolled dark denim sleeves, vintage leather apron, working with precision carving tools',
          role: 'artisan',
        },
        {
          name: defaultVehicle,
          look: `${defaultVehicle}, exact manufacturer aero lines, signature front grille, aerodynamic widebody, high-gloss automotive paint finish`,
          role: 'hero_car',
        },
      ],
    },
  });

  console.log('✨ Result from Studio Canvas:', JSON.stringify(result, null, 2));

  // Inspect what's on the canvas now
  const canvasRes = await client.callTool({
    name: 'studio_get_canvas',
    arguments: {},
  });

  const canvasData = JSON.parse(((canvasRes as any).content[0] as any)?.text || '{}');
  console.log(`\n📊 Canvas Now Contains: ${canvasData.nodes?.length || 0} nodes and ${canvasData.edges?.length || 0} edges.`);

  process.exit(0);
}

createAsmrStory().catch((err) => {
  console.error('Error creating story:', err);
  process.exit(1);
});
