/* ============================================================
   Canvas — React Flow wrapper for the workflow editor
   ============================================================ */

import { useCallback, useRef, useEffect } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  type Connection,
  type OnConnect,
  BackgroundVariant,
  Panel,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { useStudioStore } from '../store';
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

export default function Canvas() {
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
    setView,
  } = useStudioStore();

  const reactFlowWrapper = useRef<HTMLDivElement>(null);

  /* Only Generate nodes actually execute — a canvas of prompts alone can't run */
  const canRun = nodes.some((n) => (n.data as any)?.type === 'generate');

  /* Connect bridge on mount */
  useEffect(() => {
    bridge.connect();
    return () => bridge.disconnect();
  }, []);

  /* Run/Stop/Pause handlers */
  const handleRun = useCallback(() => {
    if (isRunning || !canRun) return;
    runner.run(nodes, edges);
  }, [nodes, edges, isRunning, canRun]);

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
  const addPromptNode = useCallback(() => {
    const id = `prompt_${Date.now()}`;
    addNode({
      id,
      type: 'prompt',
      position: { x: 100, y: 100 + nodes.length * 50 },
      data: { type: 'prompt', label: `Prompt ${nodes.filter(n => (n.data as any).type === 'prompt').length + 1}`, text: '' },
    });
  }, [addNode, nodes]);

  const addImageNode = useCallback(() => {
    const id = `image_${Date.now()}`;
    addNode({
      id,
      type: 'image',
      position: { x: 100, y: 200 + nodes.length * 50 },
      data: { type: 'image', label: `Image ${nodes.filter(n => (n.data as any).type === 'image').length + 1}`, imageName: '', imageData: '' },
    });
  }, [addNode, nodes]);

  const addGenerateNode = useCallback(() => {
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
  }, [addNode, nodes]);

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
          <span className="studio-topbar__stat">
            ⚡ Nodes {nodes.length}
          </span>
          <button className="studio-topbar__save" onClick={() => saveWorkflow()}>
            Save
          </button>
        </div>
      </div>

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
        proOptions={{ hideAttribution: true }}
        defaultEdgeOptions={{
          type: 'smoothstep',
          animated: true,
          style: { stroke: '#f97316', strokeWidth: 2 },
        }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#1a1a1e" />
        <Controls
          className="studio-controls"
          showInteractive={false}
        />
        <MiniMap
          className="studio-minimap"
          nodeColor={(n) => {
            const d = n.data as any;
            if (d?.type === 'prompt') return '#22c55e';
            if (d?.type === 'image') return '#3b82f6';
            if (d?.type === 'generate') return '#f97316';
            return '#666';
          }}
          maskColor="rgba(0,0,0,0.7)"
        />

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

      {/* Bottom: Recenter */}
      <button
        className="studio-recenter"
        onClick={() => {
          // Handled by React Flow controls, but this is a visual shortcut
          const fitBtn = document.querySelector('.react-flow__controls-fitview') as HTMLButtonElement;
          fitBtn?.click();
        }}
      >
        ⊡ Recenter
      </button>
    </div>
  );
}
