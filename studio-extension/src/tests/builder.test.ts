/* ============================================================
   The plan compiler, and the mess a chat model actually returns.

   Two jobs here.

   The first is the contract that makes this feature possible at all: anything
   compilePlan accepts must produce a template that passes validateTemplate —
   the same gate every bundled and every downloaded template goes through. If
   that holds, a model can only produce a workflow that is wrong in the ways a
   human would be wrong (a poor prompt, an odd order), never one that renders
   a broken canvas. Handles, ids, positions and ports stop being a model's
   problem.

   The second is extraction. Models do not return bare JSON. They fence it,
   introduce it, apologise after it, wrap it in {"workflow": ...}, or answer
   with the object alone. Every one of those is normal and none is worth
   failing over, so each is a case below.
   ============================================================ */

import { compilePlan, readPlan, extractJson, buildFromReply, type Plan } from '../studio/builder/plan';
import { validateTemplate } from '../studio/templates/validate';
import { buildSpec } from '../studio/builder/spec';

const PHOTO_TO_CLIP: Plan = {
  name: 'Product photo to ad clip',
  description: 'Turn one product photo into a short vertical ad.',
  steps: [
    { id: 'photo', type: 'image', label: 'Product photo' },
    {
      id: 'hero', type: 'generate', media: 'image', platform: 'grok',
      label: 'Hero still', prompt: 'The product on clean marble, soft studio light.',
      inputs: ['photo'], aspectRatio: '9:16',
    },
    {
      id: 'clip', type: 'generate', media: 'video', platform: 'flow',
      label: 'Ad clip', prompt: 'Slow turntable rotation, locked-off camera.',
      inputs: ['hero'], aspectRatio: '9:16', duration: '6s',
    },
  ],
};

describe('a compiled plan is a valid template', () => {
  it('compiles the worked example with no problems', () => {
    const { template, problems } = compilePlan(PHOTO_TO_CLIP);
    expect(problems).toEqual([]);
    expect(template).not.toBeNull();
    expect(validateTemplate(template)).toEqual([]);
  });

  it('gives every generate node a prompt, which is what the runner needs', () => {
    const { template } = compilePlan(PHOTO_TO_CLIP);
    const fed = new Set(template!.edges.filter((e: any) => e.targetHandle === 'text').map((e: any) => e.target));
    for (const n of template!.nodes.filter((n: any) => n.type === 'generate')) {
      expect(fed.has(n.id)).toBe(true);
    }
  });

  it('wires an upload to image_ref and a still to image_ref from result', () => {
    const { template } = compilePlan(PHOTO_TO_CLIP);
    const byId = (id: string) => template!.edges.find((e: any) => e.id === id)!;
    expect(byId('e_photo_hero_image_ref')).toMatchObject({ sourceHandle: 'image', targetHandle: 'image_ref' });
    expect(byId('e_hero_clip_image_ref')).toMatchObject({ sourceHandle: 'result', targetHandle: 'image_ref' });
  });

  it('lets a text step supply the prompt instead of a prompt node', () => {
    const { template, problems } = compilePlan({
      name: 'Written then drawn',
      steps: [
        { id: 'write', type: 'generate', media: 'text', platform: 'chatgpt',
          label: 'Write it', prompt: 'Write one vivid sentence describing a winter street.' },
        { id: 'draw', type: 'generate', media: 'image', platform: 'grok',
          label: 'Draw it', inputs: ['write'] },
      ],
    });
    expect(problems).toEqual([]);
    expect(validateTemplate(template)).toEqual([]);
    // The wire carries the text; no second prompt node was invented for it.
    const intoDraw = template!.edges.filter((e: any) => e.target === 'draw' && e.targetHandle === 'text');
    expect(intoDraw).toHaveLength(1);
    expect(intoDraw[0].source).toBe('write');
    expect(template!.nodes.find((n: any) => n.id === 'draw_p')).toBeUndefined();
  });

  it('never stacks two nodes on one point', () => {
    /* Several one-step chains put their prompt nodes at the same offset.
       The validator rejects that, and it reads as one node the user cannot
       separate, so the compiler nudges instead of failing. */
    const { template, problems } = compilePlan({
      name: 'Four at once',
      steps: [1, 2, 3, 4].map((i) => ({
        id: `g${i}`, type: 'generate' as const, media: 'image' as const,
        platform: 'grok' as const, label: `Shot ${i}`, prompt: `A photo, take ${i}.`,
      })),
    });
    expect(problems).toEqual([]);
    const points = template!.nodes.map((n: any) => `${n.position.x},${n.position.y}`);
    expect(new Set(points).size).toBe(points.length);
    expect(validateTemplate(template)).toEqual([]);
  });

  it('puts later steps in later columns', () => {
    const { template } = compilePlan(PHOTO_TO_CLIP);
    const at = (id: string) => template!.nodes.find((n: any) => n.id === id)!.position.x;
    expect(at('photo')).toBeLessThan(at('hero'));
    expect(at('hero')).toBeLessThan(at('clip'));
  });
});

describe('a plan the compiler must refuse', () => {
  const refuses = (plan: any, pattern: RegExp) => {
    const { template, problems } = compilePlan(plan);
    expect(template).toBeNull();
    expect(problems.join(' ')).toMatch(pattern);
  };

  it('refuses an input naming a step that does not exist', () => {
    refuses({ steps: [{ id: 'a', type: 'generate', media: 'image', prompt: 'x', inputs: ['ghost'] }] },
      /input "ghost"/i);
  });

  it('refuses two steps sharing an id', () => {
    refuses({ steps: [
      { id: 'a', type: 'generate', media: 'image', prompt: 'x' },
      { id: 'a', type: 'generate', media: 'image', prompt: 'y' },
    ] }, /share the id/i);
  });

  it('refuses a generate step with nothing to say', () => {
    refuses({ steps: [{ id: 'a', type: 'generate', media: 'image' }] }, /no prompt/i);
  });

  it('refuses a platform it cannot drive', () => {
    refuses({ steps: [{ id: 'a', type: 'generate', media: 'image', platform: 'midjourney', prompt: 'x' }] },
      /midjourney/i);
  });

  it('refuses both a text wire and a literal prompt on one step', () => {
    // The runner reads one text input; silently dropping the other is worse.
    refuses({ steps: [
      { id: 'w', type: 'generate', media: 'text', platform: 'chatgpt', prompt: 'Write a line.' },
      { id: 'd', type: 'generate', media: 'image', inputs: ['w'], prompt: 'Also this.' },
    ] }, /both a written-text input/i);
  });

  it('says so rather than returning an empty canvas', () => {
    refuses({ steps: [] }, /no steps/i);
  });
});

describe('reading what a model actually sends back', () => {
  const OBJ = '{"name":"X","steps":[{"id":"a","type":"generate","media":"image","prompt":"a cat"}]}';

  it('reads a bare object', () => {
    expect(readPlan(OBJ).plan?.steps).toHaveLength(1);
  });

  it('reads a ```json fence', () => {
    expect(readPlan('Here you go:\n```json\n' + OBJ + '\n```\nHope that helps!').plan?.steps).toHaveLength(1);
  });

  it('reads a bare ``` fence', () => {
    expect(readPlan('```\n' + OBJ + '\n```').plan?.steps).toHaveLength(1);
  });

  it('reads an object buried in prose', () => {
    expect(readPlan('Sure! ' + OBJ + ' Let me know if you want changes.').plan?.steps).toHaveLength(1);
  });

  it('unwraps {"workflow": ...}, which is a fair reading of the brief', () => {
    expect(readPlan('{"workflow":' + OBJ + '}').plan?.steps).toHaveLength(1);
  });

  it('says what is wrong when there is no JSON at all', () => {
    const { plan, problem } = readPlan('I would be happy to help! What kind of video?');
    expect(plan).toBeNull();
    expect(problem).toMatch(/no json/i);
  });

  it('says what is wrong when the JSON is not a plan', () => {
    const { plan, problem } = readPlan('{"nodes":[],"edges":[]}');
    expect(plan).toBeNull();
    expect(problem).toMatch(/steps/i);
  });

  it('ignores a fenced snippet that is not JSON and finds the object after it', () => {
    expect(extractJson('```\nnot json at all\n```\n' + OBJ)).toMatchObject({ name: 'X' });
  });

  it('goes from a fenced reply straight to a loadable workflow', () => {
    const { template, problems } = buildFromReply('```json\n' + OBJ + '\n```');
    expect(problems).toEqual([]);
    expect(validateTemplate(template)).toEqual([]);
  });
});

describe('the brief given to the model', () => {
  const spec = buildSpec('a 3-shot ad for a coffee brand');

  it('carries the idea', () => {
    expect(spec).toContain('a 3-shot ad for a coffee brand');
  });

  it('enumerates the platforms rather than describing them', () => {
    for (const p of ['flow', 'chatgpt', 'gemini', 'grok']) expect(spec).toContain(`"${p}"`);
  });

  it('tells the model not to send the mechanical parts', () => {
    expect(spec).toMatch(/do not include positions/i);
  });

  it('contains an example that itself compiles', () => {
    /* The example is what every model copies most closely, so a mistake in it
       is a mistake in every reply. Extract it from the brief and run it
       through the compiler — the model's most likely output, checked. */
    const { template, problems } = buildFromReply(spec.slice(spec.indexOf('EXAMPLE')));
    expect(problems).toEqual([]);
    expect(validateTemplate(template)).toEqual([]);
  });
});
