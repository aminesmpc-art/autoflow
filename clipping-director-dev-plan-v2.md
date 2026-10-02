# AutoFlow Studio: Comprehensive Clipping Director Node Specification (v2.0.0)
## Multi-Phase Architectural Spec & Developer Guide: Zero-API-Key Automated Video Clipping, Canvas Storyboarding, & Gemini Omni Flash Animation Pipeline

This specification outlines the technical design, architectural patterns, and execution flow for the **Clipping Director Node** (`ClippingDirectorNode.tsx`) inside **AutoFlow Studio (v0.27.0)**. 

Operating as a Manifest V3 Google Chrome extension built with **React 19, `@xyflow/react` (React Flow), and Zustand**, the system establishes a local-first, API-free pipeline. It programmatically drives the user's active browser tabs (Google AI Studio, Gemini Web UI, Claude.ai, and Google Flow) to execute complex, multi-turn visual and narrative operations. It keeps raw video processing private and free, utilizing high-context models only for creative planning and motion generation.

---

## 🏛️ System Architecture Overview

```
╔══════════════════════════════════════════════════════════════════════════════════════════════════════════╗
║                                    AUTOFLOW ECOSYSTEM — FULL ARCHITECTURE                              ║
╚══════════════════════════════════════════════════════════════════════════════════════════════════════════╝

                    ┌─────────────────────────────────────────────────────────────────────┐
                    │                     🌐 auto-flow.studio (Next.js / Vercel)          │
                    │  Landing · Pricing · Blog · FAQ · Changelog · Prompt Library · i18n │
                    └──────────────┬──────────────────────────┬───────────────────────────┘
                                   │  (Install CTA)           │  (Prompt Library API)
                                   ▼                          ▼
    ┌───────────────────────────────────────────────────────────────────────────────────────────────────┐
    │                            Chrome Extension — Manifest V3                                         │
    │                                                                                                   │
    │  ┌─────────────────────────────────┐    ┌──────────────────────────────────┐                      │
    │  │    📋 Batch Queue Sidepanel     │    │    🎬 Studio Canvas Tab          │                      │
    │  │  (extension/ — Original Engine) │    │  (studio-extension/ — React 19)  │                      │
    │  │                                 │    │                                  │                      │
    │  │  • Queue Library & CRUD         │    │  • @xyflow/react Node Editor     │                      │
    │  │  • Smart Run Monitor            │    │  • Zustand State Store           │                      │
    │  │  • Batch Download (720p–4K)     │    │  • Template Gallery (20+ Built-in│                      │
    │  │  • Auto-Retry & Skip            │    │    + Community)                  │                      │
    │  │  • Prompt History               │    │  • Natural Language Builder      │                      │
    │  │  • Settings (Typing/Wait)       │    │  • Story Director (Cast + World) │                      │
    │  └──────────────┬──────────────────┘    │  • Workflow Runner Engine        │                      │
    │                 │                       └──────────────┬───────────────────┘                      │
    │                 │                                      │                                          │
    │                 └──────────────┬────────────────────────┘                                          │
    │                                │                                                                  │
    │                    ┌───────────▼────────────┐                                                     │
    │                    │  🔧 MV3 Service Worker │                                                     │
    │                    │  (Background Hub)      │                                                     │
    │                    │                        │                                                     │
    │                    │  • Port Management     │                                                     │
    │                    │  • Parked Reply Buffer  │                                                     │
    │                    │  • Alarm Keep-Alive     │                                                     │
    │                    │  • Tab Routing          │                                                     │
    │                    │  • Diagnostic Ring (50) │                                                     │
    │                    └──┬──────────┬──────────┬┘                                                    │
    │                       │          │          │                                                      │
    │          ┌────────────┘    (MessagePort)    └────────────────┐                                     │
    │          ▼                                                   ▼                                     │
    │  ┌───────────────────┐                            ┌───────────────────────────────────────┐       │
    │  │ 🖥️ FFmpeg.wasm    │                            │    🌐 DOM Content Script Adapters     │       │
    │  │  Web Worker       │                            │                                       │       │
    │  │                   │                            │  ┌─────────┐ ┌─────────┐ ┌─────────┐ │       │
    │  │  • Audio Strip    │                            │  │ Google  │ │ ChatGPT │ │ Claude  │ │       │
    │  │  • Lossless Cut   │                            │  │  Flow   │ │  .com   │ │  .ai    │ │       │
    │  │  • Caption Burn   │                            │  │(Veo 3.1)│ │(GPT/DE) │ │(Sonnet) │ │       │
    │  │  • Whisper STT    │                            │  └─────────┘ └─────────┘ └─────────┘ │       │
    │  └───────────────────┘                            │  ┌─────────┐ ┌─────────┐ ┌─────────┐ │       │
    │                                                   │  │ Gemini  │ │  Grok   │ │  Z.AI   │ │       │
    │                                                   │  │.google  │ │  .com   │ │chat.z.ai│ │       │
    │                                                   │  │(Imagen) │ │(Imagine)│ │(GLM-5)  │ │       │
    │                                                   │  └─────────┘ └─────────┘ └─────────┘ │       │
    │                                                   └───────────────────────────────────────┘       │
    └───────────────────────────────────────────────────────────────────────────────────────────────────┘
                    │                                                       │
                    │  (HTTPS: Auth, Usage, Templates)                      │  (Tab automation —
                    ▼                                                       │   runs in user's
    ┌───────────────────────────────────────────────┐                       │   signed-in session)
    │     🔐 Django Backend (api.auto-flow.studio)  │                       ▼
    │                                               │           ┌─────────────────────────┐
    │  • JWT Auth (email/pw + Google OAuth)          │           │   Active AI Web UIs     │
    │  • Plan Enforcement (Free / Pro)               │           │                         │
    │  • Daily Usage Tracking (text/full/queue)      │           │   labs.google/flow      │
    │  • Community Template Moderation               │           │   chatgpt.com           │
    │  • Whop Webhook (Pro subscriptions)            │           │   gemini.google.com     │
    │  • Review Reward System                        │           │   claude.ai             │
    │  • Password Reset Flow                         │           │   grok.com              │
    │  • Prompt Library Endpoints                    │           │   chat.z.ai             │
    └──────────────┬────────────────────────────────┘           └─────────────────────────┘
                   │
                   │  (Quota check before extraction)
                   ▼
    ┌───────────────────────────────────────────────┐
    │  🎥 Extractor Backend (FastAPI / Railway)     │
    │                                               │
    │  • Video URL Download (yt-dlp + RapidAPI)     │
    │  • Direct Video Upload (500MB max)            │
    │  • Gemini 2.5 Flash Vision Analysis           │
    │  • Shot-by-Shot Prompt Extraction             │
    │  • Character Turnaround Generation            │
    │  • Voiceover Transcription                    │
    │  • GCS / Vertex AI (Enterprise Mode)          │
    │  • Google AI Studio (Dev Mode)                │
    └───────────────────────────────────────────────┘

    ┌───────────────────────────────────────────────┐
    │  🔌 AutoFlow MCP Server (Node.js)             │
    │  (Claude Desktop / Cursor / Antigravity)      │
    │                                               │
    │  • Build Workflows from Natural Language       │
    │  • Configure Story Director (Cast + World)     │
    │  • Trigger Runs on Flow / Grok                 │
    │  • Self-Healing Prompt Repair                  │
    │  • Canvas Diagnosis & Auto-Fix                 │
    │  • 18 Autonomous MCP Tools                     │
    └───────────────────────────────────────────────┘
```

The system operates across **five decoupled layers** communicating via structured message passing:

1.  **Website (auto-flow.studio):** Next.js marketing site, Prompt Library, blog, pricing, and i18n — hosted on Vercel.
2.  **Chrome Extension (Manifest V3):** Contains both the **Batch Queue Sidepanel** (original linear queue engine) and the **Studio Canvas** (React 19 node-based workflow editor).
3.  **MV3 Service Worker:** Central hub for port management, alarm keep-alive, tab routing, and parked reply buffering.
4.  **FFmpeg.wasm Web Worker:** Multi-threaded WebAssembly for local audio stripping, lossless cutting, caption burning, and Whisper STT — zero server fees.
5.  **DOM Content Script Adapters:** Six platform-specific adapters that drive Google Flow (Veo 3.1), ChatGPT, Claude, Gemini, Grok, and Z.AI by simulating composer interactions in the user's signed-in browser tabs.
6.  **Django Backend (api.auto-flow.studio):** JWT auth, plan enforcement, usage tracking, community templates, Whop billing webhooks, and Prompt Library endpoints.
7.  **Extractor Backend (FastAPI):** Video-to-prompt reverse engineering via Gemini 2.5 Flash vision, yt-dlp URL downloading, character turnaround generation, and voiceover transcription.
8.  **MCP Server (Node.js):** 18 autonomous tools for Claude Desktop, Cursor, and Antigravity — workflow building, Story Director configuration, run triggering, and self-healing prompt repair.

---

## 🔄 The 5-Phase Technical Blueprint

---

### 🎬 Phase 1: Ingestion & Sub-Second Data Extraction (The Foundation)
**Concept:** Convert raw, uncomputable 20-minute visual assets into structured, queryable data coordinates without committing files to the network.

```
[Raw 20-Min Video File]
       │
       ├─► [FFmpeg.wasm Worker] ──► Extracts 16kHz Mono MP3 (Seconds)
       │                                     │
       │                                     ▼
       │                            [Whisper.wasm Worker / API] ──► [Word-Level JSON Transcript]
       │                                                                      │
       └────────────────────────────── (Multi-Modal Join) ◄───────────────────┘
                                              │
                                              ▼
                                 [Unified Timeline Map]
```

#### 1. Local Audio Stripping (FFmpeg.wasm)
When a user drops an `.mp4` video file into the `TranscriptionNode`'s canvas input, the sidepanel intercepts the asset as a raw binary `Blob`. To bypass Chrome's upload and network bottlenecks, a multi-threaded **WebAssembly compilation of FFmpeg (FFmpeg.wasm)** runs inside an isolated background Web Worker (`worker.js`):

```javascript
// worker.js - FFmpeg WebAssembly Thread Orchestration
import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";

let ffmpeg = null;

self.onmessage = async (e) => {
  const { type, fileBlob } = e.data;
  
  if (type === "LOAD") {
    ffmpeg = new FFmpeg();
    const baseURL = "https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm";
    await ffmpeg.load({
      coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, "text/javascript"),
      wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, "application/wasm"),
    });
    self.postMessage({ type: "LOADED" });
    return;
  }

  if (type === "EXTRACT_AUDIO") {
    if (!ffmpeg) throw new Error("FFmpeg not loaded.");
    
    // Write original video blob to virtual MEMFS
    await ffmpeg.writeFile("input.mp4", await fetchFile(fileBlob));
    
    // Convert audio to 16kHz mono WAV for high-accuracy speech-to-text
    await ffmpeg.exec([
      "-i", "input.mp4",
      "-vn",                  // Strip visual stream
      "-acodec", "pcm_s16le",  // 16-bit PCM codec
      "-ar", "16000",         // 16kHz sample rate
      "-ac", "1",             // Mono audio
      "output.wav"
    ]);

    const data = await ffmpeg.readFile("output.wav");
    const audioBlob = new Blob([data.buffer], { type: "audio/wav" });
    
    self.postMessage({ type: "AUDIO_READY", audioBlob }, [audioBlob.arrayBuffer()]);
  }
};
```

#### 2. Word-Level Timestamp Transcription
The mono WAV is fed into **local Whisper.wasm** running on the client's device or piped to an optimized STT proxy (e.g., ElevenLabs). The transcription is returned not as flat text, but as a detailed **Word-Level Matrix** matching the following JSON contract:

```json
[
  { "word": "housing", "start": 512.24, "end": 512.68 },
  { "word": "market", "start": 512.72, "end": 513.10 },
  { "word": "crash", "start": 513.14, "end": 513.62 }
]
```

#### 3. The Multimodal Spatiotemporal Join
To complete Phase 1, the Director Node overlays this text-time matrix onto visual scene boundaries extracted from the video track using a lightweight visual analysis model (such as a single-pass of the Gemini API or TwelveLabs Pegasus 1.5). 

This merges transition timings (e.g., when slides change, or wide shots cut to close-ups) with the words spoken, generating a unified **Searchable Timeline Map** (a "compact fingerprint" of the file). The canvas now knows the exact millisecond where a spoken phrase aligns with a visual shift.

---

### 🧠 Phase 2: Viral Filtration & Hook Selection (Applying the Clipping Farm Rules)
**Concept:** Evaluate the narrative and psychological value of the transcript to select the most viral 60-second window, executing entirely inside the free Web UI on the client's browser.

```
                                  ┌───────────────────────────┐
                                  │   Target AI Web Tab       │
                                  │   (gemini.google.com)     │
                                  └─────────────┬─────────────┘
                                                │ (Inject DataTransfer)
                                                ▼
┌──────────────────┐              ┌───────────────────────────┐
│ Searchable Map   ├─────────────►│ Drag-and-Drop WAV File    │
└──────────────────┘              └─────────────┬─────────────┘
                                                │ (Write Prompt Schema)
                                                ▼
┌──────────────────┐              ┌───────────────────────────┐
│ Prompt Injector  ├─────────────►│ Execute Send Message      │
└──────────────────┘              └─────────────┬─────────────┘
                                                │ (Scrape & Parse)
                                                ▼
                                  ┌───────────────────────────┐
                                  │  Timing Output Extract    │
                                  │ {"start": 512, "end": 572}│
                                  └───────────────────────────┘
```

#### 1. Zero-API-Key DOM Adapter (Drag-and-Drop Injection)
To pass data to Gemini without paid developer API endpoints, AutoFlow's DOM content script simulates a manual drag-and-drop file upload. It packages the raw video or stripped WAV blob as a virtual file and dispatches a synthetic `DragEvent` with an populated `DataTransfer` payload onto Gemini's rich-text chat container:

```javascript
async function automateGeminiIngestion(fileBlob) {
  const file = new File([fileBlob], "podcast_audio.wav", { type: "audio/wav" });
  const textEditor = document.querySelector('div[contenteditable="true"]');
  if (!textEditor) throw new Error("Gemini chat box input not found.");

  // Construct DataTransfer payload
  const dataTransfer = new DataTransfer();
  dataTransfer.items.add(file);

  // Dispatch Drag and Drop simulation onto the UI
  const events = ["dragenter", "dragover", "drop"];
  events.forEach(evName => {
    const event = new DragEvent(evName, {
      bubbles: true,
      cancelable: true,
      dataTransfer: dataTransfer
    });
    textEditor.dispatchEvent(event);
  });
  console.log("Synthetic file injection executed successfully.");
}
```

#### 2. Whop Clipping Farm Engagement Filtering
With the file loaded into the upload container, the Content Script injects our pre-customized **Short-Form Clipper Skill** system prompt. It is programmed to identify continuous segments that score exceptionally high for short-form retention metrics, targetting a clip between **30 and 200 seconds** (with a strict optimal target of **60 seconds**):

> **Clipper Brain System Prompts:**
> *"Watch this video or listen to the uploaded WAV. You are an elite short-form clipping engine operating under strict Whop clipping farm monetization metrics (maximizing 9:16 vertical viewer retention).
> 
> You must scan the transcript and select the single most engaging continuous segment between **30 seconds and 200 seconds** (target exactly 60 seconds) that adheres to this psychological structure:
> 1. **Pattern-Interrupt Hook (Seconds 0-5):** Uses a high-CPM financial keyword (e.g., inflation, collapse, savings, debt) to interrupt scrolling. Must start with a bold reframe or controversy.
> 2. **The Educational Climb (Seconds 5-50):** A logical, value-rich story or lesson explaining the hook's premise. Must be dense and visually representable.
> 3. **The Retentive Loop (Seconds 50-60):** Closes the value loop and cleanly circles the narrative back to the opening hook sentence, tricking social media algorithms into registering a double-view.
> 
> **Output your result ONLY as a raw, unformatted JSON array.** Do not write markdown blocks (\`\`\`json), explanations, or preambles. Output exactly this format:*
> 
> `[{"start_time": 512.24, "end_time": 572.24, "hook_phrase": "..."}]`"

#### 3. Scraping, Regex Isolation, and Local Cut
The content script polls Gemini’s Web DOM every 1000ms. It watches for the "Stop generating" UI state to transform back into a standard "Send" arrow, indicating stream completion. 

It reads the final chat bubble container, isolates the JSON block using a strict regular expression boundary (`/\[\s*\{[\s\S]*\}\s*\]/`), and passes the parsed result back to our canvas store.

Our connected local **`FFmpegCutterNode`** intercepts the timing coordinates (`512.24` to `572.24`) and instantly runs a local, lossless stream copy cut:

```bash
ffmpeg -i raw_podcast.mp4 -ss 512.24 -to 572.24 -c copy short_clip.mp4
```
This is executed directly on the user's computer in under 3 seconds, keeping server fees at absolute zero.

---

### 🗺️ Phase 3: Canvas Workflow Planning & Director Node Intelligence (The Director)
**Concept:** Act as the "Creative Director" of the visual node editor, programmatically structuring the workspace and storyboarding the 60-second clip timeline.

```
                           ┌────────────────────────────────────────┐
                           │          Clipping Director Node        │
                           │   - Scans 60s script line-by-line      │
                           │   - Creates Visual vs Breather Map     │
                           └──────────────────┬─────────────────────┘
                                              │
                                              ▼ (Programmatic Canvas Spawning)
                      ┌───────────────────────┼───────────────────────┐
                      ▼                       ▼                       ▼
            ┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐
            │ Nano Banana Node │    │ Omni Flash Node  │    │ Subtitle Node    │
            │  (x: 200, y: 150)│    │  (x: 500, y: 150)│    │  (x: 800, y: 150)│
            └──────────────────┘    └──────────────────┘    └──────────────────┘
```

#### 1. Topological Canvas Compilation
The **Clipping Director Node** parses your user-defined custom description or conversational history and uses a layout compiler to plan your canvas coordinates `(x, y)` inside your `@xyflow/react` Zustand store (`src/studio/store.ts`).

It programmatically triggers layout actions, appending nodes and wiring connections dynamically across sockets:

```typescript
// Part of Zustand Store Slice - Programmatic Canvas Compilation
import { addEdge, Connection } from "@xyflow/react";

export const createClippingTimelineSlice = (set, get) => ({
  spawnDirectorPipeline: (startCoordX: number, startCoordY: number) => {
    const uniqueId = Date.now().toString();

    const newNodes = [
      {
        id: `nano-banana-${uniqueId}`,
        type: "nanoBananaNode",
        position: { x: startCoordX, y: startCoordY },
        data: { label: "Design Mockups", styleReference: "cream-vox-theme" }
      },
      {
        id: `omni-flash-${uniqueId}`,
        type: "omniFlashNode",
        position: { x: startCoordX + 300, y: startCoordY },
        data: { label: "Gemini Omni Flash", motionPacing: "12fps" }
      },
      {
        id: `caption-burn-${uniqueId}`,
        type: "captionOverlayNode",
        position: { x: startCoordX + 600, y: startCoordY },
        data: { label: "Styled Subtitles", style: "Kelly-3" }
      }
    ];

    const newEdges = [
      {
        id: `e-banana-omni-${uniqueId}`,
        source: `nano-banana-${uniqueId}`,
        sourceHandle: "image_out",
        target: `omni-flash-${uniqueId}`,
        targetHandle: "image_in"
      },
      {
        id: `e-omni-caption-${uniqueId}`,
        source: `omni-flash-${uniqueId}`,
        sourceHandle: "video_out",
        target: `caption-burn-${uniqueId}`,
        targetHandle: "video_in"
      }
    ];

    set((state) => ({
      nodes: [...state.nodes, ...newNodes],
      edges: [...state.edges, ...newEdges]
    }));
  }
});
```

#### 2. The Line-by-Line Retention Map
The director evaluates the extracted 60-second transcript line-by-line to prevent visual fatigue:
*   **Breather Moments (A-Roll):** Simple dialogue transitions or personal expressions are planned as **raw speaker footage with clean subtitles**. This builds a connection with the speaker and gives the viewer's eyes a crucial moment to rest.
*   **Visual Highlights (B-Roll):** Any line introducing data, abstract concepts, or mechanics (e.g., *"the money was printed"*) is flagged. The Director schedules a high-impact motion graphic, covering the speaker's face entirely with a visual animation.

#### 3. Replicating the Vox Aesthetic (Visual Design Contract)
The Director establishes a locked aesthetic brief that downstream generators must adhere to:
*   **12fps Temporal Stutter (Animating "On Twos"):** To break the smooth, sterile "artificial" look of standard AI video, all visual animations are commanded to output at **12 frames per second** inside a 24fps vertical wrapper. This replicates the tactile, hand-crafted, stop-motion texture signature of Johnny Harris and Vox documentaries.
*   **Tactile Layout:** Paper textures, grayscale photographic collage assets with soft drop shadows, roughened boundaries, subtle film grain overlays, and chromatic aberration blurring the camera borders.
*   **Color Pacing:** Desaturated cream and charcoal slate backgrounds, reserving a **single high-contrast accent color** (like bright orange) exclusively to highlight the focal point of the active scene.

#### 4. The Visual Continuity Contract
To prevent character warping and visual style-drift ("shot amnesia"), the Director builds a **Continuity Contract**:
*   **Face/Environment Registry:** Keeps a strict text description of your subject's physical traits, clothing, and environmental lighting, repeating it across all downstream prompts.
*   **Last Frame Handoff:** It configures your canvas nodes to capture the **final frame of Scene N** and automatically inject it as the **first frame anchor of Scene N+1**. This ensures backgrounds and characters remain completely stable across scene cuts.

---

### 🎨 Phase 4: Creative Asset Design & Gemini Omni Flash Animation (Production)
**Concept:** Utilize an image-first pipeline paired with Gemini Omni Flash's multimodal, conversational video engine to render premium, synchronized animations without keyframing.

```
┌─────────────────────────────────┐
│     Nano Banana 2 Lite Node     │  ◄── Master Style Frame: Cream & Slate Grayscale
└────────────────┬────────────────┘
                 │ (image Socket)
                 ▼
┌─────────────────────────────────┐
│       Start Frame Node          │  ◄── Scene Still: Paper collage map of London
└────────────────┬────────────────┘
                 │ (image Socket)
                 ▼
┌─────────────────────────────────┐
│     Gemini Omni Flash Node      │  ◄── Multimodal Pass: Combines Start Frame + WAV Audio
└─────────────────────────────────┘      + Universal Motion Prompt -> Synchronized Video
```

#### 1. The "Image-First" Workflow (Defeating Style Drift)
Standard text-to-video engines are highly unstable, leading to style morphing across cuts. Phase 4 bypasses this by implementing an **Image-First pipeline**:
1.  **Nano Banana 2 Lite** generates a single **Master Style Frame** (freezing your cream-and-blue paper texture aesthetics).
2.  The node then generates individual **Scene Stills** for each planned visual highlight, using the Master Style Frame as a style reference.
3.  These static stills are loaded as **`<FIRST_FRAME>` anchors** inside the Gemini Omni Flash Node. Since backgrounds, graphics, and characters are already drawn, the model only has to calculate movement. This completely eliminates style drift and keeps your scene graphics stable.

#### 2. Conversational Video-to-Video Editing
Because Gemini Omni maintains a unified, edit-addressable representation of video in its context window, editing is entirely conversational. Instead of restarting on failed renders, you modify the scene's vector space by sending natural-language feedback prompts:

```
Original Clip: [Cream paper collage map of London zooms in smoothly]
   ├── User Turn 2: "Keep the camera path. Warm up the lighting to golden hour."
   └── User Turn 3: "Add the text 'INFLATION' in quotes tracking above the Westminster Bridge."
```
The model changes **only the specific elements you named** while keeping other background assets and camera movements perfectly locked.

#### 3. Keyframe-Free Graphic & Typography Tracking
Instead of manually tracking null objects and adjusting easing graphs, Gemini Omni Flash processes on-screen text coordinates in the same pass as the video pixels:
*   The Director writes natural-language motion prompts: *"Render the subtitle 'REAL ESTATE CRASH' in bold Poppins, and make it track and slide behind the speaker's shoulder as the camera zooms in."*
*   The model renders crisp, stable typography that scales and rotates in 3D perspective with the environment on autopilot.

#### 4. Physics-Aware Motion Simulation
Gemini Omni Flash behaves as a **native physical simulator**. When animating your paper-collage assets, it calculates real-world physical laws like **gravity, drag, inertia, and squish/bounce upon collision**, giving elements a heavy, organic, and professional stop-motion feel.

#### 5. Multimodal Audio-Visual Synchronization
By loading the 60-second voiceover WAV track alongside the visual anchors, Gemini Omni Flash performs **Audio-Driven Visual Generation**. Cuts, camera pans, maps zooms, and on-screen text reveals automatically snap onto the exact rhythmic foley beats and vocal emphasis points of the audio track.

---

### 📝 Phase 5: Automated Subtitles & Quality Control (The Final Check)
**Concept:** Style and overlay high-retention subtitles, analyze the final compiled video, and execute autonomous corrective feedback loops before rendering the output.

```
┌──────────────────────────────┐
│     CaptionOverlayNode       │  ◄── Burns Poppins/Kelly subtitles
└──────────────┬───────────────┘      (White text, word-by-word orange highlights)
               │ (Rendered Video)
               ▼
┌──────────────────────────────┐
│   AgentNode (Gemini QC)      │  ◄── Inspects Lip-Sync, Text Distortion,
└──────────────┬───────────────┘      and Border Clippings
               │
      [Evaluation Check]
               ├─► [FAIL] ──► Modifies prompt and triggers Node Re-Run
               │
               └─► [PASS] ──► Saves final file to /workspace/out/
```

#### 1. The CaptionOverlayNode (Submagic Style)
Using the sub-second Word-Level Matrix JSON from Phase 1, the **CaptionOverlayNode** automates high-retention vertical subtitles:
*   **Formatting Rules:** Centered in the lower-third, utilizing a bold Poppins font (size 28-30) to prevent video elements from being obscured.
*   **Active Word Highlights:** Text is rendered in clean white, with the active spoken word dynamically turning bright orange with a subtle scale-up.

#### 2. AgentNode Multimodal Loop Verification (QC)
Before showing the clip to the user, your canvas triggers an **AgentNode** running a Gemini multi-modal inspection loop. It acts as a digital QC engineer checking the output frame-by-frame:
1.  **Verification Pass:** The AgentNode "watches" the newly animated segment, comparing the output video frames against the original script timeline and visual guidelines.
2.  **The Checklist:**
    *   **Text Distortion Check:** Ensure that any text labels rendered on charts are spelled correctly and do not mutate or blur across frames.
    *   **Lip-Sync Accuracy:** Verify that the speaker’s mouth patterns correspond accurately to the voiceover timestamps.
    *   **Border Clipping:** Ensure that motion-collage elements do not awkwardly scale past the 9:16 vertical crop borders.
3.  **Self-Correction Run:** If a visual glitch or error is detected, the AgentNode automatically modifies the prompt parameters, feeds the correction back to the generator, and triggers a re-run of the canvas segment on autopilot.

---

## 🔌 Canvas Data Sockets & State Contracts

To wire these phases together, the visual canvas utilizes four strongly-typed handles defined in your React Flow routing architecture (`connect.ts`):

| Sockets (Handle ID) | Type | Color | Description |
| :--- | :--- | :--- | :--- |
| `raw_video_blob` | File/Blob | Blue | Raw video stream payload |
| `transcript_json` | JSON Object | Teal | Word-level coordinate dataset |
| `time_span` | JSON Object | Red | Clip boundary timestamps `{start, end}` |
| `scene_beat_map` | JSON Array | Magenta | Chronological animation design brief |

### Example Schema of the Output Node Payload (`scene_beat_map`):
```json
[
  {
    "scene_index": 1,
    "time_span": { "start": 0.0, "end": 5.24 },
    "edit_type": "A-Roll",
    "caption": "If you think your bank account is safe, look at this..."
  },
  {
    "scene_index": 2,
    "time_span": { "start": 5.24, "end": 14.80 },
    "edit_type": "B-Roll-Graphic",
    "still_image_prompt": "A minimal paper-cutout bar chart, cream background, rising charcoal-gray bars with an orange highlight arrow, 2.5D drop shadows.",
    "motion_prompt": "A continuous dolly zoom, paper bars animate scaling up at a choppy 12fps temporal stutter, subtle film grain.",
    "caption": "The national debt grew by twelve percent in under three months."
  }
]
```

---

## 📂 Workspace Directory Layout

During active development, files must be structured within the standard AutoFlow directory layout:

```
/workspace/
├── scratch/
│   └── clipping-director/            ← Node working files and scripts
│       ├── worker.js                 ← Multi-threaded Web Worker for FFmpeg.wasm
│       ├── styles.json               ← Locked Vox-style frame templates
│       └── temp_audio.wav            ← Stripped 16kHz mono audio file
└── out/
    └── dev-planning-blueprint-v2.md  ← Final published developer manual
```

This ensures that intermediate audio stripping and temporary image assets do not clutter the user's permanent permanent storage, and are compiled only when the video passes the final quality check.
