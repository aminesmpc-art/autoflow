/**
 * @jest-environment jsdom
 */

/// <reference types="node" />

import * as fs from 'fs';
import * as path from 'path';

/**
 * Why a Last Frame node came back empty.
 *
 * Live log, two clips in the same run, ninety seconds apart:
 *
 *   15:51:45  Tile completed! (fe_id_7172dce7…)
 *   15:51:47  Last frame captured (35KB)
 *   15:53:03  Tile completed! (fe_id_74f52bbb…)
 *   15:53:06  Last frame: nothing captured from this clip
 *
 * Same code, same page, one worked. Three seconds is the tell: ~1s to load,
 * then the 2s seek timeout, then a draw that produced nothing.
 *
 * `seeked` says the playhead MOVED. It does not say a frame at that position
 * has been decoded — and while the browser fetches the new byte range,
 * readyState drops back to HAVE_METADATA (1). The old capture seeked, waited
 * at most 2s for the event, and drew immediately; captureVideoFrame bails at
 * readyState < 2 and returns an empty string with no sound. So on any clip
 * whose tail arrived a moment late, the frame node was empty, and the clip
 * wired below it failed for want of a reference it could not have got.
 *
 * A second contributor: ensureVideoLoaded restored preload="none" the instant
 * metadata arrived — BEFORE the seek to the end had started. Seeking a
 * preload="none" element into an unfetched range is precisely the case most
 * likely to arrive late.
 *
 * jsdom implements none of the media pipeline, so these tests drive a fake
 * <video> that reproduces the timing: readyState drops on seek and recovers
 * after a delay the test chooses.
 */

/// <reference types="node" />

/**
 * A <video> that behaves like a real one during a seek: the playhead moves
 * immediately, `seeked` fires, and the frame only becomes decodable later.
 */
function fakeVideo(opts: {
  duration: number;
  /** ms after a seek before readyState climbs back to HAVE_CURRENT_DATA */
  decodeDelayMs: number;
  /** seek targets that never decode at all, however long we wait */
  undecodable?: (t: number) => boolean;
}): any {
  const listeners = new Map<string, Set<() => void>>();
  const v: any = {
    duration: opts.duration,
    videoWidth: 720,
    videoHeight: 1280,
    readyState: 2,
    _currentTime: 0,
    /** preload as it stood at the moment of each seek. */
    preloadAtSeek: [] as string[],
    _attrs: new Map<string, string>([['preload', 'none']]),
    getAttribute: (k: string) => (v._attrs.has(k) ? v._attrs.get(k) : null),
    setAttribute: (k: string, val: string) => v._attrs.set(k, val),
    removeAttribute: (k: string) => v._attrs.delete(k),
    addEventListener: (ev: string, fn: () => void) => {
      if (!listeners.has(ev)) listeners.set(ev, new Set());
      listeners.get(ev)!.add(fn);
    },
    removeEventListener: (ev: string, fn: () => void) => listeners.get(ev)?.delete(fn),
    load: () => {},
    _fire: (ev: string) => listeners.get(ev)?.forEach((fn) => fn()),
  };
  // A real element reflects the property into the attribute; keeping them
  // separate hid which value the seek actually ran under.
  Object.defineProperty(v, 'preload', {
    get: () => v._attrs.get('preload') ?? '',
    set: (val: string) => v._attrs.set('preload', val),
  });
  Object.defineProperty(v, 'currentTime', {
    get: () => v._currentTime,
    set: (t: number) => {
      v._currentTime = t;
      v.preloadAtSeek.push(v.preload);
      // The browser drops back while it fetches and decodes the new range.
      v.readyState = 1;
      setTimeout(() => v._fire('seeked'), 5);
      if (!opts.undecodable?.(t)) {
        setTimeout(() => { v.readyState = 2; v._fire('canplay'); }, opts.decodeDelayMs);
      }
    },
  });
  return v;
}

/** Stand in for the canvas: any draw at readyState >= 2 yields bytes. */
function stubCanvas(): void {
  (HTMLCanvasElement.prototype as any).getContext = () => ({ drawImage: () => {} });
  (HTMLCanvasElement.prototype as any).toDataURL = () => 'data:image/jpeg;base64,AAAA';
}

import { captureVideoEndFrame } from '../content/flow/videoFrames';

beforeAll(stubCanvas);

describe('capturing the last frame of a clip', () => {
  it('waits for the frame to decode instead of drawing a blank one', async () => {
    const logged: string[] = [];
    /* 900ms is well past the old 2s-seek-then-draw-immediately path's blind
       spot and well inside a real clip's tail latency. */
    const v = fakeVideo({ duration: 8, decodeDelayMs: 900 });
    expect(await captureVideoEndFrame(v, (l) => logged.push(l))).toBe('data:image/jpeg;base64,AAAA');
  }, 30_000);

  it('falls back to a moment earlier when the very last frame will not decode', async () => {
    const logged: string[] = [];
    const v = fakeVideo({
      duration: 8,
      decodeDelayMs: 200,
      undecodable: (t) => t > 7.9,   // only the final sliver is unreadable
    });
    expect(await captureVideoEndFrame(v, (l) => logged.push(l))).toBe('data:image/jpeg;base64,AAAA');
    /* Still the end of the shot for continuity, and infinitely better than
       the nothing that failed the node below it. */
    expect(logged.join('\n')).toMatch(/taken 0\.30s before the end/);
  }, 30_000);

  it('reports the numbers when it truly cannot capture', async () => {
    const logged: string[] = [];
    const v = fakeVideo({ duration: 8, decodeDelayMs: 200, undecodable: () => true });
    expect(await captureVideoEndFrame(v, (l) => logged.push(l))).toBe('');
    /* "nothing captured from this clip" covered four different causes and
       named none of them. readyState and the target say which one it was. */
    expect(logged.join('\n')).toMatch(/nothing decodable at 7\.95s of 8\.00s \(readyState 1/);
    // All three targets tried before giving up — the giving up is the slow path.
    expect(logged.filter((l) => l.includes('nothing decodable'))).toHaveLength(3);
  }, 30_000);

  it('keeps preload open until the capture is finished, then restores it', async () => {
    const logged: string[] = [];
    const v = fakeVideo({ duration: 8, decodeDelayMs: 900 });
    v.readyState = 0;                       // nothing loaded, as Flow ships it
    setTimeout(() => { v.readyState = 2; v._fire('canplay'); }, 100);
    await captureVideoEndFrame(v, (l) => logged.push(l));
    /* The seek must run with preload open. Restoring "none" the instant
       metadata arrived — as it used to, before the seek had even started — is
       what made the tail arrive late and the capture come back empty. */
    expect(v.preloadAtSeek.length).toBeGreaterThan(0);
    expect(v.preloadAtSeek).not.toContain('none');
    // And Flow's own lazy loading is put back once we are done with it.
    expect(v.getAttribute('preload')).toBe('none');
  });

  it('puts the playhead back so the tile on the page looks untouched', async () => {
    const logged: string[] = [];
    const v = fakeVideo({ duration: 8, decodeDelayMs: 100 });
    v.currentTime = 0;
    await captureVideoEndFrame(v, (l) => logged.push(l));
    expect(v.currentTime).toBe(0);
  });
});

/**
 * A Last Frame node that came back holding the FIRST frame.
 *
 * The node sat next to its clip showing the black opening of the shot —
 * before the reveal — and handed that to the clip chained below it as the
 * thing to continue from.
 *
 * seekVideo returned void and resolved identically whether the seek finished
 * or its own three-second timeout fired. The caller could not tell those
 * apart, so it drew whatever was on screen; on a video that never seeked,
 * that is frame 0. Nothing failed, nothing was logged, and the frame looked
 * perfectly plausible — it was simply the wrong end of the shot.
 *
 * The event on its own is not proof either: Chrome fires 'seeked' for a seek
 * it clamped to a range it actually holds, which on an unfetched tail can
 * land far from where it was asked to go. So the position is checked too.
 */
describe('a frame is only taken where the playhead really is', () => {
  const SRC = fs.readFileSync(
    path.resolve(__dirname, '../content/flow/videoFrames.ts'), 'utf8').replace(/\r\n/g, '\n');
  const bare = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

  it('reports whether the seek happened', () => {
    expect(bare).toMatch(/export async function seekVideo\([^)]*\): Promise<boolean>/);
  });

  it('does not call a timeout a successful seek', () => {
    expect(bare).toMatch(/setTimeout\(\(\) => finish\(false\), 3000\)/);
  });

  it('checks where the playhead landed, not just that it moved', () => {
    /* A seek is clamped to what is buffered, and 'seeked' fires for that. */
    expect(bare).toMatch(/Math\.abs\(video\.currentTime - target\) <= 0\.5/);
  });

  it('skips the target instead of drawing from the wrong place', () => {
    expect(bare).toMatch(/if \(!await seekVideo\(video, target\)\) \{/);
  });

  it('says so when it could not seek there', () => {
    expect(SRC).toMatch(/not drawing from there/);
  });

  it('guards the downloaded-clip path the same way', () => {
    /* It had the same hole, and a worse ending: `last: last || first`
       substituted the opening frame with nothing said. */
    expect(bare).toMatch(/if \(!await seekVideo\(video, target\)\) continue;/);
  });

  it('announces a first-frame substitution rather than passing it off', () => {
    expect(SRC).toMatch(/OPENING frame is/);
    expect(SRC).toMatch(/continuity from this node will be wrong/);
  });
});
