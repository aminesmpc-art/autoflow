/**
 * `npm run build:test` — the Motion subscription check off.
 *
 * Asked for on October 1, 2026, while Motion billing was built but not
 * deployed: every account, the owner's included, was stopped at "Verify Motion
 * subscription" because the server it asks did not have the route (404). This
 * file runs with the flag OFF; everything else in this folder runs with the
 * real check, which is also what a build gets when the flag is not defined.
 */
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { startGeneration } from '../src/controller';
import { defaults } from '../src/model';
import { admitMotionJob, freePlanState, jobFor, motionPlanStep } from '../src/billing';
import Account from '../src/Account';
import { getProfile } from '../../studio-extension/src/shared/api';
import { runner } from '../../studio-extension/src/studio/engine/WorkflowRunner';

jest.mock('../src/buildFlags', () => ({ MOTION_BILLING_CHECK: false }));
jest.mock('../src/billing', () => ({ ...jest.requireActual('../src/billing'), admitMotionJob: jest.fn(), jobFor: jest.fn() }));
jest.mock('../../studio-extension/src/shared/api', () => ({
  getProfile: jest.fn(), apiFetch: jest.fn(), login: jest.fn(), logout: jest.fn(), register: jest.fn(), resendVerificationEmail: jest.fn(),
}));
jest.mock('../../studio-extension/src/sidepanel/googleSignIn', () => ({ signInWithGoogle: jest.fn() }));
jest.mock('../../studio-extension/src/studio/clip/sourceStore', () => ({ getSource: jest.fn(() => ({})) }));
jest.mock('../../studio-extension/src/studio/engine/bridge', () => ({ bridge: { getStatus: () => 'connected' } }));
jest.mock('../../studio-extension/src/studio/engine/WorkflowRunner', () => ({ runner: { run: jest.fn(async () => undefined) } }));
const save = jest.fn(async () => true);
jest.mock('../../studio-extension/src/studio/store', () => ({ useStudioStore: {
  getState: () => ({ isRunning: false, saveWorkflow: () => save() }), setState: jest.fn(),
} }));

const job = { jobId: 'uuid', fingerprint: 'hash', started: false };
beforeEach(() => {
  jest.clearAllMocks(); save.mockResolvedValue(true);
  (globalThis as any).chrome = { runtime: { id: 'test-extension' }, storage: { local: { get: jest.fn(async () => ({ af_debug_upload: true })), set: jest.fn(async () => {}) } } };
  (getProfile as jest.Mock).mockResolvedValue({ email: 'owner@example.test' });
  (jobFor as jest.Mock).mockResolvedValue(job);
});

test('generates without asking the subscription server', async () => {
  await startGeneration(defaults());
  expect(admitMotionJob).not.toHaveBeenCalled();
  expect(runner.run).toHaveBeenCalledWith([expect.objectContaining({ data: expect.objectContaining({ motionJob: { ...job, started: true } }) })], [], {});
  /* The job is still saved before and after, so a retry behaves the same. */
  expect(save).toHaveBeenCalledTimes(3);
});

test('still needs an AutoFlow sign-in', async () => {
  (getProfile as jest.Mock).mockResolvedValue(null);
  await expect(startGeneration(defaults())).rejects.toThrow(/Sign in/);
  expect(runner.run).not.toHaveBeenCalled();
});

test('the checklist says the check is off, instead of blocking Generate', () => {
  expect(motionPlanStep(null)).toEqual({ ok: true, title: 'Subscription check off', note: 'Test build. Never upload it to the Web Store.' });
  /* Nothing is counted in a test build, so nothing invites an upgrade. */
  const freeToday = { accessPlan: 'free', active: true, allowed: false, reason: 'motion_daily_limit',
    daily: { limit: 3, used: 3, remaining: 0, resetsAt: '' }, monthly: { limit: null, used: 3, remaining: null, resetsAt: '' } };
  expect(freePlanState(freeToday as any)).toBeNull();
});

test('the account sheet says it is a test build, not that billing is unavailable', async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(createElement(Account, {
    profile: { email: 'owner@example.test' } as any, entitlement: null, disabled: false, onChange: async () => undefined,
  })));
  expect(host.textContent).toContain('Subscription check off (test build)');
  expect(host.textContent).toContain('Never upload it to the Web Store');
  expect(host.textContent).not.toContain('billing is currently unavailable');
  await act(async () => root.unmount()); host.remove();
});

test('a build that does not define the flag gets the real check', () => {
  expect(jest.requireActual('../src/buildFlags').MOTION_BILLING_CHECK).toBe(true);
});
