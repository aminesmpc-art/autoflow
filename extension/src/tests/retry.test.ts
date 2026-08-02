/* Retry behaviour.

   Two things here are expensive to get wrong:
   - auto-retrying a timeout would resubmit a generation that may still be
     running on Flow, charging the user twice for one clip
   - a wrong retry set would regenerate clips that already succeeded, which for
     video is minutes each plus a prompt each
*/
import type { Edge, Node } from '@xyflow/react';
import { isTransientFailure, WorkflowRunner } from '../studio/engine/WorkflowRunner';
import { getDownstreamNodeIds } from '../studio/engine/topoSort';

describe('isTransientFailure', () => {
  it('retries transport failures', () => {
    for (const msg of [
      'Lost connection to the extension — reopen Studio and try again',
      'Reference tile fe_id_123 not found on the Flow page — cannot pass its image to this node',
      'Could not fetch reference image for tile fe_id_9: HTTP 503',
      'Failed to fetch',
      'HTTP 502 Bad Gateway',
    ]) {
      expect(isTransientFailure(msg)).toBe(true);
    }
  });

  it('never retries a timeout — the generation may still be running', () => {
    const msg =
      'No result after 22 minutes. The generation may still be running — ' +
      'check the Flow tab before re-running this node.';
    expect(isTransientFailure(msg)).toBe(false);
  });

  it('never retries an authoring mistake', () => {
    for (const msg of [
      'Connected prompt node is empty — type a prompt before running',
      'No prompt connected — link a Prompt node to the T input',
      'Skipped — upstream node failed: Character Sheet',
    ]) {
      expect(isTransientFailure(msg)).toBe(false);
    }
  });

  it('does not retry an unrecognised failure', () => {
    // Default is to stop. Retrying the unknown costs a prompt to learn nothing.
    expect(isTransientFailure('Model refused the prompt')).toBe(false);
    expect(isTransientFailure('')).toBe(false);
  });
});

/* A chain: p1 -> g1 -> g2 -> g3, plus an independent p2 -> g4 */
const NODES: Node[] = [
  { id: 'p1', type: 'prompt', position: { x: 0, y: 0 }, data: { type: 'prompt', text: 'a' } },
  { id: 'g1', type: 'generate', position: { x: 1, y: 0 }, data: { type: 'generate', enabled: true } },
  { id: 'g2', type: 'generate', position: { x: 2, y: 0 }, data: { type: 'generate', enabled: true } },
  { id: 'g3', type: 'generate', position: { x: 3, y: 0 }, data: { type: 'generate', enabled: true } },
  { id: 'p2', type: 'prompt', position: { x: 0, y: 5 }, data: { type: 'prompt', text: 'b' } },
  { id: 'g4', type: 'generate', position: { x: 1, y: 5 }, data: { type: 'generate', enabled: true } },
  { id: 'gOff', type: 'generate', position: { x: 4, y: 0 }, data: { type: 'generate', enabled: false } },
];

const EDGES: Edge[] = [
  { id: 'e1', source: 'p1', target: 'g1' },
  { id: 'e2', source: 'g1', target: 'g2' },
  { id: 'e3', source: 'g2', target: 'g3' },
  { id: 'e4', source: 'p2', target: 'g4' },
  { id: 'e5', source: 'g3', target: 'gOff' },
];

describe('getDownstreamNodeIds', () => {
  it('walks the whole chain, not just direct children', () => {
    expect(getDownstreamNodeIds('g1', EDGES).sort()).toEqual(['g2', 'g3', 'gOff']);
  });

  it('does not cross into unrelated branches', () => {
    expect(getDownstreamNodeIds('g4', EDGES)).toEqual([]);
  });

  it('terminates on a cycle', () => {
    const cyclic: Edge[] = [
      { id: 'c1', source: 'a', target: 'b' },
      { id: 'c2', source: 'b', target: 'a' },
    ];
    expect(getDownstreamNodeIds('a', cyclic).sort()).toEqual(['a', 'b']);
  });
});

describe('planRetry', () => {
  // The runner pulls in the store, which pulls in chrome APIs, so exercise the
  // planner against a fresh instance with an injected result map.
  const makeRunner = (haveResultsFor: string[] = []) => {
    const r = new WorkflowRunner();
    for (const id of haveResultsFor) {
      (r as any).nodeResults.set(id, { tileId: `tile_${id}` });
    }
    return r;
  };

  it('includes the failed node and everything skipped below it', () => {
    const only = makeRunner(['g1']).planRetry(['g2'], NODES, EDGES);
    expect([...only].sort()).toEqual(['g2', 'g3']);
  });

  it('leaves successful clips out of the retry', () => {
    const only = makeRunner(['g1']).planRetry(['g2'], NODES, EDGES);
    expect(only.has('g1')).toBe(false);
    expect(only.has('g4')).toBe(false);
  });

  it('pulls upstream back in when its result is missing', () => {
    // e.g. Studio was reloaded, so the runner holds nothing.
    const only = makeRunner([]).planRetry(['g2'], NODES, EDGES);
    expect([...only].sort()).toEqual(['g1', 'g2', 'g3']);
  });

  it('never includes a disabled node', () => {
    const only = makeRunner(['g2']).planRetry(['g3'], NODES, EDGES);
    expect(only.has('gOff')).toBe(false);
    expect([...only]).toEqual(['g3']);
  });

  it('ignores prompt and image nodes', () => {
    const only = makeRunner([]).planRetry(['p1'], NODES, EDGES);
    expect(only.has('p1')).toBe(false);
  });

  it('handles several failed nodes at once without duplication', () => {
    const only = makeRunner(['g1']).planRetry(['g2', 'g3'], NODES, EDGES);
    expect([...only].sort()).toEqual(['g2', 'g3']);
  });

  it('returns nothing when asked to retry nothing', () => {
    expect(makeRunner().planRetry([], NODES, EDGES).size).toBe(0);
  });
});
