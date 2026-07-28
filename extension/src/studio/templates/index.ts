/* ============================================================
   Built-in workflow templates.

   Each template ships with REAL example prompts, not blanks. Two
   reasons: a new user can hit Run immediately and see the thing work,
   and the prompt text itself teaches the technique — specificity and
   explicit continuity language are what actually hold a character
   together across shots.

   Layout convention: inputs at x=40, first generation at x=520,
   second at x=1000. Parallel branches step down by ~420.
   ============================================================ */

import type { Node, Edge } from '@xyflow/react';

export interface Template {
  id: string;
  name: string;
  description: string;
  category: string;
  difficulty: 'Easy' | 'Medium' | 'Advanced';
  nodeCount: number;
  thumbnail: string;
  /** One-line note on when to reach for this workflow */
  useCase: string;
  nodes: Node[];
  edges: Edge[];
}

/* ── Helpers keep the definitions readable ── */

const promptNode = (id: string, label: string, text: string, x: number, y: number): Node => ({
  id,
  type: 'prompt',
  position: { x, y },
  data: { type: 'prompt', label, text },
});

/**
 * Image nodes ship EMPTY on purpose — the user drops in their own reference.
 * `hint` becomes the node's name field so the canvas says what belongs here
 * (a face vs a flat-lay vs a room), which matters when a template wants three
 * or four references that are not interchangeable.
 */
const imageNode = (id: string, label: string, x: number, y: number, hint = ''): Node => ({
  id,
  type: 'image',
  position: { x, y },
  data: { type: 'image', label, imageName: hint, imageData: '' },
});

interface GenOpts {
  label: string;
  mediaType?: 'image' | 'video';
  model?: string;
  aspectRatio?: string;
  duration?: string;
  platform?: 'flow' | 'chatgpt';
}

const genNode = (id: string, o: GenOpts, x: number, y: number): Node => ({
  id,
  type: 'generate',
  position: { x, y },
  data: {
    type: 'generate',
    label: o.label,
    platform: o.platform || 'flow',
    mediaType: o.mediaType || 'image',
    model: o.model || (o.mediaType === 'video' ? 'Omni Flash' : 'Nano Banana Pro'),
    aspectRatio: o.aspectRatio || '9:16',
    duration: o.duration || '6s',
    creationType: 'ingredients',
    enabled: true,
    status: 'idle',
    resultUrl: null,
    previewUrl: '',
    resultTileId: null,
    progress: 0,
    errorMessage: null,
  },
});

/** text edge (orange) */
const tEdge = (source: string, target: string): Edge => ({
  id: `e_${source}_${target}_t`,
  source, target,
  sourceHandle: 'text', targetHandle: 'text',
  type: 'default', animated: true,
  style: { stroke: '#8b5cf6', strokeWidth: 2.5 },
});

/** image-reference edge — sourceHandle differs per node type */
const iEdge = (source: string, target: string, from: 'image' | 'result' = 'result'): Edge => ({
  id: `e_${source}_${target}_i`,
  source, target,
  sourceHandle: from, targetHandle: 'image_ref',
  type: 'default', animated: true,
  style: { stroke: '#3b82f6', strokeWidth: 2.5 },
});

/* Continuity boilerplate — the single biggest lever on multi-shot
   consistency. Repeated verbatim in every downstream shot on purpose. */
const CONTINUITY =
  'Same character as the reference: identical face, hairstyle, outfit, ' +
  'body proportions, colour palette and art style. Do not restyle or reset the character.';

export const TEMPLATES: Template[] = [
  /* ─────────────── Starters ─────────────── */
  {
    id: 'tpl_simple_image',
    name: 'Simple Image',
    description: 'One prompt, one image. The smallest possible workflow.',
    useCase: 'Learning the canvas, or a quick one-off still.',
    category: 'Starter',
    difficulty: 'Easy',
    nodeCount: 2,
    thumbnail: '🖼️',
    nodes: [
      promptNode('p1', 'Prompt',
        'A calico cat asleep on a stack of old books, warm afternoon light through a dusty window, shallow depth of field, photographic.',
        40, 120),
      genNode('g1', { label: 'Generate Image', mediaType: 'image', aspectRatio: '1:1' }, 520, 80),
    ],
    edges: [tEdge('p1', 'g1')],
  },
  {
    id: 'tpl_simple_video',
    name: 'Simple Video',
    description: 'One prompt, one video clip.',
    useCase: 'A single establishing shot or quick B-roll clip.',
    category: 'Starter',
    difficulty: 'Easy',
    nodeCount: 2,
    thumbnail: '🎬',
    nodes: [
      promptNode('p1', 'Scene Prompt',
        'Slow aerial push over a misty pine forest at sunrise, low fog between the trees, golden light, cinematic, no camera shake.',
        40, 120),
      genNode('g1', { label: 'Generate Video', mediaType: 'video', aspectRatio: '16:9', duration: '8s' }, 520, 80),
    ],
    edges: [tEdge('p1', 'g1')],
  },

  /* ─────────────── Marketing ─────────────── */
  {
    id: 'tpl_product_ad',
    name: 'Product Photo → Video Ad',
    description: 'Upload a product photo and turn it into a short ad clip.',
    useCase: 'Fastest path from a real product shot to something postable.',
    category: 'Marketing',
    difficulty: 'Easy',
    nodeCount: 3,
    thumbnail: '📦',
    nodes: [
      imageNode('i1', 'Product Photo', 40, 60),
      promptNode('p1', 'Ad Prompt',
        'The product on a clean marble surface, soft studio light, slow 180° turntable rotation, subtle glossy reflection, premium commercial look. Keep the product shape, colour and label exactly as in the reference.',
        40, 430),
      genNode('g1', { label: 'Generate Ad Clip', mediaType: 'video', aspectRatio: '9:16', duration: '6s' }, 520, 160),
    ],
    edges: [iEdge('i1', 'g1', 'image'), tEdge('p1', 'g1')],
  },
  {
    id: 'tpl_ugc_ad',
    name: 'UGC Ad: Photo → Scene → Video',
    description: 'Product photo becomes a lifestyle scene, then a handheld UGC-style clip.',
    useCase: 'The standard UGC ad pipeline — the two-step beats going straight to video, because you get to approve the scene before spending a video generation on it.',
    category: 'Marketing',
    difficulty: 'Medium',
    nodeCount: 5,
    thumbnail: '🛍️',
    nodes: [
      imageNode('i1', 'Product Photo', 40, 60),
      promptNode('p1', 'Lifestyle Scene',
        'A person holding the product in a sunlit kitchen, casual morning atmosphere, natural window light, shot on a phone camera, realistic skin texture. Keep the product exactly as in the reference — same shape, colour and label.',
        40, 430),
      genNode('g1', { label: 'Scene Still', mediaType: 'image', aspectRatio: '9:16' }, 520, 160),
      promptNode('p2', 'Motion Prompt',
        'Handheld UGC-style video of this exact scene, subtle natural movement, slight camera sway, the person smiles and turns the product toward the camera. Low motion intensity, no warping.',
        520, 700),
      genNode('g2', { label: 'UGC Clip', mediaType: 'video', aspectRatio: '9:16', duration: '6s' }, 1000, 160),
    ],
    edges: [
      iEdge('i1', 'g1', 'image'), tEdge('p1', 'g1'),
      iEdge('g1', 'g2'), tEdge('p2', 'g2'),
    ],
  },

  /* ─────────────── Character ─────────────── */
  {
    id: 'tpl_character_3shots',
    name: 'Character → 3 Consistent Shots',
    description: 'Build a character sheet once, then reuse it for a wide, a medium and a close-up.',
    useCase: 'The consistency stress test: if a wide, a walking shot and a reaction hold the same face, the character is production-ready.',
    category: 'Character',
    difficulty: 'Advanced',
    nodeCount: 8,
    thumbnail: '🎭',
    nodes: [
      promptNode('p0', 'Character Description',
        'Character design sheet, concept art turnaround, multiple views (front, side, back). A young woman courier in a worn olive jacket, short dark curly hair, freckles, red canvas satchel, scuffed white trainers. Neutral grey backdrop, even lighting, consistent proportions across all views.',
        40, 320),
      genNode('gs', { label: 'Character Sheet', mediaType: 'image', aspectRatio: '16:9' }, 520, 260),

      promptNode('p1', 'Shot 1 — Wide',
        `Wide establishing shot: she walks down a rain-slick city street at dusk, neon signs reflecting in puddles, camera static at street level. ${CONTINUITY}`,
        1000, 20),
      genNode('g1', { label: 'Wide Shot', mediaType: 'video', aspectRatio: '16:9', duration: '6s' }, 1480, 40),

      promptNode('p2', 'Shot 2 — Medium',
        `Medium tracking shot from the side as she checks a package label while walking, shallow depth of field, evening light. ${CONTINUITY}`,
        1000, 440),
      genNode('g2', { label: 'Medium Shot', mediaType: 'video', aspectRatio: '16:9', duration: '6s' }, 1480, 460),

      promptNode('p3', 'Shot 3 — Close-up',
        `Close-up on her face as she looks up and smiles, warm practical light from a shop window, subtle head movement. ${CONTINUITY}`,
        1000, 860),
      genNode('g3', { label: 'Close-up', mediaType: 'video', aspectRatio: '16:9', duration: '6s' }, 1480, 880),
    ],
    edges: [
      tEdge('p0', 'gs'),
      iEdge('gs', 'g1'), tEdge('p1', 'g1'),
      iEdge('gs', 'g2'), tEdge('p2', 'g2'),
      iEdge('gs', 'g3'), tEdge('p3', 'g3'),
    ],
  },
  {
    id: 'tpl_chatgpt_to_flow',
    name: 'ChatGPT Character → Flow Video',
    description: 'Design the character on ChatGPT, animate it on Google Flow.',
    useCase: 'Cross-platform: use whichever model draws your character best, then bring it into Flow for motion.',
    category: 'Character',
    difficulty: 'Medium',
    nodeCount: 4,
    thumbnail: '🔀',
    nodes: [
      promptNode('p0', 'Character Prompt',
        'Character design sheet of a friendly robot barista: rounded matte-white chassis, mint green accents, single expressive blue eye-screen, small apron. Front, side and back views on a plain background, consistent proportions.',
        40, 260),
      genNode('gc', { label: 'Design on ChatGPT', platform: 'chatgpt', mediaType: 'image' }, 520, 200),
      promptNode('p1', 'Animation Prompt',
        `The robot barista slides a coffee cup across the counter and gives a small wave, cosy café interior, warm morning light, gentle camera push in. ${CONTINUITY}`,
        520, 700),
      genNode('g1', { label: 'Animate on Flow', mediaType: 'video', aspectRatio: '9:16', duration: '6s' }, 1000, 200),
    ],
    edges: [tEdge('p0', 'gc'), iEdge('gc', 'g1'), tEdge('p1', 'g1')],
  },

  /* ─────────────── Content production ─────────────── */
  {
    id: 'tpl_broll_pack',
    name: 'B-Roll Pack (3 clips)',
    description: 'Three themed B-roll clips in one run, ready to cut under a voiceover.',
    useCase: 'Faceless YouTube and explainer channels — batch the cutaways instead of generating one at a time.',
    category: 'Content',
    difficulty: 'Easy',
    nodeCount: 6,
    thumbnail: '🎞️',
    nodes: [
      promptNode('p1', 'Clip 1',
        'Close-up of hands typing on a mechanical keyboard in a dim room, screen glow on the fingers, shallow depth of field, slow push in.',
        40, 40),
      genNode('g1', { label: 'B-Roll 1', mediaType: 'video', aspectRatio: '16:9', duration: '6s' }, 520, 60),
      promptNode('p2', 'Clip 2',
        'Slow pan across a wall of sticky notes and printed charts, office afternoon light, soft focus falloff at the edges.',
        40, 440),
      genNode('g2', { label: 'B-Roll 2', mediaType: 'video', aspectRatio: '16:9', duration: '6s' }, 520, 460),
      promptNode('p3', 'Clip 3',
        'Overhead shot of coffee being poured into a white cup on a wooden desk beside an open notebook, steam rising, natural light.',
        40, 840),
      genNode('g3', { label: 'B-Roll 3', mediaType: 'video', aspectRatio: '16:9', duration: '6s' }, 520, 860),
    ],
    edges: [tEdge('p1', 'g1'), tEdge('p2', 'g2'), tEdge('p3', 'g3')],
  },
  {
    id: 'tpl_style_variants',
    name: 'Same Subject, 3 Styles',
    description: 'One subject rendered three ways — pick the look before committing.',
    useCase: 'Deciding art direction early, instead of discovering the style is wrong after ten generations.',
    category: 'Image',
    difficulty: 'Easy',
    nodeCount: 6,
    thumbnail: '🎨',
    nodes: [
      promptNode('p1', 'Photographic',
        'A lighthouse on a rocky cliff during a storm, photographic, dramatic overcast light, long exposure sea spray, ultra detailed.',
        40, 40),
      genNode('g1', { label: 'Photographic', mediaType: 'image', aspectRatio: '16:9' }, 520, 20),
      promptNode('p2', 'Illustrated',
        'A lighthouse on a rocky cliff during a storm, flat vector illustration, bold shapes, limited palette of navy, cream and coral, poster style.',
        40, 400),
      genNode('g2', { label: 'Illustrated', mediaType: 'image', aspectRatio: '16:9' }, 520, 380),
      promptNode('p3', '3D Render',
        'A lighthouse on a rocky cliff during a storm, stylised 3D render, soft clay materials, gentle rim lighting, Pixar-like miniature diorama.',
        40, 760),
      genNode('g3', { label: '3D Render', mediaType: 'image', aspectRatio: '16:9' }, 520, 740),
    ],
    edges: [tEdge('p1', 'g1'), tEdge('p2', 'g2'), tEdge('p3', 'g3')],
  },
  {
    id: 'tpl_ab_models',
    name: 'A/B Model Comparison',
    description: 'Same prompt through two models, side by side.',
    useCase: 'Finding out which model suits your subject before burning credits at scale.',
    category: 'Utility',
    difficulty: 'Easy',
    nodeCount: 3,
    thumbnail: '⚖️',
    nodes: [
      promptNode('p1', 'Shared Prompt',
        'A vintage motorcycle parked outside a neon-lit diner at night, wet asphalt reflecting the sign, cinematic, 35mm.',
        40, 320),
      genNode('g1', { label: 'Model A — Nano Banana Pro', mediaType: 'image', aspectRatio: '16:9' }, 520, 60),
      genNode('g2', { label: 'Model B — Imagen 4', mediaType: 'image', model: 'Imagen 4', aspectRatio: '16:9' }, 520, 520),
    ],
    edges: [tEdge('p1', 'g1'), tEdge('p1', 'g2')],
  },

  /* ─────────────── Fashion ─────────────── */
  {
    id: 'tpl_outfit_swap',
    name: 'Outfit Swap → 2 Clips',
    description: 'Put a new outfit on your photo, then turn it into two short videos.',
    useCase: 'Mirror-selfie try-on content. Two reference images feed one generation — the person from one, the clothes from the other — then the dressed result drives both clips so the outfit stays identical across them.',
    category: 'Fashion',
    difficulty: 'Advanced',
    nodeCount: 8,
    thumbnail: '👗',
    nodes: [
      imageNode('i1', 'Person Photo', 40, 40),
      imageNode('i2', 'Outfit Reference', 40, 470),
      promptNode('p0', 'Try-On Prompt',
        'IMAGE 01 = the person and the setting. IMAGE 02 = the outfit. ' +
        'Dress the person from IMAGE 01 in the exact outfit from IMAGE 02 — same garments, ' +
        'colours, fabric texture and proportions. Keep her face, hair, body, pose, phone and the ' +
        'original background from IMAGE 01 completely unchanged. Photographic, natural phone-camera ' +
        'lighting, realistic fabric folds.',
        40, 900),
      genNode('g1', { label: 'Try-On Result', mediaType: 'image', aspectRatio: '9:16' }, 520, 300),

      promptNode('p1', 'Clip 1 — Turn',
        `She slowly turns to show the outfit from the side, phone stays raised for the mirror selfie, ` +
        `subtle natural movement, no camera shake. ${CONTINUITY}`,
        1000, 40),
      genNode('g2', { label: 'Clip 1', mediaType: 'video', aspectRatio: '9:16', duration: '6s' }, 1480, 60),

      promptNode('p2', 'Clip 2 — Detail',
        `She takes a small step toward the mirror and adjusts the jacket hem, looking down at the ` +
        `outfit then back up, static camera, natural handheld feel. ${CONTINUITY}`,
        1000, 560),
      genNode('g3', { label: 'Clip 2', mediaType: 'video', aspectRatio: '9:16', duration: '6s' }, 1480, 580),
    ],
    edges: [
      // Both references feed the same generation — person from one, clothes from the other
      iEdge('i1', 'g1', 'image'),
      iEdge('i2', 'g1', 'image'),
      tEdge('p0', 'g1'),
      // The dressed result anchors both clips, so the outfit can't drift between them
      iEdge('g1', 'g2'), tEdge('p1', 'g2'),
      iEdge('g1', 'g3'), tEdge('p2', 'g3'),
    ],
  },
  {
    id: 'tpl_triple_lock',
    name: 'Triple Lock: Face + Outfit + Scene',
    description: 'Three references, each locking one thing — who, what they wear, where they are.',
    useCase: 'The most controlled composite Studio can do. Separating identity, wardrobe and location into their own references stops the model trading one off against another — the usual failure where a new outfit quietly changes the face.',
    category: 'Fashion',
    difficulty: 'Advanced',
    nodeCount: 7,
    thumbnail: '🔒',
    nodes: [
      imageNode('i1', 'Face Reference', 40, 40),
      imageNode('i2', 'Outfit Sheet', 40, 470),
      imageNode('i3', 'Scene / Location', 40, 900),
      promptNode('p0', 'Master Composition',
        '# MASTER REFERENCE COMPOSITION — IDENTITY LOCK + OUTFIT LOCK + SCENE LOCK\n\n' +
        'IMAGE 01 = IDENTITY. Use this face only: same bone structure, eyes, brows, nose, lips, ' +
        'skin tone and hair. Do not beautify, slim, age or restyle the face.\n\n' +
        'IMAGE 02 = OUTFIT. Reproduce every garment and accessory exactly as shown — cut, colour, ' +
        'print placement, fabric, footwear and bag. No substitutions.\n\n' +
        'IMAGE 03 = SCENE. Place her in this exact location, matching its perspective, lighting ' +
        'direction, colour temperature and depth of field.\n\n' +
        'OUTPUT: full-body shot of the IMAGE 01 person wearing the IMAGE 02 outfit inside the ' +
        'IMAGE 03 scene. Photographic, natural light, sharp on the subject.',
        40, 1330),
      genNode('g1', { label: 'Composite Still', mediaType: 'image', aspectRatio: '9:16' }, 520, 420),

      promptNode('p1', 'Motion Prompt',
        '# REFERENCE SETUP\n' +
        'Use the reference image as the ONLY visual source for the person, outfit and location.\n\n' +
        'She walks forward naturally, weight shifting between steps, hair and fabric moving with ' +
        'her. Camera static at eye level. Same face, same outfit, same location — do not restyle, ' +
        'recolour or reset anything.',
        1000, 900),
      genNode('g2', { label: 'Scene Clip', mediaType: 'video', aspectRatio: '9:16', duration: '6s' }, 1000, 380),
    ],
    edges: [
      // Three references into ONE generation — each locks a different axis
      iEdge('i1', 'g1', 'image'),
      iEdge('i2', 'g1', 'image'),
      iEdge('i3', 'g1', 'image'),
      tEdge('p0', 'g1'),
      // Stage 2 uses only the composite, so nothing can drift back
      iEdge('g1', 'g2'), tEdge('p1', 'g2'),
    ],
  },
  {
    id: 'tpl_product_ugc',
    name: 'Product UGC: Model × Product',
    description: 'Put a consistent model in your product photo, then two clips of her using it.',
    useCase: 'Selling a physical product with UGC-style content. The product photo is a reference like any other, so the item keeps its real shape, colour and hardware instead of being re-imagined — the usual failure in product prompts.',
    category: 'Marketing',
    difficulty: 'Advanced',
    nodeCount: 9,
    thumbnail: '🪑',
    nodes: [
      imageNode('i1', 'Face Reference', 40, 40, 'face'),
      imageNode('i2', 'Outfit Reference', 40, 470, 'outfit'),
      imageNode('i3', 'Product Photo', 40, 900, 'product'),
      promptNode('p0', 'Master Composition',
        '# ROLE ORDER — read the references in this exact order\n\n' +
        'IMAGE 01 = FACE. Facial identity source only. Same bone structure, eyes, brows, nose, ' +
        'lips, skin tone and hair. Do not beautify, slim or restyle the face.\n\n' +
        'IMAGE 02 = OUTFIT. Wardrobe source only. Reproduce each garment exactly — cut, colour, ' +
        'knit texture, layering and footwear. Ignore the body and background of this image.\n\n' +
        'IMAGE 03 = PRODUCT + SETTING. The product must match this photo exactly: same silhouette, ' +
        'upholstery colour, stitching, armrests, base and castors. Keep the room, window light and ' +
        'desk as shown. Do not redesign the product.\n\n' +
        'OUTPUT: the IMAGE 01 woman, wearing the IMAGE 02 outfit, seated naturally in the IMAGE 03 ' +
        'product within that room. Full body visible, photographic, daylight from the window.',
        40, 1330),
      genNode('g1', { label: 'Composite Still', mediaType: 'image', aspectRatio: '9:16' }, 520, 430),

      promptNode('p1', 'Clip 1 — Working',
        '# REFERENCE SETUP\nUse the reference image as the ONLY source for the woman, her outfit, ' +
        'the product and the room.\n\n' +
        'She settles back into the chair and types on the laptop, small natural shifts of weight, ' +
        'the chair rocking slightly. Static camera at desk height. Same face, same outfit, same ' +
        'product — do not restyle or recolour anything.',
        1000, 900),
      genNode('g2', { label: 'Clip 1', mediaType: 'video', aspectRatio: '9:16', duration: '6s' }, 1480, 200),

      promptNode('p2', 'Clip 2 — Product Detail',
        '# REFERENCE SETUP\nUse the reference image as the ONLY source for the woman, her outfit, ' +
        'the product and the room.\n\n' +
        'Slow push in past her shoulder onto the chair\'s backrest and armrest, showing the ' +
        'upholstery texture and stitching, she leans back into frame. Same face, same outfit, same ' +
        'product — no redesign.',
        1000, 1400),
      genNode('g3', { label: 'Clip 2', mediaType: 'video', aspectRatio: '9:16', duration: '6s' }, 1480, 720),
    ],
    edges: [
      // Face, outfit and product each stay in their own lane
      iEdge('i1', 'g1', 'image'),
      iEdge('i2', 'g1', 'image'),
      iEdge('i3', 'g1', 'image'),
      tEdge('p0', 'g1'),
      // Both clips inherit the approved composite
      iEdge('g1', 'g2'), tEdge('p1', 'g2'),
      iEdge('g1', 'g3'), tEdge('p2', 'g3'),
    ],
  },
];

export const CATEGORIES = ['All', 'Starter', 'Marketing', 'Character', 'Fashion', 'Content', 'Image', 'Utility'] as const;
