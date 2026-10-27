import { framesFromVideoBlob } from '../../content/flow/videoFrames';
import { endingFrame } from '../ask/motionContinuity';

async function bounded<T>(task: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([task, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error('Reading the generated video timed out. The completed clip is kept; try frame recovery again.')), 45_000);
    })]);
  } finally { clearTimeout(timer); }
}

/** Decode the generated clip itself. Never fall back to its poster or opening frame. */
export async function recoverMotionEndFrame(videoUrl?: string): Promise<string> {
  if (!videoUrl) throw new Error('No playable generated clip is saved. Check the completed video in Flow; you can start a new scene on the next piece to continue without a frame.');
  const inline = /^data:video\//.test(videoUrl);
  let blob: Blob;
  if (inline) {
    blob = await (await fetch(videoUrl)).blob();
  } else {
    const url = new URL(videoUrl);
    if (url.protocol !== 'https:' || !/^(flow\.google\.com|flow-content\.google|labs\.google|([a-z0-9-]+\.)?googlevideo\.com)$/.test(url.hostname)) throw new Error('This is not a saved Flow video URL.');
    // Restrict the URL here; the worker caps the download size.
    const result = await bounded(chrome.runtime.sendMessage({ type: 'STUDIO_FETCH_MEDIA', payload: { url: videoUrl, maxBytes: 64 * 1024 * 1024 } }));
    if (!result?.dataUrl || !/^data:video\//.test(result.dataUrl)) throw new Error(result?.error || 'Could not read the generated clip. Its Flow download link may have expired.');
    blob = await (await fetch(result.dataUrl)).blob();
  }
  if (!blob.type.startsWith('video/') || blob.size > 64 * 1024 * 1024) throw new Error('The saved media is not a readable video under 64 MB.');
  const { last } = await framesFromVideoBlob(blob);
  const frame = endingFrame(last);
  if (!frame) throw new Error('Could not decode the ending frame. The completed clip is kept; start a new scene on the next piece to continue without this reference.');
  return frame;
}
