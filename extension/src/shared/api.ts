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

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };

  if (tokens?.access) {
    headers['Authorization'] = `Bearer ${tokens.access}`;
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

/** Get Whop checkout URL, optionally prefilled with user's email. */
export async function getUpgradeUrl(): Promise<string> {
  const profile = await getProfile();
  if (profile?.email) {
    return `${WHOP_CHECKOUT_URL}?d=${encodeURIComponent(profile.email)}`;
  }
  return WHOP_CHECKOUT_URL;
}
