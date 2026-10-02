/**
 * The repair loop stops when repairing stops working.
 *
 * A retry recovers a TRANSIENT failure. Applied to a structural one it recovers
 * nothing and spends the budget finding that out — which is what three rounds
 * of contRestart on the same word cost: three asks, several minutes, and no
 * video, on a reply where four of five prompts were perfect.
 *
 * The loop now asks the question a retry loop has to ask and this one never
 * did: did anything change? These are source-text assertions because the loop
 * is a private method on the runner and the behaviour worth pinning is the
 * shape of the decision, not the plumbing around it.
 */

/// <reference types="node" />

import { readFileSync } from 'fs';
import { join } from 'path';

const SRC = readFileSync(
  join(__dirname, '..', 'studio', 'engine', 'WorkflowRunner.ts'),
  'utf8',
);

describe('the loop can tell a slow repair from one that is not happening', () => {
  it('remembers what each failing shot looked like last round', () => {
    expect(SRC).toContain('lastLook');
    expect(SRC).toMatch(/const stuck = new Set<number>\(\)/);
  });

  it('fingerprints the words as well as the codes', () => {
    /* Codes alone would call a shot stuck when the writer had moved the problem
       onto different words — which is progress, and has earned its round. */
    expect(SRC).toMatch(/\$\{pr\.code\}@\$\{pr\.matched \|\| ''\}/);
  });

  it('stops early when every remaining shot came back identical', () => {
    expect(SRC).toMatch(/stillPending\.every\(\(i\) => stuck\.has\(i\)\)/);
    /* And says why in the log, so the run is not silently shorter. */
    expect(SRC).toContain('the same problems came back on the same words');
  });
});

describe('and says which kind of failure it was', () => {
  it('names the shots that never moved', () => {
    expect(SRC).toContain('came back unchanged after being asked twice');
  });

  it('points at the rule rather than the writer', () => {
    /* The distinction that matters when somebody reads the notice: three
       attempts on a prompt that was right means the check is wrong. */
    expect(SRC).toContain('that is a rule to change, not a prompt to rewrite');
  });

  it('quotes the offending words in the failure, not only the code', () => {
    /* "(contRestart)" sends you through four hundred words looking for
       something you cannot see. */
    expect(SRC).toMatch(/spans\.length \? ` on/);
  });
});
