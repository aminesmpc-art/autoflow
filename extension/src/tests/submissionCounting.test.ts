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
