/* ============================================================
   AutoFlow Studio — MCP (Model Context Protocol) Bridge
   Connects the in-browser React Flow Canvas to the local 
   autoflow-mcp-server running on ws://localhost:8124.
   ============================================================ */

import { useStudioStore } from '../store';
import { runner } from './WorkflowRunner';
import { nanoid } from 'nanoid';
import type { Node, Edge } from '@xyflow/react';

export type McpBridgeStatus = 'disconnected' | 'connecting' | 'connected';

export interface McpMessage {
  id?: string;
  type: 'request' | 'response' | 'event';
  action: string;
  params?: any;
  result?: any;
  error?: string;
}

class StudioMcpBridge {
  private ws: WebSocket | null = null;
  private status: McpBridgeStatus = 'disconnected';
  private statusListeners: Array<(status: McpBridgeStatus) => void> = [];
  private reconnectTimer: any = null;
  private hosts = ['127.0.0.1', 'localhost'];
  private hostIndex = 0;
  private port = 8124;
  private url = 'ws://127.0.0.1:8124';

  public getStatus(): McpBridgeStatus {
    return this.status;
  }

  public onStatusChange(listener: (status: McpBridgeStatus) => void): () => void {
    this.statusListeners.push(listener);
    listener(this.status);
    return () => {
      this.statusListeners = this.statusListeners.filter((l) => l !== listener);
    };
  }

  private setStatus(status: McpBridgeStatus) {
    this.status = status;
    this.statusListeners.forEach((l) => l(status));
  }

  public connect(port = 8124) {
    this.port = port;
    const currentHost = this.hosts[this.hostIndex % this.hosts.length];
    this.url = `ws://${currentHost}:${this.port}`;

    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    this.setStatus('connecting');

    // Run quick diagnostic ping
    fetch(`http://${currentHost}:${this.port}`)
      .then((res) => res.json())
      .then((data) => {
        console.log('[AutoFlow MCP Bridge] Local MCP server responded to HTTP ping:', data);
      })
      .catch((err) => {
        console.warn(`[AutoFlow MCP Bridge] HTTP ping to ${currentHost}:${this.port} failed. Note: If using a Proxy in Multilogin/AdsPower, add "127.0.0.1, localhost, <local>" to your profile Proxy Bypass list!`, err);
      });

    try {
      this.ws = new WebSocket(this.url);

      this.ws.onopen = () => {
        this.setStatus('connected');
        console.log('[AutoFlow MCP Bridge] Connected to local MCP server at', this.url);
        // Send initial handshake with canvas summary
        this.broadcastCanvasState();
      };

      this.ws.onmessage = async (event) => {
        try {
          const message: McpMessage = JSON.parse(event.data);
          if (message.type === 'request') {
            await this.handleRpcRequest(message);
          }
        } catch (err) {
          console.error('[AutoFlow MCP Bridge] Failed to parse message:', err);
        }
      };

      this.ws.onclose = () => {
        this.setStatus('disconnected');
        this.hostIndex++;
        this.scheduleReconnect();
      };

      this.ws.onerror = () => {
        this.setStatus('disconnected');
      };
    } catch {
      this.setStatus('disconnected');
      this.hostIndex++;
      this.scheduleReconnect();
    }
  }

  public disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.setStatus('disconnected');
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect(this.port);
    }, 2500);
  }

  public send(msg: McpMessage) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  public broadcastCanvasState() {
    const store = useStudioStore.getState();
    this.send({
      type: 'event',
      action: 'canvas_state_changed',
      params: {
        nodeCount: store.nodes.length,
        edgeCount: store.edges.length,
        isRunning: store.isRunning,
        workflowName: store.workflow.name,
      },
    });
  }

  /** Handle incoming RPC request from Claude / Cursor through MCP */
  private async handleRpcRequest(req: McpMessage) {
    const store = useStudioStore.getState();
    const { action, params, id } = req;

    try {
      let result: any = null;

      switch (action) {
        case 'get_canvas': {
          result = {
            workflow: store.workflow,
            nodes: store.nodes,
            edges: store.edges,
            isRunning: store.isRunning,
            isPaused: store.isPaused,
            currentNodeId: store.currentNodeId,
            runProgress: store.runProgress,
          };
          break;
        }

        case 'get_pipeline_status': {
          const nodes = store.nodes.map((n) => {
            const d = (n.data || {}) as any;
            return {
              id: n.id,
              type: n.type || d.type,
              label: d.label || n.id,
              status: d.status || 'idle',
              progress: d.progress || 0,
              errorMessage: d.errorMessage || null,
              resultUrl: d.resultUrl || '',
              previewUrl: d.previewUrl || '',
              previewVideoUrl: d.previewVideoUrl || '',
              prompt: d.prompt || '',
            };
          });
          result = {
            isRunning: !!store.isRunning,
            isPaused: !!store.isPaused,
            currentNodeId: store.currentNodeId || null,
            runProgress: store.runProgress,
            totalNodes: nodes.length,
            completedNodes: nodes.filter((n) => n.status === 'done').length,
            failedNodes: nodes.filter((n) => n.status === 'error').length,
            runningNodes: nodes.filter((n) => n.status === 'running').length,
            idleNodes: nodes.filter((n) => n.status === 'idle').length,
            nodes,
          };
          break;
        }

        case 'inspect_generations': {
          const outputs = store.nodes
            .filter((n) => n.type === 'generate' || (n.data as any)?.type === 'generate')
            .map((n) => {
              const d = (n.data || {}) as any;
              return {
                nodeId: n.id,
                label: d.label || n.id,
                mediaType: d.mediaType || 'image',
                platform: d.platform || 'flow',
                model: d.model || '',
                aspectRatio: d.aspectRatio || '9:16',
                duration: d.duration || '6s',
                prompt: d.prompt || '',
                status: d.status || 'idle',
                progress: d.progress || 0,
                resultUrl: d.resultUrl || '',
                previewUrl: d.previewUrl || '',
                previewVideoUrl: d.previewVideoUrl || '',
                resultTileId: d.resultTileId || '',
                errorMessage: d.errorMessage || null,
              };
            });
          result = {
            total: outputs.length,
            completed: outputs.filter((o) => o.status === 'done').length,
            failed: outputs.filter((o) => o.status === 'error').length,
            running: outputs.filter((o) => o.status === 'running').length,
            outputs,
          };
          break;
        }

        case 'create_story_graph': {
          // Builds a full Story Director + Shot sequence graph from AI brief
          const {
            brief,
            cast,
            structure = 'hook',
            shotCount = 4,
            camera = 'dynamic',
            cameraProgression,
            audioMode = 'cinematic',
            visualPreset = 'cgi3d',
            aspectRatio = '9:16',
            duration = '6s',
            world = '',
            look = '',
          } = params || {};
          
          const newNodes: Node[] = [];
          const newEdges: Edge[] = [];

          // 1. Concept Prompt Node
          const promptNodeId = `prompt-${nanoid(6)}`;
          const promptNode: Node = {
            id: promptNodeId,
            type: 'prompt',
            position: { x: -280, y: 150 },
            data: {
              type: 'prompt',
              label: 'Story Brief',
              text: brief || 'A cinematic short video sequence.',
              status: 'idle',
            },
          };
          newNodes.push(promptNode);

          // 2. Story Director Node
          const storyNodeId = `story-${nanoid(6)}`;
          const storyNode: Node = {
            id: storyNodeId,
            type: 'story',
            position: { x: 100, y: 150 },
            data: {
              type: 'story',
              label: 'Story Director',
              brief: brief || '',
              structure,
              cameraProgression: cameraProgression || camera || 'dynamic',
              audioMode,
              visualPreset,
              world,
              look,
              cast: Array.isArray(cast) ? cast : [],
              beats: [],
              rules: [],
              status: 'idle',
            },
          };
          newNodes.push(storyNode);

          // Connect Prompt Idea -> Story Director
          newEdges.push({
            id: `edge-${promptNodeId}-${storyNodeId}-text`,
            source: promptNodeId,
            sourceHandle: 'text',
            target: storyNodeId,
            targetHandle: 'text',
            type: 'default',
            style: { stroke: '#8b5cf6', strokeWidth: 2.5 },
          });

          // 3. Master Character Reference Still Node
          const masterStillId = `still-${nanoid(6)}`;
          const primaryCast = Array.isArray(cast) && cast.length > 0 ? cast[0] : null;
          const masterStillNode: Node = {
            id: masterStillId,
            type: 'generate',
            position: { x: 100, y: 480 },
            data: {
              type: 'generate',
              label: primaryCast ? `Master Ref: ${primaryCast.name}` : 'Master Character Reference',
              mediaType: 'image',
              platform: 'flow',
              model: 'Nano Banana 2',
              aspectRatio,
              prompt: primaryCast
                ? `Master character reference portrait of ${primaryCast.name}. ${primaryCast.look}. Pixar 3D CGI animation, subsurface scattering, 8K ultra-detailed, centered character turnaround, 9:16 vertical.`
                : `Master character reference portrait for: ${brief}. Pixar 3D CGI animation, 8K ultra-detailed.`,
              status: 'idle',
            },
          };
          newNodes.push(masterStillNode);

          let lastGenNodeId = '';

          for (let i = 0; i < shotCount; i++) {
            const genId = `gen-${nanoid(6)}`;
            const xPos = 600 + i * 420;
            const yPos = 150;

            const genNode: Node = {
              id: genId,
              type: 'generate',
              position: { x: xPos, y: yPos },
              data: {
                type: 'generate',
                label: `Shot ${i + 1}`,
                prompt: `Shot ${i + 1} cinematic visual sequence.`,
                mediaType: 'video',
                platform: 'flow',
                model: 'Omni 1.1 Flash',
                aspectRatio,
                duration,
                status: 'idle',
              },
            };

            newNodes.push(genNode);

            // Wire Story Director output (text port) to Generate input
            newEdges.push({
              id: `edge-${storyNodeId}-${genId}-text`,
              source: storyNodeId,
              sourceHandle: 'text',
              target: genId,
              targetHandle: 'text',
              type: 'default',
              style: { stroke: '#8b5cf6', strokeWidth: 2.5 },
            });

            // Wire Master Still Image to Shot 1 for character consistency
            if (i === 0) {
              newEdges.push({
                id: `edge-${masterStillId}-${genId}-img`,
                source: masterStillId,
                sourceHandle: 'result',
                target: genId,
                targetHandle: 'image_ref',
                type: 'default',
                style: { stroke: '#3b82f6', strokeWidth: 2.5 },
              });
            }

            // Wire Last Frame from previous shot if i > 0
            if (i > 0 && lastGenNodeId) {
              const frameId = `frame-${nanoid(6)}`;
              const frameNode: Node = {
                id: frameId,
                type: 'frame',
                position: { x: xPos - 200, y: yPos + 260 },
                data: {
                  type: 'frame',
                  label: `Last Frame ${i}`,
                  frameMode: 'last',
                  status: 'idle',
                },
              };
              newNodes.push(frameNode);

              // Previous Gen Result -> Frame image_ref
              newEdges.push({
                id: `edge-${lastGenNodeId}-${frameId}-img`,
                source: lastGenNodeId,
                sourceHandle: 'result',
                target: frameId,
                targetHandle: 'image_ref',
                type: 'default',
                style: { stroke: '#3b82f6', strokeWidth: 2.5 },
              });

              // Frame image -> Current Gen image_ref
              newEdges.push({
                id: `edge-${frameId}-${genId}-img`,
                source: frameId,
                sourceHandle: 'image',
                target: genId,
                targetHandle: 'image_ref',
                type: 'default',
                style: { stroke: '#3b82f6', strokeWidth: 2.5 },
              });
            }

            lastGenNodeId = genId;
          }

          store.setNodes(newNodes);
          store.setEdges(newEdges);
          result = { success: true, nodeCount: newNodes.length, edgeCount: newEdges.length };
          break;
        }

        case 'diagnose_canvas': {
          const nodes = store.nodes;
          const edges = store.edges;
          const issues: Array<{
            id: string;
            nodeId?: string;
            type: string;
            severity: 'critical' | 'warning' | 'info';
            message: string;
            fix: string;
          }> = [];

          if (nodes.length === 0) {
            issues.push({
              id: 'empty_canvas',
              type: 'EMPTY_CANVAS',
              severity: 'critical',
              message: 'Canvas is empty. No nodes found to execute.',
              fix: 'Create a story graph or add generator nodes.',
            });
          }

          const storyNodes = nodes.filter((n) => n.type === 'story' || (n.data as any)?.type === 'story');
          const genNodes = nodes.filter((n) => n.type === 'generate' || (n.data as any)?.type === 'generate');
          const frameNodes = nodes.filter((n) => n.type === 'frame' || (n.data as any)?.type === 'frame');

          // 1. Check Story Directors
          storyNodes.forEach((sn) => {
            const d = (sn.data || {}) as any;
            const hasUpstreamText = edges.some((e) => e.target === sn.id && (e.targetHandle === 'text' || !e.targetHandle));
            const hasBrief = !!(d.brief || d.prompt || '').trim();
            if (!hasUpstreamText && !hasBrief) {
              issues.push({
                id: `story_unfed_${sn.id}`,
                nodeId: sn.id,
                type: 'UNFED_STORY_DIRECTOR',
                severity: 'critical',
                message: `Story Director "${d.label || sn.id}" has no idea connected and no written brief.`,
                fix: 'Connect a Story Brief prompt node or fill in the brief.',
              });
            }

            const outgoing = edges.filter((e) => e.source === sn.id);
            if (outgoing.length === 0) {
              issues.push({
                id: `story_unconnected_${sn.id}`,
                nodeId: sn.id,
                type: 'UNCONNECTED_STORY_DIRECTOR',
                severity: 'warning',
                message: `Story Director "${d.label || sn.id}" is not wired to any downstream shot nodes.`,
                fix: 'Connect Director output to Generate shot nodes.',
              });
            }
          });

          // 2. Check Generators
          genNodes.forEach((gn) => {
            const d = (gn.data || {}) as any;
            const prompt = (d.prompt || '').trim();
            const hasUpstreamText = edges.some((e) => e.target === gn.id && (e.targetHandle === 'text' || !e.targetHandle));
            
            if (!prompt && !hasUpstreamText) {
              issues.push({
                id: `empty_prompt_${gn.id}`,
                nodeId: gn.id,
                type: 'EMPTY_PROMPT',
                severity: 'critical',
                message: `Generator "${d.label || gn.id}" has an empty prompt and no upstream text connection.`,
                fix: 'Inject a prompt or wire a Story Director.',
              });
            }

            // Veo 3.1 joint audio check for video nodes
            if ((d.mediaType === 'video' || !d.mediaType) && prompt) {
              const hasAudioTags = /ambient noise:|sfx:|dialogue:|sound:/i.test(prompt);
              if (!hasAudioTags) {
                issues.push({
                  id: `missing_audio_${gn.id}`,
                  nodeId: gn.id,
                  type: 'MISSING_AUDIO_TAGS',
                  severity: 'info',
                  message: `Video prompt in "${d.label || gn.id}" lacks Veo 3.1 joint audio tags (Ambient noise / SFX).`,
                  fix: 'Add "Ambient noise:" and "SFX:" tags for synchronized cinematic audio.',
                });
              }
            }

            // Safety risk check
            const safetyRiskPattern = /\b(blood|gore|weapon|gun|kill|nsfw|naked|erotic|copyright|disney|marvel|nike)\b/i;
            if (safetyRiskPattern.test(prompt)) {
              issues.push({
                id: `safety_risk_${gn.id}`,
                nodeId: gn.id,
                type: 'SAFETY_RISK_WORDS',
                severity: 'warning',
                message: `Prompt in "${d.label || gn.id}" contains words that may trigger AI safety filters.`,
                fix: 'Replace with safe stylized cinematic descriptions.',
              });
            }

            // Check if node failed on previous run
            if (d.status === 'error') {
              issues.push({
                id: `node_failed_${gn.id}`,
                nodeId: gn.id,
                type: 'PREVIOUSLY_FAILED_NODE',
                severity: 'warning',
                message: `Node "${d.label || gn.id}" is in error state: "${d.errorMessage || d.statusNote || 'Unknown error'}".`,
                fix: 'Self-heal prompt and reset status to idle.',
              });
            }
          });

          // 3. Check Frame extractors
          frameNodes.forEach((fn) => {
            const hasSource = edges.some((e) => e.target === fn.id);
            const hasTarget = edges.some((e) => e.source === fn.id);
            if (!hasSource || !hasTarget) {
              issues.push({
                id: `unwired_frame_${fn.id}`,
                nodeId: fn.id,
                type: 'UNWIRED_FRAME_EXTRACTOR',
                severity: 'warning',
                message: `Last Frame node "${fn.id}" is partially unwired (needs both source shot and target shot).`,
                fix: 'Wire previous shot -> Last Frame -> next shot.',
              });
            }
          });

          result = {
            healthy: issues.filter((i) => i.severity === 'critical').length === 0,
            totalIssues: issues.length,
            criticalCount: issues.filter((i) => i.severity === 'critical').length,
            warningCount: issues.filter((i) => i.severity === 'warning').length,
            infoCount: issues.filter((i) => i.severity === 'info').length,
            issues,
          };
          break;
        }

        case 'auto_fix_canvas': {
          let fixedCount = 0;
          const fixesApplied: string[] = [];

          // 1. Reset any failed nodes back to idle with healed prompts
          store.nodes.forEach((n) => {
            const d = (n.data || {}) as any;
            if (d.status === 'error') {
              store.updateNodeData(n.id, {
                status: 'idle',
                errorMessage: null,
                statusNote: null,
              });
              fixedCount++;
              fixesApplied.push(`Reset failed status on "${d.label || n.id}"`);
            }
          });

          // 2. Feed any un-fed Story Director nodes
          const storyNodes = store.nodes.filter((n) => n.type === 'story' || (n.data as any)?.type === 'story');
          storyNodes.forEach((sn) => {
            const d = (sn.data || {}) as any;
            const hasUpstreamText = store.edges.some((e) => e.target === sn.id && (e.targetHandle === 'text' || !e.targetHandle));
            if (!hasUpstreamText && !(d.brief || '').trim()) {
              const defaultBrief = 'A captivating cinematic short sequence with rich atmospheric depth and character continuity.';
              store.updateNodeData(sn.id, { brief: defaultBrief });
              
              // Also add a prompt node
              const pId = `prompt-${nanoid(6)}`;
              const pNode: Node = {
                id: pId,
                type: 'prompt',
                position: { x: sn.position.x - 380, y: sn.position.y },
                data: {
                  type: 'prompt',
                  label: 'Story Brief',
                  text: defaultBrief,
                  status: 'idle',
                },
              };
              store.addNode(pNode);
              store.setEdges([
                ...store.edges,
                {
                  id: `edge-${pId}-${sn.id}-text`,
                  source: pId,
                  sourceHandle: 'text',
                  target: sn.id,
                  targetHandle: 'text',
                  type: 'default',
                  style: { stroke: '#8b5cf6', strokeWidth: 2.5 },
                },
              ]);
              fixedCount++;
              fixesApplied.push(`Attached Story Brief prompt node to "${d.label || sn.id}"`);
            }
          });

          // 3. Inject audio tags & fix safety words in video generator prompts
          store.nodes
            .filter((n) => n.type === 'generate' || (n.data as any)?.type === 'generate')
            .forEach((gn) => {
              const d = (gn.data || {}) as any;
              let prompt = (d.prompt || '').trim();
              let changed = false;

              // Replace safety risk words
              const cleaned = prompt
                .replace(/\bblood\b/gi, 'glowing energy')
                .replace(/\bgun\b/gi, 'magic artifact')
                .replace(/\bkill\b/gi, 'defeat')
                .replace(/\bweapon\b/gi, 'mystic staff');
              if (cleaned !== prompt) {
                prompt = cleaned;
                changed = true;
              }

              // Add audio tags if missing on video nodes
              if ((d.mediaType === 'video' || !d.mediaType) && prompt && !/ambient noise:|sfx:/i.test(prompt)) {
                prompt = `${prompt} Ambient noise: immersive atmospheric environment sound. SFX: synchronized organic action effects.`;
                changed = true;
              }

              if (changed) {
                store.updateNodeData(gn.id, { prompt });
                fixedCount++;
                fixesApplied.push(`Enhanced prompt with audio tags and safety cleanup on "${d.label || gn.id}"`);
              }
            });

          result = {
            success: true,
            fixedCount,
            fixesApplied,
          };
          break;
        }

        case 'clear_canvas': {
          store.setNodes([]);
          store.setEdges([]);
          result = { success: true, message: 'Canvas cleared' };
          break;
        }

        case 'set_entire_workflow': {
          const { nodes: newNodes = [], edges: newEdges = [], name } = params || {};
          store.setNodes(newNodes);
          store.setEdges(newEdges);
          if (name && typeof store.setWorkflowName === 'function') {
            store.setWorkflowName(name);
          }
          result = { success: true, nodeCount: newNodes.length, edgeCount: newEdges.length };
          break;
        }

        case 'add_node': {
          const { type, label, position, data } = params || {};
          const newNodeId = `${type || 'node'}-${nanoid(6)}`;
          const newNode: Node = {
            id: newNodeId,
            type: type || 'prompt',
            position: position || { x: 300, y: 300 },
            data: {
              type: type || 'prompt',
              label: label || type,
              status: 'idle',
              ...(data || {}),
            },
          };
          store.addNode(newNode);
          result = { success: true, nodeId: newNodeId, node: newNode };
          break;
        }

        case 'update_node_data': {
          const { nodeId, data } = params || {};
          if (!nodeId) throw new Error('nodeId is required');
          store.updateNodeData(nodeId, data);
          result = { success: true, nodeId };
          break;
        }

        case 'connect_nodes': {
          const { source, target, sourceHandle = 'text', targetHandle = 'text' } = params || {};
          if (!source || !target) throw new Error('source and target are required');
          const edgeId = `edge-${source}-${target}-${nanoid(4)}`;
          const newEdge: Edge = {
            id: edgeId,
            source,
            target,
            sourceHandle,
            targetHandle,
            type: 'deletable',
          };
          store.setEdges([...store.edges, newEdge]);
          result = { success: true, edgeId };
          break;
        }

        case 'modify_prompt': {
          const { nodeId, prompt } = params || {};
          if (!nodeId) throw new Error('nodeId is required');
          store.updateNodeData(nodeId, { prompt });
          result = { success: true, nodeId, updatedPrompt: prompt };
          break;
        }

        case 'read_node_details': {
          const { nodeId } = params || {};
          const node = store.nodes.find((n) => n.id === nodeId);
          if (!node) throw new Error(`Node ${nodeId} not found`);
          result = {
            id: node.id,
            type: node.type,
            data: node.data,
            position: node.position,
          };
          break;
        }

        case 'run_pipeline': {
          if (store.isRunning) {
            result = { status: 'already_running' };
          } else {
            // Asynchronously start runner
            runner.run(store.nodes, store.edges).catch((err) => {
              console.error('[MCP Runner error]:', err);
            });
            result = { status: 'started' };
          }
          break;
        }

        case 'stop_pipeline': {
          runner.stop();
          result = { status: 'stopped' };
          break;
        }

        case 'rerun_node': {
          const { nodeId } = params || {};
          if (!nodeId) throw new Error('nodeId is required');
          // Reset node status and rerun
          store.updateNodeData(nodeId, { status: 'idle', statusNote: undefined, error: undefined });
          runner.run(store.nodes, store.edges, { only: new Set([nodeId]) }).catch((err) => console.error('[MCP Rerun error]:', err));
          result = { status: 'rerun_started', nodeId };
          break;
        }

        default:
          throw new Error(`Unknown MCP action: ${action}`);
      }

      this.send({
        id,
        type: 'response',
        action,
        result,
      });
    } catch (err: any) {
      this.send({
        id,
        type: 'response',
        action,
        error: err?.message || String(err),
      });
    }
  }
}

export const mcpBridge = new StudioMcpBridge();
