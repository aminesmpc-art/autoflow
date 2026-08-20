/**
 * Making the board findable.
 *
 * The storyboard flag shipped reachable from a pasted JSON file and from
 * nowhere else. So the only person who ever used it was the one who wrote the
 * file, and a real user given the same brief built three separate anchor
 * stills instead — a reasonable answer, arrived at without ever learning the
 * option existed.
 *
 * Two things fix that, and the split matters. A checkbox makes it possible.
 * An advisory makes it known. Neither forces it, because per-shot stills are
 * a legitimate choice: an unboxing on a bench and a sprint on court do not
 * need to look like one continuous scene.
 */

/// <reference types="node" />

import { readFileSync } from 'fs';
import { join } from 'path';
import { checkShots, blockingProblems, BLOCKING, type Shot, type ShotTarget } from '../studio/ask/storyboard';

const NODE = readFileSync(join(__dirname, '..', 'studio', 'nodes', 'GenerateNode.tsx'), 'utf8');
const CSS = readFileSync(join(__dirname, '..', 'studio', 'studio.css'), 'utf8');

describe('the checkbox on the node', () => {
  it('writes the flag the story director reads', () => {
    expect(NODE).toMatch(/set\('storyboardSheet', e\.target\.checked\)/);
    expect(NODE).toMatch(/checked=\{nodeData\.storyboardSheet === true\}/);
  });

  it('is offered on a still and never on a clip', () => {
    /* A board is a picture. A clip carrying the flag would be handed the
       permissive rulebook and be free to describe panels. */
    const at = NODE.indexOf('className="sn-check');
    expect(at).toBeGreaterThan(-1);
    const before = NODE.slice(at - 200, at);
    expect(before).toMatch(/\{!isVideo && !isText && \(/);
  });

  it('says what it changes, not just what it is called', () => {
    expect(NODE).toMatch(/title="Ask the story director for one picture holding every shot/);
  });

  it('has a style, so it is not an unstyled browser checkbox', () => {
    expect(CSS).toMatch(/\.sn-check \{/);
    expect(CSS).toMatch(/\.sn-check input \{/);
  });
});

const clip = (id: string): ShotTarget => ({
  id, label: id, media: 'video', platform: 'flow', duration: '10s',
});
const still = (id: string, isSheet = false): ShotTarget => ({
  id, label: id, media: 'image', platform: 'flow', isSheet,
});

const PROMPT = 'She continues lowering the ceramic jar onto the marble counter in the '
  + 'morning light, her fingers easing open as it comes to rest against the stone.';

const codes = (targets: ShotTarget[]) => checkShots(
  targets.map((t, i) => ({ n: i + 1, title: t.label, prompt: PROMPT } as Shot)),
  targets,
).map((p) => p.code);

describe('telling someone the board exists', () => {
  it('mentions it once a sequence is long enough to drift', () => {
    expect(codes([clip('a'), clip('b'), clip('c')])).toContain('noBoard');
  });

  it('stays quiet for two clips, which hold on the cast description alone', () => {
    expect(codes([clip('a'), clip('b')])).not.toContain('noBoard');
  });

  it('stays quiet once a board is on the canvas', () => {
    expect(codes([still('board', true), clip('a'), clip('b'), clip('c')])).not.toContain('noBoard');
  });

  it('says nothing to a workflow with no clips at all', () => {
    /* A set of stills is not a sequence and has nothing to drift across.
       Caught by mutation: every other case here has three or more TARGETS, so
       counting targets instead of clips passed all of them. */
    expect(codes([still('s1'), still('s2'), still('s3'), still('s4')])).not.toContain('noBoard');
  });

  it('counts clips, not everything wired to the director', () => {
    /* Two clips and four helper stills is still a two-clip piece. */
    expect(codes([still('s1'), still('s2'), still('s3'), still('s4'), clip('a'), clip('b')]))
      .not.toContain('noBoard');
  });

  it('is not satisfied by ordinary stills', () => {
    /* Three anchor stills are not a shared plan. They are three pictures. */
    expect(codes([still('s1'), still('s2'), still('s3'), clip('a'), clip('b'), clip('c')]))
      .toContain('noBoard');
  });

  it('never stops a run', () => {
    /* Per-shot stills are a legitimate answer, so this is advice and not a
       refusal. Making it blocking would refuse a workflow that works. */
    expect(BLOCKING.has('noBoard')).toBe(false);
    const problems = checkShots(
      [clip('a'), clip('b'), clip('c')].map((t, i) => ({ n: i + 1, title: t.label, prompt: PROMPT } as Shot)),
      [clip('a'), clip('b'), clip('c')],
    );
    expect(blockingProblems(problems).map((p) => p.code)).not.toContain('noBoard');
  });

  it('says how to act on it', () => {
    const problems = checkShots(
      [clip('a'), clip('b'), clip('c')].map((t, i) => ({ n: i + 1, title: t.label, prompt: PROMPT } as Shot)),
      [clip('a'), clip('b'), clip('c')],
    );
    const d = problems.find((p) => p.code === 'noBoard')?.detail || '';
    expect(d).toMatch(/"Storyboard board"/);
    expect(d).toMatch(/Skip it when the shots are meant to look unrelated/);
  });
});
