import { apiFetch } from '../../studio-extension/src/shared/api';
import { configuration, type MotionData } from './model';
import { MOTION_BILLING_CHECK } from './buildFlags';

/* `limit` and `remaining` are null where there is no limit: AutoFlow Pro has
   none, and nobody has a monthly one. */
type Allowance = { limit: number | null; used: number; remaining: number | null; resetsAt: string };
export type MotionEntitlement = {
  accessPlan: 'free' | 'pro';
  active: boolean; allowed: boolean; reason: string | null;
  daily: Allowance; monthly: Allowance;
};
/** Free accounts' daily allowance, for wording only — the server enforces it. */
export const FREE_DAILY_JOBS = 3;
export type MotionJob = { jobId: string; fingerprint: string; configuration: string; email: string; started: boolean; sourceHash: string };
export const PRO_PLAN_URL = 'https://www.auto-flow.studio/pricing';
/* Upgrade goes to the checkout page, not the plans page. Checkout embeds Whop
   with this account's email locked, so the subscription lands on the account
   that pressed Upgrade. From the plans page a buyer had to sign in to the
   website again, or paid under another address, and the webhook then gave Pro
   to a brand-new account while Motion stayed on Free. */
const CHECKOUT_URL = 'https://www.auto-flow.studio/checkout';
/** What that checkout charges (Whop plan_fxMVMOmbFPcp4, read October 6, 2026). */
export const PRO_PRICE = '$10/month';

/** Which invitation was pressed. The website's analytics reads this, never the email. */
export type UpgradePlace = 'top_bar' | 'limit' | 'plan_line' | 'after_clip' | 'account' | 'compare';
const tags = (place: UpgradePlace) => `utm_source=motion&utm_medium=extension&utm_campaign=pro_upgrade&utm_content=${place}`;

/**
 * Checkout for this account. The email rides in the fragment, which no request
 * carries — not to the website's server, not into its analytics, not in a
 * Referer to Whop. The query says only which button it was.
 */
export function upgradeUrl(email: string | null | undefined, place: UpgradePlace): string {
  const owner = String(email || '').trim().toLowerCase();
  return `${CHECKOUT_URL}?${tags(place)}${owner ? `#email=${encodeURIComponent(owner)}` : ''}`;
}
/** The plans page, for comparing first — tagged the same way. */
export const comparePlansUrl = () => `${PRO_PLAN_URL}?${tags('compare')}`;

/** "5h 12m" until today's free jobs come back; '' once that has passed or is unknown. */
export function untilReset(resetsAt: string | undefined, now = Date.now()): string {
  const ms = Date.parse(String(resetsAt || '')) - now;
  if (!Number.isFinite(ms) || ms <= 0) return '';
  const minutes = Math.ceil(ms / 60_000);
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
}

export async function getMotionEntitlement(): Promise<MotionEntitlement | null> {
  try {
    const res = await apiFetch('/api/motion/entitlements');
    if (!res.ok) return null;
    const data = await res.json();
    return (data.accessPlan === 'pro' || data.accessPlan === 'free')
      && typeof data.active === 'boolean' && data.daily && data.monthly ? data : null;
  } catch { return null; }
}

/** The subscription line in "Before you generate". */
export function motionPlanStep(entitlement: MotionEntitlement | null) {
  /* The build constant itself, never a parameter, so the real build drops
     this line and ships no test-build text for a reviewer to find. */
  if (!MOTION_BILLING_CHECK) return { ok: true, title: 'Subscription check off', note: 'Test build. Never upload it to the Web Store.' };
  if (!entitlement || entitlement.reason === 'motion_unavailable') {
    return { ok: false, title: 'Motion is not available right now', note: 'AutoFlow could not confirm your allowance. Refresh your account to try again.' };
  }
  if (!entitlement.active) return { ok: false, title: 'Verify your AutoFlow account', note: 'Confirm your email, then refresh your account' };
  if (entitlement.accessPlan === 'pro') return { ok: true, title: 'AutoFlow Pro — unlimited', note: 'No daily limit on Motion jobs' };
  /* Retries are free and are not gated by this line — only a NEW job is. */
  const left = entitlement.daily.remaining ?? 0;
  return left > 0
    ? { ok: true, title: `Free plan — ${left} of ${entitlement.daily.limit ?? FREE_DAILY_JOBS} left today`, note: 'AutoFlow Pro has no limit' }
    : { ok: false, title: 'Free limit reached for today', note: 'Resets at midnight UTC — AutoFlow Pro has no limit' };
}

/**
 * Whether to invite this account to upgrade, and what it has left today.
 *
 * Only a confirmed free account is invited: Pro sees none of it, and neither
 * does an account whose allowance could not be read — an upgrade button is
 * the wrong answer to "AutoFlow could not be reached".
 */
export function freePlanState(entitlement: MotionEntitlement | null): { left: number; limit: number; reached: boolean } | null {
  if (!MOTION_BILLING_CHECK || !entitlement?.active || entitlement.accessPlan !== 'free') return null;
  const limit = entitlement.daily.limit ?? FREE_DAILY_JOBS;
  const left = Math.max(0, entitlement.daily.remaining ?? 0);
  return { left, limit, reached: left === 0 };
}

const reasons: Record<string, string> = {
  motion_unavailable: 'Motion is not available right now. Nothing was started. Please try again later.',
  account_inactive: 'Your AutoFlow account is not active yet. Verify your email, then try again.',
  motion_daily_limit: `You have used your ${FREE_DAILY_JOBS} free Motion jobs for today. They reset at midnight UTC — or upgrade to AutoFlow Pro for unlimited jobs.`,
  motion_job_conflict: 'This job no longer matches its saved inputs. Start a new generation.',
};

export async function admitMotionJob(job: MotionJob): Promise<void> {
  let res: Response;
  try { res = await apiFetch('/api/usage/motion-run', { method: 'POST', body: JSON.stringify({ jobId: job.jobId, fingerprint: job.fingerprint }) }); }
  catch { throw new Error('Could not verify your Motion allowance. Nothing was generated. Try again; this saved job will not be charged twice.'); }
  if (res.status === 401) throw new Error('Sign in again to check your Motion allowance.');
  const body = await res.json().catch(() => ({}));
  const plan = body.accessPlan === 'free' || body.accessPlan === 'pro';
  if (!res.ok || !plan || body.allowed !== true || typeof body.runId !== 'string') {
    throw new Error(reasons[body.reason] || 'Could not verify your Motion allowance. Nothing was started. Please reconnect and try again.');
  }
}

const digest = async (bytes: BufferSource) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');

export async function jobFor(data: MotionData, email: string, retry: boolean, source?: File): Promise<MotionJob> {
  const config = configuration(data);
  const existing = data.motionJob;
  const owner = email.trim().toLowerCase();
  if (retry) {
    if (!existing || existing.configuration !== config || existing.email !== owner) {
      throw new Error('This project has no matching Motion job for this account. Start a new generation.');
    }
    if (source && await digest(await source.arrayBuffer()) !== existing.sourceHash) throw new Error('The video content changed. Start a new generation.');
    return existing;
  }
  if (!source) throw new Error('Add the original video before starting a new generation.');
  const sourceHash = await digest(await source.arrayBuffer());
  const fingerprint = await digest(new TextEncoder().encode(JSON.stringify([sourceHash, config])));
  // Persisted before admission: a lost response or closed panel can safely repeat the request.
  if (existing && (!existing.started || data.motionPieces.length === 0) && existing.fingerprint === fingerprint && existing.email === owner) return existing;
  return { jobId: crypto.randomUUID(), fingerprint, configuration: config, email: owner, started: false, sourceHash };
}
