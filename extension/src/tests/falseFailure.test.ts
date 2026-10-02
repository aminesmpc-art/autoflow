/**
 * The run that generated four videos and reported none.
 *
 * Ten prompts were queued. The first was
 *
 *   "a red hot air balloon drifting over a city block at dawn"
 *
 * and the run died on it three times inside one minute, while the grid showed
 * that very prompt generating at 15%, then 37%, and then finished — a correct
 * red balloon over a city. Four copies were generated and charged for. The
 * queue ended "Done! 0 videos complete", still at 0/10, having never reached
 * prompt #2.
 *
 * ── The chain ─────────────────────────────────────────────────────────────
 *
 * 1. The tab was running an interceptor from before this fix, because a
 *    MAIN-world script only injects at document_start — a Flow tab open when
 *    the extension updates keeps its old build for the rest of its life. That
 *    build scanned every record string for FAIL / SAFETY / BLOCK / REJECT /
 *    CANCEL, and the record carries the user's own prompt. "city block"
 *    matched BLOCK, so the API reported a healthy generation as failed.
 *
 * 2. processPrompt believed it. Nothing asked the page, which was showing the
 *    generation running.
 *
 * 3. The catch treated any message containing "generation failed" as a
 *    "fake cancel": it announced "Google cancelled prompt #1 (usually fake)"
 *    and retried after 3 seconds instead of backing off — three submissions
 *    in a minute.
 *
 * 4. After the third, the prompt was marked failed and the queue stopped.
 *
 * ── What changed ──────────────────────────────────────────────────────────
 *
 * The page decides whether something failed. A failed generation renders
 * <flow-error-tile> with its reason and a Retry button; that is the entire
 * vocabulary, and there is no cancelled state on this Flow at all. An API
 * "failed" that the grid contradicts is now ignored and logged.
 *
 * That alone would have saved this run, even with the old interceptor still
 * in the tab — which is the point, since the user cannot be expected to know
 * that an open tab silently runs old code.
 */

/// <reference types="node" />

import * as fs from 'fs';
import * as path from 'path';

const read = (rel: string) =>
  fs.readFileSync(path.resolve(__dirname, rel), 'utf8').replace(/\r\n/g, '\n');

const AUTOMATION = read('../content/automation.ts');
const BATCH = read('../content/flowBatch.ts');

/** Source with comments stripped, so prose cannot satisfy an assertion. */
const codeOnly = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

const CODE = codeOnly(AUTOMATION);

/** processPrompt's body, so a match cannot come from the verifier instead. */
const processPrompt = (() => {
  const start = AUTOMATION.indexOf('private async processPrompt');
  const end = AUTOMATION.indexOf('private async ', start + 40);
  return codeOnly(AUTOMATION.slice(start, end));
})();

describe('the page decides whether a generation failed', () => {
  it('asks the grid before acting on an API failure', () => {
    expect(processPrompt).toMatch(/domStateForPrompt\(prompt\.text\)/);
  });

  it('ignores the API when the grid shows the video running or done', () => {
    expect(processPrompt).toMatch(/domSays === 'completed' \|\| domSays === 'generating'/);
  });

  it('checks that before classifying the error, not after', () => {
    /* Classifying first is what set attempts past the limit and threw, so a
       later check could not undo it. */
    const veto = processPrompt.indexOf('domStateForPrompt');
    const classify = processPrompt.indexOf('getLlmOrFallbackErrorClass');
    expect(veto).toBeGreaterThan(-1);
    expect(veto).toBeLessThan(classify);
  });

  it('stops waiting rather than failing, when it disagrees', () => {
    const at = processPrompt.indexOf("domSays === 'completed'");
    expect(processPrompt.slice(at, at + 400)).toMatch(/break;/);
  });

  it('names the likely cause in the log', () => {
    /* Otherwise a stale tab is indistinguishable from a real failure — the
       run that prompted this looked exactly like Google refusing. */
    expect(AUTOMATION).toMatch(/running an old interceptor: reload it/);
  });
});

describe('there is no cancelled state on this Flow', () => {
  it('does not treat "generation failed" as a cancel', () => {
    expect(CODE).not.toMatch(/isFakeCancel/);
  });

  it('does not announce a cancellation to the user', () => {
    expect(CODE).not.toMatch(/usually fake/);
    expect(CODE).not.toMatch(/FAKE_CANCEL_ALERT/);
  });

  it('backs off properly instead of retrying in three seconds', () => {
    /* The short retry is what turned one wrong reading into three
       submissions inside a minute. */
    expect(CODE).toMatch(/const backoff = BACKOFF_BASE_MS \* Math\.pow\(2, attempts - 1\)/);
    expect(CODE).not.toMatch(/Math\.min\(BACKOFF_BASE_MS, 3000\)/);
  });

  it('still refuses to retry a real policy refusal', () => {
    /* The same prompt fails again, so retrying only burns attempts. */
    expect(processPrompt).toMatch(/attempts = MAX_RETRIES \+ 1/);
    expect(processPrompt).toMatch(/errLower\.includes\('polic'\)/);
  });

  it('cannot manufacture a failure from record text at all', () => {
    /* The other half, fixed earlier: the scan that read the prompt as a
       failure reason is gone from the interceptor. */
    expect(codeOnly(BATCH)).not.toMatch(/FAILURE_WORDS/);
  });
});

describe('telling the user their tab is running old code', () => {
  it('knows which build this tab is talking to', () => {
    const api = codeOnly(read('../content/apiHelper.ts'));
    expect(api).toMatch(/state\.interceptorBuild = String\(payload\?\.build \|\| ''\)/);
    expect(api).toMatch(/export function isInterceptorStale\(\)/);
  });

  it('compares against the build the interceptor actually stamps', () => {
    /* Two files, one string. If they drift, the check either never fires or
       always does. */
    const api = read('../content/apiHelper.ts');
    const bypass = read('../content/sw-bypass.ts');
    const expected = /EXPECTED_INTERCEPTOR_BUILD = '([^']+)'/.exec(api)?.[1];
    expect(expected).toBeTruthy();
    /* The interceptor names its build once, in a constant, and both stamps
       it on the window and gates re-installation on it. */
    expect(bypass).toContain(`const BUILD = '${expected}'`);
    expect(bypass).toContain('__af_interceptor_build = BUILD');
  });

  it('says so before the run spends anything', () => {
    const start = CODE.slice(CODE.indexOf('this.mode = this.queue.settings.automationMode'));
    const warn = start.indexOf('isInterceptorStale()');
    const firstPrompt = start.indexOf('await this.processPrompt(prompt, i)');
    expect(warn).toBeGreaterThan(-1);
    expect(warn).toBeLessThan(firstPrompt);
  });

  it('stays quiet until the interceptor has identified itself', () => {
    /* An empty build means "has not spoken yet", not "old" — warning then
       would fire on every run before the first response arrives. */
    const api = codeOnly(read('../content/apiHelper.ts'));
    expect(api).toMatch(/build !== '' && build !== EXPECTED_INTERCEPTOR_BUILD/);
  });
});

/**
 * The second run, lost the same way in a different place.
 *
 * After processPrompt was guarded, ten prompts ran again and two were still
 * marked failed with no retry — while both videos sat finished in the grid:
 *
 *   #4  "a blue crane lifting a SAFETY barrier above a construction site"
 *   #5  "orange autumn leaves REJECTED by the wind, scattering across a
 *        stone bridge"
 *
 * SAFETY and REJECTED are two of the words classifyError maps to the 'safety'
 * class — the one class that never retries. verifyAndReprompt acted on the
 * API's "failed" without asking the page, because the guard had been put in
 * processPrompt only.
 *
 * Guarding call sites one at a time was the mistake. The refusal now happens
 * where every reader comes through: a status relayed from the batchexecute
 * interceptor may not claim a failure at all, because that API never states
 * one. Any caller still holding a stale interceptor's opinion sees
 * 'generating' and waits for the page, which is the truth.
 */
describe('a false failure cannot enter the cache', () => {
  const API = codeOnly(read('../content/apiHelper.ts'));

  it('rewrites a relayed failure to still-generating', () => {
    const v2 = API.slice(API.indexOf("type === 'STATUS_UPDATE_V2'"));
    expect(v2).toMatch(/if \(status\.state === 'failed'\) \{/);
    expect(v2).toMatch(/status\.state = 'generating';/);
  });

  it('drops the reason with it', () => {
    /* The reason IS the prompt on a stale build, and leaving it would let
       classifyError read the prompt again further down. */
    const v2 = API.slice(API.indexOf("type === 'STATUS_UPDATE_V2'"));
    expect(v2).toMatch(/status\.failureReason = '';/);
    expect(v2).toMatch(/IGNORED_STALE_FAILURE/);
  });

  it('does it before the record is stored', () => {
    const v2 = API.slice(API.indexOf("type === 'STATUS_UPDATE_V2'"));
    expect(v2.indexOf("status.state = 'generating'"))
      .toBeLessThan(v2.indexOf('statusCache.set(status.mediaId, status)'));
  });

  it('complains once, not once per record', () => {
    /* A single response describes dozens of generations. */
    expect(API).toMatch(/warnedAboutStaleFailure/);
    expect(API).toMatch(/if \(!state\.warnedAboutStaleFailure\)/);
  });

  it('leaves the old tRPC path alone, where a failure is real', () => {
    /* mapStatus reads a labelled enum, not free text. */
    const v2start = API.indexOf("type === 'STATUS_UPDATE_V2'");
    expect(API.slice(0, v2start)).toMatch(/parseMediaEntry/);
    expect(API.slice(v2start)).not.toMatch(/parseMediaEntry/);
  });
});

describe('the verifier asks the page as well', () => {
  const verify = codeOnly(
    AUTOMATION.slice(AUTOMATION.indexOf('private async verifyAndReprompt')),
  );

  it('checks the grid before calling it a policy refusal', () => {
    const at = verify.indexOf("apiMatch.state === 'failed'");
    expect(at).toBeGreaterThan(-1);
    const branch = verify.slice(at, at + 900);
    expect(branch.indexOf('domStateForPrompt(p.text)'))
      .toBeLessThan(branch.indexOf('getLlmOrFallbackErrorClass'));
  });

  it('counts a finished video as done, not failed', () => {
    const at = verify.indexOf("apiMatch.state === 'failed'");
    expect(verify.slice(at, at + 900)).toMatch(/domSays === 'completed'[\s\S]{0,160}'done'/);
  });
});

/**
 * The root cause: only half the page side was ever put back.
 *
 * AutoFlow injects two scripts into a Flow tab — content.js (isolated, the
 * engine) and sw-bypass.js (MAIN, the interceptor). Both are declared in the
 * manifest at document_start.
 *
 * The worker re-injects content.js into an existing tab in four places, for
 * the ordinary reason that an extension reload orphans it. It never
 * re-injected sw-bypass.js, and it could not have been fixed by reloading the
 * extension alone: a MAIN-world script is plain page JavaScript, untouched by
 * the extension reloading, so it survives while the isolated half is replaced.
 *
 * The result is a tab running a NEW engine against an OLD interceptor, with
 * nothing to show for it — the badge reads "API Active" because both builds
 * report alive. That is how two runs were lost to an interceptor whose
 * failure detection had already been removed from the source.
 */
describe('both halves of the page side are re-injected together', () => {
  const WORKER = read('../background/service-worker.ts');
  const WORKER_CODE = codeOnly(WORKER);

  it('injects the MAIN-world interceptor, not just the engine', () => {
    expect(WORKER_CODE).toMatch(/world: 'MAIN',\s*files: \['sw-bypass\.js'\],/);
  });

  it('puts the interceptor in before the engine', () => {
    /* It patches fetch and XHR; the engine should not start asking for
       statuses before it is in place. */
    const fn = WORKER_CODE.slice(WORKER_CODE.indexOf('async function injectPageScripts'));
    expect(fn.indexOf('sw-bypass.js')).toBeLessThan(fn.indexOf('content.js'));
  });

  it('leaves no site injecting the engine on its own', () => {
    /* Any one left alone recreates the split tab, so the helper must hold
       the only content.js injection in the file. Asserted on raw source:
       stripping comments here is unsafe, because this file is full of URLs
       and a naive // stripper eats the rest of those lines. */
    expect((WORKER.match(/files: \['content\.js'\]/g) || []).length).toBe(1);
    expect((WORKER.match(/injectPageScripts\(tabId\);/g) || []).length).toBe(4);
  });

  it('injects the engine rather than calling itself', () => {
    /* It did call itself for one build of this fix: the edit that routed
       every content.js injection through the helper rewrote the one inside
       the helper too. TypeScript accepts that happily, and every
       source-text assertion above still passed — it is unbounded recursion
       that would hang the run before a single prompt was submitted. */
    const fn = WORKER.slice(WORKER.indexOf('async function injectPageScripts'));
    /* From after the signature, which names the function itself. */
    const body = fn.slice(fn.indexOf('{') + 1, fn.indexOf('\n}'));
    expect(body).not.toMatch(/injectPageScripts\(/);
    expect(body).toMatch(/files: \['content\.js'\]/);
  });

  it('still runs the engine when the interceptor cannot be refreshed', () => {
    /* Without the API the engine reads the DOM, which works. Failing the
       whole injection here would turn a degraded run into no run. */
    const fn = WORKER_CODE.slice(WORKER_CODE.indexOf('async function injectPageScripts'));
    const swAt = fn.indexOf('sw-bypass.js');
    expect(fn.slice(swAt, swAt + 260)).toMatch(/catch/);
  });
});

describe('a newer interceptor replaces an older one', () => {
  const BYPASS = codeOnly(read('../content/sw-bypass.ts'));

  it('does not refuse to install just because something is there', () => {
    /* The old guard returned on any previous install, so re-injecting could
       never have replaced a stale build even once it was attempted. */
    expect(BYPASS).toMatch(/__af_early_fetch_installed && runningBuild === BUILD/);
  });

  it('is a no-op when the build already matches', () => {
    const at = BYPASS.indexOf('runningBuild === BUILD');
    expect(BYPASS.slice(at, at + 60)).toMatch(/return;/);
  });

  it('says so when it takes over', () => {
    expect(read('../content/sw-bypass.ts')).toMatch(/Replacing interceptor/);
  });
});
