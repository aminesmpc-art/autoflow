/** @jest-environment node */
declare function require(name: string): any;
const { webcrypto } = require('node:crypto');
import { apiFetch } from '../../studio-extension/src/shared/api';
import { admitMotionJob, getMotionEntitlement, jobFor } from '../src/billing';
import { defaults } from '../src/model';
jest.mock('../../studio-extension/src/shared/api', () => ({ apiFetch: jest.fn() }));
Object.defineProperty(globalThis, 'crypto', { value: webcrypto });
const source = (text = 'video') => ({ arrayBuffer: async () => new TextEncoder().encode(text).buffer } as File);
beforeEach(() => jest.clearAllMocks());
test('stable SHA256 identity survives ambiguous admission; started new runs get new UUIDs', async () => {
  const data = defaults(); const job = await jobFor(data, 'A@Example.test', false, source());
  expect(job.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  expect(await jobFor({ ...data, motionJob: job }, 'a@example.test', false, source())).toEqual(job);
  const next = await jobFor({ ...data, motionPieces: [{ index: 1 } as any], motionJob: { ...job, started: true } }, job.email, false, source());
  expect(next.jobId).not.toBe(job.jobId); expect(next.fingerprint).toBe(job.fingerprint);
});
test('admitted job interrupted before the first piece is not charged as a new run', async () => {
  const data = defaults(); const job = { ...await jobFor(data, 'a@b.test', false, source()), started: true };
  expect(await jobFor({ ...data, motionJob: job }, job.email, false, source())).toEqual(job);
});
test('changed bytes or settings create new identity even with identical filename metadata', async () => {
  const data = defaults(); const job = await jobFor(data, 'a@b.test', false, source());
  for (const [change, file] of [[{}, source('different')], [{ wish: 'new look' }, source()]] as const) {
    const next = await jobFor({ ...data, ...change, motionJob: job }, job.email, false, file);
    expect(next.jobId).not.toBe(job.jobId); expect(next.fingerprint).not.toBe(job.fingerprint);
  }
});

test('trim bounds participate in admission identity; identical trim retries reuse the job', async () => {
  const data = { ...defaults(), motionVideoMode: 'trim' as const, motionTrimStart: 0.5, motionTrimEnd: 10.5 };
  const job = await jobFor(data, 'a@b.test', false, source());
  expect(await jobFor({ ...data, motionJob: job }, job.email, true)).toEqual(job);
  const changed = await jobFor({ ...data, motionTrimStart: 1, motionJob: job }, job.email, false, source());
  expect(changed.fingerprint).not.toBe(job.fingerprint);
  await expect(jobFor({ ...data, motionTrimEnd: 10, motionJob: job }, job.email, true)).rejects.toThrow(/matching Motion job/);
});

test('continuity mode changes admission identity; identical chain retries reuse their job', async () => {
  const plain = defaults(); const oldJob = await jobFor(plain, 'a@b.test', false, source());
  const data = { ...plain, motionContinuity: true };
  const job = await jobFor(data, 'a@b.test', false, source());
  expect(job.fingerprint).not.toBe(oldJob.fingerprint);
  expect(await jobFor({ ...data, motionJob: job }, job.email, true)).toEqual(job);
  await expect(jobFor({ ...data, motionContinuity: false, motionJob: job }, job.email, true)).rejects.toThrow(/matching Motion job/);
});
test('retry may resume without source but not with substituted source, config or account', async () => {
  const data = defaults(); const job = await jobFor(data, 'a@b.test', false, source()); data.motionJob = job;
  expect(await jobFor(data, job.email, true)).toEqual(job);
  await expect(jobFor(data, job.email, true, source('different'))).rejects.toThrow(/content changed/);
  await expect(jobFor({ ...data, wish: 'new' }, job.email, true)).rejects.toThrow(/matching Motion job/);
  await expect(jobFor(data, 'other@b.test', true)).rejects.toThrow(/matching Motion job/);
});
test.each([403, 409, 429, 503, 404])('admission fails closed on status %s even with allowed=true', async status => {
  (apiFetch as jest.Mock).mockResolvedValue({ ok: false, status, json: async () => ({ allowed: true }) });
  await expect(admitMotionJob(await jobFor(defaults(), 'a@b.test', false, source()))).rejects.toThrow();
});
test('accepted duplicate uses exact saved request pair', async () => {
  (apiFetch as jest.Mock).mockResolvedValue({ ok: true, status: 200, json: async () => ({ accessPlan: 'pro', allowed: true, runId: 'run', duplicate: true }) });
  const job = await jobFor(defaults(), 'a@b.test', false, source()); await admitMotionJob(job);
  expect(apiFetch).toHaveBeenCalledWith('/api/usage/motion-run', { method: 'POST', body: JSON.stringify({ jobId: job.jobId, fingerprint: job.fingerprint }) });
});
test('a job admitted on the free plan is accepted, as is one on Pro', async () => {
  for (const accessPlan of ['free', 'pro']) {
    (apiFetch as jest.Mock).mockResolvedValue({ ok: true, status: 201, json: async () => ({ accessPlan, allowed: true, runId: 'run', duplicate: false }) });
    await expect(admitMotionJob(await jobFor(defaults(), 'a@b.test', false, source()))).resolves.toBeUndefined();
  }
});
test('a free account past its daily allowance is told why, and that Pro has no limit', async () => {
  (apiFetch as jest.Mock).mockResolvedValue({ ok: false, status: 429, json: async () => ({ accessPlan: 'free', allowed: false, reason: 'motion_daily_limit' }) });
  await expect(admitMotionJob(await jobFor(defaults(), 'a@b.test', false, source())))
    .rejects.toThrow('You have used your 3 free Motion jobs for today. They reset at midnight UTC — or upgrade to AutoFlow Pro for unlimited jobs.');
});
test('both plans are read from the server, and an unknown one is not', async () => {
  const answer = (accessPlan: string) => ({ ok: true, status: 200, json: async () => ({ accessPlan, active: true, allowed: true, daily: {}, monthly: {} }) });
  (apiFetch as jest.Mock).mockResolvedValue(answer('free'));
  expect(await getMotionEntitlement()).toMatchObject({ accessPlan: 'free' });
  (apiFetch as jest.Mock).mockResolvedValue(answer('pro'));
  expect(await getMotionEntitlement()).toMatchObject({ accessPlan: 'pro' });
  (apiFetch as jest.Mock).mockResolvedValue(answer('motion'));
  expect(await getMotionEntitlement()).toBeNull();
});
test('unavailable entitlement is not converted into a free or active plan', async () => {
  (apiFetch as jest.Mock).mockRejectedValue(new Error('network'));
  expect(await getMotionEntitlement()).toBeNull();
});
test('old separate-plan server cannot be mistaken for Pro-included access', async () => {
  (apiFetch as jest.Mock).mockResolvedValue({ ok: true, status: 200, json: async () => ({ active: true, allowed: true, runId: 'old-run', daily: {}, monthly: {} }) });
  expect(await getMotionEntitlement()).toBeNull();
  await expect(admitMotionJob(await jobFor(defaults(), 'a@b.test', false, source()))).rejects.toThrow();
});
