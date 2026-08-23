/**
 * A node type is wired up in four places, and it only works if all four agree.
 *
 *   NODE_PORTS          what the runner reads and validateTemplate checks
 *   the component       the sockets a person can actually plug a wire into
 *   nodeTypes           whether React Flow can draw it at all
 *   the toolbar         whether anyone can add one
 *
 * This repo has watched that set drift three times. The failure documented in
 * templateBoard.test.ts is the shape of it: a field added to a type, accepted
 * by the compiler, and silently dropped by the thing that builds the node.
 * The frame ports went the same way — added to NODE_PORTS and to the runner,
 * never to the node, so Frames mode had no socket to plug into and every
 * image landed on a handle the runner no longer read. Nothing threw. The node
 * generated from the prompt alone.
 *
 * So this asks the far end what it received: not "is 'clip' in the list" but
 * "does the component draw a target handle called text, and can anybody add
 * one from the toolbar".
 */

/// <reference types="node" />

import { readFileSync } from 'fs';
import { join } from 'path';
import {
  NODE_PORTS, RENDERABLE_NODE_TYPES, RUNNABLE_NODE_TYPES, portsFor,
} from '../studio/templates/validate';
import { NODE_DOCS } from '../studio/nodes/nodeInfo';

const ROOT = join(__dirname, '..', '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

/** Which component file draws which node type. */
const COMPONENT: Record<string, string> = {
  prompt: 'src/studio/nodes/PromptNode.tsx',
  image: 'src/studio/nodes/ImageNode.tsx',
  frame: 'src/studio/nodes/FrameNode.tsx',
  extend: 'src/studio/nodes/ExtendNode.tsx',
  agent: 'src/studio/nodes/AgentNode.tsx',
  story: 'src/studio/nodes/StoryNode.tsx',
  clip: 'src/studio/nodes/ClippingNode.tsx',
  /* 'generate' is deliberately absent: its ports change with its dropdowns,
     so portsFor decides them at runtime and a static read of the source
     cannot know which mode it is in. capabilities.test.ts covers it. */
};

/** The (type, id) of every Handle the component renders. */
function handlesIn(source: string): { targets: string[]; sources: string[] } {
  const targets: string[] = [];
  const sources: string[] = [];
  for (const m of source.matchAll(/<Handle\b([^>]*)>/g)) {
    const attrs = m[1];
    const kind = /type="(\w+)"/.exec(attrs)?.[1];
    const id = /\bid="([\w_]+)"/.exec(attrs)?.[1];
    if (!kind || !id) continue;
    (kind === 'target' ? targets : sources).push(id);
  }
  return { targets, sources };
}

const canvas = () => read('src/studio/components/Canvas.tsx');

/** The keys of the nodeTypes map React Flow is handed. */
function registeredTypes(): string[] {
  const block = /const nodeTypes[^=]*=\s*\{([\s\S]*?)\n\}/.exec(canvas());
  if (!block) return [];
  return [...block[1].matchAll(/^\s*(\w+)\s*:/gm)].map((m) => m[1]);
}

/* ------------------------------------------------------------------ */

describe('every node draws the ports its type declares', () => {
  const cases = Object.entries(COMPONENT);

  it('has a component mapped for each type it checks', () => {
    for (const [type] of cases) expect(NODE_PORTS[type]).toBeDefined();
  });

  it.each(cases)('%s draws exactly the inputs NODE_PORTS declares', (type, file) => {
    /* The frame-ports failure: declared, read by the runner, never drawn. */
    const { targets } = handlesIn(read(file));
    expect(new Set(targets)).toEqual(new Set(NODE_PORTS[type].in));
  });

  it.each(cases)('%s draws exactly the outputs NODE_PORTS declares', (type, file) => {
    const { sources } = handlesIn(read(file));
    expect(new Set(sources)).toEqual(new Set(NODE_PORTS[type].out));
  });
});

/* ------------------------------------------------------------------ */

describe('the Clipping node is reachable and runnable', () => {
  it('declares ports', () => {
    expect(portsFor({ type: 'clip' })).toEqual({ in: ['text'], out: ['text'] });
  });

  it('takes a transcript in and writes prompts out', () => {
    /* The input is the escape hatch: a podcast that publishes a transcript
       skips the slowest stage. The output is the same shape as the Director —
       text, to the nodes it is responsible for. */
    expect(NODE_PORTS.clip.in).toContain('text');
    expect(NODE_PORTS.clip.out).toContain('text');
  });

  it('is registered so React Flow can draw it', () => {
    expect(registeredTypes()).toContain('clip');
  });

  it('is runnable exactly when the runner can actually execute it', () => {
    /* The invariant, rather than today's state.
     *
     * Two lists, one of them wrong, and no error anywhere: the filter said
     * agents run, the switch had no case for one, so it fell through to
     * `default` and was skipped as an unknown type — counted in the progress
     * total and never executed.
     *
     * Right now the node renders and can be added but has no dispatch yet, so
     * it is correctly absent from the runnable list. When the dispatch lands,
     * this test fails until the list is updated — which is the point. It
     * cannot be satisfied by changing only one side. */
    const claimed = (RUNNABLE_NODE_TYPES as readonly string[]).includes('clip');
    const dispatched = read('src/studio/engine/WorkflowRunner.ts').includes("case 'clip':");
    expect({ claimed, dispatched }).toEqual({ claimed: dispatched, dispatched });
  });

  it('is renderable, so templates using it are not filtered out of the gallery', () => {
    expect(RENDERABLE_NODE_TYPES as readonly string[]).toContain('clip');
  });

  it('has a button on the toolbar', () => {
    /* Canvas.tsx's own comment on the Ask AI node: reaching it by adding a
       Generate node and changing two dropdowns meant nobody found it. A node
       with no button is a node that does not exist. */
    const src = canvas();
    expect(src).toMatch(/addClipNode/);
    expect(src).toMatch(/aria-label="Add Clipping node"/);
  });

  it('has documentation, so the info badge is not blank', () => {
    expect(NODE_DOCS.clip).toBeDefined();
    expect(NODE_DOCS.clip.inputs.map((p) => p.id)).toEqual(NODE_PORTS.clip.in);
    expect(NODE_DOCS.clip.outputs.map((p) => p.id)).toEqual(NODE_PORTS.clip.out);
  });
});

/* ------------------------------------------------------------------ */

describe('the checks themselves are not vacuous', () => {
  it('actually finds handles in the sources it reads', () => {
    /* If the regex stopped matching, every equality above would compare two
       empty sets and pass while proving nothing. */
    const found = Object.values(COMPONENT)
      .map((f) => handlesIn(read(f)))
      .reduce((n, h) => n + h.targets.length + h.sources.length, 0);
    expect(found).toBeGreaterThanOrEqual(Object.keys(COMPONENT).length);
  });

  it('actually finds the nodeTypes map', () => {
    expect(registeredTypes().length).toBeGreaterThan(5);
  });
});
