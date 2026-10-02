#!/usr/bin/env node
/* ============================================================
   AutoFlow MCP Server v2.0 — Smart Structured Feedback
   Enables Claude Desktop, Cursor, and Antigravity to build,
   execute, inspect, and self-heal AI video workflows in AutoFlow Studio.

   Every tool response follows the Dual-Content pattern:
   1. Human-readable summary (what happened, why, what to do next)
   2. Machine-parseable structured JSON (for agentic workflows)
   ============================================================ */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';

/* ── Types ── */

type ErrorCategory = 'connection' | 'transient' | 'validation' | 'business' | 'internal';

interface ResponseMeta {
  tool?: string;
  durationMs?: number;
  connectedClients?: number;
  timestamp?: string;
  [key: string]: any;
}

interface ErrorOpts {
  isRetryable?: boolean;
  suggestedTool?: string;
  suggestedArgs?: Record<string, any>;
  partialData?: any;
}

/* ── Structured Response Helpers ── */

/**
 * Builds a successful MCP tool response with dual-content:
 * 1. Human-readable summary text
 * 2. Machine-parseable JSON with data + metadata
 */
function buildResponse(summary: string, data: any, meta?: ResponseMeta) {
  const structured = {
    success: true,
    data,
    meta: {
      timestamp: new Date().toISOString(),
      connectedClients: connectedClients.size,
      ...meta,
    },
  };

  return {
    content: [
      { type: 'text' as const, text: summary },
      { type: 'text' as const, text: '```json\n' + JSON.stringify(structured, null, 2) + '\n```' },
    ],
  };
}

/**
 * Builds a structured MCP error response following the
 * "What happened? Why? How to fix?" pattern.
 */
function buildError(
  what: string,
  why: string,
  howToFix: string,
  category: ErrorCategory,
  opts?: ErrorOpts,
) {
  const structured = {
    success: false,
    error: {
      what,
      why,
      howToFix,
      category,
      isRetryable: opts?.isRetryable ?? false,
      suggestedTool: opts?.suggestedTool ?? null,
      suggestedArgs: opts?.suggestedArgs ?? null,
    },
    partialData: opts?.partialData ?? null,
    meta: {
      timestamp: new Date().toISOString(),
      connectedClients: connectedClients.size,
    },
  };

  let summaryLines = [
    `ERROR: ${what}`,
    `Cause: ${why}`,
    `Fix: ${howToFix}`,
  ];
  if (opts?.suggestedTool) {
    summaryLines.push(`Suggested tool: ${opts.suggestedTool}`);
  }

  return {
    content: [
      { type: 'text' as const, text: summaryLines.join('\n') },
      { type: 'text' as const, text: '```json\n' + JSON.stringify(structured, null, 2) + '\n```' },
    ],
    isError: true,
  };
}

/** Summarizes canvas node breakdown for human-readable output */
function summarizeNodes(nodes: any[]) {
  const byType: Record<string, number> = {};
  const byStatus: Record<string, number> = {};
  for (const n of nodes) {
    const t = n.type || (n.data as any)?.type || 'unknown';
    const s = (n.data as any)?.status || n.status || 'idle';
    byType[t] = (byType[t] || 0) + 1;
    byStatus[s] = (byStatus[s] || 0) + 1;
  }
  const typeStr = Object.entries(byType).map(([k, v]) => `${v} ${k}`).join(', ');
  const statusStr = Object.entries(byStatus).map(([k, v]) => `${v} ${k}`).join(', ');
  return { byType, byStatus, typeStr, statusStr };
}

/** Runs a quick pre-flight diagnosis directly from canvas state */
function runDiagnosis(nodes: any[], edges: any[]) {
  const issues: any[] = [];

  if (nodes.length === 0) {
    issues.push({
      id: 'empty_canvas',
      type: 'EMPTY_CANVAS',
      severity: 'critical',
      message: 'Canvas is empty — no nodes found.',
      fix: 'Call studio_create_story_graph to build a storyboard, or studio_add_node to add individual nodes.',
    });
    return { healthy: false, criticalCount: 1, warningCount: 0, infoCount: 0, issues };
  }

  for (const n of nodes) {
    const d = (n.data || {}) as any;
    const nodeType = n.type || d.type;
    const nodeLabel = d.label || n.id;

    // Story Director checks
    if (nodeType === 'story') {
      const hasUpstreamText = edges.some((e: any) => e.target === n.id && (e.targetHandle === 'text' || !e.targetHandle));
      const hasBrief = !!(d.brief || d.prompt || '').trim();
      if (!hasUpstreamText && !hasBrief) {
        issues.push({
          id: `story_unfed_${n.id}`,
          nodeId: n.id,
          type: 'UNFED_STORY_DIRECTOR',
          severity: 'critical',
          message: `Story Director "${nodeLabel}" has NO idea connected and no written brief.`,
          fix: `Call studio_add_node (type="prompt") to create a brief, then studio_connect_nodes (source=<promptId>, target="${n.id}", sourceHandle="text", targetHandle="text") to wire it.`,
        });
      }
    }

    // Generator checks
    if (nodeType === 'generate') {
      const prompt = (d.prompt || '').trim();
      const hasUpstreamText = edges.some((e: any) => e.target === n.id && (e.targetHandle === 'text' || !e.targetHandle));

      if (!prompt && !hasUpstreamText) {
        issues.push({
          id: `empty_prompt_${n.id}`,
          nodeId: n.id,
          type: 'EMPTY_PROMPT',
          severity: 'critical',
          message: `Generator "${nodeLabel}" has an empty prompt and no upstream text connection.`,
          fix: `Call studio_modify_prompt (nodeId="${n.id}", prompt="<your prompt>") or wire a Story Director to it.`,
        });
      }

      // Missing audio tags
      if (prompt && !/ambient noise:|sfx:/i.test(prompt)) {
        issues.push({
          id: `missing_audio_${n.id}`,
          nodeId: n.id,
          type: 'MISSING_AUDIO_TAGS',
          severity: 'warning',
          message: `Generator "${nodeLabel}" prompt is missing Veo 3.1 joint audio tags (Ambient noise: / SFX:).`,
          fix: 'Call studio_auto_fix_canvas to inject audio tags automatically.',
        });
      }

      // Safety risk words
      const safetyWords = prompt.match(/\b(gun|weapon|blood|kill|attack|explod|burst|naked|nude|drugs?|cocaine|heroin)\w*/gi);
      if (safetyWords && safetyWords.length > 0) {
        issues.push({
          id: `safety_risk_${n.id}`,
          nodeId: n.id,
          type: 'SAFETY_RISK_WORDS',
          severity: 'warning',
          message: `Generator "${nodeLabel}" contains safety risk words: ${safetyWords.join(', ')}. These may trigger Google Flow / Grok rejection.`,
          fix: 'Call studio_auto_fix_canvas to replace them with safe cinematic alternatives.',
        });
      }

      // Error state
      if (d.status === 'error') {
        issues.push({
          id: `node_failed_${n.id}`,
          nodeId: n.id,
          type: 'PREVIOUSLY_FAILED_NODE',
          severity: 'warning',
          message: `Node "${nodeLabel}" is stuck in error state: "${d.errorMessage || d.statusNote || 'Unknown'}"`,
          fix: 'Call studio_auto_fix_canvas to reset all failed nodes to idle.',
        });
      }
    }

    // Story Director error state
    if (nodeType === 'story' && d.status === 'error') {
      issues.push({
        id: `story_failed_${n.id}`,
        nodeId: n.id,
        type: 'PREVIOUSLY_FAILED_NODE',
        severity: 'warning',
        message: `Story Director "${nodeLabel}" is stuck in error state: "${d.errorMessage || 'Unknown'}"`,
        fix: 'Call studio_auto_fix_canvas to reset it to idle.',
      });
    }
  }

  // Frame extractor checks
  const frameNodes = nodes.filter((n: any) => (n.type || (n.data as any)?.type) === 'frame');
  for (const fn of frameNodes) {
    const hasInput = edges.some((e: any) => e.target === fn.id);
    const hasOutput = edges.some((e: any) => e.source === fn.id);
    if (!hasInput || !hasOutput) {
      issues.push({
        id: `unwired_frame_${fn.id}`,
        nodeId: fn.id,
        type: 'UNWIRED_FRAME_EXTRACTOR',
        severity: 'warning',
        message: `Last Frame "${(fn.data as any)?.label || fn.id}" is not fully wired (input: ${hasInput}, output: ${hasOutput}).`,
        fix: 'Check the canvas wiring — this frame node should receive a video input and feed the next shot.',
      });
    }
  }

  const criticalCount = issues.filter(i => i.severity === 'critical').length;
  const warningCount = issues.filter(i => i.severity === 'warning').length;
  const infoCount = issues.filter(i => i.severity === 'info').length;

  return {
    healthy: criticalCount === 0,
    totalIssues: issues.length,
    criticalCount,
    warningCount,
    infoCount,
    issues,
  };
}

/* ── WebSocket + HTTP Bridge ── */

const WS_PORT = 8124;
const connectedClients = new Set<WebSocket>();
const pendingRequests = new Map<string, { resolve: (res: any) => void; reject: (err: any) => void }>();

let wss: WebSocketServer | null = null;
let httpServer: http.Server | null = null;

try {
  httpServer = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Allow-Private-Network', 'true');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === 'POST' && req.url === '/api/rpc') {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', async () => {
        try {
          const { action, params } = JSON.parse(body || '{}');
          const result = await sendToExtensionDirect(action, params);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, result }));
        } catch (err: any) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: err?.message || String(err) }));
        }
      });
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', mcp: 'autoflow', version: '2.0.0', clients: connectedClients.size }));
  });

  wss = new WebSocketServer({
    server: httpServer,
    perMessageDeflate: false,
    verifyClient: (info, callback) => {
      callback(true);
    },
  });

  wss.on('connection', (ws) => {
    connectedClients.add(ws);
    console.error(`[AutoFlow MCP] Chrome Extension connected on port ${WS_PORT} (Total: ${connectedClients.size})`);

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'response' && msg.id && pendingRequests.has(msg.id)) {
          const handler = pendingRequests.get(msg.id)!;
          pendingRequests.delete(msg.id);
          if (msg.error) {
            handler.reject(new Error(msg.error));
          } else {
            handler.resolve(msg.result);
          }
        }
      } catch (err) {
        console.error('[AutoFlow MCP] Failed to process extension message:', err);
      }
    });

    ws.on('close', () => {
      connectedClients.delete(ws);
      console.error(`[AutoFlow MCP] Chrome Extension disconnected (Remaining: ${connectedClients.size})`);
    });
  });

  wss.on('error', (err: any) => {
    if (err.code !== 'EADDRINUSE') {
      console.error('[AutoFlow MCP] WebSocket server error:', err);
    }
  });

  httpServer.on('error', (err: any) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`[AutoFlow MCP] Port ${WS_PORT} is in use by running background daemon — attaching to existing bridge.`);
    } else {
      console.error('[AutoFlow MCP] HTTP server error:', err);
    }
  });

  httpServer.listen(WS_PORT, '0.0.0.0', () => {
    console.error(`[AutoFlow MCP] HTTP & WebSocket bridge listening on http://127.0.0.1:${WS_PORT} and ws://127.0.0.1:${WS_PORT}`);
  });
} catch (err: any) {
  console.error('[AutoFlow MCP] Server init error:', err.message);
}

/** Direct RPC handler for connected WebSockets */
async function sendToExtensionDirect(action: string, params: any = {}): Promise<any> {
  const activeWs = Array.from(connectedClients).find((ws) => ws.readyState === WebSocket.OPEN);
  if (!activeWs) {
    throw new Error(
      'NO_EXTENSION_CONNECTED'
    );
  }

  const id = `req_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const message = { id, type: 'request', action, params };

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingRequests.delete(id);
      reject(new Error(`TIMEOUT:${action}`));
    }, 15000);

    pendingRequests.set(id, {
      resolve: (res) => { clearTimeout(timeout); resolve(res); },
      reject: (err) => { clearTimeout(timeout); reject(err); },
    });

    connectedClients.forEach((ws) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(message));
      }
    });
  });
}

/** Smart RPC sender with daemon fallback and structured error wrapping */
async function sendToExtension(action: string, params: any = {}): Promise<any> {
  if (connectedClients.size > 0) {
    return sendToExtensionDirect(action, params);
  }

  try {
    const response = await fetch(`http://127.0.0.1:${WS_PORT}/api/rpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, params }),
    });
    const data: any = await response.json();
    if (data.success) {
      return data.result;
    }
    throw new Error(data.error || 'Daemon request failed');
  } catch (err: any) {
    if (err.message && !err.message.includes('fetch failed') && !err.message.includes('ECONNREFUSED')) {
      throw err;
    }
  }

  return sendToExtensionDirect(action, params);
}

/** Wraps sendToExtension with structured error handling */
async function safeCallExtension(action: string, params: any = {}, toolName: string): Promise<any> {
  try {
    return await sendToExtension(action, params);
  } catch (err: any) {
    const msg = err?.message || String(err);

    if (msg === 'NO_EXTENSION_CONNECTED') {
      throw {
        __structured: true,
        ...buildError(
          'AutoFlow Studio extension is not connected in Chrome.',
          'No WebSocket clients are connected on port 8124. The extension may not be installed, or the Studio tab may not be open.',
          'Open Google Chrome, go to the AutoFlow Studio tab (studio.html), and verify the green "MCP Active" badge is visible in the top-right corner.',
          'connection',
          { isRetryable: false },
        ),
      };
    }

    if (msg.startsWith('TIMEOUT:')) {
      throw {
        __structured: true,
        ...buildError(
          `Request to Chrome extension timed out for action "${action}".`,
          'The extension did not respond within 15 seconds. This usually means the canvas is frozen, Chrome is under heavy load, or the tab was closed.',
          'Refresh the AutoFlow Studio tab (F5), wait a few seconds, then retry the same tool call.',
          'transient',
          { isRetryable: true, suggestedTool: toolName },
        ),
      };
    }

    throw err;
  }
}

/* ── Tool Definitions with Annotations ── */
const TOOLS: Tool[] = [
  {
    name: 'studio_create_story_graph',
    description:
      'Creates a complete multi-shot story workflow on the AutoFlow Studio canvas. Builds a Story Brief prompt node, Story Director, shot generators with character locks, and last-frame continuity chains. Returns structured node/edge counts and IDs.',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false, title: 'Create Story Graph' },
    inputSchema: {
      type: 'object',
      properties: {
        brief: {
          type: 'string',
          description: 'High level story concept (e.g. "A cute baby dragon eating spicy pepper and getting sparkling hiccups").',
        },
        structure: {
          type: 'string',
          enum: ['hook', 'transform', 'loop', 'ugcAd', 'asmrCraft', 'free'],
          description: 'Narrative structure style.',
        },
        shotCount: { type: 'number', description: 'Number of consecutive video shots (3-6).' },
        camera: {
          type: 'string',
          enum: ['dynamic', 'establishingToClose', 'actionTracking', 'asmrMacro', 'propped', 'fixed'],
          description: 'Director camera progression style.',
        },
        audioMode: {
          type: 'string',
          enum: ['cinematic', 'asmr', 'ambient', 'dialogue', 'none'],
          description: 'Veo 3.1 sound design mode.',
        },
        visualPreset: {
          type: 'string',
          enum: ['cgi3d', 'asmrCraft', 'liveAction', 'smartphonePOV', 'cinema35mm', 'anime', 'none'],
          description: 'Visual rendering style.',
        },
        aspectRatio: {
          type: 'string',
          enum: ['9:16', '16:9', '1:1', '2:3', '3:2', '4:3', '3:4'],
          description: 'Aspect ratio.',
        },
        duration: { type: 'string', enum: ['4s', '6s', '8s', '10s'], description: 'Duration per shot.' },
        world: { type: 'string', description: 'Setting and environment.' },
        look: { type: 'string', description: 'Lighting, color grading, lens aesthetics.' },
        cast: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              look: { type: 'string', description: 'Full invariant visual description.' },
              role: { type: 'string' },
              voice: { type: 'string' },
            },
            required: ['name', 'look'],
          },
          description: 'Characters with visual continuity locks.',
        },
      },
      required: ['brief'],
    },
  },
  {
    name: 'studio_get_canvas',
    description: 'Reads the entire canvas state: all nodes, statuses, prompts, outputs, and edge connections. Returns a human-readable summary alongside full structured data.',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false, title: 'Get Canvas State' },
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'studio_get_pipeline_status',
    description: 'Returns real-time pipeline execution status: running/paused state, node-by-node progress, completion counts, and any error messages.',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false, title: 'Get Pipeline Status' },
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'studio_wait_for_completion',
    description: 'Polls the canvas until all generating nodes complete or timeout. Returns final status with per-node results.',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false, title: 'Wait for Completion' },
    inputSchema: {
      type: 'object',
      properties: {
        timeoutSeconds: { type: 'number', description: 'Max wait time in seconds (default 600).' },
        pollIntervalSeconds: { type: 'number', description: 'Poll interval in seconds (default 4).' },
      },
    },
  },
  {
    name: 'studio_inspect_generations',
    description: 'Returns a structured report of all generated media: video URLs, image stills, preview data, generation status, and error logs for each generator node.',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false, title: 'Inspect Generations' },
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'studio_diagnose_canvas',
    description: 'Pre-flight scanner: inspects every node and cable on the canvas to find potential failures BEFORE you spend generation credits. Detects unfed Story Directors, empty prompts, missing audio tags, safety risk words, broken frame extractors, and stuck error states. Returns prioritized actionable issues with exact fix instructions.',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false, title: 'Diagnose Canvas' },
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'studio_auto_fix_canvas',
    description: 'One-shot auto-repair: fixes all issues found by studio_diagnose_canvas. Resets failed nodes, injects audio tags, replaces safety words, and adds missing briefs. Returns a detailed fix report.',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false, title: 'Auto-Fix Canvas' },
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'studio_smart_supervise_run',
    description: 'Full autonomous video production supervisor: diagnoses → auto-fixes → runs pipeline → monitors progress → self-heals failures. Returns complete production asset report.',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false, title: 'Smart Supervised Run' },
    inputSchema: {
      type: 'object',
      properties: {
        timeoutSeconds: { type: 'number', description: 'Max supervision time in seconds (default 300).' },
      },
    },
  },
  {
    name: 'studio_self_heal_node',
    description: 'Autonomous prompt repair for a single node: diagnoses safety triggers, motion glitches, or character drift, rewrites the prompt, and triggers a targeted re-render.',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false, title: 'Self-Heal Node' },
    inputSchema: {
      type: 'object',
      properties: {
        nodeId: { type: 'string', description: 'Node ID to repair.' },
        issueDescription: { type: 'string', description: 'What went wrong.' },
        fixStrategy: {
          type: 'string',
          enum: ['strip_safety_triggers', 'simplify_action', 'reinforce_character', 'enhance_lighting', 'custom_prompt'],
          description: 'Self-healing strategy.',
        },
        customPrompt: { type: 'string', description: 'Replacement prompt (required if fixStrategy is "custom_prompt").' },
      },
      required: ['nodeId'],
    },
  },
  {
    name: 'studio_read_node_details',
    description: 'Inspects a single node: returns its prompt text, status, generation output URL, error details, and all metadata.',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false, title: 'Read Node Details' },
    inputSchema: {
      type: 'object',
      properties: { nodeId: { type: 'string', description: 'Node ID to inspect.' } },
      required: ['nodeId'],
    },
  },
  {
    name: 'studio_modify_prompt',
    description: 'Rewrites the prompt text of a specific node on the canvas.',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false, title: 'Modify Prompt' },
    inputSchema: {
      type: 'object',
      properties: {
        nodeId: { type: 'string', description: 'Node to modify.' },
        prompt: { type: 'string', description: 'New prompt text.' },
      },
      required: ['nodeId', 'prompt'],
    },
  },
  {
    name: 'studio_rerun_node',
    description: 'Re-executes a single node without restarting the entire pipeline.',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false, title: 'Rerun Node' },
    inputSchema: {
      type: 'object',
      properties: { nodeId: { type: 'string', description: 'Node ID to re-render.' } },
      required: ['nodeId'],
    },
  },
  {
    name: 'studio_run_pipeline',
    description: 'Starts execution of all runnable nodes. Runs a pre-flight diagnosis first — if critical blockers exist, it REFUSES to run and returns the diagnosis with fix instructions instead.',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false, title: 'Run Pipeline' },
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'studio_stop_pipeline',
    description: 'Cancels or pauses currently running video generations.',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false, title: 'Stop Pipeline' },
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'studio_set_workflow',
    description: 'Atomically replaces the entire canvas with a custom array of nodes and edges.',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false, title: 'Set Workflow' },
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Workflow name.' },
        nodes: { type: 'array', description: 'React Flow nodes array.' },
        edges: { type: 'array', description: 'React Flow edges array.' },
      },
      required: ['nodes', 'edges'],
    },
  },
  {
    name: 'studio_clear_canvas',
    description: 'Clears ALL nodes and edges from the canvas. This is destructive and cannot be undone.',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false, title: 'Clear Canvas' },
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'studio_add_node',
    description: 'Adds a single node to the canvas (prompt, generate, image, frame, extend, story, or agent).',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false, title: 'Add Node' },
    inputSchema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['prompt', 'generate', 'image', 'frame', 'extend', 'story', 'agent'],
          description: 'Node type to create.',
        },
        label: { type: 'string', description: 'Label for the node card.' },
        position: {
          type: 'object',
          properties: { x: { type: 'number' }, y: { type: 'number' } },
        },
        data: { type: 'object', description: 'Custom data payload.' },
      },
      required: ['type'],
    },
  },
  {
    name: 'studio_connect_nodes',
    description: 'Wires a cable between two nodes on the canvas.',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false, title: 'Connect Nodes' },
    inputSchema: {
      type: 'object',
      properties: {
        source: { type: 'string', description: 'Source node ID.' },
        target: { type: 'string', description: 'Target node ID.' },
        sourceHandle: { type: 'string', description: 'Output port (e.g. text, video, result, image).' },
        targetHandle: { type: 'string', description: 'Input port (e.g. text, image_ref, frame_start, video).' },
      },
      required: ['source', 'target'],
    },
  },
];

/* ── Create MCP Server ── */
const server = new Server(
  { name: 'autoflow-mcp', version: '2.0.0' },
  { capabilities: { tools: {} } },
);

/* ── Tool Handlers ── */
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const startTime = Date.now();

  try {
    switch (name) {

      /* ─────────────────────────────────────────────
         CREATION & MUTATION TOOLS
         ───────────────────────────────────────────── */

      case 'studio_create_story_graph': {
        const result = await safeCallExtension('create_story_graph', args, name);
        const nodeCount = result.nodeCount || 0;
        const edgeCount = result.edgeCount || 0;

        return buildResponse(
          [
            `STORY GRAPH CREATED`,
            `Built ${nodeCount} nodes and ${edgeCount} wired connections on the canvas.`,
            `Includes: Story Brief prompt, Story Director, ${(args as any)?.shotCount || 4} shot generators, and last-frame continuity chains.`,
            `Next: Call studio_run_pipeline to start generating videos, or studio_diagnose_canvas to verify the canvas first.`,
          ].join('\n'),
          { nodeCount, edgeCount, nodeIds: result.nodeIds || [] },
          { tool: name, durationMs: Date.now() - startTime },
        );
      }

      case 'studio_modify_prompt': {
        const result = await safeCallExtension('modify_prompt', args, name);
        return buildResponse(
          [
            `PROMPT UPDATED`,
            `Node: "${result.nodeId}"`,
            `New prompt: "${result.updatedPrompt}"`,
            `Next: Call studio_rerun_node to re-generate this node, or studio_run_pipeline to run the full pipeline.`,
          ].join('\n'),
          { nodeId: result.nodeId, updatedPrompt: result.updatedPrompt },
          { tool: name, durationMs: Date.now() - startTime },
        );
      }

      case 'studio_rerun_node': {
        const result = await safeCallExtension('rerun_node', args, name);
        return buildResponse(
          [
            `NODE RE-RENDER STARTED`,
            `Node "${result.nodeId}" is now regenerating.`,
            `Next: Call studio_wait_for_completion or studio_get_pipeline_status to monitor progress.`,
          ].join('\n'),
          { nodeId: result.nodeId },
          { tool: name, durationMs: Date.now() - startTime },
        );
      }

      case 'studio_stop_pipeline': {
        const result = await safeCallExtension('stop_pipeline', {}, name);
        return buildResponse(
          [
            `PIPELINE STOPPED`,
            `All active generations have been cancelled.`,
            `Status: ${result.status || 'stopped'}`,
          ].join('\n'),
          { status: result.status },
          { tool: name, durationMs: Date.now() - startTime },
        );
      }

      case 'studio_set_workflow': {
        const result = await safeCallExtension('set_entire_workflow', args, name);
        return buildResponse(
          [
            `WORKFLOW REPLACED`,
            `Canvas now has ${result.nodeCount} nodes and ${result.edgeCount} edges.`,
            `Warning: Previous canvas content was removed.`,
            `Next: Call studio_diagnose_canvas to verify the new workflow.`,
          ].join('\n'),
          { nodeCount: result.nodeCount, edgeCount: result.edgeCount },
          { tool: name, durationMs: Date.now() - startTime },
        );
      }

      case 'studio_clear_canvas': {
        await safeCallExtension('clear_canvas', {}, name);
        return buildResponse(
          [
            `CANVAS CLEARED`,
            `All nodes and edges have been removed. The canvas is now empty.`,
            `Next: Call studio_create_story_graph to build a new storyboard.`,
          ].join('\n'),
          { cleared: true },
          { tool: name, durationMs: Date.now() - startTime },
        );
      }

      case 'studio_add_node': {
        const result = await safeCallExtension('add_node', args, name);
        return buildResponse(
          [
            `NODE ADDED`,
            `Created "${(args as any)?.type}" node with ID "${result.nodeId}"${(args as any)?.label ? ` labeled "${(args as any).label}"` : ''}.`,
            `Next: Call studio_connect_nodes to wire it to other nodes on the canvas.`,
          ].join('\n'),
          { nodeId: result.nodeId, type: (args as any)?.type, label: (args as any)?.label },
          { tool: name, durationMs: Date.now() - startTime },
        );
      }

      case 'studio_connect_nodes': {
        await safeCallExtension('connect_nodes', args, name);
        const src = (args as any)?.source;
        const tgt = (args as any)?.target;
        const srcH = (args as any)?.sourceHandle || 'default';
        const tgtH = (args as any)?.targetHandle || 'default';
        return buildResponse(
          [
            `NODES CONNECTED`,
            `Wired: ${src} (${srcH}) → ${tgt} (${tgtH})`,
            `Next: Call studio_diagnose_canvas to verify all connections are correct.`,
          ].join('\n'),
          { source: src, target: tgt, sourceHandle: srcH, targetHandle: tgtH },
          { tool: name, durationMs: Date.now() - startTime },
        );
      }

      /* ─────────────────────────────────────────────
         READ-ONLY / INSPECTION TOOLS
         ───────────────────────────────────────────── */

      case 'studio_get_canvas': {
        const canvas = await safeCallExtension('get_canvas', {}, name);
        const nodes = canvas.nodes || [];
        const edges = canvas.edges || [];
        const summary = summarizeNodes(nodes);

        return buildResponse(
          [
            `CANVAS STATE`,
            `Workflow: "${canvas.workflow?.name || 'Untitled'}"`,
            `Nodes: ${nodes.length} total (${summary.typeStr})`,
            `Edges: ${edges.length} connections`,
            `Status: ${summary.statusStr}`,
            `Running: ${canvas.isRunning ? 'YES' : 'NO'}`,
            ``,
            `Node List:`,
            ...nodes.map((n: any) => {
              const d = (n.data || {}) as any;
              return `  • [${n.id}] ${d.label || n.id} (${n.type || d.type}) — ${d.status || 'idle'}${d.errorMessage ? ` — ERROR: "${d.errorMessage}"` : ''}`;
            }),
          ].join('\n'),
          canvas,
          { tool: name, durationMs: Date.now() - startTime },
        );
      }

      case 'studio_get_pipeline_status': {
        const status = await safeCallExtension('get_pipeline_status', {}, name);
        const nodes = status.nodes || [];

        const errorNodes = nodes.filter((n: any) => n.status === 'error');
        const runningNodes = nodes.filter((n: any) => n.status === 'running');
        const doneNodes = nodes.filter((n: any) => n.status === 'done');

        let summaryLines = [
          `PIPELINE STATUS`,
          `Running: ${status.isRunning ? 'YES' : 'NO'} | Paused: ${status.isPaused ? 'YES' : 'NO'}`,
          `Progress: ${status.completedNodes || 0}/${status.totalNodes || 0} completed, ${status.failedNodes || 0} failed, ${status.runningNodes || 0} running`,
        ];

        if (errorNodes.length > 0) {
          summaryLines.push(``, `FAILED NODES:`);
          for (const en of errorNodes) {
            summaryLines.push(`  ✗ [${en.id}] "${en.label}" — ${en.errorMessage || 'Unknown error'}`);
          }
          summaryLines.push(`Fix: Call studio_auto_fix_canvas to reset failed nodes, then studio_run_pipeline to retry.`);
        }

        if (runningNodes.length > 0) {
          summaryLines.push(``, `CURRENTLY GENERATING:`);
          for (const rn of runningNodes) {
            summaryLines.push(`  ⟳ [${rn.id}] "${rn.label}" — ${rn.progress || 0}%`);
          }
        }

        if (doneNodes.length > 0) {
          summaryLines.push(``, `COMPLETED:`);
          for (const dn of doneNodes) {
            summaryLines.push(`  ✓ [${dn.id}] "${dn.label}"${dn.resultUrl ? ` — ${dn.resultUrl}` : ''}`);
          }
        }

        return buildResponse(
          summaryLines.join('\n'),
          status,
          { tool: name, durationMs: Date.now() - startTime },
        );
      }

      case 'studio_inspect_generations': {
        const inspection = await safeCallExtension('inspect_generations', {}, name);
        const outputs = inspection.outputs || [];

        let summaryLines = [
          `GENERATION REPORT`,
          `Total: ${inspection.total || 0} | Completed: ${inspection.completed || 0} | Failed: ${inspection.failed || 0} | Running: ${inspection.running || 0}`,
        ];

        for (const o of outputs) {
          let line = `  • [${o.nodeId}] "${o.label}" — ${o.status}`;
          if (o.status === 'done' && o.resultUrl) line += ` — Video: ${o.resultUrl}`;
          if (o.status === 'error') line += ` — Error: "${o.errorMessage || 'Unknown'}"`;
          if (o.status === 'running') line += ` — Progress: ${o.progress || 0}%`;
          summaryLines.push(line);
        }

        if (inspection.failed > 0) {
          summaryLines.push(``, `Fix: Call studio_self_heal_node for each failed node, or studio_auto_fix_canvas for bulk repair.`);
        }

        return buildResponse(
          summaryLines.join('\n'),
          inspection,
          { tool: name, durationMs: Date.now() - startTime },
        );
      }

      case 'studio_read_node_details': {
        if (!(args as any)?.nodeId) {
          return buildError(
            'Missing required parameter "nodeId".',
            'The studio_read_node_details tool requires a nodeId to know which node to inspect.',
            'Call this tool again with arguments: { nodeId: "<the node ID>" }. Use studio_get_canvas to see all available node IDs.',
            'validation',
          );
        }
        const details = await safeCallExtension('read_node_details', args, name);
        const d = (details?.data || details || {}) as any;

        return buildResponse(
          [
            `NODE DETAILS: "${d.label || (args as any).nodeId}"`,
            `Type: ${d.type || details?.type || 'unknown'}`,
            `Status: ${d.status || 'idle'}`,
            `Prompt: ${d.prompt ? `"${d.prompt.substring(0, 200)}${d.prompt.length > 200 ? '...' : ''}"` : '(empty)'}`,
            d.errorMessage ? `Error: "${d.errorMessage}"` : null,
            d.resultUrl ? `Result URL: ${d.resultUrl}` : null,
            d.previewVideoUrl ? `Preview: ${d.previewVideoUrl}` : null,
          ].filter(Boolean).join('\n'),
          details,
          { tool: name, durationMs: Date.now() - startTime },
        );
      }

      case 'studio_wait_for_completion': {
        const timeoutSeconds = Number((args as any)?.timeoutSeconds) || 600;
        const pollIntervalSeconds = Math.max(2, Number((args as any)?.pollIntervalSeconds) || 4);
        const loopStart = Date.now();
        const maxTimeMs = timeoutSeconds * 1000;

        let lastProgress = -1;

        while (Date.now() - loopStart < maxTimeMs) {
          const status = await safeCallExtension('get_pipeline_status', {}, name);
          const isRunning = !!status.isRunning;
          const runningNodes = status.runningNodes || 0;
          const completedNodes = status.completedNodes || 0;
          const totalNodes = status.totalNodes || 0;
          const failedNodes = status.failedNodes || 0;

          if (completedNodes !== lastProgress) {
            lastProgress = completedNodes;
            console.error(`[AutoFlow MCP] Poll: ${completedNodes}/${totalNodes} completed, ${runningNodes} running, ${failedNodes} failed.`);
          }

          if (!isRunning && runningNodes === 0) {
            const elapsed = Math.round((Date.now() - loopStart) / 1000);
            return buildResponse(
              [
                `PIPELINE FINISHED (${elapsed}s)`,
                `Completed: ${completedNodes}/${totalNodes} nodes`,
                `Failed: ${failedNodes} nodes`,
                failedNodes > 0 ? `Fix: Call studio_auto_fix_canvas to repair failed nodes, then studio_run_pipeline to retry.` : `All nodes completed successfully.`,
              ].join('\n'),
              status,
              { tool: name, durationMs: Date.now() - startTime },
            );
          }

          await new Promise((r) => setTimeout(r, pollIntervalSeconds * 1000));
        }

        return buildError(
          `Pipeline did not finish within ${timeoutSeconds} seconds.`,
          'Some nodes may still be generating, or the pipeline may be stuck.',
          'Call studio_get_pipeline_status to check current state, or studio_stop_pipeline to cancel.',
          'transient',
          { isRetryable: true, suggestedTool: 'studio_get_pipeline_status' },
        );
      }

      /* ─────────────────────────────────────────────
         SELF-HEALING
         ───────────────────────────────────────────── */

      case 'studio_self_heal_node': {
        const { nodeId, issueDescription, fixStrategy = 'strip_safety_triggers', customPrompt } = (args as any) || {};
        if (!nodeId) {
          return buildError(
            'Missing required parameter "nodeId".',
            'The self-heal tool needs to know which node to repair.',
            'Call this tool with { nodeId: "<ID>" }. Use studio_get_pipeline_status to find failed node IDs.',
            'validation',
          );
        }

        const details = await safeCallExtension('read_node_details', { nodeId }, name);
        let currentPrompt = details?.data?.prompt || '';
        let healedPrompt = currentPrompt;

        if (fixStrategy === 'custom_prompt' && customPrompt) {
          healedPrompt = customPrompt;
        } else if (fixStrategy === 'strip_safety_triggers') {
          healedPrompt = currentPrompt
            .replace(/\b(fire|burning|flames|explod\w*|burst\w*|weapon\w*|gun\w*|blood\w*|kill\w*|attack\w*)\b/gi, (m: string) => {
              if (/fire|burning|flames/i.test(m)) return 'glowing warm embers';
              if (/burst|explod/i.test(m)) return 'shimmering sparkle eruption';
              return '';
            })
            .replace(/\s+/g, ' ')
            .trim();
        } else if (fixStrategy === 'simplify_action') {
          healedPrompt = currentPrompt.replace(/,\s*then\s+[^,]+/gi, '').replace(/afterwards\s+[^,]+/gi, '');
        } else if (fixStrategy === 'enhance_lighting') {
          healedPrompt = `${currentPrompt} Warm cinematic volumetric lighting, shallow depth of field, 8K ultra-detailed render.`;
        }

        await safeCallExtension('modify_prompt', { nodeId, prompt: healedPrompt }, name);
        await safeCallExtension('rerun_node', { nodeId }, name);

        return buildResponse(
          [
            `NODE SELF-HEALED`,
            `Node: "${nodeId}" | Strategy: "${fixStrategy}"`,
            `Original: "${currentPrompt.substring(0, 150)}${currentPrompt.length > 150 ? '...' : ''}"`,
            `Healed: "${healedPrompt.substring(0, 150)}${healedPrompt.length > 150 ? '...' : ''}"`,
            `Re-render triggered. Call studio_wait_for_completion to monitor.`,
          ].join('\n'),
          { nodeId, fixStrategy, originalPrompt: currentPrompt, healedPrompt },
          { tool: name, durationMs: Date.now() - startTime },
        );
      }

      /* ─────────────────────────────────────────────
         DIAGNOSIS & AUTO-FIX
         ───────────────────────────────────────────── */

      case 'studio_diagnose_canvas': {
        const canvas = await safeCallExtension('get_canvas', {}, name);
        const nodes = canvas.nodes || [];
        const edges = canvas.edges || [];

        const diagnosis = runDiagnosis(nodes, edges);

        let summaryLines = [
          `CANVAS DIAGNOSIS: ${diagnosis.healthy ? 'HEALTHY' : `${diagnosis.criticalCount} CRITICAL, ${diagnosis.warningCount} WARNINGS`}`,
        ];

        const criticalIssues = diagnosis.issues.filter(i => i.severity === 'critical');
        const warningIssues = diagnosis.issues.filter(i => i.severity === 'warning');

        if (criticalIssues.length > 0) {
          summaryLines.push(``, `CRITICAL BLOCKERS (must fix before running):`);
          criticalIssues.forEach((iss, i) => {
            summaryLines.push(`  ${i + 1}. ${iss.message}`);
            summaryLines.push(`     → Fix: ${iss.fix}`);
          });
        }

        if (warningIssues.length > 0) {
          summaryLines.push(``, `WARNINGS (won't block but may cause failures):`);
          warningIssues.forEach((iss, i) => {
            summaryLines.push(`  ${i + 1}. ${iss.message}`);
            summaryLines.push(`     → Fix: ${iss.fix}`);
          });
        }

        if (diagnosis.healthy) {
          summaryLines.push(``, `Canvas is healthy and ready to run.`);
          summaryLines.push(`Next: Call studio_run_pipeline to start generating videos.`);
        } else {
          summaryLines.push(``, `Next: Call studio_auto_fix_canvas to repair all issues automatically.`);
        }

        return buildResponse(
          summaryLines.join('\n'),
          diagnosis,
          { tool: name, durationMs: Date.now() - startTime },
        );
      }

      case 'studio_auto_fix_canvas': {
        const canvas = await safeCallExtension('get_canvas', {}, name);
        const nodes = canvas.nodes || [];
        const edges = canvas.edges || [];
        let fixedCount = 0;
        const fixesApplied: string[] = [];

        for (const n of nodes) {
          const d = (n.data || {}) as any;
          const nodeType = n.type || d.type;
          const nodeLabel = d.label || n.id;

          // Reset error states
          if (d.status === 'error') {
            try {
              await sendToExtension('update_node_data', {
                nodeId: n.id,
                data: { status: 'idle', errorMessage: null, statusNote: null },
              });
              fixedCount++;
              fixesApplied.push(`Reset "${nodeLabel}" from error to idle`);
            } catch { /* ignore */ }
          }

          // Fix un-fed Story Director
          if (nodeType === 'story') {
            const hasUpstreamText = edges.some((e: any) => e.target === n.id && (e.targetHandle === 'text' || !e.targetHandle));
            if (!hasUpstreamText && !(d.brief || '').trim()) {
              const defaultBrief = 'A captivating cinematic short sequence with rich atmospheric depth and character continuity.';
              try {
                await sendToExtension('update_node_data', {
                  nodeId: n.id,
                  data: { brief: defaultBrief },
                });
                fixedCount++;
                fixesApplied.push(`Injected default brief into Story Director "${nodeLabel}"`);
              } catch { /* ignore */ }
            }
          }

          // Inject audio tags + cleanse safety words on generators
          if (nodeType === 'generate') {
            let prompt = (d.prompt || '').trim();
            let changed = false;

            if (prompt && !/ambient noise:|sfx:/i.test(prompt)) {
              prompt = `${prompt} Ambient noise: immersive atmospheric sound. SFX: synchronized cinematic effects.`;
              changed = true;
              fixesApplied.push(`Injected Veo 3.1 audio tags on "${nodeLabel}"`);
            }

            const safetyWords = prompt.match(/\b(gun|weapon|blood|kill|attack|explod|burst|naked|nude)\w*/gi);
            if (safetyWords && safetyWords.length > 0) {
              prompt = prompt
                .replace(/\b(gun|weapon)\w*/gi, 'magic artifact')
                .replace(/\b(blood)\w*/gi, 'glowing energy')
                .replace(/\b(kill|attack)\w*/gi, 'confront')
                .replace(/\b(explod|burst)\w*/gi, 'sparkle eruption')
                .replace(/\b(naked|nude)\w*/gi, 'elegantly dressed');
              changed = true;
              fixesApplied.push(`Replaced safety words on "${nodeLabel}": ${safetyWords.join(', ')}`);
            }

            if (changed) {
              try {
                await sendToExtension('update_node_data', { nodeId: n.id, data: { prompt } });
                fixedCount++;
              } catch { /* ignore */ }
            }
          }
        }

        let summaryLines = [
          `AUTO-FIX REPORT`,
          `Resolved ${fixedCount} issues on ${nodes.length} nodes.`,
        ];

        if (fixesApplied.length > 0) {
          summaryLines.push(``, `Fixes applied:`);
          fixesApplied.forEach((f) => summaryLines.push(`  ✓ ${f}`));
        } else {
          summaryLines.push(`No issues needed fixing — canvas was already clean.`);
        }

        summaryLines.push(``, `Next: Call studio_diagnose_canvas to verify, or studio_run_pipeline to start generating.`);

        return buildResponse(
          summaryLines.join('\n'),
          { fixedCount, fixesApplied, totalNodes: nodes.length },
          { tool: name, durationMs: Date.now() - startTime },
        );
      }

      /* ─────────────────────────────────────────────
         RUN PIPELINE (with pre-flight)
         ───────────────────────────────────────────── */

      case 'studio_run_pipeline': {
        // Pre-flight diagnosis
        const canvas = await safeCallExtension('get_canvas', {}, name);
        const nodes = canvas.nodes || [];
        const edges = canvas.edges || [];
        const summary = summarizeNodes(nodes);
        const diagnosis = runDiagnosis(nodes, edges);

        // If there are critical blockers, REFUSE to run
        if (diagnosis.criticalCount > 0) {
          const criticalIssues = diagnosis.issues.filter(i => i.severity === 'critical');
          let refusalLines = [
            `PIPELINE BLOCKED — ${diagnosis.criticalCount} critical issue(s) must be fixed first.`,
            `Canvas: ${nodes.length} nodes (${summary.typeStr})`,
            ``,
            `CRITICAL BLOCKERS:`,
          ];
          criticalIssues.forEach((iss, i) => {
            refusalLines.push(`  ${i + 1}. ${iss.message}`);
            refusalLines.push(`     → Fix: ${iss.fix}`);
          });
          refusalLines.push(``, `Next: Call studio_auto_fix_canvas to repair all issues, then call studio_run_pipeline again.`);

          return buildError(
            `Pipeline cannot start — ${diagnosis.criticalCount} critical blocker(s) detected.`,
            criticalIssues.map(i => i.message).join('; '),
            'Call studio_auto_fix_canvas first, then retry studio_run_pipeline.',
            'business',
            {
              isRetryable: false,
              suggestedTool: 'studio_auto_fix_canvas',
              partialData: diagnosis,
            },
          );
        }

        // Proceed with warnings
        const result = await safeCallExtension('run_pipeline', {}, name);

        let startLines = [
          `PIPELINE STARTED`,
          `Canvas: ${nodes.length} nodes (${summary.typeStr})`,
          `Status: ${result.status || 'started'}`,
        ];

        if (diagnosis.warningCount > 0) {
          startLines.push(``, `WARNINGS (pipeline started but these may cause issues):`);
          diagnosis.issues.filter(i => i.severity === 'warning').forEach((iss, i) => {
            startLines.push(`  ${i + 1}. ${iss.message}`);
          });
        }

        startLines.push(``, `Next: Call studio_wait_for_completion to monitor progress, or studio_get_pipeline_status for a snapshot.`);

        return buildResponse(
          startLines.join('\n'),
          { pipelineStarted: true, preflightDiagnosis: diagnosis, nodeBreakdown: summary },
          { tool: name, durationMs: Date.now() - startTime },
        );
      }

      /* ─────────────────────────────────────────────
         SMART SUPERVISED RUN
         ───────────────────────────────────────────── */

      case 'studio_smart_supervise_run': {
        // 1. Pre-flight diagnosis
        const canvas = await safeCallExtension('get_canvas', {}, name);
        const nodes = canvas.nodes || [];
        const edges = canvas.edges || [];
        const diagnosis = runDiagnosis(nodes, edges);

        let autoFixLog: string[] = [];

        // 2. Auto-fix if issues exist
        if (diagnosis.totalIssues > 0) {
          let fixedCount = 0;
          const fixesApplied: string[] = [];

          for (const n of nodes) {
            const d = (n.data || {}) as any;
            if (d.status === 'error') {
              try {
                await sendToExtension('update_node_data', { nodeId: n.id, data: { status: 'idle', errorMessage: null, statusNote: null } });
                fixedCount++;
                fixesApplied.push(`Reset "${d.label || n.id}"`);
              } catch { /* ignore */ }
            }
          }

          autoFixLog = [`Pre-flight auto-fix: resolved ${fixedCount} issues.`, ...fixesApplied.map(f => `  ✓ ${f}`)];
        }

        // 3. Check for remaining critical blockers
        const postFixCanvas = await safeCallExtension('get_canvas', {}, name);
        const postFixDiag = runDiagnosis(postFixCanvas.nodes || [], postFixCanvas.edges || []);

        if (postFixDiag.criticalCount > 0) {
          return buildError(
            `Smart supervisor cannot start — ${postFixDiag.criticalCount} critical blockers remain after auto-fix.`,
            postFixDiag.issues.filter(i => i.severity === 'critical').map(i => i.message).join('; '),
            'Manually fix the remaining issues. ' + postFixDiag.issues.filter(i => i.severity === 'critical').map(i => i.fix).join(' '),
            'business',
            { isRetryable: false, partialData: postFixDiag },
          );
        }

        // 4. Start pipeline
        await safeCallExtension('run_pipeline', {}, name);

        // 5. Supervision loop
        const timeoutSeconds = (args as any)?.timeoutSeconds || 300;
        const loopStart = Date.now();
        let finalStatus: any = null;
        let healsApplied = 0;
        const healLog: string[] = [];

        while (Date.now() - loopStart < timeoutSeconds * 1000) {
          await new Promise((r) => setTimeout(r, 4000));
          finalStatus = await safeCallExtension('get_pipeline_status', {}, name);

          const failedNodes = (finalStatus.nodes || []).filter((n: any) => n.status === 'error');
          if (failedNodes.length > 0) {
            for (const fn of failedNodes) {
              try {
                await sendToExtension('update_node_data', {
                  nodeId: fn.id,
                  data: {
                    status: 'idle',
                    errorMessage: null,
                    prompt: `${fn.prompt || ''} Simplified cinematic motion, smooth diffusion, 8K render.`,
                  },
                });
                await sendToExtension('run_node', { nodeId: fn.id });
                healsApplied++;
                healLog.push(`Self-healed "${fn.label || fn.id}": reset + simplified prompt`);
              } catch { /* ignore */ }
            }
          }

          if (!finalStatus.isRunning && (finalStatus.runningNodes || 0) === 0) {
            break;
          }
        }

        // 6. Final report
        let genReport: any = {};
        try {
          genReport = await safeCallExtension('inspect_generations', {}, name);
        } catch { /* ignore */ }

        const elapsed = Math.round((Date.now() - loopStart) / 1000);

        let reportLines = [
          `AUTONOMOUS PIPELINE SUPERVISION COMPLETE (${elapsed}s)`,
        ];

        if (autoFixLog.length > 0) {
          reportLines.push(``, ...autoFixLog);
        }

        reportLines.push(
          ``,
          `RESULTS:`,
          `  Completed: ${genReport.completed || 0}/${genReport.total || 0}`,
          `  Failed: ${genReport.failed || 0}`,
          `  Self-heals applied: ${healsApplied}`,
        );

        if (healLog.length > 0) {
          reportLines.push(``, `SELF-HEAL LOG:`, ...healLog.map(h => `  ✓ ${h}`));
        }

        if ((genReport.outputs || []).some((o: any) => o.status === 'done' && o.resultUrl)) {
          reportLines.push(``, `GENERATED VIDEOS:`);
          for (const o of (genReport.outputs || [])) {
            if (o.status === 'done' && o.resultUrl) {
              reportLines.push(`  ✓ "${o.label}" — ${o.resultUrl}`);
            }
          }
        }

        if ((genReport.failed || 0) > 0) {
          reportLines.push(``, `Fix remaining failures: Call studio_self_heal_node for each, or studio_auto_fix_canvas for bulk repair.`);
        }

        return buildResponse(
          reportLines.join('\n'),
          { elapsed, autoFixLog, healsApplied, healLog, generationReport: genReport },
          { tool: name, durationMs: Date.now() - startTime },
        );
      }

      default:
        return buildError(
          `Tool "${name}" does not exist.`,
          'The tool name does not match any registered AutoFlow MCP tool.',
          `Available tools: ${TOOLS.map(t => t.name).join(', ')}`,
          'validation',
        );
    }
  } catch (error: any) {
    // If it's already a structured error from safeCallExtension, return it directly
    if (error?.__structured) {
      const { __structured, ...rest } = error;
      return rest;
    }

    // Categorize unknown errors
    const msg = error?.message || String(error);
    let category: ErrorCategory = 'internal';
    let isRetryable = false;
    let howToFix = 'Check the MCP server logs for details. If the issue persists, restart the MCP server.';

    if (msg.includes('ECONNREFUSED') || msg.includes('fetch failed')) {
      category = 'connection';
      howToFix = 'The MCP daemon on port 8124 is not running. Start it with: node dist/index.js';
    } else if (msg.includes('TIMEOUT') || msg.includes('timed out')) {
      category = 'transient';
      isRetryable = true;
      howToFix = 'The extension did not respond in time. Refresh the AutoFlow Studio tab and retry.';
    } else if (msg.includes('nodeId') || msg.includes('required')) {
      category = 'validation';
      howToFix = 'Check the tool input parameters. Use studio_get_canvas to find valid node IDs.';
    }

    return buildError(
      `Tool "${name}" failed: ${msg}`,
      msg,
      howToFix,
      category,
      { isRetryable },
    );
  }
});

/* ── Start Transport ── */
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[AutoFlow MCP] MCP Server v2.0 running via Stdio — Smart Structured Feedback enabled');
}

main().catch((err) => {
  console.error('[AutoFlow MCP] Fatal error in MCP server:', err);
  process.exit(1);
});
