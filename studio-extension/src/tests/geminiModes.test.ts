/**
 * Gemini's three modes.
 *
 * The adapter never chose one. It typed into whichever composer happened to be
 * there and hoped Gemini felt like drawing — which is why an image node worked
 * only when somebody had already set the mode by hand, and why a video node
 * could never work at all: mediaType 'video' fell into the image tracker,
 * which watches <img> elements, and would wait out its whole twelve-minute
 * backstop against a page playing a video.
 *
 * Every selector below was read off gemini.google.com rather than reasoned
 * about, and three facts came from the live page that guessing would have got
 * wrong:
 *
 *   The modes are ROUTES — /app, /images, /videos — not menu items. The "+"
 *   menu exists but fights synthetic clicks; the sidebar link does not.
 *
 *   The link must be CLICKED, not followed by assigning location.href. Gemini
 *   is an Angular SPA, so the anchor is a client-side route: proven by setting
 *   a window marker, clicking, and finding the marker still there afterwards.
 *   A real navigation would tear down the content script mid-run.
 *
 *   The composer's data-placeholder says which mode is live — "Ask Gemini",
 *   "Describe your image", "Describe your video". A positive signal, present
 *   when the mode is on rather than absent when it is off.
 */

/// <reference types="node" />

import { readFileSync } from 'fs';
import { join } from 'path';

const SRC = readFileSync(join(__dirname, '..', 'content', 'gemini', 'index.ts'), 'utf8');
const NODE = readFileSync(join(__dirname, '..', 'studio', 'nodes', 'GenerateNode.tsx'), 'utf8');

describe('the routes, as the page actually has them', () => {
  it('knows all three', () => {
    expect(SRC).toMatch(/chat: '\/app', image: '\/images', video: '\/videos'/);
  });

  it('switches by clicking the sidebar link, never by assigning location', () => {
    /* THE one that matters. location.href reloads the document and kills this
       content script in the middle of its own run — the node would then hang
       until its backstop with nothing to explain why. */
    expect(SRC).toMatch(/a\.gem-nav-list-item\[href="\$\{MODE_ROUTE\[want\]\}"\]/);
    const fn = SRC.slice(SRC.indexOf('async function ensureMode'));
    const body = fn.slice(0, fn.indexOf('\n}'));
    expect(body).toMatch(/link\.click\(\)/);
    expect(body).not.toMatch(/location\.href/);
    expect(body).not.toMatch(/location\.assign/);
  });

  it('reads the mode off the placeholder, which is a positive signal', () => {
    expect(SRC).toMatch(/chat: \/ask gemini\/i/);
    expect(SRC).toMatch(/image: \/describe your image\/i/);
    expect(SRC).toMatch(/video: \/describe your video\/i/);
  });

  it('falls back to the sidebar when the composer has no placeholder to read', () => {
    /* A composer already carrying text has none. */
    expect(SRC).toMatch(/a\.gem-nav-list-item\.is-active\[href\]/);
  });
});

describe('switching modes', () => {
  const fn = () => {
    const at = SRC.indexOf('async function ensureMode');
    return SRC.slice(at, SRC.indexOf('\n}', at));
  };

  it('does nothing when the mode is already right', () => {
    expect(fn()).toMatch(/if \(currentMode\(\) === want\) return null;/);
  });

  it('waits for the mode to be live rather than for a fixed delay', () => {
    /* A route change re-renders the composer. Typing into the old one is how a
       prompt gets submitted in the wrong mode. */
    const body = fn();
    expect(body).toMatch(/while \(Date\.now\(\) < deadline\)/);
    expect(body).toMatch(/if \(currentMode\(\) === want\) return null;[\s\S]{0,60}\}/);
  });

  it('says so plainly when the account has no such mode', () => {
    expect(fn()).toMatch(/has no "\$\{want\}" mode in this account/);
  });

  it('re-finds the composer after the route change', () => {
    expect(SRC).toMatch(/composer = findComposer\(\) \|\| composer;\s*\/\/ the route change re-rendered it/);
  });

  it('chooses the mode BEFORE typing', () => {
    expect(SRC.indexOf('const modeFailure = await ensureMode('))
      .toBeLessThan(SRC.indexOf('if (!fillComposer(composer, prompt))'));
  });
});

describe('waiting for a clip', () => {
  const fn = () => {
    const at = SRC.indexOf('async function trackVideo');
    return SRC.slice(at, SRC.indexOf('\nasync function', at + 10));
  };

  it('ignores a player that has not decoded a frame', () => {
    /* A <video> exists from the moment the player mounts. readyState < 2 means
       nothing has decoded, and a poster is not a clip — the same mistake as
       reading Flow's thumbnail as a finished render. */
    expect(SRC).toMatch(/v\.readyState >= 2/);
  });

  it('waits for the src to settle AND for the site to say it has stopped', () => {
    const body = fn();
    expect(body).toMatch(/stableCount >= 2 && !isGenerating\(\) && turnFinished\(\) !== false/);
  });

  it('hands back the URL rather than the bytes', () => {
    /* One clip is tens of megabytes. A data URL of it would travel through
       sendMessage, park in session storage on a dropped port, and be written
       into the saved workflow. */
    const body = fn();
    expect(body).toMatch(/videoUrl: src/);
    expect(body).not.toMatch(/captureImage|toDataURL|FileReader/);
  });

  it('gives up with a reason rather than silently', () => {
    expect(fn()).toMatch(/did not finish the clip in time/);
  });
});

describe('the aspect ratio', () => {
  const fn = () => {
    const at = SRC.indexOf('async function setAspectRatio');
    return SRC.slice(at, SRC.indexOf('\nfunction collectResultImages', at));
  };

  it('is read off the control that is already there', () => {
    expect(fn()).toMatch(/button\[aria-label\^="Aspect ratio"\]/);
  });

  it('does nothing when it is already set', () => {
    expect(fn()).toMatch(/if \(wantPortrait && \/portrait\/i\.test\(already\)\) return;/);
  });

  it('never fails a generation over it', () => {
    /* The clip still renders — in the wrong shape, which the user can see for
       themselves. Refusing to run would be the worse trade. */
    const body = fn();
    expect(body).not.toMatch(/STUDIO_NODE_ERROR/);
    expect(body).toMatch(/logLine\(`Could not set/);
  });

  it('is only asked for on a video node', () => {
    expect(SRC).toMatch(/if \(wantsVideo && config\?\.aspectRatio\) await setAspectRatio/);
  });
});

describe('the node offers it', () => {
  it('lets a Gemini node output video', () => {
    expect(NODE).toMatch(/\{\(isGrok \|\| isGemini\) && <option value="video">Video<\/option>\}/);
  });

  it('treats a Gemini video node as a clip', () => {
    expect(NODE).toMatch(/const isVideo = mediaType === 'video' && \(platform === 'flow' \|\| isGrok \|\| isGemini\)/);
  });

  it('does not offer video on the chats that cannot make one', () => {
    /* ChatGPT and Claude have no video generation. Offering it would produce a
       node that runs, waits and fails. */
    expect(NODE).not.toMatch(/isChatGPT && <option value="video"/);
  });
});
