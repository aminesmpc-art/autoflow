# Architectural Blueprint: Integrating AutoClip into AutoFlow's Clipping Node

This document outlines the **exact architectural components, data models, and prompt pipelines** to copy from AutoClip and integrate directly into AutoFlow's **`ClippingNode`** (`studio-extension/src/studio/nodes/ClippingNode.tsx` and `studio/clip/`).

---

## 🏛️ Unified System Architecture

```mermaid
graph TB
    subgraph Input["1. Input Sources"]
        VideoFile[Local MP4 / Web Video]
        AudioTrack[Audio Waveform & Subtitles]
    end

    subgraph AutoFlow_Native["2. AutoFlow Native Processing (Client/Browser)"]
        Peaks[Audio Peak & Silence Detection\n(peaks.ts)]
        FaceTrack[Face Reframe & 9:16 Crop\n(reframe.ts)]
        RegexFilters[Shallow Linguistic Filters\n(textMoments.ts)]
    end

    subgraph AutoClip_Copied["3. AutoClip Upgrades to Inject (The Brain)"]
        Stage1[Stage 1: Outline Extractor & Boundary Snap]
        Stage2[Stage 2: 4-Pillar Highlight Scoring (0–100)]
        Stage3[Stage 3: Viral Hook & Multi-Platform Titles]
        Stage4[Stage 4: Thematic Compilation Sequencer]
    end

    subgraph Output_Node["4. Enhanced Clipping Node Output"]
        Clips[Individual Ranked Short Clips (9:16)]
        Hooks[3-Sec Text Overlay + Social Metadata]
        Compilation[Curated 3-5 Min 'Top Moments' Reel]
    end

    VideoFile --> AudioTrack
    AudioTrack --> Peaks & RegexFilters
    Peaks & RegexFilters --> Stage1
    Stage1 --> Stage2
    Stage2 --> Stage3
    Stage3 --> Stage4
    Stage2 --> FaceTrack
    FaceTrack --> Clips
    Stage3 --> Hooks
    Stage4 --> Compilation
```

---

## 📦 The 4 Key Modules to Copy & Integrate

### Module 1: The 4-Stage LLM Evaluation Pipeline (`semanticClipper.ts`)
* **Current AutoFlow State:** Relies primarily on shallow regex (`TURN`, `ADVICE`, `QUESTION`, `SPECIFIC` in `textMoments.ts`) and audio loudness (`peaks.ts`). This is fast but misses deeper conceptual value or subtle humor.
* **Architecture to Copy:**
  1. Use regex and audio peaks as the **pre-filter shortlist** (top 15 candidate spans).
  2. Send those candidates into the **AutoClip Multi-Factor Scorer** (Hook 30%, Core Value 40%, Standalone 20%, Shareability 10%).
  3. Calculate a final confidence score `0–100` with an explicit reason (`why`).

```typescript
// Proposed structure for studio/clip/semanticClipper.ts
export interface SemanticClipResult {
  id: string;
  start: number;
  end: number;
  duration: number;
  score: number; // 0 - 100
  hookText: string; // 3-second on-screen text overlay
  titles: {
    tiktok: string;
    youtubeShorts: string;
    reels: string;
  };
  summary: string;
  category: 'business' | 'knowledge' | 'entertainment' | 'general';
  rationale: string;
}
```

---

### Module 2: Multi-Platform Metadata & Hook Generator (`socialPackager.ts`)
* **Architecture to Copy:**
  * Takes each approved clip and automatically generates:
    * **3-Second Hook Overlay:** Short text (<7 words) designed to be read in 1.5 seconds.
    * **Platform-Specific Titles:** Casual for TikTok, High-Contrast/Emoji for YouTube Shorts, Story-driven for Reels.
    * **Relevant Hashtags:** Tag suggestions extracted from the topic.

---

### Module 3: Thematic Compilation Sequencer (`compilationDirector.ts`)
* **Current AutoFlow State:** Generates individual, isolated clips.
* **Architecture to Copy:**
  * Groups related micro-clips into a cohesive 3–5 minute compilation (e.g., "Top 3 Mistakes Founders Make").
  * Orders clips strategically:
    1. **Clip 1:** The most explosive hook.
    2. **Middle Clips:** Dense instructional or humorous value.
    3. **Final Clip:** Emotional resolution / Call to action.
  * Outputs title cards between clips.

---

### Module 4: Lossless Video Slicing Adapter (`losslessCutter.ts`)
* **Architecture to Copy:**
  * When running through your backend (`extractor-backend`) or local desktop engine, use FFmpeg's stream copy:
    ```bash
    ffmpeg -ss {start} -to {end} -i input.mp4 -c copy -avoid_negative_ts 1 output.mp4
    ```
  * Exports 60-second clips in **under 1.5 seconds** without re-rendering pixels.

---

## 🎛️ UI Updates for `ClippingNode.tsx`

To expose these new capabilities inside the AutoFlow Canvas Node, add these controls to `ClippingNode.tsx`:

```tsx
/* Proposed Controls for ClippingNode.tsx */
<div className="clipping-node-controls">
  {/* Genre Selector */}
  <label>Content Niche</label>
  <select value={data.category} onChange={setCategory}>
    <option value="auto">✨ Auto Detect (Gemini 3.7)</option>
    <option value="business">💼 Business & Finance</option>
    <option value="knowledge">🧠 Science & Masterclass</option>
    <option value="entertainment">🎭 Comedy & Podcast</option>
  </select>

  {/* Viral Score Threshold Slider */}
  <label>Minimum Viral Score (0–100)</label>
  <input 
    type="range" 
    min="60" 
    max="95" 
    value={data.minScore || 75} 
    onChange={setMinScore} 
  />

  {/* Output Modes */}
  <label className="checkbox-row">
    <input type="checkbox" checked={data.generateHooks} />
    <span>Generate 3-Second Visual Hook Overlays</span>
  </label>
  
  <label className="checkbox-row">
    <input type="checkbox" checked={data.generateCompilations} />
    <span>Generate Thematic 'Top Highlights' Compilations</span>
  </label>
</div>
```

---

## 🚀 Step-by-Step Implementation Flow

1. **Step 1:** Load the English prompt templates from [`autoclip-prompts/`](file:///c:/Users/HP%20PROBOOK/Desktop/autoflow/autoclip-prompts/README.md) into `studio-extension/src/studio/clip/prompts.ts`.
2. **Step 2:** In `studio-extension/src/studio/clip/runClip.ts`, after `findTextMoments` generates candidate spans, call Gemini 3.7 using `universal_scoring_prompt.md`.
3. **Step 3:** Attach the generated `hookText` and `titles` to the final `ClipPlan` output.
4. **Step 4:** Render the resulting ranked clips and title cards in the canvas node UI.
