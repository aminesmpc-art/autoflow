/* ============================================================
   CommunityFeed — workflows people posted, "like Facebook" (2026-10-25).

   One column of posts, most liked first (the owner's call, 2026-10-29: this
   is Studio's opening screen now) or newest. Each post: who and when, a
   title and caption, the workflow drawn as a mini
   map (the only picture a post has — the owner chose JSON only), likes and
   uses, and one big "Use this workflow". Posts go live at once; Report is on
   every post that is not yours, Delete on every one that is.
   ============================================================ */

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import MiniMap, { BrandMark, kindOf, platformsOf } from './MiniMap';
import Modal from './Modal';
import PostComposer, { type ComposerSource } from './PostComposer';
import {
  loadFeedPage, toggleLike, reportPost, deletePost, fetchPostWorkflow, loadMe, REPORT_REASONS,
  type FeedPost, type FeedSort, type Me,
} from './feedApi';
import './community.css';

export function ago(iso: string | null): string {
  if (!iso) return '';
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return '';
  const mins = Math.floor((Date.now() - then) / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} d`;
  return new Date(then).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase() || '?';
const hue = (name: string) => [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);

export function Avatar({ name, big }: { name: string; big?: boolean }) {
  return (
    <span className={`cf-avatar ${big ? 'cf-avatar--big' : ''}`} style={{ '--hue': hue(name) } as CSSProperties}
      aria-hidden="true">{initials(name)}</span>
  );
}

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

interface Props {
  /** Opens a workflow on the canvas — the gallery's own loadTemplate. */
  onUse: (template: any) => Promise<void> | void;
  /** A workflow handed over to post (from the side panel's builder). */
  pending?: ComposerSource | null;
  onPendingTaken?: () => void;
  /** Something sits below the feed. Only the first page loads by itself;
      the rest wait for "See more posts". Scrolling would otherwise keep
      fetching pages ahead of the reader, and whatever is underneath could
      not be reached until every post ever made had loaded. */
  stepped?: boolean;
}

export default function CommunityFeed({ onUse, pending, onPendingTaken, stepped }: Props) {
  const [sort, setSort] = useState<FeedSort>('top');
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [next, setNext] = useState<number | null>(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [me, setMe] = useState<Me | null>(null);
  const [composing, setComposing] = useState<{ source: ComposerSource | null } | null>(null);
  const [viewing, setViewing] = useState<FeedPost | null>(null);
  const [reporting, setReporting] = useState<FeedPost | null>(null);
  const [deleting, setDeleting] = useState<FeedPost | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [using, setUsing] = useState<string | null>(null);
  const [toast, setToast] = useState('');
  const sentinel = useRef<HTMLDivElement>(null);
  const busy = useRef(false);
  const round = useRef(0);

  useEffect(() => { void loadMe().then(setMe); }, []);
  useEffect(() => {
    if (!pending) return;
    setComposing({ source: pending });
    onPendingTaken?.();
  }, [pending, onPendingTaken]);
  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(''), 3600);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    if (!menuFor) return undefined;
    const close = () => setMenuFor(null);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [menuFor]);

  /* A new sort is a new feed. The round number lets a page that was already
     on its way for the old sort arrive and be ignored. */
  useEffect(() => {
    round.current += 1;
    busy.current = false;
    setPosts([]); setNext(0); setError(''); setLoading(false);
  }, [sort]);

  const loadMore = useCallback(async () => {
    if (busy.current || next === null) return;
    busy.current = true;
    setLoading(true);
    const mine = round.current;
    const res = await loadFeedPage(sort, next);
    if (mine !== round.current) return;
    busy.current = false;
    setLoading(false);
    if (res.ok === false) { setError(res.message); return; }
    setError('');
    setPosts((prev) => [...prev, ...res.posts.filter((p) => !prev.some((q) => q.id === p.id))]);
    setNext(res.next);
  }, [sort, next]);

  /* Re-made whenever the next offset moves, and an IntersectionObserver
     reports on observe — so a short page with the sentinel still on screen
     asks for the following one without waiting for a scroll. */
  useEffect(() => {
    const el = sentinel.current;
    /* next is 0 only before a sort's first page. */
    if (!el || error || (stepped && next !== 0)) return undefined;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) void loadMore();
    }, { rootMargin: '800px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [loadMore, error, stepped, next]);

  const patch = (id: string, change: Partial<FeedPost>) =>
    setPosts((prev) => prev.map((p) => (p.id === id ? { ...p, ...change } : p)));
  const drop = (id: string) => setPosts((prev) => prev.filter((p) => p.id !== id));

  const like = async (post: FeedPost) => {
    if (!me?.signedIn) { setToast('Sign in to like posts — open the AutoFlow side panel, Account.'); return; }
    patch(post.id, { liked: !post.liked, likes: Math.max(0, post.likes + (post.liked ? -1 : 1)) });
    const res = await toggleLike(post.id);
    if (res.ok) patch(post.id, { liked: res.liked, likes: res.likes });
    else { patch(post.id, { liked: post.liked, likes: post.likes }); setToast(res.message || 'Could not like that post.'); }
    if (viewing?.id === post.id) setViewing((v) => (v ? { ...v, liked: !post.liked } : v));
  };

  const use = async (post: FeedPost) => {
    setUsing(post.id);
    const payload = await fetchPostWorkflow(post.id);
    setUsing(null);
    if (!payload || !Array.isArray(payload.nodes)) { setToast('That workflow could not be opened. It may have been deleted.'); return; }
    patch(post.id, { installs: post.installs + 1 });
    await onUse({
      ...payload,
      id: `community_${Date.now().toString(36)}`,
      name: post.name,
      description: payload.description || post.description,
      category: payload.category || 'Community',
      difficulty: payload.difficulty || 'Medium',
      thumbnail: payload.thumbnail || '🧩',
      useCase: payload.useCase || '',
      nodeCount: payload.nodes.length,
    });
  };

  const openComposer = () => {
    if (me && !me.signedIn) { setToast('Sign in to post — open the AutoFlow side panel, Account.'); return; }
    setComposing({ source: null });
  };

  return (
    <div className={`cf ${stepped ? 'cf--stepped' : ''}`}>
      <div className="cf-col">
        {/* Share bar — the "What's on your mind?" of this feed */}
        <div className="cf-card cf-share">
          <Avatar name={me?.displayName || (me?.signedIn ? 'You' : '?')} />
          <button className="cf-share__ask" onClick={openComposer}>
            {me?.signedIn === false ? 'Sign in to share your workflows' : 'Share a workflow with the community…'}
          </button>
          <button className="cf-btn cf-btn--primary" onClick={openComposer}>Post</button>
        </div>

        <div className="cf-sort" role="tablist" aria-label="Sort posts">
          {([['top', 'Popular'], ['new', 'New']] as [FeedSort, string][]).map(([key, label]) => (
            <button key={key} role="tab" aria-selected={sort === key}
              className={`cf-sort__tab ${sort === key ? 'cf-sort__tab--on' : ''}`} onClick={() => setSort(key)}>
              {label}
            </button>
          ))}
        </div>

        {posts.map((post) => (
          <article key={post.id} className="cf-card cf-post">
            <header className="cf-post__head">
              <Avatar name={post.author} />
              <div className="cf-post__who">
                <span className="cf-post__author">{post.author}{post.mine && <span className="cf-you">You</span>}</span>
                <span className="cf-post__when">{ago(post.createdAt)} · {plural(post.nodeCount, 'step')}</span>
              </div>
              <div className="cf-menu">
                <button className="cf-icon-btn" aria-label="More" aria-haspopup="menu"
                  onClick={(e) => { e.stopPropagation(); setMenuFor(menuFor === post.id ? null : post.id); }}>⋯</button>
                {menuFor === post.id && (
                  <div className="cf-menu__list" role="menu">
                    {post.mine
                      ? <button role="menuitem" className="cf-menu__item cf-menu__item--bad" onClick={() => setDeleting(post)}>Delete post</button>
                      : <button role="menuitem" className="cf-menu__item" onClick={() => {
                        if (!me?.signedIn) { setToast('Sign in to report a post.'); return; }
                        setReporting(post);
                      }}>Report post</button>}
                  </div>
                )}
              </div>
            </header>

            <h3 className="cf-post__title">{post.name}</h3>
            {post.description && <Caption text={post.description} />}

            <button className="cf-post__map" onClick={() => setViewing(post)} aria-label={`See the steps of ${post.name}`}>
              <MiniMap outline={post.outline} />
              <span className="cf-post__map-cta">See the steps</span>
            </button>

            <div className="cf-post__stats">
              <span className="cf-post__brands">
                {platformsOf(post.outline).map((p) => <BrandMark key={p} name={p} className="cf-brand" />)}
              </span>
              <span>{post.likes > 0 && <>❤ {post.likes.toLocaleString()} · </>}{plural(post.installs, 'use')}</span>
            </div>

            <div className="cf-post__actions">
              <button className={`cf-action ${post.liked ? 'cf-action--liked' : ''}`} onClick={() => like(post)}
                aria-pressed={post.liked}>
                {post.liked ? '❤' : '♡'} {post.liked ? 'Liked' : 'Like'}
              </button>
              <button className="cf-action cf-action--use" onClick={() => use(post)} disabled={using === post.id}>
                {using === post.id ? 'Opening…' : 'Use this workflow'}
              </button>
            </div>
          </article>
        ))}

        {loading && [0, 1].map((i) => <div key={i} className="cf-card cf-post cf-skeleton" aria-hidden="true" />)}

        {error && (
          <div className="cf-card cf-note">
            <p>{error}</p>
            <button className="cf-btn" onClick={() => { setError(''); void loadMore(); }}>Try again</button>
          </div>
        )}

        {!loading && !error && next === null && posts.length === 0 && (
          <div className="cf-card cf-note">
            <p className="cf-note__big">No posts yet</p>
            <p className="cf-muted">Be the first: share a workflow you made, and others can use it in one click.</p>
            <button className="cf-btn cf-btn--primary" onClick={openComposer}>Share a workflow</button>
          </div>
        )}
        {!loading && !error && next === null && posts.length > 0 && (
          <p className="cf-end">You're all caught up.</p>
        )}
        {stepped && !loading && !error && next !== null && posts.length > 0 && (
          <button className="cf-btn cf-more-posts" onClick={() => void loadMore()}>See more posts</button>
        )}
        <div ref={sentinel} className="cf-sentinel" />
      </div>

      {composing && (
        <PostComposer source={composing.source} me={me} onClose={() => setComposing(null)}
          onPosted={(post, message, displayName) => {
            setComposing(null);
            setToast(message);
            if (displayName && me) setMe({ ...me, displayName });
            if (post) {
              if (sort === 'new') setPosts((prev) => [post, ...prev.filter((p) => p.id !== post.id)]);
              else setSort('new');
            }
          }} />
      )}

      {viewing && (
        <Modal title={viewing.name} wide onClose={() => setViewing(null)}
          footer={(
            <>
              <button className={`cf-btn ${viewing.liked ? 'cf-btn--liked' : 'cf-btn--ghost'}`}
                onClick={() => like(viewing)}>{viewing.liked ? '❤ Liked' : '♡ Like'}</button>
              <button className="cf-btn cf-btn--primary" disabled={using === viewing.id}
                onClick={() => { const p = viewing; setViewing(null); void use(p); }}>Use this workflow</button>
            </>
          )}>
          <div className="cf-view">
            <div className="cf-post__head">
              <Avatar name={viewing.author} />
              <div className="cf-post__who">
                <span className="cf-post__author">{viewing.author}</span>
                <span className="cf-post__when">{ago(viewing.createdAt)} · {plural(viewing.installs, 'use')}</span>
              </div>
            </div>
            {viewing.description && <p className="cf-view__caption">{viewing.description}</p>}
            <MiniMap outline={viewing.outline} size="large" />
            <ol className="cf-steps">
              {[...viewing.outline.nodes].sort((a, b) => a.x - b.x || a.y - b.y).map((n, i) => {
                const kind = kindOf(n);
                return (
                  <li key={i} className="cf-step" style={{ '--kind': kind.color } as CSSProperties}>
                    <span className="cf-step__kind">{kind.name}</span>
                    <span className="cf-step__label">{n.label || kind.name}</span>
                    {n.platform && <BrandMark name={n.platform} className="cf-brand" />}
                  </li>
                );
              })}
            </ol>
          </div>
        </Modal>
      )}

      {reporting && (
        <ReportDialog post={reporting} onClose={() => setReporting(null)}
          onDone={(message) => { drop(reporting.id); setReporting(null); setToast(message); }} />
      )}

      {deleting && (
        <Modal title="Delete this post?" onClose={() => setDeleting(null)}
          footer={(
            <>
              <button className="cf-btn cf-btn--ghost" onClick={() => setDeleting(null)}>Cancel</button>
              <button className="cf-btn cf-btn--bad" onClick={async () => {
                const target = deleting;
                const res = await deletePost(target.id);
                setDeleting(null);
                if (res.ok) drop(target.id);
                setToast(res.ok ? 'Post deleted.' : res.message);
              }}>Delete</button>
            </>
          )}>
          <p className="cf-muted">"{deleting.name}" leaves the feed for everyone. People who already used it keep their copy.</p>
        </Modal>
      )}

      {toast && <div className="cf-toast" role="status">{toast}</div>}
    </div>
  );
}

function Caption({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > 220 || text.split('\n').length > 3;
  return (
    <p className={`cf-post__caption ${long && !open ? 'cf-post__caption--clamped' : ''}`}>
      {text}
      {long && !open && <button className="cf-more" onClick={() => setOpen(true)}>See more</button>}
    </p>
  );
}

function ReportDialog({ post, onClose, onDone }: { post: FeedPost; onClose: () => void; onDone: (m: string) => void }) {
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const send = async () => {
    if (!reason) { setProblem('Choose a reason.'); return; }
    setBusy(true);
    const res = await reportPost(post.id, reason, note.trim());
    setBusy(false);
    if (!res.ok) { setProblem(res.message); return; }
    onDone(`${res.message} You won't see this post here any more.`);
  };
  return (
    <Modal title="Report this post" onClose={onClose}
      footer={(
        <>
          <button className="cf-btn cf-btn--ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="cf-btn cf-btn--bad" onClick={send} disabled={busy}>{busy ? 'Sending…' : 'Report'}</button>
        </>
      )}>
      <p className="cf-muted">What is wrong with "{post.name}"? Posts reported by several people are hidden until we review them.</p>
      <div className="cf-reasons" role="radiogroup" aria-label="Reason">
        {REPORT_REASONS.map((r) => (
          <label key={r.value} className={`cf-reason ${reason === r.value ? 'cf-reason--on' : ''}`}>
            <input type="radio" name="reason" value={r.value} checked={reason === r.value}
              onChange={() => setReason(r.value)} />
            {r.label}
          </label>
        ))}
      </div>
      <label className="cf-field">
        <span className="cf-field__label">Anything else? <span className="cf-field__opt">optional</span></span>
        <textarea className="cf-input cf-input--area" rows={3} maxLength={300} value={note}
          onChange={(e) => setNote(e.target.value)} />
      </label>
      {problem && <p className="cf-problem" role="alert">{problem}</p>}
    </Modal>
  );
}
