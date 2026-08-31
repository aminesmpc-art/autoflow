/**
 * The runner must outlast every adapter it waits on.
 *
 * The runner gave a text node three minutes. Every chat adapter carried a
 * ceiling of ten to fifteen — Z.AI's is fifteen, for GLM's Deep Think. So the
 * runner killed the node while the adapter was still legitimately waiting,
 * and reported "No result after 3 minutes", blaming the model for a wait the
 * extension itself had chosen to abandon.
 *
 * A thinking model could never finish. It is silent while it reasons, and
 * from outside the tab that silence is indistinguishable from nothing
 * happening.
 *
 * The failure is invisible from the code: two numbers in two files, neither
 * wrong on its own. It only shows as "this model always times out", which
 * reads like the model's fault. So it is checked here.
 */

/// <reference types="node" />

import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';
import { TEXT_BACKSTOP_MS } from '../studio/engine/WorkflowRunner';

const CONTENT = join(__dirname, '..', 'content');

/** Every adapter that waits for a written reply, with its own ceiling. */
function ceilings(): Array<{ name: string; ms: number }> {
  const out: Array<{ name: string; ms: number }> = [];
  for (const dir of readdirSync(CONTENT)) {
    const file = join(CONTENT, dir, 'index.ts');
    if (!existsSync(file)) continue;
    const m = /TEXT_CEILING_MS\s*=\s*([\d\s*]+)/.exec(readFileSync(file, 'utf8'));
    if (!m) continue;
    // "15 * 60 * 1000" — evaluated by multiplying the literals out.
    const ms = m[1].split('*').map((x) => Number(x.trim())).reduce((a, b) => a * b, 1);
    out.push({ name: dir, ms });
  }
  return out;
}

describe('the runner waits longer than the adapters do', () => {
  it('finds the adapters at all', () => {
    // A rename that empties this list would make every assertion below vacuous.
    const found = ceilings();
    expect(found.length).toBeGreaterThan(2);
    expect(found.map((c) => c.name)).toEqual(expect.arrayContaining(['chatgpt', 'zai']));
  });

  it('outlasts every one of them', () => {
    const tooSlow = ceilings()
      .filter((c) => c.ms >= TEXT_BACKSTOP_MS)
      .map((c) => `${c.name} waits ${c.ms / 60000}min, backstop is ${TEXT_BACKSTOP_MS / 60000}min`);
    expect({ adaptersThatOutlastTheRunner: tooSlow })
      .toEqual({ adaptersThatOutlastTheRunner: [] });
  });

  it('covers Z.AI, which is the longest and the reason this exists', () => {
    const zai = ceilings().find((c) => c.name === 'zai');
    expect(zai).toBeDefined();
    // GLM's Deep Think is the slowest thing this extension drives.
    expect(TEXT_BACKSTOP_MS).toBeGreaterThan((zai as any).ms);
  });

  it('is not so long that a dead tab hangs a run', () => {
    /* The adapters end themselves after 45-60s of true silence, so this only
       fires when the content script has stopped answering entirely. It still
       must not be open-ended. */
    expect(TEXT_BACKSTOP_MS).toBeLessThanOrEqual(20 * 60 * 1000);
  });

  it('is used by the Story and Agent path, not only by a single ask', () => {
    /* askAgent is the path a Story node takes, and it had its own hardcoded
       three minutes — which is the one that actually produced the failure. */
    const runner = readFileSync(join(__dirname, '..', 'studio', 'engine', 'WorkflowRunner.ts'), 'utf8');
    const askAgent = runner.slice(runner.indexOf('private async askAgent'));
    expect(askAgent.slice(0, 1200)).toContain('TEXT_BACKSTOP_MS');
  });
});
