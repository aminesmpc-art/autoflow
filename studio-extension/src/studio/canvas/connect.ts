/**
 * Which wires are allowed, and why a refused one was refused.
 *
 * The canvas had no validation at all. Any port could be dragged to any other
 * port, React Flow drew the edge, and nothing said a word — the run failed
 * later with a message about a missing input, pointing at a node that looked
 * correctly connected because there was a line going into it.
 *
 * Wires are the part of this canvas people find hardest, and letting someone
 * draw an impossible one is the least helpful moment to stay quiet. So the
 * rules live here, as a pure function, next to the reason each refusal
 * happens — the reason is the useful half.
 *
 * Two kinds of thing travel a wire:
 *
 *   TEXT     a written prompt. Leaves a Prompt, a Story, or a generate node
 *            in text mode. Only ever lands on a `text` input.
 *   PICTURE  a still. Leaves an Image node, a Last Frame node, or any node
 *            that produced media. Lands on a reference or a frame slot.
 *
 * A clip is the exception that proves it: `video` takes a whole generation,
 * not a still of one, which is why Extend refuses anything else.
 */

/** What a source port emits. */
const EMITS: Record<string, 'text' | 'picture' | 'video'> = {
  text: 'text',
  image: 'picture',
  // A generate node's result is whatever it made; treated as a picture
  // because that is what every downstream reference slot wants from it.
  result: 'picture',
  video: 'video',
};

/** What a target port accepts. */
const ACCEPTS: Record<string, Array<'text' | 'picture' | 'video'>> = {
  text: ['text'],
  image_ref: ['picture'],
  frame_start: ['picture'],
  frame_end: ['picture'],
  // Extend continues an actual clip. A still of one is not the same thing,
  // and accepting it produced a brand-new clip that looked like a success.
  video: ['video', 'picture'],
};

const HUMAN: Record<string, string> = {
  text: 'a written prompt',
  picture: 'a picture',
  video: 'a clip',
};

const PORT_NAME: Record<string, string> = {
  text: 'the prompt input',
  image_ref: 'the reference input',
  frame_start: 'the start frame',
  frame_end: 'the end frame',
  video: 'the clip input',
};

export interface ConnectionAttempt {
  source: string | null;
  target: string | null;
  sourceHandle?: string | null;
  targetHandle?: string | null;
}

/**
 * Why this wire cannot exist, or null when it can.
 *
 * Written for the person drawing it, not for a log. "That port sends a
 * picture, and the prompt input only takes writing" tells someone what to do
 * next; "invalid connection" does not.
 */
export function connectionProblem(c: ConnectionAttempt): string | null {
  if (!c.source || !c.target) return 'That wire has no node on one end.';
  if (c.source === c.target) return 'A node cannot feed itself.';

  const from = EMITS[c.sourceHandle || 'result'];
  const to = ACCEPTS[c.targetHandle || 'text'];

  // An unknown port is a bug in the node, not in the user's wiring — let it
  // through rather than blocking work over something they cannot fix.
  if (!from || !to) return null;

  if (!to.includes(from)) {
    return `That port sends ${HUMAN[from]}, and ${PORT_NAME[c.targetHandle || 'text']} `
      + `takes ${to.map((k) => HUMAN[k]).join(' or ')}.`;
  }
  return null;
}

/** True when the wire is allowed. React Flow wants a boolean. */
export const canConnect = (c: ConnectionAttempt): boolean => connectionProblem(c) === null;

/**
 * Whether a node could accept the wire currently being dragged.
 *
 * Used to dim the nodes that cannot, so the answer to "what does this connect
 * to" is visible while the question is being asked rather than after.
 */
export function nodeAcceptsDrag(
  nodeId: string,
  ports: string[],
  drag: { source: string | null; sourceHandle: string | null } | null,
): boolean {
  if (!drag || !drag.source) return true;
  if (drag.source === nodeId) return false;
  return ports.some((p) => canConnect({
    source: drag.source,
    target: nodeId,
    sourceHandle: drag.sourceHandle,
    targetHandle: p,
  }));
}
