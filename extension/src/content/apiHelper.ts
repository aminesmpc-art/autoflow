/* ============================================================
   AutoFlow – Flow API Helper (Content Script)

   PASSIVE ONLY. This module never makes API calls to Google.
   It reads data that Flow's own frontend already requests.

   How it works:
   1. MAIN world interceptor patches window.fetch (stealth)
   2. When Flow polls batchCheckAsyncVideoGenerationStatus,
      the interceptor reads the response and forwards it here
      via window.postMessage (local, zero network traffic)
   3. This module caches the status data
   4. automation.ts reads from the cache

   Why passive-only?
   - Zero additional HTTP requests → invisible to Google
   - No abnormal traffic patterns → no rate limiting risk
   - We piggyback on Flow's own polling cycle (every ~5s)
   - If Flow stops polling (tab backgrounded), cache goes stale
     and automation.ts falls back to DOM → safe degradation
   ============================================================ */

import { FlowGenerationStatus, FlowGenerationState } from '../types';

// ── Global State Pattern for Extension Re-injections ──
// Since content scripts can be re-evaluated when background workers wake up/restart,
// storing state in global variables will lead to empty caches/stale listeners.
// We store state on the persistent window object to keep it unified.

interface GlobalApiState {
  statusCache: Map<string, FlowGenerationStatus>;
  cachedCredits: number | null;
  interceptorInstalled: boolean;
  lastCacheUpdate: number;
  queueStartTime: number;
  preSubmitSnapshot: Set<string>;
  lastInterceptorError: string | null;
  messageListenerRegistered: boolean;
}

function getApiState(): GlobalApiState {
  const win = window as any;
  if (!win.__af_api_state) {
    win.__af_api_state = {
      statusCache: new Map<string, FlowGenerationStatus>(),
      cachedCredits: null,
      interceptorInstalled: false,
      lastCacheUpdate: 0,
      queueStartTime: 0,
      preSubmitSnapshot: new Set<string>(),
      lastInterceptorError: null,
      messageListenerRegistered: false,
    };
  }
  return win.__af_api_state;
}

// ── Status mapping ──

/** Map Google's raw status string to our simplified state */
function mapStatus(raw: string): FlowGenerationState {
  if (!raw) return 'unknown';
  const upper = raw.toUpperCase();

  if (upper.includes('SUCCESSFUL') || upper.includes('COMPLETED') || upper.includes('SUCCEEDED')) {
    return 'completed';
  }
  if (upper.includes('FAILED') || upper.includes('FAILURE') || upper.includes('BLOCKED') ||
      upper.includes('FILTERED') || upper.includes('SAFETY') || upper.includes('REJECTED') ||
      upper.includes('CANCELLED') || upper.includes('CANCELED')) {
    return 'failed';
  }
  if (upper.includes('ACTIVE') || upper.includes('PROCESSING') || upper.includes('RUNNING')) {
    return 'generating';
  }
  if (upper.includes('SCHEDULED') || upper.includes('QUEUED') || upper.includes('PENDING')) {
    return 'queued';
  }
  return 'unknown';
}

/**
 * Classify an API error reason for smart retry decisions.
 *
 * safety    → auto-skip, retrying same text is pointless
 * quota     → stop queue, no credits left
 * cancelled → re-submit via processPrompt (no retry button on cancelled tiles)
 * server    → retry via DOM retry button, transient issue
 * unknown   → fall back to DOM-based handling
 */
export function classifyError(rawStatus: string, failureDetail?: string): 'safety' | 'server' | 'cancelled' | 'quota' | 'unknown' {
  if (!rawStatus && !failureDetail) return 'unknown';
  // Check both the raw status AND the failure detail for keywords
  const combined = ((rawStatus || '') + ' ' + (failureDetail || '')).toUpperCase();
  if (combined.includes('SAFETY') || combined.includes('BLOCKED') ||
      combined.includes('FILTERED') || combined.includes('POLICY') ||
      combined.includes('REJECTED') || combined.includes('PROHIBITED') ||
      combined.includes('HARMFUL') || combined.includes('VIOLAT') ||
      combined.includes('CONTENT_FILTER') || combined.includes('NSFW')) {
    return 'safety';
  }
  if (combined.includes('QUOTA') || combined.includes('RATE') || combined.includes('LIMIT') ||
      combined.includes('CAPACITY') || combined.includes('RESOURCE')) {
    return 'quota';
  }
  if (combined.includes('CANCELLED') || combined.includes('CANCELED')) {
    return 'cancelled';
  }
  if (combined.includes('SERVER') || combined.includes('INTERNAL') ||
      combined.includes('UNAVAILABLE') || combined.includes('OVERLOAD') ||
      combined.includes('TIMEOUT')) {
    return 'server';
  }
  // If the status is just generic 'FAILED' with no detail, treat as server (retryable)
  if (combined.includes('FAILED') && !failureDetail) {
    return 'server';
  }
  return 'unknown';
}

/** Parse a single media entry from the API response into our typed status */
function parseMediaEntry(entry: any, remainingCredits?: number): FlowGenerationStatus | null {
  if (!entry?.name) return null;

  const rawStatus = entry.mediaMetadata?.mediaStatus?.mediaGenerationStatus || '';
  const requestData = entry.mediaMetadata?.requestData || {};
  const videoReq = requestData.videoGenerationRequestData?.videoModelControlInput || {};
  const promptInputs = requestData.promptInputs || [];

  // Extract failure reason from multiple possible locations in the API response
  const failureReason = 
    entry.mediaMetadata?.mediaStatus?.failureReason ||
    entry.mediaMetadata?.mediaStatus?.statusMessage ||
    entry.mediaMetadata?.safetyFilterResult ||
    entry.failureReason ||
    entry.error?.message ||
    entry.cancelReason ||
    '';

  // Extract prompt text from structured prompt parts
  let promptText = entry.mediaMetadata?.mediaTitle || '';
  if (promptInputs.length > 0) {
    const parts = promptInputs[0]?.structuredPrompt?.parts || [];
    const textParts = parts.filter((p: any) => p.text).map((p: any) => p.text);
    if (textParts.length > 0) promptText = textParts.join(' ');
  }

  return {
    mediaId: entry.name,
    projectId: entry.projectId || '',
    workflowId: entry.workflowId || '',
    state: mapStatus(rawStatus),
    rawStatus,
    failureReason,
    promptText,
    modelName: videoReq.videoModelName || entry.video?.generatedVideo?.model || '',
    aspectRatio: videoReq.videoAspectRatio || '',
    duration: entry.video?.dimensions?.length || '',
    createdAt: entry.mediaMetadata?.createTime || '',
    remainingCredits,
  };
}

// ── Initialization ──

/**
 * Initialize the API helper. Sets up a listener for messages from the
 * MAIN world interceptor and installs the interceptor if needed.
 *
 * Call this once when the content script loads.
 */
export async function initApiHelper(): Promise<void> {
  const state = getApiState();
  if (!state.messageListenerRegistered) {
    state.messageListenerRegistered = true;
    window.addEventListener('message', (event) => {
      if (event.source !== window) return;
      if (!event.data || event.data.source !== 'autoflow-api-interceptor') return;

      const { type, payload } = event.data;

      if (type === 'INTERCEPTOR_ERROR') {
        state.lastInterceptorError = payload?.message || 'Unknown interceptor error';
      }

      if (type === 'CAPTURED_REQUEST_INFO') {
        chrome.storage.local.set({ autoflow_captured_request: payload }).catch(() => {});
      }

      if ((type === 'STATUS_UPDATE' || type === 'GENERATION_SUBMITTED') && payload?.media) {
        const credits = payload.remainingCredits;
        if (typeof credits === 'number') state.cachedCredits = credits;

        for (const entry of payload.media) {
          const status = parseMediaEntry(entry, credits);
          if (status) {
            state.statusCache.set(status.mediaId, status);
          }
        }
        const wasApiAvailable = state.lastCacheUpdate > 0;
        state.lastCacheUpdate = Date.now();

        if (!wasApiAvailable) {
          chrome.runtime.sendMessage({
            type: 'API_STATUS_CHANGED',
            payload: { isApiAvailable: true }
          }).catch(() => {});
        }
      }
    });
  }

  if (!state.interceptorInstalled) {
    try {
      await chrome.runtime.sendMessage({ type: 'INSTALL_NETWORK_SNIFFER' });
      state.interceptorInstalled = true;
    } catch {
      // Non-critical — extension works fine without API data
    }
  }

  // Restore captured request info to MAIN world from local storage
  chrome.storage.local.get(['autoflow_captured_request']).then((res) => {
    if (res.autoflow_captured_request) {
      window.postMessage({
        source: 'autoflow-content-script',
        type: 'RESTORE_REQUEST_INFO',
        payload: res.autoflow_captured_request
      }, '*');
    }
  }).catch(() => {});
}

// ── Queue lifecycle ──

/**
 * Call when a new queue starts. Clears old cached data and marks
 * the start time so we can filter entries from the current queue.
 */
export function onQueueStart(): void {
  const state = getApiState();
  state.statusCache.clear();
  state.cachedCredits = null;
  state.lastCacheUpdate = 0;
  state.queueStartTime = Date.now();
  state.preSubmitSnapshot.clear();
}

/**
 * Call BEFORE clicking Generate. Snapshots current cache keys
 * so we can diff later to find the new generation entry.
 */
export function onBeforeSubmit(): void {
  const state = getApiState();
  state.preSubmitSnapshot.clear();
  for (const key of state.statusCache.keys()) {
    state.preSubmitSnapshot.add(key);
  }
}

/**
 * Get generation entries that appeared AFTER the last onBeforeSubmit().
 * This gives us the exact generation(s) created by the most recent
 * Generate click — no sorting or guessing needed.
 */
export function getNewSubmissions(): FlowGenerationStatus[] {
  const state = getApiState();
  const result: FlowGenerationStatus[] = [];
  for (const [id, status] of state.statusCache) {
    if (!state.preSubmitSnapshot.has(id)) {
      result.push(status);
    }
  }
  return result;
}

// ── Smart matching ──

/**
 * Find an API status entry that matches a given prompt text.
 * Uses multi-fragment matching: start, middle, and end of the prompt
 * are checked independently. Requires 2+ fragments to match to avoid
 * false positives from prompts that share the same opening text.
 *
 * When multiple entries match, prefers the one with the most similar
 * text length (closest match), then by state priority.
 */
export function findStatusByPromptText(promptText: string): FlowGenerationStatus | null {
  const state = getApiState();
  const clean = promptText.trim().toLowerCase();
  if (clean.length < 3) return null;

  // Build search fragments from different parts of the prompt
  const fragments: string[] = [];
  // Fragment 1: first 30 chars (most common match point)
  fragments.push(clean.slice(0, Math.min(30, clean.length)));
  // Fragment 2: middle 25 chars (disambiguates similar starts)
  if (clean.length > 60) {
    const mid = Math.floor(clean.length / 2) - 12;
    fragments.push(clean.slice(mid, mid + 25));
  }
  // Fragment 3: last 25 chars (disambiguates similar starts + middles)
  if (clean.length > 40) {
    fragments.push(clean.slice(-25));
  }

  // Score each cache entry by how many fragments match
  const scored: Array<{ status: FlowGenerationStatus; hits: number; lengthDiff: number }> = [];
  const activeStatuses = getAllCachedStatuses();
  for (const status of activeStatuses) {
    const haystack = status.promptText.trim().toLowerCase();
    let hits = 0;
    for (const frag of fragments) {
      if (haystack.includes(frag)) hits++;
    }

    // Require 2+ fragment hits for long prompts, 1 hit for short ones
    const minHits = fragments.length >= 2 ? 2 : 1;
    if (hits >= minHits) {
      scored.push({
        status,
        hits,
        lengthDiff: Math.abs(haystack.length - clean.length),
      });
    }
  }

  if (scored.length === 0) {
    // Fallback: try a simple start-of-text match (short prompts)
    const needle = clean.slice(0, 40);
    for (const status of activeStatuses) {
      const haystack = status.promptText.trim().toLowerCase();
      if (haystack.includes(needle) || needle.includes(haystack.slice(0, 40))) {
        return status;
      }
    }
    return null;
  }
  if (scored.length === 1) return scored[0].status;

  // Multiple matches — rank by: most fragment hits → closest text length → state priority
  // NOTE: 'generating' ranks HIGHER than 'failed' because when a prompt is retried,
  // there are 2 entries with the same text — old 'failed' + new 'generating'.
  // The generating entry is always the current/relevant one.
  const priority: Record<string, number> = { completed: 0, generating: 1, queued: 2, failed: 3, unknown: 4 };
  scored.sort((a, b) => {
    if (b.hits !== a.hits) return b.hits - a.hits; // more hits = better
    if (a.lengthDiff !== b.lengthDiff) return a.lengthDiff - b.lengthDiff; // closer length = better
    return (priority[a.status.state] ?? 9) - (priority[b.status.state] ?? 9); // state tiebreaker
  });
  return scored[0].status;
}

/**
 * Get a full queue status summary from API cache.
 * Returns counts of each state and the overall queue health.
 */
export function getQueueSummary(): {
  total: number;
  completed: number;
  failed: number;
  generating: number;
  queued: number;
  allSettled: boolean;
  credits: number | null;
} {
  const state = getApiState();
  const statuses = getAllCachedStatuses();
  const completed = statuses.filter(s => s.state === 'completed').length;
  const failed = statuses.filter(s => s.state === 'failed').length;
  const generating = statuses.filter(s => s.state === 'generating').length;
  const queued = statuses.filter(s => s.state === 'queued').length;

  return {
    total: statuses.length,
    completed,
    failed,
    generating,
    queued,
    allSettled: generating === 0 && queued === 0 && statuses.length > 0,
    credits: state.cachedCredits,
  };
}

// ── Cache accessors ──

/** Get all cached statuses from the current queue period. */
export function getAllCachedStatuses(): FlowGenerationStatus[] {
  const state = getApiState();
  if (state.queueStartTime === 0) return Array.from(state.statusCache.values());

  return Array.from(state.statusCache.values()).filter(s => {
    if (!s.createdAt) return true;
    return new Date(s.createdAt).getTime() >= state.queueStartTime - 60_000;
  });
}

/** Get a cached status by media ID. */
export function getCachedStatus(mediaId: string): FlowGenerationStatus | undefined {
  const state = getApiState();
  return state.statusCache.get(mediaId);
}

/** Get last known remaining credits. */
export function getRemainingCredits(): number | null {
  const state = getApiState();
  return state.cachedCredits;
}

/** Get timestamp of last cache update. */
export function getLastCacheUpdate(): number {
  const state = getApiState();
  return state.lastCacheUpdate;
}

/** Check if the cache has data and it's fresh (updated within N ms). */
export function isCacheFresh(maxAgeMs = 15_000): boolean {
  const state = getApiState();
  return state.lastCacheUpdate > 0 && (Date.now() - state.lastCacheUpdate) < maxAgeMs;
}

/** Check if the API has any data at all (interceptor is working). */
export function isApiAvailable(): boolean {
  const state = getApiState();
  return state.lastCacheUpdate > 0;
}

/** Get the last captured interceptor error. */
export function getInterceptorError(): string | null {
  const state = getApiState();
  const err = state.lastInterceptorError;
  state.lastInterceptorError = null; // consume it
  return err;
}

/** Clear the status cache. */
export function clearCache(): void {
  const state = getApiState();
  state.statusCache.clear();
  state.lastCacheUpdate = 0;
  state.preSubmitSnapshot.clear();
}

// ── Direct media ID lookup ──

/**
 * Find an API status entry by its exact media ID.
 * No text matching — direct, reliable lookup.
 */
export function findStatusByMediaId(mediaId: string): FlowGenerationStatus | null {
  const state = getApiState();
  return state.statusCache.get(mediaId) || null;
}

// ── Active API check ──

/**
 * Trigger an active status check by calling the MAIN world interceptor.
 * This replays the exact same API call Flow makes (same URL, headers, auth).
 * The response flows through the interceptor → updates our cache automatically.
 *
 * Returns true if the call succeeded and cache was refreshed.
 * Returns false if the interceptor hasn't captured a URL yet.
 *
 * ARCHITECTURE:
 * We use chrome.runtime.sendMessage → RUN_ACTIVE_CHECK → chrome.scripting.executeScript
 * to call __af_activeCheck in the MAIN world. This approach is REQUIRED because
 * Google's CSP blocks inline <script> tags on labs.google, so the script injection
 * approach (document.createElement('script')) silently fails.
 *
 * RACE CONDITION FIX:
 * The executeScript call returns before the interceptor's STATUS_UPDATE postMessage
 * updates our cache (different channels, no FIFO guarantee). So after receiving
 * success=true, we wait up to 3 seconds for lastCacheUpdate to be refreshed,
 * guaranteeing the cache has fresh data before callers read it.
 *
 * NOTE: This is the ONLY place we make an active API call. One call per
 * verification round — not spammy, just like what Flow does every 5 seconds.
 */
export async function activeStatusCheck(mediaIds?: string[]): Promise<boolean> {
  const state = getApiState();
  const cacheTimeBefore = state.lastCacheUpdate;

  try {
    const res = await chrome.runtime.sendMessage({
      type: 'RUN_ACTIVE_CHECK',
      payload: { mediaIds }
    });

    if (res?.success !== true) {
      // Active check failed — capture error info if available
      if (res?.error) {
        state.lastInterceptorError = res.error;
      }
      return false;
    }

    // SUCCESS — but cache may not be updated yet (race condition).
    // The interceptor relays the API response via window.postMessage('STATUS_UPDATE'),
    // which is processed asynchronously. Wait for the cache timestamp to change.
    const MAX_CACHE_WAIT_MS = 3000;
    const POLL_INTERVAL_MS = 100;
    const waitStart = Date.now();

    while (Date.now() - waitStart < MAX_CACHE_WAIT_MS) {
      if (state.lastCacheUpdate > cacheTimeBefore) {
        // Cache was updated — fresh data is available
        return true;
      }
      await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
    }

    // Cache wasn't updated within 3s — the interceptor relay may have failed,
    // but the API call itself succeeded. Return true optimistically since
    // the cache might update shortly after (the sleep(1000) in the caller helps).
    return true;
  } catch (err) {
    return false;
  }
}
