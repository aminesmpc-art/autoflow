/* ============================================================
   AutoFlow – API Client
   Handles all communication with the backend at api.auto-flow.studio
   ============================================================ */

import { AuthTokens, UserProfile, DailyUsageResponse } from '../types';

const API_BASE = 'https://api.auto-flow.studio';

/* The standby, and why it is on a domain we do not own.
 *
 * Every quota gate in this file fails CLOSED — checkCanGenerate and
 * checkCanStartQueue both return allowed:false when usage cannot be read,
 * deliberately, because failing open would hand every account unlimited free
 * usage for the length of an outage. The cost of that choice is that if this
 * one host is unreachable, nobody can generate anything. Pro included: there
 * is no cached entitlement to fall back on.
 *
 * A standby at api2.auto-flow.studio would not help in the case that actually
 * needs it. If the DOMAIN is what goes — lapsed registration, a DNS takeover,
 * a registrar dispute — every name under it goes with it. up.railway.app is
 * registered by someone else entirely and serves the same container, so it
 * survives exactly the failure that would otherwise brick the install base.
 *
 * Both hosts are compiled in. Neither is read from storage: anything able to
 * write chrome.storage could otherwise point every request — bearer tokens
 * included — at a host of its choosing. The list is the allowlist.
 *
 * This has to ship BEFORE it is needed. host_permissions is enforced by
 * Chrome, so a host absent from the manifest cannot be reached no matter what
 * this constant says, and adding one means a store review measured in days.
 */
const API_FALLBACK = 'https://web-production-a81f8d.up.railway.app';

/* Sticky for the session once the primary has failed, so a sustained outage
   costs one failed request rather than one per call. */
let _usingFallback = false;

/* Long enough that a slow but working server still answers, short enough that
   a dead one does not hold the UI. Matches what the auth tests advance to. */
const REQUEST_DEADLINE_MS = 15000;

/**
 * fetch against the API, failing over to the standby.
 *
 * Only a NETWORK-level failure triggers the switch. A 4xx or 5xx is an answer
 * — the host is up and has an opinion — and retrying that against the other
 * host would double every genuine error.
 */
async function apiFetchRaw(path: string, init: RequestInit = {}): Promise<Response> {
  const first = _usingFallback ? API_FALLBACK : API_BASE;

  /* A deadline, because a stalled connection otherwise hangs forever.
     fetch has no timeout of its own: a server that accepts the socket and
     then says nothing leaves the promise pending for as long as the tab
     lives, and every caller here awaits it behind a spinner the user cannot
     dismiss. An unanswered request has to become an error on its own. */
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_DEADLINE_MS);
  const signed: RequestInit = { ...init, signal: init.signal ?? controller.signal };

  try {
    return await fetch(`${first}${path}`, signed);
  } catch (err) {
    /* An abort is OUR deadline firing, not evidence that this host is down.
       Retrying it against the standby would double the wait the deadline
       exists to cap, and would ask a second host the question the first was
       never given time to answer. */
    if ((err as any)?.name === 'AbortError') throw err;

    const other = first === API_BASE ? API_FALLBACK : API_BASE;
    const res = await fetch(`${other}${path}`, signed);
    _usingFallback = other === API_FALLBACK;
    console.warn(`[AutoFlow] ${first} unreachable — using ${other}`);
    return res;
  } finally {
    clearTimeout(timer);
  }
}

/** Why a request produced no answer, in words a user can act on. */
function connectionMessage(err: any): string {
  return err?.name === 'AbortError'
    ? 'The server took too long to respond. Please try again.'
    : 'Could not reach the server. Check your internet connection.';
}
// Our own page, which embeds Whop's checkout widget with the email locked.
// See getUpgradeTarget() for why we don't link straight to whop.com.
const CHECKOUT_PAGE_URL = 'https://www.auto-flow.studio/checkout';

// ── Token Storage ──

const TOKEN_KEY = 'autoflow_auth_tokens';

async function getStoredTokens(): Promise<AuthTokens | null> {
  return new Promise(resolve => {
    chrome.storage.local.get(TOKEN_KEY, result => {
      resolve(result[TOKEN_KEY] || null);
    });
  });
}

async function storeTokens(tokens: AuthTokens): Promise<void> {
  return new Promise(resolve => {
    chrome.storage.local.set({ [TOKEN_KEY]: tokens }, resolve);
  });
}

async function clearTokens(): Promise<void> {
  return new Promise(resolve => {
    chrome.storage.local.remove(TOKEN_KEY, resolve);
  });
}

// ── Core Fetch Wrapper ──

/* Read from the manifest rather than typed here.
 *
 * This was hard-coded '5.1' and stayed there through 8.x, so every request
 * announced a version three majors old. Nothing broke, because the backend
 * does not read the header — but that is also why it went unnoticed, and it
 * is the field that would make receipt coverage exact instead of a proxy:
 * "which accounts are on a build that reports" is answerable directly from a
 * true version, and currently has to be inferred from whether an account has
 * ever produced a receipt.
 *
 * getManifest() is synchronous and available in every extension context. The
 * guard is for the test environment, where chrome is not defined. */
const EXTENSION_VERSION = (() => {
  try {
    return chrome.runtime.getManifest().version;
  } catch {
    return 'unknown';
  }
})();

async function apiFetch(
  path: string,
  options: RequestInit = {},
  retry = true
): Promise<Response> {
  const tokens = await getStoredTokens();
  const headers = new Headers(options.headers || {});
  
  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  headers.set('X-AutoFlow-Version', EXTENSION_VERSION);
  
  // Prevent aggressive browser caching for GET requests
  if (!options.method || options.method.toUpperCase() === 'GET') {
    headers.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    headers.set('Pragma', 'no-cache');
    headers.set('Expires', '0');
  }

  if (tokens?.access) {
    headers.set('Authorization', `Bearer ${tokens.access}`);
  }

  const response = await apiFetchRaw(`${path}`, {
    ...options,
    headers,
  });

  // If 401 and we have a refresh token, try refreshing
  if (response.status === 401 && tokens?.refresh && retry) {
    const refreshed = await refreshAccessToken(tokens.refresh);
    if (refreshed) {
      return apiFetch(path, options, false); // retry once
    }
  }

  return response;
}

async function refreshAccessToken(refreshToken: string): Promise<boolean> {
  try {
    const res = await apiFetchRaw(`/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh: refreshToken }),
    });

    if (!res.ok) {
      await clearTokens();
      // Broadcast session expired so the UI can react (show login screen)
      broadcastSessionExpired();
      return false;
    }

    const data = await res.json();
    const tokens = await getStoredTokens();
    await storeTokens({
      access: data.access,
      refresh: data.refresh || tokens?.refresh || refreshToken,
    });
    return true;
  } catch {
    await clearTokens();
    broadcastSessionExpired();
    return false;
  }
}

/** Broadcast that the user's session expired so the UI can show re-login. */
function broadcastSessionExpired(): void {
  try {
    chrome.storage.local.set({ af_session_expired: true });
  } catch { /* ignore in non-extension contexts */ }
}

/** Clear the session-expired flag (call after successful login). */
export async function clearSessionExpired(): Promise<void> {
  chrome.storage.local.remove('af_session_expired');
}

/**
 * Proactive session health check. Call on sidepanel open to detect stale tokens
 * BEFORE the user tries to do anything.
 * Returns: 'valid' | 'refreshed' | 'expired' | 'no_session'
 */
export async function ensureSession(): Promise<'valid' | 'refreshed' | 'expired' | 'no_session'> {
  const tokens = await getStoredTokens();
  if (!tokens?.access) return 'no_session';

  // Try a lightweight API call to check if the access token still works
  try {
    const res = await apiFetchRaw(`/api/auth/me`, {
      headers: {
        'Authorization': `Bearer ${tokens.access}`,
        'Content-Type': 'application/json',
      },
    });

    if (res.ok) return 'valid';

    if (res.status === 401 && tokens.refresh) {
      const refreshed = await refreshAccessToken(tokens.refresh);
      return refreshed ? 'refreshed' : 'expired';
    }

    return 'expired';
  } catch {
    // Network error — don't invalidate the session, just report
    return 'valid';
  }
}

// ── Auth API ──

/** Extract a human-readable error from DRF validation responses */
function extractError(data: any, fallback: string): string {
  // Simple string: { "detail": "some error" }
  if (typeof data.detail === 'string') return data.detail;

  // Nested object: { "detail": { "email": ["error"], "password": ["error"] } }
  if (typeof data.detail === 'object' && data.detail !== null) {
    for (const key of Object.keys(data.detail)) {
      const val = data.detail[key];
      if (Array.isArray(val) && val.length) return val[0];
      if (typeof val === 'string') return val;
    }
  }

  // DRF field errors at top level: { "email": ["error"] }
  for (const key of ['email', 'password', 'non_field_errors']) {
    if (Array.isArray(data[key]) && data[key].length) return data[key][0];
  }

  return fallback;
}

export async function register(email: string, password: string): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await apiFetchRaw(`/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    const data = await res.json();

    if (!res.ok) {
      return { ok: false, message: extractError(data, 'Registration failed. Please try again.') };
    }

    return { ok: true, message: data.message || 'Account created! You can log in now.' };
  } catch (err) {
    return { ok: false, message: connectionMessage(err) };
  }
}

export async function login(email: string, password: string): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await apiFetchRaw(`/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    const data = await res.json();

    if (!res.ok) {
      return { ok: false, message: extractError(data, 'Invalid email or password.') };
    }

    await storeTokens({ access: data.access, refresh: data.refresh });
    await clearSessionExpired();
    return { ok: true, message: 'Logged in!' };
  } catch (err) {
    return { ok: false, message: connectionMessage(err) };
  }
}

export async function loginWithGoogle(idToken: string): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await apiFetchRaw(`/api/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id_token: idToken }),
    });

    const data = await res.json();

    if (!res.ok) {
      return { ok: false, message: extractError(data, 'Google authentication failed.') };
    }

    await storeTokens({ access: data.access, refresh: data.refresh });
    await clearSessionExpired();
    return { ok: true, message: 'Logged in with Google!' };
  } catch (err) {
    return { ok: false, message: connectionMessage(err) };
  }
}

export async function getGoogleConfig(): Promise<{ client_id: string } | null> {
  try {
    const res = await apiFetchRaw(`/api/auth/google/config`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function logout(): Promise<void> {
  await clearTokens();
}

export async function isLoggedIn(): Promise<boolean> {
  const tokens = await getStoredTokens();
  return !!tokens?.access;
}

// ── Profile & Usage API ──

export async function getProfile(): Promise<UserProfile | null> {
  try {
    const res = await apiFetch('/api/auth/me');
    if (!res.ok) return null;
    const data = await res.json();
    // MeView returns { user: { email, ... }, profile: { plan_type, is_pro_active, ... } }
    return {
      email: data.user?.email ?? '',
      plan_type: data.profile?.plan_type ?? 'free',
      is_pro_active: data.profile?.is_pro_active ?? false,
      daily_limit: data.profile?.daily_limit ?? 30,
    };
  } catch {
    return null;
  }
}

export interface StudioRunGate {
  allowed: boolean;
  used: number;
  limit: number;
  remaining: number;
  message: string;
}

/**
 * Server-side gate for a Studio workflow run. Returns null when the check
 * could not happen at all (signed out, offline) — the caller falls back to
 * the client-side limits, which are honest UX but editable by the user.
 */
export async function consumeStudioRun(
  nodeCount: number,
  generateCount: number
): Promise<StudioRunGate | null> {
  try {
    const res = await apiFetch('/api/usage/studio-run', {
      method: 'POST',
      // node_count gates workflow size; generate_count is what actually gets
      // submitted to Flow and is charged against the daily prompt allowance.
      body: JSON.stringify({ node_count: nodeCount, generate_count: generateCount }),
    });
    if (res.status === 401) return null; // not signed in — no server authority
    const data = await res.json();
    return {
      allowed: !!data.allowed,
      used: data.used ?? 0,
      limit: data.limit ?? 0,
      remaining: data.remaining ?? 0,
      message: data.message || (data.allowed ? '' : 'Studio limit reached.'),
    };
  } catch {
    return null; // network failure — degrade to client-side limits
  }
}

export async function getDailyUsage(): Promise<DailyUsageResponse | null> {
  try {
    const res = await apiFetch('/api/entitlements');
    if (!res.ok) return null;
    const data = await res.json();
    return {
      text_used: data.text_used_today ?? 0,
      text_limit: data.is_pro_active ? 999 : (data.text_daily_limit ?? 100),
      text_remaining: data.is_pro_active ? 999 : (data.text_remaining_today ?? 100),
      full_used: data.full_used_today ?? 0,
      full_limit: data.is_pro_active ? 999 : (data.full_daily_limit ?? 20),
      full_remaining: data.is_pro_active ? 999 : (data.full_remaining_today ?? 20),
      plan_type: data.plan_type ?? 'free',
      is_pro: data.is_pro_active ?? false,
      // Queue run limits
      lite_used: data.lite_runs_today ?? 0,
      lite_limit: 999,  // Lite is unlimited for all users
      lite_remaining: 999,
      flow_used: data.flow_runs_today ?? 0,
      flow_limit: data.is_pro_active ? 999 : (data.flow_daily_limit ?? 5),
      flow_remaining: data.is_pro_active ? 999 : (data.flow_remaining_today ?? 5),
      full_monthly_used: data.full_runs_today ?? data.full_runs_this_month ?? 0,
      full_monthly_limit: data.is_pro_active ? 999 : (data.full_runs_daily_limit ?? data.full_monthly_limit ?? 1),
      full_monthly_remaining: data.is_pro_active ? 999 : (data.full_remaining_today_runs ?? data.full_remaining_this_month ?? 1),
    };
  } catch {
    return null;
  }
}

export async function trackUsage(promptCount: number = 1, promptType: 'text' | 'full' = 'text', promptStatus: 'done' | 'failed' = 'done'): Promise<boolean> {
  try {
    const res = await apiFetch('/api/usage/consume', {
      method: 'POST',
      body: JSON.stringify({ prompt_count: promptCount, prompt_type: promptType, status: promptStatus }),
    });
    if (!res.ok) {
      console.warn('[AutoFlow] trackUsage failed:', res.status);
      return false;
    }
    const data = await res.json();
    return data.allowed !== false;
  } catch (e) {
    console.error('[AutoFlow] trackUsage error:', e);
    return false;
  }
}

/**
 * Report that ONE prompt reached Flow and Flow accepted it.
 *
 * ── What makes this different from trackUsage ─────────────────────────────
 *
 * trackUsage reports an OUTCOME — this prompt finished, done or failed — and
 * it moves no counter; the charge was already taken at queue start, before
 * anything was sent. So today's billable number means "prompts queued", and
 * every failure between starting and submitting is billed and invisible: a
 * run stopped after 3 of 20 still charges 20.
 *
 * This reports a FACT with evidence: the interceptor read `mediaId` out of
 * Flow's own response to the request that carried this prompt's text. It
 * cannot exist for a prompt that never left the extension, and it is unique,
 * so the server can make the write idempotent at the database rather than in
 * application code.
 *
 * ── It does not charge, yet ───────────────────────────────────────────────
 *
 * The endpoint deliberately moves no counter. Both numbers are written for a
 * period and compared on the same runs first, because switching the dashboard
 * over in one step would drop every chart overnight with no way to tell the
 * fix from a regression.
 *
 * Fire-and-forget by design: a metering write must never be able to fail a
 * generation the user has already paid Google for.
 */
export async function trackSubmission(input: {
  mediaId: string;
  queueId: string;
  promptIndex: number;
  promptType: 'text' | 'full';
  mode?: string;
  /**
   * Sent on a LATER call for the same media id, once the generation settles.
   *
   * It rides on the same row rather than a second event: a clip Flow accepted
   * and then failed was still charged by Google, so it has to stay counted as
   * sent while being excluded from completed. Two rows would make the billable
   * number depend on how many times this reported, which is the class of bug
   * the whole change is fixing.
   */
  outcome?: 'done' | 'failed';
}): Promise<boolean> {
  if (!input.mediaId) return false;
  try {
    const res = await apiFetch('/api/usage/submitted', {
      method: 'POST',
      body: JSON.stringify({
        media_id: input.mediaId,
        queue_id: input.queueId,
        prompt_index: input.promptIndex,
        prompt_type: input.promptType,
        mode: input.mode || '',
        outcome: input.outcome || '',
      }),
    });
    /* A 404 is the expected answer from a backend that predates this
       endpoint, and it is not a problem worth a console error on every
       prompt — the old counting still works, this is purely additive. */
    if (res.status === 404) return false;
    if (!res.ok) {
      console.warn('[AutoFlow] trackSubmission failed:', res.status);
      return false;
    }
    return true;
  } catch (e) {
    console.warn('[AutoFlow] trackSubmission error:', e);
    return false;
  }
}

/**
 * Hand back the prompts a finished run never sent.
 *
 * Only meaningful while the server is charging on submission: the run claimed
 * N at the start and holds them, so anything not sent has to be returned or it
 * silently shrinks the user's quota for the rest of the day.
 *
 * Called however a run ends — completed, stopped, or failed. Idempotent, so a
 * run that ends twice cannot hand back quota twice, and harmless against a
 * server that has no such endpoint.
 */
export async function releaseQueueReservation(queueId: string): Promise<number> {
  if (!queueId) return 0;
  try {
    const res = await apiFetch('/api/usage/release', {
      method: 'POST',
      body: JSON.stringify({ queue_id: queueId }),
    });
    if (!res.ok) return 0;
    const data = await res.json();
    return Number(data.freed) || 0;
  } catch {
    /* A hold nobody released expires server-side, so failing here costs the
       user some quota for a few hours rather than permanently. Not worth
       failing a run over. */
    return 0;
  }
}

export async function checkCanGenerate(promptType: 'text' | 'full' = 'text'): Promise<{ allowed: boolean; remaining: number; limit: number }> {
  try {
    const usage = await getDailyUsage();
    // FAIL-CLOSED: if we can't get usage data, block the action
    if (!usage) return { allowed: false, remaining: 0, limit: 0 };

    if (usage.is_pro) return { allowed: true, remaining: 999, limit: 999 };

    // Every prompt counts toward the text (total) limit
    const textRemaining = usage.text_remaining;

    if (promptType === 'full') {
      // Full prompts count toward BOTH limits — take the lower one
      const fullRemaining = usage.full_remaining;
      const effectiveRemaining = Math.min(textRemaining, fullRemaining);
      return {
        allowed: effectiveRemaining > 0,
        remaining: Math.max(0, effectiveRemaining),
        limit: usage.full_limit,
      };
    }

    return {
      allowed: textRemaining > 0,
      remaining: Math.max(0, textRemaining),
      limit: usage.text_limit,
    };
  } catch {
    // FAIL-CLOSED: if anything goes wrong, block
    return { allowed: false, remaining: 0, limit: 0 };
  }
}

export async function consumeDownload(count: number = 1): Promise<{ allowed: boolean; remaining: number; limit: number; message?: string }> {
  try {
    const res = await apiFetch('/api/usage/download', {
      method: 'POST',
      body: JSON.stringify({ count }),
    });
    const data = await res.json();
    return {
      allowed: data.allowed !== false,
      remaining: data.downloads_remaining_today ?? 0,
      limit: data.download_daily_limit ?? 20,
      message: data.message,
    };
  } catch {
    // FAIL-OPEN for downloads: if server is unreachable, allow the download
    // (the media is already generated on Google's side anyway)
    return { allowed: true, remaining: 999, limit: 999 };
  }
}

export interface UpgradeTarget {
  url: string;
  /** The account email the checkout is prefilled with, or null if signed out. */
  email: string | null;
}

/**
 * Checkout, locked to the signed-in account's email.
 *
 * This goes to our own page rather than whop.com because Whop's hosted
 * checkout only *prefills* the address — it stays editable, and any address
 * other than the AutoFlow one strands the payment, since webhooks are matched
 * back to accounts by email. Our page embeds Whop's checkout widget with
 * `disable-email`, which the hosted page has no equivalent for.
 *
 * The email travels in the URL *fragment*: fragments are never sent to the
 * server, so it stays out of request logs and Referer headers.
 *
 * When signed out there is no email and, worse, no account for the webhook to
 * ever attach to — callers must send the user to sign in rather than open a
 * checkout at all.
 */
export async function getUpgradeTarget(): Promise<UpgradeTarget> {
  const profile = await getProfile();
  const email = profile?.email || null;
  return {
    url: email
      ? `${CHECKOUT_PAGE_URL}#email=${encodeURIComponent(email)}`
      : CHECKOUT_PAGE_URL,
    email,
  };
}

/** Get Whop checkout URL, prefilled with the user's email when signed in. */
export async function getUpgradeUrl(): Promise<string> {
  return (await getUpgradeTarget()).url;
}


// ── Queue Run Limits ──

export interface QueueRunCheckResult {
  allowed: boolean;
  used: number;
  limit: number;
  remaining: number;
  period: 'day' | 'month' | 'unlimited';
  message?: string;
}

/** Check if the user can start a queue in the given mode (lite/flow/full). */
export async function checkCanStartQueue(mode: 'lite' | 'flow' | 'full'): Promise<QueueRunCheckResult> {
  try {
    const usage = await getDailyUsage();
    // FAIL-CLOSED: if we can't get usage data, block
    if (!usage) return { allowed: false, used: 0, limit: 0, remaining: 0, period: 'day', message: 'Unable to verify limits.' };
    if (usage.is_pro) return { allowed: true, used: 0, limit: 999, remaining: 999, period: 'unlimited' };

    if (mode === 'lite') {
      return {
        allowed: usage.lite_remaining > 0,
        used: usage.lite_used,
        limit: usage.lite_limit,
        remaining: usage.lite_remaining,
        period: 'day',
        message: usage.lite_remaining <= 0 ? `Lite mode limit reached (${usage.lite_limit}/day). Upgrade to Pro for unlimited.` : undefined,
      };
    } else if (mode === 'flow') {
      return {
        allowed: usage.flow_remaining > 0,
        used: usage.flow_used,
        limit: usage.flow_limit,
        remaining: usage.flow_remaining,
        period: 'day',
        message: usage.flow_remaining <= 0 ? `Flow mode limit reached (${usage.flow_limit}/day). Upgrade to Pro for unlimited.` : undefined,
      };
    } else {
      return {
        allowed: usage.full_monthly_remaining > 0,
        used: usage.full_monthly_used,
        limit: usage.full_monthly_limit,
        remaining: usage.full_monthly_remaining,
        period: 'day',
        message: usage.full_monthly_remaining <= 0 ? `Full mode limit reached (${usage.full_monthly_limit}/day). Upgrade to Pro for unlimited.` : undefined,
      };
    }
  } catch {
    return { allowed: false, used: 0, limit: 0, remaining: 0, period: 'day', message: 'Unable to verify limits.' };
  }
}

/** Consume a queue run server-side. Call BEFORE starting the queue.
 *  Supports mixed queues: sends text_count + full_count separately. */
export async function consumeQueueRun(mode: 'lite' | 'flow' | 'full', promptCount: number, promptType: 'text' | 'full' = 'text', textCount?: number, fullCount?: number, queueId?: string): Promise<QueueRunCheckResult> {
  try {
    // If per-type counts are provided, send them for accurate mixed-queue tracking
    const payload: Record<string, unknown> = { mode, prompt_count: promptCount, prompt_type: promptType };
    /* The run's own id. Under submission charging the server holds this run's
       prompts against it rather than spending them, and needs the id to give
       the unused ones back when the run ends. Harmless to an older server. */
    if (queueId) payload.queue_id = queueId;
    if (textCount !== undefined && fullCount !== undefined) {
      payload.text_count = textCount;
      payload.full_count = fullCount;
    }
    const res = await apiFetch('/api/usage/queue-run', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    return {
      allowed: data.allowed !== false,
      used: data.used ?? 0,
      limit: data.limit ?? 0,
      remaining: data.remaining ?? 0,
      period: data.period ?? 'day',
      message: data.message,
    };
  } catch {
    // FAIL-CLOSED: if server is unreachable, block queue start
    return { allowed: false, used: 0, limit: 0, remaining: 0, period: 'day', message: 'Unable to verify limits.' };
  }
}


// ═══════════════════════════════════════════════════════════
// REVIEW REWARD
// ═══════════════════════════════════════════════════════════

export interface ReviewRewardResult {
  status: 'none' | 'pending' | 'approved' | 'rejected' | 'ineligible';
  message?: string;
  pro_granted_until?: string;
}

/** Submit a review reward claim. Backend enforces eligibility (50 text / 20 full in 7 days). */
export async function claimReviewReward(reviewerName: string): Promise<ReviewRewardResult> {
  try {
    const res = await apiFetch('/api/rewards/claim-review', {
      method: 'POST',
      body: JSON.stringify({ reviewer_name: reviewerName }),
    });
    return await res.json();
  } catch {
    return { status: 'none', message: 'Network error' };
  }
}

/** Check current review reward status. */
export async function getReviewRewardStatus(): Promise<ReviewRewardResult> {
  try {
    const res = await apiFetch('/api/rewards/review-status', { method: 'GET' });
    return await res.json();
  } catch {
    return { status: 'none' };
  }
}

// ═══════════════════════════════════════════════════════════
// PASSWORD RESET
// ═══════════════════════════════════════════════════════════

/** Request a password reset. Sends a 6-digit code via email. */
export async function requestPasswordReset(email: string): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await apiFetchRaw(`/api/auth/password/reset-request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const data = await res.json();
    if (res.ok) {
      return { ok: true, message: data.message || 'Verification code sent.' };
    }
    return { ok: false, message: extractError(data, 'Failed to request password reset.') };
  } catch (err) {
    return { ok: false, message: connectionMessage(err) };
  }
}

/** Confirm password reset by providing email, code, and new password. */
export async function confirmPasswordReset(email: string, code: string, newPassword: string): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await apiFetchRaw(`/api/auth/password/reset-confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, code, new_password: newPassword }),
    });
    const data = await res.json();
    if (res.ok) {
      return { ok: true, message: data.message || 'Password reset successful.' };
    }
    return { ok: false, message: extractError(data, 'Failed to reset password.') };
  } catch (err) {
    return { ok: false, message: connectionMessage(err) };
  }
}

