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
  '- "flow"    Google Flow. The best motion, and the only one that can start a',
  '            clip from one still and end it on another. Default for video.',
  '- "grok"    Grok Imagine. Fast stills, and short clips that "extend" can',
  '            continue. Use for stills, and for video only when extending.',
  '- "chatgpt" ChatGPT. Stills, and writing text for a later step to use.',
  '- "gemini"  Gemini. Stills, and reading an image or clip to describe it.',
].join('\n');

const NODE_MANUAL = `THE NODES, AND WHAT EACH IS FOR

  image     A slot the user fills with their own picture.
            Emits: a still.
            Use only when the idea depends on something the user owns — their
            product, their face, their logo. Never invent one.

  generate  One generation. media is "image", "video" or "text".
            Takes: a prompt, plus optional stills as reference.
            Emits: a still, a clip, or written text.
            This is most of any workflow.

  frame     The LAST FRAME of a clip, as a still.
            Takes: exactly one video step.
            Emits: a still.
            This is the continuity tool. Shot two literally begins on the
            image shot one ended on, which no wording in a prompt can
            promise. Use it whenever two clips must feel continuous.

  extend    Makes an existing Grok clip longer, in the same shot.
            Takes: one Grok video step, and a prompt for what happens next.
            Emits: the longer clip.
            Grok only, and the finished clip cannot pass 30 seconds. Use for
            one continuous action that outgrows a single generation — not for
            cutting to a new shot, which is a new step.

  agent     Asks a chat model to work something out and answer in text.
            Takes: a goal.
            Emits: text, which a later step can use as its prompt.
            Use when a prompt must be reasoned about rather than written now.

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
    the same room, the same object.

  One subject, many shots.
    Put the subject's description, word for word, in every prompt that shows
    it. Models drift; repeated wording is what holds a character or a product
    together across steps. Where the subject is a real thing the user owns,
    use an "image" step and feed it to every shot instead.

  Writing a prompt with a model.
      generate text  ->  generate image (inputs: that text step)
    The text step's answer BECOMES the next step's prompt. A step fed this way
    must not also carry its own "prompt".`;

const EXAMPLE = `{
  "thinking": {
    "shots": [
      "1. Hero product on a plinth, slow push in",
      "2. Macro across the surface, continuing from shot 1"
    ],
    "continuity": "Shot 2 starts on the last frame of shot 1, so the lighting and angle carry over.",
    "platforms": "Stills on grok because they are quick and I want to check the frame; motion on flow.",
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
    "type": "generate" | "extend" | "agent",
    "media": "image" | "video" | "text",
    "platform": "flow" | "chatgpt" | "gemini" | "grok",
    "label": "short name for the node",
    "prompt": "the actual prompt text, written out in full",
    "inputs": ["ids of steps that feed this one"],
    "aspectRatio": "1:1" | "9:16" | "16:9" | "2:3" | "3:2",
    "duration": "6s" | "10s",
    "extendSeconds": "+6s" | "+10s"
  }

RULES

- ids are short, lowercase, and unique. Refer to steps only by id.
- "prompt" is the finished prompt, addressed to the image or video model.
  Never write instructions to the user in it — nobody reads it but the model.
- A step fed by a "text" step must NOT also have its own "prompt".
- "frame" takes exactly one video step, and nothing else.
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
