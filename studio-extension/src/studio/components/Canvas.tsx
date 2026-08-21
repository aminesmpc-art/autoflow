/* ============================================================
   Canvas — React Flow wrapper for the workflow editor
   ============================================================ */

import { useCallback, useRef, useEffect, useState } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  MiniMap,
  addEdge,
  useReactFlow,
  useStore,
  type Connection,
  type OnConnect,
  BackgroundVariant,
  Panel,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { Icon } from './Icon';
import { getUpgradeTarget } from '../../shared/api';
import { StoryNode } from '../nodes/StoryNode';
import { canConnect, connectionProblem } from '../canvas/connect';
import { BrandIcon } from './BrandIcon';
import { useStudioStore, FREE_LIMITS } from '../store';
import { consumeStudioRun } from '../../shared/api';
import { PromptNode } from '../nodes/PromptNode';
import { ImageNode } from '../nodes/ImageNode';
import { GenerateNode } from '../nodes/GenerateNode';
import { FrameNode } from '../nodes/FrameNode';
import { ExtendNode } from '../nodes/ExtendNode';
import { AgentNode } from '../nodes/AgentNode';
import { NodeBoundary } from './NodeBoundary';
import { DeletableEdge } from '../canvas/DeletableEdge';
import { runner } from '../engine/WorkflowRunner';
import { bridge } from '../engine/bridge';
import { isRunnableType } from '../templates/validate';

/* Register custom node types */
/* Each node type wrapped so a render error is contained to its own card.
   Without this, one node throwing unmounts the entire canvas: React tears
   down the tree and Studio goes black, with the workflow still saved and no
   longer openable. */
const guarded = (Node: any, label: string) => {
  const Guarded = (props: any) => (
    <NodeBoundary label={(props?.data as any)?.label || label}>
      <Node {...props} />
    </NodeBoundary>
  );
  Guarded.displayName = `Guarded(${label})`;
  return Guarded;
};

const nodeTypes = {
  prompt: guarded(PromptNode, 'Prompt'),
  image: guarded(ImageNode, 'Image'),
  generate: guarded(GenerateNode, 'Generate'),
  frame: guarded(FrameNode, 'Last Frame'),
  extend: guarded(ExtendNode, 'Extend'),
  agent: guarded(AgentNode, 'Agent'),
  story: guarded(StoryNode, 'Director'),
};

const edgeTypes = {
  default: DeletableEdge,
  deletable: DeletableEdge,
  bezier: DeletableEdge,
  smoothstep: DeletableEdge,
};

function CanvasInner() {
  const {
    nodes,
    edges,
    onNodesChange,
    onEdgesChange,
    setEdges,
    addNode,
    setSelectedNode,
    workflow,
    setWorkflowName,
    isRunning,
    isPaused,
    runProgress,
    saveWorkflow,
    exportWorkflow,
    isDirty,
    saveState,
    saveError,
    setView,
    isPro,
    runsUsed,
    loadEntitlements,
    recordRun,
    setRunsUsed,
    runBlockedReason,
    canAddNode,
  } = useStudioStore();

  const [limitMsg, setLimitMsg] = useState<string | null>(null);

  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const { zoomIn, zoomOut, fitView, setCenter } = useReactFlow();
  const zoomPct = Math.round(useStore((s) => s.transform[2]) * 100);
  const [showMinimap, setShowMinimap] = useState(true);

  /* Put a node in the middle of the screen.
     A run happens across a canvas wider than the screen, so "which node is
     this" and "where is the one that failed" were both answered by dragging
     around looking for a coloured border. */
  const flyTo = useCallback(
    (nodeId: string) => {
      const n = nodes.find((x) => x.id === nodeId);
      if (!n) return;
      // Offset by half the node so it lands centred rather than top-left.
      setCenter(n.position.x + 150, n.position.y + 180, { zoom: 0.9, duration: 500 });
    },
    [nodes, setCenter]
  );

  const handleRecenter = useCallback(
    () => fitView({ padding: 0.25, maxZoom: 1, duration: 300 }),
    [fitView]
  );

  /* Only runnable nodes execute — a canvas of prompts alone can't run.
     Asking the shared list rather than testing for 'generate': an agent-only
     canvas is a real workflow, and this check silently disabled Run on one. */
  const canRun = nodes.some((n) => isRunnableType((n.data as any)?.type));

  /* Connect bridge on mount */
  useEffect(() => {
    bridge.connect();
    loadEntitlements();
    return () => bridge.disconnect();
  }, [loadEntitlements]);

  /* Signing in happens in the side panel, which the canvas cannot see.
     Without this, someone who signs in with the canvas already open keeps
     looking at Free limits until they reopen it. */
  useEffect(() => {
    const onChange = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && changes.af_cached_profile) loadEntitlements();
    };
    chrome.storage.onChanged.addListener(onChange);
    return () => chrome.storage.onChanged.removeListener(onChange);
  }, [loadEntitlements]);

  /* Ctrl/Cmd+S saves, as in every other editor */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        saveWorkflow();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [saveWorkflow]);

  /* Warn before closing with unsaved work. Browsers show their own generic
     text; returnValue just has to be set. */
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!useStudioStore.getState().isDirty) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  /* Run/Stop/Pause handlers.
     The SERVER is the authority on limits — local counters live in
     chrome.storage where anyone can edit them. Client-side checks remain as
     instant feedback and as the only gate for signed-out/offline use. */
  const handleRun = useCallback(async () => {
    if (isRunning || !canRun) return;

    /* Only enabled runnable nodes reach a service — Prompt/Image nodes just
       carry data, so charging for them would over-bill the user.

       An agent counts as one here, which is an UNDER-count: its loop can spend
       up to maxIterations chat turns, each of them the same cost as an Ask AI
       node. Counting the cap instead would gate a 10-step agent as ten
       generations before it has done anything. Left at one deliberately rather
       than decided quietly — it is a pricing call, not a code call. */
    const generateCount = nodes.filter((n) => {
      const d = n.data as any;
      return isRunnableType(d?.type) && d?.enabled !== false;
    }).length;

    const gate = await consumeStudioRun(nodes.length, generateCount);
    if (gate) {
      if (!gate.allowed) {
        setLimitMsg(gate.message);
        return;
      }
      // Server consumed the run — mirror its count locally for the topbar
      if (!isPro) setRunsUsed(gate.used);
    } else {
      // Signed out or offline — client-side limits are all we have
      const blocked = runBlockedReason();
      if (blocked) {
        setLimitMsg(blocked);
        return;
      }
      recordRun();
    }

    setLimitMsg(null);
    runner.run(nodes, edges);
  }, [nodes, edges, isRunning, canRun, isPro, runBlockedReason, recordRun, setRunsUsed]);

  /* How close the ceiling is, said once.
     A fifth of the allowance, floored at five, so it behaves whether free is
     ten runs or fifty. */
  const runsLeft = Math.max(0, FREE_LIMITS.runsPerMonth - runsUsed);
  const LOW_RUNS = Math.max(5, Math.round(FREE_LIMITS.runsPerMonth * 0.2));

  /* Where Pro lives, decided by the server rather than written in here twice.
     The template gallery has always asked; the topbar and the limit notice
     had the pricing URL hardcoded, so a change to it would have fixed one
     conversion surface out of three. */
  const openUpgrade = useCallback(async () => {
    let url = 'https://auto-flow.studio/pricing';
    try { url = (await getUpgradeTarget()).url || url; } catch { /* the literal is the fallback */ }
    window.open(url, '_blank', 'noopener');
  }, []);

  /* Nodes the user can retry — anything a run left in error. */
  /* What the run bar reads. currentNodeId is set by the runner as each node
     starts, so the bar names the node rather than saying "running". */
  const currentNodeId = useStudioStore((st) => st.currentNodeId);
  const runningLabel = (() => {
    const n = nodes.find((x) => x.id === currentNodeId);
    return ((n?.data as any)?.label as string) || 'Starting…';
  })();

  /* Elapsed, ticking on its own. A run has no total to count down from, so
     time spent is the honest number — and a bar that only moves once per node
     looks frozen during a five-minute video. */
  const [runStartedAt, setRunStartedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState('0:00');
  useEffect(() => {
    if (!isRunning) { setRunStartedAt(null); setElapsed('0:00'); return; }
    const started = runStartedAt ?? Date.now();
    if (runStartedAt === null) setRunStartedAt(started);
    const tick = () => {
      const total = Math.max(0, Math.floor((Date.now() - started) / 1000));
      setElapsed(`${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [isRunning, runStartedAt]);

  const failedNodeIds = nodes
    .filter((n) => {
      const d = n.data as any;
      /* Extend nodes fail like generate nodes and must be offered in the same
         Retry failed set — left out, a failed extend had no way back except
         re-running the whole workflow and paying for the clips again. */
      return isRunnableType(d?.type) && d?.status === 'error';
    })
    .map((n) => n.id);

  /**
   * Re-run only what failed, plus whatever was skipped because of it.
   *
   * Deliberately does NOT consume another Studio run. Re-running the whole
   * workflow to recover from one failure meant re-generating clips that had
   * already succeeded — minutes each, and a prompt each. The retried
   * generations are still counted individually through trackUsage, so the work
   * is paid for; what is not charged again is the run itself.
   */
  const handleRetry = useCallback(async (ids?: string[]) => {
    if (isRunning) return;
    const requested = ids && ids.length ? ids : failedNodeIds;
    if (!requested.length) return;

    const only = runner.planRetry(requested, nodes, edges);
    if (!only.size) return;

    setLimitMsg(null);
    runner.run(nodes, edges, { only });
  }, [nodes, edges, isRunning, failedNodeIds]);

  /* Control from the side panel.
     The runner lives here, in the Studio window — the panel can only ask, and
     the worker relays. Stop and pause are exactly what someone watching a run
     from the Flow tab needs to reach without switching back. */
  useEffect(() => {
    const onControl = (payload: any) => {
      const store = useStudioStore.getState();
      if (payload?.action === 'stop') {
        runner.stop();
      } else if (payload?.action === 'pause') {
        if (store.isPaused) runner.resume();
        else runner.pause();
      }
    };
    bridge.on('STUDIO_CONTROL', onControl);
    return () => bridge.off('STUDIO_CONTROL', onControl);
  }, []);

  /* Let a node's own Retry button reach the same path as the toolbar. */
  useEffect(() => {
    const onRetryNode = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      if (id) handleRetry([id]);
    };
    window.addEventListener('studio:retry-node', onRetryNode as EventListener);
    return () => window.removeEventListener('studio:retry-node', onRetryNode as EventListener);
  }, [handleRetry]);

  const handleStop = useCallback(() => {
    runner.stop();
  }, []);

  const handlePause = useCallback(() => {
    const store = useStudioStore.getState();
    if (store.isPaused) {
      runner.resume();
    } else {
      runner.pause();
    }
  }, []);

  /* Handle new connections */
  /* Refuse a wire that cannot work, and say why.
     Without this any port connected to any port: React Flow drew the edge,
     nothing complained, and the run failed later pointing at a node that
     looked correctly connected because there was a line going into it. */
  const onConnect: OnConnect = useCallback(
    (connection: Connection) => {
      const problem = connectionProblem(connection as any);
      if (problem) { setLimitMsg(problem); return; }
      setLimitMsg(null);
      setEdges(addEdge({
        ...connection,
        type: 'deletable',
        animated: true,
        style: { stroke: '#8b5cf6', strokeWidth: 2.5 },
      }, edges));
    },
    [edges, setEdges]
  );

  /* Handle node selection */
  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: any) => {
      setSelectedNode(node.id);
    },
    [setSelectedNode]
  );

  const onPaneClick = useCallback(() => {
    setSelectedNode(null);
  }, [setSelectedNode]);

  /* Add new nodes from toolbar */
  /** Free tier caps the canvas size — refuse with a reason, not silently */
  const guardAdd = useCallback((): boolean => {
    if (canAddNode()) { setLimitMsg(null); return true; }
    setLimitMsg(`Free workflows are limited to ${FREE_LIMITS.nodes} nodes. Upgrade to Pro for unlimited.`);
    return false;
  }, [canAddNode]);

  const addPromptNode = useCallback(() => {
    if (!guardAdd()) return;
    const id = `prompt_${Date.now()}`;
    addNode({
      id,
      type: 'prompt',
      position: { x: 100, y: 100 + nodes.length * 50 },
      data: { type: 'prompt', label: `Prompt ${nodes.filter(n => (n.data as any).type === 'prompt').length + 1}`, text: '' },
    });
  }, [addNode, nodes, guardAdd]);

  const addImageNode = useCallback(() => {
    if (!guardAdd()) return;
    const id = `image_${Date.now()}`;
    addNode({
      id,
      type: 'image',
      position: { x: 100, y: 200 + nodes.length * 50 },
      data: { type: 'image', label: `Image ${nodes.filter(n => (n.data as any).type === 'image').length + 1}`, imageName: '', imageData: '' },
    });
  }, [addNode, nodes, guardAdd]);

  const addGenerateNode = useCallback(() => {
    if (!guardAdd()) return;
    const id = `generate_${Date.now()}`;
    addNode({
      id,
      type: 'generate',
      position: { x: 500, y: 150 + nodes.length * 50 },
      data: {
        type: 'generate',
        label: `Generate ${nodes.filter(n => (n.data as any).type === 'generate').length + 1}`,
        model: 'Nano Banana Pro',
        mediaType: 'image',
        aspectRatio: '9:16',
        duration: '6s',
        creationType: 'ingredients',
        enabled: true,
        status: 'idle',
        resultUrl: null,
        previewUrl: '',
        resultTileId: null,
        progress: 0,
        errorMessage: null,
      },
    });
  }, [addNode, nodes, guardAdd]);

  /** Shows the last frame of the clip feeding it, and passes it on. */
  const addFrameNode = useCallback(() => {
    if (!guardAdd()) return;
    const id = `frame_${Date.now()}`;
    addNode({
      id,
      type: 'frame',
      position: { x: 380, y: 420 + nodes.length * 50 },
      data: {
        type: 'frame',
        label: `Last Frame ${nodes.filter((n) => (n.data as any).type === 'frame').length + 1}`,
        frameUrl: '',
      },
    });
  }, [addNode, nodes, guardAdd]);

  /**
   * A generate node preconfigured for Grok Imagine.
   *
   * Same node type underneath — one execution path, one set of ports — but
   * Grok and Flow have almost nothing in common to configure. Flow has a model
   * list, ingredients and Start/End frames; Imagine has resolution, its own
   * clip lengths, and Extend. Reaching Grok by adding a Flow node and changing
   * two dropdowns made one node look like it did both jobs badly, which is the
   * confusion this splits.
   */
  const addGrokNode = useCallback(() => {
    if (!guardAdd()) return;
    const id = `grok_${Date.now()}`;
    addNode({
      id,
      type: 'generate',
      position: { x: 620, y: 320 + nodes.length * 50 },
      data: {
        type: 'generate',
        label: `Grok Clip ${nodes.filter((n) => {
          const d = n.data as any;
          return d.type === 'generate' && d.platform === 'grok';
        }).length + 1}`,
        platform: 'grok',
        // Imagine's own defaults, so the node matches the page it drives.
        mediaType: 'video',
        model: '',
        aspectRatio: '9:16',
        duration: '10s',
        resolution: '720p',
        creationType: 'ingredients',
        enabled: true,
        status: 'idle',
        resultUrl: null,
        previewUrl: '',
        resultTileId: null,
        progress: 0,
        errorMessage: null,
      },
    });
  }, [addNode, nodes, guardAdd]);

  /**
   * Grok's extend, as its own node.
   *
   * It was a toggle on the clip node, and that hid what it is: a second
   * generation with its own prompt, its own length and its own result. As a
   * node it can also be chained, which is how a 10s clip reaches 30 — and how
   * the arithmetic that caps it becomes something you can see rather than
   * something a run discovers.
   */
  /**
   * An agent: a goal in, a loop, an answer out.
   *
   * Starts with read_canvas only. Tested against live ChatGPT, a model asked
   * to produce an image produced it itself rather than calling the tool - so
   * the default tool is the one it cannot fake, and generate_image is opt-in.
   */
  const addAgentNode = useCallback(() => {
    if (!guardAdd()) return;
    const id = `agent_${Date.now()}`;
    addNode({
      id,
      type: 'agent',
      position: { x: 620, y: 260 + nodes.length * 50 },
      data: {
        type: 'agent',
        label: `Agent ${nodes.filter((n) => (n.data as any).type === 'agent').length + 1}`,
        platform: 'chatgpt',
        mediaType: 'text',
        maxIterations: 4,
        tools: ['read_canvas'],
        system: '',
        agentSteps: [],
        enabled: true,
        status: 'idle',
        progress: 0,
        errorMessage: null,
      },
    });
  }, [addNode, nodes, guardAdd]);

  const addExtendNode = useCallback(() => {
    if (!guardAdd()) return;
    const id = `extend_${Date.now()}`;
    addNode({
      id,
      type: 'extend',
      position: { x: 900, y: 320 + nodes.length * 50 },
      data: {
        type: 'extend',
        label: `Extend ${nodes.filter((n) => (n.data as any).type === 'extend').length + 1}`,
        extendSeconds: '+10s',
        enabled: true,
        status: 'idle',
        progress: 0,
        errorMessage: null,
      },
    });
  }, [addNode, nodes, guardAdd]);

  /**
   * A generate node preconfigured to ask ChatGPT for text.
   *
   * Same node type underneath — it reuses the whole execution path — but
   * reaching it by adding a Generate node and changing two dropdowns meant
   * nobody found it. As its own button it is a thing you can add.
   */
  /* One director for the whole workflow. Its own node rather than a mode on
     Ask AI, because a node that writes the whole set has to see the graph, and
     five wires leaving a box says that better than a checkbox does. */
  const addStoryNode = useCallback(() => {
    if (!guardAdd()) return;
    const id = `story_${Date.now()}`;
    addNode({
      id,
      type: 'story',
      position: { x: 300, y: 250 + nodes.length * 50 },
      data: {
        type: 'story',
        /* The stored type stays 'story' — every saved workflow, all 26
           templates and the builder's plan format hold that string, and this
           rename is the label only. */
        label: `Director ${nodes.filter((x) => x.type === 'story').length + 1}`,
        platform: 'gemini',
        mediaType: 'text',
        preset: '',
        structure: 'hook',
        cameraProgression: 'dynamic',
        audioMode: 'cinematic',
        visualPreset: 'none',
        status: 'idle',
      },
    } as any);
  }, [addNode, nodes, guardAdd]);

  const addAskNode = useCallback(() => {
    if (!guardAdd()) return;
    const id = `ask_${Date.now()}`;
    addNode({
      id,
      type: 'generate',
      position: { x: 300, y: 250 + nodes.length * 50 },
      data: {
        type: 'generate',
        label: `Ask AI ${nodes.filter((n) => {
          const d = n.data as any;
          return d.type === 'generate' && d.mediaType === 'text';
        }).length + 1}`,
        platform: 'chatgpt',
        mediaType: 'text',
        model: '',
        aspectRatio: '9:16',
        creationType: 'ingredients',
        enabled: true,
        status: 'idle',
        resultUrl: null,
        previewUrl: '',
        resultTileId: null,
        resultText: '',
        progress: 0,
        errorMessage: null,
      },
    });
  }, [addNode, nodes, guardAdd]);

  return (
    <div className="studio-canvas" ref={reactFlowWrapper}>
      {/* Top Bar */}
      <div className="studio-topbar">
        <div className="studio-topbar__left">
          <button className="studio-topbar__back" onClick={() => setView('gallery')} title="Back to Gallery">
            <Icon name="back" className="studio-topbar__glyph" />
          </button>
          <input
            className="studio-topbar__name"
            value={workflow.name}
            onChange={(e) => setWorkflowName(e.target.value)}
          />
        </div>
        {/* Progress used to live here as well as in the run bar — the same
            "0/5" in two places, neither of them next to the controls. The run
            bar owns it now. */}
        <div className="studio-topbar__center" />
        <div className="studio-topbar__right">
          {isPro ? (
            <span className="studio-topbar__stat">
              Nodes {nodes.length} · <span className="studio-topbar__pro">PRO</span>
            </span>
          ) : (
            <>
              {/* What is left, not what is spent.
                  "Runs 8/50" reads the same at 8 as at 48 — the number that
                  decides anything is the one going down. */}
              <span className={`studio-topbar__stat ${
                runsLeft === 0 ? 'studio-topbar__stat--maxed'
                  : runsLeft <= LOW_RUNS ? 'studio-topbar__stat--low' : ''
              }`}>
                {runsLeft === 0 ? 'No runs left' : `${runsLeft} runs left`}
              </span>
              <span className={`studio-topbar__stat ${
                FREE_LIMITS.nodes && nodes.length >= FREE_LIMITS.nodes ? 'studio-topbar__stat--maxed' : ''
              }`}>
                Nodes {nodes.length}{FREE_LIMITS.nodes ? `/${FREE_LIMITS.nodes}` : ''}
              </span>
              {/* Loud only when it is the thing in the way. A button that
                  looks the same on run 1 as on run 50 is furniture by the
                  time it matters. */}
              <button
                type="button"
                className={`studio-topbar__upgrade ${
                  runsLeft <= LOW_RUNS ? 'studio-topbar__upgrade--urgent' : ''
                }`}
                onClick={openUpgrade}
              >
                <Icon name="upgrade" className="studio-topbar__glyph" />
                {runsLeft === 0 ? 'Get more runs' : 'Upgrade'}
              </button>
            </>
          )}
          <button
            className="studio-topbar__icon"
            onClick={() => exportWorkflow()}
            disabled={nodes.length === 0}
            title="Export workflow as JSON"
          >
            <Icon name="import" className="studio-topbar__glyph" />
          </button>
          <button
            className={`studio-topbar__save ${saveState === 'error' ? 'studio-topbar__save--error' : ''} ${saveState === 'saved' ? 'studio-topbar__save--ok' : ''}`}
            onClick={() => saveWorkflow()}
            disabled={nodes.length === 0 || saveState === 'saving'}
            title={saveError || 'Save workflow (Ctrl+S)'}
          >
            {saveState === 'saving' ? <>Saving…</>
              : saveState === 'saved' ? <><Icon name="check" className="studio-topbar__glyph" /> Saved</>
              : saveState === 'error' ? <><Icon name="alert" className="studio-topbar__glyph" /> Failed</>
              : isDirty ? <><Icon name="dot" className="studio-topbar__glyph studio-topbar__glyph--dirty" /> Save</>
              : <>Save</>}
          </button>
        </div>
      </div>

      {/* Limit notice — dismissible, never blocks the canvas */}
      {limitMsg && (
        <div className="studio-limit">
          <span className="studio-limit__text">{limitMsg}</span>
          <button type="button" className="studio-limit__cta" onClick={openUpgrade}>
            Upgrade
          </button>
          <button className="studio-limit__close" onClick={() => setLimitMsg(null)} aria-label="Dismiss">×</button>
        </div>
      )}

      {/* Node Toolbar (Left sidebar) */}
      <div className="studio-toolbar">
        <div className="studio-toolbar__group">
          <div className="studio-toolbar__heading">Inputs</div>
          <button className="studio-toolbar__btn studio-toolbar__btn--prompt" onClick={addPromptNode} aria-label="Add Prompt node">
            <span className="studio-toolbar__node-icon studio-toolbar__node-icon--prompt">
              <Icon name="prompt" kind="prompt" className="studio-toolbar__btn-icon" />
            </span>
            <span className="studio-toolbar__btn-label">Prompt</span>
          </button>
          <button className="studio-toolbar__btn studio-toolbar__btn--image" onClick={addImageNode} aria-label="Add Image node">
            <span className="studio-toolbar__node-icon studio-toolbar__node-icon--image">
              <Icon name="image" kind="image" className="studio-toolbar__btn-icon" />
            </span>
            <span className="studio-toolbar__btn-label">Image</span>
          </button>
        </div>

        <div className="studio-toolbar__group">
          <div className="studio-toolbar__heading">Generate</div>
          <button className="studio-toolbar__btn studio-toolbar__btn--flow" onClick={addGenerateNode} aria-label="Add Flow clip node">
            <span className="studio-toolbar__node-icon studio-toolbar__node-icon--flow">
              <BrandIcon name="flow" className="studio-toolbar__btn-icon studio-toolbar__btn-icon--brand" />
            </span>
            <span className="studio-toolbar__btn-label">Flow clip</span>
          </button>
          <button className="studio-toolbar__btn studio-toolbar__btn--grok" onClick={addGrokNode} aria-label="Add Grok clip node">
            <span className="studio-toolbar__node-icon studio-toolbar__node-icon--grok">
              <BrandIcon name="grok" className="studio-toolbar__btn-icon studio-toolbar__btn-icon--brand" />
            </span>
            <span className="studio-toolbar__btn-label">Grok clip</span>
          </button>
          <button className="studio-toolbar__btn studio-toolbar__btn--ask" onClick={addAskNode} aria-label="Add Ask AI node">
            <span className="studio-toolbar__node-icon studio-toolbar__node-icon--ask">
              <Icon name="chat" kind="ask" className="studio-toolbar__btn-icon" />
            </span>
            <span className="studio-toolbar__btn-label">Ask AI</span>
          </button>
          <button className="studio-toolbar__btn studio-toolbar__btn--story" onClick={addStoryNode} aria-label="Add Director node">
            <span className="studio-toolbar__node-icon studio-toolbar__node-icon--story">
              <Icon name="story" kind="video" className="studio-toolbar__btn-icon" />
            </span>
            <span className="studio-toolbar__btn-label">Director</span>
          </button>
          <button className="studio-toolbar__btn studio-toolbar__btn--agent" onClick={addAgentNode} aria-label="Add Agent node">
            <span className="studio-toolbar__node-icon studio-toolbar__node-icon--agent">
              <Icon name="agent" kind="agent" className="studio-toolbar__btn-icon" />
            </span>
            <span className="studio-toolbar__btn-label">Agent</span>
          </button>
        </div>

        <div className="studio-toolbar__group">
          <div className="studio-toolbar__heading">Continue a clip</div>
          <button className="studio-toolbar__btn studio-toolbar__btn--frame" onClick={addFrameNode} aria-label="Add Last Frame node">
            <span className="studio-toolbar__node-icon studio-toolbar__node-icon--frame">
              <Icon name="frame" kind="frame" className="studio-toolbar__btn-icon" />
            </span>
            <span className="studio-toolbar__btn-label">Last frame</span>
          </button>
          <button className="studio-toolbar__btn studio-toolbar__btn--extend" onClick={addExtendNode} aria-label="Add Extend node">
            <span className="studio-toolbar__node-icon studio-toolbar__node-icon--extend">
              <Icon name="extend" kind="frame" className="studio-toolbar__btn-icon" />
            </span>
            <span className="studio-toolbar__btn-label">Extend</span>
          </button>
        </div>

        {/* Run control */}
        <div className="studio-toolbar__divider" />
        {!isRunning && (
          <>
            <button
              className="studio-toolbar__btn studio-toolbar__btn--run"
              onClick={handleRun}
              disabled={!canRun}
              aria-label="Run workflow"
            >
              <Icon name="play" className="studio-toolbar__btn-icon" />
              <span className="studio-toolbar__btn-label">
                {canRun ? 'Run workflow' : 'Add a node to run'}
              </span>
            </button>
            {failedNodeIds.length > 0 && (
              <button
                className="studio-toolbar__btn studio-toolbar__btn--retry"
                onClick={() => handleRetry()}
                aria-label={`Retry ${failedNodeIds.length} failed node${failedNodeIds.length === 1 ? '' : 's'}`}
                title="Re-runs only the failed nodes and anything skipped because of them"
              >
                <span className="studio-toolbar__btn-icon" aria-hidden="true">↻</span>
                <span className="studio-toolbar__btn-label">
                  Retry failed ({failedNodeIds.length})
                </span>
              </button>
            )}
          </>
        )}
      </div>

      {/* React Flow Canvas */}
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        isValidConnection={(c) => canConnect(c as any)}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        deleteKeyCode={['Backspace', 'Delete']}
        fitView
        fitViewOptions={{ padding: 0.25, maxZoom: 1 }}
        proOptions={{ hideAttribution: true }}
        defaultEdgeOptions={{
          type: 'deletable',
          animated: true,
          style: { stroke: '#8b5cf6', strokeWidth: 2.5 },
        }}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="#1c1c21" />

        {/* Minimap: small, and only worth showing once the graph outgrows the screen */}
        {showMinimap && nodes.length > 2 && (
          <MiniMap
            className="studio-minimap"
            pannable
            zoomable
            nodeStrokeWidth={0}
            nodeBorderRadius={3}
            nodeColor={(n) => {
              const d = n.data as any;
              /* Mirrors the node-family tokens in shared/tokens.css. Literals
                 because React Flow writes these to an SVG fill attribute, and
                 presentation attributes do not resolve var(). These three were
                 the old swapped mapping — prompt orange, generate green — so
                 the minimap disagreed with the nodes it was a map of. */
              if (d?.type === 'prompt') return '#22c55e';   /* --n-prompt */
              if (d?.type === 'image') return '#60a5fa';    /* --n-image  */
              if (d?.type === 'generate') return '#f97316'; /* --n-video  */
              return '#33333b';                             /* --line-2   */
            }}
            maskColor="rgba(8,8,10,0.72)"
          />
        )}

        {/* Empty state */}
        {nodes.length === 0 && (
          <Panel position="top-center">
            <div className="studio-empty">
              <svg className="studio-empty__icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M20.5 12a8.5 8.5 0 1 1-2.9-6.4" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
                <path d="M15.2 3.4l3.1 2.1-2.1 3.1" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M10.3 8.9l5.4 3.1-5.4 3.1z" fill="currentColor" />
              </svg>
              <h3 className="studio-empty__title">Start Building</h3>
              <p className="studio-empty__text">
                Add nodes from the left toolbar, or go back to pick a template.
              </p>
            </div>
          </Panel>
        )}
      </ReactFlow>

      {/* ── Run bar ──
          Everything about the run in one place that does not move: what is
          running, how far in, how long, and how to stop it. Previously this
          was a 4px progress bar and "4/5" in the top centre, with Pause and
          Stop over on the left rail — three places to look, none of them
          where the eye already was. */}
      {(isRunning || failedNodeIds.length > 0) && (
        <div className={`studio-runbar ${isRunning ? '' : 'studio-runbar--idle'}`}>
          {isRunning && (
            <>
              <span className={`studio-runbar__pulse ${isPaused ? 'is-paused' : ''}`} />
              <button
                className="studio-runbar__node"
                onClick={() => currentNodeId && flyTo(currentNodeId)}
                disabled={!currentNodeId}
                title="Show this node on the canvas"
              >
                {runningLabel}
              </button>
              <div className="studio-runbar__bar">
                <div
                  className="studio-runbar__fill"
                  style={{ width: `${runProgress.total ? (runProgress.current / runProgress.total) * 100 : 0}%` }}
                />
              </div>
              <span className="studio-runbar__count">
                {runProgress.current}/{runProgress.total}
              </span>
              <span className="studio-runbar__elapsed">{elapsed}</span>
              <button className="studio-runbar__btn" onClick={handlePause}>
                {isPaused ? '▶ Resume' : '⏸ Pause'}
              </button>
              <button className="studio-runbar__btn studio-runbar__btn--stop" onClick={handleStop}>
                ⏹ Stop
              </button>
            </>
          )}

          {/* A failed node used to be a red border somewhere on a canvas wider
              than the screen. Now it is a button that flies you to it. */}
          {failedNodeIds.length > 0 && (
            <div className="studio-runbar__fails">
              <span className="studio-runbar__fails-label">
                {failedNodeIds.length} failed
              </span>
              {failedNodeIds.slice(0, 4).map((id) => {
                const n = nodes.find((x) => x.id === id);
                const d = n?.data as any;
                return (
                  <button
                    key={id}
                    className="studio-runbar__fail"
                    onClick={() => flyTo(id)}
                    title={d?.errorMessage || 'Show this node'}
                  >
                    {d?.label || id}
                  </button>
                );
              })}
              {!isRunning && (
                <button className="studio-runbar__btn studio-runbar__btn--retry" onClick={() => handleRetry()}>
                  ↻ Retry failed
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* One dock instead of zoom bottom-left + recenter bottom-centre + minimap */}
      <div className="studio-dock">
        <button className="studio-dock__btn" onClick={() => zoomOut()} title="Zoom out" aria-label="Zoom out">−</button>
        <span className="studio-dock__zoom" title="Current zoom">{zoomPct}%</span>
        <button className="studio-dock__btn" onClick={() => zoomIn()} title="Zoom in" aria-label="Zoom in">+</button>
        <span className="studio-dock__sep" />
        <button className="studio-dock__btn studio-dock__btn--wide" onClick={handleRecenter} title="Fit all nodes to view">
          ⊡ Recenter
        </button>
        {nodes.length > 2 && (
          <>
            <span className="studio-dock__sep" />
            <button
              className={`studio-dock__btn ${showMinimap ? 'studio-dock__btn--on' : ''}`}
              onClick={() => setShowMinimap((v) => !v)}
              title={showMinimap ? 'Hide minimap' : 'Show minimap'}
              aria-label="Toggle minimap"
            >
              ▣
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/* useReactFlow/useStore need the provider, so the canvas body is a child of it */
export default function Canvas() {
  return (
    <ReactFlowProvider>
      <CanvasInner />
    </ReactFlowProvider>
  );
}
