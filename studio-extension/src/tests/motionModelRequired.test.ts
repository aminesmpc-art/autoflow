/**
 * "The Motion Control extension doesn't switch to Omni 1.1 in the setup. Why?"
 *
 * Checked live on Flow (2026-10-14): the model button, its menu and the
 * adapter's clicks all work, and switching Veo 3.1 - Lite <-> Omni 1.1 Flash
 * landed every time. What did not exist was any answer for an account whose
 * Flow does not offer the model: setModel logged "not in menu. Using current"
 * and the piece generated with whatever Flow had selected.
 *
 * Motion now marks the model as required. When it cannot be selected, the run
 * stops before anything is submitted, names the models Flow offers, and Motion
 * stops the whole job instead of failing every piece on the same wall.
 */

/// <reference types="node" />

import { readFileSync } from 'fs';
import { join } from 'path';

import { MODEL_UNAVAILABLE, modelUnavailableMessage } from '../content/flow/automation';

const read = (...parts: string[]) => readFileSync(join(__dirname, '..', ...parts), 'utf8');
const AUTOMATION = read('content', 'flow', 'automation.ts');
const RUNNER = read('studio', 'engine', 'WorkflowRunner.ts');

describe('the message', () => {
  it('names the model, what Flow offers, and that nothing was generated', () => {
    expect(modelUnavailableMessage('Omni 1.1 Flash', ['Veo 3.1 - Lite', 'Veo 3.1 - Fast'])).toBe(
      'Omni 1.1 Flash is not available in this Flow account: Flow offers Veo 3.1 - Lite, Veo 3.1 - Fast. '
      + 'Nothing was generated. Use a Google account whose Flow offers Omni 1.1 Flash, then retry.');
  });

  it('says so plainly when the model list itself could not be opened', () => {
    expect(modelUnavailableMessage('Omni 1.1 Flash', []))
      .toMatch(/^Could not open Flow's model list to select Omni 1\.1 Flash, so nothing was generated\./);
  });

  it('is the text the Motion runner stops on', () => {
    expect(RUNNER).toContain(`why.includes('${MODEL_UNAVAILABLE}')`);
  });
});

describe('the adapter', () => {
  it('records the give-up in both places setModel used to carry on quietly', () => {
    expect(AUTOMATION).toMatch(/Model dropdown not found\. Using Flow default\.'\);\s*if \(!overrideTrigger\) this\.modelUnavailable = \{ wanted: modelName, offered: \[\] \};/);
    expect(AUTOMATION).toMatch(/not in menu\. Using current: \$\{currentModelRaw\}`\);\s*if \(!overrideTrigger\) this\.modelUnavailable = \{ wanted: modelName, offered \};/);
  });

  it('reads the offered names without Flow\'s icon text', () => {
    const clean = (t: string) => t.replace(/\b[a-z]+(?:_[a-z]+)+(?=[A-Z0-9])/g, '').replace(/arrow_drop_down/g, '').trim();
    expect(AUTOMATION).toContain(".replace(/\\b[a-z]+(?:_[a-z]+)+(?=[A-Z0-9])/g, '')");
    expect(clean('volume_upOmni 1.1 Flash')).toBe('Omni 1.1 Flash');
    expect(clean('volume_upVeo 3.1 - Lite')).toBe('Veo 3.1 - Lite');
    expect(clean('Nano Banana Pro')).toBe('Nano Banana Pro');
  });

  it('stops before the first prompt when a required model is missing, and only then', () => {
    const stop = AUTOMATION.indexOf('if (this.queue.settings.modelRequired && this.modelUnavailable) {');
    expect(stop).toBeGreaterThan(AUTOMATION.indexOf('const settingsOk = await this.applyAllSettings(this.queue.settings);'));
    expect(stop).toBeLessThan(AUTOMATION.indexOf('Capture baseline tile count before processing any prompts'));
    expect(AUTOMATION.slice(stop, stop + 600)).toMatch(/this\.stopped = true;[\s\S]*updatePromptStatus\(i, 'failed', msg\)/);
  });
});

describe('Motion asks for it', () => {
  it('marks Omni 1.1 Flash as required on every piece', () => {
    const body = RUNNER.slice(RUNNER.indexOf('private async executeMotionNode'), RUNNER.indexOf('private async askAgent('));
    expect(body).toMatch(/model: 'Omni 1\.1 Flash',[\s\S]{0,1200}modelRequired: true,/);
  });

  it('passes the flag through to the queue settings', () => {
    expect(read('content', 'flow', 'index.ts')).toContain('modelRequired: config.modelRequired === true,');
  });
});
