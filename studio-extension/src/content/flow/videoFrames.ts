/* ============================================================
   Getting a still off a Flow <video>.

   Split out of the content script for the same reason studioFrames.ts was:
   the rule is subtle, the failure is silent, and it decides whether the node
   chained below gets a reference at all. Inside a 1900-line file that needs a
   live page to load, none of it could be tested.
   ============================================================ */

import { sleep } from './selectors';

/** Diagnostic sink — the content script passes its own logLine in. */
export type Log = (line: string) => void;

/** Draw the current frame of a page <video> to a downscaled JPEG data URL.
    blob: video sources are same-origin, so the canvas stays untainted. */
export function captureVideoFrame(video: HTMLVideoElement): string {
  try {
    if (video.readyState < 2 || !video.videoWidth) return '';
    const scale = Math.min(1, 512 / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.82);
  } catch (e: any) {
    console.warn(`[AutoFlow Studio] Video frame capture failed: ${e?.message || e}`);
    return '';
  }
}

/**
 * Get enough of a clip loaded that it can be seeked and drawn.
 *
 * `preload="none"` means the browser has fetched nothing — not even metadata —
 * so duration is NaN and drawing the element produces an empty canvas. Setting
 * preload and calling load() starts the fetch; readyState >= 2 (HAVE_CURRENT_DATA)
 * is the point at which drawImage returns pixels.
 *
 * The attribute is restored afterwards so Flow's own lazy-loading behaviour is
 * unchanged for the user. Returns false rather than throwing: a clip that will
 * not load is a reason to report no frame, never a reason to fail the run.
 */
export async function ensureVideoLoaded(video: HTMLVideoElement): Promise<boolean> {
  const ready = () => video.readyState >= 2 && isFinite(video.duration) && video.duration > 0;
  if (ready()) return true;

  /* Left as 'auto' on purpose — the caller restores it once the whole capture
     is done. It used to be put back here, before the seek to the end had even
     started, and seeking a preload="none" element to a range the browser has
     not fetched is the one case most likely to arrive late. */
  video.preload = 'auto';
  try { video.load(); } catch { /* already loading */ }

  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      for (const ev of ['loadeddata', 'canplay', 'loadedmetadata', 'error']) {
        video.removeEventListener(ev, check);
      }
      resolve();
    };
    const check = () => { if (ready()) finish(); };
    // 10s: a Flow clip is a few MB and this happens once per node. Longer than
    // the seek timeout below because fetching bytes is the slow part.
    const timer = setTimeout(finish, 10_000);
    for (const ev of ['loadeddata', 'canplay', 'loadedmetadata', 'error']) {
      video.addEventListener(ev, check);
    }
    check();
  });

  return ready();
}

/**
 * Capture the LAST frame of a page <video>.
 *
 * Chained workflows hand one clip's ending to the next clip as its opening
 * frame — that handoff is the whole continuity technique. After a generation
 * the element sits at time 0, so capturing "the current frame" would pass the
 * clip's *start* downstream and the subject would reset on every clip instead
 * of progressing. Seeks to the end, captures, then puts the playhead back so
 * the tile on the page looks untouched.
 */
export async function captureVideoEndFrame(
  video: HTMLVideoElement, logLine: Log = () => {}
): Promise<string> {
  /* Flow renders its tiles with preload="none", so the element usually holds
     no data at all: duration is NaN, readyState is 0, and every seek below is
     pointless. This used to bail straight to the poster — the clip's OPENING
     frame — so a Last Frame node showed the start of the shot it was supposed
     to end, and the chain silently restarted on every link.

     Loading it is the whole fix. The element is left as we found it — which
     means reading preload HERE, before ensureVideoLoaded overwrites it.
     Read afterwards it says 'auto', and "restoring" it hands the page back a
     tile that eagerly downloads its clip forever after. */
  const originalPreload = video.getAttribute('preload');

  if (!(await ensureVideoLoaded(video))) {
    restorePreload(video, originalPreload);
    /* Diagnostics, not just the console. This is the moment a Last Frame node
       is decided, and until now the only record of it was a warning in the
       Flow tab — so the panel showed an empty frame box, the dependent clip
       failed, and nothing anywhere said the two were connected. */
    logLine('Last frame: the clip would not load, so no end frame was captured');
    console.warn('[AutoFlow Studio] Clip would not load, so no end frame could be captured');
    return '';
  }

  const duration = video.duration;
  if (!isFinite(duration) || duration <= 0) {
    const now = captureVideoFrame(video);
    restorePreload(video, originalPreload);
    return now;
  }

  const original = video.currentTime;

  /* Targets, latest first. The final frame is the whole point of this
     function, but it is also the one most likely to sit in a byte range the
     browser has not fetched and cannot decode in time. Half a second earlier
     is still the end of the shot for continuity purposes and is far more
     likely to be sitting in the buffer — much better than the nothing this
     returned before, which failed the node chained below it. */
  const targets = [duration - 0.05, duration - 0.3, duration - 1]
    .filter((t) => t > 0);

  try {
    for (const target of targets) {
      await seekVideo(video, target);
      const frame = await drawWhenDecodable(video);
      if (frame) {
        if (target !== targets[0]) {
          logLine(`Last frame: taken ${(duration - target).toFixed(2)}s before the end `
            + '(the final frame would not decode in time)');
        }
        return frame;
      }
      logLine(
        `Last frame: nothing decodable at ${target.toFixed(2)}s of ${duration.toFixed(2)}s `
        + `(readyState ${video.readyState}, ${video.videoWidth}x${video.videoHeight})`
      );
    }
    return '';
  } catch (e: any) {
    logLine(`Last frame: seeking threw — ${e?.message || e}`);
    return '';
  } finally {
    try { video.currentTime = original; } catch { /* leave it wherever it is */ }
    // Flow's own lazy-loading behaviour restored, now that we are done with it.
    restorePreload(video, originalPreload);
  }
}

/** Put Flow's lazy loading back exactly as we found it. */
function restorePreload(video: HTMLVideoElement, original: string | null): void {
  if (original === null) video.removeAttribute('preload');
  else video.preload = original as any;
}

/** Move the playhead and wait for the browser to admit it has moved. */
export async function seekVideo(video: HTMLVideoElement, target: number): Promise<void> {
  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      video.removeEventListener('seeked', finish);
      resolve();
    };
    // Never hang a run on a video that refuses to seek.
    const timer = setTimeout(finish, 3000);
    video.addEventListener('seeked', finish);
    try { video.currentTime = target; } catch { finish(); }
  });
}

/**
 * Draw once there is actually a frame to draw.
 *
 * This is the bug that emptied Last Frame nodes. 'seeked' says the playhead
 * moved; it does not say a frame at that position has been decoded, and while
 * the browser fetches the new range readyState drops back to HAVE_METADATA.
 * The old code seeked, waited at most 2s for the event, then drew immediately —
 * so on any clip where the tail took a moment to arrive, captureVideoFrame saw
 * readyState 1 and silently returned an empty string. The node reported "no
 * last frame", and the clip wired below it failed for want of a reference it
 * had no way to get. Intermittent by nature, which is why one clip in the same
 * run succeeded and the next did not.
 */
export async function drawWhenDecodable(video: HTMLVideoElement, budgetMs = 4000): Promise<string> {
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    if (video.readyState >= 2 && video.videoWidth > 0) {
      const frame = captureVideoFrame(video);
      if (frame) return frame;
    }
    await sleep(120);
  }
  return '';
}

