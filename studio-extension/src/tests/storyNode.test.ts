/**
 * The Story node.
 *
 * Its own type rather than a mode on Ask AI, because a node that writes for
 * five other nodes has to see the graph, and five wires leaving a box says
 * that on the canvas where a checkbox would not.
 *
 * It never edits the canvas. The nodes are the user's; this fills them in.
 */

/// <reference types="node" />

import { readFileSync } from 'fs';
import { join } from 'path';
import {
  RUNNABLE_NODE_TYPES, RENDERABLE_NODE_TYPES, NODE_PORTS, isRunnableType,
} from '../studio/templates/validate';
import { orderShotTargets, shotContract } from '../studio/ask/storyboard';

const SRC = join(__dirname, '..');

describe('the Story node is registered everywhere a node type must be', () => {
  it('runs, draws, and has ports', () => {
    expect(isRunnableType('story')).toBe(true);
    expect(RUNNABLE_NODE_TYPES).toContain('story');
    expect(RENDERABLE_NODE_TYPES).toContain('story');
    expect(NODE_PORTS.story).toEqual({ in: ['text'], out: ['text'] });
  });

  it('is dispatched by the runner switch, not only by a branch below it', () => {
    /* A type missing from that switch is counted in the progress total and
       then silently skipped — the run finishes instantly having done nothing,
       which is how the agent node failed on its first outing. */
    const runner = readFileSync(join(SRC, 'studio', 'engine', 'WorkflowRunner.ts'), 'utf8');
    expect(runner).toContain("case 'story':");
  });

  it('refuses to run wired to nothing, rather than asking for a plan for no one', () => {
    const runner = readFileSync(join(SRC, 'studio', 'engine', 'WorkflowRunner.ts'), 'utf8');
    /* "Director" since the rename — the label changed, the stored type
       ('story') did not, so this is the only string here that moved. */
    expect(runner).toContain('This Director is not wired to anything');
  });
});

describe('what a Story node writes for', () => {
  const nodes = [
    { id: 'idea', type: 'prompt', position: { x: 0, y: 0 }, data: {} },
    { id: 'story', type: 'story', position: { x: 200, y: 0 }, data: { platform: 'chatgpt' } },
    {
      id: 'poster', type: 'generate', position: { x: 600, y: 0 },
      data: { label: 'Poster', mediaType: 'image', platform: 'chatgpt', aspectRatio: '9:16' },
    },
    {
      id: 'clipA', type: 'generate', position: { x: 900, y: 0 },
      data: { label: 'Clip A', mediaType: 'video', platform: 'flow', aspectRatio: '9:16', duration: '10s' },
    },
    {
      id: 'clipB', type: 'generate', position: { x: 1200, y: 0 },
      data: { label: 'Clip B', mediaType: 'video', platform: 'flow', aspectRatio: '9:16', duration: '10s' },
    },
    // A downstream writer, not a shot.
    { id: 'ask', type: 'generate', position: { x: 1500, y: 0 }, data: { mediaType: 'text' } },
  ];
  const edges = [
    { source: 'idea', target: 'story', targetHandle: 'text' },
    { source: 'story', target: 'poster', targetHandle: 'text' },
    { source: 'story', target: 'clipA', targetHandle: 'text' },
    { source: 'story', target: 'clipB', targetHandle: 'text' },
    { source: 'story', target: 'ask', targetHandle: 'text' },
  ];

  it('covers every generator it is wired to, in canvas order', () => {
    const t = orderShotTargets('story', nodes as any, edges as any);
    expect(t.map((x) => x.id)).toEqual(['poster', 'clipA', 'clipB']);
  });

  it('leaves the chained writer out of the shot list', () => {
    // An Ask AI downstream is the next link, not a shot to be written.
    expect(orderShotTargets('story', nodes as any, edges as any).map((x) => x.id))
      .not.toContain('ask');
  });

  it('describes each one by what it is configured to do', () => {
    const c = shotContract(orderShotTargets('story', nodes as any, edges as any));
    expect(c).toContain('WRITE ALL 3 PROMPTS');
    expect(c).toContain('Poster — a still image (9:16, chatgpt)');
    expect(c).toContain('Clip A — a moving clip (9:16, 10s, flow)');
    expect(c).toContain('must say what MOVES');
  });

  it('does not tell a still it has a duration', () => {
    const c = shotContract(orderShotTargets('story', nodes as any, edges as any));
    const posterLine = c.split('\n').find((l) => l.includes('Poster')) as string;
    expect(posterLine).not.toMatch(/\b10s\b/);
  });
});

describe('the summary the node shows for itself', () => {
  const runner = readFileSync(join(SRC, 'studio', 'engine', 'WorkflowRunner.ts'), 'utf8');
  const combined = runner.slice(
    runner.indexOf('const combined = best.shots'),
    runner.indexOf("      .join('\n\n');"),
  );

  it('prints the prompt, not the Shot object holding it', () => {
    /* It interpolated the Shot itself, so resultText was every target label
       followed by "[object Object]" — the node's own account of what it had
       just written, unreadable, for as long as Story has existed. Two lines
       above, shotPlans correctly takes .prompt off the same array, which is
       what made it look right everywhere except on the node. */
    expect(combined).toContain('sh.prompt');
    expect(combined).not.toMatch(/\$\{p\}/);
  });
});
