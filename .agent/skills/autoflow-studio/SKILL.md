---
name: autoflow-studio
description: Autonomous AI Video Production & Story Director workflow builder using AutoFlow Studio MCP. Use when creating multi-shot cinematic videos, locking character continuity, or running self-healing prompt loops for Google Flow (Veo 3.1) and Grok.
---

# AutoFlow Studio — AI Video Production Skill

This skill teaches AI agents (Claude, Cursor, Antigravity, ChatGPT) how to create, direct, and self-heal multi-shot AI video pipelines in **AutoFlow Studio** using the Model Context Protocol (MCP).

---

## 🎬 1. The 3-Tier Story Director Structure

Every multi-shot video MUST be structured across 3 clean layers:

1. **CAST + WORLD (Invariant Identity):**
   * Specify every character once with permanent physical tags:
     * `[Character ID: Name, age, hair style & exact color, skin tone, facial features, outfit layers, key accessories]`.
   * Never let clothing or facial traits mutate between shots.
2. **LOOK (Visual Presets):**
   * Global style tag applied consistently (e.g., `Cinematic 35mm, anamorphic lens flare, moody volumetric lighting, Kodak Portra 400 color grade`).
3. **STRUCTURE (Shot Coverage & Camera Progression):**
   * Vary camera distance across the narrative arc:
     * `Shot 1`: Wide establishing context or subject entrance.
     * `Shot 2`: Medium tracking or dynamic over-the-shoulder motion.
     * `Shot 3`: Dramatic close-up or climactic reaction.

---

## 🛠️ 2. MCP Tool Execution Guidelines

When working with `autoflow-mcp`:

### A. Creating a New Video Story
Call `studio_create_story_graph` with:
* `brief`: Clean concept summary.
* `structure`: `'commercial' | 'threeAct' | 'hookAndCut' | 'montage'`.
* `shotCount`: Typically 3 to 5 shots.
* `camera`: `'dynamic' | 'establishingToClose' | 'actionTracking' | 'propped'`.
* `cast`: Array of characters with strict `look` descriptions.

### B. Starting the Generation Pipeline
1. Call `studio_run_pipeline()`.
2. Call `studio_get_canvas()` periodically to monitor node progress (`running`, `done`, `error`).

### C. Self-Healing Prompt Loop (Error Diagnosis & Repair)
If a node status is `error`:
1. Call `studio_read_node_details({ nodeId })` to read the error message and failed prompt.
2. **If Content Safety Error:** Replace banned/sensitive words with neutral cinematic descriptors (e.g., replace "explosive charge" with "dramatic glowing shockwave").
3. **If Character Drift:** Re-inject the full character look description at the front of the prompt.
4. Call `studio_modify_prompt({ nodeId, prompt: newPrompt })`.
5. Call `studio_rerun_node({ nodeId })` to retry only that specific shot!

---

## 📋 3. Example MCP Workflow Call

```json
{
  "name": "studio_create_story_graph",
  "arguments": {
    "brief": "A heroic astronaut discovering a crystal power source inside a dark cave on an icy alien moon.",
    "structure": "threeAct",
    "shotCount": 3,
    "camera": "dynamic",
    "cast": [
      {
        "name": "Commander Vance",
        "look": "40s male astronaut, short silver hair, rugged jawline, white EVA spacesuit with vibrant orange chest telemetry plates, gold visor helmet",
        "role": "lead"
      }
    ]
  }
}
```
