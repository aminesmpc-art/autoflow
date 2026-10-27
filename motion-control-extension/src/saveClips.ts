/* "Download all": every ready clip, saved into one folder the user picks.

   The folder comes from Chrome's own folder picker (File System Access), so
   the clips go from this panel straight to the user's disk. No browser
   download and no new permission is involved, and no clip goes anywhere
   else. `id` makes Chrome open the picker where the user saved last time.

   Files are named after the project and numbered by PIECE — "Dance - 01.mp4",
   "Dance - 03.mp4" when piece 2 failed — so the numbers match the panel and
   the order survives into an editor. Nothing is overwritten: an existing name
   gets " (2)". */

type Writable = { write(data: Blob): Promise<void>; close(): Promise<void>; abort?(): Promise<void> };
type FileHandle = { createWritable(): Promise<Writable> };
export type Folder = { name: string; getFileHandle(name: string, options?: { create?: boolean }): Promise<FileHandle> };
export type Clip = { index: number; url: string };
export type SaveResult = { saved: string[]; failed: { index: number; why: string }[] };

/** Ask for a folder. Null when the user closes the picker. */
export async function pickFolder(): Promise<Folder | null> {
  const picker = (globalThis as any).showDirectoryPicker;
  if (typeof picker !== 'function') {
    throw new Error('This browser cannot save into a folder. Use the download button on each clip instead.');
  }
  try {
    return await picker.call(globalThis, { id: 'motion-clips', mode: 'readwrite' });
  } catch (error: any) {
    if (error?.name === 'AbortError') return null;
    throw new Error(error?.name === 'SecurityError' || error?.name === 'NotAllowedError'
      ? 'Chrome did not allow saving into that folder. Choose or create another folder.'
      : `Could not open that folder: ${error?.message || error}`);
  }
}

/** Windows-safe, without the characters and names Windows refuses. */
export function safeName(text: string): string {
  const cleaned = String(text || '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '')
    .slice(0, 80)
    .trim();
  if (!cleaned) return 'Motion';
  return /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(cleaned) ? `${cleaned}_` : cleaned;
}

export function extensionFor(type: string): string {
  return /webm/i.test(type) ? 'webm' : /quicktime/i.test(type) ? 'mov' : 'mp4';
}

/** "Project - 01.mp4", padded to the width of the largest piece number. */
export function clipFileName(project: string, index: number, width: number, ext: string): string {
  return `${safeName(project)} - ${String(index).padStart(Math.max(2, String(width).length), '0')}.${ext}`;
}

async function taken(folder: Folder, name: string): Promise<boolean> {
  try { await folder.getFileHandle(name); return true; }
  catch (error: any) {
    if (error?.name === 'NotFoundError') return false;
    if (error?.name === 'TypeMismatchError') return true; // a folder already has that name
    throw error;
  }
}

/** The first of "x.mp4", "x (2).mp4", "x (3).mp4"… that is free. */
export async function freeName(folder: Folder, name: string): Promise<string> {
  if (!await taken(folder, name)) return name;
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name, ext = dot > 0 ? name.slice(dot) : '';
  for (let n = 2; n < 1000; n++) {
    const candidate = `${stem} (${n})${ext}`;
    if (!await taken(folder, candidate)) return candidate;
  }
  throw new Error('too many files with this name already');
}

/* A saved clip is either the clip itself (a data: URL, which is what the run
   normally keeps) or Flow's address for it, read with the user's Google
   session the same way the service worker reads media. */
const FLOW_HOSTS = /^(flow\.google\.com|flow-content\.google|labs\.google|([a-z0-9-]+\.)?googlevideo\.com|([a-z0-9-]+\.)?googleusercontent\.com|storage\.googleapis\.com)$/;

export async function clipBlob(url: string): Promise<Blob> {
  let response: Response;
  if (/^data:video\//.test(url)) response = await fetch(url);
  else {
    let host = '';
    try { const parsed = new URL(url); host = parsed.protocol === 'https:' ? parsed.hostname : ''; } catch { /* not a URL */ }
    if (!FLOW_HOSTS.test(host)) throw new Error('this clip has no saved video');
    response = await fetch(url, { credentials: 'include' });
    if ([401, 403, 404, 410].includes(response.status)) {
      throw new Error("Flow's link to this clip has expired. Download it from Flow");
    }
  }
  if (!response.ok) throw new Error(`the clip could not be read (${response.status})`);
  const blob = await response.blob();
  if (!blob.size) throw new Error('the clip is empty');
  return blob;
}

/** Save each clip in turn; one that fails is reported and the rest still save. */
export async function saveClips(folder: Folder, clips: Clip[], project: string, width: number,
  progress: (done: number) => void = () => undefined): Promise<SaveResult> {
  const result: SaveResult = { saved: [], failed: [] };
  for (const clip of clips) {
    try {
      const blob = await clipBlob(clip.url);
      const name = await freeName(folder, clipFileName(project, clip.index, width, extensionFor(blob.type)));
      const file = await folder.getFileHandle(name, { create: true });
      const out = await file.createWritable();
      try { await out.write(blob); await out.close(); }
      catch (error) { await out.abort?.().catch(() => undefined); throw error; }
      result.saved.push(name);
    } catch (error: any) {
      result.failed.push({ index: clip.index, why: error?.message || String(error) });
    }
    progress(result.saved.length + result.failed.length);
  }
  return result;
}

/** One sentence for the panel. */
export function saveSummary(result: SaveResult, folderName: string): { ok: boolean; text: string } {
  const saved = result.saved.length;
  const where = `"${folderName}"`;
  if (!result.failed.length) return { ok: true, text: `Saved ${saved === 1 ? '1 clip' : `${saved} clips`} to ${where}.` };
  const failures = result.failed.map(f => `piece ${f.index}: ${f.why}`).join('; ');
  return { ok: false, text: saved
    ? `Saved ${saved} of ${saved + result.failed.length} clips to ${where}. Not saved — ${failures}.`
    : `No clips were saved to ${where}. ${failures}.` };
}
