/* ============================================================
   TemplateGallery — Home screen with template cards
   Templates live in ../templates; this file is presentation only.
   ============================================================ */

import { useCallback, useMemo, useState } from 'react';
import { useStudioStore, normalizeWorkflow } from '../store';
import { TEMPLATES, CATEGORIES, type Template } from '../templates';

/** Node-chain preview gets noisy past this many dots */
const MAX_PREVIEW_DOTS = 8;

export default function TemplateGallery() {
  const { setView, setNodes, setEdges, setWorkflowName } = useStudioStore();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string>('All');

  const loadTemplate = useCallback(
    (template: Template) => {
      // Deep clone nodes/edges so each instance is independent,
      // then normalize (edge style, model names, missing fields)
      const { nodes: clonedNodes, edges: clonedEdges } = normalizeWorkflow(
        JSON.parse(JSON.stringify(template.nodes)),
        JSON.parse(JSON.stringify(template.edges))
      );
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

  /* Search covers the use-case line too — people look for "ad" or
     "consistency", not the template's proper name. */
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return TEMPLATES.filter((t) => {
      if (category !== 'All' && t.category !== category) return false;
      if (!q) return true;
      return (
        t.name.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q) ||
        t.useCase.toLowerCase().includes(q) ||
        t.category.toLowerCase().includes(q)
      );
    });
  }, [query, category]);

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
          placeholder="Search templates — try “ad”, “character”, “b-roll”…"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {/* Category Tabs */}
      <div className="studio-gallery__tabs">
        {CATEGORIES.map((cat) => (
          <button
            key={cat}
            className={`studio-gallery__tab ${category === cat ? 'studio-gallery__tab--active' : ''}`}
            onClick={() => setCategory(cat)}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Template Grid */}
      <div className="studio-gallery__grid">
        {visible.map((tpl) => (
          <div
            key={tpl.id}
            className="studio-gallery__card"
            onClick={() => loadTemplate(tpl)}
            title={tpl.useCase}
          >
            {/* Thumbnail previews the template's real node chain rather than
                sitting empty around a single oversized emoji */}
            <div className="studio-gallery__card-thumb">
              <span className="studio-gallery__card-emoji">{tpl.thumbnail}</span>
              <div className="studio-gallery__card-graph" aria-hidden="true">
                {tpl.nodes.slice(0, MAX_PREVIEW_DOTS).map((n: any, i: number) => (
                  <span key={n.id || i} className="studio-gallery__card-graph-item">
                    {i > 0 && <span className="studio-gallery__card-graph-link" />}
                    <span className={`studio-gallery__card-dot studio-gallery__card-dot--${n.data?.type || 'generate'}`} />
                  </span>
                ))}
              </div>
            </div>
            <div className="studio-gallery__card-info">
              <h3 className="studio-gallery__card-name">{tpl.name}</h3>
              <p className="studio-gallery__card-desc">{tpl.description}</p>
              <p className="studio-gallery__card-use">{tpl.useCase}</p>
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

        {visible.length === 0 && (
          <div className="studio-gallery__empty">
            <span className="studio-gallery__empty-icon">🔍</span>
            <p>No templates match “{query}”.</p>
            <button className="studio-gallery__btn-blank" onClick={startBlank}>
              Start Blank instead
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
