/**
 * The twenty-three-node construction timelapse.
 *
 * Reported with a screenshot: "Architectural Ground-Up Construction Timelapse",
 * 23 nodes, and sitting in the middle of it a Story node labelled "Construction
 * Director" carrying the words the canvas prints when nothing is wired to it —
 *
 *     Unwired. Not connected yet. Connect the (T) dot on the right to
 *     video or image nodes to direct the sequence.
 *
 * Six stills and five clips, each with a prompt node of its own beside it, and
 * a director attached to none of them. Every shot generated from its own text,
 * agreeing with nothing, which is the exact failure a director exists to
 * prevent — while the director itself sat there having cost a turn.
 *
 * THE MODEL DID NOT DO THIS ON ITS OWN. compilePlan auto-wires a lone story
 * director into any step that has no prompt and no text input. Every step in
 * this plan had a prompt, so nothing was auto-wired, and each of those prompts
 * became a node in its own column — two nodes per shot instead of one, which
 * is where 23 came from.
 *
 * checkPlan DID catch it, as `storyUnused`, and the repair it sent back could
 * not be obeyed:
 *
 *     "List it in the inputs of every shot it should write."
 *
 * Doing that makes every one of those steps carry a text input AND its own
 * prompt, which compilePlan rejects outright. So the repair traded a quality
 * problem for a structural one, the model sensibly changed nothing, and two
 * rounds later the dangling director shipped.
 *
 * A repair that cannot be carried out is worse than no repair: it spends the
 * rounds and teaches the loop nothing.
 */

/// <reference types="node" />

import { checkPlan } from '../studio/builder/check';
import { compilePlan } from '../studio/builder/plan';
import type { Plan } from '../studio/builder/plan';
import { buildSpec } from '../studio/builder/spec';

/** The reported shape: a director, and every shot writing itself. */
const shot = (n: number, prompt: string | undefined) => ({
  id: `img${n}`,
  type: 'generate' as const,
  media: 'image' as const,
  platform: 'gemini' as const,
  label: `Image ${n}`,
  ...(prompt ? { prompt } : {}),
  ...(prompt ? {} : { inputs: ['director'] }),
});

const P = 'Exact same drone camera position, altitude, lens and 45-degree angle as the '
  + 'reference. Reinforced concrete foundation slab and footings fully laid into the ground.';

const withPrompts = (): Plan => ({
  name: 'Architectural Ground-Up Construction Timelapse',
  description: 'Six stills and the clips between them.',
  steps: [
    { id: 'director', type: 'story', platform: 'gemini', label: 'Construction Director',
      structure: 'buildTimelapse', cameraProgression: 'lockedWide' },
    shot(1, P), shot(2, P), shot(3, P),
  ],
} as unknown as Plan);

const withDirector = (): Plan => ({
  name: 'Architectural Ground-Up Construction Timelapse',
  description: 'Six stills and the clips between them.',
  steps: [
    { id: 'director', type: 'story', platform: 'gemini', label: 'Construction Director',
      structure: 'buildTimelapse', cameraProgression: 'lockedWide' },
    shot(1, undefined), shot(2, undefined), shot(3, undefined),
  ],
} as unknown as Plan);

const codes = (p: Plan) => checkPlan(p).map((x) => x.code);
const detailFor = (p: Plan, code: string) =>
  checkPlan(p).find((x) => x.code === code)?.detail || '';

describe('a director wired to nothing', () => {
  it('is still caught', () => {
    expect(codes(withPrompts())).toContain('storyUnused');
  });

  it('now asks for the half of the repair that was missing', () => {
    /* Listing the director was one of two moves. Without the other one the
       plan it produces is rejected by the compiler, so the model was being
       asked to make its answer worse. */
    const d = detailFor(withPrompts(), 'storyUnused');
    expect(d).toMatch(/delete the "prompt" field/);
    expect(d).toMatch(/cannot have both a text input and its own prompt/);
  });

  it('names the steps to strip, so the repair is a diff and not a hunt', () => {
    const d = detailFor(withPrompts(), 'storyUnused');
    expect(d).toContain('"img1"');
    expect(d).toContain('"img3"');
  });

  it('offers the other way out, which is often the right one', () => {
    /* Deleting the director is a legitimate answer — a brief that hands over
       finished prompts does not need one. What is not legitimate is keeping
       both, so both escapes have to be on the table. */
    const d = detailFor(withPrompts(), 'storyUnused');
    expect(d).toMatch(/delete the story director instead/i);
    expect(d).toMatch(/One or the other, never both/);
  });

  it('says nothing once the shots actually take it', () => {
    expect(codes(withDirector())).not.toContain('storyUnused');
    expect(codes(withDirector())).not.toContain('storyAndPrompts');
  });
});

describe('a director wired to some of them', () => {
  it('names the shots that went their own way', () => {
    /* The other face of the same fault, and the one nothing checked at all:
       the director is used, so storyUnused stays quiet, and two shots write
       themselves outside the cast, world and look the others share. */
    const mixed = {
      name: 'x',
      description: 'x',
      steps: [
        { id: 'director', type: 'story', platform: 'gemini', label: 'Director' },
        shot(1, undefined),
        shot(2, P),
      ],
    } as unknown as Plan;

    expect(codes(mixed)).toContain('storyAndPrompts');
    expect(detailFor(mixed, 'storyAndPrompts')).toMatch(/Either list the director/);
  });

  it('leaves a user upload alone, which never has a prompt to lose', () => {
    const withUpload = {
      name: 'x',
      description: 'x',
      steps: [
        { id: 'director', type: 'story', platform: 'gemini', label: 'Director' },
        { id: 'up', type: 'image', label: 'Your product photo' },
        shot(1, undefined),
      ],
    } as unknown as Plan;
    expect(codes(withUpload)).not.toContain('storyAndPrompts');
  });
});

describe('what the two shapes actually compile to', () => {
  it('doubles the node count when every shot writes itself', () => {
    /* Where 23 came from. Each written prompt becomes a node in its own
       column, so eleven shots by hand is twenty-two nodes plus the director
       that none of them use. */
    const { template } = compilePlan(withPrompts());
    const prompts = template!.nodes.filter((n: any) => n.type === 'prompt');
    expect(prompts).toHaveLength(3);
    expect(template!.nodes).toHaveLength(3 + 3 + 1);
  });

  it('halves it when the director writes them', () => {
    const { template } = compilePlan(withDirector());
    expect(template!.nodes.filter((n: any) => n.type === 'prompt')).toHaveLength(0);
    expect(template!.nodes).toHaveLength(4);
  });

  it('leaves the director connected to every shot in that case', () => {
    const { template } = compilePlan(withDirector());
    const fromDirector = template!.edges.filter((e: any) => e.source === 'director');
    expect(fromDirector).toHaveLength(3);
  });
});

describe('what the brief now says before any of that happens', () => {
  const spec = buildSpec('a construction timelapse');

  it('states that a director and written prompts are alternatives', () => {
    expect(spec).toContain('A STORY DIRECTOR AND WRITTEN PROMPTS ARE ALTERNATIVES');
    expect(spec).toMatch(/never both/i);
  });

  it('names the failure by its symptom, which is the one on screen', () => {
    expect(spec).toContain('"Unwired"');
  });

  it('says what it costs in nodes, since that is the visible damage', () => {
    expect(spec).toMatch(/doubles the node count/);
    expect(spec).toMatch(/twenty-two nodes/);
  });

  it('says which way to go by default', () => {
    /* Left to choose freely a model hedges and does both, which is exactly
       how this happened. */
    expect(spec).toMatch(/Prefer the director whenever the piece is more than about three/);
  });

  it('tells a niche brief describing a SYSTEM to build a director', () => {
    expect(spec).toMatch(/describes a SYSTEM for writing prompts/);
    expect(spec).toMatch(/makes eleven strangers/);
  });

  it('forbids a step wired to nothing at all', () => {
    expect(spec).toMatch(/Nothing in the plan may be wired to nothing/);
  });
});
