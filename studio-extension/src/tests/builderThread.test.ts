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
/* Line endings normalised on read. Windows checkouts have core.autocrlf on,
   so these files are CRLF in the working tree while the regexes below are
   written with a bare newline escape — so these assertions failed on the
   developer's machine and passed in CI, which is the worst way round. */
const read = (...p: string[]) =>
  readFileSync(join(ROOT, 'src', ...p), 'utf8').replace(/\r\n/g, '\n');

const panel = read('sidepanel', 'index.ts');
const worker = read('background', 'service-worker.ts');
const runner = read('studio', 'engine', 'WorkflowRunner.ts');

describe('the builder keeps its conversation', () => {
  it('opens a chat for the first ask and continues it for repairs', () => {
    expect(panel).toMatch(/newChat: round === 0 && !threadOpen \? 'auto' : 'never'/);
  });

  it('does not re-open the chat the reading turn already started', () => {
    /* Exactly the guard the Story node has for its settings turn, below, and
       arrived here for the same reason: a long pasted brief is now read on a
       turn of its own before anything is planned. Opening a new chat for the
       plan would throw that reading away and pay to send the document twice. */
    expect(panel).toMatch(/let threadOpen = false;/);
    expect(panel).toMatch(/threadOpen = true;/);
  });

  it('does not re-send the pictures the reading turn already sent', () => {
    expect(panel).toMatch(/images: round === 0 && !threadOpen && IMAGE_CAPABLE/);
  });

  it('tells Gemini to keep the thread it is going to come back to', () => {
    /* The builder's rounds are turns of one conversation, so the thread IS
       the memory here in the way it is for a Story node — and Gemini deletes
       a finished text thread unless told otherwise. Found while adding a turn
       that depends on the thread surviving; it had been breaking the repair
       rounds all along, which is the same failure this file was opened for. */
    expect(worker).toMatch(/deleteWhenDone: false,/);
  });

  it('the worker forwards what it was asked for', () => {
    /* It hardcoded 'auto'. Passing the flag from the panel and ignoring it
       here would look correct in every diff and change nothing at all. */
    /* Flattened: the call spans lines now that it also carries the pictures
       the user attached. What matters is that the panel's flag is passed on
       rather than hardcoded here. */
    expect(worker.replace(/\s+/g, ' ')).toMatch(
      /askChatForPlan\( msg\.platform, msg\.prompt, msg\.model \|\| '', msg\.newChat/);
    /* `deleteWhenDone` sits between these two now, so the check is that the
       panel's flag is forwarded rather than hardcoded — which was always what
       it was for. */
    expect(worker).toMatch(/^\s+newChat,$/m);
    expect(worker).not.toMatch(/newChat: 'auto',\n/);
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
