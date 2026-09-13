/* ============================================================
   Viral Baby Dragon Short-Form Pipeline (Reels / TikTok / Shorts)
   100% Original Character & Concept:
   "Emberlyn The Pygmy Cinder Drake — The Fire-Pepper Hiccup"
   ============================================================ */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import path from 'path';

async function deployViralBabyDragon() {
  console.log('🐉 Deploying 100% Original Viral Baby Dragon Pipeline via MCP...');

  const transport = new StdioClientTransport({
    command: 'node',
    args: [path.resolve(__dirname, 'index.js')],
  });

  const client = new Client(
    { name: 'viral-dragon-deployer', version: '1.0.0' },
    { capabilities: {} }
  );

  await client.connect(transport);
  console.log('✅ Connected over Stdio!\n');

  const charName = 'Emberlyn (The Pygmy Cinder Drake)';
  const charLook = 'Kitten-sized plump baby dragon, oversized golden-amber curious eyes with vertical slit pupils, velvety iridescent emerald and obsidian scales with tiny glowing orange embers along the spine, soft stubby clawed paws, translucent bioluminescent winglets that flutter rapidly like a hummingbird, tiny blunt horns with soft warm glow, adorable mischievous micro-expressions.';

  // Node IDs
  const promptId = 'p_dragon_idea';
  const directorId = 'director_dragon';
  const stillId = 'g_still_dragon';
  const shot1Id = 'g_shot1_dragon';
  const frame1Id = 'f_frame1_dragon';
  const shot2Id = 'g_shot2_dragon';
  const frame2Id = 'f_frame2_dragon';
  const shot3Id = 'g_shot3_dragon';
  const frame3Id = 'f_frame3_dragon';
  const shot4Id = 'g_shot4_dragon';

  const stillPrompt = `High-end stylized 3D feature animation render, Pixar-quality subsurface scattering, 9:16 vertical framing, 8K ultra-detailed. ${charLook} Emberlyn sits curiously on a rustic sunlit wooden potting bench inside an enchanted botanical glass conservatory, tilted head, examining a woven miniature basket overflowing with glowing ruby-red fire-peppers that emit soft golden sparks. Warm morning sunbeams filter through stained glass, dust motes dancing in the air, shallow cinematic depth of field.`;

  const shotPrompts = [
    // Shot 1: The Forbidden Snack
    `High-end 3D animation, Pixar-style subsurface scattering on scales and skin, 9:16 vertical framing, warm sunlit greenhouse lighting. Extreme close-up of ${charLook} Emberlyn playfully stuffing an entire glowing ruby fire-pepper into puffed-out cheeks. Emberlyn's large amber eyes widen in hilarious spicy shock as cheeks glow bright neon orange like a lightbulb. Translucent winglets buzz rapidly in surprise. Ambient noise: Cozy greenhouse room tone, gentle breeze through foliage. SFX: Crisp crunchy vegetable bite, curious baby dragon coo, playful sizzling sound as cheeks illuminate.`,
    
    // Shot 2: The Spark Hiccups
    `High-end 3D animation, 9:16 vertical framing, dynamic medium close-up. ${charLook} Emberlyn gets the hiccups from the spicy fire-pepper! With each adorable toddler dragon hiccup, a gentle shockwave makes Emberlyn's ears wiggle and releases a tiny puff of sparkling lavender and golden embers from the nostrils. Emberlyn tries to clamp tiny stubby paws over mouth, blinking in wide-eyed bewildered embarrassment. Ambient noise: Soft sunlit room ambience. SFX: Squeaky cute dragon hiccup, gentle crackle of sparkling embers popping, rapid flutter of hummingbird winglets.`,
    
    // Shot 3: The Big Sneeze Build-Up & Climax
    `High-end 3D animation, 9:16 vertical framing, dramatic push-in shot. ${charLook} Emberlyn's little dragon nose begins to twitch violently as a colossal sneeze builds up. Emberlyn tilts head back, scrunching eyes tight, inhaling deeply, rearing up on hind paws. ACHOO! Emberlyn sneezes a magnificent swirling vortex of harmless glittering golden confetti-sparks and glowing bioluminescent fireflies that fill the entire frame in a magical explosion of light and color. Ambient noise: Echoing glass conservatory acoustics. SFX: Deep cute nasal inhale, energetic squeaky baby sneeze, magical crystal chime explosion and crackling spark shower.`,
    
    // Shot 4: The Triumphant Clapping & Loop Hook
    `High-end 3D animation, 9:16 vertical framing, low angle slow dolly out. ${charLook} Emberlyn plops back onto the wooden bench amidst a gentle cascade of floating golden sparkles. Emberlyn looks around at the sparkling fireflies in pure delight, clapping tiny stubby paws together with an infectious, toothless joyful dragon giggle. The camera pulls back to reveal the peaceful enchanted conservatory, perfectly continuous with the opening scene for a seamless looping Short/Reel. Ambient noise: Peaceful magical conservatory ambiance, distant songbirds. SFX: Soft dragon purr, joyful squeaks, gentle crystalline chime ambiance.`
  ];

  const nodes = [
    // 1. Viral Concept Input Card
    {
      id: promptId,
      type: 'prompt',
      position: { x: 40, y: 220 },
      data: {
        type: 'prompt',
        label: 'Viral Short Concept [ORIGINAL CHARACTER]',
        text: `Character: ${charName}\nStory: Emberlyn sneakily eats a magical fire-pepper, gets colorful sparkling hiccups, and lets out an epic confetti-sneeze that fills the room with fireflies!\nTarget: Viral TikTok, IG Reels & YouTube Shorts (9:16 Vertical)`,
      },
    },

    // 2. Story Director Node (Configured for 3D Feature Animation)
    {
      id: directorId,
      type: 'story',
      position: { x: 440, y: 160 },
      data: {
        type: 'story',
        label: 'Story Director — Baby Dragon Shorts',
        brief: `Original viral short-form 3D animation: Kitten-sized baby cinder drake eats a spicy fire-pepper, gets sparkling hiccups, and sneezes a magical cloud of glowing fireflies in a sunlit conservatory.`,
        structure: 'hook',
        cameraProgression: 'dynamic',
        audioMode: 'cinematic',
        visualPreset: 'cgi3d',
        colorTemp: 'daylight',
        lighting: 'hero',
        shotTitles: [
          'Master Reference Still: Sunlit Greenhouse Bench',
          'Scene 1: The Spicy Crunch Hook',
          'Scene 2: Spark Hiccups Escalation',
          'Scene 3: The Magical Confetti Sneeze',
          'Scene 4: Joyful Paws & Seamless Loop',
        ],
        shotPrompts: [stillPrompt, ...shotPrompts],
        cast: [
          {
            name: charName,
            look: charLook,
            role: 'lead_character',
          },
        ],
        status: 'done',
      },
    },

    // 3. First Frame Master Reference (Nano Banana 2 Image Still, 9:16)
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
        aspectRatio: '9:16',
        prompt: stillPrompt,
        status: 'idle',
      },
    },

    // 4. Scene 1 Video Node (9:16, 6s)
    {
      id: shot1Id,
      type: 'generate',
      position: { x: 920, y: 480 },
      data: {
        type: 'generate',
        label: 'Scene 1: The Spicy Crunch Hook',
        mediaType: 'video',
        platform: 'flow',
        model: 'Omni Flash',
        aspectRatio: '9:16',
        duration: '6s',
        prompt: shotPrompts[0],
        status: 'idle',
      },
    },

    // 5. Last Frame 1 Node
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

    // 6. Scene 2 Video Node (9:16, 6s)
    {
      id: shot2Id,
      type: 'generate',
      position: { x: 1720, y: 480 },
      data: {
        type: 'generate',
        label: 'Scene 2: Spark Hiccups Escalation',
        mediaType: 'video',
        platform: 'flow',
        model: 'Omni Flash',
        aspectRatio: '9:16',
        duration: '6s',
        prompt: shotPrompts[1],
        status: 'idle',
      },
    },

    // 7. Last Frame 2 Node
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

    // 8. Scene 3 Video Node (9:16, 6s)
    {
      id: shot3Id,
      type: 'generate',
      position: { x: 2520, y: 480 },
      data: {
        type: 'generate',
        label: 'Scene 3: Magical Confetti Sneeze',
        mediaType: 'video',
        platform: 'flow',
        model: 'Omni Flash',
        aspectRatio: '9:16',
        duration: '6s',
        prompt: shotPrompts[2],
        status: 'idle',
      },
    },

    // 9. Last Frame 3 Node
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

    // 10. Scene 4 Video Node (9:16, 6s)
    {
      id: shot4Id,
      type: 'generate',
      position: { x: 3320, y: 480 },
      data: {
        type: 'generate',
        label: 'Scene 4: Joyful Paws & Loop',
        mediaType: 'video',
        platform: 'flow',
        model: 'Omni Flash',
        aspectRatio: '9:16',
        duration: '6s',
        prompt: shotPrompts[3],
        status: 'idle',
      },
    },
  ];

  const edges = [
    // Text Wires
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

  console.log('💾 Deploying 10-Node Original Baby Dragon Short to canvas...');
  const res = await client.callTool({
    name: 'studio_set_workflow',
    arguments: {
      name: 'Baby Dragon: The Fire-Pepper Hiccup (Viral Short 9:16)',
      nodes,
      edges,
    },
  });

  console.log('Result:', ((res as any).content[0] as any)?.text);

  console.log('\n====================================================');
  console.log('🎉 ORIGINAL VIRAL BABY DRAGON PIPELINE DEPLOYED (9:16)!');
  console.log('====================================================\n');

  process.exit(0);
}

deployViralBabyDragon().catch((err) => {
  console.error('Deployment error:', err);
  process.exit(1);
});
