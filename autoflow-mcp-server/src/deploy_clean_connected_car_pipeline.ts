/* ============================================================
   Perfect Continuous ASMR Car Pipeline (Zero Break Cards)
   Direct 1-to-1 sequential chaining:
   [Prompt Variable] ➔ [Story Director]
                            │
                            ├➔ [First Frame Still (Nano Banana 2)]
                            │         │ (image_ref wire)
                            ├➔ [Shot 1 Video]
                            │         │ (image_ref wire)
                            ├➔ [Shot 2 Video]
                            │         │ (image_ref wire)
                            ├➔ [Shot 3 Video]
                            │         │ (image_ref wire)
                            └➔ [Shot 4 Video (Real Car Match-Cut)]
   ============================================================ */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import path from 'path';

async function deployCleanConnectedPipeline() {
  console.log('🎬 Deploying Clean 100% Connected ASMR Car Pipeline...');

  const transport = new StdioClientTransport({
    command: 'node',
    args: [path.resolve(__dirname, 'index.js')],
  });

  const client = new Client(
    { name: 'asmr-connected-deployer', version: '1.0.0' },
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
  const shot2Id = 'g_shot2';
  const shot3Id = 'g_shot3';
  const shot4Id = 'g_shot4';

  const firstFramePrompt = `Cinematic 8K master reference still, macro photography, 35mm lens, 1800K warm golden workshop lighting, shallow depth of field. A solid rectangular block of dark walnut hardwood sits on a rustic wooden artisan workbench, surrounded by precision Japanese woodcarving chisels, gouges, and scattered wood shavings. Meticulous pencil blueprint lines on the hardwood block outline the aerodynamic front silhouette, hood vents, and widebody stance of a ${defaultVehicle}. Photorealistic, ultra-detailed wood grain texture, warm dust motes floating in sunlight beams.`;

  const shotPrompts = [
    // Shot 1
    `Extreme macro 35mm shot, fine wood texture grain, shallow depth of field, warm workshop lighting. Weathered artisan hands holding a razor-sharp Japanese gouge slice smooth, paper-thin curls of dark walnut wood from the block, slowly carving away the excess timber to reveal the aerodynamic hood lines and front fascia contours of the miniature ${defaultVehicle}. Micro-focus on the wood fibers parting under the blade. Ambient audio: Deep satisfying ASMR wood carving slices, crisp timber crunching, rhythmic smooth chisel scraping.`,
    
    // Shot 2
    `Close-up cinematic macro tracking shot, warm volumetric workshop beams, soft golden reflections. The miniature wooden car body of the ${defaultVehicle} is refined using miniature needle files, 2000-grit sanding blocks, and a micro-rotary tool. Fine amber sawdust floats gently as the craftsman meticulously carves the front grille honeycomb texture, precision intake vents, chiseled door contours, and aerodynamic rear wing supports with museum-grade precision. Ambient audio: ASMR fine sandpaper rubbing against hardwood, gentle metallic file rasps, subtle rhythmic dust blowing.`,
    
    // Shot 3
    `Luxury commercial studio lighting, macro product cinematography, dramatic black glass turntable. Expert hands assemble miniature multi-spoke center-lock wheels with carbon ceramic brake calipers onto the sculpted ${defaultVehicle}. Multiple precision airbrush passes spray ultra-glossy Ruby Star automotive lacquer paint over the miniature body, followed by crystal-clear ceramic coat reflections. Polished chrome badges and carbon fiber trim pieces are gently set in place with miniature tweezers under gleaming studio key lights. Ambient audio: High-pressure airbrush hiss, delicate metallic clicks of wheel installation, liquid gloss shine resonance.`,
    
    // Shot 4
    `Seamless match-cut transition from the glossy handcrafted miniature on the turntable directly into the full-scale, real-life ${defaultVehicle}. The camera dramatically pulls back through a low sweeping cinematic crane shot, revealing the real automobile resting on dark rain-soaked asphalt in a modern downtown metropolis after sunset. Vibrant neon reflections and skyscraper bokeh shimmer across the wet glossy paint. The signature LED matrix headlights ignite with a bright sequence, followed by illuminated rear light bars. Slow heroic 360-degree orbit highlighting every aerodynamic curve before locking into a breathtaking front three-quarter angle. Ambient audio: Low bass swell, cinematic electronic chime as headlights ignite, distant rain ambiance and throaty exhaust rumble.`
  ];

  const nodes = [
    // 1. Vehicle Input Variable Node
    {
      id: promptId,
      type: 'prompt',
      position: { x: 40, y: 160 },
      data: {
        type: 'prompt',
        label: 'Vehicle Input Variable [INSERT VEHICLE]',
        text: `Vehicle: ${defaultVehicle}\n\n(Edit this car name anytime — Story Director will automatically adapt the entire 4-scene sequence!)`,
      },
    },

    // 2. Story Director Node
    {
      id: directorId,
      type: 'story',
      position: { x: 460, y: 120 },
      data: {
        type: 'story',
        label: 'Story Director — ASMR Car Maker',
        brief: `Ultra-cinematic ASMR craftsmanship sequence: Master artisan carves a solid block of premium hardwood into a detailed miniature ${defaultVehicle}, finishing with a match-cut transition to the real-life automobile on rain-soaked city pavement.`,
        structure: 'commercial',
        cameraProgression: 'establishingToClose',
        audioMode: 'soundEffects',
        shotTitles: [
          'First Frame Still: Raw Walnut Block Still',
          'Scene 1: Raw Wood Carving',
          'Scene 2: Precision Detailing',
          'Scene 3: Paint & Wheels',
          'Scene 4: Match-Cut Real Car Reveal',
        ],
        shotPrompts: [firstFramePrompt, ...shotPrompts],
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
        status: 'done',
      },
    },

    // 3. First Frame Still (Nano Banana 2 Image Generator)
    {
      id: stillId,
      type: 'generate',
      position: { x: 940, y: 60 },
      data: {
        type: 'generate',
        label: 'First Frame Still (Nano Banana 2)',
        mediaType: 'image',
        platform: 'flow',
        model: 'Nano Banana 2',
        aspectRatio: '16:9',
        prompt: firstFramePrompt,
        status: 'idle',
      },
    },

    // 4. Scene 1 Video Node
    {
      id: shot1Id,
      type: 'generate',
      position: { x: 1380, y: 60 },
      data: {
        type: 'generate',
        label: 'Scene 1: Raw Wood Carving',
        mediaType: 'video',
        platform: 'flow',
        model: 'Omni Flash',
        aspectRatio: '16:9',
        duration: '6s',
        prompt: shotPrompts[0],
        status: 'idle',
      },
    },

    // 5. Scene 2 Video Node
    {
      id: shot2Id,
      type: 'generate',
      position: { x: 1820, y: 60 },
      data: {
        type: 'generate',
        label: 'Scene 2: Precision Detailing',
        mediaType: 'video',
        platform: 'flow',
        model: 'Omni Flash',
        aspectRatio: '16:9',
        duration: '6s',
        prompt: shotPrompts[1],
        status: 'idle',
      },
    },

    // 6. Scene 3 Video Node
    {
      id: shot3Id,
      type: 'generate',
      position: { x: 2260, y: 60 },
      data: {
        type: 'generate',
        label: 'Scene 3: Paint & Wheels',
        mediaType: 'video',
        platform: 'flow',
        model: 'Omni Flash',
        aspectRatio: '16:9',
        duration: '6s',
        prompt: shotPrompts[2],
        status: 'idle',
      },
    },

    // 7. Scene 4 Video Node
    {
      id: shot4Id,
      type: 'generate',
      position: { x: 2700, y: 60 },
      data: {
        type: 'generate',
        label: 'Scene 4: Match-Cut Real Car Reveal',
        mediaType: 'video',
        platform: 'flow',
        model: 'Omni Flash',
        aspectRatio: '16:9',
        duration: '6s',
        prompt: shotPrompts[3],
        status: 'idle',
      },
    },
  ];

  const edges = [
    // 1. Prompt Variable -> Story Director (text wire)
    {
      id: `e_${promptId}_${directorId}_t`,
      source: promptId,
      sourceHandle: 'text',
      target: directorId,
      targetHandle: 'text',
      type: 'default',
    },

    // 2. Story Director -> First Frame Still (text wire)
    {
      id: `e_${directorId}_${stillId}_t`,
      source: directorId,
      sourceHandle: 'text',
      target: stillId,
      targetHandle: 'text',
      type: 'default',
    },

    // 3. Story Director -> 4 Video Shots (text wires)
    {
      id: `e_${directorId}_${shot1Id}_t`,
      source: directorId,
      sourceHandle: 'text',
      target: shot1Id,
      targetHandle: 'text',
      type: 'default',
    },
    {
      id: `e_${directorId}_${shot2Id}_t`,
      source: directorId,
      sourceHandle: 'text',
      target: shot2Id,
      targetHandle: 'text',
      type: 'default',
    },
    {
      id: `e_${directorId}_${shot3Id}_t`,
      source: directorId,
      sourceHandle: 'text',
      target: shot3Id,
      targetHandle: 'text',
      type: 'default',
    },
    {
      id: `e_${directorId}_${shot4Id}_t`,
      source: directorId,
      sourceHandle: 'text',
      target: shot4Id,
      targetHandle: 'text',
      type: 'default',
    },

    // 4. CONTINUOUS SEQUENTIAL CHAIN (image reference wires):
    // First Frame Still (result) -> Shot 1 (image_ref)
    {
      id: `e_${stillId}_${shot1Id}_i`,
      source: stillId,
      sourceHandle: 'result',
      target: shot1Id,
      targetHandle: 'image_ref',
      type: 'default',
    },

    // Shot 1 (result) -> Shot 2 (image_ref)
    {
      id: `e_${shot1Id}_${shot2Id}_i`,
      source: shot1Id,
      sourceHandle: 'result',
      target: shot2Id,
      targetHandle: 'image_ref',
      type: 'default',
    },

    // Shot 2 (result) -> Shot 3 (image_ref)
    {
      id: `e_${shot2Id}_${shot3Id}_i`,
      source: shot2Id,
      sourceHandle: 'result',
      target: shot3Id,
      targetHandle: 'image_ref',
      type: 'default',
    },

    // Shot 3 (result) -> Shot 4 (image_ref - Match Cut)
    {
      id: `e_${shot3Id}_${shot4Id}_i`,
      source: shot3Id,
      sourceHandle: 'result',
      target: shot4Id,
      targetHandle: 'image_ref',
      type: 'default',
    },
  ];

  console.log(`🚀 Deploying ${nodes.length} nodes and ${edges.length} directly connected cables...`);

  const res = await client.callTool({
    name: 'studio_set_workflow',
    arguments: {
      name: 'ASMR Woodcarving to Real Car (Direct Connected Chain)',
      nodes,
      edges,
    },
  });

  console.log('Result:', ((res as any).content[0] as any)?.text);

  console.log('\n====================================================');
  console.log('🎉 DIRECT CONNECTED ASMR PIPELINE DEPLOYED (NO BREAKS)!');
  console.log('====================================================\n');

  process.exit(0);
}

deployCleanConnectedPipeline().catch((err) => {
  console.error('Connected pipeline deployment error:', err);
  process.exit(1);
});
