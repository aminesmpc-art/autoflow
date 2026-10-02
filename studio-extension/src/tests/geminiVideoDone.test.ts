/**
 * A finished Gemini clip that the run kept waiting for.
 *
 * The node sat at "Generating video… 32%", diagnostics reading "Submitted —
 * waiting for the clip", while the Gemini tab beside it had the whole thing
 * rendered and playing: 0:10 of 0:10.
 *
 * ── Why it waited ─────────────────────────────────────────────────────────
 *
 * trackVideo opens its gate on
 *
 *   stableCount >= 2 && !isGenerating() && turnFinished() !== false
 *
 * and BOTH of the last two read a text answer's furniture.
 *
 * turnFinished() looks for a Copy button. A video turn has none — its footer
 * is the player's own controls, and nothing else:
 *
 *   <video-player>
 *     <video src="https://contribution.usercontent.google.com/download?…">
 *     aria-label="Download video" / "Share video" / "Mute video" / "Play video"
 *
 * so it returned false on every poll, forever. Its own docstring said it
 * returns null when it cannot tell, precisely so the caller's `!== false`
 * blocks only on an explicit "still going" — but the code returned false for
 * "I did not find the button I know about", which is not the same claim.
 *
 * ── Verified by generating one ────────────────────────────────────────────
 *
 * A clip was generated on gemini.google.com/videos and both versions of the
 * predicate run against the finished turn:
 *
 *   turnFinished() before   false   <- blocked the gate, forever
 *   turnFinished() after    true    <- opens
 *
 * and the turn's aria-labels were exactly: Download video, Share video, Mute
 * video, Play video, Good response, Bad response, Redo. No Copy anywhere.
 *
 * The same run corrected a second guess. isGenerating() was suspected too,
 * for waiting on a `complete` class that belongs to a text answer's footer —
 * but the video turn's footer DID carry `complete`, so isGenerating() already
 * returned false and was never the blocker. turnFinished() was the whole of
 * it. The isGenerating change stays as a guard for a turn whose footer never
 * completes, but it is not what fixed this and should not be described as it.
 *
 * ── The signal ────────────────────────────────────────────────────────────
 *
 * Download video. Gemini offers it only once there is a file to download, so
 * its presence means the clip is real and complete — and it is an aria-label,
 * so it does not depend on a class name that can be renamed.
 */

/// <reference types="node" />

import * as fs from 'fs';
import * as path from 'path';

const SRC = fs
  .readFileSync(path.resolve(__dirname, '../content/gemini/index.ts'), 'utf8')
  .replace(/\r\n/g, '\n');

/** Source with comments stripped, so prose cannot satisfy an assertion. */
const codeOnly = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

/** One function's body. */
const fn = (name: string): string => {
  const m = new RegExp(`function ${name}\\([\\s\\S]*?\\n\\}`).exec(SRC);
  if (!m) throw new Error(`${name} not found`);
  return m[0];
};

describe('a video turn is not "still generating"', () => {
  it('does not report false merely because Copy is absent', () => {
    /* The whole bug in one line: a video turn has no Copy, and that was read
       as evidence the turn was still running. */
    const body = codeOnly(fn('turnFinished'));
    expect(body).not.toMatch(/return !!Array\.from/);
    expect(body).toMatch(/return null;/);
  });

  it('accepts the player’s own controls as finished', () => {
    const body = codeOnly(fn('turnFinished'));
    expect(body).toMatch(/download\|share/i);
    expect(body).toMatch(/video/i);
  });

  it('still accepts Copy, which is how a text turn ends', () => {
    const body = codeOnly(fn('turnFinished'));
    expect(body).toMatch(/fonticon="copy"/);
    expect(body).toMatch(/return true;/);
  });

  it('keeps returning null when there are no turns at all', () => {
    /* "Nothing has happened yet" must not read as "finished". */
    expect(codeOnly(fn('turnFinished'))).toMatch(/if \(!turns\.length\) return null;/);
  });
});

describe('isGenerating stops waiting for a text footer', () => {
  it('treats a rendered clip as finished', () => {
    const body = codeOnly(fn('isGenerating'));
    expect(body).toMatch(/download\\s\+video/i);
    expect(body).toMatch(/if \(playable\) return false;/);
  });

  it('checks that before the response-footer class', () => {
    /* The class belongs to a text answer's footer and need never arrive on a
       video turn, so consulting it first is what hung. */
    const body = codeOnly(fn('isGenerating'));
    expect(body.indexOf('playable')).toBeLessThan(body.indexOf('response-footer'));
  });

  it('still yields to an explicit aria-busy', () => {
    /* Gemini maintains that for screen readers; it outranks our inference. */
    const body = codeOnly(fn('isGenerating'));
    expect(body.indexOf('aria-busy')).toBeLessThan(body.indexOf('playable'));
  });
});

describe('the gate the two of them feed', () => {
  it('still needs the clip URL to hold still', () => {
    /* Two unchanged polls, so a src that is still being swapped in does not
       count as done. */
    expect(codeOnly(SRC)).toMatch(/stableCount >= 2 && !isGenerating\(\) && turnFinished\(\) !== false/);
  });

  it('blocks only on an explicit still-going', () => {
    expect(SRC).toMatch(/turnFinished\(\) !== false/);
  });
});

describe('a text turn keeps its guard', () => {
  /* Returning null for every "no Copy found" was tried and was wrong: a turn
     reading "half an answ" — Gemini still writing it — went through as a
     finished result, because the caller only blocks on an explicit false.
     
     The difference is whether the turn is a media one at all. On a text turn
     the absence of Copy really does mean it is still being written, since
     Gemini puts Copy on every finished one. */

  it('still returns false for a text turn with no Copy yet', () => {
    const body = codeOnly(fn('turnFinished'));
    expect(body).toMatch(/return false;\s*\}\s*$/);
  });

  it('checks for media before concluding it is still writing', () => {
    const body = codeOnly(fn('turnFinished'));
    expect(body).toMatch(/video-player, video, generated-video/);
    expect(body.indexOf('video-player, video, generated-video'))
      .toBeLessThan(body.lastIndexOf('return false;'));
  });

  it('answers null for a media turn that has not finished rendering', () => {
    /* Not false: there is nothing here that says the clip is still coming,
       and isGenerating() is the guard that knows. */
    const body = codeOnly(fn('turnFinished'));
    const at = body.indexOf('video-player, video, generated-video');
    expect(body.slice(at, at + 120)).toMatch(/return null;/);
  });
});
