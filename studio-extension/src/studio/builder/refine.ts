import { readPlan, compilePlan, type Plan } from './plan';
import { checkPlan, repairPlanMessage } from './check';
import { productionSkills } from './productionSkills';

/**
 * Refine without replacing the working plan with an unchecked AI reply.
 *
 * `carrySkills` decides whether the production skills go along. They are a
 * couple of thousand words, and in a live thread the model was handed them
 * with the build a moment ago — repeating them on every edit buries the
 * user's actual request under a wall of text it has already read.
 *
 * Defaulted to true so a caller that does not know stays safe: a model with
 * the brief twice loses tokens, a model without it edits by guesswork.
 */
export async function refinePlan(
  request: string,
  ask: (message: string, attempt: number) => Promise<string>,
  carrySkills = true,
) {
  let message = carrySkills ? `${productionSkills()}\n\n${request}` : request;
  let problem = 'The AI did not return a usable workflow.';
  for (let attempt = 0; attempt < 3; attempt++) {
    const reply = await ask(message, attempt);
    const parsed = readPlan(reply);
    if (!parsed.plan) {
      problem = parsed.problem || problem;
      message = repairPlanMessage([], [problem]);
      continue;
    }
    const plan: Plan = parsed.plan;
    const { template, problems } = compilePlan(plan);
    const quality = checkPlan(plan);
    if (template && !problems.length && !quality.length) return { plan, template };
    problem = [...problems, ...quality.map(p => p.detail)].join('\n');
    message = repairPlanMessage(quality, problems)
      + '\nPreserve the requested edit and every unaffected step ID. Do not remove shots to hide a problem.';
  }
  throw new Error(`The edit still needs correction after three attempts. Your previous workflow is kept. ${problem}`);
}
