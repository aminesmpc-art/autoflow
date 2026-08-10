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

  /* ── Cloud delivery ──
     Absent on bundled templates, where the build itself is the guarantee.
     Set by the publish script, and read by the loader to decide whether this
     build can draw a template it was not compiled with. */

  /** Node types this template needs, e.g. ['frame']. */
  requiresNodeTypes?: string[];
  /** Platforms it needs an adapter for, e.g. ['chatgpt']. */
  requiresPlatforms?: string[];
  /** Version floor for anything not expressible as a node type. */
  minExtensionVersion?: string;
  /** 'pro' templates arrive with empty nodes/edges unless the account is Pro. */
  tier?: 'free' | 'pro';
  /** True when the server sent metadata only — the card prompts to upgrade. */
  locked?: boolean;
  /** Hides a template everywhere on the next fetch, without a republish. */
  disabled?: boolean;
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
const askNode = (id: string, label: string, x: number, y: number, preset?: string): Node => {
  const node = genNode(id, { label, mediaType: 'text', platform: 'chatgpt' }, x, y);
  // A preset wraps whatever the user types in a brief — see studio/presets.
  if (preset) (node.data as any).preset = preset;
  return node;
};

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

/* ── Emotional short film, 10 beats ──
   Tension → escalation → an unexpected kindness → relief, with the last shot
   echoing the first so the video loops.

   Every scene references the character sheet, never the scene before it. This
   is a narrative, not a continuous build: the scenes are different moments in
   different places, and chaining them would carry a drifted face into all ten.
   Fanning out from one design means a bad scene is one bad scene.

   The colour arc is the part most people skip and it is doing real work —
   desaturated blue-grey through the tense half, warming to gold at the turn.
   It lives per scene rather than in the shared block precisely because it is
   the one thing that must change. */
const FILM_STYLE =
  'Ultra-realistic 3D animation, cinematic lighting, shallow depth of field, ' +
  '35mm feel. Rendered like a modern animated feature, not a game engine.\n' +
  'Same character as the reference: identical face, hair, build, clothing and ' +
  'colour palette. Do not restyle, age or redesign them.\n' +
  'Expression carries the scene — the story is told in faces and body language, ' +
  'not dialogue. No spoken lines, no on-screen text, no subtitles.\n' +
  'One continuous shot, no cuts inside the clip. Slow deliberate camera.\n' +
  'Vertical 9:16.';

const FILM_CHARACTER =
  'Character reference sheet: one photorealistic 3D animated character, on a ' +
  'plain mid-grey backdrop.\n\n' +
  'A boy of about ten, thin, with dark tousled hair and large expressive brown ' +
  'eyes. Wearing a faded oversized green jacket with frayed cuffs, a grey shirt ' +
  'and worn trainers. Carrying a canvas satchel across one shoulder.\n\n' +
  'Three views: three-quarter front on the left, side profile in the centre, ' +
  'three-quarter back on the right. Neutral even lighting, full body, sharp ' +
  'focus, natural skin and fabric texture.\n\n' +
  'An original fictional character, not any real person.';

/** [key, label, the eight seconds] — the arc, in order. */
/* ── 3D animal slapstick ──
   The Oscar's Oasis / Larva format: two desert animals, one thing they both
   want, and physical comedy escalating to an ironic twist. Five 6s scenes cut
   to about thirty seconds.

   No dialogue anywhere. The format travels because it needs no translation,
   and a model given the chance will happily add mouth movement and a voice —
   so every scene rules it out rather than staying silent about it. */
const SLAPSTICK_STYLE =
  'Bright 3D cartoon animation, the look of Oscar\'s Oasis or Larva. Rounded ' +
  'exaggerated caricature, thick clean forms, saturated desert palette — ' +
  'orange sand, hard blue sky, sharp midday sun.\n' +
  'Squash-and-stretch physics: bodies compress on impact and stretch through ' +
  'motion, eyes pop wide, limbs windmill. Comedy is in the timing and the ' +
  'overshoot, not in detail.\n' +
  'Same characters as the reference: identical design, proportions and colour. ' +
  'Do not restyle or redesign them.\n' +
  'No dialogue, no speech, no mouth-sync, no on-screen text. Sound is thumps, ' +
  'sand, and cartoon whooshes.\n' +
  'One continuous shot per clip, camera locked or a single simple move. ' +
  'Vertical 9:16.';

/** [key, label, the six seconds] — hook, escalate, peak, twist, loop. */
const SLAPSTICK_SCENES = [
  ['hook', '1. Hook — Something Worth Wanting',
   'A single drop of water hangs from a dry cactus spine, catching the light. ' +
   'The fennec fox freezes mid-step, ears snapping forward, eyes enormous. He ' +
   'tiptoes toward it in exaggerated slow motion.\n' +
   'Open ON the drop — the first two seconds decide whether anyone stays.'],
  ['rival', '2. The Rival',
   'The meerkat erupts from the sand directly under the fox, launching him ' +
   'into a spin. Both land, spot each other, and freeze nose to nose. A long ' +
   'silent beat, eyes narrowing.\n' +
   'Hold the stare one moment past comfortable — the pause is the joke.'],
  ['escalate', '3. Escalation',
   'A full scramble: they tug, shove and vault over each other, the fox ' +
   'flattened into the sand and springing back, the meerkat cartwheeling ' +
   'off a rock. Sand sprays everywhere. The drop still hangs, untouched.\n' +
   'Fast, physical, and always readable — never a blur.'],
  ['peak', '4. Peak Chaos',
   'The cactus bends back like a loaded spring under their weight, then ' +
   'releases — both animals fire into the sky, tumbling, limbs flailing, ' +
   'shrinking to dots. A beat of silence at the top of the arc.\n' +
   'Hold the silence. It makes the landing land.'],
  ['twist', '5. Twist — Neither of Them',
   'They crater into the sand side by side. As they lift their heads, a ' +
   'passing tortoise ambles up, licks the drop off the spine without breaking ' +
   'stride, and walks on. Both stare after it, then at each other.\n' +
   'END ON the cactus spine, now bare — the same framing the video opened on, ' +
   'so it loops straight back to the drop.'],
] as const;

const FILM_SCENES = [
  ['hook', '1. Hook — Something Is Wrong',
   'The boy stands alone at the mouth of a rain-soaked alley at dusk, clutching ' +
   'his satchel to his chest, looking back over his shoulder at something out of ' +
   'frame. Rain streaks the air. He is breathing fast.\n' +
   'COLOUR: desaturated blue-grey, cold, heavy shadows. Open on his face.'],
  ['loss', '2. What He Has Lost',
   'He kneels on wet pavement and empties the satchel — a few coins, a folded ' +
   'photograph, nothing else. His hands are shaking. He presses the photograph ' +
   'flat and stares at it.\n' +
   'COLOUR: same cold blue-grey. One weak streetlamp above him.'],
  ['closing', '3. The Walls Close In',
   'He walks quickly along a narrow street of shuttered shops, glancing behind ' +
   'him. The buildings lean in, the passageway narrows ahead, and the rain gets ' +
   'heavier.\n' +
   'COLOUR: colder still, almost monochrome. Deep shadow either side.'],
  ['refused', '4. Turned Away',
   'He stops at a lit bakery window, hesitates, and pushes the door. A hand ' +
   'inside turns the sign to CLOSED and the light goes out. He steps back into ' +
   'the rain, face falling.\n' +
   'COLOUR: brief warm light from inside, snatched away, back to cold.'],
  ['storm', '5. Escalation',
   'The rain becomes a downpour. He shelters under a broken awning, soaked ' +
   'through and shivering, arms wrapped around his knees. Traffic passes and ' +
   'nobody stops. Water sheets off the edge of the awning.\n' +
   'COLOUR: the coldest point of the film. Blue-black, harsh reflections.'],
  ['bottom', '6. The Lowest Point',
   'Close on his face as he gives up looking — eyes down, jaw tight, the fight ' +
   'going out of him. He does not cry. He simply stops.\n' +
   'COLOUR: cold and desaturated, but hold the last beat one moment too long.'],
  ['turn', '7. The Turn — Unexpected Kindness',
   'A pair of worn boots stops in front of him. A weathered hand enters frame ' +
   'holding out a paper cup of something steaming and a folded dry coat. The boy ' +
   'looks up, uncomprehending. The stranger\'s face stays out of frame.\n' +
   'COLOUR: the first warmth of the film — amber light spilling in from the left.'],
  ['warmth', '8. Relief',
   'He sits wrapped in the oversized coat with both hands around the cup, steam ' +
   'rising past his face. His shoulders drop for the first time. A small ' +
   'disbelieving breath of a laugh.\n' +
   'COLOUR: warming quickly — amber and gold, the blue draining away.'],
  ['gift', '9. Passing It On',
   'Morning. Dry, bright street. The boy crouches to hand the folded coat to ' +
   'another child sitting where he had been, then presses the photograph into ' +
   'his own pocket and stands.\n' +
   'COLOUR: warm gold, soft, fully saturated. Long low sunlight.'],
  ['loop', '10. Resolution — Echo the Opening',
   'The same alley mouth as the first shot, now in clear morning light. The boy ' +
   'stands in exactly the same position, satchel over his shoulder, and this ' +
   'time he looks forward instead of back, and walks out of frame.\n' +
   'COLOUR: the composition of scene 1 rendered warm. Frame it to match, so the ' +
   'video can loop straight back to the beginning.'],
] as const;

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

/* The car the user wants, and nothing else.

   This used to be CAR_BRIEF — 150 words of sheet instructions wrapped around
   one editable line. That brief now lives in studio/presets as `car_sheet`,
   where every template can reach it and a bad wording can be fixed without a
   store review. What is left here is the only part that was ever the user's:
   the car. */
const CAR_SUBJECT = 'BMW M3 E46, 2003, Laguna Seca Blue';

/* ── Product commercial ──
   The brief the Ask node sends with the photos attached. It asks for a prompt,
   not an image: the node downstream is what renders. The "EXACTLY as
   photographed" clause is load-bearing — without it every model quietly
   improves the product, and an ad for a product that does not exist is worse
   than no ad. */
const PRODUCT_FIDELITY =
  'Keep the product EXACTLY as photographed — same colourway, same materials, ' +
  'same proportions, same branding and placement. Do not restyle, redesign, ' +
  'recolour or "improve" it. If a detail is not visible in the photos, leave ' +
  'it out rather than inventing it.';

const PRODUCT_CLEAN =
  'No text on screen, no added logos, no watermarks, no faces.\n\n' +
  'Output only the prompt itself — no title, no preamble, no explanation.';

/** [key, label, the sheet brief for that lane] */
const PRODUCT_LANES = [
  ['day', 'Daylight Studio',
   'The attached photos are the product. Write ONE image-generation prompt for ' +
   'a 2x2 storyboard sheet for a premium cinematic commercial, with these four ' +
   'beats in this order: the box or packaging opening, the hero product shot, ' +
   'a macro detail of its texture and construction, and a lifestyle beat in ' +
   'use.\n\n' +
   PRODUCT_FIDELITY + '\n\n' +
   'Studio lighting, shallow depth of field, clean neutral backdrop.\n\n' +
   PRODUCT_CLEAN],
  ['night', 'Wet Street Night',
   'The attached photos are the product. Write ONE image-generation prompt for ' +
   'a 2x2 storyboard sheet for the same commercial, this time at night on a ' +
   'wet city street: reflected neon on the pavement, a low tracking beat, a ' +
   'splash detail, and a final hero beat under a streetlight.\n\n' +
   PRODUCT_FIDELITY + '\n\n' +
   'Cinematic contrast, practical light sources, deep blacks.\n\n' +
   PRODUCT_CLEAN],
] as const;

/* ── Dental macro restoration ──
   A structured-JSON prompt package rather than prose. Macro medical work is
   the case where that pays: the camera block, the lighting and the framing
   have to come back byte-identical across three clips or the cut reads as
   three different mouths. Prose drifts between generations; a fixed JSON
   block with one field swapped does not. */

/** Step 1 of the brief — brainstorming, deliberately not wired downstream. */
const DENTAL_IDEAS =
  'Suggest 5 different cleaning methods for removing debris and decay from a ' +
  'severely damaged molar.\n\n' +
  'Rules:\n' +
  '- Focus ONLY on cleaning the cavity, not the filling or restoration stage.\n' +
  '- Each idea must describe the visual appearance of the decay and debris ' +
  'inside the tooth.\n' +
  '- The cavity should contain organic debris, food fibers, dark decay or ' +
  'trapped particles, like a heavily damaged tooth.\n' +
  '- Each idea must use a different dental cleaning technique.\n' +
  '- Clinical, realistic, documentary style — not cinematic.\n' +
  '- One molar in the centre with two neighbouring molars visible.\n\n' +
  'For each idea give: the cleaning tool used, the appearance of the decay, ' +
  'and the type of debris or residue inside the cavity.\n\n' +
  'Format each as:\n' +
  '1. <Tool name> — <one line describing the cavity, the decay colour and ' +
  'texture, and what the tool does to it>\n\n' +
  'Output only the numbered list.';

/* The one line the whole workflow keys off. Swapping the tool here and in the
   two cleaning prompts is the entire per-video edit. */
const DENTAL_METHOD =
  'CLEANING METHOD: High-pressure dental water jet cleaning — deep dark ' +
  'cavity filled with tangled green food fibers and soft brown decay. A ' +
  'high-pressure dental water jet flushes the organic debris and loose ' +
  'particles out of the cavity.\n\n' +
  'Rewrite the "center_tooth" and "tools" fields below so they match the ' +
  'method above, and return the completed JSON. Change nothing else — every ' +
  'other field is fixed across the whole series. The two fields are already ' +
  'filled in for the method above, so if you are not changing the method, ' +
  'return the JSON unchanged.\n\n' +
  `{
  "model": "image_generation",
  "format": {
    "aspect_ratio": "9:16",
    "resolution": "1080x1920",
    "style": "Medical Documentary / Extreme Macro Dentistry"
  },
  "camera": {
    "POV": "Top-down macro inside mouth",
    "lens_mm": "100mm macro lens",
    "focus": "Three lower molars in frame",
    "stability": "Tripod-stable macro shot",
    "depth_of_field": "Shallow macro depth with center tooth sharp"
  },
  "setting": {
    "location": "Dental clinic treatment environment",
    "lighting": "Bright cool surgical dental lighting",
    "environment": "Inside an open human mouth with saliva reflections and moist gums"
  },
  "subjects": {
    "teeth_layout": "Three adjacent lower molars visible side-by-side",
    "center_tooth": "Severely decayed molar with a deep dark cavity packed with tangled green food fibers and soft brown decay",
    "side_teeth": "Two healthy molars visible on both sides",
    "tools": "High-pressure dental water jet entering frame, preparing to flush debris from the center tooth"
  },
  "visual_details": {
    "textures": "Realistic enamel translucency, porous dentin decay, wet gums",
    "materials": "Subsurface scattering in gums, glossy enamel reflections",
    "style": "Clinical dental macro realism"
  },
  "composition": {
    "framing": "Decayed tooth centered with two neighboring molars visible",
    "focus_priority": "Sharp focus on the damaged tooth"
  },
  "negative_prompt": "cartoon, CGI, illustration, unrealistic teeth, blood, gore, blur, watermark, text, logo"
}` +
  '\n\nOutput only the JSON — no preamble, no explanation, no markdown fence.';

/** Parts 1 and 2 differ only in the tool line and the two timeline actions. */
const dentalClip = (
  targetTooth: string, tool: string, stability: string, movements: string,
  environment: string, a0: string, a4: string, materials: string, lighting: string
): string => `{
  "model": "video_generation",
  "format": {
    "aspect_ratio": "9:16",
    "duration": "8 seconds",
    "fps": 30,
    "resolution": "1080p",
    "style": "Medical Documentary / Macro Dentistry"
  },
  "camera": {
    "POV": "Top-down extreme macro",
    "lens_mm": "100mm macro",
    "stability": "${stability}",
    "movements": "${movements}",
    "forbidden": "No pans, no tilts, no zoom"
  },
  "setting": {
    "location": "Dental surgery environment",
    "lighting": "Bright surgical dental lighting",
    "environment": "${environment}"
  },
  "subjects": {
    "target_tooth": "${targetTooth}",
    "side_teeth": "Two healthy neighboring molars",
    "tool": "${tool}"
  },
  "action_timeline": [
    { "time": "00:00 - 00:04", "action": "${a0}" },
    { "time": "00:04 - 00:08", "action": "${a4}" }
  ],
  "physics_and_realism": {
    "materials": "${materials}",
    "lighting": "${lighting}"
  },
  "negative_prompt": "cartoon, CGI, blur, text, watermark"
}`;

const DENTAL_PART1 = dentalClip(
  'Center molar with large cavity filled with debris and decay',
  'High-pressure dental water jet',
  'Fixed tripod with micro vibrations',
  'Static framing on three molars',
  'Inside human mouth with wet enamel and saliva reflections',
  'Cleaning tool begins removing loose debris from the cavity',
  'Tool continues deeper cleaning revealing darker decay layers',
  'Real enamel reflections and gum translucency',
  'Sharp surgical shadows inside cavity',
);

const DENTAL_PART2 = dentalClip(
  'Center molar partially cleaned',
  'Same cleaning tool continuing the process',
  'Fixed tripod continuation shot',
  'Static framing identical to part one',
  'Inside human mouth with wet enamel',
  'Remaining decay and debris are removed from the cavity',
  'The cavity appears fully cleaned and ready for restoration',
  'Realistic enamel reflections and gum textures',
  'Dental surgical light reflections',
);

/* Part 3 is fixed by the brief and must never change — it is the payoff every
   video in the series ends on, so it is written out in full rather than
   generated, and deliberately does not go through the helper above. */
const DENTAL_PART3 = `{
  "model": "video_generation",
  "format": {
    "aspect_ratio": "9:16",
    "duration": "8 seconds",
    "fps": 30,
    "resolution": "1080p",
    "style": "Medical Documentary / Macro Photography"
  },
  "camera": {
    "POV": "Top-down extreme macro",
    "lens_mm": "100mm macro",
    "stability": "Fixed tripod with micro-vibrations for realism",
    "movements": "Static framing on the three molars",
    "forbidden": "No pans, no tilts, no zoom jumps"
  },
  "setting": {
    "location": "Dental surgery environment",
    "environment": "Inside a human mouth, wet mucous membranes, pink gum tissue, saliva presence"
  },
  "subjects": {
    "target_tooth": "Center lower molar with cleaned cavity ready for filling",
    "side_teeth": "Two healthy neighboring molars",
    "tools": "Composite application tool and blue UV curing dental light",
    "materials": "Thick bright white composite resin"
  },
  "action_timeline": [
    { "time": "00:00 - 00:03", "action": "Composite applicator slowly injects thick bright white composite resin into the cavity." },
    { "time": "00:03 - 00:06", "action": "Dental sculpting tool shapes the resin to match natural molar anatomy." },
    { "time": "00:06 - 00:07", "action": "Blue UV curing light hardens the composite filling." },
    { "time": "00:07 - 00:08", "action": "Final macro shot of the restored healthy molar." }
  ],
  "negative_prompt": "cartoon, CGI, blur, text, watermark, blood, gore"
}`;

/** Same clip brief both lanes — the sheet wired into it is what differs. */
const CLIP_BRIEF =
  'The attached image is a four-beat storyboard sheet. Write ONE prompt for a ' +
  '10-second commercial that plays those beats in the order they appear.\n\n' +
  'For each beat give the camera move (push in, orbit, tilt, tracking) and how ' +
  'it cuts to the next. Keep the product identical to the sheet. Real-world ' +
  'physics, no morphing, no impossible transformations.\n\n' +
  PRODUCT_CLEAN;

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

/**
 * The templates compiled into this build.
 *
 * Still the source of truth: authored here in TypeScript, validated by
 * templates.test.ts, then exported to JSON by scripts/publish-templates.js.
 * At runtime these are the floor the loader falls back to — a fresh install,
 * or the API being down, must still open a gallery with workflows in it.
 */
export const BUILTIN_TEMPLATES: Template[] = [
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
    id: 'tpl_product_commercial',
    name: 'Product Photos → Storyboard → Commercial',
    description: 'Drop in photos of a real product. Two lanes storyboard it, then film it — daylight and night.',
    useCase:
      'The workflow for a product you actually own. Photograph it from four angles, wire the shots in, and ChatGPT reads them before writing anything — so the sheet prompt describes your product rather than a generic one of its category. The storyboard sheet is the cheap checkpoint: four beats on one image, approved before a single second of video is spent. Then the same sheet drives the clip, so the commercial plays the beats you already signed off on. Two lanes because the second look is nearly free once the photos are wired — daylight studio and wet-street night, from the same references. Keep the "EXACTLY as photographed" lines: without them the model quietly restyles the product, which is the one thing a product ad cannot do.',
    category: 'Marketing',
    difficulty: 'Advanced',
    nodeCount: 16,
    thumbnail: '👟',
    nodes: [
      /* Four angles, shared by both lanes. Empty on purpose — this template is
         only worth running against a real product. The hints say which angle
         goes where, because they are not interchangeable: the detail shot is
         what stops the macro beat inventing stitching. */
      imageNode('i1', 'Product — 3/4 view', 40, 40, 'three-quarter hero angle'),
      imageNode('i2', 'Product — side', 40, 300, 'straight side profile'),
      imageNode('i3', 'Product — detail', 40, 560, 'close macro: texture, seams, sole'),
      imageNode('i4', 'Product — back', 40, 820, 'rear or underside'),

      ...PRODUCT_LANES.flatMap(([key, label, sheetBrief], i) => {
        const y = i * 860;
        return [
          promptNode(`p_sheet_${key}`, `Sheet Brief — ${label}`, sheetBrief, 520, y + 40),
          // No preset: the brief above is already product-specific, and the
          // photos ride in on image_ref so ChatGPT describes THIS product.
          askNode(`ask_sheet_${key}`, 'Write the Sheet Prompt', 940, y + 60),
          genNode(`g_sheet_${key}`, {
            label: `Storyboard Sheet — ${label}`,
            mediaType: 'image',
            aspectRatio: '16:9',
            model: 'Nano Banana Pro',
          }, 1360, y + 60),
          promptNode(`p_clip_${key}`, `Clip Brief — ${label}`, CLIP_BRIEF, 1780, y + 40),
          askNode(`ask_clip_${key}`, 'Write the Clip Prompt', 2200, y + 60),
          genNode(`g_clip_${key}`, {
            label: `Commercial — ${label}`,
            mediaType: 'video',
            aspectRatio: '16:9',
            duration: '10s',
            model: 'Omni Flash',
          }, 2620, y + 60),
        ];
      }),
    ],
    edges: PRODUCT_LANES.flatMap(([key]) => [
      tEdge(`p_sheet_${key}`, `ask_sheet_${key}`),
      /* Every photo reaches BOTH the writer and the renderer. The writer needs
         them to describe the product; the renderer needs them to draw it. */
      ...['i1', 'i2', 'i3', 'i4'].flatMap((img) => [
        iEdge(img, `ask_sheet_${key}`, 'image'),
        iEdge(img, `g_sheet_${key}`, 'image'),
      ]),
      tEdge(`ask_sheet_${key}`, `g_sheet_${key}`),
      tEdge(`p_clip_${key}`, `ask_clip_${key}`),
      // The approved sheet is the only thing the clip inherits, so the beats
      // in the video are the beats that were signed off.
      iEdge(`g_sheet_${key}`, `ask_clip_${key}`),
      tEdge(`ask_clip_${key}`, `g_clip_${key}`),
      iEdge(`g_sheet_${key}`, `g_clip_${key}`),
    ]),
  },
  {
    id: 'tpl_dental_macro',
    name: 'Dental Macro: Clean → Restore (24s)',
    description: 'Medical-macro dental series. One still, then three 8-second clips chained by last frame.',
    useCase:
      'The satisfying-restoration format, built the way it has to be built to survive the cut. Three clips of the same mouth only read as one procedure if the camera block never moves, so the prompts are structured JSON rather than prose — the lens, the framing and the lighting come back byte-identical every generation, and one field changes. Clip 2 starts from clip 1\'s closing frame and clip 3 from clip 2\'s, so the cavity that gets filled is the cavity that was cleaned, not a fresh interpretation of one. Per video you edit exactly one thing: the cleaning method line, in the still prompt and in the two cleaning clips. The restoration clip is fixed on purpose — it is the payoff the whole series ends on, and it stays identical so the ending is recognisable across every upload. The Brainstorm node up top is off to one side, wired to nothing: run it alone, read the five methods it returns, then paste the one you want into Cleaning Method.',
    category: 'Content',
    difficulty: 'Advanced',
    nodeCount: 13,
    thumbnail: '🦷',
    nodes: [
      /* Off to the side and connected to nothing downstream: it returns five
         options for a human to choose between, and a graph cannot make that
         choice. Running it alone costs one text generation. */
      promptNode('p_ideas', '1. Brainstorm Methods', DENTAL_IDEAS, 40, 40),
      askNode('ask_ideas', 'Five Cleaning Methods', 520, 60),

      // The one line that changes per video, plus the fixed image block.
      promptNode('p_method', '2. Cleaning Method', DENTAL_METHOD, 40, 460),
      askNode('ask_image', 'Write the Still Prompt', 520, 520),
      genNode('g_still', {
        label: 'Establishing Macro Still',
        mediaType: 'image',
        aspectRatio: '9:16',
        model: 'Nano Banana Pro',
      }, 1000, 520),

      promptNode('p_part1', 'Part 1 — Cleaning', DENTAL_PART1, 1000, 980),
      genNode('g_part1', {
        label: 'Clip 1 — Cleaning',
        mediaType: 'video', aspectRatio: '9:16', duration: '8s', model: 'Omni Flash',
      }, 1480, 520),
      frameNode('f_part1', 'Ends on →', 1900, 560),

      promptNode('p_part2', 'Part 2 — Deeper Clean', DENTAL_PART2, 1900, 980),
      genNode('g_part2', {
        label: 'Clip 2 — Cavity Cleared',
        mediaType: 'video', aspectRatio: '9:16', duration: '8s', model: 'Omni Flash',
      }, 2320, 520),
      frameNode('f_part2', 'Ends on →', 2740, 560),

      // Never edited. Same ending on every video in the series.
      promptNode('p_part3', 'Part 3 — Restoration (fixed)', DENTAL_PART3, 2740, 980),
      genNode('g_part3', {
        label: 'Clip 3 — Filling & Cure',
        mediaType: 'video', aspectRatio: '9:16', duration: '8s', model: 'Omni Flash',
      }, 3160, 520),
    ],
    edges: [
      tEdge('p_ideas', 'ask_ideas'),

      tEdge('p_method', 'ask_image'),
      tEdge('ask_image', 'g_still'),

      // Clip 1 opens on the approved still.
      tEdge('p_part1', 'g_part1'), iEdge('g_still', 'g_part1'),
      /* Each clip after the first starts from the previous clip's closing
         frame. This is what makes it one procedure instead of three takes —
         and it is visible on the canvas, so a bad handoff is caught before
         the next generation is spent. */
      iEdge('g_part1', 'f_part1'),
      tEdge('p_part2', 'g_part2'), iEdge('f_part1', 'g_part2', 'image'),
      iEdge('g_part2', 'f_part2'),
      tEdge('p_part3', 'g_part3'), iEdge('f_part2', 'g_part3', 'image'),
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
    id: 'tpl_animal_slapstick',
    name: '3D Animal Slapstick: 5 Beats',
    description: 'Two desert animals, one thing they both want, and a twist that gives it to neither.',
    useCase:
      'The Oscar\'s Oasis format: hook in the first two seconds, escalate, peak, then an ironic twist, cut to about thirty seconds. Describe the pair in a line and the character_sheet preset writes the design brief — the animals have to be identical across all five scenes or the escalation reads as five unrelated clips. No dialogue anywhere, which is why the format travels: nothing to translate, and a model left to itself will add mouth-sync and a voice. The last shot is framed to match the first so it loops. Needs a signed-in ChatGPT tab for the design step.',
    category: 'Content',
    difficulty: 'Medium',
    nodeCount: 13,
    thumbnail: '🦊',
    nodes: [
      promptNode('p_cast', 'The Cast',
        'A fennec fox and a meerkat as a desert cartoon duo, bright 3D animation, ' +
        'rounded exaggerated caricature, Oscar\'s Oasis look',
        40, 300),
      // The preset turns that line into a full design brief — see studio/presets.
      askNode('ask_cast', 'Write the Design Brief', 480, 260, 'character_sheet'),
      genNode('g_cast', {
        label: 'Character Sheet',
        mediaType: 'image',
        aspectRatio: '16:9',
        model: 'Nano Banana Pro',
      }, 920, 220),

      ...SLAPSTICK_SCENES.flatMap(([key, label, body], i) => {
        const y = i * 460;
        return [
          promptNode(`p_${key}`, label, body + '\n\n' + SLAPSTICK_STYLE, 1420, y + 40),
          genNode(`g_${key}`, {
            label,
            mediaType: 'video',
            aspectRatio: '9:16',
            duration: '6s',
            model: 'Omni Flash',
          }, 1940, y),
        ];
      }),
    ],
    edges: [
      tEdge('p_cast', 'ask_cast'),
      tEdge('ask_cast', 'g_cast'),
    ].concat(SLAPSTICK_SCENES.flatMap(([key]) => [
      tEdge(`p_${key}`, `g_${key}`),
      /* Every scene references the design sheet, never the scene before it.
         These are five separate gags in one place; chaining would carry a
         drifted animal into all of them, and the whole format rests on the
         same two creatures being recognisable from hook to twist. */
      iEdge('g_cast', `g_${key}`),
    ])),
  },
  {
    id: 'tpl_emotional_short',
    name: 'Emotional Short: 1 Character → 10 Beats',
    description: 'Tension, escalation, an unexpected kindness, relief — ten scenes holding one character.',
    useCase:
      'The retention format: cold open on trouble, escalate, turn on an act of kindness, resolve warm — and frame the last shot to match the first so it loops. Every scene references the character sheet rather than the scene before it, because these are ten different moments and a face that drifts in scene 3 would otherwise poison the seven after it. The colour arc is the part most people skip and it does real work: desaturated blue-grey through the tense half, warming to gold at the turn. Ten 8s clips give you the spine, not the finished film — the 2-4 second cutting the format lives on happens in the edit, where you cover each beat from more than one angle.',
    category: 'Content',
    difficulty: 'Advanced',
    nodeCount: 22,
    thumbnail: '🎬',
    nodes: [
      promptNode('p_char', 'Character Design', FILM_CHARACTER, 40, 300),
      genNode('g_char', {
        label: 'Character Sheet',
        mediaType: 'image',
        aspectRatio: '16:9',
        model: 'Nano Banana Pro',
      }, 560, 260),

      ...FILM_SCENES.flatMap(([key, label, body], i) => {
        const y = i * 460;
        return [
          promptNode(`p_${key}`, label, body + '\n\n' + FILM_STYLE, 1060, y + 40),
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
      tEdge('p_char', 'g_char'),
    ].concat(FILM_SCENES.flatMap(([key]) => [
      tEdge(`p_${key}`, `g_${key}`),
      /* One design, ten scenes. Recognising the same face across the arc is
         what makes the ending land — and a drifted face partway through would
         otherwise be inherited by everything after it. */
      iEdge('g_char', `g_${key}`),
    ])),
  },
  {
    id: 'tpl_miniature_car',
    name: 'Miniature Car: Carve → Match Cut',
    description: 'Name a car. A preset writes the sheet prompt, then four clips carve it and match-cut to the real one.',
    useCase:
      'The build-up-and-reveal format, where the whole video is a setup for the last two seconds. Change the first line of the first node to any car — "BMW M3 E46, 2003, Laguna Seca Blue" — and it renders a three-view reference sheet, then carves it, details it, paints it and reveals it full size. No photo to source, and the sheet comes out at the angles and lighting the carve clips need rather than whatever a stock shot happened to be. The Last Frame nodes matter more here than anywhere: the match cut only lands if the miniature the reveal inherits is exactly the one the previous clip finished, so the handoff sits on the canvas where you can check it before spending a generation. Editing note from the format — post the reveal first as the hook, then the build.',
    category: 'Content',
    difficulty: 'Advanced',
    nodeCount: 14,
    thumbnail: '🚗',
    thumbnailImage: 'assets/templates/miniature-car.svg',
    nodes: [
      // The label carries the editing hint; the prompt text cannot, because
      // everything in it is read by a model as an instruction to itself.
      promptNode('p_car', 'Which Car', CAR_SUBJECT, 40, 300),
      // The car_sheet preset turns those few words into the full brief — the
      // angles, the lighting, and the instruction to name this generation's
      // details rather than any car of the class.
      askNode('ask_sheet', 'Write the Sheet Prompt', 480, 260, 'car_sheet'),
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
      // Car name → preset writes the brief → Flow renders the sheet.
      tEdge('p_car', 'ask_sheet'),
      tEdge('ask_sheet', 'g_sheet'),
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

/** @deprecated Use the loader; this is the bundled floor, not the whole set. */
export const TEMPLATES = BUILTIN_TEMPLATES;
