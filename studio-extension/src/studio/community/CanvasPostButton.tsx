/* "Post" on the canvas toolbar: the workflow on screen, straight into the
   post form, and a way to go and see it in the feed afterwards. */

import { useState } from 'react';
import { useStudioStore } from '../store';
import PostComposer from './PostComposer';
import { loadMe, type Me } from './feedApi';
import './community.css';

export default function CanvasPostButton() {
  const { nodes, edges, workflow, setView } = useStudioStore();
  const [me, setMe] = useState<Me | null>(null);
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState('');

  const start = async () => {
    setDone('');
    setOpen(true);
    setMe(await loadMe());
  };

  return (
    <>
      <button className="studio-topbar__post" onClick={start} disabled={nodes.length === 0}
        title="Post this workflow to the Community feed">
        Post
      </button>
      {open && me && (
        <PostComposer
          source={{ name: workflow.name || 'Untitled', nodes, edges }}
          me={me}
          onClose={() => setOpen(false)}
          onPosted={(_post, message) => { setOpen(false); setDone(message); }}
        />
      )}
      {done && (
        <div className="cf-toast cf-toast--action" role="status">
          {done}
          <button className="cf-btn cf-btn--ghost" onClick={async () => {
            setDone('');
            await chrome.storage.local.set({ af_open_community: true });
            setView('gallery');
          }}>View in Community</button>
          <button className="cf-icon-btn" aria-label="Dismiss" onClick={() => setDone('')}>✕</button>
        </div>
      )}
    </>
  );
}
