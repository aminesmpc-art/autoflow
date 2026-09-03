/**
 * Finding the problem and then fixing it.
 *
 * Reported from a real run: the director listed seven things wrong with a
 * thirteen-shot plan — six shots missing the shared identity, one note about
 * the workflow — and then ran all thirteen anyway without asking the writer to
 * change a word. "he find problem but he dont fix it", which is exactly right.
 *
 * The cause was one line. A shot is banked when nothing BLOCKING is wrong with
 * it, and the loop then said `if (accepted.size === targets.length) break`.
 * Every one of those seven notes was an advisory, so all thirteen shots banked
 * on the first round, the loop exited, and both budgeted repair rounds went
 * unspent. `repairMessage` was never even built.
 *
 * That was an over-correction. Before it, ANY surviving problem threw, which
 * stopped whole workflows six minutes in over a blemish on one shot — see
 * storyAdvisory.test.ts for why that had to go. The pendulum went from
 * "refuse to run" straight past "ask once" to "never mention it again".
 *
 * "Ask once" is what these tests pin. One extra turn, spent only on notes a
 * writer can act on, with the banked prompt as the floor: a rewrite replaces
 * it by being better, and by nothing else.
 */

/// <reference types="node" />

import { readFileSync } from 'fs';
import { join } from 'path';
import type { Node, Edge } from '@xyflow/react';

import {
  fixableAdvisories, workflowNotes, polishMessage,
  type Problem, type ShotTarget,
} from '../studio/ask/storyboard';

const sent: Array<{ nodeId: string; config: any }> = [];
let replies: string[] = [];

jest.mock('../shared/api', () => ({
  trackUsage: jest.fn().mockResolvedValue(undefined),
  consumeStudioRun: jest.fn().mockResolvedValue(null),
  getUpgradeTarget: jest.fn().mockResolvedValue({ url: '' }),
}));

jest.mock('../studio/engine/bridge', () => {
  const handlers: Record<string, Function[]> = {};
  return {
    bridge: {
      connect: jest.fn(),
      disconnect: jest.fn(),
      send: jest.fn(),
      stopExecution: jest.fn(),
      pauseExecution: jest.fn(),
      resumeExecution: jest.fn(),
      on: (t: string, h: Function) => { (handlers[t] ||= []).push(h); },
      off: (t: string, h: Function) => {
        handlers[t] = (handlers[t] || []).filter((x) => x !== h);
      },
      executeNode: (nodeId: string, config: any) => {
        sent.push({ nodeId, config });
        setTimeout(() => {
          const isChat = config.mediaType === 'text';
          const text = isChat ? (replies.shift() ?? '{"shots":[]}') : '';
          for (const h of handlers['STUDIO_NODE_RESULT'] || []) {
            h({ nodeId, tileId: 't', text, imageUrl: isChat ? '' : 'https://example.test/x.mp4' });
          }
        }, 5);
        return true;
      },
    },
  };
});

import { runner } from '../studio/engine/WorkflowRunner';
import { useStudioStore } from '../studio/store';

const RUNNER = readFileSync(
  join(__dirname, '..', 'studio', 'engine', 'WorkflowRunner.ts'), 'utf8');

/* Both move, and both carry the anchor. Nothing is wrong with this pair. */
const P1 = 'One fixed medium-wide camera inside a tall pink lounge as the blonde designer in '
  + 'a red tracksuit walks in carrying glowing floor rails and lays them across the boards.';
const P2 = 'One fixed medium-wide camera inside the same tall pink lounge, floor already lit, '
  + 'as the blonde designer in a red tracksuit mounts the wall panels and moves the couch in.';

/* Carries the anchor, describes the room, and nothing in it moves — so it
   becomes a moving clip in which nothing moves. `static`: an advisory, because
   it renders. A worse video, not a failed one, and precisely the kind of note
   the loop used to print and abandon. */
const STILL = 'Inside the same tall pink lounge, floor already lit, the blonde designer in a '
  + 'red tracksuit seated on the low couch beside the glowing rails, warm light from below.';
/* The same note again, in different words. A rewrite that is no better. */
const STILL_AGAIN = 'The same tall pink lounge, lit from beneath, the blonde designer in a red '
  + 'tracksuit at rest on the couch, glowing rails set along the boards, warm and quiet.';

const envelope = (a: string, b: string) => JSON.stringify({
  story: 'One room, two halves.',
  anchor: 'the blonde designer in a red tracksuit, the tall pink lounge',
  shots: [
    { n: 1, title: 'Part 1', prompt: a },
    { n: 2, title: 'Part 2', prompt: b },
  ],
});

function workflow(): { nodes: Node[]; edges: Edge[] } {
  const nodes = [
    { id: 'idea', type: 'prompt', position: { x: 0, y: 0 },
      data: { type: 'prompt', label: 'Idea', text: 'a candy lounge' } },
    { id: 'story', type: 'story', position: { x: 200, y: 0 },
      data: { type: 'story', label: 'Story', platform: 'chatgpt', mediaType: 'text',
        structure: 'hook' } },
    { id: 'clipA', type: 'generate', position: { x: 500, y: 0 },
      data: { type: 'generate', label: 'Part 1', mediaType: 'video', platform: 'flow',
        aspectRatio: '9:16', duration: '10s' } },
    { id: 'clipB', type: 'generate', position: { x: 900, y: 0 },
      data: { type: 'generate', label: 'Part 2', mediaType: 'video', platform: 'flow',
        aspectRatio: '9:16', duration: '10s' } },
  ] as unknown as Node[];
  const edges = [
    { id: 'e1', source: 'idea', target: 'story', sourceHandle: 'text', targetHandle: 'text' },
    { id: 'e2', source: 'story', target: 'clipA', sourceHandle: 'text', targetHandle: 'text' },
    { id: 'e3', source: 'story', target: 'clipB', sourceHandle: 'text', targetHandle: 'text' },
  ] as unknown as Edge[];
  return { nodes, edges };
}

const promptSentTo = (id: string) => sent.find((s) => s.nodeId === id)?.config?.prompt as string;
const chatTurns = () => sent.filter((s) => s.config.mediaType === 'text');

async function run(queued: string[]) {
  replies = [...queued];
  const { nodes, edges } = workflow();
  useStudioStore.setState({ nodes, edges } as any);
  await runner.run(nodes, edges);
}

beforeEach(() => {
  sent.length = 0;
  replies = [];
  useStudioStore.setState({ nodes: [], edges: [] } as any);
});

describe('a problem nobody was ever asked to fix', () => {
  it('spends a turn on an advisory instead of only printing it', async () => {
    /* The bug, end to end. Shot 2 renders, so it banks; the old loop broke
       there and the clip was generated motionless. */
    await run([envelope(P1, STILL), envelope(P1, P2)]);

    expect(chatTurns()).toHaveLength(2);
    expect(promptSentTo('clipB')).toBe(P2);
  });

  it('names the actual note, not a generic re-ask', async () => {
    await run([envelope(P1, STILL), envelope(P1, P2)]);
    expect(chatTurns()[1].config.prompt).toContain('nothing in it moves');
  });

  it('asks for the weak shot alone and leaves the good one alone', async () => {
    await run([envelope(P1, STILL), envelope(P1, P2)]);

    const polish = chatTurns()[1].config.prompt as string;
    expect(polish).toMatch(/ONLY shot 2/);
    expect(polish).toContain('do not resend them');
    expect(promptSentTo('clipA')).toBe(P1);
  });

  it('does not tell the writer its work is unusable when it is not', async () => {
    /* repairMessage opens "That reply cannot be used as written", which is a
       lie about a prompt that renders — and an expensive one: a model told its
       work is unusable rewrites the parts nobody complained about. */
    await run([envelope(P1, STILL), envelope(P1, P2)]);

    const polish = chatTurns()[1].config.prompt as string;
    expect(polish).not.toContain('cannot be used');
    expect(polish).toContain('will all render');
  });

  it('stays in the same conversation', async () => {
    await run([envelope(P1, STILL), envelope(P1, P2)]);
    expect(chatTurns()[1].config.newChat).toBe('never');
  });

  it('costs nothing when there is nothing to fix', async () => {
    /* The whole point of banking. A clean set is one turn, as it always was. */
    await run([envelope(P1, P2)]);
    expect(chatTurns()).toHaveLength(1);
  });
});

describe('the banked prompt is the floor', () => {
  it('keeps the original when the rewrite is no better', async () => {
    /* STILL_AGAIN carries the same note STILL did. Taking it would be churn:
       a different prompt, an identical flaw, and a shot the user had already
       seen changed for no reason. */
    await run([envelope(P1, STILL), envelope(P1, STILL_AGAIN)]);

    expect(chatTurns()).toHaveLength(2);
    expect(promptSentTo('clipB')).toBe(STILL);
  });

  it('keeps the original when the rewrite arrives broken', async () => {
    /* The dangerous case. A polish is optional, so a rewrite that comes back
       carrying a code fence must not be able to turn a run that was about to
       succeed into one that stops — the fence would be typed into the
       composer, and refusing to run is worse than the note we asked about. */
    await run([envelope(P1, STILL), envelope(P1, '```\n' + P2 + '\n```')]);

    expect(promptSentTo('clipB')).toBe(STILL);
    expect(sent.some((s) => s.nodeId === 'clipB')).toBe(true);
    const story = useStudioStore.getState().nodes.find((n) => n.id === 'story');
    expect(String((story?.data as any)?.errorMessage || '')).toBe('');
  });

  it('asks once, not until the model gives in', async () => {
    /* Three replies queued and only two turns taken. A second pass on a note
       the writer already declined is a model repeating itself, and the shot
       renders either way. */
    await run([envelope(P1, STILL), envelope(P1, STILL_AGAIN), envelope(P1, P2)]);

    expect(chatTurns()).toHaveLength(2);
    expect(promptSentTo('clipB')).toBe(STILL);
  });
});

describe('the conversation the repair happens in', () => {
  it('asks the adapter to keep the thread it is going to come back to', async () => {
    /* Everything above this point assumes turn two can see turn one. On Gemini
       it could not: a finished text thread is deleted unless the caller says
       otherwise, and the turn that triggered it was the OPENING one — 'auto',
       mediaType text, nothing said. So the thread died the instant the first
       reply landed, and every repair since has been typed into an empty chat
       that had never seen the brief.

       The opening turn is the one that matters here. A repair turn sends
       newChat 'never', which the adapter already refused to tidy — which is
       exactly why this went unnoticed for so long: the guard everyone looked
       at was working perfectly, on the wrong turn. */
    await run([envelope(P1, STILL), envelope(P1, P2)]);

    const turns = chatTurns();
    expect(turns[0].config.deleteWhenDone).toBe(false);
    expect(turns[0].config.newChat).toBe('auto');
    expect(turns[1].config.deleteWhenDone).toBe(false);
  });

  it('says it on a clean run too, where there is no second turn to save', async () => {
    /* The runner cannot know in advance whether it will need to come back, so
       it never lets the thread go. A Story thread is not machine chatter
       anyway — it holds the cast, the world, the look and every prompt. */
    await run([envelope(P1, P2)]);
    expect(chatTurns()[0].config.deleteWhenDone).toBe(false);
  });
});

describe('which advisories are worth asking about', () => {
  const p = (code: string, shot: number): Problem => ({ shot, code, detail: 'x' });

  it('sends the ones about a prompt', () => {
    expect(fixableAdvisories([p('continuity', 4), p('static', 7)]).map((x) => x.code))
      .toEqual(['continuity', 'static']);
  });

  it('never sends the ones about the workflow', () => {
    /* noBoard asks for an image node ticked "Storyboard board". No rewrite of
       any prompt produces one, and a model that cannot comply invents
       compliance — last time by bolting a Consistency Reference block onto
       every prompt, which made the output worse. */
    expect(fixableAdvisories([p('noBoard', 0), p('continuity', 4)]).map((x) => x.code))
      .toEqual(['continuity']);
    expect(workflowNotes([p('noBoard', 0), p('continuity', 4)]).map((x) => x.code))
      .toEqual(['noBoard']);
  });

  it('leaves blocking problems to the repair loop that already handles them', () => {
    /* A fence is not polished, it is rescued. Two paths for one problem would
       let a shot be banked and repaired at the same time. */
    expect(fixableAdvisories([p('fence', 1), p('meta', 2), p('static', 3)]).map((x) => x.code))
      .toEqual(['static']);
    expect(workflowNotes([p('count', 0)])).toEqual([]);
  });
});

describe('the polish message', () => {
  const targets = [
    { id: 'a', label: 'Hero still', media: 'video', platform: 'flow' },
    { id: 'b', label: 'Court reveal', media: 'video', platform: 'flow' },
  ] as ShotTarget[];

  it('names the shot by its label, so the writer knows which one it means', () => {
    const out = polishMessage([{ shot: 2, code: 'static', detail: 'nothing moves.' }], targets, [2]);
    expect(out).toContain('Shot 2 ("Court reveal")');
    expect(out).toContain('nothing moves.');
  });

  it('is explicit that the rest are finished', () => {
    const out = polishMessage([{ shot: 2, code: 'static', detail: 'nothing moves.' }], targets, [2]);
    expect(out).toContain('accepted exactly as it stands');
    expect(out).toMatch(/ONLY shot 2/);
    expect(out).not.toMatch(/all 2 shots/);
  });

  it('asks for what already works to be kept', () => {
    /* Without this the writer rewrites the shot from scratch and drops the
       details that made it match the others — trading one advisory for a
       continuity break. */
    const out = polishMessage([{ shot: 1, code: 'static', detail: 'nothing moves.' }], targets, [1]);
    expect(out).toContain('Keep whatever already works');
  });
});

describe('the budget', () => {
  it('spends at most one round on polishing', () => {
    expect(RUNNER).toMatch(/const MAX_POLISH = 1;/);
    expect(RUNNER).toMatch(/polishRounds >= MAX_POLISH/);
  });

  it('never polishes at the cost of a rescue', () => {
    /* The polish branch is reached only when every shot is banked, so a shot
       still needing repair always has the turn instead. */
    const at = RUNNER.indexOf('if (accepted.size === targets.length) {');
    expect(at).toBeGreaterThan(-1);
    expect(RUNNER.slice(at, at + 400)).toMatch(/fixableAdvisories/);
  });

  it('says the workflow notes are for the user, not for the writer', () => {
    /* "7 problems" then "6 worth fixing" read as an arithmetic error. It was
       two kinds of note, and only one of them had anywhere to go. */
    expect(RUNNER).toMatch(/notes = workflowNotes\(problems\);/);
    expect(RUNNER).toMatch(/about how the workflow is wired, not the prompts/);
  });
});
