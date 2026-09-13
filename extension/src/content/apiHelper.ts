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

import { FlowGenerationStatus, FlowGenerationState, FlowMediaKind } from '../types';

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
  /** promptKey -> the media ids the interceptor tied to that prompt. */
  boundMediaIds: Map<string, string[]>;
  /** The build the MAIN-world interceptor in this tab reports. */
  interceptorBuild: string;
  /** So the stale-failure warning is logged once, not per record. */
  warnedAboutStaleFailure: boolean;
  /** What this queue is generating, so a completion can be checked against it. */
  expectMedia: 'video' | 'image';
  /** So the input-media warning is logged once, not per record. */
  warnedAboutInputMedia: boolean;
  lastInterceptorError: string | null;
  messageListenerRegistered: boolean;
  /** When the MAIN-world interceptor last proved it is running, 0 if never. */
  interceptorAliveAt: number;
  /** The most recent media file Flow fetched, for the panel's preview. */
  lastMediaUrl: string;
  lastMediaUrlAt: number;
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
      boundMediaIds: new Map<string, string[]>(),
      interceptorBuild: '',
      warnedAboutStaleFailure: false,
      expectMedia: 'video',
      warnedAboutInputMedia: false,
      lastInterceptorError: null,
      interceptorAliveAt: 0,
      lastMediaUrl: '',
      lastMediaUrlAt: 0,
      messageListenerRegistered: false,
    };
  }
  return win.__af_api_state;
}

/**
 * Whether media of this kind proves the thing the queue asked for exists.
 *
 * `legacy` satisfies both: labs.google's redirect is kind-agnostic and was
 * only ever issued for a media that existed, so refusing it would break the
 * old site for no gain. An unset kind satisfies both too — it means the
 * status came from a path that predates this field (the tRPC parser, an older
 * interceptor still resident in the tab), and treating silence as failure
 * would stall those runs rather than correct them.
 */
export function kindSatisfies(kind: FlowMediaKind | undefined, want: 'video' | 'image'): boolean {
  if (!kind) return true;
  if (kind === 'legacy') return true;
  return kind === want;
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
      combined.includes('FILTERED') || combined.includes('POLICY') || combined.includes('POLICIES') ||
      combined.includes('REJECTED') || combined.includes('PROHIBITED') ||
      combined.includes('HARMFUL') || combined.includes('VIOLAT') ||
      combined.includes('CONTENT_FILTER') || combined.includes('NSFW') ||
      combined.includes('PROMINENT') || combined.includes('DEEPFAKE') ||
      combined.includes('INAPPROPRIATE') || combined.includes('IMPERSONAT') ||
      combined.includes('PERSON') || combined.includes('CELEBRITY') ||
      combined.includes('DANGEROUS') || combined.includes('ILLEGAL')) {
    return 'safety';
  }
  if (combined.includes('QUOTA') || combined.includes('RATE') || combined.includes('LIMIT') ||
      combined.includes('CAPACITY') || combined.includes('RESOURCE') ||
      combined.includes('UNUSUAL') || combined.includes('INUSUAL')) {
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

/**
 * Record that fresh data landed, and announce the API the first time it does.
 *
 * Shared by both protocol branches. The announcement fires once, on the
 * transition out of "nothing has ever arrived" — that edge is what the panel's
 * badge reads, and it is the reason the badge sat on "API Passive": on
 * flow.google.com nothing ever reached this function at all.
 */
function cacheUpdated(state: GlobalApiState): void {
  const wasApiAvailable = state.lastCacheUpdate > 0;
  state.lastCacheUpdate = Date.now();

  if (!wasApiAvailable) {
    chrome.runtime.sendMessage({
      type: 'API_STATUS_CHANGED',
      payload: { isApiAvailable: true },
    }).catch(() => {});
  }
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

      /* The interceptor reporting that it is running. Kept apart from the
         status cache on purpose: this says the pipe is open, the cache says
         data has come through it. Conflating them is what made an idle tab
         indistinguishable from a broken one. */
      if (type === 'INTERCEPTOR_ALIVE') {
        const first = state.interceptorAliveAt === 0;
        state.interceptorAliveAt = Date.now();
        state.interceptorBuild = String(payload?.build || '');
        if (first) {
          chrome.runtime.sendMessage({
            type: 'API_STATUS_CHANGED',
            payload: { isApiAvailable: 'active' },
          }).catch(() => {});
        }
      }

      /* A media file Flow just fetched. Recorded rather than acted on: the
         panel asks for it when the user presses play. */
      if (type === 'MEDIA_URL_SEEN' && typeof payload?.url === 'string') {
        state.lastMediaUrl = payload.url;
        state.lastMediaUrlAt = Date.now();
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
        cacheUpdated(state);
      }

      /* The new site. flow.google.com's batchexecute payloads are positional
         arrays with no field names, so the interceptor reads them where it
         has the raw body and sends statuses already parsed, rather than
         shipping an anonymous nested array here for parseMediaEntry — which
         understands the old tRPC field names and nothing else. */
      if (type === 'STATUS_UPDATE_V2' && Array.isArray(payload?.statuses)) {
        for (const status of payload.statuses as FlowGenerationStatus[]) {
          if (!status?.mediaId) continue;

          /* This API does not state failures, so a 'failed' arriving here is
             never true — it is an older interceptor still running in this
             tab, scanning record text for FAIL / SAFETY / BLOCK / REJECT /
             CANCEL and finding one of them in the user's own prompt.

             It is refused here, at the one door every reader comes through,
             rather than at each place that acts on it. Two runs were lost to
             fixing those one at a time: the first died on "a red hot air
             balloon drifting over a city block at dawn" because processPrompt
             believed it, and after that was guarded the next run still lost
             "a blue crane lifting a safety barrier" and "orange autumn leaves
             rejected by the wind" — because verifyAndReprompt believed it
             too, and marked both a policy refusal with no retry while the
             videos sat finished in the grid.

             Failure is read from the page, where it is stated plainly:
             flow-error-tile, with a reason and a Retry button. */
          if (status.state === 'failed') {
            if (!state.warnedAboutStaleFailure) {
              state.warnedAboutStaleFailure = true;
              console.warn(
                '[AutoFlow] The interceptor in this tab reported an API failure, which this Flow never sends. ' +
                'It is running old code — reload the Flow tab. Ignoring the failure and trusting the page.',
              );
            }
            status.state = 'generating';
            status.rawStatus = 'IGNORED_STALE_FAILURE';
            status.failureReason = '';
          }

          /* A completion is only a completion if what arrived is the thing
             this queue asked for.

             A record references assets it did not produce. On a Frames run it
             carries the two uploaded start/end frames from the moment it is
             submitted, and those are ordinary signed image URLs — so a video
             generation announced itself finished before it had rendered
             anything, and the panel showed 1 ✅ / "All videos processed!"
             over a tile still climbing through 45%.

             Refused here for the same reason the stale failure above is: this
             is the one door every reader comes through. There are twenty-odd
             `state === 'completed'` sites in automation.ts and guarding them
             one at a time is how the last three runs were lost. */
          if (status.state === 'completed' && !kindSatisfies(status.mediaKind, state.expectMedia)) {
            if (!state.warnedAboutInputMedia) {
              state.warnedAboutInputMedia = true;
              console.warn(
                `[AutoFlow] A generation reported itself complete carrying only ` +
                `${status.mediaKind || 'no'} media, and this queue is making ` +
                `${state.expectMedia}s. That is an input frame or a grid poster, ` +
                `not the result — waiting for the real one.`,
              );
            }
            status.state = 'generating';
            status.rawStatus = status.mediaKind === 'thumb' ? 'THUMBNAIL_ONLY' : 'INPUT_MEDIA_ONLY';
            /* Not a usable URL for this queue either — carrying it forward is
               how an uploaded start frame got saved under a video's name. */
            status.mediaUrl = '';
          }

          /* Do not let a later mention downgrade a finished generation.
             Flow re-sends records across calls, and an ancestor listing can
             describe a media more thinly than the call that completed it;
             taking the newer one would put a done video back to generating
             and the queue would wait on it again. */
          const known = state.statusCache.get(status.mediaId);
          if (known?.state === 'completed' && status.state !== 'completed') continue;

          state.statusCache.set(status.mediaId, status);
        }
        cacheUpdated(state);
      }

      /* An exact prompt -> generation binding, made where the request and its
         own response are both in hand. See sw-bypass.ts; the short version is
         that "the first record after I clicked Generate" was picking up other
         traffic on a channel that carries the whole application. */
      if (type === 'GENERATION_BOUND' && Array.isArray(payload?.mediaIds)) {
        const key = promptKey(String(payload.promptText || ''));
        const ids = (payload.mediaIds as string[]).filter(Boolean);
        if (key && ids.length) state.boundMediaIds.set(key, ids);
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
export function onQueueStart(expectMedia: 'video' | 'image' = 'video'): void {
  const state = getApiState();
  state.statusCache.clear();
  state.cachedCredits = null;
  state.lastCacheUpdate = 0;
  state.queueStartTime = Date.now();
  state.preSubmitSnapshot.clear();
  /* What a completion has to carry to count. Without it every record that
     merely references an image — every Frames and every ingredient run —
     reads as a finished video. */
  state.expectMedia = expectMedia;
  state.warnedAboutInputMedia = false;
  /* Bindings belong to one run. Keeping them would let a prompt reused in a
     later queue bind to the generation the earlier queue made for it. */
  state.boundMediaIds.clear();
}

/**
 * Call BEFORE clicking Generate. Snapshots current cache keys
 * so we can diff later to find the new generation entry.
 */
export function onBeforeSubmit(promptText?: string): void {
  const state = getApiState();
  state.preSubmitSnapshot.clear();
  for (const key of state.statusCache.keys()) {
    state.preSubmitSnapshot.add(key);
  }

  /* Tell the interceptor what is about to be submitted, so it can tie the
     reply to the request that carried this text rather than to whatever else
     the page happened to ask for in the same second. The snapshot above stays
     as the fallback for when no binding comes back. */
  if (promptText) {
    try {
      window.postMessage(
        { source: 'autoflow-engine', type: 'PENDING_PROMPT', payload: { text: promptText } },
        '*',
      );
    } catch { /* the fallback still works */ }
  }
}

/**
 * The interceptor build this extension expects to be talking to.
 *
 * Kept beside the one sw-bypass stamps on the window, and bumped with it.
 */
export const EXPECTED_INTERCEPTOR_BUILD = 'batchexecute-3';

/**
 * The build actually running in this tab, or '' if it has not said yet.
 *
 * Why this is worth reporting: a MAIN-world script only injects at
 * document_start, so a Flow tab that was open when the extension was updated
 * keeps running the OLD interceptor for the rest of its life — while the
 * panel, the content script and the worker are all new. Nothing looks wrong.
 * The badge still reads "API Active", because both builds say they are alive.
 *
 * It is not a cosmetic mismatch. An older interceptor reported a generation
 * as failed when any record text contained FAIL, BLOCK, CANCEL, SAFETY or
 * REJECT — and the record includes the user's own prompt. "a red hot air
 * balloon drifting over a city block at dawn" was read as failed three times
 * while the video generated correctly.
 */
export function getInterceptorBuild(): string {
  return getApiState().interceptorBuild;
}

/** True when this tab is running an interceptor older than this build. */
export function isInterceptorStale(): boolean {
  const build = getApiState().interceptorBuild;
  return build !== '' && build !== EXPECTED_INTERCEPTOR_BUILD;
}

/** The comparison form of a prompt: letters and digits, nothing else. */
function promptKey(text: string): string {
  return String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 120);
}

/**
 * The generations the interceptor tied to this exact prompt, if any.
 *
 * Empty when the prompt was too short to match safely, when the binding has
 * not arrived yet, or on the old tRPC path — every caller falls back to the
 * previous heuristic in that case, so this can only improve the answer.
 */
export function findBoundMediaIds(promptText: string): string[] {
  const key = promptKey(promptText);
  if (!key) return [];
  return getApiState().boundMediaIds.get(key) || [];
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
    if (state.preSubmitSnapshot.has(id)) continue;

    /* "New to the cache" is not "new". Flow describes old work whenever the
       project is refreshed or the library is scrolled, so a video generated
       weeks ago can be first SEEN here seconds after Generate was clicked and
       would qualify. getAllCachedStatuses already screens on this; iterating
       the cache directly skipped it. */
    if (state.queueStartTime > 0 && status.createdAt) {
      if (new Date(status.createdAt).getTime() < state.queueStartTime - 60_000) continue;
    }
    result.push(status);
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

/**
 * Whether the MAIN-world interceptor has proved itself in this page.
 *
 * Deliberately sticky rather than time-windowed. Flow only talks to
 * batchexecute when something is happening, so an idle project makes no calls
 * for minutes at a time; ageing this out would report the interception as
 * dead every time the user stopped working, which is the same false alarm
 * this was added to remove.
 */
export function isInterceptorAlive(): boolean {
  return getApiState().interceptorAliveAt > 0;
}

/**
 * Arm the MAIN world to swallow the next file save, then forget any URL we
 * already had so a stale one cannot be mistaken for this capture's result.
 */
export function armPreviewCapture(): void {
  const state = getApiState();
  state.lastMediaUrl = '';
  state.lastMediaUrlAt = 0;
  window.postMessage({ source: 'autoflow-content-script', type: 'ARM_PREVIEW_CAPTURE' }, '*');
}

/** The media URL seen since arming, or '' if none has arrived yet. */
export function takeCapturedMediaUrl(): string {
  const state = getApiState();
  return state.lastMediaUrl;
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
  state.boundMediaIds.clear();
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
