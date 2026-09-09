/**
 * One definition of "sent to Flow", across both products.
 *
 * This runner reports every node type through the same call:
 *
 *   trackUsage(1, 'text', 'done')
 *
 * A Gemini ask, a Grok extend and an Omni generation all land in one bucket.
 * So a Studio Flow clip was invisible in the number meant to be billable,
 * while three chat round-trips inflated it — a third counting path, unrelated
 * to either of the other two.
 *
 * The media id settles both halves at once. A Flow generation has one, so it
 * lands in exactly the count the queue extension reports to. A chat node never
 * gets one, so it cannot land there at all — which is right: it is a different
 * resource and should not be in the Flow number.
 */

/// <reference types="node" />

import { readFileSync } from 'fs';
import { join } from 'path';

const RUNNER = readFileSync(
  join(__dirname, '..', 'studio', 'engine', 'WorkflowRunner.ts'), 'utf8').replace(/\r\n/g, '\n');
const BRIDGE = readFileSync(
  join(__dirname, '..', 'studio', 'engine', 'bridge.ts'), 'utf8').replace(/\r\n/g, '\n');
const FLOW = readFileSync(
  join(__dirname, '..', 'content', 'flow', 'index.ts'), 'utf8').replace(/\r\n/g, '\n');
const API = readFileSync(
  join(__dirname, '..', 'shared', 'api.ts'), 'utf8').replace(/\r\n/g, '\n');

describe('the media id reaches the runner', () => {
  it('the adapter sends it back with the result', () => {
    const at = FLOW.indexOf("type: 'STUDIO_NODE_RESULT'");
    expect(at).toBeGreaterThan(-1);
    expect(FLOW.slice(at, at + 800)).toMatch(/mediaId: mediaId \|\| ''/);
  });

  it('it is a distinct field from the tile id', () => {
    /* tileId names a DOM node in the grid and is recycled; the media id is
       Flow's own id for the generation. Conflating them would report a
       submission that Flow never confirmed. */
    expect(BRIDGE).toMatch(/mediaId\?: string;/);
    expect(BRIDGE).toMatch(/tileId: string;/);
  });

  it('the bridge carries it through', () => {
    expect(RUNNER).toMatch(/mediaId: payload\.mediaId \|\| '',/);
  });
});

describe('a Flow node reports a submission, a chat node cannot', () => {
  const block = (): string => {
    const at = RUNNER.indexOf('const media = String(this.nodeResults');
    expect(at).toBeGreaterThan(-1);
    return RUNNER.slice(at - 1200, at + 900);
  };

  it('reports it off the stored result', () => {
    expect(block()).toMatch(/this\.nodeResults\.get\(step\.nodeId\)\?\.mediaId/);
    expect(block()).toMatch(/trackSubmission\(\{/);
  });

  it('sends nothing when there is no media id', () => {
    expect(block()).toMatch(/if \(media\) \{/);
  });

  it('a text node stores no media id, so it can never qualify', () => {
    /* The success path stores {tileId:'', imageUrl: result.text} for a text
       node — deliberately without one. That is what keeps chat round-trips
       out of the Flow number. */
    expect(RUNNER).toMatch(/this\.nodeResults\.set\(step\.nodeId, \{ tileId: '', imageUrl: result\.text \|\| '' \}\)/);
  });

  it('marks the run so Studio submissions are identifiable', () => {
    expect(block()).toMatch(/mode: 'studio'/);
    expect(block()).toMatch(/queueId: `studio:\$\{/);
  });

  it('still settles the old per-node event', () => {
    /* Both numbers are written during the dual-write period. Dropping the old
       one here would blank Studio out of today's dashboard. */
    expect(block()).toMatch(/trackUsage\(1, 'text', 'done'\)/);
  });

  it('never lets metering fail a generation', () => {
    expect(block()).toMatch(/metering must never fail a generation/);
  });
});

describe('Studio posts to the same endpoint as the queue extension', () => {
  it('same path, same field names', () => {
    const body = API.slice(API.indexOf('export async function trackSubmission'),
                           API.indexOf('export async function trackUsage'));
    expect(body).toMatch(/'\/api\/usage\/submitted'/);
    for (const field of ['media_id', 'queue_id', 'prompt_index', 'prompt_type', 'outcome']) {
      expect(body).toContain(field);
    }
  });

  it('refuses to send without the evidence', () => {
    const body = API.slice(API.indexOf('export async function trackSubmission'));
    expect(body).toMatch(/if \(!input\.mediaId\) return false;/);
  });

  it('treats a 404 as an older backend', () => {
    const body = API.slice(API.indexOf('export async function trackSubmission'),
                           API.indexOf('export async function trackUsage'));
    expect(body).toMatch(/if \(res\.status === 404\) return false;/);
  });
});
