/* ============================================================
   Deploy & Test Full ASMR Director Skill Suite
   Deploys 10-node ASMR pipeline configured natively with:
   - structure: 'asmrCraft'
   - cameraProgression: 'asmrMacro'
   - audioMode: 'asmr'
   - visualPreset: 'asmrCraft'
   - colorTemp: 'amber'
   - lighting: 'intimate'
   And triggers Story Director live!
   ============================================================ */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import path from 'path';

async function deployAndTestAsmr() {
  console.log('🚀 Deploying 10-Node Workflow with ASMR Director Skill Suite...');

  const transport = new StdioClientTransport({
    command: 'node',
    args: [path.resolve(__dirname, 'index.js')],
  });

  const client = new Client(
    { name: 'asmr-suite-deployer', version: '1.0.0' },
    { capabilities: {} }
  );

  await client.connect(transport);
  console.log('✅ Connected over Stdio!\n');

  const defaultVehicle = 'Porsche 911 GT3 RS (992) in Ruby Star Neo with Exposed Carbon Aero';

  // Node IDs
  const promptId = 'p_car';
  const directorId = 'director_car';
  const stillId = 'g_still';
  const shot1Id = 'g_shot1';
  const frame1Id = 'f_frame1';
  const shot2Id = 'g_shot2';
  const frame2Id = 'f_frame2';
  const shot3Id = 'g_shot3';
  const frame3Id = 'f_frame3';
  const shot4Id = 'g_shot4';

  const nodes = [
    // 1. Vehicle Input Variable Node
    {
      id: promptId,
      type: 'prompt',
      position: { x: 40, y: 220 },
      data: {
        type: 'prompt',
        label: 'Vehicle Input Variable [INSERT VEHICLE]',
        text: `Vehicle: ${defaultVehicle}\n\n(Edit this car name anytime — Story Director will automatically adapt the entire 4-scene sequence!)`,
      },
    },

    // 2. Story Director Node (Configured with ASMR Director Skill Suite!)
    {
      id: directorId,
      type: 'story',
      position: { x: 440, y: 160 },
      data: {
        type: 'story',
        label: 'Story Director — ASMR Car Maker',
        brief: `Ultra-cinematic ASMR craftsmanship sequence: Master artisan carves a solid block of premium hardwood into a detailed miniature ${defaultVehicle}, finishing with a match-cut transition to the real-life automobile on rain-soaked city pavement.`,
        structure: 'asmrCraft',
        cameraProgression: 'asmrMacro',
        audioMode: 'asmr',
        visualPreset: 'asmrCraft',
        colorTemp: 'amber',
        lighting: 'intimate',
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
        status: 'idle',
      },
    },

    // 3. First Frame Still (Nano Banana 2 Image Generator)
    {
      id: stillId,
      type: 'generate',
      position: { x: 920, y: 40 },
      data: {
        type: 'generate',
        label: 'First Frame Still (Nano Banana 2)',
        mediaType: 'image',
        platform: 'flow',
        model: 'Nano Banana 2',
        aspectRatio: '16:9',
        status: 'idle',
      },
    },

    // 4. Scene 1 Video Node
    {
      id: shot1Id,
      type: 'generate',
      position: { x: 920, y: 480 },
      data: {
        type: 'generate',
        label: 'Scene 1: Raw Wood Carving',
        mediaType: 'video',
        platform: 'flow',
        model: 'Omni Flash',
        aspectRatio: '16:9',
        duration: '6s',
        status: 'idle',
      },
    },

    // 5. Last Frame 1 Node (Captures end of Scene 1)
    {
      id: frame1Id,
      type: 'frame',
      position: { x: 1360, y: 520 },
      data: {
        type: 'frame',
        label: 'Last Frame 1',
        frameMode: 'last',
        status: 'idle',
      },
    },

    // 6. Scene 2 Video Node
    {
      id: shot2Id,
      type: 'generate',
      position: { x: 1720, y: 480 },
      data: {
        type: 'generate',
        label: 'Scene 2: Precision Detailing',
        mediaType: 'video',
        platform: 'flow',
        model: 'Omni Flash',
        aspectRatio: '16:9',
        duration: '6s',
        status: 'idle',
      },
    },

    // 7. Last Frame 2 Node (Captures end of Scene 2)
    {
      id: frame2Id,
      type: 'frame',
      position: { x: 2160, y: 520 },
      data: {
        type: 'frame',
        label: 'Last Frame 2',
        frameMode: 'last',
        status: 'idle',
      },
    },

    // 8. Scene 3 Video Node
    {
      id: shot3Id,
      type: 'generate',
      position: { x: 2520, y: 480 },
      data: {
        type: 'generate',
        label: 'Scene 3: Paint & Wheels',
        mediaType: 'video',
        platform: 'flow',
        model: 'Omni Flash',
        aspectRatio: '16:9',
        duration: '6s',
        status: 'idle',
      },
    },

    // 9. Last Frame 3 Node (Captures end of Scene 3)
    {
      id: frame3Id,
      type: 'frame',
      position: { x: 2960, y: 520 },
      data: {
        type: 'frame',
        label: 'Last Frame 3',
        frameMode: 'last',
        status: 'idle',
      },
    },

    // 10. Scene 4 Video Node (Match-cut to Real Car)
    {
      id: shot4Id,
      type: 'generate',
      position: { x: 3320, y: 480 },
      data: {
        type: 'generate',
        label: 'Scene 4: Match-Cut Real Car Reveal',
        mediaType: 'video',
        platform: 'flow',
        model: 'Omni Flash',
        aspectRatio: '16:9',
        duration: '6s',
        status: 'idle',
      },
    },
  ];

  const edges = [
    // Text Wires from Story Director & Prompt
    {
      id: `e_${promptId}_${directorId}_t`,
      source: promptId,
      sourceHandle: 'text',
      target: directorId,
      targetHandle: 'text',
      type: 'default',
      style: { stroke: '#8b5cf6', strokeWidth: 2.5 },
    },
    {
      id: `e_${directorId}_${stillId}_t`,
      source: directorId,
      sourceHandle: 'text',
      target: stillId,
      targetHandle: 'text',
      type: 'default',
      style: { stroke: '#8b5cf6', strokeWidth: 2.5 },
    },
    {
      id: `e_${directorId}_${shot1Id}_t`,
      source: directorId,
      sourceHandle: 'text',
      target: shot1Id,
      targetHandle: 'text',
      type: 'default',
      style: { stroke: '#8b5cf6', strokeWidth: 2.5 },
    },
    {
      id: `e_${directorId}_${shot2Id}_t`,
      source: directorId,
      sourceHandle: 'text',
      target: shot2Id,
      targetHandle: 'text',
      type: 'default',
      style: { stroke: '#8b5cf6', strokeWidth: 2.5 },
    },
    {
      id: `e_${directorId}_${shot3Id}_t`,
      source: directorId,
      sourceHandle: 'text',
      target: shot3Id,
      targetHandle: 'text',
      type: 'default',
      style: { stroke: '#8b5cf6', strokeWidth: 2.5 },
    },
    {
      id: `e_${directorId}_${shot4Id}_t`,
      source: directorId,
      sourceHandle: 'text',
      target: shot4Id,
      targetHandle: 'text',
      type: 'default',
      style: { stroke: '#8b5cf6', strokeWidth: 2.5 },
    },

    // Visual Continuity Blue Cables
    {
      id: `e_${stillId}_${shot1Id}_i`,
      source: stillId,
      sourceHandle: 'result',
      target: shot1Id,
      targetHandle: 'image_ref',
      type: 'default',
      style: { stroke: '#3b82f6', strokeWidth: 2.5 },
    },
    {
      id: `e_${shot1Id}_${frame1Id}_i`,
      source: shot1Id,
      sourceHandle: 'result',
      target: frame1Id,
      targetHandle: 'image_ref',
      type: 'default',
      style: { stroke: '#3b82f6', strokeWidth: 2.5 },
    },
    {
      id: `e_${frame1Id}_${shot2Id}_i`,
      source: frame1Id,
      sourceHandle: 'image',
      target: shot2Id,
      targetHandle: 'image_ref',
      type: 'default',
      style: { stroke: '#3b82f6', strokeWidth: 2.5 },
    },
    {
      id: `e_${shot2Id}_${frame2Id}_i`,
      source: shot2Id,
      sourceHandle: 'result',
      target: frame2Id,
      targetHandle: 'image_ref',
      type: 'default',
      style: { stroke: '#3b82f6', strokeWidth: 2.5 },
    },
    {
      id: `e_${frame2Id}_${shot3Id}_i`,
      source: frame2Id,
      sourceHandle: 'image',
      target: shot3Id,
      targetHandle: 'image_ref',
      type: 'default',
      style: { stroke: '#3b82f6', strokeWidth: 2.5 },
    },
    {
      id: `e_${shot3Id}_${frame3Id}_i`,
      source: shot3Id,
      sourceHandle: 'result',
      target: frame3Id,
      targetHandle: 'image_ref',
      type: 'default',
      style: { stroke: '#3b82f6', strokeWidth: 2.5 },
    },
    {
      id: `e_${frame3Id}_${shot4Id}_i`,
      source: frame3Id,
      sourceHandle: 'image',
      target: shot4Id,
      targetHandle: 'image_ref',
      type: 'default',
      style: { stroke: '#3b82f6', strokeWidth: 2.5 },
    },
  ];

  console.log('💾 Setting complete workflow on canvas...');
  await client.callTool({
    name: 'studio_set_workflow',
    arguments: {
      name: 'ASMR Car Craftsmanship (ASMR Director Skill Active)',
      nodes,
      edges,
    },
  });

  console.log('🚀 Triggering pipeline run...');
  await client.callTool({
    name: 'studio_run_pipeline',
    arguments: {},
  });

  console.log('📡 Polling Story Director generation...');
  for (let i = 1; i <= 15; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const pollRes = await client.callTool({
      name: 'studio_get_canvas',
      arguments: {},
    });
    const currentCanvas = JSON.parse(((pollRes as any).content[0] as any)?.text || '{}');
    const currentDirector = (currentCanvas.nodes || []).find((n: any) => n.id === directorId);

    const status = currentDirector?.data?.status;
    const note = currentDirector?.data?.statusNote;
    const prompts = currentDirector?.data?.shotPrompts || [];
    const isRunning = currentCanvas.isRunning;

    console.log(`⏱️ [T+${i * 2}s] Pipeline: ${isRunning ? '⚡ ACTIVE' : 'IDLE'} | Director: [${status || 'idle'}] ${note ? `— ${note}` : ''} | Prompts: ${prompts.length}`);

    if (prompts.length > 0) {
      console.log('✨ ASMR prompts created!');
      break;
    }
  }

  process.exit(0);
}

deployAndTestAsmr().catch((err) => {
  console.error('Deployment error:', err);
  process.exit(1);
});
