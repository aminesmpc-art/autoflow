/**
 * The bridge between the website and Studio.
 *
 * ── What it replaces ──────────────────────────────────────────────────────
 *
 * The Extractor built a workflow, offered it as a .json, and asked the user to
 * download it and import it by hand. That worked and needed no permissions,
 * and it had two costs.
 *
 * The obvious one is four steps where there should be none.
 *
 * The one that mattered more: the website had to build the workflow itself,
 * which meant a second copy of the node schema living in
 * extractor/studioWorkflow.js with a comment admitting it — "the website can't
 * import from the extension bundle, so they are duplicated here; if the node
 * schema changes there, change it here". Two copies of a schema drift. They
 * always do, and the drift shows up as a workflow that imports but does not
 * run.
 *
 * So the website no longer builds anything. It sends the EXTRACTION — the raw
 * analysis, which is the Extractor's own output and not a Studio shape at all
 * — and this side compiles it with the extension's own compiler. There is one
 * schema again, and it is the one that ships with the code that reads it.
 *
 * ── Why postMessage and not externally_connectable ────────────────────────
 *
 * chrome.runtime.sendMessage from a page needs the extension's ID hardcoded
 * into the site. That is fine for a published build and wrong for every other
 * kind: an unpacked install has a different id per machine, so the feature
 * would work in production and be untestable everywhere else.
 *
 * A content script has no such problem, and it also lets the page ASK whether
 * Studio is installed — which is what turns "nothing happened" into a button
 * that says "install the extension".
 *
 * ── Trust ─────────────────────────────────────────────────────────────────
 *
 * This runs only on the site in the manifest's matches, and it still checks
 * every message: the right marker, a plausible shape, and a size that could
 * be an analysis rather than a payload. A content script is the extension's
 * hand inside a page, and the page is not the extension.
 */

/* Imported statically, not lazily.

   The first version imported the compiler with await import() to keep this
   script small on a page whose visitor may never press the button. It built
   fine and the bundle was 4KB, which is how the mistake announced itself:
   webpack had put the builder in a numbered chunk, and a content script cannot
   load a chunk unless the file is in web_accessible_resources and publicPath
   points at chrome.runtime.getURL. It would have failed at the click, on the
   one site that needed it — the worst place to find out.

   So: static, and the size is the price of it working. */
import { buildCost, extractionToPlan } from '../../studio/builder/fromExtraction';
import { compilePlan } from '../../studio/builder/plan';

/* The marker the page must put on a message. Anything on the window without
   it is somebody else's traffic — analytics, a framework, an embed. */
const FROM_PAGE = 'autoflow-web';
const FROM_EXTENSION = 'autoflow-extension';

/* An analysis of a long video is a few hundred kilobytes of prompts. A
   megabyte is not one, and whatever it is should not be parsed here. */
const MAX_MESSAGE_BYTES = 1024 * 1024;

type Reply =
  | { ok: true; nodes: number; notes?: string[] }
  | { ok: true; cost: { stills: number; clips: number; characters: number; total: number } }
  | { ok: false; error: string };

function reply(id: string, payload: Reply): void {
  window.postMessage({ source: FROM_EXTENSION, id, ...payload }, window.location.origin);
}

/**
 * Build an extraction into a workflow and open it.
 */
async function buildAndOpen(extraction: unknown, options: unknown): Promise<Reply> {
  const { plan, problems } = extractionToPlan(extraction as any, (options || {}) as any);
  if (!plan) {
    /* The LAST problem, not the first. When a build is refused the converter
       pushes the per-shot notes as it goes and appends the reason it gave up
       at the end — so problems[0] is "Shot 1 had no usable prompt", which
       explains one shot rather than why nothing was built. On a twelve-shot
       analysis that reads as a complaint about shot one while the other
       eleven are unaccounted for. */
    return {
      ok: false,
      error: problems[problems.length - 1] || 'That extraction had nothing to build.',
    };
  }

  const { template, problems: compileProblems } = compilePlan(plan);
  if (!template) {
    return { ok: false, error: compileProblems[0] || 'The workflow could not be laid out.' };
  }

  /* Parked whole rather than by id, the same way the side panel's builder
     parks one: the gallery looks an id up in the published list, and this
     workflow exists nowhere but here. */
  await chrome.storage.local.set({ af_pending_workflow: template });

  /* Opening the canvas is the service worker's job — a content script has no
     windows API. If that fails the workflow is still parked, so the next time
     Studio opens it is waiting; say so rather than reporting a failure. */
  try {
    await chrome.runtime.sendMessage({ type: 'OPEN_STUDIO' });
  } catch {
    /* the canvas will pick it up when it is next opened */
  }

  /* Skipped shots travel with a SUCCESSFUL build too. They were being dropped
     silently: an analysis with three thin shots built nine nodes instead of
     twelve, the page said "Opened in Studio", and the three missing shots were
     something to notice later on the canvas or not at all. */
  return { ok: true, nodes: template.nodes.length, ...(problems.length ? { notes: problems } : {}) };
}

window.addEventListener('message', (event) => {
  /* Only this page talking to itself. A message from an iframe or another
     origin is not the site, whatever it claims in its body. */
  if (event.source !== window) return;

  const data = event.data;
  if (!data || typeof data !== 'object' || data.source !== FROM_PAGE) return;

  const id = String(data.id || '');

  /* "Is Studio installed?" — the question that turns a dead button into an
     install link. Answered before any of the heavier work is imported. */
  if (data.type === 'PING') {
    window.postMessage(
      { source: FROM_EXTENSION, id, ok: true, installed: true, version: chrome.runtime.getManifest().version },
      window.location.origin,
    );
    return;
  }

  /* "What would this build?" — the counts under the button.
     Answered here rather than worked out on the page, because a page that
     counts for itself is a second copy of the rules deciding what a shot is
     worth building, and the number under the button would drift away from
     what pressing it produces. */
  if (data.type === 'ESTIMATE') {
    try {
      reply(id, { ok: true, cost: buildCost(data.extraction as any, (data.options || {}) as any) });
    } catch {
      reply(id, { ok: false, error: 'That extraction could not be read.' });
    }
    return;
  }

  if (data.type !== 'BUILD_FROM_EXTRACTION') return;

  let size = 0;
  try {
    size = JSON.stringify(data.extraction ?? null).length;
  } catch {
    reply(id, { ok: false, error: 'That extraction could not be read.' });
    return;
  }
  if (size > MAX_MESSAGE_BYTES) {
    reply(id, { ok: false, error: 'That extraction is too large to send.' });
    return;
  }

  buildAndOpen(data.extraction, data.options)
    .then((result) => reply(id, result))
    .catch((error: any) => reply(id, { ok: false, error: error?.message || 'Studio could not build that.' }));
});

/* Announced once, so a page that loaded before this script did can stop
   waiting. The PING above covers the other order. */
window.postMessage(
  { source: FROM_EXTENSION, type: 'READY', version: chrome.runtime.getManifest().version },
  window.location.origin,
);

console.log('[AutoFlow] Studio bridge ready on this page');
