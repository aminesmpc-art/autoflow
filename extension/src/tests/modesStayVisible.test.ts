/**
 * Frame-to-Video and Ingredients never vanish.
 *
 * Reported on 9.1 with a screenshot: the Create tab showed two modes, not
 * four, and nothing said why. The panel hid those two whenever the check
 * on today's image prompts said no — and that check fails closed, so an
 * expired login, a network blip or a slow start hid them exactly as a spent
 * allowance did. The rule had been there since May; the modes simply looked
 * removed.
 *
 * Now an unknown allowance changes nothing (the check at Run still blocks),
 * and a spent one shows the two modes locked, a tap opening the same limit
 * dialog as every other ceiling.
 */

/// <reference types="node" />

import { readFileSync } from 'fs';
import { join } from 'path';

const codeOnly = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

const CODE = codeOnly(readFileSync(join(__dirname, '..', 'sidepanel', 'index.ts'), 'utf8').replace(/\r\n/g, '\n'));

const fn = (name: string): string => {
  const at = CODE.search(new RegExp(`(async )?function ${name}\\(`));
  expect(at).toBeGreaterThan(-1);
  const next = CODE.slice(at + 10).search(/\n(async )?function \w+\(/);
  return CODE.slice(at, next === -1 ? undefined : at + 10 + next);
};

describe('the image modes stay on screen', () => {
  it('never hides a mode card', () => {
    const gate = fn('enforceImageGate');
    expect(gate).not.toMatch(/(frameCard|ingredCard|card)\.style\.display = 'none'/);
    expect(gate).toMatch(/card\.style\.display = ''/);
  });

  it('does not read a failed check as a spent allowance', () => {
    /* checkCanGenerate fails closed with limit 0. */
    expect(fn('enforceImageGate')).toMatch(/const limitReached = !quota\.allowed && quota\.limit > 0;/);
  });

  it('locks them when the allowance really is spent', () => {
    const gate = fn('enforceImageGate');
    expect(gate).toMatch(/card\.classList\.toggle\('is-locked', limitReached\)/);
    expect(gate).toMatch(/aria-disabled/);
  });

  it('explains a locked mode with the limit dialog, not a silent no', () => {
    const at = CODE.indexOf("if (card.classList.contains('is-locked'))");
    expect(at).toBeGreaterThan(-1);
    expect(CODE.slice(at, at + 120)).toContain('showImageLimitDialog()');
    expect(fn('showImageLimitDialog')).toContain('showLimitDialog({');
  });
});
