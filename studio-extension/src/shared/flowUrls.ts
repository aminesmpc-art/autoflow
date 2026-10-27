/**
 * What counts as Flow, and what counts as a Flow PROJECT.
 *
 * One definition, because three places ask: the worker choosing which tab to
 * use, the page deciding whether it has to create a project before uploading,
 * and the upload reading the project id it sends. They used to answer
 * separately — the worker did not ask at all, and took whichever tab matched
 * `https://labs.google/*` first, which is every Google Labs tool, not only
 * Flow.
 *
 * The hosts, all of which resolve:
 *
 *   flow.google.com/project/<id>                   where Flow lives now
 *   labs.google/fx/tools/flow/project/<id>         the original
 *   labs.google/fx/<locale>/tools/flow/project/<id>
 *   labs.google/flow/...                           matched by the manifest too
 *
 * Pure, and free of `location`, so the worker can use it on a tab's URL.
 */

const FLOW_ROOT = String.raw`https?:\/\/(?:flow\.google\.com|labs\.google\/(?:fx\/(?:[a-z]{2}(?:-[A-Za-z]{2,4})?\/)?tools\/)?flow)`;

const FLOW_PROJECT = new RegExp(`^${FLOW_ROOT}\\/project\\/([A-Za-z0-9-]+)`);
const FLOW_PAGE = new RegExp(`^${FLOW_ROOT}(?:[/?#]|$)`);

/** The project a Flow URL points at, or '' when it is not a project page. */
export function flowProjectId(url: string): string {
  return FLOW_PROJECT.exec(url || '')?.[1] || '';
}

/** Any Flow page — its homepage included — as opposed to another Labs tool. */
export function isFlowPage(url: string): boolean {
  return FLOW_PAGE.test(url || '');
}
