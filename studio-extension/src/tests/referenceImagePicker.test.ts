/** @jest-environment jsdom */
/// <reference types="node" />
import { AutomationEngine } from '../content/flow/automation';
import { openMediaDialog } from '../content/flow/libraryPicker';

jest.mock('../content/flow/libraryPicker', () => ({
  openMediaDialog: jest.fn(async () => ({ ok: true })),
  mediaDialogRoot: () => document.querySelector('[role="dialog"]'),
}));
jest.mock('../content/flow/selectors', () => ({
  ...jest.requireActual('../content/flow/selectors'),
  isVisible: () => true,
  findAssetOptions: (root: Element) => Array.from(root.querySelectorAll('[role="option"]')),
  simulateClick: (el: HTMLElement) => el.click(),
  setInputValue: async (el: HTMLInputElement, value: string) => {
    el.value = value; el.dispatchEvent(new Event('input', { bubbles: true }));
  },
}));

const ID = 'id:11111111-1111-1111-1111-111111111111';
let attached: string[];
let engine: any;

beforeEach(() => {
  jest.useFakeTimers();
  attached = [];
  engine = new AutomationEngine();
  engine.dismissDialogs = jest.fn(async () => {});
  engine.log = jest.fn();
  document.body.innerHTML = `<div role="dialog">
    <mat-list-item id="images"><mat-icon>image</mat-icon><span>Images</span></mat-list-item>
    <input class="search-input" aria-label="Search assets">
    <button role="option"><span class="asset-title">renamed</span>
      <img src="https://flow-content.google/image/${ID.slice(3)}?Signature=current"></button>
    <button id="commit">Add to prompt</button></div>`;
  (openMediaDialog as jest.Mock).mockResolvedValue({ ok: true });
});
afterEach(() => { jest.useRealTimers(); });

async function select() {
  const running = engine.selectSavedReference({ filename: 'af_saved.png', mediaId: ID }, () => attached);
  await jest.advanceTimersByTimeAsync(80_000);
  return running;
}

it('opens the image category, selects once, commits, and verifies the loaded chip', async () => {
  const tab = jest.fn();
  const pick = jest.fn();
  document.querySelector('#images')!.addEventListener('click', tab);
  document.querySelector('[role="option"]')!.addEventListener('click', pick);
  document.querySelector('#commit')!.addEventListener('click', () => { attached = [ID]; });
  expect(await select()).toBe(true);
  expect(tab).toHaveBeenCalledTimes(1);
  expect(pick).toHaveBeenCalledTimes(1);
});

it('does not toggle an already selected row off', async () => {
  const row = document.querySelector('[role="option"]')!;
  row.classList.add('asset-item-active');
  const pick = jest.fn();
  row.addEventListener('click', pick);
  document.querySelector('#commit')!.addEventListener('click', () => { attached = [ID]; });
  expect(await select()).toBe(true);
  expect(pick).not.toHaveBeenCalled();
});

it('does not report success for a click that failed to attach', async () => {
  expect(await select()).toBe(false);
});

it('does not click the first result when it is the wrong image', async () => {
  document.querySelector('img')!.src = 'https://flow-content.google/image/22222222-2222-2222-2222-222222222222';
  const click = jest.fn();
  document.querySelector('[role="option"]')!.addEventListener('click', click);
  expect(await select()).toBe(false);
  expect(click).not.toHaveBeenCalled();
});

it('attaches yesterday\'s reference when the picker and the prompt name it differently', async () => {
  /* The receipt holds the chip's /asb/ token from the first upload; the
     picker row shows a UUID; the new chip comes up under another token. The
     row is found by its name, and the one new chip is the proof. */
  document.querySelector('.asset-title')!.textContent = 'af_ref_511ae6e81a020c3f';
  const pick = jest.fn();
  document.querySelector('[role="option"]')!.addEventListener('click', pick);
  document.querySelector('#commit')!.addEventListener('click', () => { attached = ['asb:today']; });
  const running = engine.selectSavedReference(
    { filename: 'af_ref_511ae6e81a020c3f.png', mediaId: 'asb:yesterday' }, () => attached);
  await jest.advanceTimersByTimeAsync(80_000);
  expect(await running).toBe(true);
  expect(pick).toHaveBeenCalledTimes(1);
});

it('fails cleanly when the picker cannot open', async () => {
  (openMediaDialog as jest.Mock).mockResolvedValue({ ok: false, reason: 'unavailable' });
  expect(await select()).toBe(false);
});
