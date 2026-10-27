/// <reference types="node" />
/**
 * What Motion does with the provider tabs while a job works in them.
 *
 * First the user asked for "work fully in the background without me to see
 * the tab" (0.1.10). Then: "if the work is in Gemini it is not switching to
 * it, and if in Flow it is not switching to it". So following the work is the
 * former default; background is now the new-install default, preserving an explicit show choice. ChatGPT is not hidden-tab safe, so
 * its tab keeps coming forward as it always did.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { backgroundAllowed, readChoice, loadTabsChoice, TABS_CHOICE_KEY, TABS_FOLLOW_VERSION_KEY, workerFlags } from '../src/backgroundTabs';

describe('what the shared worker is told', () => {
  it.each(['gemini', 'claude'])('keeps the working tab with %s in front using the original foreground behavior', platform => {
    expect(workerFlags('show', platform)).toEqual({ af_background_tabs: false, af_background_strict: false });
  });

  it.each(['gemini', 'claude'])('never switches in background mode with %s', platform => {
    expect(workerFlags('background', platform)).toEqual({ af_background_tabs: true, af_background_strict: true });
  });

  it('keeps ChatGPT in front, whatever the choice', () => {
    expect(backgroundAllowed('chatgpt')).toBe(false);
    for (const choice of ['show', 'background'] as const) {
      expect(workerFlags(choice, 'chatgpt')).toEqual({ af_background_tabs: false, af_background_strict: false });
    }
  });
});

describe('the choice', () => {
  it('defaults to showing the work and permits an explicit background choice', () => {
    expect(TABS_CHOICE_KEY).toBe('af_motion_tabs');
    expect(readChoice(undefined)).toBe('show');
    expect(readChoice('show')).toBe('show');
    expect(readChoice('background')).toBe('background');
    expect(readChoice(true)).toBe('show');
  });

  it('restores following work once on upgrade, then respects a later background selection', async () => {
    const stored: Record<string, unknown> = { [TABS_CHOICE_KEY]: 'background' };
    (globalThis as any).chrome = { storage: { local: {
      get: jest.fn(async () => ({ ...stored })),
      set: jest.fn(async values => { Object.assign(stored, values); }),
    } } };
    expect(await loadTabsChoice()).toBe('show');
    expect(stored[TABS_FOLLOW_VERSION_KEY]).toBe(true);
    stored[TABS_CHOICE_KEY] = 'background';
    expect(await loadTabsChoice()).toBe('background');
    expect(chrome.storage.local.set).toHaveBeenCalledTimes(1);
  });
});

describe('the panel', () => {
  const APP = readFileSync(join(__dirname, '..', 'src', 'App.tsx'), 'utf8');

  it('writes nothing until the choice has been read, then follows it and the engine', () => {
    expect(APP).toMatch(/loadTabsChoice\(\)\.then\(setTabsChoice\)/);
    expect(APP).toMatch(/if \(!extension \|\| tabsChoice === null\) return;\s*void chrome\.storage\.local\.set\(workerFlags\(tabsChoice, data\.platform\)\)/);
    expect(APP).toMatch(/\}, \[tabsChoice, data\.platform\]\);/);
  });

  it('offers both, and says why ChatGPT stays in front', () => {
    expect(APP).toMatch(/<option value="show">Show the working tab<\/option><option value="background">Work in the background<\/option>/);
    expect(APP).toMatch(/ChatGPT needs its tab in front/);
  });

  it('shows what needs a person instead of grabbing the screen, with a button only when there is a tab to open', () => {
    expect(APP).toMatch(/msg\?\.type !== 'PANEL_RUN_STATE'/);
    expect(APP).toMatch(/canOpen: typeof msg\.payload\?\.attentionTabId === 'number'/);
    expect(APP).toMatch(/\{attention\.canOpen && <button[^>]*onClick=\{\(\) => \{ void chrome\.runtime\.sendMessage\(\{ type: 'PANEL_OPEN_ATTENTION_TAB' \}\)/);
  });
});
