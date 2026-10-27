/**
 * "when i click retry he makes all the node as failed and i can't continue
 *  from there — i need to retry the whole workflow"
 *
 * Eight chained clips. Shots 1–3 had rendered; their Last Frame nodes were
 * holding real stills. Retry was pressed. Everything went red, and the only
 * way forward was to generate all eight again.
 *
 * ── The frame nodes were destroying themselves ───────────────────────────
 *
 * A frame node is a DATA node, so it runs on every pass — the `only` filter
 * gates runnable nodes and nothing else. On a targeted retry the clip above it
 * is skipped, so `this.nodeResults` holds no result for that clip, so the
 * frame read `upstream.referenceUrl` as undefined and captured ''.
 *
 * And then wrote that '' back onto the node.
 *
 * So pressing Retry wiped the very frames the rest of the episode was chained
 * to. Every shot after the retried one then failed with "The clip above ran
 * but gave up no last frame" — a message about a clip that had rendered
 * perfectly, minutes earlier.
 *
 * ── And the walk dragged the whole chain back in ─────────────────────────
 *
 * planRetry pulls in any upstream whose result it does not hold, and
 * `nodeResults` is in memory. After a reload it holds nothing, so retrying
 * shot 4 re-ran shots 1, 2, 3 and the Director — and paid for them again.
 *
 * The canvas knew better the whole time: a finished generate node carries its
 * result url and tile id, and a frame node carries the still it captured.
 */

/// <reference types="node" />

import type { Node, Edge } from '@xyflow/react';
import { WorkflowRunner } from '../studio/engine/WorkflowRunner';

/** An eight-shot chain, with the first three finished on the canvas. */
function episode(doneThrough: number): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [{
    id: 'director', type: 'story', position: { x: 0, y: 0 },
    data: { type: 'story', label: 'Director', status: doneThrough > 0 ? 'done' : 'idle',
      resultText: doneThrough > 0 ? 'eight prompts' : '', mediaType: 'text' },
  } as any];
  const edges: Edge[] = [];

  for (let i = 1; i <= 8; i++) {
    const done = i <= doneThrough;
    nodes.push({
      id: `s${i}`, type: 'generate', position: { x: i * 400, y: 0 },
      data: {
        type: 'generate', label: `${i} — shot`, mediaType: 'video', platform: 'flow',
        status: done ? 'done' : 'error',
        resultUrl: done ? `https://flow-content.google/video/clip-${i}` : '',
        previewUrl: done ? 'data:image/jpeg;base64,AAAA' : '',
        resultTileId: done ? `tile${i}` : '',
      },
    } as any);
    edges.push({ id: `e_d_s${i}`, source: 'director', target: `s${i}`,
      sourceHandle: 'text', targetHandle: 'text' } as any);

    if (i < 8) {
      nodes.push({
        id: `f${i}`, type: 'frame', position: { x: i * 400 + 200, y: 0 },
        /* The still captured when that clip actually finished. */
        data: { type: 'frame', label: `Shot ${i} ends here`,
          frameUrl: done ? `data:image/jpeg;base64,FRAME${i}` : '' },
      } as any);
      edges.push({ id: `e_s${i}_f${i}`, source: `s${i}`, target: `f${i}`,
        sourceHandle: 'result', targetHandle: 'image_ref' } as any);
      edges.push({ id: `e_f${i}_s${i + 1}`, source: `f${i}`, target: `s${i + 1}`,
        sourceHandle: 'image', targetHandle: 'image_ref' } as any);
    }
  }
  return { nodes, edges };
}

describe('a retry resumes instead of restarting', () => {
  it('does not drag finished shots back in', () => {
    /* Shots 1–3 rendered. Retrying shot 4 must run 4 onward and nothing
       before it. Before the fix this returned the whole episode plus the
       Director, and charged for every one of them. */
    const { nodes, edges } = episode(3);
    const runner = new WorkflowRunner();
    const only = runner.planRetry(['s4'], nodes, edges);

    for (const id of ['s1', 's2', 's3', 'director']) expect(only.has(id)).toBe(false);
    for (const id of ['s4', 's5', 's6', 's7', 's8']) expect(only.has(id)).toBe(true);
  });

  it('still pulls in the Director when nothing has been written yet', () => {
    /* Nothing finished, so there is nothing to adopt and the walk does what
       it always did.

       Note what it does NOT do, which surprised me while writing this: it
       never reaches s3. The upstream walk skips anything that is not runnable
       and stops there, so it cannot traverse THROUGH a frame node — and every
       shot in this episode is behind one. That is pre-existing behaviour and
       it is correct here, because a frame carries its own still. */
    const { nodes, edges } = episode(0);
    const runner = new WorkflowRunner();
    const only = runner.planRetry(['s4'], nodes, edges);

    expect(only.has('director')).toBe(true);
    expect(only.has('s4')).toBe(true);
  });

  it('pulls in an unfinished upstream shot when it is wired directly', () => {
    /* No frame in between, so the walk can see it. This is the case the
       adoption has to not break. */
    const nodes: Node[] = [
      { id: 'a', type: 'generate', position: { x: 0, y: 0 },
        data: { type: 'generate', mediaType: 'image', status: 'error', resultUrl: '' } },
      { id: 'b', type: 'generate', position: { x: 400, y: 0 },
        data: { type: 'generate', mediaType: 'video', status: 'error' } },
    ] as any;
    const edges: Edge[] = [{ id: 'e', source: 'a', target: 'b',
      sourceHandle: 'result', targetHandle: 'image_ref' }] as any;

    expect(new WorkflowRunner().planRetry(['b'], nodes, edges).has('a')).toBe(true);
  });

  it('reads a half-finished episode back exactly as far as it got', () => {
    const { nodes, edges } = episode(5);
    const runner = new WorkflowRunner();
    const only = runner.planRetry(['s6'], nodes, edges);

    for (const id of ['s1', 's2', 's3', 's4', 's5']) expect(only.has(id)).toBe(false);
    expect(only.has('s6')).toBe(true);
    expect(only.has('s8')).toBe(true);
  });

  it('will not adopt a node that is done but carries nothing', () => {
    /* A node marked done with no result is not a result. Adopting it would
       hand the next clip an empty reference and call that resuming. Wired
       directly, so the walk can actually reach it. */
    const nodes: Node[] = [
      { id: 'a', type: 'generate', position: { x: 0, y: 0 },
        data: { type: 'generate', mediaType: 'image', status: 'done',
          resultUrl: '', previewUrl: '', resultText: '' } },
      { id: 'b', type: 'generate', position: { x: 400, y: 0 },
        data: { type: 'generate', mediaType: 'video', status: 'error' } },
    ] as any;
    const edges: Edge[] = [{ id: 'e', source: 'a', target: 'b',
      sourceHandle: 'result', targetHandle: 'image_ref' }] as any;

    expect(new WorkflowRunner().planRetry(['b'], nodes, edges).has('a')).toBe(true);

    /* And the same node WITH a result is adopted and left alone. */
    (nodes[0].data as any).resultUrl = 'https://flow-content.google/image/x';
    expect(new WorkflowRunner().planRetry(['b'], nodes, edges).has('a')).toBe(false);
  });
});

describe('a frame never throws away the still it is holding', () => {
  const SRC = require('fs').readFileSync(
    require('path').join(__dirname, '..', 'studio', 'engine', 'WorkflowRunner.ts'), 'utf8');

  it('falls back to what the node already has', () => {
    const at = SRC.indexOf("case 'frame': {");
    expect(at).toBeGreaterThan(-1);
    const body = SRC.slice(at, at + 2600);
    expect(body).toMatch(/const held = typeof nodeData\.frameUrl === 'string'/);
    expect(body).toMatch(/const frameUrl = captured \|\| held;/);
  });

  it('only writes to the node when the value actually changed', () => {
    /* The write was the destructive part. A pass that learned nothing must
       leave the node alone rather than storing its own ignorance. */
    const at = SRC.indexOf("case 'frame': {");
    const body = SRC.slice(at, at + 2600);
    expect(body).toMatch(/if \(frameUrl !== held\) store\.updateNodeData/);
    expect(body).not.toMatch(/store\.updateNodeData\(step\.nodeId, \{ frameUrl \}\);\s*\n\s*if \(!frameUrl\)/);
  });

  it('says so in the log, because a silent skip is how this hid', () => {
    const at = SRC.indexOf("case 'frame': {");
    expect(SRC.slice(at, at + 2600)).toMatch(/kept the frame it already had/);
  });
});

describe('what the canvas is allowed to stand in for', () => {
  const SRC = require('fs').readFileSync(
    require('path').join(__dirname, '..', 'studio', 'engine', 'WorkflowRunner.ts'), 'utf8');

  it('refuses to invent a referenceUrl for a generate node', () => {
    /* It is not persisted. Reconstructing one from the preview would hand a
       chained clip a thumbnail and call it a last frame — which is the exact
       failure this whole area keeps producing. The frame node's own frameUrl
       is the link, and that IS persisted. */
    const at = SRC.indexOf('private adoptCanvasResults');
    expect(at).toBeGreaterThan(-1);
    // A real saved capture may return; a poster must never stand in for it.
    expect(SRC.slice(at, at + 1800)).toMatch(/referenceUrl: inlineFrame\(d\.lastFrameUrl\)/);
    expect(SRC.slice(at, at + 1800)).not.toMatch(/referenceUrl:\s*d\.previewUrl/);
    /* And the reason is written down, above it. */
    expect(SRC.slice(Math.max(0, at - 1600), at)).toMatch(/NOT reconstructing/);
  });

  it('never overwrites a result the runner produced this session', () => {
    const at = SRC.indexOf('private adoptCanvasResults');
    expect(SRC.slice(at, at + 2000)).toMatch(/if \(this\.nodeResults\.has\(node\.id\)\) continue;/);
  });
});
