/* ============================================================
   Ultra-Consistent ASMR Car Pipeline (First Frame + Last Frame Chain)
   Complete 10-node production pipeline:
   [Prompt Variable] ➔ [Story Director]
                            │
                            ├➔ [First Frame Still (Nano Banana 2)]
                            │         │ (start frame)
                            ├➔ [Shot 1 Video] ➔ [Last Frame 1]
                            │                         │ (start frame)
                            ├➔ [Shot 2 Video] ➔ [Last Frame 2]
                            │                         │ (start frame)
                            ├➔ [Shot 3 Video] ➔ [Last Frame 3]
                            │                         │ (start frame)
                            └➔ [Shot 4 Video (Match-cut to Real Car)]
   ============================================================ */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import path from 'path';

async function deployContinuityPipeline() {
  console.log('🎬 Deploying 100% Consistent First-Frame + Last-Frame ASMR Pipeline...');

  const transport = new StdioClientTransport({
    command: 'node',
    args: [path.resolve(__dirname, 'index.js')],
  });

  const client = new Client(
    { name: 'asmr-continuity-deployer', version: '1.0.0' },
    { capabilities: {} }
  );

  await client.connect(transport);
  console.log('✅ Connected over Stdio!\n');

  const defaultVehicle = 'Porsche 911 GT3 RS (992) in Ruby Star Neo with Exposed Carbon Aero';

  // Node IDs
  const promptId = 'node_prompt_vehicle';
  const directorId = 'node_story_director';
  const firstFrameId = 'node_first_frame_still';
  const shot1Id = 'node_shot_1_video';
  const frame1Id = 'node_last_frame_1';
  const shot2Id = 'node_shot_2_video';
  const frame2Id = 'node_last_frame_2';
  const shot3Id = 'node_shot_3_video';
  const frame3Id = 'node_last_frame_3';
  const shot4Id = 'node_shot_4_video';

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
      position: { x: 50, y: 220 },
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
      position: { x: 440, y: 160 },
      data: {
        type: 'story',
        label: 'Story Director — ASMR Car Maker',
        brief: `Ultra-cinematic ASMR craftsmanship sequence: Master artisan carves a solid block of premium hardwood into a detailed miniature ${defaultVehicle}, finishing with a match-cut transition to the real-life automobile on rain-soaked city pavement.`,
        structure: 'commercial',
        cameraProgression: 'establishingToClose',
        audioMode: 'soundEffects',
        shotTitles: [
          'First Frame Still: Raw Walnut Block & Artisan Workshop',
          'Scene 1: Raw Wood Carving (ASMR Silhouette)',
          'Scene 2: Precision Detailing (Grille, Headlights & Vents)',
          'Scene 3: Paint, Clear Coat & Wheel Assembly',
          'Scene 4: Match-Cut Transformation to Real Automobile',
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

    // 3. First Frame Image Still (Nano Banana 2 Image Generator)
    {
      id: firstFrameId,
      type: 'generate',
      position: { x: 920, y: 40 },
      data: {
        type: 'generate',
        label: 'First Frame Still (Nano Banana 2)',
        mediaType: 'image',
        platform: 'flow',
        model: 'Nano Banana 2',
        aspectRatio: '16:9',
        buildFrom: 'text',
        prompt: firstFramePrompt,
        status: 'idle',
      },
    },

    // 4. Shot 1 Video Node (Builds from First Frame Still)
    {
      id: shot1Id,
      type: 'generate',
      position: { x: 920, y: 440 },
      data: {
        type: 'generate',
        label: 'Scene 1: Raw Wood Carving',
        mediaType: 'video',
        platform: 'flow',
        model: 'Omni Flash',
        aspectRatio: '16:9',
        duration: '6s',
        buildFrom: 'start_image',
        prompt: shotPrompts[0],
        status: 'idle',
      },
    },

    // 5. Last Frame 1 Node (Captures end of Shot 1)
    {
      id: frame1Id,
      type: 'frame',
      position: { x: 1360, y: 240 },
      data: {
        type: 'frame',
        label: 'Last Frame 1',
        frameMode: 'last',
        status: 'idle',
      },
    },

    // 6. Shot 2 Video Node (Builds from Last Frame 1)
    {
      id: shot2Id,
      type: 'generate',
      position: { x: 1360, y: 440 },
      data: {
        type: 'generate',
        label: 'Scene 2: Precision Detailing',
        mediaType: 'video',
        platform: 'flow',
        model: 'Omni Flash',
        aspectRatio: '16:9',
        duration: '6s',
        buildFrom: 'start_image',
        prompt: shotPrompts[1],
        status: 'idle',
      },
    },

    // 7. Last Frame 2 Node (Captures end of Shot 2)
    {
      id: frame2Id,
      type: 'frame',
      position: { x: 1800, y: 240 },
      data: {
        type: 'frame',
        label: 'Last Frame 2',
        frameMode: 'last',
        status: 'idle',
      },
    },

    // 8. Shot 3 Video Node (Builds from Last Frame 2)
    {
      id: shot3Id,
      type: 'generate',
      position: { x: 1800, y: 440 },
      data: {
        type: 'generate',
        label: 'Scene 3: Paint & Wheels',
        mediaType: 'video',
        platform: 'flow',
        model: 'Omni Flash',
        aspectRatio: '16:9',
        duration: '6s',
        buildFrom: 'start_image',
        prompt: shotPrompts[2],
        status: 'idle',
      },
    },

    // 9. Last Frame 3 Node (Captures end of Shot 3)
    {
      id: frame3Id,
      type: 'frame',
      position: { x: 2240, y: 240 },
      data: {
        type: 'frame',
        label: 'Last Frame 3',
        frameMode: 'last',
        status: 'idle',
      },
    },

    // 10. Shot 4 Video Node (Match-cut from Last Frame 3 to Real Car)
    {
      id: shot4Id,
      type: 'generate',
      position: { x: 2240, y: 440 },
      data: {
        type: 'generate',
        label: 'Scene 4: Match-Cut Real Car Reveal',
        mediaType: 'video',
        platform: 'flow',
        model: 'Omni Flash',
        aspectRatio: '16:9',
        duration: '6s',
        buildFrom: 'start_image',
        prompt: shotPrompts[3],
        status: 'idle',
      },
    },
  ];

  const edges = [
    // Prompt Variable -> Story Director
    {
      id: `edge-${promptId}-${directorId}`,
      source: promptId,
      sourceHandle: 'text',
      target: directorId,
      targetHandle: 'text',
      type: 'deletable',
    },

    // Story Director -> First Frame Image
    {
      id: `edge-${directorId}-${firstFrameId}`,
      source: directorId,
      sourceHandle: 'text',
      target: firstFrameId,
      targetHandle: 'text',
      type: 'deletable',
    },

    // Story Director -> All 4 Video Shots
    {
      id: `edge-${directorId}-${shot1Id}`,
      source: directorId,
      sourceHandle: 'text',
      target: shot1Id,
      targetHandle: 'text',
      type: 'deletable',
    },
    {
      id: `edge-${directorId}-${shot2Id}`,
      source: directorId,
      sourceHandle: 'text',
      target: shot2Id,
      targetHandle: 'text',
      type: 'deletable',
    },
    {
      id: `edge-${directorId}-${shot3Id}`,
      source: directorId,
      sourceHandle: 'text',
      target: shot3Id,
      targetHandle: 'text',
      type: 'deletable',
    },
    {
      id: `edge-${directorId}-${shot4Id}`,
      source: directorId,
      sourceHandle: 'text',
      target: shot4Id,
      targetHandle: 'text',
      type: 'deletable',
    },

    // CONTINUITY PIPELINE CHAIN:
    // 1. First Frame Still (image) -> Shot 1 Video (frame_start)
    {
      id: `edge-${firstFrameId}-${shot1Id}`,
      source: firstFrameId,
      sourceHandle: 'image',
      target: shot1Id,
      targetHandle: 'frame_start',
      type: 'deletable',
    },

    // 2. Shot 1 Video (video) -> Last Frame 1 (image_ref)
    {
      id: `edge-${shot1Id}-${frame1Id}`,
      source: shot1Id,
      sourceHandle: 'video',
      target: frame1Id,
      targetHandle: 'image_ref',
      type: 'deletable',
    },

    // 3. Last Frame 1 (image) -> Shot 2 Video (frame_start)
    {
      id: `edge-${frame1Id}-${shot2Id}`,
      source: frame1Id,
      sourceHandle: 'image',
      target: shot2Id,
      targetHandle: 'frame_start',
      type: 'deletable',
    },

    // 4. Shot 2 Video (video) -> Last Frame 2 (image_ref)
    {
      id: `edge-${shot2Id}-${frame2Id}`,
      source: shot2Id,
      sourceHandle: 'video',
      target: frame2Id,
      targetHandle: 'image_ref',
      type: 'deletable',
    },

    // 5. Last Frame 2 (image) -> Shot 3 Video (frame_start)
    {
      id: `edge-${frame2Id}-${shot3Id}`,
      source: frame2Id,
      sourceHandle: 'image',
      target: shot3Id,
      targetHandle: 'frame_start',
      type: 'deletable',
    },

    // 6. Shot 3 Video (video) -> Last Frame 3 (image_ref)
    {
      id: `edge-${shot3Id}-${frame3Id}`,
      source: shot3Id,
      sourceHandle: 'video',
      target: frame3Id,
      targetHandle: 'image_ref',
      type: 'deletable',
    },

    // 7. Last Frame 3 (image) -> Shot 4 Video (frame_start - Match Cut)
    {
      id: `edge-${frame3Id}-${shot4Id}`,
      source: frame3Id,
      sourceHandle: 'image',
      target: shot4Id,
      targetHandle: 'frame_start',
      type: 'deletable',
    },
  ];

  console.log(`🚀 Deploying ${nodes.length} nodes and ${edges.length} wired continuity cables...`);

  const res = await client.callTool({
    name: 'studio_set_workflow',
    arguments: {
      name: 'ASMR Woodcarving to Real Car (Continuity Locked)',
      nodes,
      edges,
    },
  });

  console.log('Result:', ((res as any).content[0] as any)?.text);

  console.log('\n====================================================');
  console.log('🎉 100% CONTINUITY-LOCKED ASMR PIPELINE DEPLOYED!');
  console.log('====================================================\n');

  process.exit(0);
}

deployContinuityPipeline().catch((err) => {
  console.error('Continuity pipeline deployment error:', err);
  process.exit(1);
});
