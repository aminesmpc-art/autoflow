/* ============================================================
   The community feed's calls to the backend (apps/workflows/community_views).

   Kept beside the feed rather than in shared/api.ts: only Studio's Community
   page uses them, and shared/api.ts is bundled into every surface. Each one
   returns a result instead of throwing — a feed that cannot reach AutoFlow
   says so in place, it does not take the page down.
   ============================================================ */

import { apiFetch, isLoggedIn } from '../../shared/api';

export interface OutlineNode { type: string; label: string; platform: string; media: string; x: number; y: number }
export interface Outline { nodes: OutlineNode[]; edges: [number, number][] }

export interface FeedPost {
  id: string;
  name: string;
  description: string;
  author: string;
  likes: number;
  installs: number;
  liked: boolean;
  mine: boolean;
  nodeCount: number;
  createdAt: string | null;
  outline: Outline;
}

export type FeedSort = 'new' | 'top';
export const PAGE_SIZE = 12;

const numeric = (id: string) => String(id).replace(/^community_/, '');

async function detailOf(res: Response, fallback: string): Promise<{ message: string; code?: string }> {
  const data = await res.json().catch(() => ({} as any));
  return { message: typeof data?.detail === 'string' ? data.detail : fallback, code: data?.code };
}

/** One page of the feed. `next` is the offset of the following page, or null at the end. */
export async function loadFeedPage(sort: FeedSort, offset: number):
  Promise<{ ok: true; posts: FeedPost[]; next: number | null } | { ok: false; message: string }> {
  try {
    const res = await apiFetch(`/api/templates/community?sort=${sort}&offset=${offset}&limit=${PAGE_SIZE}`);
    if (!res.ok) return { ok: false, message: 'Could not load the community right now.' };
    const data = await res.json();
    const posts: FeedPost[] = (Array.isArray(data?.templates) ? data.templates : []).map((c: any) => ({
      id: String(c.id), name: String(c.name || 'Untitled'), description: String(c.description || ''),
      author: String(c.author || 'Someone'), likes: Number(c.likes) || 0, installs: Number(c.installs) || 0,
      liked: !!c.liked, mine: !!c.mine, nodeCount: Number(c.nodeCount) || 0,
      createdAt: c.createdAt || null,
      outline: c.outline && Array.isArray(c.outline.nodes) ? c.outline : { nodes: [], edges: [] },
    }));
    return { ok: true, posts, next: typeof data?.next === 'number' ? data.next : null };
  } catch {
    return { ok: false, message: 'Could not reach AutoFlow. Check your connection.' };
  }
}

/** The workflow itself, to open on the canvas. Opening is what counts as a use. */
export async function fetchPostWorkflow(id: string): Promise<any | null> {
  try {
    const res = await apiFetch(`/api/templates/community/${numeric(id)}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data?.payload || null;
  } catch {
    return null;
  }
}

export async function toggleLike(id: string): Promise<{ ok: boolean; liked?: boolean; likes?: number; message?: string }> {
  try {
    const res = await apiFetch(`/api/templates/community/${numeric(id)}/like`, { method: 'POST' });
    if (res.status === 401) return { ok: false, message: 'Sign in to like posts.' };
    if (!res.ok) return { ok: false, ...(await detailOf(res, 'Could not like that post.')) };
    const data = await res.json();
    return { ok: true, liked: !!data.liked, likes: Number(data.likes) || 0 };
  } catch {
    return { ok: false, message: 'Could not reach AutoFlow.' };
  }
}

export const REPORT_REASONS: { value: string; label: string }[] = [
  { value: 'sexual', label: 'Sexual content' },
  { value: 'violence', label: 'Violence or hate' },
  { value: 'spam', label: 'Spam or scam' },
  { value: 'stolen', label: 'Stolen work' },
  { value: 'other', label: 'Something else' },
];

export async function reportPost(id: string, reason: string, note: string): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await apiFetch(`/api/templates/community/${numeric(id)}/report`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason, note }),
    });
    if (res.status === 401) return { ok: false, message: 'Sign in to report a post.' };
    const { message } = await detailOf(res, res.ok ? 'Thanks. We will take a look.' : 'Could not send that report.');
    return { ok: res.ok, message };
  } catch {
    return { ok: false, message: 'Could not reach AutoFlow.' };
  }
}

export async function deletePost(id: string): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await apiFetch(`/api/templates/community/${numeric(id)}`, { method: 'DELETE' });
    if (res.ok) return { ok: true, message: 'Deleted.' };
    return { ok: false, ...(await detailOf(res, 'Could not delete that post.')) };
  } catch {
    return { ok: false, message: 'Could not reach AutoFlow.' };
  }
}

export interface Me { signedIn: boolean; displayName: string; canPost: boolean }

export async function loadMe(): Promise<Me> {
  if (!(await isLoggedIn().catch(() => false))) return { signedIn: false, displayName: '', canPost: false };
  try {
    const res = await apiFetch('/api/templates/community/me');
    if (res.status === 401) return { signedIn: false, displayName: '', canPost: false };
    if (!res.ok) return { signedIn: true, displayName: '', canPost: true };
    const data = await res.json();
    return { signedIn: true, displayName: String(data?.displayName || ''), canPost: data?.canPost !== false };
  } catch {
    return { signedIn: true, displayName: '', canPost: true };
  }
}

export async function publishPost(input: { template: any; name: string; description: string; displayName?: string }):
  Promise<{ ok: true; post: FeedPost | null; message: string } | { ok: false; message: string; code?: string }> {
  try {
    const res = await apiFetch('/api/templates/community/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        template: input.template, name: input.name, description: input.description,
        ...(input.displayName !== undefined ? { display_name: input.displayName } : {}),
      }),
    });
    if (res.status === 401) return { ok: false, message: 'Sign in to post.' };
    if (!res.ok) return { ok: false, ...(await detailOf(res, 'Could not post that workflow.')) };
    const data = await res.json();
    const c = data?.card;
    return {
      ok: true,
      message: data?.detail || 'Posted.',
      post: c ? {
        id: String(c.id), name: c.name, description: c.description || '', author: c.author || 'You',
        likes: 0, installs: 0, liked: false, mine: true, nodeCount: Number(c.nodeCount) || 0,
        createdAt: c.createdAt || new Date().toISOString(), outline: c.outline || { nodes: [], edges: [] },
      } : null,
    };
  } catch {
    return { ok: false, message: 'Could not reach AutoFlow. Check your connection.' };
  }
}
