/* ============================================================
   WorkflowRunner — Orchestrates workflow execution
   Walks through nodes in topological order, executes each
   generate node on Google Flow via the bridge.
   ============================================================ */

import type { Node, Edge } from '@xyflow/react';
import { topologicalSort, getNodeInputs, getUpstreamNodeIds } from './topoSort';
import { bridge, type NodeExecutionConfig, type NodeResult } from './bridge';
import { useStudioStore } from '../store';

export type RunnerState = 'idle' | 'running' | 'paused' | 'stopped' | 'done' | 'error';

export class WorkflowRunner {
  private state: RunnerState = 'idle';
  private abortRequested = false;
  private pauseRequested = false;

  /** Results from each node (nodeId → result) */
  private nodeResults = new Map<string, NodeResult>();

  /** Nodes that failed or were skipped — dependents must not run on partial input */
  private failedNodes = new Set<string>();

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
    this.failedNodes.clear();
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

    // Count generate nodes for progress — disabled ones never run, so
    // counting them would leave the progress bar short of its total.
    const generateSteps = steps.filter((s) => {
      if (s.nodeType !== 'generate') return false;
      const n = nodes.find((x) => x.id === s.nodeId);
      return (n?.data as any)?.enabled !== false;
    });
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

        case 'generate': {
          // Nodes toggled off are skipped without consuming a generation
          if (nodeData.enabled === false) {
            console.log(`[Runner] Generate "${nodeData.label}": skipped (disabled)`);
            break;
          }

          // If anything upstream failed, this node's inputs are incomplete.
          // Running anyway burns a generation and silently produces the wrong
          // output — e.g. a scene video with no character reference because
          // the character sheet failed. Skip and say why.
          const brokenDeps = getUpstreamNodeIds(step.nodeId, edges)
            .filter((id) => this.failedNodes.has(id));
          if (brokenDeps.length > 0) {
            const names = brokenDeps
              .map((id) => (nodes.find((n) => n.id === id)?.data as any)?.label || id)
              .join(', ');
            console.warn(`[Runner] Generate "${nodeData.label}": skipped — upstream failed (${names})`);
            this.failedNodes.add(step.nodeId);
            store.updateNodeData(step.nodeId, {
              status: 'error',
              errorMessage: `Skipped — upstream node failed: ${names}`,
            });
            completedCount++;
            store.setRunProgress(completedCount, generateSteps.length);
            break;
          }

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
              previewVideoUrl: result.previewVideoUrl || '',
              resultTileId: result.tileId,
            });

            completedCount++;
            store.setRunProgress(completedCount, generateSteps.length);
            console.log(`[Runner] Generate "${nodeData.label}": DONE — tile ${result.tileId}`);
          } catch (err: any) {
            console.error(`[Runner] Generate "${nodeData.label}" FAILED:`, err.message);
            // Mark failed so dependent nodes skip instead of running with
            // missing inputs. Independent branches still continue.
            this.failedNodes.add(step.nodeId);
            store.updateNodeData(step.nodeId, {
              status: 'error',
              errorMessage: err.message || 'Generation failed',
            });

            // Don't abort the whole workflow — skip this node and continue
            completedCount++;
            store.setRunProgress(completedCount, generateSteps.length);
          }
          break;
        }

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

    // Gather prompt from upstream text connection(s)
    let prompt = '';
    const textSourceId = inputs.get('text')?.[0];
    if (textSourceId) {
      const textResult = this.nodeResults.get(textSourceId);
      if (textResult) {
        prompt = textResult.imageUrl || ''; // imageUrl stores text for prompt nodes
      }
    }

    // Gather reference images from EVERY upstream image connection.
    // Flow accepts multiple ingredients, and the canvas allows several edges
    // into image_ref — previously only one survived.
    const referenceImageIds: string[] = [];
    const referenceImageData: string[] = [];
    for (const srcId of inputs.get('image_ref') || []) {
      const imgResult = this.nodeResults.get(srcId);
      if (!imgResult) continue;
      if (imgResult.imageUrl && imgResult.imageUrl.startsWith('data:')) {
        // Image node upload, or a ChatGPT result captured as a data URL
        referenceImageData.push(imgResult.imageUrl);
      } else if (imgResult.tileId) {
        // Upstream Flow generate node — reference its tile
        referenceImageIds.push(imgResult.tileId);
      }
    }

    // An empty prompt still submits and burns a generation on Flow, so fail
    // here with something actionable instead of at the far end of the bridge.
    if (!prompt.trim()) {
      throw new Error(
        textSourceId
          ? 'Connected prompt node is empty — type a prompt before running'
          : 'No prompt connected — link a Prompt node to the T input'
      );
    }

    const config: NodeExecutionConfig = {
      prompt,
      platform: nodeData.platform === 'chatgpt' ? 'chatgpt' : 'flow',
      model: nodeData.model || (nodeData.mediaType === 'video' ? 'Omni Flash' : 'Nano Banana Pro'),
      mediaType: nodeData.mediaType || 'image',
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
            previewVideoUrl: payload.previewVideoUrl,
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

      // Send execution command — if the port is down the command never
      // arrives and no reply is coming, so fail now rather than in 10 minutes
      if (!bridge.executeNode(nodeId, config)) {
        cleanup();
        reject(new Error('Lost connection to the extension — reopen Studio and try again'));
      }
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
