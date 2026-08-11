/* ============================================================
   The brief a chat model is given.

   Written to be read by ChatGPT, Grok, Gemini, DeepSeek and Claude, which
   means it cannot rely on any one of them being clever about ambiguity. Three
   rules shaped it:

   1. Ask for the smallest thing that works. The model chooses steps, prompts
      and wiring; the extension computes ids, handles, positions and defaults.
      Anything mechanical left to a model is a failure mode for five models.

   2. Constrain by enumeration, not description. "platform: one of flow,
      chatgpt, gemini, grok" is obeyed; "pick a suitable platform" produces
      "midjourney" often enough to matter.

   3. Show one complete example. Every model tested followed the example's
      shape more closely than the prose, so the example carries the rules that
      matter most — literal prompt text, inputs by id, no positions.

   The reply is parsed by readPlan(), which already tolerates prose around the
   JSON and ```json fences. So the closing instruction asks for JSON only, but
   nothing depends on the model obeying it exactly.
   ============================================================ */

/** Platforms a built workflow may name, and what each is actually good for. */
const PLATFORM_NOTES = [
  '- "flow"    Google Flow. Video with real motion, and start/end frames. The default for video.',
  '- "grok"    Grok Imagine. Fast stills, and short clips that can be extended.',
  '- "chatgpt" ChatGPT. Stills, and writing text for a later step.',
  '- "gemini"  Gemini. Stills, and reading an image or clip to describe it.',
].join('\n');

const EXAMPLE = `{
  "name": "Product photo to ad clip",
  "description": "Turn one product photo into a short vertical ad.",
  "steps": [
    {
      "id": "photo",
      "type": "image",
      "label": "Product photo"
    },
    {
      "id": "hero",
      "type": "generate",
      "media": "image",
      "platform": "grok",
      "label": "Hero still",
      "prompt": "The product on a clean marble surface, soft studio light, subtle glossy reflection, premium commercial look. Keep the product shape, colour and label exactly as in the reference.",
      "inputs": ["photo"],
      "aspectRatio": "9:16"
    },
    {
      "id": "clip",
      "type": "generate",
      "media": "video",
      "platform": "flow",
      "label": "Ad clip",
      "prompt": "Slow 180 degree turntable rotation around the product, soft highlight travelling across the surface, locked-off camera.",
      "inputs": ["hero"],
      "aspectRatio": "9:16",
      "duration": "6s"
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
  return `You are turning an idea into a workflow plan for AutoFlow Studio, a
node editor that drives AI image and video tools.

Reply with ONE JSON object and nothing else. No commentary before or after.

THE SHAPE

{
  "name": "short name",
  "description": "one sentence",
  "steps": [ ...step objects... ]
}

A step is one of:

  Upload slot — a picture the user will supply themselves:
  { "id": "unique_id", "type": "image", "label": "what to upload" }

  A generation:
  {
    "id": "unique_id",
    "type": "generate",
    "media": "image" | "video" | "text",
    "platform": "flow" | "chatgpt" | "gemini" | "grok",
    "label": "short name for the node",
    "prompt": "the actual prompt text, written out in full",
    "inputs": ["ids of steps that feed this one"],
    "aspectRatio": "1:1" | "9:16" | "16:9" | "2:3" | "3:2",
    "duration": "6s" | "10s"
  }

RULES

- ids are short, lowercase, and unique. Refer to steps only by id.
- "prompt" is the finished prompt, addressed to the image or video model.
  Never write instructions to the user in it — nobody reads it but the model.
- "inputs" carries pictures or clips forward. A step with media "text" writes
  a prompt instead, and whatever it feeds uses that text; a step fed by a
  "text" step must NOT also have its own "prompt".
- Only "image" steps are things the user uploads. If the idea does not need an
  upload, do not invent one.
- Do not include positions, coordinates, edges, ids of connections, handles,
  or any styling. Those are added automatically. Only the fields above.
- "duration" and "aspectRatio" are optional; include them where they matter.

PLATFORMS

${PLATFORM_NOTES}

Prefer "flow" for video unless the idea calls for a clip that will be extended,
in which case use "grok". Prefer "grok" or "chatgpt" for stills.

EXAMPLE

${EXAMPLE}

THE IDEA

${String(idea || '').trim() || '(no idea given — ask for one)'}

Now reply with the JSON object only.`;
}

/** Shown next to the box so the paste step is obvious without a manual. */
export const BUILDER_STEPS = [
  'Describe what you want to make.',
  'Copy the brief and paste it into any AI chat.',
  'Paste the reply back here.',
] as const;
