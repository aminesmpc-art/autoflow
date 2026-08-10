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

export const AGENT_TOOLS: AgentTool[] = [TOOL_READ_CANVAS, TOOL_GENERATE_IMAGE];

/** Look up the definitions a node has switched on, in registry order. */
export function toolsByName(names: string[] | undefined): AgentTool[] {
  if (!names?.length) return [TOOL_READ_CANVAS];
  return AGENT_TOOLS.filter((t) => names.includes(t.name));
}
