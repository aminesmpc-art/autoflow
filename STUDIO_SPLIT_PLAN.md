# Studio as its own product — migration plan

**Status:** planning. No code written yet.

## What this is

A node canvas that orchestrates three generation backends on one account:

| Platform | Engine today | State |
|---|---|---|
| Veo / Google Flow | `extension/src/content/` | 9,577 lines, mature |
| ChatGPT | `extension/src/content/chatgpt.ts` | images + text (Ask AI) |
| Grok | `grok-auto/src/content/` | 1,689 lines, untouched since 2026-05-07 |

The pitch is "ComfyUI for AI video". That framing is what makes a separate
listing worth having — a second copy of Studio would not be.

It also consolidates: the new extension absorbs `grok-auto`, taking you from
three codebases to two.

## Decisions already made

- **Engine is copied, not shared** (option 1). Chosen knowingly; see *Drift* below.
- **AutoFlow keeps its Studio exactly as it is now.** Frozen — no new features
  there. All new work happens in the new extension.
- **One account, one backend.** `api.auto-flow.studio` stays the authority on
  identity, plans and limits.

## Still open

- **Name.** "AutoFlow Studio" carries existing trust; a distinct name positions
  it against TobyFlow head-on.
- **Pricing.** Own SKU, or unlocked by AutoFlow Pro. The backend supports either.

---

## 1. What moves, what gets copied

**Moves — this is the product:**

`extension/src/studio/` — canvas, nodes, store, runner, templates, CSS.
5,091 lines, and it imports from outside itself exactly three times:

```
consumeStudioRun, trackUsage              ← shared/api
AVAILABLE_MODELS, AVAILABLE_IMAGE_MODELS  ← types
```

Those three get inlined. Everything else Studio needs already travels over
`bridge.ts` messages, so the seam exists.

**Copied — the engines:**

- `content/index.ts`, `automation.ts`, `selectors.ts`, `studioImages.ts` (Flow)
- `content/chatgpt.ts` + `chatgptReply.ts` (ChatGPT)
- `grok-auto/src/content/*` (Grok)
- the `STUDIO_*` routing out of `background/service-worker.ts`

**Note:** `content/index.ts` is 9,577 lines and most of it serves the *queue*,
not Studio. There is a real chance to ship a far smaller engine — but that file
broke four separate times in one day. Copy it whole, get green, trim later with
tests in place. Not before.

## 2. Manifest — leaner than AutoFlow

AutoFlow asks for 10 permissions and 5 hosts. Studio needs roughly:

```
permissions      storage, activeTab, scripting, alarms, identity, unlimitedStorage
host_permissions labs.google/*, api.auto-flow.studio/*, chatgpt.com/*, grok.com/*
content_scripts  labs.google/flow* → sw-bypass.js, content.js
                 chatgpt.com/*     → chatgpt-content.js
                 grok.com/*        → grok-content.js
dropped          sidePanel, downloads, webRequest, notifications,
                 generativelanguage.googleapis.com, aisandbox-pa.googleapis.com
```

Fewer permissions means a smaller install prompt, a simpler privacy
disclosure, and a faster review. Worth protecting — resist adding any back
without a reason.

## 3. Accounts

Already solved architecturally: both extensions call the same API with a JWT,
and the server is authoritative on limits (made so on 2026-08-02 for Studio
runs and extractions). Quota is therefore shared with no double-counting.

One friction: `chrome.storage` is per-extension, so users would sign in twice.
Fix — Studio asks AutoFlow for the token on first launch via
`externally_connectable`; if AutoFlow is installed and signed in, Studio is
signed in instantly, falling back to normal sign-in otherwise.

That requires one manifest change **on the AutoFlow side**, so fold it into a
release that is going out anyway rather than spending a review on it alone.

## 4. Coexistence — mandatory, not optional

Both extensions will inject a content script into `labs.google/flow`. With both
installed there are two observers, two tile trackers, and if both run at once,
two scripts typing into one composer.

Needs an ownership claim on the page: the first engine to claim it drives,
the second stays passive **and says so in its UI** rather than failing silently
halfway through a run.

This is not deferrable — the chosen setup guarantees users will have both.

## 5. Drift

The known failure mode, already lived through:

| | grok-auto | extension |
|---|---|---|
| Last touched | 2026-05-07 | 2026-08-02 |
| Selector fixes from 2026-08-02 | 0 | 15 |
| `?d=` checkout bug | still present | fixed |

Three months, fifteen fixes, and a live bug that stranded paying customers.
Copying the engine again invites exactly this.

Mitigation, since the copy is the chosen approach: a check that hashes the
shared engine files in both repos and **fails the build when they diverge**
without an explicit acknowledgement. Roughly an hour of work. It is the
difference between this being maintainable in six months and not.

## 6. Milestones

Each one ends somewhere shippable.

0. **Grok audit.** Those selectors are three months old. Confirm grok.com still
   matches before planning around it. Cheap, and it changes the estimate.
1. **Skeleton.** New workspace, manifest, icons, build, empty Studio page loads.
2. **Flow engine copied**, one node runs end to end.
3. **Studio UI moved**, three imports inlined, templates working.
4. **Auth + limits** against the existing backend, token handoff from AutoFlow.
5. **Ownership guard** for the both-installed case.
6. **Drift check** wired into the build.
7. **ChatGPT adapter** (already built, port it).
8. **Grok adapter** — new `platform: 'grok'` on generate nodes.
9. **Store listing**, screenshots, privacy disclosure, submit.

## 7. Risks

- **The engine is the fragile part.** Four separate breakages in one day, all
  from DOM assumptions. Copying it doubles the surface. The drift check is the
  only thing standing between you and a second stale codebase.
- **Grok is unverified.** 1,689 lines that have not run against the live site
  in three months.
- **Review latency.** Studio moved 5.2 → 5.8 in a single day. A new listing does
  not escape review; it only decouples Studio's queue from AutoFlow's.
- **Two Studios in the wild.** AutoFlow's frozen copy will drift behind the new
  one by design. Users will ask why. Worth deciding the message early.
