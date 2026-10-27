import { activeVideoPost, actionRail, iconPosition, type Box } from '../src/social/pageAction';
import { socialPagePlatform } from '../src/social/policy';

const doc = (html: string) => new DOMParser().parseFromString(html, 'text/html');
const viewport = { width: 1100, height: 880 };
const videoBox: Box = { left: 160, top: 24, right: 980, bottom: 840, width: 820, height: 816 };
const box = (el: Element, value = videoBox) => jest.spyOn(el, 'getBoundingClientRect').mockReturnValue(value as DOMRect);

test('direct video pages use the visible player; offscreen, tiny and non-video pages stay clean', () => {
  const d = doc('<video></video>');
  const mock = box(d.querySelector('video')!);
  const url = 'https://www.tiktok.com/@creator/video/123';
  expect(activeVideoPost(d, url, viewport)?.link.id).toBe('123');
  expect(activeVideoPost(d, 'https://www.tiktok.com/@creator', viewport)).toBeNull();
  mock.mockReturnValue({ ...videoBox, top: 1000, bottom: 1800 } as DOMRect);
  expect(activeVideoPost(d, url, viewport)).toBeNull();
  mock.mockReturnValue({ left: 0, top: 0, right: 64, bottom: 64, width: 64, height: 64 } as DOMRect);
  expect(activeVideoPost(d, url, viewport)).toBeNull();
});

test('TikTok feed selects the permalink associated with the visible post, not a suggested video', () => {
  const d = doc('<main><article><video></video><a href="/@creator/video/123">Caption</a><a href="http://[">Bad link</a></article><aside><a href="/@other/video/456">Suggested</a></aside></main>');
  box(d.querySelector('video')!);
  const post = activeVideoPost(d, 'https://www.tiktok.com/foryou', viewport);
  expect(post?.link.url).toBe('https://www.tiktok.com/@creator/video/123');
  expect(post?.scope.tagName).toBe('ARTICLE');
});

test('Instagram feed selects a visible Reel permalink; duplicate anchors do not make it ambiguous', () => {
  const d = doc('<article><div><video></video></div><a href="/reel/AbCd123/">Reel</a><a href="/reel/AbCd123/?utm=ignore">Same Reel</a></article>');
  box(d.querySelector('video')!);
  expect(activeVideoPost(d, 'https://www.instagram.com/reels/', viewport)?.link.id).toBe('AbCd123');
});

test('ambiguous feed associations are never guessed', () => {
  const d = doc('<article><video></video><a href="/@c/video/123">One</a><a href="/@c/video/456">Two</a></article>');
  box(d.querySelector('video')!);
  expect(activeVideoPost(d, 'https://www.tiktok.com/foryou', viewport)).toBeNull();
});

test('scrolling chooses the new visible post and does not reuse the previous URL', () => {
  const d = doc('<main><article><video id="first"></video><a href="/@c/video/123">One</a></article><article><video id="second"></video><a href="/@c/video/456">Two</a></article></main>');
  const first = box(d.getElementById('first')!), second = box(d.getElementById('second')!, { ...videoBox, top: 1000, bottom: 1816 });
  expect(activeVideoPost(d, 'https://www.tiktok.com/foryou', viewport)?.link.id).toBe('123');
  first.mockReturnValue({ ...videoBox, top: -1000, bottom: -184 } as DOMRect); second.mockReturnValue(videoBox as DOMRect);
  expect(activeVideoPost(d, 'https://www.tiktok.com/foryou', viewport)?.link.id).toBe('456');
});

test('aligns above a narrow native action rail without moving existing platform controls', () => {
  const d = doc('<div id="rail"><img /><button data-e2e="like-icon"></button><button data-e2e="comment-icon"></button><button data-e2e="share-icon"></button></div>');
  const rail: Box = { left: 998, right: 1058, top: 368, bottom: 826, width: 60, height: 458 };
  box(d.getElementById('rail')!, rail);
  d.querySelectorAll('button').forEach((el, index) => box(el, { left: 998, right: 1058, top: 462 + index * 95, bottom: 522 + index * 95, width: 60, height: 60 }));
  const before = d.body.innerHTML;
  expect(actionRail(d, videoBox, viewport)).toEqual(rail);
  expect(iconPosition(videoBox, viewport, rail)).toEqual({ left: 1004, top: 308, placement: 'rail' });
  expect(d.body.innerHTML).toBe(before);
});

test('fallback icon fits the video and narrow viewports without covering bottom playback controls', () => {
  const pos = iconPosition(videoBox, viewport);
  expect(pos).toEqual({ left: 920, top: 36, placement: 'video' });
  for (const width of [320, 375, 420]) {
    const position = iconPosition({ ...videoBox, left: 0, right: width, width }, { width, height: 700 });
    expect(position.left).toBeGreaterThanOrEqual(12);
    expect(position.left + 48).toBeLessThanOrEqual(width - 12);
    expect(position.top + 48).toBeLessThan(videoBox.bottom - 50);
  }
});

test.each(['https://www.tiktok.com/foryou', 'https://www.instagram.com/reels/', 'https://www.youtube.com/'])('recognizes trusted feed origin %s', value => expect(socialPagePlatform(value)).toBeTruthy());
test.each(['https://tiktok.com.evil.test/', 'http://www.tiktok.com/', 'https://user:password@www.tiktok.com/', 'https://www.tiktok.com:444/'])('rejects untrusted feed origin %s', value => expect(socialPagePlatform(value)).toBeNull());
