# Studio background working — implementation plan

Updated: 2026-09-13. Planning only; no runtime changes made in this task.

## Target

Start a workflow, switch to other work, and collect results without repeatedly watching provider tabs. Provider tabs remain open and signed in. No permanent debugger attachment for keepalive. Existing opt-in debugger-based file uploads are a separate capability, not removed by this plan.

## What still needs fixing

Rechecked in the current checkout:

- `background/service-worker.ts`: `tabPingRoutine()` activates the provider tab; the keepalive alarm requests 0.4 minutes.
- `content/gemini/index.ts`: video-result collection skips `document.hidden`.
- `content/claude/index.ts`: the quiet deadline is checked before fresh text updates the change timestamp.
- `content/flow/index.ts`: status refresh still depends on `isApiAvailable()`. A cold, never-viewed tab needs its own readiness and submission test.
- `studio/components/Canvas.tsx`: starts the in-page runner. Closing Studio is not equivalent to switching away from provider tabs.

These are code findings. They do not prove whether a particular hidden Flow run failed to submit, stopped observing, or merely stopped displaying its result.

## Ordered delivery

1. [ ] **Measure before changing focus behavior.** Log attempt ID, tab lifecycle, composer readiness, submit receipt, matching status and collection timestamps. Exclude credentials and raw content. Verify a never-viewed Flow tab separately from one hidden after submission.
2. [ ] **Repair hidden-result collection.** Fix Gemini's visibility skip and Claude's deadline ordering. Use DOM/status events plus bounded reconciliation. Verify a fresh completed answer discovered after a delayed poll is accepted, not timed out first.
3. [ ] **Harden Flow observation.** Separate interceptor presence, captured request template, fresh status and matching generation ID. Recover observation without submitting again. Verify an old tile or stale 100% cannot complete a new attempt.
4. [ ] **Release Background Tabs beta.** Serialize work per provider composer; create tabs inactive; remove routine focus stealing only after adapter tests pass. Restore any temporary tab settings after the run. Show “Needs attention” with an explicit Open tab button when hidden execution cannot proceed. Studio must remain open in this first release.
5. [ ] **Make orchestration durable.** Move scheduling into an event-driven worker coordinator with a persisted attempt journal. Store media separately; route browser-only encoding through a tested helper. Recover submitted jobs before retrying; persist cancellation. Verify worker restart and closing/reopening Studio preserve progress without duplicate generations.
6. [ ] **Verify and roll out per provider.** Test packaged builds with DevTools closed: hidden for 10+ minutes, minimized, frozen/discarded, sleep/wake, network loss, login expiry, worker restart, and Stop followed by a late result. Test text first, then images/videos, Motion uploads, and multi-Director workflows. Live paid tests require an agreed budget.

## Acceptance rule

No focus stealing, lost completed results, or blind resubmission. Lifecycle interruptions must produce recoverable waiting states, not false generation failures. Do not advertise a provider as background-capable until its live tests pass.

## Limits

Chrome can suspend pages and terminate extension workers; persistence and recovery are required. Offscreen documents are helpers, not invisible replacements for provider tabs. See [page lifecycle](https://developer.chrome.com/docs/web-platform/page-lifecycle-api), [worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle), and [offscreen restrictions](https://developer.chrome.com/docs/extensions/reference/api/offscreen).

Running with Chrome closed requires a separate supported-API/server mode. Railway can host that coordinator, but cannot make local Flow tabs run while the computer is off. Provider API availability, costs, and feature parity need separate review; never transfer browser sessions to the server.

Background reference: [earlier investigation](studio-background-execution-plan.md). Its dated line references are historical, not implementation completion evidence.
