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
  /** Emoji shown on the card, and the fallback when there is no artwork. */
  thumbnail: string;
  /**
   * Optional artwork for the card, as a path under extension/assets/.
   * Webpack copies that folder verbatim, and studio.html sits beside it, so
   * the relative path resolves without going through the asset resolver the
   * image nodes use.
   */
  thumbnailImage?: string;
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
const imageNode = (
  id: string, label: string, x: number, y: number, hint = '', assetPath = ''
): Node => ({
  id,
  type: 'image',
  position: { x, y },
  // assetPath points at a file bundled under extension/assets/. resolveAssets()
  // in the store turns it into a data URL at load time, so the base64 never
  // sits in the JS bundle. Empty = the user supplies their own reference.
  data: { type: 'image', label, imageName: hint, imageData: '', assetPath },
});

interface GenOpts {
  label: string;
  /** 'text' asks ChatGPT to write the prompt for the node downstream of it. */
  mediaType?: 'image' | 'video' | 'text';
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
    model: o.mediaType === 'text'
      ? ''
      : o.model || (o.mediaType === 'video' ? 'Omni Flash' : 'Nano Banana Pro'),
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

/** A Last Frame node — surfaces the still one clip hands to the next. */
const frameNode = (id: string, label: string, x: number, y: number): Node => ({
  id,
  type: 'frame',
  position: { x, y },
  data: { type: 'frame', label, frameUrl: '' },
});

/** An Ask AI node — ChatGPT writing text, so no model or ratio applies. */
const askNode = (id: string, label: string, x: number, y: number): Node =>
  genNode(id, { label, mediaType: 'text', platform: 'chatgpt' }, x, y);

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

/* ── ASMR styrofoam carving ──
   Repeated in every clip so the workshop, the hands and the audio character
   don't drift between steps. The subject line names a concrete example because
   the reference slot ships empty and a template has to be runnable as-is. */
const STYROFOAM_STYLE =
  '# SUBJECT\n' +
  'Carve the subject in the attached reference image — match its shape, proportions ' +
  'and details closely. If no reference is attached, carve a seated lion. This format ' +
  'reads best with animals that have a strong silhouette.\n\n' +
  '# CONSTANTS — identical in every clip\n' +
  '• Macro close-ups at bench level, three-quarter view, so the form stays readable. ' +
  'Top-down only while measuring and cutting flat stock.\n' +
  '• Hands and forearms visible, never a face.\n' +
  '• Same warm workshop lighting, same worn wooden bench, tools and a jar of brushes ' +
  'soft and out of focus behind.\n' +
  '• Photoreal materials: white foam grain, static-clinging dust, blade marks, ' +
  'loose crumbs and offcuts scattered across the bench.\n' +
  '• ASMR audio led by the tools — blade shearing foam, dry crumbling, sanding grit.\n' +
  '• Unhurried, steady hands. One continuous take, no cuts, no time-lapse.\n' +
  '• Vertical 9:16, high detail.';

/** [key, label, what happens in the clip — ending with the state it hands on] */
const STYROFOAM_STAGES = [
  ['cut', 'Measuring & Cutting',
    'Hands measure a white styrofoam sheet with a steel ruler, mark cut lines in pencil, ' +
    'then draw a utility knife through the foam in slow even passes. Linger on the blade ' +
    'parting the surface and the crumbs dropping away.\n' +
    'END ON: several clean rectangular blocks squared up in a neat stack.'],
  ['bond', 'Stacking & Bonding',
    'White glue is spread across each block face, the blocks are pressed together one by ' +
    'one and squared into a single tall cube. Show the glue squeezing out at the seams and ' +
    'hands holding steady pressure.\n' +
    'END ON: one solid bonded cube resting on the bench, seams barely visible.'],
  ['outline', 'Outline Sketching',
    'A black marker draws the subject\'s outline onto the cube, then the block is rotated ' +
    'so the profile and front views are sketched on the adjacent faces as carving guides.\n' +
    'END ON: the cube fully outlined on every face, marker set down beside it.'],
  ['rough', 'Rough Carving',
    'A long craft knife shears away the waste in broad confident strips that curl off and ' +
    'fall to the bench. Shot three-quarter on at bench level so the silhouette reads as it ' +
    'emerges — head, limbs and stance becoming recognisable while the surface stays faceted ' +
    'and unfinished.\n' +
    'END ON: the rough three-dimensional form clearly readable, offcuts piled around it.'],
  ['detail', 'Fine Detailing',
    'A scalpel cuts the fine features — face, eyes, fur or hide texture — in small deliberate ' +
    'strokes, fine-grit sandpaper rounds every edge, and a soft brush sweeps the dust clear. ' +
    'The hand turns the piece between passes to check it from each side.\n' +
    'END ON: the finished sculpture, smooth and sharply detailed, bench swept clean.'],
  ['reveal', 'Final Reveal',
    'The camera pulls back from macro to a full view and orbits the finished sculpture once, ' +
    'slowly. Warm key light rakes across the carved texture. No hands in frame.\n' +
    'END ON: the completed piece centred and still, held for the last beat.'],
] as const;

/* ── Water wipeout ──
   Written for an Ask AI node, so two things matter more than usual: the answer
   must be ONLY the prompt (anything conversational gets rendered as if it were
   part of the shot), and it must differ from the previous answers, since all
   four asks run as consecutive turns in one ChatGPT conversation. */
const POOL_FAILS_BRIEF =
  'Write ONE prompt for a 10-second vertical AI video. Output only the prompt ' +
  'itself — no title, no explanation, no preamble, no quotes, no markdown.\n\n' +
  '# THE SHOT\n' +
  'A single contestant attempting a floating obstacle course over water, filmed ' +
  'by a friend on a modern phone. One continuous handheld take, no cuts. The ' +
  'contestant\'s face stays visible. It ends in one unexpected wipeout.\n\n' +
  '# MUST READ AS A REAL PHONE VIDEO\n' +
  '• Handheld from the poolside, slight micro-shake, imperfect framing, a touch ' +
  'of autofocus hunting.\n' +
  '• Never drone, tripod, gimbal, stabiliser or cinematic camera moves.\n' +
  '• The person filming is never seen — no hands, shadow or reflection.\n' +
  '• Natural sound only: splashes, wet slaps on inflatables, shouting, laughing, ' +
  'pool ambience. No music, no narration.\n' +
  '• Nothing glossy — not an advert, not influencer content, not a film.\n\n' +
  '# VARY IT\n' +
  'Pick a different location, contestant and obstacle order than any prompt you ' +
  'have already written in this conversation, and end on a different wipeout. ' +
  'Obstacles to draw from: floating pads, balance beam, rolling log, rope swing, ' +
  'tilting platform, rotating arm, slippery ramp, foam wall.\n\n' +
  '# BEAT-BY-BEAT\n' +
  'Describe the ten seconds in order — the approach, two or three obstacles, then ' +
  'the fall. Keep it under 150 words.';

/* ── Kids animation ──
   Deliberately, explicitly stylised. Two reasons, and they point the same way.

   The channels that work in this niche are animated — a mascot children
   recognise and come back for. Photoreal footage of children is the version
   that gets demonetised, age-restricted or pulled outright under the rules
   YouTube and TikTok enforce hardest around synthetic minors, and it is not
   something this template will help anyone make. Every prompt below names the
   render style as cartoon and keeps real children out of frame.

   Repeated verbatim in every scene, exactly like CONTINUITY above — it is what
   stops the mascot drifting between scene 1 and scene 4. */
const KIDS_STYLE =
  'Render style: bright 3D cartoon animation, the look of a modern preschool ' +
  'series. Soft rounded shapes, thick clean outlines, saturated primary colours, ' +
  'gentle even lighting, no harsh shadows. Toy-like and clearly illustrated — ' +
  'never photorealistic, never live action, and no real children in frame.\n' +
  'Same character as the reference: identical face, body proportions, colour ' +
  'palette and outfit. Do not restyle or redesign the character.\n' +
  'Friendly and calm. No peril, no scares, no chase, no loud sudden motion.';

const KIDS_CHARACTER =
  'Character design sheet for a preschool cartoon mascot, on a plain pale ' +
  'background.\n\n' +
  'A cheerful young fox cub standing upright, wearing a small yellow explorer ' +
  'backpack and a red scarf. Big friendly eyes, round soft body, short limbs, ' +
  'warm orange fur with a cream chest and tail tip. Waving with one paw.\n\n' +
  'Bright 3D cartoon animation style — soft rounded shapes, thick clean ' +
  'outlines, saturated colours, even lighting. Toy-like, clearly illustrated, ' +
  'never photorealistic.\n\n' +
  'Full body, head to toe, centred, facing the camera.';

/** [key, label, what happens in the 8 seconds] — one idea per scene. */
const KIDS_SCENES = [
  ['hello', '1. Hello',
   'The character walks into a sunny meadow, stops in the centre, waves at the ' +
   'camera and hops once on the spot with both arms up. Wide friendly framing, ' +
   'the whole body in shot, camera still at the character\'s eye level.\n' +
   'Cheerful ukulele and light percussion, birdsong underneath.'],
  ['count', '2. Counting',
   'The character points one paw at three big floating numbered balloons — 1, 2, ' +
   '3 — touching each in turn, and each one bobs and glows as it is touched. ' +
   'The character looks back at the camera and claps.\n' +
   'Same meadow, same music. Slow clear beats so a child can follow along.'],
  ['colour', '3. Colours',
   'Three oversized shapes sit in the grass — a red ball, a blue cube, a yellow ' +
   'star. The character walks to each one, pats it, and holds it up to the ' +
   'camera before setting it down.\n' +
   'Same meadow, same music. Unhurried, one object at a time.'],
  ['wave', '4. Goodbye',
   'The character waves goodbye with both paws, turns and walks away down a ' +
   'winding path toward a low hill, then turns back for one last wave before ' +
   'the camera settles.\n' +
   'Music resolves and softens. Warm late-afternoon light.'],
] as const;

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
      imageNode('i1', 'Product Photo', 40, 60, 'product'),
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
      imageNode('i1', 'Product Photo', 40, 60, 'product'),
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
      imageNode('i1', 'Person Photo', 40, 40, 'person'),
      imageNode('i2', 'Outfit Reference', 40, 470, 'outfit'),
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
      // Hints match the IMAGE 01/02/03 roles the prompt below refers to
      imageNode('i1', 'Face Reference', 40, 40, 'face'),
      imageNode('i2', 'Outfit Sheet', 40, 470, 'outfit'),
      imageNode('i3', 'Scene / Location', 40, 900, 'scene'),
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
  {
    id: 'tpl_exercise_series',
    name: 'Exercise Series: 1 Mascot → 4 Clips',
    description: 'One character reference becomes four storyboards, then four 10-second vertical clips.',
    useCase: 'Faceless fitness and how-to channels. Four parallel branches from a single style reference, so a whole series shares one look — and storyboarding before animating means you approve the movement while it is still cheap to change.',
    category: 'Content',
    difficulty: 'Advanced',
    nodeCount: 17,
    thumbnail: '💪',
    nodes: [
      imageNode('i1', 'Character / Style Reference', 40, 40, 'mascot',
        'assets/templates/fitness-mascot.jpg'),

      // ── Stage 1: one storyboard sheet per exercise ──
      ...([
        ['pu', 'Push-Up', 'one full push-up repetition',
          'FRAME 01 — high plank, arms extended, body in a straight line\n' +
          'FRAME 02 — lowering, elbows tracking back at 45°\n' +
          'FRAME 03 — bottom position, chest just above the floor\n' +
          'FRAME 04 — pressing back up to the start'],
        ['sq', 'Squat', 'one full bodyweight squat',
          'FRAME 01 — standing, feet shoulder-width\n' +
          'FRAME 02 — descending, hips travelling back\n' +
          'FRAME 03 — bottom position, thighs parallel to the floor\n' +
          'FRAME 04 — driving up through the heels'],
        ['pl', 'Plank', 'a forearm plank hold',
          'FRAME 01 — setting up on forearms and toes\n' +
          'FRAME 02 — braced hold, straight line head to heels\n' +
          'FRAME 03 — same hold seen from a low front angle\n' +
          'FRAME 04 — controlled release to the knees'],
        ['su', 'Sit-Up', 'one full sit-up repetition',
          'FRAME 01 — lying back, knees bent, hands at the temples\n' +
          'FRAME 02 — curling up, shoulder blades leaving the floor\n' +
          'FRAME 03 — top position, torso close to the thighs\n' +
          'FRAME 04 — lowering back down under control'],
      ] as const).flatMap(([k, name, motion, frames], i) => {
        const y = i * 560;
        return [
          promptNode(`p_${k}`, `${name} — Storyboard`,
            'Use the attached reference image as the visual style guide.\n\n' +
            '# COMMON STYLE CONSTANTS — identical in every frame\n' +
            '• Same character: faceless golden-yellow figure, heavy black outlines, flat vector\n' +
            '  shading, dark grey shorts, one dark grey arm sleeve\n' +
            '• Same dark neutral background and lighting\n' +
            '• Same body proportions and muscle definition — do not restyle or re-anatomise\n\n' +
            `# OUTPUT — a 2x2 storyboard grid of ${motion}, labelled FRAME 01 to FRAME 04\n` +
            frames + '\n\n' +
            'Tint the muscles doing the work in a brighter yellow in each frame. Keep the four ' +
            'panels the same scale and camera distance so they read as one sequence.',
            40, 460 + y),
          genNode(`g_${k}`, { label: `${name} Storyboard`, mediaType: 'image', aspectRatio: '9:16' },
            520, 40 + y),

          // ── Stage 2: animate that sheet ──
          promptNode(`v_${k}`, `${name} — Motion`,
            'Create a 10-second vertical animated clip from the uploaded storyboard.\n\n' +
            'Follow FRAME 01 → 04 in order as the motion path, looping smoothly back to the start. ' +
            'Keep the character exactly as shown — same golden-yellow figure, black outlines, flat ' +
            'vector style, dark shorts and sleeve, same background. Continuous motion, no morphing, ' +
            'no style drift, no camera cuts. Vertical 9:16 framing.',
            1000, 460 + y),
          genNode(`gv_${k}`, {
            label: `${name} Clip`, mediaType: 'video', aspectRatio: '9:16',
            // 10s clips are an Omni Flash capability
            duration: '10s', model: 'Omni Flash',
          }, 1480, 40 + y),
        ];
      }),
    ],
    edges: (['pu', 'sq', 'pl', 'su'] as const).flatMap((k) => [
      // The one reference feeds every branch, so the series shares a look
      iEdge('i1', `g_${k}`, 'image'),
      tEdge(`p_${k}`, `g_${k}`),
      // Each approved sheet drives its own clip
      iEdge(`g_${k}`, `gv_${k}`),
      tEdge(`v_${k}`, `gv_${k}`),
    ]),
  },
  {
    id: 'tpl_styrofoam_asmr',
    name: 'ASMR Styrofoam Carving: 6-Clip Chain',
    description: 'One reference photo becomes a six-clip carving sequence, with every handoff frame shown on the canvas.',
    useCase:
      'ASMR and satisfying-craft channels. This is the format people usually build by hand — generate a clip, screenshot its last frame, upload it as the next clip\'s first frame, repeat five times. Studio passes each clip\'s closing frame to the next node automatically, so the block genuinely progresses from raw foam to finished sculpture in one run.',
    category: 'Content',
    difficulty: 'Advanced',
    nodeCount: 18,
    thumbnail: '🔨',
    nodes: [
      imageNode('i1', 'Subject Reference', 40, 300, 'what to carve'),

      ...(STYROFOAM_STAGES).flatMap(([key, label, body], i) => {
        const x = 560 + i * 620;
        const out: Node[] = [
          promptNode(`p_${key}`, `${i + 1}. ${label}`,
            body + '\n\n' + STYROFOAM_STYLE,
            x - 260, 780),
          genNode(`g_${key}`, {
            label: `${i + 1}. ${label}`,
            mediaType: 'video',
            aspectRatio: '9:16',
            // Long takes are what makes this format satisfying, and 10s is an
            // Omni Flash capability.
            duration: '10s',
            model: 'Omni Flash',
          }, x, 200),
        ];
        // A Last Frame between each pair, so the handoff this format depends
        // on is something you can look at rather than infer from the result.
        if (i < STYROFOAM_STAGES.length - 1) {
          out.push(frameNode(`f_${key}`, 'Ends on →', x + 340, 250));
        }
        return out;
      }),
    ],
    edges: STYROFOAM_STAGES.flatMap(([key], i) => {
      const prev = STYROFOAM_STAGES[i - 1];
      const out = [
        tEdge(`p_${key}`, `g_${key}`),
        // Clip 1 starts from the user's photo; every later clip starts from
        // the Last Frame node showing where the previous clip ended.
        i === 0
          ? iEdge('i1', `g_${key}`, 'image')
          : iEdge(`f_${prev[0]}`, `g_${key}`, 'image'),
      ];
      // Each clip feeds its own Last Frame, except the reveal, which ends it.
      if (i < STYROFOAM_STAGES.length - 1) {
        out.push(iEdge(`g_${key}`, `f_${key}`));
      }
      return out;
    }),
  },
  {
    id: 'tpl_kids_episode',
    name: 'Kids Cartoon: 1 Mascot → 4 Scenes',
    description: 'Design a cartoon mascot once, then hold it across a four-scene episode.',
    useCase:
      'Preschool and educational channels, where the format rests on children recognising the same character every episode — and where holding one design across four scenes by hand is the part that actually takes the time. The first node draws the mascot; every scene after it references that single design rather than the scene before, so a wobble in one clip cannot propagate. Deliberately animated: photoreal footage of children is what gets a kids channel age-restricted or pulled.',
    category: 'Content',
    difficulty: 'Medium',
    nodeCount: 10,
    thumbnail: '🦊',
    nodes: [
      promptNode('p_char', 'Mascot Design', KIDS_CHARACTER, 40, 300),
      genNode('g_char', {
        label: 'Mascot Design Sheet',
        mediaType: 'image',
        aspectRatio: '1:1',
        model: 'Nano Banana Pro',
      }, 560, 260),

      ...KIDS_SCENES.flatMap(([key, label, body], i) => {
        const y = i * 460;
        return [
          promptNode(`p_${key}`, label, body + '\n\n' + KIDS_STYLE, 1060, y + 40),
          genNode(`g_${key}`, {
            label,
            mediaType: 'video',
            aspectRatio: '16:9',
            // 8s reads as a scene rather than a clip, and four of them cut
            // together into roughly half a minute of episode.
            duration: '8s',
            model: 'Omni Flash',
          }, 1580, y),
        ];
      }),
    ],
    edges: [
      tEdge('p_char', 'g_char'),
    ].concat(KIDS_SCENES.flatMap(([key]) => [
      tEdge(`p_${key}`, `g_${key}`),
      /* Every scene references the design sheet, not the scene before it.
         Chaining would carry a drifted face forward into everything after it;
         this way one bad scene stays one bad scene, and retries on its own. */
      iEdge('g_char', `g_${key}`),
    ])),
  },
  {
    id: 'tpl_pool_fails',
    name: 'Water Wipeouts: 4 Written by AI',
    description: 'ChatGPT writes four different wipeout prompts, Flow renders all four — a different set every run.',
    useCase:
      'Faceless fail and satisfying channels, where the format never changes but the clip has to. One brief fans out to four Ask AI nodes, and because they run as consecutive turns in the same ChatGPT conversation each one is told to differ from the last — so a single Run gives four unrelated wipeouts. Needs a signed-in ChatGPT tab; clips are 10s, which is Flow\'s longest.',
    category: 'Content',
    difficulty: 'Advanced',
    nodeCount: 9,
    thumbnail: '🌊',
    thumbnailImage: 'assets/templates/water-wipeout.svg',
    nodes: [
      promptNode('brief', 'The Brief', POOL_FAILS_BRIEF, 40, 300),

      ...([1, 2, 3, 4] as const).flatMap((n, i) => {
        const y = i * 420;
        return [
          askNode(`ask${n}`, `Write Clip ${n}`, 560, y),
          genNode(`clip${n}`, {
            label: `Clip ${n}`,
            mediaType: 'video',
            aspectRatio: '9:16',
            duration: '10s',
            model: 'Omni Flash',
          }, 1040, y),
        ];
      }),
    ],
    edges: ([1, 2, 3, 4] as const).flatMap((n) => [
      // One brief drives every branch — edit it once to change all four.
      tEdge('brief', `ask${n}`),
      // ChatGPT's answer becomes the clip's prompt.
      tEdge(`ask${n}`, `clip${n}`),
    ]),
  },
];

export const CATEGORIES = ['All', 'Starter', 'Marketing', 'Character', 'Fashion', 'Content', 'Image', 'Utility'] as const;
