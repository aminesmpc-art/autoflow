import { mediaKey } from './mediaIdentity';

export interface ReferenceFile { id: string; filename: string; mime: string; data: string }
export interface ReferenceReceipt { filename: string; mediaId?: string }

/* How much of the hash goes into the name Flow shows. The whole 64 made a
   75-character name that Flow's picker cut off on screen, that its search had
   to be handed in full, and that nobody could recognise. 16 hex characters are
   64 bits — still unique among one project's references — and the id keeps the
   whole hash, so identity is unchanged. */
const NAME_HASH_CHARS = 16;

/** Hash decoded bytes: data URL formatting and regenerated node IDs are not identity. */
export async function identifyReference(mime: string, data: string): Promise<ReferenceFile> {
  const bytes = Uint8Array.from(atob(data), c => c.charCodeAt(0));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hash = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
  const ext = ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp',
    'image/gif': 'gif', 'image/avif': 'avif' } as Record<string, string>)[mime];
  if (!ext) throw new Error(`Unsupported reference image type: ${mime}`);
  return { id: `ref_${hash}`, filename: `af_ref_${hash.slice(0, NAME_HASH_CHARS)}.${ext}`, mime, data };
}

/**
 * Whether a media key names the same picture tomorrow.
 *
 * `id:` keys are Flow's media UUIDs. `asb:` keys are the tokens in Flow's
 * `/asb/` image URLs, and nothing promises one survives a reload: a receipt
 * written from yesterday's chip held one, today's picker row did not match
 * it, and the image — in the library, under its own name — "could not be
 * attached". Only two durable keys may overrule a name.
 */
export function isDurableMediaKey(key: string | undefined): boolean {
  return !!key && key.startsWith('id:');
}

/**
 * What to type into Flow's asset search, in order.
 *
 * The name without its extension, cut to the short form first — a long name
 * may be indexed or shown cut — then the name as uploaded, then Flow's own id,
 * and last an empty query, which lists every row to be scrolled through.
 */
export function referenceSearchQueries(receipt: ReferenceReceipt): string[] {
  const stem = receipt.filename.replace(/\.(png|jpe?g|webp|gif|avif)$/i, '');
  const short = stem.startsWith('af_ref_') ? stem.slice(0, 'af_ref_'.length + NAME_HASH_CHARS) : stem;
  const id = isDurableMediaKey(receipt.mediaId) ? [receipt.mediaId!.replace(/^id:/, '')] : [];
  return [...new Set([short, stem, receipt.filename, ...id, ''])];
}

export function referenceProject(url: string): string {
  const parsed = new URL(url);
  const project = parsed.pathname.match(/\/project\/([^/]+)/)?.[1];
  if (!project) throw new Error('Open a Flow project before attaching reference images.');
  return `${parsed.origin}/project/${project}`;
}

/** One key per image/project avoids lost updates between Flow tabs. No image bytes or signed URLs. */
export function referenceReceiptKey(project: string, id: string): string {
  return `af_reference_v1:${project}:${id}`;
}

export const referenceReceipts = {
  async read(key: string): Promise<ReferenceReceipt | undefined> {
    const value = (await chrome.storage.local.get(key))[key];
    if (!value || typeof value.filename !== 'string') return undefined;
    return { filename: value.filename, mediaId: typeof value.mediaId === 'string' ? value.mediaId : undefined };
  },
  async write(key: string, value: ReferenceReceipt): Promise<void> {
    await chrome.storage.local.set({ [key]: value });
  },
};

export interface ReferenceReuseDeps {
  project: string;
  read: (key: string) => Promise<ReferenceReceipt | undefined>;
  write: (key: string, value: ReferenceReceipt) => Promise<void>;
  attached: () => string[];
  upload: (file: ReferenceFile) => Promise<boolean>;
  select: (receipt: ReferenceReceipt) => Promise<boolean>;
  stopped: () => boolean;
  log: (line: string) => void;
}

/** Serial attachment lets us associate each uploaded image with its own Flow ID. */
export async function ensureReferenceImages(files: ReferenceFile[], deps: ReferenceReuseDeps): Promise<boolean> {
  const wanted = new Set<string>();
  for (const file of Array.from(new Map(files.map(f => [f.id, f])).values())) {
    if (deps.stopped()) return false;
    const key = referenceReceiptKey(deps.project, file.id);
    let receipt = await deps.read(key);
    if (receipt?.mediaId && deps.attached().includes(receipt.mediaId)) {
      wanted.add(receipt.mediaId);
      deps.log('Reference already attached — reusing it.');
      continue;
    }
    const before = new Set(deps.attached());
    if (receipt) {
      deps.log('Finding the saved reference in the Flow library — no new upload.');
      if (!(await deps.select(receipt))) {
        throw new Error('The saved reference could not be attached from this Flow project. '
          + 'Check that the image is still in its library and retry. No duplicate was uploaded.');
      }
    } else {
      receipt = { filename: file.filename };
      // Persist BEFORE handing bytes to Flow. A timeout/reload must search, not upload twice.
      await deps.write(key, receipt);
      deps.log('Uploading this reference once for this Flow project.');
      if (!(await deps.upload(file))) {
        throw new Error('Reference upload could not be confirmed. Retry will search the library before doing anything else.');
      }
    }
    if (deps.stopped()) return false;
    const after = deps.attached();
    const fresh = after.filter(id => !before.has(id));
    /* The stored key when it is still on the prompt. Otherwise the one chip
       this attach added — unless the stored key is durable, because then a
       different durable key really is a different picture. */
    const stored = receipt.mediaId;
    const mediaId = stored && after.includes(stored)
      ? stored
      : fresh.length === 1 && !isDurableMediaKey(stored) ? fresh[0] : undefined;
    if (!mediaId || !after.includes(mediaId)) {
      throw new Error('Flow has not attached the expected reference image. Generation stopped to protect character consistency.');
    }
    await deps.write(key, { filename: receipt.filename, mediaId });
    wanted.add(mediaId);
  }
  const attached = new Set(deps.attached());
  return !deps.stopped() && [...wanted].every(id => attached.has(id));
}

/* The shortest visible part of a cut name that may stand for the whole:
   "af_ref_" and 12 hash characters. Anything shorter could be another file. */
const CUT_NAME_MIN = 'af_ref_'.length + 12;

/**
 * Only a unique identity match is acceptable; never take the first search result.
 *
 * Two durable keys decide on their own, either way. Otherwise the name does —
 * a reference's name is its content hash, so a match is the same picture —
 * including a name Flow cut short with an ellipsis, when the visible part is
 * long enough to be that hash.
 */
export function matchingReferenceRow(rows: HTMLElement[], receipt: ReferenceReceipt): HTMLElement | null {
  const stem = (s: string) => s.trim().replace(/\.(png|jpe?g|webp|gif|avif)$/i, '').toLowerCase();
  const want = stem(receipt.filename);
  const wantedKey = isDurableMediaKey(receipt.mediaId) ? receipt.mediaId : '';
  const matches = rows.filter(row => {
    const key = mediaKey(row.querySelector('img')?.getAttribute('src') || '');
    if (wantedKey && isDurableMediaKey(key)) return key === wantedKey;
    const title = row.querySelector('.asset-title, .asset-name, [data-testid="asset-name"]');
    const labels = [title?.textContent, row.getAttribute('title'), row.getAttribute('aria-label'),
      row.querySelector('img')?.getAttribute('alt'), row.textContent];
    return labels.some(s => {
      if (!s) return false;
      if (stem(s) === want) return true;
      const cut = s.trim().match(/^(.*?)(?:…|\.\.\.)$/);
      return !!cut && cut[1].length >= CUT_NAME_MIN && want.startsWith(cut[1].toLowerCase());
    });
  });
  return matches.length === 1 ? matches[0] : null;
}
