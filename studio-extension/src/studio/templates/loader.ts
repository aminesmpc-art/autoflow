/* ============================================================
   Where the gallery's templates come from.

   Three sources, in order of preference, and the gallery never waits on the
   network for any of them:

     cache (chrome.storage.local)  →  shown immediately, may be a day stale
     bundle (compiled in)          →  the floor; a fresh install, offline
     backend                       →  fetched in the background, replaces both

   The point of the whole exercise is that adding a template stops costing a
   Chrome Web Store review. What must not come with it is a gallery that is
   empty when the API is down, or slow because it waits to find out.
   ============================================================ */

import { BUILTIN_TEMPLATES, type Template } from './index';
import { validateTemplate, capabilityGap } from './validate';
import {
  type AskPreset, BUILTIN_ASK_PRESETS, setAskPresets, validatePreset,
} from '../presets';

const API_BASE = 'https://api.auto-flow.studio';
const CACHE_KEY = 'af_templates_cache';
/** Fetching more often than this buys nothing; templates change by the week. */
const REFRESH_AFTER_MS = 6 * 60 * 60 * 1000;

/** The payload shape the backend serves. */
export interface TemplatePayload {
  schemaVersion: number;
  publishedAt?: string;
  templates: Template[];
  /* Ask AI briefs travel with the templates. Same reasoning as templates
     themselves: they are text, so fixing a brief that produces weak sheets is
     a publish rather than a store review — and a template referring to a
     preset is useless if the preset it names cannot be updated with it. */
  presets?: AskPreset[];
}

/** Bumped only when the format changes in a way old builds cannot read. */
export const SUPPORTED_SCHEMA_VERSION = 1;

interface CacheEntry {
  payload: TemplatePayload;
  etag: string;
  fetchedAt: number;
}

export type TemplateSource = 'cache' | 'bundle' | 'network';

export interface LoadResult {
  templates: Template[];
  source: TemplateSource;
}

/** This build's version, for the capability gate. */
function buildVersion(): string {
  try { return chrome.runtime.getManifest().version; } catch { return '0.0.0'; }
}

/**
 * Drop what this build cannot draw, and what is not valid at all.
 *
 * The two are reported differently on purpose. A capability gap is expected and
 * boring — an older build meeting a newer template. A validation failure means
 * something was published broken, and somebody needs to know.
 */
export function usable(templates: Template[]): Template[] {
  const version = buildVersion();
  const out: Template[] = [];

  for (const tpl of templates) {
    if ((tpl as any).disabled) continue;

    const gap = capabilityGap(tpl, { version });
    if (gap) {
      console.info(`[Templates] Hiding "${(tpl as any).id}": ${gap}`);
      continue;
    }

    const problems = validateTemplate(tpl);
    if (problems.length) {
      // Per template, never per payload: one bad template must not empty the
      // gallery for everything else in it.
      console.error(`[Templates] Rejected "${(tpl as any).id}":\n  - ${problems.join('\n  - ')}`);
      continue;
    }
    out.push(tpl);
  }
  return out;
}

/**
 * Install the published presets, dropping any that are malformed.
 *
 * Per preset, never per payload — one bad brief must not take the other six
 * with it. Absent or entirely unusable leaves the bundled set in place, which
 * is why setAskPresets treats an empty list as "keep what you have".
 */
function applyPresets(presets: AskPreset[] | undefined): void {
  if (!Array.isArray(presets) || !presets.length) return;
  const usable = presets.filter((p) => {
    const problems = validatePreset(p);
    if (problems.length) {
      console.error(
        `[Presets] Rejected "${(p as any)?.id || '(no id)'}":\n  - ` +
        problems.join('\n  - ')
      );
      return false;
    }
    return true;
  });
  if (!usable.length) {
    console.error('[Presets] Nothing in the payload was usable — keeping the bundled set');
    return;
  }
  setAskPresets(usable);
  console.log(`[Presets] Using ${usable.length} published preset(s)`);
}

async function readCache(): Promise<CacheEntry | null> {
  try {
    const got = await chrome.storage.local.get(CACHE_KEY);
    const entry = got?.[CACHE_KEY] as CacheEntry | undefined;
    if (!entry?.payload?.templates?.length) return null;
    // A payload from a future format is not something to guess at.
    if (entry.payload.schemaVersion > SUPPORTED_SCHEMA_VERSION) return null;
    return entry;
  } catch {
    return null;
  }
}

/**
 * What to show right now, without waiting for anything.
 *
 * Always resolves, always with something in it. The bundle is the floor.
 */
export async function loadTemplates(): Promise<LoadResult> {
  const cached = await readCache();
  if (cached) {
    applyPresets(cached.payload.presets);
    return { templates: usable(cached.payload.templates), source: 'cache' };
  }
  setAskPresets(BUILTIN_ASK_PRESETS);
  return { templates: usable(BUILTIN_TEMPLATES), source: 'bundle' };
}

/**
 * Refresh from the backend, if it has anything newer.
 *
 * Returns null when there is nothing to change — unchanged (304), too soon,
 * offline, or the payload turned out unusable. Callers keep showing what they
 * have; a failed refresh must look like a slightly older gallery, never an
 * error.
 */
export async function refreshTemplates(opts: { force?: boolean } = {}): Promise<LoadResult | null> {
  const cached = await readCache();
  if (!opts.force && cached && Date.now() - cached.fetchedAt < REFRESH_AFTER_MS) return null;

  let token = '';
  try {
    token = (await chrome.storage.local.get('af_token'))?.af_token || '';
  } catch { /* signed out is fine — the free set is public */ }

  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api/templates`, {
      headers: {
        ...(cached?.etag ? { 'If-None-Match': cached.etag } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
  } catch (e) {
    console.info('[Templates] Refresh skipped — offline or unreachable');
    return null;
  }

  if (res.status === 304) return null;
  if (!res.ok) {
    console.warn(`[Templates] Refresh failed: HTTP ${res.status}`);
    return null;
  }

  let payload: TemplatePayload;
  try {
    payload = await res.json();
  } catch {
    console.error('[Templates] Refresh returned something that is not JSON');
    return null;
  }

  if (!Array.isArray(payload?.templates)) {
    console.error('[Templates] Payload has no templates array — keeping what we have');
    return null;
  }

  /* An older build meeting a newer format keeps its cache rather than guessing
     at fields it does not understand. Cheap now, impossible to retrofit. */
  if ((payload.schemaVersion || 1) > SUPPORTED_SCHEMA_VERSION) {
    console.warn(
      `[Templates] Payload is schema v${payload.schemaVersion}, this build reads v${SUPPORTED_SCHEMA_VERSION}. ` +
      'Keeping the current set — update the extension for the newer templates.'
    );
    return null;
  }

  applyPresets(payload.presets);

  const templates = usable(payload.templates);
  if (!templates.length) {
    // Everything was rejected. Serving an empty gallery over a working one is
    // the worst outcome available, so do not.
    console.error('[Templates] Nothing in the payload was usable — keeping the current set');
    return null;
  }

  try {
    await chrome.storage.local.set({
      [CACHE_KEY]: {
        payload,
        etag: res.headers.get('ETag') || '',
        fetchedAt: Date.now(),
      } as CacheEntry,
    });
  } catch { /* a cache we could not write still leaves this run correct */ }

  return { templates, source: 'network' };
}

/** For diagnosis and for tests — forget everything fetched. */
export async function clearTemplateCache(): Promise<void> {
  try { await chrome.storage.local.remove(CACHE_KEY); } catch { /* nothing to do */ }
}
