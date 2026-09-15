/**
 * What a user sees at a daily ceiling, and why it is a dialog.
 *
 * ── The number this exists to change ──────────────────────────────────────
 *
 * Measured on production, 2026-09-11: 1,413 accounts have hit at least one
 * free ceiling and 21 of them went Pro — 1.49%. Those 1,413 are the people
 * who used the product until it physically stopped them, which is the
 * strongest buying signal the product ever gets.
 *
 * What they were shown depended entirely on WHICH ceiling they hit:
 *
 *   flow runs   >= 5    227 users   → the upgrade dialog
 *   text prompts >= 50  1,088 users → a toast, faded in a few seconds
 *   full prompts >= 20    274 users → a toast
 *   downloads   >= 20      59 users → a toast
 *
 * So the best upgrade surface in the product reached the smallest group, and
 * the largest group was told "Upgrade to Pro for unlimited" by a message with
 * nothing in it to click, gone before they could act. These tests hold every
 * ceiling to the same dialog.
 *
 * ── And why the price is in it ────────────────────────────────────────────
 *
 * The button read "Upgrade to Pro →" with no number anywhere in the panel.
 * Pro is $9.99. At that price the number is the argument; omitting it invites
 * the reader to guess high and dismiss, which is the one outcome that cannot
 * be recovered — they do not come back to a dialog they have closed.
 */

/// <reference types="node" />

import { readFileSync } from 'fs';
import { join } from 'path';

const PANEL = readFileSync(
  join(__dirname, '..', 'sidepanel', 'index.ts'), 'utf8').replace(/\r\n/g, '\n');

/** Source with comments stripped, so prose cannot satisfy an assertion. */
const codeOnly = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

const CODE = codeOnly(PANEL);

/** The body of the shared dialog. */
const dialogBody = (): string => {
  const at = CODE.indexOf('async function showLimitDialog(');
  expect(at).toBeGreaterThan(-1);
  return CODE.slice(at, at + 6000);
};

describe('every daily ceiling opens the dialog', () => {
  /* Each of these is a place the run stops because the account is out of
     allowance. A toast here is the regression: it says "upgrade" and offers
     no way to do it. */
  const CEILINGS: Array<[string, string]> = [
    ['adding prompts to the queue', "label: kind,"],
    ['starting a run with the day spent', "label: promptType === 'full' ? 'Full-Feature Prompt' : 'Text Prompt',"],
    ['downloading', "label: 'Download',"],
  ];

  for (const [where, marker] of CEILINGS) {
    it(`shows it when ${where}`, () => {
      const at = CODE.indexOf(marker);
      expect(at).toBeGreaterThan(-1);
      // The marker sits inside a showLimitDialog({...}) call, not a toast.
      const before = CODE.slice(Math.max(0, at - 400), at);
      expect(before).toContain('showLimitDialog({');
    });
  }

  it('leaves no quota ceiling reporting through a toast', () => {
    /* The exact strings that used to stand in for the dialog. If one comes
       back, someone has re-hidden the upgrade path behind a fading message. */
    expect(CODE).not.toContain("showToast('Daily limit reached. Upgrade to Pro for unlimited.'");
    expect(CODE).not.toMatch(/showToast\(`Daily \$\{promptType/);
    expect(CODE).not.toMatch(/showToast\(dlQuota\.message/);
  });

  it('still serves the run ceilings it always served', () => {
    const at = CODE.indexOf('function showQueueLimitDialog(');
    expect(at).toBeGreaterThan(-1);
    expect(CODE.slice(at, at + 900)).toContain('showLimitDialog({');
  });
});

describe('the dialog makes the case', () => {
  it('names the price on the button', () => {
    expect(CODE).toMatch(/const PRO_PRICE_LABEL = '\$9\.99\/mo'/);
    expect(dialogBody()).toContain('${PRO_PRICE_LABEL}');
  });

  it('says what is blocked right now, when the caller can count it', () => {
    expect(dialogBody()).toContain('opts.blocked');
    // And the callers actually pass it — a number, not a word.
    expect(CODE).toMatch(/blocked:[\s\S]{0,120}\$\{waiting\}/);
    expect(CODE).toMatch(/blocked:[\s\S]{0,120}\$\{pendingCount\}/);
    expect(CODE).toMatch(/blocked:[\s\S]{0,160}\$\{selected\.length\}/);
  });

  it('describes what Pro unlocks in each ceiling\'s own terms', () => {
    expect(dialogBody()).toContain('${opts.unlocks}');
    // Downloads must not be sold as "unlimited runs in all modes".
    const at = CODE.indexOf("label: 'Download',");
    expect(CODE.slice(at, at + 400)).toContain('Unlimited downloads');
  });

  it('keeps the free route in, so the ask is not only money', () => {
    expect(dialogBody()).toContain('af-limit-free-pro-btn');
  });

  /* Signed out, the checkout cannot bind a payment to an account, so the
     click has to divert to sign-in rather than open a blank checkout. */
  it('does not send a signed-out user to checkout', () => {
    expect(dialogBody()).toContain('if (!upgradeEmail)');
  });
});
