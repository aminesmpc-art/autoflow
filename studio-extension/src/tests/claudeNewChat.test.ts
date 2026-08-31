/**
 * @jest-environment jsdom
 */

/// <reference types="node" />

import { readFileSync } from 'fs';
import { join } from 'path';

const SRC = readFileSync(join(__dirname, '..', 'content', 'claude', 'index.ts'), 'utf8');

describe('Claude New Chat detection and triggering', () => {
  it('supports finding New Chat via aria-keyshortcuts Control+Shift+O', () => {
    expect(SRC).toMatch(/button\[aria-keyshortcuts\*="Shift\+O"\], a\[aria-keyshortcuts\*="Shift\+O"\]/);
  });

  it('supports direct /new links', () => {
    expect(SRC).toMatch(/a\[href="\/new"\], a\[href="\/chat\/new"\]/);
  });

  it('supports button text containing "+ New" or "New chat"', () => {
    expect(SRC).toMatch(/t === '\+ new' \|\| t === 'new chat'/);
  });

  it('supports dispatching keyboard shortcut Ctrl+Shift+O', () => {
    expect(SRC).toMatch(/key: 'O', code: 'KeyO', ctrlKey: true, shiftKey: true/);
  });

  it('falls back to navigating to /new if stuck on old chat path', () => {
    expect(SRC).toMatch(/window\.location\.pathname\.startsWith\('\/chat\/'\)/);
    expect(SRC).toMatch(/window\.location\.href = '\/new'/);
  });
});

describe('Claude image attachment', () => {
  /* These four used to describe a different mechanism: a synthetic paste, a
     synthetic drop, a scattergun of guessed thumbnail selectors, and a
     MAIN_WORLD_ATTACH_FILES message into the page world.

     None of that is how the adapter does it, and the version that shipped is
     the better one. Claude keeps a real file input in the composer — hidden
     with `absolute -z-10 h-0 w-0 opacity-0` rather than display:none, so it can
     be filled directly — and an attached file appears as exactly one
     [data-testid="file-thumbnail"]. Both were read off a live signed-in
     claude.ai and verified by attaching a 1×1 PNG and watching it land.

     Filling the real input beats simulating a paste for the reason the header
     of the adapter gives: a paste is a guess about what the page will accept,
     and the input is what it actually reads. So the assertions now hold the
     shipped mechanism to its own claims rather than asking for the one that
     was replaced. */

  it('fills the real file input rather than simulating a paste', () => {
    expect(SRC).toMatch(/input\[type="file"\]\[data-testid="file-upload"\]/);
    expect(SRC).toMatch(/#chat-input-file-upload-onpage/);
  });

  it('tells React about it, not just the DOM', () => {
    /* Setting input.files and dispatching 'change' updates the element and
       tells React nothing — its onChange is bound through a synthetic event
       system a plain dispatch never reaches. All three routes, or the file is
       on the input and invisible to the app. */
    expect(SRC).toMatch(/__reactProps\$/);
    expect(SRC).toMatch(/__reactFiber\$/);
    expect(SRC).toMatch(/input\.dispatchEvent\(new Event\('change', \{ bubbles: true \}\)\)/);
  });

  it('waits for the thumbnail before sending', () => {
    /* The one signal that the upload finished rather than merely started.
       Sending early asks Claude about a picture it does not have yet. */
    expect(SRC).toMatch(/\[data-testid="file-thumbnail"\]/);
    expect(SRC).toMatch(/function attachmentCount/);
  });

  it('converts a data URL into a real File', () => {
    /* The picture arrives as a data URL across two message boundaries; the
       input takes Files. A mis-decoded body attaches a corrupt image, which
       Claude accepts and then describes wrongly. */
    expect(SRC).toMatch(/function dataUrlToFile/);
    expect(SRC).toMatch(/new File\(\[bytes\]/);
  });
});
