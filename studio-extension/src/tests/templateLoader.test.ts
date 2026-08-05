/**
 * @jest-environment jsdom
 */

/* ============================================================
   Cloud template delivery.

   Two properties matter more than anything else here, and they pull against
   each other:

   - The gallery must never be empty or slow because of the network. Cache
     first, bundle as the floor, refresh in the background.
   - A bad payload must not reach a canvas. Store review was slow, but it was
     review; this pipeline has none, and a bad publish reaches every user in
     seconds.
   ============================================================ */

import { validateTemplate, capabilityGap, compareVersions } from '../studio/templates/validate';
import { BUILTIN_TEMPLATES } from '../studio/templates';

/* ── A minimal, valid template to mutate per test ── */
const good = () => ({
  id: 'tpl_test',
  name: 'Test',
  description: 'd',
  useCase: 'u',
  category: 'Content',
  difficulty: 'Easy',
  nodeCount: 2,
  thumbnail: '🧪',
  nodes: [
    { id: 'p1', type: 'prompt', position: { x: 0, y: 0 }, data: { type: 'prompt', text: 'go' } },
    {
      id: 'g1', type: 'generate', position: { x: 400, y: 0 },
      data: { type: 'generate', platform: 'flow', mediaType: 'video' },
    },
  ],
  edges: [
    { id: 'e1', source: 'p1', target: 'g1', sourceHandle: 'text', targetHandle: 'text' },
  ],
});

describe('validateTemplate', () => {
  it('passes a well-formed template', () => {
    expect(validateTemplate(good())).toEqual([]);
  });

  it('passes every template compiled into this build', () => {
    // The bundled set is the floor the loader falls back to; if it were
    // invalid there would be nothing to fall back to.
    for (const tpl of BUILTIN_TEMPLATES) {
      expect({ id: tpl.id, problems: validateTemplate(tpl) })
        .toEqual({ id: tpl.id, problems: [] });
    }
  });

  it('catches an edge pointing at a node that is not there', () => {
    const t = good();
    t.edges[0].source = 'ghost';
    expect(validateTemplate(t).join(' ')).toMatch(/not in this template/);
  });

  it('catches an edge on a port the node does not expose', () => {
    // `image` vs `result` — React Flow drops the edge and the node downstream
    // generates with no reference, with nothing on screen to say so.
    const t = good();
    t.edges[0].sourceHandle = 'image';
    expect(validateTemplate(t).join(' ')).toMatch(/does not have/);
  });

  it('catches a generate node with no prompt', () => {
    const t = good();
    t.edges = [];
    expect(validateTemplate(t).join(' ')).toMatch(/no prompt connected/);
  });

  it('catches a declared node count that is a lie', () => {
    const t = good();
    t.nodeCount = 99;
    expect(validateTemplate(t).join(' ')).toMatch(/declares 99/);
  });

  it('catches two nodes stacked on the same point', () => {
    const t = good();
    t.nodes[1].position = { x: 0, y: 0 };
    expect(validateTemplate(t).join(' ')).toMatch(/stacked exactly/);
  });

  it('catches a prompt written at the user rather than the model', () => {
    const t = good();
    t.nodes[0].data.text = 'A fox cub.\n↑ Change this line to any animal.';
    expect(validateTemplate(t).join(' ')).toMatch(/aimed at the user/);
  });

  it('catches a frame node fed by something that makes no video', () => {
    const t: any = good();
    t.nodes.push({ id: 'f1', type: 'frame', position: { x: 800, y: 0 }, data: { type: 'frame' } });
    t.nodes[1].data.mediaType = 'image';
    t.edges.push({ id: 'e2', source: 'g1', target: 'f1', sourceHandle: 'result', targetHandle: 'image_ref' });
    t.nodeCount = 3;
    expect(validateTemplate(t).join(' ')).toMatch(/produces no video/);
  });

  it('reports every problem at once, not just the first', () => {
    const t: any = good();
    t.edges[0].source = 'ghost';
    t.nodeCount = 99;
    expect(validateTemplate(t).length).toBeGreaterThan(1);
  });
});

describe('capabilityGap', () => {
  const build = (version: string, nodeTypes?: string[], platforms?: string[]) =>
    ({ version, nodeTypes, platforms });

  it('lets through what the build can draw', () => {
    expect(capabilityGap(good(), build('0.8.0'))).toBeNull();
  });

  it('hides a template needing a node type this build lacks', () => {
    /* The live case: Last Frame nodes shipped in 0.6.0. A 0.5.2 build meeting
       a frame template must hide it, not render a node it cannot draw. */
    const t: any = good();
    t.nodes.push({ id: 'f1', type: 'frame', position: { x: 800, y: 0 }, data: {} });
    const old = build('0.5.2', ['prompt', 'image', 'generate']);
    expect(capabilityGap(t, old)).toMatch(/"frame" node/);
  });

  it('hides it on the declaration alone, before the nodes are inspected', () => {
    // A template can say what it needs even if this build has never heard of
    // the type — which is the whole point of shipping the requirement.
    const t: any = { ...good(), requiresNodeTypes: ['sequencer'] };
    expect(capabilityGap(t, build('0.8.0'))).toMatch(/sequencer/);
  });

  it('hides a template needing a platform this build has no adapter for', () => {
    const t: any = good();
    t.nodes[1].data.platform = 'gemini';
    expect(capabilityGap(t, build('0.7.8', undefined, ['flow', 'chatgpt']))).toMatch(/gemini/);
  });

  it('respects a version floor for things node types cannot express', () => {
    const t: any = { ...good(), minExtensionVersion: '0.9.0' };
    expect(capabilityGap(t, build('0.8.0'))).toMatch(/0\.9\.0 or newer/);
    expect(capabilityGap(t, build('0.9.0'))).toBeNull();
  });
});

describe('compareVersions', () => {
  it('compares by segment, not as text', () => {
    // "0.10.0" < "0.9.0" as strings, which would hide every template from
    // every build past 0.9.
    expect(compareVersions('0.10.0', '0.9.0')).toBe(1);
    expect(compareVersions('0.6.0', '0.6.0')).toBe(0);
    expect(compareVersions('0.5.2', '0.6.0')).toBe(-1);
    expect(compareVersions('1.0.0', '0.99.99')).toBe(1);
  });

  it('treats missing segments as zero', () => {
    expect(compareVersions('1.0', '1.0.0')).toBe(0);
    expect(compareVersions('1.0.1', '1.0')).toBe(1);
  });
});
