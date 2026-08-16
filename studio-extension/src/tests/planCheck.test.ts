/**
 * The plans that compile and should not have.
 *
 * compilePlan refuses anything that cannot become a canvas — unknown ids, a
 * frame fed by two clips, start/end frames on a platform without them. You
 * find those out immediately, because nothing gets built.
 *
 * Every plan in this file passes that. Each one opens on the canvas, runs, and
 * produces a workflow worse than the one that was asked for — and the user
 * pays the generations before finding out. That is the class of failure this
 * whole session has been about, one level up: a checker beats a rule written
 * into the brief, because a rule in a prompt is a suggestion.
 *
 * So every test here asserts TWO things: that the bad plan is caught, and that
 * the good version of the same plan is not. A checker that fires on everything
 * costs a repair round every build and teaches the model nothing.
 */

/// <reference types="node" />

import { checkPlan, repairPlanMessage, summarisePlan } from '../studio/builder/check';
import { compilePlan, type Plan } from '../studio/builder/plan';

const codes = (p: Plan) => checkPlan(p).map((x) => x.code);

/** Compiles cleanly — so anything the checker says is about quality, not shape. */
function assertCompiles(p: Plan): void {
  expect(compilePlan(p).problems).toEqual([]);
}

const still = (id: string) => ({
  id, type: 'generate' as const, media: 'image' as const, platform: 'flow' as const,
  label: 'Still', prompt: 'a person standing in a room',
});
const clip = (id: string, extra: Record<string, unknown> = {}) => ({
  id, type: 'generate' as const, media: 'video' as const, platform: 'flow' as const,
  label: 'Clip', prompt: 'the camera drifts closer', ...extra,
});

/* The folded-shots check that used to be tested here is gone, and the reason
   is in check.ts: every version of it was a keyword list, and "then" means
   both "and then, continuously" and "and then we cut", which a regex cannot
   separate. Twelve shipped templates use the first sense. Its tests were
   deleted with it rather than left asserting a rule that no longer exists. */

describe('the checks stay out of compilePlan’s way', () => {
  /* A repair message that lists the same problem twice reads like two faults.
     The model fixes one, resends, and burns a round. So these two — a step
     with nothing to say, and a step given both a prompt and a writer — belong
     to compilePlan alone, and this proves it still reports them. */
  it('leaves "nothing to say" to compilePlan', () => {
    const p: Plan = { steps: [{ id: 'a', type: 'generate', media: 'video', platform: 'flow', label: 'Clip' }] };
    expect(compilePlan(p).problems).toEqual(
      ['Step "a" has no prompt and nothing feeding it text.']);
    expect(checkPlan(p)).toEqual([]);
  });

  it('leaves "prompt and a writer" to compilePlan', () => {
    const p: Plan = {
      steps: [
        { id: 'dir', type: 'story', platform: 'chatgpt', label: 'D' },
        clip('a', { inputs: ['dir'] }),
      ],
    };
    expect(compilePlan(p).problems.join(' ')).toMatch(/both a written-text input/);
    expect(checkPlan(p).map((x) => x.code)).not.toContain('promptAndText');
  });
});

describe('continuity across a sequence', () => {
  const director = {
    id: 'dir', type: 'story' as const, platform: 'chatgpt' as const, label: 'D',
  };

  it('catches three clips of one story with nothing carrying one into the next', () => {
    const p: Plan = {
      steps: [director,
        { ...clip('a'), prompt: undefined, inputs: ['dir'] },
        { ...clip('b'), prompt: undefined, inputs: ['dir'] },
        { ...clip('c'), prompt: undefined, inputs: ['dir'] }],
    };
    assertCompiles(p);
    expect(codes(p)).toContain('noContinuity');
  });

  it('says nothing about independent clips with no director', () => {
    /* "Water Wipeouts: 4 Written by AI" ships four separate gags rendered
       from four separate prompts. Linking them would be the defect, and the
       first version of this rule flagged that shipped template. */
    const p: Plan = { steps: [clip('a'), clip('b'), clip('c')] };
    expect(codes(p)).not.toContain('noContinuity');
  });

  it('accepts a chain linked by frame steps', () => {
    const p: Plan = {
      steps: [
        director,
        clip('a'),
        { id: 'f', type: 'frame', label: 'Ends on', inputs: ['a'] },
        clip('b', { inputs: ['f'] }),
        clip('c'),
      ],
    };
    expect(codes(p)).not.toContain('noContinuity');
  });

  it('says nothing about two clips', () => {
    /* Two shots that do not continue each other is an ordinary cut, not a
       broken chain. Firing here would nag on almost every workflow. */
    const p: Plan = { steps: [clip('a'), clip('b')] };
    expect(codes(p)).not.toContain('noContinuity');
  });
});

describe('voices Flow can actually use', () => {
  it('catches a voice on a start/end frame step', () => {
    const p: Plan = {
      steps: [
        still('s1'), still('s2'),
        clip('a', { startFrame: 's1', endFrame: 's2', voice: 'Kore', prompt: 'a move' }),
      ],
    };
    assertCompiles(p);
    expect(codes(p)).toContain('voiceOnFrames');
  });

  it('catches a voice with no still wired in', () => {
    const p: Plan = { steps: [clip('a', { voice: 'Kore' })] };
    assertCompiles(p);
    expect(codes(p)).toContain('voiceWithoutImage');
  });

  it('accepts a voice on a clip that has a still', () => {
    const p: Plan = { steps: [still('s'), clip('a', { inputs: ['s'], voice: 'Kore' })] };
    expect(codes(p)).toEqual([]);
  });

  it('catches a voice Flow does not have', () => {
    const p: Plan = { steps: [still('s'), clip('a', { inputs: ['s'], voice: 'Geraldine' })] };
    expect(codes(p)).toContain('unknownVoice');
  });

  it('catches a cast that speaks in a silent story', () => {
    const p: Plan = {
      steps: [
        still('s'),
        {
          id: 'dir', type: 'story', platform: 'chatgpt', label: 'D', audioMode: 'none',
          cast: [{ name: 'Maya', look: 'red coat', voice: 'Kore' }],
        },
        { id: 'a', type: 'generate', media: 'video', platform: 'flow', label: 'C', inputs: ['dir', 's'] },
      ],
    };
    assertCompiles(p);
    expect(codes(p)).toContain('voiceButSilent');
  });

  it('catches a cast with voices when no shot has a still', () => {
    /* Every clip would come back silent, and Flow reports nothing. */
    const p: Plan = {
      steps: [
        {
          id: 'dir', type: 'story', platform: 'chatgpt', label: 'D', audioMode: 'dialogue',
          cast: [{ name: 'Maya', look: 'red coat', voice: 'Kore' }],
        },
        { id: 'a', type: 'generate', media: 'video', platform: 'flow', label: 'C', inputs: ['dir'] },
      ],
    };
    expect(codes(p)).toContain('castVoiceUnused');
  });
});

describe('the shape of the workflow', () => {
  it('catches a story nothing takes its prompt from', () => {
    const p: Plan = {
      steps: [
        { id: 'dir', type: 'story', platform: 'chatgpt', label: 'D' },
        clip('a'),
      ],
    };
    assertCompiles(p);
    expect(codes(p)).toContain('storyUnused');
  });

  it('catches two story directors', () => {
    const p: Plan = {
      steps: [
        { id: 'd1', type: 'story', platform: 'chatgpt', label: 'A' },
        { id: 'd2', type: 'story', platform: 'chatgpt', label: 'B' },
        { id: 'a', type: 'generate', media: 'video', platform: 'flow', label: 'C', inputs: ['d1', 'd2'] },
      ],
    };
    expect(codes(p)).toContain('lonelyStory');
  });

  it('catches an upload slot nothing uses', () => {
    /* It asks the user for a picture and then ignores it. */
    const p: Plan = { steps: [{ id: 'up', type: 'image', label: 'Your photo' }, clip('a')] };
    assertCompiles(p);
    expect(codes(p)).toContain('uploadUnused');
  });

  it('says nothing about a workflow that is fine', () => {
    const p: Plan = {
      steps: [
        { id: 'up', type: 'image', label: 'Your photo' },
        { id: 'dir', type: 'story', platform: 'chatgpt', label: 'D', audioMode: 'dialogue',
          cast: [{ name: 'Maya', look: 'red coat', voice: 'Kore' }] },
        { id: 'a', type: 'generate', media: 'video', platform: 'flow', label: 'One', inputs: ['dir', 'up'] },
        { id: 'f', type: 'frame', label: 'Ends on', inputs: ['a'] },
        { id: 'b', type: 'generate', media: 'video', platform: 'flow', label: 'Two', inputs: ['dir', 'f'] },
      ],
    };
    assertCompiles(p);
    expect(checkPlan(p)).toEqual([]);
  });
});

describe('what goes back to the model', () => {
  it('names the step and asks for the whole object again', () => {
    const p: Plan = { steps: [clip('a', { voice: 'Kore' })] };
    const msg = repairPlanMessage(checkPlan(p), ['Step "x" takes input "y", which is not a step.']);
    expect(msg).toMatch(/Step "a" sets a voice but has no still/);
    expect(msg).toMatch(/Step "x" takes input "y"/);          // structural problems too
    /* A reply that fixes everything and arrives wrapped in prose is still a
       failed round, and a partial reply loses the steps it did not mention. */
    expect(msg).toMatch(/ONE JSON object and nothing else/);
    expect(msg).toMatch(/every step in it, not only the ones you changed/);
  });

  it('summarises by kind, for the build log', () => {
    const p: Plan = {
      steps: [
        { id: 'up', type: 'image', label: 'unused upload' },
        clip('a', { voice: 'Geraldine' }),
      ],
    };
    /* Three kinds at once: an unknown voice, that voice having no still, and
       an upload nothing consumes. The build log shows the count and the kinds
       so a repair round is legible while it happens. */
    expect(summarisePlan(checkPlan(p))).toMatch(/3 problems: /);
    expect(summarisePlan(checkPlan(p))).toMatch(/unknownVoice/);
    expect(summarisePlan([])).toBe('no problems');
  });
});

/**
 * The checker runs on every build, and every problem costs a repair round.
 *
 * A rule that fires on workflows that are actually fine is worse than no rule:
 * it doubles the build time, teaches the model to "fix" something that was
 * right, and trains the user to ignore the output. So it is held against the
 * real thing — the templates that ship with the extension, which are the
 * workflows this feature is supposed to produce.
 */
describe('it does not nag about the workflows that ship', () => {
  const { TEMPLATES } = require('../studio/templates/index');

  it('finds nothing wrong with any shipped template', () => {
    /* Templates are nodes and edges, not steps, so they are read back into
       plan shape first — inputs from the edges, prompt text from the prompt
       node feeding each step. Anything the checker flags here is a rule that
       would have fired on a workflow somebody already uses. */
    const complaints: string[] = [];
    for (const t of TEMPLATES) {
      const byId = new Map<string, any>(t.nodes.map((n: any) => [n.id, n]));
      const steps = t.nodes
        .filter((n: any) => n.data.type !== 'prompt')
        .map((n: any) => {
          const ins = t.edges.filter((e: any) => e.target === n.id);
          const promptSrc = ins
            .map((e: any) => byId.get(e.source))
            .find((s: any) => s?.data?.type === 'prompt');
          return {
            id: n.id,
            type: n.data.type === 'generate' ? 'generate' : n.data.type,
            media: n.data.mediaType,
            platform: n.data.platform,
            label: n.data.label,
            prompt: promptSrc ? promptSrc.data.text : undefined,
            voice: n.data.voice,
            cast: n.data.cast,
            audioMode: n.data.audioMode,
            inputs: ins
              .map((e: any) => e.source)
              .filter((id: string) => byId.get(id)?.data?.type !== 'prompt'),
            startFrame: n.data.creationType === 'frames'
              ? ins.find((e: any) => e.targetHandle === 'frame_start')?.source : undefined,
            endFrame: n.data.creationType === 'frames'
              ? ins.find((e: any) => e.targetHandle === 'frame_end')?.source : undefined,
          };
        });
      for (const p of checkPlan({ steps } as Plan)) {
        complaints.push(`${t.id}: ${p.code}${p.step ? ` on ${p.step}` : ''}`);
      }
    }
    expect(complaints).toEqual([]);
  });
});
