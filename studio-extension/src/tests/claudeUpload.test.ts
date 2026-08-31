/**
 * Showing Claude a picture.
 *
 * Claude was one of two chats with no attach path at all — it took the
 * payload, ignored referenceImageData, and answered from the words while the
 * panel showed thumbnails the model never saw.
 *
 * Every selector below was read off claude.ai rather than reasoned about,
 * which is why the implementation is short. Two facts came from the live page
 * and neither was guessable:
 *
 *   The file input is ALREADY in the document. No button to click, no menu to
 *   open — it is hidden with `absolute -z-10 h-0 w-0 opacity-0` rather than
 *   display:none, so it can be filled directly. ChatGPT needs a reveal step
 *   first; Claude does not, and copying ChatGPT's shape would have added a
 *   hunt for a button that does not need pressing.
 *
 *   An attached file appears as exactly one [data-testid="file-thumbnail"].
 *   That is the difference between "the upload started" and "the upload
 *   finished", and sending in between is how a reference goes missing.
 *
 * Confirmed by attaching a 1x1 PNG to a live composer and watching what
 * appeared: one thumbnail, one Remove control, input.files.length === 1.
 */

/// <reference types="node" />

import { readFileSync } from 'fs';
import { join } from 'path';

const SRC = readFileSync(join(__dirname, '..', 'content', 'claude', 'index.ts'), 'utf8');

describe('the selectors, as the page actually has them', () => {
  it('uses the testid rather than a class', () => {
    /* The class is `absolute -z-10 h-0 w-0 overflow-hidden opacity-0
       select-none` — Tailwind describing how it is hidden, which changes with
       any styling tweak. data-testid is what the site's own tests hold on to. */
    expect(SRC).toMatch(/input\[type="file"\]\[data-testid="file-upload"\]/);
    expect(SRC).toMatch(/#chat-input-file-upload-onpage/);
  });

  it('does not go looking for a button to press first', () => {
    /* The input is already in the DOM. ChatGPT needs revealing; copying that
       would be hunting for a control that does not need pressing. */
    expect(SRC).not.toMatch(/revealFileInput/);
  });

  it('waits on the thumbnail, not on the input', () => {
    /* input.files is set the instant we set it. The thumbnail appears when
       Claude has actually taken the file. */
    expect(SRC).toMatch(/const CLAUDE_THUMBNAIL = '\[data-testid="file-thumbnail"\]'/);
    const fn = SRC.slice(SRC.indexOf('function attachmentCount'));
    expect(fn.slice(0, fn.indexOf('\n}'))).toMatch(/CLAUDE_THUMBNAIL/);
  });
});

describe('getting the file in', () => {
  it('tells React, not only the DOM', () => {
    /* Setting input.files and dispatching change updates the element and
       tells React nothing — its onChange is bound through a synthetic event
       system a plain dispatch never reaches. */
    expect(SRC).toMatch(/__reactProps\$/);
    expect(SRC).toMatch(/__reactFiber\$/);
    expect(SRC).toMatch(/input\.dispatchEvent\(new Event\('change', \{ bubbles: true \}\)\)/);
  });

  it('goes through DataTransfer, because input.files is read-only', () => {
    expect(SRC).toMatch(/const dt = new DataTransfer\(\);/);
    expect(SRC).toMatch(/input\.files = dt\.files;/);
  });

  it('decodes a data URL into a real File', () => {
    const fn = SRC.slice(SRC.indexOf('function dataUrlToFile'));
    const body = fn.slice(0, fn.indexOf('\n}'));
    expect(body).toMatch(/;base64/);
    expect(body).toMatch(/new File\(\[bytes\]/);
  });
});

describe('and never sending without it', () => {
  it('attaches before typing', () => {
    /* Uploading re-renders the composer, so a prompt typed first is wiped.
       Same ordering the ChatGPT adapter settled on, for the same reason. */
    expect(SRC.indexOf('attachReferences(references)'))
      .toBeLessThan(SRC.indexOf('let composer = findComposer()'));
  });

  it('fails the node when the upload does not land', () => {
    /* Answering from the words alone while the panel shows a thumbnail is
       the exact failure this path exists to stop. */
    expect(SRC).toMatch(/const failure = await attachReferences\(references\);/);
    expect(SRC).toMatch(/if \(failure\) \{[\s\S]{0,160}STUDIO_NODE_ERROR[\s\S]{0,80}return \{ success: false \}/);
  });

  it('actually waits for the thumbnails to arrive', () => {
    /* A deadline alone proves nothing: a loop that returns true on its first
       pass has a deadline and waits for nothing. Caught by mutation — the
       version of this test that only checked for a deadline passed against a
       waitForAttachments that returned true immediately. */
    const fn = SRC.slice(SRC.indexOf('async function waitForAttachments'));
    const body = fn.slice(0, fn.indexOf('\n}'));
    expect(body).toMatch(/attachmentCount\(\) >= baseline \+ added/);
    expect(body).toMatch(/Date\.now\(\) \+ \d+_000/);
    expect(body).toMatch(/await sleep\(/);
  });

  it('ignores anything that is not a data URL', () => {
    /* A Flow tile id names a tile in another site's grid and is no use here. */
    expect(SRC).toMatch(/d\.startsWith\('data:'\)/);
  });

  it('does nothing at all when there are no pictures', () => {
    expect(SRC).toMatch(/if \(references\.length\) \{/);
  });
});
