/**
 * @jest-environment jsdom
 */

/**
 * Motion Control's first Flow step is the upload, and the upload needs a
 * project: Flow's media library belongs to one. A Flow tab left on the
 * homepage — or one opened fresh — had no project, no composer and no media
 * dialog, and the run failed at its first Flow step.
 *
 *   Flow in a project        use it, as it is
 *   Flow on its homepage     press "+ New project"
 *   Flow not open            open Flow's homepage (not the last project),
 *                            then the same
 */

/// <reference types="node" />

import { readFileSync } from 'fs';
import { join } from 'path';

import { flowProjectId, isFlowPage } from '../shared/flowUrls';
import { ensureProject, newProjectButton } from '../content/flow/project';

/* simulateClick fires pointer events, and jsdom has no PointerEvent. */
if (typeof (globalThis as any).PointerEvent === 'undefined') {
  (globalThis as any).PointerEvent = class PointerEvent extends MouseEvent {};
}

describe('what counts as a Flow project', () => {
  it('reads the project on every host Flow answers on', () => {
    expect(flowProjectId('https://flow.google.com/project/08a09fe8-1799')).toBe('08a09fe8-1799');
    expect(flowProjectId('https://labs.google/fx/tools/flow/project/abc-123')).toBe('abc-123');
    expect(flowProjectId('https://labs.google/fx/fr/tools/flow/project/abc-123')).toBe('abc-123');
  });

  it('finds none on the homepage, which is the case this exists for', () => {
    for (const home of ['https://flow.google.com/', 'https://labs.google/fx/tools/flow', 'https://labs.google/fx/tools/flow/']) {
      expect(flowProjectId(home)).toBe('');
      expect(isFlowPage(home)).toBe(true);
    }
  });

  it('does not mistake another Labs tool for Flow', () => {
    /* The tab match is all of labs.google, so "the first Flow tab" could be
       Whisk. */
    expect(isFlowPage('https://labs.google/fx/tools/whisk')).toBe(false);
    expect(isFlowPage('https://labs.google/flowers')).toBe(false);
    expect(flowProjectId('https://example.com/project/abc')).toBe('');
  });
});

/** A page, a location we control, and a clock that only moves when waited on. */
function page(url: string) {
  let href = url;
  let clock = 0;
  const presses: string[] = [];
  const sleep = async (ms: number) => { clock += ms; };
  const addNewProject = (onPress?: () => void) => {
    const b = document.createElement('button');
    b.textContent = 'add New project';
    (b as any).getBoundingClientRect = () => ({ width: 140, height: 40, left: 0, top: 0 });
    b.addEventListener('click', () => { presses.push('new project'); onPress?.(); });
    document.body.append(b);
    return b;
  };
  return {
    presses, addNewProject,
    go: (to: string) => { href = to; },
    deps: (extra: object = {}) => ({
      href: () => href, sleep, findMs: 3000, openMs: 3000,
      waitForUi: async () => true, ...extra,
    }),
    at: () => clock,
  };
}

afterEach(() => { document.body.innerHTML = ''; });

describe('being in a project before the upload', () => {
  it('uses the project that is open, and presses nothing', async () => {
    const p = page('https://flow.google.com/project/open-one');
    p.addNewProject();
    expect(await ensureProject(p.deps())).toEqual({ ok: true, created: false, projectId: 'open-one' });
    expect(p.presses).toEqual([]);
  });

  it('creates one from the homepage, and waits for Flow to open it', async () => {
    const p = page('https://flow.google.com/');
    p.addNewProject(() => p.go('https://flow.google.com/project/fresh-123'));
    let waitedForUi = false;
    const out = await ensureProject(p.deps({ waitForUi: async () => { waitedForUi = true; return true; } }));
    expect(out).toEqual({ ok: true, created: true, projectId: 'fresh-123' });
    expect(p.presses).toEqual(['new project']);
    /* The address changes before the composer exists, and the media dialog
       opens from the composer. */
    expect(waitedForUi).toBe(true);
  });

  it('waits for a homepage that is still painting', async () => {
    const p = page('https://flow.google.com/');
    let polls = 0;
    const out = await ensureProject(p.deps({
      sleep: async () => { if (++polls === 3) p.addNewProject(() => p.go('https://flow.google.com/project/late')); },
    }));
    expect(out).toMatchObject({ ok: true, created: true, projectId: 'late' });
  });

  it('takes a project Flow opened on its own instead of making another', async () => {
    const p = page('https://flow.google.com/');
    const out = await ensureProject(p.deps({ sleep: async () => { p.go('https://flow.google.com/project/restored'); } }));
    expect(out).toEqual({ ok: true, created: false, projectId: 'restored' });
    expect(p.presses).toEqual([]);
  });

  it('says why when there is no "New project" to press', async () => {
    const p = page('https://flow.google.com/');
    const out = await ensureProject(p.deps());
    expect(out.ok).toBe(false);
    expect(!out.ok && out.reason).toMatch(/not in a project/);
  });

  it('says so when the press opens nothing', async () => {
    const p = page('https://flow.google.com/');
    p.addNewProject();                       // pressed, but Flow never routes
    const out = await ensureProject(p.deps());
    expect(!out.ok && out.reason).toMatch(/did not open one/);
  });

  it('makes one project, not two, when the upload asks twice at once', async () => {
    /* The worker retries a prepare that seems stuck. A second press while the
       first project is still opening would make a second project. */
    const p = page('https://flow.google.com/');
    p.addNewProject(() => setTimeout(() => p.go('https://flow.google.com/project/only-one'), 0));
    const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, Math.min(ms, 5)));
    const [a, b] = await Promise.all([
      ensureProject(p.deps({ sleep: realSleep })),
      ensureProject(p.deps({ sleep: realSleep })),
    ]);
    expect(p.presses).toEqual(['new project']);
    expect(a).toEqual(b);
  });

  it('finds the button the way the generation engine does', () => {
    /* A second way of finding the same button is a second thing to go stale:
       automation.ts has pressed this one against the live page for months. */
    const src = readFileSync(join(__dirname, '..', 'content', 'flow', 'project.ts'), 'utf8');
    expect(src).toMatch(/queryButtonByText\(text, doc\)/);
    expect(src).toMatch(/FLOW_STRINGS\.newProject/);
    expect(src).toMatch(/simulateClick\(button\)/);
    const p = page('https://flow.google.com/');
    p.addNewProject();
    expect(newProjectButton(document)?.textContent).toBe('add New project');
  });
});

describe('the upload asks for it', () => {
  const read = (...p: string[]) => readFileSync(join(__dirname, '..', ...p), 'utf8');

  it('is in a project before it opens the media dialog', () => {
    const flow = read('content', 'flow', 'index.ts');
    const handler = flow.slice(flow.indexOf("case 'PREPARE_VIDEO_UPLOAD'"));
    const ensure = handler.indexOf('await ensureProject(');
    const open = handler.indexOf('await openMediaDialog(');
    expect(ensure).toBeGreaterThan(-1);
    expect(open).toBeGreaterThan(ensure);
  });

  it('asks for a NEW project when Flow is closed — from Motion Control only', () => {
    const runner = read('studio', 'engine', 'WorkflowRunner.ts');
    const sends = runner.split("type: 'DEBUG_UPLOAD_TO_FLOW'").slice(1).map((s) => s.slice(0, 400));
    /* Every send that can UPLOAD. A verify-only re-check of a slow piece never
       opens or creates a project — the worker answers it from the project the
       upload went to (motionSlowPiece.test.ts). */
    const uploads = sends.filter((send) => !/^, verifyOnly: true,/.test(send));
    expect(uploads.length).toBe(2);
    expect(sends.length - uploads.length).toBe(1);
    for (const send of uploads) expect(send).toMatch(/newProjectIfClosed: true/);
    /* The Cut node keeps returning to the project the user was last in. */
    expect(read('studio', 'nodes', 'CutNode.tsx')).not.toMatch(/newProjectIfClosed/);
  });
});
