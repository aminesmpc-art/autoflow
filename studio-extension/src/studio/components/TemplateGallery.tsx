/* ============================================================
   TemplateGallery — Studio's home screen.

   Templates live in ../templates; this file is presentation only.

   The shell is a toolbar, a session bar, two levels of navigation, a filter
   row, the grid, and a footer that states the plan and what is left of it.
   Everything it shows is something the app actually knows. There are no star
   ratings and no install counts on the cards: no such data exists anywhere in
   this codebase or the backend, and a card claiming "660 users, 4.8 stars"
   would be inventing popularity for a template nobody has rated. The metrics
   that ARE shown — category, node count, difficulty, which services a
   template drives — are read off the template itself.
   ============================================================ */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStudioStore, normalizeWorkflow, resolveAssets, FREE_LIMITS } from '../store';
import { CATEGORIES, type Template } from '../templates';
import { loadTemplates, refreshTemplates, type TemplateSource } from '../templates/loader';
import { getAskPresets } from '../presets';
import { getUpgradeTarget, getProfile } from '../../shared/api';
import { AccountModal, type Account } from './AccountModal';

/** Node-chain preview gets noisy past this many dots */
const MAX_PREVIEW_DOTS = 8;

/** The three things this screen can show. Sub-pills belong to Templates. */
type Section = 'templates' | 'mine' | 'prompts';

const DIFFICULTIES = ['All', 'Easy', 'Medium', 'Advanced'] as const;

/** Which services a template drives, read from its own nodes. */
function platformsOf(tpl: Template): string[] {
  const seen = new Set<string>();
  for (const n of tpl.nodes as any[]) {
    const d = n?.data;
    if (d?.type !== 'generate' && d?.type !== 'extend' && d?.type !== 'agent') continue;
    seen.add(d.type === 'extend' ? 'grok' : (d.platform || 'flow'));
  }
  return [...seen];
}

const PLATFORM_LABEL: Record<string, string> = {
  flow: 'Flow', chatgpt: 'ChatGPT', gemini: 'Gemini', grok: 'Grok',
};

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
    newWorkflow, importWorkflow, saveWorkflow,
  } = useStudioStore();
  const isPro = useStudioStore((s) => s.isPro);
  const runsUsed = useStudioStore((s) => s.runsUsed);
  const workflow = useStudioStore((s) => s.workflow);

  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string>('All');
  const [section, setSection] = useState<Section>('templates');
  const [difficulty, setDifficulty] = useState<string>('All');
  const [account, setAccount] = useState<Account | null>(null);
  const [accountOpen, setAccountOpen] = useState(false);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importOk, setImportOk] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { listWorkflows(); }, [listWorkflows]);

  /* Who is signed in. The footer states a plan and a remaining count, so it
     has to know rather than guess — and the cached profile can be stale. */
  useEffect(() => {
    let live = true;
    getProfile()
      .then((p) => {
        if (live && p) setAccount({ email: p.email, isPro: !!p.is_pro_active });
      })
      .catch(() => { /* signed out is a normal state, not an error */ });
    return () => { live = false; };
  }, []);

  /* One path for both the button and the drop zone. Reports success as well as
     failure: importing now writes to storage, and a silent success is what made
     the old flow feel like nothing had happened. */
  const takeFile = useCallback(
    async (file: File | undefined | null) => {
      if (!file) return;
      setImportError(null);
      setImportOk(null);
      if (!/\.json$/i.test(file.name) && file.type !== 'application/json') {
        setImportError(`"${file.name}" is not a .json workflow file`);
        return;
      }
      try {
        await importWorkflow(file);
        setImportOk(`Imported "${file.name}" — saved to My Workflows`);
      } catch (err: any) {
        setImportError(err?.message || 'Could not import that file');
      }
    },
    [importWorkflow]
  );

  const handleImport = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = ''; // allow re-picking the same file
      await takeFile(file);
    },
    [takeFile]
  );

  /* Drag and drop straight onto the gallery. dragOver must be cancelled or the
     browser navigates to the file instead, which loses the whole panel. */
  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(true);
  }, []);
  const onDragLeave = useCallback((e: React.DragEvent) => {
    // Ignore the flicker from crossing child elements.
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setDragging(false);
  }, []);
  const onDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      await takeFile(e.dataTransfer?.files?.[0]);
    },
    [takeFile]
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
      /* Mint a fresh id BEFORE the nodes land. Opening a template used to keep
         whatever id was already in the store, so autosave would write the
         template over the saved workflow the user had open a moment earlier.
         Same reasoning as startBlank. */
      newWorkflow();
      // Open the canvas immediately; bundled reference images fill in a moment
      // later so a slow asset read never delays the click.
      setNodes(clonedNodes);
      setEdges(clonedEdges);
      setWorkflowName(template.name);
      setView('canvas');

      const withAssets = await resolveAssets(clonedNodes);
      if (withAssets !== clonedNodes) setNodes(withAssets);
      /* Save once the reference images are in, so the stored copy is the whole
         workflow. Until this runs the template is invisible to autosave, which
         only touches workflows it has already seen saved — which is how an
         opened template could vanish on reload. */
      await saveWorkflow();
    },
    [setView, setNodes, setEdges, setWorkflowName, newWorkflow, saveWorkflow]
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
      /* A template chosen in the side panel. The panel cannot mount this tree,
         so it parks an id in storage and asks for the canvas to open; this is
         where that choice is collected. Cleared immediately, or every later
         visit to the gallery would reopen the same template. */
      chrome.storage.local.get('af_pending_template')
        .then(({ af_pending_template: pending }) => {
          if (!live || !pending) return;
          return chrome.storage.local.remove('af_pending_template').then(() => {
            const wanted = t.find((x) => x.id === pending);
            if (wanted) loadTemplate(wanted);
          });
        })
        .catch(() => { /* nothing parked, or storage unavailable */ });

      // Then see if the backend has anything newer, without blocking the above.
      refreshTemplates().then((fresher) => {
        if (!live || !fresher) return;
        setTemplates(fresher.templates);
        setSource(fresher.source);
        console.log(`[Templates] Refreshed to ${fresher.templates.length} from network`);
      });
    });
    return () => { live = false; };
    // loadTemplate is stable via useCallback; listed so the pending pickup
    // cannot call a stale copy of it.
  }, [loadTemplate]);

  /* Search covers the use-case line too — people look for "ad" or
     "consistency", not the template's proper name. */
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return templates.filter((t) => {
      if (category !== 'All' && t.category !== category) return false;
      if (difficulty !== 'All' && t.difficulty !== difficulty) return false;
      if (!q) return true;
      return (
        t.name.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q) ||
        t.useCase.toLowerCase().includes(q) ||
        t.category.toLowerCase().includes(q)
      );
    });
  }, [query, category, difficulty, templates]);

  return (
    <div
      className={`studio-gallery ${dragging ? 'studio-gallery--dropping' : ''}`}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {dragging && (
        <div className="studio-gallery__dropzone">
          <span className="studio-gallery__dropzone-icon">⭱</span>
          <p>Drop a workflow .json to import it</p>
        </div>
      )}
      {/* ── Top bar ── */}
      <div className="sg-top">
        <div className="sg-top__brand">
          <span className="sg-top__logo">⚡</span>
          <span className="sg-top__name">AutoFlow Studio</span>
        </div>
        <div className="sg-top__actions">
          <a
            className="sg-top__icon" title="Documentation"
            href="https://auto-flow.studio/docs" target="_blank" rel="noopener noreferrer"
          >📄</a>
          <a
            className="sg-top__icon" title="auto-flow.studio"
            href="https://auto-flow.studio" target="_blank" rel="noopener noreferrer"
          >🌐</a>
          <button
            className="sg-top__icon"
            title={account ? `Signed in as ${account.email}` : 'Sign in'}
            onClick={() => setAccountOpen(true)}
          >
            {account
              ? <span className="sg-top__avatar">{account.email.charAt(0).toUpperCase()}</span>
              : '👤'}
          </button>
        </div>
      </div>

      {/* ── Session bar: which workflow is open, and how to change it ── */}
      <div className="sg-session">
        <span className="sg-session__mark">✦</span>
        <span className="sg-session__name" title={workflow.name}>{workflow.name}</span>
        {workflow.updatedAt > 0 && (
          <span className="sg-session__time">saved {relativeTime(workflow.updatedAt)}</span>
        )}
        <div className="sg-session__right">
          <button
            className="sg-session__btn nodrag"
            onClick={() => setSwitcherOpen((v) => !v)}
            title="Switch to a saved workflow"
            aria-expanded={switcherOpen}
          >▾</button>
          <button className="sg-session__new" onClick={startBlank} title="New blank workflow">+</button>
          {switcherOpen && (
            <div className="sg-switcher">
              {savedWorkflows.length === 0 && (
                <div className="sg-switcher__empty">Nothing saved yet</div>
              )}
              {savedWorkflows.slice(0, 8).map((w) => (
                <button
                  key={w.id}
                  className="sg-switcher__item"
                  onClick={() => { setSwitcherOpen(false); loadWorkflow(w.id); }}
                >
                  <span className="sg-switcher__item-name">{w.name}</span>
                  <span className="sg-switcher__item-meta">{w.nodeCount} nodes</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Primary navigation ── */}
      <div className="sg-nav">
        {([
          ['templates', '▦', 'Templates'],
          ['mine', '☍', `My Workflows${savedWorkflows.length ? ` (${savedWorkflows.length})` : ''}`],
          ['prompts', '📝', 'Prompts'],
        ] as Array<[Section, string, string]>).map(([id, icon, label]) => (
          <button
            key={id}
            className={`sg-nav__tab ${section === id ? 'sg-nav__tab--on' : ''}`}
            onClick={() => setSection(id)}
          >
            <span className="sg-nav__icon">{icon}</span>{label}
          </button>
        ))}
        <div className="sg-nav__spacer" />
        <button className="sg-nav__act" onClick={() => fileRef.current?.click()} title="Import a workflow .json">
          ⭱ Import
        </button>
        <button className="sg-nav__act sg-nav__act--go" onClick={startBlank}>+ Blank</button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          style={{ display: 'none' }}
          onChange={handleImport}
        />
      </div>

      {importError && <div className="studio-gallery__error">⚠ {importError}</div>}
      {importOk && <div className="studio-gallery__ok">✓ {importOk}</div>}

      {/* ── Sub-pills + filters, for the template grid only ── */}
      {section === 'templates' && (
        <>
          <div className="sg-pills">
            {CATEGORIES.map((cat) => (
              <button
                key={cat}
                className={`sg-pill ${category === cat ? 'sg-pill--on' : ''}`}
                onClick={() => setCategory(cat)}
              >{cat}</button>
            ))}
          </div>

          <div className="sg-filter">
            <input
              className="sg-filter__search"
              placeholder="Search templates — try “ad”, “character”, “b-roll”…"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <select
              className="sg-filter__select"
              value={difficulty}
              onChange={(e) => setDifficulty(e.target.value)}
              title="Filter by difficulty"
            >
              {DIFFICULTIES.map((d) => (
                <option key={d} value={d}>{d === 'All' ? 'All levels' : d}</option>
              ))}
            </select>
          </div>
        </>
      )}

      {/* Saved workflows */}
      {section === 'mine' && (
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
      {section === 'templates' && (
      <div className="studio-gallery__grid sg-grid">
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
                {/* Which tabs this template will want open. Derived from the
                    nodes themselves, so it cannot drift from what runs. */}
                {platformsOf(tpl).map((pf) => (
                  <span key={pf} className={`sg-card__pf sg-card__pf--${pf}`}>
                    {PLATFORM_LABEL[pf] || pf}
                  </span>
                ))}
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

      {/* ── Prompts: the Ask AI briefs, which are real and were unfindable ── */}
      {section === 'prompts' && (
        <div className="sg-prompts">
          <p className="sg-prompts__intro">
            A preset wraps whatever you type in a brief — the angles, the lighting,
            and the trap to avoid. Pick one on any Ask AI node.
          </p>
          {getAskPresets().map((p) => (
            <div key={p.id} className="sg-prompt">
              <div className="sg-prompt__head">
                <span className="sg-prompt__name">{p.name}</span>
                <code className="sg-prompt__id">{p.id}</code>
              </div>
              <p className="sg-prompt__hint">{p.hint}</p>
            </div>
          ))}
        </div>
      )}

      {/* ── Footer: the plan, and what is left of it ── */}
      <div className="sg-foot">
        <span className={`sg-foot__plan ${account?.isPro || isPro ? 'sg-foot__plan--pro' : ''}`}>
          {account?.isPro || isPro ? 'PRO' : 'FREE'}
        </span>
        <button className="sg-foot__acct" onClick={() => setAccountOpen(true)}>
          {account ? account.email : 'Sign in'}
        </button>
        <div className="sg-foot__stats">
          {/* Only the numbers the app actually holds. A Pro account has no
              monthly ceiling, so showing "n/15" against it would be a lie. */}
          {account?.isPro || isPro ? (
            <span className="sg-foot__stat">⚡ Unlimited runs</span>
          ) : (
            <span className="sg-foot__stat" title="Workflow runs used this month">
              ⚡ {runsUsed}/{FREE_LIMITS.runsPerMonth} runs
            </span>
          )}
          <span className="sg-foot__stat" title="Nodes allowed on one canvas">
            ▦ {account?.isPro || isPro ? 'Unlimited' : `${FREE_LIMITS.nodes} nodes`}
          </span>
          <span className="sg-foot__stat sg-foot__stat--src" title={`Templates loaded from ${source}`}>
            {source === 'network' ? '☁ Live' : source === 'cache' ? '☁ Cached' : '⦿ Built in'}
          </span>
        </div>
      </div>

      <AccountModal
        open={accountOpen}
        account={account}
        onClose={() => setAccountOpen(false)}
        onChanged={(a) => {
          setAccount(a);
          // The store drives the canvas's own limit checks, so refresh it too.
          useStudioStore.getState().loadEntitlements();
        }}
      />
    </div>
  );
}
