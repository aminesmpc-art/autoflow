/**
 * The call to action on the canvas — where the runs are actually spent.
 *
 * The panel got one first, which was the wrong surface to start with: the
 * canvas is where somebody builds, runs, and hits the ceiling. It already had
 * an Upgrade chip, and it had three problems.
 *
 * It counted the wrong way. "Runs 8/50" reads identically at 8 and at 48 —
 * the number that decides anything is the one going down.
 *
 * It never changed. A chip that looks the same on run 1 as on run 50 has
 * stopped being read by the time it matters.
 *
 * And it knew where Pro lived. Two hardcoded pricing URLs in this file, while
 * the template gallery asked getUpgradeTarget — so moving that page would have
 * fixed one conversion surface out of three.
 *
 * Plus the thing that made this urgent: FREE_LIMITS.runsPerMonth was still 10
 * after the server and the panel went to 50. The canvas is the copy that
 * actually blocks a run, so it was the one that mattered and the one missed.
 */

/// <reference types="node" />

import { readFileSync } from 'fs';
import { join } from 'path';

const CANVAS = readFileSync(
  join(__dirname, '..', 'studio', 'components', 'Canvas.tsx'), 'utf8');
const CSS = readFileSync(join(__dirname, '..', 'studio', 'studio.css'), 'utf8');

describe('it counts down, not up', () => {
  it('shows what is left', () => {
    expect(CANVAS).toMatch(/const runsLeft = Math\.max\(0, FREE_LIMITS\.runsPerMonth - runsUsed\)/);
    expect(CANVAS).toMatch(/\$\{runsLeft\} runs left/);
  });

  it('says none left rather than showing a zero', () => {
    expect(CANVAS).toMatch(/runsLeft === 0 \? 'No runs left'/);
  });

  it('scales the warning point to the allowance', () => {
    /* A fifth, floored at five, so it behaves whether free is ten or fifty. */
    expect(CANVAS).toMatch(/const LOW_RUNS = Math\.max\(5, Math\.round\(FREE_LIMITS\.runsPerMonth \* 0\.2\)\)/);
  });
});

describe('it gets louder only when it is in the way', () => {
  it('has a state for running low and a state for stopped', () => {
    /* Tied to the count, not merely present in the file. Mutation caught the
       first version of this: replacing the condition with a constant left
       every class name in place and the test passed. */
    expect(CANVAS).toMatch(/runsLeft <= LOW_RUNS \? 'studio-topbar__stat--low'/);
    expect(CANVAS).toMatch(/runsLeft <= LOW_RUNS \? 'studio-topbar__upgrade--urgent'/);
    expect(CANVAS).toMatch(/runsLeft === 0 \? 'studio-topbar__stat--maxed'/);
    expect(CSS).toMatch(/\.studio-topbar__stat--low/);
    expect(CSS).toMatch(/\.studio-topbar__upgrade--urgent/);
  });

  it('is a plain chip until then', () => {
    /* The urgent styling is a modifier, so the default stays quiet. */
    const at = CSS.indexOf('.studio-topbar__upgrade {');
    expect(CSS.slice(at, CSS.indexOf('}', at))).toMatch(/var\(--accent-14\)/);
  });

  it('changes what it says when there is nothing left', () => {
    /* "Upgrade" is a suggestion. "Get more runs" is the answer to why the
       Run button did nothing. */
    expect(CANVAS).toMatch(/runsLeft === 0 \? 'Get more runs' : 'Upgrade'/);
  });
});

describe('it asks the server where Pro is', () => {
  it('uses getUpgradeTarget, like the gallery already did', () => {
    expect(CANVAS).toMatch(/getUpgradeTarget\(\)\)\.url/);
  });

  it('keeps no hardcoded pricing link in the markup', () => {
    /* There were two. Moving that page would have fixed one surface in
       three, and nothing would have said which. */
    const markup = CANVAS.slice(CANVAS.indexOf('studio-topbar__right'));
    expect(markup).not.toMatch(/href="https:\/\/auto-flow\.studio\/pricing"/);
  });

  it('falls back to the site rather than to nothing', () => {
    const fn = CANVAS.slice(CANVAS.indexOf('const openUpgrade'));
    expect(fn.slice(0, fn.indexOf('\n  }'))).toMatch(/catch \{[^}]*\}/);
  });

  it('opens it safely', () => {
    expect(CANVAS).toMatch(/window\.open\(url, '_blank', 'noopener'\)/);
  });
});

describe('and Pro is never sold to Pro', () => {
  it('the whole block is behind the free branch', () => {
    const at = CANVAS.indexOf('{isPro ? (');
    const block = CANVAS.slice(at, at + 2600);
    expect(block.indexOf('studio-topbar__upgrade')).toBeGreaterThan(block.indexOf(') : ('));
  });
});
