/**
 * The way to Pro, from anywhere in the panel.
 *
 * Before the redesign the header carried the two offers on every tab. The
 * redesign moved them into Account, which is opened by people already
 * thinking about their plan — so a free user working in Create, Queues or
 * Library saw no count and no price until the day's limit stopped them.
 * The plan strip puts both back in view: one line under the tabs.
 *
 * And buying while signed out used to end at "sign in first", after which
 * the buyer had to find the Upgrade button again. The intent is now kept
 * through the sign-in, and checkout opens when it completes.
 */

/// <reference types="node" />

import { readFileSync } from 'fs';
import { join } from 'path';

const read = (rel: string): string =>
  readFileSync(join(__dirname, '..', rel), 'utf8').replace(/\r\n/g, '\n');

const codeOnly = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

const CODE = codeOnly(read('sidepanel/index.ts'));
const HTML = read('../sidepanel.html');
const CSS = read('sidepanel/styles.css');

/** The body of a top-level function, up to the next one. */
const fn = (name: string): string => {
  const at = CODE.search(new RegExp(`(async )?function ${name}\\(`));
  expect(at).toBeGreaterThan(-1);
  const next = CODE.slice(at + 10).search(/\n(async )?function \w+\(/);
  return CODE.slice(at, next === -1 ? undefined : at + 10 + next);
};

describe('the plan strip', () => {
  it('sits under the tabs, outside any one tab', () => {
    const nav = HTML.indexOf('</nav>');
    const strip = HTML.indexOf('id="af-plan-strip"');
    const firstPanel = HTML.indexOf('class="af-panel"');
    expect(nav).toBeGreaterThan(-1);
    expect(strip).toBeGreaterThan(nav);
    expect(strip).toBeLessThan(firstPanel);
  });

  it('is for free accounts only', () => {
    const render = fn('renderPlanStrip');
    expect(render).toMatch(/if \(!usage \|\| usage\.is_pro\) \{\s*strip\.hidden = true;/);
  });

  it('is fed by the usage the Account tab shows, and hidden on sign-out', () => {
    expect(fn('updateUsageDisplay')).toContain('renderPlanStrip(usage)');
    expect(fn('updateUsageDisplay')).toContain('renderPlanStrip(null)');
    expect(fn('showLoggedOutState')).toContain('renderPlanStrip(null)');
  });

  it('catches up when a run has spent prompts', () => {
    const at = CODE.indexOf("'toast.queueCompleted'");
    expect(at).toBeGreaterThan(-1);
    expect(CODE.slice(at, at + 300)).toContain('updateUsageDisplay()');
  });

  it('names the price, from the same constant as the limit dialog', () => {
    expect(fn('initPlanStrip')).toContain('PRO_PRICE_LABEL');
  });

  it('stays out of Account and Settings, which have their own', () => {
    expect(CSS).toMatch(/body:has\(#panel-account\.active\) \.af-plan-strip/);
    expect(CSS).toMatch(/body:has\(#panel-settings\.active\) \.af-plan-strip/);
  });

  it('shows the free offer exactly where Account does', () => {
    const reward = fn('checkAndShowReviewReward');
    expect(reward).not.toContain('headerBtn');
    expect(reward).toContain('setFreeProOffer(true)');
    expect(fn('setFreeProOffer')).toContain('af-plan-strip-free');
  });
});

describe('every Upgrade goes through one door', () => {
  it('the Account card, the strip and the limit dialog all use startCheckout', () => {
    expect(CODE).toMatch(/\$\('#btn-upgrade-pro'\)\?\.addEventListener\('click', \(\) => \{ void startCheckout\(\); \}\)/);
    expect(fn('initPlanStrip')).toContain('startCheckout()');
    const dialog = fn('showLimitDialog');
    const signedOut = dialog.slice(dialog.indexOf('if (!upgradeEmail)'));
    expect(signedOut.slice(0, 200)).toContain('startCheckout()');
  });

  it('locks checkout to the signed-in email', () => {
    const start = fn('startCheckout');
    expect(start).toContain('getUpgradeTarget()');
    expect(start).toMatch(/if \(!email\) \{/);
  });
});

describe('a signed-out buyer is not left to find the button again', () => {
  it('keeps the intent when sending them to sign in', () => {
    const start = fn('startCheckout');
    const signedOut = start.slice(start.indexOf('if (!email)'));
    expect(signedOut).toMatch(/chrome\.storage\.local\.set\(\{ \[PENDING_CHECKOUT_KEY\]: Date\.now\(\) \}\)/);
  });

  it('resumes after an email or Google sign-in', () => {
    const resumes = CODE.match(/await showLoggedInState\(\);\s*await resumePendingCheckout\(\);/g) || [];
    expect(resumes.length).toBe(2);
    expect(CODE).toMatch(/loginWithGoogle\(idToken\);\s*if \(result\.ok\) \{\s*await showLoggedInState\(\);\s*await resumePendingCheckout\(\);/);
  });

  it('never on a plain panel load', () => {
    /* checkAuthState runs every time the panel opens with a live session.
       Resuming there would pop a checkout open on someone who only asked
       for one days ago. */
    expect(fn('checkAuthState')).not.toContain('resumePendingCheckout');
  });

  it('forgets the intent once used, and after a while unused', () => {
    const resume = fn('resumePendingCheckout');
    expect(resume).toContain('chrome.storage.local.remove(PENDING_CHECKOUT_KEY)');
    expect(resume).toContain('PENDING_CHECKOUT_TTL_MS');
    expect(resume).toContain('_isProUser');
  });

  it('opens a tab, since the click that asked for it is long gone', () => {
    /* window.open outside a user gesture is a popup the browser may block;
       the sign-in's network round trip ends the gesture. */
    const resume = fn('resumePendingCheckout');
    expect(resume).toContain('chrome.tabs.create({ url })');
    expect(resume).not.toContain('window.open');
  });
});
