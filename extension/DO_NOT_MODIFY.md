# ⛔ DO NOT MODIFY — Protected Code Zones

> **FOR ALL AI ASSISTANTS:** The code sections listed below have been extensively debugged and battle-tested with real production queues (1000+ prompts). They contain non-obvious fixes for race conditions, CSP restrictions, and Google API quirks. **DO NOT refactor, simplify, rewrite, or "improve" any of these sections without explicit human approval.**

---

## 1. `activeStatusCheck()` in `src/content/apiHelper.ts`

**WHY IT'S PROTECTED:**
This function triggers a fresh API status poll by calling `__af_activeCheck` in the MAIN world.

- ❌ **DO NOT** use `<script>` tag injection (`document.createElement('script')`) — Google's Content Security Policy (CSP) on `labs.google` silently blocks inline scripts. The function will timeout and fail.
- ❌ **DO NOT** remove the cache confirmation wait (the `while` loop that checks `lastCacheUpdate`). Without it, there's a race condition: `chrome.runtime.sendMessage` returns success BEFORE the interceptor's `STATUS_UPDATE` postMessage updates the cache, so callers read stale data.
- ✅ **MUST** use `chrome.runtime.sendMessage({ type: 'RUN_ACTIVE_CHECK' })` → background service worker → `chrome.scripting.executeScript({ world: 'MAIN' })` — this is the ONLY approach that bypasses CSP.

---

## 2. DOM Tiebreaker in `verifyAndReprompt()` in `src/content/automation.ts`

**WHY IT'S PROTECTED:**
When the API cache says a prompt is "generating"/"queued" but the DOM shows the tile as cancelled/failed, the API is stale.

- ❌ **DO NOT** wrap the `allTilesSettled()` check or tile-specific checks inside `if (this.mode === 'flow')`. This gate caused Full mode to loop 12 rounds (3+ minutes) waiting for stale API data to change — while the DOM clearly showed cancelled tiles.
- ✅ The DOM tiebreaker **MUST** run for ALL modes (full, flow, lite).

---

## 3. CDN URL Verification for Cancelled Tiles in `verifyAndReprompt()` in `src/content/automation.ts`

**WHY IT'S PROTECTED:**
Google Flow often "fake cancels" videos — the UI says "cancelled" but the video file actually exists on Google's CDN. These must be rescued, not re-submitted.

- ❌ **DO NOT** remove `verifyMediaUrl()` calls from the "no retry button" path (cancelled tiles without a DOM retry button).
- ❌ **DO NOT** remove `verifyMediaUrl()` calls from the `noApiData` path (when Google's API completely drops cancelled entries from the batch status response).
- ✅ Both paths **MUST** poll the CDN URL before falling back to re-submission or reload recovery.

---

## 4. `mapStatus()` and `classifyError()` in `src/content/apiHelper.ts`

**WHY IT'S PROTECTED:**
These functions map Google's raw API status strings to AutoFlow's internal states.

- ❌ **DO NOT** remove `'CANCELLED'` or `'CANCELED'` from the `mapStatus()` failed-state check.
- ❌ **DO NOT** remove the `'cancelled'` return from `classifyError()`.
- ✅ Cancelled MUST map to `'failed'` in `mapStatus()` and to `'cancelled'` (not `'server'` or `'unknown'`) in `classifyError()`.

---

## 5. `verifyMediaUrl()` in `src/content/automation.ts`

**WHY IT'S PROTECTED:**
This function checks if a video file actually exists on Google's CDN by sending a HEAD request via the background service worker.

- ❌ **DO NOT** change the URL format: `https://labs.google/fx/api/trpc/media.getMediaUrlRedirect?name=${mediaId}`
- ❌ **DO NOT** change the `VERIFY_MEDIA_URL` handler in `src/background/service-worker.ts` — it uses `redirect: 'manual'` to detect valid CDN redirects without following them (avoids CORS).
- ❌ **DO NOT** change the content-type acceptance logic (must accept both `video/*` and `image/*`).

---

## 6. `__af_activeCheck()` in `src/background/service-worker.ts` (MAIN world interceptor)

**WHY IT'S PROTECTED:**
This function replays Google's own API call using captured credentials to get fresh generation statuses.

- ❌ **DO NOT** change the `replaceStringArrays()` body-patching logic — it dynamically replaces the media ID array in Google's API request payload, which has a nested/varying structure.
- ❌ **DO NOT** remove the fallback from `_lastStatusUrl` to `_lastGenerateUrl` — when no status poll has been captured yet, the generate URL is used as a template.
- ❌ **DO NOT** remove `CAPTURED_REQUEST_INFO` / `RESTORE_REQUEST_INFO` — these persist API credentials across service worker restarts.

---

## Summary of the Fix Chain

```
Google says "cancelled" (fake)
    │
    ├─ API has data? ──→ classifyError() returns 'cancelled'
    │                     └─→ CDN URL poll (2 min) → rescued ✅
    │
    ├─ API has NO data? ──→ CDN URL poll (2 min) → rescued ✅
    │
    └─ API says "generating" but DOM settled?
         └─→ DOM tiebreaker routes to retry
              └─→ No retry button? → CDN URL poll → rescued ✅
```

**Last verified:** 2026-06-19 — 16/16 prompts, 0 failures, all fake cancels rescued.
