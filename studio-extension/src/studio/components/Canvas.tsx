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

import { useStudioStore, FREE_LIMITS } from '../store';
import { consumeStudioRun } from '../../shared/api';
import { PromptNode } from '../nodes/PromptNode';
import { ImageNode } from '../nodes/ImageNode';
import { GenerateNode } from '../nodes/GenerateNode';
import { runner } from '../engine/WorkflowRunner';
import { bridge } from '../engine/bridge';

/* Register custom node types */
const nodeTypes = {
  prompt: PromptNode,
  image: ImageNode,
  generate: GenerateNode,
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
  const { zoomIn, zoomOut, fitView } = useReactFlow();
  const zoomPct = Math.round(useStore((s) => s.transform[2]) * 100);
  const [showMinimap, setShowMinimap] = useState(true);

  const handleRecenter = useCallback(
    () => fitView({ padding: 0.25, maxZoom: 1, duration: 300 }),
    [fitView]
  );

  /* Only Generate nodes actually execute — a canvas of prompts alone can't run */
  const canRun = nodes.some((n) => (n.data as any)?.type === 'generate');

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

    // Only enabled Generate nodes reach Flow — Prompt/Image nodes just carry
    // data, so charging for them would over-bill the user.
    const generateCount = nodes.filter((n) => {
      const d = n.data as any;
      return d?.type === 'generate' && d?.enabled !== false;
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

  /* Nodes the user can retry — anything a run left in error. */
  const failedNodeIds = nodes
    .filter((n) => {
      const d = n.data as any;
      return d?.type === 'generate' && d?.status === 'error';
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
  const onConnect: OnConnect = useCallback(
    (connection: Connection) => {
      setEdges(addEdge({
        ...connection,
        type: 'default',
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

  /**
   * A generate node preconfigured to ask ChatGPT for text.
   *
   * Same node type underneath — it reuses the whole execution path — but
   * reaching it by adding a Generate node and changing two dropdowns meant
   * nobody found it. As its own button it is a thing you can add.
   */
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
            ←
          </button>
          <input
            className="studio-topbar__name"
            value={workflow.name}
            onChange={(e) => setWorkflowName(e.target.value)}
          />
        </div>
        <div className="studio-topbar__center">
          {isRunning && (
            <div className="studio-topbar__progress">
              <div className="studio-topbar__progress-bar">
                <div
                  className="studio-topbar__progress-fill"
                  style={{ width: `${runProgress.total ? (runProgress.current / runProgress.total) * 100 : 0}%` }}
                />
              </div>
              <span className="studio-topbar__progress-text">
                {runProgress.current}/{runProgress.total}
              </span>
            </div>
          )}
        </div>
        <div className="studio-topbar__right">
          {isPro ? (
            <span className="studio-topbar__stat">
              ⚡ Nodes {nodes.length} · <span className="studio-topbar__pro">PRO</span>
            </span>
          ) : (
            <>
              <span className={`studio-topbar__stat ${runsUsed >= FREE_LIMITS.runsPerMonth ? 'studio-topbar__stat--maxed' : ''}`}>
                Runs {Math.min(runsUsed, FREE_LIMITS.runsPerMonth)}/{FREE_LIMITS.runsPerMonth}
              </span>
              <span className={`studio-topbar__stat ${nodes.length >= FREE_LIMITS.nodes ? 'studio-topbar__stat--maxed' : ''}`}>
                Nodes {nodes.length}/{FREE_LIMITS.nodes}
              </span>
              <a
                className="studio-topbar__upgrade"
                href="https://auto-flow.studio/pricing"
                target="_blank"
                rel="noopener noreferrer"
              >
                ⬆ Upgrade
              </a>
            </>
          )}
          <button
            className="studio-topbar__icon"
            onClick={() => exportWorkflow()}
            disabled={nodes.length === 0}
            title="Export workflow as JSON"
          >
            ⭳
          </button>
          <button
            className={`studio-topbar__save ${saveState === 'error' ? 'studio-topbar__save--error' : ''} ${saveState === 'saved' ? 'studio-topbar__save--ok' : ''}`}
            onClick={() => saveWorkflow()}
            disabled={nodes.length === 0 || saveState === 'saving'}
            title={saveError || 'Save workflow (Ctrl+S)'}
          >
            {saveState === 'saving' ? 'Saving…'
              : saveState === 'saved' ? '✓ Saved'
              : saveState === 'error' ? '⚠ Failed'
              : isDirty ? '● Save' : 'Save'}
          </button>
        </div>
      </div>

      {/* Limit notice — dismissible, never blocks the canvas */}
      {limitMsg && (
        <div className="studio-limit">
          <span className="studio-limit__text">{limitMsg}</span>
          <a className="studio-limit__cta" href="https://auto-flow.studio/pricing" target="_blank" rel="noopener noreferrer">
            Upgrade
          </a>
          <button className="studio-limit__close" onClick={() => setLimitMsg(null)} aria-label="Dismiss">×</button>
        </div>
      )}

      {/* Node Toolbar (Left sidebar) */}
      <div className="studio-toolbar">
        <button className="studio-toolbar__btn studio-toolbar__btn--add" onClick={addPromptNode} aria-label="Add Prompt node">
          <span className="studio-toolbar__btn-icon" aria-hidden="true">✏️</span>
          <span className="studio-toolbar__btn-label">Add Prompt</span>
        </button>
        <button className="studio-toolbar__btn" onClick={addImageNode} aria-label="Add Image node">
          <span className="studio-toolbar__btn-icon" aria-hidden="true">🖼️</span>
          <span className="studio-toolbar__btn-label">Add Image</span>
        </button>
        <button className="studio-toolbar__btn" onClick={addAskNode} aria-label="Add Ask AI node">
          <span className="studio-toolbar__btn-icon" aria-hidden="true">💬</span>
          <span className="studio-toolbar__btn-label">Add Ask AI</span>
        </button>
        <button className="studio-toolbar__btn studio-toolbar__btn--primary" onClick={addGenerateNode} aria-label="Add Generate node">
          <span className="studio-toolbar__btn-icon" aria-hidden="true">🎬</span>
          <span className="studio-toolbar__btn-label">Add Generate</span>
        </button>
        <div className="studio-toolbar__divider" />
        {isRunning ? (
          <>
            <button className="studio-toolbar__btn studio-toolbar__btn--pause" onClick={handlePause} aria-label={isPaused ? 'Resume workflow' : 'Pause workflow'}>
              <span className="studio-toolbar__btn-icon" aria-hidden="true">{isPaused ? '▶' : '⏸'}</span>
              <span className="studio-toolbar__btn-label">{isPaused ? 'Resume' : 'Pause'}</span>
            </button>
            <button className="studio-toolbar__btn studio-toolbar__btn--stop" onClick={handleStop} aria-label="Stop workflow">
              <span className="studio-toolbar__btn-icon" aria-hidden="true">⏹</span>
              <span className="studio-toolbar__btn-label">Stop</span>
            </button>
          </>
        ) : (
          <>
            <button
              className="studio-toolbar__btn studio-toolbar__btn--run"
              onClick={handleRun}
              disabled={!canRun}
              aria-label="Run workflow"
            >
              <span className="studio-toolbar__btn-icon" aria-hidden="true">▶</span>
              <span className="studio-toolbar__btn-label">
                {canRun ? 'Run workflow' : 'Add a Generate node to run'}
              </span>
            </button>
            {/* Recovering from a failure shouldn't mean paying for the clips
                that already worked. */}
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
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        nodeTypes={nodeTypes}
        fitView
        /* Cap zoom so a 2-node workflow doesn't fill the screen with giant cards */
        fitViewOptions={{ padding: 0.25, maxZoom: 1 }}
        proOptions={{ hideAttribution: true }}
        defaultEdgeOptions={{
          type: 'smoothstep',
          animated: true,
          style: { stroke: '#f97316', strokeWidth: 2 },
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
              if (d?.type === 'prompt') return '#f97316';
              if (d?.type === 'image') return '#3b82f6';
              if (d?.type === 'generate') return '#22c55e';
              return '#4a4a52';
            }}
            maskColor="rgba(8,8,10,0.72)"
          />
        )}

        {/* Empty state */}
        {nodes.length === 0 && (
          <Panel position="top-center">
            <div className="studio-empty">
              <div className="studio-empty__icon">⚡</div>
              <h3 className="studio-empty__title">Start Building</h3>
              <p className="studio-empty__text">
                Add nodes from the left toolbar, or go back to pick a template.
              </p>
            </div>
          </Panel>
        )}
      </ReactFlow>

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
