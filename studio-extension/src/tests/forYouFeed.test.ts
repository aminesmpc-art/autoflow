/** @jest-environment jsdom */
/// <reference types="node" />
/**
 * For You (2026-10-29). The owner asked for the community to be what
 * everyone sees first when Studio opens, "like a FYP", with the rest after
 * it: Studio's home is now the feed, most liked first, and every official
 * template under it in its own section. The side panel's template list opens
 * on Community the same way.
 *
 * The feed was built as the whole page, loading pages forever as you scroll.
 * With the templates underneath, that would have buried them: the grid could
 * not be reached until every post ever made had loaded.
 */
import { createElement, act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { readFileSync } from 'fs';
import { join } from 'path';

const mockLoad = jest.fn();
jest.mock('../studio/community/community.css', () => ({}));
jest.mock('../studio/community/PostComposer', () => ({ __esModule: true, default: () => null }));
jest.mock('../studio/community/feedApi', () => ({
  loadFeedPage: (...a: any[]) => mockLoad(...a),
  loadMe: () => Promise.resolve({ signedIn: false }),
  toggleLike: jest.fn(), reportPost: jest.fn(), deletePost: jest.fn(), fetchPostWorkflow: jest.fn(),
  REPORT_REASONS: [],
}));
const CommunityFeed = require('../studio/community/CommunityFeed').default;

const read = (...p: string[]) => readFileSync(join(__dirname, '..', ...p), 'utf8').replace(/\r\n/g, '\n');

const post = (id: string) => ({
  id, name: `Post ${id}`, description: '', author: 'Someone', likes: 0, installs: 0, liked: false,
  mine: false, nodeCount: 2, createdAt: null, outline: { nodes: [], edges: [] },
});

/* An observer that reports the sentinel on screen the moment it is watched —
   the worst case, a short page where it never leaves the viewport. */
class SeenAtOnce {
  constructor(private cb: (e: any[]) => void) {}
  observe() { this.cb([{ isIntersecting: true }]); }
  disconnect() {}
}

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  (globalThis as any).IntersectionObserver = SeenAtOnce;
  mockLoad.mockReset();
  mockLoad.mockImplementation((_sort: string, offset: number) =>
    Promise.resolve({ ok: true, posts: [post(`p${offset}`)], next: offset < 36 ? offset + 12 : null }));
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

const settle = async () => { for (let i = 0; i < 5; i++) await act(async () => { await Promise.resolve(); }); };
const mount = async (props: any) => {
  await act(async () => root.render(createElement(CommunityFeed, { onUse: () => {}, ...props })));
  await settle();
};
const moreButton = () => Array.from(host.querySelectorAll('button')).find((b) => b.textContent === 'See more posts');

describe('the feed on For You', () => {
  it('opens on the most liked posts', async () => {
    await mount({ stepped: true });
    expect(mockLoad.mock.calls[0]).toEqual(['top', 0]);
    const tabs = Array.from(host.querySelectorAll('.cf-sort__tab')).map((t) => t.textContent);
    expect(tabs).toEqual(['Popular', 'New']);
    expect(host.querySelector('.cf-sort__tab--on')!.textContent).toBe('Popular');
  });

  it('loads one page by itself and waits to be asked for the next', async () => {
    await mount({ stepped: true });
    expect(mockLoad).toHaveBeenCalledTimes(1);
    expect(host.querySelectorAll('.cf-post')).toHaveLength(1);
    expect(moreButton()).toBeDefined();

    await act(async () => { moreButton()!.click(); });
    await settle();
    expect(mockLoad).toHaveBeenCalledTimes(2);
    expect(mockLoad.mock.calls[1]).toEqual(['top', 12]);
    expect(host.querySelectorAll('.cf-post')).toHaveLength(2);
  });

  it('starts over from one page when the sort changes', async () => {
    await mount({ stepped: true });
    const newest = Array.from(host.querySelectorAll('.cf-sort__tab')).find((t) => t.textContent === 'New')!;
    await act(async () => { (newest as HTMLButtonElement).click(); });
    await settle();
    expect(mockLoad.mock.calls.map((c) => c.join(':'))).toEqual(['top:0', 'new:0']);
  });

  it('says it has reached the end instead of offering more', async () => {
    mockLoad.mockImplementation(() => Promise.resolve({ ok: true, posts: [post('only')], next: null }));
    await mount({ stepped: true });
    expect(moreButton()).toBeUndefined();
    expect(host.textContent).toContain("You're all caught up.");
  });

  it('still scrolls on by itself when nothing sits below it', async () => {
    /* The unstepped feed is unchanged: the observer keeps asking. */
    await mount({});
    expect(mockLoad.mock.calls.length).toBeGreaterThan(1);
    expect(moreButton()).toBeUndefined();
  });
});

describe('Studio opens on For You', () => {
  const gallery = read('studio', 'components', 'TemplateGallery.tsx');

  it('is the first tab and the one selected at start', () => {
    expect(gallery).toMatch(/useState<string>\(FOR_YOU\)/);
    const tabs = gallery.slice(gallery.indexOf('<div className="studio-gallery__tabs">'));
    expect(tabs.indexOf('onClick={() => setCategory(FOR_YOU)}')).toBeGreaterThan(-1);
    expect(tabs.indexOf('onClick={() => setCategory(FOR_YOU)}')).toBeLessThan(tabs.indexOf('CATEGORIES'));
  });

  it('replaces both All and the old Community tab', () => {
    /* For You already holds every template; an "All" tab beside it would be
       the same grid without the feed. */
    expect(gallery).toMatch(/CATEGORIES\.filter\(\(cat\) => cat !== 'All'\)/);
    expect(gallery).not.toMatch(/setCategory\('Community'\)/);
    expect(gallery).toMatch(/if \(category !== FOR_YOU && t\.category !== category\) return false;/);
  });

  it('puts the feed first and the official templates under their own heading', () => {
    const feed = gallery.indexOf('<CommunityFeed');
    const heading = gallery.indexOf('More from AutoFlow');
    const grid = gallery.indexOf('{/* Template Grid */}');
    expect(feed).toBeGreaterThan(-1);
    expect(heading).toBeGreaterThan(feed);
    expect(grid).toBeGreaterThan(heading);
    expect(gallery).toMatch(/<CommunityFeed onUse=\{loadTemplate\} pending=\{pendingPost\} onPendingTaken=\{takePending\} stepped \/>/);
  });

  it('keeps the feed mounted while searching, hidden on a wrapper with no display rule', () => {
    expect(gallery).toMatch(/<div hidden=\{!!query\.trim\(\)\}>/);
  });

  it('sends "Post to community" from the canvas or the panel to For You', () => {
    expect(gallery).toMatch(/if \(toPost \|\| community\) \{[\s\S]{0,200}setCategory\(FOR_YOU\);/);
  });
});

describe('the side panel opens on Community too', () => {
  const panel = read('sidepanel', 'index.ts');

  it('starts on Community', () => {
    expect(panel).toMatch(/let templateSource: TemplateSourceTab = 'community';/);
    expect(panel).toMatch(/void setTemplateSource\(templateSource\)\.then/);
  });

  it('falls back to the official set when the community comes back empty', () => {
    /* A failed fetch also returns an empty list, so this is the outage path
       as well as the nothing-shared-yet one. */
    expect(panel).toMatch(/if \(templateSource === 'community' && !communityCards\.length\) void setTemplateSource\('official'\);/);
  });

  it('never draws the official grid over the community list', () => {
    /* The two share #tpl-grid. The loader used to redraw it unconditionally
       whenever templates arrived, which is harmless only while Official is
       the tab that opens first. */
    const start = panel.indexOf('loadTemplates()\n    .then(({ templates }) => {');
    const loader = panel.slice(start, panel.indexOf('.catch(', start));
    expect(loader.match(/renderTemplates\(\)/g)).toHaveLength(2);
    expect(loader.match(/if \(templateSource === 'official'\) renderTemplates\(\);/g)).toHaveLength(2);
  });
});
