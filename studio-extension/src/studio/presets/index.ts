/* ============================================================
   Ask AI presets — the craft, so the user only supplies the subject.

   Typing "BMW 525d" into a prompt box gets you a flat sheet, because the
   model was told what to draw and nothing about how. The car template solved
   that once, by hand: CAR_BRIEF is 150 words wrapping a single editable line.
   It works, and it only works for cars, in that one template.

   A preset is that wrapper, reusable. The user brings the subject; the preset
   brings the angles, the lighting, and the trap to avoid.

   ── Two rules this file must keep ──

   1. Presets are DATA, never code. `{{subject}}` is substituted with plain
      string replacement — no expressions, no callbacks. That is what lets
      them ride the cloud-template pipeline (MV3 permits fetching config, not
      logic), and the day a preset can carry logic that stops being true.

   2. Every brief says what NOT to do. Left to itself a model will centre the
      subject, light it evenly and call it done. The instructions that earn
      their place are the ones ruling out the obvious wrong answer.
   ============================================================ */

export interface AskPreset {
  id: string;
  name: string;
  /** One line under the dropdown, so the choice explains itself. */
  hint: string;
  /** Used when nothing is wired into the image port. */
  brief: string;
  /**
   * Used when a reference image IS wired in.
   *
   * The distinction matters more than it looks: "character sheet from a
   * description" and "character sheet from a photo" are different jobs — one
   * invents a character, the other matches one. A single brief doing both
   * ends up hedging, and hedged briefs produce hedged sheets.
   */
  withImage?: string;
}

/** Shared closing rule. An Ask AI answer is fed straight to another node as
    its prompt, so anything conversational gets rendered as if it were part
    of the shot. */
const ONLY_THE_PROMPT =
  '\n\nOutput only the prompt itself — no title, no preamble, no explanation, ' +
  'no quotes, no markdown, no numbered list unless asked for one.';

/**
 * The presets compiled into this build.
 *
 * The floor, exactly like BUILTIN_TEMPLATES: a fresh install or an
 * unreachable API still has every preset. The loader replaces this set with
 * a published one when it can, which is what lets a brief that produces weak
 * sheets be rewritten and live in minutes instead of a store review.
 */
export const BUILTIN_ASK_PRESETS: AskPreset[] = [
  {
    id: 'none',
    name: 'None — send as written',
    hint: 'Your text goes to the model unchanged.',
    brief: '{{subject}}',
  },

  {
    id: 'nanobanana2_scene',
    name: '🍌 NanoBanana2 Scene Stills Master',
    hint: '8-part formula: Camera, Character ID lock, Props, Environment, Lighting, 8K Pixar render.',
    brief:
      'Write ONE ultra-high-quality scene image generation prompt for NanoBanana2 based on this concept: {{subject}}\n\n' +
      '# THE 8-PART NANOBANANA2 FORMULA (MANDATORY STRUCTURE)\n' +
      '1. [SCENE_LABEL] [REF:CHARACTER_NAME] — Identify the scene beat and character reference tag.\n' +
      '2. CAMERA COMPOSITION — Exact lens angle, shot size (medium close-up, wide establishing, low-angle hero), framing.\n' +
      '3. FULL CHARACTER ID — Explicitly specify head shape, skin tone, hair style & color, eye color, nose shape, exact layered outfit, and signature accessories.\n' +
      '4. BODY LANGUAGE & EMOTION — Micro-expressions, gaze direction, posture, and physical weight.\n' +
      '5. KEY PROPS — Explicit materials, colors, and any text spelled out clearly in quotes.\n' +
      '6. DEEP ENVIRONMENT — Tangible materials, architectural cues, depth-of-field, atmospheric dust/weather.\n' +
      '7. LIGHTING SETUP — Key light direction, ambient color temperature, rim/backlight, soft volumetric glow.\n' +
      '8. QUALITY LOCK TAG — "9:16 vertical, Pixar-quality 3D cinematic render, 8K resolution, octane render, photorealistic materials, vibrant color grading, masterpiece".\n\n' +
      'Output ONLY the single prompt string without markdown fences, preamble, or commentary.',
    withImage:
      'Write ONE NanoBanana2 scene image generation prompt that locks identity and style from the attached reference image.\n' +
      'Scene concept: {{subject}}\n\n' +
      '# READ REFERENCE & PRESERVE IDENTITY\n' +
      'Extract exact character features (face shape, hair texture/color, outfit, palette) and replicate them completely.\n' +
      'Follow the 8-part formula: [SCENE_LABEL] [REF] -> Camera -> Full Character ID -> Pose & Expression -> Key Props -> Deep Environment -> Cinematic Lighting -> 8K Pixar Quality Lock.\n\n' +
      'Output ONLY the prompt.',
  },

  {
    id: 'flow_omni_video',
    name: '🎬 Flow Omni Video Director v2',
    hint: 'Camera move, character action, dialogue in quotes, style-lock, and layered 3D sound.',
    brief:
      'Write ONE video generation prompt for Flow Omni based on this scene beat: {{subject}}\n\n' +
      '# FLOW OMNI 7-PART VIDEO PROMPT FORMULA\n' +
      '1. CAMERA MOTION — Specific movement (slow push-in, dynamic tracking pan, steadycam orbit, crane rise).\n' +
      '2. CHARACTER ID & BODY LANGUAGE — Detailed character traits, realistic movement rhythm, natural pauses.\n' +
      '3. ACTION BEAT — Clear physical action progression from 0s to 5s.\n' +
      '4. SPOKEN DIALOGUE — Include any spoken words in exact quotation marks with emotional tone tags.\n' +
      '5. RICH ENVIRONMENT & LIGHTING — World interaction, reflections, dynamic lighting shifts.\n' +
      '6. STYLE-LOCK BLOCK — "Cinematic 3D animation, hyper-detailed textures, Pixar/DreamWorks quality, rich volumetric lighting, no morphing, no flicker, smooth motion".\n' +
      '7. LAYERED SOUND DESIGN — 3+ specific audio elements (e.g., [Audio: gentle rustling wind, soft footsteps on wood, warm cheerful voice]).\n\n' +
      'Output ONLY the prompt on a single clean paragraph.',
  },

  {
    id: 'car_sheet',
    name: 'Car reference sheet',
    hint: 'Type a model and year. Returns a three-view sheet prompt.',
    brief:
      'Write ONE image-generation prompt for a reference sheet of this exact ' +
      'car: {{subject}}\n\n' +
      '# THE SHEET\n' +
      'One image on a plain mid-grey studio backdrop, three views: ' +
      'three-quarter front on the left, dead-side profile in the centre, ' +
      'three-quarter rear on the right. Even neutral studio lighting. The whole ' +
      'car in frame in every view, wheels straight, no cropping.\n\n' +
      '# BE SPECIFIC TO THIS MODEL\n' +
      'Name the details that make it recognisably this generation and trim: ' +
      'headlight and tail-light shape, grille design, bumper and skirt lines, ' +
      'bonnet contour, mirror style, wheel design and spoke count, badge ' +
      'placement, exhaust layout, roofline. Name the paint colour precisely. ' +
      'A prompt that would suit any car of that class is wrong — that is the ' +
      'failure to avoid.\n\n' +
      '# LOOK\n' +
      'Ultra photorealistic product photography, 8K, sharp throughout, ' +
      'accurate panel reflections. No people, no background detail, no text, ' +
      'no watermarks.\n\n' +
      'Under 150 words.' + ONLY_THE_PROMPT,
  },

  {
    id: 'character_sheet',
    name: 'Character sheet',
    hint: 'A name or a line of description. Wire in a photo to match one instead.',
    brief:
      'Write ONE image-generation prompt for a character reference sheet of: ' +
      '{{subject}}\n\n' +
      '# THE SHEET\n' +
      'One image on a plain mid-grey backdrop, three views: three-quarter ' +
      'front, side profile, three-quarter back. Full body head to toe in every ' +
      'view, neutral pose, arms clear of the body so the silhouette reads. ' +
      'Even lighting, no dramatic shadow.\n\n' +
      '# PIN THE THINGS THAT DRIFT\n' +
      'Face shape and features, hair length colour and how it falls, exact ' +
      'clothing including fastenings and footwear, body proportions, palette, ' +
      'and any prop the character always carries. These are what a later shot ' +
      'gets wrong, so name them rather than implying them.\n\n' +
      'Invent whatever the description leaves open, and commit to it — a ' +
      'sheet that hedges is a sheet nothing can be matched against.\n\n' +
      'Under 150 words.' + ONLY_THE_PROMPT,
    withImage:
      'Write ONE image-generation prompt for a character reference sheet that ' +
      'MATCHES the attached reference image. Notes on the subject: ' +
      '{{subject}}\n\n' +
      '# READ THE REFERENCE FIRST\n' +
      'Describe what is actually there — face shape, hair, build, clothing ' +
      'down to fastenings and footwear, colour palette, any distinctive prop. ' +
      'Do not improve, restyle, age or idealise the person in it. Where the ' +
      'reference is ambiguous, say what it shows rather than inventing.\n\n' +
      '# THE SHEET\n' +
      'One image on a plain mid-grey backdrop, three views: three-quarter ' +
      'front, side profile, three-quarter back. Full body, neutral pose, even ' +
      'lighting. Same person in every view.\n\n' +
      'Under 150 words.' + ONLY_THE_PROMPT,
  },

  {
    /* The other half of the storyboard board.
     *
     * A Story node wired to an image node ticked "Storyboard board" writes the
     * board prompt itself. This is for the workflow with no director — an Ask
     * AI node feeding an image node, which is the commonest shape people
     * actually build.
     *
     * What makes a board work is that every panel shares one canvas: the model
     * composes them as a single picture, so the character, the palette and the
     * product hold across all of them, and therefore across every clip made
     * from the board. Panels asked for as separate images lose exactly that,
     * which is why the first instruction is ONE image and not a set.
     */
    id: 'storyboard_sheet',
    name: 'Storyboard board',
    hint: 'A logline and a shot count. Returns one board with every scene as a captioned panel.',
    brief:
      'Write ONE image-generation prompt for a storyboard board of: ' +
      '{{subject}}\n\n' +
      '# THE BOARD\n' +
      'ONE image, not a set. Every scene is a numbered panel on a single ' +
      'canvas, laid out on a stated grid — six panels read as 3x2, eight as ' +
      '4x2. Say the panel count and the grid in the prompt. Wide beats tall: ' +
      'the panels are 16:9 and a single column of them is a strip nobody can ' +
      'read at a glance.\n\n' +
      '# WHAT EVERY PANEL SHARES\n' +
      'Describe the cast, the setting and the look ONCE at the top, then let ' +
      'each panel carry only its own action. That is what the single canvas ' +
      'buys — the same face, the same clothes and the same light in every ' +
      'frame — and it is the whole reason to draw a board rather than six ' +
      'separate pictures.\n\n' +
      '# EACH PANEL\n' +
      '"Panel 1: ...", "Panel 2: ..." in story order, each naming its shot ' +
      'size and what happens in it. Give each one a SHORT caption beneath the ' +
      'frame — the line that character speaks in that shot, in quotation ' +
      'marks, a few words at most. Long captions render as unreadable text.\n\n' +
      'Finish with the board itself: production-board background, clear ' +
      'borders between panels, caption text beneath each frame.\n\n' +
      'Under 220 words.' + ONLY_THE_PROMPT,
    withImage:
      'Write ONE image-generation prompt for a storyboard board that uses the ' +
      'attached reference. Notes on the piece: {{subject}}\n\n' +
      '# READ THE REFERENCE FIRST\n' +
      'Describe what is actually in it — the product or person, its colours, ' +
      'markings, materials and proportions — and carry that description into ' +
      'the shared block so every panel draws the same thing. Do not restyle, ' +
      'improve or idealise it.\n\n' +
      '# THE BOARD\n' +
      'ONE image. Every scene a numbered panel on a single canvas, on a stated ' +
      'grid. Cast, setting and look described once at the top; each panel then ' +
      'carries only its own action and shot size.\n\n' +
      '"Panel 1: ...", "Panel 2: ..." in story order, each with a SHORT quoted ' +
      'caption beneath it. Production-board background, clear borders between ' +
      'panels.\n\n' +
      'Under 220 words.' + ONLY_THE_PROMPT,
  },

  {
    id: 'continue_shot',
    name: 'Continue this shot',
    hint: 'Wire a Last Frame in. Writes the clip that follows it.',
    brief:
      'Write ONE prompt for the video clip that follows this moment: ' +
      '{{subject}}\n\n' +
      'Continue the action rather than restarting it — the next clip opens ' +
      'exactly where this one ended, so do not re-establish the scene, ' +
      're-introduce the subject or cut away.\n\n' +
      'Keep the same location, lighting, camera height and subject. Describe ' +
      'what changes over the next few seconds and nothing else.\n\n' +
      'Under 120 words.' + ONLY_THE_PROMPT,
    withImage:
      'The attached image is the LAST FRAME of the previous clip. Write ONE ' +
      'prompt for the clip that continues from it.\n' +
      '{{subject}}\n\n' +
      '# CONTINUE, DO NOT RESTART\n' +
      'Open on exactly what the frame shows. Same location, same lighting, ' +
      'same camera height, same subject in the same position. No cut, no ' +
      're-establishing shot, no reset to a wide.\n\n' +
      'Describe the reference back accurately first — the model needs to know ' +
      'what it is continuing — then say what changes over the next few ' +
      'seconds.\n\n' +
      'Under 120 words.' + ONLY_THE_PROMPT,
  },

  {
    id: 'scene_beats',
    name: 'Scene beats',
    hint: 'A logline. Returns numbered shots with an emotional arc.',
    brief:
      'Break this into a numbered sequence of shots: {{subject}}\n\n' +
      '# THE ARC\n' +
      'Open on tension or a question, escalate, turn on something unexpected, ' +
      'resolve. Frame the final shot to echo the first so the video can loop.\n\n' +
      '# EACH SHOT\n' +
      'One line naming what happens, the framing, and the colour temperature. ' +
      'Carry the colour from cool and desaturated through the tense half to ' +
      'warm at the turn — that progression is doing real work and is the part ' +
      'most sequences skip.\n\n' +
      'Every shot must hold the same character and location unless the story ' +
      'moves. Number them. No dialogue.\n\n' +
      'Give 6 shots unless the subject asks for a different count.' +
      '\n\nOutput only the numbered list — no title, no preamble, no ' +
      'explanation, no markdown.',
  },

  {
    id: 'match_style',
    name: 'Match this style',
    hint: 'Wire an image in. Describes its look so other shots can reuse it.',
    brief:
      'Describe the visual style of: {{subject}}\n\n' +
      'Write it as a style block that can be appended to any prompt — lens and ' +
      'framing habits, lighting direction and quality, colour palette and ' +
      'grade, texture and grain, level of realism.\n\n' +
      'Describe only the look. No subject, no action, no story — anything ' +
      'specific to one shot makes the block unusable in the next.' +
      ONLY_THE_PROMPT,
    withImage:
      'Describe the visual style of the attached image so it can be reused on ' +
      'other subjects.\n' +
      '{{subject}}\n\n' +
      'Lens and framing, lighting direction and quality, colour palette and ' +
      'grade, texture and grain, level of realism.\n\n' +
      'Describe only the look. Not what is in the picture — a style block that ' +
      'names the subject cannot be applied to anything else, which is the ' +
      'whole point of extracting it.' + ONLY_THE_PROMPT,
  },

  {
    id: 'product_ugc',
    name: 'Product brief',
    hint: 'Name a product. Returns a UGC-style scene prompt.',
    brief:
      'Write ONE prompt for a handheld UGC-style video of this product: ' +
      '{{subject}}\n\n' +
      '# MUST READ AS A REAL PHONE VIDEO\n' +
      'Shot by one person on a modern phone. Slight micro-shake, imperfect ' +
      'framing, natural available light, one continuous take. Never a tripod, ' +
      'gimbal, drone or cinematic move.\n\n' +
      'The product stays exactly as it is — same shape, colour and label. Held ' +
      'so the label faces camera at least once.\n\n' +
      'Nothing glossy. Not an advert, not influencer content. Natural sound ' +
      'only, no music.\n\n' +
      'Under 120 words.' + ONLY_THE_PROMPT,
  },
  /* A director's brief rather than a shot prompt.
     Every other preset here wraps one subject and returns one prompt. This one
     runs a whole session: five ideas, then a storyboard on request, then two
     motion prompts on request — and it holds a long list of rules between
     turns, because the failures it exists to prevent are all continuity
     failures that only show up across a sequence.

     Kept as a preset rather than a workflow template on purpose: it produces
     prompts for a person to use, it does not describe nodes and edges, and
     compilePlan would have nothing to compile. */
  /* The motion half of the room-transformation session, as a preset.

     It exists because the template used to carry these two prompts as static
     text: I wrote them once, for one imaginary room, and every user after
     that was editing my candy lounge by hand. The rules below are the part
     worth keeping — they are all failures this format hits without them —
     and the specific room is the part the model should be writing.

     It is deliberately a TWO-shot brief. Part 2 has to begin on the frame
     Part 1 ended on, and the only way both prompts can agree about what that
     frame contains is for one reply to write both. The Ask AI node detects
     that from the two generators wired to it and asks for them together. */
  {
    id: 'room_motion_director',
    name: 'Room motion (both halves)',
    hint: 'Writes Part 1 and Part 2 together so the second continues the first.',
    brief:
      'You are writing the two motion prompts for a 20-second fantasy room ' +
      'transformation, split into two 10-second clips.\n' +
      'RULES THAT APPLY TO BOTH, and must be written into BOTH prompts in full:\n' +
      'Vertical 9:16. Ultra-realistic. The ENTIRE clip is extreme fast hyperlapse — no ' +
      'normal-speed action, no slow walking, no waiting, no cinematic pacing, no cuts.\n' +
      'ONE fixed medium-wide camera INSIDE a large, wide, spacious room. No zoom, rotation, ' +
      'dolly, orbit, push-in or angle change. The frame shows floor, main wall, ceiling, the ' +
      'girl working and the hero furniture area, and stays visually full.\n' +
      'The same young female designer throughout: bright red sporty tracksuit, white ' +
      'sneakers, blonde ponytail. Describe her the same way in both prompts.\n' +
      'Every tool or material enters the frame IN HER HANDS before it changes anything. She ' +
      'physically places, sprays, pours, mounts, connects, spreads or styles it. Nothing ' +
      'appears, builds, floats or installs itself.\n' +
      'Everything completed stays visible and active — installed lights keep glowing, layers ' +
      'stay in place, nothing is removed, reset, hidden, turned off or replaced.\n' +
      'No clutter: only the tool being used right now is on the floor. Every second shows a ' +
      'large visible change, not a small detail.\n' +
      'The attached storyboard is a DESIGN REFERENCE ONLY. Never describe its panels, ' +
      'borders, labels, numbers or captions — describe the real room it depicts.\n' +
      'PART 1 covers 00:00–00:10: the empty room, the glowing floor base, the fantasy floor ' +
      'layer, and the beginning of the main wall. It must END on a clean, readable frame ' +
      'showing everything built so far with the girl mid-action at the wall — that frame ' +
      'becomes the first frame of Part 2, so describe it precisely.\n' +
      'PART 2 covers 00:10–00:20 and CONTINUES from that exact frame: it finishes the wall, ' +
      'transforms the ceiling, brings in the hero furniture and ends on the completed room. ' +
      'It must never restart, never return to an empty room, never rebuild the floor, and ' +
      'never remove or dim anything Part 1 installed. Because the generator cannot see Part ' +
      '1, Part 2 must describe everything already built as already present.\n' +
      'The room, its palette, its hero furniture and its wall and ceiling features come from ' +
      'this concept:\n{{subject}}\n\n' +
      'Output only the prompts themselves — no preamble, no commentary, no notes after them.',
  },
  {
    id: 'room_transform_director',
    name: 'Room transformation director',
    hint: 'Viral fantasy room hyperlapse. Ideas, then storyboard, then motion.',
    brief:
      'You are my creative partner, storyboard designer, and prompt director for viral ' +
      'AI-generated fantasy room transformation videos targeting a U.S. / American audience.\n\n' +
      'Your job is to help me create magical, colorful, realistic extreme-fast-hyperlapse ' +
      'room transformation videos for TikTok / Reels / Shorts.\n\n' +
      'Act as a creative director, not just an executor. If an idea feels boring, repetitive, ' +
      'weak, unclear, too empty, too slow, or too similar to previous ideas, improve it before ' +
      'presenting it.\n\n' +
      '# GLOBAL STYLE\n' +
      'Fantasy room transformation, realistic handmade extreme fast hyperlapse, strong visual ' +
      'hook in the first second, bright happy colors, magical materials installed realistically ' +
      'by the girl, clear step-by-step transformation, big visible changes every second, and a ' +
      'final reveal that feels viral.\n\n' +
      'All prompts and production deliverables go inside code blocks. Deliverables in English. ' +
      'No boring setup, no slow waiting, no unnecessary intro. Do not write motion prompts ' +
      'unless I explicitly say "write motion".\n\n' +
      '# STORYBOARD IS A REFERENCE, NEVER THE SUBJECT\n' +
      'Treat the storyboard as an architect\u2019s blueprint. Never animate storyboard panels, ' +
      'borders, text labels, scene numbers, captions, arrows or layout graphics. The video shows ' +
      'a real room being transformed, not a poster moving. Use the storyboard only for room ' +
      'concept, palette, scene order, materials, furniture, wall, ceiling and floor design.\n\n' +
      '# REALISTIC ACTION\n' +
      'Nothing appears, builds, floats, sprays, pours or installs itself. Every tool or material ' +
      'first appears in the girl\u2019s hands, she carries it in, and the room changes because she ' +
      'physically places, sprays, pours, mounts, connects, spreads or styles it. The finished room ' +
      'may look magical; the construction must look handmade.\n\n' +
      '# EXTREME FAST HYPERLAPSE THROUGHOUT\n' +
      'Every second is accelerated time-lapse — entering with tools, carrying materials, floor ' +
      'lights, rails, spraying, pouring, mounting, climbing the ladder, ceiling install, hero ' +
      'furniture, rugs, pillows, final lights. No normal-speed action, no slow walking, no ' +
      'waiting, no cinematic pacing, no dramatic slow motion, no idle movement.\n\n' +
      '# NO CLUTTER\n' +
      'Never scatter tools, boxes, panels, cables or buckets across the floor. Show only the ' +
      'tool or material being used right now; anything else stays briefly at the frame edge.\n\n' +
      '# BIG VISUAL HOOK\n' +
      'The first transformation must cover a large area fast — glowing floor rails across most ' +
      'of the floor, a huge floor arc, a wide expanding pattern, a large fantasy layer. Nothing ' +
      'small or central-only. It has to stop a scroll on a phone in one second.\n\n' +
      '# CUMULATIVE BUILD\n' +
      'Everything completed stays visible and active for the rest of the video. Never remove, ' +
      'reset, hide, turn off, replace, simplify or undo anything. Scene 02 builds on 01, 03 on ' +
      '01\u201302, 04 on 01\u201303, 05 on 01\u201304. Nothing goes backward.\n\n' +
      '# CHARACTER CONTINUITY\n' +
      'The same young female designer throughout: bright red sporty tracksuit, white sneakers, ' +
      'blonde ponytail, same face, body type, outfit and hairstyle in every scene.\n\n' +
      '# ROOM AND CAMERA\n' +
      'The room is large, wide and spacious, but the frame is never empty. One fixed medium-wide ' +
      'camera INSIDE the room, vertical 9:16, showing floor, main wall, ceiling, the girl working ' +
      'and the hero furniture area. No zoom, rotation, dolly, orbit, push-in or angle change, ' +
      'ever. The room shell must differ between ideas — width, proportions, shape, wall layout, ' +
      'window placement, ceiling shape, architectural identity.\n\n' +
      '# VARIETY\n' +
      'Never repeat the same room concept, furniture, colors, final reveal, room shape or camera ' +
      'side. Vary room type, layout, camera corner, hero furniture, wow feature, materials, wall, ' +
      'ceiling, floor, color identity and tool hook. Not every project is a bedroom, and the hero ' +
      'furniture must match the room type rather than always being a floating bed.\n\n' +
      '# WORKFLOW\n' +
      'STEP 1 — when I ask for ideas, give exactly 5 original ideas and no prompts. Each: title, ' +
      'core visual hook, room type + layout, final room result, why it is viral, what makes it ' +
      'different. The five must differ in at least three of: room type, layout, camera corner, ' +
      'hero furniture, fantasy material, wall feature, ceiling feature, floor treatment, final ' +
      'wow moment, color identity, tool hook.\n\n' +
      'STEP 2 — once I choose one, give the refined concept summary, a 5-scene storyboard ' +
      'breakdown, and the storyboard guide image prompt. No motion yet.\n\n' +
      '# 5-SCENE STRUCTURE (4 seconds each, 20 seconds total)\n' +
      '01 Tool hook + light floor base. 02 Fantasy material layer + glossy/transparent/structural ' +
      'top layer. 03 Main wall feature. 04 Ceiling transformation + atmosphere. 05 Hero furniture ' +
      '+ final reveal.\n\n' +
      'For each scene write: title, time range, visual action, tool/material entering, girl\u2019s ' +
      'physical action, large transformation, elements that must remain, end state.\n\n' +
      '# STORYBOARD IMAGE PROMPT\n' +
      'One complete guide poster: English title and labels, 5 numbered panels, one 4-second scene ' +
      'each, concise captions, visible tools in the girl\u2019s hands, completed elements preserved ' +
      'in later panels, the same room and the same fixed medium-wide interior camera throughout, ' +
      'same designer, and the strongest result in panel 05.\n\n' +
      '# MOTION STAGE\n' +
      'Only when I say "write motion": exactly 2 prompts, each in its own code block. Part 1 is ' +
      'the first 10 seconds (Scene 01, Scene 02, start of Scene 03) and must end on a clean frame ' +
      'usable as Reference 2. Part 2 is the second 10 seconds (finish Scene 03, Scene 04, Scene ' +
      '05) and uses two references: the storyboard as design guide, and Part 1\u2019s last frame as ' +
      'the exact starting frame. Part 2 never restarts, never returns to an empty room, never ' +
      'rebuilds Scene 01 or 02, and never alters anything already built. Replace every bracketed ' +
      'placeholder with the real elements of the chosen concept before answering.\n\n' +
      '# QUALITY CHECK BEFORE ANSWERING\n' +
      'Is the first scene interesting and the hook large? Are tools in her hands before the ' +
      'change? Is she doing the work? Is anything happening by itself? Does any completed element ' +
      'disappear? Do installed lights stay on? Does each scene build on the last? Is the room ' +
      'shape different from previous ideas? Is the camera inside, fixed and medium-wide? Is the ' +
      'frame full rather than empty? Any scattered clutter? Is the hero furniture unique? Is the ' +
      'final reveal the strongest moment? Would an American TikTok viewer stop scrolling? If ' +
      'weak, improve it before answering.\n\n' +
      'Brief for this session: {{subject}}',
  },
];

/* What the app is actually using. Starts as the bundled set and is replaced
   by the loader after a fetch — a module-level list rather than a parameter
   on every call site, because the node dropdown, the runner and the tests all
   need the same answer and threading it through each of them invites drift. */
let activePresets: AskPreset[] = BUILTIN_ASK_PRESETS;

export const getAskPresets = (): AskPreset[] => activePresets;

export function setAskPresets(presets: AskPreset[] | null | undefined): void {
  // Never leave the app with nothing to choose from: an empty published list
  // would silently remove the feature rather than update it.
  activePresets = presets && presets.length ? presets : BUILTIN_ASK_PRESETS;
}

/** @deprecated Use getAskPresets() — this is the bundled floor, not the live set. */
export const ASK_PRESETS = BUILTIN_ASK_PRESETS;

export const DEFAULT_PRESET_ID = 'none';

/**
 * Pass-through, for a caller that named nothing or named something this set
 * does not have.
 *
 * Not `activePresets[0]`. That happens to be `none` in the bundled set, which
 * is why it looked right — but presets are published from the cloud, nothing
 * requires `none` to be present or first, and a list beginning with
 * `car_sheet` would have wrapped every plain Ask AI prompt in a car brief and
 * returned a confident answer about the wrong thing.
 */
const PASS_THROUGH: AskPreset = {
  id: DEFAULT_PRESET_ID,
  name: 'No preset',
  hint: 'Sends what you type, unchanged.',
  brief: '{{subject}}',
};

export const findPreset = (id?: string): AskPreset =>
  activePresets.find((p) => p.id === id)
  || activePresets.find((p) => p.id === DEFAULT_PRESET_ID)
  || PASS_THROUGH;

/**
 * Problems with a published preset, in plain language. Empty means valid.
 *
 * The one rule that is not stylistic: every field must be a string. MV3
 * permits fetching configuration and forbids fetching code, so the day a
 * preset can carry a function this stops being a config fetch. Everything
 * else here is about not shipping a preset that produces nothing.
 */
export function validatePreset(p: any): string[] {
  const problems: string[] = [];
  if (!p || typeof p !== 'object') return ['not an object'];
  for (const field of ['id', 'name', 'hint', 'brief'] as const) {
    if (!p[field] || typeof p[field] !== 'string') problems.push(`missing or non-string ${field}`);
  }
  if (p.withImage !== undefined && typeof p.withImage !== 'string') {
    problems.push('withImage is not a string');
  }
  for (const [key, value] of Object.entries(p)) {
    if (typeof value !== 'string') problems.push(`field "${key}" is ${typeof value}, not a string`);
  }
  // A brief with no placeholder ignores whatever the user typed.
  if (typeof p.brief === 'string' && p.id !== 'none' && !p.brief.includes('{{subject}}')) {
    problems.push('brief never uses {{subject}}, so whatever the user types is discarded');
  }
  return problems;
}

/**
 * The text actually sent to the chat.
 *
 * `hasImage` picks the variant, which is why the runner calls this after it
 * has gathered references rather than before: a character sheet built from a
 * photo and one built from a sentence are different briefs, and the node
 * cannot know which it is until the edges are resolved.
 */
export function composeAskPrompt(
  presetId: string | undefined,
  subject: string,
  hasImage: boolean
): string {
  const preset = findPreset(presetId);
  const template = (hasImage && preset.withImage) || preset.brief;
  const trimmed = (subject || '').trim();

  /* An empty subject is normal for the image-led presets — "continue this
     shot" needs nothing but the frame. Substituting an empty string would
     leave a dangling "Notes on the subject:" with nothing after it.

     Dropping the whole LINE was the previous answer, on the stated grounds
     that every template keeps {{subject}} on a line of its own. That was
     simply untrue: three briefs end an instruction with it —

       "…reference sheet of this exact car: {{subject}}"
       "Break this into a numbered sequence of shots: {{subject}}"
       "Describe the visual style of: {{subject}}"

     so an empty subject deleted the instruction and sent the model a set of
     section headings with nothing to apply them to. Since an empty subject is
     a supported state, that was reachable any time the prompt node feeding an
     Ask AI node was cleared.

     So: remove the placeholder, remove the label it was hanging off, and drop
     the line only when nothing is left on it. */
  const filled = trimmed
    ? template.replace(/\{\{subject\}\}/g, trimmed)
    : template
        // "Notes on the subject: {{subject}}" → "Notes on the subject" is
        // still noise, so take the trailing colon and its spacing with it.
        .replace(/[ \t]*:?[ \t]*\{\{subject\}\}/g, '')
        // Only now, and only if the line has nothing else on it.
        .replace(/^[ \t]*\n/gm, '\n');

  return filled.replace(/\n{3,}/g, '\n\n').trim();
}
