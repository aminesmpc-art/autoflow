# 📖 MEMORY.md — AutoFlow Project

> **Last updated**: March 2026
> Complete developer reference for the AutoFlow project: Chrome Extension + Django Backend + Next.js Website.

---

## ⚡ START HERE — Quick Reference

### 🌐 Domains & Services

| Service         | Domain                 | Hosted On | Repo                           |
| --------------- | ---------------------- | --------- | ------------------------------ |
| **Backend API** | `api.auto-flow.studio` | Railway   | `autoflow-backend` (separate!) |
| **Website**     | `www.auto-flow.studio` | Vercel    | `autoflow` → `website/`        |
| **Extension**   | Chrome Web Store       | —         | `autoflow` → `src/`            |

### 🚨 #1 Rule: Backend = TWO Repos

```
📦 autoflow (main repo)         → Has everything (extension + backend + website)
📦 autoflow-backend (separate)  → Backend only — Railway watches THIS one
```

**Deploy backend changes:**

```bash
git add -A && git commit -m "message" && git push origin main
git subtree push --prefix=backend https://github.com/aminesmpc-art/autoflow-backend.git main
```

**Deploy website:**

```bash
cd website && npx vercel --prod
```

**Build extension:**

```bash
npm run build   # → dist/ folder → upload to Chrome Web Store
```

### ⚠️ Top 3 Gotchas

1. **Dual repo** — Push to `autoflow-backend` repo for Railway to deploy. `autoflow` alone won't trigger it.
2. **No bash on Railway** — Windows CRLF breaks bash. Use `python start.py`, never `bash start.sh`.
3. **Port mismatch** — Railway Service Port (Settings → Networking) must match gunicorn port (`8000`).

---

## 📋 Table of Contents

### 🔧 Infrastructure & Deployment

- [Backend — Django REST API](#backend--django-rest-api)
- [Website — Next.js Landing Page](#website--nextjs-landing-page)
- [Full Project Structure](#full-project-structure)
- [Deployment Commands Cheatsheet](#deployment-commands-cheatsheet)
- [Critical Gotchas & Lessons Learned](#️-critical-gotchas--lessons-learned)

### 🧩 Chrome Extension (detailed)

1. [Overview](#overview)
2. [Tech Stack](#tech-stack)
3. [Project Structure](#project-structure)
4. [Architecture & Message Flow](#architecture--message-flow)
5. [Entry Points](#entry-points)
6. [Types & Enums](#types--enums)
7. [Shared Utilities](#shared-utilities)
8. [Background Service Worker](#background-service-worker)
9. [Content Script — Entry](#content-script--entry)
10. [Content Script — AutomationEngine](#content-script--automationengine)
11. [Content Script — Selectors](#content-script--selectors)
12. [Content Script — Scanner](#content-script--scanner)
13. [Side Panel — UI](#side-panel--ui)
14. [Side Panel — Styles](#side-panel--styles)
15. [Side Panel — HTML](#side-panel--html)
16. [Storage Layer](#storage-layer)
17. [Automation State Machine](#automation-state-machine)
18. [DOM Interaction Strategies](#dom-interaction-strategies)
19. [Frame Chain Feature](#frame-chain-feature)
20. [Build & Development](#build--development)
21. [Key Constants](#key-constants)
22. [Available Models](#available-models)
23. [Known Patterns & Gotchas](#known-patterns--gotchas)

---

## Overview

**AutoFlow** is a Chrome Extension (Manifest V3) that automates prompt-based generation on **Google Flow** (`labs.google/flow` / `labs.google/fx`). It provides a side panel UI where users can:

- Write/paste multiple prompts (separated by blank lines)
- Attach images per-prompt (ingredients or Start/End frames)
- Configure generation settings (model, media type, orientation, etc.)
- Queue prompts and run them automatically one-by-one
- Monitor progress with real-time logs
- Download generated outputs (images/videos)
- Scan the project library, preview, and batch-download assets
- Retry failed generations

The extension manipulates Google Flow's React/Radix UI DOM through simulated user interactions (click chains, file input injection, Slate.js editor events).

---

## Tech Stack

| Layer       | Technology                                     |
| ----------- | ---------------------------------------------- |
| Language    | TypeScript (strict)                            |
| Build       | Webpack 5 + ts-loader                          |
| CSS         | Vanilla CSS (custom properties, glassmorphism) |
| Extension   | Chrome Manifest V3                             |
| Target Site | Google Flow (React + Radix UI + Slate.js)      |
| Storage     | `chrome.storage.local` + IndexedDB             |
| Tests       | Jest + ts-jest                                 |

---

## Project Structure

```
autoflow/
├── manifest.json          # Chrome MV3 manifest
├── package.json           # Dependencies & scripts
├── webpack.config.js      # 3 entry points → dist/
├── tsconfig.json          # TypeScript config (ES2020, strict)
├── jest.config.js         # Jest config (ts-jest)
├── sidepanel.html         # Side panel UI (4 tabs)
├── README.md              # User-facing readme
├── MEMORY.md              # THIS FILE — developer documentation
├── icons/                 # Extension icons (16/48/128)
├── dist/                  # Build output (gitignored)
└── src/
    ├── types/
    │   └── index.ts       # All shared types, enums, constants (222 lines)
    ├── shared/
    │   ├── constants.ts   # Numeric limits & timeouts
    │   ├── crypto.ts      # sha256() via Web Crypto API
    │   ├── parser.ts      # Prompt parsing & validation
    │   └── storage.ts     # chrome.storage.local + IndexedDB wrappers (~200 lines)
    ├── background/
    │   └── service-worker.ts  # Message router, tab management (313 lines)
    ├── content/
    │   ├── index.ts       # Content script entry, message handler (273 lines)
    │   ├── automation.ts  # AutomationEngine — core state machine (2128 lines)
    │   ├── selectors.ts   # DOM queries, click simulation, React triggers (1508 lines)
    │   └── scanner.ts     # Library scanning & asset downloading (405 lines)
    ├── sidepanel/
    │   ├── index.ts       # Side panel app logic (1882 lines)
    │   └── styles.css     # Dark theme styles (1452 lines)
    └── tests/
        ├── parser.test.ts
        ├── queue.test.ts
        └── storage.test.ts
```

---

## Architecture & Message Flow

```
┌─────────────────┐      chrome.runtime        ┌──────────────────┐
│   Side Panel     │ ◄──── .onMessage ────────► │  Background SW   │
│  (sidepanel.html │       .sendMessage         │ (service-worker) │
│   + index.ts)    │                            │                  │
└────────┬────────┘                            └───────┬──────────┘
         │                                              │
         │  IndexedDB (image blobs)              chrome.tabs
         │  chrome.storage.local                 .sendMessage
         │                                              │
         │                                     ┌────────▼─────────┐
         │  ◄── relay image blobs ──►          │  Content Script   │
         │                                     │ (content/index.ts)│
         │                                     │                  │
         │                                     │ AutomationEngine │
         │                                     │ Scanner          │
         │                                     │ Selectors        │
         └─────────────────────────────────────┴──────────────────┘
                        Google Flow Tab DOM
```

### Message Types (27 total)

Defined in `MessageType` enum:

| Message                | Direction         | Purpose                               |
| ---------------------- | ----------------- | ------------------------------------- |
| `START_QUEUE`          | BG → Content      | Begin processing a queue              |
| `STOP_QUEUE`           | BG → Content      | Abort current queue                   |
| `PAUSE_QUEUE`          | BG → Content      | Pause automation                      |
| `RESUME_QUEUE`         | BG → Content      | Resume paused automation              |
| `SKIP_CURRENT`         | BG → Content      | Skip current prompt                   |
| `RETRY_FAILED`         | BG → Content      | Retry failed generations              |
| `LOG`                  | Content → BG → SP | Log line for monitor                  |
| `QUEUE_STATUS_UPDATE`  | Content → BG → SP | Queue-level progress                  |
| `PROMPT_STATUS_UPDATE` | Content → BG → SP | Per-prompt status                     |
| `DOWNLOAD`             | Content → BG      | Trigger file download                 |
| `QUEUE_COMPLETE`       | Content → BG      | Queue finished                        |
| `QUEUE_SUMMARY`        | Content → BG → SP | Final summary with per-prompt results |
| `FAILED_TILES_RESULT`  | Content → BG → SP | List of failed tiles after scan       |
| `GET_IMAGE_BLOBS`      | Content → BG → SP | Request image data from IndexedDB     |
| `IMAGE_BLOBS_RESPONSE` | SP → BG → Content | Return base64 image data              |
| `RUN_LOCK_CHANGED`     | Content → BG → SP | Global run-lock state                 |
| `REFRESH_MODELS`       | BG → Content      | Read available models from Flow UI    |
| `MODELS_RESULT`        | Content → BG → SP | Return discovered models              |
| `SCAN_PROJECT`         | BG → Content      | Scan library for assets               |
| `SCAN_RESULT`          | Content → BG → SP | Return scanned assets                 |
| `PREVIEW_ASSET`        | BG → Content      | Open asset preview                    |
| `DOWNLOAD_SELECTED`    | BG → Content      | Download selected library assets      |
| `APPLY_SETTINGS`       | BG → Content      | Apply settings without queue          |
| `GET_FAILED_TILES`     | BG → Content      | Request failed tile info              |

---

## Entry Points

Webpack produces 3 bundles:

```js
// webpack.config.js
entry: {
  background:  './src/background/service-worker.ts',
  content:     './src/content/index.ts',
  sidepanel:   './src/sidepanel/index.ts',
}
```

Additional outputs:

- `styles.css` → extracted by `MiniCssExtractPlugin`
- `sidepanel.html`, `manifest.json`, `icons/` → copied by `CopyWebpackPlugin`

---

## Types & Enums

### `PromptEntry`

```ts
interface PromptEntry {
  id: string; // crypto.randomUUID()
  text: string; // Prompt text
  images: ImageMeta[]; // Attached images (ingredients or frames)
  status: "pending" | "running" | "done" | "failed" | "skipped";
  retries: number;
}
```

### `ImageMeta`

```ts
interface ImageMeta {
  name: string; // Original filename
  hash: string; // SHA-256 hex digest
  blobKey: string; // IndexedDB key: "img_{queueId}_{hash}"
  size: number;
  type: string; // MIME type
}
```

### `QueueObject`

```ts
interface QueueObject {
  id: string;
  name: string; // Auto-generated: "AUTOFLOW1", "AUTOFLOW2"...
  prompts: PromptEntry[];
  settings: QueueSettings;
  createdAt: number;
  status: "idle" | "running" | "paused" | "completed" | "cancelled";
  currentPromptIndex: number;
}
```

### `QueueSettings`

```ts
interface QueueSettings {
  mediaType: "video" | "image";
  creationType: "ingredients" | "frames";
  orientation: "landscape" | "portrait" | "square";
  model: string; // e.g., "Veo 2 Fast"
  generationsPerPrompt: number;
  delayBetweenPrompts: number; // seconds
  downloadAfterEach: boolean;
  downloadQuality: string; // "1080p", "4K", "720p"
  enableHumanizedTyping: boolean;
  typingSpeed: number; // chars/sec
  language: string; // UI language
  autoRetry: boolean;
}
```

### `CreationType` Enum

- `ingredients` — Attach up to 3 images as reference material
- `frames` — Attach Start frame and End frame (for video generation)

### `AutomationState` Enum (17 states)

```
IDLE → APPLYING_SETTINGS → STARTING_PROMPT → ATTACHING_IMAGES →
FILLING_PROMPT → CLICKING_GENERATE → WAITING_TILE_APPEAR →
WAITING_COMPLETION → DOWNLOADING → PROMPT_COMPLETE →
PROMPT_FAILED → RETRYING → PAUSED → STOPPING →
QUEUE_COMPLETE → POST_SCAN → ERROR
```

### `MediaType` Enum

- `video`, `image`

### `Orientation` Enum

- `landscape`, `portrait`, `square`

---

## Shared Utilities

### `constants.ts`

```ts
MAX_IMAGES_PER_PROMPT = 3;
MAX_RETRIES = 2;
GENERATION_TIMEOUT_MS = 600_000; // 10 minutes
POLL_INTERVAL_MS = 2000; // 2 seconds
IMAGE_ATTACH_MAX_RETRIES = 3;
```

### `crypto.ts`

- `sha256(buffer: ArrayBuffer): Promise<string>` — Returns hex digest via `crypto.subtle.digest`

### `parser.ts`

- `parsePrompts(text: string): string[]` — Splits by double newline, trims, filters empty
- `validatePrompts(prompts: string[]): { valid: boolean; errors: string[] }` — Checks minimum length

### `storage.ts`

Chrome storage wrappers:

- `getQueues()`, `saveQueue()`, `deleteQueue()`, `getQueueById()`
- `getSettings()`, `saveSettings()`
- `getLogs()`, `appendLog()`, `clearLogs()`
- `getActiveQueueId()`, `setActiveQueueId()`, `clearActiveQueueId()`
- `getQueueCounter()`, `incrementQueueCounter()` — for auto-naming

IndexedDB wrappers (database: `autoflow_images`, store: `blobs`):

- `saveImageBlob(key, blob)` — Stores image as Blob
- `getImageBlob(key): Blob | null`
- `deleteImageBlob(key)`
- `clearAllImageBlobs()`

---

## Background Service Worker

**File**: `src/background/service-worker.ts` (313 lines)

### Responsibilities:

1. **Open side panel** on extension icon click (`chrome.action.onClicked`)
2. **Message routing** — Central hub between side panel and content script
3. **Tab management** — Find or create Google Flow tab for automation
4. **Download handling** — `chrome.downloads.download()` for generated outputs
5. **Image blob relay** — Bridges IndexedDB access (side panel) ↔ content script

### Key Functions:

#### `startQueueInTab(queue)`

1. Finds existing Flow tab or creates new one at `https://labs.google/fx/tools/video-fx`
2. Ensures tab is active and loaded
3. Injects content script via `chrome.scripting.executeScript` if needed
4. Sends `START_QUEUE` message to content script

#### `forwardToContentScript(message)`

- Routes messages to the active Flow tab
- Auto-re-injects content script on delivery failure (one retry)

#### Image Blob Relay Flow:

```
Content Script: "I need images for prompt X"
    → GET_IMAGE_BLOBS → Background → Side Panel
Side Panel: reads from IndexedDB, converts to base64
    → IMAGE_BLOBS_RESPONSE → Background → Content Script
```

---

## Content Script — Entry

**File**: `src/content/index.ts` (273 lines)

### Responsibilities:

- Message handler routing to `AutomationEngine` and scanner functions
- Re-injection safe (removes old listener, re-registers with unique ID `af-bot-*`)
- Library download coordination
- Model refresh

### `downloadSelected(assets, projectName)`

- Downloads selected library assets with structured filenames
- Pattern: `LIBRARY/{projectName}/{index}_{slug}.{ext}`
- Slug derived from prompt label (sanitized, 40-char max)

### `refreshModels()`

- Opens the model dropdown in Flow UI
- Reads menu item text content
- Closes dropdown, returns model list

---

## Content Script — AutomationEngine

**File**: `src/content/automation.ts` (2128 lines) — **THE CORE**

### Class: `AutomationEngine`

Single instance created per content script injection. Manages the entire automation lifecycle.

### State Machine Flow:

```
start()
  ├── applyAllSettings()          // APPLYING_SETTINGS
  │     ├── Open settings panel (Radix dropdown)
  │     ├── Click media type (Video/Image)
  │     ├── Click creation type (Ingredients/Frames)
  │     ├── Click orientation
  │     ├── Click model
  │     ├── Set generations count
  │     └── Enable "Clear prompt on submit"
  │
  ├── FOR EACH prompt:
  │     ├── processPrompt()       // STARTING_PROMPT
  │     │     ├── attachImages()  // ATTACHING_IMAGES
  │     │     │     ├── Ingredients mode: attachIngredientImages()
  │     │     │     │     ├── Click "+" button (aria-haspopup="dialog")
  │     │     │     │     ├── Find "Upload" button in dialog
  │     │     │     │     ├── Inject file input, set files via DataTransfer
  │     │     │     │     ├── Trigger React onChange
  │     │     │     │     └── Wait for ingredient chips to appear
  │     │     │     │
  │     │     │     └── Frames mode: attachFrameImages()
  │     │     │           ├── Click Start frame button → dialog → upload
  │     │     │           └── Click End frame button → dialog → upload
  │     │     │
  │     │     ├── fillPrompt()    // FILLING_PROMPT
  │     │     │     ├── Find Slate.js editor (data-slate-editor)
  │     │     │     ├── Clear existing content
  │     │     │     ├── Paste (execCommand) or simulate typing
  │     │     │     └── Humanized typing: char-by-char with variable delay
  │     │     │
  │     │     ├── clickGenerate() // CLICKING_GENERATE
  │     │     │     ├── Strategy 1: simulateClick (full pointer chain)
  │     │     │     ├── Strategy 2: native .click()
  │     │     │     ├── Strategy 3: React onPointerDown
  │     │     │     ├── Strategy 4: React onClick
  │     │     │     └── Strategy 5: Enter key on prompt
  │     │     │
  │     │     ├── waitForCompletion() // WAITING_COMPLETION
  │     │     │     ├── Poll every POLL_INTERVAL_MS (2s)
  │     │     │     ├── Detect tile state changes (blur/progress/spinner)
  │     │     │     ├── Timeout after GENERATION_TIMEOUT_MS (10min)
  │     │     │     └── Track new tile IDs for download
  │     │     │
  │     │     └── downloadOutputs()   // DOWNLOADING (if enabled)
  │     │           ├── Right-click context menu → quality option
  │     │           └── Fallback: navigate to edit page
  │     │
  │     ├── On success → PROMPT_COMPLETE
  │     ├── On failure → retry up to MAX_RETRIES → PROMPT_FAILED
  │     └── delay(delayBetweenPrompts)
  │
  └── postQueueScan()              // POST_SCAN
        ├── Wait for all tiles to settle
        ├── Scroll through output grid
        ├── Map failures to prompt indices
        └── Send QUEUE_SUMMARY + FAILED_TILES_RESULT
```

### Image Attachment — Ingredients Mode (`attachIngredientImages`)

1. Find the "+" button (`aria-haspopup="dialog"`)
2. Click it to open the asset search dialog
3. Find the "Upload" button inside the dialog
4. Create a hidden `<input type="file">` with id `af-bot-file-input-{timestamp}`
5. Build a `DataTransfer` object with `File` objects (from base64 blobs)
6. Set the files on the input, trigger change via React fiber tree walk
7. Wait for ingredient chips to appear (up to `IMAGE_ATTACH_MAX_RETRIES`)

### Image Attachment — Frames Mode (`attachFrameImages`)

1. `images[0]` → Start frame, `images[1]` → End frame
2. For each: find the frame button via `findFrameButton("Start frame")` / `findFrameButton("End frame")`
3. Click to open dialog → find upload button → inject file input → trigger upload
4. Wait for confirmation (dialog closes or thumbnail appears)

### Generate Button Strategy (5 fallbacks):

1. `simulateClick()` — Full synthetic pointer→mouse→click event chain with coordinate jitter
2. `element.click()` — Native DOM click
3. `reactTrigger(el, 'onPointerDown')` — Invoke React handler directly via `__reactProps$`
4. `reactTrigger(el, 'onClick')` — Invoke React onClick handler directly
5. `Enter` key on prompt input — KeyboardEvent dispatch

### Tile Completion Detection (multi-signal):

- CSS `filter: blur()` amount (generating tiles have blur)
- Progress bar percentage text
- Spinner icon presence (`progress_activity`)
- Error icon/text (`error`, `warning`)
- Play button overlay (video completed)
- `<video>` or `<img>` src populated
- Tile opacity changes
- Empty tile detection

### Download Strategy:

1. **Context menu**: Right-click tile → find quality menu item → click
2. **Edit page fallback**: Navigate to asset edit page → find download button

### Control Methods:

- `pause()` / `resume()` — Sets/clears PAUSED state
- `stop()` — Sets STOPPING flag, breaks out of current operation
- `skipCurrent()` — Marks current prompt as skipped, moves to next
- `retryFailed()` — Re-queues failed prompts for processing

### Post-Queue Scan (`postQueueScan`):

1. Waits for all generating tiles to settle (polls with timeout)
2. Scrolls through entire virtualized output grid
3. Collects tile states from all visible and off-screen tiles
4. Maps tile positions to prompt indices via visual order
5. Sends `QUEUE_SUMMARY` with per-prompt success/failure counts
6. Sends `FAILED_TILES_RESULT` with error details

### Global Run Lock:

- Uses `chrome.storage.local` key to prevent concurrent queue execution
- Broadcasts `RUN_LOCK_CHANGED` when lock is acquired/released
- Side panel disables Run buttons when lock is active

---

## Content Script — Selectors

**File**: `src/content/selectors.ts` (1508 lines)

### Purpose:

All DOM query helpers and interaction utilities. This is the **compatibility layer** between AutoFlow and Google Flow's UI.

### DOM Query Helpers:

| Function                            | Returns          | Purpose                                               |
| ----------------------------------- | ---------------- | ----------------------------------------------------- |
| `queryByAriaLabel(label)`           | Element          | Find by aria-label                                    |
| `queryByRoleAndText(role, text)`    | Element          | Find by role + text content                           |
| `queryButtonByText(text)`           | Element          | Find visible button by text                           |
| `findMenuItem(text)`                | Element          | Find menu item in Radix dropdown                      |
| `findPromptInput()`                 | Element          | Slate.js editor / contenteditable / textarea          |
| `findGenerateButton()`              | Element          | Generate button (arrow_forward icon)                  |
| `findFrameButton(label)`            | Element          | Start/End frame button                                |
| `findIngredientAttachButton()`      | Element          | "+" button for ingredients                            |
| `findAssetSearchDialog()`           | Element          | Radix dialog with "Search for Assets"                 |
| `findFileInput()`                   | Element          | Flow's native file input (skips af-bot injected ones) |
| `findSettingsPanelTrigger()`        | Element          | Settings chip button                                  |
| `findModeButton(name)`              | Element          | Menu item in settings dropdown                        |
| `findIngredientChips()`             | Element[]        | Attached ingredient thumbnails                        |
| `findPromptComposer()`              | Element          | Prompt area container                                 |
| `findAssetCards()`                  | Element[]        | Output tile cards                                     |
| `findAllFailedTiles()`              | FailedTileInfo[] | Failed tiles with error text                          |
| `findRetryButtonOnTile(tile)`       | Element          | Retry button on failed tile                           |
| `findReusePromptButtonOnTile(tile)` | Element          | Reuse prompt button                                   |

### Interaction Utilities:

#### `simulateClick(element)`

Full synthetic event chain mimicking real user click:

```
pointerdown → mousedown → pointerup → mouseup → click
```

- Calculates element center coordinates via `getBoundingClientRect()`
- Adds ±2px random jitter to coordinates
- Sets all event properties (bubbles, cancelable, button, clientX/Y, etc.)

#### `reactTrigger(element, handlerName)`

Invokes React internal event handler directly:

- Walks element's DOM properties looking for `__reactProps$*`
- Calls the specified handler (e.g., `onClick`, `onPointerDown`) with synthetic event
- Useful when simulated DOM events don't reach React's synthetic event system

#### `triggerFileInputChange(input)`

Triggers file input change for React-managed inputs:

1. Looks for `onChange` in `__reactProps$`
2. Walks React fiber tree to find the change handler
3. Falls back to native `change` + `input` events

#### `setInputValue(element, value)`

Sets value on various input types:

- **Slate.js editor**: Uses `beforeinput` event with `insertText` type + `execCommand`
- **Native input/textarea**: Uses React prototype setter + input event
- **Contenteditable**: Uses `execCommand('insertText')`

#### `simulateTyping(element, text, charsPerSecond, variableDelay)`

Character-by-character typing with realistic timing:

- For Slate.js: dispatches `beforeinput` per character
- For native inputs: uses prototype value setter per character
- Variable delay: ±30% random jitter on base delay

### Tile State Detection (`getTileState`):

Returns one of: `'generating' | 'completed' | 'failed' | 'empty'`

**10-signal detection system**:

1. CSS `filter: blur()` > 2px → generating
2. Progress percentage text → generating
3. Spinner icon (`progress_activity`) → generating
4. Error icon/text (`error`, `warning`, `Failed`) → failed
5. Play button overlay → completed (video)
6. `<video>` with src → completed
7. `<img>` with src (non-placeholder) → completed
8. Background image set → completed
9. Opacity < 0.5 → generating
10. No content indicators → empty

### `snapshotTiles()`

```ts
interface TileSnapshot {
  total: number;
  generating: number;
  completed: number;
  failed: number;
  empty: number;
  tileIds: string[];
}
```

### Scroll Utilities:

- `findOutputScroller()` — Finds virtuoso scroller or scrollable ancestor
- `scrollOutputToTop()` — Scrolls output grid to top
- `scrollAndCollectAllTileStates()` — Incremental scroll + collect from virtualized list
- `allTilesSettledWithScroll()` — Full scroll check for no generating tiles

---

## Content Script — Scanner

**File**: `src/content/scanner.ts` (405 lines)

### Purpose:

Scans the Google Flow project library for generated assets (videos/images).

### `scanProjectForVideos()`

1. Finds the virtuoso scroller in the library view
2. Scrolls incrementally through the entire list
3. Collects tiles by `data-tile-id`
4. Filters out user uploads (checks for filename extensions like .jpg/.png/.mp4)
5. Groups assets by prompt label and row index (`data-index`)
6. Returns `ScannedAsset[]` with thumbnails, prompt labels, media types

### `previewAsset(tileId)`

- Finds the tile element and clicks to open preview

### `downloadAssetByMenu(tileId, quality)`

- Right-clicks the tile or opens context menu
- Finds quality option (e.g., "1080p", "4K")
- Triggers download

---

## Side Panel — UI

**File**: `src/sidepanel/index.ts` (1882 lines)

### App State:

```ts
const state = {
  parsedPrompts: string[],
  promptImages: Map<number, ImageMeta[]>,  // per-prompt images
  sharedImages: ImageMeta[],               // applied to all prompts
  characterImages: { name: string, meta: ImageMeta }[],
  autoAddCharacters: boolean,
  scannedAssets: ScannedAsset[],
  isRunning: boolean,
}
```

### 4 Tabs:

#### 1. Create Tab

- **Prompt Textarea**: User writes prompts separated by blank lines
- **Parse Button**: Calls `reparsePrompts()` → splits text, updates UI
- **Shared Images Section**: Attach images applied to ALL prompts
- **Character Images Section**: Named reference images auto-matched to prompts by filename
- **Automap Section**: Auto-assign images to prompts by matching filenames
- **Frame Chain Section** _(NEW)_: Select multiple images → auto-create overlapping Start/End frame pairs
- **Prompt List**: Shows parsed prompts with per-prompt image management
- **Add to Queue Button**: Creates `QueueObject` and saves to storage
- **Run Monitor**: Shows progress, logs, pause/resume/stop/skip controls
- **Failed Generations Section**: Shows failed prompts with retry options

#### 2. Settings Tab

Configures `QueueSettings`:

- Media type (Video/Image)
- Creation type (Ingredients/Frames)
- Model selection (dropdown)
- Orientation (Landscape/Portrait/Square)
- Generations per prompt (slider)
- Timing (delay between prompts, range)
- Download settings (auto-download, quality)
- Language selection
- Humanized typing toggle + speed

#### 3. Queues Tab

- Lists saved queues with status badges
- Run / Delete / Reorder queues
- Shows prompt count and creation date per queue

#### 4. Library Tab

- **Scan Button**: Triggers project scan via content script
- **Filter Pills**: All / Photos / Videos
- **Sort**: Newest / Oldest
- **Asset Grid**: Grouped by prompt, with thumbnails
- **Select & Download**: Multi-select assets, batch download
- **Preview**: Click to preview in Flow

### Key Functions:

#### `reparsePrompts()`

- Reads textarea value, splits by `\n\n`
- Trims each prompt, filters empties
- Updates `state.parsedPrompts`
- Calls `renderPromptList()`

#### `renderPromptList()`

- Creates DOM rows for each prompt
- Shows image thumbnails (per-prompt + auto-matched + shared)
- Badges: "CHAR" (yellow) for character matches, "SHARED" (indigo) for shared images
- Shows/hides image attachment sections based on creation type

#### `addToQueue()`

1. Validates prompts exist
2. For each prompt: merges per-prompt images + auto-matched character images + shared images
3. Deduplicates by SHA-256 hash
4. Creates `QueueObject` with auto-generated name
5. Saves queue and image blobs to storage
6. Sends `START_QUEUE` or just saves (depending on user action)

#### `frameChainImagesToPrompts()` _(NEW)_

- Takes N selected images
- Creates N-1 prompts (minimum 2 images needed)
- Prompt[i] gets `images[i]` as Start frame + `images[i+1]` as End frame
- Auto-sets creation type to "frames" in settings
- Updates prompt textarea with placeholder text

#### Character Auto-Match (`getAutoMatchedImages`)

- Parses character image filenames (strips extension, splits on `_-`)
- Checks if any character name appears in prompt text (case-insensitive)
- Returns matching character images for each prompt

### Message Handling:

- `LOG` → Appends to monitor log display
- `QUEUE_STATUS_UPDATE` → Updates progress bar, status text
- `PROMPT_STATUS_UPDATE` → Updates per-prompt status indicators
- `GET_IMAGE_BLOBS` → Reads from IndexedDB, converts to base64, returns
- `RUN_LOCK_CHANGED` → Enables/disables run buttons
- `QUEUE_SUMMARY` → Shows completion summary
- `FAILED_TILES_RESULT` → Populates failed generations section

---

## Side Panel — Styles

**File**: `src/sidepanel/styles.css` (1452 lines)

### Design System:

- **Theme**: Dark mode with glassmorphism
- **Colors**: CSS custom properties (`--bg-primary: #0a0a0f`, `--accent: #6366f1` indigo)
- **Gradients**: Indigo → Violet (`--gradient: linear-gradient(135deg, #6366f1, #8b5cf6)`)
- **Effects**: `backdrop-filter: blur()`, box shadows with glow
- **Typography**: System font stack + monospace for logs
- **Border radius**: 4px (xs) → 8px (sm) → 12px (default) → 9999px (pill)

### Component Classes (prefix: `af-`):

- `.af-container` — Main panel container
- `.af-tabs` / `.af-tab` — Tab navigation
- `.af-section` / `.af-card` — Content sections
- `.af-btn` / `.af-btn-primary` / `.af-btn-sm` — Buttons
- `.af-textarea` — Prompt input
- `.af-prompt-row` — Prompt list items
- `.af-thumb-*` — Image thumbnails
- `.af-monitor` — Run monitor with pulse animation
- `.af-queue-card` — Queue list items
- `.af-lib-*` — Library grid components
- `.af-toast` — Toast notifications
- `.af-framechain-*` — Frame Chain feature UI

---

## Side Panel — HTML

**File**: `sidepanel.html` (514+ lines)

### Structure:

```html
<div class="af-container">
  <!-- Tab navigation -->
  <div class="af-tabs">
    <button data-tab="create">Create</button>
    <button data-tab="settings">Settings</button>
    <button data-tab="queues">Queues</button>
    <button data-tab="library">Library</button>
  </div>

  <!-- Create Tab -->
  <div id="tab-create">
    <textarea id="prompt-input">          <!-- Prompt textarea -->
    <button id="parse-btn">               <!-- Parse prompts -->
    <div id="shared-images-section">      <!-- Shared images -->
    <div id="character-section">          <!-- Character images -->
    <div id="automap-section">            <!-- Auto-map images -->
    <div id="framechain-section">         <!-- Frame Chain (NEW) -->
    <div id="prompt-list">                <!-- Parsed prompt rows -->
    <button id="add-queue-btn">           <!-- Add to queue -->
    <div id="run-monitor">                <!-- Progress monitor -->
    <div id="failed-section">             <!-- Failed generations -->
  </div>

  <!-- Settings Tab -->
  <div id="tab-settings">
    <!-- Media type, creation type, model, orientation, etc. -->
  </div>

  <!-- Queues Tab -->
  <div id="tab-queues">
    <div id="queue-list">                 <!-- Queue cards -->
  </div>

  <!-- Library Tab -->
  <div id="tab-library">
    <!-- Scan, filter, sort, asset grid, download -->
  </div>
</div>
```

---

## Storage Layer

### chrome.storage.local Keys:

| Key             | Type            | Purpose                         |
| --------------- | --------------- | ------------------------------- |
| `queues`        | `QueueObject[]` | All saved queues                |
| `settings`      | `QueueSettings` | User preferences                |
| `logs`          | `LogEntry[]`    | Automation logs                 |
| `activeQueueId` | `string`        | Currently running queue         |
| `queueCounter`  | `number`        | Auto-increment for queue naming |
| `runLock`       | `boolean`       | Global run-lock flag            |

### IndexedDB:

- **Database**: `autoflow_images` (version 1)
- **Object Store**: `blobs`
- **Key format**: `img_{queueId}_{sha256Hash}`
- **Value**: `Blob` (original image file)

### Why both storage systems?

- `chrome.storage.local` has a ~10MB limit and is ideal for JSON metadata
- IndexedDB handles large binary blobs (images) without size constraints
- Side panel has direct IndexedDB access; content script gets blobs relayed via base64

---

## Automation State Machine

```
                    ┌─────────────────────┐
                    │        IDLE         │
                    └──────────┬──────────┘
                               │ start()
                    ┌──────────▼──────────┐
                    │  APPLYING_SETTINGS   │
                    └──────────┬──────────┘
                               │
                    ┌──────────▼──────────┐
              ┌────►│  STARTING_PROMPT    │◄──── retryFailed()
              │     └──────────┬──────────┘
              │                │
              │     ┌──────────▼──────────┐
              │     │  ATTACHING_IMAGES    │
              │     └──────────┬──────────┘
              │                │
              │     ┌──────────▼──────────┐
              │     │  FILLING_PROMPT      │
              │     └──────────┬──────────┘
              │                │
              │     ┌──────────▼──────────┐
              │     │  CLICKING_GENERATE   │
              │     └──────────┬──────────┘
              │                │
              │     ┌──────────▼──────────┐
              │     │ WAITING_TILE_APPEAR  │
              │     └──────────┬──────────┘
              │                │
              │     ┌──────────▼──────────┐
              │     │ WAITING_COMPLETION   │
              │     └──────────┬──────────┘
              │           │         │
              │     ┌─────▼───┐  ┌──▼────────┐
              │     │DOWNLOAD │  │PROMPT_FAIL │──► RETRYING ──┐
              │     └────┬────┘  └────────────┘               │
              │          │                                     │
              │     ┌────▼────────┐                           │
              │     │PROMPT_DONE  │◄──────────────────────────┘
              │     └──────┬──────┘
              │            │ (more prompts?)
              └────────────┘ YES
                           │ NO
                    ┌──────▼──────────┐
                    │   POST_SCAN     │
                    └──────┬──────────┘
                           │
                    ┌──────▼──────────┐
                    │ QUEUE_COMPLETE   │
                    └─────────────────┘

  ── At any point ──
  pause()  → PAUSED (resumes to previous state)
  stop()   → STOPPING → IDLE
  skip()   → PROMPT_COMPLETE (moves to next)
```

---

## DOM Interaction Strategies

Google Flow uses **React 18+ with Radix UI** components. AutoFlow must work around React's synthetic event system and virtualized rendering.

### Strategy 1: Simulated DOM Events

```ts
simulateClick(element);
// pointerdown → mousedown → pointerup → mouseup → click
// with getBoundingClientRect() coordinates + ±2px jitter
```

Best for: Most buttons, menu items, tiles.

### Strategy 2: React Props Invocation

```ts
reactTrigger(element, "onClick");
// Walks __reactProps$ to find and invoke handler directly
```

Best for: Buttons where simulated events don't propagate through React's synthetic system.

### Strategy 3: File Input Injection

```ts
// Create hidden <input type="file" id="af-bot-file-input-{timestamp}">
// Build DataTransfer with File objects
// Set input.files = dataTransfer.files
// Trigger via React fiber tree walk or native events
```

Best for: Image uploads (Flow's file input is deeply React-controlled).

### Strategy 4: Slate.js Editor Interaction

```ts
// For paste:
document.execCommand("insertText", false, text);
// For typing:
new InputEvent("beforeinput", { inputType: "insertText", data: char });
```

Best for: Prompt text entry into Flow's Slate.js rich text editor.

### Strategy 5: Radix UI Menu Navigation

```ts
// Click trigger button (aria-haspopup="menu")
// Wait for [role="menu"] to appear
// Find menuitem by text
// simulateClick(menuitem)
```

Best for: Settings panel, model selection, quality options.

---

## Frame Chain Feature

### Purpose:

Allows users to select N images and automatically create N-1 prompts where each consecutive pair shares a frame:

- Prompt 1: Image 1 (Start) → Image 2 (End)
- Prompt 2: Image 2 (Start) → Image 3 (End)
- Prompt 3: Image 3 (Start) → Image 4 (End)
- ...

### UI Location:

Create tab → between Automap section and Prompt list

### HTML Elements:

- `#framechain-section` — Container (hidden unless creation type = frames)
- `#framechain-btn` — "Select images in order" button
- `#framechain-file` — Hidden file input (multiple, accept=image/\*)
- `#framechain-preview` — Preview container

### Logic (`frameChainImagesToPrompts()`):

1. User selects N image files
2. Extension reads files as ArrayBuffer, computes SHA-256 hash
3. Stores blobs in IndexedDB
4. Creates N-1 entries in `state.promptImages` map
5. Each entry: `[images[i], images[i+1]]`
6. Auto-generates prompt placeholder text in textarea
7. Renders visual preview showing the chain with → arrows
8. Forces `creationType` to `frames` in settings

### Preview Rendering:

Shows a visual chain:

```
[Image1] → [Image2] → [Image3] → [Image4]
Prompt 1    Prompt 2    Prompt 3
```

---

## Build & Development

### Scripts (package.json):

```json
{
  "build:dev": "webpack --mode development --devtool source-map",
  "build:watch": "webpack --watch --mode development --devtool source-map",
  "build:prod": "webpack --mode production",
  "test": "jest"
}
```

### Webpack Config:

- 3 entry points: `background`, `content`, `sidepanel`
- Output to `dist/` with `[name].js` naming
- `MiniCssExtractPlugin` → `styles.css`
- `CopyWebpackPlugin` → copies `sidepanel.html`, `manifest.json`, `icons/`
- Target: `web` (not `node`)
- Devtool: `source-map` (dev), `false` (prod)

### TypeScript Config:

- Target: `ES2020`
- Module: `ES2020`
- Strict mode enabled
- DOM + DOM.Iterable libs
- Output to `dist/`

### Loading the Extension:

1. `npm run build:dev` or `npm run build:watch`
2. Chrome → `chrome://extensions` → Enable Developer Mode
3. "Load unpacked" → select `dist/` folder
4. Navigate to `https://labs.google/flow`
5. Click extension icon to open side panel

---

## Key Constants

```ts
// Limits
MAX_IMAGES_PER_PROMPT = 3;
MAX_RETRIES = 2;

// Timing
GENERATION_TIMEOUT_MS = 600_000; // 10 minutes per prompt
POLL_INTERVAL_MS = 2_000; // Check tile state every 2s
IMAGE_ATTACH_MAX_RETRIES = 3; // Retry image upload

// Default Settings
DEFAULT_SETTINGS = {
  mediaType: "video",
  creationType: "ingredients",
  orientation: "landscape",
  model: "", // auto-detect
  generationsPerPrompt: 1,
  delayBetweenPrompts: 5,
  downloadAfterEach: false,
  downloadQuality: "1080p",
  enableHumanizedTyping: false,
  typingSpeed: 10,
  language: "en",
  autoRetry: true,
};
```

---

## Available Models

```ts
AVAILABLE_MODELS = [
  "Veo 3.1 Fast",
  "Veo 3.1 Quality",
  "Veo 2 Fast",
  "Veo 2 Quality",
];
```

These can also be dynamically discovered via `refreshModels()`.

---

## Known Patterns & Gotchas

### 1. Re-injection Safety

Content script can be injected multiple times (e.g., on navigation or retry). Each injection:

- Generates a unique bot ID: `af-bot-{randomHex}`
- Removes the previous message listener
- Re-registers with the new listener
- File inputs are namespaced with bot ID to avoid conflicts

### 2. Virtualized Output Grid

Google Flow uses `react-virtuoso` for the output tile grid. Off-screen tiles are **not in the DOM**. The scanner and post-queue scan must scroll incrementally to discover all tiles.

### 3. React Event System

Simulated DOM events sometimes don't trigger React handlers. The extension uses a multi-strategy approach:

- Try simulated events first (most natural)
- Fall back to `__reactProps$` direct invocation
- Final fallback: keyboard events (Enter key)

### 4. Slate.js Editor

Flow's prompt input is a Slate.js rich text editor, not a regular `<textarea>`. Writing to it requires:

- `beforeinput` event with `inputType: 'insertText'`
- `document.execCommand('insertText')` for paste
- Selection API for clearing content

### 5. Dynamic Class Names

Flow uses CSS modules with hashed class names (e.g., `sc-21faa80e-0`). Selectors avoid relying on these and instead use:

- `aria-label`, `role`, `data-*` attributes
- Google Material Symbols icon text content
- Structural relationships (parent/child traversal)
- Text content matching

### 6. Image Blob Relay

Content scripts cannot access IndexedDB from the extension's origin. The relay chain is:

```
Content Script → GET_IMAGE_BLOBS → Background → Side Panel (reads IndexedDB)
Side Panel → IMAGE_BLOBS_RESPONSE (base64) → Background → Content Script
Content Script converts base64 back to File objects
```

### 7. Settings Panel

Flow's settings UI is a **Radix dropdown menu**, not a tab panel. The extension:

1. Clicks the settings trigger chip
2. Waits for `[role="menu"]` to appear
3. Finds menu items by text
4. Clicks each setting, waiting for menu to re-render between clicks

### 8. Download Quality Selection

When downloading generated assets, Flow offers quality options via a context menu. The extension:

1. Right-clicks the tile to open context menu
2. Looks for quality text (e.g., "1080p", "4K")
3. If not found, navigates to the asset's edit page as fallback

### 9. Global Run Lock

Only one queue can run at a time across all tabs. The lock is stored in `chrome.storage.local` and broadcast via `RUN_LOCK_CHANGED` messages. This prevents:

- Multiple content scripts running automation simultaneously
- Side panel starting a new queue while one is in progress

### 10. File Input Identification

Flow has its own file inputs. AutoFlow's injected file inputs are identified by the `af-bot-*` ID prefix. `findFileInput()` in selectors.ts explicitly skips elements with this prefix to find Flow's native input.

---

## Test Coverage

Tests are in `src/tests/`:

- `parser.test.ts` — Tests for prompt parsing and validation
- `queue.test.ts` — Tests for queue creation and management
- `storage.test.ts` — Tests for storage read/write operations

Run tests: `npm test`

---

_This document serves as the complete developer reference for the AutoFlow Chrome Extension. Update it when making significant architectural changes._

---

## Backend — Django REST API

> **Domain**: `api.auto-flow.studio`
> **Hosted on**: Railway (project: `secure-enthusiasm`)
> **Repository**: `https://github.com/aminesmpc-art/autoflow-backend` (SEPARATE from main repo!)

### ⚠️ CRITICAL: Dual Repository Setup

The backend code lives INSIDE the main `autoflow` repo at `backend/`, BUT Railway is connected to a **SEPARATE** repository called `autoflow-backend`. This means:

```
Main repo:     https://github.com/aminesmpc-art/autoflow.git      (everything)
Backend repo:  https://github.com/aminesmpc-art/autoflow-backend.git  (backend only — Railway watches this)
```

**To deploy backend changes to Railway, you MUST push to BOTH repos:**

```bash
# Step 1: Push to main repo (normal)
git add -A && git commit -m "your message" && git push origin main

# Step 2: Push backend/ to the separate backend repo
git subtree push --prefix=backend https://github.com/aminesmpc-art/autoflow-backend.git main

# If subtree push is rejected (history diverged), force push:
git subtree split --prefix=backend -b backend-deploy
git push https://github.com/aminesmpc-art/autoflow-backend.git backend-deploy:main --force
git branch -D backend-deploy
```

### Tech Stack

| Layer        | Technology                           |
| ------------ | ------------------------------------ |
| Framework    | Django 5 + Django REST Framework     |
| Auth         | JWT (SimpleJWT) + Email verification |
| Database     | PostgreSQL (Railway managed)         |
| Admin UI     | django-unfold (dark theme)           |
| Payments     | Whop.com webhooks                    |
| Static files | WhiteNoise                           |
| WSGI         | Gunicorn (3 workers)                 |

### Django Apps

| App              | Purpose                                               |
| ---------------- | ----------------------------------------------------- |
| `apps.users`     | CustomUser (email auth), EmailVerificationToken       |
| `apps.plans`     | Profile (plan_type, is_pro_active), PlanType enum     |
| `apps.usage`     | DailyUsage (per-day counters), UsageEvent (telemetry) |
| `apps.rewards`   | RewardCreditLedger (bonus credits)                    |
| `apps.webhooks`  | WebhookEvent (Whop payment events)                    |
| `apps.api`       | REST API views (register, login, usage, etc.)         |
| `apps.dashboard` | Admin dashboard callbacks (KPI stats, sidebar badges) |

### Settings Structure

```
config/settings/
├── base.py         # Shared settings (apps, Unfold config, JWT, etc.)
├── local.py        # Development (SQLite, DEBUG=True)
└── production.py   # Railway (DATABASE_URL, WhiteNoise, CSRF, CORS)
```

**DJANGO_SETTINGS_MODULE** in production: `config.settings.production`

### Key Environment Variables (Railway)

| Variable                 | Purpose                                            |
| ------------------------ | -------------------------------------------------- |
| `SECRET_KEY`             | Django secret key                                  |
| `DATABASE_URL`           | PostgreSQL connection string (auto-set by Railway) |
| `DJANGO_SETTINGS_MODULE` | `config.settings.production`                       |
| `ALLOWED_HOSTS`          | `api.auto-flow.studio,.railway.app`                |
| `PORT`                   | Dynamic port (Railway sets this)                   |
| `WHOP_API_KEY`           | Whop API key for payment verification              |
| `WHOP_WEBHOOK_SECRET`    | Whop webhook signature verification                |

### Railway Configuration

| Setting              | Value                  |
| -------------------- | ---------------------- |
| Project              | `secure-enthusiasm`    |
| Service              | `web`                  |
| Custom Start Command | `python start.py`      |
| Service Port         | `8000`                 |
| Custom Domain        | `api.auto-flow.studio` |
| Root Directory       | `/` (repo root)        |
| Python version       | 3.12.8                 |

### Admin Dashboard

The admin at `/admin` uses django-unfold with:

- **6 KPI cards** on dashboard: Total Users, Active Users, Pro Subscribers, Prompts Today, Active Today, Pending Webhooks
- **Sidebar badges**: Live counts on Users, Profiles (Pro), Daily Usage, Webhooks (pending)
- **Colored badges**: Plan type (⚡ PRO / Free), usage levels (green/amber/red), event types with emoji icons
- **Bulk actions**: Activate/Deactivate users, Grant/Revoke Pro, Reset usage, Mark webhooks processed

---

## Website — Next.js Landing Page

> **Domain**: `www.auto-flow.studio`
> **Hosted on**: Vercel
> **Repository**: Same main repo, `website/` subfolder

### Deploy to Vercel

```bash
cd website
npx vercel --prod
```

Or push to GitHub — Vercel can auto-deploy (check if Git integration is enabled).

### Tech Stack

| Layer     | Technology                                 |
| --------- | ------------------------------------------ |
| Framework | Next.js 15 (App Router)                    |
| Styling   | Vanilla CSS (dark theme, glassmorphism)    |
| Analytics | @vercel/analytics + @vercel/speed-insights |
| Fonts     | Google Fonts (Inter)                       |

### Pages

| Page     | Path       | File                                   |
| -------- | ---------- | -------------------------------------- |
| Homepage | `/`        | `src/app/page.js` (redirects to `/en`) |
| Pricing  | `/pricing` | `src/app/pricing/page.js`              |
| FAQ      | `/faq`     | `src/app/faq/page.js`                  |
| Privacy  | `/privacy` | `src/app/privacy/page.js`              |
| Terms    | `/terms`   | `src/app/terms/page.js`                |

### Multi-Language (i18n) — SEO Optimized

Supports **4 languages**: English (en), Arabic (ar), French (fr), Spanish (es)

**Architecture:**

- **Locale routing**: `/en`, `/ar`, `/fr`, `/es` URL prefixes
- **hreflang tags**: Each page generates `<link rel="alternate" hreflang="xx">` for all locales
- **Translations**: `src/app/dictionaries.js` (all strings in 4 languages)
- **Middleware**: `middleware.js` detects language from URL path
- **RTL**: Arabic pages get `dir="rtl"` on `<html>` tag
- **Language switcher**: Pill-style `EN | عربي | FR | ES` in the header nav
- **Sitemap**: `src/app/sitemap.js` generates 20 URLs (5 pages × 4 locales)

**Key i18n Files:**

```
website/
├── middleware.js                  # Locale detection from URL path
├── src/app/
│   ├── dictionaries.js            # All translations (EN, AR, FR, ES)
│   ├── [locale]/
│   │   ├── page.js                # Locale-aware homepage
│   │   └── layout.js              # Locale-aware layout (nav + footer + lang switcher)
│   ├── layout.js                  # Root layout (HTML shell only)
│   ├── layout.css                 # Header, footer, lang switcher, RTL CSS
│   ├── page.css                   # Homepage section styles
│   └── sitemap.js                 # Multi-locale sitemap generator
```

### CSS Files

| File          | Content                                                         |
| ------------- | --------------------------------------------------------------- |
| `globals.css` | Design tokens (colors, fonts, spacing), resets, utility classes |
| `layout.css`  | Header, footer, language switcher, RTL support                  |
| `page.css`    | Homepage sections (hero, features, how-it-works, CTA)           |

---

## Extension — Chrome Extension (i18n)

### Supported Languages

English (en), Arabic (ar), French (fr), Spanish (es)

### Files

- `src/sidepanel/i18n.ts` — Translation dictionary + `applyLanguage()` / `initLanguage()` functions
- `sidepanel.html` — Elements use `data-i18n` attributes for translatable text
- `src/sidepanel/styles.css` — RTL CSS rules appended at bottom

### How It Works

1. On load: `initLanguage()` reads saved language from `chrome.storage.local`
2. `applyLanguage(lang)` walks all elements with `data-i18n` attributes and replaces text
3. Language dropdown in Settings tab triggers `applyLanguage()` + persists selection

---

## Full Project Structure

```
autoflow/                              ← Main monorepo
├── manifest.json                      ← Chrome extension manifest (MV3)
├── package.json                       ← Extension dependencies
├── webpack.config.js                  ← Extension build (3 entry points)
├── sidepanel.html                     ← Extension side panel UI
├── MEMORY.md                          ← THIS FILE
├── .gitattributes                     ← Force LF for .sh files
│
├── src/                               ← Chrome Extension source
│   ├── types/
│   ├── shared/
│   ├── background/
│   ├── content/
│   └── sidepanel/
│
├── backend/                           ← Django REST API (also pushed to autoflow-backend repo)
│   ├── manage.py
│   ├── start.py                       ← Railway startup script (Python, NOT bash)
│   ├── start.sh                       ← OLD startup script (DO NOT USE — CRLF issues)
│   ├── nixpacks.toml                  ← Railway build config → "python start.py"
│   ├── Procfile                       ← Alternative startup (not used by Railway)
│   ├── requirements.txt
│   ├── config/                        ← Django settings
│   │   ├── urls.py
│   │   ├── wsgi.py
│   │   └── settings/
│   │       ├── base.py                ← Shared settings + Unfold config
│   │       ├── local.py               ← Dev settings
│   │       └── production.py          ← Railway settings
│   └── apps/
│       ├── users/                     ← Custom user model + email auth
│       ├── plans/                     ← Profile + plan types
│       ├── usage/                     ← Daily usage + events
│       ├── rewards/                   ← Reward credits
│       ├── webhooks/                  ← Whop webhooks
│       ├── api/                       ← REST API views
│       └── dashboard.py               ← Admin KPI callbacks
│
└── website/                           ← Next.js landing page
    ├── package.json
    ├── next.config.mjs
    ├── middleware.js                   ← i18n locale routing
    └── src/app/
        ├── globals.css                ← Design tokens
        ├── layout.js                  ← Root layout
        ├── layout.css                 ← Header/footer/lang switcher CSS
        ├── page.js                    ← Root page (redirects to /en)
        ├── page.css                   ← Homepage styles
        ├── dictionaries.js            ← Translations (EN, AR, FR, ES)
        ├── sitemap.js                 ← Multi-locale sitemap
        ├── [locale]/                  ← Locale-aware pages
        │   ├── page.js
        │   └── layout.js
        ├── pricing/page.js
        ├── faq/page.js
        ├── privacy/page.js
        └── terms/page.js
```

---

## Deployment Commands Cheatsheet

### Extension (Chrome Web Store)

```bash
npm run build          # Build to dist/
# Then upload dist/ folder to Chrome Web Store
```

### Website (Vercel)

```bash
cd website
npx vercel --prod      # Force deploy to production
```

### Backend (Railway)

```bash
# From the root of the autoflow repo:

# 1. Commit changes
git add -A && git commit -m "your message"

# 2. Push to main repo
git push origin main

# 3. Push backend/ to Railway's repo (REQUIRED for Railway deploy!)
git subtree push --prefix=backend https://github.com/aminesmpc-art/autoflow-backend.git main

# If rejected, force push:
git subtree split --prefix=backend -b backend-deploy
git push https://github.com/aminesmpc-art/autoflow-backend.git backend-deploy:main --force
git branch -D backend-deploy
```

### Railway CLI (alternative)

```bash
railway status         # Check connection
railway up --detach    # Upload local files directly (skip Git)
railway redeploy -y    # Restart latest deploy
railway logs           # View logs
```

---

## ⚠️ Critical Gotchas & Lessons Learned

### 1. DUAL REPO for Backend

Railway watches `autoflow-backend` repo, NOT the main `autoflow` repo. If you only push to `autoflow`, Railway will NOT redeploy. Always run `git subtree push`.

### 2. NEVER Use Bash Scripts on Railway (from Windows)

Windows creates files with `\r\n` (CRLF) line endings. Bash on Linux sees `\r` as part of variable names, causing errors like `'$PORT' is not a valid port number`. Use `python start.py` instead of `bash start.sh`.

### 3. Railway Port Configuration

- Railway sets the `PORT` environment variable automatically
- The gunicorn process MUST bind to `0.0.0.0:$PORT`
- The Railway **Service Port** (in Settings → Networking) must match the port gunicorn listens on (currently `8000`)
- If the port doesn't match, you get "Application failed to respond" (502)

### 4. Railway Custom Start Command

In Railway Settings → Deploy → Custom Start Command: `python start.py`
This overrides `nixpacks.toml`. If this field is set, nixpacks.toml's `[start]` is ignored.

### 5. Website Vercel Auto-Deploy

Vercel may or may not auto-deploy from Git pushes. If the site doesn't update after pushing, run `npx vercel --prod` manually from the `website/` directory.

### 6. File Dependencies Across Apps

Django apps have cross-references:

- `users.admin` imports `plans.models.Profile` for inline admin
- `dashboard.py` imports from ALL apps for stats
- If you rename models or fields, check ALL admin.py files

### 7. Django Admin URL

The admin is at `/admin/` (with trailing slash). CSRF requires `api.auto-flow.studio` in `CSRF_TRUSTED_ORIGINS`.

### 8. Extension Build

```bash
npm run build   # webpack → dist/ folder
# Load dist/ as unpacked extension in Chrome
```

### 9. i18n Translation Keys

Website translations are in `website/src/app/dictionaries.js`. When adding new sections to the homepage, add translations for ALL 4 languages (en, ar, fr, es).

### 10. .gitattributes

The `.gitattributes` file forces LF endings for `.sh` files. This prevents CRLF issues but only affects git operations, not local files.

---

_End of MEMORY.md — Last updated: March 2026_
