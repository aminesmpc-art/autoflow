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
import { composeAskPrompt } from '../presets';
import {
  isFramesMode, extendChain, secondsOf, GROK_MAX_TOTAL_SECONDS,
} from '../templates/validate';

export type RunnerState = 'idle' | 'running' | 'paused' | 'stopped' | 'done' | 'error';

/**
 * Platforms driven through a chat window rather than Flow's composer.
 *
 * A list rather than a chain of equality checks, which is what this was. Adding
 * Gemini meant remembering to widen a `chatgpt/else` ternary, and the one that
 * was missed sent every Gemini node to Flow — silently, because Flow accepts
 * any prompt. Grok would have been the same bug a second time.
 */
export const CHAT_PLATFORMS = ['chatgpt', 'gemini', 'grok'];

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

/**
 * Whether a failure makes every remaining node pointless.
 *
 * Distinct from isTransientFailure, which asks "try this node again?". This
 * asks "is there any reason to keep going at all?" — and for a quota that is
 * gone, or an account that is not signed in, the honest answer is no. Every
 * later node would fail identically, each after its own multi-minute wait.
 *
 * Deliberately short. Anything not listed keeps the old behaviour of failing
 * one node and letting independent branches continue, because stopping a run
 * that could have finished is its own kind of expensive.
 */
export function isRunFatal(message: string): boolean {
  const m = message || '';
  return [
    /out of credits/i,
    /not enough .*credits/i,
    /sign(ed)? in|not signed in|logged out/i,
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
      /* An extend is a generation and has to be treated as one here, or a
         retry neither re-runs it nor pulls in the clip it continues — and it
         then fails with "no clip to continue" against a canvas that is wired
         correctly. */
      return (d?.type === 'generate' || d?.type === 'extend') && d?.enabled !== false;
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
      // An extend is a generation: its own prompt, its own clip, its own wait.
      if (s.nodeType !== 'generate' && s.nodeType !== 'extend') return false;
      if (only && !only.has(s.nodeId)) return false;
      const n = nodes.find((x) => x.id === s.nodeId);
      return (n?.data as any)?.enabled !== false;
    });
    /* Clear what the last attempt left on screen.
     *
     * Retrying cleared the internal failure marks but not the node data, so a
     * downstream node kept showing "Skipped — upstream node failed" while the
     * upstream node was visibly regenerating above it. The run looked like it
     * had already failed before it reached them. */
    for (const step of generateSteps) {
      store.updateNodeData(step.nodeId, { status: 'idle', progress: 0, errorMessage: null });
    }

    store.setRunProgress(0, generateSteps.length);
    let completedCount = 0;

    /* Report the run to the side panel. During a run the user is watching the
       platform tab, not this canvas, so the panel is the only place they can
       see what is happening or stop it. */
    const report = (patch: Record<string, unknown>) =>
      bridge.send('STUDIO_RUN_STATE', {
        running: true,
        paused: this.pauseRequested,
        done: completedCount,
        total: generateSteps.length,
        ...patch,
      });
    report({ nodeLabel: 'Starting…', progress: 0, lastError: '' });

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

        case 'frame': {
          /* The end frame of the clip above, surfaced as an image.
             Nothing is captured here — the content script already grabbed it
             when that clip finished, because the tile was certain to exist at
             that moment and may be recycled later. This node only makes the
             frame visible and reusable. */
          const source = getNodeInputs(step.nodeId, edges).get('image_ref')?.[0];
          const upstream = source ? this.nodeResults.get(source) : undefined;
          const frameUrl = upstream?.referenceUrl || '';

          this.nodeResults.set(step.nodeId, { tileId: '', imageUrl: frameUrl });
          store.updateNodeData(step.nodeId, { frameUrl });

          if (!frameUrl) {
            // Not fatal: a downstream node will fail with its own clear
            // message about a missing reference rather than generating
            // silently without one.
            console.warn(`[Runner] Frame "${nodeData.label}": upstream produced no capturable frame`);
          } else {
            console.log(`[Runner] Frame "${nodeData.label}": captured ${Math.round(frameUrl.length / 1024)}KB`);
          }
          break;
        }

        case 'extend':
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
          report({ nodeLabel: nodeData.label || 'Generating', progress: 0 });

          /* Attempt loop. Usage is settled exactly once per node, at its final
             outcome — an internal retry is our recovery, not a second prompt
             the user should be billed a second time for. */
          let succeeded = false;
          let lastError = 'Generation failed';

          for (let attempt = 0; attempt <= MAX_AUTO_RETRIES; attempt++) {
            if (this.abortRequested) break;

            try {
              const result = await this.executeGenerateNode(step.nodeId, node, edges);

              if (nodeData.mediaType === 'text') {
                // A written answer, not media. Stored the same way a Prompt
                // node stores its text, so a downstream node's T input reads
                // it with no special handling.
                this.nodeResults.set(step.nodeId, { tileId: '', imageUrl: result.text || '' });
              } else {
                this.nodeResults.set(step.nodeId, result);
              }
              this.failedNodes.delete(step.nodeId);

              store.updateNodeData(step.nodeId, {
                status: 'done',
                progress: 100,
                resultUrl: result.videoUrl || result.imageUrl || result.thumbnailUrl || '',
                previewUrl: result.previewUrl || '',
                previewVideoUrl: result.previewVideoUrl || '',
                resultTileId: result.tileId,
                // Shown on the node so the written prompt is reviewable.
                resultText: result.text || '',
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

          /* Some failures are the workflow's, and the run should carry on to
             the branches that do not depend on them. Running out of credits is
             not one of those: the next node has exactly as many credits as
             this one, so continuing means watching every remaining node fail
             the same way — and a video node that never starts still holds the
             runner for its full 22-minute budget first. On a six-node overnight
             queue that is over an hour of waiting to be told the same thing
             six times. Stop, and say why. */
          if (!succeeded && isRunFatal(lastError)) {
            console.error(`[Runner] Stopping the run: ${lastError}`);
            this.abortRequested = true;
            report({ nodeLabel: '', progress: 0, lastError });
            for (const later of generateSteps) {
              if (later.nodeId === step.nodeId || this.nodeResults.has(later.nodeId)) continue;
              if (this.failedNodes.has(later.nodeId)) continue;
              store.updateNodeData(later.nodeId, {
                status: 'idle',
                progress: 0,
                errorMessage: 'Not run — the run stopped before reaching this node',
              });
            }
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
    report({ running: false, paused: false, nodeLabel: '', progress: 0 });
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
    /* An extend runs the same path — submit a prompt, wait for a clip — but
       everything it sends is decided by the chain it sits in rather than by
       its own dropdowns. */
    const isExtendNode = node.type === 'extend' || nodeData.type === 'extend';

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

    /* Frames mode hands Flow a first and last still and lets it interpolate.
       The order is the whole meaning — swap them and the clip runs backwards —
       so it comes from two named ports rather than the order edges happen to
       sit in. Edge order is invisible on the canvas and changes when a
       connection is remade, which is not something to hang a video on. */
    const isFrames = isFramesMode(nodeData);
    const orderedSources = isFrames
      ? [...(inputs.get('frame_start') || []), ...(inputs.get('frame_end') || [])]
      : (inputs.get('image_ref') || []);

    for (const srcId of orderedSources) {
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

    /* A broken link in a chain must not generate anyway.
       The styrofoam template depends on every clip starting from the previous
       one's last frame. If a capture came back empty, this node would generate
       regardless — same prompt, no continuity — and the only symptom would be
       a clip that quietly restarts the sculpture halfway through a six-clip
       sequence. Burn nothing, and name the link that broke.

       Scoped to frame and generate sources on purpose: an image node left
       empty is the user's choice — several templates ship with blank slots and
       prompts written to work without one — whereas a frame or a clip that
       produced nothing is a failure that already happened upstream. */
    if (!referenceImageIds.length && !referenceImageData.length) {
      const allNodes = useStudioStore.getState().nodes;
      const broken = orderedSources
        .map((id) => allNodes.find((n) => n.id === id))
        .filter((n) => n && (n.type === 'frame' || n.type === 'generate'));
      if (broken.length) {
        const names = broken.map((n) => (n!.data as any)?.label || n!.id);
        throw new Error(
          `Nothing to continue from — ${names.join(', ')} produced no usable frame`
        );
      }

      /* Frames mode without frames is not a mode, it is an ordinary
         generation wearing its name. Flow would accept the prompt and return
         a plausible clip that starts and ends nowhere near the stills the
         user wired up, and the only symptom would be a clip that looks
         unrelated. This is how the mode failed on its first outing: the node
         drew no S or E port at all, every image landed on the old reference
         port, and the run submitted with nothing attached. */
      if (isFrames) {
        throw new Error(
          'Frames mode has no images — wire one into S (start) and one into E (end), ' +
          'or switch FROM back to Ingredients'
        );
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

    /* Ask AI presets wrap the user's subject in the craft.
       Composed here rather than in the node because the variant depends on
       whether a reference image actually resolved — "character sheet from a
       photo" and "from a description" are different briefs, and only this
       point knows which one applies. */
    const askPrompt = nodeData.mediaType === 'text'
      ? composeAskPrompt(
          nodeData.preset,
          prompt,
          referenceImageData.length > 0 || referenceImageIds.length > 0
        )
      : prompt;

    /* Grok's Extend continues a clip rather than making one, so the node needs
       the clip itself — not a still of it. Taken from the upstream node's
       result, which for a Grok video holds the mp4 URL the content script uses
       to find it again in Grok's history.

       Failing here rather than in the tab: without it the run would enter an
       ordinary generation and produce a brand-new clip that looks like a
       success and breaks the continuity the node existed for. */
    let extendFromVideo: string | undefined;
    if (isExtendNode) {
      const { nodes: allNodes, edges: allEdges } = useStudioStore.getState();
      const chain = extendChain(nodeId, allNodes, allEdges);
      if (chain.problem) throw new Error(chain.problem);

      /* Refused here rather than in the tab. Imagine will not complete a clip
         past 30 seconds, and finding that out at the far end costs every
         generation before it in the chain. */
      const total = chain.secondsBefore + secondsOf(nodeData.extendSeconds || '+10s');
      if (total > GROK_MAX_TOTAL_SECONDS) {
        throw new Error(
          `${nodeData.extendSeconds || '+10s'} would make this clip ${total}s, past Grok's `
          + `${GROK_MAX_TOTAL_SECONDS}s limit — choose a smaller step or shorten the clip it continues`
        );
      }

      const srcId = inputs.get('video')?.[0];
      const upstream = srcId ? this.nodeResults.get(srcId) : undefined;
      /* videoUrl FIRST, because it is the only field guaranteed to be the
         clip's address on Grok. previewVideoUrl holds the inlined data: URL
         whenever the clip was small enough to travel — which is the normal
         case — and a data: URL is useless here: extend finds the clip again by
         the generation id in its path. Reading it first meant a clip that
         played perfectly in the node could not be extended, and the reason
         given was that no Grok video had been produced. */
      extendFromVideo = upstream?.videoUrl || upstream?.imageUrl || upstream?.previewVideoUrl || '';
      if (!extendFromVideo || !/generated_video|assets\.grok\.com|\.mp4($|\?)/.test(extendFromVideo)) {
        throw new Error(
          'Extend has no clip to continue — the node before it produced no Grok video'
        );
      }
    }

    const config: NodeExecutionConfig = {
      prompt: askPrompt,
      // Anything not a known chat platform runs on Flow. Listing them beats
      // a chatgpt/else ternary, which silently sent Gemini nodes to Flow.
      platform: isExtendNode ? 'grok'
        : CHAT_PLATFORMS.includes(nodeData.platform) ? nodeData.platform
        : 'flow',
      model: nodeData.model || (nodeData.mediaType === 'video' ? 'Omni Flash' : 'Nano Banana Pro'),
      mediaType: isExtendNode ? 'video' : (nodeData.mediaType || 'image'),
      aspectRatio: nodeData.aspectRatio || '9:16',
      duration: nodeData.duration || '6s',
      // Grok reads these; Flow ignores them.
      resolution: isExtendNode ? undefined : (nodeData.resolution || undefined),
      extend: isExtendNode ? true : undefined,
      extendSeconds: isExtendNode ? (nodeData.extendSeconds || '+10s') : undefined,
      extendFromVideo,
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
    // Asking ChatGPT for text is a chat round-trip, so it fails fast rather
    // than holding a workflow open for minutes.
    const isTextNode = config.mediaType === 'text';
    /* 3 minutes, not 2: a ChatGPT node can now spend up to 45s uploading
       reference images before it even asks the question, and the old budget
       left the reply only 30s of headroom — the outer wait would have expired
       first and blamed the model for a slow upload. */
    const timeoutMs = isTextNode ? 3 * 60 * 1000 : isVideoNode ? 22 * 60 * 1000 : 8 * 60 * 1000;
    const timeoutLabel = isTextNode ? '3 minutes' : isVideoNode ? '22 minutes' : '8 minutes';

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
            text: payload.text,
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
