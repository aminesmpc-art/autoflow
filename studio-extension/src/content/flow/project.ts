/**
 * Be inside a Flow project before uploading anything.
 *
 * ── Why the upload needs this and generation did not ──────────────────────
 *
 * Flow's media library belongs to a project. On the homepage there is no
 * project, no composer and no media dialog, so an upload that arrives there
 * has nowhere to go — the picker "does not open", three attempts and two
 * reloads later.
 *
 * The generation engine has always handled the homepage: automation.ts
 * presses "+ New project" when it lands on one. The upload never went through
 * that engine. In Motion Control it is the FIRST thing done in Flow — before
 * any generation — so a Flow tab left on the homepage, or one opened fresh,
 * broke the run at its first Flow step.
 *
 * ── What it does ──────────────────────────────────────────────────────────
 *
 *   in a project already     nothing — the open project is used
 *   on Flow's homepage       press "+ New project", wait for the project
 *                            page and its composer
 *
 * The button is found and pressed exactly the way automation.ts does it —
 * queryButtonByText over FLOW_STRINGS.newProject, then simulateClick — because
 * that path has been running against the live page, and a second way of
 * finding the same button is a second thing to go stale.
 */

import { flowProjectId } from '../../shared/flowUrls';
import { isVisible } from '../shared/visible';
import { FLOW_STRINGS } from './flowStrings';
import { queryButtonByText, simulateClick } from './selectors';
import { waitForFlowUi } from './libraryPicker';

export type ProjectOutcome =
  | { ok: true; created: boolean; projectId: string }
  | { ok: false; reason: string };

export interface ProjectDeps {
  /** Where the page is. Injected because a test's location is not Flow's. */
  href?: () => string;
  doc?: Document;
  log?: (line: string) => void;
  sleep?: (ms: number) => Promise<void>;
  /** How long to look for the button on a homepage still painting. */
  findMs?: number;
  /** How long to wait for Flow to open the project after the press. */
  openMs?: number;
  /** Waits for the project's composer — the media dialog needs it. */
  waitForUi?: () => Promise<boolean>;
}

const POLL_MS = 300;

/** Flow's "+ New project" button, when it is on screen. */
export function newProjectButton(doc: Document = document): HTMLElement | null {
  for (const text of FLOW_STRINGS.newProject) {
    const button = queryButtonByText(text, doc) as HTMLElement | null;
    if (button && isVisible(button)) return button;
  }
  return null;
}

/* One creation at a time. The worker retries a failed prepare, and a second
   press while the first project is still opening would make two. */
let creating: Promise<ProjectOutcome> | null = null;

export async function ensureProject(deps: ProjectDeps = {}): Promise<ProjectOutcome> {
  if (creating) return creating;
  creating = createIfNeeded(deps).finally(() => { creating = null; });
  return creating;
}

async function createIfNeeded(deps: ProjectDeps): Promise<ProjectOutcome> {
  const href = deps.href || (() => location.href);
  const doc = deps.doc || document;
  const say = deps.log || (() => {});
  const wait = deps.sleep || ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  const current = flowProjectId(href());
  if (current) return { ok: true, created: false, projectId: current };

  /* A tab opened a moment ago is still painting its homepage. Look for a
     while — and if Flow opens a project on its own meanwhile (it can restore
     the last one), take that instead of making another. */
  const findMs = deps.findMs ?? 15_000;
  let button = newProjectButton(doc);
  for (let waited = 0; !button && waited < findMs; waited += POLL_MS) {
    await wait(POLL_MS);
    const opened = flowProjectId(href());
    if (opened) return { ok: true, created: false, projectId: opened };
    button = newProjectButton(doc);
  }
  if (!button) {
    return {
      ok: false,
      reason: 'Flow is open but not in a project, and its "New project" button is not on the page',
    };
  }

  say('Flow is open but not in a project — creating a new one for this run.');
  simulateClick(button);

  /* Flow is a single-page app: the press routes to /project/<id> without
     reloading, so this script is still here to see it. */
  const openMs = deps.openMs ?? 30_000;
  let created = '';
  for (let waited = 0; !created && waited < openMs; waited += POLL_MS) {
    await wait(POLL_MS);
    created = flowProjectId(href());
  }
  if (!created) return { ok: false, reason: 'Pressed "New project", but Flow did not open one' };

  /* The address changes before the page is usable. The media dialog opens
     from the composer, so that is what "ready" has to mean. */
  await (deps.waitForUi || (() => waitForFlowUi({ log: say })))();
  say(`Created a new Flow project for this run (${created.slice(0, 8)}…).`);
  return { ok: true, created: true, projectId: created };
}
