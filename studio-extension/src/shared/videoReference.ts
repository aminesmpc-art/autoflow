/**
 * A clip wired into another clip's V input: what it becomes on Flow.
 *
 * "You can't attach one video to another (which is core functionality)" —
 * a 1-star review, 19 Oct 2026. Until this, a clip wired into a clip arrived
 * as its last frame only, and nothing said so.
 *
 * Flow's Omni models take a whole video as an ingredient (up to five images
 * and one video, measured). A clip Flow generated is already in the
 * project's library, so it can be put on the next prompt from the picker
 * without any upload — the route the Motion node already drives through
 * `styleReference`. This module decides, once, for both the canvas runner
 * and the service-worker coordinator:
 *
 *   on Omni, with the clip identifiable   → the clip itself, from the library
 *   otherwise, with a captured last frame → that frame, as an image reference,
 *                                            with the reason said on the node
 *   neither                               → an error, before anything is spent
 *
 * The library row is found by the clip's `/asb/` token, the one name a Flow
 * video carries. Measured on flow.google.com 2026-10-25: a video's row in the
 * composer's picker shows the same `/asb/<TOKEN>` thumbnail as its tile in
 * the grid (3 of 3 on-screen clips matched), so the token identifies the row
 * exactly even when two takes share a prompt. The prompt text, which the
 * picker lists the clip under, narrows the search and is the fallback when
 * only an API media id is known (that id space does not convert to tokens).
 */

export const CLIP_REF_PREFIX = 'clip:';

export interface ClipRef {
  /** The clip's /asb/ token, or '' when only a media id was known. */
  token: string;
  /** The prompt it was generated from: what the picker lists it under. */
  title: string;
}

/** Carried in `styleReference`, which already reaches the Flow adapter. */
export function encodeClipRef(ref: ClipRef): string {
  return CLIP_REF_PREFIX + JSON.stringify({ token: ref.token || '', title: ref.title || '' });
}

export function decodeClipRef(value: unknown): ClipRef | null {
  const s = typeof value === 'string' ? value : '';
  if (!s.startsWith(CLIP_REF_PREFIX)) return null;
  try {
    const v = JSON.parse(s.slice(CLIP_REF_PREFIX.length));
    const ref = { token: String(v?.token || ''), title: String(v?.title || '') };
    return ref.token || ref.title ? ref : null;
  } catch {
    return null;
  }
}

/** The /asb/ token in a Flow media URL, rendition suffix and query dropped. */
export function asbToken(url: unknown): string {
  const m = String(url || '').match(/\/asb\/([^/?#=]+)/);
  return m ? m[1] : '';
}

/**
 * A tile id that is an /asb/ token. flowTileIdentity names a video tile by
 * the token in its thumbnail, or by the uuid in a /video/<uuid> URL — the
 * other id space, which says nothing about the picker row.
 */
export function tileToken(tileId: unknown): string {
  const id = String(tileId || '');
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return '';
  return /^[A-Za-z0-9_-]{16,}$/.test(id) ? id : '';
}

/** Omni 1.1 Flash and Omni Flash take a video ingredient; Veo does not. */
export const takesVideoReference = (model: unknown): boolean => /\bomni\b/i.test(String(model || ''));

/** What is known about the clip upstream, from its result and its node. */
export interface UpstreamClip {
  /** flowTileIdentity's name for the tile: the bare token, for a video. */
  tileId?: string;
  thumbnailUrl?: string;
  imageUrl?: string;
  videoUrl?: string;
  /** The node's saved result, for a clip that ran in an earlier pass. */
  resultUrl?: string;
  /** Its captured last frame, as a data URL. */
  referenceUrl?: string;
  /** The prompt it was sent with. */
  sentPrompt?: string;
}

export type VideoReference =
  | { kind: 'clip'; styleReference: string; note: string }
  | { kind: 'frame'; frame: string; note: string }
  | { kind: 'none'; error: string };

/** A short, readable form of a prompt for messages. */
const shorten = (s: string, n = 48) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** A clip reference's name, unquoted: its prompt, shortened. Never the raw JSON. */
export const clipName = (ref: ClipRef): string => (ref.title ? shorten(ref.title) : 'wired clip');

/** How a clip reference reads in a log line or an error. */
export const clipLabel = (ref: ClipRef): string => (ref.title ? `"${clipName(ref)}"` : 'the wired clip');

/** What `styleReference` names, readably — a library filename or a wired clip. */
export function describeLibraryVideo(value: string): string {
  const clip = decodeClipRef(value);
  return clip ? `the clip ${clipLabel(clip)}` : `"${value}"`;
}

export function videoReferenceFor(up: UpstreamClip | undefined, model: unknown): VideoReference {
  if (!up) {
    return { kind: 'none', error: 'The clip wired into V has not run yet — run it first, or run the whole workflow' };
  }
  const token = asbToken(up.thumbnailUrl) || asbToken(up.imageUrl)
    || asbToken(up.videoUrl) || asbToken(up.resultUrl) || tileToken(up.tileId);
  const title = String(up.sentPrompt || '').replace(/\s+/g, ' ').trim();
  const frame = typeof up.referenceUrl === 'string' && up.referenceUrl.startsWith('data:') ? up.referenceUrl : '';

  if (takesVideoReference(model) && (token || title)) {
    return {
      kind: 'clip',
      styleReference: encodeClipRef({ token, title }),
      note: title
        ? `V: "${shorten(title)}" goes on the prompt as a video reference.`
        : 'V: the clip goes on the prompt as a video reference.',
    };
  }
  if (frame) {
    return {
      kind: 'frame',
      frame,
      note: takesVideoReference(model)
        ? 'V: that clip could not be identified in the Flow library, so this continues from its last frame.'
        : `V: ${String(model || 'This model')} cannot take a video, so this continues from the clip's last frame. Switch to Omni 1.1 Flash to use the whole clip.`,
    };
  }
  return {
    kind: 'none',
    error: 'The clip wired into V gave up nothing to use — no library entry and no last frame. Re-run it, then this node.',
  };
}
