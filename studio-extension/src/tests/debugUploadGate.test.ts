/**
 * The debugger upload is off until somebody turns it on.
 *
 * Attaching Chrome's debugger puts a banner across the top of the user's Flow
 * tab saying this extension is debugging their browser, and `debugger` is one
 * of the most heavily scrutinised permissions in the Web Store. Declaring it is
 * unavoidable to ship the feature; USING it without being asked is not.
 *
 * So the gate is a stored flag read in the service worker, on the only path to
 * the module — not a check in whatever UI offers the button, which is a gate
 * that one new caller walks around.
 *
 * What is asserted here is the property that matters and is easy to lose in a
 * refactor: with the flag unset, nothing reaches chrome.debugger or
 * chrome.downloads at all. A default that flips to "on" is a banner appearing
 * on somebody's screen unannounced.
 */

/// <reference types="node" />

import * as fs from 'fs';
import * as path from 'path';

const WORKER = fs.readFileSync(
  path.resolve(__dirname, '../background/service-worker.ts'),
  'utf8',
);
const MODULE = fs.readFileSync(
  path.resolve(__dirname, '../background/debugUpload.ts'),
  'utf8',
);
const MANIFEST = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../../manifest.json'), 'utf8'),
);

describe('the permissions it needs are declared', () => {
  /* Both, or the module throws the moment it is called. saveToDisk needs
     downloads because CDP file chooser handling wants absolute paths. */
  it('asks for debugger and downloads', () => {
    expect(MANIFEST.permissions).toEqual(expect.arrayContaining(['debugger', 'downloads']));
  });

  it('and the module is the only reason either is held', () => {
    /* If this ever fails because another feature started using downloads,
       that is fine — update the test. It exists so that removing the upload
       does not leave two alarming permissions behind with no caller. */
    expect(MODULE).toMatch(/chrome\.debugger\.attach/);
    expect(MODULE).toMatch(/chrome\.downloads\.download/);
  });
});

describe('the gate', () => {
  it('reads a stored flag before doing anything', () => {
    expect(WORKER).toMatch(/const DEBUG_UPLOAD_KEY = 'af_debug_upload'/);
    expect(WORKER).toMatch(/async function debugUploadEnabled\(\)/);
  });

  it('is satisfied only by an explicit true', () => {
    /* `!== false` would default to ON, which is the exact mistake this whole
       file exists to prevent. Truthiness would let the string "false" through. */
    const check = /return got\?\.\[DEBUG_UPLOAD_KEY\] === true;/.exec(WORKER);
    expect(check).not.toBeNull();
  });

  it('treats unreachable storage as "no", not as "yes"', () => {
    /* A thrown read must not become consent. */
    const body = /async function debugUploadEnabled\(\)[\s\S]*?\n\}/.exec(WORKER);
    expect(body).not.toBeNull();
    expect((body as RegExpExecArray)[0]).toMatch(/catch\s*\{[\s\S]*?return false;/);
  });

  it('refuses before it reaches the module', () => {
    /* The order is the property: the enabled check comes first, so a refusal
       costs no download, no attach and no banner. */
    const fn = /async function debugUploadToFlow\([\s\S]*?\n\}/.exec(WORKER);
    expect(fn).not.toBeNull();
    const text = (fn as RegExpExecArray)[0];
    const gateAt = text.indexOf('debugUploadEnabled');
    const useAt = text.indexOf('uploadToFlow(tabId');
    expect(gateAt).toBeGreaterThan(-1);
    expect(useAt).toBeGreaterThan(gateAt);
  });

  it('says what to do about it rather than just failing', () => {
    expect(WORKER).toMatch(/Debugger upload is off/);
    expect(WORKER).toMatch(/banner/i);
  });
});

describe('nothing else can reach the module', () => {
  it('the worker is the only importer', () => {
    /* A second import somewhere is a second path that would not pass the
       gate. Searched across the source rather than assumed. */
    const root = path.resolve(__dirname, '..');
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) { walk(full); continue; }
        if (!/\.tsx?$/.test(entry.name)) continue;
        if (full.endsWith(`background${path.sep}debugUpload.ts`)) continue;
        if (full.includes(`${path.sep}tests${path.sep}`)) continue;
        if (/from '[^']*debugUpload'|import\('[^']*debugUpload'\)/.test(fs.readFileSync(full, 'utf8'))) {
          hits.push(path.relative(root, full));
        }
      }
    };
    walk(root);
    expect(hits).toEqual([`background${path.sep}service-worker.ts`]);
  });

  it('and it imports it statically, because a worker cannot fetch a chunk', () => {
    /* As a dynamic import webpack emitted chunk 720, which a service worker
       has no way to load — the upload would have failed at the first click. */
    expect(WORKER).toMatch(/^import \{ uploadToFlow \} from '\.\/debugUpload';$/m);
    /* Matched as an ASSIGNMENT, not as the words. The comment above the
       import explains why it is not lazy and says "await import" while doing
       so — a looser pattern fails on the explanation for the fix. */
    expect(WORKER).not.toMatch(/=\s*await import\('\.\/debugUpload'\)/);
  });
});

describe('the dialog it needs is opened by code that already worked', () => {
  it('the Flow adapter answers PREPARE_VIDEO_UPLOAD', () => {
    const flow = fs.readFileSync(
      path.resolve(__dirname, '../content/flow/index.ts'), 'utf8',
    );
    expect(flow).toMatch(/case 'PREPARE_VIDEO_UPLOAD'/);
    expect(flow).toMatch(/openMediaDialog\(\)/);
  });

  it('by reusing the library picker\'s opener rather than new selectors', () => {
    /* Guessing at Flow's DOM has cost this project ten failed attempts. These
       three clicks are the only ones known to reach the media dialog, so both
       callers use the same copy. */
    const picker = fs.readFileSync(
      path.resolve(__dirname, '../content/flow/libraryPicker.ts'), 'utf8',
    );
    expect(picker).toMatch(/export async function openMediaDialog/);
    /* attachFromLibrary must call it, not keep its own copy. */
    const attach = /export async function attachFromLibrary\([\s\S]*?\n\}/.exec(picker);
    expect(attach).not.toBeNull();
    expect((attach as RegExpExecArray)[0]).toMatch(/openMediaDialog\(deps\)/);
  });
});
