/* Release notes for each extension, newest first. Each page under
   /queue/changelog, /studio/changelog and /motion/changelog reads its list
   from here, and /changelog shows the latest entry of each.

   Written for users: what changed for them, not how. Dates are the day the
   release was built. Versions between two entries are folded into the next
   one, as the AutoFlow list always did. */

export const PRODUCTS = {
  queue: {
    key: "queue",
    name: "Queue Manager",
    short: "Queue",
    href: "/queue",
    changelog: "/queue/changelog",
    blurb: "Batch generation for Google Flow — the original AutoFlow extension.",
  },
  studio: {
    key: "studio",
    name: "Studio",
    short: "Studio",
    href: "/studio",
    changelog: "/studio/changelog",
    blurb: "The node canvas that runs Flow, ChatGPT, Gemini, Grok and Claude together.",
  },
  motion: {
    key: "motion",
    name: "Motion",
    short: "Motion",
    href: "/motion",
    changelog: "/motion/changelog",
    blurb: "Gives any video's motion to your own character in Google Flow.",
  },
};

export const RELEASES = {
  queue: [
    {
      version: "11.7",
      date: "2026-11-19",
      title: "Retry One Clip, Faster Runs, Agents That Hear Everything",
      highlights: [
        "A ↻ button on each prompt makes that one clip again and keeps the others. If later clips continue from it, you choose whether they are made again too",
        "An image Flow did not accept (a blank chip in the prompt) is fixed in place with Flow's own @ picker, instead of being uploaded again",
        "Characters and images already in the prompt are used as they are, not searched for again, so each prompt goes out sooner",
        "Shorter waits between steps: the same queue finishes faster",
        "Images with the same name are told apart, so the right one is attached each time",
        "New in Characters: Full body. A character can get its whole body and outfit made, not only its face",
        "When Flow refuses to make a character, the Queue Manager stops at once and says why, instead of waiting",
        "Clips that finish after you press Stop or close the tab are still counted: the next time Google Flow opens, they are marked done or failed",
        "AI agents hear each event the moment it happens: a clip done or failed, a character ready or refused, and problems like an account Flow is limiting or no credits left",
        "The Agent page says when it is waiting for your AI agent, with a Connect now button",
      ],
    },
    {
      version: "11.6",
      date: "2026-11-15",
      title: "Files You Can Trust, and Agent Mode",
      highlights: [
        "Every queue saves into its own folder, Downloads/AutoFlow/<queue>/, never a shared date folder",
        "Each file is named for the prompt that made it, 001_<its words>.mp4, matched by the clip itself and never by its place on the page, so names no longer shift or get mixed up",
        "A manifest.json beside the files lists each prompt, its words, whether it finished and which file it made",
        "Downloading the same files again replaces them instead of adding (1) copies",
        "Agent mode, for AI agents: runs like Full, always downloads, holds a prompt Flow refuses twice until the agent gives it new words, and has its own daily runs",
        "See what an AI agent is doing: its actions in the run view's \"What happened\", an Agent tab in the panel, its prompts in Create, and image runs that show done as soon as Flow finishes",
        "AI agents connect on newer Chrome too: switching agent control on asks Chrome for the connection it was quietly holding",
        "Running a queue again saves only the prompts still without a file, and an upscaled size always gets the upscaled file",
        "Images download at your Image resolution (2K when the plan has no 4K), no longer always at 1K",
        "\"Files saved\" counts only files that really reached the folder, and \"What happened\" shows where each one went",
      ],
    },
    {
      version: "11.5",
      date: "2026-11-15",
      title: "See Every Clip as It Happens",
      highlights: [
        "The run view has a \"What happened\" list: each prompt sent, done, failed or sent again, newest first, with the time",
        "A failed prompt shows the reason Flow gave and what to do about it: new words for a policy refusal, a wait when Flow is limiting the account",
        "AI agents hear of each clip the moment it finishes or fails, instead of waiting for the whole queue, and can follow every run live",
        "Each clip's result is counted as it happens, even with the panel closed. Only the result is sent: never your prompt's words",
      ],
    },
    {
      version: "11.4",
      date: "2026-11-14",
      title: "Several Accounts, Your Queues' Projects and a Cleaner Panel",
      highlights: [
        "Each queue keeps its Flow project: open it, or Scan & download its videos numbered by its prompts, from the queue card or the Library",
        "The Library lists your queues' projects, and the Queues and Create tabs are clearer: finished queues show their progress, and Run now says which characters and chained clips the run holds",
        "Characters made after a queue was added still get into it when it runs, and a characters project whose name did not save is found anyway",
        "New projects get their name saved, even when the Flow tab is not in front",
        "Works when Google Flow is in Arabic or another language",
        "AI agents can tell your browsers apart: name each one in Settings, AI agents, and run each account on its own",
      ],
    },
    {
      version: "11.3",
      date: "2026-11-14",
      title: "Characters, Chains and Prompts That Fix Themselves",
      highlights: [
        "The Characters tab makes Flow characters for you: describe one (or let the AI writer do it), or upload a photo, which costs no credits. Pick a voice or describe how it should sound. Each character is made once, in your AutoFlow Characters project, and every queue borrows its face and voice",
        "Write a character's name in a prompt and the run adds that character to it",
        "Every queue gets its own Flow project, named after the queue, and its retries go back to it",
        "Put prompts between [ and ] on their own lines and each one starts from the last frame of the clip before it, so the story continues shot to shot",
        "A prompt Flow refuses for its policy is reworded before it is sent again, when you have a Gemini key in Settings → AI Assist. The reason Flow gave is kept with the prompt",
        "Characters made from the side panel keep their name in Flow, so prompts find them",
        "The download report says how many files failed instead of \"All downloaded\", and waits for Chrome to finish each file",
        "Stop no longer leaves prompts marked as running, and the log no longer loses lines",
        "AI agents can make characters, chain clips and give refused prompts new words, and the new Agent page shows everything an agent did",
      ],
    },
    {
      version: "11.2",
      date: "2026-11-12",
      title: "Let an AI Agent Run Your Queues",
      highlights: [
        "New in Settings: Let AI agents control AutoFlow. With it on, Claude Code, Codex, Antigravity or another AI agent on your computer can add queues, change settings and start runs for you, through the AutoFlow agent server (npx autoflow-agent). See auto-flow.studio/agents",
        "An agent's runs use the same checks as the Run button: your daily prompts, the Full, Flow and Lite allowances, and the same counting. You see them in the panel as they happen",
        "It is off until you switch it on, and it only accepts the agent server on your own computer",
        "The orange Open Studio button is gone from Google Flow's page",
      ],
    },
    {
      version: "11.1",
      date: "2026-11-10",
      title: "Lower Priority Works Again",
      highlights: [
        "Veo 3.1 - Lite [Lower Priority] stays selected. The Queue Manager used to switch it to the regular Veo 3.1 - Lite the next time it opened, which costs credits, so on some accounts Flow would not submit the prompts",
        "The run modes are called Full, Flow and Lite again, in the settings and on the Account page",
        "Find characters in Flow tries Flow's + menu a second time when it does not open, and when it still cannot read the list it says which step failed, instead of always asking you to open your project",
      ],
    },
    {
      version: "11.0",
      date: "2026-11-08",
      title: "Omni 1.2 Flash",
      highlights: [
        "Omni 1.2 Flash, Google Flow's newest video model, is in the model list. Omni 1.1 Flash is still there",
        "Each model offers its own clip lengths: Omni 1.1 keeps 4, 6, 8 and 10 seconds, and Omni 1.2 offers every length from 3 to 15 seconds. The Queue Manager sets Flow's new Length slider and checks that Flow took it",
        "Models marked \"Leaving Dec 5\" in Flow are selected and refreshed by their plain name again",
        "Once Flow removes a model, your runs switch to its replacement and say so in the log: Omni 1.1 to Omni 1.2, Veo 3.1 Fast and Quality to Veo 3.1 Lite",
      ],
    },
    {
      version: "10.9",
      date: "2026-11-05",
      title: "Flow in English, Every Time",
      highlights: [
        "Google Flow now opens in English for the Queue Manager, whatever language your Google account uses. On an Arabic Flow every prompt stopped with \"Could not switch Flow to Video mode\"",
        "A Flow tab that is not in English reloads once with ?hl=en as it opens; a tab already in English is never reloaded",
        "Pressing Run on a Flow tab that was open before the extension updated switches that tab to English first, then starts the run. The switch used to happen after Run and cut the run off"
      ],
    },
    {
      version: "10.8",
      date: "2026-11-01",
      title: "Re-prompt Before the Scan",
      highlights: [
        "Before the library scan, every prompt without a video is re-prompted, one by one, up to three times",
        "That includes prompts Flow refused during the run and prompts whose video never appeared",
        "Each prompt keeps its own retry count, so a refusal no longer counts as retries already used",
      ],
    },
    {
      version: "10.7",
      date: "2026-11-01",
      title: "Old Errors Cleaned Up",
      highlights: [
        "When a retried prompt succeeds, its old failed try is moved to Flow's Bin (you can restore it from there)",
        "Scan page matches failed tiles to prompts by their words, so a prompt that succeeded on a retry is no longer listed as failed",
        "A prompt finished later with Flow's own Retry is found by Scan page and marked done",
        "Scan page works after the run ends, even after the page reloads",
      ],
    },
    {
      version: "10.6",
      date: "2026-11-01",
      title: "Failed Prompts, Retried and Replaced",
      highlights: [
        "Failed prompts are re-prompted automatically, up to three times each, in Full and Flow mode, before the library scan",
        "Safety-blocked prompts get their three tries too; Flow refunds a refused generation",
        "New Replace button: give failed prompts new words and they are made as the same prompt numbers, so the Library stays in order",
        "Paste several replacements at once, with a blank line between, and they fill the failed prompts in order",
        "Retry now works after the run ends, even after the page reloads for the library scan",
      ],
    },
    {
      version: "10.5",
      date: "2026-11-01",
      title: "Your Flow Characters, by Name",
      highlights: [
        "Find characters in Flow reads the characters you saved in your Flow project",
        "A prompt that says a character's name gets that character, with its own face and voice",
        "Each prompt shows which characters it will get; nothing is created or changed in Flow",
      ],
    },
    {
      version: "10.4",
      date: "2026-11-01",
      title: "Characters, Reliably",
      highlights: [
        "New characters get their name in Flow every time; AutoFlow checks it took and tries again",
        "After setting up characters AutoFlow always returns to your project, so the run carries on",
        "If a character cannot be set up, its prompts still run with the character's image",
      ],
    },
    {
      version: "10.3",
      date: "2026-11-01",
      title: "Images Before Prompts",
      highlights: [
        "The image tools stay open when you add images before writing prompts; they used to vanish",
      ],
    },
    {
      version: "10.2",
      date: "2026-11-01",
      title: "Characters With Voices",
      highlights: [
        "Give a character image a voice, and AutoFlow makes it a Flow Character with that face, name and voice",
        "Every prompt that names the character gets it, and speaks in its voice",
        "Characters already in your Flow project are reused by name, with the voice you chose",
        "Prompts that name no character get no voice",
      ],
    },
    {
      version: "10.1",
      date: "2026-11-01",
      title: "Simpler Image Tools",
      highlights: [
        "Each way to add images is one plain card: what it does in one sentence, and its own button",
        "Settings stays in view while the image tools are open; each one scrolls on its own",
      ],
    },
    {
      version: "10.0",
      date: "2026-11-01",
      title: "Prompts From a Text File",
      highlights: [
        "Load .txt adds the prompts in a text file after the ones already in the box",
        "Prompts can be separated by a blank line, or one per line; AutoFlow tells which from the file",
        "Drop a .txt file on the prompt box to do the same",
      ],
    },
    {
      version: "9.9",
      date: "2026-11-01",
      title: "Matches Flow's New Settings",
      highlights: [
        "New Resolution setting for Omni 1.1 Flash: 720p or 360p, set on Flow before the run starts",
        "Duration shows only for Omni; with Veo the panel says it makes 8-second 720p clips",
        "Model lists match Flow's menus, and models Flow dropped switch to the closest one it still has",
        "Before each prompt, checks Flow's ratio, length and resolution and fixes any that changed",
        "Refresh models works with Flow's settings closed and lists clean model names",
        "Failed generations clears when a new run starts and names the queue its failures came from",
      ],
    },
    {
      version: "9.8",
      date: "2026-11-01",
      title: "Failed Videos, Retried",
      highlights: [
        "A failed video is seen through Flow's API the moment it fails, even with Flow in the background",
        "Full mode regenerates failed prompts, up to three times; Flow mode presses Flow's own Retry instead",
        "A safety-blocked prompt is tried once more, then listed as one that cannot be generated, with Flow's reason",
      ],
    },
    {
      version: "9.7",
      date: "2026-11-01",
      title: "See the API at Work",
      highlights: [
        "Pressing Stop, or a run finishing, no longer freezes the side panel",
        "When a run ends, the run view folds back into the bar at the bottom; tap it to see the summary",
        "Each row shows whether Flow's API caught its video: API, then ⚡ API when the API confirms it finished, or Page when only the page could",
        "The counts show how many videos the API caught, like API 3/3",
        "Every prompt is linked to its video the moment Flow's API names it, so the last prompt of a background run no longer waits until you look at Flow",
      ],
    },
    {
      version: "9.6",
      date: "2026-11-01",
      title: "Flow's API Answers Again",
      highlights: [
        "Videos are confirmed by Flow's own API the moment they finish, instead of by scanning the page round after round",
        "Works with Flow hidden in the background: Queue asks Flow about exactly its own videos, every five seconds at most",
        "The API badge shows API again during video runs instead of Passive",
        "The page is now only the last resort, used when the API has no answer",
      ],
    },
    {
      version: "9.5",
      date: "2026-10-31",
      title: "Full-Panel Runs & Steadier Checks",
      highlights: [
        "A run fills the side panel: progress, Pause and Stop, every prompt with its state in a word, and a summary with Retry, New run and Close when it ends",
        "A Done button folds the prompt box away and keeps your prompt list on screen, in every mode",
        "Images for many prompts moved to the bottom bar, with a small picture of how each option works",
        "The final check of an image run scrolls Flow's whole list, so finished images no longer sit at Generating",
        "Waits for every reference image to finish uploading before pressing Generate",
        "Steadier with Flow in the background: waits no longer stall in a hidden tab, and Queue no longer pulls Flow to the front every 18 seconds",
      ],
    },
    {
      version: "9.4",
      date: "2026-10-30",
      title: "Know What Changed",
      highlights: [
        "After an update, Queue opens its website changelog in a normal, active browser tab",
        "Every extension reload opens a fresh changelog tab, even when the version is unchanged",
      ],
    },
    {
      version: "9.3",
      date: "2026-10-30",
      title: "Maintenance Release",
      highlights: [
        "Everything from 9.2 under a new version number. Nothing changes in how AutoFlow works",
      ],
    },
    {
      version: "9.2",
      date: "2026-10-19",
      title: "Clearer Queues & a Steadier Flow",
      highlights: [
        "Queues are split into To run and Finished, and each one says where it stands: not started, paused at 3 of 10, running, or done",
        "Queue settings sit right under the mode picker, so you choose the model, ratio, length and run mode before you write the prompts",
        "Image prompts submit again on the latest Flow. A press that Flow ignored used to leave the run at \"Creating #1 0%\"; it now goes through, or the run stops and says so with your prompt still in the box",
        "Flow's Agent mode is switched off before a run. With Agent on, Flow hides the model and ratio settings, so the run could not set them",
      ],
      improvements: [
        "You stay signed in when your login renews. Opening the panel after an hour could sign you out, which also hid Frame-to-Video and Ingredients",
        "A Wi-Fi blip no longer signs you out",
        "Run now, pressed during a run, no longer adds a queue it then refuses to start",
        "An image counter on each prompt shows how many references it carries and how many more fit",
        "Plainer words across the panel, in all four languages",
      ],
    },
    {
      version: "9.1",
      date: "2026-09-30",
      title: "The Side Panel, Rethought",
      highlights: [
        "Three tabs — Create, Queues and Library — with Settings and Account in the header",
        "Run now beside Add to Queue, and a live prompt count instead of a Parse button",
        "A run dock on every tab: watch a run without being pulled back to Create",
        "French, Spanish and Arabic across the whole panel, with Arabic laid out right to left",
        "A plan strip for free accounts shows what is left today and the way to Pro, and checkout carries on after you sign in",
      ],
      improvements: [
        "Every choice says what it does in a sentence underneath it",
        "A prompt is Waiting, Sending, Generating, Done or Failed everywhere it appears",
        "Frame-to-Video and Ingredients no longer disappear when your allowance can't be read; a spent allowance shows them locked instead",
        "The Data & Privacy section now says exactly what stays in your browser, what goes to AutoFlow and what goes to Google",
        "Every text color meets contrast guidelines, and nothing is smaller than 11px",
      ],
    },
    {
      version: "8.4",
      date: "2026-09-13",
      title: "Finished Queues Hand Over",
      highlights: [
        "A finished queue now says it finished in every run mode, so the next queue in a chain starts on its own instead of waiting at 3 of 3",
        "Usage counts what Flow actually received, retries and extends included, even with the panel closed",
        "Every daily limit opens the same upgrade dialog, with the price and what is blocked right now",
      ],
      improvements: [
        "A backup server keeps AutoFlow working if the main one can't be reached",
        "Requests give up after a deadline instead of spinning forever",
      ],
    },
    {
      version: "5.9",
      date: "2026-09-04",
      title: "Works With the New Google Flow",
      highlights: [
        "Supports Flow's new address, flow.google.com. The panel had said Flow was closed while it was open on screen",
        "Fixes \"Could not switch Flow to Image mode\" on the redesigned Flow",
        "Finds Omni 1.1 Flash under its new name, and will keep finding models when Flow adds a version number",
      ],
    },
    {
      version: "5.8",
      date: "2026-08-03",
      title: "Ask AI & New Studio Templates",
      highlights: [
        "Ask AI: ChatGPT writes the prompt for a step, from a toolbar button of its own",
        "Templates: Water Wipeouts and ASMR styrofoam carving, with artwork on the template cards",
        "A finished clip can hand its last frame to the next step",
        "References are captured when a step runs, and a failed step can be retried",
      ],
    },
    {
      version: "5.2",
      date: "2026-08-01",
      title: "Pro Activates Every Time",
      highlights: [
        "Upgrading to Pro now opens checkout with your AutoFlow email already filled in and locked. The field used to arrive empty, so the browser could autofill a different address — and paying under an address that wasn't your AutoFlow one meant Pro never switched on",
        "Subscribed before creating an AutoFlow account? Your account is now created the moment payment clears, with Pro already active, and you get an email with a code to set your password. Previously that subscription had nothing to attach itself to and simply sat unused",
      ],
      improvements: [
        "Choosing Upgrade while signed out now takes you to sign-in instead of straight to a payment form, so a purchase can't end up belonging to nobody",
        "The Upgrade button on the pricing page goes through the same protected checkout as the extension",
      ],
    },
    {
      version: "5.1",
      date: "2026-07-29",
      title: "Studio Reliability & Full-Size Viewer",
      highlights: [
        "Multi-step workflows now run all the way through — previously only the first generation succeeded and every node after it failed to switch between Image and Video mode",
        "Long video generations survive — Studio now keeps the extension awake during a run, so 10-second clips no longer lose their connection partway through a series",
        "Full-size viewer — click any reference or result to open it at full size, videos included, with playback controls",
        "Exercise Series template — one character reference becomes four exercise storyboards and four 10-second vertical clips, with the mascot reference included",
        "Two more templates: Triple Lock (separate face, outfit and scene references) and Product UGC (put a model in your own product photo)",
      ],
      improvements: [
        "Reference images and results are no longer cropped in the node — a tall portrait previously had 45% of itself cut off, including the subject's head",
        "The Flow settings panel now closes reliably after each step instead of staying open over the prompt box",
        "A generation that takes longer than expected no longer reports as failed — it says the work may still be running so you don't re-run it needlessly",
        "Video nodes get a longer completion window than image nodes, matching how long each actually takes",
        "Every template's reference slots are now labelled with their role (face, outfit, scene, product)",
        "Template gallery search and category filters work; previously they were decorative",
      ],
    },
    {
      version: "5.0",
      date: "2026-07-29",
      title: "AutoFlow Studio — Visual Workflow Builder",
      highlights: [
        "AutoFlow Studio — build workflows on a canvas instead of a list. Connect a prompt to a generation, feed that result into the next one, and run the whole chain in a single click",
        "12 ready-made workflows with working example prompts — UGC product ads, character sheets, virtual try-on, B-roll packs and more, so there is nothing to write before your first run",
        "Character consistency — generate a character sheet once, then reuse it as a reference so the same face carries across every shot",
        "Multi-reference generation — lock face, outfit and scene with separate reference images, so a new outfit no longer quietly changes the face",
        "ChatGPT workflows — design an image on ChatGPT, then animate it on Google Flow in the same run",
        "Save, reload, import and export workflows, with autosave so closing the window no longer loses work",
      ],
      improvements: [
        "Reference images now reach the generator — image connections drawn on the canvas were previously ignored, so character references had no effect",
        "Generated results now preview inside each node instead of showing a broken thumbnail",
        "Model lists corrected — the picker offered names that do not exist on Flow (\"Veo 3\", \"Imagen 4 Ultra\"), which silently fell back to whichever model was already selected",
        "10-second clips selectable on every video node",
        "Image → Video switching made reliable in multi-step workflows; the run now stops with a clear message rather than generating the wrong media type",
        "Studio opens your Flow project, or a ChatGPT tab, automatically when one is not already open",
        "Removed the forced page reload that hit every Google Flow visit",
        "Free plan includes 15 Studio runs per month and workflows up to 5 nodes; Pro is unlimited",
        "No API key is embedded in the extension any more — AI Assist now uses your own free Gemini key",
      ],
    },
    {
      version: "4.2",
      date: "2026-07-04",
      title: "Instagram Extractor Fix & Smart Retry Engine",
      highlights: [
        "Instagram Extractor resilience — restricted and private Instagram posts now return clear, user-friendly error messages instead of raw technical errors",
        "Smart retry engine — failed generations now click the DOM retry button (up to 3 attempts) instead of re-submitting the entire prompt, saving time and credits",
        "Whop email mismatch prevention — a visible warning on registration and upgrade buttons reminds users to use the same email on Whop and AutoFlow for automatic Pro activation",
      ],
      improvements: [
        "Increased MAX_RETRIES to 3 with a new VERIFY_MAX_RETRIES constant for finer retry control",
        "MediaID capture reliability improved during the verification loop",
        "Backend now categorizes Instagram errors into 'Restricted Content' vs 'Server Block' with actionable guidance",
        "Upgrade button shows a confirmation alert before redirecting to Whop checkout",
      ],
    },
    {
      version: "4.0",
      date: "2026-06-22",
      title: "Official v4.0 Production Release",
      highlights: [
        "Major version release for the AutoFlow Chrome extension",
        "Clean zip packaging for Chrome Web Store and direct site downloads",
      ],
      improvements: [
        "Upgraded manifest and package versioning configurations",
      ],
    },
    {
      version: "3.6",
      date: "2026-06-19",
      title: "Cancelled Video Rescue & API Verification Fix",
      highlights: [
        "Fake Cancel Rescue — cancelled videos that actually exist on Google's CDN are now automatically detected and saved instead of being re-submitted or lost",
        "CSP-Safe API Checking — rewrote the active status check to work with Google's Content Security Policy, fixing the 'API credentials not captured' timeout that broke verification",
        "Universal DOM Tiebreaker — when the API cache shows stale 'generating' status but tiles are already settled, the bot now immediately routes to recovery in all modes (previously Full mode was stuck looping)",
      ],
      improvements: [
        "CDN URL verification now runs on both 'no API data' and 'no retry button' paths, catching all fake cancel scenarios",
        "Race condition fix between API cache updates and status check responses using cache confirmation polling",
        "Verification rounds resolve in 1–2 rounds instead of looping through all 12 when tiles are already settled",
      ],
    },
    {
      version: "3.5",
      date: "2026-06-16",
      title: "Stuck Wait Loop Fix & Scroll Optimization",
      highlights: [
        "Robust Tag-Agnostic Icon Detection — updated generation tile parsing to support new Google Flow span elements, preventing completed items from getting falsely stuck in generating status.",
        "Grid Scroll Optimization — wait loop now checks settles status directly via DOM and performs scroll confirmations exactly once, eliminating continuous scrolling.",
        "Recovery Scan Optimization — removed redundant page scrolling blocks from recovery scan, cutting recovery checking time in half.",
      ],
      improvements: [
        "Bundled build optimizations and bumped manifest version to 3.5 for Chrome Web Store publishing.",
      ],
    },
    {
      version: "3.4",
      date: "2026-06-14",
      title: "Zero-Intervention Reliability & CORS Resolution",
      highlights: [
        "Safety Policy Failures Classification — automatically identifies policy and safety blocks to instantly skip them without wasting retries",
        "Exact Failure Reasons — sidepanel's Failed Generations section now displays the specific reason why a prompt failed (e.g. policy violations or server errors) alongside its text",
        "CORS Redirect Bypass — redesigned network media verification using manual redirect tracking, resolving Chrome extension cross-origin blockages",
      ],
      improvements: [
        "Stuck queue mitigation — 30-second API staleness detector triggers active refreshes and DOM tiebreakers to prevent queue stagnation",
        "Automated queue-to-download pipeline robustness enhancements",
      ],
    },
    {
      version: "3.3",
      date: "2026-06-10",
      title: "Omni Flash Model & Duration Controls",
      highlights: [
        "Omni Flash model support — Google's new high-speed video generation model is now fully integrated",
        "10-second video clips — available exclusively with Omni Flash for longer, richer generations",
        "Duration selector on queue cards — change clip length directly from each queue without opening Settings",
        "Run button on every queue — run any queue instantly, not just the first one in the list",
      ],
      improvements: [
        "Updated model list across Settings and queue cards to match latest Google Flow lineup",
        "Scheduling UI temporarily removed while being redesigned for a better experience",
        "Library scanner now correctly detects and labels Omni Flash-generated assets",
        "Model selector in automation engine recognizes Omni as a new model family",
      ],
    },
    {
      version: "3.2",
      date: "2026-06-01",
      title: "Premium UI Redesign & Scalability Upgrade",
      highlights: [
        "Complete UI overhaul — electric blue glassmorphic design with micro-animations",
        "Scalable prompt list — scrollable container handles 2,000+ prompts smoothly",
        "Breathing icon animations on active mode cards for visual feedback",
        "Animated header accent line with shimmer effect",
        "Enhanced textarea focus states with multi-layer glow effects",
      ],
      improvements: [
        "Auto-expire system for time-limited Pro access (review rewards)",
        "Paying subscribers are now protected from accidental downgrades",
        "Refined tab navigation with sleek active-state underlines",
        "Compact prompt row design with stronger hover interactions",
        "Performance-optimized CSS with reduced repaints",
      ],
    },
    {
      version: "2.7",
      date: "2026-05-26",
      title: "Mixed Queue Tracking & Review Rewards",
      highlights: [
        "Mixed-type queue support — text and image prompts counted separately per queue",
        "Review Reward system — get free Pro by leaving a Chrome Web Store review",
        "Smart eligibility gate — reward CTA only appears when you hit your daily limit",
        "Limit dialog now shows 'Get Free Pro' option alongside upgrade",
      ],
      improvements: [
        "More accurate prompt tracking for mixed content queues",
        "Backend pre-consumption splits text/image credits atomically",
      ],
    },
    {
      version: "2.6",
      date: "2026-05-19",
      title: "Analytics & Usage Tracking Overhaul",
      highlights: [
        "Per-prompt type counting — each prompt in a queue is individually classified",
        "Usage analytics now based on actual execution events, not reserved quotas",
        "Enhanced admin dashboard with real-time metrics",
      ],
      improvements: [
        "Fixed mixed queues being reported as single type",
        "Improved reliability of queue consumption tracking",
      ],
    },
    {
      version: "2.5",
      date: "2026-05-13",
      title: "Browser Notifications & Queue Improvements",
      highlights: [
        "Browser notifications when queues complete or fail",
        "Notification sound toggle in settings",
        "Click notification to focus the active Flow tab",
        "Extend feature for Text-to-Video and Ingredients modes",
      ],
      improvements: [
        "Fixed Stop button reliability during long queues",
        "Better error handling for failed generation chains",
        "Improved queue stop signal propagation",
      ],
    },
    {
      version: "2.4",
      date: "2026-04-28",
      title: "Prompt Extractor & Library Scan",
      highlights: [
        "Prompt Extractor — reverse-engineer prompts from any AI video",
        "Auto-scan library after queue completion",
        "Batch download with quality selection (720p, 1080p, 4K)",
        "Re-prompt dialog for failed generations",
      ],
      improvements: [
        "Faster library scanning with grouped assets",
        "Better error messages for generation failures",
      ],
    },
    {
      version: "2.3",
      date: "2026-04-10",
      title: "Multi-Queue & Character Libraries",
      highlights: [
        "Multiple named queues with independent configurations",
        "Character image library for consistent subjects across prompts",
        "Frame chain support — use output from one generation as input for the next",
        "Queue reordering via drag-and-drop",
      ],
      improvements: [
        "Reduced memory usage for large queues (100+ prompts)",
        "Improved image attachment reliability",
      ],
    },
    {
      version: "2.0",
      date: "2026-03-15",
      title: "Major Redesign — Pro Plans & Account System",
      highlights: [
        "Complete UI redesign with dark theme",
        "Account system with Free and Pro plans",
        "Daily usage tracking with visual progress bars",
        "Veo 3 model support",
        "Multi-language support (English, Arabic, French)",
      ],
      improvements: [
        "Full rewrite of automation engine for reliability",
        "New side panel architecture",
      ],
    },
  ],

  studio: [
    {
      version: "1.7.8",
      date: "2026-11-12",
      title: "Let an AI Agent Build and Run Workflows",
      highlights: [
        "New in the side panel: Let AI agents control AutoFlow. With it on, Claude Code, Codex, Antigravity or another AI agent on your computer can build workflows, open templates, edit nodes, run, retry and read the results, through the AutoFlow agent server (npx autoflow-agent). See auto-flow.studio/agents",
        "An agent builds from a plan that Studio checks with the same rules as its own builder, and its Run counts like yours. Agent connected shows in the top bar while one is",
        "It is off until you switch it on, and it only accepts the agent server on your own computer",
      ],
    },
    {
      version: "1.7.7",
      date: "2026-11-11",
      title: "Finished Images and Videos Arrive Again",
      highlights: [
        "Fixed: an image or video Flow had finished could still show \"Generation failed\" in Studio. Studio could not download the finished file, so the node had no picture or clip to show or pass on",
        "Studio now opens from a Studio item in Flow's left bar, just above Trash, instead of the orange button over Flow's header",
        "Post to community fits the window again. Opened from the canvas, it hung off the top of the screen with its title and name fields out of reach",
      ],
    },
    {
      version: "1.7.6",
      date: "2026-11-08",
      title: "Omni 1.2 Flash",
      highlights: [
        "Omni 1.2 Flash, Google Flow's newest video model, is in the Generate node's model list. Omni 1.1 Flash is still there",
        "Each model offers its own clip lengths: Omni 1.1 keeps 4, 6, 8 and 10 seconds, and Omni 1.2 offers every length from 3 to 15 seconds in a dropdown. Studio sets Flow's new Length slider and checks that Flow took it",
        "Models marked \"Leaving Dec 5\" in Flow are selected by their plain name again",
        "Once Flow removes a model, your workflows switch to its replacement and say so in the log: Omni 1.1 to Omni 1.2, Veo 3.1 Fast and Quality to Veo 3.1 Lite",
      ],
    },
    {
      version: "1.7.5",
      date: "2026-11-05",
      title: "Flow in English, Every Time",
      highlights: [
        "Google Flow now opens in English for Studio, whatever language your Google account uses. On an Arabic Flow every prompt stopped with \"Could not switch Flow to Video mode\"",
        "A Flow tab that is not in English reloads once with ?hl=en as it opens; a tab already in English is never reloaded",
        "Pressing Run on a Flow tab that was open before the extension updated switches that tab to English first, then starts the run. The switch used to happen after Run and cut the run off"
      ],
    },
    {
      version: "1.7.4",
      date: "2026-11-02",
      title: "A Cleaner Studio",
      highlights: [
        "Switching from Simple to Canvas now fits the whole workflow on screen; the right side used to be cut off",
        "Simple view puts your photos first, keeps long prompts to a readable height, and shows results as tidy cards",
        "The settings panel is only as tall as its settings, and the mini map moved to the bottom-left so it never covers your nodes",
        "Community posts show readable step maps, the platforms they use by name, and \"Community member\" instead of \"Someone\"",
      ],
      improvements: [
        "The node library is simpler: Agent, Clipping and Motion Control were removed (Motion and clipping have their own tools). Workflows that already use them still open",
        "Node names are larger and easier to read on the canvas",
        "On smaller windows the node library starts folded, so the canvas has room",
        "The home page lines up in one centred column, and long template descriptions no longer stretch the cards",
        "Signed out, the share bar explains how to sign in instead of offering a Post button that does nothing",
        "Search stays on My Workflows and finds your saved workflows by name",
      ],
    },
    {
      version: "1.7.3",
      date: "2026-11-01",
      title: "Flow, Read Correctly",
      highlights: [
        "Flow's whole output list is scanned again: Studio now scrolls the container Flow actually scrolls",
        "Reads Flow's current status replies, so finished and failed videos are known from Flow itself",
        "Asks Flow for a video's status directly when Flow stops checking in a background tab",
        "Runs beside AutoFlow Queue without either extension silencing the other's status checks",
      ],
    },
    {
      version: "1.7.2",
      date: "2026-10-30",
      title: "Fewer Browser Permissions",
      highlights: [
        "Removed unused offscreen access and redundant active-tab access from Studio",
        "Removed an unused background media scaffold; current clipping and frame extraction continue through the existing media pipeline",
      ],
    },
    {
      version: "1.7.1",
      date: "2026-10-30",
      title: "Know What Changed",
      highlights: [
        "After an update, Studio opens its existing website changelog in a normal, active browser tab",
        "Every extension reload opens a fresh changelog tab, even when the version is unchanged",
      ],
    },
    {
      version: "1.7.0",
      date: "2026-10-30",
      title: "Simple View & a Clearer Canvas",
      highlights: [
        "Simple view: a template opens as a form. Fill in its prompts and photos, press Run, and watch every image and clip arrive in order. Switch to the canvas any time",
        "A node's settings open in a side panel when you click it, so nodes are about a third of the size and a whole workflow fits on screen",
        "Studio opens on For You: the most liked community workflows first, then every AutoFlow template",
        "Nodes never open on top of each other, and Tidy lays a workflow out in the order it runs",
      ],
      improvements: [
        "Each input says what it takes (Text, Image, Start frame, Video), and inputs no longer cover a node's settings",
        "Run sits in the top bar, and the node library docks beside the canvas and folds to icons",
        "Flow image nodes submit again on the latest Flow",
        "ChatGPT nodes work with ChatGPT's new page and start a fresh chat for each node",
        "A Director whose earlier chat can't be reopened asks again in a fresh one instead of failing",
      ],
    },
    {
      version: "1.6.1",
      date: "2026-10-27",
      title: "Community Workflows",
      highlights: [
        "Community feed: browse workflows other creators posted, see each one as a mini map of its steps, and open it on your canvas in one click",
        "Post your own workflow from the canvas with a title and a caption. Your uploaded photos are left out unless you choose to include them",
        "Report a post that breaks the rules; posts that several people report are hidden",
        "Motion: a Keep exact lip sync switch that keeps every mouth movement on the same frame as the source",
      ],
      improvements: [
        "Starting over always opens a new Gemini chat instead of continuing the old one",
        "A Generate press counts only when Flow actually reacted, so a piece no longer waits on a clip nothing asked for",
        "When the director's reply can't be read, the error quotes what it read",
      ],
    },
    {
      version: "1.4.2",
      date: "2026-09-13",
      title: "Runs in the Background",
      highlights: [
        "Background working (beta): runs keep going with the provider tabs hidden, so you can use your browser meanwhile",
        "Needs attention: when a step needs you, Studio says so and brings up the right tab, once",
        "Claude and Gemini collect a finished reply from a hidden tab instead of giving up on it",
      ],
    },
    {
      version: "1.2.0",
      date: "2026-09-04",
      title: "The New Google Flow",
      highlights: [
        "Supports flow.google.com and Flow's redesigned controls: Image/Video switching, the settings chip and aspect ratios",
        "Finds Omni 1.1 Flash under its new name, and old workflows that say Omni Flash still run",
        "The clipping editor burns in captions and drawn effects, adds the sounds the edit sheet names, and does speed ramps",
        "The workflow builder reads a whole brief and keeps the conversation",
      ],
      improvements: [
        "Studio follows Flow, ChatGPT, Gemini and Grok in every language they ship in. On a French Flow, \"off\" had read as \"on\"",
        "A failed request says why",
        "Long clips are split at pauses, not mid-sentence",
      ],
    },
    {
      version: "1.1.0",
      date: "2026-08-28",
      title: "Studio on the Chrome Web Store",
      highlights: [
        "Studio becomes its own extension, with its own canvas window and a side panel for control during a run",
        "Clipping: captions burned in, in four looks including word-by-word highlight",
        "A clipping director suggests what to add to each cut, and generates the cutaways it asks for",
        "Long clips are split into pieces Omni accepts, and uploaded to your Flow library in one click",
      ],
      improvements: [
        "A style reference from your Flow library can be attached by name",
        "A finished workflow keeps its cuts when you reopen it",
      ],
    },
    {
      version: "0.27",
      date: "2026-08-19",
      title: "Early Access",
      highlights: [
        "Six platforms on one canvas: Google Flow, ChatGPT, Gemini, Grok, Claude and Z.AI",
        "Grok Imagine video, and Extend as its own step (up to 30 seconds)",
        "Start and End frames for Flow video",
        "Ask AI presets bring the craft; you bring the idea",
        "Rebuilt generation settings, showing only the options each model has",
      ],
      improvements: [
        "Before 0.27, Studio was part of the AutoFlow extension — see Queue Manager 5.0 to 5.8",
      ],
    },
  ],

  motion: [
    {
      version: "0.1.36",
      date: "2026-11-11",
      title: "Finished Clips Arrive Again",
      highlights: [
        "Fixed: a piece Flow had finished could fail to load in Motion, because Motion could not download the finished file. It now arrives with its preview and last frame",
      ],
    },
    {
      version: "0.1.35",
      date: "2026-11-08",
      title: "Choose Omni 1.2",
      highlights: [
        "A new Model choice in the setup: Omni 1.1, with pieces up to 10 seconds, or Omni 1.2, with pieces up to 15 seconds",
        "With Omni 1.2, a long video is split into fewer pieces, and the trim shortcuts fit whole 15-second pieces. Omni 1.2 uses about twice the credits per second",
        "Your existing projects stay on Omni 1.1 with everything they already prepared",
        "Once Flow removes Omni 1.1 on December 5, Motion uses Omni 1.2 for those projects",
      ],
    },
    {
      version: "0.1.34",
      date: "2026-11-05",
      title: "Flow in English, Every Time",
      highlights: [
        "Google Flow now opens in English for Motion, whatever language your Google account uses. On an Arabic Flow every prompt stopped with \"Could not switch Flow to Video mode\"",
        "A Flow tab that is not in English reloads once with ?hl=en as it opens; a tab already in English is never reloaded",
        "Pressing Run on a Flow tab that was open before the extension updated switches that tab to English first, then starts the run. The switch used to happen after Run and cut the run off"
      ],
    },
    {
      version: "0.1.33",
      date: "2026-11-01",
      title: "Flow Status in the Background",
      highlights: [
        "Reads Flow's current status replies, so a finished or failed video is known from Flow itself",
        "Asks Flow for a video's status directly when Flow stops checking in a background tab",
        "Finds every clip in Flow's output list, including ones scrolled out of view",
      ],
    },
    {
      version: "0.1.32",
      date: "2026-11-01",
      title: "Faster Completion and Working Playback",
      highlights: [
        "A finished video is no longer held at Generating by an API response that only says its media URL is missing",
        "Reuses the downloaded video for playback and ending frames instead of downloading it twice",
        "Reload preview retrieves the saved video through the extension instead of reopening the same inaccessible link",
        "Shows when Flow has finished and Motion is loading the video; stalled media reads now have a time limit",
      ],
    },
    {
      version: "0.1.31",
      date: "2026-11-01",
      title: "Keep Finished Clips",
      highlights: [
        "A video completed in Flow stays ready even when its preview or ending frame cannot be captured",
        "Keeps the finished video's download link instead of asking you to generate it again",
        "Reads the video link again when Flow mounts its player after the first check",
      ],
    },
    {
      version: "0.1.30",
      date: "2026-10-30",
      title: "Know What Changed",
      highlights: [
        "After an update, Motion opens its existing website changelog in a normal, active browser tab",
        "Every extension reload opens a fresh changelog tab, even when the version is unchanged",
      ],
    },
    {
      version: "0.1.29",
      date: "2026-10-30",
      title: "Keeping Up With Flow and ChatGPT",
      highlights: [
        "Reads Flow's generation updates again after Flow changed how it sends them, so each piece is followed from Flow's own reports",
        "ChatGPT as the director engine works with ChatGPT's redesigned page",
      ],
    },
    {
      version: "0.1.28",
      date: "2026-10-23",
      title: "References Count Correctly",
      highlights: [
        "A video reference attached in Flow now counts as attached. Motion had stopped with \"1 of 2 ingredients\" while both were there",
      ],
    },
    {
      version: "0.1.27",
      date: "2026-10-20",
      title: "No More Silent Waits",
      highlights: [
        "A piece no longer sits at \"Generating in Flow\" when the Generate press didn't land. Motion checks that Flow reacted, and tries again or says so",
      ],
    },
    {
      version: "0.1.26",
      date: "2026-10-19",
      title: "A Fresh Chat Every Time",
      highlights: [
        "Starting over always opens a new Gemini chat",
        "When the director's reply can't be read, the error shows what it read",
      ],
    },
    {
      version: "0.1.25",
      date: "2026-10-19",
      title: "Keep Exact Lip Sync",
      highlights: [
        "A new switch beside Remove source audio: every mouth movement stays on the same frame as the source video, in time with each word",
        "Works with Remove source audio too — the mouths still move, and you can put the original sound back in an editor",
      ],
    },
    {
      version: "0.1.24",
      date: "2026-10-19",
      title: "Replace People & Items",
      highlights: [
        "Replace several people and objects in one video: Motion finds them, you pick up to four and give each one an image",
        "A replacement can be described in words instead of an image",
        "A redesigned panel: a four-step progress bar, the choices as clear cards, and a checklist that shows only what is still missing",
      ],
      improvements: [
        "Saving no longer freezes the panel during a run",
        "Flow's Agent mode is switched off before a run, so Motion can choose Omni",
        "The panel always shows something while it opens, and a Reload button if it fails",
      ],
    },
    {
      version: "0.1.23",
      date: "2026-10-18",
      title: "Landscape Output",
      highlights: [
        "Choose Portrait 9:16 or Landscape 16:9 for every clip in a project",
        "A refreshed panel with clearer cards, switches and keyboard navigation",
      ],
      improvements: [
        "Show the working tab is back to its original behavior: Motion brings up each provider as the work moves there",
        "Automatic uploads are on by default, and the checklist tells you if your browser's file access still needs enabling",
      ],
    },
    {
      version: "0.1.18",
      date: "2026-10-17",
      title: "Finished Clips Finish",
      highlights: [
        "A finished clip no longer stays at \"Generating\" because Flow showed only its thumbnail",
        "When the browser blocks an upload, Motion explains the setting to change instead of repeating the upload",
      ],
    },
    {
      version: "0.1.15",
      date: "2026-10-15",
      title: "Video Links & Omni 1.1 Flash",
      highlights: [
        "Import a video from a TikTok, Instagram Reel or YouTube link, or with the Motion button beside the video",
        "Motion uses Omni 1.1 Flash. If your Flow account doesn't offer it, Motion stops before generating and says so",
        "Gemini reads its answers from a hidden tab more reliably",
      ],
    },
    {
      version: "0.1.9",
      date: "2026-10-06",
      title: "Trim, Continuity & Retry",
      highlights: [
        "Trim a long video before splitting it, with Keep start, middle or end shortcuts",
        "Keep clips consistent: each piece carries on from the last",
        "Retry a single piece without starting a new job",
      ],
    },
    {
      version: "0.1.4",
      date: "2026-10-02",
      title: "Motion for Every Account",
      highlights: [
        "Motion launches as its own Chrome side panel: add a video and a character, and it cuts the video, writes a prompt for each piece and generates them in Flow",
        "Free accounts get 3 Motion jobs a day; AutoFlow Pro is unlimited",
        "Create an AutoFlow account inside the panel",
        "Reference images upload once per Flow project and are reused after that",
      ],
    },
  ],
};

export function latest(key) {
  return RELEASES[key][0];
}
