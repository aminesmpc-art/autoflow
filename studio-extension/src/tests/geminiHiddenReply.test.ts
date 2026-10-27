/// <reference types="node" />

import { readFileSync } from 'fs';
import { join } from 'path';
import ts from 'typescript';

type Poll = { at: number; text: string; running?: boolean; finished?: boolean | null; containers?: number };
const SOURCE = readFileSync(join(__dirname, '../content/gemini/index.ts'), 'utf8');

/** Run the actual tracker with delayed reconciliation, without contacting Gemini. */
function tracker(polls: Poll[]) {
  const start = SOURCE.indexOf('async function trackTextReply(');
  const end = SOURCE.indexOf('\n}', start) + 2;
  const constants = SOURCE.match(/^const (?:TEXT_TIMEOUT_MS|TEXT_QUIET_MS|NO_ANSWER_YET_MS|QUIET_POLLS_REQUIRED|TEXT_CEILING_MS|POLL_MS) = .+;$/gm);
  if (start < 0 || !constants || constants.length !== 6) throw new Error('Gemini tracker or constants not found');
  const code = ts.transpileModule(`${constants.join('\n')}\n${SOURCE.slice(start, end)}\nreturn trackTextReply;`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const sent: Array<{ type: string; payload: any }> = [];
  let now = 0;
  let poll: Poll = { at: 0, text: '' };
  let index = 0;
  const next = async () => {
    poll = polls[index++];
    if (!poll) throw new Error('Tracker did not settle within the supplied polls');
    now = poll.at;
  };
  const run = new Function('Date', 'sleepOrDomChange', 'sleep', 'send', 'readLatestReply', 'isGenerating', 'replyContainers',
    'logLine', 'turnFinished', 'cleanAssistantReply', 'looksLikeUsablePrompt', 'conversationId', 'location', code)(
    { now: () => now }, next, next,
    (type: string, payload: any) => sent.push({ type, payload }),
    () => poll.text, () => poll.running === true,
    () => Array.from({ length: poll.containers ?? (poll.text ? 1 : 0) }),
    () => undefined, () => poll.finished ?? null,
    (reply: string) => reply.trim(), (reply: string) => reply.length >= 20,
    () => 'fixture-chat', { pathname: '/app/fixture-chat' },
  );
  return { run, terminal: () => sent.filter(({ type }) => type === 'STUDIO_NODE_RESULT' || type === 'STUDIO_NODE_ERROR') };
}

const FULL = 'A complete cinematic prompt with a forest cabin, mist and soft natural light.';

describe('Gemini hidden-tab reconciliation', () => {
  it('captures new finished text after a delayed poll instead of judging the older quiet clock', async () => {
    const test = tracker([
      { at: 2_000, text: 'A partial cinematic prompt', finished: false },
      { at: 62_000, text: FULL, finished: true },
    ]);
    await test.run('node', '', true);
    expect(test.terminal()).toEqual([{ type: 'STUDIO_NODE_RESULT', payload: expect.objectContaining({ nodeId: 'node', text: FULL }) }]);
  });

  it('captures a first answer discovered after the no-answer budget, when the site says it is finished', async () => {
    const test = tracker([
      { at: 2_000, text: '' },
      { at: 302_000, text: FULL, finished: true },
    ]);
    await test.run('node', '', true);
    expect(test.terminal()[0]).toEqual({ type: 'STUDIO_NODE_RESULT', payload: expect.objectContaining({ text: FULL }) });
  });

  it('accepts an identical answer only when it belongs to a new reply container', async () => {
    const test = tracker([
      { at: 2_000, text: FULL, finished: true, containers: 1 },
      { at: 302_000, text: FULL, finished: true, containers: 2 },
    ]);
    await test.run('node', FULL, true, 0, 1);
    expect(test.terminal()[0]).toEqual({ type: 'STUDIO_NODE_RESULT', payload: expect.objectContaining({ text: FULL }) });
  });

  it('still times out with no new answer rather than capturing the previous turn', async () => {
    const test = tracker([
      { at: 2_000, text: FULL, finished: true, containers: 1 },
      { at: 302_000, text: FULL, finished: true, containers: 1 },
    ]);
    await test.run('node', FULL, true, 0, 1);
    expect(test.terminal()).toEqual([{ type: 'STUDIO_NODE_ERROR', payload: expect.objectContaining({ error: expect.stringContaining('did not finish answering') }) }]);
  });

  it('keeps the foreground completion path immediate when the footer appears', async () => {
    const test = tracker([{ at: 2_000, text: FULL, finished: true }]);
    await test.run('node', '', false);
    expect(test.terminal()[0]).toEqual({ type: 'STUDIO_NODE_RESULT', payload: expect.objectContaining({ text: FULL }) });
  });

  it('still requires two stable polls when the footer cannot be read', async () => {
    const test = tracker([
      { at: 2_000, text: FULL },
      { at: 4_000, text: FULL },
      { at: 6_000, text: FULL },
    ]);
    await test.run('node', '', true);
    expect(test.terminal()[0]).toEqual({ type: 'STUDIO_NODE_RESULT', payload: expect.objectContaining({ text: FULL }) });
  });
});
