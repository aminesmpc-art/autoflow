import { allowedMedia, MAX_IMPORT_BYTES, MEDIA_ORIGINS, sameVideo, socialLink, unavailable, type SocialLink, type SocialMedia } from './policy';
import { ensureSession, getAccessToken } from '../../../studio-extension/src/shared/api';

// Never use a storage/page-supplied host when sending an account bearer token.
export const IMPORT_SERVER = 'https://autoflow-extractor-production.up.railway.app';

export async function readServerVideo(link: SocialLink, signal: AbortSignal, progress: (bytes: number) => void): Promise<File> {
  if (!socialLink(link.url)) throw new Error('Unsupported video link.');
  const session = await ensureSession();
  if (signal.aborted) throw cancelled();
  if (!['valid', 'refreshed'].includes(session)) throw new Error('Sign in to AutoFlow before using server downloads. Browser only and Upload file are still available.');
  const token = await getAccessToken();
  if (!token) throw new Error('Sign in to AutoFlow before importing.');
  const response = await fetch(`${IMPORT_SERVER}/api/imports/video`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    credentials: 'omit', redirect: 'error', signal,
    body: JSON.stringify({ url: link.url, reuse_permission: true }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const fallback = response.status === 404 ? 'Server downloads need the extractor backend update. Choose Browser only or Upload file for now.'
      : response.status === 401 ? 'Sign in again to import this video.'
      : response.status === 429 ? 'Too many video imports or an import is already running. Try again shortly.'
      : 'The server could not download this video. Choose Browser only or Upload file.';
    throw new Error(typeof body.detail === 'string' ? body.detail.slice(0, 350) : fallback);
  }
  return fileFromResponse(response, `${link.platform}-${link.id || 'video'}.mp4`, signal, progress);
}

const cancelled = () => new DOMException('Import cancelled.', 'AbortError');
function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(cancelled()); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
}

export async function resolveVideo(link: SocialLink, signal: AbortSignal, tabId?: number): Promise<SocialMedia> {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const matches = tabs.filter(t => socialLink(t.url || '')?.id === link.id && socialLink(t.url || '')?.platform === link.platform);
  let tab: chrome.tabs.Tab | undefined = matches.find(t => t.id === tabId) || matches[0];
  // Short links must actually be opened and resolved by the browser.
  if (!link.id) tab = undefined;
  if (signal.aborted) throw cancelled();
  if (!tab?.id) tab = await chrome.tabs.create({ url: link.url, active: true });
  if (!tab.id) throw new Error('Could not open the video tab.');
  const deadline = Date.now() + 30_000;
  let lastError = 'Wait for the video to load in its tab, then try importing again.';
  while (Date.now() < deadline) {
    if (signal.aborted) throw cancelled();
    const currentTab = await chrome.tabs.get(tab.id);
    if (currentTab.status === 'complete') {
      try {
        const reply = await chrome.tabs.sendMessage(tab.id, { type: 'MOTION_SOCIAL_READ', url: link.url });
        if (reply?.media) {
          const media = reply.media as SocialMedia, actual = socialLink(media.pageUrl);
          if (!actual || !sameVideo(link, actual) || !allowedMedia(media.mediaUrl, link.platform)) throw new Error('The page returned media for a different or unsupported video.');
          return { ...media, name: `${actual.platform}-${actual.id}.mp4` };
        }
        if (reply?.error) lastError = String(reply.error);
      } catch (error) {
        // No listener yet on a newly opened page is expected. URL/permission
        // violations are not silently replaced with some other video's file.
        if (error instanceof Error && /different or unsupported/.test(error.message)) throw error;
      }
    }
    await wait(750, signal);
  }
  throw new Error(lastError);
}

/** Called directly by the Import click, so Chrome keeps its user gesture. */
export function requestMediaAccess(link: SocialLink): Promise<boolean> {
  // googlevideo.com is already a required Flow media permission in Motion.
  if (link.platform === 'youtube') return Promise.resolve(true);
  return chrome.permissions.request({ origins: MEDIA_ORIGINS[link.platform] });
}

export async function readVideo(media: SocialMedia, signal: AbortSignal, progress: (bytes: number) => void): Promise<File> {
  const link = socialLink(media.pageUrl);
  if (!link || !allowedMedia(media.mediaUrl, link.platform)) throw new Error('Unsupported media address.');
  // Credentials and bearer tokens never go to social CDNs. Redirects cannot
  // turn an allowlisted URL into an arbitrary request.
  const response = await fetch(media.mediaUrl, { credentials: 'omit', redirect: 'error', signal });
  if (!response.ok) throw new Error(unavailable(link.platform));
  return fileFromResponse(response, media.name, signal, progress);
}

async function fileFromResponse(response: Response, name: string, signal: AbortSignal, progress: (bytes: number) => void): Promise<File> {
  const type = (response.headers.get('content-type') || '').split(';')[0].toLowerCase();
  if (!['video/mp4', 'video/webm', 'application/octet-stream'].includes(type)) throw new Error('The download did not return a downloadable video file. Use Upload file instead.');
  if (Number(response.headers.get('content-length')) > MAX_IMPORT_BYTES) throw new Error('Link imports support videos up to 100 MB. Upload a local file for larger videos.');
  if (!response.body) throw new Error('The video response was empty. Try uploading a local file.');
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      if (signal.aborted) throw cancelled();
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_IMPORT_BYTES) throw new Error('Link imports support videos up to 100 MB. Upload a local file for larger videos.');
      chunks.push(value); progress(bytes);
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
  if (signal.aborted) throw cancelled();
  const blob = new Blob(chunks as BlobPart[]);
  const header = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
  const mp4 = String.fromCharCode(...header.slice(4, 8)) === 'ftyp';
  const webm = [0x1a, 0x45, 0xdf, 0xa3].every((v, i) => header[i] === v);
  if (!mp4 && !webm) throw new Error('The site returned a page or segmented stream, not a video file. Use Upload file instead.');
  return new File([blob], name.replace(/\.mp4$/, webm ? '.webm' : '.mp4'), { type: webm ? 'video/webm' : 'video/mp4' });
}

/** The copy uses the same downloaded bytes as the source, not a second fetch. */
export async function saveVideo(file: File): Promise<number> {
  const url = URL.createObjectURL(file);
  let id: number | undefined;
  const cleanup = () => { URL.revokeObjectURL(url); chrome.downloads.onChanged.removeListener(changed); };
  const changed = (event: chrome.downloads.DownloadDelta) => {
    if (event.id === id && ['complete', 'interrupted'].includes(event.state?.current || '')) cleanup();
  };
  chrome.downloads.onChanged.addListener(changed);
  try {
    id = await chrome.downloads.download({ url, filename: `AutoFlow Motion/${file.name.replace(/[^\w.-]/g, '_')}`, conflictAction: 'uniquify', saveAs: false });
    const [download] = await chrome.downloads.search({ id });
    if (download && ['complete', 'interrupted'].includes(download.state)) cleanup();
    if (download?.state === 'interrupted') throw new Error('Chrome interrupted saving the Downloads copy.');
    return id;
  } catch (error) { cleanup(); throw error; }
}
