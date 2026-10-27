import type { ImageMeta } from '../../types';
import type { FrameReference } from '../../shared/frameReferences';
import { identifyReference } from './referenceImages';
import { registerStudioImage, releaseStudioImages } from './studioImages';

interface ReferenceConfig {
  creationType?: string;
  frameReferences?: FrameReference[];
  referenceImageData?: string[];
  referenceImageIds?: string[];
}

/** Keep named frames ordered even when one is bytes and the other a tile. */
export async function resolveStudioReferenceImages(
  config: ReferenceConfig, tileUrlFor: (id: string) => string,
): Promise<ImageMeta[]> {
  const metas: ImageMeta[] = [];
  const frames = config.creationType === 'frames';
  const refs: FrameReference[] = frames && config.frameReferences
    ? config.frameReferences
    : [
      ...(config.referenceImageData || []).map(dataUrl => ({ kind: 'data' as const, dataUrl })),
      ...(config.referenceImageIds || []).map(tileId => ({ kind: 'tile' as const, tileId })),
    ];
  try {
    for (const ref of refs) {
      const url = ref.kind === 'data' ? ref.dataUrl : tileUrlFor(ref.tileId);
      if (!url) throw new Error(`Reference tile ${ref.kind === 'tile' ? ref.tileId : ''} not found on the Flow page — cannot pass its image to this node`);
      let mime: string;
      let data: string;
      const inline = /^data:([^;,]+);base64,(.+)$/.exec(url);
      if (inline) {
        [, mime, data] = inline;
      } else {
        if (ref.kind === 'data') throw new Error('Reference image is not a valid base64 data URL');
        try {
          const response = await fetch(url);
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const blob = await response.blob();
          mime = blob.type || 'image/png';
          data = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(String(reader.result || '').split(',')[1] || '');
            reader.onerror = () => reject(new Error('Failed to read image blob'));
            reader.readAsDataURL(blob);
          });
        } catch (error: any) {
          throw new Error(`Could not fetch reference image for tile ${ref.tileId}: ${error.message}`);
        }
      }
      const file = await identifyReference(mime, data);
      // Equal Start and End images still represent TWO slots, not one ingredient.
      if (!frames && metas.some(meta => meta.id === file.id)) continue;
      registerStudioImage(file);
      metas.push({
        id: file.id, filename: file.filename, mime, size: Math.floor(data.length * 0.75),
        sha256: file.id.slice(4), lastModified: Date.now(),
      });
    }
    return metas;
  } catch (error) {
    releaseStudioImages(metas.map(meta => meta.id));
    throw error;
  }
}
