/**
 * "when i retry samting alweys get this error"
 *
 *   Reference tile data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/…
 *   (forty thousand more characters) … not found on the Flow page
 *
 * The whole captured frame, printed back as if it were the name of a tile.
 *
 * ── Why only a retry ──
 *
 * Two runners execute this graph. The canvas one (WorkflowRunner) has always
 * sorted references correctly. The worker one (RunCoordinator) had not, and
 * since v1.5.0 every run is offered to the worker first — but a workflow
 * holding a Director or a Chief never gets there, because needsCanvas keeps it
 * local. A TARGETED retry of one clip has no such node in its `only` set. So
 * the worker's copy of this logic ran for the first time on a retry, and only
 * on a retry, which is exactly the shape the report has.
 *
 * ── Four faults in that path, not one ──
 *
 * 1. buildConfig put every reference in `referenceImageIds`, the lane the Flow
 *    adapter resolves by looking up a tile in the page's grid. A captured
 *    frame is a `data:` URL. Hence the message above.
 *
 * 2. The data nodes stamped `tileId: step.nodeId` — a canvas node id in that
 *    same tile lane, one rename away from "Reference tile frame3 not found".
 *
 * 3. An Image node was read as `data.imageUrl`, a field an Image node never
 *    sets; the upload lives in `data.imageData`. Every delegated run dropped
 *    the reference the user attached, silently.
 *
 * 4. Nothing was adopted from the canvas, and no frame was sent back to it. A
 *    retry of shot 4 therefore started with an empty memory: no Director, no
 *    board, no frame 3. The clip regenerated with no identity reference and no
 *    continuity — a generation spent on a clip that restarts the story
 *    halfway through, which is only discoverable by watching it.
 *
 * Tested against the real class rather than its source, because what matters
 * is which lane a URL lands in, not which line writes it.
 */

/// <reference types="node" />

(global as any).chrome = {
  storage: {
    session: { get: async () => ({}), set: async () => {}, remove: async () => {} },
    local: { get: async () => ({}), set: async () => {}, remove: async () => {} },
  },
  runtime: { sendMessage: () => {}, lastError: null },
};

import type { SerializedNode, SerializedEdge } from '../shared/executionTypes';

const { RunCoordinator } = require('../background/runCoordinator');

const FRAME_DATA = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD';
const BOARD_DATA = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg';

const node = (
  id: string, type: string, data: Record<string, unknown> = {},
): SerializedNode => ({ id, type, data, position: { x: 0, y: 0 } } as SerializedNode);

const edge = (source: string, target: string, targetHandle: string): SerializedEdge =>
  ({ id: `${source}->${target}`, source, target, targetHandle } as SerializedEdge);

/** A clip wired to a board and to the frame of the shot before it. */
const clip = (id: string) => node(id, 'generate', {
  platform: 'flow', mediaType: 'video', model: 'Omni 1.1 Flash',
  aspectRatio: '9:16', duration: '6s', creationType: 'ingredients',
});

const make = () => new RunCoordinator();

/** buildConfig with a given set of already-known results. */
const configFor = (
  target: SerializedNode,
  nodes: SerializedNode[],
  edges: SerializedEdge[],
  results: Record<string, any> = {},
) => {
  const c: any = make();
  /* Wired to a prompt, as on a real canvas: the worker refuses a clip with
     none, as the canvas runner always has (workerParity.test.ts). */
  c.nodeResults.set('words', { tileId: '', imageUrl: 'the next shot' });
  for (const [id, r] of Object.entries(results)) c.nodeResults.set(id, r);
  return c.buildConfig(target, [edge('words', target.id, 'text'), ...edges], nodes);
};

describe('a captured frame is not the name of a tile', () => {
  const shot4 = clip('shot4');
  const nodes = [node('frame3', 'frame', { frameUrl: FRAME_DATA }), shot4];
  const edges = [edge('frame3', 'shot4', 'image_ref')];

  it('sends a data URL in the data lane, not the id lane', () => {
    const cfg = configFor(shot4, nodes, edges, {
      frame3: { tileId: '', referenceUrl: FRAME_DATA },
    });
    expect(cfg.referenceImageData).toEqual([FRAME_DATA]);
    expect(cfg.referenceImageIds).toBeUndefined();
  });

  it('is the exact failure that was reported', () => {
    /* The adapter builds its message as `Reference tile ${tileId} not found`,
       so a data URL in that lane produces the forty-thousand-character error
       the user pasted. Nothing may put one there again. */
    const cfg = configFor(shot4, nodes, edges, {
      frame3: { tileId: '', referenceUrl: FRAME_DATA },
    });
    for (const id of cfg.referenceImageIds || []) {
      expect(id.startsWith('data:')).toBe(false);
    }
  });

  it('still sends a real Flow tile id in the id lane', () => {
    /* The lane is not dead — it is how an upstream Flow result that was never
       captured as bytes is resolved, off the tile in the page's grid. */
    const cfg = configFor(shot4, nodes, edges, {
      frame3: { tileId: 'fe_id_9917', imageUrl: 'https://flow.google.com/x.mp4' },
    });
    expect(cfg.referenceImageIds).toEqual(['fe_id_9917']);
    expect(cfg.referenceImageData).toBeUndefined();
  });

  it('never puts a canvas node id in the tile lane', () => {
    /* A frame node has no Flow tile. `tileId: step.nodeId` used to sit on
       every data node, and would come back as "Reference tile frame3 not
       found on the Flow page" the moment the data URL was missing. */
    /* And with nothing left to send, the clip is refused rather than made
       without its frame — the canvas runner's rule for a broken chain. */
    expect(() => configFor(shot4, nodes, edges, { frame3: { tileId: '' } }))
      .toThrow(/Nothing to continue from — frame3 produced no usable frame/);
  });
});

describe('Frames mode gets its stills in the order that means something', () => {
  const part2 = node('part2', 'generate', {
    platform: 'flow', mediaType: 'video', creationType: 'frames',
  });
  const nodes = [node('a', 'frame', {}), node('b', 'frame', {}), part2];
  /* Edge order deliberately reversed against port order: the end frame's edge
     was made first. Edge order is invisible on the canvas and changes when a
     connection is remade, so it must not decide which still opens the clip —
     swap them and the clip runs backwards. */
  const edges = [edge('b', 'part2', 'frame_end'), edge('a', 'part2', 'frame_start')];

  it('reads frame_start before frame_end, whatever the edges say', () => {
    const cfg = configFor(part2, nodes, edges, {
      a: { tileId: '', referenceUrl: 'data:image/png;base64,AAAA' },
      b: { tileId: '', referenceUrl: 'data:image/png;base64,BBBB' },
    });
    expect(cfg.referenceImageData).toEqual([
      'data:image/png;base64,AAAA',
      'data:image/png;base64,BBBB',
    ]);
  });
});

describe('an Image node hands over the picture it is holding', () => {
  const { staticNodeResult } = require('../background/runCoordinator');

  it('reads imageData, which is where the upload actually lives', () => {
    /* imageUrl is a field an Image node has never set. Reading it resolved
       to '' every time, so a delegated run generated without the reference
       the user had attached — and said nothing. */
    expect(staticNodeResult(node('ref', 'image', { imageData: BOARD_DATA })))
      .toEqual({ tileId: '', imageUrl: BOARD_DATA });
  });

  it('still honours imageUrl on an older saved workflow', () => {
    expect(staticNodeResult(node('ref', 'image', { imageUrl: BOARD_DATA })).imageUrl)
      .toBe(BOARD_DATA);
  });

  it('claims no Flow tile, because it has none', () => {
    for (const n of [
      node('ref', 'image', { imageData: BOARD_DATA }),
      node('p', 'prompt', { text: 'some words' }),
    ]) {
      expect(staticNodeResult(n).tileId).toBe('');
    }
  });

  it('reaches the clip below it as inline data', () => {
    const img = node('ref', 'image', { imageData: BOARD_DATA });
    const nodes = [img, clip('shot1')];
    const cfg = configFor(nodes[1], nodes, [edge('ref', 'shot1', 'image_ref')], {
      ref: staticNodeResult(img),
    });
    expect(cfg.referenceImageData).toEqual([BOARD_DATA]);
    expect(cfg.referenceImageIds).toBeUndefined();
  });

  it('carries a Prompt node as text, not as a picture', () => {
    expect(staticNodeResult(node('p', 'prompt', { text: 'a line' })).imageUrl).toBe('a line');
  });
});

describe('a retry resumes instead of starting over', () => {
  /* shot1 → frame1 → shot2, with a board feeding both clips. Retrying shot2
     alone must not need any of the rest to run again. */
  const EPISODE: SerializedNode[] = [
    node('board', 'generate', {
      platform: 'flow', mediaType: 'image', status: 'done',
      resultUrl: 'https://flow.google.com/board.png', resultTileId: 'fe_board_1',
    }),
    node('shot1', 'generate', {
      platform: 'flow', mediaType: 'video', status: 'done',
      resultUrl: 'https://flow.google.com/s1.mp4', resultTileId: 'fe_s1',
    }),
    node('frame1', 'frame', { frameUrl: FRAME_DATA }),
    clip('shot2'),
  ];
  const WIRES = [
    edge('board', 'shot1', 'image_ref'),
    edge('shot1', 'frame1', 'image_ref'),
    edge('frame1', 'shot2', 'image_ref'),
    edge('board', 'shot2', 'image_ref'),
  ];

  const adopted = (only: string[]) => {
    const c: any = make();
    const n = c.adoptCanvasResults(EPISODE, only);
    return { count: n, results: c.nodeResults as Map<string, any> };
  };

  it('reads the finished nodes off the manifest', () => {
    const { count, results } = adopted(['shot2']);
    expect(count).toBe(3);
    expect(results.get('board').tileId).toBe('fe_board_1');
    expect(results.get('shot1').imageUrl).toBe('https://flow.google.com/s1.mp4');
    expect(results.get('frame1').referenceUrl).toBe(FRAME_DATA);
  });

  it('gives the retried clip both of its references', () => {
    /* The point of all of it. Before this, shot2 was handed nothing: no
       board, no frame, and it generated anyway. */
    const { results } = adopted(['shot2']);
    const c: any = make();
    for (const [id, r] of results) c.nodeResults.set(id, r);
    c.nodeResults.set('words', { tileId: '', imageUrl: 'shot two' });
    const cfg = c.buildConfig(EPISODE[3], [edge('words', 'shot2', 'text'), ...WIRES], EPISODE);
    expect(cfg.referenceImageData).toEqual([FRAME_DATA]);
    expect(cfg.referenceImageIds).toEqual(['fe_board_1']);
  });

  it('does NOT adopt the node being retried', () => {
    /* It is the one thing the user asked to make again. Adopting it would
       turn Retry into a no-op that reports success. */
    const { results } = adopted(['shot1']);
    expect(results.has('shot1')).toBe(false);
    expect(results.has('board')).toBe(true);
  });

  it('ignores a node that has not finished', () => {
    const half = EPISODE.map(n => (n.id === 'board'
      ? node('board', 'generate', { status: 'error', resultUrl: '' }) : n));
    const c: any = make();
    c.adoptCanvasResults(half, ['shot2']);
    expect(c.nodeResults.has('board')).toBe(false);
  });

  it('does not invent a referenceUrl for an adopted clip', () => {
    /* resultUrl is an address on Flow, and previewUrl is a thumbnail. Passing
       either off as a captured last frame would hand the next clip a poster
       to continue from. The frame node's own frameUrl is the real link, and
       that one IS persisted. */
    const { results } = adopted(['shot2']);
    expect(results.get('shot1').referenceUrl).toBeUndefined();
  });
});

describe('a frame outlives the run that captured it', () => {
  const { frameStillFor } = require('../background/runCoordinator');

  it('keeps the frame the canvas holds when the clip above is skipped', () => {
    /* The bug this rule exists for. A frame node runs on every pass; with the
       clip above it skipped there is no fresh capture, and writing that
       nothing back turned every shot after the retried one red. */
    expect(frameStillFor(FRAME_DATA, [undefined])).toEqual({
      frameUrl: FRAME_DATA, fresh: false,
    });
  });

  it('prefers a fresh capture over the one it was holding', () => {
    const fresher = 'data:image/jpeg;base64,NEWER';
    expect(frameStillFor(FRAME_DATA, [{ referenceUrl: fresher }])).toEqual({
      frameUrl: fresher, fresh: true,
    });
  });

  it('does not call an unchanged capture fresh', () => {
    /* Re-running the same clip can land on the same frame. Broadcasting it
       as new would rewrite the canvas with what it already has, once per
       poll, for nothing. */
    expect(frameStillFor(FRAME_DATA, [{ referenceUrl: FRAME_DATA }])).toEqual({
      frameUrl: FRAME_DATA, fresh: false,
    });
  });

  it('refuses an upstream url that is not inline bytes', () => {
    /* An adopted clip carries imageUrl — an address on Flow — and a preview
       is a poster frame. Neither is the last frame of anything, and taking
       one would hand the next clip a thumbnail to continue from. */
    expect(frameStillFor(FRAME_DATA, [
      { referenceUrl: 'https://flow.google.com/s1.mp4' },
    ])).toEqual({ frameUrl: FRAME_DATA, fresh: false });
  });

  it('reports nothing when it has nothing, rather than a false frame', () => {
    expect(frameStillFor('', [undefined, {}])).toEqual({ frameUrl: '', fresh: false });
  });

  it('carries a fresh capture back to the canvas', () => {
    /* SW_NODE_STATUS is the only channel there is, and it described runnable
       nodes only — so a delegated run captured every frame into the worker's
       memory and left the canvas empty. The next retry then had nothing to
       adopt, which is how one failed clip cost a whole episode. */
    const c: any = make();
    const sent: any[] = [];
    c.bind({
      executeOnPlatform: async () => true,
      sendControl: () => {},
      broadcast: (m: any) => sent.push(m),
      notify: () => {},
    });
    c.updateNodeStatus('frame1', { status: 'done', frameUrl: FRAME_DATA });
    const msg = sent.find(m => m.type === 'SW_NODE_STATUS');
    expect(msg).toBeDefined();
    expect(msg.payload.frameUrl).toBe(FRAME_DATA);
    expect(msg.payload.nodeId).toBe('frame1');
  });
});

describe('the canvas applies a frame without blanking it', () => {
  const { readFileSync } = require('fs');
  const { join } = require('path');
  const RUNNER = readFileSync(
    join(__dirname, '..', 'studio', 'engine', 'WorkflowRunner.ts'), 'utf8',
  ).replace(/\r\n/g, '\n');

  it('takes the frame branch before the generate-node shape', () => {
    /* The generate shape writes resultUrl: '', previewUrl: '' and so on. Run
       over a frame node it would blank fields it does not own — and the node
       would be marked 'done' with an empty frame, which is the same bug this
       whole change exists to stop. */
    const at = RUNNER.indexOf("bridge.on('SW_NODE_STATUS'");
    expect(at).toBeGreaterThan(-1);
    const body = RUNNER.slice(at, at + 1400);
    const frameBranch = body.indexOf('if (payload.frameUrl)');
    const generateShape = body.indexOf('resultTileId: payload.resultTileId');
    expect(frameBranch).toBeGreaterThan(-1);
    expect(generateShape).toBeGreaterThan(frameBranch);
    expect(body.slice(frameBranch, generateShape)).toMatch(/return;/);
  });
});
