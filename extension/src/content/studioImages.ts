/* ============================================================
   AutoFlow Studio – In-memory reference image registry
   Studio nodes pass reference images (base64 from Image nodes,
   or media fetched from upstream Generate tiles). These never
   exist in the sidepanel's IndexedDB, so the automation engine
   resolves them from this registry instead of round-tripping
   through GET_IMAGE_BLOBS.
   ============================================================ */

export interface StudioImageFile {
  id: string;       // matches the ImageMeta.id placed on the prompt
  filename: string;
  mime: string;
  data: string;     // raw base64 (no data: prefix), same shape as GET_IMAGE_BLOBS files
}

const registry = new Map<string, StudioImageFile>();

export function registerStudioImage(entry: StudioImageFile): void {
  registry.set(entry.id, entry);
}

/**
 * Return the registered files for the given ids, or null if any id is
 * missing (meaning these are sidepanel images — caller should fall back
 * to the normal GET_IMAGE_BLOBS path).
 */
export function getStudioImageFiles(ids: string[]): StudioImageFile[] | null {
  const out: StudioImageFile[] = [];
  for (const id of ids) {
    const entry = registry.get(id);
    if (!entry) return null;
    out.push(entry);
  }
  return out;
}

/** Free registered images once a Studio node finishes (base64 can be large). */
export function releaseStudioImages(ids: string[]): void {
  for (const id of ids) registry.delete(id);
}
