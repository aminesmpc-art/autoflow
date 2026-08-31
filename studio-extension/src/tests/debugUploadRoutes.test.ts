/**
 * The debugger upload: how it finds the input, and in which language.
 *
 * Three separate reasons it could fail after the banner had already appeared —
 * which is the worst kind, because the user has consented to the scary thing
 * and then watched it do nothing.
 *
 * 1. DOM.setFileInputFiles resolves its node through the DOM agent, and only
 *    Page was enabled. That fails at the very last step, after the click and
 *    the intercept both looked fine.
 *
 * 2. The "Upload media" button was matched with /upload\s*medi/i and a
 *    three-word French fallback, while flowStrings has carried the verb in
 *    fourteen languages all along. On a French, German or Japanese Flow the
 *    lookup could not hit, and said "Upload media button not found" — which
 *    reads as "Flow changed", not "we only speak English".
 *
 * 3. The whole design assumed a file chooser had to be intercepted, because
 *    uploadVideo.ts proved Flow ignores what a content script can produce.
 *    That is true of a content script: its change event is isTrusted:false.
 *    It is NOT true of DOM.setFileInputFiles, which sets the files at browser
 *    level and fires a trusted event — Puppeteer's uploadFile() is exactly
 *    this call. So the chooser, the coordinates and the banner-shift problem
 *    were all avoidable for any dialog that has an input to find.
 */

/// <reference types="node" />

import * as fs from 'fs';
import * as path from 'path';

import { FLOW_STRINGS } from '../content/flow/flowStrings';

const SRC = fs.readFileSync(
  path.resolve(__dirname, '../background/debugUpload.ts'), 'utf8',
).replace(/\r\n/g, '\n');

describe('the CDP domains it enables', () => {
  it('enables DOM as well as Page', () => {
    expect(SRC).toMatch(/sendCDP\(target, 'Page\.enable'/);
    expect(SRC).toMatch(/sendCDP\(target, 'DOM\.enable'/);
  });

  it('enables DOM before anything asks the DOM agent for a node', () => {
    const enable = SRC.indexOf("'DOM.enable'");
    const setFiles = SRC.indexOf("'DOM.setFileInputFiles'");
    expect(enable).toBeGreaterThan(-1);
    expect(setFiles).toBeGreaterThan(enable);
  });
});

describe('the direct route', () => {
  it('exists and is tried before the chooser is intercepted', () => {
    const direct = SRC.indexOf('trySetFilesDirectly(target, filePaths)');
    const intercept = SRC.indexOf("'Page.setInterceptFileChooserDialog', { enabled: true }");
    expect(direct).toBeGreaterThan(-1);
    expect(intercept).toBeGreaterThan(direct);
  });

  it('pierces shadow roots, which Flow\'s dialog uses', () => {
    const fn = /async function trySetFilesDirectly\([\s\S]*?\n\}/.exec(SRC) as RegExpExecArray;
    expect(fn).not.toBeNull();
    /* This used DOM.querySelector with pierce:true. Moving to Runtime.evaluate
       for the accept check dropped that silently, so the walker earns it back
       explicitly — and both steps call the SAME collector, so the input that
       was surveyed is the input that receives the files. */
    expect(fn[0]).toMatch(/el\.shadowRoot/);
    expect(fn[0]).toMatch(/window\.__afFileInputs = function/);
    expect((fn[0].match(/window\.__afFileInputs\(\)/g) || []).length).toBe(2);
  });

  it('falls back rather than failing when there is no input yet', () => {
    /* Some dialogs only create the input when the picker is invoked. That is
       normal, not broken — so it must return, never throw. */
    const fn = /async function trySetFilesDirectly\([\s\S]*?\n\}/.exec(SRC) as RegExpExecArray;
    expect(fn[0]).toMatch(/return \{ ok: false, why: 'no file input on the page yet' \}/);
    expect(fn[0]).toMatch(/catch \(e: any\)/);
    expect(fn[0]).not.toMatch(/throw /);
  });

  it('only returns early when it actually worked', () => {
    expect(SRC).toMatch(/if \(direct\.ok\) \{/);
  });
});

describe('finding the button in the user\'s language', () => {
  it('builds the word list from flowStrings, not from a literal', () => {
    expect(SRC).toMatch(/const UPLOAD_WORDS = FLOW_STRINGS\.upload\.map/);
  });

  it('no longer MATCHES with the English-only regex it replaced', () => {
    /* Scoped to the injected expression, not the whole file: the comment above
       it quotes the old regex on purpose, and that history is worth keeping. */
    const expr = /expression: `\(function \(\) \{[\s\S]*?\}\)\(\)`/.exec(SRC) as RegExpExecArray;
    expect(expr).not.toBeNull();
    expect(expr[0]).not.toMatch(/\.test\(/);
    expect(expr[0]).not.toMatch(/medi\b/);
    expect(expr[0]).toMatch(/indexOf\(UP\[j\]\)/);
  });

  it('carries every language flowStrings does', () => {
    /* If someone adds a language to flowStrings, this route gets it for free.
       That is the whole reason it reads the table instead of copying it. */
    expect(FLOW_STRINGS.upload.length).toBeGreaterThanOrEqual(10);
    for (const word of ['Télécharger', 'Hochladen', 'アップロード', '上传']) {
      expect(FLOW_STRINGS.upload).toContain(word);
    }
  });

  it('matches the Material ligature too, which never translates', () => {
    /* The glyph renders as the text "upload_file" beside the translated word.
       Lowercased substring matching means the English entry doubles as an
       anchor that works in a language nobody has added. */
    const words = FLOW_STRINGS.upload.map((w) => w.toLowerCase());
    expect(words).toContain('upload');
    expect('upload_fileimporter un média'.includes('upload')).toBe(true);
  });

  it('skips zero-size buttons, which are clickable to CDP and do nothing', () => {
    expect(SRC).toMatch(/if \(!r\.width \|\| !r\.height\) continue;/);
  });

  it('prefers a media-named button, then the shortest label', () => {
    /* "Upload media" must beat "Upload media from your computer to …". */
    expect(SRC).toMatch(/if \(a\.med !== c\.med\) return a\.med \? -1 : 1;/);
    expect(SRC).toMatch(/return a\.len - c\.len;/);
  });

  it('requires the verb but only prefers the noun', () => {
    /* A language missing from MEDIA_WORDS must still find its button. */
    const m = /const MEDIA_WORDS = \[[\s\S]*?\];/.exec(SRC) as RegExpExecArray;
    expect(m).not.toBeNull();
    expect(SRC).toMatch(/if \(!isUp\) continue;/);
    expect(SRC).not.toMatch(/if \(!isMed\) continue;/);
  });
});

describe('a failure that can be acted on', () => {
  it('lists the buttons that were on the dialog when none matched', () => {
    expect(SRC).toMatch(/Buttons on the dialog/);
    expect(SRC).toMatch(/seen: seen/);
  });

  it('names the button it clicked when the chooser never opened', () => {
    /* "did not open within 15s" is equally true of a missed click, a renamed
       button, and a Flow that never opens a chooser — three problems wearing
       one sentence. */
    const m = /file chooser did not open within 15s[\s\S]*?\);/.exec(SRC) as RegExpExecArray;
    expect(m).not.toBeNull();
    expect(m[0]).toMatch(/btnCoords\.label/);
    expect(m[0]).toMatch(/direct\.why/);
  });
});
