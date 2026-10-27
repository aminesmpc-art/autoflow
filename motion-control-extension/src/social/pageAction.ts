import { socialLink, socialPagePlatform, type SocialLink } from './policy';

export interface Viewport { width: number; height: number }
export interface Box { left: number; top: number; right: number; bottom: number; width: number; height: number }
export interface VideoPost { video: HTMLVideoElement; link: SocialLink; scope: HTMLElement }
const viewportFor = (doc: Document): Viewport => ({ width: doc.defaultView?.innerWidth || 1024, height: doc.defaultView?.innerHeight || 768 });
const visibleArea = (box: Box, viewport: Viewport) => Math.max(0, Math.min(box.right, viewport.width) - Math.max(0, box.left)) * Math.max(0, Math.min(box.bottom, viewport.height) - Math.max(0, box.top));

/** A feed must supply a permalink tied to this video, not a global suggested post. */
export function activeVideoPost(doc: Document, url: string, viewport = viewportFor(doc)): VideoPost | null {
  const platform = socialPagePlatform(url);
  if (!platform) return null;
  const videos = Array.from(doc.querySelectorAll('video')).filter(video => {
    const box = video.getBoundingClientRect();
    return box.width >= 120 && box.height >= 100 && visibleArea(box, viewport) >= 12_000;
  }).sort((a, b) => visibleArea(b.getBoundingClientRect(), viewport) - visibleArea(a.getBoundingClientRect(), viewport));
  const direct = socialLink(url);
  for (const video of videos) {
    if (direct?.id) return { video, link: direct, scope: video.closest<HTMLElement>('article') || video.parentElement || video };
    let scope = video.parentElement;
    for (let depth = 0; scope && depth < 10 && scope !== doc.body && scope !== doc.documentElement; depth++, scope = scope.parentElement) {
      // Crossing into a list of videos makes link association ambiguous.
      if (scope.querySelectorAll('video').length > 1) break;
      const links = new Map<string, SocialLink>();
      for (const anchor of Array.from(scope.querySelectorAll<HTMLAnchorElement>('a[href]'))) {
        try {
          const candidate = socialLink(new URL(anchor.getAttribute('href') || '', url).href);
          if (candidate?.id && candidate.platform === platform) links.set(candidate.id, candidate);
        } catch { /* Malformed page links are not video permalinks. */ }
      }
      if (links.size === 1) return { video, scope, link: links.values().next().value! };
      if (links.size > 1) break;
    }
  }
  return null;
}

/** Opportunistic native-rail alignment; no hashed platform CSS selectors. */
export function actionRail(doc: Document, video: Box, viewport = viewportFor(doc)): Box | undefined {
  const selectors = ['[data-e2e="like-icon"]', '[data-e2e="comment-icon"]', '[data-e2e="share-icon"]'];
  const markers = selectors.map(selector => Array.from(doc.querySelectorAll<HTMLElement>(selector)).find(el => {
    const box = el.getBoundingClientRect();
    return visibleArea(box, viewport) > 0 && box.top >= video.top && box.bottom <= video.bottom && box.left >= video.right - 100 && box.left <= video.right + 150;
  }));
  if (markers.some(marker => !marker)) return undefined;
  let container: HTMLElement | null = markers[0]!;
  while (container && !markers.every(marker => container!.contains(marker!))) container = container.parentElement;
  let rail: Box | undefined;
  for (; container && container !== doc.body; container = container.parentElement) {
    const box = container.getBoundingClientRect();
    if (box.width <= 0 || box.width > 120 || box.height > video.height || visibleArea(box, viewport) <= 0) break;
    rail = box;
  }
  return rail;
}

export function iconPosition(video: Box, viewport: Viewport, rail?: Box): { left: number; top: number; placement: 'rail' | 'video' } {
  const size = 48, gap = 12;
  const clampX = (x: number) => Math.max(gap, Math.min(viewport.width - size - gap, x));
  const clampY = (y: number) => Math.max(gap, Math.min(viewport.height - size - gap, y));
  if (rail && rail.top - size - gap >= Math.max(gap, video.top + gap)) {
    return { left: clampX(rail.left + (rail.width - size) / 2), top: clampY(rail.top - size - gap), placement: 'rail' };
  }
  // Unknown page layout: use the video's upper-right corner, not captions or
  // bottom playback controls. Never add the icon to a platform-managed stack.
  return { left: clampX(video.right - size - gap), top: clampY(video.top + gap), placement: 'video' };
}
