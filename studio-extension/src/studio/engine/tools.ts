/* ============================================================
   What the agent is allowed to do.

   Definitions are DATA — a name, a description, a parameter list — for the
   same reason presets are: MV3 permits fetching config, not logic, so a tool
   list that is pure JSON can be published without a store review, and one
   carrying behaviour cannot.

   The implementations live in the runner, which is the only place with a
   canvas and a bridge to act on.

   ── Which tools are worth having ──

   Tested against live ChatGPT: asked to produce an image, it produced the
   image itself rather than emitting a tool call, four times in a row and more
   insistently the harder it was told not to. A chat model will not delegate
   what it can already do.

   So the ordering here is deliberate. read_canvas is first because it is the
   one thing the model provably cannot fake: it has never seen the canvas, and
   no amount of confidence will tell it what is on there. Tools like that are
   what make the loop work; generate_image is kept because the workflow needs
   it, not because the model reaches for it willingly.
   ============================================================ */

import type { AgentTool } from './agent';

/** Reads the canvas. Cannot be answered from the model's own knowledge. */
export const TOOL_READ_CANVAS: AgentTool = {
  name: 'read_canvas',
  description:
    'List the nodes currently on the Studio canvas, with their ids, types and labels. '
    + 'Use this first: you cannot see the canvas any other way.',
  params: [],
};

/** Renders one image on Flow through the ordinary generation path. */
export const TOOL_GENERATE_IMAGE: AgentTool = {
  name: 'generate_image',
  description:
    'Render ONE image on Google Flow and return whether it succeeded. '
    + 'You cannot render images yourself — this is the only way one can exist.',
  params: [
    { name: 'prompt', description: 'The full image prompt to render. Be specific.' },
  ],
};

/**
 * Watch a clip a node produced.
 *
 * The check that costs real time today: did the product survive the shot, did
 * the match cut land, did the camera do what the prompt asked. A still cannot
 * answer any of those, and reading a description of a clip answers none of
 * them honestly.
 *
 * Gemini is the platform to point this at — it reads video, and ChatGPT does
 * not. The node's Platform dropdown is where that choice lives.
 */
export const TOOL_INSPECT_CLIP: AgentTool = {
  name: 'inspect_clip',
  description:
    'Watch a video that a node on this canvas already produced. The clip is '
    + 'attached to the reply so you can judge it. Use read_canvas first to find '
    + 'the node id. Requires a platform that can read video, such as Gemini.',
  params: [
    { name: 'node', description: 'The id of the node whose clip to watch.' },
  ],
};

/* ── Acting on the workflow ───────────────────────────────────
   The three above only look. These three are what make an agent worth
   having: read why a node went wrong, rewrite its prompt, run it again.
   That loop is the one a fixed canvas cannot do — today it is done by hand,
   node by node, watching each render come back.
   ──────────────────────────────────────────────────────────── */

export const TOOL_READ_NODE: AgentTool = {
  name: 'read_node',
  description:
    'Read one node in detail: its settings, its status, the error it failed '
    + 'with, and the prompt it uses. Use read_canvas first to get the id.',
  params: [{ name: 'node', description: 'The id of the node to read.' }],
};

export const TOOL_SET_PROMPT: AgentTool = {
  name: 'set_prompt',
  description:
    'Replace the prompt a node uses. Give the FULL new prompt, not a patch — '
    + 'it overwrites the old one. Read the node first so you know what you are '
    + 'replacing. This only changes the text; the node does not run until you '
    + 'ask it to.',
  params: [
    { name: 'node', description: 'The id of the node whose prompt to change.' },
    { name: 'text', description: 'The complete new prompt.' },
  ],
};

export const TOOL_RERUN_NODE: AgentTool = {
  name: 'rerun_node',
  description:
    'Run one node again, using whatever prompt it has now. Costs a real '
    + 'generation and takes minutes. The result is attached to the reply so '
    + 'you can judge whether the fix worked.',
  params: [{ name: 'node', description: 'The id of the node to run again.' }],
};

export const AGENT_TOOLS: AgentTool[] = [
  TOOL_READ_CANVAS,
  TOOL_READ_NODE,
  TOOL_SET_PROMPT,
  TOOL_RERUN_NODE,
  TOOL_GENERATE_IMAGE,
  TOOL_INSPECT_CLIP,
];

/** Look up the definitions a node has switched on, in registry order. */
export function toolsByName(names: string[] | undefined): AgentTool[] {
  if (!names?.length) return [TOOL_READ_CANVAS];
  return AGENT_TOOLS.filter((t) => names.includes(t.name));
}
