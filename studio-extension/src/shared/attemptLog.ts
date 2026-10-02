/* ============================================================
   Attempt journal — what actually happened to one generation

   Step 1 of the background-working plan: measure before changing focus
   behaviour. Today a hidden run that produces nothing is indistinguishable
   from a hidden run that produced something nobody collected, because the
   only evidence is a console the tab has since discarded.

   ── Why this is storage-backed and not a logger ──────────────────────────

   The three lifecycle events worth catching all destroy in-memory state:
   Chrome discards a hidden tab, terminates an idle service worker, and
   closes Studio when the user navigates away. A journal that lives in a
   variable is empty in exactly the cases being investigated. So entries go
   to chrome.storage.local, bounded, and are read back afterwards.

   ── Why it refuses content ───────────────────────────────────────────────

   This records the SHAPE of an attempt — when a tab hid, whether the
   composer was ready, whether a media id came back — never what was
   generated or who generated it. `detail` is capped and scrubbed, and no
   field takes a prompt or a token. An investigation log that quietly
   accumulates user prompts is a liability, and one that accumulates bearer
   tokens is a breach waiting to be exported by the next person who asks a
   user to "send me your logs".
   ============================================================ */

export type AttemptPhase =
  /* the run */
  | 'attempt_start'
  | 'attempt_end'
  /* the tab it needs */
  | 'tab_created'
  | 'tab_hidden'
  | 'tab_visible'
  | 'tab_discarded'
  | 'tab_removed'
  /* the provider page */
  | 'composer_ready'
  | 'composer_blocked'
  /* evidence */
  | 'submitted'
  | 'status_observed'
  | 'collected'
  | 'gave_up';

export interface AttemptEntry {
  /** ms epoch. Ordering also carries `seq`, because these collide. */
  at: number;
  seq: number;
  attemptId: string;
  phase: AttemptPhase;
  provider?: string;
  nodeId?: string;
  tabId?: number;
  /** Whether the page could see itself at the moment of the entry. */
  hidden?: boolean;
  /** Flow's own id. Evidence that a prompt landed — not content. */
  mediaId?: string;
  /** Short, structural. Scrubbed; never a prompt and never a token. */
  detail?: string;
}

const KEY = 'af_attempt_log';

/** Bounded so a long session cannot fill the extension's storage quota.
    Roughly a day of ordinary use; the oldest entries fall off first. */
export const MAX_ENTRIES = 2000;

const DETAIL_MAX = 120;

/* Anything shaped like a credential never reaches storage, whatever the
   caller passed. Cheap, and the alternative is discovering a token in a log
   someone has already emailed. */
const SECRETISH = [
  /\b(eyJ[A-Za-z0-9_-]{10,})/g,                 // JWT
  /\b(sk-[A-Za-z0-9]{12,})/g,                   // API keys
  /\bBearer\s+[A-Za-z0-9._-]+/gi,
  /\b[A-Za-z0-9._-]*(?:token|secret|password|api[_-]?key)["'\s:=]+[^\s,}"']+/gi,
];

export function scrubDetail(raw: unknown): string | undefined {
  if (raw === undefined || raw === null) return undefined;
  let s = String(raw);
  for (const re of SECRETISH) s = s.replace(re, '[redacted]');
  s = s.replace(/\s+/g, ' ').trim();
  if (!s) return undefined;
  return s.length > DETAIL_MAX ? `${s.slice(0, DETAIL_MAX - 1)}…` : s;
}

/** Monotonic within a context; survives nothing, which is why `at` exists. */
let _seq = 0;

/**
 * One attempt id per generation, carried across contexts.
 *
 * Deliberately not random-per-call: the whole point is that the runner, the
 * background worker and the content script all write entries that can be
 * lined up afterwards, and they only can if they agree on the id.
 */
export function newAttemptId(nodeId: string, stamp: number): string {
  const short = String(nodeId || 'node').replace(/[^A-Za-z0-9_-]/g, '').slice(-8);
  return `${short}-${stamp.toString(36)}`;
}

type Storage = {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
};

/* Injectable so the tests do not need a chrome global, and so a context
   without storage (a stray import in a page) degrades to a no-op rather
   than throwing inside whatever it was instrumenting. */
function defaultStorage(): Storage | null {
  try {
    const area = (globalThis as any)?.chrome?.storage?.local;
    if (!area) return null;
    return {
      get: (key: string) => new Promise((res) => area.get(key, (v: any) => res(v || {}))),
      set: (items: Record<string, unknown>) =>
        new Promise((res) => area.set(items, () => res())),
    };
  } catch {
    return null;
  }
}

let _storage: Storage | null | undefined;

/** Test seam. Passing null forces the no-op path. */
export function __setStorage(s: Storage | null): void {
  _storage = s;
}

function storage(): Storage | null {
  if (_storage === undefined) _storage = defaultStorage();
  return _storage;
}

/**
 * Append one entry.
 *
 * Never throws and never rejects: this is instrumentation, and a journal
 * that can fail a generation is worse than no journal. Every call site is
 * inside the path it is measuring.
 */
export async function record(
  attemptId: string,
  phase: AttemptPhase,
  fields: Partial<Omit<AttemptEntry, 'at' | 'seq' | 'attemptId' | 'phase'>> = {},
): Promise<void> {
  try {
    const store = storage();
    if (!store || !attemptId) return;

    const entry: AttemptEntry = {
      at: Date.now(),
      seq: _seq++,
      attemptId,
      phase,
      ...(fields.provider ? { provider: String(fields.provider).slice(0, 24) } : {}),
      ...(fields.nodeId ? { nodeId: String(fields.nodeId).slice(0, 64) } : {}),
      ...(typeof fields.tabId === 'number' ? { tabId: fields.tabId } : {}),
      ...(typeof fields.hidden === 'boolean' ? { hidden: fields.hidden } : {}),
      ...(fields.mediaId ? { mediaId: String(fields.mediaId).slice(0, 128) } : {}),
    };
    const detail = scrubDetail(fields.detail);
    if (detail) entry.detail = detail;

    const bag = await store.get(KEY);
    const existing = Array.isArray(bag?.[KEY]) ? (bag[KEY] as AttemptEntry[]) : [];
    existing.push(entry);
    /* Oldest first out. The tail is what explains a run that just ended. */
    const trimmed = existing.length > MAX_ENTRIES
      ? existing.slice(existing.length - MAX_ENTRIES)
      : existing;
    await store.set({ [KEY]: trimmed });
  } catch {
    /* swallowed on purpose — see the doc comment */
  }
}

/** Everything recorded, oldest first. */
export async function readAll(): Promise<AttemptEntry[]> {
  try {
    const store = storage();
    if (!store) return [];
    const bag = await store.get(KEY);
    const all = Array.isArray(bag?.[KEY]) ? (bag[KEY] as AttemptEntry[]) : [];
    return [...all].sort((a, b) => (a.at - b.at) || (a.seq - b.seq));
  } catch {
    return [];
  }
}

/** One attempt's story, in order. */
export async function readAttempt(attemptId: string): Promise<AttemptEntry[]> {
  return (await readAll()).filter((e) => e.attemptId === attemptId);
}

export async function clear(): Promise<void> {
  try {
    const store = storage();
    if (store) await store.set({ [KEY]: [] });
  } catch { /* no-op */ }
}

/**
 * What the plan actually asks: did this attempt submit, and was it seen?
 *
 * The distinction that matters is between "never left" and "left, and
 * nobody collected the result" — today both present as a node that produced
 * nothing, which is why the plan forbids blind resubmission.
 */
export function summarise(entries: AttemptEntry[]): {
  submitted: boolean;
  mediaId?: string;
  collected: boolean;
  everHidden: boolean;
  hiddenAtSubmit?: boolean;
  tabLost: boolean;
  ms?: number;
} {
  const phase = (p: AttemptPhase) => entries.find((e) => e.phase === p);
  const submit = phase('submitted');
  const start = entries[0];
  const end = entries[entries.length - 1];
  return {
    submitted: !!submit,
    mediaId: submit?.mediaId,
    collected: !!phase('collected'),
    everHidden: entries.some((e) => e.phase === 'tab_hidden' || e.hidden === true),
    hiddenAtSubmit: submit ? submit.hidden : undefined,
    tabLost: !!(phase('tab_discarded') || phase('tab_removed')),
    ms: start && end ? end.at - start.at : undefined,
  };
}
