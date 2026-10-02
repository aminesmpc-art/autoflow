import { refinePlan } from '../studio/builder/refine';
import { checkPlan } from '../studio/builder/check';
import type { Plan } from '../studio/builder/plan';

const plan: Plan = { name: 'Edited ad', steps: [
  { id: 'clip', type: 'generate', media: 'video', platform: 'flow',
    prompt: 'A friendly cartoon astronaut waves at the camera inside a brightly lit space station.', duration: '4s' },
] };

it('returns both the compiled canvas and the updated editable plan', async () => {
  const ask = jest.fn().mockResolvedValue(JSON.stringify(plan));
  const result = await refinePlan('Make the clip four seconds', ask);
  expect(result.plan.steps[0].duration).toBe('4s');
  expect(result.template.nodes.find(n => n.id === 'clip')?.data.duration).toBe('4s');
  expect(ask).toHaveBeenCalledTimes(1);
});

it('repairs malformed replies and broken wiring before accepting the edit', async () => {
  const broken = { ...plan, steps: [{ ...plan.steps[0], inputs: ['missing'] }] };
  const ask = jest.fn().mockResolvedValueOnce('No JSON here')
    .mockResolvedValueOnce(JSON.stringify(broken)).mockResolvedValueOnce(JSON.stringify(plan));
  await expect(refinePlan('Edit this workflow', ask)).resolves.toHaveProperty('template');
  expect(ask).toHaveBeenCalledTimes(3);
  expect(ask.mock.calls[2][0]).toContain('missing');
});

it('stops after two repairs if quality issues remain', async () => {
  const invalid = { ...plan, steps: [{ ...plan.steps[0], voice: 'Kore' }] };
  const ask = jest.fn().mockResolvedValue(JSON.stringify(invalid));
  await expect(refinePlan('Add narration', ask)).rejects.toThrow('previous workflow is kept');
  expect(ask).toHaveBeenCalledTimes(3);
  expect(ask.mock.calls[1][0]).toContain('voice');
});

it('does not retry transport failures as if they were plan problems', async () => {
  const ask = jest.fn().mockRejectedValue(new Error('Chat disconnected'));
  await expect(refinePlan('Edit', ask)).rejects.toThrow('Chat disconnected');
  expect(ask).toHaveBeenCalledTimes(1);
});

it('checks unused Directors beyond the first group', () => {
  const grouped: Plan = { steps: [
    { id: 'chief', type: 'chief', prompt: 'A short cartoon production with two directors.' },
    { id: 'first', type: 'story', inputs: ['chief'] },
    { id: 'second', type: 'story', inputs: ['chief'] },
    { id: 'clip', type: 'generate', platform: 'flow', media: 'video', inputs: ['first'] },
  ] };
  expect(checkPlan(grouped)).toEqual(expect.arrayContaining([
    expect.objectContaining({ code: 'storyUnused', step: 'second' }),
  ]));
});
