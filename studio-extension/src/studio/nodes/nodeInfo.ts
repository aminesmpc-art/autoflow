/* ============================================================
   Node Documentation — what each node is, in its own words.

   A single source of truth so documentation never drifts from the
   node it describes. Every node renders a ⓘ badge that shows its
   entry on hover. Ports are keyed by handle ID, which is also what
   the validator checks edges against, so the name in the tooltip
   and the name the wiring uses are the same string.
   ============================================================ */

export interface PortDoc {
  /** Handle ID — matches the React Flow `id` on the Handle. */
  id: string;
  /** Short label shown in the tooltip. */
  label: string;
}

export interface NodeDoc {
  /** Human-readable node name. */
  title: string;
  /** One or two sentences: what this node does. */
  description: string;
  /** Input ports, in top-to-bottom order on the node. */
  inputs: PortDoc[];
  /** Output ports. */
  outputs: PortDoc[];
  /** A practical "when to use this" hint. */
  tip: string;
}

export const NODE_DOCS: Record<string, NodeDoc> = {

  prompt: {
    title: 'Prompt',
    description:
      'A text block that feeds into Generate or Ask AI nodes. ' +
      'Write your character description, scene direction, or any instruction here.',
    inputs: [],
    outputs: [
      { id: 'text', label: 'T — Your text, sent to whatever it connects to' },
    ],
    tip:
      'Be specific — the more detail you write, the more consistent ' +
      'your character stays across shots.',
  },

  image: {
    title: 'Reference Image',
    description:
      'Upload a photo or artwork to use as a visual ingredient. ' +
      'Generate nodes will reference this when creating their output.',
    inputs: [],
    outputs: [
      { id: 'image', label: '🖼 — The uploaded image, used as a reference' },
    ],
    tip:
      'Name your image (e.g., "Hero Character") — Flow uses the name ' +
      'when registering the ingredient.',
  },

  generate: {
    title: 'Generate',
    description:
      'Creates an image or video using Google Flow, ChatGPT, Gemini, or Grok. ' +
      'The platform, model, and output type are all configurable in the settings strip.',
    inputs: [
      { id: 'text', label: 'T — The prompt describing what to generate' },
      { id: 'image_ref', label: '🖼 — A reference image (Ingredients mode)' },
      { id: 'frame_start', label: 'S — Start frame (Frames mode, Flow only)' },
      { id: 'frame_end', label: 'E — End frame (Frames mode, Flow only)' },
    ],
    outputs: [
      { id: 'result', label: '→ — The generated image or video clip' },
      { id: 'text', label: 'T — Written answer (Text mode only)' },
    ],
    tip:
      'Flow and Grok make video; ChatGPT and Gemini draw images or write prompts. ' +
      'Switch platforms in the settings to change what this node does.',
  },

  frame: {
    title: 'Last Frame',
    description:
      'Captures the final frame of a finished video clip and passes it on as a still image. ' +
      'Use this to chain clips — the ending of one becomes the starting reference for the next.',
    inputs: [
      { id: 'image_ref', label: '🎬 — A completed video clip' },
    ],
    outputs: [
      { id: 'image', label: '🖼 — The last frame, as a still image' },
    ],
    tip:
      'Wire a Generate node\'s output into this, then wire this ' +
      'into the next Generate\'s image input for seamless clip chaining.',
  },

  extend: {
    title: 'Extend',
    description:
      'Adds more time to a Grok Imagine clip — a second generation that continues ' +
      'where the first one left off. Nothing may exceed 30 seconds total.',
    inputs: [
      { id: 'text', label: 'T — What happens in the extension' },
      { id: 'video', label: '▶ — The clip to extend' },
    ],
    outputs: [
      { id: 'result', label: '→ — The longer clip' },
    ],
    tip:
      'The node shows the running total so you don\'t hit Grok\'s ' +
      '30-second cap mid-run. Choose +6s or +10s per step.',
  },

  agent: {
    title: 'Agent',
    description:
      'An AI that can act — it reads the canvas, calls tools, and loops ' +
      'until it has an answer. Think of it as Ask AI with a to-do list.',
    inputs: [
      { id: 'text', label: 'T — The goal: what you want it to figure out' },
    ],
    outputs: [
      { id: 'text', label: 'T — Its final answer, fed to the next node' },
    ],
    tip:
      'Each step costs a real generation. Start with Max Steps = 4 ' +
      'and raise it only if the task needs more thinking.',
  },

  story: {
    title: 'Director',
    description:
      'One director for the whole workflow — writes all prompts in a single pass ' +
      'so they match each other. Wire it to every Generate node and it sees ' +
      'their settings automatically.',
    inputs: [
      { id: 'text', label: 'T — Your idea or brief (optional)' },
    ],
    outputs: [
      { id: 'text', label: 'T — A tailored prompt for each connected node' },
    ],
    tip:
      'Leave the cast, world, and style empty on the first run — the AI fills ' +
      'them in, and you correct one word for every run after.',
  },

};

/** Look up docs for a node type, with a safe fallback. */
export function getNodeDoc(type: string): NodeDoc | null {
  return NODE_DOCS[type] || null;
}
