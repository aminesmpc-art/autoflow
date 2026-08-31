/* ============================================================
   AutoFlow – API Client
   Handles all communication with the backend at api.auto-flow.studio
   ============================================================ */

import { AuthTokens, UserProfile, DailyUsageResponse } from '../types';

const API_BASE_DEFAULT = 'https://api.auto-flow.studio';
const API_BASE_KEY = 'autoflow_api_base';

/**
 * Where the API lives, overridable without a rebuild.
 *
 * The extractor base has worked this way for a long time; the Django API was
 * the one host nailed into the bundle, and that turned out to matter.
 *
 * A MultiLogin profile running through a proxy could not complete a TLS
 * handshake with api.auto-flow.studio — ERR_SSL_PROTOCOL_ERROR — while the
 * same URL in an ordinary profile on the same machine returned a clean 405.
 * The server was healthy from every angle: valid chain, TLS 1.2 and 1.3,
 * correct CORS. What it could not survive was the fingerprint that profile
 * presents, because Railway's edge sits directly in front of it with no CDN in
 * between. Every other site in that profile worked, because every other site
 * is behind one.
 *
 * The real repair is to put a CDN in front of the API. This exists so that the
 * moment such a hostname exists — a Cloudflare-proxied record, a staging
 * endpoint, anything — it can be pointed at from the console rather than
 * waiting on a release:
 *
 *   chrome.storage.local.set({ autoflow_api_base: 'https://api2.example.com' })
 *
 * Cached after the first read: this is asked on every request, and a storage
 * round trip per call would be a needless tax on the normal case.
 */
let apiBaseCache = '';

export async function getApiBase(): Promise<string> {
  if (apiBaseCache) return apiBaseCache;
  try {
    const got = await chrome.storage.local.get(API_BASE_KEY);
    const stored = got?.[API_BASE_KEY];
    apiBaseCache = typeof stored === 'string' && stored
      ? stored.replace(/\/+$/, '')
      : API_BASE_DEFAULT;
  } catch {
    /* No storage — a test, or a context without the extension APIs. */
    apiBaseCache = API_BASE_DEFAULT;
  }
  return apiBaseCache;
}

/* Kept so the many call sites that build `${API_BASE}${path}` keep working.
   It is the default until getApiBase() has resolved an override, and
   resolveApiBase() below is what replaces it at start-up. */
let API_BASE = API_BASE_DEFAULT;

/** Read the override once, early, so every later call uses it. */
export async function resolveApiBase(): Promise<string> {
  API_BASE = await getApiBase();
  return API_BASE;
}

/* The video-reading service.
   A separate host because it does a different job: the Django API holds
   accounts, plans and quotas, while this one holds a Gemini key and feeds it
   whole videos. Overridable from storage so it can be pointed at a local
   FastAPI while working on it, without rebuilding the extension. */
const EXTRACTOR_BASE_DEFAULT = 'https://autoflow-extractor-production.up.railway.app';
const EXTRACTOR_BASE_KEY = 'autoflow_extractor_base';

export async function getExtractorBase(): Promise<string> {
  return new Promise((resolve) => {
    chrome.storage.local.get(EXTRACTOR_BASE_KEY, (result) => {
      const stored = result?.[EXTRACTOR_BASE_KEY];
      resolve(typeof stored === 'string' && stored ? stored.replace(/\/+$/, '') : EXTRACTOR_BASE_DEFAULT);
    });
  });
}

/* The bearer the extractor needs.
   It verifies the same JWT the Django API issues, so there is one login and
   one token — the extension never holds a Gemini key, which is the entire
   reason that service exists. */
export async function getAccessToken(): Promise<string | null> {
  const tokens = await getStoredTokens();
  return tokens?.access || null;
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

// ── Request Timeout ──

/* Every call below used a bare fetch(), which has no deadline of its own. A
   stalled socket therefore never settled the promise, and the sign-in button
   sat disabled on "Signing in…" forever — no error, no way to retry. The auth
   endpoints answer in well under a second, so this ceiling only ever trips on
   a connection that has already gone wrong. */
const REQUEST_TIMEOUT_MS = 15000;

/** A timeout we caused, as opposed to the network being absent entirely.
    Worth telling apart: the advice for each is different. */
class TimeoutError extends Error {
  constructor() {
    super('Request timed out');
    this.name = 'TimeoutError';
  }
}

/**
 * Ask the service worker to make a request this context could not.
 *
 * A fetch from an extension PAGE — the side panel, the Studio window — is an
 * ordinary cross-origin request: it is preflighted, and anything the browser
 * dislikes about it surfaces as a bare "Failed to fetch" with the reason
 * deliberately withheld from the page. A fetch from the SERVICE WORKER is not.
 * Host permissions cover it, CORS does not apply, and there is no preflight to
 * fail.
 *
 * That difference is why this exists. Sign-in failed on a machine where the
 * server was demonstrably correct — the right status, the right
 * Access-Control-Allow-Origin on both the preflight and the response, verified
 * from the same machine with curl — and the panel still could not read it.
 * Rather than keep guessing at which layer of the browser objected, the
 * request goes somewhere the objection cannot arise.
 *
 * Only reached when the direct attempt has already failed, so the ordinary
 * path is unchanged and this costs nothing when nothing is wrong.
 */
let lastWorkerFailure = '';

/**
 * Whether Chrome is currently letting this extension talk to the API.
 *
 * host_permissions in the manifest are a REQUEST, not a grant. Chrome can hold
 * them back — the "Site access" setting on the extension's details page — and
 * it re-evaluates when a manifest adds permissions, which an update can do
 * without anybody choosing it. While a host is withheld, every fetch to it
 * fails from the page AND from the service worker, with the same bare "Failed
 * to fetch" a network outage gives.
 *
 * That is a cruel failure to debug: the server is fine, the browser reaches it
 * in a normal tab, curl reaches it, and only the extension cannot. Told to
 * check their internet connection, a user will check the one thing that is
 * definitely working.
 *
 * Returns null when the question cannot be asked, so a genuine network problem
 * is never reported as a permission one.
 */
async function apiHostAllowed(): Promise<boolean | null> {
  try {
    if (typeof chrome === 'undefined' || !chrome.permissions?.contains) return null;
    return await chrome.permissions.contains({ origins: [`${API_BASE}/*`] });
  } catch {
    return null;
  }
}

/** Filled in when a request fails, so the message can name the real cause. */
let lastHostWithheld = false;

async function fetchViaWorker(url: string, options: RequestInit): Promise<Response | null> {
  lastWorkerFailure = '';
  try {
    if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) return null;

    const headers: Record<string, string> = {};
    new Headers(options.headers || {}).forEach((v, k) => { headers[k] = v; });

    const reply: any = await chrome.runtime.sendMessage({
      type: 'API_FETCH',
      url,
      method: options.method || 'GET',
      headers,
      body: typeof options.body === 'string' ? options.body : undefined,
    });

    if (!reply?.ok) {
      /* The worker tried and could not either. That is the single most useful
         fact available — it means the request never leaves the machine, so the
         problem is the network or something intercepting it, not this page's
         cross-origin context. Carried out so the message can say so. */
      lastWorkerFailure = String(reply?.error || 'no reply');
      return null;
    }
    return new Response(reply.body ?? '', {
      status: reply.status,
      statusText: reply.statusText || '',
      headers: reply.headers || {},
    });
  } catch (e: any) {
    /* The worker is asleep, or this is not an extension context at all. */
    lastWorkerFailure = `worker unreachable: ${e?.message || e}`;
    return null;
  }
}

async function timedFetch(
  url: string,
  options: RequestInit = {},
  timeoutMs = REQUEST_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    // An abort arrives as a generic AbortError; relabel ours so callers can
    // say something more useful than "check your connection".
    if (timedOut) throw new TimeoutError();

    /* Refused rather than timed out. The worker can often make the same
       request successfully — see fetchViaWorker for why. */
    const viaWorker = await fetchViaWorker(url, options);
    if (viaWorker) return viaWorker;

    /* Both refused. Before blaming the network, ask whether Chrome is even
       letting us reach this host — a withheld permission looks exactly like
       an outage from in here. */
    lastHostWithheld = (await apiHostAllowed()) === false;

    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * What to show the user when a request in this module throws.
 *
 * It used to say only "Could not reach the server. Check your internet
 * connection." for every non-timeout failure, which is four very different
 * problems wearing the same sentence: no network, DNS gone, the response
 * blocked by CORS, or the request blocked by the extension's own CSP. The last
 * two are not the user's internet and no amount of checking it will help.
 *
 * That cost hours once. The server was answering 401 correctly to curl from
 * the same machine while the panel insisted the server was unreachable, and
 * nothing on screen could tell the two apart — the browser deliberately hides
 * the reason from the page, so the only place it exists is the console, which
 * a normal user will never open.
 *
 * So the underlying text is appended when there is any. It is short, it is in
 * parentheses, and it is the difference between a bug report that says "does
 * not work" and one that says which of the four it was.
 */
function networkErrorMessage(err: unknown): string {
  if (err instanceof TimeoutError) {
    return 'The server took too long to respond. Please try again.';
  }
  if (lastHostWithheld) {
    return 'Chrome is blocking this extension from reaching the server. '
      + 'Open chrome://extensions, click Details on AutoFlow Studio, and set '
      + 'Site access to "On all sites".';
  }
  const detail = err instanceof Error && err.message ? ` (${err.message})` : '';
  /* What the SERVICE WORKER got, when the page's own attempt was refused and
     the worker was asked to try. Worth showing because the two answers mean
     opposite things: the worker succeeding means the page's context was the
     problem, and the worker failing the same way means the request is not
     reaching the network at all. */
  const viaWorker = lastWorkerFailure ? ` [worker: ${lastWorkerFailure}]` : '';
  return `Could not reach the server. Check your internet connection.${detail}${viaWorker}`;
}

// ── Core Fetch Wrapper ──

/* Read off the manifest instead of being restated here — this said 5.1, which
   is not even this extension's numbering. Nothing on the server reads the
   header today, so it is informational, but informational and wrong is worse
   than absent. The guard is for the non-extension contexts this module also
   runs in. */
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

  const response = await timedFetch(`${API_BASE}${path}`, {
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
    const res = await timedFetch(`${API_BASE}/api/auth/refresh`, {
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
    const res = await timedFetch(`${API_BASE}/api/auth/me`, {
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
    const res = await timedFetch(`${API_BASE}/api/auth/register`, {
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
    return { ok: false, message: networkErrorMessage(err) };
  }
}

export async function login(email: string, password: string): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await timedFetch(`${API_BASE}/api/auth/login`, {
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
    return { ok: false, message: networkErrorMessage(err) };
  }
}

export async function loginWithGoogle(idToken: string): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await timedFetch(`${API_BASE}/api/auth/google`, {
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
    return { ok: false, message: networkErrorMessage(err) };
  }
}

export const DEFAULT_GOOGLE_CLIENT_ID =
  '202771542299-9de70n12u6bci4tnolh94itjm8vrseej.apps.googleusercontent.com';

export async function getGoogleConfig(): Promise<{ client_id: string }> {
  try {
    const res = await timedFetch(`${API_BASE}/api/auth/google/config`, {}, 8000);
    if (res.ok) {
      const data = await res.json();
      if (data?.client_id) return data;
    }
  } catch (err) {
    console.warn('[AutoFlow] Backend config fetch timed out or failed, using fallback Google client ID:', err);
  }
  return { client_id: DEFAULT_GOOGLE_CLIENT_ID };
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
      daily_limit: data.profile?.daily_limit ?? 50,
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
      text_limit: data.is_pro_active ? 999 : (data.text_daily_limit ?? 50),
      text_remaining: data.is_pro_active ? 999 : (data.text_remaining_today ?? 50),
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
export async function consumeQueueRun(mode: 'lite' | 'flow' | 'full', promptCount: number, promptType: 'text' | 'full' = 'text', textCount?: number, fullCount?: number): Promise<QueueRunCheckResult> {
  try {
    // If per-type counts are provided, send them for accurate mixed-queue tracking
    const payload: Record<string, unknown> = { mode, prompt_count: promptCount, prompt_type: promptType };
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
    const res = await timedFetch(`${API_BASE}/api/auth/password/reset-request`, {
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
    return { ok: false, message: networkErrorMessage(err) };
  }
}

/** Confirm password reset by providing email, code, and new password. */
export async function confirmPasswordReset(email: string, code: string, newPassword: string): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await timedFetch(`${API_BASE}/api/auth/password/reset-confirm`, {
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
    return { ok: false, message: networkErrorMessage(err) };
  }
}


/* ── Community templates ──
   Workflows other people published. A separate endpoint from the official
   bundle, and a separate failure: if this 500s the gallery still has every
   curated template, which is why the two are never merged server-side. */

export interface CommunityCard {
  id: string;
  name: string;
  description: string;
  category: string;
  thumbnail: string;
  nodeCount: number;
  author: string;
  likes: number;
  installs: number;
  liked: boolean;
  community: true;
  /** Only on the detail call — the list deliberately omits it. */
  payload?: any;
}

/** The published community gallery. Never throws; an empty list is the floor. */
export async function listCommunityTemplates(
  sort: 'top' | 'new' | 'installs' = 'top',
): Promise<CommunityCard[]> {
  try {
    const res = await apiFetch(`/api/templates/community?sort=${sort}`);
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data?.templates) ? data.templates : [];
  } catch {
    return [];
  }
}

/** One template, with its graph. Opening it is what counts as an install. */
export async function getCommunityTemplate(id: string): Promise<CommunityCard | null> {
  const numeric = String(id).replace(/^community_/, '');
  try {
    const res = await apiFetch(`/api/templates/community/${numeric}`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/** Toggle a like. Returns the server's count, which is the authority. */
export async function likeCommunityTemplate(
  id: string,
): Promise<{ ok: boolean; liked?: boolean; likes?: number; message?: string }> {
  const numeric = String(id).replace(/^community_/, '');
  try {
    const res = await apiFetch(`/api/templates/community/${numeric}/like`, { method: 'POST' });
    if (res.status === 401) return { ok: false, message: 'Sign in to like a template.' };
    if (!res.ok) return { ok: false, message: 'Could not reach AutoFlow.' };
    const data = await res.json();
    return { ok: true, liked: !!data.liked, likes: Number(data.likes) || 0 };
  } catch {
    return { ok: false, message: 'Could not reach AutoFlow.' };
  }
}

/** Share a workflow. It lands pending, never live — see apps/workflows. */
export async function submitCommunityTemplate(
  template: any,
  authorName: string,
): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await apiFetch('/api/templates/community/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ template, author_name: authorName, name: template?.name }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) return { ok: false, message: 'Sign in to share a template.' };
    if (!res.ok) return { ok: false, message: extractError(data, 'Could not share that template.') };
    return { ok: true, message: data.detail || 'Shared — it appears once a moderator approves it.' };
  } catch {
    return { ok: false, message: 'Could not reach AutoFlow. Check your connection.' };
  }
}
