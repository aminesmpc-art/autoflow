/**
 * @jest-environment jsdom
 *
 * "he dont click on the generete botton why"
 *
 * With Flow's Agent on, the prompt bar has no settings chip, so a run cannot
 * set the model and stops before it types or presses Generate. The adapter
 * turns Agent off first — but it looked for a `.content` span the chip no
 * longer has, and took only the first pressed button on the page. Fixtures are
 * the live chip, read on flow.google.com on 2026-10-18.
 */
/// <reference types="node" />
import { readFileSync } from 'fs';
import { join } from 'path';
import { findActiveAgentToggle } from '../content/flow/selectors';

const OFF = '<button class="agent-mode-chip" aria-pressed="false"><!----><span class="agent-mode-chip-label">Agent</span></button>';
const ON = '<button class="agent-mode-chip agent-mode-chip-checked" aria-pressed="true">'
  + '<div class="glow-outline glow-outline-narrow"></div><div class="glow-outline glow-outline-wide"></div>'
  + '<span class="agent-mode-chip-label">Agent</span></button>';

describe('the Agent chip', () => {
  it('is found when on, by its own markup', () => {
    document.body.innerHTML = ON;
    expect(findActiveAgentToggle()?.className).toContain('agent-mode-chip');
  });

  it('is left alone when off', () => {
    document.body.innerHTML = OFF;
    expect(findActiveAgentToggle()).toBeNull();
  });

  it('is found behind another pressed button', () => {
    document.body.innerHTML = '<button aria-pressed="true">Bold</button>' + ON;
    expect(findActiveAgentToggle()?.textContent?.trim()).toBe('Agent');
  });

  it('still reads the older markup', () => {
    document.body.innerHTML = '<button aria-pressed="true"><span class="content">Agent</span></button>';
    expect(findActiveAgentToggle()).not.toBeNull();
  });
});

describe('who turns it off', () => {
  const FLOW = join(__dirname, '..', 'content', 'flow');
  const index = readFileSync(join(FLOW, 'index.ts'), 'utf8');
  const automation = readFileSync(join(FLOW, 'automation.ts'), 'utf8');

  it('the page watcher only during a run, so Agent stays usable otherwise', () => {
    expect(index).toMatch(/if \(isRunLocked\(\)\) findActiveAgentToggle\(\)\?\.click\(\);/);
    expect(index).not.toMatch(/querySelector\('\.content'\)/);
  });

  it('the run, before it looks for the prompt box', () => {
    const ready = automation.slice(automation.indexOf('// 2. Deactivate "Agent" mode'), automation.indexOf('// 3. Now that we are sure'));
    expect(ready).toMatch(/const agentBtn = findActiveAgentToggle\(\);/);
    expect(ready).toMatch(/agentBtn\.click\(\);/);
  });
});
