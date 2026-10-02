/**
 * @jest-environment jsdom
 */

/**
 * Typing into a composer in a tab nobody is looking at.
 *
 * Reported from a real background run: "Gemini not working in the background
 * until I click on the page of it." Clicking gives the document focus back
 * and the next attempt works, which is the whole diagnosis.
 *
 * `document.execCommand('insertText', …)` needs the DOCUMENT to have focus —
 * not merely to be visible. In a background tab it is a silent no-op: no
 * error, no exception, nothing inserted. The adapter reads the composer back,
 * finds it empty, and reports that it could not type.
 *
 * Visibility was never the problem. READING the DOM while hidden is fine,
 * which is why steps 2-4 appeared to work. WRITING through execCommand is
 * not, and it is the one step in the whole run that genuinely needs focus.
 *
 * Four adapters shared it — gemini, chatgpt, grok, zai. Claude and Flow do
 * not use execCommand at all.
 */

/// <reference types="node" />

import { readFileSync } from 'fs';
import { join } from 'path';
import { insertIntoEditable } from '../content/shared/composerText';

const read = (...p: string[]) =>
  readFileSync(join(__dirname, '..', ...p), 'utf8').replace(/\r\n/g, '\n');
const codeOnly = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, '');

/** A contenteditable that only accepts text through a paste, the way an
    editor behaves when execCommand has done nothing. */
function pasteOnlyEditable(): HTMLElement {
  const el = document.createElement('div');
  el.setAttribute('contenteditable', 'true');
  el.addEventListener('paste', (e) => {
    const dt = (e as ClipboardEvent).clipboardData;
    if (dt) el.textContent = dt.getData('text/plain');
  });
  document.body.appendChild(el);
  return el;
}

describe('text lands without document focus', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  /* jsdom implements execCommand as a no-op, which is exactly how a real
     browser behaves in a background tab — so this is the failing case. */
  it('falls back to a paste when execCommand does nothing', () => {
    const el = pasteOnlyEditable();
    const ok = insertIntoEditable(el, 'a cinematic shot of a paper house');
    expect(ok).toBe(true);
    expect(el.textContent).toContain('cinematic shot');
  });

  it('reports failure rather than pretending, when nothing accepts the text', () => {
    const el = document.createElement('div');
    el.setAttribute('contenteditable', 'true');
    /* Refuses everything: no paste handler, and textContent writes bounce. */
    Object.defineProperty(el, 'textContent', { get: () => '', set: () => {} });
    Object.defineProperty(el, 'innerText', { get: () => '' });
    document.body.appendChild(el);
    expect(insertIntoEditable(el, 'a long enough prompt to matter')).toBe(false);
  });

  it('accepts a partial insert the way the adapters always have', () => {
    const el = pasteOnlyEditable();
    el.addEventListener('paste', (e) => {
      const dt = (e as ClipboardEvent).clipboardData;
      if (dt) el.textContent = dt.getData('text/plain').slice(0, 20);
    });
    // 20 of 30 characters is over the 60% floor these adapters use.
    expect(insertIntoEditable(el, '123456789012345678901234567890')).toBe(true);
  });

  it('never throws, whatever the editor does', () => {
    const el = document.createElement('div');
    el.addEventListener('paste', () => { throw new Error('editor exploded'); });
    document.body.appendChild(el);
    expect(() => insertIntoEditable(el, 'text')).not.toThrow();
  });
});

describe('every adapter that used execCommand now goes through it', () => {
  const USERS = ['gemini', 'chatgpt', 'grok', 'zai'] as const;

  for (const name of USERS) {
    it(`${name} fills its composer through the shared helper`, () => {
      const src = codeOnly(read('content', name, 'index.ts'));
      // Tolerates other named imports from the same module — gemini also
      // pulls in readRenderedText, which broke the first version of this.
      expect(src).toContain("insertIntoEditable");
      expect(src).toContain("from '../shared/composerText'");
      expect(src).toMatch(/insertIntoEditable\(el, text\)/);
    });
  }

  /* Grok sets the caret inside the extend-mode paragraph before typing;
     that is not about focus and must survive. */
  it('leaves grok extend-mode caret handling in place', () => {
    const src = codeOnly(read('content', 'grok', 'index.ts'));
    expect(src).toMatch(/p\[data-placeholder\]/);
  });

  /* ChatGPT swaps its composer node out as it hydrates, so the caller
     re-reads the live element. Unrelated to focus, and still needed. */
  it('leaves chatgpt live-composer re-read in place', () => {
    const src = codeOnly(read('content', 'chatgpt', 'index.ts'));
    expect(src).toMatch(/const live = findComposer\(\) \|\| composer/);
  });

  it('tries execCommand first, so the proven path is unchanged when focused', () => {
    const WAIT = codeOnly(read('content', 'shared', 'composerText.ts'));
    const exec = WAIT.indexOf("execCommand('insertText'");
    const paste = WAIT.indexOf("new ClipboardEvent('paste'");
    expect(exec).toBeGreaterThan(-1);
    expect(paste).toBeGreaterThan(exec);
  });
});
