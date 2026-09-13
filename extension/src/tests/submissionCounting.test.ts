/**
 * Counting what Flow received, rather than what was queued.
 *
 * ── The number this replaces ──────────────────────────────────────────────
 *
 * The charge is taken at queue start, before anything is sent, so today's
 * figure means "prompts queued". Everything that fails between starting and
 * submitting is billed and invisible:
 *
 *   run stopped after 3 of 20        →  3 reached Flow, 20 charged
 *   settings died at prompt 1        →  0 reached Flow, 20 charged
 *   Google credits ran out mid-run   →  partial,        all charged
 *
 * ── Why the media id is the right evidence ────────────────────────────────
 *
 * `mediaId` is read out of Flow's OWN response to the request carrying this
 * prompt's text (see sw-bypass.ts / GENERATION_BOUND). It cannot exist for a
 * prompt that never left the extension, and it is unique — so it is both the
 * proof and the idempotency key.
 *
 * The two properties below are the ones a future edit is most likely to break,
 * because both look like tidying:
 *
 *   · it fires on the ID, not on the OUTCOME. A prompt that failed AFTER Flow
 *     accepted it still has an id, and Google still charged for it.
 *   · it charges nothing. Both numbers are written for a period and compared
 *     on the same runs; if this starts moving counters while consume_queue_run
 *     still charges up front, every user is billed twice.
 */

/// <reference types="node" />

import { readFileSync } from 'fs';
import { join } from 'path';

const API = readFileSync(join(__dirname, '..', 'shared', 'api.ts'), 'utf8').replace(/\r\n/g, '\n');
const PANEL = readFileSync(join(__dirname, '..', 'sidepanel', 'index.ts'), 'utf8').replace(/\r\n/g, '\n');

/** The block in the sidepanel that reports a submission. */
const block = (): string => {
  const at = PANEL.indexOf('if (prompt?.mediaId) {');
  expect(at).toBeGreaterThan(-1);
  /* Bounded by the NEXT block rather than by a character count: the
     outcome-reporting block that follows mentions prompt.status, and a window
     that runs into it would quietly pass a test asserting this one does not. */
  const end = PANEL.indexOf('// ── Per-prompt tracking', at);
  expect(end).toBeGreaterThan(at);
  return PANEL.slice(at, end);
};

describe('the client sends the evidence, not the outcome', () => {
  it('fires on the media id existing', () => {
    /* Not on prompt.status. The outcome is a different question, already
       answered by trackUsage, and it is the wrong trigger: it would miss a
       prompt Flow accepted and then failed, which Google charged for. */
    expect(block()).toMatch(/if \(prompt\?\.mediaId\) \{/);
    expect(block()).not.toMatch(/prompt\.status === 'done'/);
  });

  it('sends the identity the server keys on', () => {
    const body = API.slice(API.indexOf('export async function trackSubmission'), API.indexOf('export async function checkCanGenerate'));
    for (const field of ['media_id', 'queue_id', 'prompt_index', 'prompt_type']) {
      expect(body).toContain(field);
    }
  });

  it('refuses to send without a media id', () => {
    /* Without one the server has nothing to be idempotent on, and an event
       that can be written twice is worse than no event. */
    const body = API.slice(API.indexOf('export async function trackSubmission'));
    expect(body).toMatch(/if \(!input\.mediaId\) return false;/);
  });

  it('reports each media id once, not on every progress tick', () => {
    /* This handler runs on every update and the same prompt reports many
       times before it settles. */
    expect(block()).toMatch(/const submissionKey = `sent:\$\{prompt\.mediaId\}`/);
    expect(block()).toMatch(/_trackedPromptUsage\.has\(submissionKey\)/);
  });

  it('keys the dedupe on the id, so a retry counts as its own submission', () => {
    /* A tile Retry is a new generation with a NEW media id, and Google charged
       for it. Keyed on queue+index instead, the second one would vanish. */
    expect(block()).not.toMatch(/submissionKey = `\$\{data\.queue\.id\}:\$\{data\.promptIndex\}`/);
  });
});

describe('the outcome is a second report, not a second submission', () => {
  /** The block that reports done/failed for a submission. */
  const outcomeBlock = (): string => {
    const at = PANEL.indexOf('if (prompt.mediaId) {');
    expect(at).toBeGreaterThan(-1);
    return PANEL.slice(at, at + 900);
  };

  it('carries the same media id, so the server updates one row', () => {
    /* Two rows would make the billable number depend on how many times the
       extension reported — the exact class of bug being fixed. */
    expect(outcomeBlock()).toMatch(/mediaId: prompt\.mediaId/);
    expect(outcomeBlock()).toMatch(/outcome: prompt\.status as 'done' \| 'failed'/);
  });

  it('rides alongside trackUsage rather than replacing it', () => {
    /* They answer different questions: trackUsage says what happened to a
       QUEUED prompt, this says what became of a generation Flow accepted —
       the only population "completed" may be measured against. */
    const at = PANEL.indexOf("trackUsage(1, promptType, prompt.status");
    const outcomeAt = PANEL.indexOf('outcome: prompt.status');
    expect(at).toBeGreaterThan(-1);
    expect(outcomeAt).toBeGreaterThan(at);
  });

  it('sends nothing when the prompt never got a media id', () => {
    /* No id means Flow never accepted it, so there is no submission for an
       outcome to attach to. */
    expect(outcomeBlock()).toMatch(/if \(prompt\.mediaId\) \{/);
  });

  it('the client passes the outcome through', () => {
    const body = API.slice(API.indexOf('export async function trackSubmission'), API.indexOf('export async function checkCanGenerate'));
    expect(body).toMatch(/outcome\?: 'done' \| 'failed'/);
    expect(body).toMatch(/outcome: input\.outcome \|\| ''/);
  });
});

describe('metering can never cost a generation', () => {
  it('is fire-and-forget at the call site', () => {
    expect(block()).toMatch(/\.catch\(\(\) => \{\/\* metering must never fail a generation \*\/\}\)/);
  });

  it('swallows its own failures inside the client too', () => {
    const body = API.slice(API.indexOf('export async function trackSubmission'), API.indexOf('export async function checkCanGenerate'));
    expect(body).toMatch(/catch \(e\) \{/);
    expect(body).toMatch(/return false;/);
  });

  it('treats a 404 as an old backend, not an error', () => {
    /* The endpoint ships before the extension, but a user on an older API
       host should not get a console error on every single prompt. */
    const body = API.slice(API.indexOf('export async function trackSubmission'), API.indexOf('export async function checkCanGenerate'));
    expect(body).toMatch(/if \(res\.status === 404\) return false;/);
  });
});

describe('a run claims its prompts and hands back what it did not send', () => {
  it('sends the run id with the claim', () => {
    /* The server holds this run's prompts against that id rather than
       spending them; without it there is nothing to release against. */
    expect(PANEL).toMatch(/consumeQueueRun\(mode, pendingCount, promptType as 'text' \| 'full', textCount, fullCount, queueId\)/);
    expect(API).toMatch(/if \(queueId\) payload\.queue_id = queueId;/);
  });

  it('releases on BOTH endings, not just a clean finish', () => {
    /* "Stopped after 3 of 20" is the exact run billed for 20 today. If only
       `completed` released, the 17 would stay held for hours. */
    const at = PANEL.indexOf("if (queue.status === 'completed' || queue.status === 'stopped')");
    expect(at).toBeGreaterThan(-1);
    expect(PANEL.slice(at, at + 1400)).toMatch(/releaseQueueReservation\(queue\.id\)/);
  });

  it('never lets the release fail a run', () => {
    const at = PANEL.indexOf('releaseQueueReservation(queue.id)');
    expect(PANEL.slice(at, at + 120)).toMatch(/\.catch\(/);
    const body = API.slice(API.indexOf('export async function releaseQueueReservation'));
    expect(body).toMatch(/catch \{/);
  });

  it('does nothing without a run id', () => {
    const body = API.slice(API.indexOf('export async function releaseQueueReservation'));
    expect(body).toMatch(/if \(!queueId\) return 0;/);
  });
});

describe('the old counting is left alone', () => {
  it('trackUsage still reports outcomes exactly as before', () => {
    expect(PANEL).toMatch(/trackUsage\(1, promptType, prompt\.status as 'done' \| 'failed'\)/);
  });

  it('the up-front charge at queue start is untouched', () => {
    /* Removing it before the new number is trusted would stop charging
       altogether. The switch is a later, deliberate step. */
    expect(PANEL).toMatch(/consumeQueueRun\(mode, pendingCount/);
  });

  it('the new endpoint is a different path from the old one', () => {
    expect(API).toMatch(/'\/api\/usage\/submitted'/);
    expect(API).toMatch(/'\/api\/usage\/consume'/);
  });
});

/**
 * The delivery chain for the media id.
 *
 * This is the part that was missing when the feature first shipped, and it
 * failed in the way that is hardest to notice: every piece existed, so the
 * code read as finished. The sidepanel gated on `prompt.mediaId`, the content
 * script worked hard to capture one — with two rounds of late polling and an
 * active API refresh — and a helper named sendPromptStatusUpdate even took a
 * `mediaId` argument. It just had no callers, and nothing carried the id
 * across the gap between them. The dashboard read 0 sent against 2,492
 * charged and there was no error anywhere to explain it.
 *
 * The gap is structural, not incidental:
 *
 *   · the content script keeps the id ONLY on its in-memory queue — it never
 *     writes to storage, so the id cannot reach the sidepanel that way
 *   · the background rebuilds the queue FROM storage on every status update
 *     and re-broadcasts that copy, so any field it does not explicitly carry
 *     over is erased before the sidepanel ever sees it
 *
 * So the id has to ride the status message and be copied on arrival. Both
 * halves are asserted here because either one alone silently reports nothing.
 */
describe('the media id reaches the sidepanel', () => {
  const AUTOMATION = readFileSync(
    join(__dirname, '..', 'content', 'automation.ts'), 'utf8').replace(/\r\n/g, '\n');
  const WORKER = readFileSync(
    join(__dirname, '..', 'background', 'service-worker.ts'), 'utf8').replace(/\r\n/g, '\n');

  /** The content script's status message must carry the id it captured. */
  it('is sent on the status message the content script emits', () => {
    const at = AUTOMATION.indexOf('private updatePromptStatus(');
    expect(at).toBeGreaterThan(-1);
    const body = AUTOMATION.slice(at, at + 1600);
    expect(body).toContain("type: 'PROMPT_STATUS_UPDATE'");
    expect(body).toMatch(/mediaId: this\.queue\?\.prompts\[idx\]\?\.mediaId/);
  });

  /** And the background must copy it onto the queue it broadcasts back. */
  it('is copied onto the stored prompt before the broadcast', () => {
    const at = WORKER.indexOf('async function handlePromptStatusUpdate(');
    expect(at).toBeGreaterThan(-1);
    const body = WORKER.slice(at, at + 7000);

    expect(body).toMatch(/if \(payload\.mediaId\) prompt\.mediaId = payload\.mediaId/);

    // The copy has to happen BEFORE the broadcast, or it ships the old object.
    const copy = body.indexOf('prompt.mediaId = payload.mediaId');
    const cast = body.indexOf('broadcastToExtension');
    expect(copy).toBeGreaterThan(-1);
    expect(cast).toBeGreaterThan(copy);
  });

  /**
   * A retry is a SECOND submission, and must not be swallowed.
   *
   * The first version of this fix took the first id and kept it. That reads
   * as the safe choice and is the expensive one: when a generation fails the
   * content script clears the id, clicks Retry, and Flow binds a NEW id —
   * and Google charges for that second generation too. Holding the first id
   * would report the retry under an id already counted, so the extra charge
   * would disappear exactly where this feature exists to expose it.
   */
  it('lets a retry replace the id, because Google charged twice', () => {
    const at = WORKER.indexOf('async function handlePromptStatusUpdate(');
    const body = WORKER.slice(at, at + 7000);
    expect(body).not.toContain('!prompt.mediaId');
  });

  /**
   * An empty id must never erase one already reported.
   *
   * The content script sets mediaId to '' before clicking Retry. That blank
   * travels on the next status message, and copying it over would wipe the
   * stored id — so the copy is guarded on the value being truthy.
   */
  it('ignores a blank id rather than copying it over', () => {
    const at = WORKER.indexOf('async function handlePromptStatusUpdate(');
    expect(WORKER.slice(at, at + 7000)).toMatch(/if \(payload\.mediaId\)/);
  });

  /**
   * Reporting must not depend on the side panel being open.
   *
   * The panel is where this was written, and a queue keeps running when the
   * panel is closed — the content script and the worker carry it. Every
   * prompt sent with it shut was charged and counted as never received.
   *
   * Reporting from both places is safe because the endpoint is idempotent on
   * the media id, but the CLASSIFICATION has to agree: prompt_type is what
   * would be charged if METER_ON_SUBMISSION is ever switched on, and the row
   * keeps whichever value arrived first. Both sides read the merged image
   * list off the stored prompt, so they land on the same answer.
   */
  it('is reported by the background, not only by the panel', () => {
    const at = WORKER.indexOf('async function handlePromptStatusUpdate(');
    const body = WORKER.slice(at, at + 7000);
    expect(body).toContain('trackSubmission({');
    expect(body).toMatch(/mediaId: prompt\.mediaId/);
  });

  it('classifies the prompt the same way the panel does', () => {
    const at = WORKER.indexOf('async function handlePromptStatusUpdate(');
    const body = WORKER.slice(at, at + 7000);
    expect(body).toMatch(/prompt\.images\?\.length \|\| 0\) > 0/);
    expect(body).toMatch(/creationType === 'frames'/);
  });

  it('reports the outcome too, so completed does not need the panel', () => {
    const at = WORKER.indexOf('async function handlePromptStatusUpdate(');
    const body = WORKER.slice(at, at + 7000);
    expect(body).toMatch(/outcome: payload\.status as 'done' \| 'failed'/);
  });

  /** Once per id per run, or every progress tick would re-post it. */
  it('does not re-post the same id on every tick', () => {
    expect(WORKER).toContain('const _reportedSubmissions = new Set<string>()');
    const at = WORKER.indexOf('async function handlePromptStatusUpdate(');
    expect(WORKER.slice(at, at + 7000)).toContain('!_reportedSubmissions.has(prompt.mediaId)');
  });

  /**
   * And the retry path has to ANNOUNCE the new id once it has one.
   *
   * The 'submitted' update fires before the retry is bound, so it carries the
   * old id. Without a second call after the capture the new id stays in the
   * content script's memory and the retry is never counted.
   */
  it('announces the id captured after a retry', () => {
    const at = AUTOMATION.indexOf('captured new mediaId after retry');
    expect(at).toBeGreaterThan(-1);
    const around = AUTOMATION.slice(Math.max(0, at - 600), at);
    expect(around).toContain('prompt.mediaId = newMediaId');
    expect(around).toMatch(/this\.updatePromptStatus\(idx, 'submitted'\)/);
  });
});
