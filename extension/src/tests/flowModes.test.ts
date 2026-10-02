/**
 * What FULL and FLOW each promise, and where the code has to differ.
 *
 * The panel states the contract:
 *
 *   FULL — "Creates project, fills all fields automatically"
 *   FLOW — "Runs inside your current Flow session"
 *   LITE — "Paste prompt only, you handle the rest"
 *
 * Recovery follows from that. FULL owns the project, so it re-prompts: each
 * re-submission is a fresh generation with its own media id, which it tracks.
 * FLOW is a guest in a session the user is working in, so it presses the
 * Retry button Flow itself puts on the failed tile, and nothing else —
 * re-prompting there spends a credit on a generation the user did not ask
 * for and lands it in their project untracked.
 *
 * Before this, verifyAndReprompt was shared verbatim by both. Its only
 * `this.mode` check in 800 lines was a timeout, and its three processPrompt
 * calls ran in FLOW as readily as in FULL — so FLOW re-prompted, which is the
 * one thing it must not do.
 *
 * ── Three separate breaks stopped the button path ever being reached ──────
 *
 * Each was independently fatal, which is why fixing any one of them alone
 * changed nothing:
 *
 *   1. The button could not be found. findRetryButtonOnTile looked for
 *      `i.google-symbols` and a <span>Retry</span>; the Angular Flow renders
 *      <mat-icon>refresh</mat-icon> with the word in aria-label. Covered by
 *      flowFailedTile.test.ts against the real markup.
 *
 *   2. The tile was discarded before the button was looked for.
 *      findAllFailedTilesWithScroll skips any tile whose id is empty, and
 *      findTileId reads data-tile-id / data-index — neither of which these
 *      tiles carry.
 *
 *   3. The tile could not be matched to a prompt. Strategy 1 uses
 *      prompt.tileIds, which getAllTileIds leaves empty here. Strategy 2
 *      searched the tile's own text — but a batch renders as
 *
 *        div.batch-container
 *          ├── div.batch-tiles-section  → the tiles, holding only the error
 *          └── flow-batch-info          → the prompt
 *
 *      so the prompt is a sibling of the tile, never inside it.
 *
 * ── And the API was manufacturing failures ────────────────────────────────
 *
 * inferState scanned every string in a record for FAIL/SAFETY/BLOCK/REJECT/
 * CANCEL as a substring, before checking for media. The user's prompt is one
 * of those strings. "a city block at night" contains BLOCK, so a finished
 * video was reported failed and the prompt handed on as the reason — where
 * classifyError reads a word like "prominent" and calls it a safety block,
 * the one class that never retries. Pinned in flowBatch.test.ts.
 */

/// <reference types="node" />

import * as fs from 'fs';
import * as path from 'path';

const read = (rel: string) =>
  fs.readFileSync(path.resolve(__dirname, rel), 'utf8').replace(/\r\n/g, '\n');

const AUTOMATION = read('../content/automation.ts');
const SELECTORS = read('../content/selectors.ts');
const PANEL = read('../sidepanel/index.ts');

/** Source with comments stripped, so prose cannot satisfy an assertion. */
const codeOnly = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

/** One method's body, so a match cannot come from elsewhere in the file. */
const method = (name: string): string => {
  const m = new RegExp(`private (?:async )?${name}\\([\\s\\S]*?\\n  \\}`).exec(AUTOMATION);
  if (!m) throw new Error(`${name} not found in automation.ts`);
  return m[0];
};

describe('who is allowed to re-prompt', () => {
  it('is decided in one place', () => {
    expect(codeOnly(method('canReprompt'))).toMatch(/this\.mode === 'full'/);
  });

  it('is FULL only — never FLOW', () => {
    const body = codeOnly(method('canReprompt'));
    expect(body).not.toMatch(/'flow'/);
  });

  it('guards every re-submission in the verifier', () => {
    /* There are three. Any one left open puts FLOW back to re-prompting. */
    const verify = codeOnly(
      AUTOMATION.slice(AUTOMATION.indexOf('private async verifyAndReprompt')),
    );
    const calls = verify.match(/await this\.processPrompt\(/g) || [];
    const guards = verify.match(/if \(!this\.canReprompt\(\)\)/g) || [];
    expect(calls.length).toBeGreaterThan(0);
    expect(guards.length).toBeGreaterThanOrEqual(calls.length);
  });

  it('leaves the queue run itself alone', () => {
    /* The first pass through the prompts is not a retry — FLOW submits its
       prompts like any other mode. Only recovery differs. */
    const start = AUTOMATION.slice(AUTOMATION.indexOf('await this.processPrompt(prompt, i)') - 400);
    expect(start.slice(0, 400)).not.toMatch(/canReprompt/);
  });
});

describe('FLOW, when it cannot press a Retry button', () => {
  const verify = codeOnly(
    AUTOMATION.slice(AUTOMATION.indexOf('private async verifyAndReprompt')),
  );

  it('asks the page before writing a prompt off', () => {
    /* It reaches that branch whenever the API record lags the grid — which
       includes the case where the generation actually finished. Marking that
       failed would turn a delivered video into a reported failure. */
    expect(verify).toMatch(/domStateForPrompt\(prompt\.text\)/);
  });

  it('accepts a completed tile as done', () => {
    expect(verify).toMatch(/domState === 'completed'[\s\S]{0,200}'done'/);
  });

  it('waits rather than failing one that is still running', () => {
    expect(verify).toMatch(/domState === 'generating'/);
  });

  it('finds the tile by its batch prompt, since tiles have no id here', () => {
    expect(codeOnly(method('domStateForPrompt'))).toMatch(/promptTextOfTile\(card\)/);
  });
});

describe('matching a failed tile to the prompt that made it', () => {
  it('carries the batch prompt on every failed tile', () => {
    expect(SELECTORS).toMatch(/promptText: promptTextOfTile\(card\)/);
    expect(codeOnly(SELECTORS)).toMatch(/promptText: string;/);
  });

  it('reads the prompt from the batch, not from the tile', () => {
    /* flow-batch-info is a sibling of the tiles; the tile itself holds only
       the error message, so searching it could never hit. */
    const fn = codeOnly(SELECTORS.slice(SELECTORS.indexOf('export function promptTextOfTile')));
    expect(fn).toMatch(/closest\('\.batch-container'\)/);
    expect(fn).toMatch(/flow-expandable-prompt/);
  });

  it('uses that prompt when matching, not the tile text alone', () => {
    const verify = codeOnly(
      AUTOMATION.slice(AUTOMATION.indexOf('private async verifyAndReprompt')),
    );
    expect(verify).toMatch(/ft\.promptText/);
  });

  it('gives a tile an identity when the page supplies none', () => {
    /* Callers drop any tile with an empty id, so without this every failed
       tile was discarded before its button was looked for. */
    const fn = codeOnly(SELECTORS.slice(SELECTORS.indexOf('function newFlowTileId')));
    expect(fn).toMatch(/closest\('\.batch-container'\)/);
    expect(fn).toMatch(/indexOf\(el as Element\)/);
    expect(fn).toMatch(/if \(pos < 0\) return '';/);
  });
});

describe('downloading what the run produced', () => {
  it('FLOW downloads through the library scan', () => {
    /* It passed autoDownload: false and left the user to click through the
       grid themselves. */
    const code = codeOnly(AUTOMATION);
    const flow = code.slice(code.indexOf("} else if (this.mode === 'flow') {")).slice(0, 2000);
    expect(flow).toMatch(/autoDownload: shouldAutoDownload/);
    expect(flow).not.toMatch(/autoDownload: false/);
  });

  it('FULL really falls back to the library scan', () => {
    /* Its fallback used to log "falling back to library scan" and then return
       having scanned nothing — so whenever the API path produced no URL, the
       run finished with no files. */
    const code = codeOnly(AUTOMATION);
    expect(code).toMatch(/const scanShouldDownload = this\.mode === 'full' \? true : shouldAutoDownload;/);
    expect(code).toMatch(/autoDownload: scanShouldDownload/);
    expect(code).not.toMatch(/Full Mode, skipping library scan reload/);
  });

  it('orders the files by the prompt list', () => {
    const dl = codeOnly(PANEL.slice(PANEL.indexOf('async function downloadSelectedAssets')));
    expect(dl).toMatch(/a\.promptNumber !== b\.promptNumber/);
    expect(dl).toMatch(/b\.promptNumber - a\.promptNumber/);
  });

  it('sets the library to prompt order before selecting', () => {
    const scan = codeOnly(PANEL.slice(PANEL.indexOf('async function handleAutoScanLibrary')));
    expect(scan).toMatch(/sortSelect\.value = 'prompt-num'/);
    expect(scan.indexOf("'prompt-num'")).toBeLessThan(scan.indexOf('downloadSelectedAssets()'));
  });

  it('downloads an image run too, instead of finding no videos and stopping', () => {
    const scan = codeOnly(PANEL.slice(PANEL.indexOf('async function handleAutoScanLibrary')));
    expect(scan).toMatch(/mediaType === 'image'/);
    expect(scan).toMatch(/videos\.length > 0/);
  });

  it('clears stale selections before selecting what it wants', () => {
    /* The user may have ticked things in the grid; the download must be the
       run's own output, in the run's own order. */
    const scan = codeOnly(PANEL.slice(PANEL.indexOf('async function handleAutoScanLibrary')));
    expect(scan).toMatch(/selected = false;/);
  });
});

/**
 * Finishing the run before the last video did.
 *
 * A clean run of ten: 10/10 in the monitor, "All 10 videos are ready!", every
 * prompt ticked. But the activity log reads
 *
 *   Checking results (round 1)...
 *   Done! 9 videos complete
 *
 * with the tenth sitting at 100% in the grid. The summary was taken, and the
 * download started, while that video was still finishing.
 *
 * The verification loop broke out as soon as no prompt was retryable or
 * pending — even with generations still running — on the reasoning that "the
 * retry wait loop after Step 3 will handle them". Step 3 is BELOW that break,
 * so nothing handled them. The verifier left, Step 4 counted what had landed,
 * and the run downloaded nine of ten.
 */
describe('waiting for the last video', () => {
  const verify = codeOnly(
    AUTOMATION.slice(AUTOMATION.indexOf('private async verifyAndReprompt')),
  );

  it('does not stop while a generation is still running', () => {
    expect(verify).toMatch(
      /toRetryViaDom\.length === 0 && pendingVerificationCount === 0 && waitingOnGeneration === 0/);
  });

  it('has no other way out of the round loop while one is running', () => {
    /* The old condition, without the generation check, is what left early. */
    expect(verify).not.toMatch(
      /if \(toRetryViaDom\.length === 0 && pendingVerificationCount === 0\) \{\s*if \(waitingOnGeneration > 0\)/);
  });

  it('sleeps between rounds while waiting on one', () => {
    /* Otherwise it spins its remaining rounds back to back and burns them in
       seconds — no better than the break it replaces. */
    expect(verify).toMatch(
      /\(pendingVerificationCount > 0 \|\| waitingOnGeneration > 0\) && !this\.stopped && round < MAX_ROUNDS/);
  });

  it('still gives up eventually rather than hanging', () => {
    /* A generation that never lands must not hold the run open forever. */
    expect(verify).toMatch(/round < MAX_ROUNDS/);
    expect(codeOnly(AUTOMATION)).toMatch(/const MAX_ROUNDS = \d+/);
  });

  it('says what it is waiting for', () => {
    expect(AUTOMATION).toMatch(/waiting on \$\{waitingOnGeneration\} generation\(s\) still running/);
  });

  it('counts the results after the loop, not inside it', () => {
    /* Step 4 is the summary the panel prints; taking it mid-loop is what
       produced "Done! 9 videos complete". */
    expect(verify.indexOf('while (round < MAX_ROUNDS'))
      .toBeLessThan(verify.indexOf("const finalDone = this.queue.prompts.filter"));
  });
});

/**
 * The API says when a generation is finished. The page says when one failed.
 *
 * A run kept breaking on its LAST prompts — the ones still generating when
 * everything else had landed. While the API reported them running, the
 * verifier went to the DOM to check whether the API was stale, and the check
 * it used could not work on this Flow:
 *
 *   it matched a tile to a prompt by the tile's own textContent
 *
 * and a tile contains only its error message. The prompt lives in
 * flow-batch-info, a sibling of the tiles. So no tile ever matched, every
 * still-running prompt was declared "Tile is completely missing
 * (cancelled/deleted in DOM)" and routed into the retry pass — which in FULL
 * mode meant re-submitting a prompt whose video was busily generating.
 *
 * The order is now the one that matches how the two sources actually behave:
 * wait for the API to report the generation finished, and ask the page only
 * whether it failed — which is the one thing the API never states. The DOM
 * scroll-and-retry pass then runs against real failed tiles.
 */
describe('the API decides when a generation is finished', () => {
  const verify = codeOnly(
    AUTOMATION.slice(AUTOMATION.indexOf('private async verifyAndReprompt')),
  );
  const generating = (() => {
    const at = verify.indexOf("apiMatch.state === 'generating'");
    return verify.slice(at, at + 1800);
  })();

  it('asks the page only whether the generation failed', () => {
    expect(generating).toMatch(/domStateForPrompt\(p\.text\)/);
    expect(generating).toMatch(/domState === 'failed'/);
  });

  it('does not hunt for the tile by its own text', () => {
    /* The match that could never hit: a tile holds its error message, not
       the prompt. */
    expect(generating).not.toMatch(/tileText\.includes\(promptNeedle\)/);
    expect(generating).not.toMatch(/tileForPromptExists/);
  });

  it('no longer calls a running generation a missing tile', () => {
    expect(codeOnly(AUTOMATION)).not.toMatch(/Tile is completely missing/);
  });

  it('does not route a running generation to retry on a global DOM check', () => {
    /* allTilesSettled() is page-wide: one quiet moment across the grid sent
       every waiting prompt to the retry pass at once. */
    expect(generating).not.toMatch(/allTilesSettled\(\)/);
  });

  it('keeps waiting when the page says nothing either way', () => {
    expect(generating).toMatch(/waitingOnGeneration\+\+/);
  });

  it('still gives up on the final round rather than waiting forever', () => {
    expect(generating).toMatch(/round === MAX_ROUNDS/);
  });
});

describe('scanning the library without reloading the page', () => {
  const CODE = codeOnly(AUTOMATION);

  it('does not reload before scanning', () => {
    /* The reload existed for a fake-cancel problem Google has since fixed.
       It cost a full page load plus an eight-second wait on every run. */
    const tail = CODE.slice(CODE.indexOf("} else if (this.mode === 'flow') {"));
    expect(tail).not.toMatch(/window\.location\.reload\(\)/);
  });

  it('tells the panel there was no reload to wait for', () => {
    expect(CODE).not.toMatch(/afterReload: true/);
    expect(CODE).toMatch(/afterReload: false/);
  });

  it('does not call the phase a refresh when nothing refreshes', () => {
    expect(CODE).not.toMatch(/Refreshing page for library scan/);
  });

  it('still retries the scan, which now lands sooner after the last video', () => {
    const scan = codeOnly(PANEL.slice(PANEL.indexOf('async function handleAutoScanLibrary')));
    expect(scan).toMatch(/const maxRetries = 3;/);
  });
});

/**
 * The recovery reload, and why it went.
 *
 * A run used to end by reloading the Flow tab and coming back to "clear fake
 * cancelled tiles" — the branch says so itself. That state no longer exists
 * on this Flow, and Google fixed the behaviour behind it.
 *
 * What the pass actually did was rescan the grid and call startQueue() to
 * regenerate anything it could not find. That is re-prompting, which FLOW
 * mode must never do — and FLOW was the only mode that reached it, since FULL
 * already skipped the reload.
 *
 * So the run settles every prompt against the page before it ends. By that
 * point the retry pass has run: a prompt is either finished, or it is not
 * coming, and both are answers the page can give now.
 */
describe('the run ends without reloading the page', () => {
  const CODE = codeOnly(AUTOMATION);
  const INDEX = codeOnly(read('../content/index.ts'));

  it('never reloads, anywhere in the engine', () => {
    expect(CODE).not.toMatch(/window\.location\.reload\(\)/);
  });

  it('leaves nothing queued for a reload to resolve', () => {
    /* Prompts were parked in 'queued' purely so a reloaded page would pick
       them up. With no reload they would simply be abandoned. */
    const verify = CODE.slice(CODE.indexOf('private async verifyAndReprompt'));
    expect(verify).not.toMatch(/updatePromptStatus\(idx, 'queued'\)/);
  });

  it('settles each one against the page instead', () => {
    const verify = CODE.slice(CODE.indexOf('private async verifyAndReprompt'));
    const at = verify.indexOf('finalRecoveryIndices.length > 0');
    const block = verify.slice(at, at + 1200);
    expect(block).toMatch(/domStateForPrompt\(p\.text\)/);
    expect(block).toMatch(/domState === 'completed'[\s\S]{0,120}'done'/);
    expect(block).toMatch(/'failed'/);
  });

  it('says which of the two happened', () => {
    /* "Still generating when the run ended" and "no finished video" are
       different problems and deserve different words. */
    expect(AUTOMATION).toMatch(/Still generating when the run ended/);
    expect(AUTOMATION).toMatch(/No finished video found on the page/);
  });

  it('no longer saves a run for post-reload recovery', () => {
    /* Every save now passes recoveryMode false. */
    expect(CODE).not.toMatch(/saveRunningQueue\([^)]*,\s*true/);
  });

  it('discards a recovery run saved by an older version', () => {
    /* The only way into that branch now. Regenerating prompts on a page the
       user just opened, for a run they finished days ago, is worse than
       doing nothing. */
    const at = INDEX.indexOf('if (recoveryMode) {');
    expect(at).toBeGreaterThan(-1);
    const branch = INDEX.slice(at, at + 700);
    expect(branch).toMatch(/clearRunningQueue\(\)/);
    expect(branch).not.toMatch(/startQueue\(/);
  });

  it('carries no leftovers that only the reload needed', () => {
    /* recoveryCancelled became write-only, and nothing writes the uploaded
       assets key any more — the engine holds that set in memory for the one
       run it matters in. */
    expect(INDEX).not.toMatch(/recoveryCancelled/);
    expect(INDEX).not.toMatch(/storage\.local\.get\(\['autoflow_uploaded_assets'\]/);
  });
});

/**
 * A run that downloaded nothing, and counted nothing.
 *
 * A Full-mode run: 20 prompts, all sent, all 20 charged — and 0 downloads on
 * the account. The question it raised was whether API downloads are simply
 * not counted.
 *
 * They are. BATCH_API_DOWNLOAD calls consumeDownload(total) before it starts,
 * and the library-scan path counts in downloadSelectedAssets. Both routes
 * count, so a zero means no download ran, not that one ran unrecorded.
 *
 * What did not run is the API download itself. buildApiDownloadItems keeps a
 * prompt only if it is BOTH marked done AND carrying a media id, and the
 * caller downloads only `if (downloadItems.length > 0)`. Every prompt failing
 * either condition yields an empty list, no download, and therefore no count
 * — and nothing said so.
 */
describe('why an API download produced nothing', () => {
  const CODE = codeOnly(AUTOMATION);
  const WORKER = codeOnly(read('../background/service-worker.ts'));
  const PANEL_CODE = codeOnly(PANEL);

  it('counts an API download, so a zero is not a counting bug', () => {
    const at = WORKER.indexOf("case 'BATCH_API_DOWNLOAD'");
    expect(at).toBeGreaterThan(-1);
    expect(WORKER.slice(at, at + 1600)).toMatch(/consumeDownload\(total\)/);
  });

  it('counts a library-scan download too', () => {
    const dl = PANEL_CODE.slice(PANEL_CODE.indexOf('async function downloadSelectedAssets'));
    expect(dl.slice(0, 900)).toMatch(/consumeDownload\(selected\.length\)/);
  });

  it('says how many prompts were left out, and why', () => {
    /* "Not done" and "no media id" are different failures with different
       fixes, and both used to look identical from outside: nothing. */
    const fn = CODE.slice(CODE.indexOf('private buildApiDownloadItems'));
    expect(fn).toMatch(/notDone\+\+/);
    expect(fn).toMatch(/noMediaId\+\+/);
  });

  it('warns when the list comes back empty', () => {
    expect(AUTOMATION).toMatch(/Nothing to download via the API/);
    expect(AUTOMATION).toMatch(/Falling back to the library scan/);
  });

  it('reports how many carried a usable URL when it is not empty', () => {
    /* An item with no signed URL still counts toward the total, so a full
       list can still write no files — worth distinguishing. */
    expect(AUTOMATION).toMatch(/with a signed URL ready/);
  });

  it('still falls back to the library scan, so a zero list is recoverable', () => {
    expect(CODE).toMatch(/const scanShouldDownload = this\.mode === 'full' \? true : shouldAutoDownload;/);
  });
});
/**
 * A finished queue has to SAY it finished.
 *
 * Only two endings ever sent it: full mode with images, and the API-download
 * shortcut. Every other ending released the run lock, returned, and told the
 * panel nothing — so the card sat at RUNNING showing 3/3 and 100%.
 *
 * That one missing message costs three things, because the background hangs
 * all of them off 'completed':
 *
 *   · the panel clears `state.isRunning` on it and on nothing else, so the
 *     next batch is refused while a finished queue still looks like it runs
 *   · the keepalive is stopped on it, so it otherwise runs forever
 *   · advanceChainIfNeeded is called on it, so a chained queue never starts
 *
 * FLOW is the mode most affected and the one that had it missing: it is the
 * mode people leave running back to back.
 */
describe('a finished queue tells the panel it finished', () => {
  const CODE = codeOnly(AUTOMATION);

  it('sends the status and the summary together', () => {
    const body = codeOnly(method('announceCompletion'));
    expect(body).toMatch(/sendQueueStatus\('completed'\)/);
    expect(body).toMatch(/sendQueueSummary\(/);
  });

  /** A stopped run already said 'stopped'; calling it complete would lie. */
  it('stays quiet for a run that was stopped', () => {
    expect(codeOnly(method('announceCompletion'))).toMatch(/this\.stopped/);
  });

  /* Each mode ends on its own branch and returns from there, so the call has
     to exist on every one of them — a single shared exit does not run. */
  const ENDINGS: Array<[string, string]> = [
    ['flow', "Queue complete — reloading page for library scan${shouldAutoDownload"],
    ['full, falling back to the library scan', 'Queue complete — reloading page for library scan...'],
    ['lite', 'Queue complete (Lite mode).'],
  ];

  for (const [mode, marker] of ENDINGS) {
    it('announces it when ' + mode + ' finishes', () => {
      const at = CODE.indexOf(marker);
      expect(at).toBeGreaterThan(-1);
      expect(CODE.slice(at, at + 220)).toContain('this.announceCompletion()');
    });
  }

  /** The panel end of it: this message is what unblocks the next run. */
  it('is what clears isRunning in the panel', () => {
    const at = PANEL.indexOf('function handleQueueStatusUpdate');
    expect(at).toBeGreaterThan(-1);
    const body = PANEL.slice(at, at + 1800);
    expect(body).toMatch(/status === 'completed'/);
    expect(body).toContain('state.isRunning = false');
  });
});
