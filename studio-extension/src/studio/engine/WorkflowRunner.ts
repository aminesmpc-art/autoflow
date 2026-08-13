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
  shotContract, parseShots, checkShots, repairMessage, summarise,
  orderShotTargets, type ShotTarget,
} from '../ask/storyboard';
import { runAgent, type AgentStep, type ToolOutcome } from './agent';
import { toolsByName } from './tools';
import {
  isFramesMode, extendChain, secondsOf, isRunnableType, GROK_MAX_TOTAL_SECONDS,
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

/** Nodes one agent run may re-run. Each is minutes and a real generation, so
    a model that keeps "trying once more" has to hit a wall it cannot argue with. */
const AGENT_MAX_RERUNS = 3;
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

  /* Prompts written by one Ask AI node for several downstream nodes at once,
     in the order the contract listed them. Separate from nodeResults because
     the ask has ONE result and the consumers need one each — putting them in
     the result would mean every reader had to know it might be an array. */
  private shotPlans = new Map<string, string[]>();

  /** Nodes that failed or were skipped — dependents must not run on partial input */
  private failedNodes = new Set<string>();

  /** Re-runs the current agent node has spent. Reset when one starts. */
  private agentReruns = 0;

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
      return isRunnableType(d?.type) && d?.enabled !== false;
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
      if (!isRunnableType(s.nodeType)) return false;
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

        /* All three take the same path: check they are enabled and their
           inputs survived, then run with the retry and usage handling below.
           An agent differs only inside executeGenerateNode, which sends it to
           its loop instead of a single generation.

           Missing from this list, an agent node fell through to `default` and
           was logged as an unknown type — counted in the progress total, then
           silently skipped. The run finished instantly having done nothing. */
        case 'agent':
        case 'story':
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
      /* When the upstream Ask AI wrote the whole set in one pass, this node
         gets the one addressed to it rather than all of them. Falls through to
         the plain reply whenever there is no plan, which is every ordinary
         single-answer Ask AI node. */
      const mine = this.shotFor(textSourceId, nodeId, edges);
      if (mine !== null) {
        prompt = mine;
      } else {
        const textResult = this.nodeResults.get(textSourceId);
        if (textResult) {
          prompt = textResult.imageUrl || ''; // imageUrl stores text for prompt nodes
        }
      }
    }

    /* An agent is not one round trip, so it leaves here before any of the
       generation machinery below applies to it. */
    if (node.type === 'agent' || nodeData.type === 'agent') {
      return this.executeAgentNode(nodeId, nodeData, prompt, edges);
    }

    /* A Story node writes for other nodes, so it leaves here too. It is the
       explicit form of what an Ask AI node was doing by inference: the user
       wires it to the nodes it is responsible for, and it writes all of them
       in one reply having been shown what each of them is configured to do. */
    if (node.type === 'story' || nodeData.type === 'story') {
      const targets = this.shotTargetsFor(nodeId, edges);
      if (!targets.length) {
        throw new Error(
          'This Story node is not wired to anything — connect its output to the '
          + 'nodes whose prompts it should write'
        );
      }
      if (!prompt.trim()) {
        throw new Error('No idea connected — link a Prompt node to the T input');
      }
      const brief = composeAskPrompt(nodeData.preset, prompt, false);
      return this.executeStoryboardAsk(nodeId, nodeData, brief, targets);
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
    let askPrompt = nodeData.mediaType === 'text'
      ? composeAskPrompt(
          nodeData.preset,
          prompt,
          referenceImageData.length > 0 || referenceImageIds.length > 0
        )
      : prompt;

    /* One Ask AI feeding several generators is a storyboard, not a question.
       Asking it once for all of them is the only way the prompts can agree
       with each other — the model can see shot 2 while it writes shot 3,
       which no amount of separate conversations will give you.

       Detected from the graph rather than a switch. A node wired to four
       generators is already saying what it is, and a setting that had to be
       found and turned on would be off in exactly the workflows that need it
       most. `askMode: 'single'` opts out for anyone who wants the old way. */
    if (nodeData.mediaType === 'text' && nodeData.askMode !== 'single') {
      const targets = this.shotTargetsFor(nodeId, edges);
      /* One target or ten, the reply comes back as JSON and gets checked.
         A single ask used to hand its raw prose straight to a generator, so
         "Here's a prompt for your poster:" was typed into the composer along
         with the prompt. The envelope removes that whole class of problem, and
         the checker catches the rest before anything is spent.

         Zero targets means the node feeds a person or another writer, not a
         generator — there is no format to hold it to, so it stays free text. */
      if (targets.length >= 1) {
        return this.executeStoryboardAsk(nodeId, nodeData, askPrompt, targets);
      }
    }

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
      /* Imagine's still controls. Undefined means "leave the toolbar alone",
         which is the honest default — the adapter only touches a control the
         node actually asked for. */
      imageCount: nodeData.imageCount || undefined,
      quality: nodeData.quality || undefined,
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

    return this.awaitBridge(nodeId, config, timeoutMs, timeoutLabel);
  }

  /**
   * Send one command over the bridge and wait for its result.
   *
   * Extracted so the agent loop can reuse it: an agent turn is the same
   * round trip a node makes, just many times over with the thread held open.
   * Results are matched on nodeId, so callers must not overlap two of these
   * for the same node — the loop is sequential, which is why it can.
   */
  private awaitBridge(
    nodeId: string,
    config: NodeExecutionConfig,
    timeoutMs: number,
    timeoutLabel: string
  ): Promise<NodeResult> {
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

  /**
   * Run an agent node: one goal, a loop, one answer.
   *
   * The loop lives in engine/agent.ts and knows nothing about canvases or
   * bridges. This binds it to both — `ask` is a chat turn with the thread held
   * open after the first, `runTool` is a real action — and then decides what a
   * given stop reason means for the node.
   */
  private async executeAgentNode(
    nodeId: string, nodeData: any, goal: string, edges: Edge[]
  ): Promise<NodeResult> {
    const store = useStudioStore.getState();

    if (!goal.trim()) {
      throw new Error('No goal connected — link a Prompt node to the T input');
    }

    const tools = toolsByName(nodeData.tools);
    const platform = CHAT_PLATFORMS.includes(nodeData.platform) ? nodeData.platform : 'chatgpt';
    /* Every iteration is a real generation with a real cost, so the cap is
       clamped here rather than trusted from node data. */
    const maxIterations = Math.max(1, Math.min(10, Number(nodeData.maxIterations) || 4));

    const steps: AgentStep[] = [];
    this.agentReruns = 0;
    store.updateNodeData(nodeId, { agentSteps: [], agentStopReason: null, resultText: '' });

    const result = await runAgent({
      goal,
      system: nodeData.system || undefined,
      tools,
      maxIterations,
      shouldAbort: () => this.abortRequested,
      onStep: (s) => {
        steps.push(s);
        // Copied, not pushed in place: the store compares by reference.
        store.updateNodeData(nodeId, { agentSteps: [...steps] });
      },
      ask: (message, ctx) => this.askAgent(nodeId, platform, message, ctx.firstTurn, ctx.attachments),
      runTool: (name, args) => this.runAgentTool(nodeId, name, args, edges),
    });

    store.updateNodeData(nodeId, {
      agentSteps: [...steps],
      agentStopReason: result.stopReason,
      resultText: result.answer,
    });

    /* A claim is not a result.
       Live ChatGPT said "Two images produced" having called nothing, twice,
       and more insistently after being corrected. Passing that answer to the
       next node would put a fabricated success into the workflow, so the node
       fails instead and says what was claimed. */
    if (result.stopReason === 'done-without-tools') {
      throw new Error(
        'The agent said it had finished but never ran a tool, so nothing was produced. '
        + `It claimed: "${short(result.answer)}"`
      );
    }
    if (result.stopReason === 'max-iterations') {
      throw new Error(
        `The agent used all ${maxIterations} iterations without finishing. `
        + 'Raise the limit, or give it a smaller goal.'
      );
    }
    if (result.stopReason === 'format') {
      throw new Error(
        'The agent would not answer in the required format. Its last reply: '
        + `"${short(result.answer)}"`
      );
    }
    if (result.stopReason === 'aborted') throw new Error('Stopped');

    return { tileId: '', text: result.answer };
  }

  /** One turn of the agent's conversation. The thread stays open after the first. */
  /**
   * The generate nodes this Ask AI writes for, in canvas order.
   *
   * Order has to be stable and it has to match what the contract told the
   * model, or shot 3 lands on the node expecting shot 1. Sorted by position
   * rather than edge order: edges are stored in creation order, so rewiring a
   * connection would silently renumber every shot after it.
   */
  private shotTargetsFor(askId: string, edges: Edge[]): ShotTarget[] {
    return orderShotTargets(askId, useStudioStore.getState().nodes as any, edges as any);
  }


  /** This node's own shot, or null when the source did not write a set. */
  private shotFor(sourceId: string, nodeId: string, edges: Edge[]): string | null {
    const plan = this.shotPlans.get(sourceId);
    if (!plan) return null;
    const idx = this.shotTargetsFor(sourceId, edges).findIndex((t) => t.id === nodeId);
    if (idx < 0 || idx >= plan.length) return null;
    return plan[idx];
  }

  /**
   * Get the prompts as JSON, then refuse to hand over a set that will not
   * survive the composer.
   *
   * The loop is the point. A single request produces a usable set most of the
   * time, and the rest of the time it produces one with a code fence in shot 2
   * — which is only discovered when that clip renders three backticks. Here
   * the fence is found before anything is spent, described back to the model
   * in the same thread, and fixed for the cost of one more turn.
   *
   * It gives up rather than degrading. A set that still fails after the
   * repairs would produce broken clips at full price, and "ran and wasted your
   * generations" is worse than "stopped and said why".
   */
  private async executeStoryboardAsk(
    nodeId: string,
    nodeData: any,
    brief: string,
    targets: ShotTarget[]
  ): Promise<NodeResult> {
    const store = useStudioStore.getState();
    const platform = CHAT_PLATFORMS.includes(nodeData.platform) ? nodeData.platform : 'chatgpt';
    const MAX_REPAIRS = 2;

    let message = brief + '\n' + shotContract(targets);
    let best: { shots: string[]; problems: number; story: string } | null = null;

    for (let round = 0; round <= MAX_REPAIRS; round++) {
      if (this.abortRequested) throw new Error('Stopped');

      store.updateNodeData(nodeId, {
        status: 'running',
        statusNote: round === 0
          ? `Writing ${targets.length} prompts…`
          : `Fixing the format (${round} of ${MAX_REPAIRS})…`,
      });

      const reply = await this.askAgent(nodeId, platform, message, round === 0);
      const { shots, anchor, story, problem } = parseShots(reply);

      if (problem) {
        console.warn(`[Runner] Storyboard: ${problem}`);
        if (round === MAX_REPAIRS) break;
        message = `${problem}\n\nSend only the JSON object described earlier — `
          + `no prose around it, no code fence.`;
        continue;
      }

      const problems = checkShots(shots, targets, anchor);
      console.log(`[Runner] Storyboard round ${round + 1}: ${summarise(problems)}`);

      if (!best || problems.length < best.problems) {
        best = { shots: shots.map((sh) => sh.prompt), problems: problems.length, story: story || '' };
      }
      if (!problems.length) break;
      if (round === MAX_REPAIRS) break;
      message = repairMessage(problems, targets);
    }

    if (!best || !best.shots.length) {
      throw new Error(
        `Could not get ${targets.length} usable prompts from ${platform} after `
        + `${MAX_REPAIRS + 1} attempts — open the chat tab to see what it replied`
      );
    }
    if (best.problems > 0) {
      throw new Error(
        `The prompts still fail the format check after ${MAX_REPAIRS} repairs `
        + `(${best.problems} problem${best.problems === 1 ? '' : 's'}). Stopping rather than `
        + `spending ${targets.length} generations on prompts that will not render correctly.`
      );
    }
    if (best.shots.length < targets.length) {
      throw new Error(
        `Only ${best.shots.length} of ${targets.length} prompts came back — nothing was run`
      );
    }

    this.shotPlans.set(nodeId, best.shots);

    /* The node itself shows the whole set, because that is what was written
       here; each generator shows the one it received. */
    const combined = best.shots
      .map((p, i) => `${targets[i].label || `Shot ${i + 1}`}\n${p}`)
      .join('\n\n');
    store.updateNodeData(nodeId, {
      statusNote: '',
      resultText: combined,
      // Shown on the Story node as a tick beside each target it covered.
      shotTitles: targets.map((t, i) => t.label || `Shot ${i + 1}`),
    });
    return { tileId: '', text: combined };
  }

  private async askAgent(
    nodeId: string, platform: string, message: string, firstTurn: boolean,
    attachments?: string[]
  ): Promise<string> {
    /* Uploading can take the adapter most of a minute before the question is
       even asked, and a clip is far bigger than a still, so a turn carrying
       one gets a longer budget than an Ask AI node with references. */
    const timeoutMs = attachments?.length ? 6 * 60 * 1000 : 3 * 60 * 1000;
    const res = await this.awaitBridge(nodeId, {
      prompt: message,
      model: '',
      mediaType: 'text',
      aspectRatio: '16:9',
      creationType: 'ingredients',
      platform: platform as any,
      // Only the opening turn may reset — after that the thread is the memory.
      newChat: firstTurn ? 'auto' : 'never',
      /* A TOOL block is not a prompt, and the prompt heuristic would reject a
         short one outright. The agent parser does its own unwrapping. */
      rawReply: true,
      /* The rendered file, so "did this come out right?" is a question about
         something in context rather than about a sentence describing it. The
         adapter field is named for images but carries any data: URL. */
      referenceImageData: attachments?.length ? attachments : undefined,
    }, timeoutMs, attachments?.length ? '6 minutes' : '3 minutes');
    return res.text || '';
  }

  /** Perform one tool call and describe the outcome back to the model. */
  private async runAgentTool(
    nodeId: string, name: string, args: Record<string, unknown>, edges: Edge[]
  ): Promise<ToolOutcome> {
    if (name === 'read_canvas') {
      /* The tool the model cannot fake, which is the point of it: it has never
         seen this canvas, so an invented answer is immediately wrong. */
      const { nodes } = useStudioStore.getState();
      if (!nodes.length) return 'The canvas is empty.';
      return nodes
        .map((n) => {
          const d = n.data as any;
          return `- ${n.id} (${d?.type || n.type}): ${d?.label || 'untitled'}`;
        })
        .join('\n');
    }

    if (name === 'generate_image') {
      const prompt = String(args.prompt ?? '').trim();
      if (!prompt) throw new Error('generate_image was called with no prompt');
      const res = await this.awaitBridge(nodeId, {
        prompt,
        model: 'Nano Banana Pro',
        mediaType: 'image',
        aspectRatio: '16:9',
        creationType: 'ingredients',
        platform: 'flow',
      }, 8 * 60 * 1000, '8 minutes');

      const url = res.imageUrl || res.thumbnailUrl || '';
      if (!url) {
        // "It finished" and "it produced something" are different facts.
        return 'The generation finished but returned no image.';
      }

      /* Hand back the picture, not a sentence about it. Only a data: URL can
         be attached to a chat turn — previewUrl is the captured bytes, while
         imageUrl is an address on Flow the chat cannot fetch. When there is no
         data: URL the honest move is to say the image cannot be inspected,
         because the alternative is the model confidently reviewing an image it
         never saw. */
      const inspectable = [res.previewUrl, res.imageUrl]
        .filter((u): u is string => typeof u === 'string' && u.startsWith('data:'));

      return inspectable.length
        ? {
          observation: 'Image rendered on Flow.',
          attachments: [inspectable[0]],
          attachmentNoun: 'image' as const,
        }
        : {
          observation:
            'Image rendered on Flow, but it could not be attached for you to look at, '
            + 'so you cannot judge how it came out. Do not describe it. Treat this as '
            + 'rendered-but-unverified.',
        };
    }

    if (name === 'inspect_clip') {
      const id = String(args.node ?? '').trim();
      if (!id) throw new Error('inspect_clip needs a node id');

      const res = this.nodeResults.get(id);
      if (!res) {
        /* Named rather than guessed at: the model picked this id from
           read_canvas, and a node that has not run yet is a different problem
           from one that does not exist. */
        return `Node "${id}" has not produced anything in this run. `
          + 'Only nodes that already ran have a clip to watch.';
      }

      /* previewVideoUrl is the captured bytes; videoUrl is an address on the
         generating site that a chat tab cannot fetch. Only the former can be
         attached, and without it the honest answer is that the clip cannot be
         watched — not a description of one nobody saw. */
      const clip = [res.previewVideoUrl, res.videoUrl]
        .find((u): u is string => typeof u === 'string' && u.startsWith('data:'));
      if (!clip) {
        return `Node "${id}" produced no clip that can be attached, so you `
          + 'cannot watch it. Do not describe it. Say that it could not be inspected.';
      }

      return {
        observation: `Clip from node "${id}".`,
        attachments: [clip],
        attachmentNoun: 'clip' as const,
      };
    }

    /* ── Acting on the workflow ── */

    const nodes = useStudioStore.getState().nodes;
    const findNode = (id: string) => nodes.find((n) => n.id === id);
    /* A generate node does not hold its own prompt — a Prompt node upstream
       does. Reading or rewriting "the prompt of gen_sheet_A" therefore has to
       resolve through the wire, or the agent edits a field nothing reads. */
    const promptSourceFor = (id: string): Node | undefined => {
      const srcId = getNodeInputs(id, edges).get('text')?.[0];
      return srcId ? findNode(srcId) : undefined;
    };

    if (name === 'read_node') {
      const id = String(args.node ?? '').trim();
      const node = findNode(id);
      if (!node) return `There is no node "${id}" on this canvas.`;
      const d = node.data as any;

      const out = [`id: ${id}`, `type: ${d.type || node.type}`, `label: ${d.label || '(none)'}`];
      for (const [k, v] of [
        ['platform', d.platform], ['makes', d.mediaType], ['model', d.model],
        ['aspect', d.aspectRatio], ['duration', d.duration], ['resolution', d.resolution],
      ] as Array<[string, unknown]>) {
        if (v) out.push(`${k}: ${v}`);
      }
      out.push(`status: ${d.status || 'idle'}`);
      if (d.errorMessage) out.push(`error: ${d.errorMessage}`);

      if (d.type === 'prompt') {
        out.push('prompt (held by this node):', d.text || '(empty)');
      } else {
        const src = promptSourceFor(id);
        out.push(src
          ? `prompt (held by node "${src.id}", change it there):`
          : 'no prompt node is wired to this one');
        if (src) out.push((src.data as any).text || '(empty)');
      }
      return out.join('\n');
    }

    if (name === 'set_prompt') {
      const id = String(args.node ?? '').trim();
      const text = String(args.text ?? '');
      if (!text.trim()) throw new Error('set_prompt needs the new prompt text');

      const node = findNode(id);
      if (!node) return `There is no node "${id}" on this canvas.`;

      const d = node.data as any;
      const target = d.type === 'prompt' ? node : promptSourceFor(id);
      if (!target) {
        return `Node "${id}" has no Prompt node wired to its text input, so there `
          + 'is nothing to rewrite.';
      }

      useStudioStore.getState().updateNodeData(target.id, { text });
      /* And the cached copy. The runner reads a node's prompt out of
         nodeResults, which was filled when the Prompt node was visited at the
         start of the run — updating only the canvas would leave a re-run using
         the OLD text while the node on screen showed the new one. */
      this.nodeResults.set(target.id, { tileId: '', imageUrl: text });

      return target.id === id
        ? `Rewrote the prompt on "${id}". It is not running yet.`
        : `Rewrote "${target.id}", the prompt feeding "${id}". It is not running yet.`;
    }

    if (name === 'rerun_node') {
      const id = String(args.node ?? '').trim();
      /* An agent re-running itself is an infinite loop that spends a
         generation per turn until the cap. Refused outright. */
      if (id === nodeId) throw new Error('An agent cannot re-run itself');

      const node = findNode(id);
      if (!node) return `There is no node "${id}" on this canvas.`;
      const d = node.data as any;
      if (!isRunnableType(d.type)) {
        return `Node "${id}" is a ${d.type} node — it carries data and never runs. `
          + 'Only generate, extend and agent nodes can be run.';
      }
      if (this.agentReruns >= AGENT_MAX_RERUNS) {
        return `Already re-ran ${AGENT_MAX_RERUNS} nodes this run, which is the limit. `
          + 'Report what you found instead of trying again.';
      }
      this.agentReruns++;

      const store = useStudioStore.getState();
      store.updateNodeData(id, { status: 'running', progress: 0, errorMessage: null });
      try {
        const result = await this.executeGenerateNode(id, node, edges);
        this.nodeResults.set(id, d.mediaType === 'text'
          ? { tileId: '', imageUrl: result.text || '' }
          : result);
        this.failedNodes.delete(id);
        store.updateNodeData(id, {
          status: 'done',
          progress: 100,
          resultUrl: result.videoUrl || result.imageUrl || result.thumbnailUrl || '',
          previewUrl: result.previewUrl || '',
          previewVideoUrl: result.previewVideoUrl || '',
          resultTileId: result.tileId,
          resultText: result.text || '',
          errorMessage: null,
        });

        // Hand back what it produced, so the fix can be judged rather than assumed.
        const still = [result.previewUrl, result.imageUrl]
          .find((u): u is string => typeof u === 'string' && u.startsWith('data:'));
        if (still) {
          return {
            observation: `Node "${id}" ran again.`,
            attachments: [still],
            attachmentNoun: 'image' as const,
          };
        }
        const clip = [result.previewVideoUrl, result.videoUrl]
          .find((u): u is string => typeof u === 'string' && u.startsWith('data:'));
        if (clip) {
          return {
            observation: `Node "${id}" ran again.`,
            attachments: [clip],
            attachmentNoun: 'clip' as const,
          };
        }
        return `Node "${id}" ran again${result.text ? `, and answered: ${short(result.text, 300)}` : ''}. `
          + 'Nothing could be attached, so you cannot see the result — do not describe it.';
      } catch (e: any) {
        const message = e?.message || String(e);
        this.failedNodes.add(id);
        store.updateNodeData(id, { status: 'error', errorMessage: message });
        // Information, not an abort: it can try a different prompt.
        return `Node "${id}" failed again: ${message}`;
      }
    }

    throw new Error(`${name} is not a tool this node can run`);
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

/** One line of a model's answer, for an error message that has to stay readable. */
function short(s: string, n = 120): string {
  const one = (s || '').replace(/\s+/g, ' ').trim();
  return one.length > n ? `${one.slice(0, n - 1)}…` : one;
}

/** Singleton runner instance */
export const runner = new WorkflowRunner();
