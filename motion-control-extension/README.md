# AutoFlow Motion

Version 0.1.28 fixes the false "1 of 2 ingredients" stop before Generate. Flow video chips with Google Storage image thumbnails now count as attached references. Busy, placeholder and unloaded thumbnails still block submission. Reload Motion and refresh Flow after updating so the page uses the updated adapter.

Version 0.1.23 refreshes the side panel: neutral light/dark surfaces, clearer cards and selection states, visual portrait/landscape controls, switch-style options, and persistent Create/Your results navigation. Existing generation and tab-following behavior is retained.

Version 0.1.22 adds **Output format** under **What changes**: choose **Portrait · 9:16** or **Landscape · 16:9**. The setting is saved with the project and sent to Flow for every generated clip. Portrait remains the default for existing projects. Changing format after a run requires Generate again; Retry unfinished keeps the original format.

A separately installable Chrome extension for Motion Control. All controls run directly in the browser's side panel; there is no launcher, Studio page, popup window or canvas to open. The existing motion engine, provider adapters, authentication and server plan checks are reused at build time.

## Load the extension

Automatic Flow uploads require the browser's per-extension **Allow access to file URLs** setting. In Edge, open `edge://extensions`; in Chrome, open `chrome://extensions`. Open AutoFlow Motion's Details and enable the setting only if you trust it with local-file access. Motion checks this before saving temporary clips or opening Flow's picker. Version 0.1.18 explains a denied permission instead of repeating the same blocked upload command. After enabling it, use **Retry unfinished**.

Version 0.1.21 restores the original **Show the working tab** behavior on upgrade: Motion selects the working provider at every step, including repeated Gemini steps, then Flow as the work moves there. The existing 30-second keepalive brings the working tab/window back if you switch away during a run. Stop or completion ends this behavior. Later choices in **Advanced controls → While it works** are saved. Refresh provider tabs after reloading the extension.

Version 0.1.20 also defaults automatic uploads to on when no preference is saved; an explicit off choice stays off. The setup checklist checks browser file access before enabling Generate and refreshes when you return to the panel/provider tab. The browser file-access toggle still needs to be enabled by the user once.

1. In Chrome, open **Manage extensions** and enable **Developer mode**.
2. Choose **Load unpacked** and select this folder's **`dist`** directory, not the source directory.
3. Click the **AutoFlow Motion** extension icon. The working Motion panel opens immediately beside your current tab. For an existing installation, click **Reload** in Manage extensions, close the old Motion window, and reopen the extension.
4. Sign in with your existing AutoFlow Pro account, or choose **Create an AutoFlow account** inside the panel. Enter your email, password and confirmation without opening the registration website. Verify using the link in your inbox, then return to **Back to sign in**. The panel also offers **Resend verification email**. Sessions are separate from Studio, but Motion uses the same Pro entitlement—no separate purchase. Active Pro includes 3 Motion jobs/day and 12/calendar month (UTC), tracked separately from Studio's allowance. The new backend routes must be deployed before production generation works.
5. Open a signed-in Flow project and your selected analysis chat. Add a source video and optional subject/place references. Automatic uploads and following the working provider tab are enabled by default; complete any remaining browser-access step in the checklist before generating.

Do not run Studio and Motion simultaneously against the same provider tabs. Both extensions may inject their controls into those pages; pause or disable Studio when testing Motion.

## Included

### Trim before splitting

After adding a video, choose **Keep full video** (split only when needed) or **Trim start & end**. Trim any length using start/end times and sliders; only that selected range is split into clips of up to 10 seconds. The live count shows how many clips will be generated. **Keep start / Keep middle / Keep end** shortcuts fit the largest complete 10-second multiple: 31s → 30s (3 clips), 41s → 40s (4 clips). Play the source preview to review only the selected range. The original file is unchanged; selection settings survive project reload and participate in retry identity.

The source length now displays fractional seconds: a 10.03-second source is over the 10-second limit even though the old display said 0:10. An 11-second source trimmed to 0.5–10.5 seconds produces one 10-second piece rather than two independent generations. Existing projects keep their full-video behavior unless you choose to trim.

- Transfer motion, replace a subject, or restyle a video.
- Optional subject and place references with distinct engine inputs.
- Reference images upload once per Flow project, then later pieces and retries reuse the saved library asset. Reuse is based on image contents and the confirmed Flow asset ID, not the node name or input position. Receipts survive tab reloads; only metadata is retained, not an extra copy of the image.
- Gemini, ChatGPT or Claude analysis; existing Flow Omni 1.1 Flash generation.
- Per-piece prompts, previews, alternative prompts, retry and download links.
- Video uploads must be confirmed ready before a piece is marked "In Flow". Processing, missing, or uncheckable uploads pause the run; retry checks the original project's existing upload instead of sending another copy. An explicitly failed upload can be uploaded again, while prepared prompts and completed pieces are retained. This does not prevent Google-side or network upload failures.
- Whole-source mute and mute-on-retry for individual pieces. These remove source audio; they do not guarantee that Flow generates silent output or succeeds.
- Local projects and source-video storage. Checkpoints during runs, interrupted-run warnings and single-workspace ownership prevent accidental duplicate starts.
- Fresh runs and retries require the server's existing-Pro access check. An unavailable or denied check starts no generation. Retries reuse the saved Motion job identity without consuming another Motion job; provider generation credits can still apply.
- A responsive, keyboard-accessible workspace with advanced settings collapsed by default.

## Video links

In **Motion video → Import a video link**, paste a TikTok video/short link, Instagram Reel/video post or YouTube watch/Shorts link. Or click the round orange **Motion icon** beside the visible video. Its tooltip is **Use in Motion Control**. It also supports feed posts when their permalink can be identified without guessing, and rechecks the selected post after scrolling. Confirm ownership or reuse permission and click **Import & download**. The same source bytes are used in Motion and copied into **Downloads / AutoFlow Motion**. This does not start a generation.

**AutoFlow server · yt-dlp** is the default download method. It requires sign-in, sends the selected URL to the existing extractor service, and temporarily downloads public videos (up to 100 MB / ten minutes). The route was deployed and enabled October 11, 2026; live API/auth/CORS and actual-runtime synthetic file handoff pass, but real owned-video tests on each platform remain. **Browser only** remains available and sends no video or cookies to AutoFlow during import; a video tab may open and Chrome may request the selected media-host permission. Neither path exports site cookies, removes watermarks or bypasses private/DRM access. Platform blocking and unavailable formats can still require Upload file. See [implementation and verification boundary](../motion-social-import.md).

## Processing limits

### Protected background tabs

In **Advanced controls → While it works**, **Show the working tab** is the default. You can choose **Work in the background** with Gemini (or Claude), though Gemini may pause attachment processing while hidden. Motion protects every provider tab used by the job from automatic discarding, keeps the computer awake, and checks Flow's status from its background worker. If Chrome recycles the worker, monitoring recovers from session storage without resubmitting a generation. Finishing, failing, or closing the panel restores each tab's original discard setting. No extra permission or permanent debugger session was added.

Chrome can still throttle or freeze hidden pages. If the working tab is frozen or discarded, Motion shows **Open tab** and asks you to resume collection rather than generating again. For additional Memory Saver protection, add `gemini.google.com` and `flow.google.com` to **Chrome Settings → Performance → Always keep these sites active**. If Energy Saver freezes tabs, plug the computer in or turn Energy Saver off while processing. These are [browser settings](https://support.google.com/chrome/answer/12929150?hl=en), not settings the extension can change for you. Background protection is not a guarantee of provider-side behavior. ChatGPT still requires its foreground adapter.

**Keep the side panel open during processing.** Motion cutting uses browser media/canvas APIs in this panel. Closing it interrupts local orchestration; this release does not promise unattended background execution. A submitted provider generation may still finish, so inspect Flow before retrying an interrupted piece.

Automated video uploads reuse Studio's explicit `chrome.debugger` upload permission. Chrome displays a debugging banner while attaching. Turning the switch off prevents new uploads. No debugger-free upload implementation is claimed.

Files and projects are stored locally in this extension, not automatically shared with Studio or synchronized to other computers. If source storage fails or is cleared, reselect the original file. Provider result URLs can expire; download clips you want to retain. Individual generations may have visible joins.

Reference reuse starts with uploads made by this version; older randomly named uploads cannot be safely matched. Changing the image or Flow project requires one new upload. If a saved image is deleted or Flow's picker cannot identify it, the run stops instead of duplicating it or generating without the correct reference. Keep those images in the project library. A failed/unconfirmed upload is searched on retry, not blindly uploaded again; if it never reached Flow and cannot be recovered, use a new Flow project. Clearing extension storage also clears reuse receipts. Reference reuse applies to Motion's ingredient images, not source-video uploads or Studio's Start/End frame mode.

## Google sign-in setup

Email/password uses the existing AutoFlow login endpoint. Google sign-in requires the **new extension's redirect URI** to be authorized on the existing AutoFlow Google OAuth client. The error UI reports the exact URI; it can also be read with `chrome.identity.getRedirectURL()` from this extension's service-worker console.

The unpacked extension ID can change when its directory changes. For distribution, use the published extension's stable ID and register that redirect. This task does not change the Google OAuth client, backend configuration, pricing, or store listing.

## Build and verify

Source builds require this folder beside `studio-extension` with the latter's npm dependencies installed. No dependency installation is required to load an already built `dist`.

```powershell
cd motion-control-extension
npm run check
npm run build
npm test
npm run test:ui
npm run test:extension
npm run test:background
npm run test:gemini-background
```

Packaging tests inspect `dist`, so build before running the tests. UI smoke tests use Playwright from the local Codex runtime and installed Chrome by default. Set `PLAYWRIGHT_PATH` to another installed Playwright package and `CHROME_PATH` to another Chromium executable if needed. Screenshots are written to ignored `test-artifacts/`. The UI smoke test blocks external requests and cannot spend generation credits.

The extension smoke test uses an isolated temporary Edge profile, loads the real unpacked build, and runs offline. It checks the service worker, real local video/image inputs, persistence after reload, project picker, upload-consent storage and duplicate-window lock without signing in. Override `EXTENSION_BROWSER_PATH` for another Chromium executable that supports unpacked extensions in automation.

The Gemini background smoke executes the built adapter on a hidden offline fixture with content-script timers clamped to 60 seconds. It checks new-chat navigation, a settled video attachment, one submission and full reply collection through bounded worker waits. In version 0.1.15 it also leaves the composer unchanged and renders no answer DOM, then verifies collection from the completed generation response with one submission. The hook matches only the armed prompt and requires a completion marker plus successful HTTP completion. It never replays a generation request, stores no request/response content persistently and falls back to page collection when the format is unknown. It handles Motion's Gemini text/analysis replies; image/video outputs still use their existing collectors. It cannot run a genuinely frozen renderer or send a request that Gemini itself has not issued. These offline checks do not certify the current signed-in provider. Reload the extension and refresh Gemini to replace an older injected adapter.

The build emits performance-size warnings for the shared engine/UI bundles. It does not require Studio to be installed in Chrome. A narrowly scoped, tested build adapter disables the shared Studio window opener and floating Flow-page button for Motion only. Studio source remains unchanged; if the shared launch hooks change, the build fails for review instead of silently restoring popup behavior.

## Verification boundary

Automated checks cover types, packaging, graphs, retry validation, plan denials and local UI. Successful live login, Google OAuth, video upload and a complete paid Flow generation require signed-in provider testing; they are not certified by the local smoke tests. This is a first standalone build, not a Chrome Web Store release.
