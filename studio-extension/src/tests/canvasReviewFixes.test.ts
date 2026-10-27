/**
 * The canvas half of a 1-star review (19 Oct 2026): "Nodes dont properly
 * connect. Images won't attach to video start frames." Each case below was
 * reproduced in the canvas harness before it was fixed.
 */

/// <reference types="node" />

import { readFileSync } from 'fs';
import { join } from 'path';

const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8').replace(/\r\n/g, '\n');
const CANVAS = read('studio/components/Canvas.tsx');
const FRAME = read('studio/nodes/FrameNode.tsx');

const fn = (src: string, name: string): string => {
  // Typed or not: `const onConnectEnd: OnConnectEnd = useCallback(`.
  const at = src.search(new RegExp(`const ${name}(: \\w+)? = useCallback\\(`));
  expect(at).toBeGreaterThan(-1);
  return src.slice(at, src.indexOf('\n  }, [', at) + 200);
};

describe('a wire released on a node connects', () => {
  /* React Flow only connects within 20px of a handle. Released on the
     middle of a node, a wire did nothing — no edge, no message. */
  it('falls back to the node under the pointer when no port was hit', () => {
    const end = fn(CANVAS, 'onConnectEnd');
    expect(end).toMatch(/if \(!state\.toHandle\) \{ connectByDrop\(event, state\.fromHandle as any\); return; \}/);
  });

  it('chooses the first port the existing rules allow, and explains when none does', () => {
    const drop = fn(CANVAS, 'connectByDrop');
    expect(drop).toContain('elementFromPoint');
    expect(drop).toContain("closest?.('.react-flow__node')");
    expect(drop).toMatch(/attempts\.find\(\(c\) => canConnect\(c, edges, nodes\)\)/);
    expect(drop).toContain('setConnectionMsg(');
  });

  it('tries V before 🖼, so a clip dropped on a clip is used whole', () => {
    const drop = fn(CANVAS, 'connectByDrop');
    expect(drop).toMatch(/ports\.sort\(\(a, b\) => Number\(b === 'video_ref'\) - Number\(a === 'video_ref'\)\)/);
    expect(drop.indexOf('ports.sort(')).toBeLessThan(drop.indexOf('const attempts'));
  });
});

describe('a new node lands where it can be used', () => {
  const place = fn(CANVAS, 'place');

  it('reads measured sizes from React Flow, not the store', () => {
    /* The store's nodes carry no size: a 551px video clip was placed by a
       380px guess and the next node landed on its lower half. */
    expect(place).toContain('getNodes().map((n) => boxOf(n as any))');
  });

  it('keeps clear of the panels floating over the canvas', () => {
    for (const panel of ['.studio-toolbar', '.studio-dock', '.react-flow__minimap']) expect(place).toContain(panel);
  });

  it('brings a node it had to put off screen into view', () => {
    expect(place).toMatch(/if \(!inView\) \{/);
    expect(place).toContain('setCenter(spot.x + size.w / 2, spot.y + size.h / 2');
  });
});

describe('a Flow clip starts as a clip', () => {
  /* It made an image until Output was changed, and Start/End frames exist
     only for video — so the start-frame port was nowhere to be found. */
  it('defaults to video with the builder\'s own video model', () => {
    const add = fn(CANVAS, 'addGenerateNode');
    expect(add).toContain("model: 'Omni 1.1 Flash'");
    expect(add).toContain("mediaType: 'video'");
  });
});

describe('the Last Frame node only warns about a capture that happened', () => {
  it('is created without a frameUrl', () => {
    const add = fn(CANVAS, 'addFrameNode');
    expect(add).not.toMatch(/frameUrl: ''/);
  });

  it('reads "ran empty" from the clip feeding it, not from an empty string', () => {
    /* frameUrl: '' was the creation default, so every new node opened on
       "The clip above ran but gave up no last frame". */
    expect(FRAME).not.toMatch(/typeof nodeData\.frameUrl === 'string'/);
    expect(FRAME).toMatch(/\(source\?\.data as any\)\?\.status === 'done'/);
    expect(FRAME).toMatch(/const ranEmpty = !frame && upstreamDone;/);
  });
});
