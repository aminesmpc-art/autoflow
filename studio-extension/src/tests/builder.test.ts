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

describe('the nodes the plan can now reach', () => {
  it('wires a last frame from a clip into the next clip', () => {
    /* The continuity tool, and the one the first brief could not express:
       shot two literally begins on the image shot one ended on. */
    const { template, problems } = compilePlan({
      name: 'Two continuous shots',
      steps: [
        { id: 'a', type: 'generate', media: 'video', platform: 'flow', prompt: 'Push in on the plinth.' },
        { id: 'f', type: 'frame', label: 'Ends on', inputs: ['a'] },
        { id: 'b', type: 'generate', media: 'video', platform: 'flow', prompt: 'Continue from this frame, drifting closer.', inputs: ['f'] },
      ],
    });
    expect(problems).toEqual([]);
    expect(validateTemplate(template)).toEqual([]);
    // Clip -> frame on image_ref, frame -> clip on image (not result).
    const intoFrame = template!.edges.find((e: any) => e.target === 'f')!;
    expect(intoFrame).toMatchObject({ source: 'a', sourceHandle: 'result', targetHandle: 'image_ref' });
    const outOfFrame = template!.edges.find((e: any) => e.source === 'f')!;
    expect(outOfFrame).toMatchObject({ target: 'b', sourceHandle: 'image', targetHandle: 'image_ref' });
  });

  it('refuses a frame taken from a still', () => {
    const { template, problems } = compilePlan({
      steps: [
        { id: 'a', type: 'generate', media: 'image', platform: 'grok', prompt: 'A plinth.' },
        { id: 'f', type: 'frame', inputs: ['a'] },
      ],
    });
    expect(template).toBeNull();
    expect(problems.join(' ')).toMatch(/rather than video/i);
  });

  it('refuses a frame fed by two clips', () => {
    const { problems } = compilePlan({
      steps: [
        { id: 'a', type: 'generate', media: 'video', platform: 'flow', prompt: 'One.' },
        { id: 'b', type: 'generate', media: 'video', platform: 'flow', prompt: 'Two.' },
        { id: 'f', type: 'frame', inputs: ['a', 'b'] },
      ],
    });
    expect(problems.join(' ')).toMatch(/needs exactly one/i);
  });
});

describe('the brief teaches the canvas, not just the schema', () => {
  const spec = buildSpec('a 3-shot ad for a coffee brand');

  it('names every node type a plan can use', () => {
    for (const t of ['image', 'generate', 'frame', 'extend', 'agent']) {
      expect(spec).toContain(t);
    }
  });

  it('states the two patterns the best models found unaided', () => {
    expect(spec).toMatch(/still first, then move it/i);
    expect(spec).toMatch(/frame\s*->\s*clip B|clip A\s*->\s*frame/i);
  });

  it('forbids the failure the weakest model produced', () => {
    // DeepSeek folded a three-shot ad into a single generation.
    expect(spec).toMatch(/one step per shot/i);
    expect(spec).toMatch(/never fold several shots/i);
  });

  it('asks the model to decide before it writes', () => {
    expect(spec).toContain('"thinking"');
    expect(spec).toMatch(/fill in "thinking" first/i);
  });

  it('still compiles its own example, now that the example uses a frame', () => {
    const { template, problems } = buildFromReply(spec.slice(spec.indexOf('EXAMPLE')));
    expect(problems).toEqual([]);
    expect(validateTemplate(template)).toEqual([]);
    expect(template!.nodes.some((n: any) => n.type === 'frame')).toBe(true);
  });

  it('ignores the thinking block when compiling', () => {
    // It exists to slow the model down, not to reach the canvas.
    const { template } = buildFromReply(spec.slice(spec.indexOf('EXAMPLE')));
    expect(JSON.stringify(template)).not.toContain('continuity');
  });
});

describe('the two things the car-carving plan exposed', () => {
  it('gives a match cut real start and end frames, not two references', () => {
    /* The model reasoned "nothing else takes a start frame and an end frame"
       and then wrote inputs: [a, b], because the format had no way to say it.
       Both would have been wired to image_ref — two reference pictures, which
       is a different instruction with a different result. */
    const { template, problems } = compilePlan({
      name: 'Match cut',
      steps: [
        { id: 'mini', type: 'generate', media: 'image', platform: 'grok', prompt: 'A carved wooden car.' },
        { id: 'real', type: 'generate', media: 'image', platform: 'grok', prompt: 'The real car on wet asphalt.' },
        {
          id: 'cut', type: 'generate', media: 'video', platform: 'flow',
          prompt: 'The world changes scale around the car in one unbroken move.',
          startFrame: 'mini', endFrame: 'real', duration: '6s',
        },
      ],
    });
    expect(problems).toEqual([]);
    expect(validateTemplate(template)).toEqual([]);

    const node = template!.nodes.find((n: any) => n.id === 'cut')!;
    expect(node.data.creationType).toBe('frames');
    const into = template!.edges.filter((e: any) => e.target === 'cut');
    expect(into.find((e: any) => e.targetHandle === 'frame_start')!.source).toBe('mini');
    expect(into.find((e: any) => e.targetHandle === 'frame_end')!.source).toBe('real');
    // And nothing landed on the reference port.
    expect(into.some((e: any) => e.targetHandle === 'image_ref')).toBe(false);
  });

  it('refuses start/end frames alongside inputs rather than guessing', () => {
    const { template, problems } = compilePlan({
      steps: [
        { id: 'a', type: 'generate', media: 'image', platform: 'grok', prompt: 'One.' },
        { id: 'b', type: 'generate', media: 'image', platform: 'grok', prompt: 'Two.' },
        { id: 'c', type: 'generate', media: 'video', platform: 'flow', prompt: 'Move.', startFrame: 'a', endFrame: 'b', inputs: ['a'] },
      ],
    });
    expect(template).toBeNull();
    expect(problems.join(' ')).toMatch(/use one/i);
  });

  it('refuses start/end frames on a platform that cannot do them', () => {
    const { problems } = compilePlan({
      steps: [
        { id: 'a', type: 'generate', media: 'image', platform: 'grok', prompt: 'One.' },
        { id: 'b', type: 'generate', media: 'image', platform: 'grok', prompt: 'Two.' },
        { id: 'c', type: 'generate', media: 'video', platform: 'grok', prompt: 'Move.', startFrame: 'a', endFrame: 'b' },
      ],
    });
    expect(problems.join(' ')).toMatch(/only flow/i);
  });

  it('treats an agent as text even when the plan forgets to say so', () => {
    /* A model that writes {"type":"agent"} with no media used to have its
       output wired as a picture — onto a node whose only output is text. */
    const { template, problems } = compilePlan({
      steps: [
        { id: 'think', type: 'agent', platform: 'chatgpt', prompt: 'Watch the clip and describe what changed.' },
        { id: 'shot', type: 'generate', media: 'image', platform: 'grok', inputs: ['think'] },
      ],
    });
    expect(problems).toEqual([]);
    expect(validateTemplate(template)).toEqual([]);
    const into = template!.edges.find((e: any) => e.target === 'shot' && e.source === 'think')!;
    expect(into).toMatchObject({ sourceHandle: 'text', targetHandle: 'text' });
  });

  it('auto-wires Story Director to downstream generate steps that lack prompt text', () => {
    const { template, problems } = compilePlan({
      name: 'Three-Shot Character Dialogue',
      steps: [
        {
          id: 'story',
          type: 'story',
          platform: 'chatgpt',
          label: 'Story Director',
          prompt: 'Direct a three-shot sequence',
          cast: [{ name: 'Hero', look: 'Detective in trench coat' }],
          world: 'Rainy cyberpunk alley',
          look: 'Moody neon noir',
        },
        { id: 'wide', type: 'generate', media: 'image', platform: 'grok', label: 'Wide Keyframe', aspectRatio: '16:9' },
        { id: 'wideclip', type: 'generate', media: 'video', platform: 'flow', label: 'Wide Establishing', inputs: ['wide'], aspectRatio: '16:9', duration: '8s' },
        { id: 'wideend', type: 'frame', label: 'Wide Final Frame', inputs: ['wideclip'] },
        { id: 'medium', type: 'generate', media: 'image', platform: 'grok', label: 'Medium Keyframe', inputs: ['wideend'], aspectRatio: '16:9' },
        { id: 'mediumclip', type: 'generate', media: 'video', platform: 'flow', label: 'Medium Dialogue', inputs: ['medium'], aspectRatio: '16:9', duration: '8s' },
        { id: 'mediumend', type: 'frame', label: 'Medium Final Frame', inputs: ['mediumclip'] },
        { id: 'close', type: 'generate', media: 'image', platform: 'grok', label: 'Close Keyframe', inputs: ['mediumend'], aspectRatio: '16:9' },
        { id: 'closeclip', type: 'generate', media: 'video', platform: 'flow', label: 'Emotional Close-Up', inputs: ['close'], aspectRatio: '16:9', duration: '6s' },
      ],
    });

    expect(problems).toEqual([]);
    expect(template).not.toBeNull();
    expect(validateTemplate(template)).toEqual([]);

    // Every generate node is wired to the Story Director for runtime prompt generation
    const storyEdges = template!.edges.filter((e: any) => e.source === 'story' && e.targetHandle === 'text');
    const targetIds = storyEdges.map((e: any) => e.target).sort();
    expect(targetIds).toEqual(['close', 'closeclip', 'medium', 'mediumclip', 'wide', 'wideclip']);
  });
});

describe('the brief describes the agent it actually has', () => {
  const spec = buildSpec('anything');

  it('names the agent tools rather than calling it a text step', () => {
    for (const tool of ['read_canvas', 'set_prompt', 'rerun_node', 'inspect_clip']) {
      expect(spec).toContain(tool);
    }
  });

  it('tells the model not to use an agent for prompt writing', () => {
    // Which is exactly what a model did when the description said "answers in text".
    expect(spec).toMatch(/do not use it to write a prompt/i);
  });

  it('offers start and end frames as their own fields', () => {
    expect(spec).toContain('startFrame');
    expect(spec).toContain('endFrame');
    expect(spec).toMatch(/not two\s*\n?\s*entries in "inputs"/i);
  });
});
