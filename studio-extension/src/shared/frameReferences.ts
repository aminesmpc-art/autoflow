export type FrameReference =
  | { kind: 'data'; dataUrl: string }
  | { kind: 'tile'; tileId: string };

export const inlineFrame = (value: unknown): string | undefined =>
  typeof value === 'string' && value.startsWith('data:image/') ? value : undefined;

interface FrameResult { referenceUrl?: string; imageUrl?: string; tileId?: string }
interface FrameEdge { source: string; target: string; targetHandle?: string | null }

/** Resolve each named slot independently; an absent Start must not shift End. */
export function frameReferencesFor(
  nodeId: string, edges: readonly FrameEdge[], resultFor: (id: string) => FrameResult | undefined,
): FrameReference[] {
  const refs: FrameReference[] = [];
  for (const [handle, label] of [['frame_start', 'Start'], ['frame_end', 'End']]) {
    const sources = edges.filter(e => e.target === nodeId && e.targetHandle === handle);
    if (sources.length > 1) throw new Error(`Connect only one image to the ${label.toLowerCase()} frame.`);
    if (!sources.length) {
      if (handle === 'frame_start') throw new Error('Frames mode needs a start frame — connect an image or a previous clip\'s last frame to S.');
      continue;
    }
    const result = resultFor(sources[0].source);
    const dataUrl = [result?.referenceUrl, result?.imageUrl]
      .find((url): url is string => !!url && url.startsWith('data:image/'));
    if (dataUrl) refs.push({ kind: 'data', dataUrl });
    else if (result?.tileId) refs.push({ kind: 'tile', tileId: result.tileId });
    else throw new Error(`${label} frame has no usable image — check the connected image or Last Frame node before retrying.`);
  }
  return refs;
}
