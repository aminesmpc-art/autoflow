/**
 * Where the dropped video actually lives.
 *
 * Node data is serialised — saved, exported as JSON, round-tripped through
 * the template format. A File cannot survive that, and a two-gigabyte podcast
 * should not try. So node data holds only a KEY, and the bytes live here, in
 * memory, for as long as the tab does.
 *
 * ── What that costs, stated plainly ───────────────────────────────────────
 *
 * Reopening Studio loses the bytes but keeps the run: the transcript, the
 * chosen moment and the beat map are all node data and all survive. Only the
 * stages that need to read the video again — cutting, mainly — need the file
 * back, and the fix is to drop it on the node once more.
 *
 * The alternative is the File System Access API, whose handles CAN be stored
 * in IndexedDB and re-permissioned later. That is the right answer eventually.
 * It is not the right answer first, because it needs a permission prompt on
 * every reopen and a fallback for when the user says no — which is this, so
 * this has to exist either way.
 */

/** Source videos, by the key held in node data. */
const sources = new Map<string, File>();

/** Produced media — cut clips, extracted audio — by an arbitrary key. */
const media = new Map<string, Blob>();

/**
 * A key that changes when the file does.
 *
 * Name, size and modified time rather than a hash of the contents: hashing
 * twenty minutes of video to notice a different file would read the whole
 * thing, which is the one thing this pipeline is built to avoid. The failure
 * mode of this cheaper key is a false MATCH — same name, same size, same
 * mtime, different content — which requires deliberate effort to produce.
 */
export function sourceKeyFor(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified || 0}`;
}

export function putSource(key: string, file: File): void {
  sources.set(key, file);
}

export function getSource(key: string): File | undefined {
  return sources.get(key);
}

export const hasSource = (key: string): boolean => sources.has(key);

export function putMedia(key: string, blob: Blob): void {
  media.set(key, blob);
}

export function getMedia(key: string): Blob | undefined {
  return media.get(key);
}

/**
 * Drop everything belonging to a source.
 *
 * Called when a node is removed or its file replaced. Without it a session
 * that works through five episodes holds five episodes, and the tab is the
 * same renderer process that has to decode the sixth.
 */
export function forget(key: string): void {
  sources.delete(key);
  for (const k of [...media.keys()]) {
    if (k === key || k.startsWith(`${key}#`)) media.delete(k);
  }
}

/** Everything, for a node that is being deleted or a test that just ran. */
export function forgetAll(): void {
  sources.clear();
  media.clear();
}

/** What is held right now, for the node's report and for leak checks. */
export function held(): { sources: number; media: number; bytes: number } {
  let bytes = 0;
  for (const f of sources.values()) bytes += f.size;
  for (const b of media.values()) bytes += b.size;
  return { sources: sources.size, media: media.size, bytes };
}
