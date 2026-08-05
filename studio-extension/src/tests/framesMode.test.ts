/* ============================================================
   Start and End frames.

   Flow's video composer has two slots, not a list:

       <div aria-haspopup="dialog">Start</div>  ⇄  <div ...>End</div>

   Given both, it interpolates between them. The engine has supported this all
   along — attachFrameImages exists — but Studio pinned creationType to
   'ingredients', so the mode was unreachable from a node.

   The design question was ordering. "Paste the images one by one and it
   follows the sorting" cannot be built on edge order: that order is invisible
   on the canvas, and it changes when a connection is remade. Swap Start and
   End and the clip runs backwards, with nothing on screen to say why. So the
   node exposes two named ports and the order is a fact about which wire went
   where.
   ============================================================ */

import { NODE_PORTS, portsFor, validateTemplate } from '../studio/templates/validate';

/** The ordering rule the runner applies. */
const orderedSources = (
  inputs: Map<string, string[]>,
  creationType: string,
  mediaType: string
): string[] => {
  const isFrames = creationType === 'frames' && mediaType === 'video';
  return isFrames
    ? [...(inputs.get('frame_start') || []), ...(inputs.get('frame_end') || [])]
    : (inputs.get('image_ref') || []);
};

describe('ports', () => {
  it('gives a generate node both frame ports', () => {
    expect(NODE_PORTS.generate.in).toEqual(
      expect.arrayContaining(['frame_start', 'frame_end'])
    );
  });

  it('keeps image_ref, because Ingredients mode still uses it', () => {
    // Frames is a mode, not a replacement — most templates are ingredients.
    expect(NODE_PORTS.generate.in).toContain('image_ref');
  });

  it('does not offer frame ports on a prompt writer', () => {
    // A text answer has no first or last frame.
    expect(portsFor({ type: 'generate', data: { mediaType: 'text' } })!.in)
      .not.toContain('frame_start');
  });
});

describe('ordering', () => {
  const inputs = new Map<string, string[]>([
    ['frame_start', ['nodeA']],
    ['frame_end', ['nodeB']],
    ['image_ref', ['nodeC']],
  ]);

  it('sends Start before End', () => {
    // The entire point. Reversed, the clip plays backwards.
    expect(orderedSources(inputs, 'frames', 'video')).toEqual(['nodeA', 'nodeB']);
  });

  it('ignores the frame ports in ingredients mode', () => {
    expect(orderedSources(inputs, 'ingredients', 'video')).toEqual(['nodeC']);
  });

  it('ignores frames mode on an image node', () => {
    // There is no "between" for a still, whatever the dropdown says.
    expect(orderedSources(inputs, 'frames', 'image')).toEqual(['nodeC']);
  });

  it('does not depend on the map insertion order', () => {
    const reversed = new Map<string, string[]>([
      ['frame_end', ['nodeB']],
      ['frame_start', ['nodeA']],
    ]);
    expect(orderedSources(reversed, 'frames', 'video')).toEqual(['nodeA', 'nodeB']);
  });
});

describe('templates using frames validate', () => {
  const frameTemplate = (startHandle: string, endHandle: string) => ({
    id: 'tpl_x', name: 'X', description: 'd', useCase: 'u',
    category: 'Content', difficulty: 'Easy', nodeCount: 4, thumbnail: '🎬',
    nodes: [
      { id: 'p1', type: 'prompt', position: { x: 0, y: 0 }, data: { type: 'prompt', text: 'go' } },
      { id: 'a', type: 'image', position: { x: 0, y: 200 }, data: { type: 'image' } },
      { id: 'b', type: 'image', position: { x: 0, y: 400 }, data: { type: 'image' } },
      {
        id: 'g1', type: 'generate', position: { x: 400, y: 0 },
        data: { type: 'generate', platform: 'flow', mediaType: 'video', creationType: 'frames' },
      },
    ],
    edges: [
      { id: 'e0', source: 'p1', target: 'g1', sourceHandle: 'text', targetHandle: 'text' },
      { id: 'e1', source: 'a', target: 'g1', sourceHandle: 'image', targetHandle: startHandle },
      { id: 'e2', source: 'b', target: 'g1', sourceHandle: 'image', targetHandle: endHandle },
    ],
  });

  it('accepts a well-formed frames workflow', () => {
    expect(validateTemplate(frameTemplate('frame_start', 'frame_end'))).toEqual([]);
  });

  it('rejects a typo in a frame handle', () => {
    /* The failure this catches is silent: React Flow drops an edge whose
       handle does not exist, so the canvas looks wired and the clip
       interpolates from one end only. */
    expect(validateTemplate(frameTemplate('frame_stat', 'frame_end')).join(' '))
      .toMatch(/does not have/);
  });
});
