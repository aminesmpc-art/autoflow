# 🎬 AutoFlow Studio — Deep Technical Architecture & Project Guidebook

> **Document Scope:** Full engineering manual, message protocols, node specifications, and developer reference for **AutoFlow Studio (v0.27.0)**.  
> **Source Directory:** `studio-extension/`  
> **License & Affiliation:** Independent open-source project. Not affiliated with Google, OpenAI, Anthropic, xAI, or Z.AI.

---

## Table of Contents
1. [Introduction & Product Paradigm](#1-introduction--product-paradigm)
2. [Runtime Architecture & Manifest V3 Integration](#2-runtime-architecture--manifest-v3-integration)
3. [The Node Engine & Visual Canvas](#3-the-node-engine--visual-canvas)
4. [Execution Pipeline & The Workflow Runner](#4-execution-pipeline--the-workflow-runner)
5. [Story Director & Character Continuity Framework](#5-story-director--character-continuity-framework)
6. [Natural Language AI Builder Architecture](#6-natural-language-ai-builder-architecture)
7. [Multi-Platform DOM Content Script Adapters](#7-multi-platform-dom-content-script-adapters)
8. [State Management, Persistence & Entitlements](#8-state-management-persistence--entitlements)
9. [Automated Testing & Drift Verification](#9-automated-testing--drift-verification)
10. [Developer Guide & Build Scripts](#10-developer-guide--build-scripts)

---

## 1. Introduction & Product Paradigm

### The Problem in Generative Video Workflows
Creating a multi-shot AI video clip traditionally involves tedious manual repetition:
- Switching between multiple web tabs (Google Flow, ChatGPT, Claude, Grok).
- Losing character consistency between shot 1 and shot 2 (e.g. hair changing length, clothing shifting colors, lighting changing from noon to sunset).
- Manually saving the closing frame of a video to upload it as the start frame of the next.
- Paying steep API markup fees or running out of rate limits.

### The AutoFlow Studio Solution
**AutoFlow Studio** introduces a visual node-graph canvas right in Chrome:
- **No API Keys Needed:** It scripts the web interfaces of the user's active subscriptions (Google Flow, Grok Imagine, ChatGPT Plus, Claude Pro, Gemini Advanced).
- **Infinite Node Graph:** Steps are connected with typed wires (`text`, `image_ref`, `frame_start`, `frame_end`).
- **Story Director:** Preserves biometric IDs, clothing layers, and world lighting across the entire shot list.
- **Last Frame Handoff:** Extracts video ending frames automatically to seamlessly transition motion into the next generation.

---

## 2. Runtime Architecture & Manifest V3 Integration

The extension runs in four distinct JavaScript execution contexts coordinated by the Service Worker:

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
│  │    - Tab Management & Alarms Keepalive                          │   │
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

### Manifest V3 Permission Model
- `sidePanel`: Houses the side panel UI (`sidepanel.html`).
- `storage` & `unlimitedStorage`: Persists user workflows, node data, and base64 video frames locally.
- `activeTab` & `scripting`: Dispatches synthetic paste/drop events in the page's MAIN world for image upload.
- `alarms`: Periodically awakens the service worker to prevent MV3 worker termination during 3-minute video renders.
- `identity`: Google Sign-In authentication with the AutoFlow platform.

---

## 3. The Node Engine & Visual Canvas

The visual canvas is powered by **React 19**, **`@xyflow/react` (v12.11.1)**, and customized CSS design tokens.

### Available Node Palette

#### 1. `PromptNode` (`src/studio/nodes/PromptNode.tsx`)
- Input: None.
- Output: `text` (string).
- Function: Contains raw user text, scene briefs, or camera movement instructions.

#### 2. `ImageNode` (`src/studio/nodes/ImageNode.tsx`)
- Input: File upload or bundled asset.
- Output: `image` (base64 data URL).
- Function: Supplies reference images (character faces, product bottles, background architecture).

#### 3. `GenerateNode` (`src/studio/nodes/GenerateNode.tsx`)
- Inputs: `text`, `image_ref`, `frame_start`, `frame_end`.
- Outputs: `result` (video/image blob URL), `text`.
- Supported Platforms:
  - **Google Flow:** Veo 3.1 (Quality/Fast/Lite), Omni Flash (supports 10s video), Nano Banana Pro/2/2 Lite.
  - **Grok Imagine:** Stills & 6s/10s/15s videos.
  - **ChatGPT / Claude / Gemini / Z.AI:** Multimodal still image or prompt ideation.

#### 4. `FrameNode` (`src/studio/nodes/FrameNode.tsx`)
- Input: `result` (connected to a video `GenerateNode`).
- Output: `image`.
- Function: Automatically captures the last decoded frame of the upstream video and injects it into downstream nodes as an anchor or starting frame.

#### 5. `ExtendNode` (`src/studio/nodes/ExtendNode.tsx`)
- Input: `result` (upstream video).
- Output: `result`.
- Function: Extends existing Grok / Veo video clips continuously up to 30 seconds total.

#### 6. `StoryNode` (`src/studio/nodes/StoryNode.tsx`)
- Input: `text` (Single-line story idea).
- Outputs: Dynamic multi-shot `text` handles (`shot1`, `shot2`, `shot3`, etc.).
- Function: The AI Story Director. Generates an entire shot sequence while enforcing strict character biometric lock, wardrobe lock, and audio cues.

#### 7. `AgentNode` (`src/studio/nodes/AgentNode.tsx`)
- Inputs: `text`, `image`.
- Outputs: `text`, `result`.
- Function: Multi-turn autonomous agent that can inspect generated clips, diagnose visual defects, adjust prompt modifiers, and trigger node re-runs.

---

## 4. Execution Pipeline & The Workflow Runner

Execution is orchestrated by `WorkflowRunner.ts`:

### 1. Topological Sorting (`topoSort.ts`)
Before starting, the node graph is parsed to determine strict dependency ordering:
- A cycle detection algorithm ensures no recursive feedback loops exist.
- Independent parallel branches are executed concurrently or in optimal FIFO order.

### 2. Execution State Lifecycle
Each runnable node progresses through standard lifecycle states:
```
  [ IDLE ]
     │
     ▼
[ RUNNING ] ─── (Progress Ticks: 0% → 100%)
     │
     ├─────────────┐
     ▼             ▼
  [ DONE ]      [ ERROR ]
                   │
                   ▼ (Auto-Retry if Transient)
               [ RETRYING ]
```

### 3. Parked Replies Buffer & Session Recovery
If Chrome recycles the Service Worker mid-generation:
1. The content script detects generation completion and sends `STUDIO_NODE_RESULT`.
2. The Service Worker stores the result in `chrome.storage.session` under `studio_parked_replies`.
3. When the canvas tab reconnects, the Service Worker immediately drains the parked buffer to resume the pipeline without stalling.

---

## 5. Story Director & Character Continuity Framework

One of AutoFlow Studio's standout capabilities is multi-shot visual continuity.

### The 7-Part Prompt Formula
Every shot generated by the Story Director follows an 8-part prompt architecture:
1. **Camera Direction:** Exact camera motion (`[tracking low-angle dolly forward]`, `[handheld 9:16 phone POV]`).
2. **Biometric Character ID:** Repeated verbatim on every shot (head shape, hair style, eye color, skin tone, facial features).
3. **Wardrobe & Props:** Explicit clothing layers, colors, and accessories.
4. **Action & Motion:** Physical verbs and subject interaction with props.
5. **Dialogue & Emotion:** Spoken lines in quotes with delivery markers: `(dialogue: "We found it!" [breathless, excited])`.
6. **Environment & Lighting:** Volumetric light rays, golden hour, weather, physical room materials.
7. **Style & Negative Constraints:** Quality tags (`8K photorealistic, anamorphic lens`) and negative locks (`no cartoon, no morphing, no style reset`).
8. **Layered Sound Design:** Ambience, foley footsteps, and vocal sounds.

---

## 6. Natural Language AI Builder Architecture

Located in `src/studio/builder/`:

```
User Prompt: "Create a 3-shot unboxing commercial for a luxury perfume bottle"
                         │
                         ▼
             [ Prompt Specification: spec.ts ]
                         │
                         ▼
          [ LLM (ChatGPT / Claude / Gemini) ]
                         │
                         ▼
            [ Structured Plan: plan.ts ]
          - Thinking & Shot Breakdown
          - Node Placement (X, Y coordinates)
          - Socket Connections & Wiring
                         │
                         ▼
           [ Validator & Linter: check.ts ]
          - Validates Socket Types
          - Verifies Model Compatibility
          - Fixes Disconnected Wires
                         │
                         ▼
             [ Rendered to XYFlow Canvas ]
```

---

## 7. Multi-Platform DOM Content Script Adapters

All adapters live in `src/content/` and interface with their respective web interfaces without API keys:

### 1. Google Flow (`src/content/flow/`)
- Intercepts `labs.google/flow` and `labs.google/fx`.
- Selects models: **Omni Flash**, **Veo 3.1 - Fast**, **Veo 3.1 - Quality**, **Veo 3.1 - Lite**, **Nano Banana Pro**.
- Handles aspect ratios (`9:16`, `16:9`, `1:1`, `4:3`, `3:4`), durations (`4s`, `6s`, `8s`, `10s`), and voice casting.
- Monitors generation tiles and extracts high-resolution MP4 video URLs.

### 2. ChatGPT (`src/content/chatgpt/`)
- Intercepts `chatgpt.com/*`.
- Types into ProseMirror contenteditable editor.
- Dispatches synthetic DataTransfer paste events via MAIN world injection to attach reference image files.
- Reads completed assistant turns and extracts structured markdown/JSON.

### 3. Claude (`src/content/claude/`)
- Intercepts `claude.ai/*`.
- Drives Anthropic's Claude 3.5 Sonnet interface for rich script ideation and storyboard compilation.

### 4. Grok (`src/content/grok/`)
- Intercepts `grok.com/*`.
- Automates Grok Imagine for rapid concept art and video extensions up to 30s.

### 5. Gemini (`src/content/gemini/`)
- Intercepts `gemini.google.com/*`.
- Automates Google Gemini multimodal image generation and visual verification.

### 6. Z.AI (`src/content/zai/`)
- Intercepts `chat.z.ai/*`.
- Supports GLM-4 and GLM-5 deep-thinking modes with structured JSON outputs.

---

## 8. State Management, Persistence & Entitlements

The Zustand store (`src/studio/store.ts`) manages canvas state:

### Storage Architecture
- **Storage Engine:** `chrome.storage.local` with `unlimitedStorage` permission.
- **Autosave Engine:** Debounced saving with 2000ms idle threshold.
- **Payload Sanitization (`stripResults`):** Before storing, large generated video blobs and preview data URLs are stripped to keep workflow JSON files lightweight.
- **Workflow Export/Import:** Workflows can be exported as `.json` files and imported across machines.

### Plan & Tier Limits
- **Free Tier:** 10 workflow runs per calendar month, unlimited nodes on canvas, all node types included.
- **Pro Tier:** Unlimited monthly runs, cloud template sharing, priority features.

---

## 9. Automated Testing & Drift Verification

AutoFlow Studio maintains a test suite of **108+ unit and integration tests** under `src/tests/`:

### Core Test Categories
- `topoSort.test.ts`: Graph cycle detection and sorting.
- `adapterTimeouts.test.ts`: Ensures backstop timeouts exceed content script execution caps.
- `storyboard.test.ts` & `storyRun.test.ts`: Validates character consistency invariants and self-repairing JSON parsers.
- `builder.test.ts`: Tests the Natural Language compiler across 50+ prompt variations.
- `grokExtend.test.ts`: Validates 30-second continuous extension chain logic.

### Drift Checker (`scripts/check-engine-drift.js`)
Since DOM selectors for web platforms can change upstream:
```bash
npm run check:drift
```
Compares live selector hashes against `engine-sync.json` to alert developers before a release if upstream web apps have updated their HTML structures.

---

## 10. Developer Guide & Build Scripts

### Setup & Compilation

```bash
# Clone and install
cd studio-extension
npm install

# Start development build with live reload
npm run dev

# Run test suite
npm test

# Build production bundle for Chrome Web Store
npm run build:publish
```

### Output Directory Structure (`dist/`)
```
dist/
├── manifest.json
├── background.js
├── sidepanel.html
├── sidepanel.js
├── sidepanel.css
├── studio.html
├── studio.js
├── studio.css
├── flow-content.js
├── chatgpt-content.js
├── claude-content.js
├── gemini-content.js
├── grok-content.js
├── zai-content.js
├── sw-bypass.js
├── icons/
└── assets/
```
