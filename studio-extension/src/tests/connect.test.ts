/**
 * Which wires the canvas allows.
 *
 * There was no validation at all. Any port could be dragged to any other
 * port, React Flow drew the edge, and nothing said a word — the run failed
 * later with a message about a missing input, pointing at a node that looked
 * correctly connected because there was a line going into it.
 *
 * Wires are the part of this canvas people find hardest. Letting someone draw
 * an impossible one is the least helpful moment to stay quiet.
 */

import { connectionProblem, canConnect, nodeAcceptsDrag } from '../studio/canvas/connect';
import { BUILTIN_TEMPLATES } from '../studio/templates/index';

const wire = (sourceHandle: string, targetHandle: string) =>
  connectionProblem({ source: 'a', target: 'b', sourceHandle, targetHandle });

describe('wires that should work', () => {
  it.each([
    ['a prompt into a prompt input', 'text', 'text'],
    ['an image into a reference slot', 'image', 'image_ref'],
    ['an image into a start frame', 'image', 'frame_start'],
    ['an image into an end frame', 'image', 'frame_end'],
    ['a generated result into a reference slot', 'result', 'image_ref'],
    ['a generated result into a start frame', 'result', 'frame_start'],
  ])('allows %s', (_label, from, to) => {
    expect(wire(from, to)).toBeNull();
  });

  it('allows every wire the shipped templates draw', () => {
    /* The strongest form of the rule. If a template the extension ships
       cannot be drawn on its own canvas, the validator is wrong, not the
       template. */
    const refused: string[] = [];
    for (const t of BUILTIN_TEMPLATES as any[]) {
      for (const e of t.edges) {
        const p = connectionProblem({
          source: e.source, target: e.target,
          sourceHandle: e.sourceHandle, targetHandle: e.targetHandle,
        });
        if (p) refused.push(`${t.id}: ${e.source} -> ${e.target} (${e.sourceHandle} -> ${e.targetHandle}): ${p}`);
      }
    }
    expect(refused).toEqual([]);
  });
});

describe('wires that cannot work', () => {
  it('refuses a picture into the prompt input', () => {
    const p = wire('result', 'text');
    expect(p).toContain('sends a picture');
    expect(p).toContain('takes a written prompt');
  });

  it('refuses a prompt into a reference slot', () => {
    expect(wire('text', 'image_ref')).toContain('takes a picture');
  });

  it('refuses a node feeding itself', () => {
    expect(connectionProblem({ source: 'a', target: 'a', sourceHandle: 'text', targetHandle: 'text' }))
      .toContain('cannot feed itself');
  });

  it('refuses a wire with nothing on one end', () => {
    expect(connectionProblem({ source: null, target: 'b' })).toContain('no node on one end');
  });

  it('explains itself in words someone can act on', () => {
    /* "Invalid connection" tells a person nothing. The refusal has to say
       what that port sends and what this one takes. */
    const p = wire('text', 'frame_start') as string;
    expect(p).toMatch(/sends a written prompt/);
    expect(p).toMatch(/start frame/);
    expect(p).not.toMatch(/invalid|error|failed/i);
  });
});

describe('an unknown port', () => {
  it('is allowed through rather than blocking work', () => {
    /* A port this file has not heard of is a bug in a node, not in the
       user's wiring, and they cannot fix it by dragging differently. */
    expect(wire('something_new', 'text')).toBeNull();
    expect(wire('text', 'something_new')).toBeNull();
  });
});

describe('dimming nodes while a wire is being dragged', () => {
  it('keeps nodes that could take it', () => {
    expect(nodeAcceptsDrag('b', ['text'], { source: 'a', sourceHandle: 'text' })).toBe(true);
    expect(nodeAcceptsDrag('b', ['image_ref', 'text'], { source: 'a', sourceHandle: 'result' })).toBe(true);
  });

  it('dims nodes that could not', () => {
    expect(nodeAcceptsDrag('b', ['text'], { source: 'a', sourceHandle: 'result' })).toBe(false);
    expect(nodeAcceptsDrag('b', ['image_ref'], { source: 'a', sourceHandle: 'text' })).toBe(false);
  });

  it('dims the node the wire started from', () => {
    expect(nodeAcceptsDrag('a', ['text'], { source: 'a', sourceHandle: 'text' })).toBe(false);
  });

  it('dims nothing when no wire is being dragged', () => {
    expect(nodeAcceptsDrag('b', ['text'], null)).toBe(true);
  });
});

describe('canConnect', () => {
  it('is the boolean React Flow asks for', () => {
    expect(canConnect({ source: 'a', target: 'b', sourceHandle: 'text', targetHandle: 'text' })).toBe(true);
    expect(canConnect({ source: 'a', target: 'b', sourceHandle: 'result', targetHandle: 'text' })).toBe(false);
  });
});
