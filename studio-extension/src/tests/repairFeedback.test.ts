/**
 * A repair message has to say which WORDS broke the rule.
 *
 * The failure this exists for ran three times and generated nothing. The
 * writer was told "opens as though the scene were starting — describe what is
 * already there", and it had described what was already there; the trigger was
 * one word, `leveled`, inside the handover sentence the brief requires it to
 * repeat verbatim. Nothing in the message pointed at it, so every attempt
 * reworded the part that was already right and kept the part that was not.
 *
 * This is the first practice in every account of repair loops that converge:
 * feed back the error AND the offending span. A rule name tells the writer a
 * rule exists. The span tells it what to change — and only the second one
 * ends the loop.
 *
 * So these tests are about the message, not the check. What matters is that a
 * writer reading it can find the words without re-reading its own prompt.
 */

import {
  checkShots, repairMessage, triggerText, type Shot, type ShotTarget,
} from '../studio/ask/storyboard';

const clip = (over: Partial<ShotTarget> = {}): ShotTarget => ({
  id: 'x', media: 'video', platform: 'flow', label: 'Clip', ...over,
});

const FIRST =
  'The camera is stationary and locked in place at an eye-level thirty-degree corner angle on a '
  + 'heavy tripod. Hands in matte grey gloves tie steel rebar grids and a steel trowel smooths the '
  + 'wet concrete in one clean stroke, leaving a finished rectangular concrete foundation slab with '
  + 'steel anchor bolts protruding. Ambient noise: light wind. SFX: the scrape of a steel trowel.';

/* A continuation that genuinely restarts — the case the rule is FOR. */
const RESTARTED =
  'The camera is stationary and locked in place at an eye-level thirty-degree corner angle on a '
  + 'heavy tripod. The plot is untouched bare earth with nothing built on it at all, and hands in '
  + 'matte grey gloves begin marking the first trench lines across the open soil in fast motion. '
  + 'Ambient noise: wind across open ground. SFX: a spade cutting soil.';

const targets = [
  clip({ id: 'a', label: 'Phase 1' }),
  clip({ id: 'b', label: 'Phase 2', role: 'continuation', continues: 'Phase 1' }),
];

const shotsWith = (second: string): Shot[] => [
  { n: 1, title: 'Phase 1', prompt: FIRST },
  { n: 2, title: 'Phase 2', prompt: second },
];

describe('a problem carries the words that caused it', () => {
  it('quotes the offending span, not just the rule name', () => {
    const problems = checkShots(shotsWith(RESTARTED), targets);
    const restart = problems.find((p) => p.code === 'contRestart');

    expect(restart).toBeDefined();
    expect(restart!.matched).toBeTruthy();
    /* The words that actually tripped it, findable in the prompt by eye. */
    expect(RESTARTED).toContain(restart!.matched as string);
  });

  it('puts them in the repair message, with an instruction to change only those', () => {
    const problems = checkShots(shotsWith(RESTARTED), targets);

    const message = repairMessage(problems, targets, [2]);

    expect(message).toMatch(/The words that read that way: “[^”]+”/);
    expect(message).toContain('Change those specific words');
  });
});

describe('the span is worth reading', () => {
  it('carries context either side, so it can be found in a long prompt', () => {
    const prompt = 'one two three four FIVE six seven eight nine';
    const hit = /FIVE/.exec(prompt) as RegExpExecArray;

    expect(triggerText(prompt, hit, 2)).toBe('three four FIVE six seven');
  });

  it('is absent when the rule fired on something MISSING', () => {
    /* Some rules match zero-length — a bare negative lookahead is one. Quoting
       "the first four words" there would invent a trigger and send the writer
       to change something innocent. */
    const hit = /(?=x)?/.exec('a prompt with no x in it at all') as RegExpExecArray;

    expect(hit[0]).toBe('');
    expect(triggerText('a prompt with no x in it at all', hit)).toBeUndefined();
  });

  it('says nothing extra for a problem that has no span', () => {
    /* contBreak is "never says it carries on" — an absence. The message must
       not sprout an empty quotation for it. */
    const message = repairMessage(
      [{ shot: 2, code: 'contBreak', detail: 'never says it carries on.' }],
      targets,
      [2],
    );

    expect(message).not.toContain('The words that read that way');
  });
});
