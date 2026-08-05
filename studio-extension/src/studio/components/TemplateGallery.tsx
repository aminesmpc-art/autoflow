/* ============================================================
   TemplateGallery — Home screen with template cards
   Templates live in ../templates; this file is presentation only.
   ============================================================ */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStudioStore, normalizeWorkflow, resolveAssets } from '../store';
import { CATEGORIES, type Template } from '../templates';
import { loadTemplates, refreshTemplates, type TemplateSource } from '../templates/loader';
import { getUpgradeTarget } from '../../shared/api';

/** Node-chain preview gets noisy past this many dots */
const MAX_PREVIEW_DOTS = 8;

const relativeTime = (ts: number): string => {
  if (!ts) return '';
  const mins = Math.floor((Date.now() - ts) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return days < 30 ? `${days}d ago` : new Date(ts).toLocaleDateString();
};

export default function TemplateGallery() {
  const {
    setView, setNodes, setEdges, setWorkflowName,
    savedWorkflows, listWorkflows, loadWorkflow, deleteWorkflow,
    newWorkflow, importWorkflow,
  } = useStudioStore();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string>('All');
  const [importError, setImportError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { listWorkflows(); }, [listWorkflows]);

  const handleImport = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = ''; // allow re-picking the same file
      if (!file) return;
      try {
        setImportError(null);
        await importWorkflow(file);
      } catch (err: any) {
        setImportError(err?.message || 'Could not import that file');
      }
    },
    [importWorkflow]
  );

  const loadTemplate = useCallback(
    async (template: Template) => {
      /* A Pro template reaches a free account as metadata only — the server
         strips nodes and edges rather than sending the graph and trusting the
         UI to hide it. So there is nothing to open here; send them to the
         upgrade page instead. The card is a conversion surface, not a
         disabled button. */
      if (template.locked) {
        const { url } = await getUpgradeTarget();
        window.open(url, '_blank', 'noopener');
        return;
      }

      // Deep clone nodes/edges so each instance is independent,
      // then normalize (edge style, model names, missing fields)
      const { nodes: clonedNodes, edges: clonedEdges } = normalizeWorkflow(
        JSON.parse(JSON.stringify(template.nodes)),
        JSON.parse(JSON.stringify(template.edges))
      );
      // Open the canvas immediately; bundled reference images fill in a moment
      // later so a slow asset read never delays the click.
      setNodes(clonedNodes);
      setEdges(clonedEdges);
      setWorkflowName(template.name);
      setView('canvas');

      const withAssets = await resolveAssets(clonedNodes);
      if (withAssets !== clonedNodes) setNodes(withAssets);
    },
    [setView, setNodes, setEdges, setWorkflowName]
  );

  const startBlank = useCallback(() => {
    // newWorkflow() mints a fresh id, so a blank canvas can't overwrite the
    // workflow that was open before it.
    newWorkflow();
    setView('canvas');
  }, [newWorkflow, setView]);

  /* Templates come from the cache, the bundle, or the backend — see
     templates/loader.ts. The gallery renders whatever is available first and
     swaps in a newer set if one arrives; it never waits on the network, so a
     slow or missing API looks like a slightly older gallery rather than a
     spinner or an error. */
  const [templates, setTemplates] = useState<Template[]>([]);
  const [source, setSource] = useState<TemplateSource>('bundle');

  useEffect(() => {
    let live = true;
    loadTemplates().then(({ templates: t, source: s }) => {
      if (!live) return;
      setTemplates(t);
      setSource(s);
      console.log(`[Templates] Showing ${t.length} from ${s}`);
      // Then see if the backend has anything newer, without blocking the above.
      refreshTemplates().then((fresher) => {
        if (!live || !fresher) return;
        setTemplates(fresher.templates);
        setSource(fresher.source);
        console.log(`[Templates] Refreshed to ${fresher.templates.length} from network`);
      });
    });
    return () => { live = false; };
  }, []);

  /* Search covers the use-case line too — people look for "ad" or
     "consistency", not the template's proper name. */
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return templates.filter((t) => {
      if (category !== 'All' && t.category !== category) return false;
      if (!q) return true;
      return (
        t.name.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q) ||
        t.useCase.toLowerCase().includes(q) ||
        t.category.toLowerCase().includes(q)
      );
    });
  }, [query, category, templates]);

  return (
    <div className="studio-gallery">
      {/* Header */}
      <div className="studio-gallery__header">
        <div className="studio-gallery__brand">
          <span className="studio-gallery__logo">⚡</span>
          <span className="studio-gallery__title">AutoFlow Studio</span>
        </div>
        <div className="studio-gallery__actions">
          <button className="studio-gallery__btn-ghost" onClick={() => fileRef.current?.click()}>
            ⭱ Import
          </button>
          <button className="studio-gallery__btn-blank" onClick={startBlank}>
            + Start Blank
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            style={{ display: 'none' }}
            onChange={handleImport}
          />
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

      {importError && (
        <div className="studio-gallery__error">⚠ {importError}</div>
      )}

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
        <button
          className={`studio-gallery__tab ${category === 'Mine' ? 'studio-gallery__tab--active' : ''}`}
          onClick={() => setCategory('Mine')}
        >
          My Workflows{savedWorkflows.length > 0 && ` (${savedWorkflows.length})`}
        </button>
      </div>

      {/* Saved workflows */}
      {category === 'Mine' && (
        <div className="studio-gallery__grid">
          {savedWorkflows.map((w) => (
            <div key={w.id} className="studio-gallery__saved" onClick={() => loadWorkflow(w.id)}>
              <div className="studio-gallery__saved-main">
                <h3 className="studio-gallery__card-name">{w.name}</h3>
                <span className="studio-gallery__saved-meta">
                  {w.nodeCount} nodes · saved {relativeTime(w.updatedAt)}
                </span>
              </div>
              <button
                className="studio-gallery__saved-del"
                title="Delete this workflow"
                onClick={(e) => {
                  e.stopPropagation(); // don't also open it
                  if (confirm(`Delete "${w.name}"? This cannot be undone.`)) deleteWorkflow(w.id);
                }}
              >
                🗑
              </button>
            </div>
          ))}
          {savedWorkflows.length === 0 && (
            <div className="studio-gallery__empty">
              <span className="studio-gallery__empty-icon">💾</span>
              <p>No saved workflows yet. Build one and hit Save.</p>
              <button className="studio-gallery__btn-blank" onClick={startBlank}>Start Blank</button>
            </div>
          )}
        </div>
      )}

      {/* Template Grid */}
      {category !== 'Mine' && (
      <div className="studio-gallery__grid">
        {visible.map((tpl) => (
          <div
            key={tpl.id}
            className={`studio-gallery__card ${tpl.locked ? 'studio-gallery__card--locked' : ''}`}
            onClick={() => loadTemplate(tpl)}
            title={tpl.locked ? `${tpl.useCase}

Pro template — click to upgrade.` : tpl.useCase}
          >
            {tpl.locked && <span className="studio-gallery__lock">PRO</span>}
            {/* Thumbnail previews the template's real node chain rather than
                sitting empty around a single oversized emoji */}
            <div className="studio-gallery__card-thumb">
              {tpl.thumbnailImage ? (
                <img
                  className="studio-gallery__card-art"
                  src={tpl.thumbnailImage}
                  alt=""
                  aria-hidden="true"
                  /* Deliberately not lazy. Inside the gallery's scroll
                     container the browser kept deferring it indefinitely, so
                     the card rendered blank; the artwork is a few KB and there
                     is nothing to save. */
                  /* An artwork file that goes missing must not leave a broken
                     icon where the card's identity should be — fall back to
                     the emoji that every template still carries. */
                  onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                />
              ) : (
                <span className="studio-gallery__card-emoji">{tpl.thumbnail}</span>
              )}
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
      )}
    </div>
  );
}
