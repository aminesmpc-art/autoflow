/* ============================================================
   PostComposer — "Post to community".

   Opened from the canvas (the workflow on screen), from the feed's "Share a
   workflow" bar (pick one from My Workflows first), or from the side panel's
   builder (parked in storage). A post is live the moment it is made, so this
   shows exactly what others will see — the title, the caption and the map —
   and says plainly what is left out.
   ============================================================ */

import { useEffect, useMemo, useState } from 'react';
import { useStudioStore, readSavedWorkflow } from '../store';
import MiniMap from './MiniMap';
import Modal from './Modal';
import { postableWorkflow, outlineOf, MAX_POST_BYTES } from './postable';
import { publishPost, type FeedPost, type Me } from './feedApi';

export interface ComposerSource { name: string; nodes: any[]; edges: any[] }

interface Props {
  source: ComposerSource | null;
  me: Me | null;
  onClose: () => void;
  onPosted: (post: FeedPost | null, message: string, displayName: string) => void;
}

const CAPTION_MAX = 1000;

export default function PostComposer({ source: given, me, onClose, onPosted }: Props) {
  const { savedWorkflows, listWorkflows } = useStudioStore();
  const [source, setSource] = useState<ComposerSource | null>(given);
  const [picking, setPicking] = useState<string | null>(null);
  const [title, setTitle] = useState(given?.name || '');
  const [caption, setCaption] = useState('');
  const [name, setName] = useState('');
  const [askName, setAskName] = useState(!me?.displayName);
  const [includePhotos, setIncludePhotos] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');

  useEffect(() => { if (!given) void listWorkflows(); }, [given, listWorkflows]);
  useEffect(() => { setAskName(!me?.displayName); }, [me]);

  const post = useMemo(() => (source
    ? postableWorkflow(title || source.name, source.nodes, source.edges, { includePhotos, description: caption.trim() })
    : null), [source, title, caption, includePhotos]);
  const outline = useMemo(() => (source ? outlineOf(source.nodes, source.edges) : null), [source]);

  const pick = async (id: string) => {
    setPicking(id);
    const wf = await readSavedWorkflow(id);
    setPicking(null);
    if (!wf) { setProblem('That workflow could not be read.'); return; }
    setSource(wf);
    setTitle(wf.name);
    setProblem('');
  };

  const submit = async () => {
    if (!post || !source) return;
    if (title.trim().length < 2) { setProblem('Give your post a title.'); return; }
    if (!source.nodes.length) { setProblem('This workflow is empty — add a step first.'); return; }
    if (askName && (name.trim().length < 2 || name.includes('@'))) {
      setProblem('Choose the name people will see on your posts (at least 2 characters, no @).');
      return;
    }
    if (post.tooBig) { setProblem('This workflow is too big to post. Leave your images out, or post a smaller one.'); return; }
    setBusy(true);
    setProblem('');
    const res = await publishPost({
      template: post.template, name: title.trim(), description: caption.trim(),
      ...(askName ? { displayName: name.trim() } : {}),
    });
    setBusy(false);
    if (res.ok === false) {
      if (res.code === 'display_name_required' || res.code === 'display_name') setAskName(true);
      setProblem(res.message);
      return;
    }
    onPosted(res.post, res.message, askName ? name.trim() : me?.displayName || '');
  };

  if (me && !me.signedIn) {
    return (
      <Modal title="Post to community" onClose={onClose}
        footer={<button className="cf-btn" onClick={onClose}>OK</button>}>
        <p className="cf-muted">Sign in to post. Open the AutoFlow side panel and sign in under Account, then come back here.</p>
      </Modal>
    );
  }
  if (me && !me.canPost) {
    return (
      <Modal title="Post to community" onClose={onClose}
        footer={<button className="cf-btn" onClick={onClose}>OK</button>}>
        <p className="cf-muted">Posting is turned off for this account.</p>
      </Modal>
    );
  }

  if (!source) {
    return (
      <Modal title="Which workflow do you want to share?" onClose={onClose}>
        {savedWorkflows.length === 0 ? (
          <p className="cf-muted">You have no saved workflows yet. Build one on the canvas, then press Post to community there.</p>
        ) : (
          <ul className="cf-pick">
            {savedWorkflows.map((w) => (
              <li key={w.id}>
                <button className="cf-pick__row" onClick={() => pick(w.id)} disabled={!!picking}>
                  <span className="cf-pick__name">{w.name}</span>
                  <span className="cf-pick__meta">{picking === w.id ? 'Opening…' : `${w.nodeCount} steps`}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {problem && <p className="cf-problem" role="alert">{problem}</p>}
      </Modal>
    );
  }

  return (
    <Modal title="Post to community" onClose={onClose} wide
      footer={(
        <>
          <span className="cf-foot-note">Everyone using AutoFlow Studio will see this post.</span>
          <button className="cf-btn cf-btn--ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="cf-btn cf-btn--primary" onClick={submit} disabled={busy || !source.nodes.length}>
            {busy ? 'Posting…' : 'Post'}
          </button>
        </>
      )}>
      <div className="cf-compose">
        <div className="cf-compose__fields">
          {askName && (
            <label className="cf-field">
              <span className="cf-field__label">Your name on posts</span>
              <input className="cf-input" value={name} maxLength={40} placeholder="e.g. Lola Creates"
                onChange={(e) => setName(e.target.value)} />
              <span className="cf-field__hint">Shown on every post you make. Not your email.</span>
            </label>
          )}
          <label className="cf-field">
            <span className="cf-field__label">Title</span>
            <input className="cf-input" value={title} maxLength={120} placeholder="What does this workflow make?"
              onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label className="cf-field">
            <span className="cf-field__label">Caption <span className="cf-field__opt">optional</span></span>
            <textarea className="cf-input cf-input--area" value={caption} maxLength={CAPTION_MAX} rows={5}
              placeholder="How to use it, what to change, what it is good for…"
              onChange={(e) => setCaption(e.target.value)} />
            <span className="cf-field__hint cf-field__hint--end">{caption.length}/{CAPTION_MAX}</span>
          </label>
          {post && post.photos > 0 && (
            <label className="cf-check">
              <input type="checkbox" checked={includePhotos} onChange={(e) => setIncludePhotos(e.target.checked)} />
              <span>
                Include my images ({post.photos})
                <small>Off: people who use this add their own. Your pictures stay on your computer.</small>
              </span>
            </label>
          )}
        </div>
        <div className="cf-compose__preview">
          <span className="cf-field__label">What people will see</span>
          {outline && <MiniMap outline={outline} />}
          <ul className="cf-left-out">
            <li>Only the steps and their settings are posted.</li>
            <li>Results from your runs (videos, images, replies) are not included.</li>
            {post && post.photos > 0 && !includePhotos && (
              <li>{post.photos === 1 ? 'Your image is left out.' : `Your ${post.photos} images are left out.`}</li>
            )}
          </ul>
          {post?.tooBig && (
            <p className="cf-problem">Too big to post ({Math.round(post.bytes / 1000)} KB of {Math.round(MAX_POST_BYTES / 1000)} KB).</p>
          )}
        </div>
      </div>
      {problem && <p className="cf-problem" role="alert">{problem}</p>}
    </Modal>
  );
}
