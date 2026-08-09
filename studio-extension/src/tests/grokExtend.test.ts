/* ============================================================
   Grok's extend arithmetic.

   Imagine starts a clip at 6, 10 or 15 seconds, extends by 6 or 10, and will
   not complete anything past 30. Those three facts do not compose into "offer
   both steps twice": 15 + 10 + 10 is 35, and Imagine refuses the third — after
   the two before it have already been spent.

   So the rule is arithmetic rather than a constant, and it lives in one place
   because the node, the validator and the runner each ask the same question.
   ============================================================ */

import {
  extendChain, affordableExtendSteps, secondsOf, validateTemplate,
  GROK_MAX_TOTAL_SECONDS, GROK_MAX_EXTENDS, NODE_PORTS,
} from '../studio/templates/validate';

const clip = (id: string, duration: string) => ({
  id, type: 'generate', position: { x: 0, y: 0 },
  data: { type: 'generate', platform: 'grok', mediaType: 'video', duration },
});
const ext = (id: string, seconds = '+10s') => ({
  id, type: 'extend', position: { x: 0, y: 0 },
  data: { type: 'extend', extendSeconds: seconds },
});
const wire = (from: string, to: string) => ({
  id: `e_${from}_${to}`, source: from, target: to, sourceHandle: 'result', targetHandle: 'video',
});

describe('the ports', () => {
  it('takes a clip, not a still', () => {
    /* image_ref would accept a picture, and there is nothing to continue in
       one. Naming the port `video` is what makes the wrong wire impossible to
       draw rather than merely wrong. */
    expect(NODE_PORTS.extend.in).toContain('video');
    expect(NODE_PORTS.extend.in).not.toContain('image_ref');
  });

  it('emits a result, so a second extend can follow', () => {
    expect(NODE_PORTS.extend.out).toEqual(['result']);
  });

  it('takes its own prompt', () => {
    // Each extend says what happens next; that is the point of the node.
    expect(NODE_PORTS.extend.in).toContain('text');
  });
});

describe('what still fits', () => {
  it('offers both steps on a short clip', () => {
    expect(affordableExtendSteps(10)).toEqual(['+6s', '+10s']);
  });

  it('drops +10s when it would pass the cap', () => {
    // 22 + 6 = 28 fits; 22 + 10 = 32 does not. The reason this is computed
    // rather than listed.
    expect(affordableExtendSteps(22)).toEqual(['+6s']);
  });

  it('offers nothing after 15s + 10s', () => {
    /* A reachable dead end, and the one worth naming: 25 + 6 is already 31,
       so a clip extended that way cannot be extended again at all. The node
       shows both steps disabled rather than pretending there is a choice. */
    expect(affordableExtendSteps(25)).toEqual([]);
  });

  it('offers nothing on a clip that is already full', () => {
    expect(affordableExtendSteps(GROK_MAX_TOTAL_SECONDS)).toEqual([]);
  });

  it('allows a step that lands exactly on the cap', () => {
    // 20 + 10 = 30 is legal; an off-by-one here silently removes a real option.
    expect(affordableExtendSteps(20)).toContain('+10s');
  });

  it('reads seconds out of every shape the canvas holds', () => {
    expect([secondsOf('10s'), secondsOf('+6s'), secondsOf(15), secondsOf(undefined)])
      .toEqual([10, 6, 15, 0]);
  });
});

describe('walking the chain', () => {
  it('finds the clip a single extend continues', () => {
    const nodes = [clip('g1', '10s'), ext('e1')];
    const chain = extendChain('e1', nodes, [wire('g1', 'e1')]);
    expect(chain).toMatchObject({ secondsBefore: 10, index: 1, rootId: 'g1', problem: null });
  });

  it('adds the extend before it', () => {
    const nodes = [clip('g1', '10s'), ext('e1', '+6s'), ext('e2')];
    const chain = extendChain('e2', nodes, [wire('g1', 'e1'), wire('e1', 'e2')]);
    expect(chain.secondsBefore).toBe(16);
    expect(chain.index).toBe(2);
  });

  it('refuses a third extend', () => {
    /* Not a style rule: from any starting length a third extend passes 30, so
       it is a generation Imagine will not complete. */
    const nodes = [clip('g1', '6s'), ext('e1', '+6s'), ext('e2', '+6s'), ext('e3', '+6s')];
    const edges = [wire('g1', 'e1'), wire('e1', 'e2'), wire('e2', 'e3')];
    expect(extendChain('e3', nodes, edges).problem)
      .toMatch(new RegExp(`${GROK_MAX_EXTENDS} extends`));
  });

  it('refuses to continue a Flow clip', () => {
    const flow = {
      id: 'f1', type: 'generate', position: { x: 0, y: 0 },
      data: { type: 'generate', platform: 'flow', mediaType: 'video', duration: '8s' },
    };
    expect(extendChain('e1', [flow, ext('e1')], [wire('f1', 'e1')]).problem)
      .toMatch(/only continues a Grok video/i);
  });

  it('refuses to continue a Grok image', () => {
    // There is no clip to lengthen, whatever the wire suggests.
    const still = {
      id: 'g1', type: 'generate', position: { x: 0, y: 0 },
      data: { type: 'generate', platform: 'grok', mediaType: 'image' },
    };
    expect(extendChain('e1', [still, ext('e1')], [wire('g1', 'e1')]).problem)
      .toMatch(/only continues a Grok video/i);
  });

  it('says so when nothing is connected', () => {
    expect(extendChain('e1', [ext('e1')], []).problem).toMatch(/nothing to extend/i);
  });

  it('does not hang on a loop', () => {
    const nodes = [ext('e1'), ext('e2')];
    const edges = [wire('e2', 'e1'), wire('e1', 'e2')];
    expect(extendChain('e1', nodes, edges).problem).toBeTruthy();
  });
});

describe('templates using extend', () => {
  const base = () => ({
    id: 'tpl_x', name: 'X', description: 'd', useCase: 'u',
    category: 'Content', difficulty: 'Easy', nodeCount: 4, thumbnail: '🎬',
    nodes: [
      { id: 'p1', type: 'prompt', position: { x: 0, y: 0 }, data: { type: 'prompt', text: 'go' } },
      { id: 'p2', type: 'prompt', position: { x: 0, y: 200 }, data: { type: 'prompt', text: 'then' } },
      { ...clip('g1', '10s'), position: { x: 400, y: 0 } },
      { ...ext('e1', '+10s'), position: { x: 800, y: 0 } },
    ] as any[],
    edges: [
      { id: 'x0', source: 'p1', target: 'g1', sourceHandle: 'text', targetHandle: 'text' },
      { id: 'x1', source: 'p2', target: 'e1', sourceHandle: 'text', targetHandle: 'text' },
      wire('g1', 'e1'),
    ] as any[],
  });

  it('accepts a chain that fits', () => {
    // 10 + 10 = 20.
    expect(validateTemplate(base())).toEqual([]);
  });

  it('rejects one that passes the cap', () => {
    /* 15 + 10 + 10 = 35. Caught at publish rather than three minutes into
       someone's run, having already spent the two generations before it. */
    const over = base();
    over.nodes[2] = { ...clip('g1', '15s'), position: { x: 400, y: 0 } };
    over.nodes.push({ ...ext('e2', '+10s'), position: { x: 1200, y: 0 } });
    over.nodes.push({ id: 'p3', type: 'prompt', position: { x: 0, y: 400 }, data: { type: 'prompt', text: 'and' } });
    over.edges.push(wire('e1', 'e2'));
    over.edges.push({ id: 'x9', source: 'p3', target: 'e2', sourceHandle: 'text', targetHandle: 'text' });
    over.nodeCount = 6;
    expect(validateTemplate(over).join(' ')).toMatch(/past Grok/);
  });
});
