/* ============================================================
   WorkflowRunner — Orchestrates workflow execution
   Walks through nodes in topological order, executes each
   generate node on Google Flow via the bridge.
   ============================================================ */

import type { Node, Edge } from '@xyflow/react';
import { topologicalSort, getNodeInputs } from './topoSort';
import { bridge, type NodeExecutionConfig, type NodeResult } from './bridge';
import { useStudioStore } from '../store';

export type RunnerState = 'idle' | 'running' | 'paused' | 'stopped' | 'done' | 'error';

export class WorkflowRunner {
  private state: RunnerState = 'idle';
  private abortRequested = false;
  private pauseRequested = false;

  /** Results from each node (nodeId → result) */
  private nodeResults = new Map<string, NodeResult>();

  getState(): RunnerState {
    return this.state;
  }

  /**
   * Run the entire workflow.
   * - Sorts nodes topologically
   * - Skips non-generate nodes (prompt/image just pass data)
   * - Executes generate nodes sequentially on Flow
   */
  async run(nodes: Node[], edges: Edge[]): Promise<void> {
    const store = useStudioStore.getState();

    // Reset
    this.state = 'running';
    this.abortRequested = false;
    this.pauseRequested = false;
    this.nodeResults.clear();
    store.setRunning(true);

    // Sort nodes in execution order
    let steps;
    try {
      steps = topologicalSort(nodes, edges);
    } catch (err: any) {
      console.error('[Runner] Topo sort failed:', err.message);
      this.state = 'error';
      store.setRunning(false);
      return;
    }

    // Count generate nodes for progress
    const generateSteps = steps.filter((s) => s.nodeType === 'generate');
    store.setRunProgress(0, generateSteps.length);
    let completedCount = 0;

    console.log(`[Runner] Starting workflow: ${steps.length} total, ${generateSteps.length} generate nodes`);

    // Walk through each step
    for (const step of steps) {
      if (this.abortRequested) {
        this.state = 'stopped';
        break;
      }

      // Handle pause
      while (this.pauseRequested && !this.abortRequested) {
        this.state = 'paused';
        store.setPaused(true);
        await this.sleep(500);
      }
      if (this.abortRequested) {
        this.state = 'stopped';
        break;
      }
      store.setPaused(false);
      this.state = 'running';

      const node = nodes.find((n) => n.id === step.nodeId);
      if (!node) continue;

      const nodeData = node.data as any;

      // Handle node by type
      switch (step.nodeType) {
        case 'prompt':
          // Prompt nodes don't "execute" — they just hold text
          // Store the text as a "result" so downstream nodes can read it
          this.nodeResults.set(step.nodeId, {
            tileId: '',
            imageUrl: nodeData.text || '',
          });
          console.log(`[Runner] Prompt "${nodeData.label}": stored text (${(nodeData.text || '').length} chars)`);
          break;

        case 'image':
          // Image nodes don't execute — store their data for downstream
          this.nodeResults.set(step.nodeId, {
            tileId: '',
            imageUrl: nodeData.imageData || '',
          });
          console.log(`[Runner] Image "${nodeData.label}": stored reference`);
          break;

        case 'generate':
          // GENERATE nodes — this is where the magic happens
          store.setCurrentNode(step.nodeId);
          store.updateNodeData(step.nodeId, { status: 'running', progress: 0, errorMessage: null });

          try {
            const result = await this.executeGenerateNode(step.nodeId, node, edges);
            this.nodeResults.set(step.nodeId, result);

            store.updateNodeData(step.nodeId, {
              status: 'done',
              progress: 100,
              resultUrl: result.videoUrl || result.imageUrl || result.thumbnailUrl || '',
              previewUrl: result.previewUrl || '',
              resultTileId: result.tileId,
            });

            completedCount++;
            store.setRunProgress(completedCount, generateSteps.length);
            console.log(`[Runner] Generate "${nodeData.label}": DONE — tile ${result.tileId}`);
          } catch (err: any) {
            console.error(`[Runner] Generate "${nodeData.label}" FAILED:`, err.message);
            store.updateNodeData(step.nodeId, {
              status: 'error',
              errorMessage: err.message || 'Generation failed',
            });

            // Don't abort the whole workflow — skip this node and continue
            completedCount++;
            store.setRunProgress(completedCount, generateSteps.length);
          }
          break;

        default:
          console.log(`[Runner] Unknown node type "${step.nodeType}" — skipping`);
      }
    }

    // Finished
    store.setCurrentNode(null);
    store.setRunning(false);
    store.setPaused(false);
    this.state = this.abortRequested ? 'stopped' : 'done';
    console.log(`[Runner] Workflow ${this.state}. ${completedCount}/${generateSteps.length} completed.`);
  }

  /** Execute a single generate node via Flow */
  private async executeGenerateNode(nodeId: string, node: Node, edges: Edge[]): Promise<NodeResult> {
    const nodeData = node.data as any;
    const inputs = getNodeInputs(nodeId, edges);

    // Gather prompt from upstream text connection
    let prompt = '';
    const textSourceId = inputs.get('text');
    if (textSourceId) {
      const textResult = this.nodeResults.get(textSourceId);
      if (textResult) {
        prompt = textResult.imageUrl || ''; // imageUrl stores text for prompt nodes
      }
    }

    // Gather reference images from upstream image connections
    const referenceImageIds: string[] = [];
    const referenceImageData: string[] = [];
    const imageRefSourceId = inputs.get('image_ref');
    if (imageRefSourceId) {
      const imgResult = this.nodeResults.get(imageRefSourceId);
      if (imgResult) {
        if (imgResult.tileId) {
          // Upstream was a generate node — use its tile ID
          referenceImageIds.push(imgResult.tileId);
        } else if (imgResult.imageUrl && imgResult.imageUrl.startsWith('data:')) {
          // Upstream was an image node — use base64 data
          referenceImageData.push(imgResult.imageUrl);
        }
      }
    }

    const config: NodeExecutionConfig = {
      prompt,
      model: nodeData.model || 'omni-flash',
      mediaType: nodeData.mediaType || 'video',
      aspectRatio: nodeData.aspectRatio || '9:16',
      duration: nodeData.duration || '6s',
      creationType: nodeData.creationType || 'ingredients',
      referenceImageIds: referenceImageIds.length > 0 ? referenceImageIds : undefined,
      referenceImageData: referenceImageData.length > 0 ? referenceImageData : undefined,
    };

    // Send to Flow via bridge
    return new Promise<NodeResult>((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error('Generation timed out after 10 minutes'));
      }, 10 * 60 * 1000); // 10 min timeout

      const onResult = (payload: any) => {
        if (payload.nodeId !== nodeId) return;
        cleanup();
        if (payload.error) {
          reject(new Error(payload.error));
        } else {
          resolve({
            tileId: payload.tileId || '',
            imageUrl: payload.imageUrl,
            videoUrl: payload.videoUrl,
            thumbnailUrl: payload.thumbnailUrl,
            previewUrl: payload.previewUrl,
          });
        }
      };

      const onProgress = (payload: any) => {
        if (payload.nodeId !== nodeId) return;
        useStudioStore.getState().updateNodeData(nodeId, { progress: payload.progress || 0 });
      };

      const onError = (payload: any) => {
        if (payload.nodeId !== nodeId) return;
        cleanup();
        reject(new Error(payload.error || 'Generation failed'));
      };

      const cleanup = () => {
        clearTimeout(timeout);
        bridge.off('STUDIO_NODE_RESULT', onResult);
        bridge.off('STUDIO_NODE_PROGRESS', onProgress);
        bridge.off('STUDIO_NODE_ERROR', onError);
      };

      // Listen for results
      bridge.on('STUDIO_NODE_RESULT', onResult);
      bridge.on('STUDIO_NODE_PROGRESS', onProgress);
      bridge.on('STUDIO_NODE_ERROR', onError);

      // Send execution command
      bridge.executeNode(nodeId, config);
    });
  }

  /** Pause the workflow */
  pause(): void {
    this.pauseRequested = true;
    bridge.pauseExecution();
  }

  /** Resume after pause */
  resume(): void {
    this.pauseRequested = false;
    bridge.resumeExecution();
  }

  /** Stop the workflow */
  stop(): void {
    this.abortRequested = true;
    this.pauseRequested = false;
    bridge.stopExecution();
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}

/** Singleton runner instance */
export const runner = new WorkflowRunner();
