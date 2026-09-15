/* ============================================================
   Deploy Clean ASMR Car Craftsmanship Workflow
   Clears canvas of overlapping nodes and lays out a pristine,
   perfectly spaced 4-scene ASMR Car transformation pipeline.
   ============================================================ */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import path from 'path';

async function deployCleanWorkflow() {
  console.log('🧹 Clearing canvas and deploying fresh ASMR Car Workflow...');

  const transport = new StdioClientTransport({
    command: 'node',
    args: [path.resolve(__dirname, 'index.js')],
  });

  const client = new Client(
    { name: 'asmr-clean-deployer', version: '1.0.0' },
    { capabilities: {} }
  );

  await client.connect(transport);
  console.log('✅ Connected over Stdio!\n');

  // Step 1: Clear canvas
  console.log('🧼 Step 1: Wiping old overlapping nodes from canvas...');
  await client.callTool({
    name: 'studio_clear_canvas',
    arguments: {},
  });

  const defaultVehicle = 'Porsche 911 GT3 RS (992) in Ruby Star Neo with Exposed Carbon Aero Package';

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

  // Step 2: Add Clean Vehicle Input Node
  console.log('📦 Step 2: Adding Vehicle Input Variable Node...');
  await client.callTool({
    name: 'studio_add_node',
    arguments: {
      type: 'prompt',
      label: 'Vehicle Input Variable [INSERT VEHICLE]',
      position: { x: 50, y: 220 },
      data: {
        label: 'Vehicle Input Variable',
        text: `Vehicle: ${defaultVehicle}\n\n(Edit this car name anytime — Story Director will automatically adapt the entire 4-scene sequence!)`,
      },
    },
  });

  // Step 3: Add Story Director
  console.log('🎭 Step 3: Adding Story Director Node...');
  await client.callTool({
    name: 'studio_add_node',
    arguments: {
      type: 'story',
      label: 'Story Director — ASMR Car Maker',
      position: { x: 450, y: 160 },
      data: {
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
      },
    },
  });

  // Step 4: Add 4 Clean Shot Nodes
  console.log('⚡ Step 4: Adding 4 Spacious Shot Nodes...');
  const shotCoords = [
    { x: 950, y: 50 },
    { x: 950, y: 420 },
    { x: 1450, y: 50 },
    { x: 1450, y: 420 },
  ];

  for (let i = 0; i < 4; i++) {
    await client.callTool({
      name: 'studio_add_node',
      arguments: {
        type: 'generate',
        label: shotTitles[i],
        position: shotCoords[i],
        data: {
          label: shotTitles[i],
          platform: 'flow',
          media: 'video',
          model: 'Omni Flash',
          aspectRatio: '16:9',
          duration: '6s',
          prompt: shotPrompts[i],
          status: 'idle',
        },
      },
    });
  }

  console.log('\n====================================================');
  console.log('✨ PRISTINE ASMR CAR CANVAS SUCCESSFULLY DEPLOYED!');
  console.log('====================================================\n');

  process.exit(0);
}

deployCleanWorkflow().catch((err) => {
  console.error('Deployment error:', err);
  process.exit(1);
});
