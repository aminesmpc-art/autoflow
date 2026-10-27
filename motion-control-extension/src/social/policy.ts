export type SocialPlatform = 'tiktok' | 'instagram' | 'youtube';
export interface SocialLink { platform: SocialPlatform; url: string; id: string }
export interface SocialMedia { pageUrl: string; mediaUrl: string; name: string }
export const SELECTION_KEY = 'motion_social_selection';
export const MAX_IMPORT_BYTES = 100 * 1024 * 1024;
export const MEDIA_ORIGINS: Record<SocialPlatform, string[]> = {
  tiktok: ['https://*.tiktok.com/*', 'https://*.tiktokcdn.com/*', 'https://*.tiktokv.com/*', 'https://*.byteoversea.com/*', 'https://*.ibytedtos.com/*'],
  instagram: ['https://*.cdninstagram.com/*', 'https://*.fbcdn.net/*'],
  youtube: ['https://*.googlevideo.com/*'],
};

const under = (host: string, base: string) => host === base || host.endsWith(`.${base}`);

/** Platform origin checks also cover feeds without a video ID in the URL. */
export function socialPagePlatform(value: string): SocialPlatform | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    if (['www.tiktok.com', 'm.tiktok.com', 'tiktok.com'].includes(url.hostname)) return 'tiktok';
    if (['www.instagram.com', 'instagram.com'].includes(url.hostname)) return 'instagram';
    if (['www.youtube.com', 'm.youtube.com', 'youtube.com'].includes(url.hostname)) return 'youtube';
  } catch { /* Unsupported page. */ }
  return null;
}

/** Only video links, never arbitrary URLs supplied by a page. Tracking is removed. */
export function socialLink(value: string): SocialLink | null {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    const host = url.hostname.toLowerCase(), path = url.pathname;
    if (['www.tiktok.com', 'm.tiktok.com', 'tiktok.com'].includes(host)) {
      const match = path.match(/^\/@([\w.-]+)\/video\/(\d+)\/?$/);
      if (match) return { platform: 'tiktok', id: match[2], url: `https://www.tiktok.com/@${match[1]}/video/${match[2]}` };
      if (/^\/t\/[\w-]+\/?$/.test(path)) return { platform: 'tiktok', id: '', url: `https://www.tiktok.com${path}` };
    }
    if (['vm.tiktok.com', 'vt.tiktok.com'].includes(host) && /^\/[\w-]+\/?$/.test(path)) return { platform: 'tiktok', id: '', url: `https://${host}${path}` };
    if (['www.instagram.com', 'instagram.com'].includes(host)) {
      const match = path.match(/^\/(reel|reels|p)\/([\w-]+)\/?$/);
      if (match) return { platform: 'instagram', id: match[2], url: `https://www.instagram.com/${match[1] === 'reels' ? 'reel' : match[1]}/${match[2]}/` };
    }
    if (['www.youtube.com', 'm.youtube.com', 'youtube.com', 'youtu.be'].includes(host)) {
      const id = host === 'youtu.be' ? path.slice(1) : path === '/watch' ? url.searchParams.get('v') : path.match(/^\/shorts\/([\w-]+)\/?$/)?.[1];
      if (id && /^[\w-]{11}$/.test(id)) return { platform: 'youtube', id, url: path.startsWith('/shorts/') ? `https://www.youtube.com/shorts/${id}` : `https://www.youtube.com/watch?v=${id}` };
    }
  } catch { /* Invalid or unsupported URL. */ }
  return null;
}

export function allowedMedia(value: string, platform: SocialPlatform): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return false;
    const bases = platform === 'tiktok' ? ['tiktok.com', 'tiktokcdn.com', 'tiktokv.com', 'byteoversea.com', 'ibytedtos.com']
      : platform === 'instagram' ? ['cdninstagram.com', 'fbcdn.net'] : ['googlevideo.com'];
    return bases.some(base => under(url.hostname, base));
  } catch { return false; }
}

export function sameVideo(wanted: SocialLink, current: SocialLink): boolean {
  return wanted.platform === current.platform && !!current.id && (!wanted.id || wanted.id === current.id);
}

export const platformName = (p: SocialPlatform) => ({ tiktok: 'TikTok', instagram: 'Instagram', youtube: 'YouTube' })[p];
export function unavailable(platform: SocialPlatform): string {
  return `${platformName(platform)} did not provide a downloadable video file. Private, restricted and segmented playback cannot be imported here. Download your own video using the platform's supported option, then choose Upload file.`;
}
