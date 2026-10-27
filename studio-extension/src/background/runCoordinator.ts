import type {
  RunState, RunManifest, RunOptions, ExecutionSnapshot,
  NodeExecutionStatus, SerializedNode, SerializedEdge,
  SwToCanvasMessage,
} from '../shared/executionTypes';
import { needsCanvasNode } from '../shared/executionTypes';
import { shotPromptFor } from '../shared/shotPrompt';
import { extendChain, secondsOf, GROK_MAX_TOTAL_SECONDS } from '../studio/templates/validate';
import { frameReferencesFor, inlineFrame, type FrameReference } from '../shared/frameReferences';
import { saveSnapshot, loadSnapshot, clearSnapshot } from './coordinatorState';
import {
  beginRun, finishRun, cancelRun, isRunCancelled,
  beginAttempt, recordSubmitted, settleAttempt, recoverable,
} from '../shared/runJournal';
import { trackUsage, trackSubmission } from '../shared/api';
import { videoReferenceFor } from '../shared/videoReference';

export interface NodeExecutionConfig {
  retryFailedMotion?: boolean;
  prompt: string;
  platform?: 'flow' | 'chatgpt' | 'gemini' | 'grok' | 'claude' | 'zai';
  model: string;
  mediaType: 'image' | 'video' | 'text';
  aspectRatio: string;
  duration?: string;
  renderResolution?: string;
  resolution?: string;
  imageCount?: string;
  quality?: string;
  extend?: boolean;
  extendSeconds?: string;
  extendFromVideo?: string;
  creationType: 'ingredients' | 'frames';
  styleReference?: string;
  styleReferenceRequired?: boolean;
  voice?: string;
  referenceImageIds?: string[];
  referenceImageData?: string[];
  frameReferences?: FrameReference[];
  newChat?: 'auto' | 'never';
  rawReply?: boolean;
  deleteWhenDone?: boolean;
  resumeConversation?: string;
}

export interface NodeResult {
  tileId: string;
  mediaId?: string;
  imageUrl?: string;
  videoUrl?: string;
  thumbnailUrl?: string;
  previewUrl?: string;
  previewVideoUrl?: string;
  referenceUrl?: string;
  text?: string;
  conversationPath?: string;
  /** The prompt a Flow clip was sent with: what the picker lists it under. */
  sentPrompt?: string;
}

export interface CoordinatorHost {
  /** Send a node execution command to the appropriate platform tab.
   *  Returns false if the command could not be dispatched. */
  executeOnPlatform(nodeId: string, config: NodeExecutionConfig): Promise<boolean>;
  
  /** Send pause/stop/resume to the active platform tab */
  sendControl(command: 'pause' | 'resume' | 'stop'): void;
  
  /** Broadcast a message to all connected Canvas/Panel ports */
  broadcast(message: SwToCanvasMessage): void;
  
  /** Show a Chrome notification (when Canvas is not connected) */
  notify(title: string, message: string): void;
}

const MAX_AUTO_RETRIES = 1;
const AUTO_RETRY_DELAY_MS = 2500;
const TEXT_BACKSTOP_MS = 16 * 60 * 1000;
const CHAT_PLATFORMS = ['chatgpt', 'gemini', 'grok', 'claude', 'zai'];

/**
 * Whether a failure is worth another attempt on its own.
 *
 * Deliberately narrow. Two kinds of error must never be auto-retried:
 * - A timeout. The generation may still be running on Flow, so resubmitting
 *   spends a second one and leaves the user with two clips they pay for.
 * - Anything caused by the workflow itself (empty prompt, nothing connected).
 *   Those fail identically forever, and each attempt costs a prompt.
 */
export function isTransientFailure(message: string): boolean {
  const m = message || '';
  if (/no result after/i.test(m)) return false;
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
 * For a quota that is gone or an account that is not signed in, every later
 * node would fail identically, each after its own multi-minute wait.
 */
export function isRunFatal(message: string): boolean {
  const m = message || '';
  return [
    /out of credits/i,
    /not enough .*credits/i,
    /sign(ed)? in|not signed in|logged out/i,
    /rate limit reached|out of free messages|usage limit/i,
  ].some((p) => p.test(m));
}

/**
 * What a Prompt or Image node contributes to the nodes below it.
 *
 * Two corrections live here, and both were silent.
 *
 * `imageData` is where an Image node keeps its upload. This read `imageUrl`,
 * a field an Image node has never set, so it resolved to '' every time and
 * the reference the user attached was dropped from every delegated run — no
 * error, just a generation made without it. The canvas runner has always read
 * imageData. `imageUrl` stays as a fallback for older saved workflows.
 *
 * `tileId` is EMPTY, deliberately. It names a tile in Flow's own grid, and
 * these nodes have none; the canvas node id that used to sit here travelled
 * to the Flow adapter as a tile to look up and came back as "Reference tile
 * frame3 not found on the Flow page". buildConfig now refuses to put anything
 * but a real tile id in that lane, and this is the other half of that rule.
 */
export function staticNodeResult(node: SerializedNode): NodeResult {
  const d = node.data || {};
  if (node.type === 'prompt') {
    // For legacy reasons, text data might be stored in imageUrl for prompt nodes
    return { tileId: '', imageUrl: String(d.text || '') };
  }
  return { tileId: '', imageUrl: String(d.imageData || d.imageUrl || '') };
}

/**
 * Which still a Last Frame node carries forward.
 *
 * ── Never overwrite a good frame with nothing ──
 *
 * A frame node is a data node, so it runs on EVERY pass — `only` gates
 * runnable nodes and nothing else. On a targeted retry the clip above it is
 * skipped, so there is no fresh capture, and writing that nothing back left
 * the clip BELOW with no start frame. Reported as: retry one shot, and every
 * shot after it turns red, so the only way forward is to re-run the episode
 * and pay for all of it again.
 *
 * The frame the canvas is holding was captured when that clip actually
 * finished. It is still correct, and a pass that produced nothing new has
 * learned nothing about it.
 *
 * `fresh` separates the two cases for the caller: only a new capture is worth
 * sending back to the canvas, and only a new capture may replace what is
 * already stored there.
 *
 * A capture is taken from `referenceUrl` alone, and must be inline bytes. An
 * adopted upstream result carries `imageUrl` — an address on Flow, or a
 * preview thumbnail — and neither is the last frame of anything.
 *
 * Extracted from the run loop so the rule can be tested as a rule. It is
 * three lines and it decides whether a retry costs one generation or
 * twenty-two.
 */
export function frameStillFor(
  held: string, upstream: Array<{ referenceUrl?: string } | undefined>,
): { frameUrl: string; fresh: boolean } {
  const captured = upstream
    .map((r) => r?.referenceUrl || '')
    .find((u) => u.startsWith('data:')) || '';
  if (captured && captured !== held) return { frameUrl: captured, fresh: true };
  return { frameUrl: captured || held, fresh: false };
}

function isRunnableType(type: unknown): boolean {
  const t = String(type || '');
  return ['generate', 'story', 'chief', 'agent', 'clip', 'cut', 'motion', 'extend'].includes(t);
}

interface ExecutionStep {
  nodeId: string;
  nodeType: string;
  dependencies: string[];
}

/**
 * Perform Kahn's algorithm for topological sorting of DAG nodes.
 * We rely on this instead of @xyflow/react because the service worker
 * has no React or DOM context.
 */
function topologicalSort(nodes: SerializedNode[], edges: SerializedEdge[]): ExecutionStep[] {
  const adj = new Map<string, string[]>();
  const inDegree = new Map<string, number>();
  const nodeMap = new Map<string, SerializedNode>();
  
  nodes.forEach(n => {
    adj.set(n.id, []);
    inDegree.set(n.id, 0);
    nodeMap.set(n.id, n);
  });
  
  edges.forEach(e => {
    if (adj.has(e.source) && inDegree.has(e.target)) {
      adj.get(e.source)!.push(e.target);
      inDegree.set(e.target, inDegree.get(e.target)! + 1);
    }
  });
  
  const queue: string[] = [];
  inDegree.forEach((degree, id) => {
    if (degree === 0) queue.push(id);
  });
  
  const result: ExecutionStep[] = [];
  while (queue.length > 0) {
    const current = queue.shift()!;
    const node = nodeMap.get(current)!;
    
    // Edges targeting this node represent its dependencies
    const deps = edges.filter(e => e.target === current).map(e => e.source);
    
    result.push({
      nodeId: current,
      nodeType: node.type,
      dependencies: deps
    });
    
    adj.get(current)?.forEach(neighbor => {
      const degree = inDegree.get(neighbor)! - 1;
      inDegree.set(neighbor, degree);
      if (degree === 0) queue.push(neighbor);
    });
  }
  
  return result;
}

export class RunCoordinator {
  private host: CoordinatorHost | null = null;
  private state: RunState = 'idle';
  private abortRequested = false;
  private pauseRequested = false;
  private runId = '';
  private workflowId = '';
  private nodeResults = new Map<string, NodeResult>();
  private failedNodes = new Set<string>();
  private nodeStatuses = new Map<string, NodeExecutionStatus>();
  private progress = { current: 0, total: 0 };
  private currentNodeId: string | null = null;
  private startedAt = 0;
  
  // Pending promise resolvers for in-flight node executions
  private pendingResolve: ((result: NodeResult) => void) | null = null;
  private pendingReject: ((error: Error) => void) | null = null;
  private pendingNodeId: string | null = null;
  private pendingTimeout: ReturnType<typeof setTimeout> | null = null;

  bind(host: CoordinatorHost): void { 
    this.host = host; 
  }
  
  getState(): RunState { 
    return this.state; 
  }
  
  getSnapshot(): ExecutionSnapshot {
    return this.buildSnapshot();
  }
  
  isRunning(): boolean { 
    return this.state === 'running' || this.state === 'paused'; 
  }

  async start(manifest: RunManifest, options: RunOptions = {}): Promise<void> {
    if (this.isRunning()) {
      throw new Error('A run is already in progress');
    }
    
    this.state = 'running';
    this.runId = manifest.runId || crypto.randomUUID();
    this.workflowId = manifest.workflowId;
    this.abortRequested = false;
    this.pauseRequested = false;
    this.startedAt = Date.now();
    this.nodeResults.clear();
    this.failedNodes.clear();
    this.nodeStatuses.clear();
    
    await beginRun(this.runId);
    
    const steps = topologicalSort(manifest.nodes, manifest.edges);
    /* A node switched off (the toggle beside its title) is not run, exactly
       as on the canvas — this ran it anyway, and charged for it. */
    const switchedOff = (id: string) => manifest.nodes.find(n => n.id === id)?.data?.enabled === false;
    const runnableSteps = steps.filter(s => isRunnableType(s.nodeType) && !switchedOff(s.nodeId));
    
    // Respect the options.only filter if provided
    const targetSteps = options.only 
      ? runnableSteps.filter(s => options.only!.includes(s.nodeId))
      : runnableSteps;
      
    this.progress = { current: 0, total: targetSteps.length };
    this.broadcastState();

    /* Before running anything, take account of what the canvas already
       finished. Without this a targeted retry treats a completed episode as
       missing — see adoptCanvasResults. */
    if (options.only) {
      const adopted = this.adoptCanvasResults(manifest.nodes, options.only);
      if (adopted) {
        console.log(`[Coordinator] Retry: ${adopted} finished node(s) read off the manifest `
          + '— they will not be generated again.');
      }
    }

    try {
      for (const step of steps) {
        if (this.abortRequested) {
          throw new Error('Run aborted by user');
        }

        // Wait here if paused
        while (this.pauseRequested && !this.abortRequested) {
          await this.sleep(500);
        }
        if (this.abortRequested) throw new Error('Run aborted by user');

        const node = manifest.nodes.find(n => n.id === step.nodeId)!;

        /* ── Static data nodes ──
         *
         * tileId is EMPTY on all three, deliberately. It names a tile in
         * Flow's grid and these nodes have none; the canvas node id that used
         * to sit here travelled to the Flow adapter as a tile to look up and
         * came back as "Reference tile frame3 not found on the Flow page".
         * buildConfig now refuses to put anything but a real tile id in that
         * lane, and this is the other half of the same rule. */
        if (node.type === 'prompt' || node.type === 'image') {
          this.nodeResults.set(step.nodeId, staticNodeResult(node));
          continue;
        } else if (node.type === 'frame') {
          /* The rule lives in frameStillFor, where it can be tested. */
          const { frameUrl, fresh } = frameStillFor(
            String(node.data?.frameUrl || ''),
            step.dependencies.map(d => this.nodeResults.get(d)),
          );
          if (frameUrl) {
            this.nodeResults.set(step.nodeId, { tileId: '', referenceUrl: frameUrl });
          }
          /* A fresh capture goes back to the canvas, which is the only place
             it survives this run. Nothing did, so every delegated run left
             its frame nodes empty and the NEXT retry had nothing to adopt. */
          if (fresh) {
            this.updateNodeStatus(step.nodeId, { status: 'done', frameUrl });
          }
          continue;
        }

        if (!isRunnableType(step.nodeType)) {
          continue; // Skip unrecognized types
        }
        
        if (options.only && !options.only.includes(step.nodeId)) {
          continue; // Skip nodes not in the targeted set
        }

        if (switchedOff(step.nodeId)) {
          console.log(`[Coordinator] ${String(node.data?.label || step.nodeId)}: skipped (switched off)`);
          continue;
        }

        // Check if dependencies failed
        if (step.dependencies.some(d => this.failedNodes.has(d))) {
          this.failedNodes.add(step.nodeId);
          this.updateNodeStatus(step.nodeId, { status: 'error', errorMessage: 'Upstream dependency failed' });
          /* Its prompt event stays "pending" on purpose, exactly as the canvas
             runner leaves it: the server charged it at run start but it was
             never sent to Flow, and that is what the dashboard's pending
             bucket means. The total counts done|failed only, so settling this
             as failed would count a node that never ran as submitted. */
          continue;
        }

        this.currentNodeId = step.nodeId;
        this.progress.current++;
        this.broadcastState();

        let attempt = 0;
        let success = false;
        
        while (attempt <= MAX_AUTO_RETRIES && !success && !this.abortRequested) {
          attempt++;
          const attemptId = `${step.nodeId}-${attempt}`;
          try {
            const config = this.buildConfig(node, manifest.edges, manifest.nodes);
            await beginAttempt(this.runId, step.nodeId, attemptId);
            
            this.updateNodeStatus(step.nodeId, { status: 'running', progress: 0 });
            
            /* A backstop that should now be unreachable.
             *
             * The runner checks the graph before delegating and keeps a run
             * containing one of these local, so the coordinator never receives
             * one — see needsCanvas. Reaching this means a run got here by a
             * path that skipped that check, and the message says what to do
             * about it rather than naming a version: the old wording, "motion
             * node type requires Canvas presence in v1.5.0", told the user
             * the version they were already on and nothing they could act on.
             *
             * TODO: hand the node back to the Canvas instead of failing it,
             * so a mixed workflow keeps running in the background up to the
             * node that needs the tab. Agent's multi-turn repair loop is the
             * other half of that work — v1.6.0. */
            if (needsCanvasNode(node)) {
               throw new Error(
                 `${step.nodeType === 'generate' ? 'An Ask AI' : `A ${step.nodeType}`} node needs the Studio tab open to run. `
                 + 'Open Studio and press Run again.'
               );
            }
            
            /* Listening BEFORE the hand-off, not after. The hand-off now waits
               for the tab and the adapter's reply, and an adapter that fails
               fast — a reference it cannot fetch — reports that failure before
               replying. Registered afterwards, the report found nobody waiting,
               was dropped, and the node hung for the full backstop. */
            const pending = this.waitForNodeResult(step.nodeId, TEXT_BACKSTOP_MS);
            pending.catch(() => { /* awaited below, or abandoned with the hand-off */ });
            try {
              const dispatched = await this.host!.executeOnPlatform(step.nodeId, config);
              if (!dispatched) {
                throw new Error('Failed to dispatch execution to platform tab');
              }
            } catch (handOff) {
              this.abandonPending(step.nodeId);
              throw handOff;
            }

            // Wait for node result via message handlers
            const result = await pending;
            
            /* Record the media id in the journal so a crash after this point
               knows not to re-submit. */
            if (result.mediaId) {
              await recordSubmitted(this.runId, step.nodeId, result.mediaId);
            }
            
            /* A Flow clip keeps the prompt it went out with, so a clip wired
               to its V can be searched for in the library under it. */
            const sentPrompt = config.platform === 'flow' && config.mediaType === 'video' ? config.prompt : undefined;
            this.nodeResults.set(step.nodeId, sentPrompt ? { ...result, sentPrompt } : result);
            this.updateNodeStatus(step.nodeId, {
              status: 'done', progress: 100,
              resultUrl: result.videoUrl || result.imageUrl || result.thumbnailUrl || '',
              previewUrl: result.previewUrl || '', previewVideoUrl: result.previewVideoUrl || '',
              resultTileId: result.tileId, resultText: result.text || '', errorMessage: null,
              lastFrameUrl: config.mediaType === 'video' ? inlineFrame(result.referenceUrl) || '' : '',
              ...(sentPrompt ? { sentPrompt } : {}),
            });
            success = true;
            
            await settleAttempt(this.runId, step.nodeId, 'done');
            trackUsage(1, 'text', 'done').catch(() => { /* non-blocking */ });

            /* ── And report it as a Flow submission, when it was one ──
             *
             * This was missing, and it is why "SENT TO FLOW" read 0 again.
             * The canvas runner has reported submissions for a long time; when
             * the loop moved into the worker for v1.5.0 the trackUsage call
             * came with it and this one did not — so every run that got
             * delegated, which since v1.5.0 is every ordinary run, counted its
             * prompts and reported none of its generations.
             *
             * The media id settles what belongs here: a Flow generation has
             * one, a chat round-trip never does, so a Gemini ask cannot land
             * in a number that is meant to count billable generations.
             *
             * Deliberately identical in shape to the canvas runner's call —
             * one definition of "sent to Flow" across both paths, so the
             * dashboard cannot tell which one produced a row. */
            const mediaId = String(result.mediaId || '');
            if (mediaId) {
              void trackSubmission({
                mediaId,
                queueId: `studio:${manifest.workflowId}`,
                promptIndex: steps.indexOf(step),
                promptType: (node.data?.mediaType === 'video' || node.data?.mediaType === 'image')
                  ? 'full' : 'text',
                mode: 'studio',
                outcome: 'done',
              }).catch(() => { /* metering must never fail a generation */ });
            }


          } catch (err: any) {
            const msg = err.message || 'Unknown error';
            await settleAttempt(this.runId, step.nodeId, 'failed');
            
            if (this.abortRequested) break;
            
            if (attempt <= MAX_AUTO_RETRIES && isTransientFailure(msg)) {
              this.updateNodeStatus(step.nodeId, { status: 'running', errorMessage: `Retrying… (${msg})` });
              await this.sleep(AUTO_RETRY_DELAY_MS);
            } else {
              this.failedNodes.add(step.nodeId);
              this.updateNodeStatus(step.nodeId, { status: 'error', errorMessage: msg });

              /* Settle the event this node was pre-charged for.
                 Without it a failed node leaves its event "pending" for ever:
                 the run start created one per node that would run, and only
                 the successes were ever settling them. The dashboard counts
                 pending events, so a run with failures stayed permanently
                 inflated and never reconciled. */
              trackUsage(1, 'text', 'failed').catch(() => { /* non-blocking */ });

              if (isRunFatal(msg)) {
                this.abortRequested = true;
                this.host?.notify('Run Aborted', `Fatal error: ${msg}`);
              }
              break;
            }
          }
        }
      }
      
      this.state = this.abortRequested ? 'stopped' : 'done';
    } catch (err: any) {
      this.state = 'error';
      this.host?.notify('Run Failed', err.message);
    } finally {
      this.currentNodeId = null;
      await finishRun(this.runId);
      if (this.abortRequested) {
        await cancelRun(this.runId);
      }
      this.broadcastState();
      
      // Clean up snapshot if completed normally
      if (this.state === 'done') {
        await clearSnapshot();
      } else {
        await saveSnapshot(this.buildSnapshot());
      }
    }
  }

  handleNodeResult(payload: any): void {
    if (!this.pendingNodeId || payload.nodeId !== this.pendingNodeId) return;
    if (this.pendingTimeout) clearTimeout(this.pendingTimeout);
    
    if (payload.error) {
      this.pendingReject?.(new Error(payload.error));
    } else {
      this.pendingResolve?.({
        /* Never the canvas node id: the tile lane names a tile in Flow's grid,
           and a node id there comes back from the next clip as "Reference
           tile generate_… not found on the Flow page". The canvas runner has
           always used ''. */
        tileId: payload.tileId || '',
        mediaId: payload.mediaId || '',
        imageUrl: payload.imageUrl,
        videoUrl: payload.videoUrl,
        thumbnailUrl: payload.thumbnailUrl,
        previewUrl: payload.previewUrl,
        previewVideoUrl: payload.previewVideoUrl,
        referenceUrl: payload.referenceUrl,
        text: payload.text,
        conversationPath: payload.conversationPath
      });
    }
    
    this.pendingResolve = null;
    this.pendingReject = null;
    this.pendingNodeId = null;
  }
  
  handleNodeProgress(payload: any): void {
    if (payload.nodeId && this.nodeStatuses.has(payload.nodeId)) {
      this.updateNodeStatus(payload.nodeId, { progress: payload.progress || 0 });
    }
  }
  
  handleNodeError(payload: any): void {
    this.handleNodeResult(payload); // error is passed within payload
  }
  
  pause(): void {
    if (this.state !== 'running') return;
    this.pauseRequested = true;
    this.state = 'paused';
    this.host?.sendControl('pause');
    this.broadcastState();
  }
  
  resume(): void {
    if (this.state !== 'paused') return;
    this.pauseRequested = false;
    this.state = 'running';
    this.host?.sendControl('resume');
    this.broadcastState();
  }
  
  stop(): void {
    if (!this.isRunning()) return;
    this.abortRequested = true;
    /* Set here, not left to the run loop.
       The loop's `finally` is the only other place `state` becomes terminal,
       and after the worker has been recycled there IS no loop — so a
       coordinator left reading 'running' could not be stopped by the one
       control that exists for stopping it, and every later run was refused
       with "A run is already in progress". A loop that is still alive sets
       the same value again on its way out. */
    this.state = 'stopped';
    this.host?.sendControl('stop');
    
    // Fast-fail the pending promise to unblock the run loop immediately
    if (this.pendingReject) {
      this.pendingReject(new Error('Aborted by user'));
      if (this.pendingTimeout) clearTimeout(this.pendingTimeout);
      this.pendingResolve = null;
      this.pendingReject = null;
      this.pendingNodeId = null;
    }
  }
  
  async recover(): Promise<void> {
    const snap = await loadSnapshot();
    if (!snap || snap.state === 'done') return;
    
    const cancelled = await isRunCancelled(snap.runId);
    if (cancelled) {
      await clearSnapshot();
      return;
    }
    
    // We found an interrupted run. For v1.5.0 we do NOT auto-resume.
    // Instead we restore state so Canvas shows what failed/succeeded.
    // TODO: Implement auto-resume mechanism in v1.6.0 via RunJournal recoverable checks.
    /* Everything below is for DISPLAY — which is what nodeStatuses and
       progress are. `state` is not: isRunning() reads it and start() guards
       on it, so restoring 'running' here told every future run that one was
       already under way while no loop existed to finish, fail or be stopped.
       Chrome recycles this worker after ~30s idle, so that was the ordinary
       outcome of any run, and the symptom was a press of Run that raised the
       Flow tab and then did nothing at all.
       An interrupted run is over. It is reported as what it is. */
    this.state = (snap.state === 'running' || snap.state === 'paused')
      ? 'stopped'
      : snap.state;
    this.runId = snap.runId;
    this.workflowId = snap.workflowId;
    this.nodeStatuses = new Map(Object.entries(snap.nodeStatuses));
    this.progress = { ...snap.progress };
    
    this.broadcastState();
  }
  
  /**
   * Results this run never produced, but the canvas is holding anyway.
   *
   * ── Why a retry used to be worth so little ──
   *
   * start() clears nodeResults, and the manifest arrives with no results in
   * it — only node data. So a targeted retry of shot 4 began with an empty
   * memory: the Director, the anchor, the board, shots 1 to 3 and their
   * frames were all simply absent. Skipped nodes contributed nothing, so the
   * clip being retried was handed no identity reference and no last frame,
   * and it regenerated with neither — a clip that silently restarts the story
   * halfway through, which costs a generation to discover.
   *
   * The canvas knows better, and it is all in the manifest already. A
   * generate node that finished carries its result url, its preview and its
   * tile id; a frame node carries the still it captured. Reading those back
   * is free, and it is the difference between resuming and starting over.
   *
   * Scoped to a targeted retry on purpose. A full run is a request to make
   * everything again, and adopting there would skip work the user asked for.
   *
   * Deliberately NOT reconstructing `referenceUrl` from a preview thumbnail.
   * Only the captured lastFrameUrl can restore a direct clip chain.
   */
  private adoptCanvasResults(nodes: SerializedNode[], only: string[]): number {
    let found = 0;
    for (const node of nodes) {
      /* Anything being retried must run again, whatever the canvas holds. */
      if (only.includes(node.id) || this.nodeResults.has(node.id)) continue;
      const d = node.data || {};

      if (node.type === 'frame') {
        const url = String(d.frameUrl || '');
        if (!url) continue;
        this.nodeResults.set(node.id, { tileId: '', referenceUrl: url });
        found++;
        continue;
      }

      if (!isRunnableType(node.type) || d.status !== 'done') continue;
      const media = String(d.resultUrl || d.previewUrl || '');
      const text = String(d.resultText || '');
      if (!media && !text) continue;
      this.nodeResults.set(node.id, {
        tileId: String(d.resultTileId || ''),
        imageUrl: d.mediaType === 'text' ? text : media,
        previewUrl: String(d.previewUrl || ''),
        previewVideoUrl: String(d.previewVideoUrl || ''),
        referenceUrl: inlineFrame(d.lastFrameUrl),
        text,
        sentPrompt: d.sentPrompt ? String(d.sentPrompt) : undefined,
      });
      found++;
    }
    return found;
  }

  private buildConfig(node: SerializedNode, edges: SerializedEdge[], nodes: SerializedNode[]): NodeExecutionConfig {
    const data = node.data || {};
    const p = String(data.platform || '');
    const platform = CHAT_PLATFORMS.includes(p) ? p : 'flow';
    const isExtend = node.type === 'extend' || data.type === 'extend';

    /* ── The prompt: the canvas runner's rule ──
     *
     * The first wire into T, and nothing else. This used to be the node's own
     * `prompt` field plus EVERY text wire, joined — so a placeholder the MCP
     * builder writes onto clip nodes ("Shot 1 cinematic visual sequence.")
     * went out ahead of the real prompt, and a shot retried from a Director's
     * set got the whole set, labels and all. A writer that covered several
     * clips gives each its own (shared/shotPrompt.ts). */
    const textEdge = edges.find(e => e.target === node.id && e.targetHandle === 'text');
    let promptText = '';
    if (textEdge) {
      const shot = shotPromptFor(nodes.find(n => n.id === textEdge.source), node.id, nodes, edges);
      const r = this.nodeResults.get(textEdge.source);
      promptText = shot ?? (r?.text || r?.imageUrl || '');
    }

    /* ── Upstream references, in the lane each one belongs to ──
     *
     * Two lanes reach the Flow adapter and they are not interchangeable:
     *
     *   referenceImageData  base64 `data:` URLs. Decoded and uploaded.
     *   referenceImageIds   ids naming a tile in Flow's own grid. Looked up
     *                       in the DOM, and the image taken off that tile.
     *
     * Everything went into the id lane. A captured frame is a data URL, so
     * the adapter tried to find a tile whose id was 40,000 characters of
     * base64, failed, and reported the whole thing back:
     *
     *   Reference tile data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQ… not
     *   found on the Flow page — cannot pass its image to this node
     *
     * which is what a retry produced every time. It was invisible on ordinary
     * runs only because a workflow holding a Director or a Chief never
     * delegates at all — needsCanvas keeps it local, and the canvas runner has
     * always sorted these correctly. A TARGETED retry of one clip has no such
     * node in its `only` set, so it goes to the worker, and this is the first
     * code to touch it.
     *
     * Order comes from the named ports for Frames mode, never from edge
     * order: first frame and last frame are not interchangeable, and edge
     * order is invisible on the canvas and changes when a connection is
     * remade. Same rule as the canvas runner. */
    const refImageIds: string[] = [];
    const refImageData: string[] = [];
    const framesMode = (data.platform || 'flow') === 'flow'
      && data.mediaType === 'video' && data.creationType === 'frames';
    const frameReferences = framesMode
      ? frameReferencesFor(node.id, edges, id => this.nodeResults.get(id)) : undefined;
    const handlesInOrder = framesMode
      ? ['frame_start', 'frame_end']
      : ['image_ref', 'frame_start', 'frame_end'];
    const imageEdges = handlesInOrder.flatMap(
      (h) => edges.filter(e => e.target === node.id && (e.targetHandle || '') === h));
    for (const e of imageEdges) {
      const r = this.nodeResults.get(e.source);
      if (!r) continue;
      const inline = [r.referenceUrl, r.imageUrl]
        .find((u): u is string => typeof u === 'string' && u.startsWith('data:'));
      if (inline) {
        refImageData.push(inline);
        continue;
      }
      /* Only a real Flow tile id goes in the id lane. tileId is empty on every
         data node for exactly this reason — a canvas node id put here comes
         back as "Reference tile frame3 not found on the Flow page". */
      if (r.tileId) refImageIds.push(r.tileId);
    }

    /* A clip on V: the whole clip on Omni, its last frame on anything else.
       The canvas runner's rule, from the same module, so the two paths cannot
       decide differently. Thrown before dispatch, so nothing is spent. */
    let videoReference: string | undefined;
    const videoRefMode = (data.platform || 'flow') === 'flow' && data.mediaType === 'video' && !framesMode;
    const videoEdge = videoRefMode
      ? edges.find(e => e.target === node.id && e.targetHandle === 'video_ref') : undefined;
    if (videoEdge) {
      const up = this.nodeResults.get(videoEdge.source);
      const ref = videoReferenceFor(up, data.model || 'Omni 1.1 Flash');
      if (ref.kind === 'none') throw new Error(ref.error);
      if (ref.kind === 'clip' && data.styleReference) {
        throw new Error(
          `This node already puts "${String(data.styleReference)}" on the prompt from the Flow library, `
          + 'and Flow takes one video per prompt — remove the V wire or that library video'
        );
      }
      if (ref.kind === 'clip') videoReference = ref.styleReference;
      else refImageData.unshift(ref.frame);
    }

    /* ── Refuse what the canvas refuses, before anything is spent ──
     * The same checks, in the same order, with the same words, as
     * WorkflowRunner.executeGenerateNode. */
    if (!refImageIds.length && !refImageData.length) {
      /* A clip or a frame upstream that gave up nothing is a link that
         already broke. Generating anyway restarts the story with no
         continuity, and only watching the clip shows it. An empty Image node
         is the user's choice and is let through. */
      const broken = imageEdges
        .map(e => nodes.find(n => n.id === e.source))
        .filter((n): n is SerializedNode => !!n && (n.type === 'frame' || n.type === 'generate'));
      if (broken.length) {
        const names = broken.map(n => String(n.data?.label || n.id));
        throw new Error(`Nothing to continue from — ${names.join(', ')} produced no usable frame`);
      }
      if (framesMode) {
        throw new Error(
          'Frames mode has no images — wire one into S (start) and one into E (end), ' +
          'or switch FROM back to Ingredients'
        );
      }
    }
    if (!promptText.trim()) {
      // Flow takes an empty prompt and charges for it.
      throw new Error(
        textEdge
          ? 'Connected prompt node is empty — type a prompt before running'
          : refImageIds.length || refImageData.length
            ? 'No preset or prompt provided for the connected reference image'
            : 'No prompt connected — link a Prompt node to the T input'
      );
    }

    /* ── A Grok Extend ──
     * Its settings carry no platform, no media type and no clip: all three
     * come from the chain it sits in. Read off its node data, an Extend went
     * to Flow as an IMAGE built from its prompt. The canvas runner's checks,
     * from the same functions. */
    let extendFromVideo: string | undefined;
    if (isExtend) {
      const chain = extendChain(node.id, nodes, edges);
      if (chain.problem) throw new Error(chain.problem);
      const total = chain.secondsBefore + secondsOf(data.extendSeconds || '+10s');
      if (total > GROK_MAX_TOTAL_SECONDS) {
        throw new Error(
          `${data.extendSeconds || '+10s'} would make this clip ${total}s, past Grok's `
          + `${GROK_MAX_TOTAL_SECONDS}s limit — choose a smaller step or shorten the clip it continues`
        );
      }
      const src = edges.find(e => e.target === node.id && e.targetHandle === 'video');
      const up = src ? this.nodeResults.get(src.source) : undefined;
      // videoUrl first: a data: preview cannot be found again on Grok.
      extendFromVideo = up?.videoUrl || up?.imageUrl || up?.previewVideoUrl || '';
      if (!extendFromVideo || !/generated_video|assets\.grok\.com|\.mp4($|\?)/.test(extendFromVideo)) {
        throw new Error('Extend has no clip to continue — the node before it produced no Grok video');
      }
    }

    const mediaType = (isExtend ? 'video' : (data.mediaType || 'image')) as 'image' | 'video' | 'text';
    return {
      prompt: promptText,
      platform: (isExtend ? 'grok' : platform) as NodeExecutionConfig['platform'],
      /* The canvas runner's defaults, which are what the node shows. These
         were 'default' and '1:1': a clip with no ratio chosen showed 9:16 and
         came out widescreen, on a model named "default". */
      model: String(data.model || (mediaType === 'video' ? 'Omni 1.1 Flash' : 'Nano Banana Pro')),
      mediaType,
      aspectRatio: String(data.aspectRatio || '9:16'),
      duration: String(data.duration || '6s'),
      renderResolution: String(data.renderResolution || '720p'),
      resolution: !isExtend && data.resolution ? String(data.resolution) : undefined,
      imageCount: data.imageCount ? String(data.imageCount) : undefined,
      quality: data.quality ? String(data.quality) : undefined,
      extend: isExtend ? true : undefined,
      extendSeconds: isExtend ? String(data.extendSeconds || '+10s') : undefined,
      extendFromVideo,
      creationType: (data.creationType || 'ingredients') as 'ingredients' | 'frames',
      styleReference: videoReference ?? (data.styleReference ? String(data.styleReference) : undefined),
      /* motionFrom counts, as on the canvas: Motion Control's older pieces
         carry only that, and a retried piece is still a motion piece. */
      styleReferenceRequired: Boolean(data.styleReferenceRequired)
        || typeof data.motionFrom === 'string' || videoReference !== undefined,
      voice: data.voice ? String(data.voice) : undefined,
      referenceImageIds: refImageIds.length > 0 ? refImageIds : undefined,
      referenceImageData: refImageData.length > 0 ? refImageData : undefined,
      frameReferences,
      newChat: data.newChat as 'auto' | 'never' | undefined,
      rawReply: Boolean(data.rawReply),
      deleteWhenDone: Boolean(data.deleteWhenDone),
      resumeConversation: data.resumeConversation ? String(data.resumeConversation) : undefined
    };
  }

  /** Stop waiting for a node whose hand-off failed, so nothing reports into it. */
  private abandonPending(nodeId: string): void {
    if (this.pendingNodeId !== nodeId) return;
    if (this.pendingTimeout) clearTimeout(this.pendingTimeout);
    this.pendingTimeout = null;
    this.pendingNodeId = null;
    this.pendingResolve = null;
    this.pendingReject = null;
  }

  private waitForNodeResult(nodeId: string, timeoutMs: number): Promise<NodeResult> {
    return new Promise((resolve, reject) => {
      this.pendingNodeId = nodeId;
      this.pendingResolve = resolve;
      this.pendingReject = reject;
      
      this.pendingTimeout = setTimeout(() => {
        if (this.pendingNodeId === nodeId) {
          this.pendingNodeId = null;
          this.pendingResolve = null;
          this.pendingReject = null;
          reject(new Error(`Execution timed out after ${timeoutMs}ms`));
        }
      }, timeoutMs);
    });
  }
  
  private buildSnapshot(): ExecutionSnapshot {
    const statusesObj: Record<string, NodeExecutionStatus> = {};
    this.nodeStatuses.forEach((val, key) => statusesObj[key] = val);

    return {
      runId: this.runId,
      workflowId: this.workflowId,
      state: this.state as RunState,
      currentNodeId: this.currentNodeId,
      progress: { ...this.progress },
      nodeStatuses: statusesObj,
      startedAt: this.startedAt,
      updatedAt: Date.now(),
    };
  }

  private broadcastState(): void {
    if (!this.host) return;
    const snapshot = this.buildSnapshot();
    
    this.host.broadcast({ type: 'SW_RUN_STATE', payload: snapshot });
    saveSnapshot(snapshot);
    
    /* Emit a distinct completion message so the Canvas can persist the
       workflow without polling. The snapshot already carries the state,
       but a dedicated message simplifies the listener — no need to diff. */
    if (this.state === 'done' || this.state === 'stopped' || this.state === 'error') {
      const succeeded = Array.from(this.nodeStatuses.values())
        .filter(s => s.status === 'done').length;
      const failed = Array.from(this.nodeStatuses.values())
        .filter(s => s.status === 'error').length;
      
      this.host.broadcast({
        type: 'SW_RUN_COMPLETE',
        payload: {
          runId: this.runId,
          succeeded,
          failed,
          total: this.progress.total,
        },
      });

      /* If no Canvas is connected, nudge the user. A 15-minute video
         finishing in a background tab with no visible sign is the whole
         reason this coordinator exists. */
      this.host.notify(
        'AutoFlow Studio',
        `Workflow finished — ${succeeded} of ${this.progress.total} nodes completed`,
      );
    }
  }

  private updateNodeStatus(nodeId: string, patch: Partial<NodeExecutionStatus>): void {
    const current = this.nodeStatuses.get(nodeId) || { nodeId, status: 'idle' as const };
    this.nodeStatuses.set(nodeId, { ...current, nodeId, ...patch });
    
    /* Broadcast the individual node update so the Canvas can apply it
       without parsing the full snapshot. */
    if (this.host) {
      this.host.broadcast({
        type: 'SW_NODE_STATUS',
        payload: { ...current, nodeId, ...patch },
      });
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
