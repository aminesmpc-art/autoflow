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

/* ── Miniature car build ──
   Same chain shape as the styrofoam carve, with one difference that changes
   the whole format: the last clip is a match cut. Three clips build a wooden
   miniature, the fourth holds the finished model in frame and becomes the real
   car in the same camera move. The payoff only lands if the miniature the
   fourth clip inherits is the exact one the third clip finished — which is
   what the Last Frame nodes make visible instead of hoped-for. */
const CAR_STYLE =
  '# LOOK — identical in every clip\n' +
  'Ultra photorealistic, 8K HDR, ray-traced reflections, shallow depth of field.\n' +
  'Macro cinematography at bench level, slow deliberate camera moves on a slider. ' +
  'No handheld, no shake, no whip pans.\n' +
  'Same dark walnut workbench, same warm key light raking from the left, same ' +
  'cool rim light picking out the edges. Background falls off to near black.\n' +
  'Hands and forearms only — sleeves rolled, never a face.\n' +
  'Audio led by the material: blade on grain, brush bristles, the tick of small ' +
  'parts set down. No music, no narration.\n' +
  'Same vehicle as the reference throughout: identical model, proportions, ' +
  'body lines and colour. Do not restyle or substitute a different car.\n' +
  'Vertical 9:16.';

/* The one node the user edits — and it goes straight to the image model.

   This used to route through ChatGPT to write the sheet prompt first, which
   was a mistake twice over.

   It was slow: a full chat round-trip and a tab switch before the first pixel,
   on top of a run that is already four video generations long.

   And it was wrong. The line reading "↑ Change this line to any car" was
   written at the user, but ChatGPT is not able to tell the difference — asked
   for a BMW M3 E46 it duly changed the line to any car and returned a Nissan
   Skyline R34. Nothing in a prompt can be addressed to someone other than the
   model reading it. The editing hint now lives in the node's label, where the
   model never sees it.

   Dropping the middle step lost nothing: the image model knows what an E46
   looks like far better than a paragraph describing one, so having a text
   model enumerate the headlights first was ceremony. */
const CAR_BRIEF =
  'Reference sheet of a BMW M3 E46, 2003, Laguna Seca Blue.\n\n' +
  'One image on a plain mid-grey studio backdrop showing three views of that ' +
  'exact car: three-quarter front on the left, dead-side profile in the ' +
  'centre, three-quarter rear on the right. Even neutral studio lighting. The ' +
  'whole car in frame in every view, wheels straight, no cropping.\n\n' +
  'Render the real production car of that exact year and trim, with its own ' +
  'headlights, grille, bumpers, mirrors, wheels, badges and exhaust layout, in ' +
  'that exact paint colour. Do not substitute another model and do not restyle ' +
  'it.\n\n' +
  'Ultra photorealistic product photography, 8K, sharp throughout, accurate ' +
  'panel reflections. No people, no background detail, no text, no watermarks.';

/** [key, label, the ten seconds — ending on the state the next clip inherits] */
const CAR_STAGES = [
  ['block', '1. Rough Carving',
   'A solid block of walnut is clamped on the bench. A chisel and mallet drive ' +
   'away the waste in confident strokes, shavings curling off and settling on ' +
   'the wood. The silhouette of the car emerges — roofline, bonnet, wheel ' +
   'arches — while every surface stays faceted and raw.\n' +
   'END ON: the rough car form, unmistakably the right vehicle, tool marks ' +
   'everywhere, shavings banked around it.'],
  ['detail', '2. Precision Detailing',
   'Fine rasps, needle files and a scalpel cut the details in: door shut lines, ' +
   'grille slats, mirror stems, the lip of each wheel arch. Fine-grit paper ' +
   'follows and the surface goes from faceted to glass-smooth. A soft brush ' +
   'clears the dust between passes.\n' +
   'END ON: the bare wooden model, perfectly smooth and fully detailed, ' +
   'unpainted, bench swept clean.'],
  ['finish', '3. Paint & Assembly',
   'Thin coats of automotive lacquer go on and flash off to a deep mirror ' +
   'finish. Then the small parts: chrome trim pressed into the shut lines, ' +
   'badges set with tweezers, clear lenses seated into the headlights, rubber ' +
   'tyres pushed onto machined rims.\n' +
   'END ON: the finished miniature, glossy and complete, reflecting the bench ' +
   'light — a perfect scale model of the reference car.'],
  ['reveal', '4. Match Cut to Real',
   'The camera pushes slowly along the finished miniature toward its headlight. ' +
   'As the frame fills with the reflection, the scale changes without a cut — ' +
   'the same headlight, the same body line, the same paint, now full size. The ' +
   'camera keeps pulling back to reveal the real car on wet asphalt at blue ' +
   'hour, workshop lights streaking across the panels.\n' +
   'One continuous move. The transition happens mid-shot, never on a cut, and ' +
   'the car must be identical either side of it.\n' +
   'END ON: the full-size car, static and centred, held for the last beat.'],
] as const;

/* ── AI toddler, photoreal ──
   The 100M-view format: a small child meeting something for the first time,
   shot like a parent's phone video. It lives or dies on the child being the
   SAME child every clip, which is why this one starts by generating a design
   sheet instead of taking an upload.

   That is a deliberate choice, not a limitation. Generating the character
   means it is fictional and yours — consistent across a whole channel, and
   nobody's actual kid. Feeding a real child's photo into this would produce
   synthetic video of an identifiable minor, which is a different thing
   entirely and not what the template is for. */
const BABY_STYLE =
  'Shot on a modern phone by a parent standing close. Handheld with slight ' +
  'natural micro-shake, one continuous take, no cuts. Natural available light.\n' +
  'Same child as the reference: identical face, hair, skin tone and outfit. ' +
  'Do not restyle, age up or redesign the child.\n' +
  'An adult\'s hands support the child and stay in frame; the adult\'s face is ' +
  'never shown.\n' +
  'Natural sound only — the child, ambience, a parent laughing off-camera. ' +
  'No music, no narration, no captions.\n' +
  'Warm and safe throughout. The child is happy and secure the whole time: no ' +
  'distress, no crying, no danger, nothing that could read as harm.\n' +
  'Vertical 9:16.';

const BABY_CHARACTER =
  'Character reference sheet: one photorealistic toddler, about 18 months old, ' +
  'standing against a plain light grey backdrop.\n\n' +
  'Round cheeks, dark curly hair, big brown eyes, a wide open smile. Wearing a ' +
  'plain white t-shirt and soft grey shorts, barefoot.\n\n' +
  'Neutral even studio lighting, sharp focus, full body head to toe, facing the ' +
  'camera. Natural skin texture. No props, no background detail.\n\n' +
  'This is an original fictional character, not any real person.';

/** [key, label, the eight seconds] — each is a first encounter, which is the
    beat the format is actually built on. */
const BABY_CLIPS = [
  ['fish', '1. Fish Spa',
   'The child sits on the rim of a shallow fish-spa tank in a bright shopping ' +
   'mall, held under the arms by an adult, and lowers both feet into the water. ' +
   'Small fish swarm toward the toes. The child jolts, then bursts out laughing ' +
   'and kicks once, splashing.\n' +
   'Camera at the child\'s level, close enough to hold the face and the water in ' +
   'the same frame.'],
  ['sand', '2. First Sand',
   'The child stands at the edge of dry beach sand at golden hour, supported by ' +
   'an adult\'s hands, and lifts one foot away the instant it touches. Tries ' +
   'again, then plants both feet and grins down at them, curling the toes.\n' +
   'Low camera, warm backlight, sea blurred behind.'],
  ['ice', '3. First Ice Cream',
   'The child, in a high chair at an outdoor cafe, takes a first lick of vanilla ' +
   'ice cream from a cone held by an adult. Freezes at the cold, blinks, then ' +
   'leans straight back in for more, ice cream on the nose.\n' +
   'Close framing on the face, dappled shade, street sounds behind.'],
] as const;

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
    id: 'tpl_miniature_car',
    name: 'Miniature Car: Carve → Match Cut',
    description: 'Name a car. Flow draws the reference sheet, then four clips carve it and match-cut to the real one.',
    useCase:
      'The build-up-and-reveal format, where the whole video is a setup for the last two seconds. Change the first line of the first node to any car — "BMW M3 E46, 2003, Laguna Seca Blue" — and it renders a three-view reference sheet, then carves it, details it, paints it and reveals it full size. No photo to source, and the sheet comes out at the angles and lighting the carve clips need rather than whatever a stock shot happened to be. The Last Frame nodes matter more here than anywhere: the match cut only lands if the miniature the reveal inherits is exactly the one the previous clip finished, so the handoff sits on the canvas where you can check it before spending a generation. Editing note from the format — post the reveal first as the hook, then the build.',
    category: 'Content',
    difficulty: 'Advanced',
    nodeCount: 13,
    thumbnail: '🚗',
    thumbnailImage: 'assets/templates/miniature-car.svg',
    nodes: [
      // The label carries the editing hint; the prompt text cannot, because
      // everything in it is read by a model as an instruction to itself.
      promptNode('p_car', 'Which Car — edit line 1', CAR_BRIEF, 40, 260),
      genNode('g_sheet', {
        label: 'Car Reference Sheet',
        mediaType: 'image',
        aspectRatio: '16:9',
        model: 'Nano Banana Pro',
      }, 560, 220),

      ...CAR_STAGES.flatMap(([key, label, body], i) => {
        const x = 1100 + i * 620;
        const out: Node[] = [
          promptNode(`p_${key}`, label, body + '\n\n' + CAR_STYLE, x - 260, 780),
          genNode(`g_${key}`, {
            label,
            mediaType: 'video',
            aspectRatio: '9:16',
            duration: '10s',
            model: 'Omni Flash',
          }, x, 200),
        ];
        if (i < CAR_STAGES.length - 1) {
          out.push(frameNode(`f_${key}`, 'Ends on →', x + 340, 250));
        }
        return out;
      }),
    ],
    edges: [
      // Straight to the image model — no text model in between to reinterpret it.
      tEdge('p_car', 'g_sheet'),
    ].concat(CAR_STAGES.flatMap(([key], i) => {
      const prev = CAR_STAGES[i - 1];
      const out = [
        tEdge(`p_${key}`, `g_${key}`),
        /* Clip 1 works from the generated reference sheet. Every clip after it
           starts from the previous clip's closing frame, which is what keeps
           one continuous object across four generations — and is the entire
           reason the match cut at the end reads as the same car. */
        i === 0
          ? iEdge('g_sheet', `g_${key}`)
          : iEdge(`f_${prev[0]}`, `g_${key}`, 'image'),
      ];
      if (i < CAR_STAGES.length - 1) {
        out.push(iEdge(`g_${key}`, `f_${key}`));
      }
      return out;
    })),
  },
  {
    id: 'tpl_ai_baby_firsts',
    name: 'AI Toddler: 1 Character → 3 Firsts',
    description: 'Generate one toddler, then film three first-time reactions with the same child.',
    useCase:
      'The reaction-video format that runs on Shorts, Reels and TikTok. The whole thing rests on it being the same child every clip — a face that changes between videos reads as three unrelated accounts, and matching one by hand across a posting schedule is the work. Node one generates the character, every clip references that sheet, so the child stays fixed and is fictional rather than anyone\'s actual kid. Clips are 8s at 9:16.',
    category: 'Content',
    difficulty: 'Medium',
    nodeCount: 8,
    thumbnail: '👶',
    thumbnailImage: 'assets/templates/ai-baby.svg',
    nodes: [
      promptNode('p_kid', 'Character Design', BABY_CHARACTER, 40, 300),
      genNode('g_kid', {
        label: 'Character Sheet',
        mediaType: 'image',
        aspectRatio: '1:1',
        model: 'Nano Banana Pro',
      }, 560, 260),

      ...BABY_CLIPS.flatMap(([key, label, body], i) => {
        const y = i * 460;
        return [
          promptNode(`p_${key}`, label, body + '\n\n' + BABY_STYLE, 1060, y + 40),
          genNode(`g_${key}`, {
            label,
            mediaType: 'video',
            aspectRatio: '9:16',
            duration: '8s',
            model: 'Omni Flash',
          }, 1580, y),
        ];
      }),
    ],
    edges: [
      tEdge('p_kid', 'g_kid'),
    ].concat(BABY_CLIPS.flatMap(([key]) => [
      tEdge(`p_${key}`, `g_${key}`),
      /* Every clip references the character sheet, never the clip before it.
         Chaining would carry a drifted face into everything downstream, and on
         this format a face that drifts is the format failing. */
      iEdge('g_kid', `g_${key}`),
    ])),
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
