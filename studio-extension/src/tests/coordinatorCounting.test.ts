/**
 * "THE COUNTING IS SO WRONG"
 *
 * v1.5.0 moved the run loop into the service worker. The counting did not all
 * come with it, and the ledger came apart in three places at once.
 *
 * ── 1. Submissions stopped being reported ───────────────────────────────
 *
 * The canvas runner reports two things per finished node: trackUsage, which
 * settles the prompt the server pre-charged, and trackSubmission, which says
 * a generation reached Flow. The coordinator was written with the first and
 * not the second — so every delegated run, which since v1.5.0 is every
 * ordinary run, counted its prompts and reported none of its generations.
 * "SENT TO FLOW" read 0, which is the regression this had before.
 *
 * ── 2. Failed nodes never settled ───────────────────────────────────────
 *
 * The charge is taken for the whole run up front, as one pending event per
 * node that will run. The coordinator settled only successes, so a failed
 * node left its event pending for ever and the run never reconciled.
 *
 * A SKIPPED node is different and is deliberately left pending — see below.
 *
 * ── 3. The backend contradicted itself ──────────────────────────────────
 *
 *     nodes_to_charge = node_count if not profile.is_pro else generate_count
 *     usage.text_prompts_used += nodes_to_charge     # all canvas nodes
 *     for i in range(max(1, generate_count or 1)):   # only runnable ones
 *
 * The counter and the event log are the two numbers the daily limit and the
 * dashboard are read from, and for a free user they disagreed permanently.
 * Worse, the extension settles ONE event per node it runs: when there are
 * more settles than pendings the surplus falls into ConsumePromptView's "no
 * pending found" branch and CREATES events. That is the multiplication that
 * made the dashboard read several times the real figure.
 */

/// <reference types="node" />

import { readFileSync } from 'fs';
import { join } from 'path';

const read = (...p: string[]) =>
  readFileSync(join(__dirname, '..', ...p), 'utf8').replace(/\r\n/g, '\n');

const COORD = read('background', 'runCoordinator.ts');
const RUNNER = read('studio', 'engine', 'WorkflowRunner.ts');
const SERVICES = readFileSync(
  join(__dirname, '..', '..', '..', 'backend', 'apps', 'plans', 'services.py'), 'utf8'
).replace(/\r\n/g, '\n');

/** The body of consume_studio_run, so a match cannot drift in from a sibling. */
function consumeStudioRun(): string {
  const at = SERVICES.indexOf('def consume_studio_run');
  expect(at).toBeGreaterThan(-1);
  const next = SERVICES.indexOf('\ndef ', at + 10);
  return SERVICES.slice(at, next === -1 ? undefined : next);
}

describe('the worker reports what the canvas reports', () => {
  it('reports the generation as a Flow submission', () => {
    expect(COORD).toMatch(/trackSubmission\(\{/);
  });

  it('reports it only when there is a media id', () => {
    /* A chat round-trip never gets one, and must not land in a number that
       counts billable generations. */
    const at = COORD.indexOf('trackSubmission({');
    const before = COORD.slice(Math.max(0, at - 400), at);
    expect(before).toMatch(/if \(mediaId\)/);
  });

  it('uses the same queue id shape as the canvas path', () => {
    /* One definition of "sent to Flow", so the dashboard cannot tell which
       execution path produced a row. */
    expect(COORD).toMatch(/queueId: `studio:\$\{manifest\.workflowId\}`/);
    expect(RUNNER).toMatch(/queueId: `studio:\$\{useStudioStore\.getState\(\)\.workflow\.id\}`/);
  });

  it('marks a video or image node as a full prompt, like the canvas does', () => {
    for (const src of [COORD, RUNNER]) {
      expect(src).toMatch(/mediaType === 'video' \|\| .*mediaType === 'image'/);
    }
  });

  it('settles a node that ran and failed', () => {
    const at = COORD.indexOf("this.failedNodes.add(step.nodeId);\n              this.updateNodeStatus");
    expect(at).toBeGreaterThan(-1);
    expect(COORD.slice(at, at + 900)).toMatch(/trackUsage\(1, 'text', 'failed'\)/);
  });

  it('leaves a SKIPPED node pending, exactly as the canvas runner does', () => {
    /* Not an oversight in either place. The dashboard totals done|failed and
       shows pending separately as "charged but never sent" — which is what a
       node that never ran is. Settling it would count it as submitted. */
    const at = COORD.indexOf("errorMessage: 'Upstream dependency failed'");
    expect(at).toBeGreaterThan(-1);
    const branch = COORD.slice(at, at + 700);
    expect(branch).not.toMatch(/trackUsage\(/);
    expect(branch).toMatch(/pending/);
  });
});

describe('the backend charges what the extension will settle', () => {
  it('charges the nodes that run, for free and pro alike', () => {
    const body = consumeStudioRun();
    expect(body).toMatch(/nodes_to_charge = generate_count or 0/);
  });

  it('no longer charges a free user for every node on the canvas', () => {
    /* Prompt and Image nodes only carry data and never reach a service. */
    const body = consumeStudioRun();
    expect(body).not.toMatch(/nodes_to_charge = node_count if not profile\.is_pro/);
  });

  it('creates one pending event per charged node, so the two agree', () => {
    const body = consumeStudioRun();
    const charge = body.indexOf('nodes_to_charge = generate_count');
    const loop = body.indexOf('for i in range(');
    expect(charge).toBeGreaterThan(-1);
    expect(loop).toBeGreaterThan(charge);
    /* Same source number on both sides of the ledger. */
    expect(body.slice(loop, loop + 120)).toMatch(/generate_count/);
  });

  it('still gates workflow SIZE on every node', () => {
    /* node_count keeps its other job — the free-tier cap on how big a
       workflow may be — which is a different question from what it costs. */
    const body = consumeStudioRun();
    expect(body).toMatch(/if node_count > nodes_remaining_today/);
  });
});
