/**
 * @jest-environment jsdom
 */

/**
 * When is a Flow tile finished?
 *
 * A video node went green while Flow was still attaching the clip, and the
 * damage surfaced two nodes later as "The clip above ran but gave up no last
 * frame" — which reads like a problem with the clip and was a problem with
 * this question.
 *
 * The old answer was: the tile has a <video> carrying a src, a <source>, OR a
 * poster. That last one is not a clip. Flow paints the poster the instant it
 * has a first frame to show, seconds before the encoded video is attached.
 * Caught in that window:
 *
 *   - extractTileMediaUrl fell through to the poster, so the node's "video"
 *     was one JPEG;
 *   - captureVideoEndFrame ran ensureVideoLoaded on a source-less element,
 *     which cannot load, burned 10s and returned nothing;
 *   - the Last Frame node below it had no reference and said so.
 *
 * Every one of those is downstream of accepting a thumbnail as a clip.
 *
 * These tests build the DOM Flow actually renders in each phase and ask the
 * detector what it sees. jsdom does not fetch media, which is exactly right
 * here: a <video src> with no bytes behind it is precisely the "attached but
 * not loaded" element the page has.
 */

/// <reference types="node" />

import { readFileSync } from 'fs';
import { join } from 'path';
import { getStudioTileState } from '../content/flow/tileState';

/** A tile as Flow renders it, without the guesswork. */
function tile(inner: string): Element {
  const el = document.createElement('div');
  el.setAttribute('data-tile-id', 'fe_id_test');
  el.innerHTML = inner;
  document.body.appendChild(el);
  return el;
}

/* jsdom gives every element a 0x0 rect, and the detector skips images under
   20px as tracking pixels. Give the real ones a size so the test exercises
   the branch that runs on the page rather than the placeholder branch. */
function sized(el: Element, w = 400, h = 700): void {
  el.getBoundingClientRect = () => ({
    width: w, height: h, top: 0, left: 0, right: w, bottom: h, x: 0, y: 0,
    toJSON: () => ({}),
  }) as DOMRect;
}

afterEach(() => { document.body.innerHTML = ''; });

describe('a clip is finished when it is playable', () => {
  it('a <video> with a src is completed', () => {
    const t = tile('<video src="blob:https://labs.google/abc"></video>');
    expect(getStudioTileState(t)).toBe('completed');
  });

  it('a <video> with a <source> is completed', () => {
    const t = tile('<video><source src="blob:https://labs.google/abc"></video>');
    expect(getStudioTileState(t)).toBe('completed');
  });

  it('a poster with no clip behind it is NOT completed', () => {
    const t = tile('<video poster="https://lh3.googleusercontent.com/x=w400"></video>');
    /* The bug. This returned 'completed', and the node took a JPEG for a clip. */
    expect(getStudioTileState(t)).toBe('thumbnail-only');
  });

  it('a thumbnail <img> beside a source-less <video> does not vote either', () => {
    const t = tile('<video></video><img src="https://lh3.googleusercontent.com/x=w400">');
    sized(t.querySelector('img')!);
    /* Same race, one element to the left: Flow renders an <img> inside a video
       tile too, so an img-based completion check reintroduces it exactly. */
    expect(getStudioTileState(t)).toBe('thumbnail-only');
  });

  it('a still image tile is completed on its <img> alone', () => {
    const t = tile('<img src="https://lh3.googleusercontent.com/x=w400">');
    sized(t.querySelector('img')!);
    /* Image nodes must be untouched by all of this — they have no clip to
       wait for and no last frame to seek. */
    expect(getStudioTileState(t)).toBe('completed');
  });
});

describe('a clip tile that has only painted its thumbnail', () => {
  /* Measured on a live Veo 3.1 Fast tile: it renders an <img> with NO poster
     and NO <video> element at all, and attaches the <video> some time later.
     Omni Flash does not behave this way, which is why this survived until a
     workflow switched models. */
  it('is not finished just because it has a picture', () => {
    const t = tile('<img src="https://lh3.googleusercontent.com/x=w400">');
    sized(t.querySelector('img')!);
    /* The whole bug: without knowing a clip was asked for, the image branch
       says "completed" and the node is taken with no clip — no preview, no
       playable video, and no last frame for whatever is chained below it. */
    expect(getStudioTileState(t, true)).toBe('thumbnail-only');
  });

  it('is finished once the video arrives with a source', () => {
    const t = tile('<img src="https://lh3.googleusercontent.com/x=w400">'
      + '<video src="https://labs.google/fx/api/trp/abc"></video>');
    sized(t.querySelector('img')!);
    expect(getStudioTileState(t, true)).toBe('completed');
  });

  it('still lets a still image be finished on its picture alone', () => {
    /* The same DOM, asked for as an image, is a finished image. The flag is
       the only thing separating them. */
    const t = tile('<img src="https://lh3.googleusercontent.com/x=w400">');
    sized(t.querySelector('img')!);
    expect(getStudioTileState(t, false)).toBe('completed');
  });

  it('a failed clip is still failed, not waiting for a video', () => {
    const t = tile('<img src="https://lh3.googleusercontent.com/x=w400">'
      + '<div>Oops, something went wrong!</div>');
    sized(t.querySelector('img')!);
    expect(getStudioTileState(t, true)).toBe('failed');
  });
});

describe('the phases before it are still read first', () => {
  it('a blurred preview is generating, however real the <img> is', () => {
    const t = tile(
      '<div style="--blur-amount: 12px"><img src="https://lh3.googleusercontent.com/x=w400"></div>'
    );
    sized(t.querySelector('img')!);
    expect(getStudioTileState(t)).toBe('generating');
  });

  it("Flow's own percentage badge outranks a finished-looking clip", () => {
    const t = tile('<span>43%</span><video poster="https://lh3.googleusercontent.com/x"></video>');
    expect(getStudioTileState(t)).toBe('generating');
  });

  it('a failed clip is failed, not thumbnail-only', () => {
    /* A failed tile also has no playable source. Holding the video verdict
       until after the failure text is read is the only reason this works —
       returning early on the missing source turned every failed clip into a
       twenty-minute wait for a source that was never coming. */
    const t = tile('<video poster="https://lh3.googleusercontent.com/x"></video>'
      + '<div>Oops, something went wrong!</div>');
    expect(getStudioTileState(t)).toBe('failed');
  });

  it('an empty tile is unknown', () => {
    expect(getStudioTileState(tile('<div></div>'))).toBe('unknown');
  });
});

/**
 * The poller lives inside a 1900-line content script and needs a live
 * AutomationEngine to reach, so these read the source rather than run it.
 * They prove the wiring is present, NOT that it behaves — the behaviour is
 * covered above for the part that is pure, and on the live page for the rest.
 * They exist because each of these lines is one edit away from vanishing and
 * the symptom would be a twenty-minute wait, which is the slowest possible
 * way to find out.
 */
describe('the poller can recover a tile that scrolled out of the page', () => {
  const poller = readFileSync(
    join(__dirname, '..', 'content', 'flow', 'index.ts'), 'utf8'
  );

  it('scrolls the output back to the top when the tile goes missing', () => {
    /* Flow's grid is a virtuoso list: a tile scrolled out of view is removed
       from the document. Ours is the newest, so it lives at the top. Without
       this the poller waits out its entire budget on a finished generation. */
    expect(poller).toMatch(/scrollOutputToTop/);
    expect(poller).toMatch(/missStreak/);
  });

  it('does not fight the user for the scroll position', () => {
    /* Scrolling every second would take the gallery away from someone trying
       to look at it. Only on a real miss streak, and rate-limited. */
    expect(poller).toMatch(/REMOUNT_AFTER_MISSES = \d+/);
    expect(poller).toMatch(/REMOUNT_EVERY_MS = [\d_]+/);
  });

  it('waits a bounded time for a clip to attach, then says it gave up', () => {
    expect(poller).toMatch(/THUMBNAIL_GRACE_MS = [\d_]+/);
    expect(poller).toMatch(/without ever attaching a /);
  });

  it('says why it is still waiting, like every other adapter', () => {
    expect(poller).toMatch(/Waiting \$\{wait\}s — tile /);
    expect(poller).toMatch(/const ADAPTER_BUILD = '[^']+'/);
  });

  it("asks Flow's own API instead of only guessing from pixels", () => {
    /* apiHelper reads the responses to batchCheckAsyncVideoGenerationStatus
       as Flow's frontend polls it — no requests of our own. The queue engine
       has used it all along; this poller, the one the Studio canvas runs, was
       the last path still inferring completion from rendering artefacts. */
    expect(poller).toMatch(/findStatusByMediaId/);
    expect(poller).toMatch(/findStatusByPromptText/);
    expect(poller).toMatch(/isCacheFresh\(\)/);
  });

  it('refreshes a stale cache rather than reading "no news" as "no change"', () => {
    /* Flow stops polling when its tab is idle, so the cache goes stale and
       says nothing — which is not the same as nothing having happened. */
    expect(poller).toMatch(/activeStatusCheck\(/);
    expect(poller).toMatch(/API_RECHECK_MS = [\d_]+/);
  });

  it('acts on an API failure immediately, with the reason', () => {
    /* The DOM equivalent needs eight consecutive failed reads over twenty
       seconds, and only once Flow has painted something. The API knows first
       and knows why — which decides whether rewording would even help. */
    expect(poller).toMatch(/status\.state === 'failed'/);
    expect(poller).toMatch(/classifyError\(/);
  });

  it('will not expire the thumbnail grace while the service is still working', () => {
    /* The grace period is a guess about a state the DOM cannot resolve. When
       the API resolves it, the guess must not fire — a long render would be
       called finished at 45s and hand the next node an empty frame. */
    expect(poller).toMatch(/serviceStillWorking/);
    expect(poller).toMatch(/apiState === 'generating' \|\| apiState === 'queued'/);
  });

  it('still works with no API at all', () => {
    /* A tab loaded before the extension, or a Flow change, leaves the
       interceptor with nothing. Every API rule is inside a guard so the DOM
       path stays exactly as it was rather than the node failing outright. */
    expect(poller).toMatch(/if \(isApiAvailable\(\)\) \{/);
    expect(poller).toMatch(/API \$\{apiState \|\| \(isApiAvailable\(\) \? /);
  });

  it('distinguishes "never saw the tile" from "watched it time out"', () => {
    /* The two need completely different fixes, and the old message implied
       the second whichever had happened. */
    expect(poller).toMatch(/missStreak >= REMOUNT_AFTER_MISSES\s*\n?\s*\?/);
  });
});

/**
 * The active refresh needs a handler on the other end.
 *
 * apiHelper's activeStatusCheck routes through the service worker because
 * labs.google's CSP blocks injected <script> tags, so chrome.scripting is the
 * only way into the MAIN world where Flow's captured URL and auth live. The
 * original extension has that handler; Studio never had it, so the call
 * returned false forever — and false is indistinguishable from "checked, and
 * nothing has changed". A stale cache read as a generation standing still.
 */
describe('the service worker answers the active status check', () => {
  const worker = readFileSync(
    join(__dirname, '..', 'background', 'service-worker.ts'), 'utf8'
  );

  it('handles RUN_ACTIVE_CHECK', () => {
    expect(worker).toMatch(/msg\?\.type === 'RUN_ACTIVE_CHECK'/);
  });

  it('reaches the MAIN world, where the interceptor lives', () => {
    expect(worker).toMatch(/world: 'MAIN'/);
    expect(worker).toMatch(/__af_activeCheck/);
  });

  it('keeps the message channel open for the async reply', () => {
    /* Returning false here would close the port before executeScript
       resolves, and the caller would read the same false it read before. */
    const handler = worker.slice(worker.indexOf("RUN_ACTIVE_CHECK"));
    expect(handler.slice(0, handler.indexOf('\n  // ── Diagnostic'))).toMatch(/return true;/);
  });
});

describe('how long to wait for a clip that is known to exist', () => {
  const poller2 = readFileSync(
    join(__dirname, '..', 'content', 'flow', 'index.ts'), 'utf8');

  it('waits far longer once the service confirms the render finished', () => {
    /* Then the element is the only thing missing, and giving up produces
       three failures from one impatient decision: no preview, no playable
       clip, and no last frame for the node chained below. Measured on Veo 3.1
       Fast, whose gap between thumbnail and <video> is longer than the blind
       grace allowed — and longer than Omni Flash's, which is why this only
       appeared when a workflow changed models. */
    expect(poller2).toMatch(/CONFIRMED_GRACE_MS = 4 \* 60_000/);
    expect(poller2).toMatch(
      /const grace = apiState === 'completed' \? CONFIRMED_GRACE_MS : THUMBNAIL_GRACE_MS/);
  });

  it('tells the detector what the node asked Flow for', () => {
    /* Without it the image branch answers for a clip, and a thumbnail counts
       as a finished video. */
    expect(poller2).toMatch(/getStudioTileState\(trackedTile, isVideoNode\)/);
  });
});
