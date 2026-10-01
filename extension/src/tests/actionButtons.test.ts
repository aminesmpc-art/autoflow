/**
 * Logic fixes from the review before 9.1 shipped.
 *
 * - Run now, pressed during a run, added the prompts as a new queue and then
 *   refused to start it ("Another queue is running"), leaving a queue
 *   nobody asked for. It is now disabled while a run is on, everywhere the
 *   run state changes.
 * - Upgrade with a login but no profile (a connection problem) said "sign
 *   in first" and sent you to a sign-in form the panel was not showing.
 * - The first Account card counted text-only prompts as "used" against a
 *   limit that counts every prompt, so it could read "10 / 50" beside
 *   "30 left".
 * - A mode locked by the all-prompts limit opened a dialog with the image
 *   numbers.
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

describe('Run now and Add to Queue', () => {
  it('are decided in one place: a prompt for both, no run in progress for Run now', () => {
    const sync = fn('syncActionButtons');
    expect(sync).toMatch(/add\.disabled = count === 0;/);
    expect(sync).toMatch(/run\.disabled = count === 0 \|\| running;/);
  });

  it('follow the prompts', () => {
    expect(fn('reparsePrompts')).toContain('syncActionButtons()');
  });

  it('follow the run, however it starts or ends', () => {
    expect(fn('updateRunLockUI')).toContain('syncActionButtons(locked)');
    const done = CODE.indexOf("if (queue.status === 'completed' || queue.status === 'stopped') {");
    expect(CODE.slice(done, done + 300)).toContain('syncActionButtons()');
    expect(fn('loadActiveQueueState')).toContain('syncActionButtons()');
  });

  it('are not simply re-enabled after Run now', () => {
    const at = CODE.indexOf("$('#btn-run-now')?.addEventListener('click'");
    expect(at).toBeGreaterThan(-1);
    const handler = CODE.slice(at, at + 600);
    expect(handler).toContain('syncActionButtons()');
    expect(handler).not.toMatch(/finally \{\s*btn\.disabled = false;/);
  });
});

describe('Upgrade without a profile', () => {
  it('tells a connection problem from a sign-in one', () => {
    const start = fn('startCheckout');
    const noEmail = start.slice(start.indexOf('if (!email)'));
    const offline = noEmail.indexOf("if (await isLoggedIn())");
    const pending = noEmail.indexOf('PENDING_CHECKOUT_KEY');
    expect(offline).toBeGreaterThan(-1);
    expect(offline).toBeLessThan(pending);
    expect(noEmail.slice(offline, pending)).toContain("t('toast.checkoutOffline')");
  });

  it('shows the sign-in form when the login really is gone', () => {
    expect(fn('startCheckout')).toContain('showLoggedOutState()');
  });
});

describe('the all-prompts limit', () => {
  it('counts used as what the limit has spent', () => {
    const usage = fn('updateUsageDisplay');
    expect(usage).toMatch(/usage\.text_limit - usage\.text_remaining/);
    expect(usage).toMatch(/updateBar\('text', allUsed,/);
  });

  it('is the limit a locked mode names when it is the one spent', () => {
    const dialog = fn('showImageLimitDialog');
    expect(dialog).toMatch(/const textSpent = !!usage && usage\.text_remaining <= 0;/);
    expect(dialog).toContain("t(textSpent ? 'limit.textPrompts' : 'limit.fullPrompts')");
  });
});
