# AutoFlow – Bulk Video Generator for Google Flow

> **Disclaimer:** Third-party automation tool. **Not affiliated with Google.** Automates your interactions with Flow (labs.google/flow) in your browser session. Use responsibly and respect Google's Terms of Service.

---

## What is AutoFlow?

AutoFlow is a Chrome Extension (Manifest V3) that automates bulk **Ingredients-to-Video** generation on Google Flow. It provides a side panel UI to:

- Paste many video prompts at once (separated by blank lines)
- Attach 0–3 reference images per prompt
- Queue and manage batch jobs (AUTOFLOW1, AUTOFLOW2, …)
- Configure model, aspect ratio, and generation count
- Monitor real-time progress with pause/resume/stop/skip/retry
- Scan a project's outputs and bulk-download selected videos

---

## Installation (Load Unpacked)

### Prerequisites
- **Node.js** 18+ and **npm**
- **Google Chrome** 114+ (Manifest V3 + Side Panel API)

### Steps

```bash
# 1. Clone / download this repository
cd autoflow

# 2. Install dependencies
npm install

# 3. Build the extension
npm run build

# 4. Load in Chrome
#    - Open chrome://extensions
#    - Enable "Developer mode" (top-right toggle)
#    - Click "Load unpacked"
#    - Select the `dist/` folder inside this project
```

### Generate placeholder icons (optional)

If you want icons, create an `icons/` folder with 16×16, 48×48, and 128×128 PNG files named `icon16.png`, `icon48.png`, `icon128.png`. The extension works without icons.

---

## How to Use

### 1. Open Google Flow
Navigate to [labs.google/flow](https://labs.google/flow) and log in with your Google account.

### 2. Open AutoFlow Side Panel
Click the AutoFlow extension icon in Chrome's toolbar (or use the puzzle-piece menu). The side panel opens on the right.

### 3. Configure Settings (Settings Tab)
- **Video Model**: Select the model (e.g., "Veo 3.1 Fast")
- **Aspect Ratio**: Landscape (16:9) or Vertical (9:16)
- **Generations per Task**: 1–4 outputs per prompt
- **Stop on error**: If checked, the queue stops on any failed prompt
- **Auto-download**: If checked, outputs are downloaded automatically
- Click **Save Settings**

### 4. Enter Prompts (Video Tab)
Paste your video prompts into the textarea. **Separate each prompt with a blank line:**

```
A majestic eagle soaring over mountain peaks at golden hour, 
cinematic 4K, slow motion

A deep ocean scene with bioluminescent jellyfish drifting 
through dark waters, ethereal lighting

A futuristic cityscape at night with flying cars and 
neon signs reflecting off wet streets
```

Click **Parse Prompts** to see them as individual rows.

### 5. Add Reference Images (Optional)
For each prompt, click **+ Add images** to attach up to 3 reference/ingredient images. These will be uploaded to Flow when that prompt runs.

### 6. Add to Queue
Click **Add to Queue**. The queue is auto-named (AUTOFLOW1, AUTOFLOW2, …).

Then choose:
- **Start a New Project** — AutoFlow will create a new Flow project
- **Run in This Project** — Runs in the currently open Flow project

### 7. Run the Queue (Queues Tab)
Switch to the **Queues** tab to see all queues. Click **▶ Run** on the queue you want to execute.

### 8. Monitor Progress
The **Run Monitor** appears in the Video tab showing:
- Current prompt index
- Live timestamped logs
- Per-prompt status (Queued → Running → Done / Failed)
- Controls: Pause, Resume, Stop, Skip Current, Retry Failed

### 9. Scan & Download (Library Tab)
After generation completes:
- Click **Scan This Project** to detect generated videos
- Select videos using checkboxes
- Click **Download Selected Videos**

---

## Recipe / Prompt File Format

Prompts are entered directly in the extension textarea. Separate each prompt with one or more blank lines:

```
First prompt text.
Can span multiple lines.

Second prompt starts after a blank line.

Third prompt here...
```

---

## Queue State Machine

Each prompt goes through this state machine:

```
IDLE
→ ENSURE_VIDEO_INGREDIENTS_MODE
→ APPLY_SETTINGS (model, ratio, generations)
→ ATTACH_INGREDIENT_IMAGES (0–3 via UI)
→ FILL_PROMPT
→ CLICK_GENERATE
→ WAIT_FOR_COMPLETE
→ DOWNLOAD_OUTPUTS
→ MARK_DONE / MARK_FAILED
→ NEXT
```

### Resume After Refresh
Queue progress is persisted in `chrome.storage.local`. If you refresh the page or restart Chrome, the extension can resume from where it left off.

---

## Download Naming Convention

Auto-downloaded files follow this pattern:

```
AUTOFLOW1/prompt_001_gen_01.mp4
AUTOFLOW1/prompt_001_gen_02.mp4
AUTOFLOW1/prompt_002_gen_01.mp4
...
```

Library downloads:
```
LIBRARY/project/video_001.mp4
LIBRARY/project/video_002.mp4
```

---

## Error Handling

| Error Type | Behavior |
|---|---|
| Rate limit / "too quickly" | Wait + retry with exponential backoff |
| Policy error | Mark failed, skip (or stop if `stopOnError` is on) |
| Network timeout | Retry up to 2 times |
| Image attach failed | Pause + prompt for manual intervention |
| Generation timeout (10 min) | Mark failed |

---

## Limitations & Troubleshooting

### Known Limitations
1. **UI Selectors**: Google Flow's UI may change without notice. If automation breaks, selectors in `src/content/selectors.ts` may need updating.
2. **Image Upload**: Browser security may prevent programmatic file uploads. If so, AutoFlow will pause and ask you to attach images manually.
3. **"Ask where to save"**: If Chrome is set to ask for a download location, auto-download won't work silently. Disable it in Chrome Settings → Downloads → uncheck "Ask where to save each file before downloading".
4. **Single Tab**: AutoFlow works with one Flow tab at a time.
5. **Concurrency**: Strictly sequential (1 prompt at a time) to respect Flow's queue.

### Troubleshooting
- **Extension not connecting**: Make sure you're on `labs.google/flow`. Refresh the page.
- **Side panel not showing**: Click the extension icon in Chrome toolbar. Make sure the extension is enabled.
- **Automation not clicking buttons**: Flow UI may have changed. Check the Logs in the Run Monitor for clues. Report an issue.
- **Models not loading**: Click "Refresh from Flow" in Settings. A Flow tab must be open with a project.

---

## Development

```bash
# Watch mode (rebuild on file changes)
npm run dev

# Run tests
npm test
```

### Project Structure
```
autoflow/
├── manifest.json              # Chrome MV3 manifest
├── sidepanel.html             # Side panel HTML
├── package.json               # Dependencies & scripts
├── tsconfig.json              # TypeScript config
├── webpack.config.js          # Build config
├── jest.config.js             # Test config
├── icons/                     # Extension icons (optional)
├── src/
│   ├── types/index.ts         # Shared type definitions
│   ├── shared/
│   │   ├── parser.ts          # Prompt parsing (blank-line split)
│   │   ├── storage.ts         # chrome.storage.local + IndexedDB
│   │   ├── constants.ts       # Config constants
│   │   └── crypto.ts          # SHA-256 helper
│   ├── background/
│   │   └── service-worker.ts  # MV3 background (downloads, routing)
│   ├── content/
│   │   ├── index.ts           # Content script entry
│   │   ├── automation.ts      # State machine automation engine
│   │   ├── selectors.ts       # Robust DOM selectors for Flow UI
│   │   └── scanner.ts         # Library asset scanner
│   ├── sidepanel/
│   │   ├── index.ts           # Side panel logic (all tabs)
│   │   └── styles.css         # Dark theme styles
│   └── tests/
│       ├── parser.test.ts     # Prompt parsing tests
│       ├── queue.test.ts      # Queue logic tests
│       └── storage.test.ts    # Storage tests
└── dist/                      # Build output (load this in Chrome)
```

---

## License

MIT

---

**Third-party automation tool. Not affiliated with Google. Automates your interactions with Flow in your browser session.**
