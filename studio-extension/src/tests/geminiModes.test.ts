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

  it('reaches the sidebar by data-test-id, with the href as fallback', () => {
    /* "images-side-nav-entry-button" / "videos-side-nav-entry-button" is what
       Gemini's own tests hold on to, so it survives a route or class rename in
       a way an href does not. Read straight off the live DOM. */
    const at = SRC.indexOf('async function ensureMode');
    const body = SRC.slice(at, SRC.indexOf('\n}', at));
    expect(body).toMatch(/data-test-id="\$\{want\}s-side-nav-entry-button"/);
    expect(body.indexOf('side-nav-entry-button'))
      .toBeLessThan(body.indexOf('gem-nav-list-item[href'));
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

  it('does NOT require a decoded frame', () => {
    /* The first version demanded readyState >= 2, reasoning from Flow, where a
       poster appears long before the video exists. Gemini is the other way
       round: the <video> only appears once the clip is finished, and it
       arrives paused behind a play button with nothing buffered — readyState
       0. So a finished clip was invisible, and a real run sat at 53% for five
       and a half minutes while the video played on screen beside it. */
    expect(SRC).not.toMatch(/readyState >= 2/);
  });

  it('finds the URL wherever the element keeps it', () => {
    /* currentSrc is empty until loading starts, which for an unplayed clip is
       never. The attribute or a <source> child is often the only copy. */
    const at = SRC.indexOf('function videoSrc');
    const body = SRC.slice(at, SRC.indexOf('\n}', at));
    expect(body).toMatch(/v\.currentSrc/);
    expect(body).toMatch(/v\.getAttribute\('src'\)/);
    expect(body).toMatch(/querySelector\('source'\)/);
  });

  it('says what it can see when it cannot find one', () => {
    /* "Still rendering" and "it is on screen and I cannot see it" look
       identical from outside, and the second cost a five-minute wait. The
       useful detail was that the player existed and had decoded nothing. */
    const body = fn();
    expect(body).toMatch(/No clip yet and nothing is rendering/);
    expect(body).toMatch(/readyState \$\{all\.map/);
  });

  it('waits for the src to settle AND for the site to say it has stopped', () => {
    const body = fn();
    expect(body).toMatch(/stableCount >= 2 && !isGenerating\(\) && turnFinished\(\) !== false/);
  });

  it('always hands back the URL, whatever else it sends', () => {
    /* This used to also forbid the bytes outright: one clip is tens of
       megabytes, and a data URL of it travels through sendMessage, parks in
       session storage on a dropped port, and is written into the saved
       workflow.

       The adapter now inlines them anyway, and deliberately — a Gemini-hosted
       URL needs Google's cookies, so a clip handed back as a bare URL will not
       play anywhere outside the tab that made it. Both adapters that generate
       video do the same thing.

       So the prohibition became the bound instead, which is what actually
       protects the user. The concern was real and was not theoretical: at the
       old 50MB ceiling the message reached ~67MB, over what sendMessage takes,
       and the rejection was swallowed — the node simply never got its result.
       What is asserted now is that the URL is always there as the fallback,
       and that the inlining is capped at a size the wire accepts. */
    const body = fn();
    expect(body).toMatch(/videoUrl: src/);
    expect(body).toMatch(/blob\.size <= MAX_VIDEO_CAPTURE_BYTES/);

    const cap = /const MAX_VIDEO_CAPTURE_BYTES = (\d+) \* 1024 \* 1024;/.exec(SRC);
    expect(cap).not.toBeNull();
    /* base64 is 4/3 of the bytes; sendMessage takes roughly 64MB. */
    expect(Number((cap as RegExpExecArray)[1]) * 4 / 3).toBeLessThan(48);
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

describe('what a Gemini clip node shows', () => {
  it('does not call it "Gemini Imagine"', () => {
    /* Imagine is the name of Grok's product. A Gemini clip node read "Gemini
       Imagine", which is a product that does not exist. */
    expect(NODE).toMatch(/isVideo \? \(isGrok \? 'Grok Imagine' : `\$\{chatName\} Video`\)/);
  });

  it('says Clip rather than Image under a video node', () => {
    /* The hint tested `isGrok && isVideo`, so a Gemini clip node fell through
       to "Image · needs a Gemini tab" while its Output select said Video. */
    expect(NODE).toMatch(/: isVideo\s*\n\s*\? `Clip · needs a \$\{isGrok \? 'Grok Imagine' : chatName\} tab`/);
  });

  it('offers the two ratios Gemini actually has', () => {
    /* Flow's Ratio pills live in the Flow-only block, so a Gemini clip node
       had no way to choose a shape — the adapter reads config.aspectRatio and
       nothing could set it. Two rather than five because /videos offers
       Landscape and Portrait and nothing else. */
    expect(NODE).toMatch(/const GEMINI_VIDEO_RATIOS = \['9:16', '16:9'\];/);
    expect(NODE).toMatch(/\{isGemini && isVideo && \(/);
    expect(NODE).toMatch(/GEMINI_VIDEO_RATIOS\.map\(\(r\) => \(/);
  });

  it('writes the ratio to the field the adapter reads', () => {
    const at = NODE.indexOf('GEMINI_VIDEO_RATIOS.map');
    expect(NODE.slice(at, at + 300)).toMatch(/set\('aspectRatio', r\)/);
  });
});
