/**
 * Putting a finished cut into the Flow media library.
 *
 * ── Why this is not a file input ──────────────────────────────────────────
 *
 * Every DOM route was tried against the live site and every one is dead:
 *
 *   input.files = dataTransfer.files, then a change event   nothing
 *   the same, click-to-dispatch inside one tick             nothing
 *   a synthetic paste carrying the File                     delivered, ignored
 *   a synthetic drop carrying the File                      delivered, ignored
 *   navigator.clipboard.write                               video/mp4 is not
 *                                                           a supported type
 *
 * The paste and drop attempts are the informative ones: a capture listener
 * confirmed both events reached the page carrying real video bytes, and Flow
 * ignored them. Synthetic events are `isTrusted: false`, which page script
 * cannot forge — so no amount of DOM cleverness will do it.
 *
 * What DOES work is the request the page itself makes. Watching a real upload
 * revealed a two step resumable protocol on labs.google — the same origin this
 * content script already runs on, authenticated by the session cookie that is
 * already there:
 *
 *   POST /fx/api/upload-video?action=start
 *        x-upload-content-length, x-upload-content-type,
 *        x-upload-file-name, x-upload-project-id      -> { sessionUrl }
 *
 *   PUT  /fx/api/upload-video?action=upload
 *        content-type, x-upload-command, x-upload-offset,
 *        x-upload-session-url, x-upload-file-name,
 *        x-upload-project-id                          body: the bytes
 *
 * ── What is known to work, and what is not ────────────────────────────────
 *
 * The start call is CONFIRMED: it answers 200 with a sessionUrl every time.
 *
 * The upload call is not. Five combinations of x-upload-command and
 * content-type all came back "Chunk upload failed" — though the status split is
 * a clue worth keeping: "upload" and "finalize" alone are rejected at 400,
 * while "upload, finalize" reaches 500, which reads like a command that parsed
 * and then failed further in. It may also simply be that the 3.8KB test clip
 * was rejected as media rather than the headers being wrong.
 *
 * So this ships as an ATTEMPT with a real fallback, never as a promise. Every
 * failure is classified and returned, the caller falls back to asking the user
 * to pick the file, and nothing here can break a generation that would
 * otherwise have worked.
 *
 * ── And it will break one day ─────────────────────────────────────────────
 *
 * This is an undocumented internal endpoint. It works until Google changes it,
 * and then it stops — which is exactly why the fallback is not optional and
 * why `reason` is specific enough to tell a changed protocol from a rejected
 * file.
 */

export type UploadOutcome =
  | { ok: true; name: string }
  | { ok: false; stage: 'start' | 'upload' | 'setup'; reason: string };

/* Google's resumable convention, and the one that got furthest: the single
   commands are rejected at 400 while this reaches the chunk handler. */
const UPLOAD_COMMAND = 'upload, finalize';

/** The project a Flow URL is pointing at, or '' when it is not a project page. */
export function projectIdFromUrl(href: string = location.href): string {
  const m = /\/fx\/tools\/flow\/project\/([A-Za-z0-9-]+)/.exec(href);
  return m ? m[1] : '';
}

/**
 * A name Flow will show, and a person will recognise in the picker.
 *
 * Derived from the clip's own label rather than left as a uuid, because the
 * whole point of putting it in the library is finding it again — the adapter
 * searches by this string, and so does the user.
 */
export function libraryName(label: string): string {
  const clean = (label || 'clip')
    .replace(/[^\w\s-]+/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 48);
  return `${clean || 'clip'}.mp4`;
}

/**
 * The name one piece of a split clip is written under.
 *
 * Flow shows an asset under its FILE name and sanitises it hard — spaces and
 * brackets become underscores and anything non-ASCII is dropped outright. A
 * French "telechargement (7).mp4" arrives in the library as "tlchargement_7",
 * which is what four uploaded cuts looked like: unreadable, unsortable, and
 * indistinguishable from each other.
 *
 * So the folding happens HERE, where it can be done properly, rather than
 * being left to Flow to do badly:
 *
 *   - accents are folded to their base letter (NFD, then drop the combining
 *     marks) so "Téléchargement" becomes "Telechargement" and not "Tlchargement"
 *   - what remains is reduced to word characters and hyphens
 *   - the part number is spelled out, because "part 2 of 4" is the one thing
 *     the reader needs and "(2)" is what gets mangled
 *
 * A single piece keeps the plain name: there is no part to number.
 */
export function partFileName(label: string, index: number, of: number): string {
  const clean = (label || 'clip')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s-]+/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 40)
    .replace(/^-|-$/g, '');
  const base = clean || 'clip';
  return (of > 1)
    ? `${base}-part${index}-of-${of}.mp4`
    : `${base}.mp4`;
}

interface UploadDeps {
  fetch?: typeof fetch;
  projectId?: string;
  log?: (line: string) => void;
}

/**
 * Upload a clip to the library, or say exactly why it could not be.
 *
 * Never throws. A generation that would have worked without a style reference
 * must still work when the reference cannot be uploaded, so every failure path
 * returns a reason the caller can show and carry on from.
 */
export async function uploadToLibrary(
  blob: Blob,
  label: string,
  deps: UploadDeps = {},
): Promise<UploadOutcome> {
  const doFetch = deps.fetch || fetch;
  const projectId = deps.projectId ?? projectIdFromUrl();
  const name = libraryName(label);

  if (!projectId) {
    return { ok: false, stage: 'setup', reason: 'not on a Flow project page' };
  }
  if (!blob || !blob.size) {
    return { ok: false, stage: 'setup', reason: 'the clip has no bytes to send' };
  }

  const common = {
    'x-upload-file-name': name,
    'x-upload-project-id': projectId,
  };

  let sessionUrl = '';
  try {
    const started = await doFetch('/fx/api/upload-video?action=start', {
      method: 'POST',
      headers: {
        ...common,
        'x-upload-content-length': String(blob.size),
        'x-upload-content-type': blob.type || 'video/mp4',
      },
    });
    if (!started.ok) {
      return { ok: false, stage: 'start', reason: `Flow refused to open an upload (${started.status})` };
    }
    const body = await started.json().catch(() => null);
    sessionUrl = (body && (body as any).sessionUrl) || '';
    if (!sessionUrl) {
      /* A 200 with no session is the shape changing under us, which is the
         failure this endpoint is most likely to have one day. */
      return { ok: false, stage: 'start', reason: 'Flow opened an upload but gave no session — the protocol has changed' };
    }
  } catch (error) {
    return { ok: false, stage: 'start', reason: `could not reach Flow: ${(error as Error)?.message || error}` };
  }

  try {
    const put = await doFetch('/fx/api/upload-video?action=upload', {
      method: 'PUT',
      headers: {
        ...common,
        'content-type': blob.type || 'video/mp4',
        'x-upload-command': UPLOAD_COMMAND,
        'x-upload-offset': '0',
        'x-upload-session-url': sessionUrl,
      },
      body: blob,
    });
    if (!put.ok) {
      const detail = await put.text().catch(() => '');
      let message = '';
      try {
        const parsed = JSON.parse(detail);
        message = String(parsed?.error?.message || parsed?.error || parsed?.details || '');
      } catch {
        message = detail.slice(0, 120);
      }
      return {
        ok: false,
        stage: 'upload',
        reason: `Flow rejected the upload (${put.status})${message ? `: ${message}` : ''}`,
      };
    }
    deps.log?.(`uploaded ${name} to the Flow library`);
    return { ok: true, name };
  } catch (error) {
    return { ok: false, stage: 'upload', reason: `the upload failed: ${(error as Error)?.message || error}` };
  }
}

/**
 * What to tell the user when the upload could not be done for them.
 *
 * Specific on purpose. "Something went wrong" makes a person reload and try
 * again; naming the step and the remedy makes them do the one click that
 * finishes the job.
 */
export function fallbackInstruction(outcome: UploadOutcome, label: string): string {
  if (outcome.ok) return '';
  const name = libraryName(label);
  return (
    `Could not add the clip to Flow automatically (${outcome.reason}). `
    + `Save this cut, then in Flow use + → Upload media and pick it. `
    + `Name it "${name}" and it will be found automatically next time.`
  );
}
