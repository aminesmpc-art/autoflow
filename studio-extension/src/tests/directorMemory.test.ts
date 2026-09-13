/**
 * "i need every diractor to remamber his conversation … he gat the same memory
 * and he just tell whats need tobe fixed" — and the failure that made it
 * obvious: a Director Chief reported "Gemini did not finish answering in time"
 * with its finished answer sitting in the Gemini tab, and 25 nodes skipped
 * behind it.
 *
 * Two faults, one run.
 *
 * ── The Chief was abandoned while it was still thinking ──────────────────
 *
 * trackTextReply broke out of its wait on
 *
 *     Date.now() - lastChangeAt > TEXT_QUIET_MS && !isGenerating()
 *
 * lastChangeAt moves only when the REPLY TEXT changes, so before the first
 * token it never moves — the 45-second "it stopped growing" budget was being
 * counted from the moment of asking. Diagnostics recorded the state exactly:
 *
 *     Waiting 16s — finished false, generating true, reply 0 chars
 *     Waiting 30s — finished false, generating true, reply 0 chars
 *     Waiting 47s — finished false, generating true, reply 0 chars
 *
 * 0 chars is not a fault. That is what an extended model looks like while it
 * reasons. But from 45s on, ONE poll reading "not generating" ended the turn —
 * and isGenerating() would read exactly that, because with our own turn not
 * yet rendered it inspected the PREVIOUS, finished answer, whose
 * .response-footer carries `complete`.
 *
 * ── And nobody remembered anything, so everything was re-sent ────────────
 *
 * Each ask opened a new chat, so a repair had to carry the whole world back to
 * the model that had just written it. The Chief's review did it once per
 * round; a Director asked to fix one shot was handed all ten again.
 */

/// <reference types="node" />

import { reviewAsk, reviewFollowUp } from '../studio/ask/chiefProduction';

/* ── The adapter's wait, read as source ──────────────────────────────────
 *
 * gemini/index.ts runs top-level side effects on import — it installs message
 * listeners against a chrome that does not exist here — so the wait cannot be
 * driven directly. The logic is asserted where it lives instead, the same way
 * the sibling extension's interceptor is. */
import { readFileSync } from 'fs';
import { join } from 'path';

const GEMINI = readFileSync(
  join(__dirname, '..', 'content', 'gemini', 'index.ts'), 'utf8').replace(/\r\n/g, '\n');

describe('waiting on a model that thinks before it writes', () => {
  it('does not measure "stopped growing" from before it started', () => {
    /* The whole bug in one line: two budgets, chosen by whether a first token
       has arrived. One budget for both is what abandoned a live turn. */
    expect(GEMINI).toMatch(/const budget = answerStarted \? TEXT_QUIET_MS : NO_ANSWER_YET_MS;/);
  });

  it('gives a thinking model minutes, not forty-five seconds', () => {
    const ms = /const NO_ANSWER_YET_MS = (\d+) \* 60 \* 1000;/.exec(GEMINI);
    expect(ms).not.toBeNull();
    expect(Number(ms![1])).toBeGreaterThanOrEqual(3);
  });

  it('still ends a chat that never answers at all', () => {
    /* The budget is longer, not absent. A tab that will never reply has to
       stop being waited on, or the node hangs to its outer backstop. */
    expect(GEMINI).toMatch(/if \(silentFor > budget && quietPolls >= QUIET_POLLS_REQUIRED\)/);
    expect(GEMINI).toMatch(/No answer after \$\{Math\.round\(silentFor \/ 1000\)\}s/);
  });

  it('will not end a turn on one flickering poll', () => {
    /* Between a thinking phase ending and the first token the page is neither
       streaming nor finished: the send button re-enables and every other
       signal is absent. A single reading there is not an ending. */
    expect(GEMINI).toMatch(/const QUIET_POLLS_REQUIRED = 2;/);
    expect(GEMINI).toMatch(/quietPolls = running \? 0 : quietPolls \+ 1;/);
  });

  it('says in Diagnostics that nothing has started yet', () => {
    /* "reply 0 chars" alone read as a fault. It is the normal look of a model
       that is thinking, and the feed should say so rather than leave the user
       to guess which of the two it is watching. */
    expect(GEMINI).toMatch(/\(not started — thinking\)/);
    expect(GEMINI).toMatch(/Answer started after \$\{Math\.round\(elapsed \/ 1000\)\}s\./);
  });
});

describe('telling our turn from the one before it', () => {
  it('takes a turn count before submitting', () => {
    expect(GEMINI).toMatch(
      /const turnsBefore = document\.querySelectorAll\('model-response, structured-content-container'\)\.length;/);
  });

  it('passes it to the wait, which passes it to isGenerating', () => {
    expect(GEMINI).toMatch(/trackTextReply\(nodeId, priorReply, config\?\.rawReply === true, turnsBefore\)/);
    expect(GEMINI).toMatch(/function isGenerating\(sinceTurns = 0\): boolean/);
    expect(GEMINI).toMatch(/const running = isGenerating\(sinceTurns\);/);
  });

  it('refuses to read a previous answer as this turn\'s state', () => {
    /* The specific misreading: the last model-response on the page belonged to
       the PREVIOUS question, it was complete, so "is it generating" answered
       false about a turn that had not started. */
    expect(GEMINI).toMatch(/const ours = turns\.length > sinceTurns;/);
    expect(GEMINI).toMatch(/const latest = ours \? turns\[turns\.length - 1\] : null;/);
  });

  it('still consults the page-wide signals when our turn has not rendered', () => {
    /* Scoping must not mean going blind. The stop button and the send button
       speak for the request in flight whether or not it has an element yet —
       returning false there would trade one wrong reading for another. */
    const at = GEMINI.indexOf('function isGenerating(sinceTurns = 0)');
    const body = GEMINI.slice(at, GEMINI.indexOf('\n}', at));
    expect(body).toMatch(/if \(findStopButton\(\)\) return true;/);
    expect(body).toMatch(/const btn = findSendButton\(\)/);
  });

  it('names the adapter build, so a stale tab is visible', () => {
    /* A content script already injected into an open tab is not replaced by a
       rebuild. Without a new name, this fix and its absence look identical. */
    expect(GEMINI).toMatch(/const ADAPTER_BUILD = 'thinking-wait-v5';/);
  });
});

/* ── The memory ─────────────────────────────────────────────────────────── */

const RUNNER = readFileSync(
  join(__dirname, '..', 'studio', 'engine', 'WorkflowRunner.ts'), 'utf8').replace(/\r\n/g, '\n');

describe('every node keeps its own conversation', () => {
  it('decides newChat from the open thread, not the caller\'s opinion', () => {
    /* firstTurn is the caller saying "this is a new conversation as I see it".
       The Chief's review passes true on every round and a Director's repair
       is a fresh story loop whose first ask is also true — so both meant a new
       chat, and both then had to re-send what the model had just written. */
    expect(RUNNER).toMatch(
      /newChat: firstTurn && !this\.continuesThread\(nodeId\) \? 'auto' : 'never',/);
  });

  it('records the thread only after a reply actually lands', () => {
    /* Marking it open on a turn that never answered would send the retry into
       a chat that does not exist — "fix scene 4" into an empty room, which is
       the failure the map exists to end. */
    const at = RUNNER.indexOf('private async askOnce(');
    const body = RUNNER.slice(at, RUNNER.indexOf('private async runAgentTool', at));
    const mark = body.indexOf('this.openThreads.set(nodeId, { plan: this.planKey, path });');
    const ask = body.indexOf('await this.awaitBridge(');
    expect(mark).toBeGreaterThan(ask);
  });

  it('scopes a thread to the plan it was opened under', () => {
    expect(RUNNER).toMatch(/open\.plan === this\.planKey/);
    expect(RUNNER).toMatch(/private adoptPlan\(key: string, author: string\): void/);
  });

  it('keeps the Chief\'s own thread when it adopts the plan it just wrote', () => {
    /* adoptPlan clears every thread opened under an older plan. The Chief is
       the exception by construction: the plan was written in its chat, and the
       review turns that follow are the next turns of that same conversation.
       Clearing it would make the Chief re-send the plan to itself. */
    const at = RUNNER.indexOf('private adoptPlan(');
    const body = RUNNER.slice(at, RUNNER.indexOf('\n  }', at));
    expect(body).toMatch(/if \(authors\) this\.openThreads\.set\(author, \{ \.\.\.authors, plan: key \}\);/);
    expect(RUNNER).toMatch(/this\.adoptPlan\(reply, nodeId\);/);
  });

  it('survives a Retry, which is the case it exists for', () => {
    /* Retry passes `only`. A retried Chief picks up the thread it planned in
       and a retried Director the one it wrote its shots in, so the turn can be
       "fix scene 4" rather than the whole production again. */
    const at = RUNNER.indexOf('    // Reset\n');
    const reset = RUNNER.slice(at, RUNNER.indexOf('store.setRunning(true);', at));
    const retry = reset.slice(reset.indexOf('if (only) {'), reset.indexOf('} else {'));
    expect(retry).not.toContain('forgetThreads');
  });

  it('but a full Run starts every conversation over', () => {
    /* The outer bound on a memory. Pressing Run means "make this again", and
       the brief or the cast may have changed since — continuing would answer
       the new question with the old story still in the room, and nothing on
       screen would say so.

       It is also what stops the empty planKey behaving like a real plan. Left
       out, a node that had asked anything at all in the session read as having
       a live thread under the "no plan" key, and a first turn that should have
       opened a chat continued a stale one instead — which is exactly how the
       existing story-settings tests caught this. */
    const at = RUNNER.indexOf('    // Reset\n');
    const reset = RUNNER.slice(at, RUNNER.indexOf('store.setRunning(true);', at));
    expect(reset.slice(reset.indexOf('} else {'))).toContain('this.forgetThreads();');
  });

  it('forgets everything when the plan is cleared', () => {
    expect(RUNNER).toMatch(/forgetThreads\(\): void \{\s*\n\s*this\.openThreads\.clear\(\);\s*\n\s*this\.planKey = '';/);
    const chief = readFileSync(
      join(__dirname, '..', 'studio', 'nodes', 'ChiefNode.tsx'), 'utf8');
    expect(chief).toContain('runner.forgetThreads();');
  });
});

describe('what a repair actually says', () => {
  const directors = [{
    id: 'director_1_5',
    targets: [
      { id: 'scene_1', label: 'Leo Gets His Choice' },
      { id: 'scene_4', label: 'Gia Arrives' },
    ],
  }] as any;
  const prompts = { director_1_5: ['prompt one', 'prompt four'] };
  const PLAN = JSON.stringify({ story: 'the wrong room', bible: { cast: ['Leo', 'Gia'] } });

  it('does not read the plan back to the Chief that wrote it', () => {
    const followUp = reviewFollowUp(directors, prompts);
    expect(followUp).not.toContain('the wrong room');
    expect(followUp).not.toContain('bible');
  });

  it('still sends what is new — the prompts to be reviewed', () => {
    const followUp = reviewFollowUp(directors, prompts);
    expect(followUp).toContain('prompt one');
    expect(followUp).toContain('prompt four');
    expect(followUp).toContain('scene_4');
  });

  it('repeats the answer contract, which governs this turn', () => {
    /* Everything else is in the thread. This is not: a model that has written
       prose in between drifts off the JSON shape unless told again. */
    expect(reviewFollowUp(directors, prompts)).toContain('{"approved":true,"issues":[]}');
  });

  it('is dramatically shorter than the form that assumes no memory', () => {
    expect(reviewFollowUp(directors, prompts).length)
      .toBeLessThan(reviewAsk(PLAN, directors, prompts).length);
  });

  it('keeps the full form for a Chief with no thread', () => {
    /* A run resumed into a fresh session has a cached plan but no chat. There
       the Chief genuinely has not seen it and must be shown it — so both forms
       stay, chosen by continuesThread. */
    expect(reviewAsk(PLAN, directors, prompts)).toContain('the wrong room');
    expect(RUNNER).toMatch(/const carries = this\.continuesThread\(nodeId\);/);
    expect(RUNNER).toMatch(/const full = reviewAsk\(reply, directors, checkpoint\.prompts\);/);
    expect(RUNNER).toMatch(/carries \? reviewFollowUp\(directors, checkpoint\.prompts\) : full,/);
  });

  it('asks a remembering Director for the broken shots only', () => {
    const at = RUNNER.indexOf('const delta = ');
    expect(at).toBeGreaterThan(-1);
    const body = RUNNER.slice(at, at + 900);
    expect(body).toMatch(/Send back ONLY the shots named above/);
    expect(body).toMatch(/do not repeat them/);
    expect(body).toMatch(/briefs\.set\(director\.id, remembers \? delta : wholeThing\);/);
  });

  it('and only re-sends the other nine when it has forgotten them', () => {
    /* The old message carried every untouched prompt back for the sake of two
       words changing in one of them — necessary then, because the repair
       opened a new chat. It survives for exactly that case. */
    const at = RUNNER.indexOf('const wholeThing = ');
    const body = RUNNER.slice(at, at + 500);
    expect(body).toMatch(/Keep all other target prompts unchanged: ' \+ JSON\.stringify\(old\)/);
  });
});

/* ── The thread has to be returnable, not only remembered ────────────────
 *
 * The first version of this feature was wrong in a way the map could not see.
 * `newChat: 'never'` does not go back to a conversation — it means only "do not
 * open a new one", so it types into whatever is on screen. Nodes run one after
 * another in a single tab:
 *
 *   Chief plans        opens chat A
 *   Directors 1..3     open chats B, C, D
 *   Chief review       'never' lands in chat D
 *
 * The Chief's review, written as a follow-up to a plan it had made, would have
 * arrived in the third Director's chat — and the reply would have looked fine.
 */
describe('coming back to the right conversation', () => {
  const GEM_TIDY = readFileSync(
    join(__dirname, '..', 'content', 'gemini', 'tidy.ts'), 'utf8').replace(/\r\n/g, '\n');

  it('will not call a thread open until it knows where it is', () => {
    expect(RUNNER).toMatch(/return !!open && open\.plan === this\.planKey && !!open\.path;/);
  });

  it('records the path the adapter reported, and forgets the node without one', () => {
    /* An adapter that cannot say where the turn happened leaves the node with
       no memory rather than an unreachable one — the follow-up form is only
       safe where the follow-up can actually be delivered. */
    expect(RUNNER).toMatch(/if \(path\) this\.openThreads\.set\(nodeId, \{ plan: this\.planKey, path \}\);/);
    expect(RUNNER).toMatch(/else this\.openThreads\.delete\(nodeId\);/);
  });

  it('names the conversation on every continuing turn', () => {
    expect(RUNNER).toMatch(/resumeConversation: this\.continuesThread\(nodeId\)/);
  });

  it('clicks the sidebar row rather than assigning the URL', () => {
    /* Gemini is an Angular SPA and its rows are client-side routes. Assigning
       location.href is a real navigation: it tears down the content script
       mid-run and the node waits out its backstop on a reply nothing is
       listening for. Same reasoning as the mode switches in the adapter. */
    expect(GEM_TIDY).toMatch(/export async function openConversation\(id: string\): Promise<boolean>/);
    expect(GEM_TIDY).toMatch(/link\.click\(\);/);
    expect(GEM_TIDY).not.toMatch(/location\.href =/);
  });

  it('reports back whether it actually got there', () => {
    /* False has to be a real answer. Returning void and hoping would put the
       follow-up in whatever chat the click landed on. */
    const at = GEM_TIDY.indexOf('export async function openConversation');
    const body = GEM_TIDY.slice(at);
    expect(body).toMatch(/if \(conversationId\(location\.pathname\) === id\) return true;/);
    expect(body).toMatch(/return false;/);
  });

  it('refuses to answer in the wrong thread', () => {
    const at = GEMINI.indexOf('const back = await openConversation(config.resumeConversation);');
    expect(at).toBeGreaterThan(-1);
    const body = GEMINI.slice(at, at + 700);
    expect(body).toMatch(/if \(!back\) \{/);
    expect(body).toMatch(/threadLost: true/);
    expect(body).toMatch(/STUDIO_NODE_ERROR/);
  });

  it('and the runner asks again the long way instead of losing the round', () => {
    /* One wasted turn, not a failed run. Routed on a carried flag rather than
       on the words in the error message. */
    expect(RUNNER).toMatch(/if \(payload\.threadLost\) err\.threadLost = true;/);
    expect(RUNNER).toMatch(/if \(!error\?\.threadLost\) throw error;/);
    expect(RUNNER).toMatch(/carries \? full : undefined\);/);
    const at = RUNNER.indexOf('if (!error?.threadLost || !remembers) throw error;');
    expect(at).toBeGreaterThan(-1);
    expect(RUNNER.slice(at, at + 260)).toMatch(/briefs\.set\(director\.id, wholeThing\);/);
  });
});
