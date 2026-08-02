/* Structural validation of the built-in templates.

   Inspects the real exported objects — a template with a dangling edge or an
   invalid model looks fine until someone loads it and hits Run.
*/
import { TEMPLATES, CATEGORIES } from '../studio/templates';
import { AVAILABLE_MODELS, AVAILABLE_IMAGE_MODELS } from '../types';

const IMAGE_RATIOS = ['9:16', '16:9', '1:1', '4:3', '3:4'];
const VIDEO_RATIOS = ['9:16', '16:9', '1:1'];
const DURATIONS = ['4s', '6s', '8s', '10s'];

describe('templates', () => {
  it('ships some', () => {
    expect(TEMPLATES.length).toBeGreaterThan(10);
  });

  it('has unique ids', () => {
    const ids = TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  describe.each(TEMPLATES.map((t) => [t.name, t] as const))('%s', (_name, tpl) => {
    it('declares the node count it actually has', () => {
      expect(tpl.nodeCount).toBe(tpl.nodes.length);
    });

    it('uses a known category', () => {
      expect(CATEGORIES).toContain(tpl.category as any);
    });

    it('has unique node and edge ids', () => {
      const nodeIds = tpl.nodes.map((n) => n.id);
      expect(new Set(nodeIds).size).toBe(nodeIds.length);
      const edgeIds = tpl.edges.map((e) => e.id);
      expect(new Set(edgeIds).size).toBe(edgeIds.length);
    });

    it('has no dangling edges', () => {
      const ids = new Set(tpl.nodes.map((n) => n.id));
      const bad = tpl.edges.filter((e) => !ids.has(e.source) || !ids.has(e.target));
      expect(bad.map((e) => e.id)).toEqual([]);
    });

    it('feeds every generate node a prompt', () => {
      const fed = new Set(tpl.edges.filter((e) => e.targetHandle === 'text').map((e) => e.target));
      const starved = tpl.nodes
        .filter((n) => (n.data as any).type === 'generate' && !fed.has(n.id))
        .map((n) => n.id);
      expect(starved).toEqual([]);
    });

    it('has no empty prompt nodes', () => {
      const empty = tpl.nodes
        .filter((n) => (n.data as any).type === 'prompt' && !String((n.data as any).text || '').trim())
        .map((n) => n.id);
      expect(empty).toEqual([]);
    });

    it('uses valid generate settings', () => {
      for (const n of tpl.nodes) {
        const d = n.data as any;
        if (d.type !== 'generate') continue;
        const isVideo = d.mediaType === 'video';
        expect(isVideo ? AVAILABLE_MODELS : AVAILABLE_IMAGE_MODELS).toContain(d.model);
        expect(isVideo ? VIDEO_RATIOS : IMAGE_RATIOS).toContain(d.aspectRatio);
        if (isVideo) expect(DURATIONS).toContain(d.duration);
        expect(['flow', 'chatgpt']).toContain(d.platform);
      }
    });

    it('uses valid edge handle pairs', () => {
      for (const e of tpl.edges) {
        const pair = `${e.sourceHandle}->${e.targetHandle}`;
        expect(['text->text', 'result->image_ref', 'image->image_ref']).toContain(pair);
      }
    });

    it('does not stack two nodes in the same spot', () => {
      const spots = tpl.nodes.map((n) => `${n.position.x},${n.position.y}`);
      expect(new Set(spots).size).toBe(spots.length);
    });

    it('sources image_ref edges from the right handle for the node type', () => {
      const typeOf = new Map(tpl.nodes.map((n) => [n.id, (n.data as any).type]));
      for (const e of tpl.edges) {
        if (e.targetHandle !== 'image_ref') continue;
        // Image nodes expose 'image'; generate results expose 'result'.
        const expected = typeOf.get(e.source) === 'image' ? 'image' : 'result';
        expect(e.sourceHandle).toBe(expected);
      }
    });
  });
});

describe('ASMR styrofoam carving chain', () => {
  const tpl = TEMPLATES.find((t) => t.id === 'tpl_styrofoam_asmr')!;

  it('exists', () => {
    expect(tpl).toBeDefined();
  });

  it('is six video clips driven by one reference image', () => {
    const gens = tpl.nodes.filter((n) => (n.data as any).type === 'generate');
    expect(gens).toHaveLength(6);
    expect(gens.every((g) => (g.data as any).mediaType === 'video')).toBe(true);
    expect(tpl.nodes.filter((n) => (n.data as any).type === 'image')).toHaveLength(1);
  });

  it('runs 10-second vertical clips', () => {
    for (const g of tpl.nodes.filter((n) => (n.data as any).type === 'generate')) {
      expect((g.data as any).duration).toBe('10s');
      expect((g.data as any).aspectRatio).toBe('9:16');
      expect((g.data as any).model).toBe('Omni Flash');
    }
  });

  it('chains each clip into the next, in order', () => {
    const order = ['cut', 'bond', 'outline', 'rough', 'detail', 'reveal'];
    // First clip starts from the user's photo.
    expect(tpl.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'i1', target: 'g_cut', targetHandle: 'image_ref' }),
    ]));
    // Every later clip starts from the previous clip's result.
    for (let i = 1; i < order.length; i++) {
      expect(tpl.edges).toEqual(expect.arrayContaining([
        expect.objectContaining({
          source: `g_${order[i - 1]}`,
          target: `g_${order[i]}`,
          sourceHandle: 'result',
          targetHandle: 'image_ref',
        }),
      ]));
    }
  });

  it('gives every clip exactly one reference input', () => {
    const refCount = new Map<string, number>();
    for (const e of tpl.edges) {
      if (e.targetHandle !== 'image_ref') continue;
      refCount.set(e.target, (refCount.get(e.target) || 0) + 1);
    }
    expect([...refCount.values()]).toEqual([1, 1, 1, 1, 1, 1]);
  });

  it('is a single line, not a fan-out', () => {
    // Each clip result feeds at most one downstream clip, or the "sequence"
    // would branch and the steps would not build on each other.
    const outDegree = new Map<string, number>();
    for (const e of tpl.edges) {
      if (e.targetHandle !== 'image_ref') continue;
      outDegree.set(e.source, (outDegree.get(e.source) || 0) + 1);
    }
    expect([...outDegree.values()].every((n) => n === 1)).toBe(true);
  });

  it('tells each clip where to end, so the handoff has something to land on', () => {
    const prompts = tpl.nodes.filter((n) => (n.data as any).type === 'prompt');
    expect(prompts).toHaveLength(6);
    for (const p of prompts) {
      expect((p.data as any).text).toMatch(/END ON:/);
    }
  });

  it('repeats the style constants in every clip', () => {
    for (const p of tpl.nodes.filter((n) => (n.data as any).type === 'prompt')) {
      const text = (p.data as any).text as string;
      expect(text).toContain('# CONSTANTS');
      expect(text).toMatch(/ASMR/);
      expect(text).toMatch(/9:16/);
    }
  });

  it('ships the reference slot empty for the user to fill', () => {
    const img = tpl.nodes.find((n) => (n.data as any).type === 'image')!;
    expect((img.data as any).imageData).toBe('');
    expect((img.data as any).assetPath).toBe('');
  });
});
