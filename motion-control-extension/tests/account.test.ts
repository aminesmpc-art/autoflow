import { act, createElement } from 'react';
import { createRoot, Root } from 'react-dom/client';
import Account from '../src/Account';
import { login, register, resendVerificationEmail } from '../../studio-extension/src/shared/api';

jest.mock('../../studio-extension/src/shared/api', () => ({
  getProfile: jest.fn(), login: jest.fn(), logout: jest.fn(), register: jest.fn(), resendVerificationEmail: jest.fn(),
}));
jest.mock('../../studio-extension/src/sidepanel/googleSignIn', () => ({ signInWithGoogle: jest.fn() }));

let host: HTMLDivElement, root: Root;
const onChange = jest.fn(async () => undefined);

beforeEach(async () => {
  jest.clearAllMocks();
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  (globalThis as any).chrome = { runtime: { id: 'test-extension' } };
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); this.dispatchEvent(new Event('close')); };
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  (register as jest.Mock).mockResolvedValue({ ok: true, message: 'Verify email' });
  (resendVerificationEmail as jest.Mock).mockResolvedValue({ ok: true, message: 'Email sent.' });
  await act(async () => root.render(createElement(Account, { profile: null, disabled: false, onChange })));
  await click('Sign in');
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

test('account links to existing Pro and does not offer a separate Motion purchase', async () => {
  await act(async () => root.render(createElement(Account, {
    profile: { email: 'pro@example.test', is_pro_active: true } as any,
    disabled: false, onChange, entitlement: null,
  })));
  expect(host.textContent).toContain('Motion allowance unavailable');
  expect(host.textContent).toContain('Motion is not available right now');
  expect(host.textContent).not.toContain('$5');
  expect(host.querySelector('a[href^="https://www.auto-flow.studio/pricing?"]')).not.toBeNull();
  expect(host.querySelector('a[href="https://whop.com/autoflow-studio/autoflow-motion"]')).toBeNull();
  // An allowance that could not be read is not a reason to sell.
  expect(host.querySelector('a[href*="/checkout"]')).toBeNull();
});

const allowance = (accessPlan: 'free' | 'pro', remaining: number | null) => ({
  accessPlan, active: true, allowed: remaining !== 0, reason: remaining === 0 ? 'motion_daily_limit' : null,
  daily: { limit: accessPlan === 'pro' ? null : 3, used: 0, remaining, resetsAt: '' },
  monthly: { limit: null, used: 0, remaining: null, resetsAt: '' },
});

test('a free account sees what is left today, and that Pro is unlimited', async () => {
  await act(async () => root.render(createElement(Account, {
    profile: { email: 'free@example.test' } as any, disabled: false, onChange, entitlement: allowance('free', 2) as any,
  })));
  expect(host.textContent).toContain('Free plan · 3 Motion jobs a day');
  expect(host.textContent).toContain('2 of 3 free Motion jobs left today. Upgrade to AutoFlow Pro for unlimited jobs.');
});

test('a free account upgrades through checkout for this same account', async () => {
  await act(async () => root.render(createElement(Account, {
    profile: { email: 'Free@Example.test' } as any, disabled: false, onChange, entitlement: allowance('free', 2) as any,
  })));
  const upgrade = host.querySelector('a[href*="/checkout"]') as HTMLAnchorElement;
  expect(upgrade.textContent).toBe('Upgrade to Pro · $10/month');
  expect(upgrade.getAttribute('href')).toBe('https://www.auto-flow.studio/checkout?utm_source=motion&utm_medium=extension'
    + '&utm_campaign=pro_upgrade&utm_content=account#email=free%40example.test');
  expect(upgrade.getAttribute('target')).toBe('_blank');
  expect(host.querySelector('a[href$="utm_content=compare"]')?.textContent).toBe('Compare plans');
  const opened = jest.fn();
  window.addEventListener('motion:upgrade', opened);
  upgrade.addEventListener('click', e => e.preventDefault());
  await act(async () => upgrade.click());
  window.removeEventListener('motion:upgrade', opened);
  expect(opened).toHaveBeenCalledTimes(1);
});

test('a Pro account sees unlimited, with no count to run out', async () => {
  await act(async () => root.render(createElement(Account, {
    profile: { email: 'pro@example.test' } as any, disabled: false, onChange, entitlement: allowance('pro', null) as any,
  })));
  expect(host.textContent).toContain('AutoFlow Pro · unlimited Motion');
  expect(host.textContent).toContain('Unlimited Motion jobs with AutoFlow Pro.');
  expect(host.textContent).not.toMatch(/left today|null/);
  expect(host.querySelector('.avatar--pro')).not.toBeNull();
  expect(host.querySelector('a[href*="/checkout"]')).toBeNull();
  expect(host.querySelector('a[href$="utm_content=compare"]')?.textContent).toBe('AutoFlow Pro plan');
});

async function click(text: string) {
  const button = Array.from(host.querySelectorAll('button')).find(el => el.textContent === text);
  if (!button) throw new Error(`Missing button: ${text}`);
  await act(async () => button.click());
}
async function fill(name: string, value: string) {
  const input = host.querySelector(`input[name="${name}"]`) as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function signup(confirm = 'secure-password') {
  await click('Create an AutoFlow account');
  await fill('email', 'buyer@example.com');
  await fill('password', 'secure-password');
  await fill('confirm-password', confirm);
}
async function submit() {
  await act(async () => host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
}

test('signup stays in the extension and never uses a website registration link', async () => {
  await signup();
  expect(host.querySelector('a[href*="register"]')).toBeNull();
  expect(host.querySelector('h2')?.textContent).toBe('Create your account');
  await submit();
  expect(register).toHaveBeenCalledWith('buyer@example.com', 'secure-password');
  expect(host.querySelector('h2')?.textContent).toBe('Check your email');
  expect(login).not.toHaveBeenCalled();
  expect(onChange).not.toHaveBeenCalled();
  expect(host.querySelector('input[type=password]')).toBeNull();
});

test('mismatching passwords do not call the backend and focus confirmation', async () => {
  await signup('different-password'); await submit();
  expect(register).not.toHaveBeenCalled();
  expect(host.querySelector('[role=alert]')?.textContent).toMatch(/Passwords do not match/);
  expect(document.activeElement?.getAttribute('name')).toBe('confirm-password');
});

test('backend errors keep the signup form open for correction', async () => {
  (register as jest.Mock).mockResolvedValue({ ok: false, message: 'This email is already registered.' });
  await signup(); await submit();
  expect(host.querySelector('[role=alert]')?.textContent).toMatch(/already registered/);
  expect(host.querySelector('h2')?.textContent).toBe('Create your account');
});

test('network exceptions allow another attempt without exposing internals', async () => {
  (register as jest.Mock).mockRejectedValueOnce(new Error('private diagnostics'));
  await signup(); await submit();
  expect(host.querySelector('[role=alert]')?.textContent).toMatch(/Please try again/);
  expect(host.textContent).not.toContain('private diagnostics');
  await submit();
  expect(host.querySelector('h2')?.textContent).toBe('Check your email');
});

test('verification can resend and return to sign-in with email but no password', async () => {
  await signup(); await submit();
  await click('Resend verification email');
  expect(resendVerificationEmail).toHaveBeenCalledWith('buyer@example.com');
  expect(host.querySelector('[role=status]')?.textContent).toBe('Email sent.');
  await click('Back to sign in');
  expect((host.querySelector('[name=email]') as HTMLInputElement).value).toBe('buyer@example.com');
  expect((host.querySelector('[name=password]') as HTMLInputElement).value).toBe('');
});

test('same-tick double submits send only one registration request', async () => {
  let resolve!: (result: { ok: boolean }) => void;
  (register as jest.Mock).mockReturnValue(new Promise(done => { resolve = done; }));
  await signup();
  await act(async () => {
    const form = host.querySelector('form')!;
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  expect(register).toHaveBeenCalledTimes(1);
  expect(host.querySelector('form')?.getAttribute('aria-busy')).toBe('true');
  await act(async () => resolve({ ok: true }));
});

test('switching back to sign-in clears passwords and successful login closes the sheet', async () => {
  await signup(); await click('Already have an account? Sign in');
  expect((host.querySelector('[name=password]') as HTMLInputElement).value).toBe('');
  await fill('password', 'my-password');
  (login as jest.Mock).mockResolvedValue({ ok: true }); await submit();
  expect(onChange).toHaveBeenCalledTimes(1);
  expect(host.querySelector('dialog')?.hasAttribute('open')).toBe(false);
});
