# 🎬 AutoFlow Studio — Complete System Guide & Node Manual

> **Version:** 0.27.0  
> **Type:** Standalone Chrome Extension (Manifest V3)  
> **Engine:** React 19 + `@xyflow/react` + Zustand  
> **Supported Platforms:** Google Flow (Veo 3.1 & Omni), Grok Imagine, ChatGPT, Claude, Google Gemini, Z.AI  
> **Website:** [https://auto-flow.studio](https://auto-flow.studio)

---

## 📑 Table of Contents
1. [Executive Overview & Core Philosophy](#1-executive-overview--core-philosophy)
2. [High-Level Architecture (Manifest V3)](#2-high-level-architecture-manifest-v3)
3. [The Node Graph & Connection System](#3-the-node-graph--connection-system)
4. [Exhaustive Node Manual (Every Knob, Button & Setting)](#4-exhaustive-node-manual-every-knob-button--setting)
   - [1. Prompt Node](#1-prompt-node-promptnodetsx)
   - [2. Reference Image Node](#2-reference-image-node-imagenodetsx)
   - [3. Generate Node (Veo, Grok, ChatGPT, Gemini, Claude, Z.AI)](#3-generate-node-generatenodetsx)
   - [4. Last Frame Node (Continuity Handoff)](#4-last-frame-node-framenodetsx)
   - [5. Grok Extend Node (30s Continuous Video)](#5-grok-extend-node-extendnodetsx)
   - [6. Story Director Node (Scripting & Biometric Lock)](#6-story-director-node-storynodetsx)
   - [7. AI Agent Node (Autonomous Quality Control)](#7-ai-agent-node-agentnodetsx)
5. [Story Director & Character Continuity Engine](#5-story-director--character-continuity-engine)
6. [Natural Language AI Workflow Builder](#6-natural-language-ai-workflow-builder)
7. [Platform Content Script Adapters](#7-platform-content-script-adapters)
8. [State Management, Storage & Entitlements](#8-state-management-storage--entitlements)
9. [Developer Guide, Build Commands & Testing Suite](#9-developer-guide-build-commands--testing-suite)

---

## 1. Executive Overview & Core Philosophy

**AutoFlow Studio** is a visual, node-based workflow builder and automation engine for multi-shot generative AI video production.

### Core Pillars
- **Zero API Keys Required:** Operates directly inside browser tabs where users already have active accounts (Google Flow, Grok Imagine, ChatGPT Plus, Claude Pro, Gemini Advanced).
- **True Multi-Shot Continuity:** Maintains character facial structure, wardrobe, props, and room lighting across cuts through reference image anchoring, last-frame handoffs, and biometric contract repetition.
- **Multi-Model Orchestration:** A single canvas can coordinate ChatGPT/Claude for script ideation, Gemini for visual inspection, and Google Veo / Grok for video rendering.
- **Local-First & Private:** Workflows, reference pictures, and extracted frames are stored locally in the user's browser via `chrome.storage.local`.

---

## 2. High-Level Architecture (Manifest V3)

AutoFlow Studio runs in four isolated browser execution contexts:

```
┌────────────────────────────────────────────────────────────────────────┐
│                          CHROME BROWSER WINDOW                         │
│                                                                        │
│  ┌───────────────────────┐             ┌───────────────────────────┐   │
│  │   STUDIO CANVAS TAB   │             │    CHROME SIDE PANEL      │   │
│  │ (React 19 + XYFlow)   │             │ (Build, Monitor, Library) │   │
│  └──────────┬────────────┘             └─────────────┬─────────────┘   │
│             │ Long-Lived Port                        │ Messages        │
│             ▼                                        ▼                 │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │               BACKGROUND SERVICE WORKER (MV3)                   │   │
│  │    - Session-Resilient Parked Replies Buffer                    │   │
│  │    - 50-Line Diagnostic Ring Buffer                             │   │
│  │    - Alarms Keepalive Engine                                    │   │
│  └──────────────────┬──────────────────────────────────────────────┘   │
│                     │ Routed Messages & Script Injections              │
│                     ▼                                                  │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │              PLATFORM CONTENT SCRIPTS (Isolated Worlds)         │   │
│  │  [Google Flow] [ChatGPT] [Claude] [Gemini] [Grok] [Z.AI]        │   │
│  │                           │ MAIN World Script Injection         │   │
│  │                           ▼                                     │   │
│  │             [Target Page DOM & Framework Events]                │   │
│  └─────────────────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 3. The Node Graph & Connection System

Nodes are connected via typed handles (`connect.ts`):

```
       ┌────────────────────────┐
 [text]│                        │[text]
       │     GENERATE NODE      │
[image]│                        │[result] ──> (Video / Still Output)
[frame]│                        │
       └────────────────────────┘
```

| Port Handle | Glyph & Color | Purpose | Supported Connections |
|---|---|---|---|
| **`text`** | **`T`** (Orange) | Carries prompt text, briefs, or scene descriptions. | PromptNode, StoryNode, AgentNode → GenerateNode |
| **`image_ref`** | **`🖼`** (Blue) | Carries reference photos into model ingredient trays. | ImageNode, FrameNode → GenerateNode |
| **`frame_start`** | **`S`** (Purple) | Pins the opening video frame (Flow Frames Mode). | ImageNode, FrameNode → GenerateNode |
| **`frame_end`** | **`E`** (Purple) | Pins the closing video frame (Flow Frames Mode). | ImageNode, FrameNode → GenerateNode |
| **`video`** | **`▶`** (Blue) | Passes a finished video clip for extension. | GenerateNode `result` → ExtendNode `video` |
| **`result`** | **`→`** (Green/Purple) | Outputs the completed video or image. | GenerateNode → FrameNode, ExtendNode |

---

## 4. Exhaustive Node Manual (Every Knob, Button & Setting)

---

### 1. ✍️ Prompt Node (`PromptNode.tsx`)
[Source File](file:///c:/Users/HP%20PROBOOK/Desktop/autoflow/studio-extension/src/studio/nodes/PromptNode.tsx)

```
+─────────────────────────────────────────+
| [⧉ Duplicate] [🗑 Delete]                |
| ✏️ Prompt Name                  [ⓘ Info] |
| +─────────────────────────────────────+ |
| | Describe your character or scene... | |
| |                                     | |
| +─────────────────────────────────────+ |
| 142 / 20,000 chars               (T)─── |
+─────────────────────────────────────────+
```

#### What It Is:
A clean text authoring box designed to hold raw prompts, character descriptions, lighting directives, or scene directions.

#### Visual Elements & Controls:
- **`⧉` Duplicate Button:** Clones the node and its text with a visual offset.
- **`🗑` Delete Button:** Removes the node and cleans up connected wires.
- **`✏️` Name / Title Field:** Clickable label to name your prompt block.
- **`[ⓘ]` Info Badge:** Displays node documentation on hover.
- **Multi-line Text Editor:** Scroll-safe text area (canvas zoom/drag disabled while editing). Max length: 20,000 characters.
- **Character Counter:** Real-time count indicator; turns yellow/red near limits.
- **`(T)` Output Handle (Right):** Emits the text string.

---

### 2. 🖼️ Reference Image Node (`ImageNode.tsx`)
[Source File](file:///c:/Users/HP%20PROBOOK/Desktop/autoflow/studio-extension/src/studio/nodes/ImageNode.tsx)

```
+─────────────────────────────────────────+
| [⧉ Duplicate] [🗑 Delete]                |
| 🖼 Reference Image              [ⓘ Info] |
| +─────────────────────────────────────+ |
| |          [ 📎 Upload Image ]        | |
| |      (Or Aspect-Ratio Preview)      | |
| +─────────────────────────────────────+ |
| [ Name: Hero Character ]         (🖼)─── |
+─────────────────────────────────────────+
```

#### What It Is:
A visual asset container for uploading real-world photos, product images, face anchors, or style references.

#### Visual Elements & Controls:
- **`⧉` / `🗑` Actions:** Duplicate or delete the node.
- **Media Viewport:**
  - *Empty State:* Upload button supporting PNG, JPG, and WebP.
  - *Loaded State:* Displays the image formatted to its native aspect ratio.
  - *Click-to-Zoom:* Clicking the thumbnail launches a full-screen high-resolution Lightbox.
  - *`Change` Button:* Swap the image file at any time.
- **Asset Name Input:** Text field to label the asset (e.g., *"Lead Actor Face"*, *"Perfume Bottle"*). Google Flow uses this name when registering visual ingredients.
- **`(🖼)` Output Handle (Right):** Emits base64 image data.

---

### 3. 🎬 Generate Node (`GenerateNode.tsx`)
[Source File](file:///c:/Users/HP%20PROBOOK/Desktop/autoflow/studio-extension/src/studio/nodes/GenerateNode.tsx)

```
+───────────────────────────────────────────────────────────────────+
| [⧉] [🗑]                                                         |
| 🎬 Shot 1 — The Approach      [SKIPPED] [ⓘ Info] [Toggle Switch] |
| +───────────────────────────────────────────────────────────────+ |
| |                                                               | |
| |                     MEDIA DISPLAY AREA                        | |
| |              (Video Player / Image / Spinner)                 | |
| |                                                               | |
| +───────────────────────────────────────────────────────────────+ |
| [Platform: Flow ▾] [Type: Video ▾] [Model: Veo 3.1 Fast ▾]       |
| [Ratio: 9:16 ▾]   [Duration: 8s ▾] [Mode: Ingredients ▾]        |
| [Voice: Achernar ▾]                                              |
|                                                                   |
| ──(T) Prompt Input                                 (→) Result ─── |
| ──(🖼) Reference Image                             (T) Text   ─── |
| ──(S) Start Frame (Frames Mode)                                   |
| ──(E) End Frame (Frames Mode)                                     |
+───────────────────────────────────────────────────────────────────+
```

#### What It Is:
The primary production engine. Executes generations on Google Flow (Veo & Omni), Grok, ChatGPT, Gemini, Claude, or Z.AI.

#### Visual Elements & Controls:
- **Enable/Skip Toggle (`.sn-toggle`):** Enables or disables the node during runs without deleting configuration.
- **Media Viewport (`.sn-media`):**
  - *Idle:* Ghost silhouette matching target aspect ratio.
  - *Running:* Circular spinner and dynamic progress percentage bar.
  - *Done:* Built-in HTML5 video player (with loop, mute, playback controls) or image preview with `⤢` Fullscreen Lightbox.
  - *Error:* Error description box with a **`↻ Retry`** button to re-run only this node and its dependencies.
- **Settings Strip:**
  - **Platform:** `Flow`, `ChatGPT`, `Gemini`, `Grok`, `Claude`, `Z.AI`.
  - **Media Type:** `Video`, `Image`, or `Text`.
  - **Model:**
    - *Flow Video:* `Veo 3.1 - Quality`, `Veo 3.1 - Fast`, `Veo 3.1 - Lite`, `Omni Flash`.
    - *Flow Image:* `Nano Banana Pro`, `Nano Banana 2`, `Nano Banana 2 Lite`.
  - **Aspect Ratio:** `9:16` (Vertical), `16:9` (Widescreen), `1:1` (Square), `4:3`, `3:4`.
  - **Duration:** `4s`, `6s`, `8s`, `10s` (Omni Flash).
  - **Creation Mode:** `Ingredients` (style/subject reference) vs `Frames` (pins exact start/end stills).
  - **Voice Dropdown:** Select from 30+ voice actors (e.g., *Achernar*, *Fenrir*, *Zephyr*).
- **Sockets:**
  - *Inputs (Left):* `(T)` Prompt, `(🖼)` Reference Image, `(S)` Start Frame, `(E)` End Frame.
  - *Outputs (Right):* `(→)` Video/Image Result, `(T)` Generated Text.

---

### 4. 🎞️ Last Frame Node (`FrameNode.tsx`)
[Source File](file:///c:/Users/HP%20PROBOOK/Desktop/autoflow/studio-extension/src/studio/nodes/FrameNode.tsx)

```
+─────────────────────────────────────────+
| [⧉] [🗑]                                |
| 🎞 Last Frame                   [ⓘ Info] |
| +─────────────────────────────────────+ |
| |                                     | |
| |     [ EXTRACTED FINAL STILL ]       | |
| |                                     | |
| +─────────────────────────────────────+ |
| "Hands this frame to whatever it feeds" |
| ──(🎬) From Video Clip           (🖼)─── |
+─────────────────────────────────────────+
```

#### What It Is:
Continuity engine node that extracts the final frame of an upstream video and passes it forward as a reference image or starting frame for the next shot.

#### Visual Elements & Controls:
- **Extracted Frame Viewport:** Displays the exact closing video frame captured upon generation completion. Click to zoom in Lightbox.
- **Empty / Missed State:** Displays `⇥` placeholder when awaiting video, or `⚠` alert if the upstream video failed to produce a valid closing frame.
- **Sockets:**
  - *Input (Left):* `(🎬)` Connects from an upstream GenerateNode's `(→)` result port.
  - *Output (Right):* `(🖼)` Passes the still image into downstream `(🖼)` or `(S)` ports.

---

### 5. ⏱️ Grok Extend Node (`ExtendNode.tsx`)
[Source File](file:///c:/Users/HP%20PROBOOK/Desktop/autoflow/studio-extension/src/studio/nodes/ExtendNode.tsx)

```
+─────────────────────────────────────────+
| ⏱ Grok Extend                  [ⓘ Info] |
| +─────────────────────────────────────+ |
| |       [ EXTENDED VIDEO PLAYER ]     | |
| +─────────────────────────────────────+ |
|   6s  ───>  16s  of 30s cap             |
|   Add: [ +6s ] [ +10s (Active) ]        |
|                                         |
| ──(T) Extension Prompt       (→) Result |
| ──(▶) Upstream Video                    |
+─────────────────────────────────────────+
```

#### What It Is:
Lengthens Grok Imagine video clips up to a maximum continuous duration of 30 seconds.

#### Visual Elements & Controls:
- **Video Viewport:** Plays the extended video clip.
- **Duration Arithmetic Bar:** Displays the progression math: `[Current Length] → [New Length] of 30s cap`. Warns if the step exceeds limits.
- **Step Buttons:** Select `+6s` or `+10s`. Steps that would exceed the 30-second ceiling are disabled automatically.
- **Sockets:**
  - *Inputs (Left):* `(T)` Extension prompt, `(▶)` Upstream video clip.
  - *Output (Right):* `(→)` Resulting longer video file.

---

### 6. 🎭 Story Director Node (`StoryNode.tsx`)
[Source File](file:///c:/Users/HP%20PROBOOK/Desktop/autoflow/studio-extension/src/studio/nodes/StoryNode.tsx)

```
+────────────────────────────────────────────────────────────────────────+
| [⧉] [🗑]                                                               |
| 🎭 Story Director                   [🎬 4 Shots Connected]  [ⓘ Info]   |
| +────────────────────────────────────────────────────────────────────+ |
| | [ 01 Ref Still 🖼 ] [ 02 Shot 1 🎬 9:16 8s ] [ 03 Shot 2 🎬 9:16 8s]| |
| +────────────────────────────────────────────────────────────────────+ |
| [ Tab: Director ]  [ Tab: Flow & Beats ]  [ Tab: Cast & World ]        |
|                                                                        |
| ── Narrative Structure: [ Hook ▾ ]                                     |
| ── Visual Preset:       [ Smartphone POV (TikTok) ▾ ]                  |
| ── Audio Mode:          [ Cinematic Foley & Ambience ▾ ]               |
| ── Camera Progression:  [ Dynamic Handheld ▾ ]                         |
|                                                                        |
| ──(T) Master Brief / Idea                          (T) Directed Prompts|
+────────────────────────────────────────────────────────────────────────+
```

#### What It Is:
A multi-shot narrative director. Takes a single idea and generates a coordinated sequence of prompts across all connected video nodes while enforcing strict character biometric and wardrobe locks.

#### Visual Elements & Controls:
- **Connected Sequence Timeline Ribbon:** Horizontal ribbon displaying all connected downstream shots, their media types, aspect ratios, durations, and role tags (`ref` or `cont`). Includes an inspector toggle (`✓`/`▾`) to preview the exact prompt generated for each shot.
- **Configuration Tabs:**
  - **Tab 1 (Director):** Narrative Structure (`Hook`, `Three-Act`, `Montage`, `Escalation`, `UGC`), Visual Preset (`Cinematic 35mm`, `Smartphone POV`, `Anime`, `Vintage`), Audio Mode (`Cinematic`, `Ambient`, `Dialogue-Heavy`, `Voiceover`), and Camera Progression (`Dynamic`, `Fixed`, `Wide-to-Close`, `Orbit`).
  - **Tab 2 (Flow & Beats):** Number of beats slider, timed beats toggle, and continuity rules (`samePerson`, `lockedWardrobe`, `cumulative`, `noReset`).
  - **Tab 3 (Cast & World):** Character profiles (Name, Visual Look, Role), World Environment description, and Negative Avoidance rules.
- **Sockets:**
  - *Input (Left):* `(T)` Master story brief.
  - *Output (Right):* `(T)` Emits distinct, aligned prompts into each connected GenerateNode.

---

### 7. 🤖 AI Agent Node (`AgentNode.tsx`)
[Source File](file:///c:/Users/HP%20PROBOOK/Desktop/autoflow/studio-extension/src/studio/nodes/AgentNode.tsx)

```
+────────────────────────────────────────────────────────────────────────+
| [⧉] [🗑]                                                               |
| 🧠 AI Production Agent             [SKIPPED] [ⓘ Info] [Toggle Switch]  |
| +────────────────────────────────────────────────────────────────────+ |
| |  STEP LOG:                                                         | |
| |  1 ⚙ read_canvas       -> Read 4 nodes and 3 wires                 | |
| |  2 ⚙ inspect_clip      -> Verified character wardrobe consistency   | |
| |  3 ✓ done              -> Goal achieved                            | |
| +────────────────────────────────────────────────────────────────────+ |
| [ Platform: Gemini ▾ ]  [ Max Steps: [2] [4 (Active)] [6] [10] ]       |
| Allowed Tools: [read_canvas] [inspect_clip] [rerun_node] [modify_prompt] |
| [ System Message: How the agent should think and behave... ]          |
|                                                                        |
| ──(T) Goal Input                                       (T) Final Result|
+────────────────────────────────────────────────────────────────────────+
```

#### What It Is:
An autonomous AI agent that runs in a loop to inspect outputs, diagnose visual flaws, refine prompts, and trigger re-runs.

#### Visual Elements & Controls:
- **Live Step Execution Log:** Real-time stream of agent decisions:
  - `⚙` Tool Invocation.
  - `←` Tool Observation / Feedback.
  - `↻` Automatic Prompt Repair.
  - `✓` Goal Completed.
  - `⚠` Error State.
- **Platform Selector:** `Gemini` (supports multimodal video inspection), `ChatGPT`, `Claude`, `Grok`, `Z.AI`.
- **Max Steps (Caps):** Set iteration limits (`2`, `4`, `6`, `10`) to prevent runaway executions.
- **Tool Permission Toggles:**
  - `read_canvas`: Reads node topology and settings.
  - `inspect_clip`: Visually inspects generated video/image outputs.
  - `modify_prompt`: Adjusts prompt text on other nodes.
  - `rerun_node`: Automatically triggers a re-generation of a specific node.
- **System Instructions Area:** Guidelines on how the agent should evaluate quality.
- **Sockets:**
  - *Input (Left):* `(T)` Goal / Quality objective.
  - *Output (Right):* `(T)` Final summary answer.

---

## 5. Story Director & Character Continuity Engine

To eliminate "shot amnesia," the Story Director (`storyPlan.ts` + `storyboard.ts`) automatically structures all shot prompts using the **8-Part Formula**:

```
[CAMERA DIRECTION] + [FULL BIOMETRIC CHARACTER ID] + [LOCKED WARDROBE & PROPS] + 
[PHYSICAL ACTION & VERBS] + [DIALOGUE IN QUOTES (EMOTION)] + 
[ENVIRONMENT & VOLUMETRIC LIGHTING] + [STYLE LOCK & NEGATIVES] + [LAYERED SOUND DESIGN]
```

### Example Storyboard Generation:
- **Shot 1:** `Wide tracking shot of Detective Sarah, 30s, sharp jawline, short auburn bob, emerald eyes, wearing a tailored charcoal trenchcoat over a burgundy turtleneck. She pushes open the heavy oak door of a rain-soaked abandoned warehouse. Golden volumetric dust motes filter through cracked skylights. (dialogue: "We found it." [breathless, whispering]) (ambience: heavy rain on metal roof) (foley: heavy footsteps on wet concrete) 8K photorealistic, anamorphic lens, no cartoon, no morphing.`
- **Shot 2:** `Low-angle tracking shot continuing from Shot 1 last frame. Detective Sarah (identical auburn bob, charcoal trenchcoat, burgundy turtleneck) kneels beside a glowing metallic briefcase. High contrast rim lighting. (foley: metal latch clicking open) 8K photorealistic, consistent character.`

---

## 6. Natural Language AI Workflow Builder

Located in `src/studio/builder/`:
1. **Spec Briefing (`spec.ts`):** Injects schema specifications and node palettes into the chosen LLM.
2. **Thinking Deliberation (`spec.ts`):** Forces the model to emit a structured `thinking` breakdown (shots, continuity plan) before outputting node data.
3. **Compilation (`plan.ts`):** Transforms the plan into React Flow node coordinates, handle IDs, and edge styles.
4. **Linter & Auto-Repair (`check.ts`):** Automatically fixes disconnected wires, cycle loops, or model setting mismatches before drawing to canvas.

---

## 7. Platform Content Script Adapters

All content scripts live in `src/content/`:

| Platform | Target URL | Capabilities |
|---|---|---|
| **Google Flow** | `labs.google/flow*` | Drives Veo 3.1 & Omni Flash, Ingredients & Frames modes, aspect ratios, voice dropdowns, and video polling/downloading. |
| **ChatGPT** | `chatgpt.com/*` | Dispatches image prompts, handles structured story planning, and injects reference images via MAIN-world synthetic paste events. |
| **Claude** | `claude.ai/*` | Drives Anthropic Claude 3.5 Sonnet for deep scriptwriting and storyboard compilation. |
| **Gemini** | `gemini.google.com/*` | Drives Google Gemini with multimodal visual reasoning and Imagen image creation. |
| **Grok** | `grok.com/*` | Automates xAI Grok Imagine stills and continuous 30-second video extensions. |
| **Z.AI** | `chat.z.ai/*` | Automates GLM-4 / GLM-5 deep-thinking structured generation. |

---

## 8. State Management, Storage & Entitlements

The Zustand store (`src/studio/store.ts`) manages canvas state:
- **Persistence:** Local storage via `chrome.storage.local` with `unlimitedStorage`.
- **Autosave Engine:** Debounced 2000ms idle saving.
- **Sanitization (`stripResults`):** Large base64 video blobs and preview URLs are stripped prior to storage to maintain compact workflow JSON files.
- **Entitlements:**
  - *Free Tier:* 10 runs per calendar month, unlimited nodes, all node types included.
  - *Pro Tier:* Unlimited runs, cloud template sharing, priority feature access.

---

## 9. Developer Guide, Build Commands & Testing Suite

### Prerequisites
- Node.js 18+
- npm 9+

### Commands
```bash
# Install dependencies
npm install

# Start development build with live watch
npm run dev

# Production build
npm run build

# Production build stripped for Chrome Web Store publish
npm run build:publish

# Run 108+ automated tests
npm test

# Check for DOM selector drift against upstream repositories
npm run check:drift
```

### Loading Extension in Chrome
1. Navigate to `chrome://extensions`.
2. Enable **Developer mode** in the top right.
3. Click **Load unpacked** and select `studio-extension/dist`.
4. Launch AutoFlow Studio from the Chrome toolbar or open the Chrome Side Panel.
