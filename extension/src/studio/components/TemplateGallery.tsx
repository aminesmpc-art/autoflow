/* ============================================================
   TemplateGallery — Home screen with template cards
   Shows built-in templates + user's saved workflows
   ============================================================ */

import { useCallback } from 'react';
import { useStudioStore } from '../store';
import type { Node, Edge } from '@xyflow/react';

/* ── Template Definition ── */

interface Template {
  id: string;
  name: string;
  description: string;
  category: string;
  difficulty: 'Easy' | 'Medium' | 'Advanced';
  nodeCount: number;
  thumbnail: string; // emoji for now, will be images later
  nodes: Node[];
  edges: Edge[];
}

/* ── Built-in Templates ── */

const TEMPLATES: Template[] = [
  {
    id: 'tpl_simple_image',
    name: 'Simple Image Generation',
    description: 'Write a prompt, generate one image. The simplest workflow.',
    category: 'Image',
    difficulty: 'Easy',
    nodeCount: 2,
    thumbnail: '🖼️',
    nodes: [
      {
        id: 'p1',
        type: 'prompt',
        position: { x: 50, y: 150 },
        data: { type: 'prompt', label: 'Prompt', text: '' },
      },
      {
        id: 'g1',
        type: 'generate',
        position: { x: 400, y: 100 },
        data: {
          type: 'generate', label: 'Generate Image', model: 'nano-banana-2',
          mediaType: 'image', aspectRatio: '9:16', duration: '6s',
          creationType: 'ingredients', status: 'idle', resultUrl: null,
          resultTileId: null, progress: 0, errorMessage: null,
        },
      },
    ],
    edges: [
      { id: 'e1', source: 'p1', target: 'g1', sourceHandle: 'text', targetHandle: 'text', type: 'smoothstep', animated: true, style: { stroke: '#f97316', strokeWidth: 2 } },
    ],
  },
  {
    id: 'tpl_simple_video',
    name: 'Simple Video Generation',
    description: 'Write a prompt, generate one video with Omni Flash.',
    category: 'Video',
    difficulty: 'Easy',
    nodeCount: 2,
    thumbnail: '🎬',
    nodes: [
      {
        id: 'p1',
        type: 'prompt',
        position: { x: 50, y: 150 },
        data: { type: 'prompt', label: 'Scene Prompt', text: '' },
      },
      {
        id: 'g1',
        type: 'generate',
        position: { x: 400, y: 100 },
        data: {
          type: 'generate', label: 'Generate Video', model: 'omni-flash',
          mediaType: 'video', aspectRatio: '9:16', duration: '6s',
          creationType: 'ingredients', status: 'idle', resultUrl: null,
          resultTileId: null, progress: 0, errorMessage: null,
        },
      },
    ],
    edges: [
      { id: 'e1', source: 'p1', target: 'g1', sourceHandle: 'text', targetHandle: 'text', type: 'smoothstep', animated: true, style: { stroke: '#f97316', strokeWidth: 2 } },
    ],
  },
  {
    id: 'tpl_character_chain',
    name: 'Character Sheet → Scene',
    description: 'Generate a character turnaround sheet, then use it as a reference to create a consistent scene video.',
    category: 'Character & Illustration',
    difficulty: 'Medium',
    nodeCount: 4,
    thumbnail: '👤',
    nodes: [
      {
        id: 'p_char',
        type: 'prompt',
        position: { x: 50, y: 80 },
        data: { type: 'prompt', label: 'Character Description', text: 'Character design sheet, concept art turnaround, multiple views. ' },
      },
      {
        id: 'g_sheet',
        type: 'generate',
        position: { x: 400, y: 50 },
        data: {
          type: 'generate', label: 'Generate Character Sheet', model: 'nano-banana-2',
          mediaType: 'image', aspectRatio: '9:16', duration: '6s',
          creationType: 'ingredients', status: 'idle', resultUrl: null,
          resultTileId: null, progress: 0, errorMessage: null,
        },
      },
      {
        id: 'p_scene',
        type: 'prompt',
        position: { x: 50, y: 350 },
        data: { type: 'prompt', label: 'Scene Prompt', text: '' },
      },
      {
        id: 'g_video',
        type: 'generate',
        position: { x: 800, y: 200 },
        data: {
          type: 'generate', label: 'Generate Scene Video', model: 'omni-flash',
          mediaType: 'video', aspectRatio: '9:16', duration: '6s',
          creationType: 'ingredients', status: 'idle', resultUrl: null,
          resultTileId: null, progress: 0, errorMessage: null,
        },
      },
    ],
    edges: [
      { id: 'e1', source: 'p_char', target: 'g_sheet', sourceHandle: 'text', targetHandle: 'text', type: 'smoothstep', animated: true, style: { stroke: '#f97316', strokeWidth: 2 } },
      { id: 'e2', source: 'g_sheet', target: 'g_video', sourceHandle: 'result', targetHandle: 'image_ref', type: 'smoothstep', animated: true, style: { stroke: '#3b82f6', strokeWidth: 2 } },
      { id: 'e3', source: 'p_scene', target: 'g_video', sourceHandle: 'text', targetHandle: 'text', type: 'smoothstep', animated: true, style: { stroke: '#f97316', strokeWidth: 2 } },
    ],
  },
  {
    id: 'tpl_ab_compare',
    name: 'A/B Model Comparison',
    description: 'Same prompt, two models — compare results side by side.',
    category: 'Comparison',
    difficulty: 'Easy',
    nodeCount: 3,
    thumbnail: '⚖️',
    nodes: [
      {
        id: 'p1',
        type: 'prompt',
        position: { x: 50, y: 200 },
        data: { type: 'prompt', label: 'Shared Prompt', text: '' },
      },
      {
        id: 'g_a',
        type: 'generate',
        position: { x: 450, y: 50 },
        data: {
          type: 'generate', label: 'Model A (Nano Banana)', model: 'nano-banana-2',
          mediaType: 'image', aspectRatio: '9:16', duration: '6s',
          creationType: 'ingredients', status: 'idle', resultUrl: null,
          resultTileId: null, progress: 0, errorMessage: null,
        },
      },
      {
        id: 'g_b',
        type: 'generate',
        position: { x: 450, y: 350 },
        data: {
          type: 'generate', label: 'Model B (Omni Flash)', model: 'omni-flash',
          mediaType: 'image', aspectRatio: '9:16', duration: '6s',
          creationType: 'ingredients', status: 'idle', resultUrl: null,
          resultTileId: null, progress: 0, errorMessage: null,
        },
      },
    ],
    edges: [
      { id: 'e1', source: 'p1', target: 'g_a', sourceHandle: 'text', targetHandle: 'text', type: 'smoothstep', animated: true, style: { stroke: '#f97316', strokeWidth: 2 } },
      { id: 'e2', source: 'p1', target: 'g_b', sourceHandle: 'text', targetHandle: 'text', type: 'smoothstep', animated: true, style: { stroke: '#f97316', strokeWidth: 2 } },
    ],
  },
  {
    id: 'tpl_ref_image_video',
    name: 'Reference Image → Video',
    description: 'Upload a reference image and generate a video based on it.',
    category: 'Video',
    difficulty: 'Easy',
    nodeCount: 3,
    thumbnail: '📸',
    nodes: [
      {
        id: 'img1',
        type: 'image',
        position: { x: 50, y: 80 },
        data: { type: 'image', label: 'Reference Image', imageName: '', imageData: '' },
      },
      {
        id: 'p1',
        type: 'prompt',
        position: { x: 50, y: 300 },
        data: { type: 'prompt', label: 'Scene Description', text: '' },
      },
      {
        id: 'g1',
        type: 'generate',
        position: { x: 450, y: 150 },
        data: {
          type: 'generate', label: 'Generate Video', model: 'omni-flash',
          mediaType: 'video', aspectRatio: '9:16', duration: '6s',
          creationType: 'ingredients', status: 'idle', resultUrl: null,
          resultTileId: null, progress: 0, errorMessage: null,
        },
      },
    ],
    edges: [
      { id: 'e1', source: 'img1', target: 'g1', sourceHandle: 'image', targetHandle: 'image_ref', type: 'smoothstep', animated: true, style: { stroke: '#3b82f6', strokeWidth: 2 } },
      { id: 'e2', source: 'p1', target: 'g1', sourceHandle: 'text', targetHandle: 'text', type: 'smoothstep', animated: true, style: { stroke: '#f97316', strokeWidth: 2 } },
    ],
  },
];

/* ── Component ── */

export default function TemplateGallery() {
  const { setView, setNodes, setEdges, setWorkflowName, workflow } = useStudioStore();

  const loadTemplate = useCallback(
    (template: Template) => {
      // Deep clone nodes/edges so each instance is independent
      const clonedNodes = JSON.parse(JSON.stringify(template.nodes));
      const clonedEdges = JSON.parse(JSON.stringify(template.edges));
      setNodes(clonedNodes);
      setEdges(clonedEdges);
      setWorkflowName(template.name);
      setView('canvas');
    },
    [setView, setNodes, setEdges, setWorkflowName]
  );

  const startBlank = useCallback(() => {
    setNodes([]);
    setEdges([]);
    setWorkflowName(`New Workflow - ${new Date().toLocaleDateString()}`);
    setView('canvas');
  }, [setView, setNodes, setEdges, setWorkflowName]);

  return (
    <div className="studio-gallery">
      {/* Header */}
      <div className="studio-gallery__header">
        <div className="studio-gallery__brand">
          <span className="studio-gallery__logo">⚡</span>
          <span className="studio-gallery__title">AutoFlow Studio</span>
        </div>
        <div className="studio-gallery__actions">
          <button className="studio-gallery__btn-blank" onClick={startBlank}>
            + Start Blank
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="studio-gallery__search">
        <input
          className="studio-gallery__search-input"
          placeholder="Search templates..."
          type="text"
        />
      </div>

      {/* Category Tabs */}
      <div className="studio-gallery__tabs">
        <button className="studio-gallery__tab studio-gallery__tab--active">All</button>
        <button className="studio-gallery__tab">Image</button>
        <button className="studio-gallery__tab">Video</button>
        <button className="studio-gallery__tab">Character</button>
      </div>

      {/* Template Grid */}
      <div className="studio-gallery__grid">
        {TEMPLATES.map((tpl) => (
          <div
            key={tpl.id}
            className="studio-gallery__card"
            onClick={() => loadTemplate(tpl)}
          >
            <div className="studio-gallery__card-thumb">
              <span className="studio-gallery__card-emoji">{tpl.thumbnail}</span>
            </div>
            <div className="studio-gallery__card-info">
              <h3 className="studio-gallery__card-name">{tpl.name}</h3>
              <p className="studio-gallery__card-desc">{tpl.description}</p>
              <div className="studio-gallery__card-meta">
                <span className="studio-gallery__card-tag">{tpl.category}</span>
                <span className="studio-gallery__card-nodes">⚙ {tpl.nodeCount} nodes</span>
                <span className={`studio-gallery__card-difficulty studio-gallery__card-difficulty--${tpl.difficulty.toLowerCase()}`}>
                  {tpl.difficulty}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
