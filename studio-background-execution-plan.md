# AutoFlow Studio — Background Execution Plan

Date: 2026-09-07

Scope: research and implementation plan only. No extension code or production configuration changed. Findings come from the local `studio-extension` source and official Chrome documentation; provider behavior has not been reproduced live in this investigation.

## 1. What we can actually deliver

The goal is to let the user start a workflow and use other tabs without babysitting Flow, ChatGPT, Claude, Gemini, Grok or Z.AI.

There are three different requirements:

| Requirement | Realistic approach |
|---|---|
| Do not manually open provider tabs | Studio already creates missing provider tabs with `active: false`; improve initialization and login handling. |
| Do not watch or repeatedly activate provider tabs | Improve adapters and scheduling so hidden, runnable tabs can progress. When a site/browser genuinely needs foreground interaction, pause clearly instead of failing or stealing focus. |
| No provider tabs at all, or work while Chrome/the computer is closed | Use supported provider APIs and a server job runner for supported node types. This is a different execution mode, not a tab setting. |

**Recommendation:** build a reliable Background Tabs mode first, backed by durable orchestration. Offer cloud/API execution separately where supported. Do not promise every consumer website can run invisibly forever.

## 2. Concrete findings in Studio

Line references below describe the current local checkout and may move during implementation.

| Finding | Evidence | Consequence |
|---|---|---|
| Automatic tab activation is intentional today | [service-worker.ts:169](<C:/Users/HP PROBOOK/Desktop/autoflow/studio-extension/src/background/service-worker.ts:169>), `startKeepalive()` and `tabPingRoutine()` | A repeating alarm calls `tabs.update(..., {active: true})`. The existing workaround brings tabs forward rather than supporting hidden operation. |
| Gemini explicitly refuses to inspect hidden video results | [Gemini index.ts:1261](<C:/Users/HP PROBOOK/Desktop/autoflow/studio-extension/src/content/gemini/index.ts:1261>) | `if (document.hidden) continue` skips collection while the 12-minute wall-clock deadline continues. |
| The supposed anti-throttle mechanism is itself a timer | [ChatGPT index.ts:126](<C:/Users/HP PROBOOK/Desktop/autoflow/studio-extension/src/content/chatgpt/index.ts:126>), [Flow index.ts:51](<C:/Users/HP PROBOOK/Desktop/autoflow/studio-extension/src/content/flow/index.ts:51>) | A 15-second `setInterval` sends PING messages. This is not a documented exemption from renderer throttling/freezing. Similar helpers exist in other adapters. |
| Claude can time out before considering a fresh reply | [Claude index.ts:535](<C:/Users/HP PROBOOK/Desktop/autoflow/studio-extension/src/content/claude/index.ts:535>) | `trackReply()` checks its 45-second quiet limit before updating `lastChangeAt` from newly read text. A delayed poll can find a completed answer and still break first. This is a code-path finding, not a live reproduction. |
| Workflow execution belongs to the canvas window | [Canvas.tsx:305](<C:/Users/HP PROBOOK/Desktop/autoflow/studio-extension/src/studio/components/Canvas.tsx:305>), [WorkflowRunner.ts:2948](<C:/Users/HP PROBOOK/Desktop/autoflow/studio-extension/src/studio/engine/WorkflowRunner.ts:2948>) | Closing the Studio window destroys its runner. Reconnecting a UI port is not the same as restoring the execution state machine. |
| The runner has another independent timeout | [WorkflowRunner.ts:1366](<C:/Users/HP PROBOOK/Desktop/autoflow/studio-extension/src/studio/engine/WorkflowRunner.ts:1366>) | A node can time out while its provider is still generating or its result cannot be observed. Raising only adapter timeouts does not solve this. |
| Recovery is partial and tied to one working tab | [service-worker.ts:95](<C:/Users/HP PROBOOK/Desktop/autoflow/studio-extension/src/background/service-worker.ts:95>) and keepalive globals | Only 20 terminal replies are parked in session storage. `keptTabId`/`keptPlatform` are memory-only and describe one tab, not durable per-run leases. |
| Alarm assumptions and supported versions do not align | [manifest.json:6](<C:/Users/HP PROBOOK/Desktop/autoflow/studio-extension/manifest.json:6>), [service-worker.ts:172](<C:/Users/HP PROBOOK/Desktop/autoflow/studio-extension/src/background/service-worker.ts:172>) | Minimum Chrome is 114; the keepalive requests 0.4 minutes. The documented 30-second minimum arrived in Chrome 120, and even that is not an exact scheduling guarantee. |

Other focus calls are not automatically bugs: `PANEL_OPEN_CHAT` is an explicit open-chat action. `STUDIO_NEEDS_CLICK` is an assistance path. Preserve their intent while removing unsolicited focus changes from ordinary execution.

## 3. Browser constraints the design must respect

- Hidden-page chained timers can be heavily throttled under Chrome's documented conditions, including checks only once per minute. Prefer event-driven observation over fast polling. This does not mean every hidden tab is always throttled identically. [Timer throttling](https://developer.chrome.com/blog/timer-throttling-in-chrome-88)
- Hidden, frozen and discarded are different states. A frozen tab cannot run its handlers/timers; a discarded page is unloaded. `autoDiscardable: false` addresses automatic discarding, not every lifecycle condition. Feature-detect `Tab.frozen`, documented from Chrome 132. [Tabs API](https://developer.chrome.com/docs/extensions/reference/api/tabs), [Page lifecycle](https://developer.chrome.com/docs/web-platform/page-lifecycle-api)
- An MV3 worker can terminate when idle, losing globals. Persist work and rebuild it on wake. An open port alone is insufficient; debugger lifetime behavior concerns the extension worker and does not establish universal provider-page progress. [Worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)
- Alarms may be delayed and do not wake a sleeping computer. Reconcile important alarms from saved work whenever the worker starts; do not depend on newer alarm fields without compatibility checks. [Alarms API](https://developer.chrome.com/docs/extensions/reference/api/alarms)
- Offscreen documents must be bundled extension HTML and support only the runtime extension API. They can help with legitimate DOM/media work, but are not a way to turn a remote provider URL into an invisible top-level browser tab. Do not assume embedding authenticated sites works. [Offscreen API](https://developer.chrome.com/docs/extensions/reference/api/offscreen)

These constraints explain why another keepalive timer cannot be the permanent fix.

## 4. Proposed execution design

```text
Studio canvas / side panel — controls and saved status only
                         |
                         v
Durable run coordinator — extension worker, event-driven steps
                         |
             Persistent run + node-attempt journal
                         |
              +----------+-----------+
              |                      |
       Provider tab adapters   Optional API/server jobs
       (tabs remain open)     (no consumer tabs required)
              |
       Scoped DOM/media helper when genuinely needed
```

The coordinator must survive suspension; it must not rely on keeping one Promise alive for an entire workflow. The UI subscribes to snapshots and can close/reopen. Store large media in the existing media storage, not in message payloads or the execution journal.

### Eight implementation tasks, in order

- [ ] **1 — Establish an honest baseline.** Instrument adapter version, run/node/attempt IDs, tab/document ID, visibility, frozen/discarded state when available, last observation, last actual content change, timer delay and submission receipt. Reproduce foreground versus hidden for more than five minutes, including fully occluded and minimized windows. Do not log prompts, cookies or raw provider responses by default. **Verify:** logs distinguish provider delay, observation delay, lifecycle suspension and missing content scripts.

- [ ] **2 — Fix adapter-level hidden-tab defects.** Remove Gemini's blanket hidden-result skip. In Claude, process fresh text and terminal evidence before testing the quiet deadline. Add scoped MutationObservers, media load events and available status events; retain a bounded reconciliation poll. Replace stable-poll counts with time-based evidence, but never interpret a long unobserved interval as proof of stability. Explicitly wait for login, CAPTCHA, upload gestures or provider intervention. **Verify:** a completed reply discovered on the first delayed poll is collected, never silently dropped.

- [ ] **3 — Introduce a shared adapter contract.** Add proposed `start`, `inspect`, `recover`, `cancel` operations. Every response carries `runId`, `nodeId`, `attemptId`, provider tab/document identity and a receipt when available. Flow should reuse its existing `API_STATUS_CHANGED` and media-ID correlation, not fall back to the first visible tile or a displayed 100%. Treat intercepted site responses as versioned, fragile UI integration—not a supported public API. **Verify:** stale, duplicated and wrong-attempt messages cannot finish a node.

- [ ] **4 — Move orchestration out of the canvas.** Extract dependency traversal, Director/Chief state and node transitions from `WorkflowRunner`'s live store access into a coordinator using persisted snapshots. Suggested new files: `background/runCoordinator.ts`, `shared/runJournal.ts`, `shared/executionProtocol.ts`. Save before dispatch, after submission and after collecting a result. Route local clipping/media work through a tested helper or backend, not a blind import into the worker. **Verify:** closing the canvas does not cancel the run; reopening reconstructs current state and finished outputs.

- [ ] **5 — Make retries safe.** Persist states such as `queued`, `dispatching`, `submitted`, `observing`, `collecting`, `completed`, `waiting_user`, `observation_lost`, `cancel_requested`, `cancelled`, `failed`. On worker wake, reattach to existing conversations/jobs and inspect before submitting again. A crash between a click and its receipt creates uncertain submission: reconcile or request help. Never promise exactly-once clicks where the provider has no idempotency mechanism. Persist cancellation tombstones so late events cannot restart a stopped run. **Verify:** worker restarts and dropped acknowledgements do not create duplicate paid generations.

- [ ] **6 — Replace tab stealing with managed tab leases.** Introduce a per-run/per-provider tab registry and serialize work sharing one composer. Capture each tab's original `autoDiscardable` value and restore it when its final lease ends. Create missing tabs inactive and require a readiness handshake. Replace the 30-second activation loop with lifecycle reconciliation, behind a rollout flag until tasks 2–5 pass. If a tab cannot proceed hidden, show `Needs attention` with an explicit Open tab action. An optional, user-approved dedicated automation window can be tested as a fallback; do not claim that minimizing/covering it preserves visibility. **Verify:** normal background execution never changes the user's active tab/window.

- [ ] **7 — Add clear execution-mode controls.** Offer Background Tabs and Assisted modes first. Preflight every provider and node type rather than advertising a blanket guarantee. Show real task state instead of invented completion percentages. Keep current explicit Open chat behavior; make unsolicited `STUDIO_NEEDS_CLICK` focusing a user preference/confirmation. Investigate supported API mappings as a separately authorized later phase, with explicit costs and feature differences. Consumer subscriptions, generated media and conversation history must not be assumed interchangeable with APIs. **Verify:** users know when tabs must stay open and when a real click is needed.

- [ ] **8 — Validate, package and roll out.** Choose a supported Chrome baseline deliberately: at least 120 if relying on 30-second alarms, with newer lifecycle fields feature-detected; alternatively retain a tested older-version path. Test a packaged build without DevTools, not just an unpacked development session. Roll out provider by provider, starting with text completion, then image/video and multi-Director chains. **Verify:** the acceptance matrix below passes before enabling Background Tabs by default.

## 5. Acceptance matrix

| Scenario | Required outcome |
|---|---|
| Provider tab hidden for 10+ minutes, still runnable | Result is collected and next node starts without focus stealing. |
| Provider tab frozen/discarded | Report observation loss, preserve receipts and recover/reconcile; no automatic duplicate submission. |
| Chrome minimized or completely covered | Either verified hidden operation or clear waiting state; never equate missing observations with provider failure. |
| Studio canvas and side panel closed | Durable coordinator still owns work; reopening shows accurate status. |
| Extension worker terminated mid-node | Recover saved attempt; reconcile before doing anything billable. |
| Browser restart, sleep/wake, extension reload | Restore journal and reconcile existing work; do not assume prior tab/document IDs or in-memory callbacks survive. |
| Provider tab closed or navigated elsewhere | Stop using it, preserve run, request recovery when association is uncertain. |
| Login expiry, CAPTCHA or required user gesture | Wait for the user without bypassing the challenge. |
| Same node ID reused in a later run | Earlier replies cannot affect the new attempt. |
| 20+ node Director/Chief workflow | No arbitrary terminal-reply loss; completed work persists by attempt. |
| Stop while suspended, then late result arrives | No next-node dispatch; retained result is associated with the cancelled attempt. |
| Network outage / model still thinking / missing DOM result | Different diagnostics and retry rules for each condition. |

Exercise each supported provider separately. Also regression-test existing Flow tile/media matching, reply parsing, ingredients, Builder refinements, pause/resume and Chief continuity. Use mocked state transitions first; live billable runs require explicit approval and a small budget.

## 6. What not to ship as the fix

- More 15-second self-pings or a larger timeout presented as a guarantee.
- Fake audio, fake WebRTC traffic, visibility spoofing or browser security/energy flags.
- A permanent debugger attachment used solely to keep things alive. Keep existing debugger operations scoped to their disclosed purpose. [Debugger API](https://developer.chrome.com/docs/extensions/reference/api/debugger)
- Moving the entire runner into an offscreen document and assuming suspension disappears.
- Automatically retrying submission because an ACK or result was missed.
- Uploading browser cookies or provider sessions to Railway for remote automation.
- Claiming tab automation can continue while the browser is shut down or the device is powered off.

## 7. Completion definition

The durable fix is **background-capable adapters + recoverable orchestration + explicit assistance when needed**. It is not unlimited control over third-party page lifecycles.

Near-term release: runnable hidden provider tabs work without babysitting, and interruption never silently loses state or duplicates a generation. Separate future release: server/API execution for supported nodes when the user requires genuinely tabless operation. That API feasibility, pricing and feature mapping needs its own provider-specific investigation before implementation.

Research completed; all implementation tasks above remain unstarted.

## 8. Flow-specific follow-up — 2026-09-08

User observation: the Flow page appears to make no progress until its tab is viewed. Another extension reportedly works without the debugger API. Debugger access is not a requirement of this plan.

### Additional source evidence

- `waitForTabReady()` in `background/service-worker.ts` checks page load and a PING response. Flow's PING handler returns PONG and `runLocked`, not composer, upload or submission readiness. Adapter presence must not be treated as proof that the provider UI is ready.
- The header of `content/flow/apiHelper.ts` says passive-only, but the actual module also implements `activeStatusCheck()`. The header is outdated; do not design a duplicate fallback based on that comment.
- In the Studio result watcher in `content/flow/index.ts`, the active refresh is inside `if (isApiAvailable())`. That function requires a previous `lastCacheUpdate > 0`. This leaves a cold-start case where no status was received and this watcher does not even attempt a refresh. Other engine paths also call active checks and must be traced before claiming every run suffers this problem.
- `content/flow/sw-bypass.ts` defines `__af_activeCheck()` by replaying `lastStatusRequest`. It returns false if none was captured. Its current signature takes no media IDs even though the bridge passes them: the replay is not inherently scoped to the caller's desired generation. Verify response IDs before using it.
- `activeStatusCheck()` waits for the content-script cache using another timer loop, then returns true after three seconds even if that cache has not advanced. Request success and delivery of a fresh matching observation need separate outcomes.
- The entire refresh path is still initiated by a content-script sleep loop and executes through the page's MAIN world. Moving the scheduling to the extension worker can remove one dependency, but cannot make a frozen renderer execute.

These are confirmed implementation properties, not proof that Flow's remote generation itself pauses. Opening the tab could enable first submission, restart site polling, refresh a virtualized DOM, or let Studio collect a result that already exists.

### Flow work to include in tasks 1–3

1. Add a diagnostic timeline: adapter connected → composer ready → settings verified → ingredients ready → submit attempted → new generation receipt → provider status observed → matching result collected. Record timestamps and IDs, not sensitive request headers/bodies. A screenshot of apparent inactivity cannot distinguish these stages.
2. Replace generic PING readiness with a provider-specific, read-only capability/status probe. Keep actual submission confirmation separate: a clicked button is not a receipt.
3. Distinguish interceptor installed, request template captured, status data available and status data fresh. Do not require an already-populated cache merely to attempt observation recovery; if no usable template exists, report that explicitly rather than claiming the provider is generating.
4. Have the durable coordinator request bounded status inspections for outstanding attempts, with backoff. Return fresh, generation-correlated observations directly where practical. A stale/absent response must not be reported as successful recovery.
5. Preserve existing media-ID and output-type validation. Do not replace a missing current result with an older matching tile, or add a second independent status poller that competes with existing checks.
6. Test a never-selected cold Flow tab separately from a previously viewed tab that is later hidden. Test text-only submission, image ingredients, video completion and minimized Chrome as separate cases. Keep DevTools closed during background acceptance tests.

**Decision gate:** if submission cannot happen while hidden because Flow itself requires activation, Background Tabs mode must report a bounded assistance requirement. If submission succeeds but observation stalls, repair observation and recovery without resubmitting. Do not introduce debugger access or claim that a visibility-spoofing trick solves both.
