import { allowedMedia, sameVideo, socialLink, unavailable, type SocialLink, type SocialMedia } from './policy';

/** Read a JSON assignment without evaluating any page code. */
export function jsonAssignment(text: string, marker: string): any {
  const position = text.indexOf(marker);
  if (position < 0) return null;
  const start = text.indexOf('{', position + marker.length);
  if (start < 0) return null;
  let depth = 0, quoted = false, escaped = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (quoted) { if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === '"') quoted = false; }
    else if (c === '"') quoted = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) {
      try { return JSON.parse(text.slice(start, i + 1)); } catch { return null; }
    }
  }
  return null;
}

const json = (value: string | null) => { try { return JSON.parse(value || ''); } catch { return null; } };
const firstUrl = (value: any): string => typeof value === 'string' ? value : value?.urlList?.[0] || value?.UrlList?.[0] || '';

export function pageMedia(doc: Document, locationUrl: string, requested: SocialLink): SocialMedia {
  const current = socialLink(locationUrl);
  if (!current || !sameVideo(requested, current)) throw new Error('Open the requested video, not a profile, login page or different post.');
  let mediaUrl = '';
  if (current.platform === 'tiktok') {
    const universal = json(doc.getElementById('__UNIVERSAL_DATA_FOR_REHYDRATION__')?.textContent || null);
    const sigi = json(doc.getElementById('SIGI_STATE')?.textContent || null);
    const item = universal?.__DEFAULT_SCOPE__?.['webapp.video-detail']?.itemInfo?.itemStruct || sigi?.ItemModule?.[current.id];
    // A playback URL is not a substitute when a creator has disabled downloading.
    if (String(item?.id) === current.id && item?.preventDownload !== true && item?.item_control?.prevent_download !== true && item?.video?.downloadEnabled !== false && item?.downloadEnabled !== false) {
      mediaUrl = firstUrl(item?.video?.downloadAddr);
    }
    const disabled = doc.querySelector('[data-e2e="video-download"][aria-disabled="true"], [data-e2e="video-download"][disabled]');
    if (disabled) mediaUrl = '';
  } else if (current.platform === 'youtube') {
    for (const script of Array.from(doc.scripts)) {
      const player = jsonAssignment(script.textContent || '', 'ytInitialPlayerResponse =');
      if (player?.videoDetails?.videoId !== current.id || player?.playabilityStatus?.status !== 'OK' || player?.videoDetails?.isLiveContent) continue;
      // Only an already signed, combined audio/video file. No deciphering, DASH,
      // adaptive-format muxing, DRM, or remote executable code.
      const formats = player?.streamingData?.formats;
      if (!Array.isArray(formats)) continue;
      const file = formats.filter((f: any) => typeof f.url === 'string' && /^video\/mp4/.test(f.mimeType || '') && f.audioQuality && !f.signatureCipher && !f.cipher && !f.drmFamilies)
        .sort((a: any, b: any) => (b.height || 0) - (a.height || 0))[0];
      if (file) { mediaUrl = file.url; break; }
    }
  } else {
    const videos = Array.from(doc.querySelectorAll('video')).filter(v => {
      const box = v.getBoundingClientRect();
      return box.width > 0 && box.height > 0 && box.bottom > 0 && box.top < (doc.defaultView?.innerHeight || 1000);
    }).sort((a, b) => b.getBoundingClientRect().width * b.getBoundingClientRect().height - a.getBoundingClientRect().width * a.getBoundingClientRect().height);
    const video = videos.length === 1 ? videos[0] : videos.find(v => Array.from(v.closest('article')?.querySelectorAll<HTMLAnchorElement>('a[href]') || []).some(a => socialLink(a.href)?.id === current.id));
    mediaUrl = video?.currentSrc || video?.getAttribute('src') || doc.querySelector<HTMLMetaElement>('meta[property="og:video:secure_url"], meta[property="og:video"]')?.content || '';
  }
  if (!allowedMedia(mediaUrl, current.platform)) throw new Error(unavailable(current.platform));
  return { pageUrl: current.url, mediaUrl, name: `${current.platform}-${current.id}.mp4` };
}
