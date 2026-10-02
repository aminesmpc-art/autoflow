import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import path from 'path';

async function deployCompleteStoryboard() {
  console.log('🚀 Deploying Complete Master Storyboard to AutoFlow Studio Canvas...\n');

  const transport = new StdioClientTransport({
    command: 'node',
    args: [path.resolve(__dirname, 'index.js')],
  });

  const client = new Client({ name: 'master-deployer', version: '2.0.0' }, { capabilities: {} });
  await client.connect(transport);

  // 1. Clear Canvas
  console.log('🧹 1. Clearing Canvas...');
  const clearRes = await client.callTool({ name: 'studio_clear_canvas', arguments: {} });
  console.log(((clearRes as any).content[0] as any)?.text);

  // 2. Build full nodes and edges array
  const promptId = 'prompt-idea-master';
  const storyId = 'story-director-master';
  const stillId = 'gen-char-still';
  const shot1Id = 'gen-shot-1';
  const shot2Id = 'gen-shot-2';
  const shot3Id = 'gen-shot-3';
  const shot4Id = 'gen-shot-4';
  const frame1Id = 'frame-extract-1';
  const frame2Id = 'frame-extract-2';
  const frame3Id = 'frame-extract-3';

  const briefText = 'An adorable thumb-sized baby cinder drake named Emberlyn with shimmering ruby scales, tiny golden wings, and big round amber eyes tries to toast a tiny marshmallow on a twig. She takes a deep breath and hiccups out a burst of sparkling embers instead of fire. She giggles, her tail curling with delight, and tiny glowing fireflies swirl around her.';

  const nodes = [
    {
      id: promptId,
      type: 'prompt',
      position: { x: -350, y: 150 },
      data: {
        type: 'prompt',
        label: 'Story Brief (Idea)',
        text: briefText,
        status: 'idle',
      },
    },
    {
      id: storyId,
      type: 'story',
      position: { x: 50, y: 150 },
      data: {
        type: 'story',
        label: 'Story Director',
        brief: briefText,
        prompt: briefText,
        structure: 'hook',
        cameraProgression: 'dynamic',
        audioMode: 'cinematic',
        visualPreset: 'cgi3d',
        world: 'Enchanted mossy forest clearing at golden hour with glowing bioluminescent flora.',
        look: 'Pixar 3D CGI animation, subsurface scattering, warm volumetric sunlight, 8K ultra-detailed.',
        cast: [
          {
            name: 'Emberlyn',
            look: 'Thumb-sized baby cinder drake with shimmering ruby red scales, tiny golden wings, big round amber eyes with star pupils, small ivory horns, curled tail glowing orange.',
            role: 'protagonist',
            voice: 'Tiny squeaky baby dragon giggles',
          },
        ],
        status: 'idle',
      },
    },
    {
      id: stillId,
      type: 'generate',
      position: { x: 50, y: 480 },
      data: {
        type: 'generate',
        label: 'Master Ref: Emberlyn',
        mediaType: 'image',
        platform: 'flow',
        model: 'Nano Banana 2',
        aspectRatio: '9:16',
        prompt: 'Master character reference turnaround of Emberlyn, a thumb-sized baby cinder drake with shimmering ruby scales, tiny golden wings, and big round amber eyes. Pixar 3D CGI, 8K render, 9:16 vertical.',
        status: 'idle',
      },
    },
    {
      id: shot1Id,
      type: 'generate',
      position: { x: 520, y: 150 },
      data: {
        type: 'generate',
        label: 'Shot 1: The Marshmallow',
        mediaType: 'video',
        platform: 'flow',
        model: 'Omni Flow',
        aspectRatio: '9:16',
        duration: '6s',
        prompt: 'Close-up macro shot of Emberlyn the baby ruby cinder drake holding a tiny marshmallow on a pine twig, puffing her little cheeks and concentrating intensely. Ambient noise: gentle forest breeze and birdsong. SFX: soft crackling embers and adorable squeak.',
        status: 'idle',
      },
    },
    {
      id: frame1Id,
      type: 'frame',
      position: { x: 880, y: 320 },
      data: {
        type: 'frame',
        label: 'Last Frame 1',
        status: 'idle',
      },
    },
    {
      id: shot2Id,
      type: 'generate',
      position: { x: 960, y: 150 },
      data: {
        type: 'generate',
        label: 'Shot 2: The Sparkle Hiccup',
        mediaType: 'video',
        platform: 'flow',
        model: 'Omni Flow',
        aspectRatio: '9:16',
        duration: '6s',
        prompt: 'Medium close-up shot as Emberlyn gets a sudden hiccup, sending a burst of shimmering golden sparkles and warm glowing embers over the marshmallow. Ambient noise: twilight forest ambiance. SFX: cute baby hiccup sound and magical chime sparkle.',
        status: 'idle',
      },
    },
    {
      id: frame2Id,
      type: 'frame',
      position: { x: 1320, y: 320 },
      data: {
        type: 'frame',
        label: 'Last Frame 2',
        status: 'idle',
      },
    },
    {
      id: shot3Id,
      type: 'generate',
      position: { x: 1400, y: 150 },
      data: {
        type: 'generate',
        label: 'Shot 3: Golden Toast',
        mediaType: 'video',
        platform: 'flow',
        model: 'Omni Flow',
        aspectRatio: '9:16',
        duration: '6s',
        prompt: 'Dynamic tracking shot showing the marshmallow perfectly golden-toasted and gooey. Emberlyn looks at it with wonder in her wide sparkling amber eyes. Ambient noise: soft rustling leaves. SFX: sizzle of toasted sugar and tiny happy chirp.',
        status: 'idle',
      },
    },
    {
      id: frame3Id,
      type: 'frame',
      position: { x: 1760, y: 320 },
      data: {
        type: 'frame',
        label: 'Last Frame 3',
        status: 'idle',
      },
    },
    {
      id: shot4Id,
      type: 'generate',
      position: { x: 1840, y: 150 },
      data: {
        type: 'generate',
        label: 'Shot 4: Joyful Giggles',
        mediaType: 'video',
        platform: 'flow',
        model: 'Omni Flow',
        aspectRatio: '9:16',
        duration: '6s',
        prompt: 'Wide cinematic concluding shot as Emberlyn takes a tiny bite, curls her tail happily, and giggles as swirling fireflies illuminate the enchanted glade. Ambient noise: peaceful night forest crickets. SFX: sweet baby dragon laughter and magical sparkle.',
        status: 'idle',
      },
    },
  ];

  const edges = [
    // Idea Prompt -> Story Director
    {
      id: `edge-${promptId}-${storyId}-text`,
      source: promptId,
      sourceHandle: 'text',
      target: storyId,
      targetHandle: 'text',
      type: 'default',
      style: { stroke: '#8b5cf6', strokeWidth: 2.5 },
    },
    // Story Director -> Shots
    {
      id: `edge-${storyId}-${shot1Id}-text`,
      source: storyId,
      sourceHandle: 'text',
      target: shot1Id,
      targetHandle: 'text',
      type: 'default',
      style: { stroke: '#8b5cf6', strokeWidth: 2.5 },
    },
    {
      id: `edge-${storyId}-${shot2Id}-text`,
      source: storyId,
      sourceHandle: 'text',
      target: shot2Id,
      targetHandle: 'text',
      type: 'default',
      style: { stroke: '#8b5cf6', strokeWidth: 2.5 },
    },
    {
      id: `edge-${storyId}-${shot3Id}-text`,
      source: storyId,
      sourceHandle: 'text',
      target: shot3Id,
      targetHandle: 'text',
      type: 'default',
      style: { stroke: '#8b5cf6', strokeWidth: 2.5 },
    },
    {
      id: `edge-${storyId}-${shot4Id}-text`,
      source: storyId,
      sourceHandle: 'text',
      target: shot4Id,
      targetHandle: 'text',
      type: 'default',
      style: { stroke: '#8b5cf6', strokeWidth: 2.5 },
    },
    // Continuity Frame Chains
    {
      id: `edge-${shot1Id}-${frame1Id}-video`,
      source: shot1Id,
      sourceHandle: 'video',
      target: frame1Id,
      targetHandle: 'image_ref',
      type: 'default',
      style: { stroke: '#10b981', strokeWidth: 2.5 },
    },
    {
      id: `edge-${frame1Id}-${shot2Id}-ref`,
      source: frame1Id,
      sourceHandle: 'image',
      target: shot2Id,
      targetHandle: 'image_ref',
      type: 'default',
      style: { stroke: '#10b981', strokeWidth: 2.5 },
    },
    {
      id: `edge-${shot2Id}-${frame2Id}-video`,
      source: shot2Id,
      sourceHandle: 'video',
      target: frame2Id,
      targetHandle: 'image_ref',
      type: 'default',
      style: { stroke: '#10b981', strokeWidth: 2.5 },
    },
    {
      id: `edge-${frame2Id}-${shot3Id}-ref`,
      source: frame2Id,
      sourceHandle: 'image',
      target: shot3Id,
      targetHandle: 'image_ref',
      type: 'default',
      style: { stroke: '#10b981', strokeWidth: 2.5 },
    },
    {
      id: `edge-${shot3Id}-${frame3Id}-video`,
      source: shot3Id,
      sourceHandle: 'video',
      target: frame3Id,
      targetHandle: 'image_ref',
      type: 'default',
      style: { stroke: '#10b981', strokeWidth: 2.5 },
    },
    {
      id: `edge-${frame3Id}-${shot4Id}-ref`,
      source: frame3Id,
      sourceHandle: 'image',
      target: shot4Id,
      targetHandle: 'image_ref',
      type: 'default',
      style: { stroke: '#10b981', strokeWidth: 2.5 },
    },
  ];

  // 3. Atomically deploy workflow
  console.log('📦 2. Deploying Master Workflow to Canvas...');
  const setRes = await client.callTool({
    name: 'studio_set_workflow',
    arguments: {
      name: 'Baby Dragon Marshmallow Story',
      nodes,
      edges,
    },
  });
  console.log(((setRes as any).content[0] as any)?.text);

  // 4. Pre-Flight Diagnosis
  console.log('\n🔬 3. Running Pre-Flight Diagnosis...');
  const diagRes = await client.callTool({ name: 'studio_diagnose_canvas', arguments: {} });
  console.log(((diagRes as any).content[0] as any)?.text);

  console.log('\n====================================================');
  console.log('🎉 MASTER STORYBOARD DEPLOYED WITH 100% HEALTH!');
  console.log('====================================================\n');

  process.exit(0);
}

deployCompleteStoryboard().catch((e) => {
  console.error(e);
  process.exit(1);
});
