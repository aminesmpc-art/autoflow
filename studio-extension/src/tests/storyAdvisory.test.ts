/**
 * A run that stops six minutes in, on prompts that would have worked.
 *
 * Reported as: Claude fixed what it was asked to fix, the extension still
 * would not take it, and the whole workflow stopped there. The user's ask was
 * blunt and correct — errors like this should not halt the run.
 *
 * Two faults behind it.
 *
 * NOTHING SAID WHAT WAS WRONG. The storyboard loop wrote its verdict with
 * console.log, on the Studio page, which is the one console nobody has open.
 * The node said "Fixing the format (1 of 2)…" and that was the entire
 * account: not what failed, not whether the reply that came back was better.
 * Execution Diagnostics — the panel built for exactly this — was fed by the
 * content scripts and never by the runner.
 *
 * AND EVERY PROBLEM COUNTED THE SAME. `if (best.problems > 0) throw` stopped
 * the run when anything survived three attempts. That is right for the
 * problems it was written against: a prompt carrying a code fence or a
 * "Setup:" label gets that typed into the generator, and paying to render it
 * is worse than stopping. It is wrong for most of what the checker finds. A
 * line in a frame wider than lip sync likes, a clip that reads as more
 * produced than a phone would, an opening that never says the room is empty —
 * each makes the video less good, none of them makes it fail. Refusing to run
 * those throws away the whole piece to avoid a blemish on one shot of it.
 */

/// <reference types="node" />

import { readFileSync } from 'fs';
import { join } from 'path';
import {
  BLOCKING, blockingProblems, describeProblems, type Problem,
} from '../studio/ask/storyboard';

const RUNNER = readFileSync(
  join(__dirname, '..', 'studio', 'engine', 'WorkflowRunner.ts'), 'utf8');

const p = (code: string, shot = 1, detail = 'something'): Problem => ({ shot, code, detail });

describe('which problems are worth stopping for', () => {
  it('blocks the ones that get typed into the generator', () => {
    /* Each of these has cost a generation: the characters end up rendered as
       if they were part of the scene. */
    for (const code of ['fence', 'numbered', 'meta', 'storyboard', 'markdown',
      'placeholder', 'stageLabels', 'audioLabels', 'fileName', 'editingJargon']) {
      expect(BLOCKING.has(code)).toBe(true);
    }
  });

  it('blocks a set that is the wrong size or empty', () => {
    /* Not a judgement about the shot — there is no prompt to run. */
    for (const code of ['count', 'empty', 'thin']) expect(BLOCKING.has(code)).toBe(true);
  });

  it('lets the judgements through', () => {
    /* Every one of these renders. They are reasons to look at the result, not
       reasons to refuse to make it. */
    for (const code of ['dialogueLong', 'dialogueTooWide', 'twoSpeakers',
      'ugcProduced', 'openNotFromNothing', 'static', 'continuity', 'identity']) {
      expect(BLOCKING.has(code)).toBe(false);
    }
  });

  it('separates a mixed set into the part that stops it', () => {
    const mixed = [p('dialogueTooWide'), p('fence', 2), p('ugcProduced', 3)];
    expect(blockingProblems(mixed).map((x) => x.code)).toEqual(['fence']);
  });

  it('finds nothing to stop for in a set of judgements alone', () => {
    expect(blockingProblems([p('static'), p('continuity', 2)])).toEqual([]);
  });
});

describe('saying it where somebody can read it', () => {
  it('orders the report by shot, so it reads with the piece', () => {
    const lines = describeProblems([p('a', 3, 'third'), p('b', 1, 'first'), p('c', 2, 'second')]);
    expect(lines).toEqual(['Shot 3 third', 'Shot 1 first', 'Shot 2 second'].sort(
      (x, y) => Number(x.match(/\d/)![0]) - Number(y.match(/\d/)![0])));
  });

  it('does not invent a shot number for a problem with the whole reply', () => {
    /* shot 0 means the envelope — "there are 4 shots to write but the reply
       had 3". "Shot 0" would be a shot nobody can find. */
    expect(describeProblems([p('count', 0, 'there are 4 shots to write')]))
      .toEqual(['there are 4 shots to write']);
  });

  it('sends the runner’s verdict to the panel, not only to a console', () => {
    expect(RUNNER).toMatch(/function studioLog\(/);
    expect(RUNNER).toMatch(/type: 'STUDIO_LOG'/);
    const loop = RUNNER.slice(RUNNER.indexOf('Storyboard round '));
    expect(loop.slice(0, 900)).toMatch(/studioLog\('Story', `Round \$\{round \+ 1\}/);
  });

  it('lists each problem, not just how many there were', () => {
    /* "2 problems" is what the old console line said, and it is not enough to
       act on — the point of showing this is that the user can see whether the
       repair actually addressed anything. */
    const loop = RUNNER.slice(RUNNER.indexOf('Storyboard round '));
    expect(loop.slice(0, 900)).toMatch(/for \(const line of describeProblems\(problems\)\)/);
  });
});

describe('the run does not stop for something that would have rendered', () => {
  it('throws only when a blocking problem survives', () => {
    expect(RUNNER).toMatch(/const stillBlocking = blockingProblems\(best\.blocking\);/);
    expect(RUNNER).toMatch(/if \(stillBlocking\.length\) \{[\s\S]{0,400}throw new Error/);
  });

  it('no longer throws on a plain problem count', () => {
    /* The line this replaces. Left as an explicit check because it is a
       one-word edit away from coming back. */
    expect(RUNNER).not.toMatch(/still fail the format check after/);
    /* The block itself, not a fixed window — 400 characters ran on into the
       next guard and found its throw, which would have passed for the wrong
       reason if the two had been the other way round. */
    const at = RUNNER.indexOf('if (best.problems > 0) {');
    const block = RUNNER.slice(at, RUNNER.indexOf('\n    }', at));
    expect(block).not.toContain('throw new Error');
    expect(block).toContain('studioLog');
  });

  it('says out loud that it is proceeding, and with what', () => {
    const at = RUNNER.indexOf('if (best.problems > 0) {');
    const block = RUNNER.slice(at, RUNNER.indexOf('\n    }', at));
    expect(block).toMatch(/studioLog\('Story', `Running with/);
    expect(block).toMatch(/none of them stops a clip rendering/);
  });

  it('still refuses to spend on a fence or a stage label', () => {
    /* The trade this preserves. A prompt carrying "```" renders those
       characters, every time, for real money. */
    const at = RUNNER.indexOf('const stillBlocking');
    const block = RUNNER.slice(at, at + 700);
    expect(block).toMatch(/would be typed `\s*\+ `into the generator/);
    expect(block).toMatch(/rather than spending \$\{targets\.length\} generations/);
  });

  it('keeps the genuine dead end, and now says which shot it is', () => {
    /* There used to be two errors here: "could not get N usable prompts" and
       "only N of M came back". The ledger collapses them into one, because
       with per-shot banking they are the same condition measured twice — the
       run stops when some shot never came good, whether that is one of them or
       all of them.

       What is new is that it names them. The old message was true of a reply
       where fifteen of sixteen shots were perfect and told nobody which one to
       look at. */
    expect(RUNNER).toMatch(/prompts came back usable from \$\{platform\}/);
    expect(RUNNER).toMatch(/Still wrong: \$\{detail\}/);
    const at = RUNNER.indexOf('if (!best) {');
    const block = RUNNER.slice(at, at + 900);
    expect(block).toMatch(/unresolved\.get\(i\)/);       // the codes that failed
    expect(block).toMatch(/targets\[i\]\.label/);        // named, not numbered
    expect(block).toMatch(/Nothing was run/);
  });
});
