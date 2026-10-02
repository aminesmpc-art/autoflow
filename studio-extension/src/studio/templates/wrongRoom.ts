import type { Edge, Node } from '@xyflow/react';

import type { Template } from './index';

const cast = [
  {
    name: 'Captain Riko',
    look: 'Original fictional adult football captain with warm brown skin, short swept black hair, '
      + 'a square friendly face, athletic realistic-human proportions and a slightly oversized '
      + 'cartoon head. Emerald-and-coral number 7 jersey with no badge or logo, black shorts and '
      + 'white trainers.',
    role: 'Confident judge who stands between the doors and points to each choice',
  },
  {
    name: 'Leo Azul',
    look: 'Original fictional block-avatar athlete with a glossy cobalt rectangular body, rounded '
      + 'block limbs, a realistic friendly oval face, wavy dark-brown hair and a plain '
      + 'sky-blue-and-white striped sports top with no badge or logo.',
    role: 'Friendly first contestant',
  },
  {
    name: 'Gia Nova',
    look: 'Original fictional block-avatar woman with a glossy violet rectangular body, a realistic '
      + 'heart-shaped face, long dark auburn ponytail, teal cropped jacket, purple trousers and '
      + 'white shoes, always poised and smiling.',
    role: 'Confident second contestant',
  },
  {
    name: 'Turbo Jay',
    look: 'Original fictional block-avatar entertainer with a glossy orange rectangular body, a '
      + 'realistic expressive round face, short coiled black hair, lime hoodie, charcoal trousers '
      + 'and huge readable eyes.',
    role: 'High-energy third contestant with exaggerated reactions',
  },
  {
    name: 'Nico Block',
    look: 'Original fictional pixel-block athlete with a turquoise cubic torso and limbs, a '
      + 'realistic narrow face, short curly dark hair, plum sports shirt and a playful confused '
      + 'expression.',
    role: 'Final contestant who deliberately chooses the wrong room',
  },
  {
    name: 'Moss the Builder',
    look: 'Original fictional square-headed pixel-world guide with chestnut block hair, green '
      + 'shirt, tan pixel trousers and a calm neutral expression.',
    role: 'Silent background guide who always remains visible inside the centre room',
  },
];

const world =
  'One bright colourful studio room seen from one fixed front-facing medium-wide camera. Three '
  + 'open doorways stand side-by-side and never change order or geometry. LEFT is the Neon '
  + 'Arcade: blue neon light, a clean gaming desk, monitor, keyboard, chair and abstract game '
  + 'posters with no readable brands. CENTRE is the Pixel Meadow: green pixel-textured walls, '
  + 'grass-and-earth cubes and Moss the Builder visible inside. RIGHT is the Brick Bedroom: red '
  + 'walls, an interlocking-brick bed, colourful brick toys and cosy decorations. The main floor '
  + 'is pale wood. Door frames, furniture, props, lighting direction and every background object '
  + 'stay in exactly the same place in all ten scenes.';

const look =
  'High-detail polished 3D cartoon animation with glossy toy-like materials, soft cinematic '
  + 'lighting, vibrant saturated colours, expressive faces and family-friendly comedy. Original '
  + 'fictional people only. Vertical 9:16. The fixed camera never pans, tilts, zooms, dollies, '
  + 'or changes lens, height, distance or angle.';

const avoid =
  'recognisable public figures, celebrity likenesses, brand logos, trademarked game characters, '
  + 'readable poster brands, changing doorway order, changing room geometry, changing outfits, '
  + 'changing faces, extra characters, duplicated limbs, camera movement, cuts, split screens, '
  + 'photoreal live action, frightening imagery';

const brief = [
  'Create a fast viral short called “The Wrong Room Challenge”. The story is ten separate four-second scenes, but it must read as one continuous event in the identical three-door studio. Characters already assigned to a room remain visibly inside it in all later scenes. Only poses, expressions, character positions and the selected doorway glow may change. Use one simple action per clip, a slight squash-and-stretch bounce, and a strong readable reaction by the end. The first frame must hook immediately; the tenth must hold as a clean final group tableau.',
  'For each SCENE STILL, depict the exact opening composition of that numbered scene. Keep dialogue and sound out of the picture and do not render captions as image text. For each matching VIDEO CLIP, animate forward from that still and end on the stated reaction. End every video prompt with one Ambient noise sentence, one SFX sentence, and exactly one short attributed off-screen Narrator line in curly quotation marks. Keep that spoken line under ten words so it fits naturally inside four seconds.',
  'Scene 1: Leo Azul stands in the centre foreground; Captain Riko points toward the Pixel Meadow. Required narrator words, bright delivery: First up, Leo. Which room will he get? SFX: short pointing whoosh.',
  'Scene 2: Riko points unmistakably at the centre doorway; Leo leans back with surprised wide eyes. Required narrator words, confident delivery: Pixel room for Leo. He looks surprised! SFX: whoosh, then a light selection chime.',
  'Scene 3: Leo walks through the centre doorway as green light blooms around him; Moss steps aside and welcomes him. Required narrator words, happy delivery: Leo enters the Pixel Meadow. Correct! SFX: soft footsteps and one bright ding.',
  'Scene 4: Leo remains visible in the centre room; Gia Nova enters the foreground and Riko turns toward her, beginning to point left. Required narrator words, playful delivery: Gia is next. Riko already knows. SFX: quick entrance swish.',
  'Scene 5: Gia smiles and crosses toward the blue Neon Arcade while Riko holds the left-pointing pose. Required narrator words, warm delivery: Gia chooses the Neon Arcade. Perfect! SFX: footsteps, blue shimmer and one ding.',
  'Scene 6: Leo and Gia remain in their rooms; Turbo Jay bursts into the foreground with an energetic bounce as Riko points right. Required narrator words, excited delivery: Turbo Jay arrives at maximum energy! SFX: elastic boing and pointing whoosh.',
  'Scene 7: the red Brick Bedroom glows; Turbo freezes, eyes huge, then throws both arms upward in delighted shock. Required narrator words, quick delivery: The Brick Bedroom? Turbo cannot believe it! SFX: red shimmer, crowd cheer and ding.',
  'Scene 8: assigned contestants remain visible; Nico Block enters and pauses between the centre and right doors while Riko folds his arms and watches. Required narrator words, cautious delivery: Nico is last. Choose very carefully. SFX: low playful suspense pulse.',
  'Scene 9: Nico moves into the WRONG Brick Bedroom instead of the matching Pixel Meadow; a red warning glow pulses around the right doorway as Riko plants one hand on his hip. Required narrator words, shouted delivery: Wait! Wrong room! Nico chose bricks! SFX: loud buzzer and crowd gasp.',
  'Scene 10: final group hold—Leo in the Pixel Meadow, Gia in the Neon Arcade, Turbo in the Brick Bedroom, Nico half-stepping back out in confusion, and Riko centred like the leader with one raised eyebrow. Required narrator words, laughing delivery: Everyone is placed... except confused Nico! SFX: light crowd laughter and a final impact sting.',
  'Reserve uncluttered top-centre space in every composition for the editor caption “CHOOSE THE WRONG ROOM = LOSE 😱”. Do not ask the image or video model to draw those letters; keeping the safe area clean makes the final overlay sharp and correctly spelled in the editor.',
].join('\n\n');

const scenes = [
  [1, 'Leo Gets His Choice'],
  [2, 'The Pixel Decision'],
  [3, 'Leo Enters'],
  [4, 'Gia Arrives'],
  [5, 'Gia Chooses Neon'],
  [6, 'Turbo Jay Arrives'],
  [7, 'Turbo Reacts'],
  [8, 'Nico Must Choose'],
  [9, 'Wrong Room Twist'],
  [10, 'Final Group Hold'],
] as const;

const promptNode = (): Node => ({
  id: 'brief',
  type: 'prompt',
  position: { x: 40, y: 300 },
  data: { type: 'prompt', label: 'Wrong Room Episode Brief', text: brief },
});

const chiefNode = (): Node => ({
  id: 'director_chief',
  type: 'chief',
  position: { x: 390, y: 300 },
  data: {
    type: 'chief',
    label: 'Director Chief — Global Continuity',
    platform: 'chatgpt',
    mediaType: 'text',
    enabled: true,
    status: 'idle',
  },
} as unknown as Node);

const directorNode = (
  id: string,
  label: string,
  x: number,
  y: number,
  audioMode: 'cinematic' | 'none' = 'cinematic',
): Node => ({
  id,
  type: 'story',
  position: { x, y },
  data: {
    type: 'story',
    label,
    platform: 'chatgpt',
    mediaType: 'text',
    structure: 'free',
    cameraProgression: 'fixed',
    audioMode,
    visualPreset: 'cgi3d',
    timedBeats: audioMode === 'cinematic',
    beats: 10,
    cast,
    world,
    look,
    avoid,
    rules: ['fixedCamera', 'samePerson', 'cumulative'],
  },
} as unknown as Node);

const generateNode = (
  id: string,
  label: string,
  mediaType: 'image' | 'video',
  x: number,
  y: number,
  storyboardSheet = false,
): Node => ({
  id,
  type: 'generate',
  position: { x, y },
  data: {
    type: 'generate',
    label,
    platform: mediaType === 'video' ? 'flow' : 'chatgpt',
    mediaType,
    model: mediaType === 'video' ? 'Veo 3.1 - Fast' : 'Nano Banana Pro',
    aspectRatio: '9:16',
    duration: mediaType === 'video' ? '4s' : '6s',
    creationType: 'ingredients',
    enabled: true,
    status: 'idle',
    resultUrl: null,
    previewUrl: '',
    resultTileId: null,
    progress: 0,
    errorMessage: null,
    ...(storyboardSheet ? { storyboardSheet: true } : {}),
  },
});

const textEdge = (source: string, target: string): Edge => ({
  id: `e_${source}_${target}_t`,
  source,
  target,
  sourceHandle: 'text',
  targetHandle: 'text',
  type: 'default',
  animated: true,
  style: { stroke: '#8b5cf6', strokeWidth: 2.5 },
});

const imageEdge = (source: string, target: string): Edge => ({
  id: `e_${source}_${target}_i`,
  source,
  target,
  sourceHandle: 'result',
  targetHandle: 'image_ref',
  type: 'default',
  animated: true,
  style: { stroke: '#3b82f6', strokeWidth: 2.5 },
});

const sceneNodes = scenes.flatMap(([number, label]) => {
  const y = 300 + (number - 1) * 300;
  return [
    generateNode(`scene_${number}`, `Scene ${number} Still — ${label}`, 'image', 900, y),
    generateNode(`clip_${number}`, `Clip ${number} — ${label} (4s)`, 'video', 1400, y),
  ];
});

const sceneEdges = scenes.flatMap(([number]) => {
  const director = number <= 5 ? 'director_1_5' : 'director_6_10';
  return [
    textEdge(director, `scene_${number}`),
    textEdge(director, `clip_${number}`),
    imageEdge('continuity_board', `scene_${number}`),
    imageEdge(`scene_${number}`, `clip_${number}`),
  ];
});

export const WRONG_ROOM_TEMPLATE: Template = {
  id: 'tpl_wrong_room_challenge',
  name: 'Wrong Room Challenge — 10 × 4s',
  description: 'Ten character-locked scene images become ten narrated four-second Flow clips in one fixed three-door cartoon world.',
  useCase: 'Viral Shorts and TikTok choice games with a fast hook, escalating assignments, a wrong-choice twist, native narration and independently retryable scenes.',
  category: 'Content',
  difficulty: 'Advanced',
  nodeCount: 26,
  thumbnail: '🚪',
  nodes: [
    promptNode(),
    chiefNode(),
    directorNode('board_director', 'Continuity Board Director', 760, 40, 'none'),
    generateNode('continuity_board', 'Master Continuity Board — 10 Panels', 'image', 900, 40, true),
    directorNode('director_1_5', 'Scene Director — 1 to 5', 760, 400),
    directorNode('director_6_10', 'Scene Director — 6 to 10', 760, 1900),
    ...sceneNodes,
  ],
  edges: [
    textEdge('brief', 'director_chief'),
    textEdge('director_chief', 'board_director'),
    textEdge('director_chief', 'director_1_5'),
    textEdge('director_chief', 'director_6_10'),
    textEdge('board_director', 'continuity_board'),
    ...sceneEdges,
  ],
  requiresNodeTypes: ['prompt', 'chief', 'story', 'generate'],
  requiresPlatforms: ['chatgpt', 'flow'],
  tier: 'free',
};
