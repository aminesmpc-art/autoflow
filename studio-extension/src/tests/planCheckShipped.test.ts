/**
 * Every check, run against every workflow that ships.
 *
 * check.ts carries a gravestone for a check that was deleted rather than
 * tuned, and the epitaph is the rule this file enforces: "a check that fires
 * on a dozen working workflows is worse than no check — it spends a repair
 * round on every build and asks the model to break prompts that were right."
 *
 * That check was removed after someone noticed by hand that twelve templates
 * tripped it. Nothing was watching. So this is the thing that watches: the
 * shipped templates are the best corpus of known-good workflows this repo
 * has — they were designed, built, run and kept — and any new check has to
 * pass all of them before it is allowed to speak to a model.
 *
 * A failure here is not "fix the template". It is "the check is wrong".
 */

import { BUILTIN_TEMPLATES } from '../studio/templates/index';
import { checkPlan } from '../studio/builder/check';
import type { Plan, PlanStep } from '../studio/builder/plan';

/**
 * A shipped template, read back as the plan that would have produced it.
 *
 * Templates keep the prompt in its own node joined by a text edge; a plan
 * carries it inline on the step. Everything else maps across directly. The
 * reverse is only ever approximate for fields a plan does not model, and none
 * of those are what the checks read.
 */
function planFromTemplate(t: any): Plan {
  const nodes: any[] = t.nodes || [];
  const edges: any[] = t.edges || [];
  const byId = new Map(nodes.map((n) => [n.id, n]));

  /* Prompt nodes are inlined onto whatever they feed, so they are not steps
     of their own — the same shape a plan has. */
  const promptFor = new Map<string, string>();
  for (const e of edges) {
    const from = byId.get(e.source);
    /* A prompt node keeps its text in data.text. Reading data.prompt here
       returned undefined for every template, and the whole file passed by
       describing nothing — which the mapping test below is what caught. */
    if (from?.type === 'prompt') promptFor.set(e.target, String(from.data?.text || ''));
  }

  const steps: PlanStep[] = [];
  for (const n of nodes) {
    if (n.type === 'prompt') continue;

    const incoming = edges.filter((e) => e.target === n.id && byId.get(e.source)?.type !== 'prompt');
    const inputs = incoming.map((e) => e.source);

    /* Flow's Start/End frames arrive on named handles, and a plan keeps them
       in fields of their own rather than in inputs. */
    const startFrame = incoming.find((e) => /start/i.test(String(e.targetHandle || '')))?.source;
    const endFrame = incoming.find((e) => /end/i.test(String(e.targetHandle || '')))?.source;
    const framed = new Set([startFrame, endFrame].filter(Boolean));

    steps.push({
      id: n.id,
      type: n.type,
      label: n.data?.label,
      media: n.data?.mediaType,
      platform: n.data?.platform,
      prompt: promptFor.get(n.id) || n.data?.prompt,
      model: n.data?.model,
      aspectRatio: n.data?.aspectRatio,
      duration: n.data?.duration,
      voice: n.data?.voice,
      cast: n.data?.cast,
      audioMode: n.data?.audioMode,
      extendSeconds: n.data?.extendSeconds,
      ...(startFrame ? { startFrame } : {}),
      ...(endFrame ? { endFrame } : {}),
      inputs: inputs.filter((i) => !framed.has(i)),
    } as PlanStep);
  }
  return { name: t.name, description: t.description, steps };
}

const templates = (BUILTIN_TEMPLATES as any[]).filter((t) => (t.nodes || []).length);

describe('the corpus is real', () => {
  it('there are enough shipped workflows for this to mean something', () => {
    expect(templates.length).toBeGreaterThan(10);
  });

  it('reading a template back produces the steps it has', () => {
    /* If the reverse mapping is wrong, this file passes by describing
       nothing — the worst way for a guard to fail. */
    const swap = templates.find((t) => t.id === 'tpl_outfit_swap');
    expect(swap).toBeDefined();
    const plan = planFromTemplate(swap);
    const g1 = plan.steps.find((s) => s.id === 'g1')!;
    expect(g1.media).toBe('image');
    expect(g1.prompt).toMatch(/Dress the person/);
    expect(g1.inputs).toEqual(['i1', 'i2']);
    const g2 = plan.steps.find((s) => s.id === 'g2')!;
    expect(g2.media).toBe('video');
    expect(g2.inputs).toEqual(['g1']);
  });
});

describe('no check fires on a workflow that ships', () => {
  it.each(templates.map((t) => [t.id, t]))('%s is clean', (_id, t: any) => {
    const problems = checkPlan(planFromTemplate(t));
    /* Named in the failure so a break says WHICH rule and on which step,
       rather than a bare count. */
    expect(problems.map((p) => `${p.code} on ${p.step || 'the plan'}`)).toEqual([]);
  });
});
