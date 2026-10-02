# 🔌 AutoFlow MCP Server

Official **Model Context Protocol (MCP)** server for **AutoFlow Studio** and **AutoFlow Queue Manager**.

Enables **Claude Desktop**, **Cursor**, and **Antigravity** to:
1. 🎨 **Build Multi-Shot Video Workflows** from natural language.
2. 🎭 **Configure Story Director** (Character Casts, Wardrobe Locks, Camera Progression).
3. 🚀 **Execute Generations** on Google Flow and Grok autonomously.
4. 🩺 **Self-Healing Prompt Repair** (Automatically detects failed or mutated clips, fixes prompt wording, and re-renders only the failed shot).

---

## ⚡ 1-Minute Quickstart

### Option A: Use with Claude Desktop

Add this configuration to your Claude Desktop config file:

* **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`
* **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "autoflow": {
      "command": "node",
      "args": ["c:/Users/HP PROBOOK/Desktop/autoflow/autoflow-mcp-server/dist/index.js"]
    }
  }
}
```

### Option B: Use with Cursor IDE

In Cursor:
1. Open **Cursor Settings** &rarr; **Features** &rarr; **MCP**.
2. Click **+ Add New MCP Server**.
3. Name: `autoflow`
4. Type: `command`
5. Command: `node "c:/Users/HP PROBOOK/Desktop/autoflow/autoflow-mcp-server/dist/index.js"`

---

## 🛠️ Available MCP Tools (18 Autonomous Tools)

### 🧠 Autonomous Diagnosis & Self-Healing (NEW)
| Tool Name | Description |
| :--- | :--- |
| `studio_diagnose_canvas` | 🔬 Autonomously scans the entire canvas and detects any issues: missing prompts, unfed Story Directors, broken Last Frame links, AI safety filter trigger words, and missing audio tags. |
| `studio_auto_fix_canvas` | 🛠️ Autonomously repairs all issues on the canvas in one shot: connects missing Idea nodes to Story Directors, resets failed nodes, injects missing Veo 3.1 audio tags, and cleanses prompt trigger words. |
| `studio_smart_supervise_run` | 🚀 Supervises the full video production end-to-end: runs pre-flight diagnosis, auto-fixes issues, starts execution, monitors real-time progress, and auto-heals any failed nodes. |
| `studio_self_heal_node` | 🩹 Self-heals a single failed node with automatic prompt mutation (removes safety triggers, reinforces character locks, adds volumetric lighting). |

### 📊 Real-Time Telemetry & Inspection
| Tool Name | Description |
| :--- | :--- |
| `studio_get_pipeline_status` | Returns real-time percentage progress, active node, and completion counts across the canvas. |
| `studio_wait_for_completion` | Asynchronously polls the canvas until all generating nodes complete. |
| `studio_inspect_generations` | Returns a structured report of all generated media: video URLs, image stills, and error logs. |
| `studio_get_canvas` | Reads all nodes, execution statuses, outputs, and edge connections. |
| `studio_read_node_details` | Inspects a single node: prompt, generated video URL, or error details. |

### 🎬 Workflow Orchestration & Control
| Tool Name | Description |
| :--- | :--- |
| `studio_create_story_graph` | Builds a complete 9:16 vertical / 16:9 cinematic storyboard sequence from natural language with character locks. |
| `studio_modify_prompt` | Rewrites or fixes the prompt of any node on the canvas. |
| `studio_rerun_node` | Re-executes only the failed node without restarting the entire pipeline. |
| `studio_run_pipeline` | Starts execution of all runnable nodes on Google Flow / Grok. |
| `studio_stop_pipeline` | Cancels or pauses active runs. |
| `studio_clear_canvas` | Clears all nodes and edges from the canvas, giving a clean fresh board. |
| `studio_set_workflow` | Atomically replaces the entire workflow with a custom array of nodes and edges. |
| `studio_add_node` | Injects an individual node (`prompt`, `generate`, `image`, `story`, `frame`, `extend`). |
| `studio_connect_nodes` | Wires input/output handles between canvas nodes. |

---

## 💬 Example Prompts You Can Give Claude / Antigravity:

> *"Check my AutoFlow Studio canvas for any broken connections, missing audio tags, or safety words, and fix them automatically."* (`studio_diagnose_canvas` + `studio_auto_fix_canvas`)

> *"Build a 4-shot vertical 9:16 Pixar 3D story about baby dragon Emberlyn trying to toast a tiny marshmallow, lock the character continuity, and supervise the generation."* (`studio_create_story_graph` + `studio_smart_supervise_run`)
