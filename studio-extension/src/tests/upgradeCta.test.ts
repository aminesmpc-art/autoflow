/**
 * @jest-environment jsdom
 */

/**
 * Asking for the sale, at the only moment it is a fair question.
 *
 * The panel had an upgrade API — getUpgradeTarget, getUpgradeUrl — and no
 * call to action anywhere in the main flow. The plan and the run count were
 * shown; nothing ever offered the next step.
 *
 * It appears when a free account is near its ceiling and not before. Someone
 * with forty runs left does not need selling to, and a button that is always
 * on screen stops being read — by the time it matters it has become furniture.
 * Near the limit it is not an advert, it is the answer to the question the
 * user is about to ask.
 */

/// <reference types="node" />

import { readFileSync } from 'fs';
import { join } from 'path';

const DIST = join(__dirname, '../../dist');
const SRC = readFileSync(join(__dirname, '..', 'sidepanel', 'index.ts'), 'utf8');
const CSS = () => readFileSync(join(DIST, 'sidepanel.css'), 'utf8');

function mountPanel(): void {
  document.head.innerHTML = '';
  const doc = new DOMParser().parseFromString(
    readFileSync(join(DIST, 'sidepanel.html'), 'utf8'), 'text/html');
  doc.querySelectorAll('script').forEach((s) => s.remove());
  document.body.innerHTML = doc.body.innerHTML;
  const style = document.createElement('style');
  style.textContent = CSS();
  document.head.append(style);
}

describe('the call to action', () => {
  beforeEach(mountPanel);

  it('exists, and ships hidden', () => {
    const btn = document.getElementById('foot-upgrade') as HTMLButtonElement;
    expect(btn.tagName).toBe('BUTTON');
    expect(btn.hidden).toBe(true);
  });

  it('is never shown to somebody who already paid', () => {
    /* Selling Pro to a Pro account is the fastest way to be ignored. */
    expect(SRC).toMatch(/const near = !isPro &&/);
  });

  it('appears near the ceiling, not from the first run', () => {
    /* A fifth of the allowance, floored at three, so it behaves on a small
       limit as well as a large one. */
    expect(SRC).toMatch(/left <= Math\.max\(3, Math\.round\(limit \* 0\.2\)\)/);
  });

  it('says how little is left, because that is the reason to act', () => {
    expect(SRC).toMatch(/\$\{left\} left — go Pro/);
  });

  it('changes when there is nothing left, because it stops being a nudge', () => {
    /* At zero it is not a suggestion, it is the explanation for why nothing
       is happening. */
    expect(SRC).toMatch(/left === 0 \? 'Out of runs — go Pro'/);
    expect(SRC).toMatch(/sp-foot__up--out/);
    expect(CSS()).toMatch(/\.sp-foot__up--out/);
  });

  it('goes where the server says, not to a hardcoded page', () => {
    /* getUpgradeUrl is the backend's own answer, which can change with the
       plan or the account. The literal is only the fallback. */
    expect(SRC).toMatch(/await getUpgradeUrl\(\)\.catch\(\(\) => ''\)/);
    expect(SRC).toMatch(/url \|\| 'https:\/\/auto-flow\.studio'/);
  });
});
