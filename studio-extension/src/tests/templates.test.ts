/* ============================================================
   Templates are data, and data has no compiler.

   A template with an edge pointing at a node that isn't there, or wired to a
   port that node doesn't expose, type-checks perfectly and then renders as a
   canvas with a missing connection. Nothing throws; the run just skips the
   reference and produces a subtly wrong result. These tests are the only
   thing standing between a typo in a node id and a broken template on a
   user's canvas.

   The handle map below mirrors the Handle ids declared in src/studio/nodes/.
   If a node gains or renames a port, this map has to move with it — that is
   the point: the failure shows up here rather than as a dead wire.
   ============================================================ */

import { TEMPLATES } from '../studio/templates';

/** Ports each node type actually renders, keyed by node type. */
const PORTS: Record<string, { in: string[]; out: string[] }> = {
  prompt: { in: [], out: ['text'] },
  image: { in: [], out: ['image'] },
  frame: { in: ['image_ref'], out: ['image'] },
  // A generate node's ports depend on what it makes: a prompt writer emits
  // text, everything else emits a result. Both take reference images.
  generate: { in: ['text', 'image_ref'], out: ['result'] },
  'generate:text': { in: ['text', 'image_ref'], out: ['text'] },
};

const portsFor = (node: any) => {
  const key = node.type === 'generate' && node.data?.mediaType === 'text'
    ? 'generate:text'
    : node.type;
  return PORTS[key];
};

describe.each(TEMPLATES.map((t) => [t.name, t] as const))('%s', (_name, tpl) => {
  const byId = new Map(tpl.nodes.map((n) => [n.id, n]));

  it('declares the number of nodes it actually has', () => {
    // The card shows this number before the user commits to loading it.
    expect(tpl.nodeCount).toBe(tpl.nodes.length);
  });

  it('has unique node and edge ids', () => {
    expect(byId.size).toBe(tpl.nodes.length);
    const edgeIds = new Set(tpl.edges.map((e) => e.id));
    expect(edgeIds.size).toBe(tpl.edges.length);
  });

  it('knows every node type it uses', () => {
    for (const node of tpl.nodes) {
      expect(portsFor(node)).toBeDefined();
    }
  });

  it('connects edges to nodes that exist, on ports they expose', () => {
    for (const edge of tpl.edges) {
      const source = byId.get(edge.source);
      const target = byId.get(edge.target);
      expect(`${edge.id} source ${edge.source}`).toBe(
        source ? `${edge.id} source ${edge.source}` : 'a node in this template');
      expect(`${edge.id} target ${edge.target}`).toBe(
        target ? `${edge.id} target ${edge.target}` : 'a node in this template');

      // Wrong handle = an edge React Flow drops on render. Silent, and the
      // node downstream then generates with no reference at all.
      expect({ edge: edge.id, port: edge.sourceHandle })
        .toEqual({ edge: edge.id, port: expect.stringMatching(
          new RegExp(`^(${portsFor(source).out.join('|')})$`)) });
      expect({ edge: edge.id, port: edge.targetHandle })
        .toEqual({ edge: edge.id, port: expect.stringMatching(
          new RegExp(`^(${portsFor(target).in.join('|')})$`)) });
    }
  });

  it('leaves no node stacked exactly on another', () => {
    const seen = new Set<string>();
    for (const n of tpl.nodes) {
      const at = `${n.position.x},${n.position.y}`;
      expect({ node: n.id, at, alreadyTaken: seen.has(at) })
        .toEqual({ node: n.id, at, alreadyTaken: false });
      seen.add(at);
    }
  });

  it('feeds every generate node a prompt', () => {
    // A generate node with no text input runs with an empty prompt box, which
    // fails at Flow rather than here — worth catching while it is still data.
    const hasText = new Set(
      tpl.edges.filter((e) => e.targetHandle === 'text').map((e) => e.target));
    for (const n of tpl.nodes.filter((n) => n.type === 'generate')) {
      expect({ node: n.id, hasPrompt: hasText.has(n.id) })
        .toEqual({ node: n.id, hasPrompt: true });
    }
  });

  it('gives every Last Frame node a clip to take a frame from', () => {
    for (const n of tpl.nodes.filter((n) => n.type === 'frame')) {
      const incoming = tpl.edges.filter((e) => e.target === n.id);
      // Exactly one: a frame node shows *the* last frame, and two upstream
      // clips would make which one it shows a race.
      expect({ node: n.id, upstream: incoming.length }).toEqual({ node: n.id, upstream: 1 });
      const from = byId.get(incoming[0].source);
      expect({ node: n.id, sourceType: from?.type }).toEqual({ node: n.id, sourceType: 'generate' });
      expect({ node: n.id, media: (from?.data as any)?.mediaType })
        .toEqual({ node: n.id, media: 'video' });
    }
  });
});

/* The styrofoam chain is the reason the frame node exists, so its shape is
   pinned rather than left to the generic rules above. */
describe('ASMR styrofoam carving', () => {
  const tpl = TEMPLATES.find((t) => t.id === 'tpl_styrofoam_asmr')!;

  it('exists', () => expect(tpl).toBeDefined());

  it('runs six clips joined by five visible handoff frames', () => {
    const count = (type: string) => tpl.nodes.filter((n) => n.type === type).length;
    expect({ clips: count('generate'), frames: count('frame'), refs: count('image') })
      .toEqual({ clips: 6, frames: 5, refs: 1 });
  });

  it('starts from the user photo and then from frames, never from raw clips', () => {
    const refEdges = tpl.edges.filter((e) => e.targetHandle === 'image_ref'
      && tpl.nodes.find((n) => n.id === e.target)?.type === 'generate');
    // One reference into each of the six clips.
    expect(refEdges).toHaveLength(6);
    const sourceTypes = refEdges.map(
      (e) => tpl.nodes.find((n) => n.id === e.source)!.type);
    expect(sourceTypes.filter((t) => t === 'image')).toHaveLength(1);
    expect(sourceTypes.filter((t) => t === 'frame')).toHaveLength(5);
    // No clip reaches straight into the next one — that was the invisible
    // handoff this template was rebuilt to get rid of.
    expect(sourceTypes).not.toContain('generate');
  });
});
