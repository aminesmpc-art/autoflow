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
 * ── That cost turned out to be too high ──────────────────────────────────
 *
 * A workflow that ran perfectly, reopened the next day, showed eight Cut nodes
 * all saying "the video is not loaded" and nothing to show for a finished run.
 * The paragraph above is still true — a File cannot be serialised into node
 * data — but the conclusion was wrong: the bytes do not have to live only in
 * this tab.
 *
 * ./vault.ts keeps both the clips and the source in IndexedDB, and everything
 * below writes through to it. These Maps are now the fast path in front of
 * that, not the only copy.
 *
 * The File System Access API is still not the answer: its handles need a
 * permission prompt on every reopen, and they give back the SOURCE when what a
 * finished workflow actually needs back is the OUTPUT.
 */

import * as vault from './vault';

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
  /* Written through, not awaited. A drop should feel instant, and a vault
     that cannot write must not stop a run — it only means the next reopen
     asks for the file again, which is exactly what happened before. */
  void vault.saveSource(key, file);
}

export function getSource(key: string): File | undefined {
  return sources.get(key);
}

export const hasSource = (key: string): boolean => sources.has(key);

export function putMedia(key: string, blob: Blob): void {
  media.set(key, blob);
  void vault.saveMedia(key, blob);
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
  void vault.drop(key);
}

/** Everything, for a node that is being deleted or a test that just ran. */
export function forgetAll(): void {
  sources.clear();
  media.clear();
}

/**
 * Put back what previous sessions produced.
 *
 * Called once when Studio opens, before the canvas renders, so a Cut node
 * mounts with its clip already in hand rather than mounting broken and
 * repairing itself a moment later.
 *
 * Anything already in memory WINS. A file dropped in this session is the one
 * the user just chose; a restored copy of the same key is the same bytes at
 * best and a stale namesake at worst.
 */
export async function hydrate(): Promise<{ sources: number; media: number }> {
  const { restore } = await import('./vault');
  const kept = await restore();

  for (const { key, file } of kept.sources) {
    if (!sources.has(key)) sources.set(key, file);
  }
  for (const { key, blob } of kept.media) {
    if (!media.has(key)) media.set(key, blob);
  }
  return { sources: kept.sources.length, media: kept.media.length };
}

/** What is held right now, for the node's report and for leak checks. */
export function held(): { sources: number; media: number; bytes: number } {
  let bytes = 0;
  for (const f of sources.values()) bytes += f.size;
  for (const b of media.values()) bytes += b.size;
  return { sources: sources.size, media: media.size, bytes };
}
