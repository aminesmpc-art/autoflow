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

// ── Internal state ──

/** Cache of generation statuses, keyed by media UUID */
const statusCache = new Map<string, FlowGenerationStatus>();

/** Last known remaining credits */
let cachedCredits: number | null = null;

/** Whether the MAIN world interceptor is installed */
let interceptorInstalled = false;

/** Timestamp of last cache update (from intercepted response) */
let lastCacheUpdate = 0;

/** Timestamp when the current queue started (set by automation engine) */
let queueStartTime = 0;

/** Media IDs known BEFORE the current prompt was submitted (for diff tracking) */
let preSubmitSnapshot = new Set<string>();

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
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (!event.data || event.data.source !== 'autoflow-api-interceptor') return;

    const { type, payload } = event.data;

    if ((type === 'STATUS_UPDATE' || type === 'GENERATION_SUBMITTED') && payload?.media) {
      const credits = payload.remainingCredits;
      if (typeof credits === 'number') cachedCredits = credits;

      for (const entry of payload.media) {
        const status = parseMediaEntry(entry, credits);
        if (status) {
          statusCache.set(status.mediaId, status);
        }
      }
      lastCacheUpdate = Date.now();
    }
  });

  if (!interceptorInstalled) {
    try {
      await chrome.runtime.sendMessage({ type: 'INSTALL_NETWORK_SNIFFER' });
      interceptorInstalled = true;
    } catch {
      // Non-critical — extension works fine without API data
    }
  }
}

// ── Queue lifecycle ──

/**
 * Call when a new queue starts. Clears old cached data and marks
 * the start time so we can filter entries from the current queue.
 */
export function onQueueStart(): void {
  statusCache.clear();
  cachedCredits = null;
  lastCacheUpdate = 0;
  queueStartTime = Date.now();
  preSubmitSnapshot.clear();
}

/**
 * Call BEFORE clicking Generate. Snapshots current cache keys
 * so we can diff later to find the new generation entry.
 */
export function onBeforeSubmit(): void {
  preSubmitSnapshot = new Set(statusCache.keys());
}

/**
 * Get generation entries that appeared AFTER the last onBeforeSubmit().
 * This gives us the exact generation(s) created by the most recent
 * Generate click — no sorting or guessing needed.
 */
export function getNewSubmissions(): FlowGenerationStatus[] {
  const result: FlowGenerationStatus[] = [];
  for (const [id, status] of statusCache) {
    if (!preSubmitSnapshot.has(id)) {
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
  for (const status of statusCache.values()) {
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
    for (const status of statusCache.values()) {
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
    credits: cachedCredits,
  };
}

// ── Cache accessors ──

/** Get all cached statuses from the current queue period. */
export function getAllCachedStatuses(): FlowGenerationStatus[] {
  if (queueStartTime === 0) return Array.from(statusCache.values());

  return Array.from(statusCache.values()).filter(s => {
    if (!s.createdAt) return true;
    return new Date(s.createdAt).getTime() >= queueStartTime - 60_000;
  });
}

/** Get a cached status by media ID. */
export function getCachedStatus(mediaId: string): FlowGenerationStatus | undefined {
  return statusCache.get(mediaId);
}

/** Get last known remaining credits. */
export function getRemainingCredits(): number | null {
  return cachedCredits;
}

/** Get timestamp of last cache update. */
export function getLastCacheUpdate(): number {
  return lastCacheUpdate;
}

/** Check if the cache has data and it's fresh (updated within N ms). */
export function isCacheFresh(maxAgeMs = 15_000): boolean {
  return lastCacheUpdate > 0 && (Date.now() - lastCacheUpdate) < maxAgeMs;
}

/** Check if the API has any data at all (interceptor is working). */
export function isApiAvailable(): boolean {
  return lastCacheUpdate > 0;
}

/** Clear the status cache. */
export function clearCache(): void {
  statusCache.clear();
  lastCacheUpdate = 0;
  preSubmitSnapshot.clear();
}

// ── Direct media ID lookup ──

/**
 * Find an API status entry by its exact media ID.
 * No text matching — direct, reliable lookup.
 */
export function findStatusByMediaId(mediaId: string): FlowGenerationStatus | null {
  return statusCache.get(mediaId) || null;
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
 * NOTE: This is the ONLY place we make an active API call. One call per
 * verification round — not spammy, just like what Flow does every 5 seconds.
 */
export async function activeStatusCheck(): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    // Create a script element to call __af_activeCheck in MAIN world
    const script = document.createElement('script');
    script.textContent = `
      (async () => {
        const result = typeof window.__af_activeCheck === 'function'
          ? await window.__af_activeCheck()
          : false;
        window.postMessage({
          source: 'autoflow-api-interceptor',
          type: 'ACTIVE_CHECK_RESULT',
          payload: { success: result }
        }, '*');
      })();
    `;
    document.documentElement.appendChild(script);
    script.remove();

    // Listen for the result
    const handler = (event: MessageEvent) => {
      if (event.source !== window) return;
      if (event.data?.source !== 'autoflow-api-interceptor') return;
      if (event.data?.type !== 'ACTIVE_CHECK_RESULT') return;
      window.removeEventListener('message', handler);
      resolve(event.data.payload?.success === true);
    };
    window.addEventListener('message', handler);

    // Timeout after 10s — don't wait forever
    setTimeout(() => {
      window.removeEventListener('message', handler);
      resolve(false);
    }, 10_000);
  });
}
