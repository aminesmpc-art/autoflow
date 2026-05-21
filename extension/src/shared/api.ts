/* ============================================================
   AutoFlow – API Client
   Handles all communication with the backend at api.auto-flow.studio
   ============================================================ */

import { AuthTokens, UserProfile, DailyUsageResponse } from '../types';

const API_BASE = 'https://api.auto-flow.studio';
const WHOP_CHECKOUT_URL = 'https://whop.com/checkout/plan_fxMVMOmbFPcp4';

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
  
  // Prevent aggressive browser caching for GET requests
  if (!options.method || options.method.toUpperCase() === 'GET') {
    headers.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    headers.set('Pragma', 'no-cache');
    headers.set('Expires', '0');
  }

  if (tokens?.access) {
    headers.set('Authorization', `Bearer ${tokens.access}`);
  }

  const response = await fetch(`${API_BASE}${path}`, {
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
    const res = await fetch(`${API_BASE}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh: refreshToken }),
    });

    if (!res.ok) {
      await clearTokens();
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
    return false;
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
    const res = await fetch(`${API_BASE}/api/auth/register`, {
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
    return { ok: false, message: 'Could not reach the server. Check your internet connection.' };
  }
}

export async function login(email: string, password: string): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await fetch(`${API_BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    const data = await res.json();

    if (!res.ok) {
      return { ok: false, message: extractError(data, 'Invalid email or password.') };
    }

    await storeTokens({ access: data.access, refresh: data.refresh });
    return { ok: true, message: 'Logged in!' };
  } catch (err) {
    return { ok: false, message: 'Could not reach the server. Check your internet connection.' };
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
      lite_limit: data.is_pro_active ? 999 : (data.lite_daily_limit ?? 3),
      lite_remaining: data.is_pro_active ? 999 : (data.lite_remaining_today ?? 3),
      flow_used: data.flow_runs_today ?? 0,
      flow_limit: data.is_pro_active ? 999 : (data.flow_daily_limit ?? 6),
      flow_remaining: data.is_pro_active ? 999 : (data.flow_remaining_today ?? 6),
      full_monthly_used: data.full_runs_this_month ?? 0,
      full_monthly_limit: data.is_pro_active ? 999 : (data.full_monthly_limit ?? 2),
      full_monthly_remaining: data.is_pro_active ? 999 : (data.full_remaining_this_month ?? 2),
    };
  } catch {
    return null;
  }
}

export async function trackUsage(promptCount: number = 1, promptType: 'text' | 'full' = 'text'): Promise<boolean> {
  try {
    const res = await apiFetch('/api/usage/consume', {
      method: 'POST',
      body: JSON.stringify({ prompt_count: promptCount, prompt_type: promptType }),
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

/** Get Whop checkout URL, optionally prefilled with user's email. */
export async function getUpgradeUrl(): Promise<string> {
  const profile = await getProfile();
  if (profile?.email) {
    return `${WHOP_CHECKOUT_URL}?d=${encodeURIComponent(profile.email)}`;
  }
  return WHOP_CHECKOUT_URL;
}

// ── Rewards API ──

export async function claimReviewReward(reviewerName: string): Promise<{ status: string; message: string }> {
  try {
    const res = await apiFetch('/api/rewards/claim-review', { 
      method: 'POST',
      body: JSON.stringify({ reviewer_name: reviewerName })
    });
    const data = await res.json();
    return { status: data.status || 'error', message: data.message || 'Unknown error' };
  } catch (err) {
    return { status: 'error', message: 'Network error' };
  }
}

export async function getReviewRewardStatus(): Promise<{ status: string; pro_until?: string }> {
  try {
    const res = await apiFetch('/api/rewards/review-status');
    if (!res.ok) return { status: 'none' };
    const data = await res.json();
    return { status: data.status || 'none', pro_until: data.pro_until };
  } catch (err) {
    return { status: 'none' };
  }
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
        period: 'month',
        message: usage.full_monthly_remaining <= 0 ? `Full mode limit reached (${usage.full_monthly_limit}/month). Upgrade to Pro for unlimited.` : undefined,
      };
    }
  } catch {
    return { allowed: false, used: 0, limit: 0, remaining: 0, period: 'day', message: 'Unable to verify limits.' };
  }
}

/** Consume a queue run server-side. Call BEFORE starting the queue. */
export async function consumeQueueRun(mode: 'lite' | 'flow' | 'full', promptCount: number): Promise<QueueRunCheckResult> {
  try {
    const res = await apiFetch('/api/usage/queue-run', {
      method: 'POST',
      body: JSON.stringify({ mode, prompt_count: promptCount }),
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
