/* ============================================================
   The brief a chat model is given.

   Read by ChatGPT, Grok, Gemini, DeepSeek and Claude, so it cannot rely on
   any one of them being clever about ambiguity. Four rules shaped it, and
   three of them came from watching all five answer the same idea:

   1. Ask for the smallest thing that works. The model chooses steps, prompts
      and wiring; the extension computes ids, handles, positions and defaults.
      Anything mechanical left to a model is a failure mode for five models.

   2. Constrain by enumeration, not description. "platform: one of flow,
      chatgpt, gemini, grok" is obeyed; "pick a suitable platform" produces
      "midjourney" often enough to matter.

   3. Teach the nodes, not just the schema. The first version described the
      JSON and got JSON — but three of five models built a flat row of
      unrelated generations, because nothing told them the canvas can carry a
      still into a clip or a last frame into the next shot. A model cannot use
      a tool it has not been told exists.

   4. Make it decide before it writes. DeepSeek collapsed a three-shot ad into
      one node; ChatGPT and Grok produced three shots with no continuity
      between them. Both are what a model does when it starts emitting steps
      immediately. The plan now opens with a "thinking" object it must fill in
      first — the shot list, the continuity strategy, the platform choice —
      and JSON is generated in order, so those fields are settled before the
      first step exists. readPlan ignores them; the deliberation is the point,
      not the content.

   The measured baseline, same idea, before any of this: ChatGPT 3 flat steps,
   Grok 3 flat steps, Gemini 6 (still→clip), Claude 6 (still→clip), DeepSeek
   1. The two that scored best found still→clip on their own; this brief now
   states it, so the other three do not have to guess.
   ============================================================ */

/** Platforms a built workflow may name, and what each is actually for. */
const PLATFORM_NOTES = [
  '- "flow"    Google Flow (Veo / Omni). The premier platform for video generation.',
  '            Best physical motion, realistic dynamics, and the only platform that',
  '            can interpolate between two stills (startFrame & endFrame match cuts).',
  '            Models: Omni Flash (supports 10s clips), Veo 3.1 (Lite, Fast, Quality).',
  '            Default choice for all standard AI video generations.',
  '- "grok"    Grok Imagine. Ultra-fast stills and short video clips (6s, 10s, 15s).',
  '            Exclusive capability: "extend" nodes can lengthen existing clips up to',
  '            30 seconds total in one unbroken continuous take. Excellent for quick',
  '            concept stills and extended uncut action.',
  '- "chatgpt" OpenAI ChatGPT (DALL-E & GPT). Creates high-detail images or writes',
  '            prompts for downstream nodes (media: "text"). Best for prompt-writing',
  '            steps that need creative ideation before generating.',
  '- "gemini"  Google Gemini (Imagen & Flash). High-fidelity stills and deep multimodal',
  '            reasoning. Can inspect clips and images to describe or verify results.',
  '- "zai"     Z.AI (GLM-4 / GLM-5). Fast structured text generation and creative reasoning.',
].join('\n');

export const NODE_MANUAL = `THE NODES, AND WHAT EACH IS FOR

  image     USER UPLOAD SLOT
            A place for the user to upload their own reference picture.
            Takes:  Nothing (user file upload).
            Emits:  A still image reference.
            When:   Use ONLY when the project strictly requires a real asset the user
                    already owns — their physical product photo, real face portrait,
                    brand logo, or specific artwork. Never invent image slots for
                    generic concepts (generate an image instead).

  generate  THE PRIMARY WORKHORSE NODE
            Executes one AI generation for a still image, video clip, or prompt text.
            Takes:  A prompt (or a text input from another node), plus optional
                    reference stills in "inputs".
            Emits:  A still image, a video clip, or written prompt text.
            Fields:
              - media: "image" | "video" | "text"
              - platform: "flow" | "grok" | "chatgpt" | "gemini"
              - aspectRatio: "9:16" (vertical/TikTok/Reels), "16:9" (cinematic/YouTube),
                             "1:1" (square), "2:3", "3:2", "4:3", "3:4"
              - duration: "4s" | "6s" | "8s" | "10s" (video only)
              - startFrame / endFrame: node IDs of stills for match cuts (Flow only)
              - storyboardSheet: true (image only) — see "Plan the whole piece as one
                                 picture" below
              - preset: (media "text" only) a written brief so the step only needs the
                        subject. A bare subject gets a flat result; the preset brings the
                        angles, the lighting and the trap to avoid. One of:
                          "storyboard_sheet"  every scene as a captioned panel on ONE canvas
                          "character_sheet"   three-view reference of a person
                          "car_sheet"         three-view reference of a vehicle
                          "product_ugc"       a product shot that reads as a real phone photo
                          "scene_beats"       a logline into numbered shots
                          "continue_shot"     the clip that follows a wired-in Last Frame
                          "match_style"       a new subject in an existing picture's style
                          "nanobanana2_scene" 8-part scene-still formula
                          "flow_omni_video"   camera, action, quoted dialogue, layered sound
                        Omit it, or use "none", to send your text unchanged.
            When:   This forms 80%+ of any workflow. Every shot or image is a generate step.

  frame     LAST FRAME CONTINUITY EXTRACTOR
            Extracts the exact final frame of a rendered video clip as a still image.
            Takes:  Exactly ONE video step in "inputs".
            Emits:  A still image reference.
            When:   The key tool for cinematic shot-to-shot continuity. Shot B literally
                    opens on the exact frame Shot A ended on. Use it whenever two
                    consecutive scenes must feel seamless in lighting, position, and space.

  extend    GROK CLIP LENGTHENER (UNCUT ACTION)
            Continues an existing Grok video clip forward in time in one unbroken take.
            Takes:  One Grok video step in "inputs", and a prompt for what happens next.
            Emits:  The longer video clip.
            Fields:
              - extendSeconds: "+6s" | "+10s" (Total clip duration cannot exceed 30s).
            When:   Grok only. Use for a single continuous event that needs more than 10s
                    (e.g., an ASMR craft, slow reveal, continuous walk). Not for scene cuts.

  agent     AUTONOMOUS INSPECTION & REPAIR LOOP
            An AI loop with tools that can read the canvas, check outputs, and fix prompts.
            Takes:  A goal in "prompt".
            Emits:  Its final answer as text.
            Tools:  read_canvas, read_node, set_prompt, rerun_node, generate_image, inspect_clip.
            When:   Use ONLY when a step must LOOK at a generated result and react or repair it
                    (e.g., "watch the clip and fix the prompt if the car changed colour").
                    DO NOT use it to write a prompt. That is what a generate step with
                    media "text" is for, and it is cheaper, faster and predictable.
                    If your step just needs words written before the shot, it is a
                    generate/text step, not an agent.

  story     THE DIRECTOR (ONE WRITER FOR ALL SHOTS)
            Called "Director" everywhere a person sees it. The type string stays
            "story" — that is what every saved workflow holds — so write
            "type": "story" even though the node is named Director on the canvas.
            An orchestrator node that writes synchronized prompts for every connected
            shot in a single AI pass.
            Takes:  An optional story brief/idea in "prompt" or via T input.
            Emits:  Tailored prompts fed directly to downstream Generate nodes.
            Fields:
              - platform: "chatgpt" | "gemini" | "grok" | "claude"
              - cast: [ { "name": "Name", "look": "Appearance description", "role": "position/role" } ]
              - world: "Setting and environment description"
              - look: "Visual style, camera aesthetics, and lighting rules"
              - structure: "hook" | "transform" | "loop" | "ugcAd" | "free"
              - cameraProgression: "dynamic" | "establishingToClose" | "actionTracking" | "propped" | "fixed"
              - audioMode: "cinematic" | "ambient" | "dialogue" | "none"
              - visualPreset: "liveAction" | "smartphonePOV" | "cinema35mm" | "cgi3d" | "anime" | "none"
              - colorTemp: "daylight" (5600K) | "tungsten" (3200K) | "amber" (1800K) |
                           "moon" (6800K) | "none". ONE white balance for the whole piece.
                           Shots that each pick their own look like footage from several
                           days cut together.
              - lighting: "hero" | "intimate" | "tension" | "none". ONE lighting setup,
                          repeated. Sixteen descriptions of lighting do not hold; one
                          named setup does. Do NOT pair "hero" with visualPreset
                          "smartphonePOV" — that preset rules out studio lighting, so the
                          two instructions contradict each other and the model picks one.
              - rules: ["cumulative" | "fixedCamera" | "samePerson" | "inHand"]
              - beats: number of story beats across the whole piece, or 0 to derive it
              - timedBeats: true to cut each clip into "[00:00-00:02] ..." segments
              - avoid: "what must not appear"
            Picking these:
              "propped" + "smartphonePOV" + "ugcAd" is the UGC set — a phone on a
                counter, unretouched, opening on the hook. Use all three for a
                creator ad; none of them for anything meant to look produced.
              "transform" plus rules ["cumulative","inHand"] is the build set —
                a time-lapse where things arrive and nothing disappears.
              "dialogue" only when someone actually speaks on camera; "ambient"
                for a piece with sound but no lines; "none" for silence.
            When:   Use whenever building a multi-shot story, episodic series, or
                    reusable story template where one director should coordinate
                    all scene prompts at runtime.

HOW THEY GO TOGETHER

  Still first, then move it.
      generate image  ->  generate video (inputs: the still)
    A video generation is the expensive one. Making the frame first means you
    can look at it, and regenerate a still rather than a clip when it is
    wrong. It also fixes the composition, so the clip animates the picture you
    chose instead of a fresh interpretation of the words.

  Continuity between shots.
      clip A  ->  frame  ->  clip B (inputs: that frame)
    Use this whenever the viewer should believe two shots are the same moment,
    the same room, the same object. The last frame of clip A becomes the starting
    reference for clip B, preventing character and environment drift across cuts.

  One subject, many shots.
    Put the subject's description, word for word, in every prompt that shows
    it. Models drift; repeated wording is what holds a character or a product
    together across steps. Where the subject is a real thing the user owns,
    use an "image" step and feed it to every shot instead.

  Writing a prompt with a model (Prompt Writer).
      generate text  ->  generate image (inputs: that text step)
    The text step's answer BECOMES the next step's prompt. A step fed this way
    must not also carry its own "prompt".

  A shot that must START on one image and END on another.
      "startFrame": "id", "endFrame": "id"     (flow only)
    Flow can be given both ends of a clip and will move between them. This is
    how a match cut works — the miniature at the start, the real thing at the
    end, one continuous move. Use startFrame/endFrame for that, NOT two
    entries in "inputs": inputs are reference pictures, which is a different
    instruction and will not produce the move.

  Extended continuous action (Grok exclusive).
      generate video (grok)  ->  extend (+10s)  ->  extend (+10s)
    Lengthens a single camera take up to Grok's 30s ceiling without cutting.

  One writer for the whole piece (the Director).
      story  ->  [shot1, shot2, shot3, shot4]
    Connect one Director to every generate node in your scene. It inspects
    their formats (media, ratio, duration) and writes all prompts together
    so characters, setting, and pacing match across the entire sequence.

  Plan the whole piece as one picture (storyboard sheet).
      generate image (the board)  ->  clip 1, clip 2, clip 3 (inputs: the board)
    One image holding every scene as a numbered panel, with the spoken line
    written under each. All the panels share a canvas, so the model composes
    them as a single picture — which is why the character, the palette and the
    product hold across every panel, and therefore across every clip made from
    it. Feed the board into each clip as a reference: it is read as a plan and
    the content is animated, not the borders or the captions.
    Ask for the panel count that matches the number of clips (8 clips -> a 4x2
    board) and keep each caption to a short phrase — long captions render
    badly.
    Set "storyboardSheet": true on that image step. A Director wired to
    it then asks it for a board instead of a scene; without the flag it is
    asked for one illustration and refused for mentioning panels.

  A minute, as connected ten-second clips.
      board 1 -> clip 1 (10s) -> frame -> clip 2 (10s, inputs: that frame)
    A Flow clip tops out at 10s, so a long piece is chained rather than asked
    for in one go. Give each ten seconds its own board, and pass the last
    frame of each clip into the next so the cut continues instead of
    restarting. Repeat the wardrobe and hair in every board: unmanaged, they
    drift within a single ten-second clip, let alone across six.

  How many references one shot may carry.
    Flow takes at most FIVE images and one video per generation. A shot wired
    to more fails at the composer, after the run has already started and paid
    for getting there. Two or three characters, an environment and a prop is
    the working budget.`;

const EXAMPLE = `{
  "thinking": {
    "shots": [
      "1. Hero product on a dark stone plinth, slow push in (still -> video)",
      "2. Macro pan across the product surface, continuing from shot 1's final frame"
    ],
    "continuity": "Shot 2 starts on the last frame of shot 1, so the lighting and angle carry over seamlessly.",
    "platforms": "Stills on grok because they are quick and high fidelity; motion on flow for the cleanest camera push.",
    "risks": "The product must not change shape between shots, so the reference photo feeds both stills."
  },
  "name": "Product photo to two-shot ad",
  "description": "Turn one product photo into two continuous vertical shots.",
  "steps": [
    { "id": "photo", "type": "image", "label": "Product photo" },
    {
      "id": "hero_still", "type": "generate", "media": "image", "platform": "grok",
      "label": "Hero still",
      "prompt": "The product centred on a dark stone plinth, single soft key light from the left, deep shadow behind, premium commercial look. Keep the product shape, colour and label exactly as in the reference.",
      "inputs": ["photo"], "aspectRatio": "9:16"
    },
    {
      "id": "hero_clip", "type": "generate", "media": "video", "platform": "flow",
      "label": "Push in",
      "prompt": "Slow push in toward the product, the key light travelling across its surface, dust drifting in the beam, locked-off framing otherwise.",
      "inputs": ["hero_still"], "aspectRatio": "9:16", "duration": "6s"
    },
    { "id": "handoff", "type": "frame", "label": "Ends on", "inputs": ["hero_clip"] },
    {
      "id": "macro_clip", "type": "generate", "media": "video", "platform": "flow",
      "label": "Macro drift",
      "prompt": "Continue from this exact frame: the camera drifts closer still, crossing the product surface in macro, same key light and shadow, no cut.",
      "inputs": ["handoff"], "aspectRatio": "9:16", "duration": "6s"
    }
  ]
}`;

/**
 * The full brief, with the user's idea in it.
 *
 * One string on purpose: it is pasted into a chat box by hand as often as it
 * is typed by an adapter, and a version that only worked through the
 * extension would be untestable against DeepSeek and Claude, which have no
 * adapter here.
 */
export function buildSpec(idea: string): string {
  return `You are designing a workflow for AutoFlow Studio, a node editor that
drives AI image and video tools. You are the director: decide what the shots
are, how they connect, and what each one says.

Reply with ONE JSON object and nothing else. No commentary before or after.

${NODE_MANUAL}

THE SHAPE

{
  "thinking": {
    "shots":      ["one line per shot, in order"],
    "continuity": "how the shots hold together, and which nodes do it",
    "platforms":  "why each platform was chosen",
    "risks":      "what is most likely to come out wrong, and what prevents it"
  },
  "name": "short name",
  "description": "one sentence",
  "steps": [ ...step objects... ]
}

Fill in "thinking" FIRST and let it decide the steps. It is read by a person,
not by the program, so be blunt and specific in it.

A step:

  { "id": "unique_id", "type": "image", "label": "what to upload" }

  { "id": "unique_id", "type": "frame", "label": "Ends on",
    "inputs": ["the video step this frame comes from"] }

  {
    "id": "unique_id",
    "type": "story",
    "platform": "chatgpt" | "gemini" | "grok" | "claude" | "zai",
    "label": "Story Director",
    "prompt": "optional story premise or brief",
    "cast": [ { "name": "Name", "look": "Appearance description", "role": "optional role",
                "voice": "optional Flow voice, e.g. Kore" } ],
    "world": "Setting description",
    "look": "Lighting & style description",
    "structure": "hook" | "transform" | "loop" | "ugcAd" | "free",
    "cameraProgression": "dynamic" | "establishingToClose" | "actionTracking" | "propped" | "fixed",
    "audioMode": "cinematic" | "ambient" | "dialogue" | "none",
    "visualPreset": "liveAction" | "smartphonePOV" | "cinema35mm" | "cgi3d" | "anime" | "none",
    "rules": ["cumulative" | "fixedCamera" | "samePerson" | "inHand"],
    "beats": 0,
    "timedBeats": false,
    "avoid": "optional — what must not appear"
  }

  {
    "id": "unique_id",
    "type": "generate" | "extend" | "agent",
    "media": "image" | "video" | "text",
    "platform": "flow" | "chatgpt" | "gemini" | "grok" | "zai",
    "label": "short name for the node",
    "prompt": "the actual prompt text, written out in full",
    "inputs": ["ids of steps that feed this one"],
    "aspectRatio": "1:1" | "9:16" | "16:9" | "2:3" | "3:2" | "4:3" | "3:4",
    "duration": "4s" | "6s" | "8s" | "10s",
    "extendSeconds": "+6s" | "+10s",
    "startFrame": "id of the still this clip begins on",
    "endFrame": "id of the still this clip ends on",
    "voice": "optional Flow voice for this one clip, overriding the cast"
  }

RULES

- ids are short, lowercase, and unique. Refer to steps only by id.
- "prompt" is the finished prompt, addressed to the image or video model.
  Never write instructions to the user in it — nobody reads it but the model.
- A step fed by a "text" step must NOT also have its own "prompt".
- "frame" takes exactly one video step, and nothing else.
- "startFrame"/"endFrame" are flow only, are used together, and replace
  "inputs" for that step. Do not pass two pictures in "inputs" hoping for a
  start and an end — that is two references, not a move between them.
- A voice belongs on the CAST, not on each clip: every shot a character is in
  picks up their voice by itself. Put "voice" on a step only to override that.
  A voice needs a reference image in "inputs" — Flow attaches it to a
  character — and is impossible on a startFrame/endFrame step, so do not set
  one there. Omit it entirely unless somebody actually speaks.
- "agent" is for reacting to a result, never for writing a prompt.
- "extend" is Grok only, and a clip cannot pass 30 seconds in total.
- Only "image" steps are things the user uploads. If the idea does not need an
  upload, do not invent one.
- Do not include positions, coordinates, edges, connection ids, handles, or
  styling. Those are added automatically. Only the fields above.

QUALITY BAR

- One step per shot. Never fold several shots into one generation and describe
  them in the prompt — the whole point of the canvas is that each shot is its
  own node you can rerun.
- A workflow of unconnected steps is a weak answer. If two shots share a
  subject, a place or a moment, wire them: still into clip, or frame into the
  next clip.
- Prompts carry camera, light, lens and motion, not just the subject. "A cup
  of coffee" is not a prompt; the example above is the standard.
- Prefer the fewest steps that actually deliver the idea. More nodes are not
  better — connected nodes are.
- Every still you generate must be named in the "inputs" of something. A still
  nothing uses is a generation the user pays for that appears nowhere in the
  finished video.
- Every clip in one piece takes the SAME "aspectRatio". They are shots of one
  video; mixed shapes cannot be cut together. A character sheet is the one
  exception — shoot that "1:1" so the outer poses stay in frame.
- A prompt of three or four words is a label, not a shot. If a step carries its
  own prompt, write the shot: what is in frame, how it is lit, how the camera
  moves.

PLATFORMS

${PLATFORM_NOTES}

EXAMPLE

${EXAMPLE}

THE IDEA

${String(idea || '').trim() || '(no idea given — ask for one)'}

Think it through in "thinking", then give the JSON object only.`;
}

/** Shown next to the box so the paste step is obvious without a manual. */
export const BUILDER_STEPS = [
  'Describe what you want to make.',
  'Copy the brief and paste it into any AI chat.',
  'Paste the reply back here.',
] as const;
