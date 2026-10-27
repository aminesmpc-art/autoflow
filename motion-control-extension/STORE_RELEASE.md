# AutoFlow Motion — store release candidate

## Local candidate 0.1.28 — October 23, 2026

The supplied live composer markup contains one `flow-image-ingredient-chip` and one `flow-video-ingredient-chip`. The video uses an `img.chip-image` thumbnail at `storage.googleapis.com/ai-sandbox-videofx/image/…`, not a video element or a previously recognized image host. The pre-submit counter ignored it and incorrectly stopped with "1 of 2 ingredients". Typed composer chips now identify their thumbnail by markup; the global media URL matcher is unchanged. Loaded-image, busy and placeholder checks remain, and historical batch/library thumbnails are excluded.

Regression reproduced before the fix; all six exact-markup/readiness tests pass after the fix. Verified: Motion 37 suites / 405 tests, five related Studio suites / 48 tests, type check and production build (existing bundle-size warnings). `release/autoflow-motion-0.1.28-candidate.zip`: 33 files, entries checked against dist; SHA256 92447A2B348C7B3207E012A9B056148089F0F18BE6EC9FAEA35DE4EADB1B4839. No live generation submitted during verification; live provider confirmation and existing publication gates remain.

## Local candidate 0.1.27 — October 20, 2026

Reported live: a piece read "Generating in Flow…" for 14 minutes while its prompt and both ingredients sat unsent in Flow's composer. The Generate press check accepted "any tile in the project is generating" as proof the press landed, so in a busy project, or with a tile wrongly read as busy, a press that did nothing was confirmed and the piece waited for a clip nothing had asked for. A press now counts only if it changed something itself: the prompt left the composer, a tile was added, or one more tile is generating than before the first press (`pressLanded`, flow/pressCheck.ts). A missed press falls through to the next press method and then to the existing retry and clear failure, instead of a silent wait. The confirmation window went from 2s to 4s, so a slow but real press is not pressed twice. The log says which signal confirmed each press.

Verified: Studio 271 suites / 4748 tests (pressLanded 5 new), type check and build; Motion 395 tests, type check, build, UI smoke and the offline extension smoke. `release/autoflow-motion-0.1.27-candidate.zip`: 33 files, SHA256 C7496D5BDEF7601D7606E3D04BD932D66678485860E2A406D450B582F2B2BFA5. Not yet run against live Flow. The Queue extension's copy of this check has the same weakness; it has not been changed.

## Local candidate 0.1.26 — October 19, 2026

Reported live: starting over did not open a new Gemini chat, and the director stopped with "replied with no JSON object" while the JSON answer was on the Gemini tab.
- New chat: the Gemini adapter (build `new-chat-url-v9`) reused a chat whenever it counted 0 rendered turns. A conversation whose turns are not rendered (hidden tab, still loading, a deleted thread, a redesign) counted 0, so the new run's brief went into the old thread. A chat now counts as empty only when the address is not `/app/<id>` (or `/u/N/app/<id>`), and after New chat the adapter waits until the address has left the old thread.
- No JSON: the cause is not yet confirmed. The error now quotes the first 140 characters of what was read, and the Gemini tab logs whether the reply came from the network or the page, how many reply containers there were before and after, and how the reply begins. The next failure will show which text was taken.

Verified: Studio geminiNewChat 8/8 (2 new: a conversation address with nothing rendered, and an account-prefixed address), motionDirectorRead 4/4, related Gemini/Motion suites 150/150, Studio type check and build; Motion 395 tests, type check, build, UI smoke and the offline extension smoke. `release/autoflow-motion-0.1.26-candidate.zip`: 33 files, SHA256 783D213E2447F2341CBFADD00EA5350476E66FCEC54784FAD4B07EA4FE3CE849. Not yet run against live Gemini.

## Local candidate 0.1.25 — October 19, 2026

Adds **Keep exact lip sync**, a switch beside Remove source audio, off by default. The user asked for words only: no audio replacement and no joined video. When on:
- Omni gets a LIP SYNC block after the motion block on every piece, in every mode: every mouth shape on the same frame as the input video, in time with each syllable, closed in silence, with the same words at the same moments, and nothing added, dropped, delayed, softened or exaggerated.
- The director is told not to write about mouths, speaking, the words or the voice.
- With Remove source audio also on, Omni is told to copy the mouths visually, and the silent-audio override forbids only the sound, no longer the lip movement. The panel explains that the original sound can go back on in an editor.
- The job configuration gains `lipsync-v1` only when the switch is on, so existing projects and paid jobs are unchanged.

Verified: 36 suites / 395 tests (Studio's motionLipSync suite adds 5 more), type check, production build, UI smoke (off by default; note shown and hidden), and the offline real-extension smoke 5/5. The extension smoke now warms the headless video encoder before recording its test clip; it had failed 2 of 5 runs on an empty recording. `release/autoflow-motion-0.1.25-candidate.zip`: 33 files, SHA256 46EA2A54E0243613CC49CC40BCD8C6D789CAB7065E18FD90D97D4029247D2795. Whether Omni follows the lip-sync wording has not been checked in a live generation.

## Local candidate 0.1.24 — October 19, 2026

Packages everything below that was listed as unreleased: replace chosen people and items, the full panel redesign, words instead of images for a replacement, saves that no longer stall the panel, the Replace people & items card, Agent mode switched off before a run, and a panel that is never an empty box.

Verified for this candidate: 35 suites / 393 tests, type check, production build (not the test build), UI smoke, and the offline real-extension smoke. `release/autoflow-motion-0.1.24-candidate.zip`: 33 files, entries and hashes checked against dist, SHA256 F60D35F6428AB7A6EF33021BFAF8EC1A2754297829A0E5D5DA280F1C7D070574. Replace people & items has still not been run against live Gemini/Flow. Existing bundle-size warnings and production publication gates remain.

### Replace chosen people and items (October 18, 2026)

Replace subject mode can now replace several things in one video. "Find people & items" runs one analysis turn on the first 30 seconds (or the trim). This is not a Motion job and is never admitted or counted. The analysis lists up to eight people and objects, with labels and when each appears. The user picks up to four and gives each one an image. Up to four fit; three when both a place image and continuity are on, since Omni takes five images. Omni gets a fixed "Image N replaces <label>" block and is told to keep everything else from the input video. The director names each one only as "the person/object from image N" and leaves out targets that are not in a piece. The single Subject image is unused while replacements are chosen. The list is saved with the project and marked stale when the video or trim changes. Replacements count toward the job fingerprint in Replace mode only.

Verified: 34 suites / 384 tests, type check, production build. The built panel was rendered at 320/420px in light/dark with a seeded list: no overflow, no page errors. Not yet tested against live Gemini/Flow. Not packaged.

Also in 0.1.24:
- Full panel redesign, a calm pro-tool look:
  - **Setup order:** Video → What changes → References (only what the chosen mode needs; Replace people & items shows its list there) → Direction & output.
  - **Header and progress:** one header row with the project name under the title, a 4-step stepper whose steps tick when done, and numbered step cards that turn into checks.
  - **What changes:** the modes are a list, with each card's description shown.
  - **Switches:** Keep clips consistent and Remove source audio are grouped in one box.
  - **Before you generate:** shows only what is still missing, collapses finished items into one line, and puts the Flow and analysis links on two link chips.
  - **Results:** stats and filters merged into filter pills, with Download all beside them; finished clips hide their step dots; card actions sit below a hairline.
  - **Running view:** a highlighted card with a timer.
  - **Visual system:** new neutral tokens in light and dark, and lighter dialogs.
  - **Backup:** `backups/panel-before-ui-upgrade-2026-10-18.tgz` holds the previous source.
  - **Verified:** 393 tests, type check, build, UI smoke at 320/375/420/768/1440 in light and dark, the real-extension smoke, and a running-view render at 320/400px.
- A replacement can be words instead of an image, or an image with words. Each row has **Image…** and **Describe…**; Describe opens a box in the row (Enter saves, Esc cancels, 300 characters). Only images take Omni slots, so a words-only row is not held to the image limit. Omni gets "Image N replaces <label>: <words>." or "Replace <label> with <words>."; images are numbered with words-only rows skipped. The director is told to use the user's exact words, the same in every piece, and to add nothing else about a replacement that has an image. A row with neither is not a change. Verified: Studio motionTargets (15) and motionControl, Motion 393 tests, UI smoke, and renders at 320/420px in light/dark with an open describe box.
- Saves no longer stall the panel. Before, every save read all of chrome.storage back (`get(null)`) just to list projects, and rewrote every finished clip and photo as an inline data: URL: 28 MB per save in a 6-piece test, every 5 s during a run. Now projects are listed from a small index (`studio_index_workflows`, healed with `getKeys`), and any data: URL of 256 KB or more is kept in the extension's IndexedDB vault with a `vault:` reference. Media comes back on load as the identical string, so retry fingerprints still match. The vault already caps itself at 3 GB or half the quota, dropping sources before clips; evicted media loads empty. Saves run one at a time. Measured with typing: per-save writes 28 MB → under 1 MB, full-storage reads 1 → 0, freezes over 50 ms 2 → 0. The one full read left is a one-time index build on first open. Verified: Studio store tests (13), vault and store-dependent suites, Motion 391 tests, UI smoke, and the real-extension smoke with a ~2 MB photo round-tripped byte for byte.
- The list has its own card. "Replace people & items" is the fourth choice in What changes (the cards are now 2×2). It shows the list right under the cards and hides the Subject tile. Underneath it is still Replace subject (`motionMode: 'swap'` plus `motionReplaceMany`). Replace subject goes back to needing its one subject image, and ignores a saved list. Projects saved with a list before the card existed open on the new card. Verified: 35 suites / 391 tests, UI smoke, build, and renders at 320/420px in light/dark.
- Flow's Agent mode is switched off again before a run. With Agent on, Flow hides the settings chip, so the run could not choose Omni and stopped before pressing Generate. The off-switch looked for a `.content` span the live chip no longer has; it now matches `agent-mode-chip` (live markup, 2026-10-18), and the page watcher acts only during a run.
- The panel is never an empty box. It shows "Opening Motion…" at once, says which step is slow after 6 seconds, and shows a render error with a Reload panel button instead of unmounting. Verified: 35 suites / 387 tests, build, and the built panel opened normally, with a 9-second project read, and with a malformed saved list.

## Local candidate 0.1.23 — October 18, 2026

Refreshes Motion's panel surfaces, typography, spacing, references and result cards. Portrait/landscape now use native labeled radio cards with visual icons, keyboard navigation and visible focus. Native checkboxes are styled as switches; Create/Your results navigation stays available while scrolling. Existing account, upload, generation and tab-following behavior is retained.

Verified: 375 tests, TypeScript, production build, offline extension save/reload, and UI checks at 320/375/420/768/1440px with light/dark and keyboard navigation. Final light/dark viewport screenshots reviewed. Existing bundle-size warnings and production publication gates remain.

## Local candidate 0.1.22 — October 18, 2026

Adds project-level Output format selection for 9:16 portrait and 16:9 landscape. The existing Motion runner forwards the selected aspect ratio to Flow, whose adapter maps it to orientation. Landscape participates in job configuration/fingerprinting and invalidates retries for the previous format. Legacy portrait configuration identity remains unchanged. Source trimming keeps the original full frame.

Verified: 33 suites / 375 tests, TypeScript, production build, and offline browser project save/reload with 16:9 selected. Runner tests cover every piece in both formats. ZIP entries and hashes verified against 33 built files. Existing production publication gates remain.

## Local candidate 0.1.21 — October 18, 2026

Corrected Show the working tab: previous builds mapped it to the background beta, disabling the original routine focus behavior. It now disables background flags, raises the provider at every Motion step (including repeated steps on the same provider), and focuses its window during the existing 30-second keepalive. An upgrade migration restores the mode once. Explicit background mode remains available; stopping/disconnecting stops the focus behavior.

Verified: 33 suites / 372 tests, TypeScript, production build and offline built-extension checks of repeated Gemini steps followed by Flow. Worker alarm tests verify the active target is restored without another generation, and focus ends on stop/disconnect. Existing build warnings and production publication gates remain.

## Local candidate 0.1.20 — October 18, 2026

Automatic uploads now initialize to enabled when no preference exists; explicit disabled choices are retained. The existing Show the working tab default remains. Browser file access appears in the readiness checklist before Generate, with a user-clicked settings link and permission refresh on focus/tab changes. Browser-managed file access is never enabled in code.

Verified: 33 suites / 370 tests, type check, production build and offline extension test. The browser test checks fresh defaults, file-access readiness, and disabled-upload preference after reload. ZIP 0.1.20 validated against 33 built files. Existing production publication gates remain.

## Local candidate 0.1.19 — October 18, 2026

Restores Show the working tab once on upgrade, following the existing provider handoffs; later user selections remain saved. Worker flags are awaited before execution. Local file access is checked before job admission so a missing browser setting does not consume a Motion job or clear prepared pieces. Upload permission errors (including saved legacy DOM.setFileInputFiles errors) offer an Open extension settings button. The file-access toggle remains controlled by the user.

Verified: 32 suites / 364 tests, type check, production build, and offline browser provider handoffs Gemini → Flow with background-mode protection retained. Existing bundle-size warnings and production publication gates remain. The user's file-access setting still needs enabling in their browser.

## Local candidate 0.1.18 — October 17, 2026

Added a read-only file-scheme permission preflight before Flow upload side effects and before the lower-level chooser path. A denial explains the per-extension Allow access to file URLs setting with Edge/Chrome-specific instructions; the user must enable it themselves. No new manifest permission and no automatic permission change. Late DOM.setFileInputFiles "Not allowed" errors also give actionable guidance. Original Gemini background behavior remains unchanged.

## Local candidate 0.1.17 — October 16, 2026

Reverted the 0.1.16 upload foreground fallback at the user's request. Removed its worker listener, focus lease, content wrapper and dedicated tests; retained previous network reply collection and worker waits. Uploads no longer activate Gemini or restore another tab. This restores behavior, not a fix for Gemini's hidden upload stall.

Verified October 17: 31 suites / 354 tests pass, type check and production build pass (existing bundle-size warnings). Built bundles contain no upload-focus messages. Offline browser fixture passes hidden upload and DOM/XHR/fetch reply collection. Live Gemini's original hidden-upload stall remains unresolved.

Also in this build (October 16, evening): **finished clips that stayed "Generating".** The user's report: piece 1 of 6 still "Generating" after 14:47, with the finished Omni clip on screen. Measured live: Flow now loads its data over `fetch`. Its project media list (rpc `Zzl0ze`) carries only the `/asb/` poster for every clip, finished ones included. The signed `/video/` URL arrives only in the per-clip reply (`as29s`), which Flow fetches on hover, and a finished tile has no `<video>` until it is hovered. flowBatch reads poster-only records as `THUMBNAIL_ONLY`/generating. That made the watcher's `serviceStillWorking` true, which disabled the nudge that hovers the tile, so nothing ever mounted the player. A `THUMBNAIL_ONLY` record no longer counts as still working (`studio-extension/src/content/flow/index.ts`, `src/tests/thumbnailOnlyNotWorking.test.ts`). A tile that is really rendering still reads as generating from its %/blur. Motion: 31 suites / 354 tests pass. Not yet confirmed on a live run.

## Local candidate 0.1.16 — October 16, 2026

Motion now temporarily selects and focuses Gemini only during attachment processing, then restores the previous tab/window. Manual tab/window changes cancel restoration. The session-backed lease has a two-minute cleanup alarm; upload failures release in `finally`. No extra upload or generation attempts and no new permissions. Live signed-in Gemini verification is still required; existing store gates remain open.

Verified: 33 suites / 365 tests, type check and production build. The offline browser fixture gates upload completion on visibility, verifies automatic restoration, then verifies background DOM/XHR/fetch results with one submission per turn. Existing bundle-size warnings remain.

## Local candidate 0.1.15 — October 15, 2026

Added passive Gemini generation-response collection for Motion's text/video-analysis prompts. MAIN-world fetch/XHR observation is correlated with the armed prompt; only an explicitly completed candidate after successful HTTP completion can become a result. A matching request confirms submission even when Gemini leaves its composer unchanged, avoiding another send attempt. Existing DOM collection remains the fallback. No new permissions, request replay or persistent debugger attachment. Unknown private-protocol layouts fail back to page collection.

The built offline hidden-tab fixture passed with no answer DOM, no composer clear, content-script timers clamped to 60 seconds and one submit per turn. This verifies the extension mechanism, not current signed-in Gemini compatibility or uploads/submissions that the provider itself pauses while hidden. Store gates below remain unchanged.

## Local candidate 0.1.14 — October 14, 2026

Also in this build (October 14): **Omni 1.1 Flash is required.** The user asked why Motion "doesn't switch to Omni 1.1". On live Flow the model button, its menu (now Angular Material, `aria-controls`, rows prefixed by a `volume_up` icon) and the adapter's clicks all work, Veo ↔ Omni included. What was missing was any answer when an account's Flow does not offer the model: the adapter used whatever Flow had selected. Motion generations now send `modelRequired: true`. If setModel cannot select the model, the queue stops before submitting, with "Omni 1.1 Flash is not available in this Flow account: Flow offers … Nothing was generated." The runner then stops the remaining pieces (`studio-extension/src/tests/motionModelRequired.test.ts`). Motion: 29 suites / 274 tests pass.

Gemini's hidden-tab preparation, attachment delivery, upload settling, send verification, result collection and conversation cleanup use short worker-backed waits. Completion observation includes streamed text and busy/footer changes. Diagnostic stages identify where Gemini stops. Existing run-scoped tab protection and original-setting restoration remain in place. No new permissions or persistent debugger session.

Production `dist` rebuilt; type checks, Gemini regressions, shared adapter tests and offline built-extension checks pass. The Gemini fixture keeps the actual tab hidden and clamps extension page timers to 60 seconds, then verifies a single settled upload, single submission and full answer capture. This is not a live Gemini/Flow generation certification or store submission. Keep Chrome and the panel open; refresh Gemini after reloading the extension. Browser freezing or provider-side visibility behavior can still require attention. Existing publication gates below remain open.

**Updated October 2, 2026:** Every AutoFlow account can use Motion: **Free accounts get 3 jobs a day, AutoFlow Pro is unlimited.** The separate $5 plan is superseded. The Motion allowance endpoints are deployed (Pro-only rules first, enabled October 2); the Free/Pro rules ship with the next backend deploy. **Do not submit yet:** see the gates below. Use candidate 0.1.4 or newer — 0.1.3 still says Motion requires Pro.

## Publication gates

- [ ] **Social imports (October 11):** Before shipping this build, update the public privacy policy's Motion section to match `privacy.html`'s browser-only TikTok/Instagram/YouTube import flow. Justify social-page access for the page button/selected-video reading and optional CDN access for a user-requested media download. Test owned downloadable media, optional-permission denial, blocked/disabled downloads and segmented-video fallback on live sites. Do not advertise universal YouTube downloading, private-video access, watermark removal or server downloading. Review the new install/site-access warnings. Synthetic fixture smoke tests are not proof of current live-platform compatibility.

- [ ] Deploy the Motion code/migrations into Railway **web**, domain `api.auto-flow.studio`, root `/backend`. This is not the extractor service. Back up the database first; follow [backend deployment steps](../backend/MOTION_BILLING.md).
- [ ] Keep the existing Pro product, price, webhook URL and secret unchanged. No new Motion Whop variables are required. Enable `MOTION_BILLING_ENABLED=True` only after the new endpoints and migrations have been verified.
- [ ] Verify a free account gets 3 jobs a UTC day and a 4th is refused with the reason, Pro is unlimited, and Pro expiry/revocation falls back to the free allowance. Check retries are never counted and Studio's counters are untouched. Disable/archive the unused separate Motion offering in Whop after reviewing any existing buyers; do not silently cancel or migrate paid memberships.
- [ ] Obtain the store extension ID. Register its exact `https://<extension-id>.chromiumapp.org/` redirect on the existing Google OAuth client, and configure the production API's permitted extension origin where required. Do not change Studio's redirect.
  - Store ID (draft, October 3): `cdfjofjbpbbobgbfggkhdabaplikeica`. Redirect to add: `https://cdfjofjbpbbobgbfggkhdabaplikeica.chromiumapp.org/` (from `chrome.identity.getRedirectURL()` in `googleSignIn.ts`). Done October 3: `EXTRA_CORS_ORIGINS` on Railway web now lists the unpacked ID `bdjcghcakpbolhffgefdfajfcnmhjhnj` and the store origin `chrome-extension://cdfjofjbpbbobgbfggkhdabaplikeica` (production's CORS list is locked down — Studio could not sign in until its ID was on it), and `check_motion_release --require-enabled --extension-id cdfjofjbpbbobgbfggkhdabaplikeica` passes in the container. The redirect was added October 3 to client `202771542299-9de70n12u6bci4tnolh94itjm8vrseej` (the one `/api/auth/google/config` returns). Google's authorize endpoint now sends that redirect to its sign-in page, as it does Studio's, while an unregistered ID goes to its OAuth error page.
- [ ] Test email signup, verification/resend, password login, Google login, logout, subscription purchase/linking and one authorized provider run using the packaged extension. Provider tabs, eligible accounts and credits are required. Test upload failure and retry without duplicate job charging.
- [ ] Publish a public HTTPS privacy policy matching `privacy.html`. Add the operator's legal identity, verified support email, actual server retention/deletion practices and rights-request process. Set that URL and contact in the store dashboard. The local notice is not a substitute.
  - Live since October 3: privacy policy `https://www.auto-flow.studio/privacy` (section 2.6, anchor `#motion`, covers Motion; every language now serves this text) and the website field `https://www.auto-flow.studio/motion`. Support email and retention are in it. Still open: the operator is named only as "amine.smpc" — decide whether to add a legal name/address.
- [ ] Supply reviewer credentials for a dedicated AutoFlow account with active Pro and usable provider access/instructions. Never paste credentials into this document, source control or public listing. Use the dashboard's private testing instructions. No reviewer-only bypass.
- [ ] Create real 1280×800 screenshots (at least one, up to five), 440×280 promotional tile and 128×128 icon; verify current dashboard requirements. Existing `icons/icon128.png` is ready. Offline test screenshots are QA artifacts, not evidence of successful live generation.
- [ ] Publisher account verified, two-step verification enabled, privacy questionnaire completed accurately; submit only after all gates pass.
- [ ] After the listing is published: set `MOTION_STORE_URL` in `website/src/app/products.js` to the listing URL and redeploy the website. Until then `/motion` and the home page's Motion card show "Coming soon".

## Listing copy

**Name:** AutoFlow Motion — Motion Control

**Summary:** Taken by the store from the package's manifest `description`, so it changes only with a new build: "Transfer motion, replace subjects and restyle videos in a focused AutoFlow workspace. Requires your AI platform accounts."

**Description** (paste as plain text; the summary comes from the package's manifest description):

```text
Turn the movement of one video into a new video — with a different person, a different look, or a different place.

AutoFlow Motion is a Chrome side panel that runs motion-transfer jobs in Google Flow for you. Add a source video, choose what should change, and press Generate. The panel cuts your video into pieces Flow can take, has your AI assistant watch each piece and write its prompt, uploads the pieces to Flow, and generates them one by one.

WHAT YOU CAN DO
• Transfer motion — keep the movement, timing and camera of your video, and give it to a new character from your own image.
• Replace the subject — swap the person or object while the motion and the dialogue stay as they are.
• Restyle the video — keep the movement and change the whole look: material, style or medium.
• Change the place — add a setting image, and every piece is placed in that same setting.

HOW IT WORKS
1. Add your motion video (MP4, MOV or WebM, up to 500 MB). Optionally add a subject image and a place image.
2. Choose Gemini, ChatGPT or Claude to watch the video and write a prompt for each piece.
3. Press Generate. Longer videos are cut into pieces of up to 10 seconds, and each piece is generated in Google Flow.
4. Review your clips and download them all into a folder you choose. Edit any prompt and retry only the pieces you want — finished steps are kept.

BUILT FOR REAL RUNS
• Prompts ask the model to keep every movement, in the same order and at the same timing as your video.
• Prompts ask the model to keep the subject and the setting the same across every piece.
• Optional source-audio removal, for videos where speech causes problems.
• Follows the work: Motion shows the tab that is working, or, if you prefer, leaves Google Flow and Gemini or Claude in the background while you use other tabs. Your computer stays awake until the job ends.
• Your projects are saved on your computer, so you can come back later to retry or regenerate.

PLANS
• Free AutoFlow account: 3 Motion jobs a day (resets at midnight UTC).
• AutoFlow Pro: unlimited Motion jobs.
One job is one press of Generate: all pieces of that video count together, and retrying a job never uses another one. Accepted jobs are not refunded automatically if a provider fails.

WHAT YOU NEED
• An AutoFlow account — you can sign up for free inside the extension.
• Your own Google Flow account with generation credits, and an account with Gemini, ChatGPT or Claude. Generations use your own accounts and credits.
• Keep Chrome and the Motion panel open while a job runs.

PRIVACY AND PERMISSIONS
• Your videos, images and prompts are sent only to the services you choose (Google Flow and your AI assistant). AutoFlow's server receives your account email and your job counts, to check your plan. Nothing is sold or used for advertising.
• Automated uploads to Flow need your consent in the panel. During an upload, Chrome shows a "started debugging this browser" banner: the extension is choosing the file for you in the Flow tab, and it detaches when done.
• Only upload content you have the rights to use.
Privacy policy: https://www.auto-flow.studio/privacy

AutoFlow Motion is an independent product and is not affiliated with or endorsed by Google, OpenAI or Anthropic. Provider websites can change, generations can fail, and results are not guaranteed.
```

## Single purpose and permissions

Single purpose: assist a user-requested video transformation workflow from local source selection through AI analysis, Flow upload, generation and result retrieval.

| Permission | Current purpose |
|---|---|
| sidePanel | Persistent Motion workspace beside provider tabs |
| storage | Local projects, upload receipts, preferences and account tokens |
| unlimitedStorage | User-selected video/reference media and project caches can exceed standard quotas |
| scripting | Restore provider content scripts after reload and perform scoped provider interactions |
| alarms | Coordinate/recover extension work while Chrome's service worker is recycled |
| identity | User-initiated Google authentication through Chrome's OAuth redirect |
| downloads | Save generated clips and stage video files needed by the Flow file chooser |
| debugger | Drive the real Flow file chooser for consented video uploads; detach afterward. Not optional in Chrome's permission API |
| power | Keep the computer from sleeping while a job the user started is running (`requestKeepAwake('system')`; the screen may still turn off). Released when the job ends or fails and when the panel closes. No install warning (Chrome's permission list, checked October 7) |

0.1.12 (October 7, built, NOT packaged yet): "While it works", plus "Download all". After using background mode, the user asked for the working tab to be shown again: "if the work is in Gemini it is not switching to it, and if in Flow it is not switching to it". The on/off switch is now a choice under Advanced controls (`af_motion_tabs`, `src/backgroundTabs.ts`). "Show the working tab" is the default: Studio's beta key alone, so Motion switches to Gemini/Claude or Flow at each hand-off and before an upload, but never pulls the tab back every 30 seconds. "Work in the background" adds `af_background_strict` (the 0.1.10 behaviour). ChatGPT keeps both keys off. A render of the built panel confirmed the keys for all three cases.

"Download all": A button under the clip summary saves every ready clip into a folder the user picks in Chrome's folder picker (`showDirectoryPicker({ id: 'motion-clips', mode: 'readwrite' })`, which opens in the last-used folder). Files are named "<project> - 01.mp4", numbered by piece, and never overwrite: an existing name gets " (2)". A clip is read from its saved data: URL, or from its Flow address with the Google session; one that cannot be read is named in the result while the rest still save (`src/saveClips.ts`). No new permission, and nothing leaves the device. The privacy policy's "Saving clips" line now mentions the folder (website, deploy pending approval). Tests: `tests/saveClips.test.ts`; Motion 19 suites / 165 tests and `test:extension` pass; a run of the real build with an in-memory folder saved both clips under the right names. **Hold the package:** the session fixing the flaky "Recover ending frame" UI test (task_db90b0a3) was editing `studio-extension/src/content/flow/videoFrames.ts` when this was built, so this build holds its unfinished change. Rebuild, retest and package once that session ends.

0.1.11 (October 7): 0.1.10 plus keep-awake, so a job keeps running when the user walks away. New permission `power`. The dashboard needs a justification for it, for example: "Keeps the computer from going to sleep while a Motion job the user started is running, so a long job is not cut off by system sleep. The screen can still turn off. Released as soon as the job ends or fails, or the panel is closed." The job holds `chrome.power.requestKeepAwake('system')` around `runner.run` (`src/keepAwake.ts`, `src/controller.ts`) and releases it in `finally`; the panel also releases it on open and on `pagehide`, because the request belongs to the extension, not the page. The progress card says "Your computer stays awake until the job ends." Tests: `tests/keepAwake.test.ts`; Motion 18 suites / 152 tests and `test:extension` pass. `test:ui` passed on 2 of 4 runs: it fails intermittently at its "Recover ending frame" step, which decodes a MediaRecorder webm fixture with no duration. That code is untouched here; a fix is suggested as a separate task. Packaged: `release/autoflow-motion-0.1.11-candidate.zip`, 31 files, SHA-256 `7AFEE5FDDF779C01B543D8D1A406652E5CDA0BBC535293EFF05053F7DE3462B7`. **Live test passed October 7**, in a Multilogin Mimic (Chromium) profile with the unpacked build: a one-piece, 10-second job with Gemini. The director pass, the upload to Flow and the generation all ran with the provider tabs left in the background, and the clip was collected as Ready while the Flow tab was hidden. The panel showed the keep-awake line; the job ended before Windows' idle-sleep timer, so preventing sleep itself was not observed. Upload 0.1.11, not 0.1.10.

0.1.10 (October 7): "Work in the background", on by default (Advanced controls; the choice is `af_motion_background`). Motion writes Studio's beta key `af_background_tabs` plus a Motion-only `af_background_strict` (`studio-extension/src/background/backgroundMode.ts`); Studio never sets the second, so Studio is unchanged. With both on, the shared worker skips the 30-second foreground grab, the raise at the Gemini → Flow hand-off and the raise before an upload. Instead the Flow tab is made non-discardable, and a discarded tab is reloaded in place by the upload's existing "receiving end" retry. The upload's direct route (`DOM.setFileInputFiles`) needs no layout; only if Flow offers no input and the coordinate click is left is Flow shown for that click, and the previous tab and window are put back (`showBriefly`/`handBack`). A site that needs a person appears in the panel with "Open tab" (`PANEL_RUN_STATE.needsAttention` → `PANEL_OPEN_ATTENTION_TAB`) instead of taking the screen. ChatGPT keeps the old behaviour: its adapter is not hidden-tab safe. Chrome still shows its "started debugging this browser" bar during uploads; that cannot be hidden. Tests: Motion `tests/backgroundTabs.test.ts`, Studio `src/tests/backgroundStrict.test.ts`; Motion 17 suites / 146 tests, `test:ui`, `test:extension` pass; Studio's full suite shows the same 12 failing suites and the same 22 failing tests as before the change. Packaged: `release/autoflow-motion-0.1.10-candidate.zip`, 31 files, SHA-256 `CD74BF2379F19481BD3988E7718BDB0F766C4D29DDBE1435EC961AC215C5EA48`. **Not yet live-tested:** run one short job with Flow and Gemini in background tabs before uploading it.

0.1.9 (October 6): sales. Every Upgrade link opens `https://www.auto-flow.studio/checkout` for the signed-in account (email in the URL fragment, which the checkout embed locks) instead of the plans page, from which a buyer could pay under another address and the webhook gave Pro to a new account. Each link carries `utm_source=motion&utm_medium=extension&utm_campaign=pro_upgrade&utm_content=<top_bar|limit|plan_line|after_clip|account|compare>`; the website's checkout sends a GA4 `pro_checkout_complete` event, so sales can be counted per button (mark it as a key event in GA4). The panel re-reads the plan on focus and every 15 s for 15 minutes after an Upgrade click, and says when Pro is on. Price shown: `$10/month` (`PRO_PRICE`, what Whop plan_fxMVMOmbFPcp4 charges; the website says $9.99). At 1 job left: "last free job today"; at the limit: a countdown to midnight UTC, and the plan is read again when it passes. After a finished clip: Pro also makes Studio and Queue Manager unlimited. Tests: `tests/upgrade.test.ts`, `tests/account.test.ts`; `check`, `build`, `test` (16 suites / 138 tests), `test:ui`, `test:extension` pass, and a local render of the free plan (2, 1 and 0 jobs left, 320/420 px, light/dark) showed no overflow or page errors. Packaged: `release/autoflow-motion-0.1.9-candidate.zip`, 31 files, SHA-256 `B4CD093A5D4504772E631285DAB51621CA158C45DC15F1B0AEE618D0E56451DF`. Upload 0.1.9, not 0.1.8.

0.1.8 (October 4, packaged October 6): fitness fixes — the motion block keeps the repetition count instead of forbidding "repeat", the director no longer names the action in Transfer/Replace, and a "Fitness / workout" focus preset sends its rules to Omni directly. Also: saved character/place images are found again in Flow's library — short `af_ref_<16 hex>` names for new uploads, matching by name unless both keys are Flow media UUIDs, and the one new chip as proof. And a trim dragged to the very end no longer fails at Generate: the run checks the selection against the length the panel showed (`<video>` duration) and cuts within the length the file measures (`planMotionRun`). And a piece whose Flow tile fails is retried automatically: the content watcher presses Flow's own Retry button on that tile, up to 3 times, 5 s after the failure, and waits for Flow to start again before another press (`MOTION_NATIVE_RETRIES`, `MotionNativeRetry` in `studio-extension/src/content/flow/motionRetry.ts`; it replaced the earlier panel-side resubmission). It applies to every failure Flow shows on the tile, refusals included; the log warns that retries may use Flow credits. Stop ends it. The same build carries the video trim work (motionRange.ts, VideoRange.tsx) and clip continuity (motionContinuity.ts, motionEndFrame.ts) from other sessions. Rebuilt October 6: `check`, `build` (warnings are bundle size only), `test` (15 suites / 129 tests), `test:ui` and `test:extension` pass. Packaged October 6: `release/autoflow-motion-0.1.8-candidate.zip`, 31 files, SHA-256 `CCC8AB2F5D8B1BF13DE884716ABEA735837A48BE3CD024D6E8E6C4810B1E5DE2`. Upload 0.1.8, not 0.1.7.

0.1.7 (October 3): the director's reply is read with the storyboard's quote repair, so a prompt that quotes on-screen text in straight quotes no longer stops the run, and the reply format asks for curly quotes. Upload 0.1.7, not 0.1.6.

Removed in 0.1.6: `offscreen` and `notifications`. Neither was ever used by Motion — only Studio's background opens an offscreen document or sends run notifications, and Motion's jobs always run in the panel. `tests/package.test.ts` now fails if the manifest requests a permission the shipped code never calls.

Provider hosts: `flow.google.com` and supported `labs.google` routes for Flow automation; `flow-content.google`/`*.googlevideo.com` for media retrieval; `chatgpt.com`, `gemini.google.com`, `claude.ai` for user-selected analysis; `api.auto-flow.studio` for account/billing. No all-sites permission. No browsing-history collection unrelated to the task.

## Privacy questionnaire preparation

October 11 social-import update (extractor route deployed/enabled; extension not packaged/published): round on-video Motion icon with tooltip, safe feed permalink selection, and a default **AutoFlow server · yt-dlp** method alongside **Browser only**. The new extractor host permission is `https://autoflow-extractor-production.up.railway.app/*`; server mode sends the selected link, reuse confirmation and account bearer there and temporarily downloads source media. Railway deployment `f729281b-3c6f-4b3d-9712-ee22be6cabde` is SUCCESS. Live API/auth/CORS checks, ffmpeg presence and actual-runtime synthetic yt-dlp handoff pass. Still hold store publication until owned-video tests pass on all supported platforms and public policy/disclosures match `privacy.html`. Existing candidate ZIPs do not contain these extension changes. Server uses one worker/replica; Redis shares fail-closed hourly counters. See `../motion-social-import.md` and `../outputs/motion-import-deploy-20261011/DEPLOYMENT.md` for boundaries and rollback details.

Declare the categories actually transmitted/handled: personally identifiable information (email/account), authentication information, user-provided content (video, images, prompts and outputs), and necessary provider page content/activity. Subscription status is handled; card details are not entered into this extension. Assess the dashboard's financial/payment category against the real backend processing. Do not mark “no data collected” simply because media goes directly to providers. No advertising, data selling or creditworthiness use. Review infrastructure logging/retention with the operator before certifying.

Code is bundled locally; remote responses are task data, not executable updates. Store disclosures must match both code and the public policy. This checklist is not a guarantee of approval.

## Rebuild and package

From this folder, use `npm run check`, `npm run build`, `npm test`, `npm run test:ui`, `npm run test:extension`, then `npm run package:store`.

The packaging script validates the production manifest, an explicit file allowlist, required runtime assets and root ZIP layout. It excludes source, maps, tests, environment files and reports a SHA-256. It refuses to overwrite an existing candidate. The ZIP is an upload candidate, **not approval to publish**.

## Official requirements checked October 1, 2026

- [Publish and reviewer access](https://developer.chrome.com/docs/webstore/publish)
- [Listing and screenshots](https://developer.chrome.com/docs/webstore/cws-dashboard-listing/)
- [Privacy declarations](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy/)
- [Minimum permissions](https://developer.chrome.com/docs/webstore/program-policies/permissions)
- [Optional permission restrictions](https://developer.chrome.com/docs/extensions/reference/api/permissions)
- [Limited Use](https://developer.chrome.com/docs/webstore/program-policies/limited-use)
