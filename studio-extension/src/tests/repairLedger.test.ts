/**
 * Repairing the broken shot instead of the whole set.
 *
 * `repairMessage` used to end "send the whole object again", so one bad line in
 * shot 7 re-asked for all sixteen — the most expensive possible reply to fix the
 * smallest possible problem, at the moment the reply is already at its longest.
 * And `best` was a whole-set snapshot, so a run where shot 1 came back clean in
 * round 1 and shot 3 came back clean in round 2 kept one and discarded the
 * other, while holding both.
 *
 * The ledger banks each shot as it passes and re-asks only what is missing.
 * That makes the reply a partial one, which creates the problem these tests
 * exist for: a reply carrying two of sixteen shots says nothing about WHICH two
 * except by title, by `n`, or by arrival order.
 *
 * The trap is `n`. parseShots defaults a missing `n` to the array index, so a
 * two-shot reply always claims to be shots 1 and 2 whatever it actually holds.
 * Trusting it first would overwrite a good shot 1 with a repair meant for shot
 * 7 — a wrong prompt on a shot that was already right, which is worse than the
 * failure being repaired.
 */

/// <reference types="node" />

import { readFileSync } from 'fs';
import { join } from 'path';

import { placeShots, repairMessage, type Shot, type ShotTarget, type Problem } from '../studio/ask/storyboard';

const target = (id: string, label: string): ShotTarget => ({
  id, label, media: 'video', platform: 'flow',
});

const TARGETS = [
  target('a', 'Hero still'),
  target('b', 'Macro sole close-up'),
  target('c', 'Rotating push-in'),
  target('d', 'Court reveal pull-back'),
];

const shot = (n: number, title: string, prompt = 'she lifts the jar'): Shot => ({ n, title, prompt });

describe('placing a partial reply', () => {
  it('matches by title, which is the only thing that is actually reliable', () => {
    const placed = placeShots([shot(1, 'Rotating push-in')], [2, 3], TARGETS);
    expect(placed.get(2)?.title).toBe('Rotating push-in');
    expect(placed.has(3)).toBe(false);
  });

  it('ignores a defaulted `n` that would land on a banked shot', () => {
    /* THE trap. Shots 0 and 1 are banked; 2 and 3 are still wanted. The model
       sends the two repairs and parseShots stamps them n=1 and n=2, meaning
       "shot 1" and "shot 2" — both already accepted. Following `n` here
       replaces two good shots and leaves the two broken ones untouched. */
    const reply = [shot(1, 'Rotating push-in'), shot(2, 'Court reveal pull-back')];
    const placed = placeShots(reply, [2, 3], TARGETS);

    expect(placed.get(2)?.title).toBe('Rotating push-in');
    expect(placed.get(3)?.title).toBe('Court reveal pull-back');
    expect(placed.has(0)).toBe(false);
    expect(placed.has(1)).toBe(false);
  });

  it('uses `n` when the title is no help and it lands somewhere wanted', () => {
    const placed = placeShots([shot(3, 'Untitled')], [2, 3], TARGETS);
    expect(placed.get(2)?.n).toBe(3);
  });

  it('will not let `n` reach a slot that is not pending', () => {
    const placed = placeShots([shot(1, 'Untitled')], [3], TARGETS);
    expect(placed.has(0)).toBe(false);
    expect(placed.get(3)?.n).toBe(1);   // fell through to the only free slot
  });

  it('falls back to arrival order once title and n are exhausted', () => {
    const placed = placeShots([shot(9, 'Nope'), shot(9, 'Also nope')], [1, 2], TARGETS);
    expect(placed.get(1)?.title).toBe('Nope');
    expect(placed.get(2)?.title).toBe('Also nope');
  });

  it('never places more shots than there are slots waiting', () => {
    const placed = placeShots(
      [shot(1, 'x'), shot(2, 'y'), shot(3, 'z')], [3], TARGETS,
    );
    expect(placed.size).toBe(1);
  });

  it('places nothing when nothing is pending', () => {
    expect(placeShots([shot(1, 'Hero still')], [], TARGETS).size).toBe(0);
  });
});

describe('asking for only what is still wrong', () => {
  const problems: Problem[] = [
    { shot: 3, code: 'fence', detail: 'contains a code fence (```).' },
  ];

  it('names the shots wanted and refuses the rest', () => {
    const msg = repairMessage(problems, TARGETS, [3]);
    expect(msg).toMatch(/ONLY shot 3 \("Rotating push-in"\)/);
    expect(msg).toMatch(/must not be resent/);
    expect(msg).not.toMatch(/all 4 shots/);
  });

  it('asks for the "n" field, because a partial reply needs to say which it is', () => {
    expect(repairMessage(problems, TARGETS, [3])).toMatch(/"n"/);
  });

  it('pluralises, because "ONLY shots 2" reads like a bug', () => {
    const msg = repairMessage(problems, TARGETS, [2, 3]);
    expect(msg).toMatch(/ONLY shots 2 \("Macro sole close-up"\), 3 \("Rotating push-in"\)/);
  });

  it('still asks for the whole object when everything failed', () => {
    /* Nothing is banked, so there is no saving to be had and the complete
       envelope is the simpler thing to ask for. */
    const msg = repairMessage(problems, TARGETS, [1, 2, 3, 4]);
    expect(msg).toMatch(/all 4 shots/);
    expect(msg).not.toMatch(/must not be resent/);
  });

  it('behaves exactly as before when no subset is given', () => {
    const msg = repairMessage(problems, TARGETS);
    expect(msg).toMatch(/all 4 shots/);
    expect(msg).not.toMatch(/must not be resent/);
  });

  it('still leads with what was actually wrong', () => {
    expect(repairMessage(problems, TARGETS, [3])).toMatch(/Shot 3:[\s\S]*code fence/);
  });
});

describe('the runner banks shots rather than rounds', () => {
  const RUNNER = readFileSync(
    join(__dirname, '..', 'studio', 'engine', 'WorkflowRunner.ts'), 'utf8',
  );

  it('accepts a shot only when nothing blocking is wrong with it', () => {
    expect(RUNNER).toMatch(/if \(blockingProblems\(mine\)\.length\) \{[\s\S]{0,120}unresolved\.set/);
    expect(RUNNER).toMatch(/accepted\.set\(i, sh\)/);
  });

  it('re-asks only the shots it has not banked', () => {
    expect(RUNNER).toMatch(/const stillPending = targets[\s\S]{0,120}!accepted\.has\(i\)/);
    expect(RUNNER).toMatch(/repairMessage\(outstanding, targets, stillPending\.map/);
  });

  it('does not re-state problems belonging to shots already banked', () => {
    /* Re-sending a settled problem invites the model to change something
       nobody asked it to touch. */
    expect(RUNNER).toMatch(/p\.shot === 0 \|\| stillPending\.includes\(p\.shot - 1\)/);
  });

  it('stops RESCUING as soon as every shot is banked', () => {
    /* This used to be the whole exit — `if (accepted.size === targets.length)
       break` — and that is why a run could bank thirteen prompts carrying six
       fixable notes and never mention them again: with nothing left to rescue
       there was nothing left to ask. The branch now decides between stopping
       and one improvement round; storyPolish.test.ts covers what it decides.
       What has not changed is that a banked shot is never re-rescued. */
    const at = RUNNER.indexOf('if (accepted.size === targets.length) {');
    expect(at).toBeGreaterThan(-1);
    const block = RUNNER.slice(at, RUNNER.indexOf('\n      }', at));
    expect(block).toMatch(
      /if \(!fixable\.length \|\| polishRounds >= MAX_POLISH \|\| round === MAX_REPAIRS\) break;/);
    expect(block).not.toMatch(/unresolved/);
  });

  it('keeps what is banked when a repair turn dies', () => {
    /* A repair turn that never arrives costs us the shots it was going to fix,
       not the ones already accepted. It used to guard on `best`, which no
       longer exists until after the loop. */
    const marker = RUNNER.indexOf('Storyboard repair round');
    expect(marker).toBeGreaterThan(-1);
    const at = RUNNER.lastIndexOf('} catch (err: any) {', marker);
    const block = RUNNER.slice(at, RUNNER.indexOf('throw err;', marker));
    expect(block).toMatch(/if \(accepted\.size\) \{/);
    expect(block).toMatch(/prompts already accepted/);
    expect(block).toMatch(/break;/);
    expect(block).not.toMatch(/\bbest\b/);
  });
});
