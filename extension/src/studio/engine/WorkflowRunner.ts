/* ============================================================
   WorkflowRunner — Orchestrates workflow execution
   Walks through nodes in topological order, executes each
   generate node on Google Flow via the bridge.
   ============================================================ */

import type { Node, Edge } from '@xyflow/react';
import {
  topologicalSort,
  getNodeInputs,
  getUpstreamNodeIds,
  getDownstreamNodeIds,
} from './topoSort';
import { trackUsage } from '../../shared/api';
import { bridge, type NodeExecutionConfig, type NodeResult } from './bridge';
import { useStudioStore } from '../store';

export type RunnerState = 'idle' | 'running' | 'paused' | 'stopped' | 'done' | 'error';

/** One extra attempt. Enough to ride out a blip, few enough that a node which
    is genuinely broken fails while the user is still watching. */
const MAX_AUTO_RETRIES = 1;
const AUTO_RETRY_DELAY_MS = 2500;

/**
 * Whether a failure is worth another attempt on its own.
 *
 * Deliberately narrow. Two kinds of error must never be auto-retried:
 *
 * - A timeout. The generation may still be running on Flow, so resubmitting
 *   spends a second one and leaves the user with two clips they pay for.
 * - Anything caused by the workflow itself (empty prompt, nothing connected).
 *   Those fail identically forever, and each attempt costs a prompt.
 */
export function isTransientFailure(message: string): boolean {
  const m = message || '';

  // "No result after 22 minutes" — may still be generating.
  if (/no result after/i.test(m)) return false;
  // Authoring problems, not transport problems.
  if (/prompt node is empty|no prompt connected|upstream node failed/i.test(m)) return false;

  return [
    /lost connection/i,
    /not found on the flow page/i,
    /could not fetch reference image/i,
    /failed to fetch/i,
    /network|econn|timed? out fetching/i,
    /http 5\d\d/i,
  ].some((p) => p.test(m));
}

export interface RunOptions {
  /**
   * Restrict the run to these generate nodes, keeping results already held for
   * everything else. Used by retry so successful clips are not regenerated —
   * each one costs minutes and a prompt.
   */
  only?: Set<string>;
}

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
  /**
   * Which generate nodes a retry has to run.
   *
   * A failed node alone is not enough: everything downstream was skipped
   * because of it, so those have to run too. And a retried node needs its
   * upstream results — after a Studio reload this runner holds none, so those
   * generations are pulled back in rather than failing on missing input again.
   */
  planRetry(requestedIds: string[], nodes: Node[], edges: Edge[]): Set<string> {
    const nodeById = new Map(nodes.map((n) => [n.id, n]));
    const isRunnable = (id: string) => {
      const d = nodeById.get(id)?.data as any;
      return d?.type === 'generate' && d?.enabled !== false;
    };

    const set = new Set<string>();
    for (const id of requestedIds) {
      if (isRunnable(id)) set.add(id);
      for (const down of getDownstreamNodeIds(id, edges)) {
        if (isRunnable(down)) set.add(down);
      }
    }

    const queue = [...set];
    while (queue.length) {
      const current = queue.pop()!;
      for (const up of getUpstreamNodeIds(current, edges)) {
        if (!isRunnable(up) || set.has(up) || this.nodeResults.has(up)) continue;
        set.add(up);
        queue.push(up);
      }
    }
    return set;
  }

  async run(nodes: Node[], edges: Edge[], opts: RunOptions = {}): Promise<void> {
    const store = useStudioStore.getState();
    const only = opts.only;

    // Reset
    this.state = 'running';
    this.abortRequested = false;
    this.pauseRequested = false;
    if (only) {
      // Keep what already succeeded; just clear the failure marks on the nodes
      // being retried so they are allowed to run again.
      for (const id of only) this.failedNodes.delete(id);
    } else {
      this.nodeResults.clear();
      this.failedNodes.clear();
    }
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
      if (only && !only.has(s.nodeId)) return false;
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

          // Targeted retry: anything outside the set keeps its existing result
          // and its node stays exactly as the user left it.
          if (only && !only.has(step.nodeId)) {
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
            // Its prompt event stays "pending" on purpose: the server charged
            // it at run start but it was never sent to Flow, which is exactly
            // what the dashboard's pending bucket means. Marking it failed
            // would wrongly count it as submitted.
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

          /* Attempt loop. Usage is settled exactly once per node, at its final
             outcome — an internal retry is our recovery, not a second prompt
             the user should be billed a second time for. */
          let succeeded = false;
          let lastError = 'Generation failed';

          for (let attempt = 0; attempt <= MAX_AUTO_RETRIES; attempt++) {
            if (this.abortRequested) break;

            try {
              const result = await this.executeGenerateNode(step.nodeId, node, edges);
              this.nodeResults.set(step.nodeId, result);
              this.failedNodes.delete(step.nodeId);

              store.updateNodeData(step.nodeId, {
                status: 'done',
                progress: 100,
                resultUrl: result.videoUrl || result.imageUrl || result.thumbnailUrl || '',
                previewUrl: result.previewUrl || '',
                previewVideoUrl: result.previewVideoUrl || '',
                resultTileId: result.tileId,
                errorMessage: null,
              });

              succeeded = true;
              console.log(
                `[Runner] Generate "${nodeData.label}": DONE — tile ${result.tileId}` +
                (attempt > 0 ? ` (attempt ${attempt + 1})` : '')
              );
              break;
            } catch (err: any) {
              lastError = err?.message || 'Generation failed';
              const canRetry = attempt < MAX_AUTO_RETRIES && isTransientFailure(lastError);
              console.error(
                `[Runner] Generate "${nodeData.label}" attempt ${attempt + 1} failed:`,
                lastError, canRetry ? '— retrying' : '— giving up'
              );
              if (!canRetry) break;

              store.updateNodeData(step.nodeId, { progress: 0 });
              await this.sleep(AUTO_RETRY_DELAY_MS);
            }
          }

          if (succeeded) {
            // Settle the pending prompt event the server pre-charged at run
            // start. Without this the dashboard never counts Studio prompts —
            // it only tallies events that reached done/failed.
            trackUsage(1, 'text', 'done').catch(() => { /* non-blocking */ });
          } else {
            // Mark failed so dependent nodes skip instead of running with
            // missing inputs. Independent branches still continue.
            this.failedNodes.add(step.nodeId);
            store.updateNodeData(step.nodeId, {
              status: 'error',
              errorMessage: lastError,
            });
            trackUsage(1, 'text', 'failed').catch(() => { /* non-blocking */ });
          }

          // Don't abort the whole workflow — move on to the next node
          completedCount++;
          store.setRunProgress(completedCount, generateSteps.length);
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
      if (imgResult.referenceUrl && imgResult.referenceUrl.startsWith('data:')) {
        // Captured when the upstream node finished, so it cannot go missing.
        // Preferred over the tile id: resolving a tile from the DOM minutes
        // later failed whenever Flow's grid had recycled it.
        referenceImageData.push(imgResult.referenceUrl);
      } else if (imgResult.imageUrl && imgResult.imageUrl.startsWith('data:')) {
        // Image node upload, or a ChatGPT result captured as a data URL
        referenceImageData.push(imgResult.imageUrl);
      } else if (imgResult.tileId) {
        // Fallback for results captured before referenceUrl existed, or when
        // the capture itself failed.
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

    /**
     * Give up only AFTER the content script has, never before.
     *
     * The content script tracks a tile for 20 minutes; this side used to give
     * up at 10, so a slow generation was failed here while it was still being
     * watched — and still running on Flow. Images finish in about a minute and
     * never reached it, which is why only video nodes saw
     * "Generation timed out after 10 minutes".
     *
     * Video gets the full budget plus a margin; images need far less, so a
     * genuinely stuck image node still fails reasonably fast.
     */
    const isVideoNode = config.mediaType === 'video';
    const timeoutMs = isVideoNode ? 22 * 60 * 1000 : 8 * 60 * 1000;
    const timeoutLabel = isVideoNode ? '22 minutes' : '8 minutes';

    // Send to Flow via bridge
    return new Promise<NodeResult>((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        // The tile may well be finishing on Flow — say so instead of implying
        // the generation itself failed.
        reject(new Error(
          `No result after ${timeoutLabel}. The generation may still be running — ` +
          `check the Flow tab before re-running this node.`
        ));
      }, timeoutMs);

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
            referenceUrl: payload.referenceUrl,
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
