/* ============================================================
   Perfect ASMR Car Video Pipeline Builder
   Lays out an elite Hollywood-grade 6-node workflow:
   [Prompt: Car Variable] ➔ [Story Director] ➔ [4 Video Flow Clips (16:9 Omni Flash)]
   ============================================================ */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import path from 'path';

async function deployPerfectPipeline() {
  console.log('🎬 Deploying Perfect Video-First ASMR Car Pipeline...');

  const transport = new StdioClientTransport({
    command: 'node',
    args: [path.resolve(__dirname, 'index.js')],
  });

  const client = new Client(
    { name: 'asmr-perfect-deployer', version: '1.0.0' },
    { capabilities: {} }
  );

  await client.connect(transport);
  console.log('✅ Connected over Stdio!\n');

  // Step 1: Clear old canvas
  console.log('🧹 Clearing canvas...');
  await client.callTool({
    name: 'studio_clear_canvas',
    arguments: {},
  });

  const defaultVehicle = 'Porsche 911 GT3 RS (992) in Ruby Star Neo with Exposed Carbon Aero';

  // Step 2: Define All Nodes with Exact Coordinates & Video Properties
  const promptNodeId = 'prompt_car_input';
  const directorNodeId = 'director_asmr_car';
  const shotIds = ['shot_1_wood', 'shot_2_detail', 'shot_3_paint', 'shot_4_reveal'];

  const shotTitles = [
    'Scene 1: Raw Wood Carving (ASMR Silhouette)',
    'Scene 2: Precision Detailing (Grille, Headlights & Vents)',
    'Scene 3: Paint, Clear Coat & Wheel Assembly',
    'Scene 4: Match-Cut Transformation to Real Automobile',
  ];

  const shotPrompts = [
    // Scene 1
    `Extreme macro 35mm shot, fine wood texture grain, shallow depth of field, warm workshop lighting. A solid block of premium dark walnut hardwood rests on a craftsman bench. Weathered artisan hands holding a razor-sharp Japanese gouge slice smooth, paper-thin curls of wood from the block, gradually revealing the aerodynamic hood lines and signature front fascia contours of a miniature ${defaultVehicle}. Micro-focus on the wood fibers parting under the chiseled blade. Crisp natural lighting with soft dust motes. Ambient audio: Deep satisfying ASMR wood carving slices, crisp timber crunching, rhythmic smooth chisel scraping.`,
    
    // Scene 2
    `Close-up cinematic macro tracking shot, warm volumetric workshop beams, soft golden reflections. The miniature wooden car body of a ${defaultVehicle} is refined using miniature needle files, 2000-grit sanding blocks, and a micro-rotary engraving tool. Fine amber sawdust floats gently into the air as the craftsman meticulously carves the front grille honeycomb texture, precision intake vents, chiseled door contours, and aerodynamic rear wing supports with museum-grade precision. Ambient audio: ASMR fine sandpaper rubbing against hardwood, gentle metallic file rasps, subtle rhythmic dust blowing.`,
    
    // Scene 3
    `Luxury commercial studio lighting, macro product cinematography, dramatic black glass turntable. Expert hands assemble miniature multi-spoke center-lock wheels with carbon ceramic brake calipers onto the sculpted ${defaultVehicle}. Multiple precision airbrush passes spray ultra-glossy automotive lacquer paint over the miniature body, followed by crystal-clear ceramic coat reflections. Polished chrome badges and carbon fiber trim pieces are gently set in place with miniature tweezers under gleaming studio key lights. Ambient audio: High-pressure airbrush hiss, delicate metallic clicks of wheel installation, liquid gloss shine resonance.`,
    
    // Scene 4
    `Seamless match-cut transition from the glossy handcrafted miniature on the turntable directly into the full-scale, real-life ${defaultVehicle}. The camera dramatically pulls back through a low sweeping cinematic crane shot, revealing the real automobile resting on dark rain-soaked asphalt in a modern downtown metropolis after sunset. Vibrant neon reflections and skyscraper bokeh shimmer across the wet glossy paint. The signature LED matrix headlights ignite with a bright sequence, followed by illuminated rear light bars. Slow heroic 360-degree orbit highlighting every aerodynamic curve before locking into a breathtaking front three-quarter angle. Ambient audio: Low bass swell, cinematic electronic chime as headlights ignite, distant rain ambiance and throaty exhaust rumble.`
  ];

  const nodes = [
    // 1. Prompt Input Node
    {
      id: promptNodeId,
      type: 'prompt',
      position: { x: 60, y: 150 },
      data: {
        type: 'prompt',
        label: 'Vehicle Input Variable [INSERT VEHICLE]',
        text: `Vehicle: ${defaultVehicle}\n\n(Edit this car name anytime — Story Director will automatically adapt the entire 4-scene sequence!)`,
      },
    },

    // 2. Story Director Node
    {
      id: directorNodeId,
      type: 'story',
      position: { x: 440, y: 100 },
      data: {
        type: 'story',
        label: 'Story Director — ASMR Car Maker',
        brief: `Ultra-cinematic ASMR craftsmanship sequence: Master artisan carves a solid block of premium hardwood into a detailed miniature ${defaultVehicle}, finishing with a match-cut transition to the real-life automobile on rain-soaked city pavement.`,
        structure: 'commercial',
        cameraProgression: 'establishingToClose',
        audioMode: 'soundEffects',
        shotTitles,
        shotPrompts,
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

    // 3. 4 Video Generation Nodes (Flow Video Omni Flash, 16:9, 6s)
    ...shotIds.map((id, i) => ({
      id,
      type: 'generate',
      position: { x: 900 + i * 420, y: 100 },
      data: {
        type: 'generate',
        label: shotTitles[i],
        mediaType: 'video', // Forces video mode in GenerateNode
        platform: 'flow',
        model: 'Omni Flash',
        aspectRatio: '16:9',
        duration: '6s',
        prompt: shotPrompts[i],
        status: 'idle',
      },
    })),
  ];

  // Step 3: Define Clean Connecting Cables
  const edges = [
    // Prompt Node -> Story Director
    {
      id: `edge-${promptNodeId}-${directorNodeId}`,
      source: promptNodeId,
      sourceHandle: 'text',
      target: directorNodeId,
      targetHandle: 'text',
      type: 'deletable',
    },

    // Story Director -> 4 Video Shots
    ...shotIds.map((targetId) => ({
      id: `edge-${directorNodeId}-${targetId}`,
      source: directorNodeId,
      sourceHandle: 'text',
      target: targetId,
      targetHandle: 'text',
      type: 'deletable',
    })),
  ];

  console.log(`📦 Injecting ${nodes.length} nodes and ${edges.length} edges via studio_set_workflow...`);

  const setResult = await client.callTool({
    name: 'studio_set_workflow',
    arguments: {
      name: 'ASMR Woodcarving to Real Car Commercial',
      nodes,
      edges,
    },
  });

  console.log('Result:', ((setResult as any).content[0] as any)?.text);

  console.log('\n====================================================');
  console.log('🎉 PERFECT ASMR CAR WORKFLOW SUCCESSFULLY DEPLOYED!');
  console.log('====================================================\n');

  process.exit(0);
}

deployPerfectPipeline().catch((err) => {
  console.error('Pipeline builder error:', err);
  process.exit(1);
});
