/**
 * A repair is the next turn, not a new subject.
 *
 * The builder asks for a plan, checks it, and sends the problems back. Every
 * one of those rounds opened a NEW chat, so round two said
 *
 *     "That plan has problems. Fix them and send the whole JSON object again.
 *      · A step has no id."
 *
 * to a model that had never seen a plan. Gemini answered it exactly as anyone
 * would — "Could you please provide the original JSON object or the plan you
 * are referring to?" — and then, asked again, produced a NEW plan built from
 * the complaint alone. The build trail shows it: eight steps, one problem,
 * then four steps and four structural problems. The repair made it worse and
 * the loop spent its last round failing differently.
 *
 * The Story node's own repair loop has always threaded correctly. Only the
 * builder never did, which is why this went unnoticed: the two loops look
 * identical from the outside and only one of them worked.
 */

/// <reference types="node" />

import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..', '..');
const read = (...p: string[]) => readFileSync(join(ROOT, 'src', ...p), 'utf8');

const panel = read('sidepanel', 'index.ts');
const worker = read('background', 'service-worker.ts');
const runner = read('studio', 'engine', 'WorkflowRunner.ts');

describe('the builder keeps its conversation', () => {
  it('opens a chat for the first ask and continues it for repairs', () => {
    expect(panel).toMatch(/newChat: round === 0 \? 'auto' : 'never'/);
  });

  it('the worker forwards what it was asked for', () => {
    /* It hardcoded 'auto'. Passing the flag from the panel and ignoring it
       here would look correct in every diff and change nothing at all. */
    expect(worker).toMatch(/askChatForPlan\(msg\.platform, msg\.prompt, msg\.model \|\| '', msg\.newChat/);
    expect(worker).toMatch(/newChat,\n\s+model,/);
    expect(worker).not.toMatch(/newChat: 'auto',\n\s+model,/);
  });

  it('defaults to a new chat when nobody says otherwise', () => {
    /* Everything else that asks for a plan — and anyone calling it later —
       should still get a clean thread. Only a repair opts out. */
    expect(worker).toMatch(/newChat: 'auto' \| 'never' = 'auto'/);
  });
});

describe('the Story node already did this, and must keep doing it', () => {
  it('threads its own repair rounds', () => {
    expect(runner).toMatch(/newChat: firstTurn \? 'auto' : 'never'/);
    /* Matched loosely on purpose: this call spans lines, carries the
       reference stills, and now also has to know whether a settings turn
       already opened the conversation. What matters is that a fresh chat is
       decided by round 0 and nothing else — not how it is wrapped. */
    const flat = runner.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ');
    expect(flat).toMatch(
      /this\.askAgent\( nodeId, platform, message, round === 0[^,]*,/);
  });

  it('does not re-open the chat the settings turn already started', () => {
    /* A Story node with nothing configured spends a turn choosing how to make
       the piece. Opening a new chat for the prompts would throw that away and
       pay for describing the piece twice. */
    const flat = runner.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ');
    expect(flat).toMatch(/round === 0 && !storyRun\?\.threadOpen/);
  });
});

describe('every adapter honours it', () => {
  /* The fix is worth nothing if the adapter starts a new chat anyway. Gemini
     is the one in the report, but a builder can target any of them. */
  it.each(['chatgpt', 'gemini', 'claude', 'grok', 'zai'])('%s skips the new chat', (name) => {
    const src = read('content', name, 'index.ts');
    expect(src).toMatch(/newChat !== 'never'/);
  });
});
