/**
 * An extraction, as a workflow.
 *
 * The Extractor already returns everything a workflow needs — character sheets
 * and a shot list with an image_prompt and a video_prompt each — and then made
 * a person copy it into nodes by hand. On a twelve shot video that is
 * twenty-four copy-pastes, for a structure completely determined by the
 * analysis.
 *
 * The two things worth testing hardest are the wiring, because it is what a
 * hand-built version gets wrong, and the refusals, because an empty canvas
 * reads as a broken feature rather than a thin analysis.
 */

import { buildCost, extractionToPlan, type Extraction } from '../studio/builder/fromExtraction';
import { compilePlan } from '../studio/builder/plan';

const prompt = (s: string) => `${s}, cinematic lighting, shallow depth of field`;

const extraction = (over: Partial<Extraction> = {}): Extraction => ({
  video_concept: 'A moody kitchen story about a serum that changes everything',
  character_sheets: [
    { character_name: 'Maya', prompt: prompt('Character sheet, turnaround, woman late twenties') },
  ],
  shots: [
    { shot_id: 1, time_range: '0:00-0:04', image_prompt: prompt('wide of a kitchen at dawn'), video_prompt: prompt('slow push in on the counter') },
    { shot_id: 2, time_range: '0:04-0:09', image_prompt: prompt('close on hands opening a bottle'), video_prompt: prompt('hands tilt the bottle to the light') },
  ],
  ...over,
});

const idsOf = (steps: any[]) => steps.map((s) => s.id);
const byId = (steps: any[], id: string) => steps.find((s) => s.id === id);
const nodeById = (template: any, id: string) => template.nodes.find((n: any) => n.id === id);

describe('the shape it builds', () => {
  it('makes a still and a clip for every shot', () => {
    const { plan } = extractionToPlan(extraction());
    expect(idsOf(plan!.steps)).toEqual([
      'cast1', 'shot1_still', 'shot1_clip', 'shot2_still', 'shot2_clip',
    ]);
  });

  it('wires every character into every still', () => {
    /* This is what keeps a face the same face across a dozen shots, and it is
       exactly the wiring a hand-built version skips because it is tedious —
       so the character drifts and nobody can say when it started. */
    const { plan } = extractionToPlan(extraction({
      character_sheets: [
        { character_name: 'Maya', prompt: prompt('sheet one') },
        { character_name: 'Sam', prompt: prompt('sheet two') },
      ],
    }));
    expect(byId(plan!.steps, 'shot1_still').inputs).toEqual(['cast1', 'cast2']);
    expect(byId(plan!.steps, 'shot2_still').inputs).toEqual(['cast1', 'cast2']);
  });

  it('gives each clip its OWN still and nothing else', () => {
    /* A clip generated from a still it did not come from is a continuity break
       with no explanation. */
    const { plan } = extractionToPlan(extraction());
    expect(byId(plan!.steps, 'shot1_clip').inputs).toEqual(['shot1_still']);
    expect(byId(plan!.steps, 'shot2_clip').inputs).toEqual(['shot2_still']);
  });

  it('makes video on Flow, whatever platform was asked for', () => {
    /* Only Flow makes video. A chat platform here is a node that cannot run,
       which is worse than not offering the choice. */
    const { plan } = extractionToPlan(extraction(), { platform: 'gemini' });
    expect(byId(plan!.steps, 'shot1_clip').platform).toBe('flow');
  });

  it('shoots the character sheet square and the shots vertical', () => {
    /* A sheet is a turnaround, not a shot: a 9:16 crop of one loses the outer
       poses, which are the point of having it. */
    const { plan } = extractionToPlan(extraction(), { aspectRatio: '9:16' });
    expect(byId(plan!.steps, 'cast1').aspectRatio).toBe('1:1');
    expect(byId(plan!.steps, 'shot1_still').aspectRatio).toBe('9:16');
  });

  it('names the workflow after the video', () => {
    const { plan } = extractionToPlan(extraction(), { sourceName: 'glow-drop.mp4' });
    expect(plan!.name).toBe('glow-drop.mp4 — rebuilt');
  });

  it('says what it built in the description', () => {
    const { plan } = extractionToPlan(extraction());
    expect(plan!.description).toMatch(/2 shots/);
    expect(plan!.description).toMatch(/1 character wired into every still/);
  });
});

describe('choosing what to spend on', () => {
  it('can lay out stills only, to see the look before paying for video', () => {
    const { plan } = extractionToPlan(extraction(), { mode: 'stills' });
    expect(idsOf(plan!.steps)).toEqual(['cast1', 'shot1_still', 'shot2_still']);
  });

  it('can lay out clips only, wiring them to the cast instead', () => {
    /* With no still to start from, the characters are the only thing keeping
       the clips consistent — so they go there rather than nowhere. */
    const { plan } = extractionToPlan(extraction(), { mode: 'clips' });
    expect(idsOf(plan!.steps)).toEqual(['cast1', 'shot1_clip', 'shot2_clip']);
    expect(byId(plan!.steps, 'shot1_clip').inputs).toEqual(['cast1']);
  });

  it('can skip the cast entirely', () => {
    const { plan } = extractionToPlan(extraction(), { characters: false });
    expect(idsOf(plan!.steps)).not.toContain('cast1');
    expect(byId(plan!.steps, 'shot1_still').inputs).toBeUndefined();
  });

  it('says what a build will cost before anyone presses it', () => {
    /* Twenty shots in both modes is forty generations. Finding that out from a
       credit balance afterwards is the wrong order. */
    expect(buildCost(extraction())).toEqual({ characters: 1, stills: 2, clips: 2, total: 5 });
    expect(buildCost(extraction(), { mode: 'stills' })).toMatchObject({ clips: 0, total: 3 });
  });
});

describe('what it refuses', () => {
  it('refuses something that is not an extraction', () => {
    for (const bad of [null, undefined, 'text', 42]) {
      expect(extractionToPlan(bad as any).plan).toBeNull();
    }
  });

  it('refuses an extraction with no shots', () => {
    const { plan, problems } = extractionToPlan(extraction({ shots: [] }));
    expect(plan).toBeNull();
    expect(problems.join(' ')).toMatch(/no shots/);
  });

  it('skips a shot with nothing usable, and says which', () => {
    const { plan, problems } = extractionToPlan(extraction({
      shots: [
        { shot_id: 1, image_prompt: 'a man', video_prompt: '' },
        { shot_id: 2, image_prompt: prompt('a real prompt here'), video_prompt: prompt('and motion') },
      ],
    }));
    /* "a man" produces a picture of nobody in particular, and wiring it into a
       workflow dresses that up as work. */
    expect(idsOf(plan!.steps)).not.toContain('shot1_still');
    expect(problems.join(' ')).toMatch(/Shot 1 had no usable prompt/);
  });

  it('keeps a shot that has only a clip prompt', () => {
    /* Flow generates video from text perfectly well, so a missing still is not
       a missing shot. */
    const { plan } = extractionToPlan(extraction({
      shots: [{ shot_id: 1, image_prompt: '', video_prompt: prompt('a drone rising over a city') }],
    }));
    expect(idsOf(plan!.steps)).toContain('shot1_clip');
    expect(idsOf(plan!.steps)).not.toContain('shot1_still');
  });

  it('refuses when nothing at all was usable', () => {
    const { plan, problems } = extractionToPlan(extraction({
      shots: [{ shot_id: 1, image_prompt: 'x', video_prompt: 'y' }],
    }));
    expect(plan).toBeNull();
    expect(problems.join(' ')).toMatch(/None of the shots/);
  });

  it('caps a huge analysis and says how many it left', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      shot_id: i + 1,
      image_prompt: prompt(`shot ${i + 1}`),
      video_prompt: prompt(`motion ${i + 1}`),
    }));
    const { plan, problems } = extractionToPlan(extraction({ shots: many }), { maxShots: 5 });
    expect(plan!.steps.filter((s) => s.media === 'video')).toHaveLength(5);
    expect(problems.join(' ')).toMatch(/30 shots found; the first 5/);
  });

  it('skips a character sheet with no prompt rather than making an empty node', () => {
    const { plan, problems } = extractionToPlan(extraction({
      character_sheets: [{ character_name: 'Ghost', prompt: '' }],
    }));
    expect(idsOf(plan!.steps)).not.toContain('cast1');
    expect(problems.join(' ')).toMatch(/Character 1 had no usable sheet prompt/);
  });
});

describe('the plan actually compiles', () => {
  /* A plan the compiler rejects is worse than no plan: everything looks right
     until the canvas refuses to open. */

  it('compiles into a canvas with no problems', () => {
    const { plan } = extractionToPlan(extraction());
    const { template, problems } = compilePlan(plan!);
    expect(problems).toEqual([]);
    expect(template).not.toBeNull();
  });

  it('produces the edges the wiring described', () => {
    const { plan } = extractionToPlan(extraction());
    const { template } = compilePlan(plan!);
    const pairs = template!.edges.map((e: any) => `${e.source}->${e.target}`);
    expect(pairs).toContain('cast1->shot1_still');
    expect(pairs).toContain('shot1_still->shot1_clip');
    expect(pairs).not.toContain('shot2_still->shot1_clip');
  });

  it('compiles a twenty shot analysis without falling over', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      shot_id: i + 1,
      image_prompt: prompt(`shot ${i + 1}`),
      video_prompt: prompt(`motion ${i + 1}`),
    }));
    const { plan } = extractionToPlan(extraction({ shots: many }));
    const { template, problems } = compilePlan(plan!);
    expect(problems).toEqual([]);
    expect(template!.nodes.length).toBeGreaterThan(40);
  });

  it('leaves no two nodes on top of each other', () => {
    /* Two nodes at one point read as one node nobody can separate. */
    const { plan } = extractionToPlan(extraction());
    const { template } = compilePlan(plan!);
    const points = template!.nodes.map((n: any) => `${n.position.x},${n.position.y}`);
    expect(new Set(points).size).toBe(points.length);
  });
});

describe('the settings a person chose', () => {
  /* Every one of these is a dropdown somebody filled in on the website. A
     build that silently substitutes a default for any of them produces nodes
     running on a model nobody picked, and nothing on screen says so. */

  it('runs the nodes on the models that were picked', () => {
    const { plan } = extractionToPlan(extraction(), {
      imageModel: 'Imagen 4',
      videoModel: 'Veo 3.1 Fast',
    });
    expect(byId(plan!.steps, 'cast1').model).toBe('Imagen 4');
    expect(byId(plan!.steps, 'shot1_still').model).toBe('Imagen 4');
    expect(byId(plan!.steps, 'shot1_clip').model).toBe('Veo 3.1 Fast');
  });

  it('carries the clip length onto the clips', () => {
    const { plan } = extractionToPlan(extraction(), { duration: '8s' });
    expect(byId(plan!.steps, 'shot1_clip').duration).toBe('8s');
  });

  it('survives the compiler with those choices intact', () => {
    /* The point of naming a model is that it reaches the canvas. */
    const { plan } = extractionToPlan(extraction(), { videoModel: 'Veo 3.1 Fast', duration: '8s' });
    const { template } = compilePlan(plan!);
    const clip = template!.nodes.find((n: any) => n.id === 'shot1_clip')!;
    expect(clip.data.model).toBe('Veo 3.1 Fast');
    expect(clip.data.duration).toBe('8s');
  });

  it('still defaults the model when nobody picked one', () => {
    const { plan } = extractionToPlan(extraction());
    const { template } = compilePlan(plan!);
    expect(nodeById(template!, 'shot1_clip').data.model).toBe('Omni 1.1 Flash');
    expect(nodeById(template!, 'shot1_still').data.model).toBe('Nano Banana Pro');
  });

  it('shoots stills at a ratio Flow will not take for video, and clips at one it will', () => {
    /* 4:3 is a real choice for a still and not an option for a clip. Passing
       it through produces a node Flow rejects when it runs, which is the
       worst place to find out. */
    const { plan } = extractionToPlan(extraction(), { aspectRatio: '4:3' });
    expect(byId(plan!.steps, 'shot1_still').aspectRatio).toBe('4:3');
    expect(byId(plan!.steps, 'shot1_clip').aspectRatio).toBe('9:16');
  });

  it('leaves a ratio Flow does support alone', () => {
    const { plan } = extractionToPlan(extraction(), { aspectRatio: '16:9' });
    expect(byId(plan!.steps, 'shot1_clip').aspectRatio).toBe('16:9');
  });
});
