/** @jest-environment node */
/**
 * The allowance line in "Before you generate", in the real build. Kept apart
 * from testBuild.test.ts, whose flag mock is file-wide: here nothing is
 * mocked, so this is the check every build but `build:test` ships.
 *
 * Free: 3 Motion jobs a day. AutoFlow Pro: unlimited. The line blocks only a
 * NEW job — retries are free and never wait on it.
 */
import { freePlanState, motionPlanStep } from '../src/billing';
jest.mock('../../studio-extension/src/shared/api', () => ({ apiFetch: jest.fn() }));

const allowance = (accessPlan: 'free' | 'pro', remaining: number | null, extra = {}) => ({
  accessPlan, active: true, allowed: remaining !== 0, reason: remaining === 0 ? 'motion_daily_limit' : null,
  daily: { limit: accessPlan === 'pro' ? null : 3, used: 3 - (remaining ?? 0), remaining, resetsAt: '' },
  monthly: { limit: null, used: 0, remaining: null, resetsAt: '' },
  ...extra,
}) as any;

test('a free account can generate while it has jobs left today', () => {
  expect(motionPlanStep(allowance('free', 2))).toEqual({ ok: true, title: 'Free plan — 2 of 3 left today', note: 'AutoFlow Pro has no limit' });
});

test('and is stopped, with the reason, once they are used', () => {
  expect(motionPlanStep(allowance('free', 0))).toEqual({
    ok: false, title: 'Free limit reached for today', note: 'Resets at midnight UTC — AutoFlow Pro has no limit',
  });
});

test('a Pro account is unlimited', () => {
  expect(motionPlanStep(allowance('pro', null))).toEqual({ ok: true, title: 'AutoFlow Pro — unlimited', note: 'No daily limit on Motion jobs' });
});

test('an allowance that could not be confirmed blocks Generate, and does not blame the plan', () => {
  for (const unavailable of [null, allowance('free', 3, { reason: 'motion_unavailable', active: false, allowed: false })]) {
    const step = motionPlanStep(unavailable);
    expect(step.ok).toBe(false);
    expect(step.title).toBe('Motion is not available right now');
  }
});

describe('the upgrade invitations', () => {
  test('a free account is invited, with what it has left today', () => {
    expect(freePlanState(allowance('free', 2))).toEqual({ left: 2, limit: 3, reached: false });
  });

  test('and is offered the upgrade in Generate\'s place once the day is used', () => {
    expect(freePlanState(allowance('free', 0))).toEqual({ left: 0, limit: 3, reached: true });
  });

  test('Pro is never invited, nor is an account whose allowance could not be read', () => {
    expect(freePlanState(allowance('pro', null))).toBeNull();
    expect(freePlanState(null)).toBeNull();
    expect(freePlanState(allowance('free', 3, { active: false, reason: 'account_inactive' }))).toBeNull();
  });
});

test('an inactive account is asked to verify, not to pay', () => {
  expect(motionPlanStep(allowance('free', 3, { active: false, allowed: false, reason: 'account_inactive' })))
    .toMatchObject({ ok: false, title: 'Verify your AutoFlow account' });
});
