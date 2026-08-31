/**
 * Keeping the cuts across a reopen.
 *
 * ── The bug this fixes ────────────────────────────────────────────────────
 *
 * A workflow that ran perfectly, reopened the next day, showed eight Cut nodes
 * all saying the same thing: "The video is not loaded. Drop it on the Clipping
 * node again — the cut keeps its lines, only the bytes are gone." Eight
 * failures, a Retry button, and nothing to show for a run that had already
 * finished. The clips existed. They were in a Map in a tab that had been
 * closed.
 *
 * sourceStore was honest about this from the start — its own header called the
 * File System Access API "the right answer eventually". This is the answer that
 * arrived first, and it turns out to be better for the case that actually hurt:
 * a handle would still need a permission prompt per reopen and would only give
 * back the SOURCE, whereas what a finished workflow needs back is the OUTPUT.
 *
 * ── What is kept, and why both ────────────────────────────────────────────
 *
 * The clips, always. They are the product, they are small next to the source,
 * and with them a reopened workflow needs no run at all — it simply shows what
 * it made.
 *
 * The source too, under a budget. Without it a Cut node cannot be re-run,
 * re-cut with different lines, or extended — and re-dropping a 350MB file to
 * change one clip is the workflow this whole pipeline exists to remove.
 *
 * ── Budgeted, not unlimited ───────────────────────────────────────────────
 *
 * The extension holds `unlimitedStorage`, which means nothing stops this
 * filling a disk. So it evicts: oldest first, sources before clips, until the
 * total is under budget. A clipper working through a series of podcasts should
 * not discover in a month that AutoFlow is holding forty of them.
 */

const DB_NAME = 'af_clip_vault';
const DB_VERSION = 1;
const STORE = 'blobs';

/* The most the vault may hold, before the browser's own limit is considered.
   Generous enough for a working week of clips and the couple of sources being
   worked on, small enough that nobody finds it by running out of disk. */
const BUDGET_CEILING = 3 * 1024 * 1024 * 1024;

/* And never more than this share of what the browser will actually grant.
   Measured rather than assumed: navigator.storage.estimate() reported a 3GB
   quota on the harness origin, which is exactly what the ceiling above used to
   be — so the vault would have tried to fill the entire allowance and met
   QuotaExceededError at the worst possible moment, halfway through keeping a
   run that had just succeeded. */
const QUOTA_SHARE = 0.5;

async function budget(): Promise<number> {
  try {
    const estimate = await navigator?.storage?.estimate?.();
    const quota = Number(estimate?.quota) || 0;
    if (quota > 0) return Math.min(BUDGET_CEILING, Math.floor(quota * QUOTA_SHARE));
  } catch {
    /* no estimate available — fall back to the fixed ceiling */
  }
  return BUDGET_CEILING;
}

/* A single source larger than this is not kept. A four gigabyte camera master
   would evict everything else on its way in, to serve one workflow. */
const MAX_SOURCE_BYTES = 1024 * 1024 * 1024;

export type VaultKind = 'media' | 'source';

export interface VaultRecord {
  key: string;
  kind: VaultKind;
  blob: Blob;
  size: number;
  savedAt: number;
  /** Sources only — enough to rebuild a File with the same identity. */
  name?: string;
  lastModified?: number;
  type?: string;
}

/**
 * Whether this build can persist at all.
 *
 * Jest runs in Node with no indexedDB, and the studio harness runs in a page
 * that has one. Everything below no-ops rather than throwing when it is
 * missing, because losing persistence must never break cutting — that is the
 * behaviour this replaces, and it has to remain the fallback.
 */
export const canPersist = (): boolean =>
  typeof indexedDB !== 'undefined' && indexedDB !== null;

let connection: IDBDatabase | null = null;

/* Strictly increasing, even when the clock is not.
   Eviction orders by savedAt, and Date.now() has millisecond resolution — so
   eight clips written back to back share a timestamp and their order becomes
   whatever getAll happened to return. Found by the eviction test passing on its
   own and failing in the full suite, where the machine is warm enough to write
   three records inside one millisecond and evict the NEWEST. */
let lastStamp = 0;

function stamp(): number {
  lastStamp = Math.max(Date.now(), lastStamp + 1);
  return lastStamp;
}

function open(): Promise<IDBDatabase> {
  if (connection) return Promise.resolve(connection);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'key' });
        /* Eviction walks oldest-first, so it needs an index rather than a
           full read of every blob in the vault to decide what to drop. */
        store.createIndex('savedAt', 'savedAt');
      }
    };
    request.onsuccess = () => {
      connection = request.result;
      connection.onclose = () => { connection = null; };
      resolve(connection);
    };
    request.onerror = () => reject(request.error);
  });
}

function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then((db) => new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const request = work(tx.objectStore(STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    tx.onabort = () => reject(tx.error);
  }));
}

/** Everything held, newest first, without reading the blobs back. */
export async function list(): Promise<Array<Omit<VaultRecord, 'blob'>>> {
  if (!canPersist()) return [];
  const all = await run<VaultRecord[]>('readonly', (s) => s.getAll() as IDBRequest<VaultRecord[]>);
  return all
    .map(({ blob, ...rest }) => rest)
    .sort((a, b) => b.savedAt - a.savedAt);
}

async function put(record: VaultRecord): Promise<void> {
  await run('readwrite', (s) => s.put(record) as IDBRequest<any>);
}

/**
 * Bring the total back under budget.
 *
 * Sources go before clips at the same age, because a source can be dropped in
 * again and a clip cannot be remade without one. Within a kind it is oldest
 * first.
 */
async function sweep(limit?: number): Promise<void> {
  const cap = limit ?? (await budget());
  const held = await list();
  let total = held.reduce((sum, r) => sum + (r.size || 0), 0);
  if (total <= cap) return;

  const order = [...held].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'source' ? -1 : 1;
    return a.savedAt - b.savedAt;
  });

  for (const record of order) {
    if (total <= cap) break;
    await run('readwrite', (s) => s.delete(record.key) as IDBRequest<any>);
    total -= record.size || 0;
  }
}

/**
 * Write, and if the browser says there is no room, make some and try once more.
 *
 * A quota refusal is the one failure worth retrying rather than shrugging at:
 * it means the vault itself is full, which is a condition it can fix, and the
 * thing being dropped on the floor is a clip that has just been made and
 * cannot be remade without another run.
 */
async function putWithRoom(record: VaultRecord): Promise<void> {
  try {
    await put(record);
  } catch (error) {
    const name = (error as { name?: string })?.name || '';
    if (name !== 'QuotaExceededError') throw error;
    /* Half of what is allowed, to leave headroom rather than land exactly on
       the line and fail again on the next clip. */
    await sweep(Math.floor((await budget()) / 2));
    await put(record);
  }
}

/** Keep a finished clip. Never throws — persistence is an improvement. */
export async function saveMedia(key: string, blob: Blob): Promise<void> {
  if (!canPersist()) return;
  try {
    await putWithRoom({
      key: `media:${key}`, kind: 'media', blob, size: blob.size,
      savedAt: stamp(), type: blob.type,
    });
    await sweep();
  } catch (error) {
    console.warn('[AutoFlow] Could not keep the clip for next time:', error);
  }
}

/** Keep a source video, if it is not absurdly large. */
export async function saveSource(key: string, file: File): Promise<void> {
  if (!canPersist()) return;
  if (file.size > MAX_SOURCE_BYTES) {
    console.log('[AutoFlow] Source too large to keep; it will need dropping again next time');
    return;
  }
  try {
    await putWithRoom({
      key: `source:${key}`,
      kind: 'source',
      blob: file,
      size: file.size,
      savedAt: stamp(),
      name: file.name,
      lastModified: file.lastModified,
      type: file.type,
    });
    await sweep();
  } catch (error) {
    console.warn('[AutoFlow] Could not keep the video for next time:', error);
  }
}

export interface Restored {
  media: Array<{ key: string; blob: Blob }>;
  sources: Array<{ key: string; file: File }>;
}

/**
 * Everything from previous sessions, ready to be put back in the maps.
 *
 * Sources come back as Files rather than Blobs. The pipeline probes `name` to
 * choose a demuxer and keys off name, size and modified time, so a Blob would
 * be a different file by the only definition that matters here.
 */
export async function restore(): Promise<Restored> {
  const out: Restored = { media: [], sources: [] };
  if (!canPersist()) return out;

  let all: VaultRecord[];
  try {
    all = await run<VaultRecord[]>('readonly', (s) => s.getAll() as IDBRequest<VaultRecord[]>);
  } catch (error) {
    console.warn('[AutoFlow] Could not read what was kept:', error);
    return out;
  }

  for (const record of all) {
    if (!record?.blob) continue;
    if (record.kind === 'media' && record.key.startsWith('media:')) {
      out.media.push({ key: record.key.slice('media:'.length), blob: record.blob });
    } else if (record.kind === 'source' && record.key.startsWith('source:')) {
      out.sources.push({
        key: record.key.slice('source:'.length),
        file: new File([record.blob], record.name || 'video.mp4', {
          type: record.type || record.blob.type || 'video/mp4',
          lastModified: record.lastModified || 0,
        }),
      });
    }
  }
  return out;
}

/** Drop a source and everything cut from it. */
export async function drop(sourceKey: string): Promise<void> {
  if (!canPersist()) return;
  try {
    const held = await list();
    for (const record of held) {
      const bare = record.key.replace(/^(media|source):/, '');
      if (bare === sourceKey || bare.startsWith(`${sourceKey}#`)) {
        await run('readwrite', (s) => s.delete(record.key) as IDBRequest<any>);
      }
    }
  } catch (error) {
    console.warn('[AutoFlow] Could not forget that video:', error);
  }
}

/** Everything. For a user clearing space, and for tests. */
export async function clear(): Promise<void> {
  if (!canPersist()) return;
  try {
    await run('readwrite', (s) => s.clear() as IDBRequest<any>);
  } catch {
    /* nothing kept, nothing to clear */
  }
}

/** What the vault is holding, for the node's report. */
export async function heldBytes(): Promise<{ clips: number; sources: number; bytes: number }> {
  const all = await list();
  return {
    clips: all.filter((r) => r.kind === 'media').length,
    sources: all.filter((r) => r.kind === 'source').length,
    bytes: all.reduce((sum, r) => sum + (r.size || 0), 0),
  };
}
